import { Queue, QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { getRedisClient } from './redisClient.js';
import { logger } from '../utils/logger.js';

export const QUEUES = {
  CREATIVE_GENERATION: 'creative-generation',
  CAMPAIGN_RUN: 'campaign-run',
  ASSET_PROCESSING: 'asset-processing',
};

// Retry & Job Default Options
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: {
    count: 200,
    age: 24 * 3600, // 24 hours
  },
  removeOnFail: {
    count: 500,
    age: 7 * 24 * 3600, // 7 days
  },
};

const activeQueues = new Map();
const activeQueueEvents = new Map();
const deadLetterAudit = [];

export function getQueue(queueName) {
  if (activeQueues.has(queueName)) {
    return activeQueues.get(queueName);
  }

  const connection = getRedisClient();
  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  const events = new QueueEvents(queueName, { connection });

  // Job lifecycle event hooks
  events.on('waiting', ({ jobId }) => {
    logger.debug(`[Queue:${queueName}] Job ${jobId} is waiting in queue`);
  });

  events.on('active', ({ jobId, prev }) => {
    logger.info(`[Queue:${queueName}] Job ${jobId} is active (prev: ${prev})`);
  });

  events.on('completed', ({ jobId, returnvalue }) => {
    logger.info(`[Queue:${queueName}] Job ${jobId} completed successfully`);
  });

  // Failed-job handling and dead-letter audit
  events.on('failed', ({ jobId, failedReason }) => {
    const failureRecord = {
      queueName,
      jobId,
      failedReason,
      timestamp: new Date().toISOString(),
    };
    deadLetterAudit.push(failureRecord);
    // Keep DLQ bounded
    if (deadLetterAudit.length > 500) deadLetterAudit.shift();

    logger.error(`[Queue:${queueName}] Job ${jobId} failed: ${failedReason}`, failureRecord);
  });

  activeQueues.set(queueName, queue);
  activeQueueEvents.set(queueName, events);

  return queue;
}

export function buildJobMetadata({
  tenantId,
  userId,
  taskType,
  payload = {},
  correlationId = null,
  priority = 0,
}) {
  return {
    jobId: randomUUID(),
    correlationId: correlationId || randomUUID(),
    tenantId,
    userId,
    taskType,
    payload,
    priority,
    enqueuedAt: new Date().toISOString(),
  };
}

export async function getJobLifecycle(queueName, jobId) {
  const queue = getQueue(queueName);
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    jobId: job.id,
    name: job.name,
    queue: queueName,
    state, // 'waiting', 'active', 'completed', 'failed', 'delayed', etc.
    progress,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts || DEFAULT_JOB_OPTIONS.attempts,
    enqueuedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    failedReason: job.failedReason || null,
    returnValue: job.returnvalue || null,
    metadata: job.data,
  };
}

export function getFailedJobsAudit(limit = 50) {
  return deadLetterAudit.slice(-limit);
}

export async function closeAllQueues() {
  for (const [name, queue] of activeQueues.entries()) {
    await queue.close();
  }
  for (const [name, events] of activeQueueEvents.entries()) {
    await events.close();
  }
  activeQueues.clear();
  activeQueueEvents.clear();
  logger.info('All queues closed cleanly');
}

