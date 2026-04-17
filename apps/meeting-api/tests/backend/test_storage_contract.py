import os
import sys
import asyncio
from io import BytesIO
from pathlib import Path

import pytest
from starlette.datastructures import Headers, UploadFile


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.server import AuthUser, create_audio_storage_session, transcribe_audio
from backend.services.storage import build_storage_adapter, compute_retention_expires_at, should_archive_raw_audio


def test_compute_retention_expires_at_honors_indefinite_and_zero_day_policies():
    assert compute_retention_expires_at(-1) is None
    assert compute_retention_expires_at(0) is not None


def test_build_storage_adapter_returns_r2_backend_for_hosted_settings():
    settings = type(
        "SettingsStub",
        (),
        {
            "storage_backend": "r2",
            "storage_base_path": "storage",
            "r2_account_id": "account-123",
            "r2_bucket_name": "meeting-audio",
            "r2_access_key_id": "key-123",
            "r2_secret_access_key": "secret-123",
            "r2_public_base_url": "https://cdn.example.com",
            "raw_audio_retention_days": 30,
        },
    )()

    adapter = build_storage_adapter(settings)

    assert adapter.backend == "r2"
    assert should_archive_raw_audio(settings) is True


def test_create_audio_storage_session_rejects_disabled_archival(monkeypatch):
    monkeypatch.setattr("backend.server.fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id, "tenant_id": "tenant-1"})
    monkeypatch.setattr("backend.server.get_db_connection", lambda: type("Conn", (), {"__enter__": lambda self: object(), "__exit__": lambda self, exc_type, exc, tb: False})())
    monkeypatch.setattr(
        "backend.server.settings",
        type("SettingsStub", (), {"raw_audio_retention_days": 0, "storage_backend": "r2"})(),
    )

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            create_audio_storage_session(
            type("Request", (), {"meeting_id": "meeting-1", "filename": "chunk.wav", "content_type": "audio/wav", "expires_in_seconds": 900})(),
            actor=AuthUser(id="user-1", email="user@example.com", is_authenticated=True),
        )
        )

    assert getattr(exc_info.value, "status_code", None) == 409


def test_transcribe_audio_archives_raw_chunks_when_hosted_archival_is_enabled(monkeypatch):
    calls = []

    class FakeCursor:
        def executemany(self, query, rows):
            self.rows = list(rows)

        def execute(self, query, params=None):
            self.query = query
            self.params = params

        def fetchone(self):
            return {"count": 1}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeConnection:
        def __init__(self):
            self.cursor_instance = FakeCursor()

        def cursor(self):
            return self.cursor_instance

        def commit(self):
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeProvider:
        async def transcribe(self, **kwargs):
            return [
                {
                    "id": "seg-1",
                    "meeting_id": "meeting-1",
                    "speaker_label": "SPK 1",
                    "text": "We decided to delay launch.",
                    "timestamp_start": 110,
                    "timestamp_end": 140,
                    "created_at": "2026-04-07T10:00:00+00:00",
                    "language_code": "en",
                }
            ]

    async def fake_translate(segments):
        return segments

    async def fake_materialize(meeting_id, actor, *, finalize=False, now=None):
        calls.append((meeting_id, actor.id, finalize))

    monkeypatch.setattr("backend.server.fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id, "engine": "whisper", "duration_seconds": 110, "tenant_id": "tenant-1"})
    monkeypatch.setattr("backend.server.get_speech_provider", lambda engine: FakeProvider())
    monkeypatch.setattr("backend.server.batch_translate_segments_to_english", fake_translate)
    monkeypatch.setattr("backend.server.get_db_connection", lambda: FakeConnection())
    monkeypatch.setattr("backend.server.record_completed_job", lambda **kwargs: None)
    monkeypatch.setattr("backend.server.refresh_summary_first_meeting_memory", fake_materialize)
    monkeypatch.setattr(
        "backend.server.archive_audio_chunk",
        lambda **kwargs: {"id": "asset-1", "backend": "r2", "storage_path": "meetings/meeting-1/audio/raw/chunk.wav"},
    )

    actor = AuthUser(id="user-1", email="user@example.com", is_authenticated=True)
    audio = UploadFile(file=BytesIO(b"RIFFdata"), filename="chunk.wav", headers=Headers({"content-type": "audio/wav"}))

    result = asyncio.run(
        transcribe_audio(
            "meeting-1",
            audio=audio,
            chunk_index=0,
            elapsed_seconds=0.0,
            chunk_duration_seconds=20.0,
            actor=actor,
        )
    )

    assert result["archived_audio"]["backend"] == "r2"
    assert calls == [("meeting-1", "user-1", False)]
