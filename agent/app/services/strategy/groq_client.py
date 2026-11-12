"""
AdPilot AI - Groq OpenAI-Compatible Structured Text & Vision Client
Provides fast structured JSON generation and multimodal inspection via GroqCloud's
Chat Completions API using `httpx`, enforcing strict schema preparation,
image payload budgeting, bounded transient retries, and local Pydantic validation.
"""

import asyncio
import base64
import copy
import io
import json
import random
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple, Type, TypeVar

import httpx
from PIL import Image
from pydantic import BaseModel, ValidationError

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.strategy import GenerationMetadata

TModel = TypeVar("TModel", bound=BaseModel)

GROQ_TRANSIENT_STATUS_CODES = {408, 413, 429, 500, 502, 503, 504}
GROQ_STRICT_SCHEMA_MODELS = {
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
}
GROQ_JSON_OBJECT_MODELS = {
    "qwen/qwen3.8-27b",
}
GROQ_MODEL_PARAMS: Dict[str, Dict[str, Any]] = {
    "openai/gpt-oss-120b": {"reasoning_effort": "low", "max_completion_tokens": 3500},
    "openai/gpt-oss-20b": {"reasoning_effort": "low", "max_completion_tokens": 3500},
    "openai/gpt-oss-safeguard-20b": {"reasoning_effort": "low", "max_completion_tokens": 2048},
    "qwen/qwen3.8-27b": {"reasoning_effort": "none", "max_completion_tokens": 950},
}


class GroqConfigurationError(Exception):
    """Raised when Groq API key or model configuration is missing or invalid."""


class GroqExecutionError(Exception):
    """Raised when Groq structured inference fails."""

    def __init__(
        self,
        message: str,
        model_name: str,
        status_code: Optional[int] = None,
        attempts: int = 1,
        transient: bool = False,
    ):
        super().__init__(message)
        self.model_name = model_name
        self.status_code = status_code
        self.attempts = attempts
        self.transient = transient


def _strip_markdown_fences(raw_text: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _normalize_schema_node(node: Any) -> Any:
    """Recursively enforce Groq/OpenAI strict JSON schema rules."""
    if not isinstance(node, dict):
        return node

    out = copy.deepcopy(node)
    out.pop("title", None)
    out.pop("default", None)

    # Strict mode forbids sibling keywords beside $ref
    if "$ref" in out:
        return {"$ref": out["$ref"]}

    if "$defs" in out and isinstance(out["$defs"], dict):
        out["$defs"] = {k: _normalize_schema_node(v) for k, v in out["$defs"].items()}

    if "properties" in out and isinstance(out["properties"], dict):
        out["type"] = "object"
        out["additionalProperties"] = False
        normalized_props: Dict[str, Any] = {}
        for prop_key, prop_val in out["properties"].items():
            normalized_props[prop_key] = _normalize_schema_node(prop_val)
        out["properties"] = normalized_props
        out["required"] = list(normalized_props.keys())

    if "items" in out:
        out["items"] = _normalize_schema_node(out["items"])

    for union_key in ("anyOf", "oneOf", "allOf"):
        if union_key in out and isinstance(out[union_key], list):
            out[union_key] = [_normalize_schema_node(item) for item in out[union_key]]

    return out


def build_groq_json_schema(schema_cls: Type[BaseModel]) -> Dict[str, Any]:
    """Compile a Pydantic model into Groq `response_format` JSON schema payload."""
    raw_schema = schema_cls.model_json_schema()
    normalized = _normalize_schema_node(raw_schema)
    return {
        "name": schema_cls.__name__,
        "strict": True,
        "schema": normalized,
    }


def _downscale_image_bytes(raw_bytes: bytes, max_edge: int = 1024, quality: int = 84) -> Tuple[bytes, str]:
    with Image.open(io.BytesIO(raw_bytes)) as img:
        rgb = img.convert("RGB")
        w, h = rgb.size
        longest = max(w, h)
        if longest > max_edge:
            scale = max_edge / float(longest)
            rgb = rgb.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        rgb.save(buf, format="JPEG", quality=quality, optimize=True)
        return buf.getvalue(), "image/jpeg"


def encode_image_parts_for_groq(
    image_parts: Optional[List[Any]],
    max_images: int = 3,
    max_total_bytes: int = 2_400_000,
) -> List[Dict[str, Any]]:
    """
    Convert google.genai Part items into OpenAI/Groq `image_url` base64 data URI blocks,
    respecting Groq's per-request image count and payload size budgets.
    """
    if not image_parts:
        return []

    raw_items: List[Tuple[bytes, str]] = []
    for part in image_parts:
        inline = getattr(part, "inline_data", None)
        data = getattr(inline, "data", None) if inline else None
        if not isinstance(data, (bytes, bytearray)) or len(data) == 0:
            continue
        mime = getattr(inline, "mime_type", None) or "image/jpeg"
        raw_items.append((bytes(data), mime))

    if not raw_items:
        return []

    # Preserve primary first reference(s) AND the final image (generated creative in evaluations)
    if len(raw_items) > max_images:
        if max_images >= 2:
            selected = raw_items[: max_images - 1] + [raw_items[-1]]
        else:
            selected = [raw_items[-1]]
    else:
        selected = raw_items

    total_bytes = sum(len(b) for b, _ in selected)
    prepared: List[Tuple[bytes, str]] = []
    per_image_budget = max(250_000, max_total_bytes // max(1, len(selected)))

    for raw_b, mime in selected:
        if total_bytes > max_total_bytes or len(raw_b) > per_image_budget:
            try:
                prepared.append(_downscale_image_bytes(raw_b))
                continue
            except Exception:
                pass
        prepared.append((raw_b, mime))

    return [
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:{mime};base64,{base64.b64encode(raw_b).decode('ascii')}"
            },
        }
        for raw_b, mime in prepared
    ]


