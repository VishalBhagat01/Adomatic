"""
AdPilot AI - Safe Multimodal Image Loader
Safely fetches product reference images with SSRF protection, size limits,
and content-type checks for Gemini multimodal analysis.
"""

from typing import List, Optional, Tuple
import httpx
from google.genai import types

from agent.app.core.logging import logger
from agent.app.schemas.product import Product
from agent.app.services.extractor.ssrf import validate_safe_url

ALLOWED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB per reference image
MAX_REFERENCE_IMAGES = 3


async def load_reference_images_for_gemini(
    product_data: Product,
    override_urls: Optional[List[str]] = None,
    timeout_seconds: float = 8.0,
) -> Tuple[List[types.Part], List[str]]:
    """
    Download up to MAX_REFERENCE_IMAGES permitted product images safely.
    Returns:
        (list of google.genai.types.Part, list of non-fatal warning strings)
    """
    parts: List[types.Part] = []
    warnings: List[str] = []

    candidate_urls: List[str] = []
    if override_urls:
        candidate_urls = [u.strip() for u in override_urls if u and u.strip()]
    else:
        # Prioritize primary image first
        sorted_imgs = sorted(product_data.images, key=lambda img: not img.is_primary)
        candidate_urls = [img.url for img in sorted_imgs if img.url]

    if not candidate_urls:
        return parts, warnings

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds), follow_redirects=False) as client:
        for url in candidate_urls[:MAX_REFERENCE_IMAGES]:
            is_safe, canonical_url, ssrf_err = validate_safe_url(url)
            if not is_safe:
                warnings.append(f"Skipped unsafe reference image URL '{url}': {ssrf_err}")
                continue

            try:
                resp = await client.get(canonical_url)
                if resp.status_code != 200:
                    warnings.append(f"Reference image '{canonical_url}' returned HTTP {resp.status_code}")
                    continue

                content_type = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if content_type == "image/jpg":
                    content_type = "image/jpeg"
                if content_type not in ALLOWED_IMAGE_MIME_TYPES:
                    warnings.append(
                        f"Skipped reference image '{canonical_url}' due to unsupported MIME type '{content_type}'"
                    )
                    continue

                img_bytes = resp.content
                if not img_bytes:
                    continue
                if len(img_bytes) > MAX_IMAGE_BYTES:
                    warnings.append(
                        f"Skipped reference image '{canonical_url}' exceeding {MAX_IMAGE_BYTES} byte limit"
                    )
                    continue

                parts.append(types.Part.from_bytes(data=img_bytes, mime_type=content_type))
            except Exception as e:
                logger.debug(f"Could not download reference image {canonical_url}: {e}")
                warnings.append(f"Could not load reference image '{canonical_url}': {str(e)}")

    return parts, warnings

