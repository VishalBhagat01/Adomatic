"""
AdPilot AI - 10-Stage Gemini Image Generation Pipeline Service (Step 07)
Orchestrates blueprint validation, product reference retrieval/selection,
variation prompt compilation, Gemini image synthesis, objective visual validation,
MinIO/S3 persistence (both approved & rejected assets), optional Pillow text overlays,
and generation cost/metadata telemetry.
"""

from datetime import datetime, timezone
import time
from typing import List, Optional
import uuid

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.creative import ImageCreativeBlueprint
from agent.app.schemas.image_gen import (
    GeneratedImageAsset,
    ImageGenerationRequest,
    ImageGenerationResponse,
    StoredGenerationMetadata,
)
from agent.app.services.image_gen.free_image_providers import FreeImageGenerationClient
from agent.app.services.image_gen.gemini_image_client import (
    GeminiImageClient,
    GeneratedImageRawResult,
)
from agent.app.services.image_gen.overlay_renderer import DeterministicOverlayRenderer
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)
from agent.app.services.image_gen.prompt_compiler import (
    PROMPT_VERSION,
    ImagePromptCompiler,
)
from agent.app.services.image_gen.quality_checker import (
    SUPPORTED_OUTPUT_FORMATS,
    TARGET_ASPECT_RATIOS,
    ImageQualityChecker,
)
from agent.app.services.image_gen.reference_selector import (
    ReferenceImageSelector,
    ReferenceSelectionError,
)
from agent.app.services.storage import (
    AgentStorage,
    agent_storage,
    build_creative_object_key,
)


class BlueprintValidationError(ValueError):
    """Raised when an ImageCreativeBlueprint fails structural or ratio pre-checks."""


def _mime_to_extension(mime_type: str, detected_format: Optional[str]) -> str:
    if detected_format and detected_format.upper() in SUPPORTED_OUTPUT_FORMATS:
        fmt = detected_format.lower()
        return "jpg" if fmt == "jpeg" else fmt
    mime_map = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
    }
    return mime_map.get((mime_type or "").lower(), "png")


