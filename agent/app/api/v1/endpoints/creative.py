"""
AdPilot AI - Creative Planning & Prompt Engineering Endpoint
POST /api/v1/creative/plan
Converts MarketingStrategy + ProductData into validated, executable ImageCreativeBlueprints
and VideoStoryboards ready for image/video generation pipelines.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from agent.app.core.logging import logger
from agent.app.schemas.creative import (
    CreativePlanRequest,
    CreativePlanResponse,
)
from agent.app.services.creative.planning_service import (
    CreativePlanningService,
    creative_planning_service,
)
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)

router = APIRouter(prefix="/creative", tags=["Creative Planning"])


def get_creative_planning_service() -> CreativePlanningService:
    """FastAPI dependency returning the CreativePlanningService."""
    return creative_planning_service


@router.post(
    "/plan",
    response_model=CreativePlanResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate executable image blueprints and video storyboards",
    description=(
        "Translates MarketingStrategy and verified ProductData into differentiated "
        "ImageCreativeBlueprints and time-validated VideoStoryboards with strict "
        "reference-image preservation constraints and optimized prompts."
    ),
)
async def plan_creatives(
    request: CreativePlanRequest,
    service: CreativePlanningService = Depends(get_creative_planning_service),
) -> CreativePlanResponse:
    logger.info(
        f"Received creative planning request for product '{request.product_data.product_name}'",
        extra={
            "extra": {
                "formats": request.formats,
                "placements": request.placements,
                "target_video_duration": request.target_video_duration,
                "model": service.gemini_client.model_name,
            }
        },
    )

    try:
        result = await service.plan_creatives(request)
    except GeminiConfigurationError as cfg_err:
        logger.error(f"Gemini configuration error during creative planning: {cfg_err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": str(cfg_err),
                "code": "GEMINI_CONFIGURATION_ERROR",
            },
        )
    except GeminiExecutionError as exec_err:
        logger.error(f"Gemini execution error during creative planning on '{exec_err.model_name}': {exec_err}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": str(exec_err),
                "code": "GEMINI_EXECUTION_ERROR",
                "model_name": exec_err.model_name,
                "status_code": exec_err.status_code,
                "attempts": exec_err.attempts,
            },
        )

    if not result.success:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=result.model_dump(mode="json"),
        )

    return result

