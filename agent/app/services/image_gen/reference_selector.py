"""
AdPilot AI - Product Reference Image Selector (Step 07)
Retrieves, validates, scores, deduplicates, and prepares the most useful
original product reference images as Gemini multimodal image inputs.
"""

from dataclasses import dataclass
import hashlib
import io
from typing import Callable, List, Optional, Tuple
import httpx
from PIL import Image, ImageOps
from google.genai import types

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.image_gen import ReferenceImageSelection
from agent.app.schemas.product import Product
from agent.app.services.extractor.ssrf import validate_safe_url
from agent.app.services.strategy.image_loader import ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES

MIN_REFERENCE_DIMENSION = 150


class ReferenceSelectionError(ValueError):
    """Raised when zero usable product reference images can be retrieved or validated."""


@dataclass
class LoadedReferenceImage:
    selection: ReferenceImageSelection
    image_bytes: bytes
    pil_image: Image.Image
    part: types.Part
    sha256: str


def _score_reference_candidate(
    *,
    is_primary: bool,
    width: int,
    height: int,
    mime_type: str,
) -> Tuple[float, str]:
    reasons: List[str] = []
    score = 0.0

    if is_primary:
        score += 50.0
        reasons.append("primary_product_image(+50)")

    min_side = min(width, height)
    res_bonus = min(30.0, (min_side / 1000.0) * 30.0)
    score += round(res_bonus, 2)
    reasons.append(f"resolution_{width}x{height}(+{res_bonus:.1f})")

    ratio = width / max(1, height)
    if 0.55 <= ratio <= 1.85:
        score += 10.0
        reasons.append("balanced_product_aspect(+10)")

    if mime_type == "image/png":
        score += 5.0
        reasons.append("lossless_png(+5)")

    return round(score, 2), ", ".join(reasons)


class ReferenceImageSelector:
    """Safely fetches, decodes, ranks, and prepares product reference images."""

    def __init__(
        self,
        max_references: Optional[int] = None,
        timeout_seconds: float = 10.0,
        client_factory: Optional[Callable[[], httpx.AsyncClient]] = None,
        resolve_dns: bool = True,
    ):
        self.max_references = max_references or settings.IMAGE_MAX_REFERENCE_IMAGES
        self.timeout_seconds = timeout_seconds
        self._client_factory = client_factory
        self.resolve_dns = resolve_dns

    def _build_client(self) -> httpx.AsyncClient:
        if self._client_factory is not None:
            return self._client_factory()
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout_seconds),
            follow_redirects=False,
        )

    async def select_references(
        self,
        product_data: Product,
        override_urls: Optional[List[str]] = None,
    ) -> Tuple[List[LoadedReferenceImage], List[str]]:
        """
        Retrieve and score up to `max_references` distinct, high-quality product photos.
        Returns `(selected_references, non_fatal_warnings)`.
        """
        warnings: List[str] = []
        candidates: List[Tuple[str, bool]] = []
        seen_urls = set()

        if override_urls:
            for idx, url in enumerate(override_urls):
                clean = (url or "").strip()
                if clean and clean not in seen_urls:
                    seen_urls.add(clean)
                    candidates.append((clean, idx == 0))
        else:
            sorted_imgs = sorted(product_data.images, key=lambda img: not img.is_primary)
            for img in sorted_imgs:
                clean = (img.url or "").strip()
                if clean and clean not in seen_urls:
                    seen_urls.add(clean)
                    candidates.append((clean, bool(img.is_primary)))

        if not candidates:
            raise ReferenceSelectionError(
                "No product reference image URLs available; image generation requires authentic product visuals."
            )

        loaded_candidates: List[LoadedReferenceImage] = []
        seen_hashes = set()

        # Fetch slightly more than max_references so we can drop corrupt/duplicate images cleanly
        fetch_limit = max(self.max_references * 2, self.max_references + 2)
        async with self._build_client() as client:
            for url, is_primary in candidates[:fetch_limit]:
                is_safe, canonical_url, ssrf_err = validate_safe_url(url, resolve_dns=self.resolve_dns)
                if not is_safe or not canonical_url:
                    warnings.append(f"Skipped unsafe reference URL '{url}': {ssrf_err}")
                    continue

                try:
                    resp = await client.get(canonical_url)
                except Exception as exc:
                    warnings.append(f"Failed fetching reference '{canonical_url}': {exc}")
                    continue

                if resp.status_code != 200:
                    warnings.append(f"Reference '{canonical_url}' returned HTTP {resp.status_code}")
                    continue

                raw_mime = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if raw_mime == "image/jpg":
                    raw_mime = "image/jpeg"
                if raw_mime and raw_mime not in ALLOWED_IMAGE_MIME_TYPES:
                    warnings.append(f"Skipped reference '{canonical_url}' unsupported MIME '{raw_mime}'")
                    continue

                raw_bytes = resp.content
                if not raw_bytes:
                    warnings.append(f"Skipped empty reference image '{canonical_url}'")
                    continue
                if len(raw_bytes) > MAX_IMAGE_BYTES:
                    warnings.append(f"Skipped oversized reference '{canonical_url}' ({len(raw_bytes)} bytes)")
                    continue

                digest = hashlib.sha256(raw_bytes).hexdigest()
                if digest in seen_hashes:
                    warnings.append(f"Deduplicated identical reference bytes from '{canonical_url}'")
                    continue

                try:
                    img = Image.open(io.BytesIO(raw_bytes))
                    img.load()
                    img = ImageOps.exif_transpose(img)
                except Exception as exc:
                    warnings.append(f"Unreadable reference image '{canonical_url}': {exc}")
                    continue

                width, height = img.size
                if width < MIN_REFERENCE_DIMENSION or height < MIN_REFERENCE_DIMENSION:
                    warnings.append(
                        f"Skipped tiny reference '{canonical_url}' ({width}x{height} < {MIN_REFERENCE_DIMENSION}px)"
                    )
                    continue

                fmt = (img.format or "PNG").upper()
                resolved_mime = raw_mime or (
                    "image/png" if fmt == "PNG" else "image/webp" if fmt == "WEBP" else "image/jpeg"
                )
                if resolved_mime == "image/gif":
                    resolved_mime = "image/png"
                    buf = io.BytesIO()
                    img.convert("RGB").save(buf, format="PNG")
                    raw_bytes = buf.getvalue()

                rgb_copy = img.convert("RGB")
                score, reason = _score_reference_candidate(
                    is_primary=is_primary,
                    width=width,
                    height=height,
                    mime_type=resolved_mime,
                )
                seen_hashes.add(digest)
                selection = ReferenceImageSelection(
                    url=canonical_url,
                    mime_type=resolved_mime,
                    width=width,
                    height=height,
                    byte_size=len(raw_bytes),
                    is_primary=is_primary,
                    selection_score=score,
                    selection_reason=reason,
                )
                loaded_candidates.append(
                    LoadedReferenceImage(
                        selection=selection,
                        image_bytes=raw_bytes,
                        pil_image=rgb_copy,
                        part=types.Part.from_bytes(data=raw_bytes, mime_type=resolved_mime),
                        sha256=digest,
                    )
                )

        if not loaded_candidates:
            raise ReferenceSelectionError(
                "Could not retrieve any valid, readable product reference images from ProductData."
            )

        loaded_candidates.sort(key=lambda item: item.selection.selection_score, reverse=True)
        selected = loaded_candidates[: self.max_references]
        logger.debug(
            f"Selected {len(selected)} product reference image(s) for '{product_data.product_name}'"
        )
        return selected, warnings
