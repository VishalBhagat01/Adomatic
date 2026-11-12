import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { MetaRepository, sanitizeConnection } from '../repositories/metaRepository.js';
import { metaGraphClient } from '../integrations/meta/metaClient.js';
import { decryptToken, encryptToken, getTokenLast4 } from '../integrations/meta/metaCrypto.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthStateStore = new Map();

function pruneExpiredStates() {
  const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
  for (const [state, entry] of oauthStateStore.entries()) {
    if (entry.createdAt < cutoff) {
      oauthStateStore.delete(state);
    }
  }
}

function normalizeAdAccountId(id) {
  if (!id) return null;
  const trimmed = String(id).trim();
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

function deriveConnectionLifecycle(conn) {
  if (!conn) return null;
  const nowMs = Date.now();
  const expiresMs = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt).getTime() : null;
  let computedStatus = conn.status;

  if (expiresMs && expiresMs <= nowMs) {
    computedStatus = 'expired';
  } else if (expiresMs && expiresMs - nowMs <= 14 * 24 * 60 * 60 * 1000 && computedStatus === 'active') {
    computedStatus = 'expiring_soon';
  }

  const daysRemaining =
    expiresMs !== null ? Math.max(0, Math.ceil((expiresMs - nowMs) / (24 * 60 * 60 * 1000))) : null;

  return {
    ...sanitizeConnection(conn),
    status: computedStatus,
    daysUntilExpiry: daysRemaining,
    hasAdsRead: Array.isArray(conn.scopes) && conn.scopes.includes('ads_read'),
    hasAdsManagement: Array.isArray(conn.scopes) && conn.scopes.includes('ads_management'),
    appConfigured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
    graphApiVersion: env.META_GRAPH_API_VERSION,
  };
}

export class MetaAuthService {
  /**
   * Generate CSRF-protected OAuth Dialog URL bound to current tenant & user.
   */
  static startOAuthFlow({ tenantId, userId, includeWriteScope = false }, client = metaGraphClient) {
    pruneExpiredStates();
    const state = crypto.randomBytes(24).toString('hex');
    const scopes = includeWriteScope
      ? ['ads_read', 'ads_management', 'business_management']
      : ['ads_read'];

    oauthStateStore.set(state, {
      tenantId,
      userId: userId ? String(userId) : null,
      scopes,
      createdAt: Date.now(),
    });

    const authUrl = client.buildOAuthUrl({
      state,
      scopes,
    });

    return { authUrl, state, scopes };
  }

  /**
   * Complete OAuth callback: validate CSRF state, exchange code -> long-lived token,
   * inspect permissions via /debug_token, discover owned Ad Accounts, and store encrypted.
   */
  static async handleOAuthCallback({ code, state, errorDescription }, client = metaGraphClient) {
    if (errorDescription) {
      throw new BadRequestError(`Meta OAuth authorization declined: ${errorDescription}`);
    }
    if (!code || !state) {
      throw new BadRequestError('Both OAuth code and state are required');
    }

    const storedState = oauthStateStore.get(state);
    oauthStateStore.delete(state);
    if (!storedState || Date.now() - storedState.createdAt > OAUTH_STATE_TTL_MS) {
      throw new UnauthorizedError('Invalid or expired Meta OAuth CSRF state');
    }

    const tokenBundle = await client.exchangeCodeForLongLivedToken({ code });
    return this._inspectAndPersistConnection(
      {
        tenantId: storedState.tenantId,
        userId: storedState.userId,
        rawToken: tokenBundle.accessToken,
        connectionType: 'oauth_user',
        fallbackExpiresIn: tokenBundle.expiresIn,
      },
      client
    );
  }

  /**
   * Secure server-side System User or long-lived user token connection.
   * Token is immediately inspected via Meta Graph API, verified for ads_read + owned ad accounts,
   * encrypted at rest with AES-256-GCM, and never echoed back.
   */
  static async connectWithToken(
    { tenantId, userId, accessToken, connectionType = 'system_user', primaryAdAccountId = null },
    client = metaGraphClient
  ) {
    return this._inspectAndPersistConnection(
      {
        tenantId,
        userId,
        rawToken: accessToken,
        connectionType,
        primaryAdAccountId,
      },
      client
    );
  }

