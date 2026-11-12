"""
AdPilot AI - Deterministic Advertising Claim & Policy Validator (Step 09)
Links every factual claim in generated copy or rendered image/video text back to
verified ProductData fields and rejects unsupported health claims, performance
guarantees, bogus discounts/prices, fabricated testimonials, certifications,
and unverified comparative claims.
"""

import re
from typing import List, Optional, Tuple
import uuid

from agent.app.schemas.evaluation import EvaluationIssue, LinkedClaimEvidence
from agent.app.schemas.product import Product
from agent.app.services.fact_guard import (
    DISCOUNT_REGEX,
    PRICE_REGEX,
    check_text_factual_contradictions,
    flatten_product_text,
    tokenize,
)

HEALTH_CLAIM_REGEX = re.compile(
    r"\b(?:cures?|treats?|heals?|clinically\s+proven|medical[-\s]?grade|prevents?\s+disease|"
    r"boosts?\s+immunity|weight\s+loss|detoxif(?:y|ies)|doctor\s+recommended|therapeutic)\b",
    re.IGNORECASE,
)

PERFORMANCE_GUARANTEE_REGEX = re.compile(
    r"\b(?:100%\s+guaranteed|lifetime\s+guarantee|unbreakable|never\s+breaks|"
    r"zero\s+maintenance|works\s+like\s+magic|runs\s+forever|fastest\s+ever|\d+x\s+faster)\b",
    re.IGNORECASE,
)

CERTIFICATION_REGEX = re.compile(
    r"\b(?:ISO\s*\d{3,5}|ISI\s+certified|BIS\s+(?:approved|certified)|FDA\s+approved|"
    r"CE\s+certified|UL\s+listed|FSSAI|FCC\s+certified|certified\s+organic)\b",
    re.IGNORECASE,
)

COMPARATIVE_CLAIM_REGEX = re.compile(
    r"(?:#1\b|number\s+one\b|best[-\s]+in[-\s]+class|outperforms?\b|beats?\s+(?:all|competitors|every)|"
    r"better\s+than\s+[a-z]+|cheaper\s+than\s+[a-z]+|world'?s\s+best|unmatched\s+in\s+the\s+market)",
    re.IGNORECASE,
)

FABRICATED_RATING_REGEX = re.compile(
    r"\b(\d(?:\.\d)?)\s*(?:/\s*5|stars?|★)|\b(\d{1,3}(?:,\d{3})+|\d{4,})\+?\s*(?:happy\s+customers|reviews|buyers)\b",
    re.IGNORECASE,
)


def _issue(
    code: str,
    criterion: str,
    message: str,
    evidence: Optional[str] = None,
    suggested_fix: Optional[str] = None,
) -> EvaluationIssue:
    return EvaluationIssue(
        issue_id=f"iss_{uuid.uuid4().hex[:8]}",
        code=code,
        criterion=criterion,
        severity="hard_rejection",
        source="claim_validator",
        message=message,
        evidence=evidence,
        suggested_fix=suggested_fix,
    )


