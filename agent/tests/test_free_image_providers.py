"""
Unit & Integration Tests for Free Multi-Provider Image Generation & Fallback Routing:
  - Gemini limit: 0 / FreeTier 429 fail-fast (no wasted retries)
  - Pollinations.ai free GET image generation + URL encoding check
  - Hugging Face Router Inference API + aspect ratio fitting
  - Local 1080x1080 Pillow Ad-Banner fallback uniqueness & readability
  - IMAGE_PROVIDER routing ('auto', 'pollinations', 'huggingface', 'gemini')
"""

import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from google.genai import errors as genai_errors
import httpx
from PIL import Image
import pytest

from agent.app.api.v1.endpoints.images import get_image_generation_service
from agent.app.core.config import settings
from agent.app.main import app
from agent.app.schemas.image_gen import ImageGenerationRequest
from agent.app.schemas.strategy import MarketingStrategy
from agent.app.services.image_gen.free_image_providers import (
    FreeImageGenerationClient,
    FreeImageProviderError,
)
from agent.app.services.image_gen.gemini_image_client import GeminiImageClient
from agent.app.services.image_gen.generation_service import ImageGenerationService
from agent.app.services.image_gen.quality_checker import compute_dhash
from agent.app.services.image_gen.reference_selector import ReferenceImageSelector
from agent.app.services.storage import AgentStorage
from agent.app.services.strategy.gemini_client import GeminiExecutionError
from agent.tests.fixtures.image_fixtures import (
    FakeS3Client,
    make_mock_image_http_factory,
    make_sample_image_blueprint,
    make_synthetic_product_image_bytes,
)
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_valid_strategy_dict,
)


class _FakeAsyncClient:
    def __init__(self, handler):
        self._handler = handler

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, **kwargs):
        return await self._handler("GET", url, kwargs)

    async def post(self, url, **kwargs):
        return await self._handler("POST", url, kwargs)


def _offline_ref_selector() -> ReferenceImageSelector:
    product = make_lifelong_mixer_product()
    url_map = {
        img.url: (200, "image/jpeg", make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=i))
        for i, img in enumerate(product.images)
    }
    return ReferenceImageSelector(client_factory=make_mock_image_http_factory(url_map), resolve_dns=False)


def _mock_gemini_sdk_error(err: Exception):
    mock_call = AsyncMock(side_effect=err)
    sdk = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_call)))
    return sdk, mock_call


def test_settings_have_free_image_defaults_and_timeout_field():
    assert hasattr(settings, "IMAGE_GEN_TIMEOUT_SECONDS")
    assert not hasattr(settings, "giIMAGE_GEN_TIMEOUT_SECONDS")
    assert settings.IMAGE_GEN_TIMEOUT_SECONDS > 0
    assert settings.IMAGE_PROVIDER in {"auto", "pollinations", "huggingface", "gemini"}
    assert settings.POLLINATIONS_MODEL == "flux"
    assert settings.HF_IMAGE_MODEL == "black-forest-labs/FLUX.1-schnell"


@pytest.mark.asyncio
async def test_gemini_image_client_fails_fast_on_free_tier_limit_zero_without_retrying():
    zero_quota_err = genai_errors.ClientError(
        429,
        {
            "error": {
                "code": 429,
                "message": "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image",
                "status": "RESOURCE_EXHAUSTED",
            }
        },
    )
    sdk, mock_call = _mock_gemini_sdk_error(zero_quota_err)
    client = GeminiImageClient(
        api_key="test-key",
        model_name="gemini-3.1-flash-image",
        max_retries=3,
        client=sdk,
    )

    with pytest.raises(GeminiExecutionError) as exc:
        await client.generate_image(
            positive_prompt="Mixer studio shot",
            negative_prompt="watermark",
            aspect_ratio="4:5",
            reference_parts=[],
        )

    assert exc.value.status_code == 429
    assert exc.value.attempts == 1
    assert mock_call.await_count == 1


