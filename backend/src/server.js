import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './database/connection.js';
import { closeRedis } from './queue/redisClient.js';
import { closeAllQueues } from './queue/queueManager.js';
import { storageService } from './services/storageService.js';

const app = createApp();

// Asynchronous background infrastructure initialization
(async () => {
  try {
    await connectDatabase();
    await storageService.ensureBucketsExist();
  } catch (err) {
    logger.warn(`Infrastructure deferred connection: ${err.message}`);
  }
})();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 AdPilot Backend service started successfully on port ${env.PORT}`, {
    port: env.PORT,
    environment: env.NODE_ENV,
    healthEndpoint: `http://localhost:${env.PORT}/health`,
    campaignsEndpoint: `http://localhost:${env.PORT}/api/campaigns`,
  });
});

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await closeAllQueues();
      await closeRedis();
      await disconnectDatabase();
      logger.info('All database and queue connections closed. Exiting process.');
    } catch (e) {
      logger.error(`Error during graceful shutdown: ${e.message}`);
    }
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
