"""
AdPilot AI - JSON-LD Product Schema Parser
Extracts schema.org Product, Offer, AggregateRating, and Review structures from HTML script tags.
Supports single products, lists, and @graph structures.
"""

import json
import re
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup

from agent.app.core.logging import logger


_PLACEHOLDER_VARIANT_NAMES = {"default title", "default", "n/a"}


def _merge_product_group_with_variant(group: Dict[str, Any]) -> Dict[str, Any]:
    """Synthesize a unified Product dict from a schema.org ProductGroup and its best variant."""
    merged = {k: v for k, v in group.items() if k != "hasVariant"}
    variants_raw = group.get("hasVariant")
    variants = (
        [v for v in variants_raw if isinstance(v, dict)]
        if isinstance(variants_raw, list)
        else ([variants_raw] if isinstance(variants_raw, dict) else [])
    )
    if not variants:
        return merged

    def _variant_rank(v: Dict[str, Any]) -> int:
        offers = v.get("offers")
        offer = offers[0] if isinstance(offers, list) and offers else (offers if isinstance(offers, dict) else {})
        avail = str(offer.get("availability", ""))
        return 2 if "InStock" in avail else (1 if offer.get("price") is not None else 0)

    primary = max(variants, key=_variant_rank)
    for field in ("offers", "sku", "gtin", "productID", "mpn", "url"):
        if field not in merged or merged[field] is None:
            if field in primary and primary[field] is not None:
                merged[field] = primary[field]
    if not merged.get("image") and primary.get("image"):
        merged["image"] = primary["image"]
    if not merged.get("name"):
        v_name = primary.get("name")
        if isinstance(v_name, str) and v_name.strip().lower() not in _PLACEHOLDER_VARIANT_NAMES:
            merged["name"] = v_name
    return merged


def _find_product_nodes(data: Any) -> List[Dict[str, Any]]:
    """Recursively search for objects with @type 'Product' or 'ProductGroup'."""
    products = []
    if isinstance(data, dict):
        node_type = data.get("@type")
        type_list = (
            [t.lower() for t in node_type if isinstance(t, str)]
            if isinstance(node_type, list)
            else ([node_type.lower()] if isinstance(node_type, str) else [])
        )
        if "productgroup" in type_list:
            products.append(_merge_product_group_with_variant(data))
            return products
        if "product" in type_list:
            products.append(data)

        # Check @graph
        if "@graph" in data and isinstance(data["@graph"], list):
            for item in data["@graph"]:
                products.extend(_find_product_nodes(item))

        # Check other nested dicts or lists
        for k, v in data.items():
            if k not in ("@graph", "@type"):
                products.extend(_find_product_nodes(v))
    elif isinstance(data, list):
        for item in data:
            products.extend(_find_product_nodes(item))
    return products


