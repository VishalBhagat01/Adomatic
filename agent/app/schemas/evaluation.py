"""
AdPilot AI - Creative Evaluation & Ad Copy Schemas (Step 09)
Strict Pydantic v2 models for multimodal+deterministic creative audits,
configurable weighted scoring, hard rejection rules, regeneration instructions,
claim-linked ad copy generation, and bounded retry history.
"""

from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field, model_validator

from agent.app.schemas.creative import (
    ImageCreativeBlueprint,
    PlacementSpecification,
    VideoStoryboard,
)
from agent.app.schemas.image_gen import ImageValidationResult
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import GenerationMetadata, MarketingStrategy
from agent.app.schemas.video_gen import VideoValidationResult

EvaluationCriterionKey = Literal[
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
]

HARD_REJECTION_CODES = {
    "INCORRECT_PRODUCT_LOGO",
    "MATERIALLY_ALTERED_PRODUCT",
    "FABRICATED_PRODUCT_SPECIFICATION",
    "INCORRECT_PROMOTIONAL_PRICE",
    "MISLEADING_PRODUCT_DEMONSTRATION",
    "INVALID_OUTPUT_DIMENSIONS",
    "CORRUPT_ASSET",
    "MISSING_PRICE_FABRICATION",
    "UNSUPPORTED_HEALTH_CLAIM",
    "UNSUPPORTED_PERFORMANCE_GUARANTEE",
    "UNSUPPORTED_TESTIMONIAL_OR_REVIEW",
    "UNSUPPORTED_CERTIFICATION",
    "UNSUPPORTED_COMPARATIVE_CLAIM",
    "VISUAL_QUALITY_BLANK",
}


class EvaluationWeights(BaseModel):
    """Configurable weighted scoring distribution across all 10 audit criteria."""
    product_identity_fidelity: float = Field(default=0.18, ge=0.0, le=1.0)
    product_geometry_feature_consistency: float = Field(default=0.14, ge=0.0, le=1.0)
    logo_branding_accuracy: float = Field(default=0.12, ge=0.0, le=1.0)
    visual_quality: float = Field(default=0.10, ge=0.0, le=1.0)
    composition: float = Field(default=0.08, ge=0.0, le=1.0)
    message_clarity: float = Field(default=0.08, ge=0.0, le=1.0)
    marketing_angle_consistency: float = Field(default=0.08, ge=0.0, le=1.0)
    placement_suitability: float = Field(default=0.08, ge=0.0, le=1.0)
    text_readability: float = Field(default=0.06, ge=0.0, le=1.0)
    misleading_content_compliance: float = Field(default=0.08, ge=0.0, le=1.0)

    def normalized_map(self) -> Dict[str, float]:
        raw = self.model_dump()
        total = sum(raw.values())
        if total <= 0:
            raise ValueError("EvaluationWeights must have a positive sum.")
        return {k: v / total for k, v in raw.items()}


class EvaluationIssue(BaseModel):
    """Individual hard constraint violation, quality warning, or copy issue."""
    issue_id: str
    code: str
    criterion: Optional[str] = None
    severity: Literal["hard_rejection", "warning", "improvement"]
    source: Literal["deterministic", "multimodal_gemini", "claim_validator"]
    message: str
    evidence: Optional[str] = None
    suggested_fix: Optional[str] = None


class CriterionEvaluationScore(BaseModel):
    """Weighted score entry combining deterministic and multimodal audit findings."""
    criterion: EvaluationCriterionKey
    score: float = Field(ge=0.0, le=100.0)
    weight: float = Field(ge=0.0, le=1.0)
    weighted_contribution: float = Field(ge=0.0, le=100.0)
    deterministic_note: Optional[str] = None
    multimodal_note: Optional[str] = None


class RegenerationInstruction(BaseModel):
    """Structured prompt-repair guidance generated when an asset fails evaluation."""
    creative_id: str
    format: Literal["image", "video"]
    target_attempt: int = Field(ge=1)
    issues_addressed: List[str] = Field(default_factory=list)
    prompt_adjustments: List[str] = Field(default_factory=list)
    revised_positive_prompt: str
    revised_negative_prompt: str
    preserve_constraints: List[str] = Field(default_factory=list)
    estimated_additional_cost_usd: float = 0.0


