"""
AdPilot AI - Free Multi-Provider Image Generation & Local Pillow Banner Fallback
Supports:
  1. Pollinations.ai (free, no API key required)
  2. Hugging Face Router Free Inference API (optional HF_API_KEY)
  3. Local Pillow 1080x1080 Promotional Graphic Fallback (last resort, zero external dependency)
"""

import io
import random
import re
import time
import urllib.parse
from typing import Callable, List, Optional, Tuple

import httpx
from PIL import Image, ImageDraw, ImageFont, ImageOps

from agent.app.core.config import settings
from agent.app.core.logging import logger
from agent.app.schemas.image_gen import GenerationCostRecord
from agent.app.schemas.product import Product
from agent.app.services.image_gen.gemini_image_client import GeneratedImageRawResult
from agent.app.services.image_gen.overlay_renderer import (
    _format_verified_price_badge,
    _load_font,
)
from agent.app.services.image_gen.quality_checker import (
    ASPECT_TOLERANCE,
    TARGET_ASPECT_RATIOS,
)


class FreeImageProviderError(RuntimeError):
    """Raised when an individual free external image provider fails or returns invalid data."""

    def __init__(self, provider: str, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.provider = provider
        self.status_code = status_code


ASPECT_DIMENSIONS: dict[str, Tuple[int, int]] = {
    "1:1": (1080, 1080),
    "4:5": (896, 1120),
    "9:16": (720, 1280),
}

# Distinct tasteful gradient + accent palettes keyed per variation index so Pillow fallbacks are never identical
_BANNER_PALETTES: Tuple[dict[str, Tuple[int, int, int]], ...] = (
    {
        "top": (15, 23, 42),
        "bottom": (49, 46, 129),
        "accent": (99, 102, 241),
        "cta_bg": (245, 158, 11),
        "cta_fg": (15, 23, 42),
    },
    {
        "top": (6, 78, 59),
        "bottom": (15, 118, 110),
        "accent": (45, 212, 191),
        "cta_bg": (250, 204, 21),
        "cta_fg": (17, 24, 39),
    },
    {
        "top": (67, 20, 7),
        "bottom": (154, 52, 18),
        "accent": (251, 146, 60),
        "cta_bg": (255, 255, 255),
        "cta_fg": (67, 20, 7),
    },
    {
        "top": (17, 24, 39),
        "bottom": (30, 58, 138),
        "accent": (56, 189, 248),
        "cta_bg": (16, 185, 129),
        "cta_fg": (255, 255, 255),
    },
)


def dimensions_for_aspect_ratio(aspect_ratio: str) -> Tuple[int, int]:
    """Return commercial raster width/height matching supported aspect ratios."""
    return ASPECT_DIMENSIONS.get(aspect_ratio, (1080, 1080))


def build_concise_t2i_prompt(
    positive_prompt: str,
    product_name: str = "",
    brand: Optional[str] = None,
    max_len: int = 800,
) -> str:
    """Condense multi-section reference-locked prompts into crisp URL-safe text-to-image prompts."""
    cleaned_lines: List[str] = []
    skip_section = False
    for raw_line in (positive_prompt or "").splitlines():
        line = raw_line.strip()
        if not line:
            skip_section = False
            continue
        upper = line.upper()
        if upper.startswith("ATTACHED PRODUCT REFERENCE") or upper.startswith("STRICT NEGATIVE EXCLUSIONS"):
            skip_section = True
            continue
        if skip_section and line.startswith("-"):
            continue
        skip_section = False
        cleaned_lines.append(line)

    merged = re.sub(r"\s+", " ", " ".join(cleaned_lines)).strip()
    if brand or product_name:
        lead = " ".join(part for part in (brand or "", product_name or "") if part).strip()
        if lead and lead.lower() not in merged.lower():
            merged = f"{lead} commercial product photography, {merged}".strip(", ")

    if len(merged) <= max_len:
        return merged or "Modern commercial studio product photograph, crisp lighting"

    clipped = merged[:max_len].rsplit(" ", 1)[0].strip()
    return clipped or merged[:max_len]


def _validate_and_fit_external_image(
    raw_bytes: bytes,
    aspect_ratio: str,
    mime_hint: str,
    provider_name: str,
) -> Tuple[bytes, str]:
    """Verify bytes decode as a valid raster image and gently fit mismatched ratios cleanly."""
    if not raw_bytes or len(raw_bytes) < 512:
        raise FreeImageProviderError(provider_name, f"{provider_name} returned empty or undersized image payload.")

    try:
        with Image.open(io.BytesIO(raw_bytes)) as opened:
            detected_fmt = (opened.format or "").upper()
            rgb_img = opened.convert("RGB")
    except Exception as exc:
        raise FreeImageProviderError(provider_name, f"{provider_name} returned unreadable image bytes: {exc}") from exc

    width, height = rgb_img.size
    expected_fraction = TARGET_ASPECT_RATIOS.get(aspect_ratio)
    actual_fraction = width / max(1, height)
    target_w, target_h = dimensions_for_aspect_ratio(aspect_ratio)

    needs_fit = (
        width < settings.IMAGE_MIN_WIDTH
        or height < settings.IMAGE_MIN_HEIGHT
        or (expected_fraction is not None and abs(actual_fraction - expected_fraction) > ASPECT_TOLERANCE)
    )
    if not needs_fit and detected_fmt in {"PNG", "JPEG", "WEBP"}:
        out_mime = mime_hint if mime_hint.startswith("image/") else f"image/{detected_fmt.lower()}"
        return raw_bytes, out_mime

    fitted = ImageOps.fit(rgb_img, (target_w, target_h), method=Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    fitted.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), "image/png"


def _draw_linear_gradient(
    width: int,
    height: int,
    top_rgb: Tuple[int, int, int],
    bottom_rgb: Tuple[int, int, int],
    horizontal: bool = False,
) -> Image.Image:
    """Create smooth vertical or horizontal gradient RGB background."""
    base = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(base)
    if horizontal:
        denom = max(1, width - 1)
        for x in range(width):
            t = x / denom
            r = int(top_rgb[0] + (bottom_rgb[0] - top_rgb[0]) * t)
            g = int(top_rgb[1] + (bottom_rgb[1] - top_rgb[1]) * t)
            b = int(top_rgb[2] + (bottom_rgb[2] - top_rgb[2]) * t)
            draw.line([(x, 0), (x, height)], fill=(r, g, b))
    else:
        denom = max(1, height - 1)
        for y in range(height):
            t = y / denom
            r = int(top_rgb[0] + (bottom_rgb[0] - top_rgb[0]) * t)
            g = int(top_rgb[1] + (bottom_rgb[1] - top_rgb[1]) * t)
            b = int(top_rgb[2] + (bottom_rgb[2] - top_rgb[2]) * t)
            draw.line([(0, y), (width, y)], fill=(r, g, b))
    return base


def _wrap_text_to_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
    max_lines: int = 3,
) -> List[str]:
    """Word-wrap text within exact pixel bounds."""
    words = (text or "").split()
    if not words:
        return []
    lines: List[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), trial, font=font)
        if bbox[2] - bbox[0] <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
            if len(lines) >= max_lines - 1:
                break
    if current and len(lines) < max_lines:
        lines.append(current)
    elif len(lines) == max_lines:
        lines[-1] = lines[-1][: max(1, len(lines[-1]) - 3)] + "..."
    return lines