def parse_json_ld(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
    """
    Find and parse all application/ld+json scripts on the page, returning
    the first valid schema.org/Product entity and its parsed fields.
    """
    scripts = soup.find_all("script", type=re.compile(r"application/ld\+json", re.I))
    all_products: List[Dict[str, Any]] = []

    for idx, script in enumerate(scripts):
        raw_text = script.string or script.text
        if not raw_text or not raw_text.strip():
            continue

        raw_text = raw_text.strip()
        try:
            parsed = json.loads(raw_text)
            products = _find_product_nodes(parsed)
            all_products.extend(products)
        except json.JSONDecodeError as e:
            logger.debug(f"JSON-LD script {idx} decode error: {e}. Attempting sanitized parse.")
            # Remove trailing commas before closing braces/brackets
            sanitized = re.sub(r",\s*([\]}])", r"\1", raw_text)
            try:
                parsed = json.loads(sanitized)
                products = _find_product_nodes(parsed)
                all_products.extend(products)
            except Exception:
                logger.debug(f"Failed to parse sanitized JSON-LD in script {idx}")
                continue

    if not all_products:
        return None

    # Pick the most complete product node
    best_product = max(all_products, key=lambda p: len(p.keys()))
    return extract_product_fields_from_json_ld(best_product)


def extract_product_fields_from_json_ld(data: Dict[str, Any]) -> Dict[str, Any]:
    """Extract standard product fields and nested structures from a raw JSON-LD product dict."""
    result: Dict[str, Any] = {
        "raw_json_ld": data,
        "product_name": None,
        "brand": None,
        "category": None,
        "description": None,
        "price": None,
        "original_price": None,
        "currency": None,
        "availability": None,
        "rating": None,
        "review_count": None,
        "images": [],
        "reviews": [],
        "specifications": {},
        "features": [],
    }

    # 1. Product Name (skip Shopify generic variant placeholders like "Default Title")
    name = data.get("name") or data.get("title")
    if name and isinstance(name, str):
        cleaned_name = name.strip()
        if cleaned_name.lower() not in _PLACEHOLDER_VARIANT_NAMES:
            result["product_name"] = cleaned_name

    # 2. Brand
    brand_obj = data.get("brand")
    if isinstance(brand_obj, dict):
        result["brand"] = brand_obj.get("name", "").strip() or None
    elif isinstance(brand_obj, str):
        result["brand"] = brand_obj.strip()

    # 3. Category
    category = data.get("category")
    if category and isinstance(category, str):
        result["category"] = category.strip()

    # 4. Description
    desc = data.get("description")
    if desc and isinstance(desc, str):
        # Strip HTML tags if present in description
        clean_desc = re.sub(r"<[^>]+>", " ", desc)
        result["description"] = re.sub(r"\s+", " ", clean_desc).strip()

    # 5. Images
    images_raw = data.get("image")
    if isinstance(images_raw, str):
        result["images"].append(images_raw)
    elif isinstance(images_raw, list):
        for img in images_raw:
            if isinstance(img, str):
                result["images"].append(img)
            elif isinstance(img, dict) and "url" in img:
                result["images"].append(img["url"])
            elif isinstance(img, dict) and "contentUrl" in img:
                result["images"].append(img["contentUrl"])
    elif isinstance(images_raw, dict):
        if "url" in images_raw:
            result["images"].append(images_raw["url"])
        elif "contentUrl" in images_raw:
            result["images"].append(images_raw["contentUrl"])

    # 6. Offers (Pricing & Availability)
    offers = data.get("offers")
    offer_list = []
    if isinstance(offers, dict):
        offer_list = [offers]
    elif isinstance(offers, list):
        offer_list = [o for o in offers if isinstance(o, dict)]

    if offer_list:
        primary_offer = offer_list[0]
        # Price
        raw_price = primary_offer.get("price")
        if raw_price is not None:
            try:
                # Remove currency symbols or commas if string
                if isinstance(raw_price, (int, float)):
                    result["price"] = float(raw_price)
                else:
                    clean_p = re.sub(r"[^\d.]", "", str(raw_price))
                    if clean_p:
                        result["price"] = float(clean_p)
            except (ValueError, TypeError):
                pass

        # High/Low price if AggregateOffer
        if result["price"] is None and "lowPrice" in primary_offer:
            try:
                result["price"] = float(re.sub(r"[^\d.]", "", str(primary_offer["lowPrice"])))
            except (ValueError, TypeError):
                pass
        if "highPrice" in primary_offer:
            try:
                result["original_price"] = float(re.sub(r"[^\d.]", "", str(primary_offer["highPrice"])))
            except (ValueError, TypeError):
                pass

        # Currency
        currency = primary_offer.get("priceCurrency")
        if currency and isinstance(currency, str):
            result["currency"] = currency.upper().strip()

        # Availability
        avail = primary_offer.get("availability")
        if avail and isinstance(avail, str):
            if "InStock" in avail:
                result["availability"] = "InStock"
            elif "OutOfStock" in avail or "SoldOut" in avail:
                result["availability"] = "OutOfStock"
            elif "PreOrder" in avail:
                result["availability"] = "PreOrder"

    # 7. Aggregate Rating
    agg_rating = data.get("aggregateRating")
    if isinstance(agg_rating, dict):
        val = agg_rating.get("ratingValue")
        if val is not None:
            try:
                result["rating"] = round(float(val), 2)
            except (ValueError, TypeError):
                pass
        count = agg_rating.get("reviewCount") or agg_rating.get("ratingCount")
        if count is not None:
            try:
                result["review_count"] = int(re.sub(r"[^\d]", "", str(count)))
            except (ValueError, TypeError):
                pass

    # 8. Reviews
    reviews_raw = data.get("review") or data.get("reviews")
    if isinstance(reviews_raw, dict):
        reviews_raw = [reviews_raw]
    if isinstance(reviews_raw, list):
        for r in reviews_raw:
            if not isinstance(r, dict):
                continue
            author_val = None
            author_obj = r.get("author")
            if isinstance(author_obj, dict):
                author_val = author_obj.get("name")
            elif isinstance(author_obj, str):
                author_val = author_obj

            rating_val = None
            rev_rating = r.get("reviewRating")
            if isinstance(rev_rating, dict) and "ratingValue" in rev_rating:
                try:
                    rating_val = float(rev_rating["ratingValue"])
                except (ValueError, TypeError):
                    pass

            content_val = r.get("reviewBody") or r.get("description")
            title_val = r.get("name") or r.get("headline")
            date_val = r.get("datePublished")

            if content_val or title_val or rating_val:
                result["reviews"].append({
                    "author": author_val,
                    "rating": rating_val,
                    "title": title_val,
                    "content": content_val,
                    "date": date_val,
                })

    # 9. Additional Properties (Specifications)
    add_props = data.get("additionalProperty")
    if isinstance(add_props, list):
        for prop in add_props:
            if isinstance(prop, dict) and "name" in prop and "value" in prop:
                k = str(prop["name"]).strip()
                v = str(prop["value"]).strip()
                if k and v:
                    result["specifications"][k] = v

    return result

