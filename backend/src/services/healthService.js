import process from 'node:process';
import { env } from '../config/env.js';
import { getDatabaseHealth } from '../database/connection.js';
import { pingRedis } from '../queue/redisClient.js';
import { storageService } from './storageService.js';

export class HealthService {
  static async getHealthStatus() {
    const memory = process.memoryUsage();

    const [dbHealth, redisHealth, storageHealth] = await Promise.allSettled([
      Promise.resolve(getDatabaseHealth()),
      pingRedis(),
      storageService.getStorageHealth(),
    ]);

    const database = dbHealth.status === 'fulfilled' ? dbHealth.value : { status: 'error', error: dbHealth.reason?.message };
    const redis = redisHealth.status === 'fulfilled' ? redisHealth.value : { status: 'error', error: redisHealth.reason?.message };
    const storage = storageHealth.status === 'fulfilled' ? storageHealth.value : { status: 'error', error: storageHealth.reason?.message };

    const isHealthy = database.status !== 'error' && redis.status !== 'error';

    return {
      status: isHealthy ? 'ok' : 'degraded',
      service: 'adpilot-backend',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memory: {
        rssMb: Number((memory.rss / (1024 * 1024)).toFixed(2)),
        heapTotalMb: Number((memory.heapTotal / (1024 * 1024)).toFixed(2)),
        heapUsedMb: Number((memory.heapUsed / (1024 * 1024)).toFixed(2)),
      },
      infrastructure: {
        database,
        cache_and_queue: redis,
        storage,
      },
      dependencies: {
        agentService: {
          configuredUrl: env.AGENT_SERVICE_URL,
        },
      },
      features: {
        videoGeneration: env.ENABLE_VIDEO_GENERATION,
        imageOnlyMode: !env.ENABLE_VIDEO_GENERATION,
      },
    };
  }

  static getLivenessStatus() {
    return {
      status: 'alive',
      service: 'adpilot-backend',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  static async getReadinessStatus() {
    const full = await this.getHealthStatus();
    const dbReady = full.infrastructure.database.status !== 'error';
    const redisReady = full.infrastructure.cache_and_queue.status !== 'error';
    const ready = dbReady && redisReady;
    return {
      ready,
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database: full.infrastructure.database.status,
        redis: full.infrastructure.cache_and_queue.status,
        storage: full.infrastructure.storage.status,
      },
      timestamp: full.timestamp,
    };
  }
}
