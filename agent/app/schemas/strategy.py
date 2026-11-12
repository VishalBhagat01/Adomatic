"""
AdPilot AI - Product Understanding & Marketing Strategy Schemas
Strict Pydantic v2 models for Gemini structured output, claim validation,
personas, marketing angles, quality checks, and generation metadata.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from agent.app.schemas.product import Product


class ProductKnowledge(BaseModel):
    """
    Structured product understanding strictly separating verified facts
    from customer benefit interpretations and identified knowledge gaps.
    """
    product_category: str = Field(description="Grounded e-commerce product category")
    core_functionality: str = Field(description="Objective summary of what the product does")
    verified_features: List[str] = Field(
        default_factory=list,
        description="Factual features explicitly verified from ProductData specs/description"
    )
    customer_benefits: List[str] = Field(
        default_factory=list,
        description="Practical customer benefits directly derived from verified features"
    )
    differentiating_factors: List[str] = Field(
        default_factory=list,
        description="Competitive differentiators backed by actual specs, pricing, or ratings"
    )
    product_limitations: List[str] = Field(
        default_factory=list,
        description="Honest constraints or limitations observed from product data"
    )
    supported_claims: List[str] = Field(
        default_factory=list,
        description="Specific advertising claims factually supported by extracted product data"
    )
    missing_or_uncertain_info: List[str] = Field(
        default_factory=list,
        description="Important product details that are missing or unverified in ProductData"
    )


class AudiencePersona(BaseModel):
    """Target audience segment grounded in product functionality and prompt context."""
    persona_id: str = Field(description="Short stable ID such as 'persona_1'")
    persona_name: str = Field(description="Descriptive, non-generic target segment label")
    segment_context: str = Field(
        description="Behavioral usage context explaining fit without fabricating demographic statistics"
    )
    pain_points: List[str] = Field(
        min_length=1,
        description="Concrete problems or friction this product helps solve"
    )
    purchase_motivations: List[str] = Field(
        min_length=1,
        description="Factual reasons to buy based on verified specs, pricing, or reviews"
    )
    relevance_to_prompt: str = Field(
        description="How this segment aligns with the user's advertising objective"
    )


class ClaimValidation(BaseModel):
    """Audit result verifying user prompt or marketing claims against ProductData."""
    claim_text: str = Field(description="Specific claim requested or evaluated")
    source: Literal["user_prompt", "product_data", "strategy_check"] = Field(
        default="user_prompt",
        description="Where the claim originated"
    )
    status: Literal["supported", "unsupported", "contradictory", "unverifiable"] = Field(
        description="Validation verdict against extracted product data"
    )
    supporting_evidence: Optional[str] = Field(
        default=None,
        description="Exact specification, feature, or review backing the claim if supported"
    )
    reason: str = Field(description="Clear explanation for the validation verdict")
    safe_alternative: Optional[str] = Field(
        default=None,
        description="Factually compliant rewrite if original claim is unsupported or contradictory"
    )


class MarketingAngle(BaseModel):
    """Distinct creative advertising angle grounded in product evidence."""
    angle_id: str = Field(description="Unique identifier such as 'angle_1'")
    angle_name: str = Field(description="Concise, distinct strategic angle title")
    target_persona_id: str = Field(description="Matching persona_id from personas list")
    core_promise: str = Field(description="Central benefit/promise supported by verified facts")
    supporting_facts: List[str] = Field(
        min_length=1,
        description="Verified product specifications or features proving this angle"
    )
    recommended_messaging: str = Field(
        description="Recommended primary ad copy direction complying with factual constraints"
    )
    visual_direction: str = Field(
        description="Concrete visual scene, framing, lighting, and product display guidance"
    )
    hooks: List[str] = Field(
        min_length=2,
        description="2 to 4 opening hooks tailored for the target placements"
    )
    cta_recommendations: List[str] = Field(
        min_length=1,
        description="Recommended calls-to-action aligned with funnel intent"
    )
    recommended_placements: List[str] = Field(
        min_length=1,
        description="Best-fit placements from requested campaign placements"
    )


class PlacementGuidance(BaseModel):
    """Actionable placement-specific execution guidance."""
    placement: str = Field(description="Target placement identifier (e.g. instagram_reels)")
    format: str = Field(description="Asset format (image or video)")
    creative_direction: str = Field(description="Format/placement-specific composition advice")
    hook_style: str = Field(description="Recommended hook pacing or visual anchor")


class MarketingRecommendation(BaseModel):
    """Consolidated campaign execution recommendations."""
    priority_angle_id: str = Field(description="Top recommended angle_id to test first")
    recommended_formats: List[str] = Field(description="Recommended ad formats")
    placement_recommendations: List[PlacementGuidance] = Field(
        default_factory=list,
        description="Tailored recommendations per requested placement"
    )
    primary_cta: str = Field(description="Primary call-to-action")
    secondary_cta: Optional[str] = Field(default=None, description="Alternative call-to-action")
    creative_dos: List[str] = Field(default_factory=list, description="Essential creative guardrails to follow")
    creative_donts: List[str] = Field(default_factory=list, description="Claims or visuals to avoid")


class MarketingStrategy(BaseModel):
    """
    Complete Gemini-generated product understanding and marketing strategy.
    Enforces strict separation of verified product facts vs creative direction.
    """
    product_knowledge: ProductKnowledge
    personas: List[AudiencePersona] = Field(min_length=1)
    marketing_angles: List[MarketingAngle] = Field(min_length=1, max_length=5)
    claim_validations: List[ClaimValidation] = Field(default_factory=list)
    recommendations: MarketingRecommendation
    prompt_alignment_notes: str = Field(
        description="Explains how user prompt style/direction was applied and where factual constraints governed claims"
    )


class GenerationMetadata(BaseModel):
    """Execution telemetry and model provenance for Gemini generation calls."""
    model_name: str
    model_version: Optional[str] = None
    response_id: Optional[str] = None
    prompt_tokens: Optional[int] = None
    candidates_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    latency_ms: float
    attempts: int = 1
    regenerations: int = 0
    multimodal_images_used: int = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class QualityIssue(BaseModel):
    """Individual defect identified by local strategy quality checks."""
    code: str = Field(description="Machine-readable issue code")
    severity: Literal["error", "warning"]
    message: str
    field_path: Optional[str] = None


class QualityValidationResult(BaseModel):
    """Outcome of local quality gate validation."""
    passed: bool
    score: float = Field(ge=0.0, le=1.0)
    issues: List[QualityIssue] = Field(default_factory=list)


class StrategyGenerateRequest(BaseModel):
    """Input payload for POST /api/v1/strategy/generate."""
    product_data: Product = Field(description="Validated extracted product data from Step 4")
    user_prompt: str = Field(
        min_length=5,
        max_length=2500,
        description="User advertising creative prompt controlling tone, style, and goals"
    )
    formats: List[Literal["image", "video"]] = Field(
        default_factory=lambda: ["image"],
        min_length=1,
        description="Requested ad formats"
    )
    placements: List[str] = Field(
        default_factory=lambda: ["instagram_feed"],
        min_length=1,
        description="Target ad placements (e.g. instagram_feed, instagram_reels)"
    )
    reference_image_urls: Optional[List[str]] = Field(
        default=None,
        description="Optional override of reference product image URLs (defaults to product_data.images)"
    )
    fetch_images: bool = Field(
        default=True,
        description="Whether to download validated product reference images for Gemini multimodal vision"
    )
    learning_hints: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional non-overriding creative learning memory hints (angles, hooks, defects to avoid)"
    )


class StrategyGenerateResponse(BaseModel):
    """API output containing verified strategy, quality audit, and model telemetry."""
    success: bool
    strategy: Optional[MarketingStrategy] = None
    generation_metadata: Optional[GenerationMetadata] = None
    quality_validation: Optional[QualityValidationResult] = None
    warnings: List[str] = Field(default_factory=list)
    error: Optional[str] = None

