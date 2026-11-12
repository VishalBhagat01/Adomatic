# AdPilot AI — Comprehensive System Audit & Production Readiness Report

**Audit Date**: 2026-11-11  
**Repository**: `c:\Users\VISHAL BHAGAT\Desktop\Admatic`  
**Runtime Versions Verified**: Node.js `v22.19.0`, Python `3.13.5` (`agent/.venv`), Vite `6.4.6`  
**Audit Scope**: Full inspection and end-to-end verification of `frontend/`, `backend/`, `agent/`, `infrastructure/`, `docker-compose*.yml`, and `docs/`, plus resolution of live runtime crashes observed on Windows local startup and Shopify product campaign execution.

---

## 1. Architecture Summary

AdPilot AI is a three-service monorepo backed by MongoDB, Redis, and MinIO/S3:

1. **Frontend (`frontend/`, React 18 + Vite 6 + Tailwind v4)**:
   - Dark-mode creative studio routing across Dashboard (`/`), Campaigns (`/campaigns`), Create Campaign (`/campaigns/new`), Generation Workspace (`/campaigns/:id/workspace`), Campaign Details (`/campaigns/:id`), Creative Gallery (`/creatives`), Creative Editor (`/creatives/:creativeId/edit`), Brand Assets (`/brand-assets`), Analytics (`/analytics`), and Settings (`/settings`).
   - Polls API/Agent health, displays live product extraction previews, streams campaign progress via SSE (`/api/campaigns/:id/events`), manages Meta fixture sync / OAuth status, and renders Meta attribution metrics & optimization intelligence.
2. **Backend (`backend/`, Node.js + Express + Mongoose + BullMQ/ioredis + AWS SDK v3)**:
   - Exposes REST endpoints under `/api/campaigns`, `/api/products`, `/api/dashboard`, `/api/creatives`, `/api/meta`, `/api/analytics`, `/api/optimization`, and `/api/v1`, alongside `/health`, `/health/live`, `/health/ready`, `/metrics` (Prometheus text), and `/api/metrics`.
   - Enqueues campaign jobs into BullMQ (`campaign-run`) and executes the 8-stage pipeline sequentially via `backend/src/services/campaignOrchestrator.js` against the Python Agent API, persisting outputs in MongoDB and assets in MinIO/S3.
3. **AI Agent (`agent/`, Python 3.13 + FastAPI)**:
   - Exposes stateless/worker AI endpoints under `/api/v1` (`products`, `strategy`, `creative`, `images`, `videos`, `evaluations`), plus `/health`, `/api/v1/health`, and `/metrics`.
   - Implements URL HTML/JSON-LD/OpenGraph/SSRF-safe product extraction, Google `google-genai` structured strategy planning, creative blueprint compilation, image generation/overlay/quality checks, Veo video client + `imageio-ffmpeg` video assembly, and multimodal creative evaluation + ad copy generation.
   - **Architectural Note**: While `langgraph` and `langchain-core` are declared in `agent/requirements.txt` and `agent/app/main.py` reports `"framework": "FastAPI + LangGraph"`, active stage orchestration executes in Node (`campaignOrchestrator.js`), not an in-process LangGraph `StateGraph`.

---

## 2. Verification & Test Suite Results (Post-Final-Edit)

All verification commands below were executed cleanly **after the final code changes**:

| Check | Command | Observed Result |
| --- | --- | --- |
| **Agent Python Tests** | `agent\.venv\Scripts\python.exe -m pytest agent/tests -v` | **`108 passed in 88.14s`**, exit `0` (`0` failed, `0` skipped). Includes 5 new regression tests covering `agent/` entrypoint importability, comma-separated `CORS_ORIGINS`, Gemini transient `503` capacity failover, non-failover on `404`, and Shopify `ProductGroup` + `hCaptcha`-footer extraction. |
| **Python Dependency Check** | `agent\.venv\Scripts\python.exe -m pip check` | **`No broken requirements found.`**, exit `0`. |
| **Backend Node Tests** | `npm --prefix backend test` (`node --test tests/**/*.test.js`) | **`60 passed` across `11` suites in `9.75s`**, exit `0` (`0` failed, `0` skipped) with live Redis & local MinIO active. |
| **Frontend Production Build** | `npm --prefix frontend run build` | **`1624` modules transformed**, built in `3.25s`, exit `0` (`dist/assets/index-B1hfExfW.css` 56.40 kB, `dist/assets/index-DLD10XoU.js` 380.92 kB). |
| **Docker Compose Validation** | `docker compose -f docker-compose.yml config -q` and `docker compose -f docker-compose.prod.yml --env-file .env.production.example config -q` | Both exited **`0`**. |
| **Live 3-Service + Browser E2E** | Isolated Playwright Edge E2E script against live Agent (`18000`), Backend (`15000`), Frontend (`15173`), MongoDB (`adpilot_audit_e2e`), Redis (`6379`), MinIO (`9000`) | Exited **`0`**: `/health` reported `ok` for MongoDB, Redis (`PONG`), and MinIO; live Lifelong Moka Pot extraction returned HTTP `200` (`"Lifelong Moka Pot 300ml \| Stovetop & Induction Espresso Maker Machine"`, `949` INR, `5` images); SSRF blocked (`400`); Meta write gate blocked (`400`); Settings fixture sync & Analytics ROAS verified; zero desktop/tablet horizontal overflow across 5 routes; `page_errors: []`, `http_5xx: []`. |
| **Live Gemini Strategy Run** | Live `MarketingStrategyService` call against extracted Lifelong Moka Pot product | **`STRATEGY_SUCCESS: True`**, `TOKENS: 3329`, `ATTEMPTS: 6`, `ANGLES: ['Minimalist Morning Ritual', 'Universal Compatibility']`, `PERSONAS: 2`, served cleanly via failover from `503` spikes (`gemini-3.6-flash`/`gemini-3.7-flash`) to `gemini-3.1-flash-lite`. |
| **Production Dependency Audit** | `npm --prefix backend audit --omit=dev` & `npm --prefix frontend audit --omit=dev` | Backend: **1 high** (`zod <4.6.6`, `GHSA-mrhx-c7xc-m3w5`); Frontend: **2 moderate** (`react-router 6.0.0 - 7.17.0`, `GHSA-wrjc-x8rr-h8h6` & `GHSA-337j-9hxr-rhxg`). |

