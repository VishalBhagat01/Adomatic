"""
AdPilot AI - Dedicated Image & Video Prompt Optimization Templates
Compiles structured CreativeConceptDrafts + ReferenceImageConstraints + PlacementSpecification
into directly executable GenerationPrompts with zero generic filler.
"""

from typing import List
from agent.app.schemas.creative import (
    GenerationPrompt,
    ImageConceptDraft,
    PlacementSpecification,
    ReferenceImageConstraints,
    VideoConceptDraft,
)
from agent.app.schemas.product import Product

IMAGE_TEMPLATE_NAME = "adpilot_image_blueprint_v1"
VIDEO_TEMPLATE_NAME = "adpilot_video_storyboard_v1"

BASE_IMAGE_NEGATIVES = [
    "blurry or illegible brand logo",
    "distorted product proportions",
    "extra hallucinated buttons or digital displays",
    "watermarks",
    "text gibberish",
    "floating ungrounded props",
    "overexposed plastic glare",
    "cropped product silhouette",
]

BASE_VIDEO_NEGATIVES = [
    "morphing or melting product geometry across frames",
    "flickering or misspelled brand logo",
    "sudden disappearing lids, jars, or cords",
    "hallucinated control screens or glowing buttons",
    "unnatural hand anatomy around appliances",
    "jarring camera jitter",
    "random unrequested text overlays",
]


def _dedupe_preserve_order(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for item in items:
        clean = item.strip()
        if clean and clean.lower() not in seen:
            seen.add(clean.lower())
            out.append(clean)
    return out


def render_image_generation_prompt(
    draft: ImageConceptDraft,
    product: Product,
    placement_spec: PlacementSpecification,
    constraints: ReferenceImageConstraints,
) -> GenerationPrompt:
    """Compile a product-grounded, placement-aware executable image generation prompt."""
    key_specs = ", ".join(f"{k}: {v}" for k, v in list(product.specifications.items())[:5])
    features_summary = "; ".join(constraints.recognizable_design_features[:4])

    positive_prompt = (
        f"[SUBJECT] Commercial advertising photography of {product.product_name}"
        + (f" ({key_specs})" if key_specs else "")
        + f".\n"
        f"[CREATIVE OBJECTIVE] {draft.creative_objective}. Concept: {draft.creative_title} — {draft.creative_direction_summary}.\n"
        f"[COMPOSITION & CAMERA] {draft.camera_perspective}. Positioning: {draft.product_positioning}. "
        f"Visual layout: {draft.visual_composition}.\n"
        f"[ENVIRONMENT & LIGHTING] Background: {draft.background_direction}. Lighting: {draft.lighting_direction}.\n"
        f"[PLACEMENT & FRAMING] Target placement '{placement_spec.placement}' at {placement_spec.aspect_ratio} "
        f"({placement_spec.recommended_resolution}). {placement_spec.safe_zone_notes}\n"
        f"[REFERENCE PRESERVATION CONSTRAINTS]\n"
        f"- Geometry: {constraints.preserve_geometry}\n"
        f"- Logo: {constraints.preserve_logo}\n"
        f"- Controls: {constraints.preserve_buttons_and_controls}\n"
        f"- Color & Finish: {constraints.preserve_color_and_finish}\n"
        f"- Proportions: {constraints.preserve_dimensions_and_proportions}\n"
        f"- Must keep accurate: {features_summary}."
    )

    negatives = _dedupe_preserve_order(
        BASE_IMAGE_NEGATIVES + constraints.prohibited_inventions + draft.extra_negative_instructions
    )

    return GenerationPrompt(
        prompt_id=f"prm_{draft.concept_id}",
        target_medium="image",
        template_name=IMAGE_TEMPLATE_NAME,
        positive_prompt=positive_prompt,
        negative_prompt=", ".join(negatives),
        aspect_ratio=placement_spec.aspect_ratio,
        reference_constraints=constraints,
        style_tags=draft.style_tags or ["commercial product photography", "authentic brand fidelity"],
    )


def render_video_generation_prompt(
    draft: VideoConceptDraft,
    product: Product,
    placement_spec: PlacementSpecification,
    constraints: ReferenceImageConstraints,
) -> GenerationPrompt:
    """Compile a scene-sequenced, product-preserving executable video generation prompt."""
    key_specs = ", ".join(f"{k}: {v}" for k, v in list(product.specifications.items())[:5])

    scene_lines = []
    for scene in draft.scene_sequence:
        scene_lines.append(
            f"Scene {scene.scene_number} ({scene.scene_duration}s): {scene.scene_description} "
            f"| Camera: {scene.camera_movement} "
            f"| Product visibility: {scene.product_visibility} "
            f"| Transition: {scene.transition_instructions}"
        )
    scenes_block = "\n".join(scene_lines)

    positive_prompt = (
        f"[VIDEO SUBJECT] Commercial ad video featuring {product.product_name}"
        + (f" ({key_specs})" if key_specs else "")
        + f".\n"
        f"[VIDEO OBJECTIVE & FORMAT] {draft.video_objective}. Duration: {draft.total_duration}s vertical/framed "
        f"for '{placement_spec.placement}' at {placement_spec.aspect_ratio} ({placement_spec.recommended_resolution}). "
        f"Opening Hook: {draft.opening_hook}.\n"
        f"[SAFE ZONE GUIDANCE] {placement_spec.safe_zone_notes}\n"
        f"[SCENE-BY-SCENE DIRECTION]\n{scenes_block}\n"
        f"[REFERENCE CONSISTENCY ACROSS MOTION]\n"
        f"- Geometry: {constraints.preserve_geometry}\n"
        f"- Logo: {constraints.preserve_logo}\n"
        f"- Controls: {constraints.preserve_buttons_and_controls}\n"
        f"- Color & Finish: {constraints.preserve_color_and_finish}\n"
        f"- Proportions: {constraints.preserve_dimensions_and_proportions}"
    )

    negatives = _dedupe_preserve_order(
        BASE_VIDEO_NEGATIVES + constraints.prohibited_inventions + draft.extra_negative_instructions
    )

    return GenerationPrompt(
        prompt_id=f"prm_{draft.concept_id}",
        target_medium="video",
        template_name=VIDEO_TEMPLATE_NAME,
        positive_prompt=positive_prompt,
        negative_prompt=", ".join(negatives),
        aspect_ratio=placement_spec.aspect_ratio,
        reference_constraints=constraints,
        style_tags=draft.style_tags or ["commercial motion ad", "consistent product fidelity"],
    )

