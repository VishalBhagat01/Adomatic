"""
Comprehensive tests for Step 09 — Independent Creative Evaluation, Claim Validation,
Bounded Regeneration Orchestration, and Approved Ad Copy Generation.
"""

import base64
from types import SimpleNamespace
from typing import Any, List, Optional, Tuple
from unittest.mock import AsyncMock
import pytest

from agent.app.schemas.evaluation import (
    AdCopyDraft,
    AdCopyDraftItem,
    AdCopyGenerateRequest,
    CreativeEvaluationRequest,
    EvaluateAndRegenerateRequest,
    EvaluationCriterionKey,
    EvaluationWeights,
    MultimodalCriterionItem,
    MultimodalEvaluationDraft,
)
from agent.app.schemas.image_gen import (
    GeneratedImageAsset,
    GenerationCostRecord,
    ImageGenerationResponse,
    ImageValidationCheck,
    ImageValidationResult,
    StoredGenerationMetadata,
)
from agent.app.schemas.strategy import GenerationMetadata, MarketingStrategy
from agent.app.services.evaluation.ad_copy_service import (
    AdCopyPreconditionError,
    AdCopyService,
)
from agent.app.services.evaluation.claim_validator import ClaimValidator
from agent.app.services.evaluation.evaluator_service import (
    CRITERIA_ORDER,
    CreativeEvaluationService,
)
from agent.app.services.evaluation.regeneration_service import EvaluationRegenerationService
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
from agent.tests.fixtures.video_fixtures import (
    make_real_mp4_bytes,
    make_sample_video_storyboard,
)


def _make_multimodal_draft(
    *,
    score_each: float = 90.0,
    overrides: Optional[dict[EvaluationCriterionKey, float]] = None,
    observed_text: Optional[List[str]] = None,
    hard_codes: Optional[List[str]] = None,
    hard_reasons: Optional[List[str]] = None,
) -> MultimodalEvaluationDraft:
    overrides = overrides or {}
    items = [
        MultimodalCriterionItem(
            criterion=crit,
            score=overrides.get(crit, score_each),
            reasoning=f"Measured criterion {crit} cleanly against reference photos.",
        )
        for crit in CRITERIA_ORDER
    ]
    return MultimodalEvaluationDraft(
        criterion_scores=items,
        observed_visual_summary="White and grey Lifelong mixer grinder with stainless steel jar on countertop.",
        observed_visible_text=observed_text or [],
        observed_product_details="3-speed rotary knob and printed front Lifelong logo cleanly rendered.",
        hard_violation_codes=hard_codes or [],  # type: ignore[arg-type]
        hard_violation_reasons=hard_reasons or [],
        regeneration_hints=["Keep front Lifelong logo sharp and preserve exact INR 1499 pricing."]
        if hard_codes
        else [],
    )


def _make_ad_copy_draft(
    *,
    primary_overrides: Optional[List[str]] = None,
    headline_overrides: Optional[List[str]] = None,
    description_overrides: Optional[List[str]] = None,
) -> AdCopyDraft:
    primaries = primary_overrides or [
        "Upgrade daily chutney and spice prep with the Lifelong LLM99 500W Mixer Grinder and 3 stainless steel jars.",
        "Compact countertop power at INR 1,499: 3-speed rotary control with pulse mode and 1 Year Brand Warranty.",
        "Built for Indian cooking with 0.35L Chutney, 0.8L Dry, and 1.25L Liquidizing stainless steel jars.",
    ]
    headlines = headline_overrides or [
        "Lifelong LLM99 500W Mixer",
        "3 Steel Jars | INR 1,499",
        "500W Daily Kitchen Partner",
    ]
    descriptions = description_overrides or [
        "Includes 1 Year Lifelong Domestic Warranty and anti-skid feet.",
        "Save 40% off INR 2,499 MRP — rated 4.3/5 across 156 reviews.",
    ]
    return AdCopyDraft(
        primary_texts=[
            AdCopyDraftItem(
                text=t,
                linked_product_facts=["500W motor", "3 stainless steel jars", "1 Year Warranty"],
                visual_alignment_note="Matches countertop hero shot showing white body and stainless jar.",
            )
            for t in primaries
        ],
        headlines=[
            AdCopyDraftItem(
                text=t,
                linked_product_facts=["500W Wattage", "INR 1499"],
                visual_alignment_note="Clean headline aligned with studio framing.",
            )
            for t in headlines
        ],
        descriptions=[
            AdCopyDraftItem(
                text=t,
                linked_product_facts=["1 Year Domestic Warranty", "rating 4.3"],
                visual_alignment_note="Complements visual without clutter.",
            )
            for t in descriptions
        ],
        cta_recommendation="Shop Now",
        creative_angle="Compact Daily 3-Jar Versatility",
        audience_hypothesis="Busy urban home cooks furnishing compact apartment kitchens",
    )


