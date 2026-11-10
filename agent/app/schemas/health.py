from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class MemoryInfo(BaseModel):
    rss_mb: float = Field(..., description="Resident Set Size in MB")
    virtual_mb: float = Field(..., description="Virtual memory in MB")


class HealthResponse(BaseModel):
    status: str = Field(default="ok", json_schema_extra={"example": "ok"})
    service: str = Field(default="adpilot-agent", json_schema_extra={"example": "adpilot-agent"})
    version: str = Field(default="0.1.0", json_schema_extra={"example": "0.1.0"})
    timestamp: str = Field(..., description="ISO 8601 UTC timestamp")
    environment: str = Field(default="development", json_schema_extra={"example": "development"})
    uptime_seconds: int = Field(..., ge=0, description="Uptime in seconds")
    python_version: str = Field(..., json_schema_extra={"example": "3.13.5"})
    framework: str = Field(default="FastAPI + LangGraph")
    details: Optional[Dict[str, Any]] = None
