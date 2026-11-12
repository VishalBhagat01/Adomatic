"""
AdPilot AI - Creative Planning & Prompt Engineering Schemas
Strict Pydantic v2 models converting MarketingStrategy and ProductData into
executable image blueprints, video storyboards, reference-image constraints,
and optimized generation prompts.
"""

from datetime import datetime, timezone
from typing import List, Literal, Optional
from pydantic import BaseModel, Field

from agent.app.schemas.product import Product
from agent.app.schemas.strategy import GenerationMetadata, MarketingStrategy


class PlacementSpecification(BaseModel):
    """Technical and creative constraints for a target advertising placement."""
    placement: str = Field(description="Placement identifier (e.g. instagram_feed, instagram_reels)")
    format: Literal["image", "video"] = Field(description="Target asset format")
    aspect_ratio: str = Field(description="Required aspect ratio (e.g. 1:1, 4:5, 9:16, 16:9)")
    recommended_resolution: str = Field(description="Pixel dimensions (e.g. 1080x1080, 1080x1920)")
    safe_zone_notes: str = Field(description="UI overlay & caption safe-zone guidance")
    default_duration_seconds: Optional[int] = Field(
        default=None,
        description="Recommended total video duration in seconds if format is video"
    )


class ReferenceImageConstraints(BaseModel):
    """
    Explicit visual preservation rules derived from ProductData to ensure image/video
    models reproduce the real product faithfully without hallucinating features.
    """
    preserve_geometry: str = Field(description="Instructions preserving exact silhouette and body geometry")
    preserve_logo: str = Field(description="Instructions preserving exact brand mark and typography")
    preserve_buttons_and_controls: str = Field(
        description="Instructions preserving exact dials, switches, buttons, or displays"
    )
    preserve_color_and_finish: str = Field(description="Exact color palette and surface material constraints")
    preserve_dimensions_and_proportions: str = Field(
        description="Scale, jar-to-motor proportions, and physical size consistency"
    )
    recognizable_design_features: List[str] = Field(
        default_factory=list,
        description="Specific real design traits that must remain visible and accurate"
    )
    prohibited_inventions: List[str] = Field(
        default_factory=list,
        description="Strict prohibitions preventing fabricated parts, capabilities, or overlays"
    )


class GenerationPrompt(BaseModel):
    """Executable prompt artifact compiled from dedicated image or video templates."""
    prompt_id: str = Field(description="Unique prompt identifier")
    target_medium: Literal["image", "video"]
    template_name: str = Field(description="Identifier of prompt engineering template applied")
    positive_prompt: str = Field(description="Complete executable generation prompt")
    negative_prompt: str = Field(description="Explicit negative instructions and defect exclusions")
    aspect_ratio: str = Field(description="Target generation aspect ratio matching placement")
    reference_constraints: ReferenceImageConstraints
    style_tags: List[str] = Field(default_factory=list)


class ImageCreativeBlueprint(BaseModel):
    """Complete, executable creative specification for a static/carousel image ad."""
    concept_id: str
    creative_title: str
    marketing_angle: str
    audience_hypothesis: str
    creative_objective: str = Field(description="Defined advertising objective for this creative")
    hook: str
    main_message: str
    visual_composition: str
    background_direction: str
    lighting_direction: str
    product_positioning: str
    camera_perspective: str
    brand_constraints: List[str] = Field(default_factory=list)
    negative_instructions: List[str] = Field(default_factory=list)
    reference_constraints: ReferenceImageConstraints
    aspect_ratio: str
    placement: str
    placement_spec: PlacementSpecification
    image_generation_prompt: GenerationPrompt


class VideoScene(BaseModel):
    """Single executable beat within a multi-scene video storyboard."""
    scene_number: int = Field(ge=1)
    scene_duration: int = Field(ge=1, description="Duration of this scene in whole seconds")
    opening_hook: Optional[str] = Field(
        default=None,
        description="Visual/spoken attention hook if this is an opening/hook beat"
    )
    scene_description: str
    camera_movement: str
    product_visibility: str = Field(description="How product geometry and controls appear on frame")
    voiceover_script: str
    on_screen_text: str
    sound_direction: str
    transition_instructions: str


class VideoStoryboard(BaseModel):
    """Complete, time-exact executable storyboard for video creative generation."""
    concept_id: str
    creative_title: str
    marketing_angle: str
    audience_hypothesis: str
    video_objective: str = Field(description="Defined objective of the video ad")
    total_duration: int = Field(ge=1, description="Total video duration in seconds; must equal sum of scenes")
    aspect_ratio: str
    placement: str
    placement_spec: PlacementSpecification
    opening_hook: str
    scene_sequence: List[VideoScene] = Field(min_length=2)
    final_cta: str
    brand_constraints: List[str] = Field(default_factory=list)
    negative_instructions: List[str] = Field(default_factory=list)
    reference_constraints: ReferenceImageConstraints
    video_generation_prompt: GenerationPrompt


