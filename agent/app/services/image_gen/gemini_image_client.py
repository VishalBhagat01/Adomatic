"""
AdPilot AI - Official Google Gemini Image Generation Client (Step 07)
Uses google-genai SDK (`generate_content` with `response_modalities=["IMAGE"]`
and `types.ImageConfig`) strictly bound to the configured GEMINI_IMAGE_MODEL.
Never silently falls back to another model on error.
"""

import asyncio
from dataclasses import dataclass
import time
from typing import Any, List, Optional
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.image_gen import GenerationCostRecord
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
    TRANSIENT_STATUS_CODES,
)


@dataclass
class GeneratedImageRawResult:
    image_bytes: bytes
    mime_type: str
    model_identifier: str
    attempts: int
    latency_ms: float
    cost: GenerationCostRecord
    response_id: Optional[str] = None
    model_version: Optional[str] = None
    text_commentary: Optional[str] = None


def _extract_image_payload(response: Any) -> tuple[Optional[bytes], Optional[str], Optional[str]]:
    """Extract inline image bytes, MIME type, and optional commentary from Gemini response."""
    parts = getattr(response, "parts", None)
    if not parts:
        candidates = getattr(response, "candidates", None) or []
        if candidates:
            content = getattr(candidates[0], "content", None)
            parts = getattr(content, "parts", None)

    text_chunks: List[str] = []
    if parts:
        for part in parts:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                data = inline.data
                if isinstance(data, bytearray):
                    data = bytes(data)
                mime = getattr(inline, "mime_type", None) or "image/png"
                return data, mime, "\n".join(text_chunks) if text_chunks else None
            txt = getattr(part, "text", None)
            if txt:
                text_chunks.append(txt)

    return None, None, "\n".join(text_chunks) if text_chunks else None


