# AdPilot AI — Production Deployment Guide

## 1. Architecture & Environment Separation

AdPilot AI separates development and production environments cleanly:

- **Development (`docker-compose.yml`)**: Hot-reloaded source mounts (`target: dev`), permissive local CORS for Vite (`localhost:5173`), optional isolated Meta fixture sync enabled for offline development tests.
- **Production (`docker-compose.prod.yml`)**:
  - Multi-stage builds (`target: prod`) with non-root users (`node` in backend, `adpilot` in agent, hardened `nginx:alpine` in frontend).
  - Reverse proxy via Nginx forwarding `/api/*` and `/health` with SSE buffering disabled (`proxy_buffering off`) for live campaign progress streaming.
  - Explicit environment validation on boot (`backend/src/config/env.js`) and `META_ALLOW_FIXTURE_SYNC=false` in production.
  - Container resource limits, restart policies (`always`), healthchecks (`/health/live`, `/health/ready`, `/metrics`), and structured JSON logging with log rotation (`json-file` driver).

## 2. Secrets Management

1. Copy `.env.production.example` to `.env.production` in a secure secrets store or deployment runner (never commit `.env.production` to git).
2. Generate high-entropy credentials:
   - `META_TOKEN_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - Strong distinct passwords for `MONGO_INITDB_ROOT_PASSWORD`, `MONGODB_URI`, `REDIS_PASSWORD`, `STORAGE_SECRET_KEY`.
3. Supply Google `GEMINI_API_KEY` and Meta OAuth credentials (`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`).
4. Verify secrets are never printed in container logs: structured loggers redact sensitive tokens and never log raw Meta access tokens.

## 3. Initial Production Boot

```bash
# Validate compose configuration and env vars
docker compose -f docker-compose.prod.yml --env-file .env.production config

# Build and start all services detached
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Verify readiness & metrics
BACKEND_URL=http://localhost:5000 ./infrastructure/scripts/verify-health.sh
```

## 4. TLS / Domain Termination

Expose `frontend` behind a TLS-terminating reverse proxy or cloud load balancer (Caddy, Traefik, AWS ALB, or Cloudflare) pointing `https://your-domain.com` to port `80` of the `frontend` Nginx service, ensuring `CORS_ORIGIN`, `META_REDIRECT_URI`, and `META_FRONTEND_CALLBACK_URL` match your HTTPS origin.

## 5. Observability & Cost Monitoring

- **Readiness / Liveness**: `GET /health/live` (process alive), `GET /health/ready` (returns `503` in production if MongoDB or Redis is disconnected), `GET /health` (full dependency breakdown).
- **Metrics**:
  - Prometheus scrape endpoint: `GET /metrics`
  - JSON summary endpoint (HTTP traffic, error rate, stalled recoveries, cumulative estimated Gemini/Veo USD cost): `GET /api/metrics`
  - Python Agent telemetry: `GET :8000/metrics`
- **External Error Reporting**: Attach Sentry/Datadog/OpenTelemetry handlers via `metricsService.registerErrorReporter((err, entry) => ...)` during bootstrap.

## 6. Automated Backups

Schedule cron jobs on the host / orchestrator:

```bash
# Daily MongoDB compressed archive
0 2 * * * /opt/adpilot/infrastructure/scripts/backup-mongodb.sh /var/backups/adpilot/mongo

# Daily MinIO creative bucket mirror
30 2 * * * /opt/adpilot/infrastructure/scripts/backup-minio.sh /var/backups/adpilot/minio
```

