# AdPilot AI — Startup, Execution & Production Operations Runbook

This guide covers local Windows PowerShell and Linux/macOS startup, Docker Compose deployment, sample E2E campaign testing, verification suites, and production incident recovery.

---

## Part A — Developer Startup & Execution Guide

### 1. Prerequisites & Verified Ports

| Dependency / Tool | Requirement | Notes |
| --- | --- | --- |
| **Node.js & npm** | Node `>= 20.0.0` (verified `v22.19.0`) | Runs Express Backend (`backend/`) and Vite React Frontend (`frontend/`). |
| **Python & venv** | Python `>= 3.12` (verified `3.13.5`) | Dedicated virtualenv at `agent/.venv`. |
| **MongoDB** | Port `27017` | Native service on `127.0.0.1:27017` or via Docker Compose. |
| **Redis** | Port `6379` | Native service on `localhost:6379` (required for BullMQ + caching). |
| **MinIO (S3 Storage)** | API `9000` / Console `9001` | Local object storage on `http://localhost:9000` (or AWS S3 in cloud). |
| **FFmpeg** | Bundled via `imageio-ffmpeg` | Installed automatically inside `agent/.venv` via `requirements.txt`. |
| **Playwright Chromium** | Optional for JS SPA sites | Install in venv via `python -m playwright install chromium` if JS rendering fallback is required locally. |
| **Docker & Compose v2** | Optional | Required only for containerized dev/prod execution. |

**Default Service Ports & URLs:**

| Service | URL |
| --- | --- |
| **Frontend Studio (Vite Dev / Nginx)** | `http://localhost:5173` (Prod Docker: `http://localhost:80`) |
| **Backend Express API** | `http://localhost:5000` |
| **Python FastAPI Agent** | `http://localhost:8000` |
| **MongoDB** | `mongodb://127.0.0.1:27017/adpilot` |
| **Redis** | `redis://localhost:6379` |
| **MinIO S3 API / Console** | `http://localhost:9000` / `http://localhost:9001` |

---

### 2. Environment Configuration

1. Create root `.env` from `.env.example` (or `.env.production` from `.env.production.example` for production Docker):
   - **PowerShell**: `Copy-Item .env.example .env`
   - **macOS / Linux**: `cp .env.example .env`
2. Configure your Google Gemini key & recommended model parameters in `.env`:
   - `GEMINI_API_KEY=<your-google-ai-studio-api-key>` (never commit `.env` or `.env.production`)
   - `GEMINI_MODEL=gemini-3.6-flash` (avoids retired `gemini-2.5-flash` `404` errors)
   - `GEMINI_FALLBACK_MODELS=gemini-3.7-flash,gemini-3.1-flash-lite` (opt-in capacity failover strictly on transient `429`/`503`/`504` demand spikes)
   - `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image` (configurable to any supported image generation model available to your key)
   - `GEMINI_VIDEO_MODEL=veo-3.1-fast-generate-preview` (requires a Gemini API key tier with Veo video generation enabled)
3. Configure `CORS_ORIGINS` as either a comma-separated string (`http://localhost:5173,http://localhost:5000`) or JSON array.
4. *(Optional)* Configure Meta Marketing API variables (`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_TOKEN_ENCRYPTION_KEY`) for live Meta Graph API sync.

---

### 3. Local Multi-Service Startup (Recommended for Active Development)

Ensure **MongoDB (`27017`)**, **Redis (`6379`)**, and **MinIO (`9000`)** are running (either locally on Windows/macOS/Linux, or by running `docker compose up -d mongodb redis minio minio-init`).

#### Step 1: Install Dependencies (First Time Only)

**Windows PowerShell (from repo root `Admatic/`):**
```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
python -m venv agent\.venv
.\agent\.venv\Scripts\Activate.ps1
pip install -r agent\requirements.txt
# Optional: enable Playwright Chromium JS fallback for CSR e-commerce pages
python -m playwright install chromium
```

**Linux / macOS (from repo root `Admatic/`):**
```bash
npm install
npm --prefix backend install
npm --prefix frontend install
python3 -m venv agent/.venv
source agent/.venv/bin/activate
pip install -r agent/requirements.txt
# Optional:
python -m playwright install chromium
```

#### Step 2: Start All 3 Application Services (3 Terminals)

