"""
AdPilot AI - Asynchronous HTTP Fetcher
Provides polite, resilient HTTP fetching with SSRF safe-redirect protection,
exponential backoff retry, rate-limiting, and anti-bot challenge detection.
"""

import asyncio
import time
import urllib.parse
from typing import Dict, List, Optional, Tuple
import importlib.util
import httpx

_HTTP2_AVAILABLE = importlib.util.find_spec("h2") is not None
_BROTLI_AVAILABLE = (
    importlib.util.find_spec("brotli") is not None
    or importlib.util.find_spec("brotlicffi") is not None
)

from agent.app.core.logging import logger
from agent.app.services.extractor.ssrf import validate_safe_url

MAX_HTML_BYTES = 10 * 1024 * 1024  # 10 MB safety ceiling for extracted product HTML

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 "
    "(compatible; AdPilotBot/1.0; +https://adpilot.ai/bot)"
)

DEFAULT_HEADERS = {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br" if _BROTLI_AVAILABLE else "gzip, deflate",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

# Signatures of unambiguous anti-bot interstitial pages that must NOT be bypassed
CHALLENGE_SIGNATURES = [
    "cf-browser-verification",
    "challenge-running",
    "ray id:",
    "cf_chl_prog",
    "attention required! | cloudflare",
    "just a moment...",
    "challenge-form",
]

CAPTCHA_WIDGET_SIGNATURES = [
    "g-recaptcha",
    "hcaptcha",
    "cf-turnstile",
]


def is_anti_bot_challenge(status_code: int, html_text: str) -> bool:
    """
    Detect genuine anti-bot / CAPTCHA interstitial challenges while avoiding false
    positives on full storefront pages whose footer/form scripts load reCAPTCHA/hCaptcha.
    """
    text_lower = (html_text or "").lower()
    if status_code in (403, 429):
        return True
    if any(sig in text_lower for sig in CHALLENGE_SIGNATURES):
        return True

    has_captcha_marker = any(sig in text_lower for sig in CAPTCHA_WIDGET_SIGNATURES)
    if not has_captcha_marker:
        return False

    has_product_markup = (
        "application/ld+json" in text_lower
        or 'property="og:title"' in text_lower
        or "property='og:title'" in text_lower
    )
    if not has_product_markup and len(html_text) < 50000:
        return True
    return False


class DomainRateLimiter:
    """Thread-safe / async rate limiter per hostname to avoid hammering websites."""
    def __init__(self, delay_seconds: float = 0.5):
        self.delay = delay_seconds
        self.last_access: Dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def throttle(self, domain: str):
        async with self._lock:
            now = time.time()
            prev = self.last_access.get(domain, 0.0)
            elapsed = now - prev
            if elapsed < self.delay:
                await asyncio.sleep(self.delay - elapsed)
            self.last_access[domain] = time.time()


global_rate_limiter = DomainRateLimiter()


class FetchResult:
    """Detailed result of an HTTP fetch attempt."""
    def __init__(
        self,
        html: Optional[str] = None,
        status_code: Optional[int] = None,
        final_url: Optional[str] = None,
        retries: int = 0,
        is_blocked: bool = False,
        error_message: Optional[str] = None,
        redirect_history: Optional[List[str]] = None,
    ):
        self.html = html
        self.status_code = status_code
        self.final_url = final_url
        self.retries = retries
        self.is_blocked = is_blocked
        self.error_message = error_message
        self.redirect_history = redirect_history or []


async def fetch_html_content(
    target_url: str,
    max_retries: int = 3,
    timeout_seconds: float = 15.0,
    allowlist: Optional[List[str]] = None,
) -> FetchResult:
    """
    Fetch HTML content from target URL with SSRF checks on every hop,
    exponential backoff retries, and anti-bot challenge detection.
    """
    # 1. SSRF check on initial target URL
    is_safe, canonical_url, ssrf_err = validate_safe_url(target_url, allowlist=allowlist)
    if not is_safe:
        return FetchResult(
            error_message=f"SSRF validation blocked request: {ssrf_err}",
            is_blocked=True,
        )

    domain = urllib.parse.urlparse(canonical_url).hostname or "unknown"
    await global_rate_limiter.throttle(domain)

    retries_done = 0
    redirect_history = [canonical_url]
    current_url = canonical_url

    async with httpx.AsyncClient(
        headers=DEFAULT_HEADERS,
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=False,  # We manually inspect redirects for SSRF safety
        http2=_HTTP2_AVAILABLE,
    ) as client:
        for attempt in range(max_retries):
            retries_done = attempt
            try:
                # Manual redirect loop (max 5 hops)
                hops = 0
                max_hops = 5

                while hops < max_hops:
                    # Validate URL before requesting
                    is_safe, valid_url, err = validate_safe_url(current_url, allowlist=allowlist)
                    if not is_safe:
                        return FetchResult(
                            error_message=f"Redirect to unsafe destination blocked: {err}",
                            retries=retries_done,
                            is_blocked=True,
                            redirect_history=redirect_history,
                        )

                    async with client.stream("GET", valid_url) as response:
                        # Handle 3xx Redirects
                        if response.is_redirect:
                            loc = response.headers.get("Location")
                            if not loc:
                                break
                            next_url = urllib.parse.urljoin(valid_url, loc)
                            current_url = next_url
                            redirect_history.append(current_url)
                            hops += 1
                            continue

                        cl_header = response.headers.get("content-length")
                        if cl_header and cl_header.isdigit() and int(cl_header) > MAX_HTML_BYTES:
                            return FetchResult(
                                status_code=response.status_code,
                                final_url=valid_url,
                                retries=retries_done,
                                is_blocked=True,
                                error_message=f"HTML payload exceeded maximum allowed size ({MAX_HTML_BYTES} bytes).",
                                redirect_history=redirect_history,
                            )

                        raw_chunks: List[bytes] = []
                        total_bytes = 0
                        async for chunk in response.aiter_bytes():
                            total_bytes += len(chunk)
                            if total_bytes > MAX_HTML_BYTES:
                                return FetchResult(
                                    status_code=response.status_code,
                                    final_url=valid_url,
                                    retries=retries_done,
                                    is_blocked=True,
                                    error_message=f"HTML payload exceeded maximum allowed size ({MAX_HTML_BYTES} bytes).",
                                    redirect_history=redirect_history,
                                )
                            raw_chunks.append(chunk)

                        html_text = b"".join(raw_chunks).decode(response.encoding or "utf-8", errors="replace")

                        # Check for Anti-bot / Cloudflare Challenge
                        if is_anti_bot_challenge(response.status_code, html_text):
                            logger.warning(
                                f"Anti-bot or CAPTCHA challenge detected for {valid_url} (HTTP {response.status_code})"
                            )
                            return FetchResult(
                                html=html_text,
                                status_code=response.status_code,
                                final_url=valid_url,
                                retries=retries_done,
                                is_blocked=True,
                                error_message=f"Access blocked by target website anti-bot protection (HTTP {response.status_code}).",
                                redirect_history=redirect_history,
                            )

                        # Successful response
                        if response.status_code == 200:
                            return FetchResult(
                                html=html_text,
                                status_code=200,
                                final_url=valid_url,
                                retries=retries_done,
                                is_blocked=False,
                                redirect_history=redirect_history,
                            )

                        # If 5xx server error, retry with exponential backoff
                        if 500 <= response.status_code <= 599:
                            if attempt < max_retries - 1:
                                wait_time = 0.5 * (2 ** attempt)
                                await asyncio.sleep(wait_time)
                                break  # Retry loop
                            return FetchResult(
                                status_code=response.status_code,
                                final_url=valid_url,
                                retries=retries_done,
                                error_message=f"Target server returned HTTP {response.status_code}",
                                redirect_history=redirect_history,
                            )

                        # Other client errors (404, 400, etc.)
                        return FetchResult(
                            html=html_text,
                            status_code=response.status_code,
                            final_url=valid_url,
                            retries=retries_done,
                            error_message=f"HTTP request returned status {response.status_code}",
                            redirect_history=redirect_history,
                        )

            except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.NetworkError) as e:
                logger.warning(f"Network error accessing {current_url} (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    wait_time = 0.5 * (2 ** attempt)
                    await asyncio.sleep(wait_time)
                else:
                    return FetchResult(
                        retries=retries_done,
                        error_message=f"Connection failed after {max_retries} attempts: {str(e)}",
                        redirect_history=redirect_history,
                    )
            except Exception as e:
                return FetchResult(
                    retries=retries_done,
                    error_message=f"Unexpected error while fetching URL: {str(e)}",
                    redirect_history=redirect_history,
                )

    return FetchResult(
        retries=retries_done,
        error_message="Exceeded maximum retries.",
        redirect_history=redirect_history,
    )

