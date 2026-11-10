import crypto from 'node:crypto';
import { CampaignRepository } from '../repositories/campaignRepository.js';
import { CreativeRepository } from '../repositories/creativeRepository.js';
import { CampaignQueue } from '../queues/campaignQueue.js';
import { campaignEvents, CAMPAIGN_EVENTS } from '../events/campaignEvents.js';
import { CAMPAIGN_STATUS, STAGE_PROGRESS } from '../models/Campaign.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class CampaignService {
  /**
   * Derive a deterministic idempotency key if not explicitly supplied by headers.
   */
  static generateIdempotencyKey(tenantId, productUrl, userPrompt) {
    const raw = `${tenantId}:${productUrl.trim()}:${userPrompt.trim().toLowerCase()}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Create and enqueue a new advertising campaign.
   */
  static async createCampaign({
    tenantId,
    userId,
    product_url,
    user_prompt,
    formats,
    placements,
    idempotencyKey = null,
  }) {
    const finalIdempotencyKey =
      idempotencyKey || this.generateIdempotencyKey(tenantId, product_url, user_prompt);

    // 1. Idempotency Check: prevent duplicate campaign execution
    const existing = await CampaignRepository.findByIdempotencyKey(finalIdempotencyKey, tenantId);
    if (existing) {
      logger.info(`Idempotent match found for campaign ${existing.id} (key: ${finalIdempotencyKey})`);
      return {
        campaign: existing,
        isDuplicate: true,
      };
    }

    // 2. Derive a user-friendly name from prompt or URL
    const domain = new URL(product_url).hostname.replace(/^www\./, '');
    const name = `${domain} — ${formats.join('/')} Campaign`;

    // 3. Persist campaign in MongoDB
    const campaign = await CampaignRepository.create({
      tenantId,
      userId,
      productUrl: product_url,
      userPrompt: user_prompt,
      formats,
      placements,
      name,
      idempotencyKey: finalIdempotencyKey,
    });

    campaignEvents.emit(CAMPAIGN_EVENTS.CREATED, { campaignId: campaign.id, tenantId });

    // 4. Transition to QUEUED and Enqueue into Redis BullMQ
    let job = null;
    try {
      await CampaignRepository.updateStage(campaign.id, tenantId, CAMPAIGN_STATUS.QUEUED);
      campaignEvents.emitStageChange(campaign.id, CAMPAIGN_STATUS.INITIALIZED, CAMPAIGN_STATUS.QUEUED);

      job = await CampaignQueue.enqueueCampaign({
        campaignId: campaign.id,
        tenantId,
        userId,
        productUrl: product_url,
        userPrompt: user_prompt,
        formats,
        placements,
        idempotencyKey: finalIdempotencyKey,
      });

      if (job) {
        await CampaignRepository.updateJobId(campaign.id, job.id);
        campaign.jobId = job.id;
      }
    } catch (queueError) {
      // If queue service is unavailable locally, record error but preserve campaign record
      logger.warn(`Could not enqueue campaign ${campaign.id} to Redis: ${queueError.message}`);
    }

    campaign.status = CAMPAIGN_STATUS.QUEUED;
    campaign.progress = STAGE_PROGRESS[CAMPAIGN_STATUS.QUEUED];

    return {
      campaign,
      isDuplicate: false,
    };
  }

  /**
   * Get paginated campaigns.
   */
  static async getCampaigns({ tenantId, page, limit, status, search }) {
    return await CampaignRepository.findPaginated({ tenantId, page, limit, status, search });
  }

  /**
   * Get single campaign by ID.
   */
  static async getCampaignById(id, tenantId) {
    const campaign = await CampaignRepository.findById(id, tenantId);
    if (!campaign) {
      throw new NotFoundError(`Campaign with ID ${id} not found`);
    }
    return campaign;
  }

  /**
   * Get lightweight status and stage progress.
   */
  static async getCampaignStatus(id, tenantId) {
    const campaign = await this.getCampaignById(id, tenantId);
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      currentStage: campaign.currentStage,
      progress: campaign.progress,
      jobId: campaign.jobId || null,
      errorMetadata: campaign.errorMetadata || null,
      stageHistory: campaign.stageHistory || [],
      updatedAt: campaign.updatedAt,
      createdAt: campaign.createdAt,
    };
  }

  /**
   * Get campaign creatives and ad copy.
   */
  static async getCampaignCreatives(id, tenantId) {
    // Verify existence & ownership
    await this.getCampaignById(id, tenantId);
    return await CreativeRepository.findByCampaignId(id, tenantId);
  }

  /**
   * Regenerate a completed or failed campaign.
   */
  static async regenerateCampaign(id, tenantId) {
    const campaign = await this.getCampaignById(id, tenantId);

    // Only allow regeneration if campaign is not already in-flight
    const inFlightStatuses = [
      CAMPAIGN_STATUS.QUEUED,
      CAMPAIGN_STATUS.EXTRACTING_PRODUCT,
      CAMPAIGN_STATUS.ANALYZING_PRODUCT,
      CAMPAIGN_STATUS.GENERATING_STRATEGY,
      CAMPAIGN_STATUS.PLANNING_CREATIVES,
      CAMPAIGN_STATUS.GENERATING_ASSETS,
      CAMPAIGN_STATUS.EVALUATING_CREATIVES,
      CAMPAIGN_STATUS.GENERATING_COPY,
      CAMPAIGN_STATUS.ASSEMBLING_CAMPAIGN,
    ];

    if (inFlightStatuses.includes(campaign.status)) {
      throw new BadRequestError(`Cannot regenerate campaign while in progress (${campaign.status})`);
    }

    const updated = await CampaignRepository.resetForRegeneration(id, tenantId);

    try {
      const job = await CampaignQueue.enqueueCampaign({
        campaignId: updated.id,
        tenantId: updated.tenantId,
        userId: updated.userId,
        productUrl: updated.productUrl,
        userPrompt: updated.userPrompt,
        formats: updated.formats,
        placements: updated.placements,
        idempotencyKey: `regen_${Date.now()}_${updated.id}`,
      });

      if (job) {
        await CampaignRepository.updateJobId(updated.id, job.id);
      }
    } catch (queueError) {
      logger.warn(`Could not re-enqueue campaign ${id}: ${queueError.message}`);
    }

    campaignEvents.emit(CAMPAIGN_EVENTS.REGENERATED, { campaignId: id, tenantId });

    return updated;
  }

  /**
   * Soft-delete a campaign.
   */
  static async deleteCampaign(id, tenantId) {
    const campaign = await this.getCampaignById(id, tenantId);
    const deleted = await CampaignRepository.softDelete(id, tenantId);
    logger.info(`Campaign ${id} soft-deleted by tenant ${tenantId}`);
    return { success: true, message: `Campaign ${id} deleted successfully` };
  }
}

