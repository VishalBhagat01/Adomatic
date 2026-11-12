"""
AdPilot AI - Open Graph & Meta Tag Parser
Extracts social meta tags (OpenGraph, Twitter Cards, Product Meta) from HTML.
"""

import re
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup


def parse_open_graph(soup: BeautifulSoup) -> Dict[str, Any]:
    """Extract Open Graph, Twitter, and Product meta tags."""
    result: Dict[str, Any] = {
        "product_name": None,
        "brand": None,
        "category": None,
        "description": None,
        "price": None,
        "currency": None,
        "availability": None,
        "images": [],
    }

    meta_tags = soup.find_all("meta")
    meta_dict: Dict[str, str] = {}

    for tag in meta_tags:
        prop = tag.get("property") or tag.get("name")
        content = tag.get("content")
        if prop and content:
            meta_dict[prop.lower().strip()] = content.strip()

    # Product Name
    title = (
        meta_dict.get("og:title")
        or meta_dict.get("twitter:title")
        or meta_dict.get("product:title")
    )
    if title:
        # Strip common trailing site suffixes like " | Lifelong Online"
        clean_title = re.sub(r"\s*[|\-–—]\s*(?:Lifelong|Shopify|Store|Official).*$", "", title, flags=re.I)
        result["product_name"] = clean_title.strip()

    # Description
    desc = (
        meta_dict.get("og:description")
        or meta_dict.get("twitter:description")
        or meta_dict.get("description")
    )
    if desc:
        clean_desc = re.sub(r"<[^>]+>", " ", desc)
        result["description"] = re.sub(r"\s+", " ", clean_desc).strip()

    # Images
    og_image = meta_dict.get("og:image") or meta_dict.get("og:image:secure_url") or meta_dict.get("twitter:image")
    if og_image:
        result["images"].append(og_image)

    # Price
    price_val = (
        meta_dict.get("og:price:amount")
        or meta_dict.get("product:price:amount")
        or meta_dict.get("price")
    )
    if price_val:
        try:
            clean_p = re.sub(r"[^\d.]", "", price_val)
            if clean_p:
                result["price"] = float(clean_p)
        except (ValueError, TypeError):
            pass

    # Currency
    currency_val = (
        meta_dict.get("og:price:currency")
        or meta_dict.get("product:price:currency")
        or meta_dict.get("currency")
    )
    if currency_val:
        result["currency"] = currency_val.upper().strip()

    # Brand
    brand_val = (
        meta_dict.get("product:brand")
        or meta_dict.get("og:brand")
        or meta_dict.get("twitter:site")
    )
    if brand_val:
        result["brand"] = brand_val.strip()

    # Category
    category_val = meta_dict.get("product:category") or meta_dict.get("og:category")
    if category_val:
        result["category"] = category_val.strip()

    # Availability
    avail_val = meta_dict.get("og:availability") or meta_dict.get("product:availability")
    if avail_val:
        avail_lower = avail_val.lower()
        if "instock" in avail_lower or "in stock" in avail_lower:
            result["availability"] = "InStock"
        elif "outofstock" in avail_lower or "out of stock" in avail_lower:
            result["availability"] = "OutOfStock"
        elif "preorder" in avail_lower:
            result["availability"] = "PreOrder"

    return result

