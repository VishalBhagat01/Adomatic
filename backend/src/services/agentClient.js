import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

// Validated request contract to Agent
export const agentWorkflowRequestSchema = z.object({
  campaign_id: z.string(),
  tenant_id: z.string(),
  product_url: z.string().url(),
  user_prompt: z.string(),
  formats: z.array(z.enum(['image', 'video'])),
  placements: z.array(z.string()),
  correlation_id: z.string(),
});

// Validated response contract from Agent
export const agentWorkflowResponseSchema = z.object({
  status: z.string(),
  workflow_id: z.string().optional(),
  message: z.string().optional(),
  stage: z.string().optional(),
  data: z.record(z.any()).optional(),
});

export class AgentClient {
  constructor(baseUrl = env.AGENT_SERVICE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Health probe to FastAPI agent runtime.
   */
  async checkHealth() {
    const url = `${this.baseUrl}/health`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        throw new Error(`Agent health probe failed with HTTP ${response.status}`);
      }

      const data = await response.json();
      return { status: 'ok', data };
    } catch (error) {
      return { status: 'degraded', error: error.message };
    }
  }

  /**
   * Dispatch campaign creative generation task to the FastAPI agent.
   */
  async dispatchWorkflow(payload) {
    // 1. Validate outgoing request contract
    const validatedRequest = agentWorkflowRequestSchema.safeParse(payload);
    if (!validatedRequest.success) {
      throw new AppError(
        'Agent client request contract validation failed',
        400,
        'AGENT_CONTRACT_ERROR',
        validatedRequest.error.errors
      );
    }

    const url = `${this.baseUrl}/api/v1/orchestrate`;
    logger.info(`Dispatching workflow to Agent: ${url}`, {
      campaignId: payload.campaign_id,
      correlationId: payload.correlation_id,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Correlation-ID': payload.correlation_id,
        },
        body: JSON.stringify(validatedRequest.data),
        signal: AbortSignal.timeout(10000),
      });

      const responseText = await response.text();
      let responseJson;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        throw new AppError(
          `Agent service returned non-JSON response (HTTP ${response.status})`,
          502,
          'AGENT_INVALID_RESPONSE'
        );
      }

      if (!response.ok) {
        throw new AppError(
          responseJson.message || `Agent service error: HTTP ${response.status}`,
          response.status >= 500 ? 502 : response.status,
          'AGENT_SERVICE_ERROR',
          responseJson
        );
      }

      // 2. Validate incoming response contract
      const validatedResponse = agentWorkflowResponseSchema.safeParse(responseJson);
      if (!validatedResponse.success) {
        logger.warn('Agent response contract validation warnings', {
          errors: validatedResponse.error.errors,
        });
      }

      return responseJson;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to communicate with Agent service', { error: error.message });
      throw new AppError(
        `Agent service communication error: ${error.message}`,
        503,
        'AGENT_COMMUNICATION_ERROR'
      );
    }
  }
}

export const agentClient = new AgentClient();

