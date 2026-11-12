import { env } from '../config/env.js';
import { metaGraphClient } from '../integrations/meta/metaClient.js';
import { parseMetaInsightRow } from '../integrations/meta/metaMetricsParser.js';
import { buildIsolatedMetaFixtures } from '../integrations/meta/metaFixtures.js';
import { MetaRepository } from '../repositories/metaRepository.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { MetaAuthService } from './metaAuthService.js';
import { ForbiddenError } from '../utils/errors.js';

function defaultDateRange(days = 14) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return {
    since: start.toISOString().slice(0, 10),
    until: end.toISOString().slice(0, 10),
  };
}

/**
 * Attempt deterministic linkage from Meta Ad metadata or explicit mapping table
 * without assuming every Meta ad was created by AdPilot.
 */
function inferMappingLinks(rawAd, existingMappingsByAdId, tenantCreativesByKey) {
  const existing = existingMappingsByAdId.get(String(rawAd.id));
  if (existing) {
    return {
      adPilotCampaignId: existing.adPilotCampaignId || null,
      adPilotCreativeId: existing.adPilotCreativeId || null,
      origin: existing.origin || 'external_meta',
      mappingSource: existing.mappingSource || 'manual',
    };
  }

  // Convention 1: [adpilot_creative:<creativeKey_or_id>] tag inside Meta Ad name
  const nameStr = String(rawAd.name || '');
  const tagMatch = /\[adpilot_creative:([a-zA-Z0-9_-]+)\]/.exec(nameStr);
  if (tagMatch) {
    const candidate = tenantCreativesByKey.get(tagMatch[1]);
    if (candidate) {
      return {
        adPilotCampaignId: String(candidate.campaignId),
        adPilotCreativeId: String(candidate.id),
        origin: 'adpilot_generated',
        mappingSource: 'utm_tag',
      };
    }
  }

  // Fallback: unmapped Meta advertisement (may be native Meta ad or manually uploaded later)
  return {
    adPilotCampaignId: null,
    adPilotCreativeId: null,
    origin: rawAd.originHint || 'external_meta',
    mappingSource: 'auto_discovered',
  };
}

