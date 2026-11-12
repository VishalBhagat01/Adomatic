import { CreativeMetadataExtractor } from './creativeMetadataExtractor.js';

const DEFAULT_THRESHOLDS = {
  minImpressions: 1000,
  minLinkClicks: 30,
  minSpend: 50,
  minPurchasesForConversionWinner: 5,
  alpha: 0.05, // 95% two-sided confidence
};

function roundOpt(val, decimals = 4) {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

/**
 * Standard normal CDF approximation (Abramowitz and Stegun 7.1.26)
 * accurate to 1.5e-7, deterministic and dependency-free.
 */
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const prob =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - prob : prob;
}

/**
 * Wilson score 95% confidence interval for a binomial proportion (successes / trials).
 */
export function wilsonInterval(successes, trials, z = 1.959964) {
  if (!trials || trials <= 0 || successes === null || successes === undefined) {
    return { lower: null, upper: null, rate: null };
  }
  const s = Math.max(0, Math.min(trials, successes));
  const p = s / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / denom;
  return {
    rate: roundOpt(p * 100, 3),
    lower: roundOpt(Math.max(0, center - margin) * 100, 3),
    upper: roundOpt(Math.min(1, center + margin) * 100, 3),
  };
}

/**
 * Two-proportion two-sided z-test comparing Group A vs Group B.
 */
export function twoProportionZTest(successA, trialsA, successB, trialsB) {
  if (!trialsA || !trialsB || trialsA <= 0 || trialsB <= 0) {
    return { zScore: 0, pValue: 1, confidenceLevel: 0, significant: false };
  }
  const sA = Math.max(0, Math.min(trialsA, successA || 0));
  const sB = Math.max(0, Math.min(trialsB, successB || 0));
  const pA = sA / trialsA;
  const pB = sB / trialsB;
  const pooled = (sA + sB) / (trialsA + trialsB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / trialsA + 1 / trialsB));
  if (!se || !Number.isFinite(se)) {
    return { zScore: 0, pValue: 1, confidenceLevel: 0, significant: false };
  }
  const z = (pA - pB) / se;
  const pValue = Math.min(1, Math.max(0, 2 * (1 - normalCdf(Math.abs(z)))));
  const confidenceLevel = roundOpt(1 - pValue, 4);
  return {
    zScore: roundOpt(z, 4),
    pValue: roundOpt(pValue, 6),
    confidenceLevel,
    significant: pValue < DEFAULT_THRESHOLDS.alpha,
  };
}

export class PerformanceAnalyzerService {
  static getThresholds(overrides = {}) {
    return { ...DEFAULT_THRESHOLDS, ...overrides };
  }

  /**
   * Evaluate sample sufficiency for a single creative record.
   */
  static assessSampleSufficiency(metrics, thresholds = DEFAULT_THRESHOLDS) {
    const impressions = metrics?.impressions ?? 0;
    const linkClicks = metrics?.linkClicks ?? 0;
    const spend = metrics?.spend ?? 0;
    const purchases = metrics?.purchases ?? 0;

    const warnings = [];
    if (impressions < thresholds.minImpressions) {
      warnings.push(`Low impression count (${impressions} < ${thresholds.minImpressions} minimum)`);
    }
    if (linkClicks < thresholds.minLinkClicks) {
      warnings.push(`Low click volume (${linkClicks} < ${thresholds.minLinkClicks} minimum)`);
    }
    if (spend < thresholds.minSpend) {
      warnings.push(`Low spend volume (${spend} < ${thresholds.minSpend} minimum)`);
    }

    const conversionSampleSufficient =
      impressions >= thresholds.minImpressions &&
      linkClicks >= thresholds.minLinkClicks &&
      purchases >= thresholds.minPurchasesForConversionWinner;

    return {
      sufficientForCtr: impressions >= thresholds.minImpressions && linkClicks >= thresholds.minLinkClicks,
      sufficientForConversion: conversionSampleSufficient,
      warnings,
      sampleTier:
        impressions >= thresholds.minImpressions && linkClicks >= thresholds.minLinkClicks
          ? conversionSampleSufficient
            ? 'high'
            : 'moderate'
          : 'insufficient',
    };
  }

