"""
AdPilot AI - Image Prompt Compiler (Step 07)
Constructs product-faithful, aspect-ratio-aware commercial generation prompts
from ImageCreativeBlueprint, MarketingStrategy, ProductData, and reference metadata.
"""

from typing import Dict, List, Tuple

from agent.app.schemas.creative import ImageCreativeBlueprint
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import MarketingStrategy
from agent.app.services.image_gen.reference_selector import LoadedReferenceImage

PROMPT_VERSION = "step07.img.v1"

ASPECT_COMPOSITION_DIRECTIVES: Dict[str, str] = {
    "1:1": (
        "1:1 SQUARE COMPOSITION: Frame the full product upright and centered with balanced negative space "
        "on all sides; zero edge clipping of product attachments, cords, or branding."
    ),
    "4:5": (
        "4:5 PORTRAIT FEED COMPOSITION: Keep the complete hero product cleanly centered inside the inner "
        "88% safe frame with airy upper backdrop breathing room so portrait feeds never crop top or bottom geometry."
    ),
    "9:16": (
        "9:16 VERTICAL STORIES/REELS COMPOSITION: Place the entire physical product cleanly within the middle "
        "64% vertical band; reserve top 14% and bottom 22% as uncluttered background surface/sky for UI and safe overlays."
    ),
}

VARIATION_DIRECTIONS: Tuple[str, ...] = (
    "Variation focus: Clean hero studio framing matching blueprint lighting directly, crisp shadow anchor on countertop.",
    "Variation focus: Warm architectural three-quarter depth composition with slightly elevated camera angle and soft rim light.",
    "Variation focus: Lifestyle countertop context highlighting everyday ergonomics while keeping the product central and sharp.",
    "Variation focus: Crisp high-contrast editorial lighting emphasizing authentic surface textures, metallic accents, and control dial legibility.",
)


class ImagePromptCompiler:
    """Builds product-locked generation instructions and exclusion guardrails per variation."""

    def compile(
        self,
        *,
        blueprint: ImageCreativeBlueprint,
        strategy: MarketingStrategy,
        product_data: Product,
        target_aspect_ratio: str,
        variation_index: int,
        total_variations: int,
        selected_refs: List[LoadedReferenceImage],
    ) -> Tuple[str, str, Dict[str, str]]:
        """
        Return `(positive_prompt, negative_prompt, generation_parameters)` tuned for commercial product fidelity.
        """
        ref_summary_lines = [
            f"- Reference #{idx + 1} ({'PRIMARY' if ref.selection.is_primary else 'SECONDARY'} "
            f"{ref.selection.width}x{ref.selection.height})"
            for idx, ref in enumerate(selected_refs)
        ]

        rc = blueprint.reference_constraints
        ratio_directive = ASPECT_COMPOSITION_DIRECTIVES.get(
            target_aspect_ratio,
            f"Compose cleanly for exact {target_aspect_ratio} ratio with entire product visible inside safe margins.",
        )
        variation_cue = VARIATION_DIRECTIONS[(variation_index - 1) % len(VARIATION_DIRECTIONS)]

        features_text = ", ".join(rc.recognizable_design_features[:6]) or "exact visible housing, attachments, and finish"
        donts_text = "; ".join(
            list(
                dict.fromkeys(
                    blueprint.negative_instructions
                    + rc.prohibited_inventions
                    + strategy.recommendations.creative_donts
                )
            )[:10]
        )

        # Instruct Gemini strictly on physical product lock + NO baked-in marketing text overlays.
        positive_parts = [
            "TASK: Generate a photorealistic commercial e-commerce product photograph for the attached reference product.",
            f"PRODUCT IDENTITY: {product_data.product_name} (Brand: {product_data.brand or 'authentic label shown on reference'}).",
            f"CREATIVE CONCEPT: {blueprint.creative_title} — Angle: {blueprint.marketing_angle}.",
            f"OBJECTIVE: {blueprint.creative_objective}.",
            "",
            "ATTACHED PRODUCT REFERENCE INPUTS:",
            *ref_summary_lines,
            "",
            "STRICT PRODUCT FIDELITY CONSTRAINTS (HIGHEST PRIORITY):",
            f"1. Geometry & Silhouette: {rc.preserve_geometry}",
            f"2. Brand Logo Integrity: {rc.preserve_logo}",
            f"3. Buttons, Dials & Controls: {rc.preserve_buttons_and_controls}",
            f"4. Authentic Color & Finish: {rc.preserve_color_and_finish}",
            f"5. Scale & Proportions: {rc.preserve_dimensions_and_proportions}",
            f"6. Recognizable Design Features to Keep Visible: {features_text}.",
            "Do NOT redesign, recolor, simplify, remove, or invent dials, digital screens, extra jars, or altered branding.",
            "",
            "VISUAL ART DIRECTION & SCENE:",
            f"- Composition: {blueprint.visual_composition}",
            f"- Background Direction: {blueprint.background_direction}",
            f"- Lighting Direction: {blueprint.lighting_direction}",
            f"- Product Positioning: {blueprint.product_positioning}",
            f"- Camera Perspective: {blueprint.camera_perspective}",
            f"- Blueprint Prompt Core: {blueprint.image_generation_prompt.positive_prompt}",
            f"- Variation {variation_index}/{total_variations}: {variation_cue}",
            "",
            "FRAMING & CLEAN BASE VISUAL RULE:",
            f"- {ratio_directive}",
            "- NO BAKED-IN PROMOTIONAL TEXT: Produce a clean photograph free of headline banners, floating price tags, "
            "discount badges, UI buttons, watermarks, or overlaid slogans. Preserve ONLY physical brand markings printed on the product.",
        ]

        negative_prompt = (
            f"{blueprint.image_generation_prompt.negative_prompt}; "
            f"{donts_text}; "
            "embedded advertising headlines, floating price stickers, fake discount badges, watermarks, cropped product edges, "
            "hallucinated buttons or LED screens, altered logo lettering, distorted proportions, plastic toy appearance"
        ).strip("; ")

        positive_prompt = "\n".join(positive_parts)
        gen_params = {
            "prompt_version": PROMPT_VERSION,
            "aspect_ratio": target_aspect_ratio,
            "variation_index": str(variation_index),
            "reference_count": str(len(selected_refs)),
            "clean_base_visual": "true",
        }
        return positive_prompt, negative_prompt, gen_params

