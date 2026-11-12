import { logger } from '../utils/logger.js';

const MAX_RECENT_ERRORS = 50;

class MetricsRegistry {
  constructor() {
    this.startedAt = Date.now();
    this.http = {
      requestsTotal: 0,
      status2xx: 0,
      status4xx: 0,
      status5xx: 0,
      totalLatencyMs: 0,
    };
    this.campaigns = {
      executed: 0,
      completed: 0,
      failed: 0,
      recoveredFromStall: 0,
      estimatedAiCostUsd: 0,
    };
    this.recentErrors = [];
    this.errorReporters = [];
  }

  registerErrorReporter(fn) {
    if (typeof fn === 'function') {
      this.errorReporters.push(fn);
    }
  }

  recordHttpRequest({ method, url, statusCode, durationMs }) {
    this.http.requestsTotal += 1;
    this.http.totalLatencyMs += Number(durationMs || 0);
    if (statusCode >= 500) this.http.status5xx += 1;
    else if (statusCode >= 400) this.http.status4xx += 1;
    else if (statusCode >= 200) this.http.status2xx += 1;
    void method;
    void url;
  }

  recordCampaignOutcome({ succeeded, costUsd = 0 }) {
    this.campaigns.executed += 1;
    if (succeeded) this.campaigns.completed += 1;
    else this.campaigns.failed += 1;
    this.campaigns.estimatedAiCostUsd = Number(
      (this.campaigns.estimatedAiCostUsd + Number(costUsd || 0)).toFixed(4)
    );
  }

  recordWorkerRecovery(count = 1) {
    this.campaigns.recoveredFromStall += Number(count || 0);
  }

  reportError(err, context = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      name: err?.name || 'Error',
      code: err?.code || 'INTERNAL_ERROR',
      message: err?.message || 'Unknown error',
      requestId: context.requestId || null,
      statusCode: context.statusCode || 500,
    };
    this.recentErrors.unshift(entry);
    if (this.recentErrors.length > MAX_RECENT_ERRORS) {
      this.recentErrors.length = MAX_RECENT_ERRORS;
    }

    for (const reporter of this.errorReporters) {
      try {
        reporter(err, entry);
      } catch (hookErr) {
        logger.warn(`External error reporter hook failed: ${hookErr.message}`);
      }
    }
  }

  getSnapshot() {
    const avgLatencyMs =
      this.http.requestsTotal > 0
        ? Number((this.http.totalLatencyMs / this.http.requestsTotal).toFixed(2))
        : 0;

    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      http: {
        ...this.http,
        avgLatencyMs,
      },
      campaigns: { ...this.campaigns },
      recentErrorCount: this.recentErrors.length,
      recentErrors: this.recentErrors.slice(0, 10),
    };
  }

  formatPrometheus() {
    const snap = this.getSnapshot();
    const lines = [
      '# HELP adpilot_uptime_seconds Process uptime in seconds',
      '# TYPE adpilot_uptime_seconds gauge',
      `adpilot_uptime_seconds ${snap.uptimeSeconds}`,
      '# HELP adpilot_http_requests_total Total HTTP requests handled',
      '# TYPE adpilot_http_requests_total counter',
      `adpilot_http_requests_total ${snap.http.requestsTotal}`,
      '# HELP adpilot_http_requests_5xx_total Total HTTP 5xx responses',
      '# TYPE adpilot_http_requests_5xx_total counter',
      `adpilot_http_requests_5xx_total ${snap.http.status5xx}`,
      '# HELP adpilot_http_avg_latency_ms Average HTTP request duration in ms',
      '# TYPE adpilot_http_avg_latency_ms gauge',
      `adpilot_http_avg_latency_ms ${snap.http.avgLatencyMs}`,
      '# HELP adpilot_campaigns_completed_total Total completed campaigns',
      '# TYPE adpilot_campaigns_completed_total counter',
      `adpilot_campaigns_completed_total ${snap.campaigns.completed}`,
      '# HELP adpilot_campaigns_failed_total Total failed campaigns',
      '# TYPE adpilot_campaigns_failed_total counter',
      `adpilot_campaigns_failed_total ${snap.campaigns.failed}`,
      '# HELP adpilot_worker_stalls_recovered_total Total stalled campaigns recovered',
      '# TYPE adpilot_worker_stalls_recovered_total counter',
      `adpilot_worker_stalls_recovered_total ${snap.campaigns.recoveredFromStall}`,
      '# HELP adpilot_ai_estimated_cost_usd Cumulative estimated AI generation cost in USD',
      '# TYPE adpilot_ai_estimated_cost_usd counter',
      `adpilot_ai_estimated_cost_usd ${snap.campaigns.estimatedAiCostUsd}`,
    ];
    return `${lines.join('\n')}\n`;
  }

  reset() {
    this.http = { requestsTotal: 0, status2xx: 0, status4xx: 0, status5xx: 0, totalLatencyMs: 0 };
    this.campaigns = { executed: 0, completed: 0, failed: 0, recoveredFromStall: 0, estimatedAiCostUsd: 0 };
    this.recentErrors = [];
  }
}

export const metricsService = new MetricsRegistry();