- **Terminal 1 — Python FastAPI Agent (`http://localhost:8000`)**
  - **Windows PowerShell (from `agent/` or root)**:
    ```powershell
    cd agent
    .\.venv\Scripts\Activate.ps1
    uvicorn app.main:app --reload
    ```
  - **Linux / macOS**:
    ```bash
    cd agent && source .venv/bin/activate && uvicorn app.main:app --reload
    ```

- **Terminal 2 — Node.js Express Backend (`http://localhost:5000`)**
  ```powershell
  npm --prefix backend run dev
  ```

- **Terminal 3 — React Vite Frontend (`http://localhost:5173`)**
  ```powershell
  npm --prefix frontend run dev
  ```

---

### 4. Docker Compose Startup

**Development Stack:**
```bash
docker compose -f docker-compose.yml up --build
```

**Production Stack (Linux / Staging / Server):**
```bash
cp .env.production.example .env.production
# Edit .env.production with strong credentials & real secrets
docker compose -f docker-compose.prod.yml --env-file .env.production up --build -d
```

**Validate Compose Configuration Syntax (without starting containers):**
```bash
docker compose -f docker-compose.yml config -q
docker compose -f docker-compose.prod.yml --env-file .env.production.example config -q
```

---

### 5. Health Check Verification & Automated Tests

**Verify All Health & Observability Endpoints:**
- Agent Health & Metrics: `http://localhost:8000/health`, `http://localhost:8000/api/v1/health`, `http://localhost:8000/metrics`
- Backend Full Health (MongoDB + Redis + MinIO + Agent link): `http://localhost:5000/health`
- Backend Liveness / Readiness / Metrics: `http://localhost:5000/health/live`, `http://localhost:5000/health/ready`, `http://localhost:5000/metrics`, `http://localhost:5000/api/metrics`
- Linux/macOS smoke script: `./infrastructure/scripts/verify-health.sh`

**Run Automated Test Suites & Build Checks:**
```powershell
# Python Agent suite (108 tests)
.\agent\.venv\Scripts\python.exe -m pytest agent/tests -v

# Backend API, Mongo/Redis/MinIO invariants, Meta & Optimization suites (60 tests)
npm --prefix backend test

# Frontend production Vite bundle check
npm --prefix frontend run build
```

---

### 6. Sample End-to-End Studio Walkthrough

1. Open **`http://localhost:5173`** and confirm the top header displays **API** and **Agent** green online badges.
2. Navigate to **Create Campaign** (`/campaigns/new`) and enter a public product URL, e.g.:
   `https://www.lifelongindiaonline.com/products/lifelong-moka-pot-300ml-stovetop-induction-espresso-maker-machine`
   - Wait for **Product Preview** to render product title, extracted price/currency (`949` INR), and product gallery images.
3. Keep the creative prompt optional or enter your campaign direction, choose format (`image` or `video`) and target placements, and click **Launch Campaign**.
4. Track real-time SSE pipeline execution on `/campaigns/:id/workspace` (`EXTRACTING_PRODUCT` -> `COMPLETED` or structured `FAILED` with **Retry Campaign** if API quota/entitlement prevents a stage).
5. **Testing Analytics & Optimization Without Live Meta Ads Credentials**:
   - Open **Settings** (`/settings`) and click **Load Isolated Meta Test Fixtures** (`POST /api/meta/sync/fixtures`).
   - Open **Analytics** (`/analytics`) to inspect CTR, CPC, CPM, ROAS, spend, and creative attribution.
   - Remove fixture records cleanly anytime from **Settings** (`DELETE /api/meta/fixtures`).

---

### 7. Local Troubleshooting Reference

| Symptom | Root Cause & Verified Resolution |
| --- | --- |
| `ModuleNotFoundError: No module named 'agent'` when starting Uvicorn inside `agent/` | Resolved by `agent/app/__init__.py` monorepo `sys.path` insertion; ensure `.venv` matches `pip install -r agent/requirements.txt`. |
| `SettingsError: error parsing value for field "CORS_ORIGINS"` | Resolved via `NoDecode` parsing in `agent/app/core/config.py`; both comma-separated and JSON list formats are accepted. |
| Shopify product extracts `"Unnamed Product"` or false `CAPTCHA` challenge on valid URL | Resolved via `httpx[http2]`, `_BROTLI_AVAILABLE` Accept-Encoding negotiation, `is_anti_bot_challenge()` threshold checks, and `@type: "ProductGroup"` variant merging in `json_ld.py`. |
| `404` retired Gemini model or `503 UNAVAILABLE` high demand spike | Set `GEMINI_MODEL=gemini-3.6-flash` and `GEMINI_FALLBACK_MODELS=gemini-3.7-flash,gemini-3.1-flash-lite` in `.env` and restart the Agent. |
| `404 NOT_FOUND` on Veo video generation | The configured `GEMINI_API_KEY` lacks Veo model entitlement (`veo-3.1-*`). Use image campaigns or upgrade API key entitlement. |
| `npm --prefix backend test` hangs after running cleanly when Redis is up | Resolved via `registerRedisCleanupHandler(closeAllQueues)` in `backend/src/queue/{redisClient.js,queueManager.js}` so BullMQ `QueueEvents` sockets close before Redis disconnects. |

