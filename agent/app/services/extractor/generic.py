"""
AdPilot AI - Generic E-Commerce Extractor
Provides standard product extraction for any e-commerce site using Schema.org JSON-LD,
Open Graph, Microdata, and standard semantic HTML.
"""

from typing import Any, Dict
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


class GenericECommerceExtractor(BaseExtractor):
    """Fallback extractor applicable to any e-commerce store."""

    name: str = "generic_ecommerce_extractor"

    def can_handle(self, domain: str) -> bool:
        return True  # Fallback for all domains

    def extract(self, soup: BeautifulSoup, product_url: str) -> Product:
        """Extract product data using universal e-commerce conventions."""
        # 1. JSON-LD
        json_ld_data = parse_json_ld(soup)

        # 2. Open Graph & Twitter tags
        og_data = parse_open_graph(soup)

        # 3. HTML DOM parsing
        features = extract_features_from_soup(soup)
        specifications = extract_specifications_from_soup(soup)
        dom_price, dom_original_price, dom_currency = extract_price_from_soup(soup)
        dom_availability = extract_availability_from_soup(soup)
        dom_rating, dom_review_count, dom_reviews = extract_reviews_from_soup(soup)

        html_title = None
        h1 = soup.select_one("h1")
        if h1:
            html_title = h1.get_text(strip=True)

        html_desc = None
        desc_elem = soup.select_one("[itemprop='description'], .description, #description")
        if desc_elem:
            html_desc = desc_elem.get_text(strip=True)

        html_data: Dict[str, Any] = {
            "product_name": html_title,
            "brand": None,
            "category": None,
            "description": html_desc,
            "price": dom_price,
            "original_price": dom_original_price,
            "currency": dom_currency,
            "discount": None,
            "features": features,
            "specifications": specifications,
            "availability": dom_availability,
            "rating": dom_rating,
            "review_count": dom_review_count,
            "reviews": dom_reviews,
        }

        # 4. Images
        json_ld_images = json_ld_data.get("images", []) if json_ld_data else []
        og_images = og_data.get("images", []) if og_data else []
        images = extract_images_from_soup(
            soup=soup,
            base_url=product_url,
            json_ld_images=json_ld_images,
            og_images=og_images,
        )

        # 5. Normalize & Merge
        return ProductNormalizer.merge_and_normalize(
            product_url=product_url,
            json_ld_data=json_ld_data,
            og_data=og_data,
            html_data=html_data,
            images=images,
            default_brand=None,
        )

