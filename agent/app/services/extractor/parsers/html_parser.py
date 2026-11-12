"""
AdPilot AI - HTML DOM Parser
Extracts features, specifications, pricing, reviews, and availability from DOM structures.
"""

import re
from typing import Any, Dict, List, Optional, Tuple
from bs4 import BeautifulSoup

from agent.app.schemas.product import ProductReview


def extract_features_from_soup(soup: BeautifulSoup) -> List[str]:
    """Extract bullet point highlights and key features from the product page."""
    features: List[str] = []
    seen: set = set()

    # Common feature list selectors
    selectors = [
        ".product-description ul li",
        ".product-single__description ul li",
        ".features-list li",
        ".key-features li",
        ".product-features li",
        ".highlights li",
        "#features ul li",
        "[data-feature-list] li",
        ".bullet-points li",
    ]

    for sel in selectors:
        for li in soup.select(sel):
            text = li.get_text(strip=True)
            if not text or len(text) < 5 or len(text) > 400:
                continue
            # Filter out generic warranty or shipping disclaimers from features
            if any(skip in text.lower() for skip in ["cash on delivery", "free shipping", "return policy", "emi starts"]):
                continue
            cleaned = re.sub(r"\s+", " ", text).strip()
            if cleaned not in seen:
                seen.add(cleaned)
                features.append(cleaned)

    return features


def extract_specifications_from_soup(soup: BeautifulSoup) -> Dict[str, Any]:
    """Extract technical and product specifications into structured key-value pairs."""
    specs: Dict[str, Any] = {}

    # 1. Look for tables
    table_selectors = [
        "table.spec-table",
        "table.specifications",
        ".product-specifications table",
        ".specification-table",
        "#specifications table",
        ".product-details table",
        "table",
    ]

    for sel in table_selectors:
        for table in soup.select(sel):
            rows = table.find_all("tr")
            for row in rows:
                cols = row.find_all(["th", "td"])
                if len(cols) == 2:
                    k = cols[0].get_text(strip=True)
                    v = cols[1].get_text(strip=True)
                    if k and v and len(k) < 80 and len(v) < 300:
                        # Clean key
                        clean_k = re.sub(r"[:\s]+$", "", k).strip()
                        if clean_k and clean_k not in specs:
                            specs[clean_k] = v

    # 2. Look for definition lists <dl>
    for dl in soup.select("dl.specs, .product-specs dl, dl"):
        dts = dl.find_all("dt")
        dds = dl.find_all("dd")
        if len(dts) == len(dds):
            for dt, dd in zip(dts, dds):
                k = dt.get_text(strip=True)
                v = dd.get_text(strip=True)
                if k and v and len(k) < 80 and len(v) < 300:
                    clean_k = re.sub(r"[:\s]+$", "", k).strip()
                    if clean_k and clean_k not in specs:
                        specs[clean_k] = v

    # 3. Look for key-value divs (.spec-row or .specification-row)
    for row in soup.select(".spec-row, .specification-row, .product-attributes__item"):
        label = row.select_one(".spec-label, .label, .attr-name, th")
        val = row.select_one(".spec-value, .value, .attr-value, td")
        if label and val:
            k = label.get_text(strip=True)
            v = val.get_text(strip=True)
            if k and v:
                clean_k = re.sub(r"[:\s]+$", "", k).strip()
                if clean_k and clean_k not in specs:
                    specs[clean_k] = v

    return specs


def extract_price_from_soup(soup: BeautifulSoup) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    """
    Extract selling price, compare-at/original price, and currency from HTML.
    Returns: (price, original_price, currency)
    """
    price: Optional[float] = None
    original_price: Optional[float] = None
    currency: Optional[str] = None

    # Detect currency symbol
    full_text = soup.get_text()
    if "₹" in full_text or "Rs." in full_text or "INR" in full_text:
        currency = "INR"
    elif "$" in full_text or "USD" in full_text:
        currency = "USD"

    # Price selectors (ordered from specific to general)
    sale_selectors = [
        ".price-item--sale",
        ".product-price--sale",
        ".special-price .price",
        ".current-price",
        "[data-product-price]",
        ".price .amount",
        ".product__price",
        "#product-price",
    ]

    for sel in sale_selectors:
        elem = soup.select_one(sel)
        if elem:
            text = elem.get_text(strip=True)
            digits = re.sub(r"[^\d.]", "", text)
            if digits:
                try:
                    price = float(digits)
                    break
                except ValueError:
                    pass

    # Original / Compare-at / MRP selectors
    regular_selectors = [
        ".price-item--regular",
        ".compare-at-price",
        ".price-item--compare-at",
        ".old-price .price",
        ".original-price",
        ".mrp",
        ".was-price",
    ]

    for sel in regular_selectors:
        elem = soup.select_one(sel)
        if elem:
            text = elem.get_text(strip=True)
            digits = re.sub(r"[^\d.]", "", text)
            if digits:
                try:
                    original_price = float(digits)
                    break
                except ValueError:
                    pass

    return price, original_price, currency