class FakeGeminiEvalClient:
    """Deterministic fake GeminiStrategyClient returning queued drafts sequentially."""

    def __init__(self, responses: List[Any]):
        self.responses = list(responses)
        self.calls: List[dict[str, Any]] = []
        self.model_name = "gemini-2.5-flash"

    async def generate_structured(
        self,
        *,
        prompt_text: str,
        response_schema: Any,
        system_instruction: str,
        image_parts: Any = None,
        temperature: float = 0.2,
    ):
        self.calls.append(
            {
                "prompt_text": prompt_text,
                "schema": response_schema.__name__,
                "image_part_count": len(image_parts) if image_parts else 0,
                "temperature": temperature,
            }
        )
        draft = self.responses.pop(0)
        meta = GenerationMetadata(
            model_name=self.model_name,
            prompt_tokens=320,
            output_tokens=180,
            total_tokens=500,
            latency_ms=42.0,
        )
        return draft, meta


def _build_offline_ref_selector(product) -> ReferenceImageSelector:
    url_map = {
        img.url: (200, "image/jpeg", make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=idx))
        for idx, img in enumerate(product.images)
    }
    return ReferenceImageSelector(
        client_factory=make_mock_image_http_factory(url_map),
        resolve_dns=False,
    )


# ---------------------------------------------------------------------------
# 1. ClaimValidator Unit Tests
# ---------------------------------------------------------------------------


def test_claim_validator_rejects_all_unsupported_categories():
    validator = ClaimValidator()
    product = make_lifelong_mixer_product()

    bad_texts = {
        "UNSUPPORTED_HEALTH_CLAIM": "Doctors recommend this mixer to boost immunity and weight loss!",
        "UNSUPPORTED_PERFORMANCE_GUARANTEE": "Unbreakable blender with a 100% guaranteed motor that runs forever.",
        "INCORRECT_PROMOTIONAL_PRICE": "Limited deal: take this mixer home for just INR 699 today!",
        "UNSUPPORTED_TESTIMONIAL_OR_REVIEW": "Rated 4.9/5 stars by over 25,000 happy customers!",
        "UNSUPPORTED_CERTIFICATION": "Now FDA approved and ISO 9001 certified appliance.",
        "UNSUPPORTED_COMPARATIVE_CLAIM": "The #1 best-in-class grinder — beats every competitor!",
        "FABRICATED_PRODUCT_SPECIFICATION": "Cordless rechargeable 1000W blender with 5 Year Warranty.",
    }

    for expected_code, sentence in bad_texts.items():
        issues = validator.audit_text(sentence, product)
        codes = {i.code for i in issues}
        assert expected_code in codes, f"Expected {expected_code} for text '{sentence}', got {codes}"


def test_claim_validator_rejects_fabricated_price_when_missing_and_links_valid_claims():
    validator = ClaimValidator()
    no_price_product = make_missing_price_product()
    issues = validator.audit_text("Order today for just Rs 1999!", no_price_product)
    assert any(i.code == "MISSING_PRICE_FABRICATION" for i in issues)

    product = make_lifelong_mixer_product()
    clean_copy = (
        "Lifelong LLM99 500 Watts Mixer Grinder with 3 Stainless Steel Jars "
        "for INR 1499 (40% off), rated 4.3 stars."
    )
    assert validator.audit_text(clean_copy, product) == []

    links = validator.link_claims_to_product(clean_copy, product)
    linked_fields = {lnk.verified_source_field for lnk in links}
    assert "price" in linked_fields
    assert "discount" in linked_fields
    assert "rating" in linked_fields
    assert "specifications.Wattage" in linked_fields


