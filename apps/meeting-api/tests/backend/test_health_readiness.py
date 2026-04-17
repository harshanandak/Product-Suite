import asyncio
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

import backend.server as server_module


def test_health_reports_public_baseline_failures_explicitly(monkeypatch):
    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query):
            return None

        def fetchone(self):
            return {"ok": 1}

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setattr(server_module, "build_capability_matrix", lambda: {})
    monkeypatch.setattr(server_module, "OPENAI_API_KEY", "")
    monkeypatch.setattr(
        server_module,
        "settings",
        type(
            "SettingsStub",
            (),
            {
                "is_hosted": True,
                "auth_provider": "neon",
                "neon_auth_url": "",
                "storage_backend": "r2",
                "storage_base_path": "storage",
                "database_provider": "neon",
                "deployment_mode": "hosted",
                "auth_required": True,
                "upload_max_bytes": 1000,
                "request_timeout_seconds": 30,
            },
        )(),
    )
    monkeypatch.setattr(
        server_module,
        "get_storage_adapter",
        lambda: type("StorageStub", (), {"provider_ready": lambda self: False})(),
    )

    payload = asyncio.run(server_module.health())

    assert payload["ready"] is False
    assert payload["public_baseline_ready"] is False
    assert payload["readiness"]["failures"] == ["openai", "neon_auth", "storage"]


def test_health_reports_ready_when_all_hosted_providers_are_configured(monkeypatch):
    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query):
            return None

        def fetchone(self):
            return {"ok": 1}

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setattr(server_module, "build_capability_matrix", lambda: {"whisper": {"transcription": True}})
    monkeypatch.setattr(server_module, "OPENAI_API_KEY", "openai-key")
    monkeypatch.setattr(
        server_module,
        "settings",
        type(
            "SettingsStub",
            (),
            {
                "is_hosted": True,
                "auth_provider": "neon",
                "neon_auth_url": "https://project-123.neon.tech/auth",
                "storage_backend": "r2",
                "storage_base_path": "storage",
                "database_provider": "neon",
                "deployment_mode": "hosted",
                "auth_required": True,
                "upload_max_bytes": 1000,
                "request_timeout_seconds": 30,
            },
        )(),
    )
    monkeypatch.setattr(
        server_module,
        "get_storage_adapter",
        lambda: type("StorageStub", (), {"provider_ready": lambda self: True})(),
    )

    payload = asyncio.run(server_module.health())

    assert payload["ready"] is True
    assert payload["public_baseline_ready"] is True
    assert payload["readiness"]["failures"] == []


def test_health_does_not_require_neon_auth_in_oss_mode(monkeypatch):
    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query):
            return None

        def fetchone(self):
            return {"ok": 1}

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setattr(server_module, "build_capability_matrix", lambda: {})
    monkeypatch.setattr(server_module, "OPENAI_API_KEY", "openai-key")
    monkeypatch.setattr(
        server_module,
        "settings",
        type(
            "SettingsStub",
            (),
            {
                "is_hosted": False,
                "auth_provider": "local",
                "neon_auth_url": "",
                "storage_backend": "local",
                "storage_base_path": "storage",
                "database_provider": "postgres",
                "deployment_mode": "oss",
                "auth_required": False,
                "upload_max_bytes": 1000,
                "request_timeout_seconds": 30,
            },
        )(),
    )
    monkeypatch.setattr(
        server_module,
        "get_storage_adapter",
        lambda: type("StorageStub", (), {"provider_ready": lambda self: True})(),
    )

    payload = asyncio.run(server_module.health())

    assert payload["ready"] is True
    assert payload["readiness"]["failures"] == []
