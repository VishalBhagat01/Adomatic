"""
AdPilot AI - FFmpeg Multimedia Processing Engine (Step 08)
Handles scene clip probing, black-frame & audio-volume measurement, aspect-preserving
normalization, multi-scene concatenation, placement-safe Pillow/PNG subtitle & CTA
compositing, voiceover mixing, EBU R128 loudness normalization, and MP4 export.
"""

from dataclasses import dataclass
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import textwrap
from typing import Dict, List, Optional, Tuple
import imageio_ffmpeg
from PIL import Image, ImageDraw

from agent.app.core.config import settings
from agent.app.schemas.creative import VideoScene, VideoStoryboard
from agent.app.schemas.product import Product
from agent.app.services.image_gen.overlay_renderer import (
    _format_verified_price_badge,
    _load_font,
)


class FFmpegProcessingError(RuntimeError):
    """Raised when FFmpeg invocation fails or binaries cannot be resolved."""


@dataclass
class VideoProbeInfo:
    corrupt: bool
    duration_seconds: float = 0.0
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    has_video_stream: bool = False
    has_audio_stream: bool = False
    max_volume_db: Optional[float] = None
    mean_volume_db: Optional[float] = None
    black_frame_duration_seconds: float = 0.0
    black_frame_ratio: float = 0.0
    error: Optional[str] = None


@dataclass
class TimedOverlaySegment:
    image_path: Path
    start_sec: float
    end_sec: float
    kind: str  # "subtitle" | "cta"


def resolve_ffmpeg_exe() -> str:
    if settings.FFMPEG_BINARY and Path(settings.FFMPEG_BINARY).exists():
        return settings.FFMPEG_BINARY
    which_exe = shutil.which("ffmpeg")
    if which_exe:
        return which_exe
    bundled = imageio_ffmpeg.get_ffmpeg_exe()
    if bundled and Path(bundled).exists():
        return bundled
    raise FFmpegProcessingError("No ffmpeg executable found in PATH or bundled imageio-ffmpeg.")


def resolve_ffprobe_exe() -> Optional[str]:
    if settings.FFPROBE_BINARY and Path(settings.FFPROBE_BINARY).exists():
        return settings.FFPROBE_BINARY
    return shutil.which("ffprobe")