class MultimodalCriterionItem(BaseModel):
    """Raw structured score returned by Gemini Vision per criterion before local checks."""
    criterion: EvaluationCriterionKey
    score: float = Field(ge=0.0, le=100.0)
    reasoning: str


class MultimodalEvaluationDraft(BaseModel):
    """Structured JSON response expected from Gemini multimodal creative audit."""
    criterion_scores: List[MultimodalCriterionItem] = Field(min_length=10, max_length=10)
    hard_violation_codes: List[str] = Field(default_factory=list)
    hard_violation_reasons: List[str] = Field(default_factory=list)
    observed_visible_text: List[str] = Field(
        default_factory=list,
        description="Exact visible promotional text, prices, labels, or logos observed inside the creative",
    )
    observed_product_details: str = Field(
        default="",
        description="Objective description of visible product appearance compared against references"
    )
    observed_visual_summary: str = Field(
        default="",
        description="Concise objective summary of visual scene, lighting, framing, and mood"
    )
    regeneration_hints: List[str] = Field(default_factory=list)


class CreativeEvaluation(BaseModel):
    """Complete independent evaluation record separating weighted quality from hard rejection."""
    evaluation_id: str
    campaign_id: str
    creative_id: str
    concept_id: str
    format: Literal["image", "video"]
    placement: str
    approved: bool
    decision: Literal["approved", "rejected_hard_rule", "rejected_low_score"]
    overall_weighted_score: float = Field(ge=0.0, le=100.0)
    approval_threshold: float
    criteria_scores: List[CriterionEvaluationScore] = Field(default_factory=list)
    hard_rejection_triggered: bool = False
    hard_rejection_reasons: List[str] = Field(default_factory=list)
    issues: List[EvaluationIssue] = Field(default_factory=list)
    deterministic_image_validation: Optional[ImageValidationResult] = None
    deterministic_video_validation: Optional[VideoValidationResult] = None
    observed_visual_summary: str = ""
    observed_visible_text: List[str] = Field(default_factory=list)
    regeneration_instruction: Optional[RegenerationInstruction] = None
    metadata: Optional[GenerationMetadata] = None
    storage_object_key: Optional[str] = None
    evaluated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LinkedClaimEvidence(BaseModel):
    """Traceability link tying a factual advertising statement back to verified ProductData."""
    claim_text: str
    verified_source_field: str
    evidence_snippet: str


class AdCopyVariant(BaseModel):
    """Single validated primary text, headline, or description variant."""
    variant_id: str
    copy_type: Literal["primary_text", "headline", "description"]
    text: str
    character_count: int = Field(ge=1)
    linked_claims: List[LinkedClaimEvidence] = Field(default_factory=list)
    visual_alignment_note: str


class AdCopyDraftItem(BaseModel):
    """LLM-generated copy item prior to deterministic claim verification."""
    text: str
    linked_product_facts: List[str] = Field(default_factory=list)
    visual_alignment_note: str


class AdCopyDraft(BaseModel):
    """Structured Gemini ad-copy response with 3 primary texts, 3 headlines, and 2 descriptions."""
    primary_texts: List[AdCopyDraftItem] = Field(min_length=3, max_length=3)
    headlines: List[AdCopyDraftItem] = Field(min_length=3, max_length=3)
    descriptions: List[AdCopyDraftItem] = Field(min_length=2, max_length=2)
    cta_recommendation: str
    creative_angle: str
    audience_hypothesis: str


