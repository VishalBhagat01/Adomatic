"""
Integration tests for POST /api/v1/products/extract endpoint
"""

import os
from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient

from agent.app.main import app
from agent.app.schemas.product import ProductExtractResponse, ExtractionDiagnostics

client = TestClient(app)
FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def read_fixture(filename: str) -> str:
    path = os.path.join(FIXTURES_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_extract_missing_url_field():
    response = client.post("/api/v1/products/extract", json={})
    assert response.status_code == 400
    assert "Either 'url' or 'product_url' must be provided" in response.text


def test_extract_ssrf_blocked_url():
    response = client.post(
        "/api/v1/products/extract",
        json={"url": "http://127.0.0.1:8000/internal-status"}
    )
    assert response.status_code == 400
    data = response.json()
    assert "blocked" in data["detail"]["error"].lower() or "forbidden" in data["detail"]["error"].lower()


def test_extract_invalid_scheme():
    response = client.post(
        "/api/v1/products/extract",
        json={"url": "ftp://files.example.com/product.json"}
    )
    assert response.status_code == 400
    data = response.json()
    assert "Unsupported URL scheme" in data["detail"]["error"]


@patch("agent.app.services.extractor.engine.fetch_html_content")
def test_extract_valid_product_api(mock_fetch):
    from agent.app.services.extractor.html_fetcher import FetchResult

    valid_html = read_fixture("valid_product.html")
    mock_fetch.return_value = FetchResult(
        html=valid_html,
        status_code=200,
        final_url="https://www.lifelongindiaonline.com/products/mixer-grinder",
        retries=0,
        is_blocked=False,
    )

    response = client.post(
        "/api/v1/products/extract",
        json={"product_url": "https://www.lifelongindiaonline.com/products/mixer-grinder"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"] is not None

    product = data["data"]
    assert "Lifelong LLM99 Mixer Grinder" in product["product_name"]
    assert product["price"] == 1499.0
    assert product["currency"] == "INR"
    assert product["brand"] == "Lifelong"
    assert len(product["images"]) >= 3
    assert product["images"][0]["is_primary"] is True
    assert "diagnostics" in data
    assert data["diagnostics"]["extractor_name"] == "lifelong_india_extractor"


@patch("agent.app.services.extractor.engine.fetch_html_content")
def test_extract_anti_bot_blocked_api(mock_fetch):
    from agent.app.services.extractor.html_fetcher import FetchResult

    blocked_html = read_fixture("blocked_website.html")
    mock_fetch.return_value = FetchResult(
        html=blocked_html,
        status_code=403,
        final_url="https://protected-site.com/product",
        retries=0,
        is_blocked=True,
        error_message="Access blocked by target website anti-bot protection (HTTP 403).",
    )

    response = client.post(
        "/api/v1/products/extract",
        json={"url": "https://protected-site.com/product"}
    )

    # Handled safely, returning HTTP 400 with diagnostics
    assert response.status_code == 400
    data = response.json()
    assert "anti-bot" in data["detail"]["error"].lower()

