"""
Reusable Step 08 video storyboard fixtures, real minimal MP4 clip builders (via FFmpeg),
and sinusoidal PCM WAV voiceover generators for testing Step 08 end-to-end.
"""

import io
import math
from pathlib import Path
import struct
import subprocess
import tempfile
from typing import Optional
import wave
from PIL import Image

from agent.app.schemas.creative import (
    GenerationPrompt,
    PlacementSpecification,
    ReferenceImageConstraints,
    VideoScene,
    VideoStoryboard,
)
from agent.app.services.video_gen.ffmpeg_processor import resolve_ffmpeg_exe
from agent.tests.fixtures.image_fixtures import (
    make_synthetic_product_image_bytes,
    make_unrelated_neon_image_bytes,
)


def make_sample_video_storyboard(
    total_duration: int = 9,
    aspect_ratio: str = "9:16",
    placement: str = "instagram_reels",
) -> VideoStoryboard:
    s_dur = total_duration // 3
    rem = total_duration - s_dur * 3
    d1, d2, d3 = s_dur, s_dur, s_dur + rem

    rc = ReferenceImageConstraints(
        preserve_geometry="Keep exact white cylindrical motor unit and stainless jar silhouette",
        preserve_logo="Keep Lifelong logo crisp on front housing",
        preserve_buttons_and_controls="Preserve tactile 3-speed rotary control knob",
        preserve_color_and_finish="White and cool grey housing with brushed stainless steel jars",
        preserve_dimensions_and_proportions="Accurate 1.25L jar proportions",
        recognizable_design_features=["White and grey housing", "Stainless steel jar", "3-speed rotary dial"],
        prohibited_inventions=["touchscreen LED", "cordless battery pack", "fabricated buttons"],
    )

    scenes = [
        VideoScene(
            scene_number=1,
            scene_duration=d1,
            opening_hook="Upgrade morning kitchen prep in seconds.",
            scene_description="Smooth push-in onto the Lifelong 500W mixer grinder centered on clean kitchen counter.",
            camera_movement="Gentle dolly push-in",
            product_visibility="Full front housing and stainless jar visible center-frame",
            voiceover_script="Meet your everyday 500-watt kitchen partner.",
            on_screen_text="500W Daily Power",
            sound_direction="Crisp countertop ambience and soft mechanical click",
            transition_instructions="Clean cut to close-up dial turn",
        ),
        VideoScene(
            scene_number=2,
            scene_duration=d2,
            opening_hook=None,
            scene_description="Close three-quarter view of the 3-speed rotary knob powering fresh chutney prep.",
            camera_movement="Slow 30-degree countertop arc",
            product_visibility="3-speed rotary dial and Lifelong logo centered sharply",
            voiceover_script="Three speeds plus pulse tackle spices effortlessly.",
            on_screen_text="3 Stainless Steel Jars",
            sound_direction="Smooth grinding hum",
            transition_instructions="Match cut to hero end frame",
        ),
        VideoScene(
            scene_number=3,
            scene_duration=d3,
            opening_hook=None,
            scene_description="Clean bright studio finish showing the compact mixer and 3 jars ready for service.",
            camera_movement="Stabilized gentle pull-back",
            product_visibility="Complete mixer set unobstructed inside safe vertical frame",
            voiceover_script="Order Lifelong LLM99 today.",
            on_screen_text="1 Year Brand Warranty",
            sound_direction="Warm resolving chime",
            transition_instructions="Clean hold on CTA",
        ),
    ]

    return VideoStoryboard(
        concept_id="vid_concept_hero_01",
        creative_title="Compact Countertop Power Reel",
        marketing_angle="Everyday 3-Jar Indian Cooking Efficiency",
        audience_hypothesis="Urban home cooks seeking compact reliable countertop appliances",
        video_objective="Drive product consideration and click-through on Reels",
        total_duration=total_duration,
        aspect_ratio=aspect_ratio,
        placement=placement,
        placement_spec=PlacementSpecification(
            placement=placement,
            format="video",
            aspect_ratio=aspect_ratio,
            recommended_resolution="1080x1920" if aspect_ratio == "9:16" else "1920x1080",
            safe_zone_notes="Reserve bottom 22% and top 14% safe zones.",
            default_duration_seconds=total_duration,
        ),
        opening_hook="Upgrade morning kitchen prep in seconds.",
        scene_sequence=scenes,
        final_cta="Shop Lifelong LLM99",
        brand_constraints=["Preserve Lifelong wordmark", "Maintain 3-speed rotary dial"],
        negative_instructions=["No invented touchscreen", "No cordless operation"],
        reference_constraints=rc,
        video_generation_prompt=GenerationPrompt(
            prompt_id="vid_prompt_01",
            target_medium="video",
            template_name="adpilot_video_storyboard_v1",
            positive_prompt="Photorealistic studio commercial video featuring the Lifelong LLM99 500W mixer grinder.",
            negative_prompt="warped dial, flickering logo, battery icon",
            aspect_ratio=aspect_ratio,
            reference_constraints=rc,
            style_tags=["commercial", "clean", "product_hero"],
        ),
    )


