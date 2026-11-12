"""
Unit and workflow tests for Step 05: Gemini Product Understanding, Strategy Generation,
Quality Validation, Controlled Regeneration, and Multimodal Reference Loading.
"""

import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from google.genai import errors as genai_errors

from agent.app.schemas.strategy import (
    MarketingStrategy,
    StrategyGenerateRequest,
)
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
    GeminiStrategyClient,
)
from agent.app.services.strategy.image_loader import load_reference_images_for_gemini
from agent.app.services.strategy.quality_validator import StrategyQualityValidator
from agent.app.services.strategy.strategy_service import MarketingStrategyService
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_missing_price_product,
    make_valid_strategy_dict,
)


def _make_mock_genai_response(strategy_dict: dict, model_version: str = "gemini-2.5-flash-001"):
    return SimpleNamespace(
        text=json.dumps(strategy_dict),
        parsed=None,
        model_version=model_version,
        response_id="resp_test_123",
        usage_metadata=SimpleNamespace(
            prompt_token_count=450,
            candidates_token_count=620,
            total_token_count=1070,
        ),
    )


def _make_mock_genai_client(side_effects):
    mock_generate = AsyncMock(side_effect=side_effects)
    return SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(
                generate_content=mock_generate
            )
        )
    ), mock_generate


# ---------------------------------------------------------------------------
# 1. Gemini Client Configuration, Telemetry & No Silent Fallback Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gemini_client_fails_explicitly_without_api_key():
    client = GeminiStrategyClient(api_key="", model_name="gemini-2.5-flash")
    with pytest.raises(GeminiConfigurationError) as exc:
        await client.generate_strategy("Analyze product")
    assert "GEMINI_API_KEY" in str(exc.value)


@pytest.mark.asyncio
async def test_gemini_client_never_silently_falls_back_on_model_error():
    """
    If configured model returns 404 (not found) or 400/403, client MUST fail immediately
    with GeminiExecutionError referencing that exact model_name and never switch models.
    """
    api_err = genai_errors.ClientError(404, {"error": {"message": "Model not found"}})
    fake_sdk, mock_call = _make_mock_genai_client([api_err])

    client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-nonexistent-9.9",
        max_retries=2,
        genai_client=fake_sdk,
    )

    with pytest.raises(GeminiExecutionError) as exc:
        await client.generate_strategy("Analyze product")

    assert exc.value.model_name == "gemini-nonexistent-9.9"
    assert exc.value.status_code == 404
    # Must NOT retry non-transient 404 or call another model
    assert mock_call.await_count == 1
    assert mock_call.call_args.kwargs["model"] == "gemini-nonexistent-9.9"


@pytest.mark.asyncio
async def test_gemini_client_retries_transient_error_and_records_metadata():
    transient_err = genai_errors.ServerError(503, {"error": {"message": "Service temporarily unavailable"}})
    valid_resp = _make_mock_genai_response(make_valid_strategy_dict())
    fake_sdk, mock_call = _make_mock_genai_client([transient_err, valid_resp])

    client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        max_retries=2,
        genai_client=fake_sdk,
    )

    with patch("agent.app.services.strategy.gemini_client.asyncio.sleep", new_callable=AsyncMock):
        strategy, meta = await client.generate_strategy("Analyze product")

    assert isinstance(strategy, MarketingStrategy)
    assert mock_call.await_count == 2
    assert meta.model_name == "gemini-2.5-flash"
    assert meta.model_version == "gemini-2.5-flash-001"
    assert meta.attempts == 2
    assert meta.prompt_tokens == 450
    assert meta.candidates_tokens == 620
    assert meta.total_tokens == 1070
    assert meta.latency_ms >= 0


