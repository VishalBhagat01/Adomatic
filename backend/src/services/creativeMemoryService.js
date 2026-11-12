import { OptimizationRepository } from '../repositories/optimizationRepository.js';
import { PerformanceAnalyzerService } from './performanceAnalyzerService.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { CampaignRepository } from '../repositories/campaignRepository.js';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'into', 'are', 'was',
  'were', 'has', 'have', 'not', 'but', 'our', 'you', 'all', 'can', 'more', 'best',
]);

export function tokenizeText(text = '') {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (words.length === 0) return {};

  const counts = {};
  for (const w of words) {
    counts[w] = (counts[w] || 0) + 1;
  }
  let norm = 0;
  for (const val of Object.values(counts)) {
    norm += val * val;
  }
  const denom = Math.sqrt(norm) || 1;
  const normalized = {};
  for (const [k, v] of Object.entries(counts)) {
    normalized[k] = Math.round((v / denom) * 10000) / 10000;
  }
  return normalized;
}

export function cosineSimilarity(vecA = {}, vecB = {}) {
  const keysA = Object.keys(vecA);
  if (keysA.length === 0 || !vecB || Object.keys(vecB).length === 0) return 0;
  let dot = 0;
  for (const k of keysA) {
    if (vecB[k] !== undefined) {
      dot += vecA[k] * vecB[k];
    }
  }
  return Math.max(0, Math.min(1, Math.round(dot * 10000) / 10000));
}

/**
 * Strip numeric price/spec assertions from historical learnings so historical
 * campaign copy can NEVER inject stale/false product specs into current campaigns.
 */
function sanitizeLearningStatement(statement = '') {
  return String(statement)
    .replace(/\b(?:₹|rs\.?|inr|\$)\s*\d[\d,.]*/gi, '[price_omitted_use_verified_product_data]')
    .replace(/\b\d+\s*%\s*off\b/gi, '[discount_omitted_use_verified_product_data]');
}

