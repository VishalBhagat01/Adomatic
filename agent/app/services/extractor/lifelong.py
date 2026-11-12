"""
AdPilot AI - Lifelong India Specialized Product Extractor
Extracts product intelligence from Lifelong India (lifelongindiaonline.com)
including specifications, feature highlights, Shopify JSON-LD, pricing, and reviews.
"""

import re
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup

from agent.app.schemas.product import Product
from agent.app.services.extractor.base import BaseExtractor
from agent.app.services.extractor.normalizer import ProductNormalizer
from agent.app.services.extractor.parsers.html_parser import (
    extract_availability_from_soup,
    extract_features_from_soup,
    extract_price_from_soup,
    extract_reviews_from_soup,
    extract_specifications_from_soup,
)
from agent.app.services.extractor.parsers.images import extract_images_from_soup
from agent.app.services.extractor.parsers.json_ld import parse_json_ld
from agent.app.services.extractor.parsers.open_graph import parse_open_graph


class LifelongIndiaExtractor(BaseExtractor):
    """Specialized extractor for Lifelong India products."""

    name: str = "lifelong_india_extractor"

    def can_handle(self, domain: str) -> bool:
        domain_lower = domain.lower()
        return (
            "lifelongindiaonline.com" in domain_lower
            or "lifelongonline.com" in domain_lower
            or "lifelongindia.com" in domain_lower
        )

    def extract(self, soup: BeautifulSoup, product_url: str) -> Product:
        """Extract Lifelong India product data through layered parsing."""
        # 1. JSON-LD parsing
        json_ld_data = parse_json_ld(soup)

        # 2. Open Graph parsing
        og_data = parse_open_graph(soup)

        # 3. HTML DOM parsing
        features = extract_features_from_soup(soup)
        specifications = extract_specifications_from_soup(soup)
        dom_price, dom_original_price, dom_currency = extract_price_from_soup(soup)
        dom_availability = extract_availability_from_soup(soup)
        dom_rating, dom_review_count, dom_reviews = extract_reviews_from_soup(soup)

        # HTML title fallback
        html_title = None
        h1_elem = soup.select_one("h1.product-title, h1.product__title, h1.product-single__title, h1")
        if h1_elem:
            html_title = h1_elem.get_text(strip=True)

        # HTML description fallback
        html_desc = None
        desc_elem = soup.select_one(".product-description, .product__description, .description")
        if desc_elem:
            html_desc = desc_elem.get_text(strip=True)

        # Aggregate HTML layer
        html_data: Dict[str, Any] = {
            "product_name": html_title,
            "brand": "Lifelong",
            "category": None,
            "description": html_desc,
            "price": dom_price,
            "original_price": dom_original_price,
            "currency": dom_currency or "INR",
            "discount": None,
            "features": features,
            "specifications": specifications,
            "availability": dom_availability,
            "rating": dom_rating,
            "review_count": dom_review_count,
            "reviews": dom_reviews,
        }

        # 4. Images extraction with Shopify CDN enhancement
        json_ld_images = json_ld_data.get("images", []) if json_ld_data else []
        og_images = og_data.get("images", []) if og_data else []
        images = extract_images_from_soup(
            soup=soup,
            base_url=product_url,
            json_ld_images=json_ld_images,
            og_images=og_images,
        )

        # 5. Normalization, provenance tracking, and confidence scoring
        product = ProductNormalizer.merge_and_normalize(
            product_url=product_url,
            json_ld_data=json_ld_data,
            og_data=og_data,
            html_data=html_data,
            images=images,
            default_brand="Lifelong",
        )

        return product