  static async _inspectAndPersistConnection(
    {
      tenantId,
      userId,
      rawToken,
      connectionType = 'oauth_user',
      primaryAdAccountId = null,
      fallbackExpiresIn = null,
    },
    client = metaGraphClient
  ) {
    const cleanToken = String(rawToken || '').trim();
    if (!cleanToken) {
      throw new BadRequestError('Meta access token cannot be empty');
    }

    const debugInfo = await client.debugToken({ inputToken: cleanToken });
    if (!debugInfo || debugInfo.is_valid === false) {
      throw new UnauthorizedError('Meta token failed /debug_token validation or has expired');
    }

    const scopes = Array.isArray(debugInfo.scopes) ? debugInfo.scopes : [];
    if (scopes.length > 0 && !scopes.includes('ads_read') && !scopes.includes('ads_management')) {
      throw new ForbiddenError(
        'Meta token lacks required ads_read or ads_management permission',
        { scopes }
      );
    }

    const { items: rawAccounts } = await client.getAdAccounts({ accessToken: cleanToken });
    const connectedAdAccounts = (rawAccounts || []).map((acc) => {
      const adAccountId = normalizeAdAccountId(acc.id || acc.account_id);
      return {
        adAccountId,
        accountId: String(acc.account_id || adAccountId.replace(/^act_/, '')),
        name: acc.name || adAccountId,
        currency: (acc.currency || 'USD').toUpperCase(),
        timezoneName: acc.timezone_name || 'UTC',
        timezoneOffsetHoursUtc: Number(acc.timezone_offset_hours_utc ?? 0),
        accountStatus: Number(acc.account_status ?? 1),
        businessName: acc.business?.name || '',
      };
    });

    if (connectedAdAccounts.length === 0) {
      throw new ForbiddenError(
        'No accessible Meta Ad Accounts found for this token. Assign user/system user an Ad Account role in Business Manager.'
      );
    }

    let chosenPrimary = connectedAdAccounts[0].adAccountId;
    if (primaryAdAccountId) {
      const normalizedTarget = normalizeAdAccountId(primaryAdAccountId);
      const owned = connectedAdAccounts.find((a) => a.adAccountId === normalizedTarget);
      if (!owned) {
        throw new ForbiddenError(
          `Requested Ad Account ${normalizedTarget} is not accessible by this Meta token`
        );
      }
      chosenPrimary = owned.adAccountId;
    }

    let tokenExpiresAt = null;
    if (Number(debugInfo.expires_at) > 0) {
      tokenExpiresAt = new Date(Number(debugInfo.expires_at) * 1000);
    } else if (fallbackExpiresIn && Number(fallbackExpiresIn) > 0) {
      tokenExpiresAt = new Date(Date.now() + Number(fallbackExpiresIn) * 1000);
    }

    const dataAccessExpiresAt =
      Number(debugInfo.data_access_expires_at) > 0
        ? new Date(Number(debugInfo.data_access_expires_at) * 1000)
        : null;

    const tokenType =
      debugInfo.type === 'SYSTEM_USER' || connectionType === 'system_user'
        ? 'SYSTEM_USER'
        : 'USER';

    const accessTier =
      tokenType === 'SYSTEM_USER' ? 'system_user' : 'development_or_limited';

    const encryptedToken = encryptToken(cleanToken);
    const saved = await MetaRepository.saveConnection({
      tenantId,
      userId,
      connectionType,
      tokenType,
      accessTier,
      metaUserId: String(debugInfo.user_id || ''),
      metaUserName: String(debugInfo.user_name || ''),
      encryptedToken,
      tokenLast4: getTokenLast4(cleanToken),
      tokenExpiresAt,
      dataAccessExpiresAt,
      scopes,
      writeAuthorized: false, // Always require explicit user authorization separately
      primaryAdAccountId: chosenPrimary,
      connectedAdAccounts,
      status: 'active',
      lastDebuggedAt: new Date(),
    });

    logger.info(`Meta connection established for tenant ${tenantId}`, {
      connectionId: saved.id,
      tokenType,
      accountsCount: connectedAdAccounts.length,
    });

    return deriveConnectionLifecycle(saved);
  }

  static async getConnectionStatus(tenantId, { refreshDebug = false } = {}, client = metaGraphClient) {
    const conn = await MetaRepository.getActiveConnection(tenantId, {
      includeEncryptedToken: refreshDebug,
    });
    if (!conn) {
      return {
        connected: false,
        connection: null,
        appConfigured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
        graphApiVersion: env.META_GRAPH_API_VERSION,
      };
    }

    if (refreshDebug && conn.encryptedToken) {
      try {
        const token = decryptToken(conn.encryptedToken);
        const debugInfo = await client.debugToken({ inputToken: token });
        const nextStatus = debugInfo?.is_valid === false ? 'expired' : 'active';
        const updated = await MetaRepository.updateConnection(conn.id, tenantId, {
          status: nextStatus,
          scopes: Array.isArray(debugInfo?.scopes) ? debugInfo.scopes : conn.scopes,
          lastDebuggedAt: new Date(),
        });
        return {
          connected: nextStatus !== 'expired',
          connection: deriveConnectionLifecycle(updated),
          appConfigured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
          graphApiVersion: env.META_GRAPH_API_VERSION,
        };
      } catch (err) {
        logger.warn(`Meta token debug probe failed for tenant ${tenantId}: ${err.message}`);
      }
    }

    const formatted = deriveConnectionLifecycle(conn);
    return {
      connected: formatted.status !== 'expired' && formatted.status !== 'revoked',
      connection: formatted,
      appConfigured: Boolean(env.META_APP_ID && env.META_APP_SECRET),
      graphApiVersion: env.META_GRAPH_API_VERSION,
    };
  }