@pytest.mark.asyncio
async def test_gemini_client_rejects_invalid_json_after_retries():
    bad_resp = SimpleNamespace(text="{invalid json", parsed=None)
    fake_sdk, mock_call = _make_mock_genai_client([bad_resp, bad_resp])

    client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        max_retries=1,
        genai_client=fake_sdk,
    )

    with patch("agent.app.services.strategy.gemini_client.asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(GeminiExecutionError):
            await client.generate_strategy("Analyze product")

    assert mock_call.await_count == 2


# ---------------------------------------------------------------------------
# 2. Local Strategy Quality Validator Tests
# ---------------------------------------------------------------------------


def test_quality_validator_accepts_grounded_strategy():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    result = StrategyQualityValidator.validate(
        strategy=strategy,
        product=product,
        user_prompt="Create a premium Instagram ad targeting young professionals.",
        requested_placements=["instagram_feed", "instagram_reels"],
    )
    assert result.passed is True
    assert result.score == 1.0
    assert result.issues == []


def test_quality_validator_flags_repeated_angles_and_hooks():
    product = make_lifelong_mixer_product()
    data = make_valid_strategy_dict()
    # Duplicate angle 2 into angle 3
    data["marketing_angles"][2]["angle_name"] = data["marketing_angles"][1]["angle_name"]
    data["marketing_angles"][2]["hooks"] = list(data["marketing_angles"][1]["hooks"])

    strategy = MarketingStrategy.model_validate(data)
    result = StrategyQualityValidator.validate(
        strategy=strategy,
        product=product,
        user_prompt="Create Instagram ads.",
        requested_placements=["instagram_feed"],
    )

    assert result.passed is False
    codes = {i.code for i in result.issues}
    assert "REPEATED_ANGLES" in codes


def test_quality_validator_flags_generic_and_fabricated_stat_personas():
    product = make_lifelong_mixer_product()
    data = make_valid_strategy_dict()
    data["personas"][0]["persona_name"] = "General Consumers"
    data["personas"][1]["segment_context"] = "78% of millennials earn ₹80000 per month and cook daily."

    strategy = MarketingStrategy.model_validate(data)
    result = StrategyQualityValidator.validate(
        strategy=strategy,
        product=product,
        user_prompt="Create Instagram ads.",
        requested_placements=["instagram_feed"],
    )

    assert result.passed is False
    generic_issues = [i for i in result.issues if i.code == "GENERIC_PERSONA"]
    assert len(generic_issues) >= 2


def test_quality_validator_flags_fabricated_price_when_price_missing():
    product = make_missing_price_product()
    data = make_valid_strategy_dict()
    # Clean wattage/warranty so price hallucination is isolated
    data["marketing_angles"][0]["recommended_messaging"] = "Get this 2000W blender today for just ₹999!"
    data["marketing_angles"][0]["hooks"] = ["Heavy duty blending for cafes.", "Upgrade your kitchen prep."]
    data["marketing_angles"][1]["recommended_messaging"] = "Commercial 2000W capacity built for cafes."
    data["marketing_angles"][1]["hooks"] = ["Built for steady daily output.", "Large 2.5L jar capacity."]
    data["marketing_angles"][2]["recommended_messaging"] = "Designed for smooth large-batch blending."
    data["marketing_angles"][2]["hooks"] = ["Smooth results in every batch.", "Reliable 2000W performance."]
    data["product_knowledge"]["supported_claims"] = ["2000W motor"]

    strategy = MarketingStrategy.model_validate(data)
    result = StrategyQualityValidator.validate(
        strategy=strategy,
        product=product,
        user_prompt="Create a bold cafe owner ad.",
        requested_placements=["instagram_feed"],
    )

    assert result.passed is False
    assert any(
        i.code == "CONTRADICTORY_PRODUCT_INFO" and "price is missing" in i.message
        for i in result.issues
    )


def test_quality_validator_flags_contradictory_specs_and_unflagged_prompt_claims():
    product = make_lifelong_mixer_product()
    prompt = "Create an energetic ad claiming cordless battery use, 1000W motor, and 50% off."

    # Case A: Model obediently obeys user prompt instead of ProductData and leaves claim unflagged
    bad_data = make_valid_strategy_dict(include_cordless_audit=False)
    bad_data["marketing_angles"][0]["recommended_messaging"] = (
        "Enjoy total freedom with our cordless 1000W mixer at 50% off!"
    )

    strategy_bad = MarketingStrategy.model_validate(bad_data)
    res_bad = StrategyQualityValidator.validate(
        strategy=strategy_bad,
        product=product,
        user_prompt=prompt,
        requested_placements=["instagram_reels"],
    )
    assert res_bad.passed is False
    codes = {i.code for i in res_bad.issues}
    assert "CONTRADICTORY_PRODUCT_INFO" in codes
    assert "UNSUPPORTED_CLAIM" in codes

    # Case B: Model flags unsupported prompt claims properly and keeps ad copy factual
    good_data = make_valid_strategy_dict(include_cordless_audit=True)
    good_data["claim_validations"].append({
        "claim_text": "50% off discount",
        "source": "user_prompt",
        "status": "contradictory",
        "supporting_evidence": None,
        "reason": "Actual product discount is 40.0% off MRP (INR 1499 vs INR 2499), not 50% off.",
        "safe_alternative": "Save 40% off MRP at ₹1,499",
    })
    strategy_good = MarketingStrategy.model_validate(good_data)
    res_good = StrategyQualityValidator.validate(
        strategy=strategy_good,
        product=product,
        user_prompt=prompt,
        requested_placements=["instagram_reels"],
    )
    assert res_good.passed is True


# ---------------------------------------------------------------------------
# 3. Controlled Regeneration Loop Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strategy_service_controlled_regeneration_succeeds():
    """
    Round 1 returns repeated angles -> Validator catches REPEATED_ANGLES ->
    Service triggers controlled regeneration passing defect details -> Round 2 succeeds.
    """
    bad_dict = make_valid_strategy_dict()
    bad_dict["marketing_angles"][1]["angle_name"] = bad_dict["marketing_angles"][0]["angle_name"]
    good_dict = make_valid_strategy_dict()

    fake_sdk, mock_call = _make_mock_genai_client([
        _make_mock_genai_response(bad_dict),
        _make_mock_genai_response(good_dict),
    ])

    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=fake_sdk,
    )
    service = MarketingStrategyService(gemini_client=gemini_client, max_regenerations=2)

    req = StrategyGenerateRequest(
        product_data=make_lifelong_mixer_product(),
        user_prompt="Create a clean Instagram campaign for young home cooks.",
        formats=["image", "video"],
        placements=["instagram_feed", "instagram_reels"],
        fetch_images=False,
    )

    result = await service.generate_marketing_strategy(req)

    assert result.success is True
    assert result.strategy is not None
    assert result.quality_validation.passed is True
    assert result.generation_metadata.regenerations == 1
    assert result.generation_metadata.attempts == 2
    assert result.generation_metadata.total_tokens == 2140  # 1070 * 2
    # Confirm second prompt contained quality feedback notice
    second_call_prompt = mock_call.call_args_list[1].kwargs["contents"][0]
    assert "CRITICAL QUALITY REGENERATION NOTICE" in second_call_prompt
    assert "REPEATED_ANGLES" in second_call_prompt


