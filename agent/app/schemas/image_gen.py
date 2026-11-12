"""
AdPilot AI - Image Generation Schemas (Step 07)
Strict Pydantic v2 models covering reference selection, validation diagnostics,
cost tracking, MinIO/S3 persistence metadata, deterministic text overlays, and API I/O.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from agent.app.schemas.creative import ImageCreativeBlueprint
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import MarketingStrategy

AspectRatioChoice = Literal["1:1", "4:5", "9:16"]


class ReferenceImageSelection(BaseModel):
    """Metadata describing a selected product reference image used for generation."""
    url: str
    mime_type: str
    width: Optional[int] = None
    height: Optional[int] = None
    byte_size: int = 0
    is_primary: bool = False
    selection_score: float = 0.0
    selection_reason: str


class ImageValidationCheck(BaseModel):
    """Single deterministic check within the generated-image validation pipeline."""
    name: str
    passed: bool
    severity: Literal["error", "warning"]
    measured_value: Optional[str] = None
    expected_value: Optional[str] = None
    details: str


class ImageValidationResult(BaseModel):
    """Complete quality, format, duplicate, and reference-consistency audit."""
    approved: bool
    checks: List[ImageValidationCheck] = Field(default_factory=list)
    rejection_reasons: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    width: Optional[int] = None
    height: Optional[int] = None
    detected_format: Optional[str] = None
    file_size_bytes: int = 0
    actual_aspect_ratio: Optional[str] = None
    sha256_hash: Optional[str] = None
    perceptual_hash: Optional[str] = None
    reference_similarity_score: Optional[float] = Field(
        default=None,
        description="Measured tonal/structural histogram correlation [0.0..1.0] vs best reference image",
    )
    pixel_std_dev: Optional[float] = None


class GenerationCostRecord(BaseModel):
    """Token telemetry and configurable cost estimation for Gemini image calls."""
    model_identifier: str
    prompt_tokens: Optional[int] = None
    candidates_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    estimated_cost_usd: float = 0.0
    pricing_basis: str = "configured_per_image_estimate"


class StoredGenerationMetadata(BaseModel):
    """Persisted audit record uploaded alongside each approved or rejected creative asset."""
    creative_id: str
    campaign_id: str
    concept_id: str
    variation_index: int
    image_object_key: str
    metadata_object_key: str
    overlay_object_key: Optional[str] = None
    bucket: str
    stored: bool
    presigned_url: Optional[str] = None
    overlay_presigned_url: Optional[str] = None
    storage_error: Optional[str] = None
    model_identifier: str
    prompt_version: str
    generation_parameters: Dict[str, Any] = Field(default_factory=dict)
    generation_cost: GenerationCostRecord
    generation_timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    validation_results: ImageValidationResult


class GeneratedImageAsset(BaseModel):
    """Complete single variation result returned by the image generation pipeline."""
    creative_id: str
    variation_index: int
    approved: bool
    mime_type: str
    width: Optional[int] = None
    height: Optional[int] = None
    aspect_ratio: str
    object_key: str
    metadata_object_key: str
    overlay_object_key: Optional[str] = None
    presigned_url: Optional[str] = None
    overlay_presigned_url: Optional[str] = None
    overlay_applied: bool = False
    text_overlay_spec: Optional[Dict[str, Optional[str]]] = None
    prompt_used: str
    negative_prompt_used: str
    attempts: int = 1
    latency_ms: float = 0.0
    cost: GenerationCostRecord
    validation: ImageValidationResult
    metadata: StoredGenerationMetadata


class ImageGenerationRequest(BaseModel):
    """Request payload for Step 07 Gemini product creative image generation."""
    campaign_id: str = Field(min_length=1, max_length=120)
    blueprint: ImageCreativeBlueprint
    marketing_strategy: MarketingStrategy
    product_data: Product
    aspect_ratio: Optional[AspectRatioChoice] = Field(
        default=None,
        description="Requested aspect ratio (1:1, 4:5, 9:16). Defaults to blueprint aspect_ratio if supported.",
    )
    num_variations: int = Field(
        default=2,
        ge=1,
        le=4,
        description="Number of distinct image variations to generate for this creative blueprint",
    )
    apply_deterministic_overlay: bool = Field(
        default=False,
        description="Render crisp Pillow headline/price/CTA overlay on approved clean base visuals",
    )
    overlay_headline: Optional[str] = Field(
        default=None,
        max_length=120,
        description="Optional explicit headline text when deterministic overlay is enabled",
    )
    overlay_cta: Optional[str] = Field(
        default=None,
        max_length=60,
        description="Optional explicit CTA text when deterministic overlay is enabled",
    )
    reference_image_urls: Optional[List[str]] = Field(
        default=None,
        description="Optional override URLs for product reference images",
    )
    image_size: Optional[Literal["1K", "2K", "4K"]] = Field(
        default=None,
        description="Optional resolution tier passed to ImageConfig when supported by model",
    )


class ImageGenerationResponse(BaseModel):
    """API response aggregating generated assets, validation status, storage keys, and cost."""
    success: bool
    campaign_id: str
    concept_id: str
    aspect_ratio: str
    model_identifier: str
    prompt_version: str
    requested_variations: int
    approved_count: int
    rejected_count: int
    selected_reference_images: List[ReferenceImageSelection] = Field(default_factory=list)
    assets: List[GeneratedImageAsset] = Field(default_factory=list)
    total_estimated_cost_usd: float = 0.0
    total_latency_ms: float = 0.0
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)

