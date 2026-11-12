"""
AdPilot AI - Product Understanding & Marketing Strategy API Endpoint
POST /api/v1/strategy/generate
Analyzes validated ProductData, reference images, and user creative brief using Gemini
with structured output enforcement, claim validation, and quality gates.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from agent.app.core.logging import logger
from agent.app.schemas.strategy import (
    StrategyGenerateRequest,
    StrategyGenerateResponse,
)
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)
from agent.app.services.strategy.strategy_service import (
    MarketingStrategyService,
    strategy_service,
)

router = APIRouter(prefix="/strategy", tags=["Marketing Strategy"])


def get_strategy_service() -> MarketingStrategyService:
    """FastAPI dependency returning the configured MarketingStrategyService."""
    return strategy_service


@router.post(
    "/generate",
    response_model=StrategyGenerateResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate grounded product knowledge and marketing strategy",
    description=(
        "Uses Google Gemini structured output to build ProductKnowledge, AudiencePersonas, "
        "ClaimValidations, 3-5 MarketingAngles, and placement recommendations from validated ProductData."
    ),
)
async def generate_strategy(
    request: StrategyGenerateRequest,
    service: MarketingStrategyService = Depends(get_strategy_service),
) -> StrategyGenerateResponse:
    logger.info(
        f"Received marketing strategy generation request for product '{request.product_data.product_name}'",
        extra={
            "extra": {
                "formats": request.formats,
                "placements": request.placements,
                "model": service.gemini_client.model_name,
            }
        },
    )

    try:
        result = await service.generate_marketing_strategy(request)
    except GeminiConfigurationError as cfg_err:
        logger.error(f"Gemini configuration error: {cfg_err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": str(cfg_err),
                "code": "GEMINI_CONFIGURATION_ERROR",
            },
        )
    except GeminiExecutionError as exec_err:
        logger.error(f"Gemini execution error on model '{exec_err.model_name}': {exec_err}")
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
