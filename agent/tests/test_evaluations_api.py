"""
FastAPI endpoint integration tests for Step 09:
- POST /api/v1/evaluations/evaluate
- POST /api/v1/evaluations/copy
- POST /api/v1/evaluations/evaluate-and-regenerate
"""

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient

from agent.app.api.v1.endpoints.evaluations import (
    get_ad_copy_service,
    get_creative_evaluation_service,
    get_evaluation_regeneration_service,
)
from agent.app.main import app
from agent.app.schemas.strategy import MarketingStrategy
from agent.app.services.evaluation import (
    AdCopyService,
    CreativeEvaluationService,
    EvaluationRegenerationService,
)
from agent.app.services.image_gen.reference_selector import ReferenceImageSelector
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
)
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_valid_strategy_dict,
)
from agent.tests.test_evaluation_and_copy import (
    FakeGeminiEvalClient,
    _fake_generated_image_response,
    _make_ad_copy_draft,
    _make_multimodal_draft,
)

client = TestClient(app)


def _offline_ref_selector(product):
    ref_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=0)
    return ReferenceImageSelector(
        client_factory=make_mock_image_http_factory(
            {img.url: (200, "image/jpeg", ref_bytes) for img in product.images}
        ),
        resolve_dns=False,
    )


def test_evaluate_endpoint_returns_200_for_existing_image():
    product = make_lifelong_mixer_product()
    strategy = make_valid_strategy_dict()
    blueprint = make_sample_image_blueprint()
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)

    svc = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient([_make_multimodal_draft(score_each=90.0)]),  # type: ignore[arg-type]
        reference_selector=_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    app.dependency_overrides[get_creative_evaluation_service] = lambda: svc
    try:
        resp = client.post(
            "/api/v1/evaluations/evaluate",
            json={
                "campaign_id": "camp_api_01",
                "creative_id": "cr_api_01",
                "format": "image",
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy,
                "image_blueprint": blueprint.model_dump(mode="json"),
                "creative_base64": base64.b64encode(cand_bytes).decode("ascii"),
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["approved"] is True
        assert body["decision"] == "approved"
        assert len(body["criteria_scores"]) == 10
    finally:
        app.dependency_overrides.clear()


def test_evaluate_endpoint_maps_missing_object_key_to_422_and_gemini_errors():
    product = make_lifelong_mixer_product()
    strategy = make_valid_strategy_dict()
    blueprint = make_sample_image_blueprint()

    svc_missing = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient([]),  # type: ignore[arg-type]
        reference_selector=_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    app.dependency_overrides[get_creative_evaluation_service] = lambda: svc_missing
    try:
        resp = client.post(
            "/api/v1/evaluations/evaluate",
            json={
                "campaign_id": "camp_miss",
                "creative_id": "cr_miss",
                "format": "image",
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy,
                "image_blueprint": blueprint.model_dump(mode="json"),
                "object_key": "nonexistent/key.png",
            },
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "EVALUATION_ASSET_RETRIEVAL_ERROR"
    finally:
        app.dependency_overrides.clear()

    class _CfgErrClient:
        async def generate_structured(self, **kwargs):
            raise GeminiConfigurationError("GEMINI_API_KEY not configured")

    svc_cfg = CreativeEvaluationService(
        gemini_client=_CfgErrClient(),  # type: ignore[arg-type]
        reference_selector=_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)
    app.dependency_overrides[get_creative_evaluation_service] = lambda: svc_cfg
    try:
        resp = client.post(
            "/api/v1/evaluations/evaluate",
            json={
                "campaign_id": "camp_cfg",
                "creative_id": "cr_cfg",
                "format": "image",
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy,
                "image_blueprint": blueprint.model_dump(mode="json"),
                "creative_base64": base64.b64encode(cand_bytes).decode("ascii"),
            },
        )
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()

    class _ExecErrClient:
        async def generate_structured(self, **kwargs):
            raise GeminiExecutionError("Upstream timeout", model_name="gemini-2.5-flash", status_code=504)

    svc_exec = CreativeEvaluationService(
        gemini_client=_ExecErrClient(),  # type: ignore[arg-type]
        reference_selector=_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    app.dependency_overrides[get_creative_evaluation_service] = lambda: svc_exec
    try:
        resp = client.post(
            "/api/v1/evaluations/evaluate",
            json={
                "campaign_id": "camp_exec",
                "creative_id": "cr_exec",
                "format": "image",
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy,
                "image_blueprint": blueprint.model_dump(mode="json"),
                "creative_base64": base64.b64encode(cand_bytes).decode("ascii"),
            },
        )
        assert resp.status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_copy_endpoint_enforces_approval_and_claim_validation():
    product = make_lifelong_mixer_product()
    strategy_dict = make_valid_strategy_dict()
    strategy = MarketingStrategy.model_validate(strategy_dict)
    blueprint = make_sample_image_blueprint()
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)

    eval_svc = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient(
            [
                _make_multimodal_draft(score_each=91.0),
                _make_multimodal_draft(score_each=91.0, hard_codes=["INCORRECT_PRODUCT_LOGO"], hard_reasons=["Bad logo"]),
            ]
        ),  # type: ignore[arg-type]
        reference_selector=_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )

    import asyncio

    from agent.app.schemas.evaluation import CreativeEvaluationRequest

    approved_ev = asyncio.run(
        eval_svc.evaluate_creative(
            CreativeEvaluationRequest(
                campaign_id="camp_cp",
                creative_id="cr_ok",
                format="image",
                product_data=product,
                marketing_strategy=strategy,
                image_blueprint=blueprint,
                creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
            )
        )
    )
    rejected_ev = asyncio.run(
        eval_svc.evaluate_creative(
            CreativeEvaluationRequest(
                campaign_id="camp_cp",
                creative_id="cr_bad",
                format="image",
                product_data=product,
                marketing_strategy=strategy,
                image_blueprint=blueprint,
                creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
            )
        )
    )

    # 1. Valid creative + clean copy -> 200
    app.dependency_overrides[get_ad_copy_service] = lambda: AdCopyService(
        gemini_client=FakeGeminiEvalClient([_make_ad_copy_draft()]),  # type: ignore[arg-type]
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    try:
        resp_ok = client.post(
            "/api/v1/evaluations/copy",
            json={
                "campaign_id": "camp_cp",
                "creative_id": "cr_ok",
                "creative_evaluation": approved_ev.model_dump(mode="json"),
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy_dict,
                "image_blueprint": blueprint.model_dump(mode="json"),
            },
        )
        assert resp_ok.status_code == 200
        body = resp_ok.json()
        assert body["approved"] is True
        assert len(body["primary_texts"]) == 3
        assert len(body["headlines"]) == 3
        assert len(body["descriptions"]) == 2
    finally:
        app.dependency_overrides.clear()

    # 2. Unapproved creative -> 422 UNAPPROVED_CREATIVE_REJECTED
    app.dependency_overrides[get_ad_copy_service] = lambda: AdCopyService(
        gemini_client=FakeGeminiEvalClient([_make_ad_copy_draft()]),  # type: ignore[arg-type]
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    try:
        resp_unapproved = client.post(
            "/api/v1/evaluations/copy",
            json={
                "campaign_id": "camp_cp",
                "creative_id": "cr_bad",
                "creative_evaluation": rejected_ev.model_dump(mode="json"),
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy_dict,
                "image_blueprint": blueprint.model_dump(mode="json"),
            },
        )
        assert resp_unapproved.status_code == 422
        assert resp_unapproved.json()["detail"]["code"] == "UNAPPROVED_CREATIVE_REJECTED"
    finally:
        app.dependency_overrides.clear()

    # 3. Approved creative but copy keeps inventing prohibited claims -> 422 AD_COPY_CLAIM_AUDIT_FAILED
    bad_copy_draft = _make_ad_copy_draft(
        primary_overrides=[
            "The #1 best-in-class mixer that cures fatigue and beats all competitors!",
            "Unbreakable FDA approved motor guaranteed for life.",
            "Special flash price INR 499 for 50,000 happy customers.",
        ]
    )
    app.dependency_overrides[get_ad_copy_service] = lambda: AdCopyService(
        gemini_client=FakeGeminiEvalClient([bad_copy_draft, bad_copy_draft]),  # type: ignore[arg-type]
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    try:
        resp_bad_copy = client.post(
            "/api/v1/evaluations/copy",
            json={
                "campaign_id": "camp_cp",
                "creative_id": "cr_ok",
                "creative_evaluation": approved_ev.model_dump(mode="json"),
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy_dict,
                "image_blueprint": blueprint.model_dump(mode="json"),
            },
        )
        assert resp_bad_copy.status_code == 422
        assert resp_bad_copy.json()["detail"]["code"] == "AD_COPY_CLAIM_AUDIT_FAILED"
    finally:
        app.dependency_overrides.clear()


def test_evaluate_and_regenerate_endpoint_returns_200_with_full_history():
    product = make_lifelong_mixer_product()
    strategy_dict = make_valid_strategy_dict()
    blueprint = make_sample_image_blueprint()
    img_bad = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)
    img_good = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=2)

    fake_s3 = FakeS3Client()
    storage = AgentStorage(s3_client=fake_s3)
    regen_key = "campaigns/camp_api_regen/regen_v2.png"
    storage.upload_bytes(bucket="adpilot-creatives", object_key=regen_key, data=img_good, content_type="image/png")

    evaluator = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient(
            [
                _make_multimodal_draft(score_each=88.0, hard_codes=["INCORRECT_PRODUCT_LOGO"], hard_reasons=["Blurred brand mark"]),
                _make_multimodal_draft(score_each=92.0),
            ]
        ),  # type: ignore[arg-type]
        reference_selector=_offline_ref_selector(product),
        storage=storage,
    )
    copy_svc = AdCopyService(
        gemini_client=FakeGeminiEvalClient([_make_ad_copy_draft()]),  # type: ignore[arg-type]
        storage=storage,
    )
    img_svc = SimpleNamespace(
        generate_creatives=AsyncMock(return_value=_fake_generated_image_response("camp_api_regen", regen_key, "cr_regen_2", cost=0.04)),
        storage=storage,
    )
    orch = EvaluationRegenerationService(
        evaluator_service=evaluator,
        copy_service=copy_svc,
        image_service=img_svc,  # type: ignore[arg-type]
        storage=storage,
    )

    app.dependency_overrides[get_evaluation_regeneration_service] = lambda: orch
    try:
        resp = client.post(
            "/api/v1/evaluations/evaluate-and-regenerate",
            json={
                "campaign_id": "camp_api_regen",
                "creative_id": "cr_initial",
                "format": "image",
                "product_data": product.model_dump(mode="json"),
                "marketing_strategy": strategy_dict,
                "image_blueprint": blueprint.model_dump(mode="json"),
                "creative_base64": base64.b64encode(img_bad).decode("ascii"),
                "max_regenerations": 2,
                "generate_ad_copy_on_approval": True,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["total_attempts"] == 2
        assert body["regenerations_performed"] == 1
        assert body["validated_ad_copy"]["approved"] is True
    finally:
        app.dependency_overrides.clear()
