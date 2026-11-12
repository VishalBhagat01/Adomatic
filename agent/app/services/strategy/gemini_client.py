"""
AdPilot AI - Official Google Gen AI SDK Client
Manages structured Gemini generation with configurable model names, strict local
Pydantic validation, timeouts, bounded retries, telemetry recording, and NO silent
model fallback.
"""

import asyncio
import json
import random
import time
from typing import Any, List, Optional, Tuple, Type, TypeVar
from pydantic import BaseModel, ValidationError
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.strategy import GenerationMetadata, MarketingStrategy
from agent.app.services.strategy.groq_client import (
    GROQ_MODEL_PARAMS,
    GroqConfigurationError,
    GroqExecutionError,
    GroqStructuredClient,
)
from agent.app.services.strategy.prompt_builder import SYSTEM_INSTRUCTION

TModel = TypeVar("TModel", bound=BaseModel)


class GeminiConfigurationError(Exception):
    """Raised when GEMINI_API_KEY or GEMINI_MODEL is missing or invalid."""
    pass


class GeminiExecutionError(Exception):
    """Raised when Gemini generation or structured parsing fails after bounded retries."""
    def __init__(self, message: str, model_name: str, status_code: Optional[int] = None, attempts: int = 1):
        super().__init__(message)
        self.model_name = model_name
        self.status_code = status_code
        self.attempts = attempts


TRANSIENT_STATUS_CODES = {408, 429, 500, 502, 503, 504}


