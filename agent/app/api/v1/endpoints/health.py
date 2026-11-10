from fastapi import APIRouter
from agent.app.schemas.health import HealthResponse
from agent.app.services.health_service import HealthService

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def get_health_status() -> HealthResponse:
    """Return health status and metadata for the AdPilot agent service."""
    return HealthService.get_health()

