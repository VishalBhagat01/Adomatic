"""
AdPilot AI - Independent Multimodal + Deterministic Creative Evaluation Engine (Step 09)
Evaluates generated image or video assets independently without regenerating them.
Combines Gemini multimodal inspection against original product references with
deterministic technical checks (Step 07/08 validators) and ClaimValidator text audits.
Strictly separates hard constraint violations from configurable weighted scoring.
"""

import base64
from pathlib import Path
import tempfile
from typing import List, Optional, Tuple
import uuid
import httpx
from google.genai import types

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.creative import PlacementSpecification
from agent.app.schemas.evaluation import (
    CreativeEvaluation,
    CreativeEvaluationRequest,
    CriterionEvaluationScore,
    EvaluationCriterionKey,
    EvaluationIssue,
    MultimodalEvaluationDraft,
    RegenerationInstruction,
)
from agent.app.schemas.image_gen import ImageValidationResult
from agent.app.schemas.video_gen import VideoValidationResult
from agent.app.services.creative.placements import resolve_placement_spec
from agent.app.services.extractor.ssrf import validate_safe_url
from agent.app.services.image_gen.quality_checker import ImageQualityChecker
from agent.app.services.image_gen.reference_selector import (
    LoadedReferenceImage,
    ReferenceImageSelector,
)
from agent.app.services.storage import AgentStorage, agent_storage
from agent.app.services.strategy.gemini_client import GeminiStrategyClient
from agent.app.services.video_gen.ffmpeg_processor import FFmpegProcessor
from agent.app.services.video_gen.video_validator import VideoQualityValidator
from agent.app.services.evaluation.claim_validator import ClaimValidator

EVALUATION_SYSTEM_INSTRUCTION = (
    "You are an independent multimodal Advertising Creative QA Auditor. "
    "Compare the generated image or video keyframes directly against the authentic "
    "product reference photos and ProductData specs. Be strictly objective: penalize "
    "wrong logos, altered product geometry/controls, invented features, wrong prices, "
    "unreadable text overlays, or misleading demonstrations. Never assume correctness."
)

CRITERIA_ORDER: Tuple[EvaluationCriterionKey, ...] = (
    "product_identity_fidelity",
    "product_geometry_feature_consistency",
    "logo_branding_accuracy",
    "visual_quality",
    "composition",
    "message_clarity",
    "marketing_angle_consistency",
    "placement_suitability",
    "text_readability",
    "misleading_content_compliance",
)


def _guess_image_mime(raw: bytes) -> str:
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw[:2] == b"\xff\xd8":
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


class CreativeAssetRetrievalError(ValueError):
    """Raised when an existing creative payload cannot be retrieved cleanly for audit."""


