import { QUEUES, getQueue, buildJobMetadata, getJobLifecycle } from '../queue/queueManager.js';
import { logger } from '../utils/logger.js';

export class CampaignQueue {
  static getQueueInstance() {
    return getQueue(QUEUES.CAMPAIGN_RUN);
  }

  /**
   * Enqueue campaign execution job with idempotency and retry policy.
   */
  static async enqueueCampaign({
    campaignId,
    tenantId,
    userId,
    productUrl,
    userPrompt,
    formats,
    placements,
    idempotencyKey,
  }) {
    const queue = this.getQueueInstance();

    // Use deterministic jobId to prevent duplicate queueing of the same campaign execution
    const jobId = `campaign_${campaignId}`;

    const metadata = buildJobMetadata({
      tenantId,
      userId,
      taskType: 'campaign_orchestration',
      payload: {
        campaignId,
        productUrl,
        userPrompt,
        formats,
        placements,
        idempotencyKey,
      },
      correlationId: `corr_${campaignId}`,
      priority: 1,
    });

    try {
      const job = await queue.add('orchestrate_campaign', metadata, {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      });

      logger.info(`Campaign ${campaignId} enqueued in BullMQ job: ${job.id}`, {
        jobId: job.id,
        campaignId,
      });

      return job;
    } catch (error) {
      logger.error(`Failed to enqueue campaign ${campaignId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Track job execution status in Redis.
   */
  static async getJobStatus(jobId) {
    return await getJobLifecycle(QUEUES.CAMPAIGN_RUN, jobId);
  }
}

