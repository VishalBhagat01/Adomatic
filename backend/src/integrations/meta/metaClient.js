import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { computeAppSecretProof } from './metaCrypto.js';
import { classifyMetaApiError, MetaRateLimitTracker } from './metaRateLimiter.js';

const DEFAULT_INSIGHT_FIELDS = [
  'account_id',
  'account_currency',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'date_start',
  'date_stop',
  'impressions',
  'reach',
  'spend',
  'cpm',
  'clicks',
  'ctr',
  'cpc',
  'inline_link_clicks',
  'inline_link_click_ctr',
  'cost_per_inline_link_click',
  'actions',
  'action_values',
  'cost_per_action_type',
  'purchase_roas',
  'website_purchase_roas',
  'attribution_setting',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MetaGraphClient {
  constructor({
    graphBaseUrl = 'https://graph.facebook.com',
    oauthBaseUrl = 'https://www.facebook.com',
    apiVersion = env.META_GRAPH_API_VERSION,
    fetchImpl = globalThis.fetch,
    rateTracker = new MetaRateLimitTracker(),
  } = {}) {
    this.graphBaseUrl = graphBaseUrl.replace(/\/+$/, '');
    this.oauthBaseUrl = oauthBaseUrl.replace(/\/+$/, '');
    this.apiVersion = apiVersion || 'v27.0';
    this.fetchImpl = fetchImpl;
    this.rateTracker = rateTracker;
  }

  /**
   * Build Meta OAuth Dialog URL with CSRF state and explicit read/write scopes.
   */
  buildOAuthUrl({
    clientId = env.META_APP_ID,
    redirectUri = env.META_REDIRECT_URI,
    state,
    scopes = ['ads_read'],
  }) {
    if (!clientId) {
      throw new AppError(
        'META_APP_ID must be configured to initiate Meta OAuth login',
        400,
        'META_APP_NOT_CONFIGURED'
      );
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: scopes.join(','),
    });
    return `${this.oauthBaseUrl}/${this.apiVersion}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Execute a low-level Graph API request with appsecret_proof, rate-limit tracking, and retry backoff.
   */
  async request(pathOrUrl, {
    method = 'GET',
    accessToken = null,
    params = {},
    body = null,
    scopeKey = 'global',
    maxRetries = 2,
    timeoutMs = 20000,
  } = {}) {
    const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
    const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    const url = new URL(
      isAbsolute ? pathOrUrl : `${this.graphBaseUrl}/${this.apiVersion}${cleanPath}`
    );

    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    }

    // Never duplicate access_token if paging.next already carries it
    if (accessToken && !url.searchParams.has('access_token')) {
      url.searchParams.set('access_token', accessToken);
    }
    const proof = accessToken ? computeAppSecretProof(accessToken) : null;
    if (proof && !url.searchParams.has('appsecret_proof')) {
      url.searchParams.set('appsecret_proof', proof);
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt += 1;
      const delayMs = this.rateTracker.getRecommendedDelayMs(scopeKey);
      if (delayMs > 0) {
        logger.warn(`Proactive Meta API rate-limit pause (${delayMs}ms) for scope ${scopeKey}`);
        await sleep(Math.min(delayMs, 3000));
      }

      const fetchOptions = {
        method,
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (body && method !== 'GET') {
        fetchOptions.headers['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await this.fetchImpl(url.toString(), fetchOptions);
      const rateInfo = this.rateTracker.record(scopeKey, response.headers);

      const text = await response.text();
      let json = {};
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { message: text };
        }
      }

      if (response.ok) {
        return { data: json, rateInfo };
      }

      const domainErr = classifyMetaApiError(response.status, json, rateInfo);
      const isRetryable = domainErr.statusCode === 429 || response.status >= 500;
      if (!isRetryable || attempt > maxRetries) {
        throw domainErr;
      }

      const backoffMs = Math.min(2500, 400 * attempt);
      await sleep(backoffMs);
    }

    throw new AppError('Meta Graph API request exhausted retries', 503, 'META_RETRY_EXHAUSTED');
  }

  /**
   * Exchange OAuth authorization code for short-lived token, then extend to ~60-day long-lived token.
   */
  async exchangeCodeForLongLivedToken({
    code,
    clientId = env.META_APP_ID,
    clientSecret = env.META_APP_SECRET,
    redirectUri = env.META_REDIRECT_URI,
  }) {
    if (!clientId || !clientSecret) {
      throw new AppError(
        'META_APP_ID and META_APP_SECRET are required to exchange OAuth codes',
        400,
        'META_APP_NOT_CONFIGURED'
      );
    }

    const shortRes = await this.request('/oauth/access_token', {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      },
      scopeKey: 'oauth',
    });

    const shortToken = shortRes.data?.access_token;
    if (!shortToken) {
      throw new AppError('Meta OAuth token response did not contain access_token', 502, 'META_OAUTH_ERROR');
    }

    return this.exchangeLongLivedToken({
      shortLivedToken: shortToken,
      clientId,
      clientSecret,
    });
  }

  async exchangeLongLivedToken({
    shortLivedToken,
    clientId = env.META_APP_ID,
    clientSecret = env.META_APP_SECRET,
  }) {
    if (!clientId || !clientSecret) {
      return {
        accessToken: shortLivedToken,
        tokenType: 'bearer',
        expiresIn: null,
      };
    }

    const longRes = await this.request('/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: clientId,
        client_secret: clientSecret,
        fb_exchange_token: shortLivedToken,
      },
      scopeKey: 'oauth',
    });

    return {
      accessToken: longRes.data?.access_token || shortLivedToken,
      tokenType: longRes.data?.token_type || 'bearer',
      expiresIn: Number(longRes.data?.expires_in || 0) || null,
    };
  }

  /**
   * Inspect token validity, expiration timestamps, and granted scopes via /debug_token.
   */
  async debugToken({
    inputToken,
    appId = env.META_APP_ID,
    appSecret = env.META_APP_SECRET,
  }) {
    if (appId && appSecret) {
      const appAccessToken = `${appId}|${appSecret}`;
      const res = await this.request('/debug_token', {
        accessToken: appAccessToken,
        params: { input_token: inputToken },
        scopeKey: 'debug_token',
      });
      return res.data?.data || res.data || null;
    }

    // Fallback when app credentials aren't configured: probe /me + /me/permissions with user token
    const [meRes, permRes] = await Promise.all([
      this.request('/me', { accessToken: inputToken, params: { fields: 'id,name' }, scopeKey: 'me' }),
      this.request('/me/permissions', { accessToken: inputToken, scopeKey: 'me_permissions' }),
    ]);
    const grantedScopes = (permRes.data?.data || [])
      .filter((p) => p.status === 'granted')
      .map((p) => p.permission);

    return {
      is_valid: true,
      type: 'USER',
      user_id: meRes.data?.id || '',
      user_name: meRes.data?.name || '',
      scopes: grantedScopes,
      expires_at: 0,
      data_access_expires_at: 0,
    };
  }

  /**
   * Traverse cursor-paginated Graph edges via paging.next or paging.cursors.after.
   */
  async fetchPaginated(edgePath, {
    accessToken,
    params = {},
    scopeKey = 'global',
    maxPages = 20,
  } = {}) {
    const items = [];
    let currentTarget = edgePath;
    let currentParams = { ...params };
    let page = 0;
    let lastRateInfo = null;

    while (page < maxPages && currentTarget) {
      page += 1;
      const { data, rateInfo } = await this.request(currentTarget, {
        accessToken,
        params: currentParams,
        scopeKey,
      });
      lastRateInfo = rateInfo;

      if (Array.isArray(data?.data)) {
        items.push(...data.data);
      }

      const nextUrl = data?.paging?.next;
      const afterCursor = data?.paging?.cursors?.after;

      if (nextUrl) {
        currentTarget = nextUrl;
        currentParams = {}; // paging.next already carries query params cleanly
      } else if (afterCursor && Array.isArray(data?.data) && data.data.length > 0) {
        currentTarget = edgePath;
        currentParams = { ...params, after: afterCursor };
      } else {
        break;
      }
    }

    return { items, pagesFetched: page, rateInfo: lastRateInfo };
  }

  async getAdAccounts({ accessToken }) {
    return this.fetchPaginated('/me/adaccounts', {
      accessToken,
      params: {
        fields: 'id,account_id,name,currency,timezone_name,timezone_offset_hours_utc,account_status,business{id,name}',
        limit: 50,
      },
      scopeKey: 'adaccounts',
    });
  }

  async getCampaigns({ accessToken, adAccountId }) {
    const cleanAct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    return this.fetchPaginated(`/${cleanAct}/campaigns`, {
      accessToken,
      params: {
        fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time',
        limit: 100,
      },
      scopeKey: cleanAct,
    });
  }

  async getAds({ accessToken, adAccountId }) {
    const cleanAct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    return this.fetchPaginated(`/${cleanAct}/ads`, {
      accessToken,
      params: {
        fields: 'id,name,campaign_id,adset_id,status,effective_status,creative{id,name,title,body,thumbnail_url,object_story_spec},adset{id,name}',
        limit: 100,
      },
      scopeKey: cleanAct,
    });
  }

  async getInsights({
    accessToken,
    adAccountId,
    level = 'ad',
    since,
    until,
    timeIncrement = 1,
    breakdowns = [],
    attributionWindows = ['7d_click', '1d_view'],
    useUnifiedAttributionSetting = true,
    fields = DEFAULT_INSIGHT_FIELDS,
  }) {
    const cleanAct = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const params = {
      level,
      fields: fields.join(','),
      time_increment: timeIncrement,
      use_unified_attribution_setting: useUnifiedAttributionSetting ? 'true' : 'false',
      limit: 250,
    };

    if (since && until) {
      params.time_range = JSON.stringify({ since, until });
    }
    if (Array.isArray(breakdowns) && breakdowns.length > 0) {
      params.breakdowns = breakdowns.join(',');
    }
    if (Array.isArray(attributionWindows) && attributionWindows.length > 0) {
      params.action_attribution_windows = JSON.stringify(attributionWindows);
    }

    return this.fetchPaginated(`/${cleanAct}/insights`, {
      accessToken,
      params,
      scopeKey: cleanAct,
      maxPages: 30,
    });
  }

  /**
   * Guarded write call: requires caller service to enforce explicit writeAuthorization beforehand.
   */
  async updateAdEntity({ accessToken, entityId, payload, scopeKey = 'write' }) {
    return this.request(`/${entityId}`, {
      method: 'POST',
      accessToken,
      body: payload,
      scopeKey,
    });
  }
}

export const metaGraphClient = new MetaGraphClient();