export class MetaSyncService {
  /**
   * Idempotently synchronize Meta campaigns, ads, creative mappings, and daily Insights.
   */
  static async syncAdAccount(
    tenantId,
    {
      adAccountId = null,
      since = null,
      until = null,
      includePlacementBreakdown = true,
      includeAudienceBreakdown = false,
      useUnifiedAttributionSetting = true,
      attributionWindows = null,
    } = {},
    client = metaGraphClient
  ) {
    const authCtx = await MetaAuthService.resolveAuthorizedAccountContext(tenantId, adAccountId);
    const { connection, accountMeta, accessToken } = authCtx;
    const range = since && until ? { since, until } : defaultDateRange(14);
    const windows =
      Array.isArray(attributionWindows) && attributionWindows.length > 0
        ? attributionWindows
        : env.META_INSIGHTS_DEFAULT_ATTRIBUTION_WINDOWS.split(',').map((s) => s.trim()).filter(Boolean);

    const syncRun = await MetaRepository.createSyncRun({
      tenantId,
      metaConnectionId: connection.id,
      metaAdAccountId: accountMeta.adAccountId,
      dateRange: range,
      breakdowns: [
        ...(includePlacementBreakdown ? ['publisher_platform,platform_position'] : []),
        ...(includeAudienceBreakdown ? ['age,gender'] : []),
      ],
      attributionWindows: windows,
      status: 'running',
      isTestFixture: false,
      startedAt: new Date(),
    });

    try {
      // 1. Fetch Meta Campaigns & Ads using cursor pagination & rate-limit tracking
      const [campaignsRes, adsRes, existingMappings, tenantCreativesRes] = await Promise.all([
        client.getCampaigns({ accessToken, adAccountId: accountMeta.adAccountId }),
        client.getAds({ accessToken, adAccountId: accountMeta.adAccountId }),
        MetaRepository.listCreativeMappings(tenantId, { metaAdAccountId: accountMeta.adAccountId }),
        CreativeRepository.findAll({ tenantId, limit: 250 }),
      ]);

      const metaCampaigns = campaignsRes.items || [];
      const metaAds = adsRes.items || [];
      const campaignNameMap = new Map(metaCampaigns.map((c) => [String(c.id), c.name]));

      const existingMapByAdId = new Map(existingMappings.map((m) => [String(m.metaAdId), m]));
      const creativesByKey = new Map();
      for (const cr of tenantCreativesRes.items || []) {
        creativesByKey.set(String(cr.id), cr);
        if (cr.creativeKey) creativesByKey.set(String(cr.creativeKey), cr);
      }

      // 2. Upsert ad mappings (preserving any existing AdPilot <-> Meta links)
      const activeLinksByAdId = new Map();
      let mappingsUpdated = 0;
      for (const ad of metaAds) {
        const link = inferMappingLinks(ad, existingMapByAdId, creativesByKey);
        activeLinksByAdId.set(String(ad.id), link);
        await MetaRepository.upsertCreativeMapping(tenantId, {
          adPilotCampaignId: link.adPilotCampaignId,
          adPilotCreativeId: link.adPilotCreativeId,
          metaAdAccountId: accountMeta.adAccountId,
          metaCampaignId: String(ad.campaign_id || ''),
          metaCampaignName: campaignNameMap.get(String(ad.campaign_id)) || '',
          metaAdSetId: String(ad.adset_id || ad.adset?.id || ''),
          metaAdSetName: ad.adset?.name || '',
          metaAdId: String(ad.id),
          metaAdName: ad.name || `Meta Ad ${ad.id}`,
          metaCreativeId: String(ad.creative?.id || ''),
          origin: link.origin,
          mappingSource: link.mappingSource,
          creativeTitle: ad.creative?.name || ad.name || '',
          thumbnailUrl: ad.creative?.thumbnail_url || null,
          effectiveStatus: ad.effective_status || ad.status || 'UNKNOWN',
          lastSyncedAt: new Date(),
          isTestFixture: false,
        });
        mappingsUpdated += 1;
      }

      // 3. Fetch Daily Insights + Optional Placement / Audience Breakdowns
      const insightBatches = [
        client.getInsights({
          accessToken,
          adAccountId: accountMeta.adAccountId,
          level: 'ad',
          since: range.since,
          until: range.until,
          timeIncrement: 1,
          breakdowns: [],
          attributionWindows: windows,
          useUnifiedAttributionSetting,
        }),
      ];

      if (includePlacementBreakdown) {
        insightBatches.push(
          client.getInsights({
            accessToken,
            adAccountId: accountMeta.adAccountId,
            level: 'ad',
            since: range.since,
            until: range.until,
            timeIncrement: 1,
            breakdowns: ['publisher_platform', 'platform_position'],
            attributionWindows: windows,
            useUnifiedAttributionSetting,
          })
        );
      }

      if (includeAudienceBreakdown) {
        insightBatches.push(
          client.getInsights({
            accessToken,
            adAccountId: accountMeta.adAccountId,
            level: 'ad',
            since: range.since,
            until: range.until,
            timeIncrement: 1,
            breakdowns: ['age', 'gender'],
            attributionWindows: windows,
            useUnifiedAttributionSetting,
          })
        );
      }

      const settledBatches = await Promise.allSettled(insightBatches);
      const rawInsightRows = [];
      const warnings = [];

      for (const res of settledBatches) {
        if (res.status === 'fulfilled') {
          rawInsightRows.push(...(res.value.items || []));
        } else {
          warnings.push(`Partial insights breakdown unavailable: ${res.reason?.message}`);
        }
      }

      const missingMetricSet = new Set();
      let provisionalRowCount = 0;
      let upsertedCount = 0;
      const campaignDailyRollups = new Map();

      for (const rawRow of rawInsightRows) {
        const normalized = parseMetaInsightRow(rawRow, accountMeta, {
          attributionWindows: windows,
          attributionSetting: windows.join('_'),
          useUnifiedAttributionSetting,
        });

        const link = activeLinksByAdId.get(String(normalized.metaAdId)) || {};
        const snapshot = await MetaRepository.upsertInsightSnapshot(tenantId, {
          ...normalized,
          syncRunId: syncRun.id,
          metaConnectionId: connection.id,
          adPilotCampaignId: link.adPilotCampaignId || null,
          adPilotCreativeId: link.adPilotCreativeId || null,
          origin: link.origin || 'external_meta',
          isTestFixture: false,
        });

        upsertedCount += 1;
        for (const m of normalized.missingMetrics) missingMetricSet.add(m);
        if (normalized.isProvisionalAttribution) provisionalRowCount += 1;

        if (snapshot.breakdownKey === 'none' && link.adPilotCampaignId) {
          const rKey = `${link.adPilotCampaignId}:${snapshot.dateStart}`;
          const cur = campaignDailyRollups.get(rKey) || {
            campaignId: link.adPilotCampaignId,
            creativeId: link.adPilotCreativeId,
            dateStart: snapshot.dateStart,
            currency: snapshot.currency,
            impressions: 0,
            linkClicks: 0,
            purchases: 0,
            spend: 0,
            purchaseValue: 0,
          };
          cur.impressions += snapshot.impressions || 0;
          cur.linkClicks += snapshot.linkClicks || 0;
          cur.purchases += snapshot.purchases || 0;
          cur.spend += snapshot.spend || 0;
          cur.purchaseValue += snapshot.purchaseConversionValue || 0;
          campaignDailyRollups.set(rKey, cur);
        }
      }

      for (const rollup of campaignDailyRollups.values()) {
        await MetaRepository.upsertCampaignPerformanceRollup(tenantId, {
          ...rollup,
          ctr: rollup.impressions > 0 ? (rollup.linkClicks / rollup.impressions) * 100 : 0,
          cpc: rollup.linkClicks > 0 ? rollup.spend / rollup.linkClicks : 0,
          cpa: rollup.purchases > 0 ? rollup.spend / rollup.purchases : null,
          roas: rollup.spend > 0 ? rollup.purchaseValue / rollup.spend : 0,
        });
      }

      if (provisionalRowCount > 0) {
        warnings.push(
          `${provisionalRowCount} insight rows fall within the trailing 72h attribution window and may update as delayed conversions settle.`
        );
      }
      if (connection.accessTier === 'development_or_limited') {
        warnings.push(
          'Connected under Development / Limited Access tier; verify Meta App Review & Business Manager roles for production volume.'
        );
      }

      const trackerPeak = client.rateTracker?.getPeakPct?.(accountMeta.adAccountId) ?? 0;
      const batchPeaks = settledBatches.map((res) =>
        res.status === 'fulfilled' ? Number(res.value?.rateInfo?.maxUsagePct || 0) : 0
      );
      const ratePeak = Math.max(trackerPeak, ...batchPeaks);
      const completedRun = await MetaRepository.updateSyncRun(syncRun.id, tenantId, {
        status: warnings.length > 0 ? 'completed_with_warnings' : 'completed',
        campaignsCount: metaCampaigns.length,
        adsCount: metaAds.length,
        mappingsUpdated,
        recordsFetched: rawInsightRows.length,
        recordsUpserted: upsertedCount,
        rateLimitPeakPct: ratePeak,
        discrepancyWarnings: warnings,
        missingMetricsSummary: Array.from(missingMetricSet),
        completedAt: new Date(),
      });

      await MetaRepository.updateConnection(connection.id, tenantId, {
        lastSyncedAt: new Date(),
      });

      return completedRun;
    } catch (err) {
      await MetaRepository.updateSyncRun(syncRun.id, tenantId, {
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      });
      throw err;
    }
  }

