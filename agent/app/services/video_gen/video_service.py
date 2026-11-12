"""
AdPilot AI - Asynchronous Video Generation & Assembly Service (Step 08)
Coordinates storyboard validation, reference selection, scene Veo job submission,
persistent operation tracking (for worker restart recovery), bounded async polling,
scene & final validation, FFmpeg assembly/subtitles/voiceover/CTA export, and MinIO/S3 persistence.
"""

import asyncio
import base64
from pathlib import Path
import tempfile
import time
from typing import Dict, List, Optional, Tuple
import uuid

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.video_gen import (
    FinalVideoArtifact,
    SceneGenerationRecord,
    VideoGenerationJobResponse,
    VideoGenerationRequest,
    VideoJobSnapshot,
)
from agent.app.services.image_gen.reference_selector import (
    LoadedReferenceImage,
    ReferenceImageSelector,
)
from agent.app.services.storage import (
    AgentStorage,
    agent_storage,
    build_video_object_key,
)
from agent.app.services.video_gen.ffmpeg_processor import FFmpegProcessor
from agent.app.services.video_gen.job_store import VideoJobStore, video_job_store
from agent.app.services.video_gen.scene_prompt_builder import (
    PROMPT_VERSION,
    ScenePromptBuilder,
    map_scene_duration_to_veo,
    resolve_target_geometry,
    validate_storyboard_for_execution,
)
from agent.app.services.video_gen.veo_client import VeoVideoClient
from agent.app.services.video_gen.video_validator import VideoQualityValidator


class VideoJobNotFoundError(LookupError):
    """Raised when querying or resuming an unknown video generation job ID."""


