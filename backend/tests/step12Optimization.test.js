import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MetaRepository } from '../src/repositories/metaRepository.js';
import { CampaignRepository } from '../src/repositories/campaignRepository.js';
import { CreativeRepository } from '../src/repositories/creativeRepository.js';
import { OptimizationRepository } from '../src/repositories/optimizationRepository.js';
import { CreativeMetadataExtractor } from '../src/services/creativeMetadataExtractor.js';
import { PerformanceAnalyzerService } from '../src/services/performanceAnalyzerService.js';
import { CreativeMemoryService } from '../src/services/creativeMemoryService.js';
import { ExperimentService } from '../src/services/experimentService.js';
import { MetaAuthService } from '../src/services/metaAuthService.js';
import { metricsService } from '../src/services/metricsService.js';
import { closeRedis } from '../src/queue/redisClient.js';
import { disconnectDatabase } from '../src/database/connection.js';

describe('Step 12 — Optimization Engine, Performance Analysis, Learning Memory & Experimentation', () => {
  const app = createApp();
  const tenantId = 'tenant_opt_test';

  beforeEach(() => {
    MetaRepository.clearMemoryStore();
    CampaignRepository.clearMemoryStore();
    CreativeRepository.clearMemoryStore();
    OptimizationRepository.clearMemoryStore();
    MetaAuthService.clearOAuthStates();
    metricsService.reset();
  });

  after(async () => {
    await closeRedis();
    await disconnectDatabase();
  });

  async function seedLinkedCreativeWithMetrics({
    name,
    productCategory = 'Kitchen Appliances',
    marketingAngle = 'Speed & Efficiency',
    hook = 'Still blending for 5 minutes? Switch to 750W!',
    assetType = 'image',
    durationSeconds = null,
    placement = 'instagram_feed',
    visualComposition = 'Hero centered stainless jar on dark marble countertop',
    primaryText = 'Tired of slow mornings? Save time with 3 stainless blades.',
    impressions = 2500,
    linkClicks = 75,
    spend = 300,
    purchases = 12,
    revenue = 1800,
    objective = 'OUTCOME_SALES',
    attributionSetting = '7d_click_1d_view',
    audienceLabel = 'Home Cooks 25-45',
    metaAdId = 'ad_default_1',
    approved = true,
    approvalStatus = 'approved',
  }) {
    const camp = await CampaignRepository.create({
      tenantId,
      name,
      productUrl: 'https://www.lifelongindiaonline.com/products/mixer-750w',
      userPrompt: 'Highlight verified 750W power and durability',
      formats: [assetType],
      placements: [placement],
      productData: {
        product_name: 'Lifelong PowerPro 750W',
        brand: 'Lifelong',
        category: productCategory,
        price: 2999,
      },
      strategyData: {
        product_knowledge: { product_category: productCategory },
        cta_recommendations: ['Shop Now'],
      },
    });

    const creative = await CreativeRepository.createCreative({
      tenantId,
      campaignId: camp.id,
      creativeKey: `cr_${metaAdId}`,
      title: name,
      assetType,
      placement,
      aspectRatio: assetType === 'video' ? '9:16' : '1:1',
      storageKey: `tenants/${tenantId}/creatives/${metaAdId}.${assetType === 'video' ? 'mp4' : 'png'}`,
      durationSeconds,
      marketingAngle,
      audienceHypothesis: audienceLabel,
      hook,
      mainMessage: primaryText,
      visualComposition,
      overlaySpec: { cta: 'Shop Now' },
      approved,
      approvalStatus,
      evaluation: { overall_weighted_score: approved ? 88 : 52 },
    });

    await CreativeRepository.createAdCopy({
      tenantId,
      campaignId: camp.id,
      creativeId: creative.id,
      headline: hook,
      primaryText,
      callToAction: 'Shop Now',
      placement,
      creativeAngle: marketingAngle,
      audienceHypothesis: audienceLabel,
    });

    await MetaRepository.upsertCreativeMapping(tenantId, {
      metaAdAccountId: 'act_999',
      metaCampaignId: 'mc_1',
      metaAdId,
      adPilotCampaignId: camp.id,
      adPilotCreativeId: creative.id,
      creativeTitle: name,
      origin: 'adpilot_generated',
    });

    await MetaRepository.upsertInsightSnapshot(tenantId, {
      syncKey: `sync_${metaAdId}_1`,
      breakdownKey: 'none',
      metaAdAccountId: 'act_999',
      metaCampaignId: 'mc_1',
      metaCampaignName: 'Meta Kitchen Campaign',
      metaAdId,
      metaAdName: name,
      origin: 'adpilot_generated',
      adPilotCampaignId: camp.id,
      adPilotCreativeId: creative.id,
      dateStart: '2026-10-01',
      dateStop: '2026-10-07',
      objective,
      attributionSetting,
      placement,
      audienceLabel,
      impressions,
      reach: Math.round(impressions * 0.8),
      allClicks: Math.round(linkClicks * 1.25),
      linkClicks,
      spend,
      purchases,
      purchaseConversionValue: revenue,
      currency: 'INR',
      timezoneName: 'Asia/Kolkata',
    });

    return { camp, creative };
  }

  test('Part A: Extracts full creative metadata mapped to Meta campaign outcomes', async () => {
    await seedLinkedCreativeWithMetrics({
      name: 'Question Hook Hero Creative',
      metaAdId: 'ad_meta_a1',
      hook: 'Still blending manually?',
      primaryText: 'Tired of noisy blades? Fix prep bottlenecks today.',
      impressions: 3000,
      linkClicks: 90,
      spend: 450,
      purchases: 9,
      revenue: 1800,
    });

    const extracted = await CreativeMetadataExtractor.extractEnrichedPerformance(tenantId);
    assert.strictEqual(extracted.items.length, 1);

    const item = extracted.items[0];
    assert.strictEqual(item.creativeMetadata.hookType, 'question_hook');
    assert.strictEqual(item.creativeMetadata.copyStructure, 'problem_solution_cta');
    assert.strictEqual(item.creativeMetadata.productVisibility, 'hero_centered');
    assert.strictEqual(item.creativeMetadata.placement, 'instagram_feed');
    assert.strictEqual(item.creativeMetadata.cta, 'Shop Now');
    assert.strictEqual(item.metrics.linkCtr, 3);
    assert.strictEqual(item.metrics.conversionRate, 10);
    assert.strictEqual(item.metrics.cpc, 5);
    assert.strictEqual(item.metrics.roas, 4);
  });

  test('Part B: Refuses to declare a creative winner on insufficient sample and separates correlation vs causation', async () => {
    // Low-sample high CTR vs low-sample lower CTR -> MUST NOT declare winner
    await seedLinkedCreativeWithMetrics({
      name: 'Tiny Sample Lucky Ad',
      metaAdId: 'ad_low_1',
      impressions: 120,
      linkClicks: 10,
      spend: 20,
      purchases: 1,
      revenue: 100,
    });
    await seedLinkedCreativeWithMetrics({
      name: 'Tiny Sample Ad 2',
      metaAdId: 'ad_low_2',
      impressions: 140,
      linkClicks: 3,
      spend: 25,
      purchases: 0,
      revenue: 0,
    });

    const lowSampleAnalysis = await PerformanceAnalyzerService.analyzePerformance(tenantId);
    assert.strictEqual(lowSampleAnalysis.cohortComparisons[0].status, 'insufficient_sample');
    assert.strictEqual(lowSampleAnalysis.cohortComparisons[0].winnerCreativeId, null);
    assert.match(lowSampleAnalysis.cohortComparisons[0].warning, /insufficient/i);
    assert.match(lowSampleAnalysis.causationDisclaimer, /correlation/i);

    // Sufficient unconfounded cohort -> computes exact statistical confidence via two-proportion Z-test
    MetaRepository.clearMemoryStore();
    CampaignRepository.clearMemoryStore();
    CreativeRepository.clearMemoryStore();

    await seedLinkedCreativeWithMetrics({
      name: 'High CTR Proven Creative',
      metaAdId: 'ad_sig_1',
      hook: 'Still struggling with tough batter?',
      impressions: 5000,
      linkClicks: 210, // 4.2% CTR
      spend: 600,
      purchases: 20,
      revenue: 3000,
    });
    await seedLinkedCreativeWithMetrics({
      name: 'Baseline Creative',
      metaAdId: 'ad_sig_2',
      hook: 'Everyday mixer grinder.',
      impressions: 5000,
      linkClicks: 80, // 1.6% CTR
      spend: 550,
      purchases: 6,
      revenue: 900,
    });

    const sigAnalysis = await PerformanceAnalyzerService.analyzePerformance(tenantId);
    const comp = sigAnalysis.cohortComparisons[0];
    assert.strictEqual(comp.status, 'statistically_distinct_association');
    assert.ok(comp.statisticalConfidence >= 0.99);
    assert.ok(comp.pValue < 0.01);
    assert.match(comp.causationNote, /association only/i);
  });

  test('Part C: Creative Learning Memory filters structured metadata first and protects ProductData truth', async () => {
    await seedLinkedCreativeWithMetrics({
      name: 'Winner Blender Angle',
      metaAdId: 'ad_mem_win',
      productCategory: 'Kitchen Appliances',
      marketingAngle: 'Heavy Duty Grinding',
      hook: '25% faster grinding at ₹9999? Tested in daily kitchens!',
      impressions: 4000,
      linkClicks: 140, // 3.5% CTR
      spend: 500,
      purchases: 18,
      revenue: 2500,
    });

    await seedLinkedCreativeWithMetrics({
      name: 'QA Rejected Creative',
      metaAdId: 'ad_mem_qa_bad',
      productCategory: 'Kitchen Appliances',
      approved: false,
      approvalStatus: 'rejected',
      impressions: 0,
      linkClicks: 0,
      spend: 0,
      purchases: 0,
      revenue: 0,
    });

    const syncRes = await CreativeMemoryService.syncLearningMemory(tenantId);
    assert.ok(syncRes.syncedCount >= 1);

    const memory = await CreativeMemoryService.retrieveLearningMemory(tenantId, {
      productCategory: 'Kitchen Appliances',
      placement: 'instagram_feed',
      format: 'image',
    });

    assert.strictEqual(memory.productTruthGuardrail.enforced, true);
    assert.match(memory.productTruthGuardrail.policy, /NEVER override current verified ProductData/i);
    assert.ok(memory.successfulConcepts.length >= 1);
    assert.ok(memory.effectiveHooks.length >= 1);

    // Verify historical price strings are redacted/blocked before surfacing as strategy learnings
    const allLearningsText = memory.successfulConcepts
      .flatMap((c) => c.keyLearnings || [])
      .join(' ');
    assert.doesNotMatch(allLearningsText, /₹9999/);
  });

  test('Part D & E: Experiment confidence gating, advisory contextual bandit, explicit human approval, and evidence-backed recommendations', async () => {
    // Seed weak video ad + strong image ad for recommendations
    await seedLinkedCreativeWithMetrics({
      name: 'Weak Opening Video Ad',
      metaAdId: 'ad_rec_vid',
      assetType: 'video',
      durationSeconds: 15,
      placement: 'instagram_reels',
      impressions: 4000,
      linkClicks: 24, // < 30 clicks -> insufficient OR bump to 32 clicks (0.8% CTR)
      spend: 200,
      purchases: 1,
      revenue: 150,
    });
    await MetaRepository.upsertInsightSnapshot(tenantId, {
      syncKey: 'sync_ad_rec_vid_2',
      breakdownKey: 'none',
      metaAdAccountId: 'act_999',
      metaCampaignId: 'mc_1',
      metaCampaignName: 'Meta Kitchen Campaign',
      metaAdId: 'ad_rec_vid',
      metaAdName: 'Weak Opening Video Ad',
      origin: 'adpilot_generated',
      dateStart: '2026-10-08',
      dateStop: '2026-10-09',
      objective: 'OUTCOME_SALES',
      attributionSetting: '7d_click_1d_view',
      placement: 'instagram_reels',
      audienceLabel: 'Home Cooks 25-45',
      impressions: 2000,
      linkClicks: 16,
      spend: 100,
      purchases: 1,
      purchaseConversionValue: 150,
    });

    const recRes = await request(app)
      .post('/api/optimization/recommendations/generate')
      .set('X-Tenant-ID', tenantId)
      .send({});
    assert.strictEqual(recRes.status, 200);
    assert.ok(recRes.body.data.recommendations.length >= 1);
    const openingSceneRec = recRes.body.data.recommendations.find(
      (r) => r.insightType === 'change_opening_scene'
    );
    assert.ok(openingSceneRec, 'Should generate change_opening_scene recommendation for low-CTR video');
    assert.ok(openingSceneRec.observedEvidence.impressions >= 4000);

    // Create experiment with initial insufficient samples -> bandit MUST NOT allocate yet
    const expCreate = await request(app)
      .post('/api/optimization/experiments')
      .set('X-Tenant-ID', tenantId)
      .send({
        name: 'Hook Test: Question vs Direct Benefit',
        hypothesis: 'Question hook increases link CTR on Instagram Feed',
        variableTested: 'hook_type',
        objective: 'TRAFFIC',
        banditEnabled: true,
        variants: [
          { variantId: 'var_a', label: 'Question Hook', hookType: 'question_hook', impressions: 250, linkClicks: 12, spend: 40 },
          { variantId: 'var_b', label: 'Direct Benefit', hookType: 'direct_benefit_hook', impressions: 250, linkClicks: 5, spend: 40 },
        ],
      });
    assert.strictEqual(expCreate.status, 201);
    assert.strictEqual(expCreate.body.data.status, 'running');
    assert.strictEqual(expCreate.body.data.banditEligible, false);
    assert.strictEqual(Object.keys(expCreate.body.data.banditAllocations).length, 0);
    assert.ok(expCreate.body.data.sampleSizeWarnings.length === 2);

    const expId = expCreate.body.data.id;

    // Attempting approval before statistical conclusion MUST fail 400
    const prematureApprove = await request(app)
      .post(`/api/optimization/experiments/${expId}/approve`)
      .set('X-Tenant-ID', tenantId)
      .send({ approve: true, confirmationPhrase: 'APPROVE_EXPERIMENT_BUDGET_ACTION' });
    assert.strictEqual(prematureApprove.status, 400);

    // Record reliable statistically significant variant metrics
    const metricsRes = await request(app)
      .patch(`/api/optimization/experiments/${expId}/metrics`)
      .set('X-Tenant-ID', tenantId)
      .send({
        variants: [
          { variantId: 'var_a', impressions: 3500, linkClicks: 145, spend: 280 },
          { variantId: 'var_b', impressions: 3500, linkClicks: 55, spend: 270 },
        ],
      });
    assert.strictEqual(metricsRes.status, 200);
    assert.strictEqual(metricsRes.body.data.status, 'concluded');
    assert.strictEqual(metricsRes.body.data.winningVariantId, 'var_a');
    assert.ok(metricsRes.body.data.confidenceLevel >= 0.99);
    assert.strictEqual(metricsRes.body.data.banditEligible, true);
    assert.ok(metricsRes.body.data.banditAllocations.var_a.advisoryOnly === true);
    assert.strictEqual(metricsRes.body.data.userApprovedBudgetAction, false);

    // Verify execution write gate blocks unapproved budget actions even after winning experiment
    await assert.rejects(
      () => ExperimentService.assertExperimentWritePermitted(tenantId, expId),
      (err) => err.statusCode === 403 && /never automatically increases budgets/i.test(err.message)
    );

    // Explicit approval requires confirmation phrase
    const badPhrase = await request(app)
      .post(`/api/optimization/experiments/${expId}/approve`)
      .set('X-Tenant-ID', tenantId)
      .send({ approve: true, confirmationPhrase: 'WRONG_PHRASE' });
    assert.strictEqual(badPhrase.status, 403);

    const goodApprove = await request(app)
      .post(`/api/optimization/experiments/${expId}/approve`)
      .set('X-Tenant-ID', tenantId)
      .send({ approve: true, confirmationPhrase: 'APPROVE_EXPERIMENT_BUDGET_ACTION' });
    assert.strictEqual(goodApprove.status, 200);
    assert.strictEqual(goodApprove.body.data.userApprovedBudgetAction, true);
  });
});
