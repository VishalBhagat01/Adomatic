"""
Integration tests for POST /api/v1/strategy/generate FastAPI endpoint
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from agent.app.main import app
from agent.app.api.v1.endpoints.strategy import get_strategy_service
from agent.app.services.strategy.gemini_client import GeminiStrategyClient
from agent.app.services.strategy.strategy_service import MarketingStrategyService
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_valid_strategy_dict,
)

client = TestClient(app)


def _mock_genai_sdk(side_effects):
    mock_generate = AsyncMock(side_effect=side_effects)
    return SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(
                generate_content=mock_generate
            )
        )
    )


def test_strategy_generate_endpoint_success():
    product = make_lifelong_mixer_product()
    valid_strategy = make_valid_strategy_dict()

    fake_resp = SimpleNamespace(
        text=json.dumps(valid_strategy),
        parsed=None,
        model_version="gemini-2.5-flash-001",
        response_id="resp_api_001",
        usage_metadata=SimpleNamespace(
            prompt_token_count=300,
            candidates_token_count=500,
            total_token_count=800,
        ),
    )

    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=_mock_genai_sdk([fake_resp]),
    )
    service = MarketingStrategyService(gemini_client=gemini_client, max_regenerations=1)
    app.dependency_overrides[get_strategy_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/strategy/generate",
            json={
                "product_data": product.model_dump(mode="json"),
                "user_prompt": "Create a premium Instagram ad targeting young professionals.",
                "formats": ["image", "video"],
                "placements": ["instagram_feed", "instagram_reels"],
                "fetch_images": False,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert len(body["strategy"]["marketing_angles"]) == 3
    assert body["quality_validation"]["passed"] is True
    assert body["generation_metadata"]["model_name"] == "gemini-2.5-flash"
    assert body["generation_metadata"]["total_tokens"] == 800


def test_strategy_generate_endpoint_missing_api_key_returns_503():
    gemini_client = GeminiStrategyClient(api_key="", model_name="gemini-2.5-flash")
    service = MarketingStrategyService(gemini_client=gemini_client)
    app.dependency_overrides[get_strategy_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/strategy/generate",
            json={
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "user_prompt": "Create an engaging Instagram campaign.",
                "fetch_images": False,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "GEMINI_CONFIGURATION_ERROR"


def test_strategy_generate_endpoint_model_failure_returns_502_no_fallback():
    err = genai_errors.ClientError(404, {"error": {"message": "Requested model not found"}})
    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-custom-strict",
        genai_client=_mock_genai_sdk([err]),
    )
    service = MarketingStrategyService(gemini_client=gemini_client)
    app.dependency_overrides[get_strategy_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/strategy/generate",
            json={
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "user_prompt": "Create an engaging Instagram campaign.",
                "fetch_images": False,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "GEMINI_EXECUTION_ERROR"
    assert detail["model_name"] == "gemini-custom-strict"


def test_strategy_generate_endpoint_quality_failure_returns_422():
    bad_strategy = make_valid_strategy_dict()
    bad_strategy["personas"][0]["persona_name"] = "General Consumers"

    fake_resp = SimpleNamespace(
        text=json.dumps(bad_strategy),
        parsed=None,
        model_version="gemini-2.5-flash-001",
        response_id="resp_bad",
        usage_metadata=None,
    )

    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=_mock_genai_sdk([fake_resp, fake_resp]),
    )
    service = MarketingStrategyService(gemini_client=gemini_client, max_regenerations=1)
    app.dependency_overrides[get_strategy_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/strategy/generate",
            json={
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "user_prompt": "Create an Instagram campaign.",
                "fetch_images": False,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["success"] is False
    assert detail["quality_validation"]["passed"] is False
    assert any(i["code"] == "GENERIC_PERSONA" for i in detail["quality_validation"]["issues"])


def test_strategy_generate_endpoint_rejects_invalid_request_input():
    response = client.post(
        "/api/v1/strategy/generate",
        json={
            "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
            "user_prompt": "hi",  # Below min_length=5
        },
    )
    assert response.status_code == 422

