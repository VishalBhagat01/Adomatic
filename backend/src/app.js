import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { getHealth } from './controllers/healthController.js';
import campaignRoutes from './routes/campaignRoutes.js';
import apiRoutes from './routes/index.js';

export function createApp() {
  const app = express();

  // Basic security and request parsing
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key', 'X-Tenant-ID', 'X-User-ID'],
      credentials: true,
    })
  );

  // Payload size constraints
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Structured request logging
  app.use(requestLogger);

  // General rate limiter on all API routes
  app.use('/api', generalLimiter);

  // Direct root health endpoint
  app.get('/health', getHealth);

  // Campaign routes mounted directly at /api/campaigns
  app.use('/api/campaigns', campaignRoutes);

  // Versioned API router mounted at /api/v1
  app.use('/api/v1', apiRoutes);

  // 404 & centralized error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