class ImageGenerationService:
    """Production-oriented Gemini image generation & storage pipeline."""

    def __init__(
        self,
        gemini_client: Optional[GeminiImageClient] = None,
        free_image_client: Optional[FreeImageGenerationClient] = None,
        reference_selector: Optional[ReferenceImageSelector] = None,
        prompt_compiler: Optional[ImagePromptCompiler] = None,
        quality_checker: Optional[ImageQualityChecker] = None,
        overlay_renderer: Optional[DeterministicOverlayRenderer] = None,
        storage: Optional[AgentStorage] = None,
        allow_free_fallback: Optional[bool] = None,
    ):
        self.gemini_client = gemini_client or GeminiImageClient()
        self.free_image_client = free_image_client or FreeImageGenerationClient()
        self.reference_selector = reference_selector or ReferenceImageSelector()
        self.prompt_compiler = prompt_compiler or ImagePromptCompiler()
        self.quality_checker = quality_checker or ImageQualityChecker()
        self.overlay_renderer = overlay_renderer or DeterministicOverlayRenderer()
        self.storage = storage or agent_storage
        self._allow_free_fallback = (
            allow_free_fallback
            if allow_free_fallback is not None
            else not (gemini_client is not None and free_image_client is None)
        )

    def _validate_blueprint(
        self,
        blueprint: ImageCreativeBlueprint,
        requested_aspect_ratio: Optional[str],
    ) -> str:
        target_ratio = requested_aspect_ratio or blueprint.aspect_ratio
        if target_ratio not in TARGET_ASPECT_RATIOS:
            raise BlueprintValidationError(
                f"Unsupported aspect ratio '{target_ratio}'. Supported image generation ratios: {sorted(TARGET_ASPECT_RATIOS)}."
            )
        if not blueprint.concept_id.strip():
            raise BlueprintValidationError("ImageCreativeBlueprint.concept_id cannot be empty.")
        if not blueprint.image_generation_prompt.positive_prompt.strip():
            raise BlueprintValidationError("ImageCreativeBlueprint positive_prompt cannot be empty.")
        if blueprint.placement_spec.format != "image":
            raise BlueprintValidationError(
                f"Blueprint placement_spec.format must be 'image', got '{blueprint.placement_spec.format}'."
            )
        return target_ratio

    async def generate_creatives(
        self,
        request: ImageGenerationRequest,
    ) -> ImageGenerationResponse:
        pipeline_start = time.perf_counter()
        warnings: List[str] = []
        errors: List[str] = []

        # Step 1: Validate blueprint & resolve aspect ratio
        target_ratio = self._validate_blueprint(request.blueprint, request.aspect_ratio)

        # Steps 2, 3 & 4: Retrieve, score, deduplicate, and prepare reference images
        selected_refs, ref_warnings = await self.reference_selector.select_references(
            request.product_data,
            override_urls=request.reference_image_urls,
        )
        warnings.extend(ref_warnings)
        reference_parts = [ref.part for ref in selected_refs]

        seen_sha256: set[str] = set()
        seen_dhashes: List[int] = []
        assets: List[GeneratedImageAsset] = []
        total_cost = 0.0

        overlay_spec = None
        if request.apply_deterministic_overlay:
            overlay_spec = self.overlay_renderer.build_overlay_spec(
                blueprint=request.blueprint,
                strategy=request.marketing_strategy,
                product_data=request.product_data,
                headline_override=request.overlay_headline,
                cta_override=request.overlay_cta,
            )

        provider = (settings.IMAGE_PROVIDER or "auto").strip().lower()
        primary_ref_pil = selected_refs[0].pil_image if selected_refs else None
        banner_headline = (
            request.overlay_headline
            or request.blueprint.hook
            or request.blueprint.main_message
            or request.blueprint.creative_title
        )
        banner_cta = (
            request.overlay_cta
            or request.marketing_strategy.recommendations.primary_cta
            or "Shop Now"
        )
        raw_t2i_prompt = (
            f"{request.product_data.brand or ''} {request.product_data.product_name}. "
            f"{request.blueprint.image_generation_prompt.positive_prompt}"
        ).strip()

        for variation_idx in range(1, request.num_variations + 1):
            creative_id = f"{request.blueprint.concept_id}_v{variation_idx}_{uuid.uuid4().hex[:8]}"

            # Step 5: Construct product-specific multimodal generation prompt
            positive_prompt, negative_prompt, gen_params = self.prompt_compiler.compile(
                blueprint=request.blueprint,
                strategy=request.marketing_strategy,
                product_data=request.product_data,
                target_aspect_ratio=target_ratio,
                variation_index=variation_idx,
                total_variations=request.num_variations,
                selected_refs=selected_refs,
            )
            if request.image_size or settings.GEMINI_IMAGE_SIZE:
                gen_params["image_size"] = str(request.image_size or settings.GEMINI_IMAGE_SIZE)

            # Steps 6 & 7: Route image generation per IMAGE_PROVIDER with free fallback chain
            raw_result: GeneratedImageRawResult
            if provider == "pollinations":
                raw_result, fb_warns = await self.free_image_client.generate_with_fallback(
                    providers=["pollinations"],
                    prompt=raw_t2i_prompt,
                    aspect_ratio=target_ratio,
                    headline=banner_headline,
                    product_name=request.product_data.product_name,
                    brand=request.product_data.brand,
                    cta_text=banner_cta,
                    product_data=request.product_data,
                    reference_pil_image=primary_ref_pil,
                    variation_index=variation_idx,
                )
                warnings.extend(fb_warns)
            elif provider == "huggingface":
                if not self.free_image_client.has_hf_api_key():
                    warnings.append("HF_API_KEY not configured for IMAGE_PROVIDER=huggingface; using Pollinations/Pillow fallback.")
                raw_result, fb_warns = await self.free_image_client.generate_with_fallback(
                    providers=["huggingface", "pollinations"],
                    prompt=raw_t2i_prompt,
                    aspect_ratio=target_ratio,
                    headline=banner_headline,
                    product_name=request.product_data.product_name,
                    brand=request.product_data.brand,
                    cta_text=banner_cta,
                    product_data=request.product_data,
                    reference_pil_image=primary_ref_pil,
                    variation_index=variation_idx,
                )
                warnings.extend(fb_warns)
            elif provider == "gemini" or not self._allow_free_fallback:
                raw_result = await self.gemini_client.generate_image(
                    positive_prompt=positive_prompt,
                    negative_prompt=negative_prompt,
                    aspect_ratio=target_ratio,
                    reference_parts=reference_parts,
                    image_size=request.image_size,
                )
            else:
                try:
                    raw_result = await self.gemini_client.generate_image(
                        positive_prompt=positive_prompt,
                        negative_prompt=negative_prompt,
                        aspect_ratio=target_ratio,
                        reference_parts=reference_parts,
                        image_size=request.image_size,
                    )
                except (GeminiConfigurationError, GeminiExecutionError) as gem_err:
                    warn_msg = f"Gemini image generation unavailable ({gem_err}); falling back to free image provider."
                    logger.warning(warn_msg)
                    warnings.append(warn_msg)
                    raw_result, fb_warns = await self.free_image_client.generate_with_fallback(
                        providers=["huggingface", "pollinations"],
                        prompt=raw_t2i_prompt,
                        aspect_ratio=target_ratio,
                        headline=banner_headline,
                        product_name=request.product_data.product_name,
                        brand=request.product_data.brand,
                        cta_text=banner_cta,
                        product_data=request.product_data,
                        reference_pil_image=primary_ref_pil,
                        variation_index=variation_idx,
                    )
                    warnings.extend(fb_warns)

            total_cost += raw_result.cost.estimated_cost_usd
            gen_params["image_provider_model"] = raw_result.model_identifier

            is_pillow_fallback = raw_result.model_identifier == "local:pillow-banner-fallback"
            is_free_external = raw_result.model_identifier.startswith(("pollinations:", "huggingface:"))
            effective_ratio = "1:1" if is_pillow_fallback else target_ratio

            # Step 8: Deterministic format, dimension, duplicate, quality, and ref similarity check
            validation_result, dhash_val, _ = self.quality_checker.validate(
                image_bytes=raw_result.image_bytes,
                expected_aspect_ratio=effective_ratio,
                reference_images=[] if (is_pillow_fallback or is_free_external) else selected_refs,
                seen_sha256=seen_sha256,
                seen_dhashes=seen_dhashes,
            )
            if validation_result.sha256_hash:
                seen_sha256.add(validation_result.sha256_hash)
            if dhash_val is not None:
                seen_dhashes.append(dhash_val)

            # Steps 9 & 10: Store BOTH approved and rejected raw generations + full metadata JSON
            ext = _mime_to_extension(raw_result.mime_type, validation_result.detected_format)
            image_object_key = build_creative_object_key(
                campaign_id=request.campaign_id,
                concept_id=request.blueprint.concept_id,
                creative_id=creative_id,
                approved=validation_result.approved,
                ext=ext,
            )
            metadata_object_key = build_creative_object_key(
                campaign_id=request.campaign_id,
                concept_id=request.blueprint.concept_id,
                creative_id=creative_id,
                approved=validation_result.approved,
                ext="metadata.json",
            )

            storage_resp = self.storage.upload_bytes(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=image_object_key,
                data=raw_result.image_bytes,
                content_type=raw_result.mime_type,
                metadata={
                    "campaign_id": request.campaign_id,
                    "concept_id": request.blueprint.concept_id,
                    "creative_id": creative_id,
                    "approved": str(validation_result.approved).lower(),
                    "model_identifier": raw_result.model_identifier,
                },
            )
            if storage_resp.get("error"):
                warnings.append(f"{creative_id} upload notice: {storage_resp['error']}")

            overlay_object_key: Optional[str] = None
            overlay_presigned_url: Optional[str] = None
            overlay_applied = False
            if request.apply_deterministic_overlay and validation_result.approved and overlay_spec and not is_pillow_fallback:
                overlay_bytes, overlay_mime = self.overlay_renderer.render(
                    base_image_bytes=raw_result.image_bytes,
                    aspect_ratio=effective_ratio,
                    overlay_spec=overlay_spec,
                )
                overlay_object_key = build_creative_object_key(
                    campaign_id=request.campaign_id,
                    concept_id=request.blueprint.concept_id,
                    creative_id=creative_id,
                    approved=True,
                    ext="png",
                    suffix="_overlay",
                )
                ov_resp = self.storage.upload_bytes(
                    bucket=settings.STORAGE_BUCKET_CREATIVES,
                    object_key=overlay_object_key,
                    data=overlay_bytes,
                    content_type=overlay_mime,
                    metadata={
                        "campaign_id": request.campaign_id,
                        "creative_id": creative_id,
                        "overlay": "deterministic_pillow",
                    },
                )
                overlay_presigned_url = ov_resp.get("presigned_url")
                overlay_applied = True

            stored_metadata = StoredGenerationMetadata(
                creative_id=creative_id,
                campaign_id=request.campaign_id,
                concept_id=request.blueprint.concept_id,
                variation_index=variation_idx,
                image_object_key=image_object_key,
                metadata_object_key=metadata_object_key,
                overlay_object_key=overlay_object_key,
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                stored=bool(storage_resp.get("stored")),
                presigned_url=storage_resp.get("presigned_url"),
                overlay_presigned_url=overlay_presigned_url,
                storage_error=storage_resp.get("error"),
                model_identifier=raw_result.model_identifier,
                prompt_version=PROMPT_VERSION,
                generation_parameters=gen_params,
                generation_cost=raw_result.cost,
                generation_timestamp=datetime.now(timezone.utc),
                validation_results=validation_result,
            )

            meta_upload = self.storage.upload_json(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=metadata_object_key,
                payload=stored_metadata.model_dump(mode="json"),
            )
            if not meta_upload.get("stored") and meta_upload.get("error"):
                warnings.append(f"{creative_id} metadata notice: {meta_upload['error']}")

            if not validation_result.approved:
                errors.extend(
                    f"{creative_id}: {reason}" for reason in validation_result.rejection_reasons
                )

            assets.append(
                GeneratedImageAsset(
                    creative_id=creative_id,
                    variation_index=variation_idx,
                    approved=validation_result.approved,
                    mime_type=raw_result.mime_type,
                    width=validation_result.width,
                    height=validation_result.height,
                    aspect_ratio=effective_ratio,
                    object_key=image_object_key,
                    metadata_object_key=metadata_object_key,
                    overlay_object_key=overlay_object_key,
                    presigned_url=storage_resp.get("presigned_url"),
                    overlay_presigned_url=overlay_presigned_url,
                    overlay_applied=overlay_applied,
                    text_overlay_spec=overlay_spec if overlay_applied else None,
                    prompt_used=positive_prompt,
                    negative_prompt_used=negative_prompt,
                    attempts=raw_result.attempts,
                    latency_ms=raw_result.latency_ms,
                    cost=raw_result.cost,
                    validation=validation_result,
                    metadata=stored_metadata,
                )
            )

        approved_count = sum(1 for a in assets if a.approved)
        rejected_count = len(assets) - approved_count
        total_latency_ms = round((time.perf_counter() - pipeline_start) * 1000, 2)

        resolved_model_id = assets[0].cost.model_identifier if assets else self.gemini_client.model_name
        logger.info(
            f"Completed image generation for concept '{request.blueprint.concept_id}': "
            f"approved={approved_count}, rejected={rejected_count}",
            extra={
                "extra": {
                    "campaign_id": request.campaign_id,
                    "model_identifier": resolved_model_id,
                    "approved_count": approved_count,
                    "rejected_count": rejected_count,
                    "total_cost_usd": round(total_cost, 6),
                }
            },
        )

        return ImageGenerationResponse(
            success=approved_count > 0,
            campaign_id=request.campaign_id,
            concept_id=request.blueprint.concept_id,
            aspect_ratio=target_ratio,
            model_identifier=resolved_model_id,
            prompt_version=PROMPT_VERSION,
            requested_variations=request.num_variations,
            approved_count=approved_count,
            rejected_count=rejected_count,
            selected_reference_images=[ref.selection for ref in selected_refs],
            assets=assets,
            total_estimated_cost_usd=round(total_cost, 6),
            total_latency_ms=total_latency_ms,
            warnings=warnings,
            errors=errors,
        )


image_generation_service = ImageGenerationService()