export class CreativeMemoryService {
  /**
   * Synchronize evaluated campaign performance and QA rejections into structured learning memory.
   */
  static async syncLearningMemory(tenantId, filters = {}) {
    const [analysis, creativesRes, campaignsRes] = await Promise.all([
      PerformanceAnalyzerService.analyzePerformance(tenantId, filters),
      CreativeRepository.findAll({ tenantId, limit: 250 }),
      CampaignRepository.findPaginated({ tenantId, page: 1, limit: 200 }),
    ]);

    const campaignsById = new Map((campaignsRes.items || []).map((c) => [String(c.id), c]));
    const persistedIds = new Set();
    const ingestedEntries = [];

    // 1. Ingest Meta-tracked creative outcomes with strict sample gating
    for (const item of analysis.creatives || []) {
      const m = item.metrics || {};
      const sample = item.sampleAssessment;
      const cohort = item.cohortNormalization;

      let outcomeStatus = 'inconclusive';
      const learnings = [];

      if (sample.sufficientForCtr) {
        const strongCtr = (cohort.relativeCtrIndex !== null && cohort.relativeCtrIndex >= 1.15) || (m.linkCtr || 0) >= 1.8;
        const strongRoas = (cohort.relativeRoasIndex !== null && cohort.relativeRoasIndex >= 1.1) || (m.roas || 0) >= 2.5;
        const weakCtr = (cohort.relativeCtrIndex !== null && cohort.relativeCtrIndex < 0.85) || ((m.linkCtr || 0) < 0.85 && m.impressions >= 1500);
        const weakRoas = m.roas !== null && m.roas < 1.2 && m.spend >= 100;

        if ((strongCtr || strongRoas) && !weakRoas) {
          outcomeStatus = 'winning';
          learnings.push(
            sanitizeLearningStatement(
              `Strong ${item.creativeMetadata.hookType} (${m.linkCtr ?? 'N/A'}% link CTR, ROAS ${m.roas ?? 'N/A'}) under ${item.creativeMetadata.placement} placement (${m.impressions} impressions).`
            )
          );
        } else if (weakCtr || weakRoas) {
          outcomeStatus = 'underperforming';
          learnings.push(
            sanitizeLearningStatement(
              `Underperformed cohort baseline (${m.linkCtr ?? 'N/A'}% link CTR, CPA ${m.cpa ?? 'N/A'}) with ${item.creativeMetadata.hookType} angle "${item.creativeMetadata.marketingAngle}".`
            )
          );
        } else {
          learnings.push(
            sanitizeLearningStatement(
              `Moderate observed metrics (${m.linkCtr ?? 'N/A'}% link CTR over ${m.impressions} impressions); run single-variable A/B test to confirm lift.`
            )
          );
        }
      } else {
        learnings.push(
          `Insufficient sample size (${m.impressions || 0} impressions, ${m.linkClicks || 0} link clicks) — do not generalize yet.`
        );
      }

      const summaryText = [
        item.productContext.productCategory,
        item.creativeMetadata.placement,
        item.creativeMetadata.format,
        item.creativeMetadata.marketingAngle,
        item.creativeMetadata.hookType,
        item.creativeMetadata.copyStructure,
        item.creativeMetadata.audienceHypothesis,
        ...learnings,
      ]
        .filter(Boolean)
        .join(' ');

      const saved = await OptimizationRepository.upsertMemoryEntry({
        tenantId,
        sourceCampaignId: item.adPilotCampaignId,
        sourceCreativeId: item.adPilotCreativeId || item.metaAdId,
        sourceMetaAdId: item.metaAdId,
        productCategory: item.productContext.productCategory,
        productName: item.productContext.productName,
        placement: item.creativeMetadata.placement,
        format: item.creativeMetadata.format,
        marketingAngle: item.creativeMetadata.marketingAngle,
        audienceHypothesis: item.creativeMetadata.audienceHypothesis,
        hookType: item.creativeMetadata.hookType,
        copyStructure: item.creativeMetadata.copyStructure,
        cta: item.creativeMetadata.cta,
        productVisibility: item.creativeMetadata.productVisibility,
        videoDuration: item.creativeMetadata.videoDuration,
        outcomeStatus,
        metricsSummary: {
          impressions: m.impressions,
          linkClicks: m.linkClicks,
          linkCtr: m.linkCtr,
          cpc: m.cpc,
          cpm: m.cpm,
          conversionRate: m.conversionRate,
          purchases: m.purchases,
          spend: m.spend,
          cpa: m.cpa,
          roas: m.roas,
          sampleSufficient: sample.sufficientForCtr,
        },
        qaScore: item.adPilotQaScore ?? null,
        keyLearnings: learnings,
        summaryText,
        tokenVector: tokenizeText(summaryText),
        neverOverrideVerifiedProduct: true,
      });

      if (item.adPilotCreativeId) persistedIds.add(String(item.adPilotCreativeId));
      ingestedEntries.push(saved);
    }

    // 2. Also ingest locally rejected QA creatives so future concepts avoid known creative defects
    for (const cr of creativesRes.items || []) {
      const cid = String(cr.id);
      if (persistedIds.has(cid)) continue;
      if (cr.approvalStatus !== 'rejected') continue;

      const camp = campaignsById.get(String(cr.campaignId));
      const productCategory =
        camp?.productData?.category ||
        camp?.strategyData?.product_knowledge?.product_category ||
        'general';

      const defects = (cr.evaluation?.defects || [])
        .slice(0, 3)
        .map((d) => sanitizeLearningStatement(d.message || d.category || 'QA defect'));

      const learnings = defects.length
        ? defects
        : ['Creative rejected by QA compliance gate; review visual fidelity and product accuracy.'];

      const summaryText = [
        productCategory,
        cr.placement,
        cr.assetType,
        cr.marketingAngle,
        cr.hook,
        ...learnings,
      ]
        .filter(Boolean)
        .join(' ');

      const saved = await OptimizationRepository.upsertMemoryEntry({
        tenantId,
        sourceCampaignId: cr.campaignId ? String(cr.campaignId) : null,
        sourceCreativeId: cid,
        productCategory,
        productName: camp?.productData?.product_name || cr.title,
        placement: cr.placement || 'instagram_feed',
        format: cr.assetType || 'image',
        marketingAngle: cr.marketingAngle || 'general',
        audienceHypothesis: cr.audienceHypothesis || '',
        hookType: 'rejected_pattern',
        copyStructure: 'standard',
        cta: cr.overlaySpec?.cta || 'Shop Now',
        productVisibility: 'unspecified',
        videoDuration: cr.durationSeconds ?? null,
        outcomeStatus: 'rejected_qa',
        metricsSummary: { sampleSufficient: false },
        qaScore: cr.evaluation?.overall_weighted_score ?? null,
        keyLearnings: learnings,
        summaryText,
        tokenVector: tokenizeText(summaryText),
        neverOverrideVerifiedProduct: true,
      });
      ingestedEntries.push(saved);
    }

    return {
      syncedCount: ingestedEntries.length,
      entries: ingestedEntries,
    };
  }

