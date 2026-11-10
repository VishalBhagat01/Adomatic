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
