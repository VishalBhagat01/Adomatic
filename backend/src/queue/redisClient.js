import Redis from 'ioredis';
import net from 'node:net';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let redisInstance = null;

function isPortOpen(host, port, timeout = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export function getRedisClient(options = {}) {
  if (redisInstance && redisInstance.status !== 'end') {
    return redisInstance;
  }

  const connectionOptions = {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    connectTimeout: 2000,
    retryStrategy(times) {
      if (env.NODE_ENV === 'test' || times > 3) {
        return null;
      }
      return Math.min(times * 100, 2000);
    },
    lazyConnect: true,
    ...options,
  };

  redisInstance = new Redis(env.REDIS_URL, connectionOptions);

  redisInstance.on('connect', () => {
    logger.info('⚡ Redis connecting...');
  });

  redisInstance.on('ready', () => {
    logger.info('⚡ Redis connection ready and authenticated');
  });

  redisInstance.on('error', (err) => {
    if (env.NODE_ENV !== 'test') {
      logger.error('❌ Redis error:', { error: err.message });
    }
  });

  redisInstance.on('close', () => {
    if (env.NODE_ENV !== 'test') {
      logger.warn('⚠️ Redis connection closed');
    }
  });

  return redisInstance;
}

export async function pingRedis() {
  const isOpen = await isPortOpen(env.REDIS_HOST, env.REDIS_PORT);
  if (!isOpen) {
    return {
      status: 'degraded',
      reachable: false,
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    };
  }

  const client = getRedisClient();
  try {
    if (client.status === 'wait') {
      await client.connect();
    }
    const response = await client.ping();
    return {
      status: response === 'PONG' ? 'ok' : 'degraded',
      reachable: true,
      response,
      statusStr: client.status,
    };
  } catch (error) {
    return {
      status: 'degraded',
      reachable: false,
      error: error.message,
      statusStr: client.status,
    };
  }
}

export async function closeRedis() {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      redisInstance.disconnect();
    }
    redisInstance = null;
  }
}