# ---------------------------------------------------------------------------
# 2. Independent CreativeEvaluationService Tests (Image & Video)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_independent_image_evaluation_approves_compliant_asset_without_regeneration():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint(aspect_ratio="4:5", placement="instagram_feed")
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)

    fake_s3 = FakeS3Client()
    storage = AgentStorage(s3_client=fake_s3)
    gemini = FakeGeminiEvalClient([_make_multimodal_draft(score_each=88.0)])

    service = CreativeEvaluationService(
        gemini_client=gemini,  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=storage,
    )

    result = await service.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="camp_09_ok",
            creative_id="cr_img_ok",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
        )
    )

    assert result.approved is True
    assert result.decision == "approved"
    assert result.overall_weighted_score == pytest.approx(88.0, abs=0.2)
    assert len(result.criteria_scores) == 10
    assert result.hard_rejection_triggered is False
    assert result.regeneration_instruction is None
    assert len(gemini.calls) == 1
    assert ("adpilot-creatives", result.storage_object_key) in fake_s3.objects


@pytest.mark.asyncio
async def test_hard_constraint_rejects_even_when_weighted_average_exceeds_threshold():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint(aspect_ratio="4:5", placement="instagram_feed")
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)

    # Very high scores across criteria (avg ~89 > threshold 75), PLUS hard violation flag!
    draft = _make_multimodal_draft(
        score_each=95.0,
        hard_codes=["INCORRECT_PRODUCT_LOGO"],
        hard_reasons=["Brand logo misspelled as 'LifeLonger' on motor base."],
    )
    service = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient([draft]),  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )

    result = await service.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="camp_hard_gate",
            creative_id="cr_bad_logo",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
            approval_threshold=75.0,
        )
    )

    # Overall weighted score > 75, yet hard constraint MUST still reject!
    assert result.overall_weighted_score >= 75.0
    assert result.hard_rejection_triggered is True
    assert result.approved is False
    assert result.decision == "rejected_hard_rule"
    assert result.regeneration_instruction is not None
    assert any("INCORRECT_PRODUCT_LOGO" in item for item in result.regeneration_instruction.issues_addressed)


@pytest.mark.asyncio
async def test_observed_visible_text_wrong_price_triggers_claim_validator_hard_rejection():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint(aspect_ratio="4:5", placement="instagram_feed")
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=2)

    # Gemini didn't list any hard_violation_codes, ONLY transcribed overlaid promotional price!
    draft = _make_multimodal_draft(
        score_each=94.0,
        observed_text=["Flash Deal INR 699 Only!"],
    )
    service = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient([draft]),  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )

    result = await service.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="camp_ocr_price",
            creative_id="cr_bad_price",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
        )
    )

    assert result.approved is False
    assert result.decision == "rejected_hard_rule"
    assert any(i.code == "INCORRECT_PROMOTIONAL_PRICE" for i in result.issues)


@pytest.mark.asyncio
async def test_corrupt_image_bytes_rejected_deterministically_without_calling_llm():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint(aspect_ratio="4:5", placement="instagram_feed")
    gemini = FakeGeminiEvalClient([_make_multimodal_draft()])

    service = CreativeEvaluationService(
        gemini_client=gemini,  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )

    result = await service.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="camp_corrupt",
            creative_id="cr_corrupt",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(b"not-a-valid-png-or-jpeg-payload" * 50).decode("ascii"),
        )
    )

    assert result.approved is False
    assert result.decision == "rejected_hard_rule"
    assert any(i.code == "CORRUPT_ASSET" for i in result.issues)
    assert len(gemini.calls) == 0


