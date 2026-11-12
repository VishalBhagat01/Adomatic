"""
AdPilot AI - Deterministic Video Quality & Consistency Validator (Step 08)
Verifies duration, resolution, aspect ratio, frame rate, audio presence,
audio peak clipping, prolonged black frames, scene transition continuity,
corrupt files, and sampled-frame product tonal consistency vs reference photos.
"""

from pathlib import Path
import tempfile
from typing import List, Optional
from PIL import ImageStat

from agent.app.core.config import settings
from agent.app.schemas.video_gen import VideoValidationCheck, VideoValidationResult
from agent.app.services.image_gen.quality_checker import measure_reference_similarity
from agent.app.services.image_gen.reference_selector import LoadedReferenceImage
from agent.app.services.video_gen.ffmpeg_processor import FFmpegProcessor


class VideoQualityValidator:
    """Evaluates scene clips and final assembled videos via FFmpeg probe + Pillow metrics."""

    def __init__(
        self,
        ffmpeg: Optional[FFmpegProcessor] = None,
        max_black_ratio: Optional[float] = None,
        max_peak_db: Optional[float] = None,
        min_similarity_score: Optional[float] = None,
    ):
        self.ffmpeg = ffmpeg or FFmpegProcessor()
        self.max_black_ratio = (
            settings.VIDEO_BLACK_FRAME_MAX_RATIO if max_black_ratio is None else max_black_ratio
        )
        self.max_peak_db = (
            settings.VIDEO_AUDIO_MAX_PEAK_DB if max_peak_db is None else max_peak_db
        )
        self.min_similarity_score = (
            settings.VIDEO_SIMILARITY_MIN_SCORE if min_similarity_score is None else min_similarity_score
        )

    def validate_video(
        self,
        *,
        video_path: Path,
        expected_duration_seconds: float,
        duration_tolerance_seconds: float,
        expected_aspect_ratio: str,
        expected_min_width: int,
        expected_min_height: int,
        min_fps: float,
        require_audio: bool,
        reference_images: List[LoadedReferenceImage],
        scene_cut_timestamps: Optional[List[float]] = None,
    ) -> VideoValidationResult:
        checks: List[VideoValidationCheck] = []
        rejection_reasons: List[str] = []
        warnings: List[str] = []

        probe = self.ffmpeg.probe_video(video_path, run_signal_checks=True)
        if probe.corrupt or not probe.has_video_stream:
            reason = probe.error or "Video file is corrupt or has no decodable video stream."
            checks.append(
                VideoValidationCheck(
                    name="integrity",
                    passed=False,
                    severity="error",
                    measured_value="corrupt",
                    expected_value="valid mp4 video stream",
                    details=reason,
                )
            )
            return VideoValidationResult(
                approved=False,
                corrupt=True,
                checks=checks,
                rejection_reasons=[reason],
            )

        checks.append(
            VideoValidationCheck(
                name="integrity",
                passed=True,
                severity="error",
                measured_value="decodable",
                expected_value="decodable",
                details="FFmpeg verified readable container and video frames.",
            )
        )

        # 1. Duration accuracy
        dur_diff = abs(probe.duration_seconds - expected_duration_seconds)
        dur_ok = dur_diff <= duration_tolerance_seconds
        checks.append(
            VideoValidationCheck(
                name="duration",
                passed=dur_ok,
                severity="error",
                measured_value=f"{probe.duration_seconds:.2f}s",
                expected_value=f"{expected_duration_seconds:.2f}s +/-{duration_tolerance_seconds:.2f}s",
                details="Checks clip or assembled runtime against storyboard schedule.",
            )
        )
        if not dur_ok:
            rejection_reasons.append(
                f"Duration {probe.duration_seconds:.2f}s outside expected {expected_duration_seconds:.2f}s (+/-{duration_tolerance_seconds:.2f}s)."
            )

        # 2. Resolution & Aspect Ratio
        w = probe.width or 0
        h = probe.height or 0
        res_ok = w >= expected_min_width and h >= expected_min_height
        checks.append(
            VideoValidationCheck(
                name="resolution",
                passed=res_ok,
                severity="error",
                measured_value=f"{w}x{h}",
                expected_value=f">={expected_min_width}x{expected_min_height}",
                details="Verifies minimum frame dimensions.",
            )
        )
        if not res_ok:
            rejection_reasons.append(f"Resolution {w}x{h} below required {expected_min_width}x{expected_min_height}.")

        actual_ratio_val = w / max(1, h)
        target_map = {"9:16": 9 / 16, "16:9": 16 / 9, "4:5": 0.8, "1:1": 1.0}
        expected_frac = target_map.get(expected_aspect_ratio, actual_ratio_val)
        ratio_ok = abs(actual_ratio_val - expected_frac) <= 0.08
        actual_ratio_str = f"{actual_ratio_val:.3f}"
        checks.append(
            VideoValidationCheck(
                name="aspect_ratio",
                passed=ratio_ok,
                severity="error",
                measured_value=f"{w}x{h} ({actual_ratio_str})",
                expected_value=expected_aspect_ratio,
                details="Prevents stretched or misoriented aspect geometry.",
            )
        )
        if not ratio_ok:
            rejection_reasons.append(
                f"Video aspect {w}x{h} ({actual_ratio_str}) mismatches expected {expected_aspect_ratio}."
            )

        # 3. Frame rate
        actual_fps = probe.fps or 0.0
        fps_ok = actual_fps >= min_fps
        checks.append(
            VideoValidationCheck(
                name="frame_rate",
                passed=fps_ok,
                severity="error",
                measured_value=f"{actual_fps:.2f} fps",
                expected_value=f">={min_fps:.1f} fps",
                details="Ensures smooth playback pacing without choppy drops.",
            )
        )
        if not fps_ok:
            rejection_reasons.append(f"Frame rate {actual_fps:.2f} fps below minimum {min_fps:.1f} fps.")

        # 4. Audio presence & clipping verification
        aud_ok = (not require_audio) or probe.has_audio_stream
        checks.append(
            VideoValidationCheck(
                name="audio_presence",
                passed=aud_ok,
                severity="error",
                measured_value=str(probe.has_audio_stream),
                expected_value=str(require_audio),
                details="Checks presence of normalized audio stream when required.",
            )
        )
        if not aud_ok:
            rejection_reasons.append("Required audio track missing from video.")

        clipping_ok = True
        if probe.has_audio_stream and probe.max_volume_db is not None:
            # Threshold <= -0.05 dBFS flags 0.0 dB full-scale sample saturation/clipping risk
            clipping_ok = probe.max_volume_db <= self.max_peak_db
            if not clipping_ok:
                rejection_reasons.append(
                    f"Audio peak {probe.max_volume_db:.2f} dB exceeds safe ceiling ({self.max_peak_db:.2f} dB)."
                )
        checks.append(
            VideoValidationCheck(
                name="audio_clipping",
                passed=clipping_ok,
                severity="error",
                measured_value=f"{probe.max_volume_db:.2f} dB" if probe.max_volume_db is not None else "n/a",
                expected_value=f"<= {self.max_peak_db:.2f} dB",
                details="Measures peak audio headroom via FFmpeg volumedetect.",
            )
        )

        # 5. Black frame detection
        black_ok = probe.black_frame_ratio <= self.max_black_ratio
        checks.append(
            VideoValidationCheck(
                name="black_frames",
                passed=black_ok,
                severity="error",
                measured_value=f"{probe.black_frame_duration_seconds:.2f}s ({probe.black_frame_ratio:.1%})",
                expected_value=f"<={self.max_black_ratio:.0%}",
                details="Rejects blank black screen stalls via FFmpeg blackdetect.",
            )
        )
        if not black_ok:
            rejection_reasons.append(
                f"Excessive black frames detected ({probe.black_frame_ratio:.1%} > {self.max_black_ratio:.0%})."
            )

        # 6. Product visibility / frame consistency & scene transitions check
        sim_score: Optional[float] = None
        transition_ok = True
        with tempfile.TemporaryDirectory(prefix="adpilot_vprobe_") as tmp_dir:
            tmp_path = Path(tmp_dir)
            mid_t = max(0.1, probe.duration_seconds * 0.5)
            sample_times = [min(probe.duration_seconds * 0.25, max(0.1, probe.duration_seconds - 0.2)), mid_t]
            if scene_cut_timestamps:
                for cut_t in scene_cut_timestamps:
                    if 0.05 < cut_t < probe.duration_seconds - 0.1:
                        sample_times.append(cut_t + 0.05)

            extracted = self.ffmpeg.extract_sample_frames(video_path, sample_times, tmp_path)
            if not extracted:
                transition_ok = False
                rejection_reasons.append("Could not sample visual keyframes from video.")
            else:
                low_var_count = 0
                best_sims: List[float] = []
                for ts, frame_img in extracted:
                    gray = frame_img.convert("L")
                    stddev = float(ImageStat.Stat(gray).stddev[0])
                    if stddev < 6.0:
                        low_var_count += 1
                    if reference_images:
                        sim = measure_reference_similarity(frame_img, reference_images)
                        if sim is not None:
                            best_sims.append(sim)

                if low_var_count == len(extracted):
                    transition_ok = False
                    rejection_reasons.append("All sampled frames appear blank or uniform color.")

                if best_sims:
                    sim_score = round(max(best_sims), 4)

        checks.append(
            VideoValidationCheck(
                name="scene_transitions",
                passed=transition_ok,
                severity="error",
                measured_value="valid" if transition_ok else "stalled/blank",
                expected_value="non-blank frames across scene boundaries",
                details="Checks decodable non-blank frames at scene transitions and midpoints.",
            )
        )

        prod_ok = True
        if sim_score is not None:
            prod_ok = sim_score >= self.min_similarity_score
            if not prod_ok:
                rejection_reasons.append(
                    f"Sampled frame product color similarity {sim_score:.3f} below threshold {self.min_similarity_score:.2f}."
                )
        checks.append(
            VideoValidationCheck(
                name="product_visibility",
                passed=prod_ok,
                severity="error",
                measured_value=f"{sim_score:.4f}" if sim_score is not None else "n/a",
                expected_value=f">={self.min_similarity_score:.2f}",
                details="Measures RGB distribution correlation of sampled frames vs product references.",
            )
        )

        return VideoValidationResult(
            approved=len(rejection_reasons) == 0,
            corrupt=False,
            duration_seconds=probe.duration_seconds,
            width=probe.width,
            height=probe.height,
            aspect_ratio=actual_ratio_str,
            fps=probe.fps,
            has_video_stream=probe.has_video_stream,
            has_audio_stream=probe.has_audio_stream,
            max_volume_db=probe.max_volume_db,
            mean_volume_db=probe.mean_volume_db,
            black_frame_duration_seconds=probe.black_frame_duration_seconds,
            black_frame_ratio=probe.black_frame_ratio,
            transition_frames_valid=transition_ok,
            product_similarity_score=sim_score,
            checks=checks,
            rejection_reasons=rejection_reasons,
            warnings=warnings,
        )
