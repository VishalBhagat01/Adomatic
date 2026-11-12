"""
AdPilot AI - Local Strategy Quality & Factuality Validator
Audits Gemini-generated MarketingStrategy outputs for:
1. Incomplete structured output & broken ID references
2. Repeated or overlapping marketing angles
3. Generic or fabricated-statistic personas
4. Contradictory product information (pricing, discounts, specs)
5. Unsupported claims from user prompt leaking into marketing copy
"""

import re
from typing import List, Set
from agent.app.schemas.product import Product
from agent.app.schemas.strategy import (
    MarketingStrategy,
    QualityIssue,
    QualityValidationResult,
)
from agent.app.services.fact_guard import (
    check_text_factual_contradictions,
    flatten_product_text as _flatten_product_text,
    jaccard_similarity as _jaccard_similarity,
    tokenize as _tokenize,
)

GENERIC_PERSONA_NAMES = {
    "general consumer",
    "general consumers",
    "general audience",
    "general shoppers",
    "all consumers",
    "all shoppers",
    "everyone",
    "anyone",
    "customers",
    "shoppers",
    "users",
    "people",
    "target audience",
    "online shoppers",
    "average consumer",
}


def _positive_strategy_texts(strategy: MarketingStrategy) -> List[tuple[str, str]]:
    """Return (field_path, text) for positive claims and ad copy (excludes claim_validations & creative_donts)."""
    items: List[tuple[str, str]] = []
    for idx, claim in enumerate(strategy.product_knowledge.supported_claims):
        items.append((f"product_knowledge.supported_claims[{idx}]", claim))
    for idx, feat in enumerate(strategy.product_knowledge.verified_features):
        items.append((f"product_knowledge.verified_features[{idx}]", feat))
    for idx, angle in enumerate(strategy.marketing_angles):
        items.append((f"marketing_angles[{idx}].core_promise", angle.core_promise))
        items.append((f"marketing_angles[{idx}].recommended_messaging", angle.recommended_messaging))
        for h_idx, hook in enumerate(angle.hooks):
            items.append((f"marketing_angles[{idx}].hooks[{h_idx}]", hook))
    return items