class GeminiImageClient:
    """Async client wrapper for Gemini native multimodal image generation."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
        unit_cost_usd: Optional[float] = None,
        client: Optional[genai.Client] = None,
    ):
        self.api_key = api_key if api_key is not None else settings.GEMINI_API_KEY
        self.model_name = (model_name or settings.GEMINI_IMAGE_MODEL or "").strip()
        self.timeout_seconds = timeout_seconds or settings.IMAGE_GEN_TIMEOUT_SECONDS
        self.max_retries = settings.IMAGE_GEN_MAX_RETRIES if max_retries is None else max_retries
        self.unit_cost_usd = (
            settings.GEMINI_IMAGE_ESTIMATED_COST_USD if unit_cost_usd is None else unit_cost_usd
        )
        self._client = client

    def _validate_configuration(self) -> None:
        if self._client is not None:
            if not self.model_name:
                raise GeminiConfigurationError(
                    "GEMINI_IMAGE_MODEL must be explicitly configured and non-empty."
                )
            return

        if not self.api_key or not self.api_key.strip() or "your_gemini_api_key" in self.api_key:
            raise GeminiConfigurationError(
                "GEMINI_API_KEY is not configured. Set a valid Google Gemini API key in environment variables."
            )
        if not self.model_name:
            raise GeminiConfigurationError(
                "GEMINI_IMAGE_MODEL must be configured and non-empty."
            )

    def _get_client(self) -> genai.Client:
        self._validate_configuration()
        if self._client is None:
            # HttpOptions timeout expects milliseconds in google-genai >=1.0
            self._client = genai.Client(
                api_key=self.api_key,
                http_options=types.HttpOptions(timeout=int(self.timeout_seconds * 1000)),
            )
        return self._client

    async def generate_image(
        self,
        *,
        positive_prompt: str,
        negative_prompt: str,
        aspect_ratio: str,
        reference_parts: List[types.Part],
        image_size: Optional[str] = None,
    ) -> GeneratedImageRawResult:
        """
        Invoke configured Gemini image model with multimodal product references and aspect config.
        Enforces bounded retries for 429/5xx/timeouts and never falls back to another model.
        """
        client = self._get_client()
        full_prompt = positive_prompt
        if negative_prompt:
            full_prompt = f"{positive_prompt}\n\nSTRICT NEGATIVE EXCLUSIONS (AVOID IN SCENE):\n{negative_prompt}"

        contents: List[Any] = [*reference_parts, full_prompt]
        image_cfg_kwargs: dict[str, Any] = {"aspect_ratio": aspect_ratio}
        resolved_size = image_size or settings.GEMINI_IMAGE_SIZE
        if resolved_size:
            image_cfg_kwargs["image_size"] = resolved_size

        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(**image_cfg_kwargs),
        )

        last_exc: Optional[Exception] = None
        last_status: Optional[int] = None
        start_time = time.perf_counter()
        total_attempts = 0

        for attempt in range(self.max_retries + 1):
            total_attempts = attempt + 1
            try:
                response = await asyncio.wait_for(
                    client.aio.models.generate_content(
                        model=self.model_name,
                        contents=contents,
                        config=config,
                    ),
                    timeout=self.timeout_seconds,
                )

                img_bytes, mime_type, commentary = _extract_image_payload(response)
                if not img_bytes:
                    raise GeminiExecutionError(
                        f"Gemini image model '{self.model_name}' returned no inline image bytes"
                        + (f" (commentary: {commentary[:200]})" if commentary else ""),
                        model_name=self.model_name,
                        attempts=total_attempts,
                    )

                elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
                usage = getattr(response, "usage_metadata", None)
                cost_record = GenerationCostRecord(
                    model_identifier=self.model_name,
                    prompt_tokens=getattr(usage, "prompt_token_count", None) if usage else None,
                    candidates_tokens=getattr(usage, "candidates_token_count", None) if usage else None,
                    total_tokens=getattr(usage, "total_token_count", None) if usage else None,
                    estimated_cost_usd=round(self.unit_cost_usd, 6),
                    pricing_basis="configured_per_image_estimate",
                )

                return GeneratedImageRawResult(
                    image_bytes=img_bytes,
                    mime_type=mime_type or "image/png",
                    model_identifier=self.model_name,
                    attempts=total_attempts,
                    latency_ms=elapsed_ms,
                    cost=cost_record,
                    response_id=getattr(response, "response_id", None),
                    model_version=getattr(response, "model_version", None),
                    text_commentary=commentary,
                )

            except genai_errors.APIError as api_err:
                last_exc = api_err
                last_status = getattr(api_err, "code", None)
                err_text = str(api_err)
                is_zero_quota = last_status == 429 and (
                    "limit: 0" in err_text or "FreeTier" in err_text
                )
                is_transient = last_status in TRANSIENT_STATUS_CODES and not is_zero_quota
                if is_zero_quota:
                    logger.warning(
                        f"Gemini image model '{self.model_name}' hit FreeTier / limit: 0 quota "
                        f"(attempt={total_attempts}); failing fast without retrying."
                    )
                if is_transient and attempt < self.max_retries:
                    delay = (1.25 * (2**attempt)) if last_status == 429 else (0.6 * (2**attempt))
                    logger.warning(
                        f"Transient Gemini image API error (status={last_status}, model={self.model_name}, "
                        f"attempt={total_attempts}); retrying in {delay:.2f}s"
                    )
                    await asyncio.sleep(delay)
                    continue

                raise GeminiExecutionError(
                    f"Gemini image API call failed on configured model '{self.model_name}' "
                    f"(status={last_status}): {api_err}",
                    model_name=self.model_name,
                    status_code=last_status,
                    attempts=total_attempts,
                ) from api_err

            except (asyncio.TimeoutError, TimeoutError) as timeout_err:
                last_exc = timeout_err
                if attempt < self.max_retries:
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                raise GeminiExecutionError(
                    f"Gemini image call timed out after {self.timeout_seconds}s on model '{self.model_name}'",
                    model_name=self.model_name,
                    status_code=408,
                    attempts=total_attempts,
                ) from timeout_err

            except GeminiExecutionError:
                raise

            except Exception as exc:
                last_exc = exc
                raise GeminiExecutionError(
                    f"Unexpected error calling Gemini image model '{self.model_name}': {exc}",
                    model_name=self.model_name,
                    attempts=total_attempts,
                ) from exc

        raise GeminiExecutionError(
            f"Gemini image call failed after {total_attempts} attempts on '{self.model_name}': {last_exc}",
            model_name=self.model_name,
            status_code=last_status,
            attempts=total_attempts,
        )