class VideoGenerationService:
    """End-to-end async Veo generation & FFmpeg video assembly orchestrator."""

    def __init__(
        self,
        veo_client: Optional[VeoVideoClient] = None,
        reference_selector: Optional[ReferenceImageSelector] = None,
        prompt_builder: Optional[ScenePromptBuilder] = None,
        ffmpeg_processor: Optional[FFmpegProcessor] = None,
        validator: Optional[VideoQualityValidator] = None,
        job_store: Optional[VideoJobStore] = None,
        storage: Optional[AgentStorage] = None,
    ):
        self.veo_client = veo_client or VeoVideoClient()
        self.reference_selector = reference_selector or ReferenceImageSelector()
        self.prompt_builder = prompt_builder or ScenePromptBuilder()
        self.ffmpeg = ffmpeg_processor or FFmpegProcessor()
        self.validator = validator or VideoQualityValidator(ffmpeg=self.ffmpeg)
        self.job_store = job_store or video_job_store
        self.storage = storage or agent_storage
        self._background_tasks: Dict[str, asyncio.Task] = {}

    def _compute_scene_cut_timestamps(self, scene_durations: List[int]) -> List[float]:
        cuts: List[float] = []
        cursor = 0.0
        for d in scene_durations[:-1]:
            cursor += float(d)
            cuts.append(cursor)
        return cuts

    async def submit_job(self, request: VideoGenerationRequest) -> VideoGenerationJobResponse:
        """
        Validate inputs, prepare initial scene prompts & checkpoints, and either run
        asynchronously in background (default) or await completion (`execute_sync=True`).
        """
        # Steps 1 & 2: Validate storyboard structure & duration alignment
        validate_storyboard_for_execution(request.storyboard)
        out_ratio, veo_ratio, resolution, _, _ = resolve_target_geometry(
            request.storyboard, request.preferences
        )
        self.veo_client.validate_configuration()

        # Step 4: Retrieve authentic product reference images cleanly
        selected_refs, ref_warnings = await self.reference_selector.select_references(
            request.product_data,
            override_urls=request.reference_image_urls,
        )

        # Check approved ImageCreative first-frame candidates if requested
        first_frame_refs: List[LoadedReferenceImage] = []
        if request.approved_image_urls and request.preferences.generation_mode in {"auto", "image_to_video"}:
            try:
                first_frame_refs, extra_warns = await self.reference_selector.select_references(
                    request.product_data,
                    override_urls=request.approved_image_urls,
                )
                ref_warnings.extend(extra_warns)
            except Exception as exc:
                ref_warnings.append(f"Could not load approved_image_urls cleanly: {exc}")

        use_i2v = bool(first_frame_refs) and request.preferences.generation_mode in {"auto", "image_to_video"}
        use_refs = bool(selected_refs) and not use_i2v and request.preferences.generation_mode != "text_to_video"

        # Step 3: Compile scene prompts & build durable initial job snapshot
        scene_records: List[SceneGenerationRecord] = []
        for scene in sorted(request.storyboard.scene_sequence, key=lambda s: s.scene_number):
            positive_p, negative_p = self.prompt_builder.build_scene_prompt(
                storyboard=request.storyboard,
                scene=scene,
                product_data=request.product_data,
                reference_images=selected_refs,
                generate_native_audio=request.preferences.generate_native_audio,
            )
            veo_dur = map_scene_duration_to_veo(
                scene.scene_duration,
                resolution=resolution,
                using_reference_images=use_refs,
            )
            mode = (
                "image_to_video"
                if use_i2v
                else ("reference_images" if use_refs else "text_to_video")
            )
            scene_records.append(
                SceneGenerationRecord(
                    scene_number=scene.scene_number,
                    scene_duration_target=scene.scene_duration,
                    veo_requested_duration=veo_dur,
                    veo_aspect_ratio=veo_ratio,
                    prompt_used=positive_p,
                    negative_prompt_used=negative_p,
                    status="PENDING",
                    generation_mode=mode,
                )
            )

        job_id = f"vidjob_{uuid.uuid4().hex[:12]}"
        staging_dir = str(Path(tempfile.gettempdir()) / "adpilot_video_staging" / job_id)
        Path(staging_dir).mkdir(parents=True, exist_ok=True)

        job_resp = VideoGenerationJobResponse(
            job_id=job_id,
            campaign_id=request.campaign_id,
            concept_id=request.storyboard.concept_id,
            status="QUEUED",
            model_identifier=self.veo_client.model_name,
            prompt_version=PROMPT_VERSION,
            target_aspect_ratio=out_ratio,
            target_resolution=resolution,
            progress_percent=5,
            scene_records=scene_records,
            selected_reference_images=[r.selection for r in selected_refs],
            warnings=ref_warnings,
        )
        snapshot = VideoJobSnapshot(job=job_resp, request=request, staging_dir=staging_dir)
        self.job_store.save_snapshot(snapshot)

        if request.execute_sync:
            return await self._execute_snapshot(job_id, loaded_refs=selected_refs, first_frame_refs=first_frame_refs)

        task = asyncio.create_task(self._execute_background_safe(job_id))
        self._background_tasks[job_id] = task
        task.add_done_callback(lambda _: self._background_tasks.pop(job_id, None))
        return job_resp

    async def _execute_background_safe(self, job_id: str) -> None:
        try:
            await self._execute_snapshot(job_id)
        except Exception as exc:
            logger.error(f"Background video job '{job_id}' failed: {exc}")

    def get_job_status(self, job_id: str) -> Optional[VideoGenerationJobResponse]:
        snap = self.job_store.load_snapshot(job_id)
        return snap.job if snap else None

    async def resume_job(self, job_id: str) -> VideoGenerationJobResponse:
        """Recover persisted job from JobStore after worker restart and continue from saved operations."""
        snap = self.job_store.load_snapshot(job_id)
        if snap is None:
            raise VideoJobNotFoundError(f"Video generation job '{job_id}' was not found in job store.")
        if snap.job.status == "COMPLETED" and snap.job.final_video is not None:
            return snap.job
        return await self._execute_snapshot(job_id)

    async def _restore_existing_scene_clip(
        self,
        rec: SceneGenerationRecord,
        staging_path: Path,
    ) -> Optional[Path]:
        if rec.local_clip_path and Path(rec.local_clip_path).exists() and Path(rec.local_clip_path).stat().st_size > 0:
            return Path(rec.local_clip_path)

        key_to_fetch = rec.normalized_clip_object_key or rec.raw_clip_object_key
        if key_to_fetch:
            fetched = self.storage.download_bytes(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=key_to_fetch,
            )
            if fetched:
                restored_path = staging_path / f"scene_{rec.scene_number}_restored.mp4"
                restored_path.write_bytes(fetched)
                rec.local_clip_path = str(restored_path)
                return restored_path
        return None

    async def _execute_snapshot(
        self,
        job_id: str,
        loaded_refs: Optional[List[LoadedReferenceImage]] = None,
        first_frame_refs: Optional[List[LoadedReferenceImage]] = None,
    ) -> VideoGenerationJobResponse:
        run_start = time.perf_counter()
        snapshot = self.job_store.load_snapshot(job_id)
        if snapshot is None:
            raise VideoJobNotFoundError(f"Video generation job '{job_id}' could not be loaded.")

        job = snapshot.job
        req = snapshot.request
        staging_path = Path(snapshot.staging_dir)
        staging_path.mkdir(parents=True, exist_ok=True)

        out_ratio, veo_ratio, resolution, target_w, target_h = resolve_target_geometry(
            req.storyboard, req.preferences
        )
        fps = req.preferences.fps or settings.GEMINI_VIDEO_FPS

        try:
            if loaded_refs is None:
                loaded_refs, _ = await self.reference_selector.select_references(
                    req.product_data,
                    override_urls=req.reference_image_urls,
                )

            first_frame_pair: Optional[Tuple[bytes, str]] = None
            if req.approved_image_urls and req.preferences.generation_mode in {"auto", "image_to_video"}:
                if first_frame_refs is None:
                    try:
                        first_frame_refs, _ = await self.reference_selector.select_references(
                            req.product_data,
                            override_urls=req.approved_image_urls,
                        )
                    except Exception:
                        first_frame_refs = []
                if first_frame_refs:
                    first_frame_pair = (
                        first_frame_refs[0].image_bytes,
                        first_frame_refs[0].selection.mime_type,
                    )

            ref_pairs = [(r.image_bytes, r.selection.mime_type) for r in loaded_refs[:3]]

            job.status = "GENERATING_SCENES"
            job.progress_percent = 15
            self.job_store.save_snapshot(snapshot)

            normalized_paths: List[Path] = []
            scene_to_video_map: Dict[str, str] = {}
            total_scenes = max(1, len(job.scene_records))

            for idx, rec in enumerate(job.scene_records):
                # Recovery Path 1: Scene already completed & persisted in S3 / staging
                if rec.status == "COMPLETED":
                    existing = await self._restore_existing_scene_clip(rec, staging_path)
                    if existing is not None:
                        normalized_paths.append(existing)
                        scene_to_video_map[f"scene_{rec.scene_number}"] = (
                            rec.normalized_clip_object_key or rec.raw_clip_object_key or str(existing)
                        )
                        continue

                max_clip_tries = 1 + req.preferences.max_scene_clip_retries
                scene_passed = False
                last_clip_err: Optional[str] = None

                while rec.clip_attempts < max_clip_tries and not scene_passed:
                    rec.clip_attempts += 1

                    # Recovery Path 2: Resume persisted operation_name if already submitted before restart
                    op_obj = None
                    if rec.status in {"SUBMITTED", "POLLING"} and rec.operation_name and rec.clip_attempts == 1:
                        op_name = rec.operation_name
                        job.warnings.append(
                            f"Scene {rec.scene_number}: resumed persisted Veo operation '{op_name}'."
                        )
                    else:
                        use_i2v_now = rec.generation_mode == "image_to_video" and first_frame_pair is not None
                        use_refs_now = rec.generation_mode == "reference_images" and bool(ref_pairs)
                        submitted = await self.veo_client.submit_scene_job(
                            prompt=rec.prompt_used,
                            negative_prompt=rec.negative_prompt_used,
                            aspect_ratio=veo_ratio,
                            duration_seconds=rec.veo_requested_duration,
                            resolution=resolution,
                            fps=fps,
                            generate_audio=req.preferences.generate_native_audio,
                            first_frame_image=first_frame_pair if use_i2v_now else None,
                            reference_images=ref_pairs if use_refs_now else None,
                        )
                        op_name = submitted.operation_name
                        op_obj = submitted.operation
                        rec.operation_name = op_name
                        rec.generation_mode = submitted.generation_mode  # type: ignore[assignment]
                        rec.status = "SUBMITTED"
                        self.job_store.save_snapshot(snapshot)

                    job.status = "POLLING_OPERATIONS"
                    rec.status = "POLLING"
                    self.job_store.save_snapshot(snapshot)

                    completed_op, polls = await self.veo_client.poll_operation(
                        operation_name=rec.operation_name,
                        initial_operation=op_obj,
                    )
                    rec.poll_attempts += polls
                    raw_bytes = await self.veo_client.download_video_bytes(completed_op)

                    # Charge cost estimate for completed non-blocked Veo clip
                    rec.estimated_cost_usd = round(
                        rec.estimated_cost_usd + (rec.veo_requested_duration * self.veo_client.cost_per_second_usd),
                        4,
                    )

                    raw_file = staging_path / f"scene_{rec.scene_number}_attempt_{rec.clip_attempts}_raw.mp4"
                    raw_file.write_bytes(raw_bytes)

                    # Validate raw clip before normalization (integrity, black frames, ref product consistency)
                    raw_val = self.validator.validate_video(
                        video_path=raw_file,
                        expected_duration_seconds=float(rec.veo_requested_duration),
                        duration_tolerance_seconds=max(2.5, float(rec.veo_requested_duration)),
                        expected_aspect_ratio=veo_ratio if rec.generation_mode != "image_to_video" else out_ratio,
                        expected_min_width=360,
                        expected_min_height=360,
                        min_fps=15.0,
                        require_audio=False,
                        reference_images=loaded_refs,
                    )
                    if not raw_val.approved:
                        rej_key = build_video_object_key(
                            req.campaign_id,
                            req.storyboard.concept_id,
                            f"{job_id}_s{rec.scene_number}_a{rec.clip_attempts}_raw",
                            stage="rejected",
                        )
                        self.storage.upload_bytes(
                            bucket=settings.STORAGE_BUCKET_CREATIVES,
                            object_key=rej_key,
                            data=raw_bytes,
                            content_type="video/mp4",
                            metadata={"job_id": job_id, "scene": str(rec.scene_number), "approved": "false"},
                        )
                        rec.raw_clip_object_key = rej_key
                        rec.validation = raw_val
                        rec.status = "REJECTED"
                        last_clip_err = "; ".join(raw_val.rejection_reasons)
                        rec.error = last_clip_err
                        rec.operation_name = None  # allow fresh generation retry
                        self.job_store.save_snapshot(snapshot)
                        continue

                    # Upload valid intermediate raw clip to MinIO/S3
                    raw_key = build_video_object_key(
                        req.campaign_id,
                        req.storyboard.concept_id,
                        f"{job_id}_s{rec.scene_number}_raw",
                        stage="scenes",
                    )
                    raw_up = self.storage.upload_bytes(
                        bucket=settings.STORAGE_BUCKET_CREATIVES,
                        object_key=raw_key,
                        data=raw_bytes,
                        content_type="video/mp4",
                        metadata={"job_id": job_id, "scene": str(rec.scene_number), "operation": rec.operation_name},
                    )
                    rec.raw_clip_object_key = raw_key
                    rec.presigned_url = raw_up.get("presigned_url")

                    # Normalize scene clip (aspect-safe scaling/padding, exact duration, FPS, audio sync)
                    norm_file = staging_path / f"scene_{rec.scene_number}_norm.mp4"
                    self.ffmpeg.normalize_scene_clip(
                        input_path=raw_file,
                        output_path=norm_file,
                        target_duration=rec.scene_duration_target,
                        width=target_w,
                        height=target_h,
                        fps=fps,
                    )

                    norm_val = self.validator.validate_video(
                        video_path=norm_file,
                        expected_duration_seconds=float(rec.scene_duration_target),
                        duration_tolerance_seconds=0.45,
                        expected_aspect_ratio=out_ratio,
                        expected_min_width=target_w,
                        expected_min_height=target_h,
                        min_fps=float(fps) - 1.0,
                        require_audio=True,
                        reference_images=loaded_refs,
                    )
                    rec.validation = norm_val
                    norm_bytes = norm_file.read_bytes()
                    norm_key = build_video_object_key(
                        req.campaign_id,
                        req.storyboard.concept_id,
                        f"{job_id}_s{rec.scene_number}_norm",
                        stage="scenes" if norm_val.approved else "rejected",
                    )
                    norm_up = self.storage.upload_bytes(
                        bucket=settings.STORAGE_BUCKET_CREATIVES,
                        object_key=norm_key,
                        data=norm_bytes,
                        content_type="video/mp4",
                        metadata={"job_id": job_id, "scene": str(rec.scene_number), "normalized": "true"},
                    )
                    rec.normalized_clip_object_key = norm_key
                    rec.local_clip_path = str(norm_file)
                    rec.presigned_url = norm_up.get("presigned_url") or rec.presigned_url

                    meta_key = build_video_object_key(
                        req.campaign_id,
                        req.storyboard.concept_id,
                        f"{job_id}_s{rec.scene_number}_norm",
                        stage="scenes" if norm_val.approved else "rejected",
                        ext="metadata.json",
                    )
                    rec.metadata_object_key = meta_key
                    self.storage.upload_json(
                        bucket=settings.STORAGE_BUCKET_CREATIVES,
                        object_key=meta_key,
                        payload=rec.model_dump(mode="json"),
                    )

                    if not norm_val.approved:
                        rec.status = "REJECTED"
                        last_clip_err = "; ".join(norm_val.rejection_reasons)
                        rec.error = last_clip_err
                        rec.operation_name = None
                        self.job_store.save_snapshot(snapshot)
                        continue

                    rec.status = "COMPLETED"
                    rec.error = None
                    scene_passed = True
                    normalized_paths.append(norm_file)
                    scene_to_video_map[f"scene_{rec.scene_number}"] = norm_key
                    job.progress_percent = min(75, 15 + int(((idx + 1) / total_scenes) * 60))
                    self.job_store.save_snapshot(snapshot)

                if not scene_passed:
                    rec.status = "FAILED"
                    raise RuntimeError(
                        f"Scene {rec.scene_number} failed validation after {rec.clip_attempts} attempt(s): {last_clip_err}"
                    )

            # Steps 10, 11 & 12: FFmpeg concatenation, subtitles, voiceover mix, CTA & MP4 export
            job.status = "ASSEMBLING_VIDEO"
            job.progress_percent = 82
            self.job_store.save_snapshot(snapshot)

            overlays_dir = staging_path / "overlays"
            srt_path, overlay_segments = self.ffmpeg.build_srt_and_overlay_pngs(
                storyboard=req.storyboard,
                product_data=req.product_data,
                aspect_ratio=out_ratio,
                width=target_w,
                height=target_h,
                work_dir=overlays_dir,
                include_subtitles=req.preferences.include_subtitles,
                include_cta=req.preferences.include_cta_overlay,
            )

            voiceover_track_path: Optional[Path] = None
            if req.voiceover_audio_base64:
                vo_bytes = base64.b64decode(req.voiceover_audio_base64)
                voiceover_track_path = staging_path / "voiceover_track.wav"
                voiceover_track_path.write_bytes(vo_bytes)

            final_video_id = f"{req.storyboard.concept_id}_{job_id}"
            final_mp4_path = staging_path / f"{final_video_id}_final.mp4"
            self.ffmpeg.assemble_final_video(
                scene_clip_paths=normalized_paths,
                output_path=final_mp4_path,
                overlay_segments=overlay_segments,
                voiceover_track_path=voiceover_track_path,
                fps=fps,
            )

            job.status = "VALIDATING_CLIPS"
            job.progress_percent = 92
            self.job_store.save_snapshot(snapshot)

            cut_timestamps = self._compute_scene_cut_timestamps(
                [r.scene_duration_target for r in job.scene_records]
            )
            final_validation = self.validator.validate_video(
                video_path=final_mp4_path,
                expected_duration_seconds=float(req.storyboard.total_duration),
                duration_tolerance_seconds=0.6,
                expected_aspect_ratio=out_ratio,
                expected_min_width=target_w,
                expected_min_height=target_h,
                min_fps=float(fps) - 1.0,
                require_audio=req.preferences.require_audio,
                reference_images=loaded_refs,
                scene_cut_timestamps=cut_timestamps,
            )

            final_bytes = final_mp4_path.read_bytes()
            final_stage = "final" if final_validation.approved else "rejected"
            final_obj_key = build_video_object_key(
                req.campaign_id,
                req.storyboard.concept_id,
                final_video_id,
                stage=final_stage,
                ext="mp4",
            )
            final_meta_key = build_video_object_key(
                req.campaign_id,
                req.storyboard.concept_id,
                final_video_id,
                stage=final_stage,
                ext="metadata.json",
            )

            if srt_path and srt_path.exists():
                srt_key = build_video_object_key(
                    req.campaign_id,
                    req.storyboard.concept_id,
                    final_video_id,
                    stage=final_stage,
                    ext="srt",
                )
                self.storage.upload_bytes(
                    bucket=settings.STORAGE_BUCKET_CREATIVES,
                    object_key=srt_key,
                    data=srt_path.read_bytes(),
                    content_type="application/x-subrip",
                )

            up_res = self.storage.upload_bytes(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=final_obj_key,
                data=final_bytes,
                content_type="video/mp4",
                metadata={
                    "job_id": job_id,
                    "campaign_id": req.campaign_id,
                    "concept_id": req.storyboard.concept_id,
                    "approved": str(final_validation.approved).lower(),
                },
            )
            if up_res.get("error"):
                job.warnings.append(f"Final video storage notice: {up_res['error']}")

            artifact = FinalVideoArtifact(
                video_id=final_video_id,
                campaign_id=req.campaign_id,
                concept_id=req.storyboard.concept_id,
                object_key=final_obj_key,
                metadata_object_key=final_meta_key,
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                stored=bool(up_res.get("stored")),
                presigned_url=up_res.get("presigned_url"),
                storage_error=up_res.get("error"),
                duration_seconds=final_validation.duration_seconds or float(req.storyboard.total_duration),
                width=final_validation.width or target_w,
                height=final_validation.height or target_h,
                aspect_ratio=out_ratio,
                fps=final_validation.fps or float(fps),
                has_audio=final_validation.has_audio_stream,
                subtitles_rendered=any(s.kind == "subtitle" for s in overlay_segments),
                cta_overlay_applied=any(s.kind == "cta" for s in overlay_segments),
                voiceover_mixed=voiceover_track_path is not None,
                file_size_bytes=len(final_bytes),
                scene_to_video_map=scene_to_video_map,
                validation=final_validation,
            )

            self.storage.upload_json(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=final_meta_key,
                payload={
                    "job_id": job_id,
                    "model_identifier": self.veo_client.model_name,
                    "prompt_version": PROMPT_VERSION,
                    "artifact": artifact.model_dump(mode="json"),
                },
            )

            job.final_video = artifact
            job.total_estimated_cost_usd = round(sum(r.estimated_cost_usd for r in job.scene_records), 4)
            job.total_latency_ms = round((time.perf_counter() - run_start) * 1000, 2)

            if final_validation.approved:
                job.status = "COMPLETED"
                job.progress_percent = 100
            else:
                job.status = "FAILED"
                job.errors.extend(final_validation.rejection_reasons)

            self.job_store.save_snapshot(snapshot)
            return job

        except Exception as exc:
            job.status = "FAILED"
            job.total_estimated_cost_usd = round(sum(r.estimated_cost_usd for r in job.scene_records), 4)
            job.total_latency_ms = round((time.perf_counter() - run_start) * 1000, 2)
            job.errors.append(str(exc))
            self.job_store.save_snapshot(snapshot)
            raise


video_generation_service = VideoGenerationService()