class StrategyQualityValidator:
    """Runs deterministic quality and fact-grounding audits on MarketingStrategy."""

    @classmethod
    def validate(
        cls,
        strategy: MarketingStrategy,
        product: Product,
        user_prompt: str,
        requested_placements: List[str],
    ) -> QualityValidationResult:
        issues: List[QualityIssue] = []

        cls._check_completeness(strategy, product, issues)
        cls._check_repeated_angles(strategy, issues)
        cls._check_personas(strategy, product, issues)
        cls._check_product_contradictions(strategy, product, issues)
        cls._check_unsupported_prompt_claims(strategy, product, user_prompt, issues)

        error_count = sum(1 for i in issues if i.severity == "error")
        warning_count = sum(1 for i in issues if i.severity == "warning")

        score = max(0.0, round(1.0 - (error_count * 0.25) - (warning_count * 0.05), 2))
        return QualityValidationResult(
            passed=(error_count == 0),
            score=score,
            issues=issues,
        )

    @staticmethod
    def _check_completeness(strategy: MarketingStrategy, product: Product, issues: List[QualityIssue]):
        pk = strategy.product_knowledge
        if not pk.core_functionality or len(pk.core_functionality.strip()) < 15:
            issues.append(QualityIssue(
                code="INCOMPLETE_OUTPUT",
                severity="error",
                message="product_knowledge.core_functionality is empty or too brief.",
                field_path="product_knowledge.core_functionality",
            ))

        if (product.features or product.specifications) and not pk.verified_features:
            issues.append(QualityIssue(
                code="INCOMPLETE_OUTPUT",
                severity="error",
                message="verified_features must not be empty when ProductData contains features or specs.",
                field_path="product_knowledge.verified_features",
            ))

        # Expect 3-5 angles when ProductData is rich
        is_rich_product = bool(product.description) and (bool(product.features) or bool(product.specifications))
        if is_rich_product and len(strategy.marketing_angles) < 3:
            issues.append(QualityIssue(
                code="INCOMPLETE_OUTPUT",
                severity="error",
                message=f"Expected 3-5 distinct marketing angles for rich product data, got {len(strategy.marketing_angles)}.",
                field_path="marketing_angles",
            ))

        persona_ids = {p.persona_id for p in strategy.personas}
        angle_ids = {a.angle_id for a in strategy.marketing_angles}

        if strategy.recommendations.priority_angle_id not in angle_ids:
            issues.append(QualityIssue(
                code="INCOMPLETE_OUTPUT",
                severity="error",
                message=f"priority_angle_id '{strategy.recommendations.priority_angle_id}' does not match any marketing_angle.",
                field_path="recommendations.priority_angle_id",
            ))

        for idx, angle in enumerate(strategy.marketing_angles):
            if angle.target_persona_id not in persona_ids:
                issues.append(QualityIssue(
                    code="INCOMPLETE_OUTPUT",
                    severity="error",
                    message=f"Angle '{angle.angle_id}' references unknown persona '{angle.target_persona_id}'.",
                    field_path=f"marketing_angles[{idx}].target_persona_id",
                ))
            if not angle.recommended_messaging.strip() or not angle.visual_direction.strip():
                issues.append(QualityIssue(
                    code="INCOMPLETE_OUTPUT",
                    severity="error",
                    message=f"Angle '{angle.angle_id}' is missing messaging or visual direction.",
                    field_path=f"marketing_angles[{idx}]",
                ))
            if len(angle.hooks) < 2:
                issues.append(QualityIssue(
                    code="INCOMPLETE_OUTPUT",
                    severity="error",
                    message=f"Angle '{angle.angle_id}' should provide at least 2 distinct hooks.",
                    field_path=f"marketing_angles[{idx}].hooks",
                ))

    @staticmethod
    def _check_repeated_angles(strategy: MarketingStrategy, issues: List[QualityIssue]):
        angles = strategy.marketing_angles
        seen_hooks: Set[str] = set()

        for i in range(len(angles)):
            for h in angles[i].hooks:
                norm_h = re.sub(r"\s+", " ", h.strip().lower())
                if norm_h in seen_hooks:
                    issues.append(QualityIssue(
                        code="REPEATED_ANGLES",
                        severity="error",
                        message=f"Duplicate hook '{h}' repeated across marketing angles.",
                        field_path=f"marketing_angles[{i}].hooks",
                    ))
                seen_hooks.add(norm_h)

            for j in range(i + 1, len(angles)):
                a, b = angles[i], angles[j]
                if a.angle_name.strip().lower() == b.angle_name.strip().lower():
                    issues.append(QualityIssue(
                        code="REPEATED_ANGLES",
                        severity="error",
                        message=f"Duplicate angle name '{a.angle_name}'.",
                        field_path=f"marketing_angles[{j}].angle_name",
                    ))
                    continue

                sim_promise = _jaccard_similarity(
                    f"{a.angle_name} {a.core_promise}",
                    f"{b.angle_name} {b.core_promise}",
                )
                sim_msg = _jaccard_similarity(a.recommended_messaging, b.recommended_messaging)
                if sim_promise >= 0.68 or sim_msg >= 0.72:
                    issues.append(QualityIssue(
                        code="REPEATED_ANGLES",
                        severity="error",
                        message=(
                            f"Marketing angles '{a.angle_name}' and '{b.angle_name}' "
                            f"are overly repetitive (similarity={max(sim_promise, sim_msg):.2f})."
                        ),
                        field_path=f"marketing_angles[{j}]",
                    ))

    @staticmethod
    def _check_personas(strategy: MarketingStrategy, product: Product, issues: List[QualityIssue]):
        product_text = _flatten_product_text(product)
        stat_pattern = re.compile(
            r"\b\d{1,3}%\s+of\s+(?:consumers|users|buyers|shoppers|millennials|gen\s*z|households|women|men)\b",
            re.IGNORECASE,
        )
        income_pattern = re.compile(
            r"\b(?:earn(?:s|ing)?|income\s+of)\s+(?:\$|₹|Rs\.?)\s*\d+",
            re.IGNORECASE,
        )

        for idx, p in enumerate(strategy.personas):
            name_lower = p.persona_name.strip().lower()
            if name_lower in GENERIC_PERSONA_NAMES or len(name_lower) < 4:
                issues.append(QualityIssue(
                    code="GENERIC_PERSONA",
                    severity="error",
                    message=f"Persona '{p.persona_name}' is overly generic; specify a concrete product use-case segment.",
                    field_path=f"personas[{idx}].persona_name",
                ))

            if any(len(pp.strip()) < 8 for pp in p.pain_points):
                issues.append(QualityIssue(
                    code="GENERIC_PERSONA",
                    severity="error",
                    message=f"Persona '{p.persona_name}' contains empty or trivial pain points.",
                    field_path=f"personas[{idx}].pain_points",
                ))

            combined = f"{p.persona_name} {p.segment_context} {' '.join(p.pain_points)} {' '.join(p.purchase_motivations)}"
            if (stat_pattern.search(combined) or income_pattern.search(combined)) and not stat_pattern.search(product_text):
                issues.append(QualityIssue(
                    code="GENERIC_PERSONA",
                    severity="error",
                    message=f"Persona '{p.persona_name}' manufactures unverified demographic statistics or income figures.",
                    field_path=f"personas[{idx}].segment_context",
                ))

    @staticmethod
    def _check_product_contradictions(strategy: MarketingStrategy, product: Product, issues: List[QualityIssue]):
        product_text = _flatten_product_text(product)
        positive_texts = _positive_strategy_texts(strategy)

        for path, text in positive_texts:
            for code, msg in check_text_factual_contradictions(text, product, product_text):
                issues.append(QualityIssue(
                    code=code,
                    severity="error",
                    message=msg,
                    field_path=path,
                ))

    @staticmethod
    def _check_unsupported_prompt_claims(
        strategy: MarketingStrategy,
        product: Product,
        user_prompt: str,
        issues: List[QualityIssue],
    ):
        """
        Verify that unsupported factual claims appearing in user_prompt are flagged
        in strategy.claim_validations AND not marked 'supported' or leaked into ad copy.
        """
        product_text = _flatten_product_text(product)
        prompt_lower = user_prompt.lower()
        positive_texts = _positive_strategy_texts(strategy)

        # Patterns of concrete factual claims often injected via prompts
        probe_checks = [
            ("cordless", re.compile(r"\bcordless\b", re.I)),
            ("wireless", re.compile(r"\bwireless\b", re.I)),
            ("lifetime warranty", re.compile(r"\blifetime\s+warrant(?:y|ies)\b", re.I)),
            ("waterproof", re.compile(r"\bwaterproof\b", re.I)),
            ("clinically proven", re.compile(r"\bclinically\s+proven\b", re.I)),
            ("doctor recommended", re.compile(r"\bdoctor\s+recommended\b", re.I)),
            ("certified organic", re.compile(r"\bcertified\s+organic\b", re.I)),
        ]

        # Numeric discount / wattage probes in user prompt
        watt_matches = re.findall(r"\b(\d{2,5})\s*(?:w|watt|watts)\b", prompt_lower)
        for w in watt_matches:
            if not re.search(rf"\b{re.escape(w)}\s*(?:w|watt|watts)\b", product_text):
                probe_checks.append((f"{w}w", re.compile(rf"\b{re.escape(w)}\s*(?:w|watt|watts)\b", re.I)))

        disc_matches = re.findall(r"\b(\d+(?:\.\d+)?)\s*%\s*off\b", prompt_lower)
        for d in disc_matches:
            if product.discount is None or float(d) > product.discount + 1.0:
                probe_checks.append((f"{d}% off", re.compile(rf"\b{re.escape(d)}\s*%\s*off\b", re.I)))

        for keyword, pattern in probe_checks:
            if pattern.search(prompt_lower) and not pattern.search(product_text):
                # This claim is in user_prompt, NOT in product_data -> must be flagged!
                matching_validations = [
                    cv for cv in strategy.claim_validations
                    if keyword in cv.claim_text.lower() or pattern.search(cv.claim_text)
                ]

                if not matching_validations:
                    issues.append(QualityIssue(
                        code="UNSUPPORTED_CLAIM",
                        severity="error",
                        message=f"User prompt requested unsupported claim '{keyword}', but claim_validations failed to flag it.",
                        field_path="claim_validations",
                    ))
                elif any(cv.status == "supported" for cv in matching_validations):
                    issues.append(QualityIssue(
                        code="UNSUPPORTED_CLAIM",
                        severity="error",
                        message=f"Unsupported user prompt claim '{keyword}' was wrongly marked as 'supported'.",
                        field_path="claim_validations",
                    ))

                # Also verify it didn't leak into positive copy
                for path, text in positive_texts:
                    if pattern.search(text) and f"not {keyword}" not in text.lower() and f"non-{keyword}" not in text.lower():
                        issues.append(QualityIssue(
                            code="UNSUPPORTED_CLAIM",
                            severity="error",
                            message=f"Flagged unsupported prompt claim '{keyword}' leaked into '{path}'.",
                            field_path=path,
                        ))