---

## 3. Defects Found & Fixed

### A. User-Reported Startup & Live Pipeline Failures (Root Causes Resolved)

1. **`ModuleNotFoundError: No module named 'agent'` when starting `uvicorn app.main:app --reload` from `agent/`**
   - **Root Cause**: `agent/app/main.py` and submodules import using `from agent.app...`, which failed when the working directory was `Admatic/agent/`.
   - **Fix**: Updated `agent/app/__init__.py` to insert the monorepo root (`Path(__file__).resolve().parents[2]`) into `sys.path` before FastAPI module imports, and updated `agent/app/core/config.py` to resolve both root `.env` and `agent/.env` regardless of working directory.
2. **Startup crash (`SettingsError: error parsing value for field "CORS_ORIGINS"`)**
   - **Root Cause**: `.env` stores comma-separated `CORS_ORIGINS=http://localhost:5173,http://localhost:5000`, which `pydantic-settings` tried to JSON-decode before field validators ran.
   - **Fix**: Annotated `CORS_ORIGINS` with `NoDecode` in `agent/app/core/config.py` so both JSON lists and comma-separated origin strings parse cleanly.
3. **Expired & Overloaded Gemini Models (`gemini-2.5-flash` `404` & `503 UNAVAILABLE` high-demand spikes)**
   - **Root Cause**: Google retired `gemini-2.5-flash` for new users (`404 NOT_FOUND`), while newer preview/flash tiers (`gemini-3.8-flash`, `gemini-3.7-flash`) intermittently threw transient `503 UNAVAILABLE` spikes under load.
   - **Fix**: Updated default `GEMINI_MODEL` to `gemini-3.6-flash`, set tracked template `GEMINI_IMAGE_MODEL` to `gemini-3.1-flash-image` (preserving user overrides in `.env`), added jittered exponential backoff + opt-in `GEMINI_FALLBACK_MODELS` (`NoDecode` comma-separated/JSON list) in `agent/app/core/config.py` and `agent/app/services/strategy/gemini_client.py`. Failover triggers **strictly** after primary retries exhaust on transient capacity/network failures (`429`/`503`/`504`), never on `400`/`403`/`404` or schema errors.
4. **Shopify Extraction Failures (`"Unnamed Product"`, `No module named 'h2'`, Brotli mojibake, false `hCaptcha` block)**
   - **Root Causes**:
     - `html_fetcher.py` passed `http2=True` without checking if `h2` was installed (`500 No module named 'h2'`).
     - `DEFAULT_HEADERS` advertised `br` (`Accept-Encoding: gzip, deflate, br`) without `brotli` installed, returning binary Brotli responses parsed as `"Unnamed Product"`.
     - Valid 765 KB Shopify PDPs contain footer JS strings (`storefront-forms-hcaptcha`, `g-recaptcha-response`), triggering a false-positive `Anti-bot or CAPTCHA challenge detected (HTTP 200)` error.
     - Shopify embeds variant titles (`"Default Title"`) inside JSON-LD `@type: "ProductGroup"` `hasVariant` entries, overwriting the parent product title.
   - **Fix**: Added `_HTTP2_AVAILABLE` and `_BROTLI_AVAILABLE` capability detection in `agent/app/services/extractor/html_fetcher.py`, upgraded `httpx` -> `httpx[http2]>=0.27.0,<1.0.0` in `agent/requirements.txt`, refined `is_anti_bot_challenge(status_code, html_text)` so `200` PDPs with `application/ld+json` / `og:title` >= 50 KB aren't falsely blocked, and added `_merge_product_group_with_variant()` + `_PLACEHOLDER_VARIANT_NAMES` filtering in `agent/app/services/extractor/parsers/json_ld.py`.

### B. Audit Integration, Test & Infrastructure Defects Resolved