@pytest.mark.asyncio
async def test_pollinations_provider_builds_expected_url_and_returns_image_bytes():
    captured = {}
    sample_jpeg = make_synthetic_product_image_bytes(width=896, height=1120, fmt="JPEG", variant_seed=3)

    async def handler(method, url, kwargs):
        captured["method"] = method
        captured["url"] = url
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=sample_jpeg)

    free_client = FreeImageGenerationClient(
        pollinations_model="flux",
        http_client_factory=lambda _t: _FakeAsyncClient(handler),
    )

    res = await free_client.generate_pollinations_image(
        prompt="Lifelong mixer grinder studio photo",
        aspect_ratio="4:5",
        seed=4242,
    )

    assert captured["method"] == "GET"
    assert "https://image.pollinations.ai/prompt/" in captured["url"]
    assert "width=896" in captured["url"]
    assert "height=1120" in captured["url"]
    assert "model=flux" in captured["url"]
    assert "nologo=true" in captured["url"]
    assert "enhance=true" in captured["url"]
    assert "seed=4242" in captured["url"]
    assert res.model_identifier == "pollinations:flux"
    assert res.mime_type == "image/jpeg"
    assert res.cost.estimated_cost_usd == 0.0
    assert len(res.image_bytes) > 1024


@pytest.mark.asyncio
async def test_pollinations_provider_rejects_non_image_content_type():
    async def handler(method, url, kwargs):
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>error</html>")

    free_client = FreeImageGenerationClient(
        http_client_factory=lambda _t: _FakeAsyncClient(handler),
    )

    with pytest.raises(FreeImageProviderError):
        await free_client.generate_pollinations_image(prompt="Test prompt", aspect_ratio="1:1")


@pytest.mark.asyncio
async def test_huggingface_provider_posts_router_api_and_fits_aspect_ratio():
    captured = {}
    square_png = make_synthetic_product_image_bytes(width=1024, height=1024, fmt="PNG", variant_seed=2)

    async def handler(method, url, kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        captured["json"] = kwargs.get("json")
        return httpx.Response(200, headers={"content-type": "image/png"}, content=square_png)

    free_client = FreeImageGenerationClient(
        hf_api_key="hf_secret_test",
        hf_image_model="black-forest-labs/FLUX.1-schnell",
        http_client_factory=lambda _t: _FakeAsyncClient(handler),
    )

    res = await free_client.generate_huggingface_image(
        prompt="Stainless steel mixer on marble counter",
        aspect_ratio="4:5",
    )

    assert captured["method"] == "POST"
    assert captured["url"] == "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"
    assert captured["headers"]["Authorization"] == "Bearer hf_secret_test"
    assert "inputs" in captured["json"]
    assert res.model_identifier == "huggingface:black-forest-labs/FLUX.1-schnell"
    assert res.cost.estimated_cost_usd == 0.0

    with Image.open(io.BytesIO(res.image_bytes)) as img:
        assert img.size == (896, 1120)


def test_pillow_fallback_renders_1080x1080_distinct_variations():
    free_client = FreeImageGenerationClient()
    product = make_lifelong_mixer_product()
    ref_bytes = make_synthetic_product_image_bytes(width=600, height=600, fmt="JPEG", variant_seed=0)
    with Image.open(io.BytesIO(ref_bytes)) as ref_img:
        ref_rgb = ref_img.convert("RGB")

    res1 = free_client.generate_pillow_banner_fallback(
        headline="Upgrade Everyday Kitchen Prep",
        product_name=product.product_name,
        brand=product.brand,
        cta_text="Shop Now",
        product_data=product,
        reference_pil_image=ref_rgb,
        variation_index=1,
    )
    res2 = free_client.generate_pillow_banner_fallback(
        headline="Upgrade Everyday Kitchen Prep",
        product_name=product.product_name,
        brand=product.brand,
        cta_text="Shop Now",
        product_data=product,
        reference_pil_image=None,
        variation_index=2,
    )

    assert res1.model_identifier == "local:pillow-banner-fallback"
    assert res1.cost.estimated_cost_usd == 0.0
    with Image.open(io.BytesIO(res1.image_bytes)) as im1, Image.open(io.BytesIO(res2.image_bytes)) as im2:
        assert im1.size == (1080, 1080)
        assert im2.size == (1080, 1080)
        assert compute_dhash(im1) != compute_dhash(im2)


@pytest.mark.asyncio
async def test_image_generation_service_pollinations_skips_gemini_and_stores_assets(monkeypatch):
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "pollinations")

    gemini_sdk, gemini_call = _mock_gemini_sdk_error(RuntimeError("Gemini must not be called"))

    call_idx = -1

    async def poll_handler(method, url, kwargs):
        nonlocal call_idx
        call_idx += 1
        img_b = make_synthetic_product_image_bytes(width=896, height=1120, fmt="JPEG", variant_seed=call_idx)
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=img_b)

    fake_s3 = FakeS3Client()
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(api_key="", model_name="gemini-3.1-flash-image", client=gemini_sdk),
        free_image_client=FreeImageGenerationClient(
            pollinations_model="flux",
            http_client_factory=lambda _t: _FakeAsyncClient(poll_handler),
        ),
        reference_selector=_offline_ref_selector(),
        storage=AgentStorage(s3_client=fake_s3),
        allow_free_fallback=True,
    )

    resp = await service.generate_creatives(
        ImageGenerationRequest(
            campaign_id="camp_poll_direct",
            blueprint=make_sample_image_blueprint("4:5", "instagram_feed"),
            marketing_strategy=MarketingStrategy.model_validate(make_valid_strategy_dict()),
            product_data=make_lifelong_mixer_product(),
            aspect_ratio="4:5",
            num_variations=2,
            apply_deterministic_overlay=True,
        )
    )

    gemini_call.assert_not_awaited()
    assert resp.success is True
    assert resp.approved_count == 2
    assert resp.model_identifier == "pollinations:flux"
    assert resp.total_estimated_cost_usd == 0.0
    assert len(fake_s3.objects) == 6  # 2 raw + 2 overlays + 2 metadata JSONs


