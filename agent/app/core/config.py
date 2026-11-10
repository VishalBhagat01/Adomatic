from typing import List, Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "adpilot-agent"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    HOST: str = "0.0.0.0"
    PORT: int = Field(default=8000, ge=1, le=65535)
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: List[str] = [
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

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v):
        if isinstance(v, str):
            return [i.strip() for i in v.split(",") if i.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