class CreativeConcept(BaseModel):
    """Top-level concept unit linking strategy rationale to executable image or video blueprint."""
    concept_id: str
    creative_title: str
    format: Literal["image", "video"]
    marketing_angle_id: str
    marketing_angle_name: str
    audience_hypothesis: str
    creative_objective: str
    creative_direction_summary: str = Field(
        description="Distinct visual & narrative direction differentiating this concept beyond background swaps"
    )
    placement: str
    image_blueprint: Optional[ImageCreativeBlueprint] = None
    video_storyboard: Optional[VideoStoryboard] = None


# ---------------------------------------------------------------------------
# Gemini Structured Planning Draft Models (LLM generates rich concepts/scenes;
# local engine compiles exact specs, constraints, and generation prompt templates)
# ---------------------------------------------------------------------------


class ImageConceptDraft(BaseModel):
    """LLM-generated image creative direction before local template compilation."""
    concept_id: str
    creative_title: str
    marketing_angle_id: str
    marketing_angle_name: str
    audience_hypothesis: str
    creative_objective: str
    creative_direction_summary: str
    hook: str
    main_message: str
    visual_composition: str
    background_direction: str
    lighting_direction: str
    product_positioning: str
    camera_perspective: str
    placement: str
    style_tags: List[str] = Field(default_factory=list)
    extra_negative_instructions: List[str] = Field(default_factory=list)


class VideoConceptDraft(BaseModel):
    """LLM-generated video creative storyboard before local template compilation."""
    concept_id: str
    creative_title: str
    marketing_angle_id: str
    marketing_angle_name: str
    audience_hypothesis: str
    video_objective: str
    creative_direction_summary: str
    total_duration: int = Field(ge=1)
    placement: str
    opening_hook: str
    scene_sequence: List[VideoScene] = Field(min_length=2)
    final_cta: str
    style_tags: List[str] = Field(default_factory=list)
    extra_negative_instructions: List[str] = Field(default_factory=list)


class CreativePlanDraft(BaseModel):
    """Gemini structured output container containing image and video concept drafts."""
    image_concepts: List[ImageConceptDraft] = Field(default_factory=list)
    video_concepts: List[VideoConceptDraft] = Field(default_factory=list)
    planning_notes: str


# ---------------------------------------------------------------------------
# Compiled Executable Creative Plan & Validation Schemas
# ---------------------------------------------------------------------------


class CreativePlan(BaseModel):
    """Final validated, executable creative plan ready for downstream asset generators."""
    plan_id: str
    product_name: str
    brand: Optional[str] = None
    concepts: List[CreativeConcept] = Field(min_length=1)
    reference_constraints: ReferenceImageConstraints
    placement_specs: List[PlacementSpecification] = Field(default_factory=list)
    planning_notes: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CreativeValidationIssue(BaseModel):
    """Defect reported by the Creative Plan Validator."""
    code: str
    severity: Literal["error", "warning"]
    message: str
    concept_id: Optional[str] = None
    field_path: Optional[str] = None


class CreativeValidationResult(BaseModel):
    """Outcome of local creative blueprint validation."""
    passed: bool
    score: float = Field(ge=0.0, le=1.0)
    issues: List[CreativeValidationIssue] = Field(default_factory=list)


class CreativePlanRequest(BaseModel):
    """Input payload for POST /api/v1/creative/plan."""
    product_data: Product
    strategy: MarketingStrategy
    user_prompt: str = Field(min_length=5, max_length=2500)
    formats: List[Literal["image", "video"]] = Field(
        default_factory=lambda: ["image", "video"],
        min_length=1,
    )
    placements: List[str] = Field(
        default_factory=lambda: ["instagram_feed", "instagram_reels"],
        min_length=1,
    )
    target_video_duration: int = Field(
        default=15,
        ge=6,
        le=60,
        description="Requested video storyboard duration in seconds (scenes must sum strictly to this)"
    )


class CreativePlanResponse(BaseModel):
    """Response payload for POST /api/v1/creative/plan."""
    success: bool
    plan: Optional[CreativePlan] = None
    validation: Optional[CreativeValidationResult] = None
    generation_metadata: Optional[GenerationMetadata] = None
    warnings: List[str] = Field(default_factory=list)
    error: Optional[str] = None
