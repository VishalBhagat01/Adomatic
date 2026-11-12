"""
AdPilot AI - Claim-Validated Advertising Copy Generation Engine (Step 09)
Generates platform-ready advertising copy strictly for APPROVED image or video creatives.
Produces 3 primary text variations, 3 headlines, 2 descriptions, CTA recommendation,
creative angle, and audience hypothesis—each verified against ProductData via ClaimValidator
and aligned with the evaluated visual creative.
"""

import base64
from pathlib import Path
import tempfile
from typing import List, Optional, Tuple
import uuid
from google.genai import types

from agent.app.core.config import settings
from agent.app.schemas.evaluation import (
    AdCopyDraft,
    AdCopyDraftItem,
    AdCopyGenerateRequest,
    AdCopyVariant,
    EvaluationIssue,
    LinkedClaimEvidence,
    ValidatedAdCopy,
)
from agent.app.schemas.product import Product
from agent.app.services.evaluation.claim_validator import ClaimValidator
from agent.app.services.evaluation.evaluator_service import _guess_image_mime
from agent.app.services.fact_guard import flatten_product_text, tokenize
from agent.app.services.storage import AgentStorage, agent_storage
from agent.app.services.strategy.gemini_client import GeminiStrategyClient
from agent.app.services.video_gen.ffmpeg_processor import FFmpegProcessor

AD_COPY_SYSTEM_INSTRUCTION = (
    "You are a senior performance copywriter and advertising compliance officer. "
    "Generate advertising copy ONLY using verified facts present in ProductData and observed in the creative. "
    "NEVER invent prices, discounts, percentages, health/medical benefits, absolute guarantees, "
    "certifications, customer ratings/review counts, or competitor comparisons unless explicitly present "
    "in ProductData. Match tone, hook, and messaging to the approved creative visual."
)


class AdCopyPreconditionError(ValueError):
    """Raised when ad copy generation is requested for an unapproved creative."""


