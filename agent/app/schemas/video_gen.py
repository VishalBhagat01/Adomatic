"""
AdPilot AI - Video Generation & FFmpeg Assembly Schemas (Step 08)
Strict Pydantic v2 models covering Veo job submission, async operation tracking,
worker restart recovery snapshots, FFmpeg processing diagnostics, video quality validation,
and final MinIO/S3 asset manifests.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from agent.app.schemas.creative import VideoStoryboard
from agent.app.schemas.image_gen import ReferenceImageSelection
from agent.app.schemas.product import Product

VideoJobStatus = Literal[
    "QUEUED",
    "VALIDATING_STORYBOARD",
    "GENERATING_SCENES",
    "POLLING_OPERATIONS",
    "VALIDATING_CLIPS",
    "ASSEMBLING_VIDEO",
    "COMPLETED",
    "FAILED",
]

SceneJobStatus = Literal[
    "PENDING",
    "SUBMITTED",
    "POLLING",
    "COMPLETED",
    "REJECTED",
    "FAILED",
]


class VideoGenerationPreferences(BaseModel):
    """Caller preferences controlling Veo synthesis, audio mixing, and FFmpeg assembly."""
    aspect_ratio: Optional[Literal["9:16", "16:9", "4:5", "1:1"]] = Field(
        default=None,
        description="Target assembled aspect ratio; defaults to VideoStoryboard aspect_ratio",
    )
    resolution: Optional[Literal["720p", "1080p"]] = Field(
        default=None,
        description="Target resolution tier for Veo generation and FFmpeg assembly",
    )
    fps: int = Field(default=24, ge=15, le=60, description="Target normalized video frame rate")
    generate_native_audio: bool = Field(
        default=True,
        description="Enable native audio cues & Veo synchronized audio synthesis where supported",
    )
    require_audio: bool = Field(
        default=True,
        description="Require non-empty audio stream in assembled output (synthesizes voiceover/silent mix check)",
    )
    include_subtitles: bool = Field(
        default=True,
        description="Burn placement-safe synchronized captions from storyboard scene on_screen_text/voiceover",
    )
    include_cta_overlay: bool = Field(
        default=True,
        description="Render crisp final-beat CTA overlay card from storyboard.final_cta",
    )
    generation_mode: Literal["auto", "reference_images", "image_to_video", "text_to_video"] = Field(
        default="auto",
        description="Preferred visual conditioning strategy across storyboard scenes",
    )
    max_scene_clip_retries: int = Field(
        default=1,
        ge=0,
        le=3,
        description="Maximum regeneration attempts per scene if clip validation rejects a scene",
    )


class SceneVoiceoverInput(BaseModel):
    """Optional caller-supplied per-scene voiceover audio payload."""
    scene_number: int = Field(ge=1)
    audio_base64: Optional[str] = None
    mime_type: str = "audio/wav"


class VideoValidationCheck(BaseModel):
    """Individual deterministic validation check for scene clip or assembled video."""
    name: str
    passed: bool
    severity: Literal["error", "warning"]
    measured_value: Optional[str] = None
    expected_value: Optional[str] = None
    details: str


class VideoValidationResult(BaseModel):
    """Objective media probe, black-frame, audio clipping, transition, and reference similarity audit."""
    approved: bool
    corrupt: bool = False
    duration_seconds: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None
    aspect_ratio: Optional[str] = None
    fps: Optional[float] = None
    has_video_stream: bool = False
    has_audio_stream: bool = False
    max_volume_db: Optional[float] = None
    mean_volume_db: Optional[float] = None
    black_frame_duration_seconds: float = 0.0
    black_frame_ratio: float = 0.0
    transition_frames_valid: bool = True
    product_similarity_score: Optional[float] = Field(
        default=None,
        description="Measured color-histogram correlation [0.0..1.0] across sampled frames vs reference product",
    )
    checks: List[VideoValidationCheck] = Field(default_factory=list)
    rejection_reasons: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class SceneGenerationRecord(BaseModel):
    """Persisted execution record mapping a storyboard scene to Veo operation & S3 artifacts."""
    scene_number: int
    scene_duration_target: int
    veo_requested_duration: int
    veo_aspect_ratio: str
    prompt_used: str
    negative_prompt_used: str
    status: SceneJobStatus = "PENDING"
    generation_mode: Literal["reference_images", "image_to_video", "text_to_video"] = "reference_images"
    operation_name: Optional[str] = Field(
        default=None,
        description="Provider async operation resource name persisted for worker restart recovery",
    )
    poll_attempts: int = 0
    clip_attempts: int = 0
    raw_clip_object_key: Optional[str] = None
    normalized_clip_object_key: Optional[str] = None
    metadata_object_key: Optional[str] = None
    local_clip_path: Optional[str] = None
    presigned_url: Optional[str] = None
    estimated_cost_usd: float = 0.0
    validation: Optional[VideoValidationResult] = None
    error: Optional[str] = None


class FinalVideoArtifact(BaseModel):
    """Completed FFmpeg-assembled final advertisement video metadata & storage mapping."""
    video_id: str
    campaign_id: str
    concept_id: str
    object_key: str
    metadata_object_key: str
    bucket: str
    stored: bool
    presigned_url: Optional[str] = None
    storage_error: Optional[str] = None
    mime_type: str = "video/mp4"
    duration_seconds: float
    width: int
    height: int
    aspect_ratio: str
    fps: float
    has_audio: bool
    subtitles_rendered: bool = False
    cta_overlay_applied: bool = False
    voiceover_mixed: bool = False
    file_size_bytes: int = 0
    scene_to_video_map: Dict[str, str] = Field(default_factory=dict)
    validation: VideoValidationResult


class VideoGenerationRequest(BaseModel):
    """Input payload for Step 08 Veo generation & FFmpeg video assembly."""
    campaign_id: str = Field(min_length=1, max_length=120)
    storyboard: VideoStoryboard
    product_data: Product
    reference_image_urls: Optional[List[str]] = Field(
        default=None,
        description="Optional override product reference image URLs",
    )
    approved_image_urls: Optional[List[str]] = Field(
        default=None,
        description="Approved Step 07 creative image URLs usable for image-to-video anchoring",
    )
    preferences: VideoGenerationPreferences = Field(default_factory=VideoGenerationPreferences)
    voiceover_audio_base64: Optional[str] = Field(
        default=None,
        description="Optional base64-encoded narration audio track (WAV/MP3/AAC) to mix with loudness normalization",
    )
    scene_voiceovers: List[SceneVoiceoverInput] = Field(default_factory=list)
    execute_sync: bool = Field(
        default=False,
        description="When false (default), submits async background job and returns job_id; when true, awaits assembly",
    )


class VideoGenerationJobResponse(BaseModel):
    """Public status/result schema for async or completed video generation jobs."""
    job_id: str
    campaign_id: str
    concept_id: str
    status: VideoJobStatus
    model_identifier: str
    prompt_version: str
    target_aspect_ratio: str
    target_resolution: str
    progress_percent: int = Field(ge=0, le=100)
    scene_records: List[SceneGenerationRecord] = Field(default_factory=list)
    final_video: Optional[FinalVideoArtifact] = None
    selected_reference_images: List[ReferenceImageSelection] = Field(default_factory=list)
    total_estimated_cost_usd: float = 0.0
    total_latency_ms: float = 0.0
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class VideoJobSnapshot(BaseModel):
    """Durable state persisted in Redis / local state store to resume jobs after worker restart."""
    job: VideoGenerationJobResponse
    request: VideoGenerationRequest
    staging_dir: str