class FreeImageGenerationClient:
    """Handles Pollinations.ai, Hugging Face Free Inference API, and Pillow banner fallback."""

    def __init__(
        self,
        *,
        pollinations_model: Optional[str] = None,
        hf_api_key: Optional[str] = None,
        hf_image_model: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        http_client_factory: Optional[Callable[[float], httpx.AsyncClient]] = None,
    ):
        self.pollinations_model = (pollinations_model or settings.POLLINATIONS_MODEL or "flux").strip()
        self.hf_api_key = (hf_api_key if hf_api_key is not None else settings.HF_API_KEY or "").strip()
        self.hf_image_model = (
            hf_image_model or settings.HF_IMAGE_MODEL or "black-forest-labs/FLUX.1-schnell"
        ).strip()
        self.timeout_seconds = timeout_seconds or settings.IMAGE_GEN_TIMEOUT_SECONDS
        self._http_client_factory = http_client_factory

    def has_hf_api_key(self) -> bool:
        return bool(self.hf_api_key and "your_hf_api_key" not in self.hf_api_key.lower())

    def _create_http_client(self) -> httpx.AsyncClient:
        if self._http_client_factory is not None:
            return self._http_client_factory(self.timeout_seconds)
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout_seconds),
            follow_redirects=True,
        )

    async def generate_pollinations_image(
        self,
        *,
        prompt: str,
        aspect_ratio: str = "1:1",
        product_name: str = "",
        brand: Optional[str] = None,
        seed: Optional[int] = None,
    ) -> GeneratedImageRawResult:
        """Generate free image via Pollinations.ai GET API (no API key required)."""
        start_time = time.perf_counter()
        width, height = dimensions_for_aspect_ratio(aspect_ratio)
        clean_prompt = build_concise_t2i_prompt(prompt, product_name=product_name, brand=brand)
        encoded_prompt = urllib.parse.quote(clean_prompt, safe="")
        random_seed = seed if seed is not None else random.randint(1, 999_999_999)
        encoded_model = urllib.parse.quote(self.pollinations_model, safe="")

        url = (
            f"https://image.pollinations.ai/prompt/{encoded_prompt}"
            f"?width={width}&height={height}&model={encoded_model}"
            f"&nologo=true&enhance=true&seed={random_seed}"
        )

        try:
            async with self._create_http_client() as client:
                response = await client.get(url)
        except Exception as exc:
            raise FreeImageProviderError("pollinations", f"Pollinations.ai request failed: {exc}") from exc

        content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        if response.status_code != 200 or not content_type.startswith("image/"):
            raise FreeImageProviderError(
                "pollinations",
                f"Pollinations.ai returned status={response.status_code}, content-type='{content_type}'.",
                status_code=response.status_code,
            )

        fitted_bytes, mime_type = _validate_and_fit_external_image(
            response.content, aspect_ratio, content_type, "pollinations"
        )
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        model_id = f"pollinations:{self.pollinations_model}"

        return GeneratedImageRawResult(
            image_bytes=fitted_bytes,
            mime_type=mime_type,
            model_identifier=model_id,
            attempts=1,
            latency_ms=latency_ms,
            cost=GenerationCostRecord(
                model_identifier=model_id,
                estimated_cost_usd=0.0,
                pricing_basis="free_pollinations_tier",
            ),
        )

    async def generate_huggingface_image(
        self,
        *,
        prompt: str,
        aspect_ratio: str = "1:1",
        product_name: str = "",
        brand: Optional[str] = None,
    ) -> GeneratedImageRawResult:
        """Generate free image via Hugging Face Router Inference API when HF_API_KEY is configured."""
        if not self.has_hf_api_key():
            raise FreeImageProviderError("huggingface", "HF_API_KEY is not configured.")

        start_time = time.perf_counter()
        clean_prompt = build_concise_t2i_prompt(prompt, product_name=product_name, brand=brand, max_len=1000)
        url = f"https://router.huggingface.co/hf-inference/models/{self.hf_image_model}"
        headers = {
            "Authorization": f"Bearer {self.hf_api_key}",
            "Accept": "image/png",
        }

        try:
            async with self._create_http_client() as client:
                response = await client.post(url, json={"inputs": clean_prompt}, headers=headers)
        except Exception as exc:
            raise FreeImageProviderError("huggingface", f"Hugging Face inference request failed: {exc}") from exc

        content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        if response.status_code != 200 or not content_type.startswith("image/"):
            detail = response.text[:250] if response.text else ""
            raise FreeImageProviderError(
                "huggingface",
                f"Hugging Face returned status={response.status_code}, content-type='{content_type}': {detail}",
                status_code=response.status_code,
            )

        fitted_bytes, mime_type = _validate_and_fit_external_image(
            response.content, aspect_ratio, content_type, "huggingface"
        )
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        model_id = f"huggingface:{self.hf_image_model}"

        return GeneratedImageRawResult(
            image_bytes=fitted_bytes,
            mime_type=mime_type,
            model_identifier=model_id,
            attempts=1,
            latency_ms=latency_ms,
            cost=GenerationCostRecord(
                model_identifier=model_id,
                estimated_cost_usd=0.0,
                pricing_basis="free_huggingface_inference_tier",
            ),
        )

    def generate_pillow_banner_fallback(
        self,
        *,
        headline: str,
        product_name: str,
        brand: Optional[str] = None,
        cta_text: str = "Shop Now",
        product_data: Optional[Product] = None,
        reference_pil_image: Optional[Image.Image] = None,
        variation_index: int = 1,
    ) -> GeneratedImageRawResult:
        """
        Render a clean modern 1080x1080 promotional graphic locally with Pillow
        so GENERATING_ASSETS never fails when all remote image APIs are unavailable.
        """
        start_time = time.perf_counter()
        width, height = 1080, 1080
        palette = _BANNER_PALETTES[(max(1, variation_index) - 1) % len(_BANNER_PALETTES)]
        alt_layout = (variation_index % 2) == 0

        if alt_layout:
            canvas = _draw_linear_gradient(
                width, height, palette["accent"], palette["top"], horizontal=True
            ).convert("RGBA")
        else:
            canvas = _draw_linear_gradient(
                width, height, palette["top"], palette["bottom"], horizontal=False
            ).convert("RGBA")
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Subtle decorative backdrop accents (flipped orientation across even/odd variations so dHash differs cleanly)
        if alt_layout:
            draw.rectangle((0, 0, width // 2, height), fill=(*palette["bottom"], 95))
            draw.ellipse((-180, -140, 420, 460), fill=(*palette["cta_bg"], 55))
        else:
            draw.ellipse((620, -120, 1180, 440), fill=(*palette["accent"], 45))
            draw.ellipse((-140, 620, 420, 1180), fill=(*palette["accent"], 36))

        # Modern centered dark-frosted container card
        margin = 64
        draw.rounded_rectangle(
            (margin, margin, width - margin, height - margin),
            radius=36,
            fill=(15, 23, 42, 118),
            outline=(255, 255, 255, 52),
            width=2,
        )

        # Brand pill header (left-aligned vs right-aligned accent panel)
        brand_label = (brand or (product_data.brand if product_data else None) or "FEATURED PRODUCT").strip().upper()[:32]
        badge_font = _load_font(26)
        title_font = _load_font(34)
        headline_font = _load_font(54)
        cta_font = _load_font(30)

        b_box = draw.textbbox((0, 0), brand_label, font=badge_font)
        b_w = (b_box[2] - b_box[0]) + 44
        b_h = (b_box[3] - b_box[1]) + 22
        pill_x = (width - margin - 44 - b_w) if alt_layout else (margin + 44)
        pill_y = margin + 40
        draw.rounded_rectangle(
            (pill_x, pill_y, pill_x + b_w, pill_y + b_h),
            radius=999,
            fill=(*palette["accent"], 230),
        )
        draw.text((pill_x + 22, pill_y + 10), brand_label, font=badge_font, fill=(255, 255, 255, 255))

        # Variation showcase window (embeds authentic reference image if available)
        showcase_top = pill_y + b_h + 32
        showcase_bottom = 610
        showcase_left = (width // 2 - 40) if alt_layout else (margin + 44)
        showcase_right = width - margin - 44
        if alt_layout:
            # Decorative bright typography strip beside offset showcase frame
            draw.rounded_rectangle(
                (margin + 44, showcase_top, showcase_left - 24, showcase_bottom),
                radius=24,
                fill=(*palette["cta_bg"], 215),
            )

        if reference_pil_image is not None:
            draw.rounded_rectangle(
                (showcase_left, showcase_top, showcase_right, showcase_bottom),
                radius=28,
                fill=(255, 255, 255, 245),
                outline=(255, 255, 255, 255),
                width=2,
            )
            box_w = showcase_right - showcase_left - 48
            box_h = showcase_bottom - showcase_top - 48
            thumb = ImageOps.contain(reference_pil_image.convert("RGB"), (box_w, box_h), Image.Resampling.LANCZOS)
            paste_x = showcase_left + (showcase_right - showcase_left - thumb.width) // 2
            paste_y = showcase_top + (showcase_bottom - showcase_top - thumb.height) // 2
            composed = Image.alpha_composite(canvas, overlay)
            composed.paste(thumb, (paste_x, paste_y))
            overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            canvas = composed
        else:
            # Clean geometric product podium emblem when reference bytes aren't loaded
            draw.rounded_rectangle(
                (showcase_left, showcase_top, showcase_right, showcase_bottom),
                radius=28,
                fill=(255, 255, 255, 26),
                outline=(255, 255, 255, 70),
                width=2,
            )
            initials = (brand_label[:2] if len(brand_label) >= 2 else "AD").upper()
            monogram_font = _load_font(120)
            m_box = draw.textbbox((0, 0), initials, font=monogram_font)
            mx = (width - (m_box[2] - m_box[0])) // 2
            my = showcase_top + ((showcase_bottom - showcase_top) - (m_box[3] - m_box[1])) // 2 - 12
            draw.text((mx, my), initials, font=monogram_font, fill=(255, 255, 255, 235))

        # Product name
        clean_product = (product_name or "Commercial Campaign Creative").strip()
        p_lines = _wrap_text_to_width(draw, clean_product, title_font, width - (margin + 44) * 2, max_lines=2)
        cursor_y = showcase_bottom + 28
        for pline in p_lines:
            draw.text((margin + 44, cursor_y), pline, font=title_font, fill=(226, 232, 240, 245))
            cursor_y += 44

        # Campaign headline
        clean_headline = (headline or clean_product).strip()
        h_lines = _wrap_text_to_width(draw, clean_headline, headline_font, width - (margin + 44) * 2, max_lines=2)
        cursor_y += 12
        for hline in h_lines:
            draw.text((margin + 44, cursor_y), hline, font=headline_font, fill=(255, 255, 255, 255))
            cursor_y += 66

        # Verified price badge + CTA pill anchored along bottom bar
        bar_y = height - margin - 108
        cta_label = (cta_text or "Shop Now").strip()[:28]
        c_box = draw.textbbox((0, 0), cta_label, font=cta_font)
        c_w = (c_box[2] - c_box[0]) + 56
        c_h = (c_box[3] - c_box[1]) + 28
        cta_x = width - margin - 44 - c_w
        draw.rounded_rectangle(
            (cta_x, bar_y, cta_x + c_w, bar_y + c_h),
            radius=999,
            fill=(*palette["cta_bg"], 255),
        )
        draw.text((cta_x + 28, bar_y + 13), cta_label, font=cta_font, fill=(*palette["cta_fg"], 255))

        if product_data is not None:
            price_str = _format_verified_price_badge(product_data)
            if price_str:
                price_font = _load_font(30)
                pr_box = draw.textbbox((0, 0), price_str, font=price_font)
                pr_w = (pr_box[2] - pr_box[0]) + 44
                pr_h = (pr_box[3] - pr_box[1]) + 24
                draw.rounded_rectangle(
                    (margin + 44, bar_y + 2, margin + 44 + pr_w, bar_y + 2 + pr_h),
                    radius=16,
                    fill=(15, 23, 42, 220),
                    outline=(255, 255, 255, 90),
                    width=2,
                )
                draw.text((margin + 66, bar_y + 13), price_str, font=price_font, fill=(255, 255, 255, 255))

        final_rgb = Image.alpha_composite(canvas, overlay).convert("RGB")
        buf = io.BytesIO()
        final_rgb.save(buf, format="PNG", optimize=True)
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        model_id = "local:pillow-banner-fallback"

        return GeneratedImageRawResult(
            image_bytes=buf.getvalue(),
            mime_type="image/png",
            model_identifier=model_id,
            attempts=1,
            latency_ms=latency_ms,
            cost=GenerationCostRecord(
                model_identifier=model_id,
                estimated_cost_usd=0.0,
                pricing_basis="local_pillow_fallback",
            ),
        )

    async def generate_with_fallback(
        self,
        *,
        providers: List[str],
        prompt: str,
        aspect_ratio: str,
        headline: str,
        product_name: str,
        brand: Optional[str] = None,
        cta_text: str = "Shop Now",
        product_data: Optional[Product] = None,
        reference_pil_image: Optional[Image.Image] = None,
        variation_index: int = 1,
    ) -> Tuple[GeneratedImageRawResult, List[str]]:
        """Try requested free remote providers in order, falling back cleanly to 1080x1080 Pillow."""
        warnings: List[str] = []
        seed_base = random.randint(1000, 999_000) + variation_index

        for prov in providers:
            if prov == "huggingface":
                if not self.has_hf_api_key():
                    continue
                try:
                    logger.info(f"Generating image via Hugging Face model '{self.hf_image_model}' (variation={variation_index})")
                    res = await self.generate_huggingface_image(
                        prompt=prompt,
                        aspect_ratio=aspect_ratio,
                        product_name=product_name,
                        brand=brand,
                    )
                    return res, warnings
                except Exception as exc:
                    msg = f"Hugging Face image generation failed ({exc}); falling back to next provider."
                    logger.warning(msg)
                    warnings.append(msg)

            elif prov == "pollinations":
                try:
                    logger.info(f"Generating image via Pollinations.ai model '{self.pollinations_model}' (variation={variation_index})")
                    res = await self.generate_pollinations_image(
                        prompt=prompt,
                        aspect_ratio=aspect_ratio,
                        product_name=product_name,
                        brand=brand,
                        seed=seed_base,
                    )
                    return res, warnings
                except Exception as exc:
                    msg = f"Pollinations.ai image generation failed ({exc}); falling back to next provider."
                    logger.warning(msg)
                    warnings.append(msg)

        logger.warning(
            f"All external image providers failed or unavailable (variation={variation_index}); "
            "rendering local 1080x1080 Pillow promotional banner fallback."
        )
        warnings.append(
            "External image providers unavailable; generated local 1080x1080 Pillow promotional banner fallback."
        )
        res = self.generate_pillow_banner_fallback(
            headline=headline,
            product_name=product_name,
            brand=brand,
            cta_text=cta_text,
            product_data=product_data,
            reference_pil_image=reference_pil_image,
            variation_index=variation_index,
        )
        return res, warnings
