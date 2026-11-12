# AdPilot AI — Monorepo & Infrastructure Foundation

> **Next-generation AI-powered e-commerce advertising creative generation platform.**

This repository contains the monorepo and reliable local infrastructure for **AdPilot AI**, orchestrated across three independent microservices and containerized infrastructure:

1. **Frontend**: React 18, Vite 6, Tailwind CSS v4, React Router 6.
2. **Backend**: Node.js 22, Express, ES Modules, Mongoose 8, BullMQ, AWS SDK S3, Zod validation, structured logging.
3. **Agent**: Python 3.13, FastAPI, Pydantic v2, LangGraph workflow runtime, Redis, Boto3.
4. **Infrastructure**:
   - **MongoDB 7.0**: Multi-tenant document database with strict JSON schema validators and indexes.
   - **Redis 7.2**: In-memory caching, message broker, and BullMQ background task queues with exponential retry.
   - **MinIO**: S3-compatible private object storage with presigned upload/download URL support.

---

## Architecture & Directory Layout

```text
adpilot-ai/
├── frontend/                     # React + Vite + Tailwind CSS SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/           # Button, Card, Badge, StatCard
│   │   │   └── layout/           # Sidebar, Header, AppLayout
│   │   ├── pages/                # Dashboard, Campaigns, Creatives, BrandAssets, Analytics, Settings
│   │   ├── router/               # React Router configuration
│   │   ├── services/             # Health probing & client API calls
│   │   ├── App.jsx               # Root application component
│   │   ├── index.css             # Tailwind v4 styles & dark-mode tokens
│   │   └── main.jsx              # DOM entrypoint
│   ├── index.html                # HTML template with dark color-scheme
│   ├── vite.config.js            # Vite configuration with @tailwindcss/vite
│   ├── package.json              # Frontend dependencies and build scripts
│   ├── .env.example              # Frontend environment template
│   └── .env                      # Local frontend environment
│
├── backend/                      # Node.js + Express API Service (ESM)
│   ├── src/
│   │   ├── config/               # Zod-validated environment config (env.js)
│   │   ├── controllers/          # Request controllers (healthController.js)
│   │   ├── database/             # MongoDB connection manager (connection.js)
│   │   ├── middleware/           # requestLogger, errorHandler, validateRequest
│   │   ├── models/               # 11 Mongoose Schemas (User, Product, Campaign, Creative, etc.)
│   │   ├── queue/                # Redis connection (redisClient.js) & BullMQ (queueManager.js)
│   │   ├── routes/               # Modular Express routers (healthRoutes.js)
│   │   ├── services/             # StorageService (MinIO S3), HealthService
│   │   ├── utils/                # logger.js (structured JSON), errors.js (AppError)
│   │   ├── app.js                # Express app factory with Helmet & CORS
│   │   └── server.js             # HTTP listener with graceful shutdown
│   ├── tests/                    # Tests (mongodb, redisQueue, storageService, health)
│   ├── package.json              # Backend dependencies
│   ├── .env.example              # Backend environment template
│   └── .env                      # Local backend environment
│
├── agent/                        # Python + FastAPI + LangGraph Agent Service
│   ├── app/
│   │   ├── api/v1/endpoints/     # Versioned endpoints (health.py)
│   │   ├── core/                 # config.py (Pydantic Settings), logging.py
│   │   ├── schemas/              # Pydantic v2 schemas (health.py)
│   │   ├── services/             # Health, Cache (Redis), Storage (S3) services
│   │   └── main.py               # FastAPI application with CORS & logging
│   ├── tests/                    # Pytest test suite
│   ├── requirements.txt          # Pinned Python dependencies
│   ├── .env.example              # Agent environment template
│   └── .env                      # Local agent environment
│
├── infrastructure/               # Container and deployment artifacts
│   └── docker/
│       ├── mongo-init.js         # MongoDB user, collections, schemas & index provisioner
│       ├── minio-init.sh         # MinIO private bucket setup & policy provisioner
│       ├── frontend.Dockerfile   # Multi-stage Vite build & dev Dockerfile
│       ├── backend.Dockerfile    # Node.js Alpine production/dev Dockerfile
│       └── agent.Dockerfile      # Python slim runtime Dockerfile
│
├── .env.example                  # Monorepo unified environment template
├── .gitignore                    # Comprehensive multi-language ignore rules
├── docker-compose.yml            # Multi-service & infrastructure local composition
├── package.json                  # Root monorepo orchestration scripts
└── README.md                     # Documentation & setup instructions
```

---

## Infrastructure Architecture

### 1. MongoDB Design (11 Core Collections)

Every document implements an explicit ID strategy (string `id` alongside `_id`), automatic timestamps (`createdAt`, `updatedAt`), multi-tenant ownership scoping (`tenantId`, `userId`), and strict validation:

