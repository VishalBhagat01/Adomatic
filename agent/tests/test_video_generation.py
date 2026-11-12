"""
Unit, FFmpeg multimedia, validation, async job, and restart-recovery tests for Step 08.
Runs genuine FFmpeg encoding, normalization, concatenation, PNG overlay subtitles/CTAs,
voiceover mixing, audio loudness/clipping checks, black-frame checks, and crash recovery.
"""

import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from google.genai import errors as genai_errors

from agent.app.schemas.video_gen import (
    SceneGenerationRecord,
    VideoGenerationJobResponse,
    VideoGenerationPreferences,
    VideoGenerationRequest,
    VideoJobSnapshot,
)
from agent.app.services.image_gen.reference_selector import ReferenceImageSelector
from agent.app.services.storage import AgentStorage, build_video_object_key
from agent.app.services.strategy.gemini_client import (
    GeminiConfigurationError,
    GeminiExecutionError,
)
from agent.app.services.video_gen.ffmpeg_processor import FFmpegProcessor
from agent.app.services.video_gen.job_store import VideoJobStore
from agent.app.services.video_gen.scene_prompt_builder import (
    PROMPT_VERSION,
    StoryboardValidationError,
    validate_storyboard_for_execution,
)
from agent.app.services.video_gen.veo_client import VeoVideoClient
from agent.app.services.video_gen.video_service import VideoGenerationService
from agent.app.services.video_gen.video_validator import VideoQualityValidator
from agent.tests.fixtures.image_fixtures import (
    FakeS3Client,
    make_mock_image_http_factory,
    make_synthetic_product_image_bytes,
)
from agent.tests.fixtures.strategy_fixtures import make_lifelong_mixer_product
from agent.tests.fixtures.video_fixtures import (
    make_real_mp4_bytes,
    make_sample_video_storyboard,
    make_voiceover_wav_bytes,
)


def _ref_http_factory():
    ref1 = make_synthetic_product_image_bytes(900, 900, fmt="JPEG", variant_seed=0)
    ref2 = make_synthetic_product_image_bytes(1100, 1100, fmt="PNG", variant_seed=1)
    return make_mock_image_http_factory(
        {
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer1.jpg": (200, "image/jpeg", ref1),
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer2.jpg": (200, "image/png", ref2),
        }
    )


def _mock_veo_sdk(generate_side_effects, get_side_effects=None, download_side_effects=None):
    gen_mock = AsyncMock(side_effect=generate_side_effects)
    get_mock = AsyncMock(side_effect=get_side_effects or [])
    dl_mock = AsyncMock(side_effect=download_side_effects or [])
    sdk = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_videos=gen_mock),
            operations=SimpleNamespace(get=get_mock),
            files=SimpleNamespace(download=dl_mock),
        )
    )
    return sdk, gen_mock, get_mock, dl_mock


def _op(name: str, done: bool = False, video_bytes: bytes = None, error=None):
    vid_obj = SimpleNamespace(video_bytes=video_bytes, uri="https://generativelanguage.googleapis.com/v1/files/vid")
    resp = SimpleNamespace(generated_videos=[SimpleNamespace(video=vid_obj)]) if done and not error else None
    return SimpleNamespace(name=name, done=done, error=error, response=resp)


# ---------------------------------------------------------------------------
# 1. Storyboard Validation & Veo Client Tests
# ---------------------------------------------------------------------------


def test_storyboard_validation_rejects_scene_duration_mismatch():
    sb = make_sample_video_storyboard(total_duration=9)
    sb.total_duration = 12
    with pytest.raises(StoryboardValidationError):
        validate_storyboard_for_execution(sb)


@pytest.mark.asyncio
async def test_veo_client_requires_api_key_and_never_falls_back_on_404():
    no_key = VeoVideoClient(api_key="", model_name="veo-3.1-fast-generate-preview")
    with pytest.raises(GeminiConfigurationError):
        await no_key.submit_scene_job(
            prompt="Shot",
            negative_prompt="",
            aspect_ratio="9:16",
            duration_seconds=8,
            resolution="720p",
        )

    err_404 = genai_errors.ClientError(404, {"error": {"message": "Unknown Veo model"}})
    sdk, gen_mock, _, _ = _mock_veo_sdk([err_404])
    client = VeoVideoClient(
        api_key="test-key",
        model_name="veo-invalid-9.9",
        max_retries=2,
        client=sdk,
    )
    with pytest.raises(GeminiExecutionError) as exc:
        await client.submit_scene_job(
            prompt="Shot",
            negative_prompt="",
            aspect_ratio="9:16",
            duration_seconds=8,
            resolution="720p",
        )
    assert exc.value.model_name == "veo-invalid-9.9"
    assert exc.value.status_code == 404
    assert gen_mock.await_count == 1