class AdCopyService:
    """Generates and deterministically audits advertising copy for approved creatives."""

    def __init__(
        self,
        gemini_client: Optional[GeminiStrategyClient] = None,
        claim_validator: Optional[ClaimValidator] = None,
        ffmpeg_processor: Optional[FFmpegProcessor] = None,
        storage: Optional[AgentStorage] = None,
    ):
        self.gemini_client = gemini_client or GeminiStrategyClient()
        self.claim_validator = claim_validator or ClaimValidator()
        self.ffmpeg = ffmpeg_processor or FFmpegProcessor()
        self.storage = storage or agent_storage

    def _load_visual_parts(self, request: AdCopyGenerateRequest) -> List[types.Part]:
        raw: Optional[bytes] = None
        if request.creative_base64:
            try:
                raw = base64.b64decode(request.creative_base64)
            except Exception:
                raw = None
        elif request.object_key:
            raw = self.storage.download_bytes(
                bucket=settings.STORAGE_BUCKET_CREATIVES,
                object_key=request.object_key,
            )

        if not raw:
            return []

        if request.creative_evaluation.format == "image":
            return [types.Part.from_bytes(data=raw, mime_type=_guess_image_mime(raw))]

        # Video creative: extract a representative midpoint frame if readable by FFmpeg
        with tempfile.TemporaryDirectory(prefix="adpilot_copy_vid_") as tmp:
            vid_path = Path(tmp) / "approved.mp4"
            vid_path.write_bytes(raw)
            try:
                sampled = self.ffmpeg.extract_sample_frames(
                    vid_path,
                    [1.0],
                    Path(tmp) / "frames",
                )
                parts: List[types.Part] = []
                for idx, _ in enumerate(sampled):
                    frame_path = Path(tmp) / "frames" / f"probe_frame_{idx}.png"
                    if frame_path.exists():
                        parts.append(types.Part.from_bytes(data=frame_path.read_bytes(), mime_type="image/png"))
                return parts
            except Exception:
                return []

    def _build_prompt(
        self,
        request: AdCopyGenerateRequest,
        *,
        rejected_feedback: Optional[List[EvaluationIssue]] = None,
    ) -> str:
        product = request.product_data
        strategy = request.marketing_strategy
        ev = request.creative_evaluation
        bp = request.image_blueprint
        sb = request.video_storyboard

        price_line = (
            f"{product.currency or ''} {product.price} "
            f"(original_price={product.original_price}, discount={product.discount}%)"
            if product.price is not None
            else "MISSING — DO NOT invent, estimate, or mention any price or discount."
        )
        rating_line = (
            f"{product.rating}/5 across {product.review_count} reviews"
            if product.rating is not None
            else "NOT PROVIDED — DO NOT invent star ratings or customer review counts."
        )

        angle_context = ""
        if bp:
            angle_context = (
                f"Blueprint Title: {bp.creative_title}\n"
                f"Marketing Angle: {bp.marketing_angle}\n"
                f"Audience Hypothesis: {bp.audience_hypothesis}\n"
                f"Blueprint Hook: {bp.hook}\n"
                f"Main Message: {bp.main_message}"
            )
        elif sb:
            angle_context = (
                f"Storyboard Title: {sb.creative_title}\n"
                f"Marketing Angle: {sb.marketing_angle}\n"
                f"Audience Hypothesis: {sb.audience_hypothesis}\n"
                f"Opening Hook: {sb.opening_hook}\n"
                f"Storyboard CTA: {sb.final_cta}"
            )

        angles_summary = "; ".join(
            f"{a.angle_name} ({a.core_promise})" for a in strategy.marketing_angles[:3]
        )
        personas_summary = "; ".join(
            f"{p.persona_name}: {', '.join(p.pain_points[:2])}" for p in strategy.personas[:2]
        )
        specs_summary = ", ".join(f"{k}={v}" for k, v in list(product.specifications.items())[:8])

        lines = [
            f"Generate verified advertising copy for APPROVED creative '{request.creative_id}'.",
            f"Format: {ev.format} | Placement: {ev.placement}",
            "",
            "--- VISUAL CONTEXT FROM APPROVED CREATIVE ---",
            f"Observed Visual Summary: {ev.observed_visual_summary}",
            f"Observed Visible Text: {ev.observed_visible_text}",
            angle_context or "No explicit blueprint attached; align strictly with strategy and visual.",
            "",
            "--- VERIFIED PRODUCT DATA (SINGLE SOURCE OF TRUTH FOR CLAIMS) ---",
            f"Name: {product.product_name} | Brand: {product.brand or 'Unknown'} | Category: {product.category or 'General'}",
            f"Pricing: {price_line}",
            f"Reviews/Ratings: {rating_line}",
            f"Verified Features: {product.features[:8]}",
            f"Verified Specifications: {specs_summary or 'None'}",
            "",
            "--- STRATEGY CONTEXT ---",
            f"Personas: {personas_summary}",
            f"Angles: {angles_summary}",
            f"Primary Strategy CTA: {strategy.recommendations.primary_cta}",
            f"Creative Don'ts: {strategy.recommendations.creative_donts[:5]}",
            "",
            "--- OUTPUT CONTRACT ---",
            "- Produce EXACTLY 3 primary_texts (engaging social body copy aligned with visual + hook).",
            "- Produce EXACTLY 3 headlines (concise, scannable, factually grounded).",
            "- Produce EXACTLY 2 descriptions (supporting factual proof or availability detail).",
            "- Include cta_recommendation, creative_angle, and audience_hypothesis.",
            "- Every item must populate linked_product_facts with the exact ProductData facts it cites,",
            "  and visual_alignment_note explaining how it pairs with the evaluated creative.",
            "- Strictly avoid health claims, performance guarantees, unverified certifications,",
            "  superlatives (#1, best-in-class, unmatched), fabricated reviews, or fake prices.",
        ]

        if rejected_feedback:
            lines.extend(
                [
                    "",
                    "--- PREVIOUS DRAFT VIOLATIONS TO ELIMINATE ---",
                    *[f"- [{i.code}] {i.message} (fix: {i.suggested_fix or 'remove claim'})" for i in rejected_feedback],
                ]
            )

        return "\n".join(lines)

    def _validate_draft(
        self,
        draft: AdCopyDraft,
        product: Product,
    ) -> Tuple[List[EvaluationIssue], List[AdCopyVariant], List[AdCopyVariant], List[AdCopyVariant]]:
        all_issues: List[EvaluationIssue] = []

        def _check_bundle(
            items: List[AdCopyDraftItem],
            copy_type: str,
        ) -> List[AdCopyVariant]:
            variants: List[AdCopyVariant] = []
            for idx, item in enumerate(items, start=1):
                cleaned = item.text.strip()
                if not cleaned:
                    all_issues.append(
                        EvaluationIssue(
                            issue_id=f"copy_{uuid.uuid4().hex[:8]}",
                            code="EMPTY_AD_COPY_VARIANT",
                            criterion="message_clarity",
                            severity="hard_rejection",
                            source="claim_validator",
                            message=f"{copy_type} variant #{idx} cannot be empty.",
                        )
                    )
                    cleaned = "Placeholder"

                item_issues = self.claim_validator.audit_text(
                    cleaned,
                    product,
                    criterion="misleading_content_compliance",
                )
                all_issues.extend(item_issues)

                links = self._build_linked_evidence(cleaned, item.linked_product_facts, product)
                variants.append(
                    AdCopyVariant(
                        variant_id=f"{copy_type}_{idx}",
                        copy_type=copy_type,  # type: ignore[arg-type]
                        text=cleaned,
                        character_count=len(cleaned),
                        linked_claims=links,
                        visual_alignment_note=item.visual_alignment_note.strip() or "Aligned with creative visual.",
                    )
                )
            return variants

        primary_variants = _check_bundle(draft.primary_texts, "primary_text")
        headline_variants = _check_bundle(draft.headlines, "headline")
        description_variants = _check_bundle(draft.descriptions, "description")

        for field_label, val in (
            ("cta_recommendation", draft.cta_recommendation),
            ("creative_angle", draft.creative_angle),
            ("audience_hypothesis", draft.audience_hypothesis),
        ):
            if not val.strip():
                all_issues.append(
                    EvaluationIssue(
                        issue_id=f"copy_{uuid.uuid4().hex[:8]}",
                        code="EMPTY_AD_COPY_METADATA",
                        criterion="message_clarity",
                        severity="hard_rejection",
                        source="claim_validator",
                        message=f"{field_label} cannot be blank.",
                    )
                )
            all_issues.extend(
                self.claim_validator.audit_text(
                    val,
                    product,
                    criterion="misleading_content_compliance",
                )
            )

        return all_issues, primary_variants, headline_variants, description_variants

    def _build_linked_evidence(
        self,
        text: str,
        claimed_facts: List[str],
        product: Product,
    ) -> List[LinkedClaimEvidence]:
        links = self.claim_validator.link_claims_to_product(text, product)
        seen_fields = {lnk.verified_source_field for lnk in links}
        product_tokens = tokenize(flatten_product_text(product))

        for fact in claimed_facts[:4]:
            fact_tokens = tokenize(fact)
            if fact_tokens and len(fact_tokens & product_tokens) >= 2:
                field_key = "product_fact_summary"
                if field_key not in seen_fields:
                    links.append(
                        LinkedClaimEvidence(
                            claim_text=fact[:120],
                            verified_source_field=field_key,
                            evidence_snippet=fact[:140],
                        )
                    )
                    seen_fields.add(field_key)
        return links

    async def generate_copy(self, request: AdCopyGenerateRequest) -> ValidatedAdCopy:
        """
        Generate & claim-verify advertising copy strictly for an approved creative.
        Performs at most one controlled regeneration retry if ClaimValidator detects violations.
        """
        ev = request.creative_evaluation
        if not ev.approved or ev.decision != "approved":
            raise AdCopyPreconditionError(
                f"Cannot generate ad copy for unapproved creative '{request.creative_id}' "
                f"(decision={ev.decision}, score={ev.overall_weighted_score})."
            )

        asset_parts = self._load_visual_parts(request)
        last_issues: List[EvaluationIssue] = []
        last_draft: Optional[AdCopyDraft] = None
        last_meta = None
        primary_variants: List[AdCopyVariant] = []
        headline_variants: List[AdCopyVariant] = []
        description_variants: List[AdCopyVariant] = []

        for attempt in range(2):
            prompt = self._build_prompt(
                request,
                rejected_feedback=last_issues if attempt > 0 else None,
            )
            draft, gen_meta = await self.gemini_client.generate_structured(
                prompt_text=prompt,
                response_schema=AdCopyDraft,
                system_instruction=AD_COPY_SYSTEM_INSTRUCTION,
                image_parts=asset_parts or None,
                temperature=0.3 if attempt == 0 else 0.15,
            )
            issues, p_vars, h_vars, d_vars = self._validate_draft(draft, request.product_data)
            last_draft = draft
            last_meta = gen_meta
            last_issues = issues
            primary_variants = p_vars
            headline_variants = h_vars
            description_variants = d_vars
            if not issues:
                break

        copy_id = f"copy_{uuid.uuid4().hex[:12]}"
        approved = len(last_issues) == 0

        result = ValidatedAdCopy(
            copy_id=copy_id,
            campaign_id=request.campaign_id,
            creative_id=request.creative_id,
            concept_id=ev.concept_id,
            placement=ev.placement,
            approved=approved,
            creative_angle=last_draft.creative_angle.strip() if last_draft else "",
            audience_hypothesis=last_draft.audience_hypothesis.strip() if last_draft else "",
            cta_recommendation=last_draft.cta_recommendation.strip() if last_draft else "",
            primary_texts=primary_variants,
            headlines=headline_variants,
            descriptions=description_variants,
            rejected_claim_flags=last_issues,
            metadata=last_meta,
        )

        storage_key = f"campaigns/{request.campaign_id}/copy/{request.creative_id}/{copy_id}.json"
        self.storage.upload_json(
            bucket=settings.STORAGE_BUCKET_CREATIVES,
            object_key=storage_key,
            payload=result.model_dump(mode="json"),
        )
        return result


ad_copy_service = AdCopyService()

