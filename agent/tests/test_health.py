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


def test_settings_accepts_comma_separated_cors_origins_env(monkeypatch):
    from agent.app.core.config import Settings

    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173, https://studio.example.com")
    cfg = Settings()
    assert cfg.CORS_ORIGINS == ["http://localhost:5173", "https://studio.example.com"]


def test_agent_entrypoint_importable_from_agent_dir():
    import subprocess
    import sys
    from pathlib import Path

    agent_dir = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        [sys.executable, "-c", "import app.main; assert app.main.app.title == 'adpilot-agent'"],
        cwd=str(agent_dir),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"stderr: {proc.stderr}\nstdout: {proc.stdout}"