class ClaimValidator:
    """Validates copy and visible creative text strictly against extracted ProductData."""

    def audit_text(self, text: str, product: Product, *, criterion: str = "misleading_content_compliance") -> List[EvaluationIssue]:
        """Return list of hard-rejection EvaluationIssues for any unsupported claim or price error."""
        if not text or not text.strip():
            return []

        issues: List[EvaluationIssue] = []
        product_text = flatten_product_text(product)

        # 1. Shared Step 05/06 factual contradictions (wattage, warranty, cordless, discount > actual, missing price)
        for code, msg in check_text_factual_contradictions(text, product, product_text):
            mapped_code = code
            if "price" in msg.lower() and product.price is None:
                mapped_code = "MISSING_PRICE_FABRICATION"
            elif "discount" in msg.lower():
                mapped_code = "INCORRECT_PROMOTIONAL_PRICE"
            else:
                mapped_code = "FABRICATED_PRODUCT_SPECIFICATION"
            issues.append(_issue(mapped_code, criterion, msg, evidence=text[:140]))

        # 2. Exact price accuracy check when Product.price is present
        if product.price is not None:
            allowed_prices = {float(product.price)}
            if product.original_price is not None:
                allowed_prices.add(float(product.original_price))
            for m in PRICE_REGEX.finditer(text):
                raw_num = m.group(1).replace(",", "")
                try:
                    val = float(raw_num)
                except ValueError:
                    continue
                if all(abs(val - allowed) > 1.0 for allowed in allowed_prices):
                    issues.append(
                        _issue(
                            "INCORRECT_PROMOTIONAL_PRICE",
                            "misleading_content_compliance",
                            f"Promotional price '{m.group(0)}' does not match verified price ({product.currency or ''} {product.price}).",
                            evidence=m.group(0),
                            suggested_fix=f"Use exact verified price {product.price} or omit price.",
                        )
                    )

        # 3. Free shipping / bogus discount phrasing when absent in ProductData
        if product.discount is None and re.search(r"\b(?:flash\s+sale|flat\s+\d+%|mega\s+discount)\b", text, re.IGNORECASE):
            issues.append(
                _issue(
                    "INCORRECT_PROMOTIONAL_PRICE",
                    criterion,
                    "Promo discount wording used when product_data.discount is unavailable.",
                    evidence=text[:120],
                )
            )

        # 4. Unsupported health claims
        for m in HEALTH_CLAIM_REGEX.finditer(text):
            if m.group(0).lower() not in product_text:
                issues.append(
                    _issue(
                        "UNSUPPORTED_HEALTH_CLAIM",
                        criterion,
                        f"Unsupported health or medical claim '{m.group(0)}' absent from ProductData.",
                        evidence=m.group(0),
                        suggested_fix="Remove health/medical wording and cite verified product features only.",
                    )
                )

        # 5. Unsupported performance guarantees
        for m in PERFORMANCE_GUARANTEE_REGEX.finditer(text):
            if m.group(0).lower() not in product_text:
                issues.append(
                    _issue(
                        "UNSUPPORTED_PERFORMANCE_GUARANTEE",
                        criterion,
                        f"Unsupported absolute guarantee '{m.group(0)}' not backed by verified warranty/specs.",
                        evidence=m.group(0),
                        suggested_fix="Cite exact verified warranty or specification numbers instead.",
                    )
                )

        # 6. Unsupported certifications
        for m in CERTIFICATION_REGEX.finditer(text):
            if m.group(0).lower() not in product_text:
                issues.append(
                    _issue(
                        "UNSUPPORTED_CERTIFICATION",
                        criterion,
                        f"Unsupported certification '{m.group(0)}' not present in ProductData.",
                        evidence=m.group(0),
                        suggested_fix="Remove unverified certification badges or regulatory claims.",
                    )
                )

        # 7. Unsupported comparative claims
        for m in COMPARATIVE_CLAIM_REGEX.finditer(text):
            if m.group(0).lower() not in product_text:
                issues.append(
                    _issue(
                        "UNSUPPORTED_COMPARATIVE_CLAIM",
                        criterion,
                        f"Unsupported comparative superlative '{m.group(0)}' without comparative evidence.",
                        evidence=m.group(0),
                        suggested_fix="Describe product's verified attributes directly without competitor/superlative comparisons.",
                    )
                )

        # 8. Unsupported testimonials / rating or customer count fabrication
        for m in FABRICATED_RATING_REGEX.finditer(text):
            if m.group(1):
                claimed_rating = float(m.group(1))
                if product.rating is None or abs(claimed_rating - product.rating) > 0.15:
                    issues.append(
                        _issue(
                            "UNSUPPORTED_TESTIMONIAL_OR_REVIEW",
                            criterion,
                            f"Stated rating '{m.group(0)}' does not match extracted product_data.rating ({product.rating}).",
                            evidence=m.group(0),
                        )
                    )
            elif m.group(2):
                claimed_count = int(m.group(2).replace(",", ""))
                if product.review_count is None or claimed_count > product.review_count:
                    issues.append(
                        _issue(
                            "UNSUPPORTED_TESTIMONIAL_OR_REVIEW",
                            criterion,
                            f"Customer/review volume '{m.group(0)}' unsupported by review_count ({product.review_count}).",
                            evidence=m.group(0),
                        )
                    )

        return issues

    def link_claims_to_product(self, text: str, product: Product) -> List[LinkedClaimEvidence]:
        """Identify verified ProductData fields supporting claims present inside `text`."""
        links: List[LinkedClaimEvidence] = []
        text_lower = text.lower()
        text_tokens = tokenize(text)

        if product.price is not None:
            p_int = str(int(product.price))
            if p_int in text.replace(",", ""):
                links.append(
                    LinkedClaimEvidence(
                        claim_text=f"Price {product.currency or ''} {product.price}",
                        verified_source_field="price",
                        evidence_snippet=f"{product.currency or ''} {product.price}",
                    )
                )

        if product.discount is not None and f"{int(product.discount)}%" in text:
            links.append(
                LinkedClaimEvidence(
                    claim_text=f"{int(product.discount)}% discount",
                    verified_source_field="discount",
                    evidence_snippet=f"{product.discount}% off MRP",
                )
            )

        if product.rating is not None and str(product.rating) in text:
            links.append(
                LinkedClaimEvidence(
                    claim_text=f"{product.rating} rating",
                    verified_source_field="rating",
                    evidence_snippet=f"rating={product.rating} ({product.review_count} reviews)",
                )
            )

        for idx, feat in enumerate(product.features):
            feat_tokens = tokenize(feat)
            overlap = text_tokens & feat_tokens
            if len(overlap) >= 2 or (feat.lower() in text_lower):
                links.append(
                    LinkedClaimEvidence(
                        claim_text=", ".join(sorted(overlap)[:4]) or feat[:60],
                        verified_source_field=f"features[{idx}]",
                        evidence_snippet=feat,
                    )
                )

        for k, v in product.specifications.items():
            val_str = str(v).strip()
            if val_str and val_str.lower() in text_lower:
                links.append(
                    LinkedClaimEvidence(
                        claim_text=f"{k}: {val_str}",
                        verified_source_field=f"specifications.{k}",
                        evidence_snippet=f"{k}={val_str}",
                    )
                )

        if not links and product.brand and product.brand.lower() in text_lower:
            links.append(
                LinkedClaimEvidence(
                    claim_text=f"Brand {product.brand}",
                    verified_source_field="brand",
                    evidence_snippet=product.brand,
                )
            )

        return links