class ValidatedAdCopy(BaseModel):
    """Claim-verified, visually consistent advertising copy bundle for an approved creative."""
    copy_id: str
    campaign_id: str
    creative_id: str
    concept_id: str
    placement: str
    approved: bool
    creative_angle: str
    audience_hypothesis: str
    cta_recommendation: str
    primary_texts: List[AdCopyVariant] = Field(default_factory=list)
    headlines: List[AdCopyVariant] = Field(default_factory=list)
    descriptions: List[AdCopyVariant] = Field(default_factory=list)
    rejected_claim_flags: List[EvaluationIssue] = Field(default_factory=list)
    metadata: Optional[GenerationMetadata] = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CreativeEvaluationRequest(BaseModel):
    """Standalone evaluation payload assessing an existing generated asset without regeneration."""
    campaign_id: str = Field(min_length=1, max_length=120)
    creative_id: str = Field(min_length=1, max_length=120)
    format: Literal["image", "video"]
    product_data: Product
    marketing_strategy: MarketingStrategy
    image_blueprint: Optional[ImageCreativeBlueprint] = None
    video_storyboard: Optional[VideoStoryboard] = None
    placement_spec: Optional[PlacementSpecification] = None
    creative_base64: Optional[str] = Field(default=None, description="Base64-encoded image or MP4 creative bytes")
    object_key: Optional[str] = Field(default=None, description="Existing MinIO/S3 object key to load")
    creative_url: Optional[str] = Field(default=None, description="Public HTTPS creative asset URL")
    reference_image_urls: Optional[List[str]] = None
    weights: EvaluationWeights = Field(default_factory=EvaluationWeights)
    approval_threshold: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    attempt_number: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def verify_blueprint_and_source(self):
        if self.format == "image" and self.image_blueprint is None:
            raise ValueError("image_blueprint is required when evaluating an image creative.")
        if self.format == "video" and self.video_storyboard is None:
            raise ValueError("video_storyboard is required when evaluating a video creative.")
        if not (self.creative_base64 or self.object_key or self.creative_url):
            raise ValueError("Provide at least one asset source: creative_base64, object_key, or creative_url.")
        return self


class AdCopyGenerateRequest(BaseModel):
    """Request to generate & claim-validate advertising copy for an approved creative."""
    campaign_id: str = Field(min_length=1, max_length=120)
    creative_id: str = Field(min_length=1, max_length=120)
    creative_evaluation: CreativeEvaluation
    product_data: Product
    marketing_strategy: MarketingStrategy
    image_blueprint: Optional[ImageCreativeBlueprint] = None
    video_storyboard: Optional[VideoStoryboard] = None
    creative_base64: Optional[str] = None
    object_key: Optional[str] = None


class RegenerationAttemptRecord(BaseModel):
    """Audit record preserving every generation version, cost, and evaluation verdict."""
    attempt_number: int
    creative_id: str
    object_key: Optional[str] = None
    generation_cost_usd: float = 0.0
    evaluation: CreativeEvaluation
    regeneration_instruction: Optional[RegenerationInstruction] = None


class EvaluateAndRegenerateRequest(BaseModel):
    """Orchestrated evaluation + bounded regeneration + approved ad copy workflow."""
    campaign_id: str = Field(min_length=1, max_length=120)
    creative_id: str = Field(min_length=1, max_length=120)
    format: Literal["image", "video"]
    product_data: Product
    marketing_strategy: MarketingStrategy
    image_blueprint: Optional[ImageCreativeBlueprint] = None
    video_storyboard: Optional[VideoStoryboard] = None
    creative_base64: Optional[str] = None
    object_key: Optional[str] = None
    reference_image_urls: Optional[List[str]] = None
    weights: EvaluationWeights = Field(default_factory=EvaluationWeights)
    approval_threshold: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    max_regenerations: Optional[int] = Field(default=None, ge=0, le=3)
    generate_ad_copy_on_approval: bool = True

    @model_validator(mode="after")
    def verify_blueprint_presence(self):
        if self.format == "image" and self.image_blueprint is None:
            raise ValueError("image_blueprint is required for image evaluation/regeneration.")
        if self.format == "video" and self.video_storyboard is None:
            raise ValueError("video_storyboard is required for video evaluation/regeneration.")
        if not (self.creative_base64 or self.object_key):
            raise ValueError("Provide initial asset via creative_base64 or object_key.")
        return self


class EvaluateAndRegenerateResponse(BaseModel):
    """Final result containing final approval status, preserved versions, total cost, and ad copy."""
    success: bool
    campaign_id: str
    concept_id: str
    format: Literal["image", "video"]
    final_creative_id: str
    final_evaluation: CreativeEvaluation
    attempt_history: List[RegenerationAttemptRecord] = Field(default_factory=list)
    total_attempts: int
    regenerations_performed: int
    total_generation_cost_usd: float = 0.0
    validated_ad_copy: Optional[ValidatedAdCopy] = None
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)