@pytest.mark.asyncio
async def test_independent_video_evaluation_extracts_keyframes_and_validates_black_frames():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    storyboard = make_sample_video_storyboard(total_duration=9, aspect_ratio="9:16", placement="instagram_reels")

    good_mp4 = make_real_mp4_bytes(720, 1280, duration_seconds=9.0, fps=24, with_audio=True)
    bad_mp4 = make_real_mp4_bytes(720, 1280, duration_seconds=9.0, fps=24, with_audio=True, black_frames=True)

    gemini_ok = FakeGeminiEvalClient([_make_multimodal_draft(score_each=86.0)])
    service_ok = CreativeEvaluationService(
        gemini_client=gemini_ok,  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    res_ok = await service_ok.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="camp_vid_eval",
            creative_id="cr_vid_ok",
            format="video",
            product_data=product,
            marketing_strategy=strategy,
            video_storyboard=storyboard,
            creative_base64=base64.b64encode(good_mp4).decode("ascii"),
        )
    )
    assert res_ok.approved is True
    assert res_ok.deterministic_video_validation is not None
    assert res_ok.deterministic_video_validation.duration_seconds == pytest.approx(9.0, abs=0.5)
    # 2 references + 3 sampled video keyframes sent to Gemini multimodal inspector
    assert gemini_ok.calls[0]["image_part_count"] >= 5

    service_bad = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient([_make_multimodal_draft(score_each=92.0)]),  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    res_bad = await service_bad.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="camp_vid_black",
            creative_id="cr_vid_black",
            format="video",
            product_data=product,
            marketing_strategy=strategy,
            video_storyboard=storyboard,
            creative_base64=base64.b64encode(bad_mp4).decode("ascii"),
        )
    )
    assert res_bad.approved is False
    assert any(i.code == "VISUAL_QUALITY_BLANK" for i in res_bad.issues)


# ---------------------------------------------------------------------------
# 3. AdCopyService Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ad_copy_refuses_unapproved_creative_and_validates_approved_copy():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint()
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)

    eval_service = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient(
            [
                _make_multimodal_draft(
                    score_each=90.0,
                    hard_codes=["MATERIALLY_ALTERED_PRODUCT"],
                    hard_reasons=["Extra buttons invented"],
                ),
                _make_multimodal_draft(score_each=89.0),
            ]
        ),  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )

    rejected_eval = await eval_service.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="c1",
            creative_id="bad_cr",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
        )
    )
    approved_eval = await eval_service.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="c1",
            creative_id="ok_cr",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
        )
    )

    copy_service = AdCopyService(
        gemini_client=FakeGeminiEvalClient([_make_ad_copy_draft()]),  # type: ignore[arg-type]
        storage=AgentStorage(s3_client=FakeS3Client()),
    )

    with pytest.raises(AdCopyPreconditionError):
        await copy_service.generate_copy(
            AdCopyGenerateRequest(
                campaign_id="c1",
                creative_id="bad_cr",
                creative_evaluation=rejected_eval,
                product_data=product,
                marketing_strategy=strategy,
                image_blueprint=blueprint,
            )
        )

    valid_copy = await copy_service.generate_copy(
        AdCopyGenerateRequest(
            campaign_id="c1",
            creative_id="ok_cr",
            creative_evaluation=approved_eval,
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
        )
    )

    assert valid_copy.approved is True
    assert len(valid_copy.primary_texts) == 3
    assert len(valid_copy.headlines) == 3
    assert len(valid_copy.descriptions) == 2
    assert valid_copy.cta_recommendation == "Shop Now"
    assert valid_copy.rejected_claim_flags == []
    assert any(len(v.linked_claims) > 0 for v in valid_copy.primary_texts)


@pytest.mark.asyncio
async def test_ad_copy_retries_and_rejects_persistent_unverified_claims():
    no_price_product = make_missing_price_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint()
    cand_bytes = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=0)

    eval_service = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient([_make_multimodal_draft(score_each=87.0)]),  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(no_price_product),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    approved_eval = await eval_service.evaluate_creative(
        CreativeEvaluationRequest(
            campaign_id="c_np",
            creative_id="cr_np",
            format="image",
            product_data=no_price_product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(cand_bytes).decode("ascii"),
        )
    )

    bad_draft = _make_ad_copy_draft(
        primary_overrides=[
            "Grab this 2000W Commercial Blender for INR 2999 today!",
            "FDA approved commercial blending machine that cures fatigue.",
            "Trusted by 50,000+ happy customers nationwide!",
        ]
    )
    gemini_copy = FakeGeminiEvalClient([bad_draft, bad_draft])
    copy_service = AdCopyService(
        gemini_client=gemini_copy,  # type: ignore[arg-type]
        storage=AgentStorage(s3_client=FakeS3Client()),
    )

    result = await copy_service.generate_copy(
        AdCopyGenerateRequest(
            campaign_id="c_np",
            creative_id="cr_np",
            creative_evaluation=approved_eval,
            product_data=no_price_product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
        )
    )

    assert len(gemini_copy.calls) == 2
    assert result.approved is False
    codes = {flag.code for flag in result.rejected_claim_flags}
    assert "MISSING_PRICE_FABRICATION" in codes
    assert "UNSUPPORTED_HEALTH_CLAIM" in codes
    assert "UNSUPPORTED_CERTIFICATION" in codes
    assert "UNSUPPORTED_TESTIMONIAL_OR_REVIEW" in codes


