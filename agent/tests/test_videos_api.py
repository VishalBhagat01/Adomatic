"""
Integration tests for Step 08 FastAPI endpoints:
POST /api/v1/videos/generate (async 202 + sync 200)
GET  /api/v1/videos/jobs/{job_id}
POST /api/v1/videos/jobs/{job_id}/resume
"""

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
import pytest

from agent.app.api.v1.endpoints.videos import get_video_generation_service
from agent.app.core.config import settings
from agent.app.main import app
from agent.app.services.image_gen.reference_selector import ReferenceImageSelector
from agent.app.services.storage import AgentStorage
from agent.app.services.video_gen.job_store import VideoJobStore
from agent.app.services.video_gen.veo_client import VeoVideoClient
from agent.app.services.video_gen.video_service import VideoGenerationService
from agent.tests.fixtures.image_fixtures import (
    FakeS3Client,
    make_mock_image_http_factory,
    make_synthetic_product_image_bytes,
)
from agent.tests.fixtures.strategy_fixtures import make_lifelong_mixer_product
from agent.tests.fixtures.video_fixtures import (
    make_real_mp4_bytes,
    make_sample_video_storyboard,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def _enable_video_endpoint(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_VIDEO_GENERATION", True)


def _ref_factory():
    ref1 = make_synthetic_product_image_bytes(900, 900, fmt="JPEG", variant_seed=0)
    return make_mock_image_http_factory(
        {
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer1.jpg": (200, "image/jpeg", ref1),
            "https://cdn.shopify.com/s/files/1/0000/0001/products/mixer2.jpg": (200, "image/png", ref1),
        }
    )


def _mock_veo_done(clips):
    ops = [
        SimpleNamespace(
            name=f"operations/api-s{idx+1}",
            done=True,
            error=None,
            response=SimpleNamespace(
                generated_videos=[SimpleNamespace(video=SimpleNamespace(video_bytes=raw))]
            ),
        )
        for idx, raw in enumerate(clips)
    ]
    sdk = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_videos=AsyncMock(side_effect=ops)),
            operations=SimpleNamespace(get=AsyncMock()),
            files=SimpleNamespace(download=AsyncMock()),
        )
    )
    return sdk


