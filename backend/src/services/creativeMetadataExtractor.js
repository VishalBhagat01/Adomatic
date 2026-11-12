import { MetaAnalyticsService } from './metaAnalyticsService.js';
import { MetaRepository } from '../repositories/metaRepository.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { CampaignRepository } from '../repositories/campaignRepository.js';

function roundOpt(val, decimals = 2) {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

export function classifyHookType(hookText = '', title = '') {
  const text = `${hookText} ${title}`.toLowerCase();
  if (!text.trim()) return 'unspecified';
  if (text.includes('?') || /\b(why|how|tired of|still struggling|ever wondered)\b/.test(text)) {
    return 'question_hook';
  }
  if (/\b(\d+%|\d+x|save|off|discount|inr|rs\.|₹|free|limited|today)\b/.test(text)) {
    return 'offer_urgency_hook';
  }
  if (/\b(stop|no more|hate|pain|mess|slow|hard|struggle|problem)\b/.test(text)) {
    return 'pain_point_hook';
  }
  if (/\b(\d+\s*(w|watt|litre|l|bar|rpm|year|month|hr)|rated|certified|warranty)\b/.test(text)) {
    return 'stat_or_spec_hook';
  }
  if (/\b(meet|discover|upgrade|effortless|ready in|morning|kitchen|home)\b/.test(text)) {
    return 'story_scenario_hook';
  }
  return 'direct_benefit_hook';
}

export function classifyProductVisibility(creativeObj) {
  if (!creativeObj) return 'unspecified';
  const blueprintText = [
    creativeObj.visualComposition,
    creativeObj.backgroundDirection,
    creativeObj.blueprint?.product_positioning,
    creativeObj.blueprint?.visual_composition,
    creativeObj.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!blueprintText.trim()) return 'unspecified';
  if (/\b(close[- ]up|macro|detail|texture|zoom)\b/.test(blueprintText)) {
    return 'close_up_detail';
  }
  if (/\b(in[- ]use|lifestyle|kitchen|person|model|routine|action)\b/.test(blueprintText)) {
    return 'lifestyle_in_use';
  }
  if (/\b(sequence|scene|multi|split|before|after)\b/.test(blueprintText) || creativeObj.assetType === 'video') {
    return 'multi_frame_sequence';
  }
  if (/\b(center|hero|front|studio|pedestal|isolated|prominent)\b/.test(blueprintText)) {
    return 'hero_centered';
  }
  return 'hero_centered';
}

export function classifyCopyStructure(adCopyObj, creativeObj) {
  const headline = adCopyObj?.headline || adCopyObj?.headlines?.[0] || creativeObj?.hook || '';
  const primary = adCopyObj?.primaryText || adCopyObj?.primaryTexts?.[0] || creativeObj?.mainMessage || '';
  const combined = `${headline} ${primary}`.toLowerCase();

  if (!combined.trim()) return 'unspecified';
  if (/\b(\d+% off|save|deal|offer|discount|limited|₹|rs\.)\b/.test(combined)) {
    return 'offer_led_cta';
  }
  if (/\b(review|rated|trusted|customers|stars|4\.\d|users love)\b/.test(combined)) {
    return 'social_proof_cta';
  }
  if ((primary.match(/[\n•\-✔✓]/g) || []).length >= 2) {
    return 'benefit_list_cta';
  }
  if (/\b(tired of|struggling|no more|solve|fix|say goodbye)\b/.test(combined)) {
    return 'problem_solution_cta';
  }
  return primary.length > 0 && primary.length <= 120 ? 'concise_direct' : 'standard_narrative';
}

export class CreativeMetadataExtractor {
  /**
   * Extract enriched creative metadata joined with Meta outcome metrics,
   * AdCopy records, Campaigns, and Snapshot objectives/audiences.
   */
  static async extractEnrichedPerformance(tenantId, filters = {}) {
    const [comparisonRes, snapshots, creativesRes, adCopies, campaignsRes] = await Promise.all([
      MetaAnalyticsService.getCreativeComparison(tenantId, filters),
      MetaRepository.queryInsightSnapshots(tenantId, {
        since: filters.since,
        until: filters.until,
        metaAdAccountId: filters.adAccountId,
        adPilotCampaignId: filters.campaignId,
        origin: filters.origin || undefined,
        includeBreakdowns: true,
        includeTestFixtures: filters.includeTestFixtures !== 'false',
      }),
      CreativeRepository.findAll({ tenantId, limit: 250 }),
      CreativeRepository.listAdCopies({ tenantId }),
      CampaignRepository.findPaginated({ tenantId, page: 1, limit: 200 }),
    ]);

    const creativesById = new Map((creativesRes.items || []).map((c) => [String(c.id), c]));
    const campaignsById = new Map((campaignsRes.items || []).map((c) => [String(c.id), c]));

    const copyByCreativeId = new Map();
    const copyByCampaignId = new Map();
    for (const copy of adCopies || []) {
      if (copy.creativeId && !copyByCreativeId.has(String(copy.creativeId))) {
        copyByCreativeId.set(String(copy.creativeId), copy);
      }
      if (copy.campaignId && !copyByCampaignId.has(String(copy.campaignId))) {
        copyByCampaignId.set(String(copy.campaignId), copy);
      }
    }

    // Group snapshot metadata per Meta Ad ID for objective, placement, audience attribution
    const snapMetaByAd = new Map();
    for (const row of snapshots || []) {
      const key = `${row.metaAdAccountId}:${row.metaAdId}`;
      const existing = snapMetaByAd.get(key) || {
        objectives: new Set(),
        placements: new Set(),
        audiences: new Set(),
      };
      if (row.objective) existing.objectives.add(row.objective);
      if (row.placement) existing.placements.add(row.placement);
      if (row.audienceLabel) existing.audiences.add(row.audienceLabel);
      snapMetaByAd.set(key, existing);
    }

    const items = (comparisonRes.items || []).map((comp) => {
      const creativeObj = comp.adPilotCreativeId ? creativesById.get(String(comp.adPilotCreativeId)) : null;
      const campaignObj = comp.adPilotCampaignId ? campaignsById.get(String(comp.adPilotCampaignId)) : null;
      const copyObj =
        (comp.adPilotCreativeId ? copyByCreativeId.get(String(comp.adPilotCreativeId)) : null) ||
        (comp.adPilotCampaignId ? copyByCampaignId.get(String(comp.adPilotCampaignId)) : null);

      const snapKey = `${comp.metaAdAccountId}:${comp.metaAdId}`;
      const snapContext = snapMetaByAd.get(snapKey);

      const m = comp.metrics || {};
      const linkClicks = m.linkClicks ?? null;
      const allClicks = m.allClicks ?? null;
      const clickDenominator = linkClicks !== null && linkClicks > 0 ? linkClicks : allClicks;
      const conversionRate =
        m.purchases !== null && clickDenominator > 0
          ? roundOpt((m.purchases / clickDenominator) * 100, 2)
          : null;

      const productData = campaignObj?.productData || {};
      const strategyData = campaignObj?.strategyData || {};

      const placement =
        creativeObj?.placement ||
        copyObj?.placement ||
        (snapContext?.placements.size ? Array.from(snapContext.placements)[0] : 'instagram_feed');

      const marketingAngle =
        creativeObj?.marketingAngle ||
        copyObj?.creativeAngle ||
        strategyData?.marketing_angles?.[0]?.angle_name ||
        'unspecified';

      const audienceHypothesis =
        creativeObj?.audienceHypothesis ||
        copyObj?.audienceHypothesis ||
        (snapContext?.audiences.size ? Array.from(snapContext.audiences)[0] : 'broad_or_unspecified');

      const hookText = creativeObj?.hook || copyObj?.headline || comp.adPilotCreativeTitle || '';
      const cta =
        creativeObj?.overlaySpec?.cta ||
        copyObj?.callToAction ||
        strategyData?.cta_recommendations?.[0] ||
        'Shop Now';

      const format =
        creativeObj?.assetType ||
        (/\bvideo|reel\b/i.test(`${comp.metaAdName} ${comp.adPilotCreativeTitle}`) ? 'video' : 'image');

      return {
        id: comp.adPilotCreativeId || comp.metaAdId,
        adPilotCreativeId: comp.adPilotCreativeId,
        adPilotCampaignId: comp.adPilotCampaignId,
        adPilotCreativeTitle: comp.adPilotCreativeTitle,
        adPilotCampaignName: comp.adPilotCampaignName,
        adPilotQaScore: comp.adPilotQaScore,
        approved: creativeObj ? Boolean(creativeObj.approved) : null,
        metaAdAccountId: comp.metaAdAccountId,
        metaCampaignId: comp.metaCampaignId,
        metaCampaignName: comp.metaCampaignName,
        metaAdId: comp.metaAdId,
        metaAdName: comp.metaAdName,
        origin: comp.origin,
        isTestFixture: Boolean(comp.isTestFixture),
        hasMissingMetrics: Boolean(comp.hasMissingMetrics),
        creativeMetadata: {
          marketingAngle,
          audienceHypothesis,
          hookType: classifyHookType(hookText, comp.adPilotCreativeTitle),
          hookText,
          format,
          videoDuration: creativeObj?.durationSeconds ?? null,
          productVisibility: classifyProductVisibility(creativeObj),
          cta,
          placement,
          copyStructure: classifyCopyStructure(copyObj, creativeObj),
          headline: copyObj?.headline || creativeObj?.hook || null,
        },
        productContext: {
          productName: productData.product_name || comp.adPilotCampaignName || 'Unknown Product',
          productCategory:
            productData.category ||
            strategyData?.product_knowledge?.product_category ||
            'general',
          verifiedBrand: productData.brand || null,
        },
        campaignContext: {
          objective:
            (snapContext?.objectives.size ? Array.from(snapContext.objectives)[0] : null) ||
            'OUTCOME_SALES',
          audienceSegment: snapContext?.audiences.size
            ? Array.from(snapContext.audiences).join(', ')
            : audienceHypothesis,
          attributionSetting: comp.attributionSetting || '7d_click_1d_view',
          currency: comp.currency || 'INR',
          timezoneName: comp.timezoneName || 'Asia/Kolkata',
        },
        metrics: {
          impressions: m.impressions ?? null,
          reach: m.reach ?? null,
          spend: m.spend ?? null,
          cpm: m.cpm ?? null,
          allClicks: m.allClicks ?? null,
          allClickCtr: m.allClickCtr ?? null,
          linkClicks: m.linkClicks ?? null,
          linkCtr: m.linkCtr ?? null,
          cpc: m.cpc ?? null,
          landingPageViews: m.landingPageViews ?? null,
          addToCart: m.addToCart ?? null,
          purchases: m.purchases ?? null,
          purchaseVolume: m.purchases ?? null,
          conversionRate,
          cpa: m.cpa ?? null,
          roas: m.roas ?? null,
          purchaseConversionValue: m.purchaseConversionValue ?? null,
        },
      };
    });

    return {
      items,
      discrepancyWarnings: comparisonRes.discrepancyWarnings || [],
      totalCount: items.length,
    };
  }
}

