"""
AdPilot AI - Creative Planning & Prompt Engineering Service
Converts MarketingStrategy + ProductData into validated, placement-aligned,
executable ImageCreativeBlueprints and VideoStoryboards with strict reference-image
preservation constraints and bounded regeneration.
"""

import time
import uuid
from typing import Dict, List, Optional

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.creative import (
    CreativeConcept,
    CreativePlan,
    CreativePlanDraft,
    CreativePlanRequest,
    CreativePlanResponse,
    CreativeValidationResult,
    ImageCreativeBlueprint,
    PlacementSpecification,
    ReferenceImageConstraints,
    VideoStoryboard,
)
from agent.app.schemas.strategy import GenerationMetadata
from agent.app.services.creative.placements import resolve_placement_spec
from agent.app.services.creative.planner_prompt_builder import (
    CREATIVE_PLANNER_SYSTEM_INSTRUCTION,
    build_creative_planning_prompt,
    build_creative_regeneration_prompt,
)
from agent.app.services.creative.prompt_templates import (
    render_image_generation_prompt,
    render_video_generation_prompt,
)
from agent.app.services.creative.reference_constraints import build_reference_constraints
from agent.app.services.creative.validator import CreativePlanValidator
from agent.app.services.strategy.gemini_client import GeminiStrategyClient


