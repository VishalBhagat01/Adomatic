const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const AGENT_URL = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000';

export async function checkBackendHealth() {
  const start = performance.now();
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { method: 'GET' });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      online: true,
      service: 'backend',
      url: BACKEND_URL,
      latencyMs,
      details: data.data || data,
    };
  } catch (err) {
    return {
      online: false,
      service: 'backend',
      url: BACKEND_URL,
      latencyMs: Math.round(performance.now() - start),
      error: err.message,
    };
  }
}

export async function checkAgentHealth() {
  const start = performance.now();
  try {
    const res = await fetch(`${AGENT_URL}/health`, { method: 'GET' });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      online: true,
      service: 'agent',
      url: AGENT_URL,
      latencyMs,
      details: data,
    };
  } catch (err) {
    return {
      online: false,
      service: 'agent',
      url: AGENT_URL,
      latencyMs: Math.round(performance.now() - start),
      error: err.message,
    };
  }
}

