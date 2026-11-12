"""
AdPilot AI - Scene Prompt Builder & Storyboard Geometry Validator (Step 08)
Validates VideoStoryboard duration invariants, maps placements to Veo API
parameters (duration, resolution, native aspect ratio), and constructs
product-faithful per-scene generation prompts.
"""

from typing import List, Tuple

from agent.app.schemas.creative import VideoScene, VideoStoryboard
from agent.app.schemas.product import Product
from agent.app.schemas.video_gen import VideoGenerationPreferences
from agent.app.services.image_gen.reference_selector import LoadedReferenceImage

PROMPT_VERSION = "step08.vid.v1"

ASPECT_DIMENSIONS = {
    ("9:16", "720p"): (720, 1280),
    ("9:16", "1080p"): (1080, 1920),
    ("16:9", "720p"): (1280, 720),
    ("16:9", "1080p"): (1920, 1080),
    ("4:5", "720p"): (720, 900),
    ("4:5", "1080p"): (1080, 1350),
    ("1:1", "720p"): (720, 720),
    ("1:1", "1080p"): (1080, 1080),
}


class StoryboardValidationError(ValueError):
    """Raised when VideoStoryboard violates scene duration, format, or structural rules."""


def resolve_target_geometry(
    storyboard: VideoStoryboard,
    preferences: VideoGenerationPreferences,
) -> Tuple[str, str, str, int, int]:
    """
    Resolve `(output_aspect_ratio, veo_aspect_ratio, resolution, width, height)`.
    Veo natively supports '9:16' and '16:9'; portrait/square targets like '4:5' or '1:1'
    render from '9:16' and are safely padded/cropped by FFmpeg without stretching.
    """
    out_ratio = preferences.aspect_ratio or storyboard.aspect_ratio
    if out_ratio not in {"9:16", "16:9", "4:5", "1:1"}:
        raise StoryboardValidationError(
            f"Unsupported video aspect_ratio '{out_ratio}'. Supported: 9:16, 16:9, 4:5, 1:1."
        )
    resolution = preferences.resolution or "720p"
    if resolution not in {"720p", "1080p"}:
        raise StoryboardValidationError(f"Unsupported video resolution '{resolution}'.")

    veo_ratio = "16:9" if out_ratio == "16:9" else "9:16"
    width, height = ASPECT_DIMENSIONS[(out_ratio, resolution)]
    return out_ratio, veo_ratio, resolution, width, height


def map_scene_duration_to_veo(
    scene_duration: int,
    *,
    resolution: str,
    using_reference_images: bool,
) -> int:
    """
    Map storyboard scene seconds to official Veo 3.1 clip duration options (4, 6, 8s).
    Per Gemini Veo documentation, 1080p output and reference-image guidance require 8s clips.
    """
    if resolution == "1080p" or using_reference_images:
        return 8
    if scene_duration <= 4:
        return 4
    if scene_duration <= 6:
        return 6
    return 8


def validate_storyboard_for_execution(storyboard: VideoStoryboard) -> None:
    """Enforce exact duration totals, positive scene ordering, and non-empty prompts."""
    if not storyboard.concept_id.strip():
        raise StoryboardValidationError("VideoStoryboard.concept_id cannot be empty.")
    if not storyboard.scene_sequence:
        raise StoryboardValidationError("VideoStoryboard.scene_sequence must contain at least one scene.")
    if storyboard.placement_spec.format != "video":
        raise StoryboardValidationError(
            f"Storyboard placement_spec.format must be 'video', got '{storyboard.placement_spec.format}'."
        )
    scene_sum = sum(s.scene_duration for s in storyboard.scene_sequence)
    if scene_sum != storyboard.total_duration:
        raise StoryboardValidationError(
            f"Sum of scene durations ({scene_sum}s) does not equal storyboard.total_duration ({storyboard.total_duration}s)."
        )
    seen_nums = set()
    for scene in storyboard.scene_sequence:
        if scene.scene_duration <= 0:
            raise StoryboardValidationError(f"Scene {scene.scene_number} duration must be positive.")
        if scene.scene_number in seen_nums:
            raise StoryboardValidationError(f"Duplicate scene_number {scene.scene_number} in storyboard.")
        seen_nums.add(scene.scene_number)
        if not scene.scene_description.strip() or not scene.product_visibility.strip():
            raise StoryboardValidationError(
                f"Scene {scene.scene_number} requires non-empty scene_description and product_visibility."
            )


class ScenePromptBuilder:
    """Compiles scene-specific Veo generation prompts locked to product appearance."""

    def build_scene_prompt(
        self,
        *,
        storyboard: VideoStoryboard,
        scene: VideoScene,
        product_data: Product,
        reference_images: List[LoadedReferenceImage],
        generate_native_audio: bool,
    ) -> Tuple[str, str]:
        rc = storyboard.reference_constraints
        features = ", ".join(rc.recognizable_design_features[:5]) or "exact product contour, logo, and dials"
        ref_count = len(reference_images)

        parts = [
            f"COMMERCIAL PRODUCT VIDEO SCENE ({scene.scene_number}/{len(storyboard.scene_sequence)} — {scene.scene_duration}s): {storyboard.creative_title}",
            f"PRODUCT TO PRESERVE EXACTLY: {product_data.product_name} by {product_data.brand or 'authentic brand label'}.",
            f"Reference photos attached: {ref_count}. Keep identical physical silhouette, finish, printed branding, knobs/controls, and proportions across cut.",
            "",
            "PRODUCT FIDELITY RULES:",
            f"- Geometry: {rc.preserve_geometry}",
            f"- Brand Mark: {rc.preserve_logo}",
            f"- Controls: {rc.preserve_buttons_and_controls}",
            f"- Colors & Material: {rc.preserve_color_and_finish}",
            f"- Key Physical Traits: {features}",
            "- NO unsupported product functions, invented buttons, floating LED displays, or fake accessories.",
            "",
            "SCENE ACTION & CINEMATOGRAPHY:",
            f"- Visual Action: {scene.scene_description}",
            f"- Camera Movement: {scene.camera_movement}",
            f"- Product Framing in Shot: {scene.product_visibility}",
            f"- Continuity / End Transition Intent: {scene.transition_instructions}",
        ]

        if generate_native_audio and scene.sound_direction:
            parts.append(
                f"- Synchronized Ambient / Foley Audio Direction: {scene.sound_direction}. Natural realistic sound matching physical action."
            )

        parts.append(
            "TEXT-FREE RENDERING RULE: Do NOT render burned-in advertising captions, subtitles, price tags, "
            "or CTA banners inside generated video frames; keep frame clean for downstream subtitle and CTA compositing."
        )

        prohibited = list(
            dict.fromkeys(
                storyboard.negative_instructions
                + rc.prohibited_inventions
                + ["warped product geometry", "altered brand logo", "flickering hardware", "baked-in subtitle text", "watermarks"]
            )
        )
        negative_prompt = "; ".join(prohibited[:14])
        return "\n".join(parts), negative_prompt