| Collection | Key Fields | Indexes & Constraints |
|---|---|---|
| `users` | `tenantId`, `email`, `name`, `role`, `status` | Unique on `email`, compound `{ tenantId: 1, role: 1 }` |
| `products` | `tenantId`, `sku`, `title`, `price`, `images`, `attributes` | Unique compound `{ tenantId: 1, sku: 1 }`, `{ tenantId: 1, status: 1, createdAt: -1 }` |
| `campaigns` | `tenantId`, `userId`, `productId`, `objective`, `budget`, `platforms` | Compound `{ tenantId: 1, status: 1, createdAt: -1 }`, `{ tenantId: 1, productId: 1 }` |
| `campaign_runs` | `tenantId`, `campaignId`, `runNumber`, `status`, `jobId`, `metrics` | Unique compound `{ tenantId: 1, campaignId: 1, runNumber: 1 }`, `{ status: 1, createdAt: -1 }` |
| `marketing_strategies` | `tenantId`, `campaignId`, `version`, `targetPersona`, `keyMessaging` | Unique compound `{ tenantId: 1, campaignId: 1, version: 1 }` |
| `creative_concepts` | `tenantId`, `campaignId`, `title`, `hook`, `visualPrompt`, `aspectRatio` | Compound `{ tenantId: 1, campaignId: 1, status: 1 }` |
| `creatives` | `tenantId`, `campaignId`, `conceptId`, `assetType`, `storageKey`, `format` | Unique on `storageKey`, compound `{ tenantId: 1, campaignId: 1, status: 1 }` |
| `creative_evaluations` | `tenantId`, `creativeId`, `visualScore`, `complianceScore`, `predictedCtr` | Unique on `creativeId`, `{ tenantId: 1, creativeId: 1 }` |
| `ad_copies` | `tenantId`, `campaignId`, `creativeId`, `primaryText`, `headline` | Compound `{ tenantId: 1, campaignId: 1 }` |
| `campaign_performance` | `tenantId`, `campaignId`, `date`, `impressions`, `clicks`, `spend`, `roas` | Unique compound `{ tenantId: 1, campaignId: 1, date: 1 }` |
| `optimization_insights` | `tenantId`, `campaignId`, `insightType`, `recommendation`, `confidenceScore`| Compound `{ tenantId: 1, campaignId: 1, insightType: 1 }` |

### 2. Redis & Queue Infrastructure (BullMQ)

- **Connection Management**: Reusable singleton client with automatic reconnect backoff and non-blocking socket reachability probes.
- **Queues**:
  - `creative-generation`: Dispatches generative visual workflows to the agent.
  - `campaign-run`: Orchestrates end-to-end campaign execution.
  - `asset-processing`: Image optimization, resizing, and video encoding.
- **Retry Policy**: 3 automatic attempts with exponential backoff (`delay: 2000ms`, doubling on each attempt).
- **Pruning**: Automatically keeps last 200 completed jobs (24h) and last 500 failed jobs (7d).
- **Job Metadata**: Standardized correlation ID, tenant ID, user ID, priority, and timestamp schema on every payload.
- **Failed-Job Handling**: Captures error stacks, failure reasons, and emits to an in-memory DLQ audit log.
- **Lifecycle Tracking**: Inspectable states (`waiting`, `active`, `completed`, `failed`, `delayed`), progress percentage, and timestamps.

### 3. MinIO (S3-Compatible Object Storage)

- **Private Buckets**: `adpilot-creatives`, `adpilot-assets`, `adpilot-temp`. All configured with strict private access (no anonymous access allowed).
- **Object Key Naming Convention**:
  `tenants/{tenantId}/{entityType}/{entityId}/{timestamp}-{randomId}-{sanitizedFilename}`
- **Content-Type Validation**:
  - Images: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`.
  - Videos: `video/mp4`, `video/webm`, `video/quicktime`.
- **Security Invariant — Presigned URLs**:
  - Permanent storage credentials are **never exposed to the frontend**.
  - Direct client uploads are mediated via short-lived Presigned PUT URLs (`getPresignedUploadUrl`, default expiry: 15 minutes).
  - Private asset viewing is mediated via short-lived Presigned GET URLs (`getPresignedDownloadUrl`, default expiry: 60 minutes).

---

## Docker Compose Quickstart

Run the entire application stack (databases, queue, storage, and all three application services):

```bash
docker compose up -d
```

Infrastructure services exposed:
- **MongoDB**: `localhost:27017`
- **Redis**: `localhost:6379` (password: `adpilot_redis_pass`)
- **MinIO S3 API**: `http://localhost:9000`
- **MinIO Console**: `http://localhost:9001` (user: `adpilot_minio_user`, password: `adpilot_minio_secret_key`)

Application services exposed:
- **Frontend SPA**: `http://localhost:5173`
- **Backend Express API**: `http://localhost:5000`
- **Agent FastAPI Service**: `http://localhost:8000`

---

## Verification & Testing

Run all unit, schema, and smoke test suites across the monorepo:

```bash
# Run backend tests (MongoDB models, Redis queues, MinIO storage, Health)
npm run test:backend

# Run agent tests (FastAPI, Pydantic, Health)
npm run test:agent

# Run full monorepo test suite (Backend tests + Frontend Vite build)
npm run test
```

