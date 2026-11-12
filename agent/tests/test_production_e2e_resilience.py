"""
Step 12 — Python Agent Production E2E, Failure Recovery, Security & Memory Guardrail Tests
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from agent.app.main import app
from agent.app.api.v1.endpoints.strategy import get_strategy_service
from agent.app.services.strategy.gemini_client import GeminiStrategyClient
from agent.app.services.strategy.prompt_builder import build_strategy_prompt
from agent.app.services.strategy.strategy_service import MarketingStrategyService
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_valid_strategy_dict,
)

client = TestClient(app)


def test_agent_health_and_metrics_observability():
    health_res = client.get("/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "ok"

    metrics_res = client.get("/metrics")
    assert metrics_res.status_code == 200
    body = metrics_res.json()
    assert body["service"] == "adpilot-agent"
    assert "requests_total" in body
    assert "configured_models" in body
    assert "strategy_model" in body["configured_models"]
    assert "image_model" in body["configured_models"]
    assert "video_model" in body["configured_models"]


def test_learning_hints_never_override_verified_product_facts():
    product = make_lifelong_mixer_product()
    prompt = build_strategy_prompt(
        product_data=product,
        user_prompt="Highlight authentic grinding capability.",
        formats=["image"],
        placements=["instagram_feed"],
        learning_hints={
            "effective_hooks": [{"hookType": "question_hook", "avgLinkCtr": 3.4}],
            "avoid_patterns": ["Avoid dark obscured jars"],
            "recommendations": ["Test hero countertop contrast"],
        },
    )

    assert "VERIFIED PRODUCT DATA (SOLE SOURCE OF FACTUAL TRUTH)" in prompt
    assert "HISTORICAL CREATIVE LEARNING MEMORY (CREATIVE GUIDANCE ONLY — NEVER OVERRIDES PRODUCTDATA FACTS)" in prompt
    assert "question_hook" in prompt
    assert "Verified current ProductData strictly controls ALL factual specs, prices, discounts, and claims." in prompt


def test_ssrf_protection_blocks_private_and_metadata_urls():
    for malicious_url in [
        "http://127.0.0.1:5000/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.12/internal",
        "http://192.168.1.50/router",
    ]:
        res = client.post(
            "/api/v1/products/extract",
            json={"product_url": malicious_url},
        )
        assert res.status_code in (400, 422)


def test_strategy_generation_handles_gemini_outage_with_structured_502_and_metrics():
    product = make_lifelong_mixer_product()

    def failing_sdk():
        mock_generate = AsyncMock(
            side_effect=genai_errors.ServerError(503, {"error": {"message": "Service Unavailable"}}, None)
        )
        return SimpleNamespace(
            aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_generate))
        )

    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=failing_sdk(),
        max_retries=1,
    )
    failing_service = MarketingStrategyService(gemini_client=gemini_client, max_regenerations=0)
    app.dependency_overrides[get_strategy_service] = lambda: failing_service

    try:
        before_metrics = client.get("/metrics").json()
        res = client.post(
            "/api/v1/strategy/generate",
            json={
                "product_data": product.model_dump(mode="json"),
                "user_prompt": "Create compelling mixer ads",
                "formats": ["image"],
                "placements": ["instagram_feed"],
                "fetch_images": False,
                "learning_hints": {
                    "effective_hooks": [{"hookType": "question_hook", "winCount": 2}],
                    "avoid_patterns": ["Blurred product label"],
                },
            },
        )
        assert res.status_code == 502
        detail = res.json()["detail"]
        assert detail["code"] == "GEMINI_EXECUTION_ERROR"

        after_metrics = client.get("/metrics").json()
        assert after_metrics["errors_5xx"] >= before_metrics["errors_5xx"] + 1
    finally:
        app.dependency_overrides.clear()


def test_strategy_endpoint_accepts_learning_hints_and_returns_valid_strategy():
    product = make_lifelong_mixer_product()
    valid_strategy = make_valid_strategy_dict()

    fake_resp = SimpleNamespace(
        text=json.dumps(valid_strategy),
        parsed=None,
        model_version="gemini-2.5-flash-001",
        response_id="resp_step12_001",
        usage_metadata=SimpleNamespace(
            prompt_token_count=320,
            candidates_token_count=540,
            total_token_count=860,
        ),
    )

    mock_sdk = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_content=AsyncMock(return_value=fake_resp))
        )
    )
    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=mock_sdk,
    )
    svc = MarketingStrategyService(gemini_client=gemini_client, max_regenerations=1)
    app.dependency_overrides[get_strategy_service] = lambda: svc

    try:
        res = client.post(
            "/api/v1/strategy/generate",
            json={
                "product_data": product.model_dump(mode="json"),
                "user_prompt": "Promote 500W heavy duty grinding for busy homes.",
                "formats": ["image"],
                "placements": ["instagram_feed"],
                "fetch_images": False,
                "learning_hints": {
                    "effective_hooks": [{"hookType": "question_hook", "avgLinkCtr": 3.5}],
                    "recommendations": ["Test question hook anchored on verified wattage"],
                },
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        assert body["strategy"]["product_knowledge"]["product_category"]
    finally:
        app.dependency_overrides.clear()
