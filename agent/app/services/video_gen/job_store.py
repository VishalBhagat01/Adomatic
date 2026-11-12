"""
AdPilot AI - Durable Video Job State & Operation Store (Step 08)
Persists job status, provider Veo operation IDs, scene completion states, and
request snapshots in Redis (when reachable) backed by local JSON checkpoints
so interrupted video jobs can resume cleanly after worker restarts.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from typing import List, Optional

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.video_gen import VideoJobSnapshot
from agent.app.services.cache import AgentCache, agent_cache, is_redis_reachable


class VideoJobStore:
    """Dual Redis + local-file checkpoint store for async video jobs & recovery."""

    REDIS_KEY_PREFIX = "adpilot:video_job:"
    REDIS_ACTIVE_SET = "adpilot:video_jobs:active"

    def __init__(
        self,
        cache: Optional[AgentCache] = None,
        state_dir: Optional[Path] = None,
        ttl_seconds: int = 86400 * 3,
    ):
        self.cache = cache or agent_cache
        configured_dir = settings.VIDEO_JOB_STATE_DIR.strip() if settings.VIDEO_JOB_STATE_DIR else ""
        default_dir = Path(configured_dir) if configured_dir else (Path(tempfile.gettempdir()) / "adpilot_video_jobs")
        self.state_dir = Path(state_dir) if state_dir is not None else default_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = ttl_seconds

    def _snapshot_path(self, job_id: str) -> Path:
        safe_id = job_id.replace("/", "_").replace("..", "_")
        return self.state_dir / f"{safe_id}.json"

    def _can_use_redis(self) -> bool:
        if getattr(self.cache, "_client", None) is not None:
            return True
        return is_redis_reachable(settings.REDIS_URL, default_port=6379)

    def save_snapshot(self, snapshot: VideoJobSnapshot) -> None:
        snapshot.job.updated_at = datetime.now(timezone.utc)
        serialized = snapshot.model_dump_json()

        # Always persist durable file checkpoint so local recovery never loses state
        try:
            self._snapshot_path(snapshot.job.job_id).write_text(serialized, encoding="utf-8")
        except Exception as exc:
            logger.warning(f"Could not write local video job checkpoint '{snapshot.job.job_id}': {exc}")

        if self._can_use_redis():
            try:
                key = f"{self.REDIS_KEY_PREFIX}{snapshot.job.job_id}"
                self.cache.client.set(key, serialized, ex=self.ttl_seconds)
                if snapshot.job.status in {"COMPLETED", "FAILED"}:
                    self.cache.client.srem(self.REDIS_ACTIVE_SET, snapshot.job.job_id)
                else:
                    self.cache.client.sadd(self.REDIS_ACTIVE_SET, snapshot.job.job_id)
            except Exception as exc:
                logger.warning(f"Redis save warning for video job '{snapshot.job.job_id}': {exc}")

    def load_snapshot(self, job_id: str) -> Optional[VideoJobSnapshot]:
        if self._can_use_redis():
            try:
                raw = self.cache.client.get(f"{self.REDIS_KEY_PREFIX}{job_id}")
                if raw:
                    return VideoJobSnapshot.model_validate_json(raw)
            except Exception as exc:
                logger.debug(f"Redis load fallback for '{job_id}': {exc}")

        local_path = self._snapshot_path(job_id)
        if local_path.exists():
            try:
                return VideoJobSnapshot.model_validate_json(local_path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.error(f"Corrupt local video job checkpoint '{local_path}': {exc}")
        return None

    def list_recoverable_job_ids(self) -> List[str]:
        """Identify in-flight jobs that were interrupted before COMPLETED/FAILED."""
        ids: set[str] = set()
        if self._can_use_redis():
            try:
                members = self.cache.client.smembers(self.REDIS_ACTIVE_SET) or []
                ids.update(str(m) for m in members)
            except Exception:
                pass

        for path in self.state_dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                status = (data.get("job") or {}).get("status")
                jid = (data.get("job") or {}).get("job_id")
                if jid and status not in {"COMPLETED", "FAILED"}:
                    ids.add(jid)
            except Exception:
                continue
        return sorted(ids)


video_job_store = VideoJobStore()

