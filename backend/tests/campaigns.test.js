import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { CampaignRepository } from '../src/repositories/campaignRepository.js';
import { closeRedis } from '../src/queue/redisClient.js';
import { disconnectDatabase } from '../src/database/connection.js';

describe('Campaign Management API Endpoints', () => {
  const app = createApp();

  beforeEach(() => {
    CampaignRepository.clearMemoryStore();
  });

  after(async () => {
    await closeRedis();
    await disconnectDatabase();
  });

  const validPayload = {
    product_url: 'https://www.lifelongindiaonline.com/products/example',
    user_prompt: 'Create a premium Instagram advertisement targeting young professionals.',
    formats: ['image', 'video'],
    placements: ['instagram_feed', 'instagram_reels'],
  };

  test('POST /api/campaigns rejects invalid inputs and SSRF targets', async () => {
    // 1. SSRF target (localhost)
    const ssrfRes = await request(app)
      .post('/api/campaigns')
      .send({ ...validPayload, product_url: 'http://localhost:5000/internal' });
    assert.strictEqual(ssrfRes.statusCode, 400);
    assert.strictEqual(ssrfRes.body.success, false);

    // 2. Short prompt (< 10 chars)
    const shortPromptRes = await request(app)
      .post('/api/campaigns')
      .send({ ...validPayload, user_prompt: 'Too short' });
    assert.strictEqual(shortPromptRes.statusCode, 400);

    // 3. Empty formats
    const emptyFormatsRes = await request(app)
      .post('/api/campaigns')
      .send({ ...validPayload, formats: [] });
    assert.strictEqual(emptyFormatsRes.statusCode, 400);
  });

  test('POST /api/campaigns creates and queues campaign with initial progress', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .send(validPayload);

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.id);
    assert.strictEqual(res.body.data.status, 'QUEUED');
    assert.strictEqual(res.body.data.progress, 10);
    assert.strictEqual(res.body.isDuplicate, false);
    assert.ok(res.body.data.stageHistory.length >= 1);
  });

  test('POST /api/campaigns prevents duplicate execution via idempotency', async () => {
    // First creation
    const res1 = await request(app)
      .post('/api/campaigns')
      .set('Idempotency-Key', 'unique-client-key-101')
      .send(validPayload);
    assert.strictEqual(res1.statusCode, 201);
    const originalId = res1.body.data.id;

    // Retry with same idempotency key
    const res2 = await request(app)
      .post('/api/campaigns')
      .set('Idempotency-Key', 'unique-client-key-101')
      .send(validPayload);
    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2.body.isDuplicate, true);
    assert.strictEqual(res2.body.data.id, originalId);
  });

  test('GET /api/campaigns returns paginated results', async () => {
    // Create two campaigns
    await request(app).post('/api/campaigns').send(validPayload);
    await request(app).post('/api/campaigns').send({
      ...validPayload,
      product_url: 'https://example.com/shoes/runner-pro',
      user_prompt: 'Target athletes with a high-energy video ad.',
    });

    const res = await request(app).get('/api/campaigns?page=1&limit=10');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.strictEqual(res.body.data.length, 2);
    assert.strictEqual(res.body.pagination.total, 2);
  });

  test('GET /api/campaigns/:id returns specific campaign details', async () => {
    const createRes = await request(app).post('/api/campaigns').send(validPayload);
    const campaignId = createRes.body.data.id;

    const res = await request(app).get(`/api/campaigns/${campaignId}`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.id, campaignId);
    assert.strictEqual(res.body.data.userPrompt, validPayload.user_prompt);

    // Test non-existent ID
    const notFoundRes = await request(app).get('/api/campaigns/673111111111111111111199');
    assert.strictEqual(notFoundRes.statusCode, 404);
  });

  test('GET /api/campaigns/:id/status returns stage-level progress metadata', async () => {
    const createRes = await request(app).post('/api/campaigns').send(validPayload);
    const campaignId = createRes.body.data.id;

    const res = await request(app).get(`/api/campaigns/${campaignId}/status`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.id, campaignId);
    assert.strictEqual(res.body.data.status, 'QUEUED');
    assert.strictEqual(res.body.data.progress, 10);
    assert.ok(Array.isArray(res.body.data.stageHistory));
  });

  test('GET /api/campaigns/:id/creatives returns generated creatives schema', async () => {
    const createRes = await request(app).post('/api/campaigns').send(validPayload);
    const campaignId = createRes.body.data.id;

    const res = await request(app).get(`/api/campaigns/${campaignId}/creatives`);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.data.creatives));
    assert.ok(Array.isArray(res.body.data.adCopies));
    assert.strictEqual(res.body.data.count.creatives, 0);
  });

  test('POST /api/campaigns/:id/regenerate resets and re-queues campaign', async () => {
    const createRes = await request(app).post('/api/campaigns').send(validPayload);
    const campaignId = createRes.body.data.id;

    // Simulate completion
    await CampaignRepository.updateStage(campaignId, 'tenant_default', 'COMPLETED');

    const regenRes = await request(app).post(`/api/campaigns/${campaignId}/regenerate`);
    assert.strictEqual(regenRes.statusCode, 200);
    assert.strictEqual(regenRes.body.data.status, 'QUEUED');
    assert.strictEqual(regenRes.body.data.progress, 10);
  });

  test('DELETE /api/campaigns/:id soft-deletes the campaign', async () => {
    const createRes = await request(app).post('/api/campaigns').send(validPayload);
    const campaignId = createRes.body.data.id;

    const deleteRes = await request(app).delete(`/api/campaigns/${campaignId}`);
    assert.strictEqual(deleteRes.statusCode, 200);
    assert.strictEqual(deleteRes.body.success, true);

    // Subsequent retrieval should return 404
    const getRes = await request(app).get(`/api/campaigns/${campaignId}`);
    assert.strictEqual(getRes.statusCode, 404);
  });
});

