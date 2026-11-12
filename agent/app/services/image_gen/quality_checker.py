"""
AdPilot AI - Deterministic Generated Image Quality Validator (Step 07)
Performs honest, reproducible Pillow-based checks:
1. Image readability & raster decode integrity
2. Output format validation (PNG / JPEG / WEBP)
3. File size bounds
4. Minimum pixel dimensions
5. Target aspect ratio alignment (4:5, 1:1, 9:16)
6. Visual quality / anti-blank / extreme clipping check
7. Exact SHA-256 & 64-bit dHash perceptual duplicate detection across batch
8. Reference-image color-histogram & coarse luminance consistency score
"""

import hashlib
import io
import math
from typing import Iterable, List, Optional, Sequence, Tuple
from PIL import Image, ImageStat

from agent.app.core.config import settings
from agent.app.schemas.image_gen import ImageValidationCheck, ImageValidationResult
from agent.app.services.image_gen.reference_selector import LoadedReferenceImage

SUPPORTED_OUTPUT_FORMATS = {"PNG", "JPEG", "WEBP"}
TARGET_ASPECT_RATIOS = {
    "1:1": 1.0,
    "4:5": 0.8,
    "9:16": 9.0 / 16.0,
}
ASPECT_TOLERANCE = 0.085
MAX_DHASH_DISTANCE = 4


def _get_gray_pixels(gray_img: Image.Image) -> List[int]:
    """Extract grayscale pixel list compatible across Pillow 10–14+ without deprecation warnings."""
    if hasattr(gray_img, "get_flattened_data"):
        return list(gray_img.get_flattened_data())
    return list(gray_img.getdata())


