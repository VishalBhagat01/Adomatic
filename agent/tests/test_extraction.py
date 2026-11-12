"""
Unit tests for Product Extraction Engine using local HTML fixtures
"""

import os
import pytest
from bs4 import BeautifulSoup

from agent.app.services.extractor.engine import ProductExtractionEngine, extraction_engine
from agent.app.services.extractor.html_fetcher import CHALLENGE_SIGNATURES
from agent.app.services.extractor.lifelong import LifelongIndiaExtractor

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def read_fixture(filename: str) -> str:
    path = os.path.join(FIXTURES_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


@pytest.mark.asyncio
async def test_valid_product_fixture():
    html = read_fixture("valid_product.html")
    url = "https://www.lifelongindiaonline.com/products/lifelong-llm99-mixer-grinder-500w"

    res = await extraction_engine.extract_product(url=url, html_override=html)
    assert res.success is True
    assert res.data is not None

    product = res.data
    # 1. Product Name & Brand
    assert "Lifelong LLM99 Mixer Grinder" in product.product_name
    assert product.brand == "Lifelong"
    assert product.category == "Kitchen Appliances"

    # 2. Pricing & Currency
    assert product.price == 1499.00
    assert product.original_price == 2499.00
    assert product.currency == "INR"
    assert product.discount == 40.0  # (2499 - 1499) / 2499 = 40.0%

    # 3. Features & Specifications
    assert len(product.features) >= 4
    assert any("500-watt" in f for f in product.features)
    assert product.specifications.get("Wattage") == "500 Watts"
    assert product.specifications.get("Model") == "LLM99"

    # 4. Images & Primary Image
    assert len(product.images) >= 3
    assert product.images[0].is_primary is True
    assert "mixer1.jpg" in product.images[0].url

    # 5. Reviews & Ratings
    assert product.rating == 4.3
    assert product.review_count == 156
    assert len(product.reviews) == 2
    assert product.reviews[0].author == "Pooja Verma"
    assert product.reviews[0].rating == 5.0

    # 6. Provenance & Confidence
    assert product.field_provenance["product_name"] == "json_ld"
    assert product.field_provenance["price"] == "json_ld_offers"
    assert product.field_provenance["discount"] == "calculated_from_prices"
    assert product.field_confidence["price"] >= 0.90


@pytest.mark.asyncio
async def test_missing_price_fixture():
    html = read_fixture("missing_price.html")
    url = "https://www.lifelongindiaonline.com/products/commercial-blender"

    res = await extraction_engine.extract_product(url=url, html_override=html)
    assert res.success is True
    product = res.data

    # Price must be None, NEVER fabricated or defaulted to 0.0
    assert product.price is None
    assert product.original_price is None
    assert product.discount is None
    assert "price" in product.missing_fields
    assert "original_price" in product.missing_fields


@pytest.mark.asyncio
async def test_missing_images_fixture():
    html = read_fixture("missing_images.html")
    url = "https://www.lifelongindiaonline.com/products/warranty-card"

    res = await extraction_engine.extract_product(url=url, html_override=html)
    assert res.success is True
    product = res.data

    assert product.images == []
    assert "images" in product.missing_fields


@pytest.mark.asyncio
async def test_invalid_json_ld_fallback_to_og_and_html():
    html = read_fixture("invalid_json_ld.html")
    url = "https://www.lifelongindiaonline.com/products/induction-cooktop"

    # Malformed JSON-LD should not crash the engine; it should recover via OpenGraph and HTML DOM
    res = await extraction_engine.extract_product(url=url, html_override=html)
    assert res.success is True
    product = res.data

    assert product.product_name == "Lifelong Induction Cooktop 1400W"
    assert product.price == 1299.00
    assert product.original_price == 2199.00
    assert product.currency == "INR"
    assert len(product.features) == 3
    assert product.specifications.get("Wattage") == "1400 Watts"
    assert len(product.images) >= 1
    # Check provenance points to OpenGraph / DOM instead of JSON-LD
    assert product.field_provenance["product_name"] == "open_graph"
    assert product.field_provenance["features"] == "html_bullets"


def test_js_rendered_spa_detection():
    html = read_fixture("js_rendered.html")
    engine = ProductExtractionEngine()
    assert engine._needs_javascript_rendering(html) is True
    assert engine._needs_javascript_rendering("<html><body><h1>Normal Page</h1></body></html>") is False


@pytest.mark.asyncio
async def test_duplicate_images_deduplication():
    html = read_fixture("duplicate_images.html")
    url = "https://www.lifelongindiaonline.com/products/airfryer"

    res = await extraction_engine.extract_product(url=url, html_override=html)
    assert res.success is True
    product = res.data

    # Should deduplicate variations of airfryer_main (differing by thumbnail, ?v=, relative URL)
    image_urls = [img.url for img in product.images]
    assert len(image_urls) == 2
    assert any("airfryer_main" in u for u in image_urls)
    assert any("airfryer_basket" in u for u in image_urls)

    # Excluded logo check
    assert not any("payment_visa_logo" in u for u in image_urls)

    # Exactly one primary image
    primary_images = [img for img in product.images if img.is_primary]
    assert len(primary_images) == 1


def test_blocked_website_challenge_signature():
    html = read_fixture("blocked_website.html")
    text_lower = html.lower()
    matches = [sig for sig in CHALLENGE_SIGNATURES if sig in text_lower]
    assert len(matches) > 0
    assert "cf-browser-verification" in matches


@pytest.mark.asyncio
async def test_html_fetcher_rejects_oversized_payload():
    import httpx
    from unittest.mock import patch
    from agent.app.services.extractor.html_fetcher import MAX_HTML_BYTES, fetch_html_content

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-length": str(MAX_HTML_BYTES + 1024)}, content=b"<html>ok</html>")

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def mock_client_factory(*args, **kwargs):
        kwargs.pop("http2", None)
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("agent.app.services.extractor.html_fetcher.validate_safe_url", return_value=(True, "https://example.com/product", None)), \
         patch("agent.app.services.extractor.html_fetcher.httpx.AsyncClient", side_effect=mock_client_factory):
        res = await fetch_html_content("https://example.com/product", max_retries=1)

    assert res.is_blocked is True
    assert "exceeded maximum allowed size" in (res.error_message or "")


@pytest.mark.asyncio
async def test_playwright_fetcher_blocks_ssrf_before_launch():
    from agent.app.services.extractor.js_fetcher import PlaywrightFetcher

    html = await PlaywrightFetcher.fetch_rendered_html("http://127.0.0.1:8000/internal")
    assert html is None


@pytest.mark.asyncio
async def test_shopify_product_group_default_title_and_hcaptcha_footer_not_blocked():
    from agent.app.services.extractor.html_fetcher import is_anti_bot_challenge

    shopify_html = """<!doctype html>
    <html>
      <head>
        <title>Lifelong Moka Pot 300ml</title>
        <meta property="og:title" content="Lifelong Moka Pot 300ml" />
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "ProductGroup",
          "name": "Lifelong Moka Pot 300ml",
          "brand": {"@type": "Brand", "name": "Lifelong"},
          "description": "Aluminum stovetop espresso maker for 6 cups.",
          "image": ["https://cdn.example.com/moka1.jpg"],
          "hasVariant": [
            {
              "@type": "Product",
              "name": "Default Title",
              "sku": "LLCMM01",
              "offers": {
                "@type": "Offer",
                "price": 949.0,
                "priceCurrency": "INR",
                "availability": "https://schema.org/InStock"
              }
            }
          ]
        }
        </script>
      </head>
      <body>
        <script>const url='https://cdn.shopify.com/shopifycloud/storefront-forms-hcaptcha/ce.js';</script>
      </body>
    </html>""" + (" " * 55000)

    assert is_anti_bot_challenge(200, shopify_html) is False
    assert is_anti_bot_challenge(200, "<html><body><div class='hcaptcha'>Verify</div></body></html>") is True

    res = await extraction_engine.extract_product(
        url="https://www.lifelongindiaonline.com/products/lifelong-moka-pot",
        html_override=shopify_html,
    )
    assert res.success is True
    assert res.data.product_name == "Lifelong Moka Pot 300ml"
    assert res.data.brand == "Lifelong"
    assert res.data.price == 949.0
    assert res.data.currency == "INR"


