"""
AdPilot AI - Creative Plan & Blueprint Validator
Audits CreativePlans to guarantee:
1. Every concept defines an explicit objective
2. Video scene durations add up strictly to total_duration == target_video_duration
3. Every factual claim is supported (no unsupported claims or invented features)
4. Image/video prompts strictly match selected placements, formats, and aspect ratios
5. Same-format concepts are sufficiently differentiated (not mere background swaps)
"""

import re
from typing import List, Tuple
from agent.app.schemas.creative import (
    CreativeConcept,
    CreativePlan,
    CreativeValidationIssue,
    CreativeValidationResult,
)
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import MarketingStrategy
from agent.app.services.fact_guard import (
    check_text_factual_contradictions,
    flatten_product_text,
    jaccard_similarity,
)

# Phrases indicating instruction to invent hardware features not in specs
FEATURE_INVENTION_PROBES = [
    ("touchscreen", re.compile(r"\b(?:touch\s*screen|led\s+display|digital\s+screen|oled\s+screen)\b", re.I)),
    ("extra buttons", re.compile(r"\b(?:add\s+(?:extra|more|glowing)\s+buttons?|extra\s+knobs?)\b", re.I)),
    ("bluetooth/wifi", re.compile(r"\b(?:bluetooth|wi-?fi|app\s+controlled|smart\s+connected)\b", re.I)),
]