def extract_availability_from_soup(soup: BeautifulSoup) -> str:
    """Determine stock availability from buttons and badges."""
    # Check for explicit Out of Stock text in badge or buy button
    sold_out_indicators = [
        ".sold-out",
        ".out-of-stock",
        "[data-sold-out]",
        ".badge--sold-out",
        ".product-form__submit:disabled",
    ]
    for sel in sold_out_indicators:
        elem = soup.select_one(sel)
        if elem:
            text = elem.get_text(strip=True).lower()
            if any(term in text for term in ["sold out", "out of stock", "unavailable"]):
                return "OutOfStock"

    # Check Add to Cart button state
    submit_btn = soup.select_one("button[type='submit'][name='add'], .product-form__submit, #AddToCart")
    if submit_btn:
        if submit_btn.has_attr("disabled"):
            return "OutOfStock"
        btn_text = submit_btn.get_text(strip=True).lower()
        if "sold out" in btn_text or "out of stock" in btn_text:
            return "OutOfStock"
        if "pre-order" in btn_text or "preorder" in btn_text:
            return "PreOrder"
        if "add to cart" in btn_text or "buy now" in btn_text:
            return "InStock"

    return "Unknown"


def extract_reviews_from_soup(soup: BeautifulSoup) -> Tuple[Optional[float], Optional[int], List[ProductReview]]:
    """Extract customer reviews and ratings from DOM (e.g. Judge.me, Shopify Reviews, etc.)."""
    rating: Optional[float] = None
    review_count: Optional[int] = None
    reviews: List[ProductReview] = []

    # Rating badge selectors
    # Judge.me: <span class='jdgm-prev-badge__stars' data-score='4.3'>
    badge = soup.select_one(".jdgm-prev-badge, .review-rating-summary, .product-reviews-badge")
    if badge:
        score_attr = badge.get("data-score") or badge.get("data-average-rating")
        if score_attr:
            try:
                rating = float(score_attr)
            except ValueError:
                pass
        count_attr = badge.get("data-number-of-reviews")
        if count_attr:
            try:
                review_count = int(count_attr)
            except ValueError:
                pass

    if rating is None:
        # Fallback text rating
        rating_elem = soup.select_one(".jdgm-prev-badge__stars, .rating-score, .stars-rating")
        if rating_elem:
            text = rating_elem.get_text(strip=True)
            match = re.search(r"(\d+(?:\.\d+)?)", text)
            if match:
                try:
                    val = float(match.group(1))
                    if 0.0 <= val <= 5.0:
                        rating = val
                except ValueError:
                    pass

    if review_count is None:
        count_elem = soup.select_one(".jdgm-prev-badge__text, .review-count, .reviews-count")
        if count_elem:
            text = count_elem.get_text(strip=True)
            match = re.search(r"(\d+)", text)
            if match:
                try:
                    review_count = int(match.group(1))
                except ValueError:
                    pass

    # Review cards / individual reviews
    review_selectors = [
        ".jdgm-rev",
        ".product-review",
        ".customer-review",
        ".review-item",
    ]

    for sel in review_selectors:
        for rev in soup.select(sel):
            author_elem = rev.select_one(".jdgm-rev__author, .review-author, .author")
            author = author_elem.get_text(strip=True) if author_elem else None

            rev_rating = None
            star_elem = rev.select_one("[data-score], .jdgm-rev__rating")
            if star_elem and star_elem.get("data-score"):
                try:
                    rev_rating = float(star_elem["data-score"])
                except ValueError:
                    pass

            title_elem = rev.select_one(".jdgm-rev__title, .review-title, .title")
            title = title_elem.get_text(strip=True) if title_elem else None

            body_elem = rev.select_one(".jdgm-rev__body, .review-body, .content")
            content = body_elem.get_text(strip=True) if body_elem else None

            date_elem = rev.select_one(".jdgm-rev__timestamp, .review-date, .date")
            date_str = date_elem.get_text(strip=True) if date_elem else None

            verified = bool(rev.select_one(".jdgm-buyer-badge, .verified-badge"))

            if content or title:
                reviews.append(
                    ProductReview(
                        author=author,
                        rating=rev_rating,
                        title=title,
                        content=content,
                        date=date_str,
                        verified=verified,
                    )
                )

    return rating, review_count, reviews

