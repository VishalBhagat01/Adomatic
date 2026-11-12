const isViteLocal =
  typeof window !== 'undefined' && ['5173', '4173'].includes(window.location.port);
const API_BASE = isViteLocal
  ? ''
  : (import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status = 500, code = 'API_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getAuthContext() {
  try {
    const raw = localStorage.getItem('adpilot.identity');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        tenantId: parsed.tenantId || 'tenant_default',
        userId: parsed.userId || '',
      };
    }
  } catch {
    // Ignore storage read errors in restricted environments
  }
  return { tenantId: 'tenant_default', userId: '' };
}

export function resolveApiUrl(path) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${clean}`;
}

async function requestJson(path, options = {}) {
  const identity = getAuthContext();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');
  headers.set('X-Tenant-ID', identity.tenantId);
  if (identity.userId) {
    headers.set('X-User-ID', identity.userId);
  }

  let response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...options,
      headers,
    });
  } catch (networkErr) {
    throw new ApiError(
      `Network error contacting backend API (${networkErr.message})`,
      0,
      'NETWORK_ERROR'
    );
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok || payload?.success === false) {
    const errMsg =
      payload?.error?.message ||
      payload?.message ||
      payload?.data?.error ||
      `Request failed with HTTP ${response.status}`;
    const errCode = payload?.error?.code || 'HTTP_ERROR';
    const errDetails = payload?.error?.details || payload?.errors || null;
    throw new ApiError(errMsg, response.status, errCode, errDetails);
  }

  return payload;
}

export async function checkBackendHealth() {
  const start = performance.now();
  try {
    const res = await fetch(resolveApiUrl('/health'), { method: 'GET' });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      online: true,
      service: 'backend',
      latencyMs,
      details: data.data || data,
    };
  } catch (err) {
    return {
      online: false,
      service: 'backend',
      latencyMs: Math.round(performance.now() - start),
      error: err.message,
    };
  }
}

export async function checkAgentHealth() {
  const start = performance.now();
  const endpoint = resolveApiUrl('/api/v1/agent-health');
  try {
    const res = await fetch(endpoint, { method: 'GET' });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const details = payload?.data || payload;
    const online = details?.online ?? details?.status === 'ok';
    return {
      online: Boolean(online),
      service: 'agent',
      latencyMs,
      details,
    };
  } catch (err) {
    return {
      online: false,
      service: 'agent',
      latencyMs: Math.round(performance.now() - start),
      error: err.message,
    };
  }
}

export const dashboardApi = {
  getSummary: () => requestJson('/api/dashboard/summary'),
};

export const productApi = {
  preview: (product_url, force_js = false) =>
    requestJson('/api/products/preview', {
      method: 'POST',
      body: JSON.stringify({ product_url, force_js }),
    }),
};

export const campaignApi = {
  list: ({ page = 1, limit = 20, status = '', search = '' } = {}) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    return requestJson(`/api/campaigns?${params.toString()}`);
  },
  get: (id) => requestJson(`/api/campaigns/${encodeURIComponent(id)}`),
  getStatus: (id) => requestJson(`/api/campaigns/${encodeURIComponent(id)}/status`),
  getDetails: (id) => requestJson(`/api/campaigns/${encodeURIComponent(id)}/details`),
  getCreatives: (id) => requestJson(`/api/campaigns/${encodeURIComponent(id)}/creatives`),
  create: (body, idempotencyKey = null) =>
    requestJson('/api/campaigns', {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      body: JSON.stringify(body),
    }),
  regenerate: (id) =>
    requestJson(`/api/campaigns/${encodeURIComponent(id)}/regenerate`, {
      method: 'POST',
    }),
  remove: (id) =>
    requestJson(`/api/campaigns/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  subscribeEvents: (id, handlers = {}) => {
    const url = resolveApiUrl(`/api/campaigns/${encodeURIComponent(id)}/events`);
    const source = new EventSource(url);

    const bind = (eventName, fn) => {
      if (!fn) return;
      source.addEventListener(eventName, (event) => {
        try {
          fn(JSON.parse(event.data));
        } catch {
          fn({ raw: event.data });
        }
      });
    };

    bind('snapshot', handlers.onSnapshot);
    bind('stage_changed', handlers.onStageChanged);
    bind('progress', handlers.onProgress);
    bind('retry', handlers.onRetry);
    bind('creative_generated', handlers.onCreativeGenerated);
    bind('completed', handlers.onCompleted);
    bind('failed', handlers.onFailed);

    if (handlers.onOpen) {
      source.onopen = handlers.onOpen;
    }
    if (handlers.onError) {
      source.onerror = handlers.onError;
    }

    return () => {
      source.close();
    };
  },
};