@pytest.mark.asyncio
async def test_veo_client_reference_images_and_image_to_video_mutual_exclusion():
    pending_op = _op("operations/veo-op-1", done=False)
    done_op = _op("operations/veo-op-1", done=True, video_bytes=None)
    sdk, gen_mock, get_mock, dl_mock = _mock_veo_sdk(
        generate_side_effects=[pending_op, _op("operations/veo-op-2", done=True, video_bytes=b"MP4INLINE")],
        get_side_effects=[done_op],
        download_side_effects=[b"MP4DOWNLOADED"],
    )
    client = VeoVideoClient(
        api_key="test-key",
        model_name="veo-3.1-fast-generate-preview",
        poll_interval_seconds=0.01,
        poll_max_interval_seconds=0.02,
        client=sdk,
    )

    # Case 1: reference_images mode passes ASSET refs and polls + downloads cleanly
    submitted = await client.submit_scene_job(
        prompt="Commercial mixer shot",
        negative_prompt="watermark",
        aspect_ratio="9:16",
        duration_seconds=8,
        resolution="720p",
        reference_images=[(b"ref1", "image/png")],
    )
    cfg = gen_mock.call_args.kwargs["config"]
    assert cfg.reference_images is not None and len(cfg.reference_images) == 1
    assert "image" not in gen_mock.call_args.kwargs

    finished_op, polls = await client.poll_operation(
        operation_name=submitted.operation_name,
        initial_operation=submitted.operation,
    )
    assert polls == 1
    dl_bytes = await client.download_video_bytes(finished_op)
    assert dl_bytes == b"MP4DOWNLOADED"
    assert dl_mock.await_count == 1

    # Case 2: image_to_video passes `image=` first-frame and keeps `config.reference_images` unset
    await client.submit_scene_job(
        prompt="Animate first frame",
        negative_prompt="",
        aspect_ratio="9:16",
        duration_seconds=4,
        resolution="720p",
        first_frame_image=(b"heroframe", "image/png"),
        reference_images=[(b"ignored", "image/png")],
    )
    cfg2 = gen_mock.call_args.kwargs["config"]
    assert cfg2.reference_images is None
    assert gen_mock.call_args.kwargs["image"].image_bytes == b"heroframe"


# ---------------------------------------------------------------------------
# 2. Real FFmpeg Normalization & Validation Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ffmpeg_aspect_safe_normalization_and_validator_rejections(tmp_path: Path):
    processor = FFmpegProcessor()
    validator = VideoQualityValidator(ffmpeg=processor, min_similarity_score=0.22)
    selector = ReferenceImageSelector(client_factory=_ref_http_factory(), resolve_dns=False)
    refs, _ = await selector.select_references(make_lifelong_mixer_product())

    # 1. Corrupt video fails cleanly
    corrupt_path = tmp_path / "corrupt.mp4"
    corrupt_path.write_bytes(b"NOT_A_VALID_MP4_HEADER" * 40)
    res_corrupt = validator.validate_video(
        video_path=corrupt_path,
        expected_duration_seconds=3.0,
        duration_tolerance_seconds=0.5,
        expected_aspect_ratio="9:16",
        expected_min_width=720,
        expected_min_height=1280,
        min_fps=20.0,
        require_audio=True,
        reference_images=refs,
    )
    assert res_corrupt.approved is False and res_corrupt.corrupt is True

    # 2. Black-frame clip fails black_frames check
    black_path = tmp_path / "black.mp4"
    black_path.write_bytes(make_real_mp4_bytes(720, 1280, duration_seconds=2.5, black_frames=True))
    res_black = validator.validate_video(
        video_path=black_path,
        expected_duration_seconds=2.5,
        duration_tolerance_seconds=0.5,
        expected_aspect_ratio="9:16",
        expected_min_width=720,
        expected_min_height=1280,
        min_fps=20.0,
        require_audio=True,
        reference_images=refs,
    )
    assert res_black.approved is False
    assert any("black" in r.lower() for r in res_black.rejection_reasons)

    # 3. Missing audio track fails when require_audio=True
    mute_path = tmp_path / "mute.mp4"
    mute_path.write_bytes(make_real_mp4_bytes(720, 1280, duration_seconds=2.5, with_audio=False))
    res_mute = validator.validate_video(
        video_path=mute_path,
        expected_duration_seconds=2.5,
        duration_tolerance_seconds=0.5,
        expected_aspect_ratio="9:16",
        expected_min_width=720,
        expected_min_height=1280,
        min_fps=20.0,
        require_audio=True,
        reference_images=refs,
    )
    assert res_mute.approved is False
    assert any("audio track" in r.lower() for r in res_mute.rejection_reasons)

    # 4. Saturated 0.0 dBFS clipped audio fails audio_clipping check
    clip_path = tmp_path / "clipped_audio.mp4"
    clip_path.write_bytes(make_real_mp4_bytes(720, 1280, duration_seconds=2.5, with_audio=True, clipping_audio=True))
    res_clip = validator.validate_video(
        video_path=clip_path,
        expected_duration_seconds=2.5,
        duration_tolerance_seconds=0.5,
        expected_aspect_ratio="9:16",
        expected_min_width=720,
        expected_min_height=1280,
        min_fps=20.0,
        require_audio=True,
        reference_images=refs,
    )
    assert res_clip.approved is False
    assert any("clipping" in r.lower() or "peak" in r.lower() for r in res_clip.rejection_reasons)

    # 5. Landscape 1280x720 source normalized into portrait 720x1280 without stretching passes cleanly
    landscape_raw = tmp_path / "raw_16_9.mp4"
    landscape_raw.write_bytes(make_real_mp4_bytes(1280, 720, duration_seconds=4.0, with_audio=False, variant_seed=0))
    portrait_norm = tmp_path / "norm_9_16.mp4"
    probe = processor.normalize_scene_clip(
        input_path=landscape_raw,
        output_path=portrait_norm,
        target_duration=3,
        width=720,
        height=1280,
        fps=24,
    )
    assert probe.width == 720 and probe.height == 1280
    assert abs(probe.duration_seconds - 3.0) <= 0.25
    assert probe.has_audio_stream is True