@pytest.mark.asyncio
async def test_strategy_service_returns_clear_failure_when_regenerations_exhausted():
    bad_dict = make_valid_strategy_dict()
    bad_dict["personas"][0]["persona_name"] = "Everyone"

    fake_sdk, mock_call = _make_mock_genai_client([
        _make_mock_genai_response(bad_dict),
        _make_mock_genai_response(bad_dict),
    ])

    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=fake_sdk,
    )
    service = MarketingStrategyService(gemini_client=gemini_client, max_regenerations=1)

    req = StrategyGenerateRequest(
        product_data=make_lifelong_mixer_product(),
        user_prompt="Create an Instagram ad.",
        formats=["image"],
        placements=["instagram_feed"],
        fetch_images=False,
    )

    result = await service.generate_marketing_strategy(req)

    assert result.success is False
    assert result.strategy is None
    assert result.quality_validation.passed is False
    assert result.generation_metadata.regenerations == 1
    assert "failed quality validation" in result.error.lower()
    assert mock_call.await_count == 2


# ---------------------------------------------------------------------------
# 4. Safe Multimodal Image Loader Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_image_loader_skips_ssrf_and_loads_valid_image():
    product = make_lifelong_mixer_product()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"Content-Type": "image/jpeg"}
    mock_resp.content = b"\xff\xd8\xff\xe0fakejpegbytes"

    with patch("agent.app.services.strategy.image_loader.validate_safe_url") as mock_ssrf, \
         patch("agent.app.services.strategy.image_loader.httpx.AsyncClient") as mock_http:
        # 1st URL blocked by SSRF, 2nd URL safe
        mock_ssrf.side_effect = [
            (False, None, "Direct connection to private IP forbidden"),
            (True, "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer2.jpg", None),
        ]
        mock_client_inst = AsyncMock()
        mock_client_inst.get.return_value = mock_resp
        mock_http.return_value.__aenter__.return_value = mock_client_inst

        parts, warnings = await load_reference_images_for_gemini(
            product_data=product,
            override_urls=[
                "http://127.0.0.1/secret.jpg",
                "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer2.jpg",
            ],
        )

    assert len(parts) == 1
    assert len(warnings) == 1
    assert "unsafe reference image" in warnings[0].lower()


@pytest.mark.asyncio
async def test_gemini_client_transient_503_failover_with_explicit_fallback_models():
    """When explicit fallback_models are configured, a transient 503 spike fails over cleanly and records serving model."""
    transient_err = genai_errors.ServerError(503, {"error": {"message": "This model is currently experiencing high demand."}})
    valid_resp = _make_mock_genai_response(make_valid_strategy_dict(), model_version="gemini-3.1-flash-lite-001")
    fake_sdk, mock_call = _make_mock_genai_client([transient_err, transient_err, valid_resp])

    client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-3.8-flash",
        fallback_models=["gemini-3.1-flash-lite"],
        max_retries=1,
        genai_client=fake_sdk,
    )

    with patch("agent.app.services.strategy.gemini_client.asyncio.sleep", new_callable=AsyncMock):
        strategy, meta = await client.generate_strategy("Analyze product")

    assert isinstance(strategy, MarketingStrategy)
    assert mock_call.await_count == 3
    assert meta.model_name == "gemini-3.1-flash-lite"


@pytest.mark.asyncio
async def test_gemini_client_404_never_uses_fallback_models():
    """Even when fallback_models are configured, non-transient 404/400 MUST abort immediately without falling back."""
    err_404 = genai_errors.ClientError(404, {"error": {"message": "Model not found"}})
    fake_sdk, mock_call = _make_mock_genai_client([err_404])

    client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-retired-model",
        fallback_models=["gemini-3.6-flash"],
        max_retries=2,
        genai_client=fake_sdk,
    )

    with pytest.raises(GeminiExecutionError) as exc:
        await client.generate_strategy("Analyze product")

    assert exc.value.model_name == "gemini-retired-model"
    assert exc.value.status_code == 404
    assert mock_call.await_count == 1


