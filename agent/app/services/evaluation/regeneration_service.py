"""
AdPilot AI - Controlled Evaluation & Bounded Regeneration Orchestrator (Step 09)
Evaluates an initial image or video creative, applies prompt-level failure repairs
from Evaluation feedback for up to `max_regenerations` attempts (hard-capped at <= 3),
preserves all rejected & approved asset versions/costs/evaluations, and triggers
claim-verified AdCopyService once a creative is approved.
"""

import base64
from typing import List, Optional
import uuid

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.creative import ImageCreativeBlueprint, VideoStoryboard
from agent.app.schemas.evaluation import (
    AdCopyGenerateRequest,
    CreativeEvaluation,
    CreativeEvaluationRequest,
    EvaluateAndRegenerateRequest,
    EvaluateAndRegenerateResponse,
    RegenerationAttemptRecord,
    RegenerationInstruction,
    ValidatedAdCopy,
)
from agent.app.schemas.image_gen import ImageGenerationRequest
from agent.app.schemas.video_gen import VideoGenerationRequest
from agent.app.services.evaluation.ad_copy_service import AdCopyService, ad_copy_service
from agent.app.services.evaluation.evaluator_service import (
    CreativeEvaluationService,
    creative_evaluation_service,
)
from agent.app.services.image_gen.generation_service import (
    ImageGenerationService,
    image_generation_service,
)
from agent.app.services.storage import AgentStorage, agent_storage
from agent.app.services.video_gen.video_service import (
    VideoGenerationService,
    video_generation_service,
)


