"""
AdPilot AI - Official Google Veo Video Generation Client (Step 08)
Uses google-genai SDK (`client.aio.models.generate_videos`, `operations.get`,
and `files.download`) strictly pinned to configured GEMINI_VIDEO_MODEL.
Supports operation ID reconstruction for recovery after worker restarts and
never silently switches models on error.
"""

import asyncio
from dataclasses import dataclass
import time
from typing import Any, List, Optional, Tuple
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
    TRANSIENT_STATUS_CODES,
)


@dataclass
class SubmittedVeoOperation:
    operation_name: str
    operation: Any
    model_identifier: str
    generation_mode: str


class VeoVideoClient:
    """Async client wrapper for Google Veo video generation & operation polling."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout_seconds: float = 60.0,
        max_retries: Optional[int] = None,
        poll_interval_seconds: Optional[float] = None,
        poll_max_interval_seconds: Optional[float] = None,
        max_poll_attempts: Optional[int] = None,
        cost_per_second_usd: Optional[float] = None,
        client: Optional[genai.Client] = None,
    ):
        self.api_key = api_key if api_key is not None else settings.GEMINI_API_KEY
        self.model_name = (model_name or settings.GEMINI_VIDEO_MODEL or "").strip()
        self.timeout_seconds = timeout_seconds
        self.max_retries = settings.VIDEO_JOB_MAX_RETRIES if max_retries is None else max_retries
        self.poll_interval_seconds = (
            settings.VIDEO_JOB_POLL_INTERVAL_SECONDS if poll_interval_seconds is None else poll_interval_seconds
        )
        self.poll_max_interval_seconds = (
            settings.VIDEO_JOB_POLL_MAX_INTERVAL_SECONDS
            if poll_max_interval_seconds is None
            else poll_max_interval_seconds
        )
        self.max_poll_attempts = (
            settings.VIDEO_JOB_MAX_POLL_ATTEMPTS if max_poll_attempts is None else max_poll_attempts
        )
        self.cost_per_second_usd = (
            settings.GEMINI_VIDEO_COST_PER_SECOND_USD if cost_per_second_usd is None else cost_per_second_usd
        )
        self._client = client

    def validate_configuration(self) -> None:
        if not self.model_name:
            raise GeminiConfigurationError(
                "GEMINI_VIDEO_MODEL must be explicitly configured and non-empty."
            )
        if self._client is not None:
            return
        if not self.api_key or not self.api_key.strip() or "your_gemini_api_key" in self.api_key:
            raise GeminiConfigurationError(
                "GEMINI_API_KEY is not configured. Set a valid Google Gemini API key for Veo video generation."
            )

    def _get_client(self) -> genai.Client:
        self.validate_configuration()
        if self._client is None:
            self._client = genai.Client(
                api_key=self.api_key,
                http_options=types.HttpOptions(timeout=int(self.timeout_seconds * 1000)),
            )
        return self._client

    async def submit_scene_job(
        self,
        *,
        prompt: str,
        negative_prompt: str,
        aspect_ratio: str,
        duration_seconds: int,
        resolution: str,
        fps: Optional[int] = None,
        generate_audio: Optional[bool] = None,
        first_frame_image: Optional[Tuple[bytes, str]] = None,
        reference_images: Optional[List[Tuple[bytes, str]]] = None,
    ) -> SubmittedVeoOperation:
        """
        Submit an async Veo video generation job via `models.generate_videos`.
        Enforces SDK rule: `image` (I2V first frame) and `config.reference_images` are mutually exclusive.
        """
        client = self._get_client()

        config_kwargs: dict[str, Any] = {
            "aspect_ratio": aspect_ratio,
            "duration_seconds": duration_seconds,
            "resolution": resolution,
            "number_of_videos": 1,
            "negative_prompt": negative_prompt,
        }
        if fps is not None:
            config_kwargs["fps"] = fps
        if generate_audio is not None:
            config_kwargs["generate_audio"] = generate_audio

        image_arg: Optional[types.Image] = None
        generation_mode = "text_to_video"

        if first_frame_image is not None:
            img_bytes, mime = first_frame_image
            image_arg = types.Image(image_bytes=img_bytes, mime_type=mime)
            generation_mode = "image_to_video"
        elif reference_images:
            ref_objs = [
                types.VideoGenerationReferenceImage(
                    image=types.Image(image_bytes=rb, mime_type=rmime),
                    reference_type=types.VideoGenerationReferenceType.ASSET,
                )
                for rb, rmime in reference_images[:3]
            ]
            config_kwargs["reference_images"] = ref_objs
            generation_mode = "reference_images"

        config = types.GenerateVideosConfig(**config_kwargs)

        last_exc: Optional[Exception] = None
        last_status: Optional[int] = None
        for attempt in range(self.max_retries + 1):
            try:
                call_kwargs: dict[str, Any] = {
                    "model": self.model_name,
                    "prompt": prompt,
                    "config": config,
                }
                if image_arg is not None:
                    call_kwargs["image"] = image_arg

                op = await asyncio.wait_for(
                    client.aio.models.generate_videos(**call_kwargs),
                    timeout=self.timeout_seconds,
                )
                op_name = getattr(op, "name", None)
                if not op_name:
                    raise GeminiExecutionError(
                        f"Veo model '{self.model_name}' returned an operation without a resource name.",
                        model_name=self.model_name,
                        attempts=attempt + 1,
                    )
                return SubmittedVeoOperation(
                    operation_name=op_name,
                    operation=op,
                    model_identifier=self.model_name,
                    generation_mode=generation_mode,
                )
            except genai_errors.APIError as api_err:
                last_exc = api_err
                last_status = getattr(api_err, "code", None)
                if last_status in TRANSIENT_STATUS_CODES and attempt < self.max_retries:
                    delay = (1.5 * (2**attempt)) if last_status == 429 else (0.7 * (2**attempt))
                    logger.warning(
                        f"Transient Veo submission error (status={last_status}, model={self.model_name}); "
                        f"retrying in {delay:.2f}s"
                    )
                    await asyncio.sleep(delay)
                    continue
                raise GeminiExecutionError(
                    f"Veo video submission failed on configured model '{self.model_name}' "
                    f"(status={last_status}): {api_err}",
                    model_name=self.model_name,
                    status_code=last_status,
                    attempts=attempt + 1,
                ) from api_err
            except (asyncio.TimeoutError, TimeoutError) as timeout_err:
                last_exc = timeout_err
                if attempt < self.max_retries:
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                raise GeminiExecutionError(
                    f"Veo video submission timed out on model '{self.model_name}'",
                    model_name=self.model_name,
                    status_code=408,
                    attempts=attempt + 1,
                ) from timeout_err
            except GeminiExecutionError:
                raise
            except Exception as exc:
                raise GeminiExecutionError(
                    f"Unexpected Veo video submission error on '{self.model_name}': {exc}",
                    model_name=self.model_name,
                    attempts=attempt + 1,
                ) from exc

        raise GeminiExecutionError(
            f"Veo submission failed after retries on '{self.model_name}': {last_exc}",
            model_name=self.model_name,
            status_code=last_status,
        )

    async def poll_operation(
        self,
        *,
        operation_name: str,
        initial_operation: Optional[Any] = None,
    ) -> Tuple[Any, int]:
        """
        Poll Veo long-running operation until completion using bounded exponential backoff.
        Accepts raw `operation_name` when `initial_operation` is None (worker restart recovery).
        """
        client = self._get_client()
        operation = initial_operation or types.GenerateVideosOperation(name=operation_name)
        poll_count = 0

        for poll_idx in range(self.max_poll_attempts):
            if getattr(operation, "done", False):
                err = getattr(operation, "error", None)
                if err:
                    raise GeminiExecutionError(
                        f"Veo operation '{operation_name}' failed on '{self.model_name}': {err}",
                        model_name=self.model_name,
                        status_code=502,
                        attempts=poll_count,
                    )
                return operation, poll_count

            sleep_for = min(
                self.poll_max_interval_seconds,
                self.poll_interval_seconds * (1.35**poll_idx),
            )
            await asyncio.sleep(sleep_for)
            poll_count += 1

            try:
                operation = await asyncio.wait_for(
                    client.aio.operations.get(operation),
                    timeout=self.timeout_seconds,
                )
            except genai_errors.APIError as api_err:
                status_code = getattr(api_err, "code", None)
                if status_code in TRANSIENT_STATUS_CODES:
                    logger.warning(f"Transient poll error ({status_code}) on '{operation_name}', continuing polling")
                    continue
                raise GeminiExecutionError(
                    f"Veo operation poll failed on '{operation_name}': {api_err}",
                    model_name=self.model_name,
                    status_code=status_code,
                    attempts=poll_count,
                ) from api_err
            except (asyncio.TimeoutError, TimeoutError):
                logger.warning(f"Timeout polling Veo operation '{operation_name}', continuing polling")
                continue

        if getattr(operation, "done", False):
            err = getattr(operation, "error", None)
            if err:
                raise GeminiExecutionError(
                    f"Veo operation '{operation_name}' failed: {err}",
                    model_name=self.model_name,
                    status_code=502,
                    attempts=poll_count,
                )
            return operation, poll_count

        raise GeminiExecutionError(
            f"Veo operation '{operation_name}' exceeded max poll attempts ({self.max_poll_attempts}).",
            model_name=self.model_name,
            status_code=504,
            attempts=poll_count,
        )

    async def download_video_bytes(self, operation: Any) -> bytes:
        """Retrieve completed MP4 bytes immediately (Veo retains files for 2 days)."""
        client = self._get_client()
        response = getattr(operation, "response", None) or getattr(operation, "result", None)
        generated_videos = getattr(response, "generated_videos", None) or []
        if not generated_videos:
            filtered_reasons = getattr(response, "rai_media_filtered_reasons", None)
            raise GeminiExecutionError(
                f"Veo operation completed with zero videos on '{self.model_name}'"
                + (f" (filtered: {filtered_reasons})" if filtered_reasons else ""),
                model_name=self.model_name,
                status_code=502,
            )

        video_obj = getattr(generated_videos[0], "video", None)
        if video_obj is None:
            raise GeminiExecutionError(
                f"Veo generated video entry contained no video handle on '{self.model_name}'.",
                model_name=self.model_name,
                status_code=502,
            )

        inline_bytes = getattr(video_obj, "video_bytes", None)
        if inline_bytes:
            return bytes(inline_bytes)

        downloaded = await asyncio.wait_for(
            client.aio.files.download(file=video_obj),
            timeout=self.timeout_seconds,
        )
        if isinstance(downloaded, (bytes, bytearray)):
            return bytes(downloaded)
        after_bytes = getattr(video_obj, "video_bytes", None)
        if after_bytes:
            return bytes(after_bytes)

        raise GeminiExecutionError(
            f"Unable to extract downloaded MP4 bytes from Veo video handle on '{self.model_name}'.",
            model_name=self.model_name,
            status_code=502,
        )