  static async selectPrimaryAdAccount(tenantId, adAccountId) {
    const conn = await MetaRepository.getActiveConnection(tenantId);
    if (!conn) {
      throw new NotFoundError('No active Meta Marketing connection found for this workspace');
    }
    const normalized = normalizeAdAccountId(adAccountId);
    const owned = (conn.connectedAdAccounts || []).find((a) => a.adAccountId === normalized);
    if (!owned) {
      throw new ForbiddenError(`Ad Account ${normalized} is not owned by the connected Meta credentials`);
    }

    const updated = await MetaRepository.updateConnection(conn.id, tenantId, {
      primaryAdAccountId: normalized,
    });
    return deriveConnectionLifecycle(updated);
  }

  /**
   * Explicit user authorization gate required before publishing ads or modifying budgets.
   */
  static async setWriteAuthorization(tenantId, userId, { authorize, confirmationPhrase = '' }) {
    const conn = await MetaRepository.getActiveConnection(tenantId);
    if (!conn) {
      throw new NotFoundError('Connect a Meta Marketing account before configuring write authorization');
    }

    if (authorize) {
      const hasManagementScope =
        Array.isArray(conn.scopes) && conn.scopes.includes('ads_management');
      if (!hasManagementScope) {
        throw new ForbiddenError(
          'Connected Meta token does not include ads_management permission; reconnect with write scopes before authorizing campaign/budget changes'
        );
      }
      if (confirmationPhrase && confirmationPhrase !== 'AUTHORIZE_META_WRITES') {
        throw new BadRequestError(
          'confirmation_phrase must match AUTHORIZE_META_WRITES when supplied'
        );
      }
    }

    const updated = await MetaRepository.updateConnection(conn.id, tenantId, {
      writeAuthorized: Boolean(authorize),
      writeAuthorizedAt: authorize ? new Date() : null,
      writeAuthorizedBy: authorize ? String(userId || 'workspace_user') : null,
    });

    return deriveConnectionLifecycle(updated);
  }

  /**
   * Resolve decrypted backend-only access token + verified Ad Account metadata
   * while validating tenant & Meta ad account ownership.
   */
  static async resolveAuthorizedAccountContext(tenantId, requestedAdAccountId = null) {
    const conn = await MetaRepository.getActiveConnection(tenantId, {
      includeEncryptedToken: true,
    });
    if (!conn || conn.status === 'revoked') {
      throw new NotFoundError('No active Meta connection found. Connect Meta Marketing API in Settings first.');
    }

    const lifecycle = deriveConnectionLifecycle(conn);
    if (lifecycle.status === 'expired') {
      throw new UnauthorizedError('Meta access token has expired. Re-authenticate in Studio Settings.');
    }

    const targetAccountId = normalizeAdAccountId(requestedAdAccountId || conn.primaryAdAccountId);
    const accountMeta = (conn.connectedAdAccounts || []).find(
      (a) => a.adAccountId === targetAccountId
    );
    if (!accountMeta) {
      throw new ForbiddenError(
        `Ad Account ${targetAccountId || '(unspecified)'} is not verified under this Meta connection`
      );
    }

    const accessToken = decryptToken(conn.encryptedToken);
    return {
      connection: lifecycle,
      accountMeta,
      accessToken,
    };
  }

  /**
   * Guard executed prior to ANY Meta write operation (publishing ads or editing budgets).
   */
  static async assertWriteAuthorized(tenantId, adAccountId, explicitUserAuthorizationFlag) {
    if (explicitUserAuthorizationFlag !== true) {
      throw new ForbiddenError(
        'Explicit user authorization confirmation is required before publishing ads or modifying budgets'
      );
    }
    const ctx = await this.resolveAuthorizedAccountContext(tenantId, adAccountId);
    if (!ctx.connection.writeAuthorized) {
      throw new ForbiddenError(
        'Meta write operations are currently locked. Enable Write Authorization explicitly in Settings first.'
      );
    }
    if (!ctx.connection.hasAdsManagement) {
      throw new ForbiddenError(
        'Connected Meta token only has read permissions (missing ads_management scope)'
      );
    }
    return ctx;
  }

  static async disconnect(tenantId) {
    await MetaRepository.revokeConnections(tenantId);
    return { disconnected: true };
  }

  static clearOAuthStates() {
    oauthStateStore.clear();
  }
}