---

## Part B — Production Incident & Operations Runbook

## 1. Worker Crash / Stalled Campaign Recovery

**Symptom**: Campaigns remain stuck in intermediate stages (`EXTRACTING_PRODUCT` through `ASSEMBLING_CAMPAIGN`) after a backend/agent restart.

**Procedure**:
1. Check system metrics and active logs:
   ```bash
   curl -s http://localhost:5000/api/metrics | jq .
   docker compose -f docker-compose.prod.yml logs --tail=100 backend agent
   ```
2. Trigger non-destructive stall recovery scan (preserves existing extracted products & generated creatives):
   ```bash
   curl -X POST http://localhost:5000/api/optimization/recovery/stalled \
     -H "Content-Type: application/json" \
     -H "X-Tenant-ID: tenant_default" \
     -d '{"staleThresholdMs": 300000, "autoRequeue": false}'
   ```
   - `autoRequeue: false` safely transitions stalled runs to recoverable failure status so operators or users can click **Regenerate**.
   - `autoRequeue: true` automatically re-schedules runs under `maxRecoveryAttempts` (`2`).

## 2. Meta Marketing API Rate Limit or Token Expiry

**Symptom**: Meta sync fails with HTTP `401`/`403`, token expiry banner, or rate-limit throttling (`META_RATE_LIMIT_PAUSE_THRESHOLD`).

**Procedure**:
1. Inspect Meta connection lifecycle in Studio **Settings** or `GET /api/meta/status`.
2. Verify recent sync run errors via `GET /api/meta/sync-runs`.
3. Re-authenticate via OAuth in Settings (with `ads_read` only, or `ads_management` only when write authorization is explicitly required).
4. Remember: **Write Safety Gate** prevents any ad pause/publish/budget update unless both `writeAuthorized === true` AND explicit experiment confirmation (`APPROVE_EXPERIMENT_BUDGET_ACTION`) are recorded.

## 3. Gemini / Veo AI Generation Failures & Cost Spikes

**Symptom**: High 5xx count on `/api/metrics`, quota exhaustion (`429`), `503` high-demand spikes, or cost alert threshold exceeded.

**Procedure**:
1. Check `GET /api/metrics` (`campaigns.estimatedAiCostUsd`) and Agent logs (`agent`).
2. Image, text, fallback, and video models stay configurable without code edits via `.env` / `.env.production`:
   - `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_IMAGE_MODEL`, `GEMINI_VIDEO_MODEL`
   - Reduce `EVALUATION_MAX_REGENERATIONS` or temporarily pause `video` format generation if Veo quota is constrained or unavailable.
3. All transient network/5xx/503 generation errors use bounded retries and preserve partially approved creatives.

## 4. MongoDB Backup & Disaster Restore

**Backup:**
```bash
./infrastructure/scripts/backup-mongodb.sh
```

**Restore (destructive — drops target database before restoring archive):**
```bash
CONFIRM_RESTORE=YES ./infrastructure/scripts/restore-mongodb.sh ./backups/mongodb/adpilot-mongodb-YYYYMMDDTHHMMSSZ.archive.gz
```
After restore, restart `backend` and run `./infrastructure/scripts/verify-health.sh`.

## 5. MinIO / Object Storage Backup & Recovery

**Backup:**
```bash
./infrastructure/scripts/backup-minio.sh
```

**Recovery:**
Check bucket health via `GET /health` (`infrastructure.storage`). Re-sync mirrored backups from `./backups/minio/<timestamp>/` using `mc mirror` back into `adpilot-creatives` and `adpilot-assets`.