# ---------------------------------------------------------------------------
# 4. Bounded EvaluationRegenerationService Orchestration Tests
# ---------------------------------------------------------------------------


def _fake_generated_image_response(campaign_id: str, object_key: str, creative_id: str, cost: float = 0.04) -> ImageGenerationResponse:
    return ImageGenerationResponse(
        success=True,
        campaign_id=campaign_id,
        concept_id="concept_studio_hero_01",
        aspect_ratio="4:5",
        model_identifier="gemini-2.5-flash-image",
        prompt_version="step07_v1",
        requested_variations=1,
        approved_count=1,
        rejected_count=0,
        assets=[
            GeneratedImageAsset(
                creative_id=creative_id,
                variation_index=1,
                approved=True,
                mime_type="image/png",
                width=896,
                height=1120,
                aspect_ratio="4:5",
                object_key=object_key,
                metadata_object_key=f"{object_key}.meta.json",
                prompt_used="repaired prompt",
                negative_prompt_used="no wrong logo",
                cost=GenerationCostRecord(
                    model_identifier="gemini-2.5-flash-image",
                    pricing_basis="per_image",
                    estimated_cost_usd=cost,
                ),
                validation=ImageValidationResult(approved=True, width=896, height=1120, actual_aspect_ratio="4:5"),
                metadata=StoredGenerationMetadata(
                    creative_id=creative_id,
                    campaign_id=campaign_id,
                    concept_id="concept_studio_hero_01",
                    variation_index=1,
                    image_object_key=object_key,
                    metadata_object_key=f"{object_key}.meta.json",
                    bucket="adpilot-creatives",
                    stored=True,
                    model_identifier="gemini-2.5-flash-image",
                    prompt_version="step07_v1",
                    generation_cost=GenerationCostRecord(
                        model_identifier="gemini-2.5-flash-image",
                        pricing_basis="per_image",
                        estimated_cost_usd=cost,
                    ),
                    validation_results=ImageValidationResult(approved=True),
                ),
            )
        ],
        total_estimated_cost_usd=cost,
    )


