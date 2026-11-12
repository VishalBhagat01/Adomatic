"""
AdPilot AI - Reference Image Preservation Constraints Builder
Derives concrete, product-specific preservation guardrails from ProductData and
ClaimValidation audit verdicts so downstream generative models never alter product
identity or fabricate features.
"""

from typing import List
from agent.app.schemas.creative import ReferenceImageConstraints
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import MarketingStrategy


def build_reference_constraints(
    product: Product,
    strategy: MarketingStrategy,
) -> ReferenceImageConstraints:
    """
    Build deterministic visual preservation constraints anchored to ProductData specs
    and flagged unsupported claims.
    """
    specs = {k.lower(): str(v) for k, v in product.specifications.items()}
    brand_name = product.brand or "the original brand"

    # Extract color & finish
    color = specs.get("color") or specs.get("colour") or specs.get("finish")
    if color:
        preserve_color = (
            f"Match exact reference image surface finish and color palette ({color}); "
            "do not recolor housing, dials, or metallic surfaces under dramatic color casts."
        )
    else:
        preserve_color = (
            "Preserve exact color tones and material finish directly from the product reference images "
            "without shifting hue or applying artificial metallic tints."
        )

    # Extract geometry & dimensions/proportions
    dimensions = specs.get("dimensions") or specs.get("size") or specs.get("weight")
    jars_or_parts = specs.get("jars included") or specs.get("capacity")
    if dimensions:
        preserve_dims = (
            f"Maintain exact physical dimensions ({dimensions}) and accessory-to-body proportions "
            "matching the reference photography."
        )
    elif jars_or_parts:
        preserve_dims = (
            f"Keep proportional scale strictly accurate between main housing and {jars_or_parts}; "
            "do not oversize or elongate attachments."
        )
    else:
        preserve_dims = (
            "Maintain true-to-life physical proportions, height-to-width ratio, and realistic countertop scale "
            "relative to surrounding kitchen/environment props."
        )

    preserve_geometry = (
        f"Preserve the exact exterior silhouette, housing contours, base structure, and lid/handle geometry "
        f"of the {product.product_name} shown in the reference images."
    )

    preserve_logo = (
        f"Preserve the exact '{brand_name}' wordmark logo, font weight, spacing, and placement on the front housing. "
        "Keep typography crisp, unwarped, and spelled accurately; never invent extra badges or logos."
    )

    # Detect controls from features/description
    combined_text = " ".join([
        product.product_name or "",
        product.description or "",
        *product.features,
        *(f"{k} {v}" for k, v in product.specifications.items()),
    ]).lower()

    if "rotary" in combined_text or "knob" in combined_text or "dial" in combined_text:
        preserve_controls = (
            "Preserve the exact physical rotary speed dial/knob markings, position, and indicator ticks; "
            "do NOT replace physical dials with digital touchscreens or extra illuminated buttons."
        )
    elif "push button" in combined_text or "button" in combined_text:
        preserve_controls = (
            "Preserve the exact push-button control panel layout, icon labels, and button count; "
            "do not invent extra LED screens or additional switches."
        )
    else:
        preserve_controls = (
            "Reproduce all visible dials, switches, vents, and control markings identically to the reference image; "
            "never fabricate digital displays, extra buttons, or glowing indicators."
        )

    # Recognizable design features directly from verified facts
    recognizable_features: List[str] = []
    if jars_or_parts:
        recognizable_features.append(f"Include authentic attachment configuration: {jars_or_parts}")
    for feat in strategy.product_knowledge.verified_features[:5]:
        recognizable_features.append(feat)
    if not recognizable_features:
        recognizable_features.append(f"Authentic exterior casing and trim of {product.product_name}")

    # Prohibited inventions
    prohibited: List[str] = [
        "Never invent unverified buttons, digital touchscreens, LED panels, or wireless antennas",
        "Never alter brand logo spelling, emblem shape, or add unapproved certification stamps",
        "Never fabricate extra accessories, jars, or attachments absent from ProductData",
    ]

    # Power cord awareness
    if ("230v" in combined_text or "corded" in combined_text or "50hz" in combined_text) and "cordless" not in combined_text:
        prohibited.append(
            "Product is 230V AC corded: do not render battery indicators or imply wireless/cordless portability"
        )

    # Add rejected user claims as explicit visual prohibitions
    for cv in strategy.claim_validations:
        if cv.status in ("unsupported", "contradictory"):
            prohibited.append(f"Do not depict or state rejected claim: '{cv.claim_text}'")

    return ReferenceImageConstraints(
        preserve_geometry=preserve_geometry,
        preserve_logo=preserve_logo,
        preserve_buttons_and_controls=preserve_controls,
        preserve_color_and_finish=preserve_color,
        preserve_dimensions_and_proportions=preserve_dims,
        recognizable_design_features=recognizable_features,
        prohibited_inventions=prohibited,
    )

