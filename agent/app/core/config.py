import json
from pathlib import Path
from typing import Annotated, List, Literal, Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_AGENT_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
_ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    APP_NAME: str = "adpilot-agent"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    HOST: str = "0.0.0.0"
    PORT: int = Field(default=8000, ge=1, le=65535)
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: Annotated[List[str], NoDecode] = [
        "http://localhost:5173",
        "http://localhost:5000",
    ]

    # Infrastructure
    REDIS_URL: str = "redis://:adpilot_redis_pass@localhost:6379/0"
    STORAGE_ENDPOINT: str = "http://localhost:9000"
    STORAGE_ACCESS_KEY: str = "adpilot_minio_user"
    STORAGE_SECRET_KEY: str = "adpilot_minio_secret_key"
    STORAGE_BUCKET_CREATIVES: str = "adpilot-creatives"
    STORAGE_BUCKET_ASSETS: str = "adpilot-assets"
    STORAGE_BUCKET_TEMP: str = "adpilot-temp"

    # Multi-Provider LLM Configuration (Groq for fast text/vision + Gemini fallback & image gen)
    LLM_PROVIDER: Literal["auto", "groq", "gemini"] = Field(
        default="auto",
        description="Structured text/vision provider routing: 'auto' prefers Groq when GROQ_API_KEY is set and fails over to Gemini on transient capacity errors.",
    )
    GROQ_API_KEY: Optional[str] = Field(default=None, description="Groq Cloud API Key for fast structured text/vision inference")
    GROQ_BASE_URL: str = Field(default="https://api.groq.com/openai/v1", description="Groq OpenAI-compatible base URL")
    GROQ_MODEL: str = Field(default="openai/gpt-oss-120b", description="Primary Groq production text model identifier")
    GROQ_FALLBACK_MODELS: Annotated[List[str], NoDecode] = Field(
        default_factory=lambda: ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
        description="Groq text fallback models attempted after transient 429/503/timeout capacity errors",
    )
    GROQ_VISION_MODEL: str = Field(
        default="qwen/qwen3.8-27b",
        description="Primary Groq multimodal vision model identifier",
    )
    GROQ_VISION_FALLBACK_MODELS: Annotated[List[str], NoDecode] = Field(
        default_factory=list,
        description="Groq vision fallback models attempted after transient 429/503/timeout capacity errors",
    )
    GROQ_MAX_VISION_IMAGES: int = Field(
        default=2,
        ge=1,
        le=5,
        description="Maximum reference/creative images sent per Groq vision request (keeps TPM within Groq limits)",
    )
    GROQ_TIMEOUT_SECONDS: float = Field(default=45.0, gt=0.0, description="Request timeout for Groq API calls")
    GROQ_MAX_RETRIES: int = Field(default=2, ge=0, le=5, description="Bounded retries on transient Groq API errors")

    # Feature Toggles
    ENABLE_VIDEO_GENERATION: bool = Field(
        default=True,
        description="Enable Veo video generation endpoints; set false for image-only cost-saving mode",
    )

    # Gemini AI Configuration (Never commit real keys; configure via env)
    GEMINI_API_KEY: Optional[str] = Field(default=None, description="Google Gemini API Key")
    GEMINI_MODEL: str = Field(default="gemini-3.8-flash", description="Configured Gemini model identifier")
    GEMINI_FALLBACK_MODELS: Annotated[List[str], NoDecode] = Field(
        default_factory=list,
        description="Optional fallback models attempted ONLY after transient 429/503/timeout capacity errors",
    )
    GEMINI_TIMEOUT_SECONDS: float = Field(default=45.0, gt=0.0, description="Request timeout for Gemini API calls")
    GEMINI_MAX_RETRIES: int = Field(default=3, ge=0, le=5, description="Bounded retries on transient Gemini API errors")
    GEMINI_MAX_REGENERATIONS: int = Field(default=2, ge=0, le=3, description="Controlled regeneration attempts on quality failure")

    # Image Generation Configuration (Step 07 + Free Multi-Provider Fallback)
    IMAGE_PROVIDER: Literal["auto", "pollinations", "huggingface", "gemini"] = Field(
        default="auto",
        description=(
            "Image generation routing: 'auto' tries Gemini first and fails over to HuggingFace -> Pollinations -> Pillow; "
            "'pollinations' uses free Pollinations.ai directly; 'huggingface' tries HF first then Pollinations; 'gemini' is strict Gemini-only."
        ),
    )
    POLLINATIONS_MODEL: str = Field(
        default="flux",
        description="Pollinations.ai image model identifier (no API key required)",
    )
    HF_API_KEY: str = Field(
        default="",
        description="Optional Hugging Face Inference API token for free-tier text-to-image fallback",
    )
    HF_IMAGE_MODEL: str = Field(
        default="black-forest-labs/FLUX.1-schnell",
        description="Hugging Face router inference model identifier",
    )
    GEMINI_IMAGE_MODEL: str = Field(
        default="gemini-3.1-flash-image",
        description="Configured Gemini image generation model identifier",
    )
    GEMINI_IMAGE_SIZE: Optional[str] = Field(
        default=None,
        description="Optional resolution tier (1K, 2K, 4K) if supported by configured model",
    )
    IMAGE_GEN_TIMEOUT_SECONDS: float = Field(default=60.0, gt=0.0, description="Request timeout for image generation providers")
    IMAGE_GEN_MAX_RETRIES: int = Field(default=2, ge=0, le=5, description="Bounded retries on transient image API errors")
    IMAGE_MIN_WIDTH: int = Field(default=512, ge=64, description="Minimum accepted image width in pixels")
    IMAGE_MIN_HEIGHT: int = Field(default=512, ge=64, description="Minimum accepted image height in pixels")
    IMAGE_MAX_FILE_BYTES: int = Field(default=15 * 1024 * 1024, gt=0, description="Maximum allowed generated image file size")
    IMAGE_MAX_REFERENCE_IMAGES: int = Field(default=3, ge=1, le=14, description="Maximum product reference images per call")
    IMAGE_SIMILARITY_MIN_SCORE: float = Field(
        default=0.25, ge=0.0, le=1.0, description="Minimum tonal/structural similarity threshold against product reference"
    )
    GEMINI_IMAGE_ESTIMATED_COST_USD: float = Field(
        default=0.039, ge=0.0, description="Estimated USD cost per generated image at default resolution"
    )

    # Veo / Gemini Video Generation & FFmpeg Assembly Configuration (Step 08)
    GEMINI_VIDEO_MODEL: str = Field(
        default="veo-3.1-fast-generate-preview",
        description="Configured Google Veo video model identifier (never silently substituted)",
    )
    GEMINI_VIDEO_RESOLUTION: str = Field(default="720p", description="Target Veo generation resolution (720p or 1080p)")
    GEMINI_VIDEO_FPS: int = Field(default=24, ge=15, le=60, description="Normalized assembly output frame rate")
    GEMINI_VIDEO_GENERATE_AUDIO: Optional[bool] = Field(
        default=True, description="Enable native audio synthesis on supported Veo models"
    )
    GEMINI_VIDEO_COST_PER_SECOND_USD: float = Field(
        default=0.10, ge=0.0, description="Configurable per-second Veo clip cost estimate in USD"
    )
    VIDEO_JOB_POLL_INTERVAL_SECONDS: float = Field(default=10.0, gt=0.0, description="Initial Veo polling interval")
    VIDEO_JOB_POLL_MAX_INTERVAL_SECONDS: float = Field(default=30.0, gt=0.0, description="Maximum polling backoff cap")
    VIDEO_JOB_MAX_POLL_ATTEMPTS: int = Field(default=30, ge=1, le=200, description="Bounded Veo poll attempts")
    VIDEO_JOB_MAX_RETRIES: int = Field(default=2, ge=0, le=5, description="Bounded retries on transient Veo errors")
    VIDEO_REQUIRE_AUDIO_DEFAULT: bool = Field(default=True, description="Require valid audio track in assembled ads")
    VIDEO_BLACK_FRAME_MAX_RATIO: float = Field(
        default=0.35, ge=0.0, le=1.0, description="Maximum tolerated black-frame duration ratio per clip"
    )
    VIDEO_AUDIO_MAX_PEAK_DB: float = Field(
        default=-0.05, description="Threshold above 0 dB or hard ceiling indicating severe audio clipping risk"
    )
    VIDEO_SIMILARITY_MIN_SCORE: float = Field(
        default=0.22, ge=0.0, le=1.0, description="Minimum sampled-frame tonal similarity vs product references"
    )
    FFMPEG_BINARY: Optional[str] = Field(default=None, description="Optional explicit path to ffmpeg binary")
    FFPROBE_BINARY: Optional[str] = Field(default=None, description="Optional explicit path to ffprobe binary")
    VIDEO_JOB_STATE_DIR: str = Field(default="", description="Optional directory for durable video job snapshots")

    # Creative Evaluation & Ad Copy Configuration (Step 09)
    EVALUATION_APPROVAL_THRESHOLD: float = Field(
        default=75.0, ge=0.0, le=100.0, description="Minimum weighted evaluation score (0-100) required when no hard rule violated"
    )
    EVALUATION_MAX_REGENERATIONS: int = Field(
        default=2, ge=0, le=3, description="Maximum controlled regeneration retries for rejected creatives"
    )
    EVALUATION_MULTIMODAL_TEMPERATURE: float = Field(
        default=0.15, ge=0.0, le=1.0, description="Sampling temperature for Gemini multimodal creative audits"
    )

    @field_validator("IMAGE_PROVIDER", mode="before")
    @classmethod
    def normalize_image_provider(cls, v):
        if isinstance(v, str):
            cleaned = v.strip().lower()
            return cleaned or "auto"
        return v or "auto"

    @field_validator("HF_API_KEY", mode="before")
    @classmethod
    def normalize_hf_api_key(cls, v):
        if v is None:
            return ""
        return str(v).strip()

    @field_validator(
        "CORS_ORIGINS",
        "GEMINI_FALLBACK_MODELS",
        "GROQ_FALLBACK_MODELS",
        "GROQ_VISION_FALLBACK_MODELS",
        mode="before",
    )
    @classmethod
    def assemble_cors_origins(cls, v):
        if isinstance(v, str):
            raw = v.strip()
            if not raw:
                return []
            if raw.startswith("["):
                parsed = json.loads(raw)
                return [str(i).strip() for i in parsed if str(i).strip()]
            return [i.strip() for i in raw.split(",") if i.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=(_ROOT_ENV_FILE, _AGENT_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
