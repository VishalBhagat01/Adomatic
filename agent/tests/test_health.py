import pytest
from fastapi.testclient import TestClient
from agent.app.main import app

client = TestClient(app)


def test_root_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "adpilot-agent"
    assert data["version"] == "0.1.0"
    assert data["uptime_seconds"] >= 0
    assert "details" in data
    assert "platform" in data["details"]


def test_api_v1_health_endpoint():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "adpilot-agent"


def test_not_found():
    response = client.get("/non-existent")
    assert response.status_code == 404

