import { env } from '../config/env.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { metricsService } from '../services/metricsService.js';

export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_SERVER_ERROR';
  const message = isAppError ? err.message : (env.NODE_ENV === 'production' ? 'Internal server error' : err.message);

  const errorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(err.details ? { details: err.details } : {}),
      requestId: req.id,
      timestamp: new Date().toISOString(),
    },
  };

  if (env.NODE_ENV !== 'production' && !isAppError) {
    errorResponse.error.stack = err.stack;
  }

  logger.error(`Error handling request: ${err.message}`, {
    requestId: req.id,
    statusCode,
    code,
    stack: err.stack,
  });

  if (statusCode >= 500 || !isAppError) {
    metricsService.reportError(err, { requestId: req.id, statusCode });
  }

  res.status(statusCode).json(errorResponse);
}

