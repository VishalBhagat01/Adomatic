"""
Unit and workflow tests for Step 06: Creative Planning, Prompt Optimization Templates,
Reference Constraints, Placement Specs, Validation Rules, and Controlled Regeneration.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest

from agent.app.schemas.creative import (
    CreativePlanDraft,
    CreativePlanRequest,
    ImageConceptDraft,
)
from agent.app.schemas.strategy import MarketingStrategy
from agent.app.services.creative.placements import resolve_placement_spec
from agent.app.services.creative.planning_service import CreativePlanningService
from agent.app.services.creative.prompt_templates import (
    IMAGE_TEMPLATE_NAME,
    VIDEO_TEMPLATE_NAME,
    render_image_generation_prompt,
    render_video_generation_prompt,
)
from agent.app.services.creative.reference_constraints import build_reference_constraints
from agent.app.services.creative.validator import CreativePlanValidator
from agent.app.services.strategy.gemini_client import GeminiStrategyClient
from agent.tests.fixtures.creative_fixtures import make_valid_creative_draft_dict
from agent.tests.fixtures.strategy_fixtures import (
    make_lifelong_mixer_product,
    make_missing_price_product,
    make_valid_strategy_dict,
)


def _mock_sdk_with_drafts(draft_dicts):
    responses = [
        SimpleNamespace(
            text=json.dumps(d),
            parsed=None,
            model_version="gemini-2.5-flash-001",
            response_id=f"resp_c_{idx}",
            usage_metadata=SimpleNamespace(
                prompt_token_count=500,
                candidates_token_count=750,
                total_token_count=1250,
            ),
        )
        for idx, d in enumerate(draft_dicts)
    ]
    mock_generate = AsyncMock(side_effect=responses)
    return SimpleNamespace(
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=mock_generate))
    ), mock_generate


# ---------------------------------------------------------------------------
# 1. Placements & Reference Constraints Tests
# ---------------------------------------------------------------------------


def test_placement_specification_resolution():
    feed_img = resolve_placement_spec("instagram_feed", "image")
    assert feed_img.aspect_ratio == "4:5"
    assert feed_img.recommended_resolution == "1080x1350"

    reels_vid = resolve_placement_spec("instagram_reels", "video", requested_duration=20)
    assert reels_vid.aspect_ratio == "9:16"
    assert reels_vid.default_duration_seconds == 20

    yt_vid = resolve_placement_spec("youtube_instream", "video")
    assert yt_vid.aspect_ratio == "16:9"

    custom_vert = resolve_placement_spec("custom_stories_slot", "image")
    assert custom_vert.aspect_ratio == "9:16"


def test_reference_constraints_enforce_all_six_pillars_and_rejected_claims():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict(include_cordless_audit=True))

    constraints = build_reference_constraints(product, strategy)

    assert "silhouette" in constraints.preserve_geometry.lower()
    assert "Lifelong" in constraints.preserve_logo
    assert "rotary" in constraints.preserve_buttons_and_controls.lower()
    assert "White and Grey" in constraints.preserve_color_and_finish
    assert "3 Stainless Steel Jars" in constraints.preserve_dimensions_and_proportions
    assert len(constraints.recognizable_design_features) >= 3
    # Must explicitly block cordless/230V inventions AND rejected user prompt claims
    combined_prohibitions = " ".join(constraints.prohibited_inventions).lower()
    assert "cordless" in combined_prohibitions
    assert "1000w" in combined_prohibitions


def test_separate_image_and_video_prompt_templates():
    product = make_lifelong_mixer_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    constraints = build_reference_constraints(product, strategy)
    draft = CreativePlanDraft.model_validate(make_valid_creative_draft_dict(15))

    img_spec = resolve_placement_spec("instagram_feed", "image")
    vid_spec = resolve_placement_spec("instagram_reels", "video", 15)

    img_prompt = render_image_generation_prompt(draft.image_concepts[0], product, img_spec, constraints)
    vid_prompt = render_video_generation_prompt(draft.video_concepts[0], product, vid_spec, constraints)

    assert img_prompt.target_medium == "image"
    assert img_prompt.template_name == IMAGE_TEMPLATE_NAME
    assert img_prompt.aspect_ratio == "4:5"
    assert "Lifelong LLM99 Mixer Grinder 500W" in img_prompt.positive_prompt
    assert "REFERENCE PRESERVATION CONSTRAINTS" in img_prompt.positive_prompt

    assert vid_prompt.target_medium == "video"
    assert vid_prompt.template_name == VIDEO_TEMPLATE_NAME
    assert vid_prompt.aspect_ratio == "9:16"
    assert "Scene 1 (3s):" in vid_prompt.positive_prompt
    assert "REFERENCE CONSISTENCY ACROSS MOTION" in vid_prompt.positive_prompt


# ---------------------------------------------------------------------------
# 2. CreativePlanValidator Rules Tests
# ---------------------------------------------------------------------------


def _compile_fixture_plan(draft_dict: dict, product=None, strategy=None, duration: int = 15):
    product = product or make_lifelong_mixer_product()
    strategy = strategy or MarketingStrategy.model_validate(make_valid_strategy_dict(include_cordless_audit=True))
    req = CreativePlanRequest(
        product_data=product,
        strategy=strategy,
        user_prompt="Create premium Instagram Feed and Reels ads.",
        formats=["image", "video"],
        placements=["instagram_feed", "instagram_reels"],
        target_video_duration=duration,
    )
    constraints = build_reference_constraints(product, strategy)
    specs = CreativePlanningService._build_placement_specs(req)
    draft = CreativePlanDraft.model_validate(draft_dict)
    return CreativePlanningService._compile_plan(draft, req, constraints, specs), req


def test_validator_passes_valid_compiled_plan():
    plan, req = _compile_fixture_plan(make_valid_creative_draft_dict(15))
    val = CreativePlanValidator.validate(
        plan=plan,
        product=req.product_data,
        strategy=req.strategy,
        requested_formats=req.formats,
        requested_placements=req.placements,
        target_video_duration=req.target_video_duration,
    )
    assert val.passed is True
    assert val.score == 1.0
    assert val.issues == []


def test_validator_rejects_scene_duration_mismatch():
    bad_draft = make_valid_creative_draft_dict(15)
    # Tamper scene 1 duration so sum becomes 18 != 15
    bad_draft["video_concepts"][0]["scene_sequence"][0]["scene_duration"] = 6
    plan, req = _compile_fixture_plan(bad_draft)

    val = CreativePlanValidator.validate(
        plan=plan,
        product=req.product_data,
        strategy=req.strategy,
        requested_formats=req.formats,
        requested_placements=req.placements,
        target_video_duration=15,
    )
    assert val.passed is False
    assert any(i.code == "DURATION_MISMATCH" and i.concept_id == "vid_c1" for i in val.issues)


def test_validator_rejects_missing_objective():
    bad_draft = make_valid_creative_draft_dict(15)
    bad_draft["image_concepts"][0]["creative_objective"] = "Short."  # Too short / undefined
    plan, req = _compile_fixture_plan(bad_draft)

    val = CreativePlanValidator.validate(
        plan=plan,
        product=req.product_data,
        strategy=req.strategy,
        requested_formats=req.formats,
        requested_placements=req.placements,
        target_video_duration=15,
    )
    assert val.passed is False
    assert any(i.code == "OBJECTIVE_MISSING" and i.concept_id == "img_c1" for i in val.issues)


def test_validator_rejects_unsupported_claims_and_feature_inventions():
    bad_draft = make_valid_creative_draft_dict(15)
    # Inject rejected cordless operation + invented LED touchscreen + contradictory wattage
    bad_draft["image_concepts"][0]["main_message"] = "Enjoy cordless freedom with an LED touch screen display and 1000W power!"
    plan, req = _compile_fixture_plan(bad_draft)

    val = CreativePlanValidator.validate(
        plan=plan,
        product=req.product_data,
        strategy=req.strategy,
        requested_formats=req.formats,
        requested_placements=req.placements,
        target_video_duration=15,
    )
    assert val.passed is False
    codes = {i.code for i in val.issues}
    assert "CONTRADICTORY_PRODUCT_INFO" in codes
    assert "FEATURE_INVENTION" in codes


def test_validator_rejects_missing_price_fabrication():
    product = make_missing_price_product()
    strategy = MarketingStrategy.model_validate(make_valid_strategy_dict())
    bad_draft = make_valid_creative_draft_dict(15)
    # Keep wattage neutral for missing-price test but fabricate ₹999 price in CTA/message
    bad_draft["image_concepts"][0]["main_message"] = "Industrial blending power at just ₹999 today!"
    bad_draft["image_concepts"][1]["main_message"] = "Built for steady commercial cafe mixing with 2000W output."
    bad_draft["video_concepts"][0]["scene_sequence"][1]["voiceover_script"] = "Built for commercial blending."
    bad_draft["video_concepts"][0]["scene_sequence"][3]["on_screen_text"] = "Commercial Cafe Ready"
    bad_draft["video_concepts"][0]["scene_sequence"][3]["voiceover_script"] = "Shop Lifelong Commercial Blender today."
    bad_draft["video_concepts"][1]["scene_sequence"][1]["voiceover_script"] = "Commercial 2000W blender strength."
    bad_draft["video_concepts"][1]["scene_sequence"][3]["voiceover_script"] = "Rated by cafe professionals."
    bad_draft["video_concepts"][1]["scene_sequence"][3]["on_screen_text"] = "Trusted Cafe Strength"

    plan, req = _compile_fixture_plan(bad_draft, product=product, strategy=strategy)
    val = CreativePlanValidator.validate(
        plan=plan,
        product=product,
        strategy=strategy,
        requested_formats=req.formats,
        requested_placements=req.placements,
        target_video_duration=15,
    )
    assert val.passed is False
    assert any(i.code == "CONTRADICTORY_PRODUCT_INFO" and "price is missing" in i.message for i in val.issues)


def test_validator_rejects_placement_mismatch_and_aspect_ratio_tamper():
    bad_draft = make_valid_creative_draft_dict(15)
    bad_draft["image_concepts"][0]["placement"] = "tiktok_vertical"  # Not in requested placements
    plan, req = _compile_fixture_plan(bad_draft)

    val = CreativePlanValidator.validate(
        plan=plan,
        product=req.product_data,
        strategy=req.strategy,
        requested_formats=req.formats,
        requested_placements=["instagram_feed", "instagram_reels"],
        target_video_duration=15,
    )
    assert val.passed is False
    assert any(i.code == "PLACEMENT_MISMATCH" and i.concept_id == "img_c1" for i in val.issues)


def test_validator_rejects_mere_background_swap_concepts():
    bad_draft = make_valid_creative_draft_dict(15)
    # Make img_c2 essentially clone img_c1 except background_direction ("marble" -> "oak wood")
    clone = dict(bad_draft["image_concepts"][0])
    clone["concept_id"] = "img_c2"
    clone["creative_title"] = "Three-Jar Culinary Flatlay Blueprint Alternate"
    clone["hook"] = "Three dedicated steel jars—zero morning kitchen chaos."
    clone["background_direction"] = "Warm oak wooden table instead of slate stone."
    bad_draft["image_concepts"][1] = clone

    plan, req = _compile_fixture_plan(bad_draft)
    val = CreativePlanValidator.validate(
        plan=plan,
        product=req.product_data,
        strategy=req.strategy,
        requested_formats=req.formats,
        requested_placements=req.placements,
        target_video_duration=15,
    )
    assert val.passed is False
    assert any(i.code == "INSUFFICIENT_DIFFERENTIATION" and i.concept_id == "img_c2" for i in val.issues)


# ---------------------------------------------------------------------------
# 3. CreativePlanningService Controlled Regeneration Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_creative_planning_service_controlled_regeneration_succeeds():
    bad_draft = make_valid_creative_draft_dict(15)
    bad_draft["video_concepts"][0]["scene_sequence"][0]["scene_duration"] = 10  # Breaks 15s sum!
    good_draft = make_valid_creative_draft_dict(15)

    sdk, mock_call = _mock_sdk_with_drafts([bad_draft, good_draft])
    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=sdk,
    )
    service = CreativePlanningService(gemini_client=gemini_client, max_regenerations=2)

    req = CreativePlanRequest(
        product_data=make_lifelong_mixer_product(),
        strategy=MarketingStrategy.model_validate(make_valid_strategy_dict()),
        user_prompt="Create bold Instagram Feed and Reels ads.",
        formats=["image", "video"],
        placements=["instagram_feed", "instagram_reels"],
        target_video_duration=15,
    )

    resp = await service.plan_creatives(req)
    assert resp.success is True
    assert resp.plan is not None
    assert len(resp.plan.concepts) == 4
    assert resp.validation.passed is True
    assert resp.generation_metadata.regenerations == 1
    assert resp.generation_metadata.total_tokens == 2500
    second_prompt = mock_call.call_args_list[1].kwargs["contents"][0]
    assert "DURATION_MISMATCH" in second_prompt


@pytest.mark.asyncio
async def test_creative_planning_service_fails_clearly_when_regenerations_exhausted():
    bad_draft = make_valid_creative_draft_dict(15)
    bad_draft["video_concepts"][0]["scene_sequence"][0]["scene_duration"] = 99

    sdk, mock_call = _mock_sdk_with_drafts([bad_draft, bad_draft])
    gemini_client = GeminiStrategyClient(
        api_key="test-key",
        model_name="gemini-2.5-flash",
        genai_client=sdk,
    )
    service = CreativePlanningService(gemini_client=gemini_client, max_regenerations=1)

    req = CreativePlanRequest(
        product_data=make_lifelong_mixer_product(),
        strategy=MarketingStrategy.model_validate(make_valid_strategy_dict()),
        user_prompt="Create Instagram Reels ads.",
        formats=["image", "video"],
        placements=["instagram_feed", "instagram_reels"],
        target_video_duration=15,
    )

    resp = await service.plan_creatives(req)
    assert resp.success is False
    assert resp.plan is None
    assert resp.validation.passed is False
    assert resp.generation_metadata.regenerations == 1
    assert mock_call.await_count == 2

