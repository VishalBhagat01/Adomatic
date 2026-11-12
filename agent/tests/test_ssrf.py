"""
Unit tests for SSRF Protection and URL Validator
"""

import pytest
from agent.app.services.extractor.ssrf import validate_safe_url


def test_valid_public_https_url():
    is_safe, canonical, err = validate_safe_url(
        "https://www.lifelongindiaonline.com/products/mixer-grinder",
        resolve_dns=False,
    )
    assert is_safe is True
    assert err is None
    assert canonical == "https://www.lifelongindiaonline.com/products/mixer-grinder"


def test_blocked_localhost():
    is_safe, canonical, err = validate_safe_url("http://localhost:8000/secret", resolve_dns=False)
    assert is_safe is False
    assert "blocked" in err.lower()


def test_blocked_loopback_ip():
    is_safe, canonical, err = validate_safe_url("http://127.0.0.1:80/status", resolve_dns=True)
    assert is_safe is False
    assert "blocked" in err.lower() or "forbidden" in err.lower()


def test_blocked_cloud_metadata_ip():
    is_safe, canonical, err = validate_safe_url("http://169.254.169.254/latest/meta-data/", resolve_dns=True)
    assert is_safe is False
    assert "blocked" in err.lower() or "forbidden" in err.lower()


def test_blocked_private_rfc1918():
    for private_ip in ["10.0.0.1", "192.168.1.1", "172.16.0.1"]:
        is_safe, canonical, err = validate_safe_url(f"http://{private_ip}/admin", resolve_dns=True)
        assert is_safe is False, f"Expected {private_ip} to be blocked"
        assert "forbidden" in err.lower() or "blocked" in err.lower()


def test_blocked_non_standard_port():
    is_safe, canonical, err = validate_safe_url("https://example.com:8443/product", resolve_dns=False)
    assert is_safe is False
    assert "Port 8443 is not permitted" in err


def test_blocked_unsupported_scheme():
    is_safe, canonical, err = validate_safe_url("ftp://example.com/files/product.pdf", resolve_dns=False)
    assert is_safe is False
    assert "Unsupported URL scheme" in err


def test_blocked_empty_url():
    is_safe, canonical, err = validate_safe_url("", resolve_dns=False)
    assert is_safe is False
    assert "non-empty string" in err


def test_domain_allowlist():
    allowlist = ["lifelongindiaonline.com", "example.com"]

    is_safe, _, _ = validate_safe_url("https://www.lifelongindiaonline.com/p/1", allowlist=allowlist, resolve_dns=False)
    assert is_safe is True

    is_safe, _, err = validate_safe_url("https://malicious-site.com/p/1", allowlist=allowlist, resolve_dns=False)
    assert is_safe is False
    assert "not in the allowed domain list" in err