def _extract_groq_error_message(resp: httpx.Response) -> str:
    try:
        payload = resp.json()
        err = payload.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or resp.text)
        if err:
            return str(err)
    except Exception:
        pass
    return resp.text[:400]


def _is_schema_mode_rejection(status_code: int, message: str) -> bool:
    if status_code != 400:
        return False
    lowered = message.lower()
    return any(
        token in lowered
        for token in (
            "response_format",
            "json_schema",
            "strict",
            "grammar",
            "structured output",
            "additionalproperties",
            "minitems",
            "maxitems",
            "minimum",
            "maximum",
            "schema",
            "failed to generate json",
            "failed_generation",
            "json_validate_failed",
        )
    )


class GroqStructuredClient:
    """Async client calling Groq Chat Completions API with Pydantic structured validation."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
        http_client_factory: Optional[Callable[[float], httpx.AsyncClient]] = None,
    ):
        self.api_key = api_key if api_key is not None else settings.GROQ_API_KEY
        self.base_url = (base_url or settings.GROQ_BASE_URL).rstrip("/")
        self.timeout_seconds = timeout_seconds or settings.GROQ_TIMEOUT_SECONDS
        self.max_retries = max_retries if max_retries is not None else settings.GROQ_MAX_RETRIES
        self._http_client_factory = http_client_factory

    def _has_valid_key(self) -> bool:
        return bool(
            self.api_key
            and self.api_key.strip()
            and self.api_key.strip() != "your_groq_api_key_here"
        )

    def _create_http_client(self) -> httpx.AsyncClient:
        if self._http_client_factory is not None:
            return self._http_client_factory(self.timeout_seconds)
        return httpx.AsyncClient(timeout=httpx.Timeout(self.timeout_seconds))

    async def generate_structured_with_models(
        self,
        candidate_models: List[str],
        prompt_text: str,
        response_schema: Type[TModel],
        system_instruction: str,
        image_parts: Optional[List[Any]] = None,
        temperature: float = 0.25,
    ) -> Tuple[TModel, GenerationMetadata]:
        if not self._has_valid_key():
            raise GroqConfigurationError(
                "GROQ_API_KEY environment variable is not configured. "
                "Add a valid key from https://console.groq.com/keys to enable Groq inference."
            )

        clean_models = [m.strip() for m in candidate_models if isinstance(m, str) and m.strip()]
        if not clean_models:
            raise GroqConfigurationError("No Groq models configured for structured inference.")

        max_images = getattr(settings, "GROQ_MAX_VISION_IMAGES", 2)
        encoded_images = encode_image_parts_for_groq(image_parts, max_images=max_images)
        schema_spec = build_groq_json_schema(response_schema)

        start_time = time.time()
        total_attempts = 0
        last_error: Optional[Exception] = None
        last_status: Optional[int] = None
        last_model_attempted = clean_models[0]

        async with self._create_http_client() as client:
            for idx, model_id in enumerate(clean_models):
                is_fallback = idx > 0
                if is_fallback:
                    logger.warning(
                        f"Groq model '{last_model_attempted}' unavailable ({last_error}); "
                        f"failing over to Groq model '{model_id}'."
                    )

                last_model_attempted = model_id
                can_failover = False
                max_tries = self.max_retries if not is_fallback else min(1, self.max_retries)
                use_json_object_fallback = model_id in GROQ_JSON_OBJECT_MODELS

                for attempt in range(max_tries + 1):
                    total_attempts += 1
                    is_strict = model_id in GROQ_STRICT_SCHEMA_MODELS
                    try:
                        resp = None
                        for schema_retry in range(2):
                            if use_json_object_fallback:
                                required_fields = [
                                    name
                                    for name, field_info in response_schema.model_fields.items()
                                    if field_info.is_required()
                                ]
                                all_fields = list(response_schema.model_fields.keys())
                                sys_content = (
                                    f"{system_instruction}\n\n"
                                    f"Return ONLY a single valid JSON object (no markdown fences). "
                                    f"Every top-level key in this list must appear in your JSON output: {', '.join(all_fields)}. "
                                    f"Strictly required fields (never omit): {', '.join(required_fields)}.\n"
                                    f"Exact JSON Schema:\n{json.dumps(schema_spec['schema'], separators=(',', ':'))}"
                                )
                                response_format: Dict[str, Any] = {"type": "json_object"}
                            else:
                                sys_content = system_instruction
                                response_format = {
                                    "type": "json_schema",
                                    "json_schema": {
                                        "name": schema_spec["name"],
                                        "strict": is_strict,
                                        "schema": schema_spec["schema"],
                                    },
                                }

                            if encoded_images:
                                user_content: Any = [
                                    {"type": "text", "text": prompt_text},
                                    *encoded_images,
                                ]
                            else:
                                user_content = prompt_text

                            payload: Dict[str, Any] = {
                                "model": model_id,
                                "messages": [
                                    {"role": "system", "content": sys_content},
                                    {"role": "user", "content": user_content},
                                ],
                                "temperature": temperature,
                                "response_format": response_format,
                                **GROQ_MODEL_PARAMS.get(model_id, {"max_completion_tokens": 2048}),
                            }

                            logger.info(
                                f"Calling Groq model '{model_id}' for {response_schema.__name__} "
                                f"(attempt {attempt + 1}/{max_tries + 1}, strict={is_strict and not use_json_object_fallback})",
                                extra={"extra": {"model": model_id, "images": len(encoded_images), "attempt": total_attempts}},
                            )

                            resp = await client.post(
                                f"{self.base_url}/chat/completions",
                                headers={
                                    "Authorization": f"Bearer {self.api_key.strip()}",
                                    "Content-Type": "application/json",
                                },
                                json=payload,
                            )

                            if (
                                schema_retry == 0
                                and not use_json_object_fallback
                                and resp.status_code == 400
                                and _is_schema_mode_rejection(resp.status_code, _extract_groq_error_message(resp))
                            ):
                                err_msg = _extract_groq_error_message(resp)
                                logger.warning(
                                    f"Groq model '{model_id}' rejected json_schema mode ({err_msg}); "
                                    f"retrying in json_object mode with local Pydantic validation."
                                )
                                use_json_object_fallback = True
                                continue
                            break

                        assert resp is not None
                        if resp.status_code >= 400:
                            err_msg = _extract_groq_error_message(resp)
                            last_status = resp.status_code

                            if resp.status_code not in GROQ_TRANSIENT_STATUS_CODES:
                                raise GroqExecutionError(
                                    message=f"Groq model '{model_id}' failed with HTTP {resp.status_code}: {err_msg}",
                                    model_name=model_id,
                                    status_code=resp.status_code,
                                    attempts=total_attempts,
                                    transient=False,
                                )

                            last_error = GroqExecutionError(
                                message=f"Groq model '{model_id}' failed with HTTP {resp.status_code}: {err_msg}",
                                model_name=model_id,
                                status_code=resp.status_code,
                                attempts=total_attempts,
                                transient=True,
                            )
                            can_failover = True
                            logger.warning(
                                f"Transient Groq HTTP {resp.status_code} on '{model_id}' "
                                f"(attempt {attempt + 1}): {err_msg}"
                            )
                            # Rate-limit / payload-size 429/413 won't clear within 1-2s; move straight to next model/provider
                            if resp.status_code in {413, 429}:
                                break
                        else:
                            data = resp.json()
                            choices = data.get("choices") or []
                            if not choices:
                                raise ValueError("Groq returned empty choices list.")
                            content = choices[0].get("message", {}).get("content")
                            if not isinstance(content, str) or not content.strip():
                                raise ValueError("Groq returned empty message content.")

                            cleaned = _strip_markdown_fences(content)
                            parsed_model = response_schema.model_validate_json(cleaned)

                            latency_ms = round((time.time() - start_time) * 1000, 2)
                            usage = data.get("usage") or {}
                            meta = GenerationMetadata(
                                model_name=model_id,
                                model_version=data.get("model"),
                                response_id=data.get("id"),
                                prompt_tokens=usage.get("prompt_tokens"),
                                candidates_tokens=usage.get("completion_tokens"),
                                total_tokens=usage.get("total_tokens"),
                                latency_ms=latency_ms,
                                attempts=total_attempts,
                                regenerations=0,
                                multimodal_images_used=len(encoded_images),
                            )
                            return parsed_model, meta

                    except GroqExecutionError as groq_err:
                        if not groq_err.transient:
                            raise
                        last_error = groq_err
                        can_failover = True

                    except (httpx.TimeoutException, httpx.TransportError, TimeoutError, ConnectionError) as net_err:
                        last_error = net_err
                        last_status = None
                        can_failover = True
                        logger.warning(
                            f"Groq network/timeout error on '{model_id}' (attempt {attempt + 1}): {net_err}"
                        )

                    except (ValidationError, json.JSONDecodeError, ValueError) as val_err:
                        last_error = val_err
                        # Validation drift on a best-effort model can be retried once in json_object or next model
                        can_failover = True
                        logger.warning(
                            f"Local Pydantic validation failed on Groq '{model_id}' output "
                            f"(attempt {attempt + 1}): {val_err}"
                        )

                    if attempt < max_tries:
                        backoff = min(6.0, 1.0 * (2 ** attempt)) + random.uniform(0.1, 0.4)
                        await asyncio.sleep(backoff)

                if not can_failover:
                    break

        raise GroqExecutionError(
            message=f"Groq model '{last_model_attempted}' failed after {total_attempts} attempts: {last_error}",
            model_name=last_model_attempted,
            status_code=last_status,
            attempts=total_attempts,
            transient=isinstance(
                last_error,
                (
                    GroqExecutionError,
                    httpx.TimeoutException,
                    httpx.TransportError,
                    TimeoutError,
                    ConnectionError,
                    ValidationError,
                    json.JSONDecodeError,
                    ValueError,
                ),
            ),
        )
