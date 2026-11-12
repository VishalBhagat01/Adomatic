"""
Unit and pipeline tests for Step 07: Gemini Image Generation Engine.
Covers reference selection + SSRF guard, Gemini client retry & no-fallback policy,
quality/duplicate/similarity validation, deterministic Pillow text overlays, and S3 persistence.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from google.genai import errors as genai_errors

from agent.app.schemas.image_gen import ImageGenerationRequest
from agent.app.schemas.product import ProductImage
from agent.app.schemas.strategy import MarketingStrategy
from agent.app.services.image_gen.gemini_image_client import GeminiImageClient
from agent.app.services.image_gen.generation_service import ImageGenerationService
from agent.app.services.image_gen.overlay_renderer import DeterministicOverlayRenderer
from agent.app.services.image_gen.prompt_compiler import PROMPT_VERSION
from agent.app.services.image_gen.quality_checker import ImageQualityChecker
from agent.app.services.image_gen.reference_selector import (
    ReferenceImageSelector,
    ReferenceSelectionError,
)
from agent.app.services.storage import AgentStorage
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)
from agent.tests.fixtures.image_fixtures import (
    FakeS3Client,
    make_mock_image_http_factory,
    make_sample_image_blueprint,
    make_synthetic_product_image_bytes,
    make_unrelated_neon_image_bytes,
)
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_missing_price_product,
    make_valid_strategy_dict,
)


def _mock_image_response(image_bytes: bytes, mime_type: str = "image/png"):
    return SimpleNamespace(
        parts=[
            SimpleNamespace(
                inline_data=SimpleNamespace(data=image_bytes, mime_type=mime_type),
                text=None,
            )
        ],
        candidates=[],
        model_version="gemini-2.5-flash-image-001",
        response_id="img_resp_001",
        usage_metadata=SimpleNamespace(
            prompt_token_count=380,
            candidates_token_count=1290,
            total_token_count=1670,
        ),
    )


def _mock_genai_sdk(side_effects):
    mock_call = AsyncMock(side_effect=side_effects)
    sdk = SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_call))
    )
    return sdk, mock_call


def _default_ref_http_factory():
    ref1 = make_synthetic_product_image_bytes(width=900, height=900, fmt="JPEG", variant_seed=0)
    ref2 = make_synthetic_product_image_bytes(width=1200, height=1200, fmt="PNG", variant_seed=1)
    return make_mock_image_http_factory(
        {
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer1.jpg": (200, "image/jpeg", ref1),
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer2.jpg": (200, "image/png", ref2),
        }
    )


# ---------------------------------------------------------------------------
# 1. Reference Image Selection, Scoring, Deduplication & SSRF Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reference_selector_prioritizes_primary_deduplicates_and_blocks_ssrf():
    primary_bytes = make_synthetic_product_image_bytes(width=1000, height=1000, fmt="PNG", variant_seed=0)
    secondary_bytes = make_synthetic_product_image_bytes(width=800, height=800, fmt="JPEG", variant_seed=1)
    tiny_bytes = make_synthetic_product_image_bytes(width=80, height=80, fmt="PNG", variant_seed=2)

    product = make_lifelong_mixer_product()
    product.images = [
        ProductImage(url="http://127.0.0.1/internal.png", is_primary=True),
        ProductImage(url="https://cdn.shopify.com/tiny.png", is_primary=False),
        ProductImage(url="https://cdn.shopify.com/duplicate.png", is_primary=False),
        ProductImage(url="https://cdn.shopify.com/secondary.jpg", is_primary=False),
        ProductImage(url="https://cdn.shopify.com/primary.png", is_primary=True),
    ]

    factory = make_mock_image_http_factory(
        {
            "https://cdn.shopify.com/primary.png": (200, "image/png", primary_bytes),
            "https://cdn.shopify.com/duplicate.png": (200, "image/png", primary_bytes),
            "https://cdn.shopify.com/secondary.jpg": (200, "image/jpeg", secondary_bytes),
            "https://cdn.shopify.com/tiny.png": (200, "image/png", tiny_bytes),
        }
    )
    selector = ReferenceImageSelector(max_references=3, client_factory=factory, resolve_dns=False)
    selected, warnings = await selector.select_references(product)

    assert len(selected) == 2
    assert selected[0].selection.url == "https://cdn.shopify.com/primary.png"
    assert selected[0].selection.is_primary is True
    assert any("127.0.0.1" in w or "unsafe" in w.lower() for w in warnings)
    assert any("tiny" in w.lower() for w in warnings)
    assert any("deduplicated" in w.lower() for w in warnings)


@pytest.mark.asyncio
async def test_reference_selector_raises_when_no_valid_images():
    selector = ReferenceImageSelector(client_factory=_default_ref_http_factory(), resolve_dns=False)
    empty_product = make_missing_price_product()
    with pytest.raises(ReferenceSelectionError):
        await selector.select_references(empty_product)


# ---------------------------------------------------------------------------
# 2. Gemini Image Client Tests (Config, No Silent Fallback, Retries, Cost)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gemini_image_client_requires_api_key():
    client = GeminiImageClient(api_key="", model_name="gemini-2.5-flash-image")
    with pytest.raises(GeminiConfigurationError) as exc:
        await client.generate_image(
            positive_prompt="Studio photo",
            negative_prompt="",
            aspect_ratio="4:5",
            reference_parts=[],
        )
    assert "GEMINI_API_KEY" in str(exc.value)


@pytest.mark.asyncio
async def test_gemini_image_client_never_silently_falls_back_on_404():
    err = genai_errors.ClientError(404, {"error": {"message": "Model not found"}})
    sdk, mock_call = _mock_genai_sdk([err])
    client = GeminiImageClient(
        api_key="test-key",
        model_name="gemini-invalid-image-model",
        max_retries=2,
        client=sdk,
    )

    with pytest.raises(GeminiExecutionError) as exc:
        await client.generate_image(
            positive_prompt="Studio photo",
            negative_prompt="text",
            aspect_ratio="4:5",
            reference_parts=[],
        )

    assert exc.value.model_name == "gemini-invalid-image-model"
    assert exc.value.status_code == 404
    assert mock_call.await_count == 1
    assert mock_call.call_args.kwargs["model"] == "gemini-invalid-image-model"


@pytest.mark.asyncio
async def test_gemini_image_client_retries_429_rate_limit_and_tracks_cost():
    rate_err = genai_errors.ClientError(429, {"error": {"message": "Quota exceeded"}})
    img_bytes = make_synthetic_product_image_bytes(896, 1120, variant_seed=0)
    sdk, mock_call = _mock_genai_sdk([rate_err, _mock_image_response(img_bytes)])

    client = GeminiImageClient(
        api_key="test-key",
        model_name="gemini-2.5-flash-image",
        max_retries=1,
        unit_cost_usd=0.039,
        client=sdk,
    )

    result = await client.generate_image(
        positive_prompt="Studio shot",
        negative_prompt="watermark",
        aspect_ratio="4:5",
        reference_parts=[],
        image_size="1K",
    )

    assert mock_call.await_count == 2
    assert result.attempts == 2
    assert result.model_identifier == "gemini-2.5-flash-image"
    assert result.cost.estimated_cost_usd == 0.039
    assert result.cost.total_tokens == 1670
    call_cfg = mock_call.call_args.kwargs["config"]
    assert call_cfg.response_modalities == ["IMAGE"]
    assert call_cfg.image_config.aspect_ratio == "4:5"
    assert call_cfg.image_config.image_size == "1K"


# ---------------------------------------------------------------------------
# 3. Quality Validator Tests (Integrity, Aspect, Duplicates, Blank, Reference Sim)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_quality_checker_rejects_corrupt_blank_wrong_ratio_and_duplicates():
    selector = ReferenceImageSelector(client_factory=_default_ref_http_factory(), resolve_dns=False)
    refs, _ = await selector.select_references(make_lifelong_mixer_product())
    checker = ImageQualityChecker(min_similarity_score=0.25)

    seen_sha = set()
    seen_dhashes = []

    # 1. Valid 4:5 image passes
    valid_bytes = make_synthetic_product_image_bytes(896, 1120, fmt="PNG", variant_seed=0)
    res_ok, dhash1, _ = checker.validate(
        image_bytes=valid_bytes,
        expected_aspect_ratio="4:5",
        reference_images=refs,
        seen_sha256=seen_sha,
        seen_dhashes=seen_dhashes,
    )
    assert res_ok.approved is True
    assert res_ok.width == 896 and res_ok.height == 1120
    assert res_ok.reference_similarity_score is not None and res_ok.reference_similarity_score >= 0.25
    seen_sha.add(res_ok.sha256_hash)
    seen_dhashes.append(dhash1)

    # 2. Exact duplicate fails
    res_dup, _, _ = checker.validate(
        image_bytes=valid_bytes,
        expected_aspect_ratio="4:5",
        reference_images=refs,
        seen_sha256=seen_sha,
        seen_dhashes=seen_dhashes,
    )
    assert res_dup.approved is False
    assert any("duplicate" in r.lower() for r in res_dup.rejection_reasons)

    # 3. Corrupt unreadable bytes fail cleanly (never approved)
    res_corrupt, _, _ = checker.validate(
        image_bytes=b"NOT_AN_IMAGE_STREAM_AT_ALL" * 60,
        expected_aspect_ratio="4:5",
        reference_images=refs,
        seen_sha256=seen_sha,
        seen_dhashes=seen_dhashes,
    )
    assert res_corrupt.approved is False
    assert any("decoded" in r.lower() or "unreadable" in r.lower() for r in res_corrupt.rejection_reasons)

    # 4. Solid blank image fails visual quality check
    blank_bytes = make_synthetic_product_image_bytes(896, 1120, fmt="PNG", blank=True)
    res_blank, _, _ = checker.validate(
        image_bytes=blank_bytes,
        expected_aspect_ratio="4:5",
        reference_images=refs,
        seen_sha256=seen_sha,
        seen_dhashes=seen_dhashes,
    )
    assert res_blank.approved is False
    assert any("visual quality" in r.lower() for r in res_blank.rejection_reasons)

    # 5. Wrong aspect ratio (1:1 returned when 9:16 requested) fails
    square_bytes = make_synthetic_product_image_bytes(1080, 1080, fmt="PNG", variant_seed=2)
    res_ratio, _, _ = checker.validate(
        image_bytes=square_bytes,
        expected_aspect_ratio="9:16",
        reference_images=refs,
        seen_sha256=seen_sha,
        seen_dhashes=seen_dhashes,
    )
    assert res_ratio.approved is False
    assert any("aspect ratio" in r.lower() for r in res_ratio.rejection_reasons)

    # 6. Completely unrelated neon color palette fails stricter similarity threshold
    strict_checker = ImageQualityChecker(min_similarity_score=0.45)
    neon_bytes = make_unrelated_neon_image_bytes(896, 1120)
    res_sim, _, _ = strict_checker.validate(
        image_bytes=neon_bytes,
        expected_aspect_ratio="4:5",
        reference_images=refs,
        seen_sha256=seen_sha,
        seen_dhashes=seen_dhashes,
    )
    assert res_sim.approved is False
    assert any("similarity" in r.lower() for r in res_sim.rejection_reasons)


# ---------------------------------------------------------------------------
# 4. End-to-End 10-Step Pipeline + Deterministic Overlay + S3 Storage Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_image_generation_service_stores_both_approved_and_rejected_with_metadata():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint(aspect_ratio="4:5", placement="instagram_feed")

    good_v1 = make_synthetic_product_image_bytes(896, 1120, fmt="PNG", variant_seed=0)
    bad_blank_v2 = make_synthetic_product_image_bytes(896, 1120, fmt="PNG", blank=True)

    sdk, _ = _mock_genai_sdk(
        [
            _mock_image_response(good_v1, "image/png"),
            _mock_image_response(bad_blank_v2, "image/png"),
        ]
    )
    fake_s3 = FakeS3Client()
    storage = AgentStorage(s3_client=fake_s3)

    service = ImageGenerationService(
        gemini_client=GeminiImageClient(api_key="test-key", model_name="gemini-2.5-flash-image", client=sdk),
        reference_selector=ReferenceImageSelector(client_factory=_default_ref_http_factory(), resolve_dns=False),
        storage=storage,
    )

    req = ImageGenerationRequest(
        campaign_id="camp_007",
        blueprint=blueprint,
        marketing_strategy=strategy,
        product_data=product,
        aspect_ratio="4:5",
        num_variations=2,
        apply_deterministic_overlay=True,
    )
    resp = await service.generate_creatives(req)

    assert resp.success is True
    assert resp.approved_count == 1
    assert resp.rejected_count == 1
    assert resp.model_identifier == "gemini-2.5-flash-image"
    assert resp.prompt_version == PROMPT_VERSION
    assert resp.total_estimated_cost_usd > 0

    approved_asset = resp.assets[0]
    rejected_asset = resp.assets[1]

    assert approved_asset.approved is True
    assert "/approved/" in approved_asset.object_key
    assert approved_asset.overlay_applied is True
    assert approved_asset.overlay_object_key is not None
    assert approved_asset.text_overlay_spec["price_badge"] == "₹1,499  •  40% OFF"
    assert "NO BAKED-IN PROMOTIONAL TEXT" in approved_asset.prompt_used

    # Rejected blank asset is STILL persisted under /rejected/ with approved=False and full metadata
    assert rejected_asset.approved is False
    assert "/rejected/" in rejected_asset.object_key
    assert rejected_asset.overlay_applied is False
    assert rejected_asset.metadata.stored is True

    # Inspect actual S3 objects written (approved PNG + overlay PNG + metadata JSON + rejected PNG + metadata JSON = 5 objects)
    assert len(fake_s3.objects) == 5
    rej_meta_obj = fake_s3.objects[("adpilot-creatives", rejected_asset.metadata_object_key)]
    parsed_meta = json.loads(rej_meta_obj["Body"].decode("utf-8"))
    assert parsed_meta["campaign_id"] == "camp_007"
    assert parsed_meta["concept_id"] == blueprint.concept_id
    assert parsed_meta["model_identifier"] == "gemini-2.5-flash-image"
    assert parsed_meta["validation_results"]["approved"] is False


def test_deterministic_overlay_renderer_respects_missing_price():
    renderer = DeterministicOverlayRenderer()
    product_no_price = make_missing_price_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint(aspect_ratio="9:16", placement="instagram_reels")

    spec = renderer.build_overlay_spec(
        blueprint=blueprint,
        strategy=strategy,
        product_data=product_no_price,
    )
    assert spec["price_badge"] is None
    assert spec["headline"] == blueprint.hook

    base_bytes = make_synthetic_product_image_bytes(768, 1344, fmt="PNG", variant_seed=1)
    out_bytes, mime = renderer.render(
        base_image_bytes=base_bytes,
        aspect_ratio="9:16",
        overlay_spec=spec,
    )
    assert mime == "image/png"
    assert len(out_bytes) > 1000

