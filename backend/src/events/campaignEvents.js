import EventEmitter from 'node:events';
import { logger } from '../utils/logger.js';

export const CAMPAIGN_EVENTS = {
  CREATED: 'campaign:created',
  QUEUED: 'campaign:queued',
  STAGE_CHANGED: 'campaign:stage_changed',
  PROGRESS: 'campaign:progress',
  RETRY: 'campaign:retry',
  CREATIVE_GENERATED: 'creative:generated',
  CREATIVE_UPDATED: 'creative:updated',
  COMPLETED: 'campaign:completed',
  FAILED: 'campaign:failed',
  REGENERATED: 'campaign:regenerated',
};

class CampaignEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);

    this.on(CAMPAIGN_EVENTS.STAGE_CHANGED, ({ campaignId, fromStage, toStage }) => {
      logger.info(`Campaign ${campaignId} transitioned from ${fromStage} -> ${toStage}`, {
        campaignId,
        fromStage,
        toStage,
      });
    });

    this.on(CAMPAIGN_EVENTS.FAILED, ({ campaignId, stage, error }) => {
      logger.error(`Campaign ${campaignId} failed during ${stage}: ${error}`, {
        campaignId,
        stage,
        error,
      });
    });
  }

  emitStageChange(campaignId, fromStage, toStage, metadata = {}) {
    this.emit(CAMPAIGN_EVENTS.STAGE_CHANGED, {
      campaignId: String(campaignId),
      fromStage,
      toStage,
      metadata,
      timestamp: new Date().toISOString(),
    });
  }

  emitProgress(campaignId, payload = {}) {
    this.emit(CAMPAIGN_EVENTS.PROGRESS, {
      campaignId: String(campaignId),
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  emitRetry(campaignId, payload = {}) {
    this.emit(CAMPAIGN_EVENTS.RETRY, {
      campaignId: String(campaignId),
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  emitCreativeGenerated(campaignId, creative) {
    this.emit(CAMPAIGN_EVENTS.CREATIVE_GENERATED, {
      campaignId: String(campaignId),
      creative,
      timestamp: new Date().toISOString(),
    });
  }

  emitCreativeUpdated(campaignId, creative) {
    this.emit(CAMPAIGN_EVENTS.CREATIVE_UPDATED, {
      campaignId: String(campaignId),
      creative,
      timestamp: new Date().toISOString(),
    });
  }

  emitCompleted(campaignId, payload = {}) {
    this.emit(CAMPAIGN_EVENTS.COMPLETED, {
      campaignId: String(campaignId),
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  emitFailure(campaignId, stage, error, details = {}) {
    this.emit(CAMPAIGN_EVENTS.FAILED, {
      campaignId: String(campaignId),
      stage,
      error,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}

export const campaignEvents = new CampaignEventEmitter();
