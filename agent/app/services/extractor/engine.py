"""
AdPilot AI - Product Extraction Engine
Coordinates the multi-stage extraction pipeline: URL validation, SSRF checks,
HTTP fetching, progressive JavaScript rendering, domain-specific extractors,
and diagnostic compilation.
"""

import time
import urllib.parse
from typing import List, Optional
from bs4 import BeautifulSoup

from agent.app.core.logging import logger
from agent.app.schemas.product import (
    ExtractionDiagnostics,
    Product,
    ProductExtractResponse,
)
from agent.app.services.extractor.base import BaseExtractor
from agent.app.services.extractor.generic import GenericECommerceExtractor
from agent.app.services.extractor.html_fetcher import fetch_html_content
from agent.app.services.extractor.js_fetcher import PlaywrightFetcher
from agent.app.services.extractor.lifelong import LifelongIndiaExtractor
from agent.app.services.extractor.ssrf import validate_safe_url


class ProductExtractionEngine:
    """Core extraction engine managing domain routing, fetching, and diagnostics."""

    def __init__(self, extractors: Optional[List[BaseExtractor]] = None):
        # Register extractors in priority order (domain-specific first, generic last)
        self.extractors: List[BaseExtractor] = extractors or [
            LifelongIndiaExtractor(),
            GenericECommerceExtractor(),
        ]

    def _select_extractor(self, domain: str) -> BaseExtractor:
        """Select the first extractor capable of handling the domain."""
        for ext in self.extractors:
            if ext.can_handle(domain):
                return ext
        return GenericECommerceExtractor()

    @staticmethod
    def _needs_javascript_rendering(html: str) -> bool:
        """
        Detect whether the initial HTML is an empty single-page app shell
        that requires client-side JavaScript hydration.
        """
        if not html:
            return True

        lower = html.lower()

        # Obvious SPA empty root with minimal payload
        if ('<div id="root"></div>' in lower or '<div id="app"></div>' in lower) and len(html.strip()) < 1500:
            return True

        if "you need to enable javascript" in lower and len(html.strip()) < 2000:
            return True

        return False

    async def extract_product(
        self,
        url: str,
        force_js: bool = False,
        allowlist: Optional[List[str]] = None,
        html_override: Optional[str] = None,
    ) -> ProductExtractResponse:
        """
        Execute the full extraction pipeline for a given product URL.
        Optional html_override is supported for hermetic test execution with fixtures.
        """
        start_time = time.time()
        warnings: List[str] = []

        # 1. URL & SSRF Validation (only if not providing direct html_override)
        if not html_override:
            is_safe, canonical_url, ssrf_err = validate_safe_url(url, allowlist=allowlist)
            if not is_safe:
                duration_ms = round((time.time() - start_time) * 1000, 2)
                domain = urllib.parse.urlparse(url).hostname or "unknown"
                diagnostics = ExtractionDiagnostics(
                    url=url,
                    domain=domain,
                    extractor_name="none",
                    extraction_method="ssrf_blocked",
                    js_rendered=False,
                    duration_ms=duration_ms,
                    warnings=[f"SSRF validation blocked: {ssrf_err}"],
                )
                return ProductExtractResponse(
                    success=False,
                    data=None,
                    diagnostics=diagnostics,
                    error=f"URL validation failed: {ssrf_err}",
                )
        else:
            canonical_url = url

        parsed_url = urllib.parse.urlparse(canonical_url)
        domain = parsed_url.hostname or "unknown"
        extractor = self._select_extractor(domain)

        html_content: Optional[str] = html_override
        status_code = 200 if html_override else None
        retries = 0
        js_rendered = False
        extraction_method = "fixture" if html_override else "http"

        # 2. Fetch HTML if not overridden by test fixture
        if not html_content:
            fetch_result = await fetch_html_content(canonical_url, allowlist=allowlist)
            status_code = fetch_result.status_code
            retries = fetch_result.retries

            if fetch_result.is_blocked:
                duration_ms = round((time.time() - start_time) * 1000, 2)
                diagnostics = ExtractionDiagnostics(
                    url=canonical_url,
                    domain=domain,
                    extractor_name=extractor.name,
                    extraction_method="blocked",
                    js_rendered=False,
                    duration_ms=duration_ms,
                    status_code=status_code,
                    retries=retries,
                    warnings=[fetch_result.error_message or "Access blocked by target website."],
                )
                return ProductExtractResponse(
                    success=False,
                    data=None,
                    diagnostics=diagnostics,
                    error=fetch_result.error_message,
                )

            if not fetch_result.html:
                duration_ms = round((time.time() - start_time) * 1000, 2)
                diagnostics = ExtractionDiagnostics(
                    url=canonical_url,
                    domain=domain,
                    extractor_name=extractor.name,
                    extraction_method="http_failed",
                    js_rendered=False,
                    duration_ms=duration_ms,
                    status_code=status_code,
                    retries=retries,
                    warnings=[fetch_result.error_message or "Empty response received."],
                )
                return ProductExtractResponse(
                    success=False,
                    data=None,
                    diagnostics=diagnostics,
                    error=fetch_result.error_message or "Could not retrieve HTML content.",
                )

            html_content = fetch_result.html

            # 3. Check if JavaScript rendering is needed
            if force_js or self._needs_javascript_rendering(html_content):
                logger.info(f"Invoking Playwright fallback for {canonical_url} (force_js={force_js})")
                rendered_html = await PlaywrightFetcher.fetch_rendered_html(canonical_url)
                if rendered_html:
                    html_content = rendered_html
                    js_rendered = True
                    extraction_method = "playwright_rendered"
                else:
                    warnings.append(
                        "JavaScript rendering was requested or detected as needed, "
                        "but headless browser was unavailable. Continuing with static HTML."
                    )
            else:
                extraction_method = "http_html"

        # 4. Parse DOM
        try:
            soup = BeautifulSoup(html_content, "html.parser")
            product: Product = extractor.extract(soup, canonical_url)

            # Check if JSON-LD was primary
            if product.field_provenance.get("product_name") == "json_ld":
                extraction_method = f"{extraction_method}_json_ld"

        except Exception as e:
            logger.error(f"Error during DOM extraction for {canonical_url}: {e}", exc_info=True)
            duration_ms = round((time.time() - start_time) * 1000, 2)
            diagnostics = ExtractionDiagnostics(
                url=canonical_url,
                domain=domain,
                extractor_name=extractor.name,
                extraction_method=extraction_method,
                js_rendered=js_rendered,
                duration_ms=duration_ms,
                status_code=status_code,
                retries=retries,
                warnings=[f"DOM parsing exception: {str(e)}"],
            )
            return ProductExtractResponse(
                success=False,
                data=None,
                diagnostics=diagnostics,
                error=f"Extraction failure: {str(e)}",
            )

        # 5. Compile Diagnostics
        duration_ms = round((time.time() - start_time) * 1000, 2)
        diagnostics = ExtractionDiagnostics(
            url=canonical_url,
            domain=domain,
            extractor_name=extractor.name,
            extraction_method=extraction_method,
            js_rendered=js_rendered,
            duration_ms=duration_ms,
            status_code=status_code,
            retries=retries,
            field_confidence=product.field_confidence,
            missing_fields=product.missing_fields,
            warnings=warnings,
        )

        return ProductExtractResponse(
            success=True,
            data=product,
            diagnostics=diagnostics,
            error=None,
        )


# Global singleton engine instance
extraction_engine = ProductExtractionEngine()

