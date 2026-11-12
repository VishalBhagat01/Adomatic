import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import {
  getHealth,
  getLiveness,
  getReadiness,
  getMetricsJson,
  getMetricsPrometheus,
} from './controllers/healthController.js';
import campaignRoutes from './routes/campaignRoutes.js';
import productRoutes from './routes/productRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import creativeRoutes from './routes/creativeRoutes.js';
import metaRoutes from './routes/metaRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import optimizationRoutes from './routes/optimizationRoutes.js';
import apiRoutes from './routes/index.js';

export function createApp() {
  const app = express();

  // Basic security and request parsing (allow cross-origin media rendering)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  const configuredOrigins =
    env.CORS_ORIGIN === '*'
      ? '*'
      : env.CORS_ORIGIN.split(',').map((o) => o.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || configuredOrigins === '*') return callback(null, true);
        if (configuredOrigins.includes(origin)) return callback(null, true);
        if (
          env.NODE_ENV !== 'production' &&
          /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)
        ) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-ID',
        'Idempotency-Key',
        'X-Tenant-ID',
        'X-User-ID',
        'Range',
        'Last-Event-ID',
      ],
      exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Disposition'],
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

  // Direct root health & metrics endpoints
  app.get('/health', getHealth);
  app.get('/health/live', getLiveness);
  app.get('/health/ready', getReadiness);
  app.get('/metrics', getMetricsPrometheus);
  app.get('/api/metrics', getMetricsJson);

  // Studio & Campaign routes mounted under /api
  app.use('/api/campaigns', campaignRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/creatives', creativeRoutes);
  app.use('/api/meta', metaRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/optimization', optimizationRoutes);

  // Versioned API router mounted at /api/v1
  app.use('/api/v1', apiRoutes);

  // 404 & centralized error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