class CreativeEvaluationService:
    """Independent evaluation service auditing existing image or video creatives."""

    def __init__(
        self,
        gemini_client: Optional[GeminiStrategyClient] = None,
        reference_selector: Optional[ReferenceImageSelector] = None,
        image_checker: Optional[ImageQualityChecker] = None,
        ffmpeg_processor: Optional[FFmpegProcessor] = None,
        video_validator: Optional[VideoQualityValidator] = None,
        claim_validator: Optional[ClaimValidator] = None,
        storage: Optional[AgentStorage] = None,
    ):
        self.gemini_client = gemini_client or GeminiStrategyClient()
        self.reference_selector = reference_selector or ReferenceImageSelector()
        self.image_checker = image_checker or ImageQualityChecker()
        self.ffmpeg = ffmpeg_processor or FFmpegProcessor()
        self.video_validator = video_validator or VideoQualityValidator(ffmpeg=self.ffmpeg)
        self.claim_validator = claim_validator or ClaimValidator()
        self.storage = storage or agent_storage

    async def _load_creative_bytes(self, request: CreativeEvaluationRequest) -> bytes:
        if request.creative_base64:
            try:
                return base64.b64decode(request.creative_base64)
            except Exception as exc:
                raise CreativeAssetRetrievalError(f"Invalid creative_base64 payload: {exc}") from exc

        if request.object_key:
            data = self.storage.download_bytes(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=request.object_key,
            )
            if not data:
                raise CreativeAssetRetrievalError(
                    f"Could not download object '{request.object_key}' from storage."
                )
            return data

        if request.creative_url:
            is_safe, canonical, err = validate_safe_url(request.creative_url)
            if not is_safe or not canonical:
                raise CreativeAssetRetrievalError(f"Unsafe creative_url blocked: {err}")
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=False) as client:
                resp = await client.get(canonical)
            if resp.status_code != 200 or not resp.content:
                raise CreativeAssetRetrievalError(
                    f"Failed fetching creative_url '{canonical}': HTTP {resp.status_code}"
                )
            return resp.content

        raise CreativeAssetRetrievalError("No asset source available.")

    def _resolve_placement_spec(self, request: CreativeEvaluationRequest) -> PlacementSpecification:
        if request.placement_spec is not None:
            return request.placement_spec
        if request.format == "image" and request.image_blueprint is not None:
            return request.image_blueprint.placement_spec
        if request.format == "video" and request.video_storyboard is not None:
            return request.video_storyboard.placement_spec
        return resolve_placement_spec("instagram_feed", request.format)

    def _build_audit_prompt(
        self,
        *,
        request: CreativeEvaluationRequest,
        placement_spec: PlacementSpecification,
        ref_count: int,
        asset_part_count: int,
        det_summary: str,
    ) -> str:
        bp = request.image_blueprint
        sb = request.video_storyboard
        concept_title = bp.creative_title if bp else sb.creative_title  # type: ignore[union-attr]
        marketing_angle = bp.marketing_angle if bp else sb.marketing_angle  # type: ignore[union-attr]
        target_msg = (
            f"Hook: {bp.hook} | Message: {bp.main_message}"
            if bp
            else f"Hook: {sb.opening_hook} | CTA: {sb.final_cta}"  # type: ignore[union-attr]
        )
        rc = bp.reference_constraints if bp else sb.reference_constraints  # type: ignore[union-attr]

        return f"""
Evaluate the generated {request.format.upper()} creative asset objectively across all 10 advertising QA criteria.

INPUT IMAGE ORDER IN MULTIMODAL PAYLOAD:
- First {ref_count} image(s): AUTHENTIC ORIGINAL PRODUCT REFERENCE PHOTOS.
- Next {asset_part_count} image(s): GENERATED CREATIVE ASSET (or video keyframes) UNDER AUDIT.

VERIFIED PRODUCT FACTS (GROUND TRUTH):
- Product Name: {request.product_data.product_name}
- Brand: {request.product_data.brand}
- Price: {request.product_data.price} {request.product_data.currency or ''} (MRP: {request.product_data.original_price}, Discount: {request.product_data.discount}%)
- Rating: {request.product_data.rating} ({request.product_data.review_count} reviews)
- Features: {'; '.join(request.product_data.features[:6])}
- Specifications: {request.product_data.specifications}

CREATIVE BRIEF & CONSTRAINTS:
- Concept: {concept_title}
- Marketing Angle: {marketing_angle}
- Intended Messaging: {target_msg}
- Placement: {placement_spec.placement} ({placement_spec.format}), Required Ratio: {placement_spec.aspect_ratio}, Safe Zones: {placement_spec.safe_zone_notes}
- Reference Preservation Rules:
  * Geometry: {rc.preserve_geometry}
  * Logo: {rc.preserve_logo}
  * Controls: {rc.preserve_buttons_and_controls}
  * Color/Finish: {rc.preserve_color_and_finish}
  * Prohibited Inventions: {rc.prohibited_inventions}

DETERMINISTIC TECHNICAL CHECKS ALREADY MEASURED:
{det_summary}

REQUIRED 10 CRITERIA (score each 0-100 independently):
1. product_identity_fidelity
2. product_geometry_feature_consistency
3. logo_branding_accuracy
4. visual_quality
5. composition
6. message_clarity
7. marketing_angle_consistency
8. placement_suitability
9. text_readability
10. misleading_content_compliance

HARD VIOLATION CODES (report in hard_violation_codes ONLY when clearly violated):
- INCORRECT_PRODUCT_LOGO
- MATERIALLY_ALTERED_PRODUCT
- FABRICATED_PRODUCT_SPECIFICATION
- INCORRECT_PROMOTIONAL_PRICE
- MISLEADING_PRODUCT_DEMONSTRATION
- INVALID_OUTPUT_DIMENSIONS

REQUIRED OUTPUT FIELDS IN JSON:
- `criterion_scores`: all 10 criteria above (keep each `reasoning` concise, under 15 words)
- `observed_visual_summary`: 1-2 sentence objective summary of scene, lighting, framing, and mood
- `observed_product_details`: objective visual comparison of product body, jar/parts, and logo against references
- `observed_visible_text`: transcribe ANY text overlays, badges, prices, or product labels actually visible
- `hard_violation_codes`, `hard_violation_reasons`, and `regeneration_hints`
Be honest about uncertainty — never rubber-stamp an altered product or wrong logo.
""".strip()

    def _build_regeneration_instruction(
        self,
        *,
        request: CreativeEvaluationRequest,
        issues: List[EvaluationIssue],
        draft: Optional[MultimodalEvaluationDraft],
    ) -> RegenerationInstruction:
        if request.format == "image" and request.image_blueprint is not None:
            orig_pos = request.image_blueprint.image_generation_prompt.positive_prompt
            orig_neg = request.image_blueprint.image_generation_prompt.negative_prompt
            rc = request.image_blueprint.reference_constraints
            est_cost = settings.GEMINI_IMAGE_ESTIMATED_COST_USD
        else:
            sb = request.video_storyboard
            orig_pos = sb.video_generation_prompt.positive_prompt  # type: ignore[union-attr]
            orig_neg = sb.video_generation_prompt.negative_prompt  # type: ignore[union-attr]
            rc = sb.reference_constraints  # type: ignore[union-attr]
            est_cost = round(sb.total_duration * settings.GEMINI_VIDEO_COST_PER_SECOND_USD, 4)  # type: ignore[union-attr]

        fixes = [i.suggested_fix or i.message for i in issues][:6]
        if draft and draft.regeneration_hints:
            for hint in draft.regeneration_hints[:4]:
                if hint not in fixes:
                    fixes.append(hint)

        codes_summary = [f"{i.code}: {i.message}" for i in issues]
        repair_clause = "CRITICAL FIXES REQUIRED: " + "; ".join(fixes) if fixes else "Strictly match attached reference product."

        return RegenerationInstruction(
            creative_id=request.creative_id,
            format=request.format,
            target_attempt=request.attempt_number + 1,
            issues_addressed=codes_summary,
            prompt_adjustments=fixes,
            revised_positive_prompt=f"{orig_pos}\n{repair_clause}",
            revised_negative_prompt=f"{orig_neg}; {', '.join(i.code.lower().replace('_', ' ') for i in issues)}",
            preserve_constraints=[
                rc.preserve_geometry,
                rc.preserve_logo,
                rc.preserve_buttons_and_controls,
                rc.preserve_color_and_finish,
            ],
            estimated_additional_cost_usd=est_cost,
        )

    async def evaluate_creative(
        self,
        request: CreativeEvaluationRequest,
    ) -> CreativeEvaluation:
        """Independently evaluate an existing image or video creative without regenerating it."""
        placement_spec = self._resolve_placement_spec(request)
        threshold = (
            settings.EVALUATION_APPROVAL_THRESHOLD
            if request.approval_threshold is None
            else request.approval_threshold
        )
        weights_map = request.weights.normalized_map()

        selected_refs: List[LoadedReferenceImage] = []
        ref_warnings: List[str] = []
        try:
            selected_refs, ref_warnings = await self.reference_selector.select_references(
                request.product_data,
                override_urls=request.reference_image_urls,
            )
        except Exception as exc:
            ref_warnings.append(f"Reference retrieval note: {exc}")

        raw_bytes = await self._load_creative_bytes(request)
        asset_parts: List[types.Part] = []
        det_img_res: Optional[ImageValidationResult] = None
        det_vid_res: Optional[VideoValidationResult] = None
        issues: List[EvaluationIssue] = []

        if request.format == "image":
            det_img_res, _, _ = self.image_checker.validate(
                image_bytes=raw_bytes,
                expected_aspect_ratio=placement_spec.aspect_ratio,
                reference_images=selected_refs,
                seen_sha256=set(),
                seen_dhashes=[],
            )
            det_summary = (
                f"Image approved={det_img_res.approved}, dims={det_img_res.width}x{det_img_res.height}, "
                f"ratio={det_img_res.actual_aspect_ratio}, stddev={det_img_res.pixel_std_dev}, "
                f"ref_sim={det_img_res.reference_similarity_score}, rejections={det_img_res.rejection_reasons}"
            )
            for chk in det_img_res.checks:
                if not chk.passed:
                    code = (
                        "CORRUPT_ASSET"
                        if chk.name == "readability"
                        else "INVALID_OUTPUT_DIMENSIONS"
                        if chk.name in {"dimensions", "aspect_ratio"}
                        else "VISUAL_QUALITY_BLANK"
                        if chk.name == "visual_quality"
                        else "MATERIALLY_ALTERED_PRODUCT"
                        if chk.name == "reference_similarity"
                        else f"DETERMINISTIC_{chk.name.upper()}"
                    )
                    issues.append(
                        EvaluationIssue(
                            issue_id=f"det_{uuid.uuid4().hex[:8]}",
                            code=code,
                            criterion=(
                                "placement_suitability"
                                if chk.name in {"dimensions", "aspect_ratio"}
                                else "visual_quality"
                            ),
                            severity="hard_rejection",
                            source="deterministic",
                            message=f"{chk.name}: {chk.details} (measured={chk.measured_value}, expected={chk.expected_value})",
                            evidence=chk.measured_value,
                            suggested_fix=f"Ensure asset satisfies {chk.name} ({chk.expected_value}).",
                        )
                    )
            if det_img_res.width:
                asset_parts.append(types.Part.from_bytes(data=raw_bytes, mime_type=_guess_image_mime(raw_bytes)))
        else:
            # Video deterministic inspection + extract representative sample PNG frames for Gemini Vision
            w_str, h_str = (placement_spec.recommended_resolution or "720x1280").lower().split("x")
            exp_w = min(720, int(w_str))
            exp_h = min(1280, int(h_str))
            sb = request.video_storyboard
            with tempfile.TemporaryDirectory(prefix="adpilot_eval_vid_") as tmp:
                vid_path = Path(tmp) / "candidate.mp4"
                vid_path.write_bytes(raw_bytes)
                det_vid_res = self.video_validator.validate_video(
                    video_path=vid_path,
                    expected_duration_seconds=float(sb.total_duration),  # type: ignore[union-attr]
                    duration_tolerance_seconds=1.0,
                    expected_aspect_ratio=placement_spec.aspect_ratio,
                    expected_min_width=exp_w,
                    expected_min_height=exp_h,
                    min_fps=20.0,
                    require_audio=True,
                    reference_images=selected_refs,
                )
                det_summary = (
                    f"Video approved={det_vid_res.approved}, dims={det_vid_res.width}x{det_vid_res.height}, "
                    f"dur={det_vid_res.duration_seconds}s, fps={det_vid_res.fps}, audio={det_vid_res.has_audio_stream}, "
                    f"black_ratio={det_vid_res.black_frame_ratio}, rejections={det_vid_res.rejection_reasons}"
                )
                if not det_vid_res.corrupt and det_vid_res.duration_seconds:
                    frame_times = [
                        max(0.1, det_vid_res.duration_seconds * frac)
                        for frac in (0.15, 0.50, 0.85)
                    ]
                    sampled = self.ffmpeg.extract_sample_frames(vid_path, frame_times, Path(tmp) / "frames")
                    for p_idx, (_, pil_frame) in enumerate(sampled):
                        f_path = Path(tmp) / "frames" / f"probe_frame_{p_idx}.png"
                        if f_path.exists():
                            asset_parts.append(types.Part.from_bytes(data=f_path.read_bytes(), mime_type="image/png"))

            for chk in det_vid_res.checks:
                if not chk.passed:
                    code = (
                        "CORRUPT_ASSET"
                        if chk.name == "integrity"
                        else "INVALID_OUTPUT_DIMENSIONS"
                        if chk.name in {"resolution", "aspect_ratio"}
                        else "VISUAL_QUALITY_BLANK"
                        if chk.name in {"black_frames", "scene_transitions"}
                        else f"VIDEO_{chk.name.upper()}"
                    )
                    issues.append(
                        EvaluationIssue(
                            issue_id=f"det_{uuid.uuid4().hex[:8]}",
                            code=code,
                            criterion=(
                                "placement_suitability"
                                if chk.name in {"resolution", "aspect_ratio", "duration"}
                                else "visual_quality"
                            ),
                            severity="hard_rejection",
                            source="deterministic",
                            message=f"{chk.name}: {chk.details} (measured={chk.measured_value}, expected={chk.expected_value})",
                            evidence=chk.measured_value,
                            suggested_fix=f"Fix {chk.name} to match {chk.expected_value}.",
                        )
                    )

        # Call Gemini multimodal evaluation ONLY if asset contains readable visual frames
        draft: Optional[MultimodalEvaluationDraft] = None
        gen_meta = None
        if asset_parts:
            all_parts = [r.part for r in selected_refs] + asset_parts
            prompt = self._build_audit_prompt(
                request=request,
                placement_spec=placement_spec,
                ref_count=len(selected_refs),
                asset_part_count=len(asset_parts),
                det_summary=det_summary,
            )
            draft, gen_meta = await self.gemini_client.generate_structured(
                prompt_text=prompt,
                response_schema=MultimodalEvaluationDraft,
                system_instruction=EVALUATION_SYSTEM_INSTRUCTION,
                image_parts=all_parts,
                temperature=settings.EVALUATION_MULTIMODAL_TEMPERATURE,
            )

            # Audit observed visible text AND blueprint overlay/text deterministically via ClaimValidator
            for visible_line in draft.observed_visible_text:
                issues.extend(
                    self.claim_validator.audit_text(
                        visible_line,
                        request.product_data,
                        criterion="misleading_content_compliance",
                    )
                )

            for idx, hv_code in enumerate(draft.hard_violation_codes):
                reason = (
                    draft.hard_violation_reasons[idx]
                    if idx < len(draft.hard_violation_reasons)
                    else f"Multimodal audit flagged hard violation {hv_code}"
                )
                issues.append(
                    EvaluationIssue(
                        issue_id=f"mm_{uuid.uuid4().hex[:8]}",
                        code=hv_code,
                        criterion="product_identity_fidelity",
                        severity="hard_rejection",
                        source="multimodal_gemini",
                        message=reason,
                        evidence=draft.observed_product_details[:140],
                        suggested_fix=(
                            draft.regeneration_hints[0]
                            if draft.regeneration_hints
                            else f"Resolve {hv_code} and re-anchor strictly to product references."
                        ),
                    )
                )

        # Combine weighted criterion scores (apply deterministic caps on unreadable/broken assets)
        draft_map = {item.criterion: item for item in (draft.criterion_scores if draft else [])}
        criteria_scores: List[CriterionEvaluationScore] = []
        weighted_sum = 0.0

        for crit in CRITERIA_ORDER:
            weight = weights_map[crit]
            mm_item = draft_map.get(crit)
            raw_score = float(mm_item.score) if mm_item else 0.0
            det_note = None

            # Never allow LLM optimism to mask deterministic failures
            crit_issues = [i for i in issues if i.criterion == crit]
            if crit_issues:
                raw_score = min(raw_score, 35.0)
                det_note = "; ".join(i.code for i in crit_issues)

            contrib = round(raw_score * weight, 3)
            weighted_sum += raw_score * weight
            criteria_scores.append(
                CriterionEvaluationScore(
                    criterion=crit,
                    score=round(raw_score, 2),
                    weight=round(weight, 4),
                    weighted_contribution=contrib,
                    deterministic_note=det_note,
                    multimodal_note=mm_item.reasoning if mm_item else "Skipped due to unreadable asset.",
                )
            )

        overall_score = round(min(100.0, max(0.0, weighted_sum)), 2)
        hard_issues = [i for i in issues if i.severity == "hard_rejection"]
        hard_triggered = len(hard_issues) > 0
        hard_reasons = [f"{i.code}: {i.message}" for i in hard_issues]

        if hard_triggered:
            approved = False
            decision = "rejected_hard_rule"
        elif overall_score < threshold:
            approved = False
            decision = "rejected_low_score"
        else:
            approved = True
            decision = "approved"

        regen_inst = None
        if not approved:
            regen_inst = self._build_regeneration_instruction(
                request=request,
                issues=issues,
                draft=draft,
            )

        concept_id = (
            request.image_blueprint.concept_id
            if request.image_blueprint
            else request.video_storyboard.concept_id  # type: ignore[union-attr]
        )
        evaluation_id = f"eval_{uuid.uuid4().hex[:12]}"
        storage_key = f"campaigns/{request.campaign_id}/evaluations/{request.creative_id}/{evaluation_id}.json"

        evaluation = CreativeEvaluation(
            evaluation_id=evaluation_id,
            campaign_id=request.campaign_id,
            creative_id=request.creative_id,
            concept_id=concept_id,
            format=request.format,
            placement=placement_spec.placement,
            approved=approved,
            decision=decision,  # type: ignore[arg-type]
            overall_weighted_score=overall_score,
            approval_threshold=threshold,
            criteria_scores=criteria_scores,
            hard_rejection_triggered=hard_triggered,
            hard_rejection_reasons=hard_reasons,
            issues=issues,
            deterministic_image_validation=det_img_res,
            deterministic_video_validation=det_vid_res,
            observed_visual_summary=(
                draft.observed_visual_summary if draft else "Creative could not be decoded for multimodal review."
            ),
            observed_visible_text=draft.observed_visible_text if draft else [],
            regeneration_instruction=regen_inst,
            metadata=gen_meta,
            storage_object_key=storage_key,
        )

        self.storage.upload_json(
            bucket=settings.STORAGE_BUCKET_CREATIVES,
            object_key=storage_key,
            payload=evaluation.model_dump(mode="json"),
        )
        return evaluation


creative_evaluation_service = CreativeEvaluationService()
