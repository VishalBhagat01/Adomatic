"""
AdPilot AI - Image Generation Endpoint (Step 07)
POST /api/v1/images/generate
Generates product-faithful commercial variations from an ImageCreativeBlueprint,
validates format/dimensions/duplicates/reference consistency, persists approved
and rejected outputs + metadata to object storage, and returns full asset details.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from agent.app.core.logging import logger
from agent.app.schemas.image_gen import (
    ImageGenerationRequest,
    ImageGenerationResponse,
)
from agent.app.services.image_gen.generation_service import (
    BlueprintValidationError,
    ImageGenerationService,
    image_generation_service,
)
from agent.app.services.image_gen.reference_selector import ReferenceSelectionError
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)

router = APIRouter(prefix="/images", tags=["Image Generation"])


def get_image_generation_service() -> ImageGenerationService:
    """FastAPI dependency returning the ImageGenerationService."""
    return image_generation_service


@router.post(
    "/generate",
    response_model=ImageGenerationResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate validated commercial product ad images via Gemini",
    description=(
        "Executes the 10-step image generation pipeline: validates ImageCreativeBlueprint, "
        "selects top product references, compiles product-locked prompts, invokes configured "
        "Gemini image model, validates quality/aspect/duplicates/reference similarity, and "
        "stores both approved and rejected assets + metadata in object storage."
    ),
)
async def generate_images(
    request: ImageGenerationRequest,
    service: ImageGenerationService = Depends(get_image_generation_service),
) -> ImageGenerationResponse:
    logger.info(
        f"Received image generation request for campaign '{request.campaign_id}', "
        f"concept '{request.blueprint.concept_id}'",
        extra={
            "extra": {
                "variations": request.num_variations,
                "aspect_ratio": request.aspect_ratio or request.blueprint.aspect_ratio,
                "model_identifier": service.gemini_client.model_name,
            }
        },
    )

    try:
        result = await service.generate_creatives(request)
    except (BlueprintValidationError, ReferenceSelectionError) as input_err:
        logger.warning(f"Image generation pre-check failed: {input_err}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": str(input_err),
                "code": "IMAGE_GENERATION_INPUT_ERROR",
            },
        )
    except GeminiConfigurationError as cfg_err:
        logger.error(f"Gemini configuration error during image generation: {cfg_err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": str(cfg_err),
                "code": "GEMINI_CONFIGURATION_ERROR",
            },
        )
    except GeminiExecutionError as exec_err:
        logger.error(
            f"Gemini image API error on '{exec_err.model_name}': {exec_err}"
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": str(exec_err),
                "code": "GEMINI_IMAGE_EXECUTION_ERROR",
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

