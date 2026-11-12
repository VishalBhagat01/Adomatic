import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from agent.app.core.config import settings
from agent.app.core.logging import logger, setup_logging
from agent.app.api.v1.endpoints.health import router as health_router
from agent.app.api.v1.router import api_v1_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(settings.LOG_LEVEL)
    logger.info(
        f"🤖 AdPilot Agent Service starting on {settings.HOST}:{settings.PORT} [{settings.ENVIRONMENT}]",
        extra={"extra": {"port": settings.PORT, "env": settings.ENVIRONMENT}},
    )
    yield
    logger.info("AdPilot Agent Service shutting down.")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AdPilot AI - LangGraph Powered Creative Generation Agent Service",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_agent_metrics = {
    "requests_total": 0,
    "errors_5xx": 0,
    "latency_ms_sum": 0.0,
}


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start_time) * 1000, 2)
    _agent_metrics["requests_total"] += 1
    _agent_metrics["latency_ms_sum"] += duration_ms
    if response.status_code >= 500:
        _agent_metrics["errors_5xx"] += 1
    logger.info(
        f"HTTP {request.method} {request.url.path} {response.status_code} - {duration_ms}ms",
        extra={
            "extra": {
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            }
        },
    )
    return response


@app.get("/metrics", tags=["Observability"])
async def get_agent_metrics():
    total = _agent_metrics["requests_total"]
    avg_latency = round(_agent_metrics["latency_ms_sum"] / total, 2) if total > 0 else 0.0
    return {
        "service": settings.APP_NAME,
        "environment": settings.ENVIRONMENT,
        "requests_total": total,
        "errors_5xx": _agent_metrics["errors_5xx"],
        "avg_latency_ms": avg_latency,
        "configured_models": {
            "strategy_model": settings.GEMINI_MODEL,
            "image_model": settings.GEMINI_IMAGE_MODEL,
            "video_model": settings.GEMINI_VIDEO_MODEL,
        },
    }


# Direct health check endpoint
app.include_router(health_router)

# Versioned API router
app.include_router(api_v1_router, prefix="/api/v1")

