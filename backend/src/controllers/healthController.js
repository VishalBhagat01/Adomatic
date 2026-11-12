import { HealthService } from '../services/healthService.js';
import { agentClient } from '../services/agentClient.js';
import { metricsService } from '../services/metricsService.js';

export async function getHealth(req, res, next) {
  try {
    const healthData = await HealthService.getHealthStatus();
    return res.status(200).json({
      success: true,
      data: healthData,
    });
  } catch (err) {
    next(err);
  }
}

export async function getLiveness(req, res) {
  return res.status(200).json({
    success: true,
    data: HealthService.getLivenessStatus(),
  });
}

export async function getReadiness(req, res, next) {
  try {
    const readiness = await HealthService.getReadinessStatus();
    const statusCode = readiness.ready || process.env.NODE_ENV !== 'production' ? 200 : 503;
    return res.status(statusCode).json({
      success: true,
      data: readiness,
    });
  } catch (err) {
    next(err);
  }
}

export async function getMetricsJson(req, res) {
  return res.status(200).json({
    success: true,
    data: metricsService.getSnapshot(),
  });
}

export async function getMetricsPrometheus(req, res) {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return res.status(200).send(metricsService.formatPrometheus());
}

export async function getAgentHealth(req, res, next) {
  try {
    const result = await agentClient.checkHealth();
    return res.status(200).json({
      success: true,
      data: {
        online: result.status === 'ok',
        ...result,
      },
    });
  } catch (err) {
    next(err);
  }
}