@pytest.mark.asyncio
async def test_image_generation_service_huggingface_falls_back_to_pollinations(monkeypatch):
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "huggingface")

    calls = []

    async def handler(method, url, kwargs):
        calls.append((method, url))
        if "router.huggingface.co" in url:
            return httpx.Response(503, text="Model loading")
        img_b = make_synthetic_product_image_bytes(width=1080, height=1080, fmt="JPEG", variant_seed=len(calls))
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=img_b)

    service = ImageGenerationService(
        free_image_client=FreeImageGenerationClient(
            hf_api_key="hf_test_live",
            http_client_factory=lambda _t: _FakeAsyncClient(handler),
        ),
        reference_selector=_offline_ref_selector(),
        storage=AgentStorage(s3_client=FakeS3Client()),
        allow_free_fallback=True,
    )

    resp = await service.generate_creatives(
        ImageGenerationRequest(
            campaign_id="camp_hf_fb",
            blueprint=make_sample_image_blueprint("1:1", "facebook_feed"),
            marketing_strategy=MarketingStrategy.model_validate(make_valid_strategy_dict()),
            product_data=make_lifelong_mixer_product(),
            aspect_ratio="1:1",
            num_variations=1,
        )
    )

    assert len(calls) == 2
    assert calls[0][0] == "POST" and "router.huggingface.co" in calls[0][1]
    assert calls[1][0] == "GET" and "image.pollinations.ai" in calls[1][1]
    assert resp.success is True
    assert resp.model_identifier == "pollinations:flux"


