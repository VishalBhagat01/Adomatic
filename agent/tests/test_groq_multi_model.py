"""
Unit and endpoint tests for Groq + Gemini multi-model LLM routing, vision payload encoding,
strict JSON schema downgrade to json_object, transient capacity failover, and image-only mode.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors
from google.genai import types
import pytest

from agent.app.core.config import settings
from agent.app.main import app
from agent.app.schemas.strategy import MarketingStrategy, StrategyGenerateRequest
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
    GeminiStrategyClient,
)
from agent.app.services.strategy.groq_client import (
    GroqStructuredClient,
    build_groq_json_schema,
    encode_image_parts_for_groq,
)
from agent.app.services.strategy.strategy_service import MarketingStrategyService
from agent.tests.fixtures.image_fixtures import make_synthetic_product_image_bytes
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_valid_strategy_dict,
)
from agent.tests.fixtures.video_fixtures import make_sample_video_storyboard


class _FakeAsyncHttpClient:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return await self.responder(url, headers, json, len(self.calls))


def _make_groq_success_response(model_id: str, payload_obj: dict) -> httpx.Response:
    return httpx.Response(
        status_code=200,
        json={
            "id": "chatcmpl_test_1",
            "model": model_id,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": json.dumps(payload_obj)},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 310,
                "completion_tokens": 520,
                "total_tokens": 830,
            },
        },
    )


def test_build_groq_json_schema_sets_strict_additional_properties_and_required():
    spec = build_groq_json_schema(MarketingStrategy)
    assert spec["strict"] is True
    assert spec["name"] == "MarketingStrategy"
    schema = spec["schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"].keys())
    for sub in (schema.get("$defs") or {}).values():
        if "properties" in sub:
            assert sub["additionalProperties"] is False
            assert set(sub["required"]) == set(sub["properties"].keys())


def test_encode_image_parts_for_groq_caps_count_and_keeps_last_generated_asset():
    raw = make_synthetic_product_image_bytes(600, 600, fmt="JPEG")
    parts = [types.Part.from_bytes(data=raw, mime_type="image/jpeg") for _ in range(5)]
    encoded = encode_image_parts_for_groq(parts, max_images=3)
    assert len(encoded) == 3
    assert all(item["type"] == "image_url" for item in encoded)
    assert all(item["image_url"]["url"].startswith("data:image/") for item in encoded)


@pytest.mark.asyncio
async def test_groq_client_downgrades_schema_rejection_and_validates_locally():
    strategy_dict = make_valid_strategy_dict()
    seen_payloads = []

    async def responder(url, headers, payload, call_idx):
        seen_payloads.append(payload)
        if call_idx == 1:
            return httpx.Response(
                status_code=400,
                json={"error": {"message": "json_schema strict grammar not supported for minItems"}},
            )
        return _make_groq_success_response("openai/gpt-oss-20b", strategy_dict)

    fake_http = _FakeAsyncHttpClient(responder)
    groq_client = GroqStructuredClient(
        api_key="gsk_test_123",
        max_retries=0,
        http_client_factory=lambda _t: fake_http,
    )

    result, meta = await groq_client.generate_structured_with_models(
        candidate_models=["openai/gpt-oss-120b"],
        prompt_text="Build strategy",
        response_schema=MarketingStrategy,
        system_instruction="Be accurate.",
    )

    assert isinstance(result, MarketingStrategy)
    assert len(seen_payloads) == 2
    assert seen_payloads[0]["response_format"]["type"] == "json_schema"
    assert seen_payloads[1]["response_format"] == {"type": "json_object"}
    assert meta.model_name == "openai/gpt-oss-120b"
    assert meta.total_tokens == 830


@pytest.mark.asyncio
async def test_gemini_strategy_client_routes_groq_primary_and_fails_over_on_429(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "gsk_test_live")
    monkeypatch.setattr(settings, "GROQ_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(settings, "GROQ_FALLBACK_MODELS", ["openai/gpt-oss-20b"])

    strategy_dict = make_valid_strategy_dict()
    attempted_models = []

    async def responder(url, headers, payload, call_idx):
        attempted_models.append(payload["model"])
        if payload["model"] == "openai/gpt-oss-120b":
            return httpx.Response(status_code=429, json={"error": {"message": "Rate limit exceeded"}})
        return _make_groq_success_response("openai/gpt-oss-20b", strategy_dict)

    fake_http = _FakeAsyncHttpClient(responder)
    client = GeminiStrategyClient(
        api_key="gemini_test_key",
        model_name="gemini-3.8-flash",
        groq_client=GroqStructuredClient(
            api_key="gsk_test_live",
            max_retries=0,
            http_client_factory=lambda _t: fake_http,
        ),
    )

    with patch("agent.app.services.strategy.groq_client.asyncio.sleep", new_callable=AsyncMock):
        strategy, meta = await client.generate_strategy("Analyze mixer")

    assert isinstance(strategy, MarketingStrategy)
    assert attempted_models == ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    assert meta.model_name == "openai/gpt-oss-20b"


@pytest.mark.asyncio
async def test_gemini_strategy_client_auto_fails_over_from_groq_to_gemini_on_transient_exhaustion(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "gsk_test_live")
    monkeypatch.setattr(settings, "GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    monkeypatch.setattr(settings, "GROQ_VISION_FALLBACK_MODELS", [])

    strategy_dict = make_valid_strategy_dict()
    groq_models_tried = []

    async def responder(url, headers, payload, call_idx):
        groq_models_tried.append(payload["model"])
        return httpx.Response(status_code=503, json={"error": {"message": "Groq capacity spike"}})

    fake_http = _FakeAsyncHttpClient(responder)
    gemini_mock = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(
                generate_content=AsyncMock(
                    return_value=SimpleNamespace(
                        text=json.dumps(strategy_dict),
                        parsed=None,
                        model_version="gemini-3.8-flash-001",
                        response_id="gem_fallback_1",
                        usage_metadata=SimpleNamespace(
                            prompt_token_count=400,
                            candidates_token_count=600,
                            total_token_count=1000,
                        ),
                    )
                )
            )
        )
    )

    raw_img = make_synthetic_product_image_bytes(512, 512, fmt="JPEG")
    img_parts = [types.Part.from_bytes(data=raw_img, mime_type="image/jpeg")]

    client = GeminiStrategyClient(
        api_key="gemini_test_key",
        model_name="gemini-3.8-flash",
        llm_provider="auto",
        groq_api_key="gsk_test_live",
        groq_client=GroqStructuredClient(
            api_key="gsk_test_live",
            max_retries=0,
            http_client_factory=lambda _t: fake_http,
        ),
    )
    with patch.object(client, "_get_client", return_value=gemini_mock):
        with patch("agent.app.services.strategy.groq_client.asyncio.sleep", new_callable=AsyncMock):
            strategy, meta = await client.generate_strategy("Analyze mixer", image_parts=img_parts)

    assert isinstance(strategy, MarketingStrategy)
    assert groq_models_tried == ["qwen/qwen3.8-27b"]
    assert meta.model_name == "gemini-3.8-flash"
    assert meta.multimodal_images_used == 1


@pytest.mark.asyncio
async def test_gemini_strategy_client_401_on_groq_never_silently_falls_back(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "gsk_bad_key")
    monkeypatch.setattr(settings, "GROQ_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(settings, "GROQ_FALLBACK_MODELS", ["openai/gpt-oss-20b"])

    calls = 0

    async def responder(url, headers, payload, call_idx):
        nonlocal calls
        calls += 1
        return httpx.Response(status_code=401, json={"error": {"message": "Invalid API Key"}})

    fake_http = _FakeAsyncHttpClient(responder)
    client = GeminiStrategyClient(
        api_key="gemini_test_key",
        model_name="gemini-3.8-flash",
        llm_provider="auto",
        groq_api_key="gsk_bad_key",
        groq_client=GroqStructuredClient(
            api_key="gsk_bad_key",
            max_retries=1,
            http_client_factory=lambda _t: fake_http,
        ),
    )

    with pytest.raises(GeminiExecutionError) as exc:
        await client.generate_strategy("Analyze mixer")

    assert exc.value.status_code == 401
    assert exc.value.model_name == "openai/gpt-oss-120b"
    assert calls == 1


@pytest.mark.asyncio
async def test_groq_provider_without_key_raises_configuration_error(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "groq")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "")

    client = GeminiStrategyClient(llm_provider="groq", groq_api_key="")
    with pytest.raises(GeminiConfigurationError) as exc:
        await client.generate_strategy("Analyze mixer")
    assert "GROQ_API_KEY" in str(exc.value)


def test_videos_endpoint_returns_503_and_health_reports_image_only_mode(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_VIDEO_GENERATION", False)
    http_client = TestClient(app)

    health_resp = http_client.get("/api/v1/health")
    assert health_resp.status_code == 200
    features = health_resp.json()["details"]["features"]
    assert features["video_generation"] is False
    assert features["image_only_mode"] is True

    vid_resp = http_client.post(
        "/api/v1/videos/generate",
        json={
            "campaign_id": "camp_disabled",
            "storyboard": make_sample_video_storyboard(9, "9:16").model_dump(mode="json"),
            "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
            "execute_sync": True,
        },
    )
    assert vid_resp.status_code == 503
    assert vid_resp.json()["detail"]["code"] == "VIDEO_GENERATION_DISABLED"


@pytest.mark.asyncio
async def test_strategy_service_routes_to_groq_text_model_when_vision_budget_is_low(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "auto")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "gsk_test_live")
    monkeypatch.setattr(settings, "GROQ_MODEL", "openai/gpt-oss-120b")
    monkeypatch.setattr(settings, "GROQ_FALLBACK_MODELS", ["openai/gpt-oss-20b"])
    monkeypatch.setattr(settings, "GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    monkeypatch.setattr(settings, "GROQ_VISION_FALLBACK_MODELS", [])

    models_called = []

    async def responder(url, headers, payload, call_idx):
        models_called.append(payload["model"])
        # Verify no image_url content blocks are sent
        user_msg = payload["messages"][-1]["content"]
        assert isinstance(user_msg, str)
        return httpx.Response(
            status_code=200,
            json={
                "id": "chatcmpl_strat_text",
                "choices": [{"message": {"content": json.dumps(make_valid_strategy_dict())}}],
                "usage": {"prompt_tokens": 500, "completion_tokens": 1800, "total_tokens": 2300},
            },
        )

    fake_http = _FakeAsyncHttpClient(responder)
    client = GeminiStrategyClient(
        api_key="gemini_test_key",
        model_name="gemini-3.8-flash",
        llm_provider="auto",
        groq_api_key="gsk_test_live",
        groq_client=GroqStructuredClient(
            api_key="gsk_test_live",
            max_retries=0,
            http_client_factory=lambda _t: fake_http,
        ),
    )
    service = MarketingStrategyService(gemini_client=client, max_regenerations=0)

    req = StrategyGenerateRequest(
        product_data=make_lifelong_mixer_product(),
        user_prompt="Create launch campaign for Lifelong mixer grinder",
        formats=["image"],
        placements=["instagram_post", "facebook_feed"],
        fetch_images=True,
    )

    with patch(
        "agent.app.services.strategy.strategy_service.load_reference_images_for_gemini",
        new_callable=AsyncMock,
    ) as mock_loader:
        response = await service.generate_marketing_strategy(req)

    mock_loader.assert_not_awaited()
    assert response.success is True
    assert response.generation_metadata.model_name == "openai/gpt-oss-120b"
    assert response.generation_metadata.multimodal_images_used == 0
    assert models_called == ["openai/gpt-oss-120b"]
    assert any("text models" in w for w in response.warnings)


@pytest.mark.asyncio
async def test_strategy_service_falls_back_to_text_only_on_transient_multimodal_error():
    class _TransientMultimodalClient:
        def prefers_text_only_strategy(self) -> bool:
            return False

        async def generate_strategy(self, prompt_text: str, image_parts=None):
            if image_parts:
                raise GeminiExecutionError(
                    "Model overloaded during multimodal call",
                    model_name="gemini-3.8-flash",
                    status_code=503,
                    attempts=3,
                )
            strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
            from agent.app.schemas.strategy import GenerationMetadata
            return strategy, GenerationMetadata(
                model_name="openai/gpt-oss-120b",
                latency_ms=42.0,
                attempts=1,
                multimodal_images_used=0,
            )

    raw_img = make_synthetic_product_image_bytes(256, 256, fmt="JPEG")
    img_parts = [types.Part.from_bytes(data=raw_img, mime_type="image/jpeg")]
    service = MarketingStrategyService(gemini_client=_TransientMultimodalClient(), max_regenerations=0)
    req = StrategyGenerateRequest(
        product_data=make_lifelong_mixer_product(),
        user_prompt="Create launch campaign",
        formats=["image"],
        placements=["instagram_post"],
        fetch_images=True,
    )

    with patch(
        "agent.app.services.strategy.strategy_service.load_reference_images_for_gemini",
        new_callable=AsyncMock,
        return_value=(img_parts, []),
    ):
        response = await service.generate_marketing_strategy(req)

    assert response.success is True
    assert response.generation_metadata.model_name == "openai/gpt-oss-120b"
    assert any("transient provider error (503)" in w for w in response.warnings)


