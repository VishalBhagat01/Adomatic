"""
Integration tests for POST /api/v1/creative/plan FastAPI endpoint
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from agent.app.api.v1.endpoints.creative import get_creative_planning_service
from agent.app.main import app
from agent.app.services.creative.planning_service import CreativePlanningService
from agent.app.services.strategy.gemini_client import GeminiStrategyClient
from agent.tests.fixtures.creative_fixtures import make_valid_creative_draft_dict
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_valid_strategy_dict,
)

client = TestClient(app)


def _mock_sdk(side_effects):
    mock_gen = AsyncMock(side_effect=side_effects)
    return SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_gen))
    )


def test_creative_plan_endpoint_success():
    product = make_lifelong_mixer_product()
    strategy = make_valid_strategy_dict(include_cordless_audit=True)
    draft = make_valid_creative_draft_dict(target_video_duration=15)

    fake_resp = SimpleNamespace(
        text=json.dumps(draft),
        parsed=None,
        model_version="gemini-2.5-flash-001",
        response_id="resp_creative_ok",
        usage_metadata=SimpleNamespace(
            prompt_token_count=420,
            candidates_token_count=880,
            total_token_count=1300,
        ),
    )

    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=_mock_sdk([fake_resp]),
    )
    service = CreativePlanningService(gemini_client=gemini_client, max_regenerations=1)
    app.dependency_overrides[get_creative_planning_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/creative/plan",
            json={
                "product_data": product.model_dump(mode="json"),
                "strategy": strategy,
                "user_prompt": "Create dynamic Instagram Feed and Reels ads highlighting compact 3-jar cooking prep.",
                "formats": ["image", "video"],
                "placements": ["instagram_feed", "instagram_reels"],
                "target_video_duration": 15,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["validation"]["passed"] is True
    assert len(body["plan"]["concepts"]) == 4

    # Verify compiled prompts and preservation rules exist on concepts
    img_concept = next(c for c in body["plan"]["concepts"] if c["format"] == "image")
    vid_concept = next(c for c in body["plan"]["concepts"] if c["format"] == "video")
    assert img_concept["image_blueprint"]["aspect_ratio"] == "4:5"
    assert "Lifelong LLM99 Mixer Grinder" in img_concept["image_blueprint"]["image_generation_prompt"]["positive_prompt"]
    assert vid_concept["video_storyboard"]["total_duration"] == 15
    assert sum(s["scene_duration"] for s in vid_concept["video_storyboard"]["scene_sequence"]) == 15


def test_creative_plan_endpoint_missing_api_key_returns_503():
    gemini_client = GeminiStrategyClient(api_key="", model_name="gemini-2.5-flash")
    service = CreativePlanningService(gemini_client=gemini_client)
    app.dependency_overrides[get_creative_planning_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/creative/plan",
            json={
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "strategy": make_valid_strategy_dict(),
                "user_prompt": "Create dynamic Instagram ads.",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "GEMINI_CONFIGURATION_ERROR"


def test_creative_plan_endpoint_model_error_returns_502_no_fallback():
    err = genai_errors.ClientError(404, {"error": {"message": "Model unavailable"}})
    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-strict-model",
        genai_client=_mock_sdk([err]),
    )
    service = CreativePlanningService(gemini_client=gemini_client)
    app.dependency_overrides[get_creative_planning_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/creative/plan",
            json={
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "strategy": make_valid_strategy_dict(),
                "user_prompt": "Create dynamic Instagram ads.",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 502
    assert response.json()["detail"]["model_name"] == "gemini-strict-model"


def test_creative_plan_endpoint_validation_failure_returns_422():
    bad_draft = make_valid_creative_draft_dict(15)
    bad_draft["video_concepts"][0]["scene_sequence"][0]["scene_duration"] = 99

    bad_resp = SimpleNamespace(
        text=json.dumps(bad_draft),
        parsed=None,
        model_version="gemini-2.5-flash-001",
        response_id="resp_c_bad",
        usage_metadata=None,
    )
    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=_mock_sdk([bad_resp, bad_resp]),
    )
    service = CreativePlanningService(gemini_client=gemini_client, max_regenerations=1)
    app.dependency_overrides[get_creative_planning_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/creative/plan",
            json={
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "strategy": make_valid_strategy_dict(),
                "user_prompt": "Create dynamic Instagram Reels ads.",
                "target_video_duration": 15,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["success"] is False
    assert any(i["code"] == "DURATION_MISMATCH" for i in detail["validation"]["issues"])


def test_creative_plan_endpoint_rejects_invalid_duration_request():
    response = client.post(
        "/api/v1/creative/plan",
        json={
            "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
            "strategy": make_valid_strategy_dict(),
            "user_prompt": "Create dynamic ads.",
            "target_video_duration": 2,  # Below ge=6 constraint
        },
    )
    assert response.status_code == 422

