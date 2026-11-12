import { MetaRepository } from '../repositories/metaRepository.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { CampaignRepository } from '../repositories/campaignRepository.js';

function roundOpt(val, decimals = 2) {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function sumNullable(rows, key) {
  let hasAny = false;
  let total = 0;
  for (const r of rows) {
    if (r[key] !== null && r[key] !== undefined && Number.isFinite(Number(r[key]))) {
      hasAny = true;
      total += Number(r[key]);
    }
  }
  return hasAny ? roundOpt(total, 4) : null;
}

/**
 * Aggregate metrics across a group of insight rows preserving all-click vs link-click clarity
 * and keeping missing (null) metrics distinct from verified zeros.
 */
function aggregateMetrics(rows) {
  const spend = sumNullable(rows, 'spend');
  const impressions = sumNullable(rows, 'impressions');
  const reach = sumNullable(rows, 'reach');
  const allClicks = sumNullable(rows, 'allClicks');
  const linkClicks = sumNullable(rows, 'linkClicks');
  const landingPageViews = sumNullable(rows, 'landingPageViews');
  const addToCart = sumNullable(rows, 'addToCart');
  const purchases = sumNullable(rows, 'purchases');
  const purchaseConversionValue = sumNullable(rows, 'purchaseConversionValue');

  const cpm = spend !== null && impressions > 0 ? roundOpt((spend / impressions) * 1000, 2) : null;
  const linkCtr = linkClicks !== null && impressions > 0 ? roundOpt((linkClicks / impressions) * 100, 2) : null;
  const allClickCtr = allClicks !== null && impressions > 0 ? roundOpt((allClicks / impressions) * 100, 2) : null;
  const cpc = spend !== null && linkClicks > 0 ? roundOpt(spend / linkClicks, 2) : null;
  const allClickCpc = spend !== null && allClicks > 0 ? roundOpt(spend / allClicks, 2) : null;
  const cpa = spend !== null && purchases > 0 ? roundOpt(spend / purchases, 2) : null;
  const roas = spend !== null && spend > 0 && purchaseConversionValue !== null
    ? roundOpt(purchaseConversionValue / spend, 2)
    : null;

  return {
    impressions,
    reach,
    spend: spend !== null ? roundOpt(spend, 2) : null,
    cpm,
    allClicks,
    allClickCtr,
    allClickCpc,
    linkClicks,
    linkCtr,
    cpc,
    landingPageViews,
    addToCart,
    purchases,
    purchaseConversionValue:
      purchaseConversionValue !== null ? roundOpt(purchaseConversionValue, 2) : null,
    cpa,
    roas,
  };
}

export class MetaAnalyticsService {
  static async getOverview(tenantId, filters = {}) {
    const rows = await MetaRepository.queryInsightSnapshots(tenantId, {
      since: filters.since,
      until: filters.until,
      metaAdAccountId: filters.adAccountId,
      adPilotCampaignId: filters.campaignId,
      origin: filters.origin || undefined,
      includeBreakdowns: false,
      includeTestFixtures: filters.includeTestFixtures !== 'false',
    });

    const summary = aggregateMetrics(rows);

    const currencies = Array.from(new Set(rows.map((r) => r.currency).filter(Boolean)));
    const timezones = Array.from(new Set(rows.map((r) => r.timezoneName).filter(Boolean)));
    const attributionSettings = Array.from(new Set(rows.map((r) => r.attributionSetting).filter(Boolean)));
    const provisionalDates = Array.from(
      new Set(rows.filter((r) => r.isProvisionalAttribution).map((r) => r.dateStart))
    ).sort();

    const missingSet = new Set();
    for (const r of rows) {
      for (const m of r.missingMetrics || []) missingSet.add(m);
    }

    const containsTestFixtures = rows.some((r) => Boolean(r.isTestFixture));
    const discrepancyWarnings = [];

    if (containsTestFixtures) {
      discrepancyWarnings.push(
        'Dataset includes isolated Meta test fixtures marked as simulation data (not live ad spend).'
      );
    }
    if (currencies.length > 1) {
      discrepancyWarnings.push(
        `Multiple billing currencies (${currencies.join(', ')}) detected; filter by a single Ad Account for exact monetary sums.`
      );
    }
    if (provisionalDates.length > 0) {
      discrepancyWarnings.push(
        `Dates (${provisionalDates.join(', ')}) fall inside the delayed conversion attribution window and remain provisional.`
      );
    }

    // Group Meta Campaigns present in filtered slice
    const byCampaignMap = new Map();
    for (const r of rows) {
      const key = `${r.metaAdAccountId}:${r.metaCampaignId || r.metaAdId}`;
      const list = byCampaignMap.get(key) || {
        metaAdAccountId: r.metaAdAccountId,
        metaCampaignId: r.metaCampaignId,
        metaCampaignName: r.metaCampaignName || 'Meta Campaign',
        adPilotCampaignId: r.adPilotCampaignId ? String(r.adPilotCampaignId) : null,
        currency: r.currency,
        timezoneName: r.timezoneName,
        rows: [],
      };
      list.rows.push(r);
      byCampaignMap.set(key, list);
    }

    const campaigns = Array.from(byCampaignMap.values()).map((c) => ({
      metaAdAccountId: c.metaAdAccountId,
      metaCampaignId: c.metaCampaignId,
      metaCampaignName: c.metaCampaignName,
      adPilotCampaignId: c.adPilotCampaignId,
      currency: c.currency,
      timezoneName: c.timezoneName,
      ...aggregateMetrics(c.rows),
    }));

    return {
      totals: summary,
      campaigns,
      recordCount: rows.length,
      containsTestFixtures,
      dataQuality: {
        currencies,
        primaryCurrency: currencies.length === 1 ? currencies[0] : currencies[0] || null,
        timezones,
        attributionSettings,
        provisionalDates,
        missingMetrics: Array.from(missingSet),
        discrepancyWarnings,
      },
    };
  }

  /**
   * Build Creative-Level Comparison table joining:
   * AdPilot Campaign ID -> Creative ID -> Meta Ad ID (plus external / uploaded ads).
   */
  static async getCreativeComparison(tenantId, filters = {}) {
    const [rows, mappings, creativesRes, campaignsRes] = await Promise.all([
      MetaRepository.queryInsightSnapshots(tenantId, {
        since: filters.since,
        until: filters.until,
        metaAdAccountId: filters.adAccountId,
        adPilotCampaignId: filters.campaignId,
        origin: filters.origin || undefined,
        includeBreakdowns: false,
        includeTestFixtures: filters.includeTestFixtures !== 'false',
      }),
      MetaRepository.listCreativeMappings(tenantId, {
        metaAdAccountId: filters.adAccountId,
        adPilotCampaignId: filters.campaignId,
      }),
      CreativeRepository.findAll({ tenantId, limit: 250 }),
      CampaignRepository.findPaginated({ tenantId, page: 1, limit: 100 }),
    ]);

    const creativesById = new Map((creativesRes.items || []).map((c) => [String(c.id), c]));
    const campaignsById = new Map((campaignsRes.items || []).map((c) => [String(c.id), c]));
    const mappingByAdKey = new Map(mappings.map((m) => [`${m.metaAdAccountId}:${m.metaAdId}`, m]));

    const groupedByAd = new Map();
    for (const r of rows) {
      const k = `${r.metaAdAccountId}:${r.metaAdId}`;
      const existing = groupedByAd.get(k) || {
        key: k,
        metaAdAccountId: r.metaAdAccountId,
        metaCampaignId: r.metaCampaignId,
        metaCampaignName: r.metaCampaignName,
        metaAdId: r.metaAdId,
        metaAdName: r.metaAdName,
        currency: r.currency,
        timezoneName: r.timezoneName,
        attributionSetting: r.attributionSetting,
        isTestFixture: Boolean(r.isTestFixture),
        rows: [],
      };
      existing.rows.push(r);
      groupedByAd.set(k, existing);
    }

    const items = Array.from(groupedByAd.values()).map((entry) => {
      const mapEntry = mappingByAdKey.get(entry.key);
      const sampleRow = entry.rows[0];
      const adPilotCreativeId =
        mapEntry?.adPilotCreativeId
          ? String(mapEntry.adPilotCreativeId)
          : sampleRow?.adPilotCreativeId
            ? String(sampleRow.adPilotCreativeId)
            : null;
      const adPilotCampaignId =
        mapEntry?.adPilotCampaignId
          ? String(mapEntry.adPilotCampaignId)
          : sampleRow?.adPilotCampaignId
            ? String(sampleRow.adPilotCampaignId)
            : null;

      const creativeObj = adPilotCreativeId ? creativesById.get(adPilotCreativeId) : null;
      const campaignObj = adPilotCampaignId ? campaignsById.get(adPilotCampaignId) : null;

      return {
        metaAdAccountId: entry.metaAdAccountId,
        metaCampaignId: entry.metaCampaignId,
        metaCampaignName: entry.metaCampaignName,
        metaAdId: entry.metaAdId,
        metaAdName: entry.metaAdName,
        metaCreativeId: mapEntry?.metaCreativeId || null,
        origin: mapEntry?.origin || sampleRow?.origin || 'external_meta',
        adPilotCampaignId,
        adPilotCampaignName: campaignObj?.name || null,
        adPilotCreativeId,
        adPilotCreativeTitle:
          creativeObj?.title || mapEntry?.creativeTitle || entry.metaAdName,
        adPilotQaScore: creativeObj?.evaluation?.overall_weighted_score ?? null,
        currency: entry.currency,
        timezoneName: entry.timezoneName,
        attributionSetting: entry.attributionSetting,
        isTestFixture: entry.isTestFixture,
        hasMissingMetrics: entry.rows.some((r) => (r.missingMetrics || []).length > 0),
        metrics: aggregateMetrics(entry.rows),
      };
    });

    items.sort((a, b) => (b.metrics.spend || 0) - (a.metrics.spend || 0));

    return {
      items,
      mappingsCount: mappings.length,
      containsTestFixtures: items.some((i) => i.isTestFixture),
    };
  }

  /**
   * Daily performance trends grouped strictly by Meta account calendar date (YYYY-MM-DD).
   */
  static async getTrends(tenantId, filters = {}) {
    const rows = await MetaRepository.queryInsightSnapshots(tenantId, {
      since: filters.since,
      until: filters.until,
      metaAdAccountId: filters.adAccountId,
      adPilotCampaignId: filters.campaignId,
      origin: filters.origin || undefined,
      includeBreakdowns: false,
      includeTestFixtures: filters.includeTestFixtures !== 'false',
    });

    const byDate = new Map();
    for (const r of rows) {
      const existing = byDate.get(r.dateStart) || [];
      existing.push(r);
      byDate.set(r.dateStart, existing);
    }

    const series = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayRows]) => ({
        date,
        currency: dayRows[0]?.currency || 'USD',
        timezoneName: dayRows[0]?.timezoneName || 'UTC',
        isProvisionalAttribution: dayRows.some((d) => Boolean(d.isProvisionalAttribution)),
        isTestFixture: dayRows.some((d) => Boolean(d.isTestFixture)),
        ...aggregateMetrics(dayRows),
      }));

    return {
      series,
      containsTestFixtures: series.some((s) => s.isTestFixture),
    };
  }

  /**
   * Placement (publisher_platform / platform_position) and Audience (age / gender) breakdowns.
   */
  static async getBreakdowns(tenantId, filters = {}) {
    const rows = await MetaRepository.queryInsightSnapshots(tenantId, {
      since: filters.since,
      until: filters.until,
      metaAdAccountId: filters.adAccountId,
      adPilotCampaignId: filters.campaignId,
      origin: filters.origin || undefined,
      includeBreakdowns: true,
      includeTestFixtures: filters.includeTestFixtures !== 'false',
    });

    const placementGroups = new Map();
    const audienceGroups = new Map();

    for (const r of rows) {
      if (r.breakdownKey === 'none') continue;
      if (r.publisherPlatform || r.platformPosition) {
        const key = `${r.publisherPlatform || 'unknown'} · ${r.platformPosition || 'all'}`;
        const list = placementGroups.get(key) || [];
        list.push(r);
        placementGroups.set(key, list);
      }
      if (r.age || r.gender) {
        const key = `${r.age || 'All ages'} · ${r.gender || 'All'}`;
        const list = audienceGroups.get(key) || [];
        list.push(r);
        audienceGroups.set(key, list);
      }
    }

    const placements = Array.from(placementGroups.entries())
      .map(([label, grp]) => ({
        dimension: label,
        publisherPlatform: grp[0]?.publisherPlatform || null,
        platformPosition: grp[0]?.platformPosition || null,
        currency: grp[0]?.currency || 'USD',
        ...aggregateMetrics(grp),
      }))
      .sort((a, b) => (b.spend || 0) - (a.spend || 0));

    const audiences = Array.from(audienceGroups.entries())
      .map(([label, grp]) => ({
        dimension: label,
        age: grp[0]?.age || null,
        gender: grp[0]?.gender || null,
        currency: grp[0]?.currency || 'USD',
        ...aggregateMetrics(grp),
      }))
      .sort((a, b) => (b.spend || 0) - (a.spend || 0));

    return {
      placements,
      audiences,
      containsTestFixtures: rows.some((r) => Boolean(r.isTestFixture)),
    };
  }
}

