import { env } from '../config/env.js';
import { metaGraphClient } from '../integrations/meta/metaClient.js';
import { MetaRepository } from '../repositories/metaRepository.js';
import { MetaAuthService } from '../services/metaAuthService.js';
import { MetaSyncService } from '../services/metaSyncService.js';
import { MetaAnalyticsService } from '../services/metaAnalyticsService.js';
import { NotFoundError } from '../utils/errors.js';

function getClient(req) {
  return req.app?.get?.('metaGraphClient') || metaGraphClient;
}

export async function getMetaStatus(req, res, next) {
  try {
    const refreshDebug = req.query.refresh === 'true';
    const data = await MetaAuthService.getConnectionStatus(
      req.tenantId,
      { refreshDebug },
      getClient(req)
    );
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function startMetaOAuth(req, res, next) {
  try {
    const includeWriteScope = req.query.include_write_scope === 'true';
    const data = MetaAuthService.startOAuthFlow(
      {
        tenantId: req.tenantId,
        userId: req.userId,
        includeWriteScope,
      },
      getClient(req)
    );
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function handleMetaOAuthCallback(req, res) {
  const callbackBase = env.META_FRONTEND_CALLBACK_URL || 'http://localhost:5173/settings';
  const redirectTarget = new URL(callbackBase);
  try {
    const { code, state, error_description: errorDesc, error } = req.query;
    const declinedReason = errorDesc || error || null;
    await MetaAuthService.handleOAuthCallback(
      { code, state, errorDescription: declinedReason },
      getClient(req)
    );
    redirectTarget.searchParams.set('meta_connected', '1');
    return res.redirect(302, redirectTarget.toString());
  } catch (err) {
    redirectTarget.searchParams.set('meta_error', err.message || 'Meta OAuth authentication failed');
    return res.redirect(302, redirectTarget.toString());
  }
}

export async function connectMetaToken(req, res, next) {
  try {
    const {
      access_token: accessToken,
      connection_type: connectionType,
      primary_ad_account_id: primaryAdAccountId,
    } = req.body;

    const connection = await MetaAuthService.connectWithToken(
      {
        tenantId: req.tenantId,
        userId: req.userId,
        accessToken,
        connectionType,
        primaryAdAccountId: primaryAdAccountId || null,
      },
      getClient(req)
    );

    return res.status(200).json({
      success: true,
      data: { connection },
    });
  } catch (err) {
    next(err);
  }
}

export async function selectAdAccount(req, res, next) {
  try {
    const { ad_account_id: adAccountId } = req.body;
    const connection = await MetaAuthService.selectPrimaryAdAccount(req.tenantId, adAccountId);
    return res.status(200).json({
      success: true,
      data: { connection },
    });
  } catch (err) {
    next(err);
  }
}

export async function authorizeMetaWrites(req, res, next) {
  try {
    const { authorize, confirmation_phrase: confirmationPhrase = '' } = req.body;
    const connection = await MetaAuthService.setWriteAuthorization(req.tenantId, req.userId, {
      authorize,
      confirmationPhrase,
    });
    return res.status(200).json({
      success: true,
      data: { connection },
    });
  } catch (err) {
    next(err);
  }
}

export async function disconnectMeta(req, res, next) {
  try {
    const result = await MetaAuthService.disconnect(req.tenantId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listMetaCampaigns(req, res, next) {
  try {
    const authCtx = await MetaAuthService.resolveAuthorizedAccountContext(
      req.tenantId,
      req.query.adAccountId || null
    );
    const { items, rateInfo } = await getClient(req).getCampaigns({
      accessToken: authCtx.accessToken,
      adAccountId: authCtx.accountMeta.adAccountId,
    });
    return res.status(200).json({
      success: true,
      data: {
        adAccount: authCtx.accountMeta,
        items,
        rateInfo,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listMetaAds(req, res, next) {
  try {
    const authCtx = await MetaAuthService.resolveAuthorizedAccountContext(
      req.tenantId,
      req.query.adAccountId || null
    );
    const { items, rateInfo } = await getClient(req).getAds({
      accessToken: authCtx.accessToken,
      adAccountId: authCtx.accountMeta.adAccountId,
    });
    return res.status(200).json({
      success: true,
      data: {
        adAccount: authCtx.accountMeta,
        items,
        rateInfo,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listMappings(req, res, next) {
  try {
    const items = await MetaRepository.listCreativeMappings(req.tenantId, {
      metaAdAccountId: req.query.adAccountId || undefined,
      adPilotCampaignId: req.query.campaignId || undefined,
      origin: req.query.origin || undefined,
    });
    return res.status(200).json({
      success: true,
      data: { items },
    });
  } catch (err) {
    next(err);
  }
}

export async function createMapping(req, res, next) {
  try {
    const b = req.body;
    const derivedOrigin =
      b.origin ||
      (b.adpilot_creative_id || b.adpilot_campaign_id ? 'adpilot_generated' : 'external_meta');

    const mapping = await MetaRepository.upsertCreativeMapping(req.tenantId, {
      metaAdAccountId: b.meta_ad_account_id,
      metaAdId: b.meta_ad_id,
      metaAdName: b.meta_ad_name || '',
      metaCampaignId: b.meta_campaign_id || '',
      metaCampaignName: b.meta_campaign_name || '',
      metaAdSetId: b.meta_adset_id || '',
      metaCreativeId: b.meta_creative_id || '',
      adPilotCampaignId: b.adpilot_campaign_id || null,
      adPilotCreativeId: b.adpilot_creative_id || null,
      origin: derivedOrigin,
      mappingSource: 'manual',
      creativeTitle: b.creative_title || b.meta_ad_name || b.meta_ad_id,
    });

    return res.status(200).json({
      success: true,
      data: { mapping },
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteMapping(req, res, next) {
  try {
    const removed = await MetaRepository.deleteCreativeMapping(req.params.id, req.tenantId);
    if (!removed) {
      throw new NotFoundError(`Creative mapping ${req.params.id} was not found`);
    }
    return res.status(200).json({
      success: true,
      data: { deleted: true, id: req.params.id },
    });
  } catch (err) {
    next(err);
  }
}

export async function triggerMetaSync(req, res, next) {
  try {
    const b = req.body || {};
    const syncRun = await MetaSyncService.syncAdAccount(
      req.tenantId,
      {
        adAccountId: b.ad_account_id || null,
        since: b.since || null,
        until: b.until || null,
        includePlacementBreakdown: b.include_placement_breakdown !== false,
        includeAudienceBreakdown: Boolean(b.include_audience_breakdown),
        useUnifiedAttributionSetting: b.use_unified_attribution_setting !== false,
        attributionWindows: b.attribution_windows || null,
      },
      getClient(req)
    );
    return res.status(200).json({
      success: true,
      data: { syncRun },
    });
  } catch (err) {
    next(err);
  }
}

export async function triggerFixtureSync(req, res, next) {
  try {
    const b = req.body || {};
    const syncRun = await MetaSyncService.syncIsolatedTestFixtures(req.tenantId, {
      adAccountId: b.ad_account_id || 'act_9988776655',
      currency: b.currency || 'INR',
      timezoneName: b.timezone_name || 'Asia/Kolkata',
    });
    return res.status(200).json({
      success: true,
      data: { syncRun },
    });
  } catch (err) {
    next(err);
  }
}

export async function clearFixtures(req, res, next) {
  try {
    await MetaRepository.clearTestFixtureData(req.tenantId);
    return res.status(200).json({
      success: true,
      data: { cleared: true },
    });
  } catch (err) {
    next(err);
  }
}

export async function getSyncHistory(req, res, next) {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 15)));
    const items = await MetaRepository.listSyncRuns(req.tenantId, limit);
    return res.status(200).json({
      success: true,
      data: { items },
    });
  } catch (err) {
    next(err);
  }
}

export async function publishOrPauseMetaAd(req, res, next) {
  try {
    const {
      ad_id: adId,
      ad_account_id: adAccountId,
      target_status: targetStatus,
      explicit_user_authorization: explicitUserAuthorization,
    } = req.body;

    const ctx = await MetaAuthService.assertWriteAuthorized(
      req.tenantId,
      adAccountId,
      explicitUserAuthorization
    );

    const result = await getClient(req).updateAdEntity({
      accessToken: ctx.accessToken,
      entityId: adId,
      payload: { status: targetStatus },
      scopeKey: ctx.accountMeta.adAccountId,
    });

    return res.status(200).json({
      success: true,
      data: {
        adId,
        adAccountId: ctx.accountMeta.adAccountId,
        targetStatus,
        authorizedBy: ctx.connection.writeAuthorizedBy,
        metaResponse: result.data,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function updateMetaBudget(req, res, next) {
  try {
    const {
      entity_id: entityId,
      ad_account_id: adAccountId,
      daily_budget_minor_units: dailyBudgetMinorUnits,
      explicit_user_authorization: explicitUserAuthorization,
    } = req.body;

    const ctx = await MetaAuthService.assertWriteAuthorized(
      req.tenantId,
      adAccountId,
      explicitUserAuthorization
    );

    const result = await getClient(req).updateAdEntity({
      accessToken: ctx.accessToken,
      entityId,
      payload: { daily_budget: dailyBudgetMinorUnits },
      scopeKey: ctx.accountMeta.adAccountId,
    });

    return res.status(200).json({
      success: true,
      data: {
        entityId,
        adAccountId: ctx.accountMeta.adAccountId,
        dailyBudgetMinorUnits,
        authorizedBy: ctx.connection.writeAuthorizedBy,
        metaResponse: result.data,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getAnalyticsOverview(req, res, next) {
  try {
    const data = await MetaAnalyticsService.getOverview(req.tenantId, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getCreativeComparison(req, res, next) {
  try {
    const data = await MetaAnalyticsService.getCreativeComparison(req.tenantId, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getPerformanceTrends(req, res, next) {
  try {
    const data = await MetaAnalyticsService.getTrends(req.tenantId, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getBreakdownAnalysis(req, res, next) {
  try {
    const data = await MetaAnalyticsService.getBreakdowns(req.tenantId, req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