---

## Campaign Management API (Step 03)

### Endpoints

| Method | Endpoint | Description | Status Code |
|---|---|---|---|
| `POST` | `/api/campaigns` | Create & enqueue advertising campaign | `201 Created` / `200 OK` (idempotent match) |
| `GET` | `/api/campaigns` | Paginated, filterable campaign list | `200 OK` |
| `GET` | `/api/campaigns/:id` | Get campaign details | `200 OK` / `404 Not Found` |
| `GET` | `/api/campaigns/:id/status` | Lightweight lifecycle stage & progress | `200 OK` / `404 Not Found` |
| `GET` | `/api/campaigns/:id/creatives` | Get generated creatives and ad copy | `200 OK` / `404 Not Found` |
| `POST` | `/api/campaigns/:id/regenerate` | Re-queue campaign generation | `200 OK` / `400 Bad Request` |
| `DELETE` | `/api/campaigns/:id` | Soft-delete / archive campaign | `200 OK` / `404 Not Found` |

### Campaign Lifecycle State Machine

Campaigns transition across 12 explicit stages with progress tracking:

```
INITIALIZED (5%)
      ↓
   QUEUED (10%)
      ↓
EXTRACTING_PRODUCT (20%)
      ↓
ANALYZING_PRODUCT (35%)
      ↓
GENERATING_STRATEGY (50%)
      ↓
PLANNING_CREATIVES (65%)
      ↓
GENERATING_ASSETS (75%)
      ↓
EVALUATING_CREATIVES (85%)
      ↓
GENERATING_COPY (90%)
      ↓
ASSEMBLING_CAMPAIGN (95%)
      ↓
COMPLETED (100%) [or FAILED (0%)]
```

### Security & Invariants

- **SSRF Defense**: `ssrfValidator.js` blocks internal private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`), cloud link-local metadata services (`169.254.169.254`), non-standard ports, and non-HTTP protocols.
- **Idempotency**: Automatic hashing (`sha256(tenantId + productUrl + userPrompt)`) or client `Idempotency-Key` headers prevent duplicate runs upon retry.
- **Rate Limiting**: Configured `express-rate-limit` throttles campaign creation to 30 requests per 15 minutes per IP.
- **Agent Client Contract**: `agentClient.js` validates outgoing requests and incoming FastAPI responses using strict Zod schemas with a 10s timeout. Gemini logic is strictly isolated in the agent service.

---

## Step 04 — Product Intelligence & Website Extraction

The Python FastAPI agent service houses a multi-stage product extraction engine built for Lifelong India product URLs with an extensible architecture for arbitrary e-commerce platforms.

### Pipeline Architecture

```text
URL Input
   ↓
[1. URL & SSRF Validation]  (Strict DNS resolution, blocks private CIDRs & metadata IPs)
   ↓
[2. Polite HTTP Fetcher]     (Browser headers, safe-redirect inspection, exponential retry backoff)
   ↓
[3. Challenge Detection]     (Flags Cloudflare / CAPTCHA anti-bot challenges gracefully without evasion)
   ↓
[4. Progressive JS Render]   (Playwright headless Chromium fallback ONLY if client-side SPA detected)
   ↓
[5. Multi-Layer Parser]      (Schema.org JSON-LD + Open Graph / Twitter Cards + BeautifulSoup HTML DOM)
   ↓
[6. Image Pipeline]          (CDN resolution enhancement, format validation, deduping, primary image scoring)
   ↓
