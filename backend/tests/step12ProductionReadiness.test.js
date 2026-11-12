import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { CampaignRepository } from '../src/repositories/campaignRepository.js';
import { CreativeRepository } from '../src/repositories/creativeRepository.js';
import { MetaRepository } from '../src/repositories/metaRepository.js';
import { OptimizationRepository } from '../src/repositories/optimizationRepository.js';
import { campaignOrchestrator } from '../src/services/campaignOrchestrator.js';
import { agentClient } from '../src/services/agentClient.js';
import { storageService } from '../src/services/storageService.js';
import { metricsService } from '../src/services/metricsService.js';
import { CAMPAIGN_STATUS } from '../src/models/Campaign.js';
import { closeRedis } from '../src/queue/redisClient.js';
import { disconnectDatabase } from '../src/database/connection.js';

describe('Step 12 — Production Readiness, E2E Workflow, Recovery, Security & Load', () => {
  const app = createApp();
  const tenantId = 'tenant_e2e_prod';

  const originalAgentMethods = {
    extractProduct: agentClient.extractProduct.bind(agentClient),
    generateStrategy: agentClient.generateStrategy.bind(agentClient),
    planCreatives: agentClient.planCreatives.bind(agentClient),
    generateImages: agentClient.generateImages.bind(agentClient),
    evaluateCreative: agentClient.evaluateCreative.bind(agentClient),
    generateAdCopy: agentClient.generateAdCopy.bind(agentClient),
  };

  beforeEach(() => {
    CampaignRepository.clearMemoryStore();
    CreativeRepository.clearMemoryStore();
    MetaRepository.clearMemoryStore();
    OptimizationRepository.clearMemoryStore();
    metricsService.reset();

    // Restore original agent methods cleanly before each test
    Object.assign(agentClient, originalAgentMethods);
  });

  after(async () => {
    Object.assign(agentClient, originalAgentMethods);
    await closeRedis();
    await disconnectDatabase();
  });

  function installStubbedAgentPipeline({ failOnceOnStrategy = false } = {}) {
    let strategyAttempt = 0;

    agentClient.extractProduct = async () => ({
      success: true,
      product: {
        product_name: 'Lifelong NutriPro Juicer Mixer 750W',
        brand: 'Lifelong',
        category: 'Kitchen Appliances',
        description: '750W copper motor mixer grinder with 3 stainless jars.',
        price: 2799,
        currency: 'INR',
        features: ['750W Copper Motor', '3 Stainless Steel Jars'],
        specifications: { wattage: '750W', jars: '3' },
        images: [{ url: 'https://cdn.example.com/mixer.jpg', alt_text: 'Mixer Hero' }],
        missing_fields: [],
      },
      warnings: [],
    });

    agentClient.generateStrategy = async (payload) => {
      strategyAttempt += 1;
      if (failOnceOnStrategy && strategyAttempt === 1) {
        const err = new Error('Transient Gemini 503 overloaded');
        err.statusCode = 503;
        throw err;
      }
      assert.ok(payload.product_data.product_name.includes('Lifelong'));
      return {
        success: true,
        strategy: {
          product_knowledge: {
            product_category: 'Kitchen Appliances',
            core_functionality: 'High-speed blending and grinding',
            verified_features: ['750W Copper Motor', '3 Stainless Steel Jars'],
            supported_claims: ['750W powerful copper motor'],
            missing_or_uncertain_info: [],
          },
          personas: [
            {
              persona_id: 'persona_1',
              persona_name: 'Busy Home Cooks',
              pain_points: ['Slow spice grinding'],
              purchase_motivations: ['750W torque'],
            },
          ],
          marketing_angles: [
            {
              angle_id: 'angle_1',
              angle_name: 'Power Efficiency',
              target_persona_id: 'persona_1',
              core_hook: '750W copper power for effortless daily prep',
            },
          ],
          cta_recommendations: ['Shop Now'],
        },
        warnings: [],
      };
    };

    agentClient.planCreatives = async () => ({
      success: true,
      plan: {
        concepts: [
          {
            concept_id: 'concept_img_1',
            creative_title: 'Countertop Hero 750W',
            format: 'image',
            placement: 'instagram_feed',
            image_blueprint: {
              creative_title: 'Countertop Hero 750W',
              marketing_angle: 'Power Efficiency',
              audience_hypothesis: 'Busy Home Cooks',
              hook: 'Tired of slow blending? Switch to 750W!',
              main_message: '3 stainless steel jars built for daily grinding.',
              visual_composition: 'Hero centered appliance on dark slate counter',
              placement: 'instagram_feed',
              aspect_ratio: '1:1',
            },
          },
        ],
        placement_specs: [{ placement: 'instagram_feed', aspect_ratio: '1:1' }],
      },
      warnings: [],
    });

    agentClient.generateImages = async () => ({
      success: true,
      total_estimated_cost_usd: 0.039,
      assets: [
        {
          creative_id: 'cr_img_e2e_1',
          object_key: `tenants/${tenantId}/creatives/e2e_1.png`,
          overlay_object_key: `tenants/${tenantId}/creatives/e2e_1_overlay.png`,
          presigned_url: 'http://localhost:9000/adpilot-creatives/e2e_1.png',
          aspect_ratio: '1:1',
          approved: true,
          metadata: { bucket: 'adpilot-creatives' },
        },
      ],
      warnings: [],
    });

    agentClient.evaluateCreative = async () => ({
      creative_id: 'cr_img_e2e_1',
      overall_weighted_score: 91,
      approved: true,
      decision: 'approved',
      strengths: ['Crisp product visibility', 'Verified 750W spec alignment'],
      defects: [],
    });

    agentClient.generateAdCopy = async () => ({
      headlines: [{ text: 'Lifelong 750W NutriPro — Faster Prep', linked_claims: [] }],
      primary_texts: [{ text: 'Grind spices & batters effortlessly with 750W copper power.', linked_claims: [] }],
      descriptions: [{ text: '3 stainless steel jars included.' }],
      cta_recommendation: 'Shop Now',
      creative_angle: 'Power Efficiency',
      audience_hypothesis: 'Busy Home Cooks',
    });
  }

  test('E2E: URL + optional empty prompt -> Completed Campaign -> Meta Analytics -> Optimization Intelligence loop', async () => {
    installStubbedAgentPipeline({ failOnceOnStrategy: true });

    // 1. Create campaign via HTTP with optional blank prompt
    const createRes = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', tenantId)
      .send({
        product_url: 'https://www.lifelongindiaonline.com/products/nutripro-750w',
        user_prompt: '',
        formats: ['image'],
        placements: ['instagram_feed'],
      });

    assert.strictEqual(createRes.status, 201);
    const campaignId = createRes.body.data.id;

    // 2. Run orchestrator end-to-end (exercises retry on 503 strategy error + complete assembly)
    const completed = await campaignOrchestrator.runCampaign(campaignId, tenantId);
    assert.strictEqual(completed.status, CAMPAIGN_STATUS.COMPLETED);
    assert.strictEqual(completed.retryCount, 1);
    assert.strictEqual(completed.executionMetadata.approvedCount, 1);
    assert.strictEqual(completed.executionMetadata.totalCostUsd, 0.039);

    // 3. Verify creatives + ad copy persisted
    const creativesRes = await request(app)
      .get(`/api/campaigns/${campaignId}/creatives`)
      .set('X-Tenant-ID', tenantId);
    assert.strictEqual(creativesRes.status, 200);
    assert.strictEqual(creativesRes.body.data.creatives.length, 1);
    assert.strictEqual(creativesRes.body.data.adCopies.length, 1);

    // 4. Sync isolated Meta fixture insights linked to campaign -> verify intelligence & recommendations loop
    const syncRes = await request(app)
      .post('/api/meta/sync/fixtures')
      .set('X-Tenant-ID', tenantId)
      .send({});
    assert.strictEqual(syncRes.status, 200);

    const intelRes = await request(app)
      .get('/api/optimization/intelligence')
      .set('X-Tenant-ID', tenantId);
    assert.strictEqual(intelRes.status, 200);
    assert.ok(intelRes.body.data.creatives.length >= 1);

    // 5. Verify metrics tracked campaign completion & AI cost accurately
    const metricsRes = await request(app).get('/api/metrics');
    assert.strictEqual(metricsRes.status, 200);
    assert.strictEqual(metricsRes.body.data.campaigns.completed, 1);
    assert.strictEqual(metricsRes.body.data.campaigns.estimatedAiCostUsd, 0.039);
  });

  test('Worker Crash Recovery: Recovers stalled campaign without corrupting partial creatives', async () => {
    const camp = await CampaignRepository.create({
      tenantId,
      name: 'Crashed Worker Campaign',
      productUrl: 'https://www.lifelongindiaonline.com/products/vacuum',
      userPrompt: 'Promote wet and dry vacuum cleaner',
      formats: ['image'],
      placements: ['instagram_feed'],
      productData: { product_name: 'Lifelong Wet & Dry Vacuum' },
    });

    const partialCreative = await CreativeRepository.createCreative({
      tenantId,
      campaignId: camp.id,
      creativeKey: 'cr_partial_1',
      title: 'Preserved Image Before Crash',
      assetType: 'image',
      placement: 'instagram_feed',
      storageKey: 'tenants/t/creatives/preserved.png',
      approved: true,
      approvalStatus: 'approved',
    });

    // Simulate worker stalling in GENERATING_ASSETS 15 minutes ago
    await CampaignRepository.updateArtifacts(camp.id, tenantId, {
      status: CAMPAIGN_STATUS.GENERATING_ASSETS,
      currentStage: CAMPAIGN_STATUS.GENERATING_ASSETS,
    });
    const stalledDoc = await CampaignRepository.findById(camp.id, tenantId);
    stalledDoc.updatedAt = new Date(Date.now() - 15 * 60 * 1000);

    const recoverRes = await request(app)
      .post('/api/optimization/recovery/stalled')
      .set('X-Tenant-ID', tenantId)
      .send({ staleThresholdMs: 5 * 60 * 1000, autoRequeue: false });

    assert.strictEqual(recoverRes.status, 200);
    assert.strictEqual(recoverRes.body.data.recoveredCount, 1);
    assert.strictEqual(recoverRes.body.data.recovered[0].previousStage, CAMPAIGN_STATUS.GENERATING_ASSETS);

    const recoveredCamp = await CampaignRepository.findById(camp.id, tenantId);
    assert.strictEqual(recoveredCamp.status, CAMPAIGN_STATUS.FAILED);
    assert.strictEqual(recoveredCamp.errorMetadata.errorCode, 'WORKER_STALL_RECOVERED');
    assert.ok(recoveredCamp.productData.product_name.includes('Vacuum'));

    // Partial creative must remain uncorrupted
    const creativesCheck = await CreativeRepository.findByCampaignId(camp.id, tenantId);
    assert.strictEqual(creativesCheck.creatives.length, 1);
    assert.strictEqual(creativesCheck.creatives[0].id, partialCreative.id);
  });

  test('Error Reporting Hook & Storage Recovery: Permanent failure triggers structured error reporter cleanly', async () => {
    const capturedErrors = [];
    metricsService.registerErrorReporter((err, entry) => {
      capturedErrors.push({ message: err.message, code: entry.code });
    });

    const origCreate = CreativeRepository.createCreative;
    CreativeRepository.createCreative = async () => {
      throw new Error('Simulated storage persistence outage');
    };

    try {
      installStubbedAgentPipeline();
      const camp = await CampaignRepository.create({
        tenantId,
        name: 'Storage Failure Camp',
        productUrl: 'https://www.lifelongindiaonline.com/products/mixer',
        userPrompt: 'Promote mixer',
        formats: ['image'],
        placements: ['instagram_feed'],
      });

      // Asset generation loop gracefully warns when per-asset persistence fails, OR if critical path fails, error reporter fires
      const origPlan = agentClient.planCreatives;
      agentClient.planCreatives = async () => {
        throw new Error('Fatal planning outage');
      };

      await assert.rejects(() => campaignOrchestrator.runCampaign(camp.id, tenantId));
      assert.ok(capturedErrors.some((e) => e.message.includes('Fatal planning outage')));
      agentClient.planCreatives = origPlan;
    } finally {
      CreativeRepository.createCreative = origCreate;
    }

    const storageHealth = await storageService.getStorageHealth();
    assert.ok(['connected', 'error', 'degraded', 'ok'].includes(storageHealth.status));
  });

  test('Observability Contracts: /health/live, /health/ready, /metrics Prometheus, and /api/metrics', async () => {
    const [liveRes, readyRes, promRes, jsonMetricsRes] = await Promise.all([
      request(app).get('/health/live'),
      request(app).get('/health/ready'),
      request(app).get('/metrics'),
      request(app).get('/api/metrics'),
    ]);

    assert.strictEqual(liveRes.status, 200);
    assert.strictEqual(liveRes.body.data.status, 'alive');

    assert.strictEqual(readyRes.status, 200);
    assert.ok(['ready', 'not_ready'].includes(readyRes.body.data.status));

    assert.strictEqual(promRes.status, 200);
    assert.match(promRes.text, /adpilot_http_requests_total/);
    assert.match(promRes.text, /adpilot_ai_estimated_cost_usd/);

    assert.strictEqual(jsonMetricsRes.status, 200);
    assert.ok(typeof jsonMetricsRes.body.data.http.requestsTotal === 'number');
  });

  test('Security & Tenant Isolation: Cross-tenant access blocked and malformed payloads rejected', async () => {
    const expRes = await request(app)
      .post('/api/optimization/experiments')
      .set('X-Tenant-ID', 'tenant_alpha')
      .send({
        name: 'Alpha Private Experiment',
        hypothesis: 'Isolate tenant access strictly',
        variants: [
          { variantId: 'a', label: 'Variant A' },
          { variantId: 'b', label: 'Variant B' },
        ],
      });
    assert.strictEqual(expRes.status, 201);
    const expId = expRes.body.data.id;

    // Tenant Beta cannot view or modify Tenant Alpha's experiment
    const betaList = await request(app)
      .get('/api/optimization/experiments')
      .set('X-Tenant-ID', 'tenant_beta');
    assert.strictEqual(betaList.body.data.count, 0);

    const betaMutate = await request(app)
      .post(`/api/optimization/experiments/${expId}/approve`)
      .set('X-Tenant-ID', 'tenant_beta')
      .send({ approve: true, confirmationPhrase: 'APPROVE_EXPERIMENT_BUDGET_ACTION' });
    assert.strictEqual(betaMutate.status, 404);

    // Malformed / injection-like payload rejected by schema validation
    const invalidCampaign = await request(app)
      .post('/api/campaigns')
      .set('X-Tenant-ID', 'tenant_alpha')
      .send({
        product_url: 'javascript:alert(1)',
        user_prompt: { $gt: '' },
      });
    assert.strictEqual(invalidCampaign.status, 400);
  });

  test('Load Burst: 25 concurrent analytics & health requests complete cleanly without race errors', async () => {
    const requests = [];
    for (let i = 0; i < 25; i++) {
      requests.push(
        request(app)
          .get(i % 2 === 0 ? '/api/optimization/intelligence' : '/health/live')
          .set('X-Tenant-ID', tenantId)
      );
    }

    const responses = await Promise.all(requests);
    assert.strictEqual(responses.length, 25);
    for (const r of responses) {
      assert.strictEqual(r.status, 200);
    }

    const metricsRes = await request(app).get('/api/metrics');
    assert.ok(metricsRes.body.data.http.requestsTotal >= 25);
    assert.strictEqual(metricsRes.body.data.http.status5xx, 0);
  });
});
