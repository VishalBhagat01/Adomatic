import socket
from urllib.parse import urlparse
import boto3
from botocore.client import Config
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


class AgentStorage:
    def __init__(self):
        self._client = None

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
                    read_timeout=1,
                    retries={"max_attempts": 1},
                ),
                region_name="us-east-1",
            )
        return self._client

    def check_connection(self) -> dict:
        if not is_service_reachable(settings.STORAGE_ENDPOINT, default_port=9000):
            return {"status": "degraded", "endpoint": settings.STORAGE_ENDPOINT, "reachable": False}

        try:
            self.s3_client.head_bucket(Bucket=settings.STORAGE_BUCKET_CREATIVES)
            return {"status": "ok", "endpoint": settings.STORAGE_ENDPOINT, "reachable": True}
        except Exception as e:
            return {"status": "degraded", "error": str(e), "endpoint": settings.STORAGE_ENDPOINT}


agent_storage = AgentStorage()