# ---------------------------------------------------------------------------
# 3. Full Pipeline + FFmpeg Subtitles, Voiceover, CTA + Worker Restart Recovery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_end_to_end_video_assembly_with_subtitles_voiceover_and_cta(tmp_path: Path):
    product = make_lifelong_mixer_product()
    storyboard = make_sample_video_storyboard(total_duration=9, aspect_ratio="9:16")

    clip1 = make_real_mp4_bytes(720, 1280, duration_seconds=4.0, fps=24, with_audio=True, variant_seed=0)
    clip2 = make_real_mp4_bytes(720, 1280, duration_seconds=4.0, fps=24, with_audio=True, variant_seed=1)
    clip3 = make_real_mp4_bytes(720, 1280, duration_seconds=4.0, fps=24, with_audio=True, variant_seed=2)

    sdk, _, _, _ = _mock_veo_sdk(
        generate_side_effects=[
            _op("operations/s1", done=True, video_bytes=clip1),
            _op("operations/s2", done=True, video_bytes=clip2),
            _op("operations/s3", done=True, video_bytes=clip3),
        ]
    )

    fake_s3 = FakeS3Client()
    store = VideoJobStore(state_dir=tmp_path / "job_state")
    service = VideoGenerationService(
        veo_client=VeoVideoClient(
            api_key="test-key",
            model_name="veo-3.1-fast-generate-preview",
            poll_interval_seconds=0.01,
            client=sdk,
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_http_factory(), resolve_dns=False),
        job_store=store,
        storage=AgentStorage(s3_client=fake_s3),
    )

    vo_wav_b64 = base64.b64encode(make_voiceover_wav_bytes(9.0)).decode("ascii")
    req = VideoGenerationRequest(
        campaign_id="camp_vid_08",
        storyboard=storyboard,
        product_data=product,
        preferences=VideoGenerationPreferences(
            aspect_ratio="9:16",
            resolution="720p",
            fps=24,
            include_subtitles=True,
            include_cta_overlay=True,
            require_audio=True,
        ),
        voiceover_audio_base64=vo_wav_b64,
        execute_sync=True,
    )

    res = await service.submit_job(req)

    assert res.status == "COMPLETED"
    assert res.progress_percent == 100
    assert res.prompt_version == PROMPT_VERSION
    assert res.total_estimated_cost_usd > 0
    assert len(res.scene_records) == 3
    assert all(r.status == "COMPLETED" for r in res.scene_records)

    final_v = res.final_video
    assert final_v is not None
    assert final_v.stored is True
    assert final_v.width == 720 and final_v.height == 1280
    assert abs(final_v.duration_seconds - 9.0) <= 0.4
    assert final_v.has_audio is True
    assert final_v.subtitles_rendered is True
    assert final_v.cta_overlay_applied is True
    assert final_v.voiceover_mixed is True
    assert final_v.validation.approved is True
    assert final_v.validation.max_volume_db is not None and final_v.validation.max_volume_db <= -0.05
    assert len(final_v.scene_to_video_map) == 3
    assert ("adpilot-creatives", final_v.object_key) in fake_s3.objects


