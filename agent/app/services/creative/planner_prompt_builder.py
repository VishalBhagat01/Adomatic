"""
AdPilot AI - Creative Planning Prompt Engineering Builder
Constructs structured system instructions and planning prompts for Gemini
to translate MarketingStrategy into concrete image and video CreativePlanDrafts.
"""

import json
from typing import List

from agent.app.schemas.creative import (
    CreativeValidationIssue,
    PlacementSpecification,
    ReferenceImageConstraints,
)
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import MarketingStrategy

CREATIVE_PLANNER_SYSTEM_INSTRUCTION = """You are a senior creative director and AI prompt architect at AdPilot AI.

Your responsibility is to translate a validated MarketingStrategy and verified ProductData into executable, distinct image creative blueprints and scene-by-scene video storyboards.

CRITICAL RULES:
1. DISTINCT CREATIVE CONCEPTS (NO MERE BACKGROUND SWAPS):
   - Every concept within the same format MUST feature a fundamentally distinct creative direction, narrative setup, camera perspective, visual composition, hook, and marketing angle hypothesis—NOT the same shot placed against a different backdrop.
2. STRICT FACTUALITY & REFERENCE FIDELITY:
   - Never fabricate specifications, pricing, discounts, buttons, digital screens, wireless/cordless capability, or accessories.
   - Any claim marked 'unsupported' or 'contradictory' in ClaimValidation MUST be completely excluded from hooks, messages, voiceovers, on-screen text, and scene descriptions.
   - Respect missing price/ratings: if price is None in ProductData, never state any numeric currency price or discount percentage.
3. PLACEMENT & DURATION PRECISION:
   - Assign placements strictly from the requested placements list.
   - For every VideoConceptDraft, 'total_duration' MUST equal the requested target_video_duration, and the integer durations ('scene_duration') of all scenes in 'scene_sequence' MUST be positive (> 0), sequential (scene_number 1..N), and sum EXACTLY to 'total_duration'.
4. DEFINED OBJECTIVES:
   - Every image concept and video storyboard MUST state a clear, specific 'creative_objective' or 'video_objective' tied to a persona and marketing angle.
"""


def build_creative_planning_prompt(
    product: Product,
    strategy: MarketingStrategy,
    user_prompt: str,
    formats: List[str],
    placement_specs: List[PlacementSpecification],
    constraints: ReferenceImageConstraints,
    target_video_duration: int,
) -> str:
    """Build planning prompt linking Strategy + Product + Constraints + Placement Specs."""
    requested_placements = list(dict.fromkeys(spec.placement for spec in placement_specs))

    strategy_summary = {
        "product_knowledge": strategy.product_knowledge.model_dump(),
        "personas": [p.model_dump() for p in strategy.personas],
        "marketing_angles": [a.model_dump() for a in strategy.marketing_angles],
        "rejected_claims": [
            cv.model_dump()
            for cv in strategy.claim_validations
            if cv.status in ("unsupported", "contradictory")
        ],
        "recommendations": strategy.recommendations.model_dump(),
    }

    product_facts = {
        "product_name": product.product_name,
        "brand": product.brand,
        "price": product.price,
        "original_price": product.original_price,
        "currency": product.currency,
        "discount": product.discount,
        "features": product.features,
        "specifications": product.specifications,
        "missing_fields": product.missing_fields,
    }

    specs_summary = [spec.model_dump() for spec in placement_specs]

    return f"""Convert the MarketingStrategy and ProductData into an executable CreativePlanDraft.

=== USER CREATIVE BRIEF ===
- User Prompt: "{user_prompt}"
- Requested Formats: {json.dumps(formats)}
- Allowed Placements: {json.dumps(requested_placements)}
- Target Video Duration (exact seconds): {target_video_duration}

=== PLACEMENT SPECIFICATIONS ===
{json.dumps(specs_summary, indent=2)}

=== VERIFIED PRODUCT FACTS ===
{json.dumps(product_facts, indent=2, ensure_ascii=False)}

=== REFERENCE IMAGE PRESERVATION CONSTRAINTS ===
{json.dumps(constraints.model_dump(), indent=2, ensure_ascii=False)}

=== MARKETING STRATEGY INPUT ===
{json.dumps(strategy_summary, indent=2, ensure_ascii=False)}

GENERATION REQUIREMENTS:
- Generate 2 to 3 distinct ImageConceptDraft objects ONLY IF "image" is in {json.dumps(formats)} (otherwise return empty []). Use IDs "img_c1", "img_c2", etc.
- Generate 2 to 3 distinct VideoConceptDraft objects ONLY IF "video" is in {json.dumps(formats)} (otherwise return empty []). Use IDs "vid_c1", "vid_c2", etc.
- Each VideoConceptDraft MUST have total_duration={target_video_duration}, and sum(scene.scene_duration) == {target_video_duration}.
- Ensure every concept has a defined creative_objective/video_objective, uses an allowed placement from {json.dumps(requested_placements)}, and avoids all rejected claims or feature inventions.
"""


def build_creative_regeneration_prompt(
    base_prompt: str,
    issues: List[CreativeValidationIssue],
) -> str:
    """Append local validation failures to guide targeted corrective regeneration."""
    formatted = "\n".join(
        f"- [{i.code}] ({i.severity})"
        + (f" [{i.concept_id}]" if i.concept_id else "")
        + f": {i.message}"
        for i in issues
    )
    return f"""{base_prompt}

=== CRITICAL CREATIVE VALIDATION DEFECTS TO FIX ===
Your previous CreativePlanDraft failed validation checks for these exact issues:
{formatted}

Fix EVERY listed defect in the regenerated output:
- Verify scene durations are whole positive integers that sum strictly to total_duration.
- Ensure concepts of the same format are genuinely distinct (unique direction, composition, hooks, and messaging — not mere background variations).
- Assign only allowed placements and formats requested above.
- Remove any unsupported claims, fabricated pricing, or invented product features.
"""

