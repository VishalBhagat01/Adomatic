import { OptimizationRepository } from '../repositories/optimizationRepository.js';
import { PerformanceAnalyzerService, twoProportionZTest, wilsonInterval } from './performanceAnalyzerService.js';
import { MetaAuthService } from './metaAuthService.js';
import { ForbiddenError, NotFoundError, BadRequestError } from '../utils/errors.js';

function roundOpt(val, decimals = 3) {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

/**
 * Compute deterministic UCB1/contextual exploration-exploitation weights ONLY when
 * all variants satisfy strict minimum sample thresholds. Always returns advisory weights.
 */
function computeAdvisoryBanditAllocations(variants, metricKey = 'ctr') {
  const totalTrials = variants.reduce((sum, v) => sum + (v.impressions || 0), 0);
  if (totalTrials <= 0) return {};

  const scores = variants.map((v) => {
    const rate =
      metricKey === 'conversionRate'
        ? (v.conversionRate || 0) / 100
        : (v.ctr || 0) / 100;
    const trials = Math.max(1, v.impressions || 1);
    const ucbBonus = Math.sqrt((2 * Math.log(Math.max(2, totalTrials))) / trials);
    return {
      variantId: v.variantId,
      score: Math.max(0.001, rate + ucbBonus * 0.25),
    };
  });

  const sumScores = scores.reduce((acc, s) => acc + s.score, 0) || 1;
  const rawWeights = scores.map((s) => ({
    variantId: s.variantId,
    weight: Math.min(0.7, Math.max(0.15, s.score / sumScores)),
  }));

  const normalizedSum = rawWeights.reduce((acc, w) => acc + w.weight, 0) || 1;
  const allocations = {};
  for (const w of rawWeights) {
    allocations[w.variantId] = {
      recommendedTrafficShare: roundOpt(w.weight / normalizedSum, 3),
      advisoryOnly: true,
    };
  }
  return allocations;
}

export class ExperimentService {
  /**
   * Analyze experiment variants with strict minimum-sample gating, two-proportion Z-test,
   * sample-size warnings, and explicit separation of correlation from causation.
   */
  static evaluateExperimentState(experiment) {
    const minImp = experiment.minSampleImpressions || 1000;
    const minClicks = experiment.minSampleClicks || 30;
    const variants = (experiment.variants || []).map((v) => {
      const impressions = Number(v.impressions || 0);
      const linkClicks = Number(v.linkClicks || 0);
      const conversions = Number(v.conversions || 0);
      const spend = Number(v.spend || 0);
      const revenue = Number(v.revenue || 0);

      const ctr = impressions > 0 ? roundOpt((linkClicks / impressions) * 100, 3) : null;
      const conversionRate = linkClicks > 0 ? roundOpt((conversions / linkClicks) * 100, 3) : null;
      const cpa = conversions > 0 ? roundOpt(spend / conversions, 2) : null;
      const roas = spend > 0 ? roundOpt(revenue / spend, 2) : null;

      return {
        ...v,
        impressions,
        linkClicks,
        conversions,
        spend: roundOpt(spend, 2),
        revenue: roundOpt(revenue, 2),
        ctr,
        conversionRate,
        cpa,
        roas,
        ctrWilson95: wilsonInterval(linkClicks, impressions),
        cvrWilson95: wilsonInterval(conversions, linkClicks),
      };
    });

    const warnings = [];
    for (const v of variants) {
      if (v.impressions < minImp || v.linkClicks < minClicks) {
        warnings.push(
          `Variant "${v.label}" (${v.variantId}) has insufficient sample size: ${v.impressions}/${minImp} impressions, ${v.linkClicks}/${minClicks} clicks.`
        );
      }
    }

    const allVariantsSufficient = variants.length >= 2 && warnings.length === 0;
    const useConversionMetric =
      experiment.objective === 'CONVERSIONS' &&
      variants.every((v) => v.conversions >= 5 && v.linkClicks >= minClicks);

    const sorted = [...variants].sort((a, b) => {
      const metricA = useConversionMetric ? a.conversionRate || 0 : a.ctr || 0;
      const metricB = useConversionMetric ? b.conversionRate || 0 : b.ctr || 0;
      return metricB - metricA;
    });

    let pValue = 1;
    let confidenceLevel = 0;
    let winningVariantId = null;
    let status = experiment.status === 'archived' ? 'archived' : 'running';
    let conclusion = 'Experiment is awaiting sufficient minimum sample thresholds across all variants before conclusions can be drawn.';

    if (variants.length >= 2) {
      const leader = sorted[0];
      const runnerUp = sorted[1];
      const testRes = useConversionMetric
        ? twoProportionZTest(leader.conversions, leader.linkClicks, runnerUp.conversions, runnerUp.linkClicks)
        : twoProportionZTest(leader.linkClicks, leader.impressions, runnerUp.linkClicks, runnerUp.impressions);

      pValue = testRes.pValue;
      confidenceLevel = testRes.confidenceLevel;

      if (allVariantsSufficient && testRes.significant) {
        status = 'concluded';
        winningVariantId = leader.variantId;
        const metricName = useConversionMetric ? 'conversion rate' : 'link CTR';
        const leaderVal = useConversionMetric ? `${leader.conversionRate}%` : `${leader.ctr}%`;
        const runnerVal = useConversionMetric ? `${runnerUp.conversionRate}%` : `${runnerUp.ctr}%`;
        conclusion = `Controlled conclusion (${Math.round(confidenceLevel * 100)}% statistical confidence, p=${pValue}): Variant "${leader.label}" outperformed "${runnerUp.label}" on ${metricName} (${leaderVal} vs ${runnerVal}) testing "${experiment.variableTested}". Budget changes remain advisory until explicitly approved by the user.`;
      } else if (allVariantsSufficient) {
        status = 'inconclusive';
        conclusion = `Minimum sample met across all variants, but difference is not statistically significant at 95% confidence (p=${pValue}, confidence=${Math.round(confidenceLevel * 100)}%). Continue testing or introduce a stronger creative contrast.`;
      }
    }

    // Bandit contextual allocation is ONLY enabled & computed after sample thresholds are satisfied
    const banditEligible = allVariantsSufficient;
    const banditAllocations =
      banditEligible && experiment.banditEnabled
        ? computeAdvisoryBanditAllocations(variants, useConversionMetric ? 'conversionRate' : 'ctr')
        : {};

    return {
      variants,
      status,
      confidenceLevel: roundOpt(confidenceLevel, 4),
      pValue: roundOpt(pValue, 6),
      winningVariantId,
      conclusion,
      sampleSizeWarnings: warnings,
      banditEligible,
      banditAllocations,
      requiresExplicitUserApproval: true,
      correlationVsCausationNote:
        experiment.variableTested === 'multivariate'
          ? 'Multivariate test: attribute combined direction cautiously; isolate winning element for causal verification.'
          : `Controlled single-variable test isolating "${experiment.variableTested}" under fixed objective (${experiment.objective}) and placement (${experiment.placement}).`,
    };
  }

  static async createExperiment(tenantId, payload) {
    if (!Array.isArray(payload.variants) || payload.variants.length < 2) {
      throw new BadRequestError('An experiment requires at least 2 distinct variant groups.');
    }

    const baseDoc = {
      tenantId,
      campaignId: payload.campaignId || null,
      name: payload.name,
      hypothesis: payload.hypothesis,
      variableTested: payload.variableTested || 'hook_type',
      objective: payload.objective || 'CONVERSIONS',
      placement: payload.placement || 'instagram_feed',
      attributionSetting: payload.attributionSetting || '7d_click_1d_view',
      minSampleImpressions: payload.minSampleImpressions || 1000,
      minSampleClicks: payload.minSampleClicks || 30,
      banditEnabled: Boolean(payload.banditEnabled),
      requiresExplicitUserApproval: true,
      userApprovedBudgetAction: false,
      variants: payload.variants,
    };

    const evaluated = this.evaluateExperimentState(baseDoc);
    return await OptimizationRepository.createExperiment({
      ...baseDoc,
      ...evaluated,
    });
  }

  static async recordVariantMetrics(tenantId, experimentId, { variants, banditEnabled, endDate }) {
    const existing = await OptimizationRepository.getExperimentById(experimentId, tenantId);
    if (!existing) {
      throw new NotFoundError('Experiment not found');
    }

    const incomingMap = new Map((variants || []).map((v) => [v.variantId, v]));
    const mergedVariants = (existing.variants || []).map((v) => {
      const update = incomingMap.get(v.variantId);
      return update ? { ...v, ...update } : v;
    });

    const nextCandidate = {
      ...existing,
      variants: mergedVariants,
      banditEnabled: banditEnabled !== undefined ? Boolean(banditEnabled) : existing.banditEnabled,
      endDate: endDate || existing.endDate,
    };

    const evaluated = this.evaluateExperimentState(nextCandidate);
    return await OptimizationRepository.updateExperiment(experimentId, tenantId, {
      ...evaluated,
      banditEnabled: nextCandidate.banditEnabled,
      endDate: nextCandidate.status === 'concluded' ? existing.endDate || new Date() : nextCandidate.endDate,
    });
  }

  /**
   * Explicitly approve or reject a human-gated experiment action.
   * NEVER auto-launches or increases spend without explicit confirmation + Meta write gate.
   */
  static async approveExperimentBudgetAction(
    tenantId,
    userId,
    experimentId,
    { approve, confirmationPhrase = '' }
  ) {
    const existing = await OptimizationRepository.getExperimentById(experimentId, tenantId);
    if (!existing) {
      throw new NotFoundError('Experiment not found');
    }

    if (approve) {
      if (existing.status !== 'concluded' || !existing.winningVariantId) {
        throw new BadRequestError(
          'Cannot approve budget shift before experiment reaches statistically conclusive status with sufficient sample size.'
        );
      }
      if (confirmationPhrase !== 'APPROVE_EXPERIMENT_BUDGET_ACTION') {
        throw new ForbiddenError(
          'Explicit user approval required: supply confirmationPhrase="APPROVE_EXPERIMENT_BUDGET_ACTION" to record budget authorization.'
        );
      }
    }

    return await OptimizationRepository.updateExperiment(experimentId, tenantId, {
      userApprovedBudgetAction: Boolean(approve),
      approvedBy: approve ? String(userId || 'workspace_user') : null,
      approvedAt: approve ? new Date() : null,
    });
  }

  /**
   * Execute Meta write action ONLY if experiment is explicitly approved by user
   * AND tenant Meta connection has authorized writes.
   */
  static async assertExperimentWritePermitted(tenantId, experimentId) {
    const exp = await OptimizationRepository.getExperimentById(experimentId, tenantId);
    if (!exp) throw new NotFoundError('Experiment not found');
    if (!exp.userApprovedBudgetAction) {
      throw new ForbiddenError(
        'AdPilot never automatically increases budgets or launches ads. Explicit user approval on the experiment is required first.'
      );
    }
    const authCtx = await MetaAuthService.resolveAuthorizedAccountContext(tenantId);
    if (!authCtx.connection.writeAuthorized) {
      throw new ForbiddenError(
        'Meta connection write authorization is disabled. Enable write authorization in Studio Settings first.'
      );
    }
    return { experiment: exp, authCtx };
  }

  /**
   * Generate evidence-backed optimization recommendations referencing exact observed Meta metrics,
   * cohort context, and sample warnings.
   */
  static async generateRecommendations(tenantId, filters = {}) {
    const analysis = await PerformanceAnalyzerService.analyzePerformance(tenantId, filters);
    const recommendations = [];

    for (const item of analysis.creatives || []) {
      const m = item.metrics;
      const meta = item.creativeMetadata;
      const sample = item.sampleAssessment;
      const cohort = item.cohortNormalization;

      const baseEvidence = {
        metaAdId: item.metaAdId,
        adPilotCreativeId: item.adPilotCreativeId,
        objective: item.campaignContext.objective,
        attributionSetting: item.campaignContext.attributionSetting,
        placement: meta.placement,
        format: meta.format,
        hookType: meta.hookType,
        marketingAngle: meta.marketingAngle,
        impressions: m.impressions,
        linkClicks: m.linkClicks,
        linkCtr: m.linkCtr,
        cpc: m.cpc,
        cpm: m.cpm,
        conversionRate: m.conversionRate,
        cpa: m.cpa,
        roas: m.roas,
        spend: m.spend,
        purchases: m.purchases,
      };

      // Insufficient sample gate -> explicit warning instead of premature change
      if (!sample.sufficientForCtr) {
        recommendations.push({
          tenantId,
          campaignId: item.adPilotCampaignId || null,
          creativeId: item.adPilotCreativeId || null,
          metaAdId: item.metaAdId,
          insightType: 'insufficient_data_warning',
          impactLevel: 'low',
          confidenceScore: 0.25,
          recommendation: `Collect additional delivery volume for "${item.adPilotCreativeTitle}" (${m.impressions || 0} impressions, ${m.linkClicks || 0} link clicks in ${meta.placement}) before judging performance or altering creative direction.`,
          observedEvidence: baseEvidence,
          sampleSizeWarning: sample.warnings.join('; '),
          correlationVsCausationNote: analysis.causationDisclaimer,
        });
        continue;
      }

      // 1. Expand promising concept
      if (
        (cohort.relativeCtrIndex >= 1.15 || (m.roas !== null && m.roas >= 2.5)) &&
        sample.sufficientForCtr
      ) {
        recommendations.push({
          tenantId,
          campaignId: item.adPilotCampaignId || null,
          creativeId: item.adPilotCreativeId || null,
          metaAdId: item.metaAdId,
          insightType: 'expand_promising_concept',
          impactLevel: 'high',
          confidenceScore: sample.sufficientForConversion ? 0.86 : 0.72,
          recommendation: `Expand promising concept "${item.adPilotCreativeTitle}" (angle: ${meta.marketingAngle}, ${meta.hookType}): observed ${m.linkCtr}% link CTR (${m.linkClicks} link clicks / ${m.impressions} impressions) and ROAS ${m.roas ?? 'N/A'} across ${meta.placement}. Recommend human-approved budget test or spin-off variants.`,
          observedEvidence: baseEvidence,
          sampleSizeWarning: sample.sufficientForConversion ? null : 'Conversion count < 5; validate ROAS with more purchase volume.',
          correlationVsCausationNote: analysis.causationDisclaimer,
        });
      }

      // 2. Weak opening scene on video creatives
      if (
        meta.format === 'video' &&
        ((m.linkCtr !== null && m.linkCtr < 1.1) || (cohort.relativeCtrIndex !== null && cohort.relativeCtrIndex < 0.85))
      ) {
        recommendations.push({
          tenantId,
          campaignId: item.adPilotCampaignId || null,
          creativeId: item.adPilotCreativeId || null,
          metaAdId: item.metaAdId,
          insightType: 'change_opening_scene',
          impactLevel: 'high',
          confidenceScore: 0.74,
          recommendation: `Change first 3-second opening scene for video "${item.adPilotCreativeTitle}" (${meta.videoDuration || 'N/A'}s): link CTR is ${m.linkCtr}% across ${m.impressions} impressions (CPC ${m.cpc ?? 'N/A'}), below cohort benchmark (${cohort.cohortAvgLinkCtr ?? 'N/A'}%).`,
          observedEvidence: baseEvidence,
          sampleSizeWarning: null,
          correlationVsCausationNote: analysis.causationDisclaimer,
        });
      } else if (
        (m.linkCtr !== null && m.linkCtr < 1.0) ||
        (cohort.relativeCtrIndex !== null && cohort.relativeCtrIndex < 0.85)
      ) {
        // 3. Test different hook
        recommendations.push({
          tenantId,
          campaignId: item.adPilotCampaignId || null,
          creativeId: item.adPilotCreativeId || null,
          metaAdId: item.metaAdId,
          insightType: 'test_different_hook',
          impactLevel: 'high',
          confidenceScore: 0.75,
          recommendation: `Test a different hook against current "${meta.hookType}" for "${item.adPilotCreativeTitle}": observed ${m.linkCtr}% link CTR (${m.linkClicks} clicks / ${m.impressions} impressions, CPM ${m.cpm ?? 'N/A'}) trails comparable ${meta.placement} ads (${cohort.cohortAvgLinkCtr ?? 'N/A'}% avg).`,
          observedEvidence: baseEvidence,
          sampleSizeWarning: null,
          correlationVsCausationNote: analysis.causationDisclaimer,
        });
      }

      // 4. Revise ad copy / visibility when CTR works but conversion efficiency lags
      if (
        m.linkClicks >= 30 &&
        m.linkCtr >= 1.2 &&
        ((m.conversionRate !== null && m.conversionRate < 1.5) || (m.roas !== null && m.roas < 1.4))
      ) {
        recommendations.push({
          tenantId,
          campaignId: item.adPilotCampaignId || null,
          creativeId: item.adPilotCreativeId || null,
          metaAdId: item.metaAdId,
          insightType: 'revise_ad_copy',
          impactLevel: 'medium',
          confidenceScore: sample.sufficientForConversion ? 0.78 : 0.62,
          recommendation: `Revise "${meta.copyStructure}" ad copy on "${item.adPilotCreativeTitle}" to align expectation with landing page specs: click intent is healthy (${m.linkCtr}% link CTR, ${m.linkClicks} link clicks), yet post-click conversion rate is ${m.conversionRate ?? 0}% (CPA ${m.cpa ?? 'N/A'}, spend ${m.spend}).`,
          observedEvidence: baseEvidence,
          sampleSizeWarning: sample.sufficientForConversion ? null : 'Early conversion signal (< 5 purchases); monitor landing page alignment.',
          correlationVsCausationNote: analysis.causationDisclaimer,
        });
      }

      // 5. Improve product visibility when framing is unspecified/non-hero and clicks/conversions lag
      if (
        ['unspecified', 'lifestyle_in_use'].includes(meta.productVisibility) &&
        m.linkClicks >= 30 &&
        (m.conversionRate === null || m.conversionRate < 2.0)
      ) {
        recommendations.push({
          tenantId,
          campaignId: item.adPilotCampaignId || null,
          creativeId: item.adPilotCreativeId || null,
          metaAdId: item.metaAdId,
          insightType: 'improve_product_visibility',
          impactLevel: 'medium',
          confidenceScore: 0.68,
          recommendation: `Improve product visibility (current framing: ${meta.productVisibility}) in "${item.adPilotCreativeTitle}": test a hero-centered composition highlighting key verified features; observed ${m.linkClicks} clicks yielded ${m.purchases ?? 0} purchases (${m.conversionRate ?? 0}% CVR).`,
          observedEvidence: baseEvidence,
          sampleSizeWarning: null,
          correlationVsCausationNote: analysis.causationDisclaimer,
        });
      }

      // 6. Test another placement when placement spend is concentrated
      if (
        meta.placement === 'instagram_feed' &&
        m.spend >= 100 &&
        cohort.peerCount >= 1
      ) {
        recommendations.push({
          tenantId,
          campaignId: item.adPilotCampaignId || null,
          creativeId: item.adPilotCreativeId || null,
          metaAdId: item.metaAdId,
          insightType: 'test_another_placement',
          impactLevel: 'low',
          confidenceScore: 0.65,
          recommendation: `Test "${item.adPilotCreativeTitle}" across vertical 9:16 placements (Reels/Stories) in a controlled split: current spend (${m.spend}) is concentrated in ${meta.placement} (CPM ${m.cpm ?? 'N/A'}, ${m.impressions} impressions).`,
          observedEvidence: baseEvidence,
          sampleSizeWarning: null,
          correlationVsCausationNote: analysis.causationDisclaimer,
        });
      }
    }

    const saved = await OptimizationRepository.upsertInsightsForTenant(tenantId, recommendations);
    return {
      generatedCount: saved.length,
      causationDisclaimer: analysis.causationDisclaimer,
      recommendations: saved,
    };
  }
}

