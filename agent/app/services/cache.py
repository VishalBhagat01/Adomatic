import socket
from urllib.parse import urlparse
import redis
from agent.app.core.config import settings
from agent.app.core.logging import logger


def is_redis_reachable(url: str, default_port: int = 6379, timeout: float = 0.3) -> bool:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "localhost"
        port = parsed.port or default_port
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class AgentCache:
    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            self._client = redis.Redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_timeout=1,
                socket_connect_timeout=1,
                retry_on_timeout=False,
            )
        return self._client

    def ping(self) -> dict:
        if not is_redis_reachable(settings.REDIS_URL, default_port=6379):
            return {"status": "degraded", "reachable": False}

        try:
            res = self.client.ping()
            return {"status": "ok" if res else "degraded", "response": str(res), "reachable": True}
        except Exception as e:
            return {"status": "degraded", "error": str(e), "reachable": False}


agent_cache = AgentCache()
