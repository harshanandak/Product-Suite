import os

from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.server import app


def test_runtime_config_endpoint_exposes_local_auth_metadata():
    client = TestClient(app)

    response = client.get("/api/runtime-config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["auth"]["provider"] == "local"
    assert payload["auth"]["supported_providers"] == ["email"]
    assert payload["tenant_mode"] == "single"
