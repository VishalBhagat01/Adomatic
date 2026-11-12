"""
AdPilot AI - Independent Evaluation, Regeneration, & Ad Copy API Endpoints (Step 09)
POST /api/v1/evaluations/evaluate
POST /api/v1/evaluations/copy
POST /api/v1/evaluations/evaluate-and-regenerate
"""

from fastapi import APIRouter, Depends, HTTPException, status

from agent.app.core.logging import logger
from agent.app.schemas.evaluation import (
    AdCopyGenerateRequest,
    CreativeEvaluation,
    CreativeEvaluationRequest,
    EvaluateAndRegenerateRequest,
    EvaluateAndRegenerateResponse,
    ValidatedAdCopy,
)
from agent.app.services.evaluation import (
    AdCopyPreconditionError,
    AdCopyService,
    CreativeAssetRetrievalError,
    CreativeEvaluationService,
    EvaluationRegenerationService,
    ad_copy_service,
    creative_evaluation_service,
    evaluation_regeneration_service,
)
from agent.app.services.image_gen.generation_service import BlueprintValidationError
from agent.app.services.image_gen.reference_selector import ReferenceSelectionError
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)
from agent.app.services.video_gen.scene_prompt_builder import StoryboardValidationError

router = APIRouter(prefix="/evaluations", tags=["Creative Evaluation & Ad Copy"])


def get_creative_evaluation_service() -> CreativeEvaluationService:
    return creative_evaluation_service


def get_ad_copy_service() -> AdCopyService:
    return ad_copy_service


def get_evaluation_regeneration_service() -> EvaluationRegenerationService:
    return evaluation_regeneration_service


@router.post(
    "/evaluate",
    response_model=CreativeEvaluation,
    status_code=status.HTTP_200_OK,
    summary="Independently evaluate an existing image or video creative",
    description=(
        "Audits an existing image or video asset without triggering regeneration. "
        "Combines Gemini multimodal inspection, deterministic technical validation, "
        "ClaimValidator text compliance, weighted 10-criterion scoring, and hard rejection gates."
    ),
)
async def evaluate_creative(
    request: CreativeEvaluationRequest,
    service: CreativeEvaluationService = Depends(get_creative_evaluation_service),
) -> CreativeEvaluation:
    logger.info(
        f"Evaluating {request.format} creative '{request.creative_id}' "
        f"(campaign={request.campaign_id}, attempt={request.attempt_number})"
    )
    try:
        return await service.evaluate_creative(request)
    except CreativeAssetRetrievalError as asset_err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": str(asset_err), "code": "EVALUATION_ASSET_RETRIEVAL_ERROR"},
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
                "code": "GEMINI_EVALUATION_EXECUTION_ERROR",
                "model_name": exec_err.model_name,
                "status_code": exec_err.status_code,
            },
        )
    except Exception as exc:
        logger.exception("Unexpected failure during creative evaluation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": f"Creative evaluation failed: {exc}", "code": "EVALUATION_INTERNAL_ERROR"},
        )


@router.post(
    "/copy",
    response_model=ValidatedAdCopy,
    status_code=status.HTTP_200_OK,
    summary="Generate claim-verified advertising copy for an approved creative",
    description=(
        "Enforces creative_evaluation.approved == True, generates 3 primary texts, "
        "3 headlines, 2 descriptions, CTA, creative angle, and audience hypothesis, "
        "and audits every variant via ClaimValidator."
    ),
)
async def generate_ad_copy(
    request: AdCopyGenerateRequest,
    service: AdCopyService = Depends(get_ad_copy_service),
) -> ValidatedAdCopy:
    logger.info(
        f"Generating ad copy for creative '{request.creative_id}' (campaign={request.campaign_id})"
    )
    try:
        result = await service.generate_copy(request)
    except AdCopyPreconditionError as pre_err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": str(pre_err), "code": "UNAPPROVED_CREATIVE_REJECTED"},
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
                "code": "GEMINI_COPY_EXECUTION_ERROR",
                "model_name": exec_err.model_name,
                "status_code": exec_err.status_code,
            },
        )
    except Exception as exc:
        logger.exception("Unexpected failure during ad copy generation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": f"Ad copy generation failed: {exc}", "code": "AD_COPY_INTERNAL_ERROR"},
        )

    if not result.approved:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "Generated ad copy failed deterministic claim validation checks.",
                "code": "AD_COPY_CLAIM_AUDIT_FAILED",
                "rejected_claim_flags": [flag.model_dump(mode="json") for flag in result.rejected_claim_flags],
            },
        )
    return result


@router.post(
    "/evaluate-and-regenerate",
    response_model=EvaluateAndRegenerateResponse,
    status_code=status.HTTP_200_OK,
    summary="Evaluate creative, execute bounded prompt-repaired regeneration, and generate copy",
    description=(
        "Evaluates initial creative; if rejected and regeneration budget remains, repairs "
        "prompt/constraints from failure feedback, regenerates candidate asset, preserves all "
        "versions and cumulative generation costs, and generates claim-verified ad copy upon approval."
    ),
)
async def evaluate_and_regenerate_creative(
    request: EvaluateAndRegenerateRequest,
    service: EvaluationRegenerationService = Depends(get_evaluation_regeneration_service),
) -> EvaluateAndRegenerateResponse:
    logger.info(
        f"Evaluate & regenerate request for {request.format} creative '{request.creative_id}' "
        f"(campaign={request.campaign_id}, max_regenerations={request.max_regenerations})"
    )
    try:
        return await service.evaluate_and_regenerate(request)
    except (
        CreativeAssetRetrievalError,
        AdCopyPreconditionError,
        BlueprintValidationError,
        StoryboardValidationError,
        ReferenceSelectionError,
    ) as input_err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": str(input_err), "code": "EVALUATE_REGENERATE_INPUT_ERROR"},
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
                "code": "GEMINI_EXECUTION_ERROR",
                "model_name": exec_err.model_name,
                "status_code": exec_err.status_code,
            },
        )
    except Exception as exc:
        logger.exception("Unexpected failure during evaluation-regeneration orchestration")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": f"Evaluate-and-regenerate workflow failed: {exc}",
                "code": "EVALUATE_REGENERATE_INTERNAL_ERROR",
            },
        )