class EvaluationRegenerationService:
    """Orchestrates bounded regeneration and post-approval ad copy generation."""

    def __init__(
        self,
        evaluator_service: Optional[CreativeEvaluationService] = None,
        copy_service: Optional[AdCopyService] = None,
        image_service: Optional[ImageGenerationService] = None,
        video_service: Optional[VideoGenerationService] = None,
        storage: Optional[AgentStorage] = None,
    ):
        self.evaluator = evaluator_service or creative_evaluation_service
        self.copy_service = copy_service or ad_copy_service
        self.image_service = image_service or image_generation_service
        self.video_service = video_service or video_generation_service
        self.storage = storage or self.evaluator.storage or agent_storage

    def _apply_image_repairs(
        self,
        blueprint: ImageCreativeBlueprint,
        instruction: RegenerationInstruction,
    ) -> ImageCreativeBlueprint:
        repaired = blueprint.model_copy(deep=True)
        repaired.image_generation_prompt.positive_prompt = instruction.revised_positive_prompt
        repaired.image_generation_prompt.negative_prompt = instruction.revised_negative_prompt
        for adj in instruction.prompt_adjustments[:4]:
            if adj not in repaired.negative_instructions:
                repaired.negative_instructions.append(adj)
        return repaired

    def _apply_video_repairs(
        self,
        storyboard: VideoStoryboard,
        instruction: RegenerationInstruction,
    ) -> VideoStoryboard:
        repaired = storyboard.model_copy(deep=True)
        repaired.video_generation_prompt.positive_prompt = instruction.revised_positive_prompt
        repaired.video_generation_prompt.negative_prompt = instruction.revised_negative_prompt
        for adj in instruction.prompt_adjustments[:4]:
            if adj not in repaired.negative_instructions:
                repaired.negative_instructions.append(adj)
        if repaired.scene_sequence:
            fix_hint = "; ".join(instruction.prompt_adjustments[:2])
            if fix_hint:
                repaired.scene_sequence[0].product_visibility = (
                    f"{repaired.scene_sequence[0].product_visibility} (Fix: {fix_hint})"
                )
        return repaired

    def _resolve_candidate_source(
        self,
        object_key: Optional[str],
        generator_service: object,
    ) -> Optional[str]:
        """Return base64 bytes if object_key resides in generator storage or shared storage."""
        if not object_key:
            return None
        for candidate_storage in (
            getattr(self.evaluator, "storage", None),
            getattr(generator_service, "storage", None),
            self.storage,
        ):
            if candidate_storage is None:
                continue
            raw = candidate_storage.download_bytes(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=object_key,
            )
            if raw:
                return base64.b64encode(raw).decode("ascii")
        return None

    async def evaluate_and_regenerate(
        self,
        request: EvaluateAndRegenerateRequest,
    ) -> EvaluateAndRegenerateResponse:
        """
        Evaluate initial creative; regenerate with failure-aware prompt updates up to
        max_regenerations while keeping full version/cost audit trail; generate validated
        ad copy upon approval.
        """
        configured_cap = (
            settings.EVALUATION_MAX_REGENERATIONS
            if request.max_regenerations is None
            else request.max_regenerations
        )
        max_retries = min(max(0, configured_cap), 3)

        working_bp = request.image_blueprint.model_copy(deep=True) if request.image_blueprint else None
        working_sb = request.video_storyboard.model_copy(deep=True) if request.video_storyboard else None

        current_creative_id = request.creative_id
        current_object_key = request.object_key
        current_b64 = request.creative_base64

        attempt_history: List[RegenerationAttemptRecord] = []
        warnings: List[str] = []
        errors: List[str] = []
        total_cost_usd = 0.0
        regenerations_performed = 0

        # Attempt 1: Independent evaluation of the supplied asset
        current_eval: CreativeEvaluation = await self.evaluator.evaluate_creative(
            CreativeEvaluationRequest(
                campaign_id=request.campaign_id,
                creative_id=current_creative_id,
                format=request.format,
                product_data=request.product_data,
                marketing_strategy=request.marketing_strategy,
                image_blueprint=working_bp,
                video_storyboard=working_sb,
                creative_base64=current_b64,
                object_key=current_object_key,
                reference_image_urls=request.reference_image_urls,
                weights=request.weights,
                approval_threshold=request.approval_threshold,
                attempt_number=1,
            )
        )
        attempt_history.append(
            RegenerationAttemptRecord(
                attempt_number=1,
                creative_id=current_creative_id,
                object_key=current_object_key,
                generation_cost_usd=0.0,
                evaluation=current_eval,
                regeneration_instruction=current_eval.regeneration_instruction,
            )
        )

        # Bounded controlled regeneration loop
        while not current_eval.approved and regenerations_performed < max_retries:
            regenerations_performed += 1
            next_attempt = regenerations_performed + 1
            instruction = current_eval.regeneration_instruction
            if instruction is None:
                warnings.append(
                    f"Missing regeneration_instruction at attempt {regenerations_performed}; stopping loop."
                )
                break

            logger.info(
                "Triggering controlled %s regeneration attempt %d/%d for concept=%s (prev_score=%.1f, hard=%s)",
                request.format,
                next_attempt,
                max_retries + 1,
                current_eval.concept_id,
                current_eval.overall_weighted_score,
                current_eval.hard_rejection_triggered,
            )

            attempt_cost = 0.0
            if request.format == "image":
                assert working_bp is not None
                working_bp = self._apply_image_repairs(working_bp, instruction)
                aspect_choice = (
                    working_bp.placement_spec.aspect_ratio
                    if working_bp.placement_spec.aspect_ratio in {"1:1", "4:5", "9:16"}
                    else None
                )
                gen_resp = await self.image_service.generate_creatives(
                    ImageGenerationRequest(
                        campaign_id=request.campaign_id,
                        blueprint=working_bp,
                        marketing_strategy=request.marketing_strategy,
                        product_data=request.product_data,
                        aspect_ratio=aspect_choice,  # type: ignore[arg-type]
                        num_variations=1,
                        reference_image_urls=request.reference_image_urls,
                    )
                )
                if not gen_resp.assets:
                    errors.append(
                        f"Image regeneration attempt {next_attempt} returned no assets: {gen_resp.errors}"
                    )
                    break
                chosen_asset = next((a for a in gen_resp.assets if a.approved), gen_resp.assets[0])
                attempt_cost = float(
                    gen_resp.total_estimated_cost_usd or chosen_asset.cost.estimated_cost_usd
                )
                total_cost_usd += attempt_cost
                current_creative_id = chosen_asset.creative_id
                current_object_key = chosen_asset.overlay_object_key or chosen_asset.object_key
                current_b64 = self._resolve_candidate_source(current_object_key, self.image_service)
            else:
                assert working_sb is not None
                working_sb = self._apply_video_repairs(working_sb, instruction)
                vid_resp = await self.video_service.submit_job(
                    VideoGenerationRequest(
                        campaign_id=request.campaign_id,
                        storyboard=working_sb,
                        product_data=request.product_data,
                        reference_image_urls=request.reference_image_urls,
                        execute_sync=True,
                    )
                )
                attempt_cost = float(vid_resp.total_estimated_cost_usd)
                total_cost_usd += attempt_cost
                if not vid_resp.final_video:
                    errors.append(
                        f"Video regeneration attempt {next_attempt} produced no final video: {vid_resp.errors}"
                    )
                    break
                current_creative_id = vid_resp.final_video.video_id
                current_object_key = vid_resp.final_video.object_key
                current_b64 = self._resolve_candidate_source(current_object_key, self.video_service)

            if not (current_b64 or current_object_key):
                errors.append(
                    f"Regenerated creative '{current_creative_id}' has no retrievable bytes or object_key."
                )
                break

            current_eval = await self.evaluator.evaluate_creative(
                CreativeEvaluationRequest(
                    campaign_id=request.campaign_id,
                    creative_id=current_creative_id,
                    format=request.format,
                    product_data=request.product_data,
                    marketing_strategy=request.marketing_strategy,
                    image_blueprint=working_bp,
                    video_storyboard=working_sb,
                    creative_base64=current_b64,
                    object_key=current_object_key,
                    reference_image_urls=request.reference_image_urls,
                    weights=request.weights,
                    approval_threshold=request.approval_threshold,
                    attempt_number=next_attempt,
                )
            )
            attempt_history.append(
                RegenerationAttemptRecord(
                    attempt_number=next_attempt,
                    creative_id=current_creative_id,
                    object_key=current_object_key,
                    generation_cost_usd=round(attempt_cost, 6),
                    evaluation=current_eval,
                    regeneration_instruction=current_eval.regeneration_instruction,
                )
            )

        if not current_eval.approved:
            warnings.append(
                f"Creative remained rejected after {regenerations_performed} regeneration attempt(s) "
                f"(cap={max_retries})."
            )

        validated_ad_copy: Optional[ValidatedAdCopy] = None
        if current_eval.approved and request.generate_ad_copy_on_approval:
            validated_ad_copy = await self.copy_service.generate_copy(
                AdCopyGenerateRequest(
                    campaign_id=request.campaign_id,
                    creative_id=current_creative_id,
                    creative_evaluation=current_eval,
                    product_data=request.product_data,
                    marketing_strategy=request.marketing_strategy,
                    image_blueprint=working_bp,
                    video_storyboard=working_sb,
                    creative_base64=current_b64,
                    object_key=current_object_key,
                )
            )
            if not validated_ad_copy.approved:
                errors.append(
                    "Generated ad copy failed deterministic ClaimValidator checks after bounded retry."
                )

        overall_success = bool(
            current_eval.approved and (validated_ad_copy is None or validated_ad_copy.approved)
        )

        response = EvaluateAndRegenerateResponse(
            success=overall_success,
            campaign_id=request.campaign_id,
            concept_id=current_eval.concept_id,
            format=request.format,
            final_creative_id=current_creative_id,
            final_evaluation=current_eval,
            attempt_history=attempt_history,
            total_attempts=len(attempt_history),
            regenerations_performed=regenerations_performed,
            total_generation_cost_usd=round(total_cost_usd, 6),
            validated_ad_copy=validated_ad_copy,
            warnings=warnings,
            errors=errors,
        )

        summary_key = f"campaigns/{request.campaign_id}/evaluations/regeneration_{uuid.uuid4().hex[:10]}.json"
        self.storage.upload_json(
            bucket=settings.STORAGE_BUCKET_CREATIVES,
            object_key=summary_key,
            payload=response.model_dump(mode="json"),
        )
        return response


evaluation_regeneration_service = EvaluationRegenerationService()