  /**
   * Full creative performance analysis normalized by campaign objective, placement,
   * attribution settings, audience, and sample size thresholds.
   */
  static async analyzePerformance(tenantId, filters = {}, thresholdOverrides = {}) {
    const thresholds = this.getThresholds(thresholdOverrides);
    const extracted = await CreativeMetadataExtractor.extractEnrichedPerformance(tenantId, filters);
    const items = extracted.items || [];

    // Build cohort benchmarks grouped by objective + attribution + placement
    const cohorts = new Map();
    for (const item of items) {
      const cohortKey = [
        item.campaignContext.objective,
        item.campaignContext.attributionSetting,
        item.creativeMetadata.placement,
      ].join('|');
      const list = cohorts.get(cohortKey) || [];
      list.push(item);
      cohorts.set(cohortKey, list);
    }

    const analyzedItems = items.map((item) => {
      const m = item.metrics;
      const sample = this.assessSampleSufficiency(m, thresholds);
      const ctrCi = wilsonInterval(m.linkClicks, m.impressions);
      const cvrCi = wilsonInterval(m.purchases, m.linkClicks);

      const cohortKey = [
        item.campaignContext.objective,
        item.campaignContext.attributionSetting,
        item.creativeMetadata.placement,
      ].join('|');
      const peers = cohorts.get(cohortKey) || [];
      const reliablePeers = peers.filter(
        (p) => (p.metrics.impressions ?? 0) >= thresholds.minImpressions
      );

      const avgCohortCtr =
        reliablePeers.length > 0
          ? reliablePeers.reduce((acc, p) => acc + (p.metrics.linkCtr || 0), 0) / reliablePeers.length
          : null;
      const avgCohortRoas =
        reliablePeers.some((p) => p.metrics.roas !== null)
          ? reliablePeers
              .filter((p) => p.metrics.roas !== null)
              .reduce((acc, p, _, arr) => acc + p.metrics.roas / arr.length, 0)
          : null;

      const relativeCtrIndex =
        avgCohortCtr && m.linkCtr !== null && sample.sufficientForCtr
          ? roundOpt(m.linkCtr / avgCohortCtr, 2)
          : null;
      const relativeRoasIndex =
        avgCohortRoas && m.roas !== null && sample.sufficientForConversion
          ? roundOpt(m.roas / avgCohortRoas, 2)
          : null;

      return {
        ...item,
        sampleAssessment: sample,
        confidenceIntervals: {
          linkCtrPercent95: ctrCi,
          conversionRatePercent95: cvrCi,
        },
        cohortNormalization: {
          cohortKey,
          peerCount: peers.length,
          reliablePeerCount: reliablePeers.length,
          cohortAvgLinkCtr: roundOpt(avgCohortCtr, 2),
          cohortAvgRoas: roundOpt(avgCohortRoas, 2),
          relativeCtrIndex,
          relativeRoasIndex,
        },
      };
    });

    // Cohort-normalized head-to-head comparison (strictly refuse declaring winners on insufficient evidence)
    const cohortComparisons = [];
    for (const [cohortKey, group] of cohorts.entries()) {
      const reliable = group.filter(
        (g) => this.assessSampleSufficiency(g.metrics, thresholds).sufficientForCtr
      );
      if (group.length < 2) {
        cohortComparisons.push({
          cohortKey,
          status: 'insufficient_peers',
          winnerCreativeId: null,
          statisticalConfidence: 0,
          pValue: 1,
          warning: 'At least 2 creatives in the same objective/attribution/placement cohort are required for comparison.',
          causationNote: 'Observational cohort data cannot establish causation without an isolated A/B test.',
        });
        continue;
      }

      if (reliable.length < 2) {
        cohortComparisons.push({
          cohortKey,
          status: 'insufficient_sample',
          winnerCreativeId: null,
          statisticalConfidence: 0,
          pValue: 1,
          warning:
            'Sample size is insufficient to compare creatives reliably. Do not declare a superior creative yet.',
          causationNote:
            'Observed metric differences below minimum impression/click thresholds are dominated by random variance.',
        });
        continue;
      }

      const sorted = [...reliable].sort((a, b) => {
        const scoreA = a.metrics.roas ?? a.metrics.linkCtr ?? 0;
        const scoreB = b.metrics.roas ?? b.metrics.linkCtr ?? 0;
        return scoreB - scoreA;
      });
      const leader = sorted[0];
      const runnerUp = sorted[1];

      const spendRatio =
        Math.min(leader.metrics.spend || 1, runnerUp.metrics.spend || 1) > 0
          ? Math.max(leader.metrics.spend || 1, runnerUp.metrics.spend || 1) /
            Math.min(leader.metrics.spend || 1, runnerUp.metrics.spend || 1)
          : 1;
      const audienceMismatch =
        leader.campaignContext.audienceSegment !== runnerUp.campaignContext.audienceSegment;

      const zRes = twoProportionZTest(
        leader.metrics.linkClicks,
        leader.metrics.impressions,
        runnerUp.metrics.linkClicks,
        runnerUp.metrics.impressions
      );

      const confoundingFactors = [];
      if (spendRatio > 2.5) {
        confoundingFactors.push(
          `Unequal spend distribution (${roundOpt(spendRatio, 1)}x difference) can skew delivery algorithm exposure.`
        );
      }
      if (audienceMismatch) {
        confoundingFactors.push(
          `Different audiences ("${leader.campaignContext.audienceSegment}" vs "${runnerUp.campaignContext.audienceSegment}") confound creative attribution.`
        );
      }

      const isStatisticallyDistinct = zRes.significant && confoundingFactors.length === 0;
      cohortComparisons.push({
        cohortKey,
        status: isStatisticallyDistinct ? 'statistically_distinct_association' : 'inconclusive_or_confounded',
        candidateLeaderCreativeId: leader.id,
        candidateLeaderTitle: leader.adPilotCreativeTitle,
        runnerUpCreativeId: runnerUp.id,
        runnerUpTitle: runnerUp.adPilotCreativeTitle,
        statisticalConfidence: zRes.confidenceLevel,
        pValue: zRes.pValue,
        confoundingFactors,
        warning: isStatisticallyDistinct
          ? null
          : 'Differences may be due to sampling noise or confounding variables; validate in a controlled experiment before shifting budget.',
        causationNote:
          'Correlation vs Causation: Observational Meta results show association only. Isolate one creative variable inside a Controlled Experiment to confirm causal lift.',
      });
    }

    // Metadata-level aggregated rollups (Angle, Hook Type, Format, Placement)
    const summarizeDimension = (keyFn) => {
      const map = new Map();
      for (const item of analyzedItems) {
        const key = keyFn(item) || 'unspecified';
        const bucket = map.get(key) || {
          key,
          creativeCount: 0,
          sufficientSampleCount: 0,
          impressions: 0,
          linkClicks: 0,
          spend: 0,
          purchases: 0,
          revenue: 0,
        };
        bucket.creativeCount += 1;
        if (item.sampleAssessment.sufficientForCtr) bucket.sufficientSampleCount += 1;
        bucket.impressions += item.metrics.impressions || 0;
        bucket.linkClicks += item.metrics.linkClicks || 0;
        bucket.spend += item.metrics.spend || 0;
        bucket.purchases += item.metrics.purchases || 0;
        bucket.revenue += item.metrics.purchaseConversionValue || 0;
        map.set(key, bucket);
      }

      return Array.from(map.values()).map((b) => ({
        ...b,
        spend: roundOpt(b.spend, 2),
        linkCtr: b.impressions > 0 ? roundOpt((b.linkClicks / b.impressions) * 100, 2) : null,
        cpc: b.linkClicks > 0 ? roundOpt(b.spend / b.linkClicks, 2) : null,
        cpm: b.impressions > 0 ? roundOpt((b.spend / b.impressions) * 1000, 2) : null,
        conversionRate: b.linkClicks > 0 ? roundOpt((b.purchases / b.linkClicks) * 100, 2) : null,
        cpa: b.purchases > 0 ? roundOpt(b.spend / b.purchases, 2) : null,
        roas: b.spend > 0 ? roundOpt(b.revenue / b.spend, 2) : null,
        reliable: b.impressions >= thresholds.minImpressions && b.linkClicks >= thresholds.minLinkClicks,
      }));
    };

    return {
      thresholds,
      causationDisclaimer:
        'All observational performance breakdowns measure statistical correlation across historical delivery conditions, NOT causal creative proof. Always verify high-stakes hypotheses via controlled single-variable experiments.',
      discrepancyWarnings: extracted.discrepancyWarnings,
      creatives: analyzedItems,
      cohortComparisons,
      breakdowns: {
        byMarketingAngle: summarizeDimension((i) => i.creativeMetadata.marketingAngle),
        byHookType: summarizeDimension((i) => i.creativeMetadata.hookType),
        byFormat: summarizeDimension((i) => i.creativeMetadata.format),
        byPlacement: summarizeDimension((i) => i.creativeMetadata.placement),
        byCopyStructure: summarizeDimension((i) => i.creativeMetadata.copyStructure),
      },
    };
  }
}

