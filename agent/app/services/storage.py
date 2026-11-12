import json
import socket
from typing import Any, Dict, Optional
from urllib.parse import urlparse
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from agent.app.core.config import settings
from agent.app.core.logging import logger


def is_service_reachable(url: str, default_port: int = 9000, timeout: float = 0.3) -> bool:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "localhost"
        port = parsed.port or default_port
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def build_creative_object_key(
    campaign_id: str,
    concept_id: str,
    creative_id: str,
    approved: bool,
    ext: str = "png",
    suffix: str = "",
) -> str:
    """Build deterministic S3/MinIO object key separating approved vs rejected creatives."""
    safe_campaign = campaign_id.strip().replace("/", "_")
    safe_concept = concept_id.strip().replace("/", "_")
    status_dir = "approved" if approved else "rejected"
    clean_ext = ext.lstrip(".").lower() or "png"
    return f"campaigns/{safe_campaign}/creatives/{safe_concept}/{status_dir}/{creative_id}{suffix}.{clean_ext}"


def build_video_object_key(
    campaign_id: str,
    concept_id: str,
    artifact_id: str,
    stage: str = "final",
    ext: str = "mp4",
) -> str:
    """Build S3/MinIO key for intermediate scenes, rejected clips, or final assembled videos."""
    safe_campaign = campaign_id.strip().replace("/", "_")
    safe_concept = concept_id.strip().replace("/", "_")
    safe_stage = stage.strip().replace("/", "_")
    clean_ext = ext.lstrip(".").lower() or "mp4"
    return f"campaigns/{safe_campaign}/videos/{safe_concept}/{safe_stage}/{artifact_id}.{clean_ext}"


class AgentStorage:
    def __init__(self, s3_client: Optional[Any] = None):
        self._client = s3_client

    @property
    def s3_client(self):
        if self._client is None:
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.STORAGE_ENDPOINT,
                aws_access_key_id=settings.STORAGE_ACCESS_KEY,
                aws_secret_access_key=settings.STORAGE_SECRET_KEY,
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"},
                    connect_timeout=1,
                    read_timeout=2,
                    retries={"max_attempts": 1},
                ),
                region_name="us-east-1",
            )
        return self._client

    def check_connection(self) -> dict:
        if self._client is None and not is_service_reachable(settings.STORAGE_ENDPOINT, default_port=9000):
            return {"status": "degraded", "endpoint": settings.STORAGE_ENDPOINT, "reachable": False}

        try:
            self.s3_client.head_bucket(Bucket=settings.STORAGE_BUCKET_CREATIVES)
            return {"status": "ok", "endpoint": settings.STORAGE_ENDPOINT, "reachable": True}
        except Exception as e:
            return {"status": "degraded", "error": str(e), "endpoint": settings.STORAGE_ENDPOINT}

    def ensure_bucket(self, bucket: str) -> None:
        """Verify bucket exists, creating it on live MinIO/S3 if missing."""
        try:
            self.s3_client.head_bucket(Bucket=bucket)
        except ClientError as exc:
            error_code = str(exc.response.get("Error", {}).get("Code", ""))
            if error_code in {"404", "NoSuchBucket", "NotFound"}:
                self.s3_client.create_bucket(Bucket=bucket)
            else:
                raise

    def upload_bytes(
        self,
        *,
        bucket: str,
        object_key: str,
        data: bytes,
        content_type: str,
        metadata: Optional[Dict[str, str]] = None,
        presign_expires_seconds: int = 3600,
    ) -> Dict[str, Any]:
        """Upload binary payload (image/file) safely to private MinIO/S3 storage."""
        if self._client is None and not is_service_reachable(settings.STORAGE_ENDPOINT, default_port=9000):
            msg = f"Object storage unreachable at {settings.STORAGE_ENDPOINT}"
            logger.warning(f"Skipped upload for {object_key}: {msg}")
            return {
                "stored": False,
                "bucket": bucket,
                "object_key": object_key,
                "presigned_url": None,
                "error": msg,
            }

        try:
            self.ensure_bucket(bucket)
            put_kwargs: Dict[str, Any] = {
                "Bucket": bucket,
                "Key": object_key,
                "Body": data,
                "ContentType": content_type,
            }
            if metadata:
                put_kwargs["Metadata"] = {
                    str(k): str(v)[:1024] for k, v in metadata.items() if v is not None
                }
            self.s3_client.put_object(**put_kwargs)
            presigned = self.generate_presigned_url(bucket, object_key, expires_in=presign_expires_seconds)
            return {
                "stored": True,
                "bucket": bucket,
                "object_key": object_key,
                "presigned_url": presigned,
                "error": None,
            }
        except Exception as exc:
            logger.error(f"Failed uploading object '{object_key}' to bucket '{bucket}': {exc}")
            return {
                "stored": False,
                "bucket": bucket,
                "object_key": object_key,
                "presigned_url": None,
                "error": str(exc),
            }

    def upload_json(
        self,
        *,
        bucket: str,
        object_key: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Serialize metadata payload as UTF-8 JSON and store alongside media assets."""
        serialized = json.dumps(payload, indent=2, default=str).encode("utf-8")
        return self.upload_bytes(
            bucket=bucket,
            object_key=object_key,
            data=serialized,
            content_type="application/json",
        )

    def generate_presigned_url(
        self,
        bucket: str,
        object_key: str,
        expires_in: int = 3600,
    ) -> Optional[str]:
        """Create short-lived presigned GET URL without exposing storage credentials."""
        try:
            return self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": object_key},
                ExpiresIn=expires_in,
            )
        except Exception as exc:
            logger.debug(f"Could not generate presigned URL for {object_key}: {exc}")
            return None

    def download_bytes(self, *, bucket: str, object_key: str) -> Optional[bytes]:
        """Download binary object from MinIO/S3 (used for worker restart recovery)."""
        if self._client is None and not is_service_reachable(settings.STORAGE_ENDPOINT, default_port=9000):
            return None
        try:
            resp = self.s3_client.get_object(Bucket=bucket, Key=object_key)
            body = resp.get("Body")
            if body is None:
                return None
            return body.read() if hasattr(body, "read") else bytes(body)
        except Exception as exc:
            logger.debug(f"Could not download '{object_key}' from bucket '{bucket}': {exc}")
            return None


agent_storage = AgentStorage()
