"""
AdPilot AI - Data Normalizer & Provenance Tracker
Normalizes extracted e-commerce data, merges data layers with priority,
computes field-level confidence scores, tracks source provenance,
and identifies missing fields.
"""

import re
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from agent.app.schemas.product import Product, ProductImage, ProductReview


STANDARD_FIELDS = [
    "product_name",
    "brand",
    "category",
    "description",
    "price",
    "original_price",
    "currency",
    "discount",
    "features",
    "specifications",
    "images",
    "reviews",
    "rating",
    "availability",
]


class ProductNormalizer:
    """Combines JSON-LD, OpenGraph, and HTML extraction layers into a strictly validated Product."""

    @staticmethod
    def normalize_text(text: Optional[str]) -> Optional[str]:
        if not text:
            return None
        # Remove HTML tags if present
        clean = re.sub(r"<[^>]+>", " ", text)
        clean = re.sub(r"\s+", " ", clean).strip()
        return clean if clean else None

    @classmethod
    def merge_and_normalize(
        cls,
        product_url: str,
        json_ld_data: Optional[Dict[str, Any]],
        og_data: Optional[Dict[str, Any]],
        html_data: Dict[str, Any],
        images: List[ProductImage],
        default_brand: Optional[str] = None,
    ) -> Product:
        """
        Merge extracted data according to source hierarchy:
        1. JSON-LD (highest precision)
        2. Open Graph / Twitter meta
        3. HTML DOM selectors
        """
        confidence: Dict[str, float] = {}
        provenance: Dict[str, str] = {}
        missing_fields: List[str] = []

        json_ld = json_ld_data or {}
        og = og_data or {}

        # 1. Product Name
        name = (
            cls.normalize_text(json_ld.get("product_name"))
            or cls.normalize_text(og.get("product_name"))
            or cls.normalize_text(html_data.get("product_name"))
        )
        if json_ld.get("product_name"):
            provenance["product_name"] = "json_ld"
            confidence["product_name"] = 0.98
        elif og.get("product_name"):
            provenance["product_name"] = "open_graph"
            confidence["product_name"] = 0.88
        elif html_data.get("product_name"):
            provenance["product_name"] = "html_dom"
            confidence["product_name"] = 0.80
        else:
            name = "Unnamed Product"
            confidence["product_name"] = 0.10
            missing_fields.append("product_name")

        # 2. Brand
        brand = (
            cls.normalize_text(json_ld.get("brand"))
            or cls.normalize_text(og.get("brand"))
            or cls.normalize_text(html_data.get("brand"))
        )
        if json_ld.get("brand"):
            provenance["brand"] = "json_ld"
            confidence["brand"] = 0.95
        elif og.get("brand"):
            provenance["brand"] = "open_graph"
            confidence["brand"] = 0.85
        elif html_data.get("brand"):
            provenance["brand"] = "html_dom"
            confidence["brand"] = 0.75
        elif default_brand:
            brand = default_brand
            provenance["brand"] = "domain_default"
            confidence["brand"] = 0.90
        else:
            missing_fields.append("brand")

        # 3. Category
        category = (
            cls.normalize_text(json_ld.get("category"))
            or cls.normalize_text(og.get("category"))
            or cls.normalize_text(html_data.get("category"))
        )
        if json_ld.get("category"):
            provenance["category"] = "json_ld"
            confidence["category"] = 0.90
        elif og.get("category"):
            provenance["category"] = "open_graph"
            confidence["category"] = 0.80
        elif html_data.get("category"):
            provenance["category"] = "html_dom"
            confidence["category"] = 0.70
        else:
            missing_fields.append("category")

        # 4. Description
        description = (
            cls.normalize_text(json_ld.get("description"))
            or cls.normalize_text(og.get("description"))
            or cls.normalize_text(html_data.get("description"))
        )
        if json_ld.get("description"):
            provenance["description"] = "json_ld"
            confidence["description"] = 0.95
        elif og.get("description"):
            provenance["description"] = "open_graph"
            confidence["description"] = 0.85
        elif html_data.get("description"):
            provenance["description"] = "html_dom"
            confidence["description"] = 0.75
        else:
            missing_fields.append("description")

        # 5. Price (NEVER default to 0.0)
        price: Optional[float] = None
        if json_ld.get("price") is not None:
            price = json_ld["price"]
            provenance["price"] = "json_ld_offers"
            confidence["price"] = 0.95
        elif og.get("price") is not None:
            price = og["price"]
            provenance["price"] = "open_graph"
            confidence["price"] = 0.85
        elif html_data.get("price") is not None:
            price = html_data["price"]
            provenance["price"] = "html_dom"
            confidence["price"] = 0.75
        else:
            missing_fields.append("price")

        # 6. Original Price (Compare at / MRP)
        original_price: Optional[float] = None
        if json_ld.get("original_price") is not None:
            original_price = json_ld["original_price"]
            provenance["original_price"] = "json_ld_offers"
            confidence["original_price"] = 0.90
        elif html_data.get("original_price") is not None:
            original_price = html_data["original_price"]
            provenance["original_price"] = "html_dom"
            confidence["original_price"] = 0.75
        else:
            missing_fields.append("original_price")

        # 7. Currency
        currency = (
            json_ld.get("currency")
            or og.get("currency")
            or html_data.get("currency")
        )
        if currency:
            currency = currency.upper().strip()
            provenance["currency"] = "extracted"
            confidence["currency"] = 0.90
        else:
            missing_fields.append("currency")

        # 8. Discount (Calculate or extract, never fabricate)
        discount: Optional[float] = None
        if price is not None and original_price is not None and original_price > price:
            discount = round(((original_price - price) / original_price) * 100.0, 1)
            provenance["discount"] = "calculated_from_prices"
            confidence["discount"] = 0.92
        elif html_data.get("discount") is not None:
            discount = html_data["discount"]
            provenance["discount"] = "html_dom"
            confidence["discount"] = 0.75
        else:
            missing_fields.append("discount")

        # 9. Features
        features: List[str] = html_data.get("features", [])
        if features:
            provenance["features"] = "html_bullets"
            confidence["features"] = 0.85
        else:
            missing_fields.append("features")

        # 10. Specifications
        specifications: Dict[str, Any] = {}
        if json_ld.get("specifications"):
            specifications.update(json_ld["specifications"])
        if html_data.get("specifications"):
            # Update with HTML specs (often richer on Shopify)
            for k, v in html_data["specifications"].items():
                if k not in specifications:
                    specifications[k] = v

        if specifications:
            provenance["specifications"] = "table_and_schema"
            confidence["specifications"] = 0.90
        else:
            missing_fields.append("specifications")

        # 11. Images
        if images:
            provenance["images"] = "multi_source_deduped"
            confidence["images"] = 0.95
        else:
            missing_fields.append("images")

        # 12. Reviews & Rating
        reviews: List[ProductReview] = []
        if json_ld.get("reviews"):
            for r in json_ld["reviews"]:
                reviews.append(
                    ProductReview(
                        author=r.get("author"),
                        rating=r.get("rating"),
                        title=r.get("title"),
                        content=r.get("content"),
                        date=r.get("date"),
                    )
                )
        if not reviews and html_data.get("reviews"):
            reviews.extend(html_data["reviews"])

        rating: Optional[float] = json_ld.get("rating") or html_data.get("rating")
        review_count: Optional[int] = json_ld.get("review_count") or html_data.get("review_count")

        if rating is not None:
            provenance["rating"] = "json_ld" if json_ld.get("rating") else "html_badge"
            confidence["rating"] = 0.90 if json_ld.get("rating") else 0.80
        else:
            missing_fields.append("rating")

        if not reviews:
            missing_fields.append("reviews")
        else:
            provenance["reviews"] = "json_ld_and_html"
            confidence["reviews"] = 0.88

        # 13. Availability
        availability = (
            json_ld.get("availability")
            or og.get("availability")
            or html_data.get("availability")
            or "Unknown"
        )
        if json_ld.get("availability"):
            provenance["availability"] = "json_ld_offers"
            confidence["availability"] = 0.95
        elif og.get("availability"):
            provenance["availability"] = "open_graph"
            confidence["availability"] = 0.85
        elif html_data.get("availability") != "Unknown":
            provenance["availability"] = "html_buttons"
            confidence["availability"] = 0.75
        else:
            confidence["availability"] = 0.30
            missing_fields.append("availability")

        # Construct validated Product model
        return Product(
            product_name=name,
            brand=brand,
            category=category,
            description=description,
            price=price,
            original_price=original_price,
            currency=currency,
            discount=discount,
            features=features,
            specifications=specifications,
            images=images,
            reviews=reviews,
            rating=rating,
            review_count=review_count,
            availability=availability,
            product_url=product_url,
            source_urls=[product_url],
            extraction_timestamp=datetime.now(timezone.utc),
            field_confidence=confidence,
            field_provenance=provenance,
            missing_fields=missing_fields,
        )

