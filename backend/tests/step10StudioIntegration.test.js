import { test, describe, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { CampaignRepository } from '../src/repositories/campaignRepository.js';
import { CreativeRepository } from '../src/repositories/creativeRepository.js';
import { agentClient } from '../src/services/agentClient.js';
import { campaignOrchestrator } from '../src/services/campaignOrchestrator.js';
import { closeRedis } from '../src/queue/redisClient.js';
import { disconnectDatabase } from '../src/database/connection.js';

describe('Step 10 Studio Backend APIs & Orchestration Integration', () => {
  const app = createApp();
  const initialVideoFlag = env.ENABLE_VIDEO_GENERATION;

  const originalAgentMethods = {
    extractProduct: agentClient.extractProduct.bind(agentClient),
    generateStrategy: agentClient.generateStrategy.bind(agentClient),
    planCreatives: agentClient.planCreatives.bind(agentClient),
    generateImages: agentClient.generateImages.bind(agentClient),
    generateVideo: agentClient.generateVideo.bind(agentClient),
    getVideoJobStatus: agentClient.getVideoJobStatus.bind(agentClient),
    evaluateCreative: agentClient.evaluateCreative.bind(agentClient),
    generateAdCopy: agentClient.generateAdCopy.bind(agentClient),
  };

  beforeEach(() => {
    env.ENABLE_VIDEO_GENERATION = true;
    CampaignRepository.clearMemoryStore();
    CreativeRepository.clearMemoryStore();
    campaignOrchestrator.setAutoExecute(false);
  });

  afterEach(() => {
    Object.assign(agentClient, originalAgentMethods);
    campaignOrchestrator.setAutoExecute(null);
  });

  after(async () => {
    env.ENABLE_VIDEO_GENERATION = initialVideoFlag;
    await closeRedis();
    await disconnectDatabase();
  });

  const sampleProduct = {
    product_name: 'Lifelong AeroFit Smart Blender 1000W',
    brand: 'Lifelong',
    category: 'Kitchen Appliances',
    description: 'High-torque 1000W copper motor blender with stainless steel blades.',
    price: 3499,
    original_price: 5999,
    currency: 'INR',
    discount: '42% off',
    features: ['1000W Copper Motor', '6-Leaf Stainless Blades', '2-Year Warranty'],
    specifications: { Power: '1000W', Capacity: '1.5L' },
    images: ['https://cdn.example.com/blender-front.jpg'],
    reviews: [],
    rating: 4.5,
    review_count: 142,
    availability: 'In Stock',
  };

  const sampleStrategy = {
    product_knowledge: {
      product_name: sampleProduct.product_name,
      category: 'Kitchen Appliances',
      core_functionality: 'Heavy-duty blending for smoothies and batters',
      verified_features: sampleProduct.features,
      customer_benefits: ['Blends tough ingredients smoothly'],
      differentiating_factors: ['1000W high-torque copper motor'],
      product_limitations: [],
      supported_advertising_claims: ['1000W Copper Motor', '2-Year Warranty'],
      missing_or_uncertain_information: ['Noise decibel rating not listed'],
    },
    customer_personas: [
      {
        persona_name: 'Busy Urban Health Enthusiast',
        demographics: '24-38 professionals in metro cities',
        pain_points: ['Clumpy smoothies with low-watt mixers'],
        purchase_motivations: ['Fast morning smoothies under 30 seconds'],
        objections: ['Motor overheating during heavy grinding'],
      },
    ],
    marketing_angles: [
      {
        angle_id: 'angle_power',
        angle_name: 'Effortless 1000W Power',
        core_hook: 'Zero lumps in 20 seconds',
        messaging_direction: 'Show high-torque blending performance cleanly.',
        visual_direction: 'Warm kitchen countertop studio shot',
        target_persona: 'Busy Urban Health Enthusiast',
      },
    ],
    visual_direction_guidelines: 'Natural morning kitchen daylight with clean product hero framing',
    recommended_hooks: ['Zero lumps in 20 seconds', 'Built for daily 1000W blending'],
    cta_recommendations: ['Shop Now', 'Upgrade Your Kitchen'],
    placement_recommendations: [
      {
        placement: 'instagram_feed',
        recommended_format: 'image',
        aspect_ratio: '1:1',
        rationale: 'Clear product visibility in feed',
      },
    ],
  };

  test('POST /api/campaigns allows omitted or blank optional user_prompt', async () => {
    const resBlank = await request(app).post('/api/campaigns').send({
      product_url: 'https://www.lifelongindiaonline.com/products/blender',
      user_prompt: '',
      formats: ['image'],
      placements: ['instagram_feed'],
    });
    assert.strictEqual(resBlank.statusCode, 201);
    assert.strictEqual(resBlank.body.data.status, 'QUEUED');
    assert.strictEqual(resBlank.body.data.userPrompt, '');

    const resOmitted = await request(app)
      .post('/api/campaigns')
      .set('Idempotency-Key', 'opt-omitted-prompt')
      .send({
        product_url: 'https://www.lifelongindiaonline.com/products/blender-2',
        formats: ['image'],
        placements: ['instagram_feed'],
      });
    assert.strictEqual(resOmitted.statusCode, 201);
  });

  test('POST /api/products/preview rejects unsafe URLs and returns missing field diagnostics', async () => {
    const ssrfRes = await request(app).post('/api/products/preview').send({
      product_url: 'http://127.0.0.1:8000/internal',
    });
    assert.strictEqual(ssrfRes.statusCode, 400);

    agentClient.extractProduct = async () => ({
      success: true,
      product: { ...sampleProduct, brand: null, rating: null },
      warnings: ['Brand name could not be confirmed from JSON-LD'],
      diagnostics: { extraction_method: 'http_bs4', fetch_time_ms: 140 },
    });

    const previewRes = await request(app).post('/api/products/preview').send({
      product_url: 'https://www.lifelongindiaonline.com/products/aerofit-blender',
    });
    assert.strictEqual(previewRes.statusCode, 200);
    assert.strictEqual(previewRes.body.success, true);
    assert.strictEqual(previewRes.body.data.product.product_name, sampleProduct.product_name);
    assert.ok(previewRes.body.data.missingFields.includes('brand'));
    assert.strictEqual(previewRes.body.data.warnings.length, 1);
  });

  test('Orchestrator executes pipeline, populates dashboard summary, and supports selective creative edit + regeneration', async () => {
    let regenCallCount = 0;

    agentClient.extractProduct = async () => ({
      success: true,
      product: sampleProduct,
      warnings: [],
    });

    agentClient.generateStrategy = async () => ({
      success: true,
      strategy: sampleStrategy,
      warnings: [],
    });

    agentClient.planCreatives = async () => ({
      success: true,
      plan: {
        plan_id: 'plan_1',
        product_name: sampleProduct.product_name,
        concepts: [
          {
            concept_id: 'concept_kitchen_hero',
            format: 'image',
            creative_title: 'Morning Countertop Power Hero',
            marketing_angle_name: 'Effortless 1000W Power',
            audience_hypothesis: 'Busy Urban Health Enthusiast',
            placement: 'instagram_feed',
            image_blueprint: {
              concept_id: 'concept_kitchen_hero',
              creative_title: 'Morning Countertop Power Hero',
              marketing_angle_name: 'Effortless 1000W Power',
              audience_hypothesis: 'Busy Urban Health Enthusiast',
              hook: 'Zero lumps in 20 seconds',
              main_message: '1000W copper motor blends frozen fruit effortlessly.',
              visual_composition: 'Centered countertop product shot',
              background_direction: 'Warm sunlit marble kitchen counter',
              aspect_ratio: '1:1',
              placement: 'instagram_feed',
              image_generation_prompt: 'Studio product photo of Lifelong 1000W blender on warm marble countertop.',
            },
          },
        ],
        placement_specs: [{ placement: 'instagram_feed', aspect_ratio: '1:1' }],
      },
      warnings: [],
    });

    agentClient.generateImages = async ({ blueprint }) => {
      regenCallCount += 1;
      const samplePngB64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      return {
        success: true,
        model_identifier: 'gemini-3-pro-image-preview',
        prompt_version: 'v1',
        total_estimated_cost_usd: 0.04,
        assets: [
          {
            creative_id: `cr_img_${regenCallCount}`,
            variation_index: 0,
            approved: true,
            mime_type: 'image/png',
            width: 1080,
            height: 1080,
            aspect_ratio: blueprint.aspect_ratio || '1:1',
            object_key: `campaigns/c/cr_img_${regenCallCount}.png`,
            prompt_used: blueprint.image_generation_prompt,
            cost: { estimated_cost_usd: 0.04 },
            validation: { passed: true },
            metadata: { bucket: 'adpilot-creatives' },
          },
        ],
      };
    };

    agentClient.evaluateCreative = async ({ creative_id }) => ({
      creative_id,
      approved: true,
      overall_weighted_score: 91.5,
      hard_rejection_triggered: false,
      criteria_scores: [
        { criterion: 'product_identity_and_visual_fidelity', score: 9.4, rationale: 'Accurate blade assembly' },
        { criterion: 'text_readability', score: 9.0, rationale: 'Crisp high contrast overlay' },
      ],
      issues: [],
    });

    agentClient.generateAdCopy = async ({ creative_id }) => ({
      copy_id: `copy_${creative_id}`,
      creative_id,
      approved: true,
      creative_angle: 'Effortless 1000W Power',
      audience_hypothesis: 'Busy Urban Health Enthusiast',
      cta_recommendation: 'Shop Now',
      headlines: [
        { text: '1000W Precision Blending', linked_claims: [{ verified_source_field: 'features', claim_text: '1000W Copper Motor' }] },
      ],
      primary_texts: [
        { text: 'Crush frozen fruit and ice effortlessly with a 1000W copper motor.', linked_claims: [] },
      ],
      descriptions: [{ text: '2-Year Lifelong Manufacturer Warranty' }],
    });

    // 1. Create Campaign & Execute Orchestrator directly
    const createRes = await request(app).post('/api/campaigns').send({
      product_url: 'https://www.lifelongindiaonline.com/products/aerofit-blender',
      formats: ['image'],
      placements: ['instagram_feed'],
    });
    assert.strictEqual(createRes.statusCode, 201);
    const campaignId = createRes.body.data.id;

    const completedCampaign = await campaignOrchestrator.runCampaign(campaignId, 'tenant_default');
    assert.strictEqual(completedCampaign.status, 'COMPLETED');
    assert.strictEqual(completedCampaign.progress, 100);

    // 2. Check Dashboard Summary (Real Aggregated Counts)
    const dashRes = await request(app).get('/api/dashboard/summary');
    assert.strictEqual(dashRes.statusCode, 200);
    assert.strictEqual(dashRes.body.data.totals.totalCampaigns, 1);
    assert.strictEqual(dashRes.body.data.totals.generatedCreatives, 1);
    assert.strictEqual(dashRes.body.data.totals.approvedCreatives, 1);
    assert.ok(dashRes.body.data.recentActivity.length >= 2);

    // 3. Check Consolidated Campaign Details
    const detailsRes = await request(app).get(`/api/campaigns/${campaignId}/details`);
    assert.strictEqual(detailsRes.statusCode, 200);
    assert.strictEqual(detailsRes.body.data.creatives.length, 1);
    assert.strictEqual(detailsRes.body.data.adCopies.length, 1);
    assert.strictEqual(detailsRes.body.data.strategy.customer_personas.length, 1);

    const creativeId = detailsRes.body.data.creatives[0].id;

    // 4. Patch Creative Copy & Instructions (Creative Editor save)
    const patchRes = await request(app)
      .patch(`/api/creatives/${creativeId}`)
      .send({
        headline: 'Custom Dark Slate Kitchen Hero',
        primaryText: 'Engineered with a 1000W copper motor for smooth daily nutrition.',
        callToAction: 'Order Today',
        backgroundDirection: 'Dark matte slate stone countertop with moody rim lighting',
        creativeInstructions: 'Emphasize metallic brushed base',
      });
    assert.strictEqual(patchRes.statusCode, 200);
    assert.strictEqual(patchRes.body.data.creative.backgroundDirection, 'Dark matte slate stone countertop with moody rim lighting');
    assert.strictEqual(patchRes.body.data.adCopies[0].headline, 'Custom Dark Slate Kitchen Hero');

    // 5. Selective Single-Creative Regeneration preserves v1 in versionHistory without restarting campaign
    const regenCreativeRes = await request(app)
      .post(`/api/creatives/${creativeId}/regenerate`)
      .send({
        creativeInstructions: 'Make lighting warmer dusk studio reflection',
      });
    assert.strictEqual(regenCreativeRes.statusCode, 200);
    assert.strictEqual(regenCreativeRes.body.data.creative.version, 2);
    assert.strictEqual(regenCreativeRes.body.data.creative.versionHistory.length, 1);
    assert.strictEqual(regenCreativeRes.body.data.creative.versionHistory[0].version, 1);
    assert.strictEqual(regenCreativeRes.body.data.campaign.status, 'COMPLETED');

    // 6. Verify inline media proxy fallback works when inlineBase64 exists cleanly
    const samplePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await CreativeRepository.updateCreative(creativeId, 'tenant_default', {
      metadata: { inlineBase64: samplePng },
    });
    const mediaRes = await request(app).get(`/api/creatives/${creativeId}/media?download=1`);
    assert.strictEqual(mediaRes.statusCode, 200);
    assert.match(mediaRes.headers['content-disposition'], /attachment; filename=/);
    assert.strictEqual(mediaRes.headers['content-type'], 'image/png');
  });

  test('GET /api/campaigns/:id/events streams SSE initial snapshot cleanly', async () => {
    const createRes = await request(app).post('/api/campaigns').send({
      product_url: 'https://www.lifelongindiaonline.com/products/sse-test',
      formats: ['image'],
      placements: ['instagram_feed'],
    });
    const campaignId = createRes.body.data.id;

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      const firstChunk = await new Promise((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/api/campaigns/${campaignId}/events`,
          { headers: { Accept: 'text/event-stream' } },
          (res) => {
            assert.strictEqual(res.statusCode, 200);
            assert.match(res.headers['content-type'], /text\/event-stream/);
            let received = '';
            res.on('data', (chunk) => {
              received += chunk.toString('utf8');
              if (received.includes('event: snapshot')) {
                req.destroy();
                resolve(received);
              }
            });
          }
        );
        req.on('error', (err) => {
          if (err.code !== 'ECONNRESET') reject(err);
        });
      });

      assert.match(firstChunk, /event: snapshot/);
      assert.match(firstChunk, new RegExp(campaignId));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('Live Agent wire contract: ProductExtractResponse.data, GenerationPrompt objects, and video failure marks campaign FAILED', async () => {
    const prod = {
      product_name: 'Lifelong Glass Kettle 1.8L',
      brand: 'Lifelong',
      category: 'Kitchen Appliances',
      price: 999,
      currency: 'INR',
      features: ['1500W Rapid Boil', 'Borosilicate Glass'],
      specifications: { Capacity: '1.8 L', Power: '1500W' },
      images: [{ url: 'https://cdn.example.com/kettle.jpg', is_primary: true }],
    };

    // Real Pydantic ProductExtractResponse uses { success, data, diagnostics }, not { product }
    agentClient.extractProduct = async () => ({
      success: true,
      data: prod,
      diagnostics: {
        extraction_method: 'http_json_ld',
        warnings: ['Minor spec table normalization applied'],
      },
      error: null,
    });

    const previewRes = await request(app).post('/api/products/preview').send({
      product_url: 'https://www.lifelongindiaonline.com/products/glass-kettle',
    });
    assert.strictEqual(previewRes.statusCode, 200);
    assert.strictEqual(previewRes.body.success, true);
    assert.strictEqual(previewRes.body.data.product.product_name, prod.product_name);
    assert.deepStrictEqual(previewRes.body.data.warnings, ['Minor spec table normalization applied']);

    agentClient.generateStrategy = async () => ({
      success: true,
      strategy: {
        customer_personas: [{ persona_name: 'Daily Tea Maker', pain_points: ['Slow boiling'], purchase_motivations: ['Speed'] }],
        marketing_angles: [{ angle_name: 'Fast Boil Mornings' }],
        cta_recommendations: ['Shop Now'],
      },
      warnings: [],
    });

    agentClient.planCreatives = async () => ({
      success: true,
      plan: {
        plan_id: 'plan_contract_1',
        product_name: prod.product_name,
        concepts: [
          {
            concept_id: 'c_img_obj',
            format: 'image',
            creative_title: 'Rapid Boil Hero',
            placement: 'instagram_feed',
            image_blueprint: {
              concept_id: 'c_img_obj',
              creative_title: 'Rapid Boil Hero',
              hook: 'Boil Water in Minutes',
              main_message: '1500W borosilicate kettle',
              aspect_ratio: '1:1',
              placement: 'instagram_feed',
              image_generation_prompt: {
                positive_prompt: 'Studio glass kettle on slate counter',
                negative_prompt: 'blurry, text artifacts',
              },
            },
          },
          {
            concept_id: 'c_vid_fail',
            format: 'video',
            creative_title: 'Kettle Pour Motion',
            placement: 'instagram_reels',
            video_storyboard: {
              concept_id: 'c_vid_fail',
              creative_title: 'Kettle Pour Motion',
              opening_hook: 'Fast Morning Pour',
              final_cta: 'Shop Now',
              total_duration: 9,
              placement: 'instagram_reels',
              scene_sequence: [{ scene_number: 1, scene_duration: 9, scene_description: 'Kettle pouring hot water' }],
              video_generation_prompt: { positive_prompt: 'Glass kettle boiling video', negative_prompt: 'distorted logo' },
            },
          },
        ],
        placement_specs: [{ placement: 'instagram_feed', aspect_ratio: '1:1' }],
      },
      warnings: [],
    });

    let lastSeenBlueprint = null;
    let lastStrategyRefs = null;
    let lastImageRefs = null;
    let lastEvalRefs = null;

    const prevGenStrategy = agentClient.generateStrategy;
    agentClient.generateStrategy = async (payload) => {
      lastStrategyRefs = payload.reference_image_urls;
      return prevGenStrategy(payload);
    };

    agentClient.generateImages = async ({ blueprint, reference_image_urls }) => {
      lastSeenBlueprint = blueprint;
      lastImageRefs = reference_image_urls;
      return {
        success: true,
        model_identifier: 'gemini-2.5-flash-image',
        prompt_version: 'v1',
        total_estimated_cost_usd: 0.039,
        assets: [
          {
            creative_id: 'cr_kettle_1',
            variation_index: 0,
            approved: true,
            mime_type: 'image/png',
            width: 1080,
            height: 1080,
            aspect_ratio: '1:1',
            object_key: 'campaigns/contract/cr_kettle_1.png',
            prompt_used: blueprint.image_generation_prompt?.positive_prompt || '',
            cost: { estimated_cost_usd: 0.039 },
            validation: { approved: true },
            metadata: { bucket: 'adpilot-creatives' },
          },
        ],
      };
    };

    agentClient.generateVideo = async () => ({
      job_id: 'vidjob_fail_1',
      status: 'FAILED',
      errors: ['Veo quota exhausted'],
      total_estimated_cost_usd: 0,
    });
    agentClient.evaluateCreative = async ({ creative_id, reference_image_urls }) => {
      lastEvalRefs = reference_image_urls;
      return {
        creative_id,
        approved: true,
        overall_weighted_score: 90,
        criteria_scores: [],
      };
    };
    agentClient.generateAdCopy = async () => ({
      headlines: [{ text: 'Fast Boil', linked_claims: [] }],
      primary_texts: [{ text: '1500W glass kettle', linked_claims: [] }],
      descriptions: [{ text: 'Rapid boil' }],
      cta_recommendation: 'Shop Now',
    });

    const createCampRes = await request(app).post('/api/campaigns').send({
      product_url: 'https://www.lifelongindiaonline.com/products/glass-kettle',
      formats: ['image', 'video'],
      placements: ['instagram_feed', 'instagram_reels'],
    });
    assert.strictEqual(createCampRes.statusCode, 201);
    const campaignId = createCampRes.body.data.id;

    // Multi-format campaign MUST fail (not silently report COMPLETED) when requested video generation fails
    await assert.rejects(() => campaignOrchestrator.runCampaign(campaignId, 'tenant_default'));
    const failedCamp = await CampaignRepository.findById(campaignId, 'tenant_default');
    assert.strictEqual(failedCamp.status, 'FAILED');
    // Verify ProductImage objects ({ url, is_primary }) are normalized to URL string arrays for Agent endpoints
    assert.deepStrictEqual(lastStrategyRefs, ['https://cdn.example.com/kettle.jpg']);
    assert.deepStrictEqual(lastImageRefs, ['https://cdn.example.com/kettle.jpg']);

    // Partial image creative preserved cleanly; selective image regeneration must keep GenerationPrompt as object
    const creativesList = await CreativeRepository.findAll({ tenantId: 'tenant_default', campaignId });
    assert.strictEqual(creativesList.items.length, 1);
    const imgId = creativesList.items[0].id;

    const regenRes = await request(app)
      .post(`/api/creatives/${imgId}/regenerate`)
      .send({ creativeInstructions: 'Add warm morning sunrise glow' });
    assert.strictEqual(regenRes.statusCode, 200);
    assert.strictEqual(typeof lastSeenBlueprint.image_generation_prompt, 'object');
    assert.match(lastSeenBlueprint.image_generation_prompt.positive_prompt, /Add warm morning sunrise glow/);
    assert.deepStrictEqual(lastImageRefs, ['https://cdn.example.com/kettle.jpg']);
    assert.deepStrictEqual(lastEvalRefs, ['https://cdn.example.com/kettle.jpg']);
  });

  test('Retry re-extracts degraded Unnamed Product / empty-image cached data and surfaces asset failure causes', async () => {
    const camp = await CampaignRepository.create({
      tenantId: 'tenant_default',
      name: 'Unnamed Product — image',
      productUrl: 'https://www.lifelongindiaonline.com/products/air-purifier',
      userPrompt: '',
      formats: ['image'],
      placements: ['facebook_feed'],
      productData: {
        product_name: 'Unnamed Product',
        brand: 'Lifelong',
        images: [],
      },
    });

    let extractCalled = 0;
    agentClient.extractProduct = async () => {
      extractCalled += 1;
      return {
        success: true,
        data: {
          product_name: 'Lifelong Ecofresh 200 Air Purifier',
          brand: 'Lifelong',
          price: 4999,
          currency: 'INR',
          images: [
            { url: 'https://cdn.example.com/purifier-secondary.jpg', is_primary: false },
            { url: 'https://cdn.example.com/purifier-primary.jpg', is_primary: true },
          ],
        },
        diagnostics: { warnings: [] },
      };
    };

    let strategyRefs = null;
    agentClient.generateStrategy = async (payload) => {
      strategyRefs = payload.reference_image_urls;
      return {
        success: true,
        strategy: {
          ...sampleStrategy,
          recommendations: { primary_cta: 'Explore Purifier' },
        },
        warnings: [],
      };
    };

    agentClient.planCreatives = async () => ({
      success: true,
      plan: {
        plan_id: 'plan_retry_1',
        product_name: 'Lifelong Ecofresh 200 Air Purifier',
        concepts: [
          {
            concept_id: 'img_c1',
            format: 'image',
            creative_title: 'Purifier Studio',
            placement: 'facebook_feed',
            image_blueprint: {
              concept_id: 'img_c1',
              creative_title: 'Purifier Studio',
              hook: 'Breathe Cleaner Air',
              main_message: 'True HEPA H13 filtration',
              aspect_ratio: '1:1',
              placement: 'facebook_feed',
              image_generation_prompt: { positive_prompt: 'Studio purifier', negative_prompt: '' },
            },
          },
        ],
        placement_specs: [{ placement: 'facebook_feed', aspect_ratio: '1:1' }],
      },
      warnings: [],
    });

    agentClient.generateImages = async () => {
      const err = new Error('No product reference image URLs available; image generation requires authentic product visuals.');
      err.statusCode = 422;
      throw err;
    };

    await assert.rejects(
      () => campaignOrchestrator.runCampaign(camp.id, 'tenant_default'),
      /No creative assets could be generated for this campaign: img_c1: No product reference image URLs available/
    );
    assert.strictEqual(extractCalled, 1);
    assert.deepStrictEqual(strategyRefs, [
      'https://cdn.example.com/purifier-primary.jpg',
      'https://cdn.example.com/purifier-secondary.jpg',
    ]);
  });

  test('Orchestrator skips video format cleanly when ENABLE_VIDEO_GENERATION=false', async () => {
    const camp = await CampaignRepository.create({
      tenantId: 'tenant_default',
      productUrl: 'https://www.lifelongindiaonline.com/products/air-purifier',
      userPrompt: 'Clean bedroom studio shots',
      formats: ['image', 'video'],
      placements: ['instagram_feed'],
      name: 'Purifier Campaign',
    });

    env.ENABLE_VIDEO_GENERATION = false;
    let videoCalls = 0;
    let plannedFormats = null;

    agentClient.extractProduct = async () => ({
      success: true,
      data: {
        product_name: 'Lifelong Air Purifier',
        images: [{ url: 'https://cdn.example.com/p1.jpg', is_primary: true }],
      },
      warnings: [],
    });
    agentClient.generateStrategy = async () => ({
      success: true,
      strategy: {
        product_knowledge: { product_category: 'Appliances', verified_features: ['HEPA'] },
        personas: [{ persona_id: 'p1', persona_name: 'Homeowners' }],
        marketing_angles: [{ angle_id: 'a1', angle_name: 'Clean Air' }],
        recommendations: { primary_cta: 'Shop Now' },
      },
      warnings: [],
    });
    agentClient.planCreatives = async (payload) => {
      plannedFormats = payload.formats;
      return {
        success: true,
        plan: {
          plan_id: 'plan_img_only',
          concepts: [
            {
              concept_id: 'img_1',
              format: 'image',
              creative_title: 'HEPA Hero',
              placement: 'instagram_feed',
              image_blueprint: {
                concept_id: 'img_1',
                creative_title: 'HEPA Hero',
                hook: 'Pure Air',
                main_message: 'HEPA filtration',
                aspect_ratio: '4:5',
                placement: 'instagram_feed',
                image_generation_prompt: { positive_prompt: 'Studio purifier', negative_prompt: '' },
              },
            },
          ],
          placement_specs: [{ placement: 'instagram_feed', aspect_ratio: '4:5' }],
        },
        warnings: [],
      };
    };
    agentClient.generateImages = async () => ({
      total_estimated_cost_usd: 0.039,
      warnings: [],
      assets: [
        {
          creative_id: 'cr_img_1',
          approved: true,
          aspect_ratio: '4:5',
          placement: 'instagram_feed',
          object_key: 'k1.png',
          presigned_url: 'http://minio/k1.png',
          metadata: { bucket: 'adpilot-creatives' },
        },
      ],
    });
    agentClient.generateVideo = async () => {
      videoCalls += 1;
      throw new Error('Should not call generateVideo when video generation is disabled');
    };
    agentClient.evaluateCreative = async ({ creative_id }) => ({
      creative_id,
      approved: true,
      overall_weighted_score: 88,
      criteria_scores: [],
    });
    agentClient.generateAdCopy = async () => ({
      headlines: [{ text: 'Pure Air', linked_claims: [] }],
      primary_texts: [{ text: 'Clean home air', linked_claims: [] }],
      descriptions: [{ text: 'HEPA filtration' }],
      cta_recommendation: 'Shop Now',
    });

    await campaignOrchestrator.runCampaign(camp.id, 'tenant_default');
    const updated = await CampaignRepository.findById(camp.id, 'tenant_default');

    assert.strictEqual(updated.status, 'COMPLETED');
    assert.strictEqual(videoCalls, 0);
    assert.deepStrictEqual(plannedFormats, ['image']);
  });
});

