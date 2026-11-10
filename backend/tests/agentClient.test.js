import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  agentClient,
  agentWorkflowRequestSchema,
  agentWorkflowResponseSchema,
} from '../src/services/agentClient.js';

describe('AI Agent Communication Client Invariants', () => {
  test('agentWorkflowRequestSchema validates required campaign execution payload', () => {
    const validPayload = {
      campaign_id: '673111111111111111111111',
      tenant_id: 'tenant_default',
      product_url: 'https://example.com/product/123',
      user_prompt: 'Generate an energetic TikTok video ad',
      formats: ['video'],
      placements: ['tiktok_infeed'],
      correlation_id: 'corr_test_123',
    };

    const parsed = agentWorkflowRequestSchema.safeParse(validPayload);
    assert.strictEqual(parsed.success, true);
  });

  test('agentWorkflowRequestSchema rejects missing mandatory fields or invalid format', () => {
    const invalidPayload = {
      campaign_id: '123',
      product_url: 'not-a-valid-url',
      formats: ['audio'], // invalid enum
    };

    const parsed = agentWorkflowRequestSchema.safeParse(invalidPayload);
    assert.strictEqual(parsed.success, false);
    assert.ok(parsed.error.errors.length > 0);
  });

  test('agentWorkflowResponseSchema validates expected agent response structures', () => {
    const validResponse = {
      status: 'ok',
      workflow_id: 'wf_999',
      stage: 'ANALYZING_PRODUCT',
      data: { confidence: 0.95 },
    };

    const parsed = agentWorkflowResponseSchema.safeParse(validResponse);
    assert.strictEqual(parsed.success, true);
  });

  test('checkHealth method handles connection failures gracefully without throwing unhandled exceptions', async () => {
    const health = await agentClient.checkHealth();
    assert.ok(['ok', 'degraded'].includes(health.status));
  });
});