5. **Backend Test Runner Hang Under Live Redis (`npm --prefix backend test`)**
   - **Root Cause**: When Redis was running locally on port `6379`, BullMQ `Queue` and blocking `QueueEvents` sockets opened in `queueManager.js` remained alive after test suites called `closeRedis()`, causing `node --test` worker processes to hang indefinitely on Windows.
   - **Fix**: Added `registerRedisCleanupHandler()` in `backend/src/queue/redisClient.js` and registered `closeAllQueues()` in `backend/src/queue/queueManager.js` so `closeRedis()` drains all BullMQ `Queue` and `QueueEvents` handles before closing the Redis connection.
6. **Backend <-> Agent Wire Contract & Lifecycle Mismatches**
   - **Fix**: Removed duplicate `idempotencyKey` schema index warning in `backend/src/models/Campaign.js`; aligned Backend (`agentClient.js`, `campaignOrchestrator.js`, `creativeStudioService.js`, `studioController.js`) with Agent `ProductExtractResponse.data`, `GenerationPrompt` structured objects, `VideoValidationResult.approved`, and explicit campaign failure marking on failed video jobs.
7. **Playwright SSRF Gap in `js_fetcher.py`**
   - **Fix**: Enforced `validate_safe_url()` both prior to browser launch and inside Playwright's page route interceptor (`route_handler`).
8. **Docker Compose, Mongo Init & UI Accessibility Fixes**
   - **Fix**: Aligned `mongo-init.js` mount path & Mongo credentials (`adpilot_user:adpilot_password`) across `docker-compose.yml` and `docker-compose.prod.yml`; added `.env.production` to `.gitignore`; added `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` + Chromium install + non-root permissions in `infrastructure/docker/agent.Dockerfile`; added `role="status"` and `role="alert"` ARIA landmarks to Meta status/error banners in `frontend/src/pages/Settings.jsx`.

---

## 4. Remaining Risks, Limitations & Honest Gaps

1. **No Cryptographic Authentication / JWT Middleware on Tenant Headers**: `backend/src/middleware/ownership.js` (`attachOwnershipContext`) reads caller-supplied `X-Tenant-ID` / `X-User-ID` headers (defaulting to `tenant_default`). While suitable for single-tenant local studio usage, public multi-tenant deployment MUST add authenticated JWT/session middleware upstream before trusting `req.tenantId`.
2. **Veo Video Model Entitlement (`404 NOT_FOUND`)**: The currently configured `GEMINI_API_KEY` tier returns `404` for all tested Veo video models on `v1beta`. Live video generation remains `BLOCKED BY CREDENTIALS` until a Veo-enabled key/tier is supplied.
3. **Playwright Chromium on Local Host & Docker Daemon Execution**: Local Windows host lacks a standalone `ms-playwright` Chromium download (though container installation is configured in `agent.Dockerfile`), and Docker container builds were not started because the Docker Desktop daemon was offline during the audit.
4. **Live Meta OAuth / Graph API Sync Unverified Against Live Meta Accounts**: Requires valid `META_APP_ID`, `META_APP_SECRET`, and live Ad Account tokens; analytics synchronization is verified locally via isolated Meta test fixtures (`POST /api/meta/sync/fixtures`).
5. **Non-Blocking Package Advisories**: `npm audit --omit=dev` flags `zod <4.6.6` (backend high, breaking upgrade to 4.x) and `react-router 6.0.0 - 7.17.0` (frontend moderate, breaking upgrade to 7.18.5). Track upgrades cleanly before internet-facing release.
6. **FFprobe Binary Fallback**: Host Windows environment provides FFmpeg via `imageio-ffmpeg` without `ffprobe`; `ffmpeg_processor.py` cleanly parses stream durations from FFmpeg stderr, so installing full FFmpeg/FFprobe on PATH is recommended but optional in local dev.

---

## 5. Production Readiness Verdict

**Verdict: READY FOR LOCAL & CONTROLLED STAGING DEPLOYMENT (WITH CREDENTIAL & AUTH PREREQUISITES FOR PUBLIC PRODUCTION)**

- All local services (Frontend, Express/BullMQ Backend, FastAPI Agent, MongoDB, Redis, MinIO), core product extraction, live Gemini strategy generation + capacity failover, FFmpeg media processing, optimization analytics, and E2E Studio browser flows passed post-edit verification cleanly (`108/108` pytest, `60/60` backend Node tests, `1624` Vite build modules, `0` E2E HTTP 5xx / uncaught page errors).
- Before exposing the stack on public multi-tenant infrastructure:
  1. Place API Gateway / JWT authentication in front of `attachOwnershipContext` (`X-Tenant-ID`).
  2. Supply production `.env.production` secrets (MongoDB, Redis, MinIO, Meta OAuth keys, encryption keys, Veo-entitled `GEMINI_API_KEY`) and verify `docker compose -f docker-compose.prod.yml up --build` inside an active Docker runtime.
  3. Schedule major-version upgrades for `zod` (backend) and `react-router-dom` (frontend) during a dedicated dependency maintenance window.