  /**
   * Synchronize isolated sandbox Meta fixture payloads (explicitly marked isTestFixture: true).
   * Used solely for testing/demonstration when live Meta API credentials are unavailable.
   */
  static async syncIsolatedTestFixtures(
    tenantId,
    { adAccountId = 'act_9988776655', currency = 'INR', timezoneName = 'Asia/Kolkata' } = {}
  ) {
    if (!env.META_ALLOW_FIXTURE_SYNC) {
      throw new ForbiddenError('Isolated Meta fixture sync is disabled in this environment');
    }

    const fixtures = buildIsolatedMetaFixtures({ adAccountId, currency, timezoneName });
    const creativesRes = await CreativeRepository.findAll({ tenantId, limit: 10 });
    const tenantCreatives = creativesRes.items || [];

    const syncRun = await MetaRepository.createSyncRun({
      tenantId,
      metaAdAccountId: fixtures.adAccount.adAccountId,
      dateRange: {
        since: fixtures.dailyInsights[0].date_start,
        until: fixtures.dailyInsights[fixtures.dailyInsights.length - 1].date_stop,
      },
      breakdowns: ['publisher_platform,platform_position'],
      attributionWindows: ['7d_click', '1d_view'],
      status: 'running',
      isTestFixture: true,
      startedAt: new Date(),
    });

    const linkByAdId = new Map();
    for (let i = 0; i < fixtures.ads.length; i++) {
      const ad = fixtures.ads[i];
      const matchedCreative = i < 2 && tenantCreatives[i] ? tenantCreatives[i] : null;
      const origin = ad.originHint || (matchedCreative ? 'adpilot_generated' : 'external_meta');

      const mapping = await MetaRepository.upsertCreativeMapping(tenantId, {
        adPilotCampaignId: matchedCreative ? matchedCreative.campaignId : null,
        adPilotCreativeId: matchedCreative ? matchedCreative.id : null,
        metaAdAccountId: fixtures.adAccount.adAccountId,
        metaCampaignId: ad.campaign_id,
        metaCampaignName:
          fixtures.campaigns.find((c) => c.id === ad.campaign_id)?.name || 'Fixture Campaign',
        metaAdSetId: ad.adset_id,
        metaAdSetName: ad.adset?.name || '',
        metaAdId: ad.id,
        metaAdName: ad.name,
        metaCreativeId: ad.creative?.id || '',
        origin,
        mappingSource: matchedCreative ? 'utm_tag' : 'auto_discovered',
        creativeTitle: matchedCreative?.title || ad.creative?.name || ad.name,
        effectiveStatus: ad.effective_status,
        lastSyncedAt: new Date(),
        isTestFixture: true,
      });
      linkByAdId.set(ad.id, mapping);
    }

    const allRawRows = [...fixtures.dailyInsights, ...fixtures.placementBreakdowns];
    const missingSet = new Set();
    let upsertedCount = 0;

    for (const rawRow of allRawRows) {
      const parsed = parseMetaInsightRow(rawRow, fixtures.adAccount, {
        attributionWindows: ['7d_click', '1d_view'],
        attributionSetting: '7d_click_1d_view',
        useUnifiedAttributionSetting: true,
      });
      const mapping = linkByAdId.get(parsed.metaAdId);

      await MetaRepository.upsertInsightSnapshot(tenantId, {
        ...parsed,
        syncRunId: syncRun.id,
        adPilotCampaignId: mapping?.adPilotCampaignId || null,
        adPilotCreativeId: mapping?.adPilotCreativeId || null,
        origin: mapping?.origin || 'external_meta',
        isTestFixture: true,
      });
      upsertedCount += 1;
      for (const m of parsed.missingMetrics) missingSet.add(m);
    }

    return await MetaRepository.updateSyncRun(syncRun.id, tenantId, {
      status: 'completed_with_warnings',
      campaignsCount: fixtures.campaigns.length,
      adsCount: fixtures.ads.length,
      mappingsUpdated: fixtures.ads.length,
      recordsFetched: allRawRows.length,
      recordsUpserted: upsertedCount,
      rateLimitPeakPct: 0,
      discrepancyWarnings: [
        'TEST FIXTURE DATA: Simulated Meta Graph API v27.0 dataset (not live production spend).',
        'Some trailing days fall inside the 72h delayed attribution window.',
      ],
      missingMetricsSummary: Array.from(missingSet),
      completedAt: new Date(),
    });
  }
}
