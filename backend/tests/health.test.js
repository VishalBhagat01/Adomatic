import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeRedis } from '../src/queue/redisClient.js';
import { disconnectDatabase } from '../src/database/connection.js';

describe('Backend Smoke Tests', () => {
  const app = createApp();

  after(async () => {
    await closeRedis();
    await disconnectDatabase();
  });

  test('GET /health returns 200 with structured infrastructure metadata', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(['ok', 'degraded'].includes(res.body.data.status));
    assert.strictEqual(res.body.data.service, 'adpilot-backend');
    assert.ok(res.body.data.infrastructure, 'infrastructure breakdown must be present');
    assert.ok(res.body.data.infrastructure.database);
    assert.ok(res.body.data.infrastructure.cache_and_queue);
    assert.ok(res.body.data.infrastructure.storage);
    assert.ok(res.body.data.uptimeSeconds >= 0);
    assert.ok(res.body.data.memory.heapUsedMb > 0);
  });

  test('GET /api/v1/health returns 200 with status', async () => {
    const res = await request(app).get('/api/v1/health');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(['ok', 'degraded'].includes(res.body.data.status));
  });

  test('GET /non-existent-route returns 404 with structured error', async () => {
    const res = await request(app).get('/non-existent-route');
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    assert.ok(res.body.error.message.includes('not found'));
  });
});