[7. Data Normalization]      (Field-level confidence scoring, strict provenance tracking, missing_fields)
```

### Extraction Endpoint

| Method | Endpoint | Description | Input |
|---|---|---|---|
| `POST` | `/api/v1/products/extract` | Extract structured product data & diagnostics | `{"url": "https://www.lifelongindiaonline.com/products/example"}` |

### Product Schema & Provenance Guarantee

Every extraction result strictly distinguishes missing values from zero or empty values. Prices, features, ratings, and customer reviews are **never fabricated**.

- `product_name`: Normalized product title (`field_provenance`: `json_ld` / `open_graph` / `html_dom`)
- `brand`: Extracted manufacturer (`field_provenance`: `json_ld` / `domain_default`)
- `price` & `original_price`: Current selling and compare-at / MRP prices (`None` if absent, never `0.0`)
- `discount`: Accurately computed discount percentage (`round((original_price - price) / original_price * 100, 1)`)
- `features`: Bullet-point highlights and key features
- `specifications`: Technical specifications dictionary (power, voltage, capacity, warranty, etc.)
- `images`: Validated, deduplicated list of `ProductImage` models with format, resolution, and `is_primary` indicator
- `reviews`: Customer review list with rating, author, content, date, and purchase verification
- `field_confidence`: Confidence scores ($0.0 - 1.0$) for every extracted field
- `field_provenance`: Source provenance map tracking exactly where each attribute originated
- `missing_fields`: Explicit checklist of expected attributes that were absent on the page

---

## Step 05 — Gemini Product Understanding and Marketing Strategy

The Python FastAPI agent includes a Gemini-powered intelligence engine using the official `google-genai` SDK with strict Pydantic JSON schema enforcement, multimodal reference image loading, claim auditing, and local quality gates.

### Core Capabilities

1. **Fact vs. Direction Separation**:
   - `ProductData` strictly controls factual product claims, specs, pricing, warranties, and limitations.
   - The user's `user_prompt` controls tone, creative aesthetic, audience focus, and campaign objectives.
   - Unsupported or contradictory claims requested in the user prompt (e.g., wrong wattage, cordless claims for corded units, fabricated discounts) are explicitly audited and flagged in `claim_validations` instead of accepted into ad copy.
2. **Official Google Gen AI SDK Integration (`gemini_client.py`)**:
   - Configurable model via `GEMINI_MODEL` (default `gemini-2.5-flash`) and `GEMINI_API_KEY`.
   - Enforces timeouts, bounded retries on transient errors (`429`, `5xx`), and records `GenerationMetadata` (model version, token usage, latency, attempt count).
   - **Zero silent fallback**: Never silently substitutes a different model when the configured model fails.
3. **Structured Output & Quality Validation (`quality_validator.py`)**:
   - Validates every response locally against `MarketingStrategy`, `ProductKnowledge`, `AudiencePersona`, `MarketingAngle`, `ClaimValidation`, and `MarketingRecommendation`.
   - Runs deterministic quality audits checking for:
     - Incomplete structured outputs and broken persona/angle ID references (`INCOMPLETE_OUTPUT`)
     - Repeated or overly similar marketing angles and hooks (`REPEATED_ANGLES`)
     - Generic personas or fabricated demographic statistics (`GENERIC_PERSONA`)
     - Contradictory product specs, warranties, or missing-price fabrication (`CONTRADICTORY_PRODUCT_INFO`)
     - Unsupported prompt claims leaking into copy (`UNSUPPORTED_CLAIM`)
   - Performs controlled regeneration with exact defect feedback up to `GEMINI_MAX_REGENERATIONS` before returning a clean failure (`422 Unprocessable Entity`).

### Strategy Endpoint

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/strategy/generate` | Analyze `ProductData` + images + `user_prompt` into a verified `MarketingStrategy` |

---

## Step 06 — Creative Planning & Prompt Engineering Engine