class CreativePlanValidator:
    """Validates compiled CreativePlan blueprints prior to returning executable assets."""

    @classmethod
    def validate(
        cls,
        plan: CreativePlan,
        product: Product,
        strategy: MarketingStrategy,
        requested_formats: List[str],
        requested_placements: List[str],
        target_video_duration: int,
    ) -> CreativeValidationResult:
        issues: List[CreativeValidationIssue] = []
        norm_placements = {p.strip().lower() for p in requested_placements}
        norm_formats = {f.strip().lower() for f in requested_formats}

        cls._check_format_coverage(plan, norm_formats, issues)

        for concept in plan.concepts:
            cls._check_objective(concept, issues)
            cls._check_placement_match(concept, norm_formats, norm_placements, issues)
            cls._check_video_durations(concept, target_video_duration, issues)
            cls._check_factual_and_feature_compliance(concept, product, strategy, issues)

        cls._check_concept_differentiation(plan.concepts, issues)

        errors = sum(1 for i in issues if i.severity == "error")
        warnings = sum(1 for i in issues if i.severity == "warning")
        score = max(0.0, round(1.0 - (errors * 0.25) - (warnings * 0.05), 2))
        return CreativeValidationResult(
            passed=(errors == 0),
            score=score,
            issues=issues,
        )

    @staticmethod
    def _check_format_coverage(
        plan: CreativePlan,
        norm_formats: set[str],
        issues: List[CreativeValidationIssue],
    ):
        present_formats = {c.format for c in plan.concepts}
        for fmt in norm_formats:
            if fmt not in present_formats:
                issues.append(CreativeValidationIssue(
                    code="FORMAT_COVERAGE_MISSING",
                    severity="error",
                    message=f"Requested format '{fmt}' has no generated creative concepts.",
                    field_path="concepts",
                ))

    @staticmethod
    def _check_objective(concept: CreativeConcept, issues: List[CreativeValidationIssue]):
        if not concept.creative_objective or len(concept.creative_objective.strip()) < 15:
            issues.append(CreativeValidationIssue(
                code="OBJECTIVE_MISSING",
                severity="error",
                concept_id=concept.concept_id,
                message=f"Concept '{concept.concept_id}' must define a clear creative objective (>= 15 chars).",
                field_path="creative_objective",
            ))

        if concept.format == "image" and concept.image_blueprint:
            obj = concept.image_blueprint.creative_objective
            if not obj or len(obj.strip()) < 15:
                issues.append(CreativeValidationIssue(
                    code="OBJECTIVE_MISSING",
                    severity="error",
                    concept_id=concept.concept_id,
                    message=f"Image blueprint '{concept.concept_id}' lacks a defined creative_objective.",
                    field_path="image_blueprint.creative_objective",
                ))
        elif concept.format == "video" and concept.video_storyboard:
            obj = concept.video_storyboard.video_objective
            if not obj or len(obj.strip()) < 15:
                issues.append(CreativeValidationIssue(
                    code="OBJECTIVE_MISSING",
                    severity="error",
                    concept_id=concept.concept_id,
                    message=f"Video storyboard '{concept.concept_id}' lacks a defined video_objective.",
                    field_path="video_storyboard.video_objective",
                ))

    @staticmethod
    def _check_placement_match(
        concept: CreativeConcept,
        norm_formats: set[str],
        norm_placements: set[str],
        issues: List[CreativeValidationIssue],
    ):
        if concept.format not in norm_formats:
            issues.append(CreativeValidationIssue(
                code="PLACEMENT_MISMATCH",
                severity="error",
                concept_id=concept.concept_id,
                message=f"Concept format '{concept.format}' was not in requested formats {sorted(norm_formats)}.",
                field_path="format",
            ))

        if concept.placement.strip().lower() not in norm_placements:
            issues.append(CreativeValidationIssue(
                code="PLACEMENT_MISMATCH",
                severity="error",
                concept_id=concept.concept_id,
                message=f"Concept placement '{concept.placement}' is not in requested placements {sorted(norm_placements)}.",
                field_path="placement",
            ))

        if concept.format == "image":
            bp = concept.image_blueprint
            if not bp:
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message="Image concept is missing image_blueprint.",
                    field_path="image_blueprint",
                ))
                return
            expected_ar = bp.placement_spec.aspect_ratio
            if bp.aspect_ratio != expected_ar or bp.image_generation_prompt.aspect_ratio != expected_ar:
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message=(
                        f"Image aspect ratio mismatch for '{bp.placement}': expected '{expected_ar}', "
                        f"got blueprint='{bp.aspect_ratio}', prompt='{bp.image_generation_prompt.aspect_ratio}'."
                    ),
                    field_path="image_blueprint.aspect_ratio",
                ))
            if bp.image_generation_prompt.target_medium != "image":
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message="Image prompt target_medium must be 'image'.",
                    field_path="image_blueprint.image_generation_prompt.target_medium",
                ))
            if expected_ar not in bp.image_generation_prompt.positive_prompt:
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message=f"Image prompt text does not reference placement aspect ratio '{expected_ar}'.",
                    field_path="image_blueprint.image_generation_prompt.positive_prompt",
                ))

        elif concept.format == "video":
            sb = concept.video_storyboard
            if not sb:
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message="Video concept is missing video_storyboard.",
                    field_path="video_storyboard",
                ))
                return
            expected_ar = sb.placement_spec.aspect_ratio
            if sb.aspect_ratio != expected_ar or sb.video_generation_prompt.aspect_ratio != expected_ar:
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message=(
                        f"Video aspect ratio mismatch for '{sb.placement}': expected '{expected_ar}', "
                        f"got storyboard='{sb.aspect_ratio}', prompt='{sb.video_generation_prompt.aspect_ratio}'."
                    ),
                    field_path="video_storyboard.aspect_ratio",
                ))
            if sb.video_generation_prompt.target_medium != "video":
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message="Video prompt target_medium must be 'video'.",
                    field_path="video_storyboard.video_generation_prompt.target_medium",
                ))
            if expected_ar not in sb.video_generation_prompt.positive_prompt:
                issues.append(CreativeValidationIssue(
                    code="PLACEMENT_MISMATCH",
                    severity="error",
                    concept_id=concept.concept_id,
                    message=f"Video prompt text does not reference placement aspect ratio '{expected_ar}'.",
                    field_path="video_storyboard.video_generation_prompt.positive_prompt",
                ))

    @staticmethod
    def _check_video_durations(
        concept: CreativeConcept,
        target_video_duration: int,
        issues: List[CreativeValidationIssue],
    ):
        if concept.format != "video" or not concept.video_storyboard:
            return

        sb = concept.video_storyboard
        if sb.total_duration != target_video_duration:
            issues.append(CreativeValidationIssue(
                code="DURATION_MISMATCH",
                severity="error",
                concept_id=concept.concept_id,
                message=(
                    f"Storyboard total_duration ({sb.total_duration}s) does not match "
                    f"requested duration ({target_video_duration}s)."
                ),
                field_path="video_storyboard.total_duration",
            ))

        scene_sum = sum(s.scene_duration for s in sb.scene_sequence)
        if scene_sum != sb.total_duration:
            issues.append(CreativeValidationIssue(
                code="DURATION_MISMATCH",
                severity="error",
                concept_id=concept.concept_id,
                message=(
                    f"Sum of scene durations ({scene_sum}s) does not equal "
                    f"storyboard total_duration ({sb.total_duration}s)."
                ),
                field_path="video_storyboard.scene_sequence",
            ))

        expected_nums = list(range(1, len(sb.scene_sequence) + 1))
        actual_nums = [s.scene_number for s in sb.scene_sequence]
        if actual_nums != expected_nums:
            issues.append(CreativeValidationIssue(
                code="DURATION_MISMATCH",
                severity="error",
                concept_id=concept.concept_id,
                message=f"Scene numbers {actual_nums} must be strictly sequential {expected_nums}.",
                field_path="video_storyboard.scene_sequence",
            ))

    @staticmethod
    def _check_factual_and_feature_compliance(
        concept: CreativeConcept,
        product: Product,
        strategy: MarketingStrategy,
        issues: List[CreativeValidationIssue],
    ):
        product_text = flatten_product_text(product)
        rejected_claims = [
            cv.claim_text.strip()
            for cv in strategy.claim_validations
            if cv.status in ("unsupported", "contradictory") and cv.claim_text.strip()
        ]

        # Collect positive creative copy & scene visuals (excluding negative prompts / prohibited lists)
        positive_fields: List[Tuple[str, str]] = [
            ("creative_direction_summary", concept.creative_direction_summary),
        ]

        if concept.format == "image" and concept.image_blueprint:
            bp = concept.image_blueprint
            positive_fields.extend([
                ("image_blueprint.hook", bp.hook),
                ("image_blueprint.main_message", bp.main_message),
                ("image_blueprint.visual_composition", bp.visual_composition),
                ("image_blueprint.product_positioning", bp.product_positioning),
                ("image_blueprint.background_direction", bp.background_direction),
            ])
        elif concept.format == "video" and concept.video_storyboard:
            sb = concept.video_storyboard
            positive_fields.extend([
                ("video_storyboard.opening_hook", sb.opening_hook),
                ("video_storyboard.final_cta", sb.final_cta),
            ])
            for idx, scene in enumerate(sb.scene_sequence):
                positive_fields.extend([
                    (f"scene[{idx}].scene_description", scene.scene_description),
                    (f"scene[{idx}].product_visibility", scene.product_visibility),
                    (f"scene[{idx}].voiceover_script", scene.voiceover_script),
                    (f"scene[{idx}].on_screen_text", scene.on_screen_text),
                ])

        for path, text in positive_fields:
            # 1. Shared price/wattage/warranty/cordless contradiction guard
            for code, msg in check_text_factual_contradictions(text, product, product_text):
                issues.append(CreativeValidationIssue(
                    code=code,
                    severity="error",
                    concept_id=concept.concept_id,
                    message=msg,
                    field_path=path,
                ))

            # 2. Rejected user prompt claim leakage
            text_lower = text.lower()
            for rejected in rejected_claims:
                rej_lower = rejected.lower()
                # Check direct phrase leakage in non-negated context
                if rej_lower in text_lower and f"not {rej_lower}" not in text_lower and f"no {rej_lower}" not in text_lower:
                    issues.append(CreativeValidationIssue(
                        code="UNSUPPORTED_CLAIM",
                        severity="error",
                        concept_id=concept.concept_id,
                        message=f"Rejected claim '{rejected}' appeared in creative copy '{path}'.",
                        field_path=path,
                    ))

            # 3. Feature invention checks
            for feat_name, pattern in FEATURE_INVENTION_PROBES:
                if pattern.search(text) and not pattern.search(product_text):
                    # Allow negated warnings if phrased defensively (e.g. "no touchscreen")
                    if re.search(rf"\b(?:no|not|never|without)\s+{feat_name}", text_lower):
                        continue
                    issues.append(CreativeValidationIssue(
                        code="FEATURE_INVENTION",
                        severity="error",
                        concept_id=concept.concept_id,
                        message=f"Creative direction instructs unsupported feature '{feat_name}' absent from ProductData.",
                        field_path=path,
                    ))

    @staticmethod
    def _check_concept_differentiation(concepts: List[CreativeConcept], issues: List[CreativeValidationIssue]):
        for fmt in ("image", "video"):
            group = [c for c in concepts if c.format == fmt]
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    a, b = group[i], group[j]

                    if a.creative_title.strip().lower() == b.creative_title.strip().lower():
                        issues.append(CreativeValidationIssue(
                            code="INSUFFICIENT_DIFFERENTIATION",
                            severity="error",
                            concept_id=b.concept_id,
                            message=f"Duplicate creative title '{a.creative_title}' across {fmt} concepts.",
                            field_path="creative_title",
                        ))
                        continue

                    if fmt == "image" and a.image_blueprint and b.image_blueprint:
                        bp_a, bp_b = a.image_blueprint, b.image_blueprint
                        if bp_a.hook.strip().lower() == bp_b.hook.strip().lower():
                            issues.append(CreativeValidationIssue(
                                code="INSUFFICIENT_DIFFERENTIATION",
                                severity="error",
                                concept_id=b.concept_id,
                                message=f"Image concepts '{a.concept_id}' and '{b.concept_id}' repeat identical hook.",
                                field_path="image_blueprint.hook",
                            ))
                            continue

                        # Ensure creative composition & message diverge beyond background swap
                        text_a = f"{a.creative_direction_summary} {bp_a.visual_composition} {bp_a.camera_perspective} {bp_a.main_message}"
                        text_b = f"{b.creative_direction_summary} {bp_b.visual_composition} {bp_b.camera_perspective} {bp_b.main_message}"
                        sim = jaccard_similarity(text_a, text_b)
                        if sim >= 0.72:
                            issues.append(CreativeValidationIssue(
                                code="INSUFFICIENT_DIFFERENTIATION",
                                severity="error",
                                concept_id=b.concept_id,
                                message=(
                                    f"Image concepts '{a.concept_id}' and '{b.concept_id}' are overly similar "
                                    f"(similarity={sim:.2f}); diversify composition, perspective, and message rather than background alone."
                                ),
                                field_path="image_blueprint.visual_composition",
                            ))

                    elif fmt == "video" and a.video_storyboard and b.video_storyboard:
                        sb_a, sb_b = a.video_storyboard, b.video_storyboard
                        if sb_a.opening_hook.strip().lower() == sb_b.opening_hook.strip().lower():
                            issues.append(CreativeValidationIssue(
                                code="INSUFFICIENT_DIFFERENTIATION",
                                severity="error",
                                concept_id=b.concept_id,
                                message=f"Video concepts '{a.concept_id}' and '{b.concept_id}' repeat identical opening_hook.",
                                field_path="video_storyboard.opening_hook",
                            ))
                            continue

                        scenes_a = " ".join(s.scene_description + " " + s.voiceover_script for s in sb_a.scene_sequence)
                        scenes_b = " ".join(s.scene_description + " " + s.voiceover_script for s in sb_b.scene_sequence)
                        text_a = f"{a.creative_direction_summary} {scenes_a}"
                        text_b = f"{b.creative_direction_summary} {scenes_b}"
                        sim = jaccard_similarity(text_a, text_b)
                        if sim >= 0.72:
                            issues.append(CreativeValidationIssue(
                                code="INSUFFICIENT_DIFFERENTIATION",
                                severity="error",
                                concept_id=b.concept_id,
                                message=(
                                    f"Video concepts '{a.concept_id}' and '{b.concept_id}' have overly repetitive "
                                    f"narratives/scenes (similarity={sim:.2f})."
                                ),
                                field_path="video_storyboard.scene_sequence",
                            ))

