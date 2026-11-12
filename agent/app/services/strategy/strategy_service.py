"""
AdPilot AI - Marketing Strategy Orchestration Service
Combines multimodal reference image loading, Gemini structured generation,
deterministic quality validation, and controlled regeneration.
"""

import time
from typing import List, Optional

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.strategy import (
    GenerationMetadata,
    MarketingStrategy,
    QualityValidationResult,
    StrategyGenerateRequest,
    StrategyGenerateResponse,
)
from agent.app.services.strategy.gemini_client import (
    TRANSIENT_STATUS_CODES,
    GeminiConfigurationError,
    GeminiExecutionError,
    GeminiStrategyClient,
)
from agent.app.services.strategy.image_loader import load_reference_images_for_gemini
from agent.app.services.strategy.prompt_builder import (
    build_regeneration_prompt,
    build_strategy_prompt,
)
from agent.app.services.strategy.quality_validator import StrategyQualityValidator


class MarketingStrategyService:
    """Orchestrates product understanding and marketing strategy generation with quality enforcement."""

    def __init__(
        self,
        gemini_client: Optional[GeminiStrategyClient] = None,
        max_regenerations: Optional[int] = None,
    ):
        self.gemini_client = gemini_client or GeminiStrategyClient()
        self.max_regenerations = (
            max_regenerations if max_regenerations is not None else settings.GEMINI_MAX_REGENERATIONS
        )

    async def generate_marketing_strategy(
        self,
        request: StrategyGenerateRequest,
    ) -> StrategyGenerateResponse:
        """
        Execute product understanding, claim auditing, strategy generation,
        and quality validation with bounded controlled regeneration.
        """
        overall_start = time.time()
        warnings: List[str] = []

        # 1. Load reference images safely (SSRF-guarded) unless Groq low-OTPM vision routing
        # prefers high-output text models for MarketingStrategy
        image_parts = []
        if request.fetch_images:
            if getattr(self.gemini_client, "prefers_text_only_strategy", lambda: False)():
                msg = (
                    "Skipped multimodal product images during strategy generation so Groq routes "
                    "MarketingStrategy to high-output text models and preserves vision budget for evaluation/ad-copy."
                )
                logger.info(msg)
                warnings.append(msg)
            else:
                image_parts, img_warnings = await load_reference_images_for_gemini(
                    product_data=request.product_data,
                    override_urls=request.reference_image_urls,
                )
                warnings.extend(img_warnings)

        # 2. Build primary prompt
        base_prompt = build_strategy_prompt(
            product_data=request.product_data,
            user_prompt=request.user_prompt,
            formats=request.formats,
            placements=request.placements,
            learning_hints=request.learning_hints,
        )

        current_prompt = base_prompt
        last_strategy: Optional[MarketingStrategy] = None
        last_validation: Optional[QualityValidationResult] = None

        total_prompt_tokens = 0
        total_candidates_tokens = 0
        total_tokens = 0
        total_api_attempts = 0
        regenerations_performed = 0
        last_meta: Optional[GenerationMetadata] = None

        for regen_idx in range(self.max_regenerations + 1):
            if regen_idx > 0:
                regenerations_performed = regen_idx

            try:
                strategy, meta = await self.gemini_client.generate_strategy(
                    prompt_text=current_prompt,
                    image_parts=image_parts if image_parts else None,
                )
            except GeminiExecutionError as exec_err:
                if image_parts and (exec_err.status_code in TRANSIENT_STATUS_CODES or exec_err.status_code == 413):
                    fallback_warn = (
                        f"Multimodal strategy call hit transient provider error ({exec_err.status_code}); "
                        f"retrying strategy generation in text-only mode from verified product specs."
                    )
                    logger.warning(fallback_warn)
                    warnings.append(fallback_warn)
                    image_parts = []
                    strategy, meta = await self.gemini_client.generate_strategy(
                        prompt_text=current_prompt,
                        image_parts=None,
                    )
                else:
                    raise

            total_api_attempts += meta.attempts
            if meta.prompt_tokens:
                total_prompt_tokens += meta.prompt_tokens
            if meta.candidates_tokens:
                total_candidates_tokens += meta.candidates_tokens
            if meta.total_tokens:
                total_tokens += meta.total_tokens
            last_meta = meta
            last_strategy = strategy

            # 3. Run local quality gate
            validation = StrategyQualityValidator.validate(
                strategy=strategy,
                product=request.product_data,
                user_prompt=request.user_prompt,
                requested_placements=request.placements,
            )
            last_validation = validation

            if validation.passed:
                # Aggregate full telemetry
                overall_latency_ms = round((time.time() - overall_start) * 1000, 2)
                final_meta = GenerationMetadata(
                    model_name=last_meta.model_name,
                    model_version=last_meta.model_version,
                    response_id=last_meta.response_id,
                    prompt_tokens=total_prompt_tokens or None,
                    candidates_tokens=total_candidates_tokens or None,
                    total_tokens=total_tokens or None,
                    latency_ms=overall_latency_ms,
                    attempts=total_api_attempts,
                    regenerations=regenerations_performed,
                    multimodal_images_used=len(image_parts),
                )
                return StrategyGenerateResponse(
                    success=True,
                    strategy=strategy,
                    generation_metadata=final_meta,
                    quality_validation=validation,
                    warnings=warnings,
                    error=None,
                )

            # Quality validation failed
            error_issues = [i for i in validation.issues if i.severity == "error"]
            logger.warning(
                f"MarketingStrategy failed local quality validation on round {regen_idx + 1}: "
                f"{[i.code for i in error_issues]}"
            )

            if regen_idx < self.max_regenerations:
                current_prompt = build_regeneration_prompt(base_prompt, error_issues)

        # Max regenerations exhausted and quality gate still failed
        overall_latency_ms = round((time.time() - overall_start) * 1000, 2)
        final_meta = GenerationMetadata(
            model_name=last_meta.model_name if last_meta else self.gemini_client.model_name,
            model_version=last_meta.model_version if last_meta else None,
            response_id=last_meta.response_id if last_meta else None,
            prompt_tokens=total_prompt_tokens or None,
            candidates_tokens=total_candidates_tokens or None,
            total_tokens=total_tokens or None,
            latency_ms=overall_latency_ms,
            attempts=total_api_attempts,
            regenerations=regenerations_performed,
            multimodal_images_used=len(image_parts),
        )

        error_summary = "; ".join(i.message for i in (last_validation.issues if last_validation else []) if i.severity == "error")
        return StrategyGenerateResponse(
            success=False,
            strategy=None,
            generation_metadata=final_meta,
            quality_validation=last_validation,
            warnings=warnings,
            error=f"Marketing strategy failed quality validation after {regenerations_performed} regeneration(s): {error_summary}",
        )


strategy_service = MarketingStrategyService()