@pytest.mark.asyncio
async def test_image_generation_service_auto_falls_back_through_hf_pollinations_to_pillow(monkeypatch):
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "auto")

    zero_quota_err = genai_errors.ClientError(
        429,
        {"error": {"code": 429, "message": "limit: 0 FreeTier exceeded"}},
    )
    sdk, gemini_call = _mock_gemini_sdk_error(zero_quota_err)

    async def failing_http(method, url, kwargs):
        return httpx.Response(503, text="Upstream busy")

    fake_s3 = FakeS3Client()
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(
            api_key="test-key",
            model_name="gemini-3.1-flash-image",
            max_retries=2,
            client=sdk,
        ),
        free_image_client=FreeImageGenerationClient(
            hf_api_key="hf_live_key",
            http_client_factory=lambda _t: _FakeAsyncClient(failing_http),
        ),
        reference_selector=_offline_ref_selector(),
        storage=AgentStorage(s3_client=fake_s3),
        allow_free_fallback=True,
    )

    resp = await service.generate_creatives(
        ImageGenerationRequest(
            campaign_id="camp_auto_pillow",
            blueprint=make_sample_image_blueprint("4:5", "instagram_feed"),
            marketing_strategy=MarketingStrategy.model_validate(make_valid_strategy_dict()),
            product_data=make_lifelong_mixer_product(),
            aspect_ratio="4:5",
            num_variations=2,
            apply_deterministic_overlay=True,
        )
    )

    assert gemini_call.await_count == 2  # 1 fail-fast attempt per variation
    assert resp.success is True
    assert resp.approved_count == 2
    assert resp.model_identifier == "local:pillow-banner-fallback"
    assert all(a.width == 1080 and a.height == 1080 for a in resp.assets)
    assert all(a.aspect_ratio == "1:1" for a in resp.assets)


def test_images_generate_endpoint_auto_recovers_from_gemini_429_via_pollinations(monkeypatch):
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "auto")

    zero_quota_err = genai_errors.ClientError(
        429,
        {"error": {"code": 429, "message": "FreeTier limit: 0 exhausted"}},
    )
    sdk, _ = _mock_gemini_sdk_error(zero_quota_err)

    async def poll_ok(method, url, kwargs):
        img_b = make_synthetic_product_image_bytes(width=896, height=1120, fmt="JPEG", variant_seed=5)
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=img_b)

    fake_s3 = FakeS3Client()
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(api_key="test-key", model_name="gemini-3.1-flash-image", client=sdk),
        free_image_client=FreeImageGenerationClient(
            hf_api_key="",
            http_client_factory=lambda _t: _FakeAsyncClient(poll_ok),
        ),
        reference_selector=_offline_ref_selector(),
        storage=AgentStorage(s3_client=fake_s3),
        allow_free_fallback=True,
    )

    client = TestClient(app)
    app.dependency_overrides[get_image_generation_service] = lambda: service
    try:
        resp = client.post(
            "/api/v1/images/generate",
            json={
                "campaign_id": "camp_ep_auto",
                "blueprint": make_sample_image_blueprint("4:5", "instagram_feed").model_dump(mode="json"),
                "marketing_strategy": make_valid_strategy_dict(),
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "aspect_ratio": "4:5",
                "num_variations": 1,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["approved_count"] == 1
    assert body["model_identifier"] == "pollinations:flux"


@pytest.mark.asyncio
async def test_image_generation_service_explicit_gemini_provider_does_not_fallback(monkeypatch):
    monkeypatch.setattr(settings, "IMAGE_PROVIDER", "gemini")

    zero_quota_err = genai_errors.ClientError(
        429,
        {"error": {"code": 429, "message": "FreeTier limit: 0 exceeded"}},
    )
    sdk, _ = _mock_gemini_sdk_error(zero_quota_err)

    service = ImageGenerationService(
        gemini_client=GeminiImageClient(api_key="test-key", model_name="gemini-3.1-flash-image", client=sdk),
        reference_selector=_offline_ref_selector(),
        storage=AgentStorage(s3_client=FakeS3Client()),
        allow_free_fallback=True,
    )

    with pytest.raises(GeminiExecutionError) as exc:
        await service.generate_creatives(
            ImageGenerationRequest(
                campaign_id="camp_strict_gem",
                blueprint=make_sample_image_blueprint("4:5", "instagram_feed"),
                marketing_strategy=MarketingStrategy.model_validate(make_valid_strategy_dict()),
                product_data=make_lifelong_mixer_product(),
                aspect_ratio="4:5",
                num_variations=1,
            )
        )
    assert exc.value.status_code == 429

