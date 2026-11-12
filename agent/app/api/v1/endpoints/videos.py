"""
AdPilot AI - Asynchronous Video Generation & FFmpeg Assembly Endpoints (Step 08)
POST /api/v1/videos/generate
GET  /api/v1/videos/jobs/{job_id}
POST /api/v1/videos/jobs/{job_id}/resume
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.video_gen import (
    VideoGenerationJobResponse,
    VideoGenerationRequest,
)
from agent.app.services.image_gen.reference_selector import ReferenceSelectionError
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)
from agent.app.services.video_gen.scene_prompt_builder import StoryboardValidationError
from agent.app.services.video_gen.video_service import (
    VideoGenerationService,
    VideoJobNotFoundError,
    video_generation_service,
)

router = APIRouter(prefix="/videos", tags=["Video Generation"])


def get_video_generation_service() -> VideoGenerationService:
    """FastAPI dependency returning the VideoGenerationService."""
    return video_generation_service


@router.post(
    "/generate",
    response_model=VideoGenerationJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit async Veo storyboard video generation and FFmpeg assembly job",
    description=(
        "Validates VideoStoryboard, selects authentic product references, persists scene job "
        "state and operation IDs for crash recovery, and triggers background Veo clip generation, "
        "validation, subtitle/voiceover/CTA FFmpeg assembly, and MinIO/S3 export."
    ),
)
async def generate_video(
    request: VideoGenerationRequest,
    response: Response,
    service: VideoGenerationService = Depends(get_video_generation_service),
) -> VideoGenerationJobResponse:
    if not settings.ENABLE_VIDEO_GENERATION:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "Video generation is currently disabled (ENABLE_VIDEO_GENERATION=false). Use image-only campaign formats.",
                "code": "VIDEO_GENERATION_DISABLED",
            },
        )

    logger.info(
        f"Received video generation request for campaign '{request.campaign_id}', "
        f"concept '{request.storyboard.concept_id}', sync={request.execute_sync}",
        extra={
            "extra": {
                "scenes": len(request.storyboard.scene_sequence),
                "total_duration": request.storyboard.total_duration,
                "model_identifier": service.veo_client.model_name,
            }
        },
    )

    try:
        job = await service.submit_job(request)
    except (StoryboardValidationError, ReferenceSelectionError) as input_err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": str(input_err), "code": "VIDEO_INPUT_VALIDATION_ERROR"},
        )
    except GeminiConfigurationError as cfg_err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": str(cfg_err), "code": "GEMINI_CONFIGURATION_ERROR"},
        )
    except GeminiExecutionError as exec_err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error": str(exec_err),
                "code": "VEO_EXECUTION_ERROR",
                "model_name": exec_err.model_name,
                "status_code": exec_err.status_code,
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": str(exc), "code": "VIDEO_GENERATION_FAILED"},
        )

    if request.execute_sync:
        if job.status == "FAILED":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=job.model_dump(mode="json"),
            )
        response.status_code = status.HTTP_200_OK

    return job


@router.get(
    "/jobs/{job_id}",
    response_model=VideoGenerationJobResponse,
    status_code=status.HTTP_200_OK,
    summary="Inspect persisted video generation job status and output artifact links",
)
async def get_video_job(
    job_id: str,
    service: VideoGenerationService = Depends(get_video_generation_service),
) -> VideoGenerationJobResponse:
    job = service.get_job_status(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": f"Video job '{job_id}' not found", "code": "VIDEO_JOB_NOT_FOUND"},
        )
    return job


@router.post(
    "/jobs/{job_id}/resume",
    response_model=VideoGenerationJobResponse,
    status_code=status.HTTP_200_OK,
    summary="Resume an interrupted video job after worker restart using saved operation IDs",
)
async def resume_video_job(
    job_id: str,
    service: VideoGenerationService = Depends(get_video_generation_service),
) -> VideoGenerationJobResponse:
    if not settings.ENABLE_VIDEO_GENERATION:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "Video generation is currently disabled (ENABLE_VIDEO_GENERATION=false).",
                "code": "VIDEO_GENERATION_DISABLED",
            },
        )

    try:
        return await service.resume_job(job_id)
    except VideoJobNotFoundError as not_found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": str(not_found), "code": "VIDEO_JOB_NOT_FOUND"},
        )
    except GeminiExecutionError as exec_err:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"error": str(exec_err), "code": "VEO_EXECUTION_ERROR", "model_name": exec_err.model_name},
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": str(exc), "code": "VIDEO_RESUME_FAILED"},
        )

