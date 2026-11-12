"""
AdPilot AI - Strategy Prompt Engineering Builder
Constructs structured, fact-grounded system instructions and prompts for Gemini
to analyze extracted ProductData and produce compliant MarketingStrategy plans.
"""

import json
from typing import Any, Dict, List, Optional
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import QualityIssue

SYSTEM_INSTRUCTION = """You are a senior performance marketing strategist and rigorous fact-grounded AI product analyst for AdPilot AI.

Your job is to analyze validated e-commerce product intelligence (ProductData + any attached product images) together with a user's campaign request, and return a strictly factual, high-converting MarketingStrategy JSON matching the requested schema.

CRITICAL RULES & GUARDRAILS:
1. FACTUAL GROUNDING (ProductData controls facts):
   - Use ONLY specifications, pricing, discounts, warranties, materials, capacities, ratings, and features explicitly present in ProductData or visually confirmed in attached reference images.
   - Distinguish verified facts ('verified_features', 'supported_claims') from marketing interpretations ('customer_benefits', 'marketing_angles').
   - NEVER invent pricing, discount percentages, specifications, certifications, guarantees, ratings, or demographic statistics (e.g., do NOT say "78% of millennials" or invent unverified price figures).
   - If 'price', 'original_price', 'rating', or specs are missing/None in ProductData, explicitly list them in 'missing_or_uncertain_info' and NEVER state a fabricated price or discount.

2. PROMPT INTERPRETATION & CLAIM AUDITING (User prompt controls creative style, NOT facts):
   - Let the user prompt guide tone, visual aesthetic, target persona focus, and ad objectives.
   - Audit EVERY explicit or implied product claim in the user prompt against ProductData and populate 'claim_validations'.
   - If the user prompt requests an unsupported, contradictory, or unverifiable claim (for example: wrong wattage, cordless when the spec says 230V corded, a 5-year warranty when specs state 1 year, or "50% off" when discount is lower or price is missing), you MUST flag it in 'claim_validations' with status 'unsupported', 'contradictory', or 'unverifiable', provide a clear 'reason' and a factually accurate 'safe_alternative', and EXCLUDE the false claim from 'supported_claims', 'recommended_messaging', and 'hooks'.

3. PERSONAS & ANGLES QUALITY:
   - Personas must be concrete behavioral/use-case segments relevant to the actual product (NEVER generic labels like "General Consumers" or "Anyone").
   - Generate 3 to 5 genuinely distinct 'marketing_angles' when ProductData contains enough attributes (or fewer if ProductData is severely minimal), each targeting a distinct pain point, motivation, or use-case with non-overlapping hooks and concrete visual direction.
   - Every MarketingAngle 'target_persona_id' must match a valid 'persona_id' from 'personas'.
   - 'recommendations.priority_angle_id' must match a valid 'angle_id' from 'marketing_angles'.
"""


def build_strategy_prompt(
    product_data: Product,
    user_prompt: str,
    formats: List[str],
    placements: List[str],
    learning_hints: Optional[Dict[str, Any]] = None,
) -> str:
    """Build the primary user prompt combining ProductData and campaign brief."""
    # Exclude raw timestamps/low-level noise while preserving all facts & missing_fields
    product_summary = {
        "product_name": product_data.product_name,
        "brand": product_data.brand,
        "category": product_data.category,
        "description": product_data.description,
        "price": product_data.price,
        "original_price": product_data.original_price,
        "currency": product_data.currency,
        "discount_percentage": product_data.discount,
        "availability": product_data.availability,
        "features": product_data.features,
        "specifications": product_data.specifications,
        "rating": product_data.rating,
        "review_count": product_data.review_count,
        "sample_reviews": [r.model_dump() for r in product_data.reviews[:5]],
        "image_count": len(product_data.images),
        "image_alt_texts": [img.alt_text for img in product_data.images if img.alt_text],
        "missing_fields_from_extraction": product_data.missing_fields,
    }

    hints_section = ""
    if learning_hints and isinstance(learning_hints, dict):
        # Strictly pass creative pattern guidance ONLY and reaffirm verified ProductData overrides everything
        safe_hints = {
            "effective_hooks": learning_hints.get("effective_hooks", [])[:4],
            "avoid_patterns": learning_hints.get("avoid_patterns", [])[:4],
            "recommendations": learning_hints.get("recommendations", [])[:3],
        }
        hints_section = f"""
=== HISTORICAL CREATIVE LEARNING MEMORY (CREATIVE GUIDANCE ONLY — NEVER OVERRIDES PRODUCTDATA FACTS) ===
{json.dumps(safe_hints, indent=2, ensure_ascii=False)}
Rule: Use historical hints only for hook style, creative framing, or defect avoidance. Verified current ProductData strictly controls ALL factual specs, prices, discounts, and claims.
"""

    return f"""Analyze the following validated ProductData and Campaign Brief to produce a complete MarketingStrategy.

=== VERIFIED PRODUCT DATA (SOLE SOURCE OF FACTUAL TRUTH) ===
{json.dumps(product_summary, indent=2, ensure_ascii=False)}

=== USER CAMPAIGN BRIEF (CONTROLS STYLE, DIRECTION & OBJECTIVES ONLY) ===
- User Prompt: "{user_prompt}"
- Requested Formats: {json.dumps(formats)}
- Requested Placements: {json.dumps(placements)}
{hints_section}
INSTRUCTIONS:
1. Extract factual understanding into 'product_knowledge', strictly identifying 'missing_or_uncertain_info'.
2. Audit all claims implied or requested by the User Prompt inside 'claim_validations'. Flag any unsupported or contradictory claims instead of adopting them.
3. Create concrete, non-generic 'personas' referencing real pain points addressed by this product.
4. Create 3 to 5 distinct, non-repetitive 'marketing_angles' tailored to the requested formats ({", ".join(formats)}) and placements ({", ".join(placements)}).
5. Ensure all 'target_persona_id' and 'priority_angle_id' IDs cross-reference properly.
6. Return valid JSON conforming strictly to the MarketingStrategy schema.
"""


def build_regeneration_prompt(
    base_prompt: str,
    issues: List[QualityIssue],
) -> str:
    """Append explicit quality gate defects for controlled regeneration."""
    formatted_issues = "\n".join(
        f"- [{issue.code}] ({issue.severity}): {issue.message}"
        + (f" [field: {issue.field_path}]" if issue.field_path else "")
        for issue in issues
    )

    return f"""{base_prompt}

=== CRITICAL QUALITY REGENERATION NOTICE ===
Your previous MarketingStrategy output failed local quality & factual compliance validation for the following reasons:
{formatted_issues}

You MUST fix EVERY listed issue in this regenerated output:
- Remove or rewrite any unsupported/contradictory claims so they appear ONLY as flagged items in 'claim_validations' and NEVER in messaging, hooks, or supported_claims.
- Ensure marketing angles are genuinely distinct (unique angle_name, promise, messaging, and hooks).
- Ensure personas are specific use-case buyers with concrete pain points, not generic consumers or fabricated statistics.
- Ensure all required fields and ID cross-references ('target_persona_id', 'priority_angle_id') are complete and valid.
"""

