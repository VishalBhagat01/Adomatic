"""
AdPilot AI - Deterministic Promotional Text & CTA Overlay Renderer (Step 07)
Composites crisp, legible headlines, verified pricing/discount badges, and CTA pills
onto approved clean base visuals inside placement-safe margins via Pillow,
keeping text rendering decoupled from generative image synthesis.
"""

import io
import textwrap
from typing import Dict, Optional, Tuple
from PIL import Image, ImageDraw, ImageFont

from agent.app.schemas.creative import ImageCreativeBlueprint
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import MarketingStrategy


def _load_font(size: int) -> ImageFont.ImageFont:
    """Load clean scalable TrueType font with guaranteed Pillow 10+ fallback."""
    for candidate in ("arial.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _format_verified_price_badge(product_data: Product) -> Optional[str]:
    """Build price/discount tag strictly from verified numeric ProductData fields."""
    if product_data.price is None:
        return None
    currency = (product_data.currency or "INR").upper()
    prefix = "₹" if currency == "INR" else f"{currency} "
    price_val = int(product_data.price) if float(product_data.price).is_integer() else product_data.price
    badge = f"{prefix}{price_val:,}"
    if product_data.discount and product_data.discount > 0:
        disc = int(product_data.discount) if float(product_data.discount).is_integer() else round(product_data.discount, 1)
        badge = f"{badge}  •  {disc}% OFF"
    return badge


class DeterministicOverlayRenderer:
    """Applies placement-safe headline, verified price badge, and CTA pills via Pillow."""

    def build_overlay_spec(
        self,
        *,
        blueprint: ImageCreativeBlueprint,
        strategy: MarketingStrategy,
        product_data: Product,
        headline_override: Optional[str] = None,
        cta_override: Optional[str] = None,
    ) -> Dict[str, Optional[str]]:
        headline = (headline_override or blueprint.hook or blueprint.main_message).strip()
        cta = (cta_override or strategy.recommendations.primary_cta or "Shop Now").strip()
        price_badge = _format_verified_price_badge(product_data)
        return {
            "headline": headline[:90],
            "price_badge": price_badge,
            "cta": cta[:40],
        }

    def render(
        self,
        *,
        base_image_bytes: bytes,
        aspect_ratio: str,
        overlay_spec: Dict[str, Optional[str]],
    ) -> Tuple[bytes, str]:
        """
        Composite legible promotional overlays within placement-safe margins.
        Returns `(png_bytes, "image/png")`.
        """
        with Image.open(io.BytesIO(base_image_bytes)) as opened:
            canvas = opened.convert("RGBA")

        width, height = canvas.size
        overlay_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay_layer)

        # Respect vertical Stories/Reels safe zones (top 14% / bottom 22%)
        top_margin = int(height * (0.15 if aspect_ratio == "9:16" else 0.06))
        bottom_margin = int(height * (0.23 if aspect_ratio == "9:16" else 0.06))
        side_margin = int(width * 0.06)

        headline_font = _load_font(max(20, int(width * 0.036)))
        meta_font = _load_font(max(16, int(width * 0.028)))

        headline = overlay_spec.get("headline") or ""
        if headline:
            wrapped = textwrap.fill(headline, width=32)
            bbox = draw.multiline_textbbox((0, 0), wrapped, font=headline_font, spacing=6)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
            pad_x, pad_y = int(width * 0.025), int(height * 0.015)
            box = (
                side_margin,
                top_margin,
                min(width - side_margin, side_margin + text_w + pad_x * 2),
                top_margin + text_h + pad_y * 2,
            )
            draw.rounded_rectangle(box, radius=14, fill=(14, 18, 28, 195))
            draw.multiline_text(
                (box[0] + pad_x, box[1] + pad_y),
                wrapped,
                font=headline_font,
                fill=(248, 250, 252, 255),
                spacing=6,
            )

        cta_text = overlay_spec.get("cta")
        price_badge = overlay_spec.get("price_badge")
        footer_y = height - bottom_margin

        if cta_text:
            c_bbox = draw.textbbox((0, 0), cta_text, font=meta_font)
            cw = c_bbox[2] - c_bbox[0]
            ch = c_bbox[3] - c_bbox[1]
            pad_x, pad_y = int(width * 0.032), int(height * 0.014)
            cta_box = (
                side_margin,
                footer_y - ch - pad_y * 2,
                min(width - side_margin, side_margin + cw + pad_x * 2),
                footer_y,
            )
            draw.rounded_rectangle(cta_box, radius=999, fill=(99, 102, 241, 235))
            draw.text(
                (cta_box[0] + pad_x, cta_box[1] + pad_y - c_bbox[1]),
                cta_text,
                font=meta_font,
                fill=(255, 255, 255, 255),
            )

            if price_badge:
                p_bbox = draw.textbbox((0, 0), price_badge, font=meta_font)
                pw = p_bbox[2] - p_bbox[0]
                ph = p_bbox[3] - p_bbox[1]
                gap = int(width * 0.02)
                badge_left = cta_box[2] + gap
                if badge_left + pw + pad_x * 2 <= width - side_margin:
                    badge_box = (
                        badge_left,
                        footer_y - ph - pad_y * 2,
                        badge_left + pw + pad_x * 2,
                        footer_y,
                    )
                    draw.rounded_rectangle(badge_box, radius=999, fill=(15, 23, 42, 220))
                    draw.text(
                        (badge_box[0] + pad_x, badge_box[1] + pad_y - p_bbox[1]),
                        price_badge,
                        font=meta_font,
                        fill=(253, 224, 71, 255),
                    )

        composited = Image.alpha_composite(canvas, overlay_layer).convert("RGB")
        out_buf = io.BytesIO()
        composited.save(out_buf, format="PNG", optimize=True)
        return out_buf.getvalue(), "image/png"

