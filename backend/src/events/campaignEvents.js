import EventEmitter from 'node:events';
import { logger } from '../utils/logger.js';

export const CAMPAIGN_EVENTS = {
  CREATED: 'campaign:created',
  QUEUED: 'campaign:queued',
  STAGE_CHANGED: 'campaign:stage_changed',
  COMPLETED: 'campaign:completed',
  FAILED: 'campaign:failed',
  REGENERATED: 'campaign:regenerated',
};

class CampaignEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(30);

    // Default structured logging listener
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
    this.emit(CAMPAIGN_EVENTS.STAGE_CHANGED, { campaignId, fromStage, toStage, metadata });
  }

  emitFailure(campaignId, stage, error, details = {}) {
    this.emit(CAMPAIGN_EVENTS.FAILED, { campaignId, stage, error, details });
  }
}

export const campaignEvents = new CampaignEventEmitter();