def make_real_mp4_bytes(
    width: int = 720,
    height: int = 1280,
    *,
    duration_seconds: float = 3.0,
    fps: int = 24,
    with_audio: bool = True,
    clipping_audio: bool = False,
    black_frames: bool = False,
    unrelated_colors: bool = False,
    variant_seed: int = 0,
) -> bytes:
    """Encode a fast real H.264/AAC MP4 fixture using bundled FFmpeg for realistic validation/assembly tests."""
    ffmpeg_exe = resolve_ffmpeg_exe()
    with tempfile.TemporaryDirectory(prefix="adpilot_vid_fix_") as tmp:
        tmp_dir = Path(tmp)
        frame_path = tmp_dir / "src.png"
        out_path = tmp_dir / "clip.mp4"

        if black_frames:
            Image.new("RGB", (width, height), (0, 0, 0)).save(frame_path, format="PNG")
        elif unrelated_colors:
            frame_path.write_bytes(make_unrelated_neon_image_bytes(width, height))
        else:
            frame_path.write_bytes(
                make_synthetic_product_image_bytes(width, height, fmt="PNG", variant_seed=variant_seed)
            )

        cmd = [
            ffmpeg_exe,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-loop",
            "1",
            "-i",
            str(frame_path),
        ]

        if with_audio:
            # Generate 440Hz sine wave: quiet safe (-12 dB -> amp ~0.25) or clipped (gain x12 -> 0 dBFS hard clip)
            cmd.extend(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    f"sine=frequency={440 + variant_seed * 60}:sample_rate=48000:duration={duration_seconds:.2f}",
                ]
            )

        cmd.extend(["-t", f"{duration_seconds:.2f}", "-r", str(fps), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"])
        if with_audio:
            if clipping_audio:
                cmd.extend(["-af", "volume=12.0,alimiter=limit=1.0:attack=0.1:release=1.0"])
            else:
                cmd.extend(["-af", "volume=0.25,aformat=channel_layouts=stereo"])
            cmd.extend(["-c:a", "aac", "-b:a", "128k"])
        else:
            cmd.append("-an")

        cmd.append(str(out_path))
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        if proc.returncode != 0 or not out_path.exists():
            raise RuntimeError(f"Failed generating synthetic MP4 fixture: {proc.stderr}")
        return out_path.read_bytes()


def make_voiceover_wav_bytes(duration_seconds: float = 9.0, sample_rate: int = 48000) -> bytes:
    """Create a valid stereo PCM WAV track at gentle speaking loudness (-15 dB)."""
    num_frames = int(duration_seconds * sample_rate)
    amp = int(32767 * 0.18)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        # Fast chunked sine generation
        frames = bytearray()
        two_pi_f = 2.0 * math.pi * 220.0 / sample_rate
        for i in range(num_frames):
            val = int(amp * math.sin(two_pi_f * i))
            frames.extend(struct.pack("<hh", val, val))
        wf.writeframes(bytes(frames))
    return buf.getvalue()
