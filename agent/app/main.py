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


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start_time) * 1000, 2)
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


# Direct health check endpoint
app.include_router(health_router)

# Versioned API router
app.include_router(api_v1_router, prefix="/api/v1")

