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

  _buildHeaders(options = {}) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.correlationId ? { 'X-Correlation-ID': options.correlationId } : {}),
    };
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

  /**
   * Shared JSON POST helper for FastAPI agent endpoints.
   */
  async _postJson(path, body, errorCode, contextLabel, options = {}) {
    const url = `${this.baseUrl}${path}`;
    logger.info(`Requesting ${contextLabel} from Agent: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this._buildHeaders(options),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs || 30000),
      });

      const rawText = await response.text();
      let data = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = { raw: rawText };
        }
      }
      if (!response.ok) {
        let errorMsg = `Agent ${contextLabel} error (HTTP ${response.status})`;
        if (typeof data.detail === 'string') {
          errorMsg = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorMsg = data.detail
            .map((item) => item?.msg || JSON.stringify(item))
            .filter(Boolean)
            .join('; ');
        } else if (data.detail && typeof data.detail === 'object') {
          errorMsg = data.detail.error || data.detail.message || JSON.stringify(data.detail);
        } else if (typeof data.error === 'string') {
          errorMsg = data.error;
        }

        throw new AppError(errorMsg, response.status, errorCode, data);
      }

      return data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error(`Failed to communicate with Agent for ${contextLabel}`, { error: error.message });
      throw new AppError(
        `Agent ${contextLabel} communication error: ${error.message}`,
        503,
        'AGENT_COMMUNICATION_ERROR'
      );
    }
  }

  /**
   * Request product intelligence extraction from the agent service.
   */
  async extractProduct(productUrl, options = {}) {
    return this._postJson(
      '/api/v1/products/extract',
      {
        product_url: productUrl,
        force_js: options.forceJs || false,
      },
      'AGENT_EXTRACTION_ERROR',
      'product extraction',
      options
    );
  }

  /**
   * Request Gemini-powered marketing strategy generation from the agent service.
   */
  async generateStrategy(payload, options = {}) {
    return this._postJson(
      '/api/v1/strategy/generate',
      payload,
      'AGENT_STRATEGY_ERROR',
      'marketing strategy generation',
      { timeoutMs: 60000, ...options }
    );
  }

  /**
   * Request executable image blueprints and video storyboards from the agent service.
   */
  async planCreatives(payload, options = {}) {
    return this._postJson(
      '/api/v1/creative/plan',
      payload,
      'AGENT_CREATIVE_PLAN_ERROR',
      'creative planning',
      { timeoutMs: 60000, ...options }
    );
  }

  /**
   * Request Gemini-powered commercial product image generation from a validated blueprint.
   */
  async generateImages(payload, options = {}) {
    return this._postJson(
      '/api/v1/images/generate',
      payload,
      'AGENT_IMAGE_GEN_ERROR',
      'image generation',
      { timeoutMs: 120000, ...options }
    );
  }

  /**
   * Submit Veo storyboard video generation + FFmpeg assembly job.
   */
  async generateVideo(payload, options = {}) {
    return this._postJson(
      '/api/v1/videos/generate',
      payload,
      'AGENT_VIDEO_GEN_ERROR',
      'video generation',
      { timeoutMs: 120000, ...options }
    );
  }

  /**
   * Retrieve persisted video job progress and artifact manifest.
   */
  async getVideoJobStatus(jobId, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/videos/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: this._buildHeaders(options),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (!response.ok) {
        throw new AppError(
          `Agent video job lookup returned HTTP ${response.status}`,
          response.status >= 500 ? 502 : response.status,
          'AGENT_VIDEO_STATUS_ERROR',
          { status: response.status, response: data }
        );
      }
      return data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(`Agent video job lookup failed: ${err.message}`, 503, 'AGENT_UNAVAILABLE');
    }
  }

  /**
   * Independently evaluate an existing image or video creative without regenerating it.
   */
  async evaluateCreative(payload, options = {}) {
    return this._postJson(
      '/api/v1/evaluations/evaluate',
      payload,
      'AGENT_EVALUATION_ERROR',
      'creative evaluation',
      { timeoutMs: 60000, ...options }
    );
  }

  /**
   * Generate claim-verified advertising copy strictly for an approved creative.
   */
  async generateAdCopy(payload, options = {}) {
    return this._postJson(
      '/api/v1/evaluations/copy',
      payload,
      'AGENT_AD_COPY_ERROR',
      'ad copy generation',
      { timeoutMs: 60000, ...options }
    );
  }

  /**
   * Evaluate a creative, execute bounded prompt-repaired regeneration on failure, and generate copy.
   */
  async evaluateAndRegenerate(payload, options = {}) {
    return this._postJson(
      '/api/v1/evaluations/evaluate-and-regenerate',
      payload,
      'AGENT_EVALUATE_REGENERATE_ERROR',
      'evaluate and regenerate creative',
      { timeoutMs: 240000, ...options }
    );
  }
}

export const agentClient = new AgentClient();