def test_videos_generate_sync_and_get_status_endpoint(tmp_path: Path):
    clips = [
        make_real_mp4_bytes(720, 1280, duration_seconds=3.5, fps=24, with_audio=True, variant_seed=i)
        for i in range(3)
    ]
    fake_s3 = FakeS3Client()
    service = VideoGenerationService(
        veo_client=VeoVideoClient(
            api_key="test-key",
            model_name="veo-3.1-fast-generate-preview",
            poll_interval_seconds=0.01,
            client=_mock_veo_done(clips),
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        job_store=VideoJobStore(state_dir=tmp_path / "api_jobs"),
        storage=AgentStorage(s3_client=fake_s3),
    )
    app.dependency_overrides[get_video_generation_service] = lambda: service

    try:
        resp = client.post(
            "/api/v1/videos/generate",
            json={
                "campaign_id": "camp_api_vid",
                "storyboard": make_sample_video_storyboard(9, "9:16").model_dump(mode="json"),
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "execute_sync": True,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "COMPLETED"
        job_id = body["job_id"]

        status_resp = client.get(f"/api/v1/videos/jobs/{job_id}")
        assert status_resp.status_code == 200
        assert status_resp.json()["final_video"]["stored"] is True
    finally:
        app.dependency_overrides.clear()


def test_videos_generate_async_returns_202_immediately(tmp_path: Path):
    clips = [
        make_real_mp4_bytes(720, 1280, duration_seconds=3.5, fps=24, with_audio=True, variant_seed=i)
        for i in range(3)
    ]
    fake_s3 = FakeS3Client()
    service = VideoGenerationService(
        veo_client=VeoVideoClient(
            api_key="test-key",
            model_name="veo-3.1-fast-generate-preview",
            poll_interval_seconds=0.01,
            client=_mock_veo_done(clips),
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        job_store=VideoJobStore(state_dir=tmp_path / "async_jobs"),
        storage=AgentStorage(s3_client=fake_s3),
    )
    app.dependency_overrides[get_video_generation_service] = lambda: service

    try:
        resp = client.post(
            "/api/v1/videos/generate",
            json={
                "campaign_id": "camp_async_vid",
                "storyboard": make_sample_video_storyboard(9, "9:16").model_dump(mode="json"),
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
                "execute_sync": False,
            },
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "QUEUED"
        assert body["job_id"].startswith("vidjob_")
    finally:
        app.dependency_overrides.clear()


def test_videos_generate_missing_api_key_returns_503_and_invalid_duration_422(tmp_path: Path):
    service = VideoGenerationService(
        veo_client=VeoVideoClient(api_key="", model_name="veo-3.1-fast-generate-preview"),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        job_store=VideoJobStore(state_dir=tmp_path / "err_jobs"),
        storage=AgentStorage(s3_client=FakeS3Client()),
    )
    app.dependency_overrides[get_video_generation_service] = lambda: service

    try:
        bad_sb = make_sample_video_storyboard(9, "9:16").model_dump(mode="json")
        bad_sb["total_duration"] = 25
        resp_422 = client.post(
            "/api/v1/videos/generate",
            json={
                "campaign_id": "camp_bad_dur",
                "storyboard": bad_sb,
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
            },
        )
        assert resp_422.status_code == 422

        resp_503 = client.post(
            "/api/v1/videos/generate",
            json={
                "campaign_id": "camp_nokey",
                "storyboard": make_sample_video_storyboard(9, "9:16").model_dump(mode="json"),
                "product_data": make_lifelong_mixer_product().model_dump(mode="json"),
            },
        )
        assert resp_503.status_code == 503

        resp_404 = client.get("/api/v1/videos/jobs/nonexistent_job_id")
        assert resp_404.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_videos_resume_endpoint_recovers_interrupted_job(tmp_path: Path):
    from agent.app.schemas.video_gen import (
        SceneGenerationRecord,
        VideoGenerationJobResponse,
        VideoGenerationPreferences,
        VideoGenerationRequest,
        VideoJobSnapshot,
    )
    from agent.app.services.storage import build_video_object_key
    from agent.app.services.video_gen.scene_prompt_builder import PROMPT_VERSION

    storyboard = make_sample_video_storyboard(9, "9:16")
    product = make_lifelong_mixer_product()
    clip1 = make_real_mp4_bytes(720, 1280, duration_seconds=3.0, fps=24, with_audio=True, variant_seed=0)
    clip2 = make_real_mp4_bytes(720, 1280, duration_seconds=3.5, fps=24, with_audio=True, variant_seed=1)
    clip3 = make_real_mp4_bytes(720, 1280, duration_seconds=3.5, fps=24, with_audio=True, variant_seed=2)

    fake_s3 = FakeS3Client()
    storage = AgentStorage(s3_client=fake_s3)
    s1_key = build_video_object_key("camp_api_resume", storyboard.concept_id, "vidjob_api_res_s1_norm", stage="scenes")
    storage.upload_bytes(bucket="adpilot-creatives", object_key=s1_key, data=clip1, content_type="video/mp4")

    store = VideoJobStore(state_dir=tmp_path / "resume_api_jobs")
    snap = VideoJobSnapshot(
        job=VideoGenerationJobResponse(
            job_id="vidjob_api_res",
            campaign_id="camp_api_resume",
            concept_id=storyboard.concept_id,
            status="POLLING_OPERATIONS",
            model_identifier="veo-3.1-fast-generate-preview",
            prompt_version=PROMPT_VERSION,
            target_aspect_ratio="9:16",
            target_resolution="720p",
            progress_percent=40,
            scene_records=[
                SceneGenerationRecord(
                    scene_number=1,
                    scene_duration_target=3,
                    veo_requested_duration=8,
                    veo_aspect_ratio="9:16",
                    prompt_used="s1",
                    negative_prompt_used="",
                    status="COMPLETED",
                    normalized_clip_object_key=s1_key,
                ),
                SceneGenerationRecord(
                    scene_number=2,
                    scene_duration_target=3,
                    veo_requested_duration=8,
                    veo_aspect_ratio="9:16",
                    prompt_used="s2",
                    negative_prompt_used="",
                    status="SUBMITTED",
                    operation_name="operations/resumed-s2",
                ),
                SceneGenerationRecord(
                    scene_number=3,
                    scene_duration_target=3,
                    veo_requested_duration=8,
                    veo_aspect_ratio="9:16",
                    prompt_used="s3",
                    negative_prompt_used="",
                    status="PENDING",
                ),
            ],
        ),
        request=VideoGenerationRequest(
            campaign_id="camp_api_resume",
            storyboard=storyboard,
            product_data=product,
            preferences=VideoGenerationPreferences(aspect_ratio="9:16", resolution="720p", fps=24),
        ),
        staging_dir=str(tmp_path / "resume_api_stage"),
    )
    store.save_snapshot(snap)

    sdk = SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(
                generate_videos=AsyncMock(
                    side_effect=[
                        SimpleNamespace(
                            name="operations/new-s3",
                            done=True,
                            error=None,
                            response=SimpleNamespace(
                                generated_videos=[SimpleNamespace(video=SimpleNamespace(video_bytes=clip3))]
                            ),
                        )
                    ]
                )
            ),
            operations=SimpleNamespace(
                get=AsyncMock(
                    side_effect=[
                        SimpleNamespace(
                            name="operations/resumed-s2",
                            done=True,
                            error=None,
                            response=SimpleNamespace(
                                generated_videos=[SimpleNamespace(video=SimpleNamespace(video_bytes=clip2))]
                            ),
                        )
                    ]
                )
            ),
            files=SimpleNamespace(download=AsyncMock()),
        )
    )
    service = VideoGenerationService(
        veo_client=VeoVideoClient(
            api_key="test-key",
            model_name="veo-3.1-fast-generate-preview",
            poll_interval_seconds=0.01,
            client=sdk,
        ),
        reference_selector=ReferenceImageSelector(client_factory=_ref_factory(), resolve_dns=False),
        job_store=store,
        storage=storage,
    )
    app.dependency_overrides[get_video_generation_service] = lambda: service

    try:
        resp = client.post("/api/v1/videos/jobs/vidjob_api_res/resume")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "COMPLETED"
        assert body["final_video"]["stored"] is True
    finally:
        app.dependency_overrides.clear()

