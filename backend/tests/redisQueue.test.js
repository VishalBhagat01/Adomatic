import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  QUEUES,
  DEFAULT_JOB_OPTIONS,
  buildJobMetadata,
  getFailedJobsAudit,
} from '../src/queue/queueManager.js';

describe('Redis & Queue Infrastructure Invariants', () => {
  test('Standard retry configuration enforces exponential backoff and pruning', () => {
    assert.strictEqual(DEFAULT_JOB_OPTIONS.attempts, 3, 'Default attempts must be 3');
    assert.strictEqual(DEFAULT_JOB_OPTIONS.backoff.type, 'exponential');
    assert.strictEqual(DEFAULT_JOB_OPTIONS.backoff.delay, 2000);
    assert.ok(DEFAULT_JOB_OPTIONS.removeOnComplete.age > 0);
    assert.ok(DEFAULT_JOB_OPTIONS.removeOnFail.age > 0);
  });

  test('buildJobMetadata generates valid metadata payload with correlation IDs', () => {
    const meta = buildJobMetadata({
      tenantId: 'tenant_abc',
      userId: 'user_123',
      taskType: 'generate_creative',
      payload: { prompt: 'Luxury watch banner' },
      priority: 5,
    });

    assert.ok(meta.jobId, 'jobId must be present');
    assert.ok(meta.correlationId, 'correlationId must be generated');
    assert.strictEqual(meta.tenantId, 'tenant_abc');
    assert.strictEqual(meta.userId, 'user_123');
    assert.strictEqual(meta.taskType, 'generate_creative');
    assert.strictEqual(meta.priority, 5);
    assert.ok(meta.enqueuedAt, 'enqueuedAt timestamp must be recorded');
  });

  test('Named queues cover all core platform asynchronous workflows', () => {
    assert.strictEqual(QUEUES.CREATIVE_GENERATION, 'creative-generation');
    assert.strictEqual(QUEUES.CAMPAIGN_RUN, 'campaign-run');
    assert.strictEqual(QUEUES.ASSET_PROCESSING, 'asset-processing');
  });

  test('Failed jobs audit log operates bounded buffer', () => {
    const audit = getFailedJobsAudit(10);
    assert.ok(Array.isArray(audit));
  });
});