@pytest.mark.asyncio
async def test_worker_restart_recovery_resumes_operation_and_skips_completed_scene(tmp_path: Path):
    """
    Simulate mid-job worker crash and restart:
    - Scene 1 ALREADY completed & normalized clip persisted in S3 -> must NOT call Veo again.
    - Scene 2 ALREADY submitted with saved operation_name='operations/persisted-s2' -> must resume polling, NOT re-submit.
    - Scene 3 still PENDING -> fresh Veo submission & completion, followed by FFmpeg final assembly.
    """
    product = make_lifelong_mixer_product()
    storyboard = make_sample_video_storyboard(total_duration=9, aspect_ratio="9:16")

    norm_clip_s1 = make_real_mp4_bytes(720, 1280, duration_seconds=3.0, fps=24, with_audio=True, variant_seed=0)
    raw_clip_s2 = make_real_mp4_bytes(720, 1280, duration_seconds=4.0, fps=24, with_audio=True, variant_seed=1)
    raw_clip_s3 = make_real_mp4_bytes(720, 1280, duration_seconds=4.0, fps=24, with_audio=True, variant_seed=2)

    fake_s3 = FakeS3Client()
    storage = AgentStorage(s3_client=fake_s3)
    s1_key = build_video_object_key("camp_recover", storyboard.concept_id, "vidjob_crash_s1_norm", stage="scenes")
    storage.upload_bytes(bucket="adpilot-creatives", object_key=s1_key, data=norm_clip_s1, content_type="video/mp4")

    store = VideoJobStore(state_dir=tmp_path / "recover_state")
    req = VideoGenerationRequest(
        campaign_id="camp_recover",
        storyboard=storyboard,
        product_data=product,
        preferences=VideoGenerationPreferences(aspect_ratio="9:16", resolution="720p", fps=24),
        execute_sync=True,
    )

    persisted_job = VideoGenerationJobResponse(
        job_id="vidjob_crash",
        campaign_id="camp_recover",
        concept_id=storyboard.concept_id,
        status="POLLING_OPERATIONS",
        model_identifier="veo-3.1-fast-generate-preview",
        prompt_version=PROMPT_VERSION,
        target_aspect_ratio="9:16",
        target_resolution="720p",
        progress_percent=35,
        scene_records=[
            SceneGenerationRecord(
                scene_number=1,
                scene_duration_target=3,
                veo_requested_duration=8,
                veo_aspect_ratio="9:16",
                prompt_used="Scene 1 prompt",
                negative_prompt_used="",
                status="COMPLETED",
                operation_name="operations/done-s1",
                normalized_clip_object_key=s1_key,
                local_clip_path=str(tmp_path / "deleted_temp_after_crash.mp4"),
            ),
            SceneGenerationRecord(
                scene_number=2,
                scene_duration_target=3,
                veo_requested_duration=8,
                veo_aspect_ratio="9:16",
                prompt_used="Scene 2 prompt",
                negative_prompt_used="",
                status="SUBMITTED",
                operation_name="operations/persisted-s2",
            ),
            SceneGenerationRecord(
                scene_number=3,
                scene_duration_target=3,
                veo_requested_duration=8,
                veo_aspect_ratio="9:16",
                prompt_used="Scene 3 prompt",
                negative_prompt_used="",
                status="PENDING",
            ),
        ],
    )
    store.save_snapshot(
        VideoJobSnapshot(job=persisted_job, request=req, staging_dir=str(tmp_path / "recovered_stage"))
    )
    assert "vidjob_crash" in store.list_recoverable_job_ids()

    # Fresh restarted service instance:
    sdk, gen_mock, get_mock, _ = _mock_veo_sdk(
        # Only Scene 3 submits freshly!
        generate_side_effects=[_op("operations/new-s3", done=True, video_bytes=raw_clip_s3)],
        # Resumed poll for persisted Scene 2 operation!
        get_side_effects=[_op("operations/persisted-s2", done=True, video_bytes=raw_clip_s2)],
    )
    restarted_service = VideoGenerationService(
        veo_client=VeoVideoClient(
            api_key="test-key",
            model_name="veo-3.1-fast-generate-preview",
            poll_interval_seconds=0.01,
            client=sdk,
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_http_factory(), resolve_dns=False),
        job_store=store,
        storage=storage,
    )

    recovered_job = await restarted_service.resume_job("vidjob_crash")

    assert recovered_job.status == "COMPLETED"
    assert gen_mock.await_count == 1  # ONLY Scene 3 submitted! Scene 1 skipped, Scene 2 resumed!
    assert get_mock.await_count == 1  # Polled persisted operations/persisted-s2
    assert get_mock.call_args.args[0].name == "operations/persisted-s2"
    assert recovered_job.final_video is not None
    assert recovered_job.final_video.validation.approved is True
    assert "vidjob_crash" not in store.list_recoverable_job_ids()