Translates `MarketingStrategy` + `ProductData` into executable [`ImageCreativeBlueprint`](file:///c:/Users/VISHAL%20BHAGAT/Desktop/Admatic/agent/app/schemas/creative.py) and [`VideoStoryboard`](file:///c:/Users/VISHAL%20BHAGAT/Desktop/Admatic/agent/app/schemas/creative.py) plans ready for downstream asset generators.

### Key Modules & Guarantees

1. **Placement Specifications (`placements.py`)**: Maps target placements (`instagram_feed`, `instagram_reels`, `instagram_stories`, `facebook_feed`, `youtube_shorts`, `youtube_instream`, `web_banner`) to aspect ratios (`4:5`, `9:16`, `1:1`, `16:9`), recommended pixel dimensions, and safe-zone constraints.
2. **Reference-Image Preservation (`reference_constraints.py`)**: Builds explicit rules preserving product silhouette geometry, brand logo typography, physical buttons/dials, surface color/finish, physical dimensions/proportions, recognizable features, and prohibited inventions (e.g., blocking battery/cordless artifacts on 230V AC corded products and rejected user prompt claims).
3. **Dedicated Image & Video Prompt Templates (`prompt_templates.py`)**: Separate `adpilot_image_blueprint_v1` and `adpilot_video_storyboard_v1` compilers injecting product specs, visual composition, lighting, scene progression, and negative exclusions.
4. **Deterministic Creative Validation (`validator.py`)**:
   - Defined objective on every concept (`OBJECTIVE_MISSING`)
   - Exact sum of positive video scene durations matching `target_video_duration` (`DURATION_MISMATCH`)
   - Supported claims & zero invented hardware features (`UNSUPPORTED_CLAIM`, `CONTRADICTORY_PRODUCT_INFO`, `FEATURE_INVENTION`)
   - Strict placement, format, and aspect ratio consistency (`PLACEMENT_MISMATCH`, `FORMAT_COVERAGE_MISSING`)
   - Concept differentiation preventing mere background swaps (`INSUFFICIENT_DIFFERENTIATION`)

### Creative Planning Endpoint

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/creative/plan` | Compile verified `ImageCreativeBlueprint` and `VideoStoryboard` assets from `MarketingStrategy` |

---

## Step 07 — Gemini Image Generation Engine

Implements a 10-stage commercial product image generation pipeline using the official Google GenAI SDK (`google-genai` `client.aio.models.generate_content` with `response_modalities=["IMAGE"]` and `types.ImageConfig`) bound strictly to `GEMINI_IMAGE_MODEL` (default: `gemini-2.5-flash-image`, configurable via environment variables without silent model substitution).

### Pipeline Architecture (`agent/app/services/image_gen/`)

1. **Blueprint Validation**: Verifies `ImageCreativeBlueprint` integrity, format (`image`), and supported aspect ratios (`1:1`, `4:5`, `9:16`).
2. **Product Reference Selection (`reference_selector.py`)**: SSRF-safe retrieval (`validate_safe_url`), Pillow decoding, SHA-256 deduplication, and scoring prioritizing primary high-resolution product images (up to `IMAGE_MAX_REFERENCE_IMAGES`, default `3`).
3. **Product-Locked Prompt Compilation (`prompt_compiler.py`)**: Injects `ReferenceImageConstraints` (geometry, logo, dials, finish, proportions), variation cues, and aspect-specific composition margins while explicitly instructing Gemini to render **clean base visuals without baked-in promotional text**.
4. **Gemini Native Image Synthesis (`gemini_image_client.py`)**: Async execution with configured timeout, bounded retries on `429` / `5xx` / timeout errors, token usage capture, and configurable cost estimates (`GEMINI_IMAGE_ESTIMATED_COST_USD`).
5. **Deterministic Validation (`quality_checker.py`)**: Checks raster readability, format (`PNG`/`JPEG`/`WEBP`), byte size bounds, minimum resolution, aspect-ratio tolerance, batch SHA-256 + 64-bit `dHash` duplicates, anti-blank/clipping statistics, and measured RGB histogram similarity against selected product references (note: histogram correlation gauges tonal consistency rather than full semantic object fidelity).
6. **Optional Deterministic Overlay (`overlay_renderer.py`)**: When `apply_deterministic_overlay=true`, renders placement-safe headlines, verified pricing/discount badges, and CTAs onto approved base visuals via Pillow while keeping the clean original untouched.
7. **Full Asset & Metadata Persistence (`storage.py`)**: Stores **both approved and rejected** image assets alongside `StoredGenerationMetadata` JSON manifests in MinIO/S3 (`campaigns/{campaign_id}/creatives/{concept_id}/{approved|rejected}/{creative_id}.{ext}`).

### Image Generation Endpoint & Example Request

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/images/generate` | Generate, validate, and persist commercial product image variations |

```json
{
  "campaign_id": "camp_007",
  "blueprint": { "...": "ImageCreativeBlueprint from POST /api/v1/creative/plan" },
  "marketing_strategy": { "...": "MarketingStrategy from POST /api/v1/strategy/generate" },
  "product_data": { "...": "Product from POST /api/v1/products/extract" },
  "aspect_ratio": "4:5",
  "num_variations": 2,
  "apply_deterministic_overlay": true
}
```

---

## Step 08 — Veo Video Generation & FFmpeg Assembly Engine

Implements an asynchronous end-to-end commercial video pipeline pairing Google's official Veo API (`google-genai` `models.generate_videos`, `operations.get`, and `files.download`) with FFmpeg scene normalization, concatenation, caption/CTA rendering, voiceover mixing, loudness normalization, validation, and MinIO/S3 archival.

### Pipeline Modules (`agent/app/services/video_gen/`)

1. **Storyboard & Prompt Builder (`scene_prompt_builder.py`)**: Enforces exact scene duration sums, selects valid Veo durations (`4`/`6`/`8` seconds), aligns Veo native `9:16` / `16:9` ratios cleanly, and injects product-locked fidelity rules and ambient sound cues per scene.
2. **Official Veo Async Client (`veo_client.py`)**: Strictly uses configured `GEMINI_VIDEO_MODEL` (default `veo-3.1-fast-generate-preview`) without silent model fallback, supporting both `VideoGenerationReferenceImage(ASSET)` consistency and image-to-video first-frame anchoring (`image=` mutually exclusive with `reference_images`), exponential polling backoff, and configurable per-second cost estimation.
3. **Crash-Safe Job Store (`job_store.py`)**: Persists job status, provider operation resource names (`operation_name`), intermediate scene object keys, and staging state across Redis + local JSON checkpoints so interrupted jobs resume without regenerating finished scenes (`POST /api/v1/videos/jobs/{job_id}/resume`).
4. **FFmpeg Multimedia Processor (`ffmpeg_processor.py`)**: Uses bundled `imageio-ffmpeg` / system FFmpeg for aspect-preserving `force_original_aspect_ratio=decrease` padding (zero stretching), FPS/48kHz audio normalization, multi-scene concatenation, safe-zone RGBA subtitle & CTA overlays, SRT caption generation, optional voiceover mixing (`amix`), EBU R128 `loudnorm` (`-16 LUFS` / `-1.5 dBTP`), and `yuv420p` MP4 export.
5. **Deterministic Video Validator (`video_validator.py`)**: Audits duration, resolution, aspect ratio, FPS, audio stream presence, `volumedetect` peak clipping headroom, `blackdetect` ratios, transition boundary keyframes, corrupt streams, and sampled-frame RGB histogram correlation against product reference photos.

### Video Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/videos/generate` | Submit async Veo storyboard generation job (`202 Accepted` or `execute_sync=true`) |
| `GET` | `/api/v1/videos/jobs/{job_id}` | Inspect job progress, scene status, and final MP4 / S3 manifest |
| `POST` | `/api/v1/videos/jobs/{job_id}/resume` | Resume an interrupted job from persisted Veo operation IDs |

## Step 09: Creative Evaluation, Controlled Regeneration & Advertising Copy Engine

Step 09 implements an independent QA gate (`agent/app/services/evaluation/`) combining multimodal visual inspection, deterministic technical validation, strict advertising claim verification, bounded prompt-repaired regeneration, and compliant ad copy generation:

1. **Independent Evaluator (`evaluator_service.py`)**: Audits any existing generated image or MP4 video asset *without regenerating it*. Combines reference-compared Gemini multimodal scoring across 10 weighted criteria (`product_identity_fidelity`, `product_geometry_feature_consistency`, `logo_branding_accuracy`, `visual_quality`, `composition`, `message_clarity`, `marketing_angle_consistency`, `placement_suitability`, `text_readability`, `misleading_content_compliance`) with deterministic Pillow/FFmpeg checks (`ImageQualityChecker`, `VideoQualityValidator`, sampled keyframes) and `ClaimValidator` audits over `observed_visible_text`.
2. **Hard Rules vs Weighted Scoring**: Any hard constraint violation (`INCORRECT_PRODUCT_LOGO`, `MATERIALLY_ALTERED_PRODUCT`, `FABRICATED_PRODUCT_SPECIFICATION`, `INCORRECT_PROMOTIONAL_PRICE`, `MISSING_PRICE_FABRICATION`, `MISLEADING_PRODUCT_DEMONSTRATION`, `INVALID_OUTPUT_DIMENSIONS`, unsupported claim, or `CORRUPT_ASSET`) rejects the creative (`decision="rejected_hard_rule"`) even when the weighted average exceeds `EVALUATION_APPROVAL_THRESHOLD`.
3. **Controlled Regeneration (`regeneration_service.py`)**: Uses structured `RegenerationInstruction` feedback to patch cloned blueprint/storyboard prompts up to `EVALUATION_MAX_REGENERATIONS` (capped at `<= 3` to prevent infinite loops), preserving every rejected and approved version alongside cumulative USD generation costs in `attempt_history`.
4. **Claim-Verified Ad Copy (`ad_copy_service.py` & `claim_validator.py`)**: Refuses copy generation for unapproved creatives (`422`), generates 3 primary texts, 3 headlines, 2 descriptions, CTA recommendation, creative angle, and audience hypothesis, links claims directly to verified `Product` fields (`LinkedClaimEvidence`), and rejects unsupported health claims, performance guarantees, unverified prices/discounts, fabricated reviews/ratings, certifications, and comparative claims.

### Evaluation & Ad Copy Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/evaluations/evaluate` | Independently audit an existing image or video asset without regeneration |
| `POST` | `/api/v1/evaluations/copy` | Generate claim-verified advertising copy strictly for an approved creative |
| `POST` | `/api/v1/evaluations/evaluate-and-regenerate` | Evaluate creative, execute bounded prompt-repaired regeneration, and generate copy on approval |

---

## Step 10 — AdPilot AI Creative Studio Frontend & Live Workflow Integration

Step 10 delivers a dark-mode React + Vite studio integrated end-to-end with Express and the FastAPI Gemini agent, backed by real asynchronous campaign orchestration, Server-Sent Events (SSE), selective single-creative regeneration, and secure media streaming.

### Required Studio Pages (`frontend/src/pages/`)

1. **Dashboard (`/`)**: Displays real tenant metrics (`totalCampaigns`, `generatedCreatives`, `approvedCreatives`, active runs), status distribution bars, recent campaigns, and chronological pipeline stage activity.
2. **Create Campaign (`/campaigns/new`)**: Validated brief form supporting product URL entry, **optional** advertisement description, image/video formats, placements, and pre-launch **Product Preview**.
3. **Product Preview (`ProductPreviewPanel`)**: Extracts and displays product title, brand, pricing/discounts, image gallery (with reference image selection), specifications, verified features, missing fields, and extraction warnings prior to running expensive image/video generation.
4. **Generation Workspace (`/campaigns/:id/workspace`)**: Streams live execution updates over SSE (`GET /api/campaigns/:id/events`) across all pipeline steps (`EXTRACTING_PRODUCT` -> `ANALYZING_PRODUCT` -> `GENERATING_STRATEGY` -> `PLANNING_CREATIVES` -> `GENERATING_ASSETS` -> `EVALUATING_CREATIVES` -> `GENERATING_COPY` -> `ASSEMBLING_CAMPAIGN` -> `COMPLETED`), displaying job IDs, retry counts, streamed asset previews, and structured errors with retry triggers.
5. **Creative Gallery (`/creatives`)**: Filterable multi-campaign gallery for image previews, inline HTML5 `<video controls>` playback, QA approval status badges, 10-criterion evaluation score inspection dialog, previous version history, secure downloads, and quick selective regeneration.
6. **Creative Editor (`/creatives/:creativeId/edit`)**: Dedicated editor to modify headlines, primary copy text, CTA, overlay headline/subtext/CTA, background direction, aspect ratio, and steering instructions — supporting fast metadata saves (`PATCH`) or selective regeneration of that single creative (`POST .../regenerate`) without restarting the parent campaign.
7. **Campaign Details (`/campaigns/:id`)**: Tabbed deliverable view surfacing approved creatives, ad copy variations with linked verified claim evidence, target audience personas, marketing angles, placement recommendations, and extracted product grounding.

### Step 10 Backend Studio API Contracts (`backend/src/`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard/summary` | Real tenant campaign & creative totals, status breakdown, recent activity |
| `POST` | `/api/products/preview` | SSRF-checked live product extraction preview + missing field diagnostics |
| `GET` | `/api/campaigns/:id/details` | Consolidated campaign, extracted product, strategy, creatives, and copies |
| `GET` | `/api/campaigns/:id/events` | Real-time Server-Sent Events (`snapshot`, `stage_changed`, `progress`, `retry`, `creative_generated`, `completed`, `failed`) |
| `GET` | `/api/creatives` | Cross-campaign creative gallery with format/approval/campaign filters |
| `GET` | `/api/creatives/:creativeId` | Single creative detail with linked copy, campaign context, and version history |
| `PATCH` | `/api/creatives/:creativeId` | Save edited copy variations, overlays, background direction, and approval state |
| `POST` | `/api/creatives/:creativeId/regenerate` | Regenerate one creative selectively, archiving prior version into `versionHistory` |
| `GET` | `/api/creatives/:creativeId/media` | Stream image/MP4 binary cleanly with HTTP `Range` support (`?download=1` attachment download) |
| `GET` | `/api/creatives/:creativeId/download-url` | Resolve presigned MinIO URL (when configured) alongside backend proxy download link |

---

## Step 11 — Meta Marketing API Integration & Campaign Analytics

Step 11 integrates the official Meta Marketing API (`v27.0`, configurable via `META_GRAPH_API_VERSION`) into `backend/src/integrations/meta/` to synchronize live campaign delivery metrics, map performance back to AdPilot-generated creatives, enforce write safety gates, and surface actionable analytics across [Analytics](file:///c:/Users/VISHAL%20BHAGAT/Desktop/Admatic/frontend/src/pages/Analytics.jsx) and [Settings](file:///c:/Users/VISHAL%20BHAGAT/Desktop/Admatic/frontend/src/pages/Settings.jsx).

### Backend Integration Architecture (`backend/src/integrations/meta/`)

1. **Authentication & Security (`metaCrypto.js`, `metaAuthService.js`)**:
   - **OAuth 2.0 + System User Flows**: CSRF `state`-protected OAuth URL generation (`GET /api/meta/oauth/start`), short-to-long-lived token exchange (`fb_exchange_token`), System User tokens, `/debug_token` permission/expiry inspection, and Ad Account ownership verification via `/me/adaccounts`.
   - **At-Rest Encryption & Secret Hygiene**: Access tokens are encrypted server-side with **AES-256-GCM** (`META_TOKEN_ENCRYPTION_KEY`) and computed with **HMAC-SHA256 `appsecret_proof`** on outbound calls. Tokens never leave the backend (`encryptedToken` stripped via `select: false` and `toJSON()`).
   - **Explicit Write Authorization Gate**: Any Meta ad status change (`POST /api/meta/actions/publish-ad`) or campaign/adset budget mutation (`POST /api/meta/actions/budget`) requires `ads_management` scope, explicit server-side authorization (`POST /api/meta/authorize-write` with confirmation phrase `AUTHORIZE_META_WRITES`), and `explicit_user_authorization: true` on every write payload.

2. **Ingestion, Rate Limits & Metrics Normalization (`metaClient.js`, `metaRateLimiter.js`, `metaMetricsParser.js`, `metaSyncService.js`)**:
   - **Cursor Pagination & Rate-Limit Resilience**: Traverses `paging.next` / `paging.cursors.after`, tracks `x-business-use-case-usage`, `x-ad-account-usage`, and `x-app-usage` headers, applies proactive slowdowns, and retries HTTP `429`/5xx with exponential backoff while classifying Graph error codes (`190` → `401`, `10/200/294` → `403`, `4/17/32/613/80004` → `429`).
   - **Metrics Quality & Integrity**: Strictly separates outbound link clicks (`inline_link_clicks`, `inline_link_click_ctr`, `cost_per_inline_link_click`) from all-click engagement (`clicks`, `ctr`), extracts ordered conversion actions (`landing_page_view`, `add_to_cart`, `purchase`, `action_values`, `purchase_roas`), preserves missing fields as `null` (`missingMetrics`) rather than fabricating zeros, retains billing currency + IANA account timezone, and flags trailing 72h delayed attribution rows (`isProvisionalAttribution`).
   - **Creative Lineage & Origin Distinction**: Associates `AdPilot Campaign -> Creative -> Meta Ad ID` deterministically (`[adpilot_creative:...]` or manual `MetaCreativeMapping`), cleanly distinguishing `adpilot_generated`, `uploaded_creative`, and `external_meta` advertisements.
   - **Isolated Sandbox Fixtures**: `POST /api/meta/sync/fixtures` populates Graph v27.0-shaped test records strictly flagged `isTestFixture: true` for verification when live Meta ad credentials are unavailable (`DELETE /api/meta/fixtures` removes them cleanly).

### Meta & Analytics Endpoints (`backend/src/routes/`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/meta/status` | Inspect connection lifecycle, token expiry, scopes, and verified Ad Accounts |
| `GET` | `/api/meta/oauth/start` | Generate CSRF-protected Meta OAuth 2.0 dialog URL |
| `GET` | `/api/meta/oauth/callback` | Exchange OAuth code for long-lived token and store encrypted credentials |
| `POST` | `/api/meta/connect/token` | Verify, encrypt server-side, and connect a System User or User access token |
| `POST` | `/api/meta/ad-account` | Select verified primary Ad Account (`currency` & IANA timezone binding) |
| `POST` | `/api/meta/authorize-write` | Unlock or lock Meta ad/budget write permissions (`AUTHORIZE_META_WRITES`) |
| `GET` / `POST` / `DELETE` | `/api/meta/mappings` | List, upsert, and remove AdPilot Campaign/Creative <-> Meta Ad ID links |
| `POST` | `/api/meta/sync` | Idempotently sync Meta campaigns, ads, daily insights, and breakdowns |
| `POST` / `DELETE` | `/api/meta/sync/fixtures`, `/api/meta/fixtures` | Populate or clear isolated `isTestFixture=true` verification datasets |
| `POST` | `/api/meta/actions/publish-ad`, `/api/meta/actions/budget` | Write-gated Meta ad status & budget updates |
| `GET` | `/api/analytics/overview`, `/creatives`, `/trends`, `/breakdowns` | Aggregated performance KPIs, sortable creative comparison, daily trends, and placement/audience breakdowns |

---

## Step 12 — Optimization Engine, Production Testing & Deployment Readiness

Step 12 closes the performance feedback loop and prepares the monorepo for reliable production operation:

1. **Performance Intelligence & Statistical Rigor (`creativeMetadataExtractor.js`, `performanceAnalyzerService.js`)**:
   - Joins Meta outcomes with AdPilot creative metadata (`marketingAngle`, `audienceHypothesis`, `hookType`, `format`, `videoDuration`, `productVisibility`, `cta`, `placement`, `copyStructure`).
   - Normalizes performance cohorts by campaign objective, placement, audience segment, spend, and attribution settings, computes two-proportion Z-tests and Wilson 95% confidence intervals, enforces minimum impression/click/spend thresholds (`insufficient_sample`), and separates correlation from causation.
2. **Creative Learning Memory (`CreativeMemoryEntry.js`, `creativeMemoryService.js`)**:
   - Retrieves `successfulConcepts`, `failedConcepts`, `effectiveHooks`, and `productCategoryInsights` using structured metadata filters first followed by secondary cosine similarity (`tokenVector`), with strict fact firewalls (`neverOverrideVerifiedProduct: true`) ensuring historical performance NEVER overrides verified current `ProductData`.
3. **Controlled Experiments & Recommendations (`CreativeExperiment.js`, `experimentService.js`)**:
   - Tracks A/B variants, confidence levels, sample-size warnings, optional reliability-gated advisory contextual bandit shares (`advisoryOnly: true`), human approval gates (`APPROVE_EXPERIMENT_BUDGET_ACTION`), and evidence-backed recommendations (`test_different_hook`, `expand_promising_concept`, `change_opening_scene`, `test_another_placement`, `improve_product_visibility`, `revise_ad_copy`).
4. **Production Hardening, Observability & Operations**:
   - Structured metrics (`/metrics` Prometheus text + `/api/metrics` JSON + Agent `:8000/metrics`), `/health/live`, `/health/ready`, error reporter hooks (`metricsService.js`), non-destructive stalled worker crash recovery (`POST /api/optimization/recovery/stalled`), hardened production multi-stage Dockerfiles + `docker-compose.prod.yml` + Nginx SSE reverse proxy, backup/restore scripts (`infrastructure/scripts/`), and runbooks ([DEPLOYMENT.md](file:///c:/Users/VISHAL%20BHAGAT/Desktop/Admatic/docs/DEPLOYMENT.md), [RUNBOOK.md](file:///c:/Users/VISHAL%20BHAGAT/Desktop/Admatic/docs/RUNBOOK.md)).