class CreativePlanningService:
    """Orchestrates creative blueprint compilation, prompt templating, and validation."""

    def __init__(
        self,
        gemini_client: Optional[GeminiStrategyClient] = None,
        max_regenerations: Optional[int] = None,
    ):
        self.gemini_client = gemini_client or GeminiStrategyClient()
        self.max_regenerations = (
            max_regenerations if max_regenerations is not None else settings.GEMINI_MAX_REGENERATIONS
        )

    @staticmethod
    def _build_placement_specs(request: CreativePlanRequest) -> List[PlacementSpecification]:
        specs: List[PlacementSpecification] = []
        for placement in request.placements:
            for fmt in request.formats:
                specs.append(
                    resolve_placement_spec(
                        placement=placement,
                        fmt=fmt,
                        requested_duration=request.target_video_duration if fmt == "video" else None,
                    )
                )
        return specs

    @staticmethod
    def _compile_plan(
        draft: CreativePlanDraft,
        request: CreativePlanRequest,
        constraints: ReferenceImageConstraints,
        placement_specs: List[PlacementSpecification],
    ) -> CreativePlan:
        """Transform Gemini CreativePlanDraft into fully compiled executable blueprints."""
        spec_lookup: Dict[tuple[str, str], PlacementSpecification] = {
            (spec.placement, spec.format): spec for spec in placement_specs
        }

        brand_constraints = [
            constraints.preserve_logo,
            constraints.preserve_color_and_finish,
            constraints.preserve_buttons_and_controls,
            *request.strategy.recommendations.creative_dos[:3],
        ]
        concepts: List[CreativeConcept] = []

        for img_draft in draft.image_concepts:
            norm_place = img_draft.placement.strip().lower()
            spec = spec_lookup.get((norm_place, "image")) or resolve_placement_spec(norm_place, "image")
            gen_prompt = render_image_generation_prompt(
                draft=img_draft,
                product=request.product_data,
                placement_spec=spec,
                constraints=constraints,
            )
            blueprint = ImageCreativeBlueprint(
                concept_id=img_draft.concept_id,
                creative_title=img_draft.creative_title,
                marketing_angle=img_draft.marketing_angle_name,
                audience_hypothesis=img_draft.audience_hypothesis,
                creative_objective=img_draft.creative_objective,
                hook=img_draft.hook,
                main_message=img_draft.main_message,
                visual_composition=img_draft.visual_composition,
                background_direction=img_draft.background_direction,
                lighting_direction=img_draft.lighting_direction,
                product_positioning=img_draft.product_positioning,
                camera_perspective=img_draft.camera_perspective,
                brand_constraints=brand_constraints,
                negative_instructions=list(dict.fromkeys(constraints.prohibited_inventions + img_draft.extra_negative_instructions)),
                reference_constraints=constraints,
                aspect_ratio=spec.aspect_ratio,
                placement=img_draft.placement,
                placement_spec=spec,
                image_generation_prompt=gen_prompt,
            )
            concepts.append(
                CreativeConcept(
                    concept_id=img_draft.concept_id,
                    creative_title=img_draft.creative_title,
                    format="image",
                    marketing_angle_id=img_draft.marketing_angle_id,
                    marketing_angle_name=img_draft.marketing_angle_name,
                    audience_hypothesis=img_draft.audience_hypothesis,
                    creative_objective=img_draft.creative_objective,
                    creative_direction_summary=img_draft.creative_direction_summary,
                    placement=img_draft.placement,
                    image_blueprint=blueprint,
                    video_storyboard=None,
                )
            )

        for vid_draft in draft.video_concepts:
            norm_place = vid_draft.placement.strip().lower()
            spec = spec_lookup.get((norm_place, "video")) or resolve_placement_spec(
                norm_place, "video", request.target_video_duration
            )
            gen_prompt = render_video_generation_prompt(
                draft=vid_draft,
                product=request.product_data,
                placement_spec=spec,
                constraints=constraints,
            )
            storyboard = VideoStoryboard(
                concept_id=vid_draft.concept_id,
                creative_title=vid_draft.creative_title,
                marketing_angle=vid_draft.marketing_angle_name,
                audience_hypothesis=vid_draft.audience_hypothesis,
                video_objective=vid_draft.video_objective,
                total_duration=vid_draft.total_duration,
                aspect_ratio=spec.aspect_ratio,
                placement=vid_draft.placement,
                placement_spec=spec,
                opening_hook=vid_draft.opening_hook,
                scene_sequence=vid_draft.scene_sequence,
                final_cta=vid_draft.final_cta,
                brand_constraints=brand_constraints,
                negative_instructions=list(dict.fromkeys(constraints.prohibited_inventions + vid_draft.extra_negative_instructions)),
                reference_constraints=constraints,
                video_generation_prompt=gen_prompt,
            )
            concepts.append(
                CreativeConcept(
                    concept_id=vid_draft.concept_id,
                    creative_title=vid_draft.creative_title,
                    format="video",
                    marketing_angle_id=vid_draft.marketing_angle_id,
                    marketing_angle_name=vid_draft.marketing_angle_name,
                    audience_hypothesis=vid_draft.audience_hypothesis,
                    creative_objective=vid_draft.video_objective,
                    creative_direction_summary=vid_draft.creative_direction_summary,
                    placement=vid_draft.placement,
                    image_blueprint=None,
                    video_storyboard=storyboard,
                )
            )

        return CreativePlan(
            plan_id=f"cplan_{uuid.uuid4().hex[:10]}",
            product_name=request.product_data.product_name,
            brand=request.product_data.brand,
            concepts=concepts,
            reference_constraints=constraints,
            placement_specs=placement_specs,
            planning_notes=draft.planning_notes,
        )

    async def plan_creatives(
        self,
        request: CreativePlanRequest,
    ) -> CreativePlanResponse:
        """
        Generate, compile, and validate executable image blueprints and video storyboards
        with bounded corrective regeneration on validation failures.
        """
        overall_start = time.time()
        constraints = build_reference_constraints(request.product_data, request.strategy)
        placement_specs = self._build_placement_specs(request)

        base_prompt = build_creative_planning_prompt(
            product=request.product_data,
            strategy=request.strategy,
            user_prompt=request.user_prompt,
            formats=request.formats,
            placement_specs=placement_specs,
            constraints=constraints,
            target_video_duration=request.target_video_duration,
        )

        current_prompt = base_prompt
        last_validation: Optional[CreativeValidationResult] = None
        last_meta: Optional[GenerationMetadata] = None
        total_prompt_tokens = 0
        total_candidates_tokens = 0
        total_tokens = 0
        total_attempts = 0
        regenerations_performed = 0

        for regen_idx in range(self.max_regenerations + 1):
            if regen_idx > 0:
                regenerations_performed = regen_idx

            draft, meta = await self.gemini_client.generate_structured(
                prompt_text=current_prompt,
                response_schema=CreativePlanDraft,
                system_instruction=CREATIVE_PLANNER_SYSTEM_INSTRUCTION,
                temperature=0.35,
            )

            total_attempts += meta.attempts
            if meta.prompt_tokens:
                total_prompt_tokens += meta.prompt_tokens
            if meta.candidates_tokens:
                total_candidates_tokens += meta.candidates_tokens
            if meta.total_tokens:
                total_tokens += meta.total_tokens
            last_meta = meta

            compiled_plan = self._compile_plan(draft, request, constraints, placement_specs)

            validation = CreativePlanValidator.validate(
                plan=compiled_plan,
                product=request.product_data,
                strategy=request.strategy,
                requested_formats=request.formats,
                requested_placements=request.placements,
                target_video_duration=request.target_video_duration,
            )
            last_validation = validation

            if validation.passed:
                overall_ms = round((time.time() - overall_start) * 1000, 2)
                final_meta = GenerationMetadata(
                    model_name=last_meta.model_name,
                    model_version=last_meta.model_version,
                    response_id=last_meta.response_id,
                    prompt_tokens=total_prompt_tokens or None,
                    candidates_tokens=total_candidates_tokens or None,
                    total_tokens=total_tokens or None,
                    latency_ms=overall_ms,
                    attempts=total_attempts,
                    regenerations=regenerations_performed,
                    multimodal_images_used=0,
                )
                return CreativePlanResponse(
                    success=True,
                    plan=compiled_plan,
                    validation=validation,
                    generation_metadata=final_meta,
                    warnings=[],
                    error=None,
                )

            error_issues = [i for i in validation.issues if i.severity == "error"]
            logger.warning(
                f"CreativePlan failed validation on round {regen_idx + 1}: {[i.code for i in error_issues]}"
            )
            if regen_idx < self.max_regenerations:
                current_prompt = build_creative_regeneration_prompt(base_prompt, error_issues)

        overall_ms = round((time.time() - overall_start) * 1000, 2)
        final_meta = GenerationMetadata(
            model_name=last_meta.model_name if last_meta else self.gemini_client.model_name,
            model_version=last_meta.model_version if last_meta else None,
            response_id=last_meta.response_id if last_meta else None,
            prompt_tokens=total_prompt_tokens or None,
            candidates_tokens=total_candidates_tokens or None,
            total_tokens=total_tokens or None,
            latency_ms=overall_ms,
            attempts=total_attempts,
            regenerations=regenerations_performed,
            multimodal_images_used=0,
        )

        error_summary = "; ".join(
            i.message for i in (last_validation.issues if last_validation else []) if i.severity == "error"
        )
        return CreativePlanResponse(
            success=False,
            plan=None,
            validation=last_validation,
            generation_metadata=final_meta,
            warnings=[],
            error=f"Creative plan failed validation after {regenerations_performed} regeneration(s): {error_summary}",
        )


creative_planning_service = CreativePlanningService()

