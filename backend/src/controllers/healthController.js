import { HealthService } from '../services/healthService.js';

export async function getHealth(req, res, next) {
  try {
    const healthData = await HealthService.getHealthStatus();
    const statusCode = healthData.status === 'ok' ? 200 : 200; // Return 200 with degraded details for observability
    return res.status(statusCode).json({
      success: true,
      data: healthData,
    });
  } catch (err) {
    next(err);
  }
}
