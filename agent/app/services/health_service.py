import platform
import sys
import time
from datetime import datetime, timezone
from agent.app.core.config import settings
from agent.app.schemas.health import HealthResponse
from agent.app.services.cache import agent_cache
from agent.app.services.storage import agent_storage

_START_TIME = time.time()


class HealthService:
    @staticmethod
    def get_health() -> HealthResponse:
        uptime = int(time.time() - _START_TIME)
        return HealthResponse(
            status="ok",
            service=settings.APP_NAME,
            version=settings.APP_VERSION,
            timestamp=datetime.now(timezone.utc).isoformat(),
            environment=settings.ENVIRONMENT,
            uptime_seconds=uptime,
            python_version=platform.python_version(),
            framework="FastAPI + LangGraph",
            details={
                "platform": platform.platform(),
                "cors_origins": settings.CORS_ORIGINS,
                "infrastructure": {
                    "redis": agent_cache.ping(),
                    "storage": agent_storage.check_connection(),
                },
            },
        )