def _run_subprocess(cmd: List[str], timeout: float = 120.0) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def _format_srt_timestamp(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    hrs, rem = divmod(ms_total, 3600000)
    mins, rem = divmod(rem, 60000)
    secs, ms = divmod(rem, 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"


class FFmpegProcessor:
    """Stateless FFmpeg / Pillow multimedia processor for video validation & assembly."""

    def __init__(self, ffmpeg_exe: Optional[str] = None, ffprobe_exe: Optional[str] = None):
        self.ffmpeg_exe = ffmpeg_exe or resolve_ffmpeg_exe()
        self.ffprobe_exe = ffprobe_exe if ffprobe_exe is not None else resolve_ffprobe_exe()

    def probe_video(self, video_path: Path, run_signal_checks: bool = True) -> VideoProbeInfo:
        """
        Inspect video/audio streams, duration, resolution, FPS, black frames, and volume levels.
        Uses ffprobe if installed, otherwise parses ffmpeg inspection & filter logs reliably.
        """
        if not video_path.exists() or video_path.stat().st_size == 0:
            return VideoProbeInfo(corrupt=True, error="Video file is missing or 0 bytes.")

        info = VideoProbeInfo(corrupt=False)
        parsed_header = False

        if self.ffprobe_exe:
            proc = _run_subprocess(
                [
                    self.ffprobe_exe,
                    "-v",
                    "quiet",
                    "-print_format",
                    "json",
                    "-show_format",
                    "-show_streams",
                    str(video_path),
                ]
            )
            if proc.returncode == 0 and proc.stdout.strip():
                try:
                    data = json.loads(proc.stdout)
                    fmt = data.get("format") or {}
                    info.duration_seconds = float(fmt.get("duration") or 0.0)
                    for st in data.get("streams") or []:
                        if st.get("codec_type") == "video" and not info.has_video_stream:
                            info.has_video_stream = True
                            info.width = int(st.get("width") or 0) or None
                            info.height = int(st.get("height") or 0) or None
                            rate_str = st.get("r_frame_rate") or st.get("avg_frame_rate") or "0/1"
                            if "/" in rate_str:
                                num, den = rate_str.split("/", 1)
                                info.fps = round(float(num) / max(1.0, float(den)), 2)
                            if info.duration_seconds <= 0 and st.get("duration"):
                                info.duration_seconds = float(st["duration"])
                        elif st.get("codec_type") == "audio":
                            info.has_audio_stream = True
                    parsed_header = True
                except Exception:
                    parsed_header = False

        if not parsed_header:
            proc = _run_subprocess([self.ffmpeg_exe, "-hide_banner", "-i", str(video_path)])
            stderr = proc.stderr or ""
            dur_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", stderr)
            vid_match = re.search(
                r"Stream\s+#\d+:\d+.*?:\s*Video:.*?,\s*(\d{2,5})x(\d{2,5})(?:[^\n]*?(\d+(?:\.\d+)?)\s*(?:fps|tbr))?",
                stderr,
            )
            aud_match = re.search(r"Stream\s+#\d+:\d+.*?:\s*Audio:", stderr)

            if not vid_match or not dur_match:
                return VideoProbeInfo(
                    corrupt=True,
                    error=f"Unreadable or corrupt video stream: {stderr.strip()[:260]}",
                )

            hrs, mins, secs = int(dur_match.group(1)), int(dur_match.group(2)), float(dur_match.group(3))
            info.duration_seconds = round(hrs * 3600 + mins * 60 + secs, 3)
            info.has_video_stream = True
            info.width = int(vid_match.group(1))
            info.height = int(vid_match.group(2))
            if vid_match.group(3):
                info.fps = round(float(vid_match.group(3)), 2)
            info.has_audio_stream = aud_match is not None

        if not info.has_video_stream or info.duration_seconds <= 0:
            return VideoProbeInfo(corrupt=True, error="No decodable video frames or non-positive duration.")

        if run_signal_checks:
            # Verify full container decode & detect prolonged black frames
            bd_proc = _run_subprocess(
                [
                    self.ffmpeg_exe,
                    "-hide_banner",
                    "-v",
                    "info",
                    "-i",
                    str(video_path),
                    "-vf",
                    "blackdetect=d=0.10:pix_th=0.10",
                    "-an",
                    "-f",
                    "null",
                    "-",
                ]
            )
            if bd_proc.returncode != 0:
                return VideoProbeInfo(
                    corrupt=True,
                    duration_seconds=info.duration_seconds,
                    width=info.width,
                    height=info.height,
                    fps=info.fps,
                    has_video_stream=info.has_video_stream,
                    has_audio_stream=info.has_audio_stream,
                    error=f"FFmpeg decode verification failed: {(bd_proc.stderr or '')[-260:]}",
                )
            black_secs = sum(float(m) for m in re.findall(r"black_duration:\s*([0-9.]+)", bd_proc.stderr or ""))
            info.black_frame_duration_seconds = round(black_secs, 3)
            info.black_frame_ratio = round(min(1.0, black_secs / max(0.01, info.duration_seconds)), 4)

            if info.has_audio_stream:
                vd_proc = _run_subprocess(
                    [
                        self.ffmpeg_exe,
                        "-hide_banner",
                        "-i",
                        str(video_path),
                        "-vn",
                        "-af",
                        "volumedetect",
                        "-f",
                        "null",
                        "-",
                    ]
                )
                max_m = re.search(r"max_volume:\s*([-0-9.]+)\s*dB", vd_proc.stderr or "")
                mean_m = re.search(r"mean_volume:\s*([-0-9.]+)\s*dB", vd_proc.stderr or "")
                if max_m:
                    info.max_volume_db = float(max_m.group(1))
                if mean_m:
                    info.mean_volume_db = float(mean_m.group(1))

        return info

    def extract_sample_frames(
        self,
        video_path: Path,
        timestamps: List[float],
        output_dir: Path,
    ) -> List[Tuple[float, Image.Image]]:
        """Decode representative video frames at explicit timestamps into PIL RGB images."""
        output_dir.mkdir(parents=True, exist_ok=True)
        frames: List[Tuple[float, Image.Image]] = []
        for idx, ts in enumerate(timestamps):
            frame_path = output_dir / f"probe_frame_{idx}.png"
            proc = _run_subprocess(
                [
                    self.ffmpeg_exe,
                    "-hide_banner",
                    "-y",
                    "-ss",
                    f"{max(0.0, ts):.3f}",
                    "-i",
                    str(video_path),
                    "-frames:v",
                    "1",
                    str(frame_path),
                ]
            )
            if proc.returncode == 0 and frame_path.exists():
                with Image.open(frame_path) as im:
                    frames.append((ts, im.convert("RGB")))
        return frames

    def normalize_scene_clip(
        self,
        *,
        input_path: Path,
        output_path: Path,
        target_duration: int,
        width: int,
        height: int,
        fps: int,
    ) -> VideoProbeInfo:
        """
        Normalize raw Veo scene clip without stretching or distorting the product:
        - Exact duration trim (cloning final frame safely if raw clip is slightly short)
        - Aspect-preserving scale + centered pad (`force_original_aspect_ratio=decrease`)
        - Uniform frame rate & pixel format (`yuv420p`)
        - Uniform 48kHz stereo audio stream (adding silent stream if raw lacked audio)
        """
        probe = self.probe_video(input_path, run_signal_checks=False)
        if probe.corrupt:
            raise FFmpegProcessingError(f"Cannot normalize corrupt clip '{input_path}': {probe.error}")

        pad_filter = ""
        if probe.duration_seconds < target_duration:
            extra = max(0.0, target_duration - probe.duration_seconds + 0.1)
            pad_filter = f"tpad=stop_mode=clone:stop_duration={extra:.3f},"

        vf = (
            f"{pad_filter}"
            f"fps={fps},"
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
            f"setsar=1,format=yuv420p"
        )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        if probe.has_audio_stream:
            cmd = [
                self.ffmpeg_exe,
                "-hide_banner",
                "-y",
                "-i",
                str(input_path),
                "-t",
                f"{target_duration:.3f}",
                "-vf",
                vf,
                "-af",
                "aresample=async=1",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                str(output_path),
            ]
        else:
            cmd = [
                self.ffmpeg_exe,
                "-hide_banner",
                "-y",
                "-i",
                str(input_path),
                "-f",
                "lavfi",
                "-t",
                f"{target_duration:.3f}",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-t",
                f"{target_duration:.3f}",
                "-vf",
                vf,
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                str(output_path),
            ]

        proc = _run_subprocess(cmd)
        if proc.returncode != 0:
            raise FFmpegProcessingError(
                f"Scene normalization failed for '{input_path}': {(proc.stderr or '')[-400:]}"
            )
        return self.probe_video(output_path, run_signal_checks=True)

    def build_srt_and_overlay_pngs(
        self,
        *,
        storyboard: VideoStoryboard,
        product_data: Product,
        aspect_ratio: str,
        width: int,
        height: int,
        work_dir: Path,
        include_subtitles: bool,
        include_cta: bool,
    ) -> Tuple[Optional[Path], List[TimedOverlaySegment]]:
        """Render clean SRT captions and placement-safe RGBA PNG overlays for subtitles & CTA."""
        work_dir.mkdir(parents=True, exist_ok=True)
        segments: List[TimedOverlaySegment] = []
        srt_lines: List[str] = []

        subtitle_font = _load_font(max(20, int(width * 0.042)))
        cta_font = _load_font(max(18, int(width * 0.036)))
        price_badge = _format_verified_price_badge(product_data)

        # Keep lower overlays above Instagram Reels bottom 22% caption UI zone
        subtitle_y_ratio = 0.70 if aspect_ratio == "9:16" else 0.78
        cta_y_ratio = 0.78 if aspect_ratio == "9:16" else 0.85

        cursor = 0.0
        for idx, scene in enumerate(storyboard.scene_sequence, start=1):
            start_t = cursor
            end_t = cursor + float(scene.scene_duration)
            cursor = end_t

            caption = (scene.on_screen_text or scene.voiceover_script or "").strip()
            if caption:
                srt_lines.append(
                    f"{idx}\n{_format_srt_timestamp(start_t)} --> {_format_srt_timestamp(end_t)}\n{caption}\n"
                )

            if include_subtitles and caption:
                overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                draw = ImageDraw.Draw(overlay)
                wrapped = textwrap.fill(caption[:85], width=28 if width <= 720 else 34)
                bbox = draw.multiline_textbbox((0, 0), wrapped, font=subtitle_font, spacing=6, align="center")
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                pad_x, pad_y = int(width * 0.035), int(height * 0.015)
                box_x0 = max(24, (width - tw) // 2 - pad_x)
                box_x1 = min(width - 24, box_x0 + tw + pad_x * 2)
                box_y0 = int(height * subtitle_y_ratio) - th // 2 - pad_y
                box_y1 = box_y0 + th + pad_y * 2
                draw.rounded_rectangle((box_x0, box_y0, box_x1, box_y1), radius=14, fill=(10, 14, 24, 200))
                draw.multiline_text(
                    (box_x0 + pad_x, box_y0 + pad_y),
                    wrapped,
                    font=subtitle_font,
                    fill=(248, 250, 252, 255),
                    spacing=6,
                    align="center",
                )
                png_path = work_dir / f"subtitle_s{scene.scene_number}.png"
                overlay.save(png_path, format="PNG")
                # End slightly before last CTA if last scene uses CTA banner below
                seg_end = end_t - 0.05 if not (include_cta and idx == len(storyboard.scene_sequence)) else max(start_t + 0.5, end_t - 0.1)
                segments.append(
                    TimedOverlaySegment(
                        image_path=png_path,
                        start_sec=start_t,
                        end_sec=seg_end,
                        kind="subtitle",
                    )
                )

        if include_cta and storyboard.final_cta.strip():
            last_scene = storyboard.scene_sequence[-1]
            cta_end = cursor
            cta_start = max(0.0, cursor - float(last_scene.scene_duration))
            overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            label = storyboard.final_cta.strip()[:48]
            if price_badge and price_badge not in label and len(label) < 32:
                label = f"{label}  •  {price_badge}"
            bbox = draw.textbbox((0, 0), label, font=cta_font)
            cw = bbox[2] - bbox[0]
            ch = bbox[3] - bbox[1]
            pad_x, pad_y = int(width * 0.045), int(height * 0.016)
            box_x0 = max(24, (width - cw) // 2 - pad_x)
            box_x1 = min(width - 24, box_x0 + cw + pad_x * 2)
            box_y0 = int(height * cta_y_ratio)
            box_y1 = min(height - 24, box_y0 + ch + pad_y * 2)
            draw.rounded_rectangle((box_x0, box_y0, box_x1, box_y1), radius=999, fill=(79, 70, 229, 238))
            draw.text(
                (box_x0 + pad_x, box_y0 + pad_y - bbox[1]),
                label,
                font=cta_font,
                fill=(255, 255, 255, 255),
            )
            cta_png = work_dir / "cta_overlay.png"
            overlay.save(cta_png, format="PNG")
            segments.append(
                TimedOverlaySegment(
                    image_path=cta_png,
                    start_sec=cta_start,
                    end_sec=cta_end,
                    kind="cta",
                )
            )

        srt_path = None
        if srt_lines:
            srt_path = work_dir / "captions.srt"
            srt_path.write_text("\n".join(srt_lines), encoding="utf-8")

        return srt_path, segments

    def assemble_final_video(
        self,
        *,
        scene_clip_paths: List[Path],
        output_path: Path,
        overlay_segments: List[TimedOverlaySegment],
        voiceover_track_path: Optional[Path] = None,
        fps: int = 24,
    ) -> VideoProbeInfo:
        """
        Concatenate normalized scene clips, apply timed subtitle & CTA PNG overlays,
        mix optional voiceover track with EBU R128 loudness normalization, and export MP4.
        """
        if not scene_clip_paths:
            raise FFmpegProcessingError("Cannot assemble final video with zero normalized scene clips.")

        cmd: List[str] = [self.ffmpeg_exe, "-hide_banner", "-y"]
        for clip in scene_clip_paths:
            cmd.extend(["-i", str(clip)])

        overlay_input_offset = len(scene_clip_paths)
        for seg in overlay_segments:
            cmd.extend(["-loop", "1", "-i", str(seg.image_path)])

        voiceover_idx: Optional[int] = None
        if voiceover_track_path is not None and voiceover_track_path.exists():
            voiceover_idx = overlay_input_offset + len(overlay_segments)
            cmd.extend(["-i", str(voiceover_track_path)])

        n = len(scene_clip_paths)
        filter_steps: List[str] = []

        concat_inputs = "".join(f"[{i}:v:0][{i}:a:0]" for i in range(n))
        filter_steps.append(f"{concat_inputs}concat=n={n}:v=1:a=1[vbase][abase]")

        v_label = "vbase"
        for idx, seg in enumerate(overlay_segments):
            in_idx = overlay_input_offset + idx
            next_label = f"vov{idx}"
            filter_steps.append(
                f"[{v_label}][{in_idx}:v]overlay=0:0:shortest=1:enable='between(t,{seg.start_sec:.3f},{seg.end_sec:.3f})'[{next_label}]"
            )
            v_label = next_label

        if voiceover_idx is not None:
            filter_steps.append("[abase]volume=0.30[aduck]")
            filter_steps.append(
                f"[{voiceover_idx}:a]aresample=async=1,aformat=channel_layouts=stereo[avo]"
            )
            filter_steps.append("[aduck][avo]amix=inputs=2:duration=first:dropout_transition=1[amix]")
            filter_steps.append("[amix]loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
        else:
            filter_steps.append("[abase]loudnorm=I=-16:TP=-1.5:LRA=11[aout]")

        filter_complex = ";".join(filter_steps)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.extend(
            [
                "-filter_complex",
                filter_complex,
                "-map",
                f"[{v_label}]",
                "-map",
                "[aout]",
                "-r",
                str(fps),
                "-ar",
                "48000",
                "-ac",
                "2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "22",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
        )

        proc = _run_subprocess(cmd, timeout=240.0)
        if proc.returncode != 0:
            raise FFmpegProcessingError(
                f"Final FFmpeg video assembly failed: {(proc.stderr or '')[-500:]}"
            )
        return self.probe_video(output_path, run_signal_checks=True)