def compute_dhash(pil_img: Image.Image, hash_size: int = 8) -> int:
    """Compute 64-bit horizontal gradient difference hash for perceptual duplicate detection."""
    gray = pil_img.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = _get_gray_pixels(gray)
    bits = 0
    row_stride = hash_size + 1
    for row in range(hash_size):
        row_offset = row * row_stride
        for col in range(hash_size):
            left = pixels[row_offset + col]
            right = pixels[row_offset + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return bits


def hamming_distance(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def _normalized_rgb_histogram(pil_img: Image.Image) -> List[float]:
    """Build compact 48-bin (16 bins x 3 channels) normalized RGB distribution vector."""
    rgb = pil_img.convert("RGB").resize((128, 128), Image.Resampling.BILINEAR)
    raw_hist = rgb.histogram()  # 256*3 = 768 values
    bins: List[float] = []
    for channel in range(3):
        offset = channel * 256
        for b in range(16):
            bins.append(float(sum(raw_hist[offset + b * 16 : offset + (b + 1) * 16])))
    norm = math.sqrt(sum(v * v for v in bins))
    if norm == 0.0:
        return [0.0] * len(bins)
    return [v / norm for v in bins]


def _cosine_similarity(vec_a: Sequence[float], vec_b: Sequence[float]) -> float:
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    return max(0.0, min(1.0, dot))


def measure_reference_similarity(
    generated_rgb: Image.Image,
    references: Iterable[LoadedReferenceImage],
) -> Optional[float]:
    """
    Compute measured tonal/color distribution similarity against product references.
    Evaluates both full frame and center-60% subject crop, taking max similarity per ref.
    Note: Measures color-palette consistency, not semantic object geometry.
    """
    refs = list(references)
    if not refs:
        return None

    w, h = generated_rgb.size
    cx0, cy0 = int(w * 0.2), int(h * 0.2)
    cx1, cy1 = max(cx0 + 1, int(w * 0.8)), max(cy0 + 1, int(h * 0.8))
    gen_center = generated_rgb.crop((cx0, cy0, cx1, cy1))

    gen_full_hist = _normalized_rgb_histogram(generated_rgb)
    gen_center_hist = _normalized_rgb_histogram(gen_center)

    best_score = 0.0
    for ref in refs:
        ref_hist = _normalized_rgb_histogram(ref.pil_image)
        sim_full = _cosine_similarity(gen_full_hist, ref_hist)
        sim_center = _cosine_similarity(gen_center_hist, ref_hist)
        best_score = max(best_score, sim_full, sim_center)

    return round(best_score, 4)


class ImageQualityChecker:
    """Validates generated commercial product visuals and flags unreadable or defective outputs."""

    def __init__(
        self,
        min_width: Optional[int] = None,
        min_height: Optional[int] = None,
        max_file_bytes: Optional[int] = None,
        min_similarity_score: Optional[float] = None,
    ):
        self.min_width = settings.IMAGE_MIN_WIDTH if min_width is None else min_width
        self.min_height = settings.IMAGE_MIN_HEIGHT if min_height is None else min_height
        self.max_file_bytes = settings.IMAGE_MAX_FILE_BYTES if max_file_bytes is None else max_file_bytes
        self.min_similarity_score = (
            settings.IMAGE_SIMILARITY_MIN_SCORE if min_similarity_score is None else min_similarity_score
        )

    def validate(
        self,
        *,
        image_bytes: bytes,
        expected_aspect_ratio: str,
        reference_images: List[LoadedReferenceImage],
        seen_sha256: set[str],
        seen_dhashes: List[int],
    ) -> Tuple[ImageValidationResult, Optional[int], Optional[Image.Image]]:
        """
        Inspect generated image bytes and return `(ImageValidationResult, dhash_int, decoded_rgb)`.
        Never marks failed generations approved.
        """
        checks: List[ImageValidationCheck] = []
        rejection_reasons: List[str] = []
        warnings: List[str] = []

        file_size = len(image_bytes) if image_bytes else 0
        sha256 = hashlib.sha256(image_bytes).hexdigest() if image_bytes else None

        # 1. File size bounds
        size_ok = 1024 <= file_size <= self.max_file_bytes
        checks.append(
            ImageValidationCheck(
                name="file_size",
                passed=size_ok,
                severity="error",
                measured_value=f"{file_size} bytes",
                expected_value=f"1024..{self.max_file_bytes} bytes",
                details="Validates non-empty payload within object storage size limits.",
            )
        )
        if not size_ok:
            rejection_reasons.append(f"Image file size {file_size} bytes outside valid bounds.")

        # 2. Image readability & pixel decoding
        decoded_img: Optional[Image.Image] = None
        detected_format: Optional[str] = None
        width: Optional[int] = None
        height: Optional[int] = None
        try:
            opened = Image.open(io.BytesIO(image_bytes))
            detected_format = (opened.format or "").upper()
            opened.load()
            decoded_img = opened.convert("RGB")
            width, height = decoded_img.size
            checks.append(
                ImageValidationCheck(
                    name="readability",
                    passed=True,
                    severity="error",
                    measured_value="decoded",
                    expected_value="decoded",
                    details="Image stream decoded cleanly by Pillow.",
                )
            )
        except Exception as exc:
            checks.append(
                ImageValidationCheck(
                    name="readability",
                    passed=False,
                    severity="error",
                    measured_value="unreadable",
                    expected_value="decoded",
                    details=f"Corrupt or non-image payload: {exc}",
                )
            )
            rejection_reasons.append(f"Generated image could not be decoded cleanly: {exc}")
            return (
                ImageValidationResult(
                    approved=False,
                    checks=checks,
                    rejection_reasons=rejection_reasons,
                    warnings=warnings,
                    file_size_bytes=file_size,
                    sha256_hash=sha256,
                ),
                None,
                None,
            )

        # 3. Format check
        fmt_ok = detected_format in SUPPORTED_OUTPUT_FORMATS
        checks.append(
            ImageValidationCheck(
                name="format",
                passed=fmt_ok,
                severity="error",
                measured_value=detected_format,
                expected_value="/".join(sorted(SUPPORTED_OUTPUT_FORMATS)),
                details="Verifies web-compatible raster output encoding.",
            )
        )
        if not fmt_ok:
            rejection_reasons.append(f"Unsupported image format '{detected_format}'.")

        # 4. Dimension check
        dims_ok = width >= self.min_width and height >= self.min_height
        checks.append(
            ImageValidationCheck(
                name="dimensions",
                passed=dims_ok,
                severity="error",
                measured_value=f"{width}x{height}",
                expected_value=f">={self.min_width}x{self.min_height}",
                details="Verifies minimum commercial resolution thresholds.",
            )
        )
        if not dims_ok:
            rejection_reasons.append(
                f"Dimensions {width}x{height} below required minimum {self.min_width}x{self.min_height}."
            )

        # 5. Aspect ratio check
        actual_fraction = width / max(1, height)
        actual_ratio_str = f"{actual_fraction:.3f}"
        expected_fraction = TARGET_ASPECT_RATIOS.get(expected_aspect_ratio)
        ratio_ok = True
        if expected_fraction is not None:
            diff = abs(actual_fraction - expected_fraction)
            ratio_ok = diff <= ASPECT_TOLERANCE
        checks.append(
            ImageValidationCheck(
                name="aspect_ratio",
                passed=ratio_ok,
                severity="error",
                measured_value=f"{width}:{height} ({actual_ratio_str})",
                expected_value=expected_aspect_ratio,
                details=f"Checks output ratio tolerance within +/-{ASPECT_TOLERANCE}.",
            )
        )
        if not ratio_ok:
            rejection_reasons.append(
                f"Aspect ratio {width}x{height} ({actual_ratio_str}) mismatches requested {expected_aspect_ratio}."
            )

        # 6. Exact & perceptual duplicate check
        dhash_val = compute_dhash(decoded_img)
        dhash_hex = f"{dhash_val:016x}"
        is_exact_dup = sha256 in seen_sha256
        min_hamming = min((hamming_distance(dhash_val, prev) for prev in seen_dhashes), default=64)
        is_near_dup = min_hamming <= MAX_DHASH_DISTANCE
        dup_ok = not (is_exact_dup or is_near_dup)
        checks.append(
            ImageValidationCheck(
                name="duplicate",
                passed=dup_ok,
                severity="error",
                measured_value=f"exact={is_exact_dup}, min_dhash_dist={min_hamming}",
                expected_value=f"unique (dhash_dist>{MAX_DHASH_DISTANCE})",
                details="Prevents storing duplicate variations within the same creative batch.",
            )
        )
        if not dup_ok:
            rejection_reasons.append(
                f"Image duplicate detected (exact={is_exact_dup}, min_perceptual_distance={min_hamming})."
            )

        # 7. Basic visual quality (blank / uniform / severe clipping)
        gray = decoded_img.convert("L")
        stddev = float(ImageStat.Stat(gray).stddev[0])
        sampled = gray.resize((64, 64), Image.Resampling.BILINEAR)
        px_vals = _get_gray_pixels(sampled)
        extreme_clip_ratio = sum(1 for p in px_vals if p <= 2 or p >= 253) / max(1, len(px_vals))
        visual_ok = stddev >= 8.0 and extreme_clip_ratio < 0.95
        checks.append(
            ImageValidationCheck(
                name="visual_quality",
                passed=visual_ok,
                severity="error",
                measured_value=f"stddev={stddev:.2f}, extreme_clip={extreme_clip_ratio:.2%}",
                expected_value="stddev>=8.0, extreme_clip<95%",
                details="Detects blank, solid-color, washed-out, or severely clipped images.",
            )
        )
        if not visual_ok:
            rejection_reasons.append(
                f"Failed visual quality check (luminance stddev={stddev:.2f}, extreme_clip={extreme_clip_ratio:.2%})."
            )

        # 8. Reference image similarity check
        ref_sim = measure_reference_similarity(decoded_img, reference_images)
        sim_ok = True
        if ref_sim is not None:
            sim_ok = ref_sim >= self.min_similarity_score
            if not sim_ok:
                rejection_reasons.append(
                    f"Reference color/tonal similarity {ref_sim:.3f} below threshold {self.min_similarity_score:.2f}."
                )
        checks.append(
            ImageValidationCheck(
                name="reference_similarity",
                passed=sim_ok,
                severity="error",
                measured_value=f"{ref_sim:.4f}" if ref_sim is not None else "n/a",
                expected_value=f">={self.min_similarity_score:.2f}",
                details="Measures color-distribution similarity between center/full output and reference photos.",
            )
        )

        approved = len(rejection_reasons) == 0
        return (
            ImageValidationResult(
                approved=approved,
                checks=checks,
                rejection_reasons=rejection_reasons,
                warnings=warnings,
                width=width,
                height=height,
                detected_format=detected_format,
                file_size_bytes=file_size,
                actual_aspect_ratio=actual_ratio_str,
                sha256_hash=sha256,
                perceptual_hash=dhash_hex,
                reference_similarity_score=ref_sim,
                pixel_std_dev=round(stddev, 2),
            ),
            dhash_val,
            decoded_img,
        )