class GeminiStrategyClient:
    """
    Wrapper around google.genai.Client enforcing structured MarketingStrategy output
    and strict error handling without silent model switching.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
        genai_client: Optional[Any] = None,
        fallback_models: Optional[List[str]] = None,
        groq_api_key: Optional[str] = None,
        llm_provider: Optional[str] = None,
        groq_client: Optional[GroqStructuredClient] = None,
    ):
        self.api_key = api_key if api_key is not None else settings.GEMINI_API_KEY
        self.model_name = model_name or settings.GEMINI_MODEL
        self.timeout_seconds = timeout_seconds or settings.GEMINI_TIMEOUT_SECONDS
        self.max_retries = max_retries if max_retries is not None else settings.GEMINI_MAX_RETRIES
        self._injected_client = genai_client
        self._explicit_groq_key = groq_api_key
        self._explicit_llm_provider = llm_provider
        self._injected_groq_client = groq_client
        self._force_gemini_only = (genai_client is not None) or (
            llm_provider is None
            and groq_api_key is None
            and groq_client is None
            and (api_key is not None or (model_name is not None and model_name.lower().startswith("gemini")))
        )
        if fallback_models is not None:
            raw_fallbacks = fallback_models
        elif model_name is None:
            raw_fallbacks = list(getattr(settings, "GEMINI_FALLBACK_MODELS", []) or [])
        else:
            raw_fallbacks = []
        self.fallback_models = [
            m.strip() for m in raw_fallbacks if isinstance(m, str) and m.strip() and m.strip() != self.model_name
        ]

    def _get_client(self) -> Any:
        if self._injected_client is not None:
            return self._injected_client

        if not self.api_key or not self.api_key.strip() or self.api_key.strip() == "your_gemini_api_key_here":
            raise GeminiConfigurationError(
                "GEMINI_API_KEY environment variable is not configured. "
                "Cannot execute Gemini inference without a valid API key."
            )

        if not self.model_name or not self.model_name.strip():
            raise GeminiConfigurationError("GEMINI_MODEL must be configured.")

        return genai.Client(
            api_key=self.api_key.strip(),
            http_options=types.HttpOptions(timeout=int(self.timeout_seconds * 1000)),
        )

    @staticmethod
    def _validate_response_locally(response: Any, schema_cls: Type[TModel] = MarketingStrategy) -> TModel:
        """
        Validate Gemini JSON / parsed payload locally against a Pydantic schema.
        Raises ValidationError or ValueError if invalid.
        """
        # Prefer raw text JSON validation to enforce full Pydantic checks locally
        raw_text = getattr(response, "text", None)
        if raw_text and isinstance(raw_text, str) and raw_text.strip():
            cleaned = raw_text.strip()
            # Strip accidental markdown JSON fences if returned by a model variant
            if cleaned.startswith("```"):
                lines = cleaned.splitlines()
                if lines and lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                cleaned = "\n".join(lines).strip()
            return schema_cls.model_validate_json(cleaned)

        parsed = getattr(response, "parsed", None)
        if parsed is not None:
            if isinstance(parsed, schema_cls):
                # Re-validate via model_dump to guarantee constraints run
                return schema_cls.model_validate(parsed.model_dump())
            if isinstance(parsed, dict):
                return schema_cls.model_validate(parsed)

        raise ValueError("Gemini returned empty text and empty parsed payload.")

    def _has_gemini_key(self) -> bool:
        return bool(
            self.api_key
            and self.api_key.strip()
            and self.api_key.strip() != "your_gemini_api_key_here"
        )

    def _should_use_groq(self) -> bool:
        provider = (self._explicit_llm_provider or getattr(settings, "LLM_PROVIDER", "auto")).strip().lower()
        groq_key = (
            self._explicit_groq_key
            if self._explicit_groq_key is not None
            else getattr(settings, "GROQ_API_KEY", None)
        )
        has_groq_key = bool(groq_key and groq_key.strip() and groq_key.strip() != "your_groq_api_key_here")
        return bool(
            not self._force_gemini_only
            and (
                provider == "groq"
                or (provider == "auto" and (has_groq_key or self._injected_groq_client is not None))
            )
        )

    def prefers_text_only_strategy(self) -> bool:
        """
        Return True when Groq handles structured calls and configured Groq vision models
        have a completion-token budget too small (< 1500 tokens) for full MarketingStrategy output.
        """
        if not self._should_use_groq():
            return False
        vision_models = [
            m.strip()
            for m in [
                getattr(settings, "GROQ_VISION_MODEL", ""),
                *(getattr(settings, "GROQ_VISION_FALLBACK_MODELS", []) or []),
            ]
            if m and m.strip()
        ]
        if not vision_models:
            return True
        return all(
            GROQ_MODEL_PARAMS.get(model, {}).get("max_completion_tokens", 2048) < 1500
            for model in vision_models
        )

    async def generate_structured(
        self,
        prompt_text: str,
        response_schema: Type[TModel],
        system_instruction: str = SYSTEM_INSTRUCTION,
        image_parts: Optional[List[types.Part]] = None,
        temperature: float = 0.25,
    ) -> Tuple[TModel, GenerationMetadata]:
        """
        Invoke configured LLM provider(s) with structured JSON enforcement against response_schema,
        bounded transient retries, telemetry recording, and explicit multi-model failover.
        """
        provider = (self._explicit_llm_provider or getattr(settings, "LLM_PROVIDER", "auto")).strip().lower()
        groq_key = (
            self._explicit_groq_key
            if self._explicit_groq_key is not None
            else getattr(settings, "GROQ_API_KEY", None)
        )
        use_groq = self._should_use_groq()

        if use_groq:
            groq_client = self._injected_groq_client or GroqStructuredClient(api_key=groq_key)
            if image_parts:
                groq_models = [
                    getattr(settings, "GROQ_VISION_MODEL", "qwen/qwen3.8-27b"),
                    *(getattr(settings, "GROQ_VISION_FALLBACK_MODELS", []) or []),
                ]
            else:
                groq_models = [
                    getattr(settings, "GROQ_MODEL", "openai/gpt-oss-120b"),
                    *(getattr(settings, "GROQ_FALLBACK_MODELS", []) or []),
                ]

            try:
                return await groq_client.generate_structured_with_models(
                    candidate_models=groq_models,
                    prompt_text=prompt_text,
                    response_schema=response_schema,
                    system_instruction=system_instruction,
                    image_parts=image_parts,
                    temperature=temperature,
                )
            except GroqConfigurationError as cfg_err:
                if provider == "auto" and self._has_gemini_key():
                    logger.warning(f"Groq not configured ({cfg_err}); falling back to Gemini.")
                else:
                    raise GeminiConfigurationError(str(cfg_err)) from cfg_err
            except GroqExecutionError as groq_err:
                if provider == "auto" and groq_err.transient and self._has_gemini_key():
                    logger.warning(
                        f"All configured Groq models hit transient capacity/network failures ({groq_err}); "
                        f"failing over to configured Gemini models."
                    )
                else:
                    raise GeminiExecutionError(
                        message=str(groq_err),
                        model_name=groq_err.model_name,
                        status_code=groq_err.status_code,
                        attempts=groq_err.attempts,
                    ) from groq_err

        return await self._generate_with_gemini(
            prompt_text=prompt_text,
            response_schema=response_schema,
            system_instruction=system_instruction,
            image_parts=image_parts,
            temperature=temperature,
        )

    async def _generate_with_gemini(
        self,
        prompt_text: str,
        response_schema: Type[TModel],
        system_instruction: str = SYSTEM_INSTRUCTION,
        image_parts: Optional[List[types.Part]] = None,
        temperature: float = 0.25,
    ) -> Tuple[TModel, GenerationMetadata]:
        """Invoke configured Gemini models with bounded transient retries and telemetry."""
        client = self._get_client()
        contents: List[Any] = [prompt_text]
        img_count = 0
        if image_parts:
            contents.extend(image_parts)
            img_count = len(image_parts)

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=response_schema,
            http_options=types.HttpOptions(timeout=int(self.timeout_seconds * 1000)),
        )

        candidate_models = [self.model_name, *self.fallback_models]
        start_time = time.time()
        total_attempts = 0
        last_error: Optional[Exception] = None
        last_status: Optional[int] = None
        last_model_attempted = self.model_name

        for idx, candidate_model in enumerate(candidate_models):
            is_fallback = idx > 0
            if is_fallback:
                logger.warning(
                    f"Primary Gemini model '{self.model_name}' hit transient capacity error "
                    f"({last_error}); retrying with configured fallback model '{candidate_model}'."
                )

            last_model_attempted = candidate_model
            can_failover = False
            max_tries_for_model = self.max_retries if not is_fallback else min(1, self.max_retries)

            for attempt in range(max_tries_for_model + 1):
                total_attempts += 1
                try:
                    logger.info(
                        f"Calling Gemini model '{candidate_model}' for {response_schema.__name__} "
                        f"(attempt {attempt + 1}/{max_tries_for_model + 1})",
                        extra={"extra": {"model": candidate_model, "images": img_count, "attempt": total_attempts}},
                    )

                    response = await asyncio.wait_for(
                        client.aio.models.generate_content(
                            model=candidate_model,
                            contents=contents,
                            config=config,
                        ),
                        timeout=self.timeout_seconds + 2.0,
                    )

                    result_obj = self._validate_response_locally(response, response_schema)
                    latency_ms = round((time.time() - start_time) * 1000, 2)

                    usage = getattr(response, "usage_metadata", None)
                    metadata = GenerationMetadata(
                        model_name=candidate_model,
                        model_version=getattr(response, "model_version", None),
                        response_id=getattr(response, "response_id", None),
                        prompt_tokens=getattr(usage, "prompt_token_count", None) if usage else None,
                        candidates_tokens=getattr(usage, "candidates_token_count", None) if usage else None,
                        total_tokens=getattr(usage, "total_token_count", None) if usage else None,
                        latency_ms=latency_ms,
                        attempts=total_attempts,
                        regenerations=0,
                        multimodal_images_used=img_count,
                    )
                    return result_obj, metadata

                except genai_errors.APIError as api_err:
                    status_code = getattr(api_err, "code", None)
                    last_status = status_code
                    last_error = api_err

                    # NEVER silently fall back on non-transient 4xx (e.g., 400, 403, 404)
                    if status_code is not None and status_code not in TRANSIENT_STATUS_CODES:
                        logger.error(
                            f"Non-retryable Gemini APIError (HTTP {status_code}) on model '{candidate_model}': {api_err}"
                        )
                        raise GeminiExecutionError(
                            message=f"Gemini model '{candidate_model}' failed with HTTP {status_code}: {str(api_err)}",
                            model_name=candidate_model,
                            status_code=status_code,
                            attempts=total_attempts,
                        ) from api_err

                    can_failover = True
                    logger.warning(
                        f"Transient Gemini APIError (HTTP {status_code}) on '{candidate_model}' "
                        f"(attempt {attempt + 1}): {api_err}"
                    )

                except (asyncio.TimeoutError, TimeoutError, ConnectionError) as net_err:
                    last_error = net_err
                    can_failover = True
                    logger.warning(
                        f"Gemini request timeout/network error on '{candidate_model}' "
                        f"(attempt {attempt + 1}): {net_err}"
                    )

                except (ValidationError, json.JSONDecodeError, ValueError) as val_err:
                    last_error = val_err
                    can_failover = False
                    logger.warning(
                        f"Local Pydantic validation failed on Gemini output (attempt {attempt + 1}): {val_err}"
                    )

                except Exception as exc:
                    last_error = exc
                    logger.error(f"Unexpected error calling Gemini model '{candidate_model}': {exc}")
                    raise GeminiExecutionError(
                        message=f"Unexpected error from Gemini model '{candidate_model}': {str(exc)}",
                        model_name=candidate_model,
                        attempts=total_attempts,
                    ) from exc

                if attempt < max_tries_for_model:
                    backoff = min(8.0, 1.25 * (2 ** attempt)) + random.uniform(0.1, 0.5)
                    await asyncio.sleep(backoff)

            if not can_failover:
                break

        raise GeminiExecutionError(
            message=f"Gemini model '{last_model_attempted}' failed after {total_attempts} attempts: {str(last_error)}",
            model_name=last_model_attempted,
            status_code=last_status,
            attempts=total_attempts,
        )

    async def generate_strategy(
        self,
        prompt_text: str,
        image_parts: Optional[List[types.Part]] = None,
    ) -> Tuple[MarketingStrategy, GenerationMetadata]:
        """Invoke configured Gemini model using MarketingStrategy structured JSON schema."""
        return await self.generate_structured(
            prompt_text=prompt_text,
            response_schema=MarketingStrategy,
            system_instruction=SYSTEM_INSTRUCTION,
            image_parts=image_parts,
            temperature=0.25,
        )

