import { env } from '../../config/env.js';
import { AppError, ForbiddenError, RateLimitError, UnauthorizedError } from '../../utils/errors.js';

function getHeaderCaseInsensitive(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * Parse Meta Graph API rate-limit headers:
 * - x-business-use-case-usage
 * - x-ad-account-usage
 * - x-app-usage
 */
export function parseMetaRateLimitHeaders(headers) {
  let maxUsagePct = 0;
  let estimatedRegainSeconds = 0;
  const details = {};

  const bucRaw = getHeaderCaseInsensitive(headers, 'x-business-use-case-usage');
  if (bucRaw) {
    try {
      const parsed = typeof bucRaw === 'string' ? JSON.parse(bucRaw) : bucRaw;
      details.businessUseCaseUsage = parsed;
      for (const entries of Object.values(parsed)) {
        const arr = Array.isArray(entries) ? entries : [entries];
        for (const item of arr) {
          const peak = Math.max(
            Number(item?.call_count || 0),
            Number(item?.total_cputime || 0),
            Number(item?.total_time || 0)
          );
          if (peak > maxUsagePct) maxUsagePct = peak;
          const regain = Number(item?.estimated_time_to_regain_access || 0);
          if (regain > estimatedRegainSeconds) estimatedRegainSeconds = regain;
        }
      }
    } catch {
      // Ignore malformed usage JSON header cleanly
    }
  }

  const adAcctRaw = getHeaderCaseInsensitive(headers, 'x-ad-account-usage');
  if (adAcctRaw) {
    try {
      const parsed = typeof adAcctRaw === 'string' ? JSON.parse(adAcctRaw) : adAcctRaw;
      details.adAccountUsage = parsed;
      const pct = Number(parsed?.acc_id_util_pct || 0);
      if (pct > maxUsagePct) maxUsagePct = pct;
    } catch {
      // Ignore malformed JSON
    }
  }

  const appUsageRaw = getHeaderCaseInsensitive(headers, 'x-app-usage');
  if (appUsageRaw) {
    try {
      const parsed = typeof appUsageRaw === 'string' ? JSON.parse(appUsageRaw) : appUsageRaw;
      details.appUsage = parsed;
      const peak = Math.max(
        Number(parsed?.call_count || 0),
        Number(parsed?.total_cputime || 0),
        Number(parsed?.total_time || 0)
      );
      if (peak > maxUsagePct) maxUsagePct = peak;
    } catch {
      // Ignore malformed JSON
    }
  }

  return {
    maxUsagePct,
    estimatedRegainSeconds,
    details,
  };
}

/**
 * Translate Graph API error payloads into safe domain errors without exposing tokens.
 */
export function classifyMetaApiError(statusCode, payload, rateInfo = {}) {
  const errObj = payload?.error || {};
  const code = Number(errObj.code || 0);
  const subcode = Number(errObj.error_subcode || 0);
  const msg = errObj.error_user_msg || errObj.message || `Meta Graph API failed with HTTP ${statusCode}`;

  // Error 190 = Invalid / expired OAuth token
  if (code === 190 || statusCode === 401) {
    return new UnauthorizedError(`Meta access token is invalid or expired: ${msg}`, {
      metaCode: code,
      metaSubcode: subcode,
      fbtraceId: errObj.fbtrace_id || null,
    });
  }

  // Permission / role / asset authorization errors
  if ([10, 200, 294, 275].includes(code) || statusCode === 403) {
    return new ForbiddenError(`Meta permission or ad account access denied: ${msg}`, {
      metaCode: code,
      metaSubcode: subcode,
      fbtraceId: errObj.fbtrace_id || null,
    });
  }

  // Rate limit errors: 4 (app), 17 (user), 32 (page), 613 (calls limit), 80004 (ad account throttle)
  if ([4, 17, 32, 613, 80000, 80004].includes(code) || statusCode === 429) {
    const retryAfterSeconds = Math.max(rateInfo.estimatedRegainSeconds || 0, 5);
    return new RateLimitError(`Meta Marketing API rate limit reached: ${msg}`, {
      metaCode: code,
      metaSubcode: subcode,
      retryAfterSeconds,
      rateLimitPct: rateInfo.maxUsagePct || 100,
    });
  }

  return new AppError(msg, statusCode >= 500 ? 502 : statusCode || 400, 'META_API_ERROR', {
    metaCode: code || null,
    metaSubcode: subcode || null,
    fbtraceId: errObj.fbtrace_id || null,
  });
}

export class MetaRateLimitTracker {
  constructor(pauseThreshold = env.META_RATE_LIMIT_PAUSE_THRESHOLD) {
    this.pauseThreshold = pauseThreshold;
    this.buckets = new Map();
  }

  record(scopeKey, headers) {
    const parsed = parseMetaRateLimitHeaders(headers);
    const key = scopeKey || 'global';
    const existing = this.buckets.get(key) || { peakPct: 0, lastPct: 0, regainUntilMs: 0 };
    const nextRegain =
      parsed.estimatedRegainSeconds > 0
        ? Date.now() + parsed.estimatedRegainSeconds * 1000
        : existing.regainUntilMs;

    this.buckets.set(key, {
      lastPct: parsed.maxUsagePct,
      peakPct: Math.max(existing.peakPct, parsed.maxUsagePct),
      regainUntilMs: nextRegain,
      updatedAt: Date.now(),
    });
    return parsed;
  }

  getPeakPct(scopeKey = null) {
    if (scopeKey && this.buckets.has(scopeKey)) {
      return this.buckets.get(scopeKey).peakPct;
    }
    let overall = 0;
    for (const v of this.buckets.values()) {
      if (v.peakPct > overall) overall = v.peakPct;
    }
    return overall;
  }

  getRecommendedDelayMs(scopeKey = 'global') {
    const state = this.buckets.get(scopeKey);
    if (!state) return 0;

    const now = Date.now();
    if (state.regainUntilMs > now) {
      return Math.min(state.regainUntilMs - now, 60000);
    }
    if (state.lastPct >= this.pauseThreshold) {
      // Proactive proportional slowdown before triggering hard error code 17/80004
      return Math.min(2000, Math.round((state.lastPct - this.pauseThreshold + 10) * 50));
    }
    return 0;
  }
}