  /**
   * Retrieve creative learning memory using structured metadata filters FIRST,
   * followed by secondary semantic cosine similarity ranking, with strict protection
   * ensuring historical claims NEVER override verified ProductData facts.
   */
  static async retrieveLearningMemory(tenantId, query = {}) {
    // 1. Structured metadata filtering FIRST
    const structuredFilters = {};
    if (query.productCategory) structuredFilters.productCategory = query.productCategory;
    if (query.placement) structuredFilters.placement = query.placement;
    if (query.format) structuredFilters.format = query.format;
    if (query.marketingAngle) structuredFilters.marketingAngle = query.marketingAngle;
    if (query.hookType) structuredFilters.hookType = query.hookType;
    if (query.outcomeStatus) structuredFilters.outcomeStatus = query.outcomeStatus;

    let candidates = await OptimizationRepository.queryMemoryEntries(tenantId, structuredFilters);
    let broadenedFallback = false;

    // Fallback: relax narrow category/angle filter while preserving format/placement if empty
    if (candidates.length === 0 && Object.keys(structuredFilters).length > 0) {
      const relaxed = {};
      if (query.placement) relaxed.placement = query.placement;
      if (query.format) relaxed.format = query.format;
      candidates = await OptimizationRepository.queryMemoryEntries(tenantId, relaxed);
      if (candidates.length === 0) {
        candidates = await OptimizationRepository.queryMemoryEntries(tenantId, {});
      }
      broadenedFallback = candidates.length > 0;
    }

    // 2. Secondary semantic similarity ranking over query text
    const queryText = [
      query.productCategory,
      query.productName,
      query.userPrompt,
      query.marketingAngle,
      query.placement,
      query.format,
    ]
      .filter(Boolean)
      .join(' ');
    const queryVec = tokenizeText(queryText);

    const ranked = candidates
      .map((entry) => {
        const semanticScore = cosineSimilarity(queryVec, entry.tokenVector || {});
        const reliabilityBonus = entry.metricsSummary?.sampleSufficient ? 0.25 : 0;
        const categoryMatchBonus =
          query.productCategory &&
          entry.productCategory?.toLowerCase() === String(query.productCategory).toLowerCase()
            ? 0.35
            : 0;
        const relevanceScore =
          Math.round((semanticScore * 0.4 + reliabilityBonus + categoryMatchBonus) * 1000) / 1000;

        return {
          ...entry,
          retrievalScores: {
            semanticSimilarity: semanticScore,
            structuredCategoryMatch: categoryMatchBonus > 0,
            sampleReliable: Boolean(entry.metricsSummary?.sampleSufficient),
            compositeScore: relevanceScore,
          },
        };
      })
      .sort((a, b) => b.retrievalScores.compositeScore - a.retrievalScores.compositeScore);

    const successfulConcepts = ranked.filter((e) => e.outcomeStatus === 'winning').slice(0, 8);
    const failedConcepts = ranked
      .filter((e) => e.outcomeStatus === 'underperforming' || e.outcomeStatus === 'rejected_qa')
      .slice(0, 8);

    // Aggregate effective hooks across reliable winners
    const hookStats = new Map();
    for (const entry of ranked) {
      if (!entry.metricsSummary?.sampleSufficient) continue;
      const h = entry.hookType || 'unspecified';
      const cur = hookStats.get(h) || { hookType: h, winCount: 0, totalCtrs: 0, count: 0 };
      if (entry.outcomeStatus === 'winning') cur.winCount += 1;
      if (entry.metricsSummary?.linkCtr !== null && entry.metricsSummary?.linkCtr !== undefined) {
        cur.totalCtrs += Number(entry.metricsSummary.linkCtr);
        cur.count += 1;
      }
      hookStats.set(h, cur);
    }

    const effectiveHooks = Array.from(hookStats.values())
      .map((h) => ({
        hookType: h.hookType,
        winCount: h.winCount,
        avgLinkCtr: h.count > 0 ? Math.round((h.totalCtrs / h.count) * 100) / 100 : null,
        observedSamples: h.count,
      }))
      .sort((a, b) => b.winCount - a.winCount || (b.avgLinkCtr || 0) - (a.avgLinkCtr || 0));

    // Product category rollups
    const categoryStats = new Map();
    for (const entry of ranked) {
      const cat = entry.productCategory || 'general';
      const cur = categoryStats.get(cat) || {
        productCategory: cat,
        totalEntries: 0,
        winningCount: 0,
        underperformingCount: 0,
        rejectedQaCount: 0,
      };
      cur.totalEntries += 1;
      if (entry.outcomeStatus === 'winning') cur.winningCount += 1;
      if (entry.outcomeStatus === 'underperforming') cur.underperformingCount += 1;
      if (entry.outcomeStatus === 'rejected_qa') cur.rejectedQaCount += 1;
      categoryStats.set(cat, cur);
    }

    const performanceRecommendations = [];
    if (effectiveHooks[0]?.winCount > 0) {
      performanceRecommendations.push(
        `Prioritize testing "${effectiveHooks[0].hookType}" hooks (observed winning average CTR ${effectiveHooks[0].avgLinkCtr ?? 'N/A'}% across ${effectiveHooks[0].observedSamples} reliable creative(s)) as creative direction while using strictly current verified product specs.`
      );
    }
    if (failedConcepts.length > 0) {
      const topDefect = failedConcepts[0].keyLearnings?.[0];
      if (topDefect) {
        performanceRecommendations.push(
          sanitizeLearningStatement(`Avoid repeating previously weak/rejected pattern: ${topDefect}`)
        );
      }
    }

    return {
      productTruthGuardrail: {
        enforced: true,
        policy:
          'Historical creative learnings inform creative structure, hooks, and placement hypotheses ONLY. Historical claims, prices, discounts, or specifications NEVER override current verified ProductData.',
      },
      broadenedFallbackUsed: broadenedFallback,
      totalMatchedEntries: ranked.length,
      successfulConcepts,
      failedConcepts,
      effectiveHooks,
      productCategoryInsights: Array.from(categoryStats.values()),
      performanceRecommendations,
    };
  }
}

