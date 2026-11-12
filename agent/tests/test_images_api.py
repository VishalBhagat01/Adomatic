"""
Integration tests for POST /api/v1/images/generate FastAPI endpoint (Step 07).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from agent.app.api.v1.endpoints.images import get_image_generation_service
from agent.app.main import app
from agent.app.services.image_gen.gemini_image_client import GeminiImageClient
from agent.app.services.image_gen.generation_service import ImageGenerationService
from agent.app.services.image_gen.reference_selector import ReferenceImageSelector
from agent.app.services.storage import AgentStorage
from agent.tests.fixtures.image_fixtures import (
    FakeS3Client,
    make_mock_image_http_factory,
    make_sample_image_blueprint,
    make_synthetic_product_image_bytes,
)
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_missing_price_product,
    make_valid_strategy_dict,
)

client = TestClient(app)


def _mock_sdk(side_effects):
    mock_call = AsyncMock(side_effect=side_effects)
    return SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_call))
    )


def _img_resp(raw_bytes: bytes, mime_type: str = "image/png"):
    return SimpleNamespace(
        parts=[SimpleNamespace(inline_data=SimpleNamespace(data=raw_bytes, mime_type=mime_type), text=None)],
        candidates=[],
        model_version="gemini-2.5-flash-image-001",
        response_id="resp_api_img_1",
        usage_metadata=SimpleNamespace(
            prompt_token_count=320,
            candidates_token_count=1290,
            total_token_count=1610,
        ),
    )


def _ref_factory():
    ref1 = make_synthetic_product_image_bytes(900, 900, fmt="JPEG", variant_seed=0)
    ref2 = make_synthetic_product_image_bytes(1100, 1100, fmt="PNG", variant_seed=1)
    return make_mock_image_http_factory(
        {
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer1.jpg": (200, "image/jpeg", ref1),
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer2.jpg": (200, "image/png", ref2),
        }
    )


def test_images_generate_endpoint_success_multi_variation_9_16():
    product = make_lifelong_mixer_product()
    strategy = make_valid_strategy_dict()
    blueprint = make_sample_image_blueprint(aspect_ratio="9:16", placement="instagram_reels")

    var1 = make_synthetic_product_image_bytes(768, 1344, fmt="PNG", variant_seed=0)
    var2 = make_synthetic_product_image_bytes(768, 1344, fmt="PNG", variant_seed=1)

    fake_s3 = FakeS3Client()
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(
            api_key="test-key",
            model_name="gemini-2.5-flash-image",
            client=_mock_sdk([_img_resp(var1), _img_resp(var2)]),
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        storage=AgentStorage(s3_client=fake_s3),
    )
    app.dependency_overrides[get_image_generation_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/images/generate",
            json={
                "campaign_id": "camp_reels_01",
                "blueprint": blueprint.model_dump(mode="json"),
                "marketing_strategy": strategy,
                "product_data": product.model_dump(mode="json"),
                "aspect_ratio": "9:16",
                "num_variations": 2,
                "apply_deterministic_overlay": True,
                "overlay_headline": "Compact 500W Grinding Power",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["aspect_ratio"] == "9:16"
    assert body["approved_count"] == 2
    assert body["rejected_count"] == 0
    assert len(body["assets"]) == 2
    assert body["assets"][0]["overlay_applied"] is True
    assert body["assets"][0]["text_overlay_spec"]["headline"] == "Compact 500W Grinding Power"
    assert body["assets"][0]["presigned_url"].startswith("https://minio.local/adpilot-creatives/")
    # 2 raw PNGs + 2 overlay PNGs + 2 metadata JSONs = 6 S3 objects
    assert len(fake_s3.objects) == 6


def test_images_generate_endpoint_missing_api_key_returns_503():
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(api_key="", model_name="gemini-2.5-flash-image"),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    app.dependency_overrides[get_image_generation_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/images/generate",
            json={
                "campaign_id": "camp_nokey",
                "blueprint": make_sample_image_blueprint("1:1", "facebook_feed").model_dump(mode="json"),
                "marketing_strategy": make_valid_strategy_dict(),
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "aspect_ratio": "1:1",
                "num_variations": 1,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "GEMINI_CONFIGURATION_ERROR"


def test_images_generate_endpoint_model_404_returns_502_without_fallback():
    err = genai_errors.ClientError(404, {"error": {"message": "Model not found"}})
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(
            api_key="test-key",
            model_name="gemini-unregistered-image",
            client=_mock_sdk([err]),
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    app.dependency_overrides[get_image_generation_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/images/generate",
            json={
                "campaign_id": "camp_badmodel",
                "blueprint": make_sample_image_blueprint("4:5", "instagram_feed").model_dump(mode="json"),
                "marketing_strategy": make_valid_strategy_dict(),
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "num_variations": 1,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 502
    assert response.json()["detail"]["model_name"] == "gemini-unregistered-image"


def test_images_generate_endpoint_missing_reference_images_returns_422():
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(api_key="test-key", model_name="gemini-2.5-flash-image"),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    app.dependency_overrides[get_image_generation_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/images/generate",
            json={
                "campaign_id": "camp_norefs",
                "blueprint": make_sample_image_blueprint("4:5", "instagram_feed").model_dump(mode="json"),
                "marketing_strategy": make_valid_strategy_dict(),
                "product_data": make_missing_price_product().model_dump(mode="json"),
                "num_variations": 1,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "IMAGE_GENERATION_INPUT_ERROR"


def test_images_generate_endpoint_all_failed_persists_rejected_and_returns_422():
    blank_img = make_synthetic_product_image_bytes(1080, 1080, fmt="PNG", blank=True)
    fake_s3 = FakeS3Client()
    service = ImageGenerationService(
        gemini_client=GeminiImageClient(
            api_key="test-key",
            model_name="gemini-2.5-flash-image",
            client=_mock_sdk([_img_resp(blank_img)]),
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        storage=AgentStorage(s3_client=fake_s3),
    )
    app.dependency_overrides[get_image_generation_service] = lambda: service

    try:
        response = client.post(
            "/api/v1/images/generate",
            json={
                "campaign_id": "camp_allfail",
                "blueprint": make_sample_image_blueprint("1:1", "facebook_feed").model_dump(mode="json"),
                "marketing_strategy": make_valid_strategy_dict(),
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "aspect_ratio": "1:1",
                "num_variations": 1,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["success"] is False
    assert detail["approved_count"] == 0
    assert detail["rejected_count"] == 1
    assert detail["assets"][0]["approved"] is False
    assert "/rejected/" in detail["assets"][0]["object_key"]
    # Failed raw image and metadata MUST still be saved to S3
    assert len(fake_s3.objects) == 2

