"""
AdPilot AI - Product Image Processor & Deduplicator
Extracts, cleans, upscales, deduplicates, and identifies primary product images.
"""

import os
import re
import urllib.parse
from typing import Dict, List, Optional, Set
from bs4 import BeautifulSoup

from agent.app.schemas.product import ProductImage

# Recognized e-commerce image extensions
VALID_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".svg", ".gif"}

# Shopify thumbnail size patterns to convert to original / high-res
SHOPIFY_SIZE_REGEX = re.compile(
    r"_(?:pico|icon|thumb|small|compact|medium|large|grande|1024x1024|2048x2048|master|(\d+x\d+))\.(jpg|jpeg|png|webp|avif)",
    re.IGNORECASE
)

# Negative patterns to filter out non-product imagery (badges, icons, spacers, payment logos)
EXCLUDE_IMAGE_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in [
        r"logo",
        r"icon",
        r"badge",
        r"rating",
        r"star",
        r"avatar",
        r"payment",
        r"visa",
        r"mastercard",
        r"upi",
        r"amex",
        r"paypal",
        r"banner_footer",
        r"trust_badge",
        r"placeholder",
        r"spacer\.gif",
        r"1x1",
        r"tracking",
        r"pixel",
    ]
]


def normalize_image_url(url: str, base_url: str = "") -> str:
    """Normalize image URL, handling protocol-relative URLs and Shopify sizing."""
    if not url:
        return ""
    url = url.strip()

    # Protocol-relative '//cdn.shopify.com/...' -> 'https://cdn.shopify.com/...'
    if url.startswith("//"):
        url = "https:" + url
    elif not url.startswith("http://") and not url.startswith("https://") and base_url:
        url = urllib.parse.urljoin(base_url, url)

    # Clean and parse URL
    parsed = urllib.parse.urlparse(url)

    # For Shopify images, remove size constraints to get full-res master image
    # e.g., product_500x.jpg -> product.jpg or product_master.jpg
    cleaned_path = SHOPIFY_SIZE_REGEX.sub(r".\2", parsed.path)

    # Strip cache-busting query params like ?v=12345 or resizing parameters
    # but keep other relevant paths intact
    canonical_parsed = parsed._replace(path=cleaned_path, query="")
    return urllib.parse.urlunparse(canonical_parsed)


def is_valid_product_image(url: str, alt_text: Optional[str] = None) -> bool:
    """Validate image URL extension, format, and ensure it is not a logo/tracking pixel."""
    if not url or not url.startswith("http"):
        return False

    url_lower = url.lower()
    parsed = urllib.parse.urlparse(url_lower)
    path = parsed.path

    # Check extension
    _, ext = os.path.splitext(path)
    if ext and ext not in VALID_IMAGE_EXTENSIONS:
        return False

    # Check exclusion patterns in URL
    for pattern in EXCLUDE_IMAGE_PATTERNS:
        if pattern.search(url_lower):
            # If alt_text strongly indicates product, maybe allow, but usually exclude
            if alt_text and any(word in alt_text.lower() for word in ["product", "jar", "model", "unit"]):
                continue
            return False

    # Check exclusion patterns in alt text
    if alt_text:
        alt_lower = alt_text.lower()
        for pattern in EXCLUDE_IMAGE_PATTERNS:
            if pattern.search(alt_lower):
                return False

    return True


def extract_images_from_soup(
    soup: BeautifulSoup,
    base_url: str,
    json_ld_images: List[str],
    og_images: List[str]
) -> List[ProductImage]:
    """
    Extract all product images from JSON-LD, OpenGraph, and HTML DOM.
    Deduplicates images, enhances resolution, validates formats, and identifies the primary image.
    """
    seen_urls: Set[str] = set()
    product_images: List[ProductImage] = []

    # Helper to add an image candidate
    def add_candidate(raw_url: str, source: str, alt: Optional[str] = None, is_primary_hint: bool = False):
        if not raw_url:
            return
        norm_url = normalize_image_url(raw_url, base_url)
        if not norm_url or norm_url in seen_urls:
            return
        if not is_valid_product_image(norm_url, alt):
            return

        seen_urls.add(norm_url)

        # Detect format from extension
        ext = os.path.splitext(urllib.parse.urlparse(norm_url).path)[1].replace(".", "").lower()
        fmt = ext if ext in ("jpg", "jpeg", "png", "webp", "avif", "svg", "gif") else "jpg"
        if fmt == "jpeg":
            fmt = "jpg"

        product_images.append(
            ProductImage(
                url=norm_url,
                alt_text=alt.strip() if alt else None,
                is_primary=False,  # Assigned below
                format=fmt,
                source=source,
            )
        )

    # 1. Add JSON-LD images first (highest priority)
    for idx, img_url in enumerate(json_ld_images):
        add_candidate(img_url, source="json_ld", is_primary_hint=(idx == 0))

    # 2. Add OpenGraph images
    for idx, img_url in enumerate(og_images):
        add_candidate(img_url, source="open_graph", is_primary_hint=(len(product_images) == 0 and idx == 0))

    # 3. Add DOM gallery images
    # Common e-commerce image selectors (Shopify, Lifelong, WooCommerce, custom)
    gallery_selectors = [
        ".product-single__media img",
        ".product__media img",
        ".product-gallery img",
        ".product-media-modal__content img",
        ".product-images img",
        "#product-images img",
        "[data-product-images] img",
        ".photoswipe-wrapper img",
        ".main-image img",
        ".product-featured-image",
    ]

    for selector in gallery_selectors:
        for img_tag in soup.select(selector):
            src = (
                img_tag.get("data-src")
                or img_tag.get("data-highres")
                or img_tag.get("data-master")
                or img_tag.get("src")
            )
            # Check srcset if available
            srcset = img_tag.get("srcset") or img_tag.get("data-srcset")
            if srcset:
                # Pick the highest resolution entry from srcset
                parts = [p.strip() for p in srcset.split(",") if p.strip()]
                if parts:
                    last_part = parts[-1].split()[0]
                    if last_part.startswith("http") or last_part.startswith("//"):
                        src = last_part

            alt = img_tag.get("alt")
            add_candidate(src, source="html_gallery", alt=alt)

    # 4. Fallback: all images inside main or article
    if len(product_images) < 2:
        for img_tag in soup.select("main img, article img, #main-content img"):
            src = img_tag.get("data-src") or img_tag.get("src")
            alt = img_tag.get("alt")
            # Require minimum relevance or size hints
            width = img_tag.get("width")
            height = img_tag.get("height")
            if width and height:
                try:
                    if int(width) < 100 or int(height) < 100:
                        continue
                except ValueError:
                    pass
            add_candidate(src, source="html_dom", alt=alt)

    # 5. Mark primary image
    if product_images:
        # If any was from JSON-LD first, mark as primary, otherwise first image
        product_images[0].is_primary = True

    return product_images