export const creativeApi = {
  list: ({ page = 1, limit = 50, assetType = '', approved = '', campaignId = '', placement = '' } = {}) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (assetType) params.set('assetType', assetType);
    if (approved !== '') params.set('approved', String(approved));
    if (campaignId) params.set('campaignId', campaignId);
    if (placement) params.set('placement', placement);
    return requestJson(`/api/creatives?${params.toString()}`);
  },
  get: (creativeId) => requestJson(`/api/creatives/${encodeURIComponent(creativeId)}`),
  update: (creativeId, patch) =>
    requestJson(`/api/creatives/${encodeURIComponent(creativeId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  regenerate: (creativeId, overrides = {}) =>
    requestJson(`/api/creatives/${encodeURIComponent(creativeId)}/regenerate`, {
      method: 'POST',
      body: JSON.stringify(overrides),
    }),
  getDownloadUrl: (creativeId) =>
    requestJson(`/api/creatives/${encodeURIComponent(creativeId)}/download-url`),
  mediaSrc: (creativeId, { download = false, cacheBust = '' } = {}) => {
    const params = new URLSearchParams();
    if (download) params.set('download', '1');
    if (cacheBust) params.set('v', String(cacheBust));
    const qs = params.toString();
    return resolveApiUrl(`/api/creatives/${encodeURIComponent(creativeId)}/media${qs ? `?${qs}` : ''}`);
  },
};

function buildQuery(paramsObj = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const metaApi = {
  getStatus: (refresh = false) =>
    requestJson(`/api/meta/status${refresh ? '?refresh=true' : ''}`),
  startOAuth: (includeWriteScope = false) =>
    requestJson(`/api/meta/oauth/start?include_write_scope=${includeWriteScope ? 'true' : 'false'}`),
  connectToken: ({ access_token, connection_type = 'system_user', primary_ad_account_id }) =>
    requestJson('/api/meta/connect/token', {
      method: 'POST',
      body: JSON.stringify({
        access_token,
        connection_type,
        ...(primary_ad_account_id ? { primary_ad_account_id } : {}),
      }),
    }),
  selectAdAccount: (adAccountId) =>
    requestJson('/api/meta/ad-account', {
      method: 'POST',
      body: JSON.stringify({ ad_account_id: adAccountId }),
    }),
  authorizeWrite: ({ authorize, confirmation_phrase = '' }) =>
    requestJson('/api/meta/authorize-write', {
      method: 'POST',
      body: JSON.stringify({
        authorize,
        ...(confirmation_phrase ? { confirmation_phrase } : {}),
      }),
    }),
  disconnect: () =>
    requestJson('/api/meta/connection', {
      method: 'DELETE',
    }),
  listMetaCampaigns: (adAccountId) =>
    requestJson(`/api/meta/campaigns${buildQuery({ adAccountId })}`),
  listMetaAds: (adAccountId) =>
    requestJson(`/api/meta/ads${buildQuery({ adAccountId })}`),
  listMappings: (filters = {}) =>
    requestJson(`/api/meta/mappings${buildQuery(filters)}`),
  createMapping: (payload) =>
    requestJson('/api/meta/mappings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteMapping: (id) =>
    requestJson(`/api/meta/mappings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  triggerSync: (payload = {}) =>
    requestJson('/api/meta/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  triggerFixtureSync: (payload = {}) =>
    requestJson('/api/meta/sync/fixtures', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  clearFixtures: () =>
    requestJson('/api/meta/fixtures', {
      method: 'DELETE',
    }),
  getSyncRuns: (limit = 10) =>
    requestJson(`/api/meta/sync-runs?limit=${encodeURIComponent(limit)}`),
  publishOrPauseAd: (payload) =>
    requestJson('/api/meta/actions/publish-ad', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBudget: (payload) =>
    requestJson('/api/meta/actions/budget', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export const analyticsApi = {
  overview: (filters = {}) =>
    requestJson(`/api/analytics/overview${buildQuery(filters)}`),
  creatives: (filters = {}) =>
    requestJson(`/api/analytics/creatives${buildQuery(filters)}`),
  trends: (filters = {}) =>
    requestJson(`/api/analytics/trends${buildQuery(filters)}`),
  breakdowns: (filters = {}) =>
    requestJson(`/api/analytics/breakdowns${buildQuery(filters)}`),
};

export const optimizationApi = {
  getIntelligence: (filters = {}) =>
    requestJson(`/api/optimization/intelligence${buildQuery(filters)}`),
  listRecommendations: (filters = {}) =>
    requestJson(`/api/optimization/recommendations${buildQuery(filters)}`),
  generateRecommendations: (payload = {}) =>
    requestJson('/api/optimization/recommendations/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRecommendationStatus: (id, actionStatus) =>
    requestJson(`/api/optimization/recommendations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ actionStatus }),
    }),
  retrieveMemory: (filters = {}) =>
    requestJson(`/api/optimization/memory${buildQuery(filters)}`),
  syncMemory: (payload = {}) =>
    requestJson('/api/optimization/memory/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listExperiments: (filters = {}) =>
    requestJson(`/api/optimization/experiments${buildQuery(filters)}`),
  createExperiment: (payload) =>
    requestJson('/api/optimization/experiments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  recordExperimentMetrics: (id, payload) =>
    requestJson(`/api/optimization/experiments/${encodeURIComponent(id)}/metrics`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  approveExperimentBudget: (id, payload) =>
    requestJson(`/api/optimization/experiments/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  triggerStalledRecovery: (payload = {}) =>
    requestJson('/api/optimization/recovery/stalled', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export const observabilityApi = {
  getMetrics: () => requestJson('/api/metrics'),
  getReadiness: () => requestJson('/api/v1/health/ready'),
};
