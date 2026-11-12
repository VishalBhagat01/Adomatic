"""
AdPilot AI - Playwright Headless Browser Fetcher
Renders JavaScript-heavy single-page applications (SPAs) only when required.
Safely falls back if browser binaries are unavailable.
"""

from typing import Optional
from agent.app.core.logging import logger
from agent.app.services.extractor.ssrf import validate_safe_url


class PlaywrightFetcher:
    """Safely executes headless browser navigation for JavaScript-rendered sites."""

    @staticmethod
    async def fetch_rendered_html(target_url: str, timeout_ms: int = 15000) -> Optional[str]:
        """
        Launch headless Chromium, block tracking/font assets, wait for DOM hydration,
        and return the fully rendered HTML.
        Returns None gracefully if Playwright binaries are unavailable.
        """
        is_safe, canonical_url, ssrf_err = validate_safe_url(target_url)
        if not is_safe:
            logger.warning(f"Blocked unsafe Playwright URL '{target_url}': {ssrf_err}")
            return None

        try:
            from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout
        except ImportError:
            logger.warning("Playwright is not installed in the environment.")
            return None

        try:
            async with async_playwright() as p:
                try:
                    browser = await p.chromium.launch(
                        headless=True,
                        args=[
                            "--no-sandbox",
                            "--disable-setuid-sandbox",
                            "--disable-dev-shm-usage",
                            "--disable-accelerated-2d-canvas",
                            "--no-first-run",
                            "--no-zygote",
                            "--disable-gpu",
                        ],
                    )
                except Exception as e:
                    logger.warning(
                        f"Could not launch Playwright Chromium browser: {e}. "
                        "If running on a fresh host, ensure 'playwright install chromium' has been run."
                    )
                    return None

                context = await browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    ),
                    viewport={"width": 1280, "height": 800},
                )

                page = await context.new_page()

                # Abort heavy assets and enforce SSRF protection on all browser HTTP(S) sub-requests/redirects
                async def route_handler(route):
                    req_type = route.request.resource_type
                    raw_url = route.request.url
                    url_lower = raw_url.lower()
                    if url_lower.startswith(("http://", "https://")):
                        safe_sub, _, err_sub = validate_safe_url(raw_url)
                        if not safe_sub:
                            logger.warning(f"Blocked unsafe Playwright sub-request '{raw_url}': {err_sub}")
                            await route.abort()
                            return
                    if req_type in ("font", "media") or any(
                        t in url_lower for t in ["google-analytics", "analytics", "doubleclick", "facebook.net"]
                    ):
                        await route.abort()
                    else:
                        await route.continue_()

                await page.route("**/*", route_handler)

                try:
                    await page.goto(canonical_url, wait_until="domcontentloaded", timeout=timeout_ms)
                    # Allow brief window for hydration
                    await page.wait_for_timeout(1500)
                    html = await page.content()
                    await browser.close()
                    return html
                except PlaywrightTimeout:
                    logger.warning(f"Playwright navigation timed out for {target_url}")
                    html = await page.content()
                    await browser.close()
                    return html if html and len(html) > 500 else None
                except Exception as e:
                    logger.warning(f"Playwright error during page interaction: {e}")
                    await browser.close()
                    return None

        except Exception as e:
            logger.warning(f"Unexpected Playwright execution error: {e}")
            return None

