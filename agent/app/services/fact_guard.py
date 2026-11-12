"""
AdPilot AI - Shared Factuality & Similarity Guards
Reusable deterministic checks preventing contradictory specifications, fabricated pricing,
wireless/cordless hallucinations, and low-differentiation duplicate text across Steps 5 and 6.
"""

import re
from typing import List, Set, Tuple
from agent.app.schemas.product import Product

STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "with", "to", "in", "on", "of",
    "is", "are", "your", "you", "this", "that", "from", "by", "at", "it", "as",
}

PRICE_REGEX = re.compile(r"(?:₹|Rs\.?|\$|INR|USD)\s*(\d[\d,]*(?:\.\d+)?)", re.IGNORECASE)
DISCOUNT_REGEX = re.compile(r"(\d+(?:\.\d+)?)\s*%\s*(?:off|discount|savings?)", re.IGNORECASE)
WATTAGE_REGEX = re.compile(r"\b(\d{2,5})\s*(?:w|watt|watts)\b", re.IGNORECASE)
WARRANTY_REGEX = re.compile(r"\b(\d+)\s*[-\s]?year(?:s)?\s+(?:brand\s+)?warranty\b", re.IGNORECASE)


def tokenize(text: str) -> Set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if len(w) > 2 and w not in STOPWORDS}


def jaccard_similarity(text_a: str, text_b: str) -> float:
    tokens_a = tokenize(text_a)
    tokens_b = tokenize(text_b)
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def flatten_product_text(product: Product) -> str:
    parts = [
        product.product_name or "",
        product.brand or "",
        product.category or "",
        product.description or "",
        " ".join(product.features),
        " ".join(f"{k} {v}" for k, v in product.specifications.items()),
        " ".join((r.content or "") for r in product.reviews),
    ]
    return " ".join(parts).lower()


def check_text_factual_contradictions(
    text: str,
    product: Product,
    product_text: str,
) -> List[Tuple[str, str]]:
    """
    Scan positive copy/direction text for contradictions against ProductData.
    Returns list of (issue_code, human_readable_reason).
    """
    findings: List[Tuple[str, str]] = []
    product_wattages = set(WATTAGE_REGEX.findall(product_text))
    product_warranties = set(WARRANTY_REGEX.findall(product_text))
    is_cordless_in_product = any(
        w in product_text for w in ["cordless", "wireless", "rechargeable", "battery operated"]
    )

    # 1. Price hallucination when price is None
    if product.price is None and PRICE_REGEX.search(text):
        findings.append((
            "CONTRADICTORY_PRODUCT_INFO",
            f"Stated explicit price in '{text}' even though extracted product_data.price is missing (None).",
        ))

    # 2. Discount verification
    for m in DISCOUNT_REGEX.finditer(text):
        claimed_disc = float(m.group(1))
        if product.discount is None:
            findings.append((
                "CONTRADICTORY_PRODUCT_INFO",
                f"Stated '{m.group(0)}' when extracted product discount is missing.",
            ))
        elif claimed_disc > product.discount + 1.0:
            findings.append((
                "CONTRADICTORY_PRODUCT_INFO",
                f"Claimed '{m.group(0)}' exceeds actual product discount ({product.discount}%).",
            ))

    # 3. Wattage contradiction
    if product_wattages:
        for m in WATTAGE_REGEX.finditer(text):
            w_val = m.group(1)
            if w_val not in product_wattages:
                findings.append((
                    "CONTRADICTORY_PRODUCT_INFO",
                    f"Contradictory wattage '{m.group(0)}' (product specifies {', '.join(product_wattages)}W).",
                ))

    # 4. Warranty contradiction
    if product_warranties:
        for m in WARRANTY_REGEX.finditer(text):
            yr_val = m.group(1)
            if yr_val not in product_warranties:
                findings.append((
                    "CONTRADICTORY_PRODUCT_INFO",
                    f"Contradictory warranty '{m.group(0)}' (product specifies {', '.join(product_warranties)} year warranty).",
                ))
    if "lifetime warranty" in text.lower() and "lifetime" not in product_text:
        findings.append((
            "CONTRADICTORY_PRODUCT_INFO",
            "Claimed unsupported 'lifetime warranty' not present in ProductData.",
        ))

    # 5. Cordless/wireless fabrication
    text_lower = text.lower()
    if not is_cordless_in_product and any(
        phrase in text_lower
        and f"not {phrase}" not in text_lower
        and f"non-{phrase}" not in text_lower
        and f"never {phrase}" not in text_lower
        for phrase in ["cordless", "wireless", "battery-powered", "battery powered"]
    ):
        findings.append((
            "CONTRADICTORY_PRODUCT_INFO",
            "Claimed product is cordless/wireless without evidence in ProductData.",
        ))

    return findings