@pytest.mark.asyncio
async def test_controlled_regeneration_repairs_prompt_preserves_versions_and_generates_copy():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint()
    orig_prompt = blueprint.image_generation_prompt.positive_prompt

    img_bad = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)
    img_good = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=2)

    fake_s3 = FakeS3Client()
    storage = AgentStorage(s3_client=fake_s3)
    regen_key = "campaigns/camp_regen/concept_studio_hero_01/regenerated_v2.png"
    storage.upload_bytes(bucket="adpilot-creatives", object_key=regen_key, data=img_good, content_type="image/png")

    eval_gemini = FakeGeminiEvalClient(
        [
            _make_multimodal_draft(
                score_each=90.0,
                hard_codes=["INCORRECT_PRODUCT_LOGO"],
                hard_reasons=["Printed wordmark missing on front body."],
            ),
            _make_multimodal_draft(score_each=91.0),
        ]
    )
    evaluator = CreativeEvaluationService(
        gemini_client=eval_gemini,  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=storage,
    )
    copy_svc = AdCopyService(
        gemini_client=FakeGeminiEvalClient([_make_ad_copy_draft()]),  # type: ignore[arg-type]
        storage=storage,
    )

    captured_gen_requests: List[Any] = []

    async def fake_generate_creatives(req):
        captured_gen_requests.append(req)
        return _fake_generated_image_response("camp_regen", regen_key, "cr_v2", cost=0.04)

    mock_img_service = SimpleNamespace(
        generate_creatives=AsyncMock(side_effect=fake_generate_creatives),
        storage=storage,
    )

    orchestrator = EvaluationRegenerationService(
        evaluator_service=evaluator,
        copy_service=copy_svc,
        image_service=mock_img_service,  # type: ignore[arg-type]
        storage=storage,
    )

    resp = await orchestrator.evaluate_and_regenerate(
        EvaluateAndRegenerateRequest(
            campaign_id="camp_regen",
            creative_id="cr_v1",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(img_bad).decode("ascii"),
            max_regenerations=2,
            generate_ad_copy_on_approval=True,
        )
    )

    # Caller's original blueprint remains unmutated, while regeneration received repaired prompt
    assert blueprint.image_generation_prompt.positive_prompt == orig_prompt
    assert len(captured_gen_requests) == 1
    assert "CRITICAL FIXES REQUIRED" in captured_gen_requests[0].blueprint.image_generation_prompt.positive_prompt

    # Both rejected attempt 1 and approved attempt 2 are preserved along with cost
    assert resp.success is True
    assert resp.total_attempts == 2
    assert resp.regenerations_performed == 1
    assert resp.total_generation_cost_usd == pytest.approx(0.04, abs=1e-6)
    assert resp.attempt_history[0].creative_id == "cr_v1"
    assert resp.attempt_history[0].evaluation.approved is False
    assert resp.attempt_history[1].creative_id == "cr_v2"
    assert resp.attempt_history[1].evaluation.approved is True
    assert resp.final_creative_id == "cr_v2"
    assert resp.validated_ad_copy is not None
    assert resp.validated_ad_copy.approved is True


@pytest.mark.asyncio
async def test_regeneration_halts_at_max_regenerations_to_prevent_infinite_loop():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    blueprint = make_sample_image_blueprint()
    img_bad = make_synthetic_product_image_bytes(width=896, height=1120, variant_seed=1)

    fake_s3 = FakeS3Client()
    storage = AgentStorage(s3_client=fake_s3)
    for idx in (2, 3):
        storage.upload_bytes(
            bucket="adpilot-creatives",
            object_key=f"campaigns/camp_cap/attempt_{idx}.png",
            data=img_bad,
            content_type="image/png",
        )

    always_fail_drafts = [
        _make_multimodal_draft(
            score_each=60.0,
            hard_codes=["MATERIALLY_ALTERED_PRODUCT"],
            hard_reasons=["Still wrong dial shape"],
        )
        for _ in range(3)
    ]
    evaluator = CreativeEvaluationService(
        gemini_client=FakeGeminiEvalClient(always_fail_drafts),  # type: ignore[arg-type]
        reference_selector=_build_offline_ref_selector(product),
        storage=storage,
    )

    attempt_counter = {"n": 1}

    async def fake_generate_creatives(req):
        attempt_counter["n"] += 1
        n = attempt_counter["n"]
        return _fake_generated_image_response(
            "camp_cap", f"campaigns/camp_cap/attempt_{n}.png", f"cr_v{n}", cost=0.04
        )

    orchestrator = EvaluationRegenerationService(
        evaluator_service=evaluator,
        image_service=SimpleNamespace(
            generate_creatives=AsyncMock(side_effect=fake_generate_creatives),
            storage=storage,
        ),  # type: ignore[arg-type]
        storage=storage,
    )

    resp = await orchestrator.evaluate_and_regenerate(
        EvaluateAndRegenerateRequest(
            campaign_id="camp_cap",
            creative_id="cr_v1",
            format="image",
            product_data=product,
            marketing_strategy=strategy,
            image_blueprint=blueprint,
            creative_base64=base64.b64encode(img_bad).decode("ascii"),
            max_regenerations=2,
            generate_ad_copy_on_approval=True,
        )
    )

    assert resp.success is False
    assert resp.regenerations_performed == 2
    assert resp.total_attempts == 3
    assert resp.total_generation_cost_usd == pytest.approx(0.08, abs=1e-6)
    assert resp.final_evaluation.approved is False
    assert resp.validated_ad_copy is None
    assert any("remained rejected" in w for w in resp.warnings)
