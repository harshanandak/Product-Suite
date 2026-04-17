import os
import sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.datastructures import Headers, UploadFile

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.server import (
    AuthUser,
    MeetingCreate,
    MeetingUpdate,
    app,
    build_summary_first_materialization,
    create_meeting,
    fetch_meeting,
    get_action_items,
    get_decisions,
    get_open_questions,
    refresh_summary_first_meeting_memory,
    should_materialize_after_transcription_chunk,
    should_refresh_summary_first_on_read,
    transcribe_audio,
    update_meeting,
)
from backend.routes.chapters import build_chapter_list_payload
from backend.routes.meetings import build_generated_items_payload
from backend.routes.runtime import build_runtime_config_payload
from backend.routes.state import build_recent_lines_payload, build_state_payload


class DummyMeetingCursor:
    def __init__(self, meeting):
        self._meeting = meeting

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        self.query = query
        self.params = params

    def fetchone(self):
        return self._meeting


class DummyMeetingConnection:
    def __init__(self, meeting):
        self._meeting = meeting

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return DummyMeetingCursor(self._meeting)


class InsertCaptureCursor:
    def __init__(self):
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        self.executed.append((query, params))


class InsertCaptureConnection:
    def __init__(self):
        self.capture = InsertCaptureCursor()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return self.capture


def test_runtime_config_payload_exposes_summary_policy():
    payload = build_runtime_config_payload(
        deployment_mode="hosted",
        auth_required=True,
        auth_provider="neon",
        supported_auth_providers=["email", "google"],
        tenant_mode="organization",
        organization_required=True,
        onboarding_required=True,
        backend_url="http://localhost:8000",
        hosted_auth_url="https://project-123.neon.tech/auth",
        database_provider="neon",
        storage_backend="local",
        raw_audio_retention_days=30,
        transcript_retention_days=-1,
        derived_retention_days=-1,
        state_window_seconds=120,
        chapter_window_seconds=300,
        inactivity_timeout_seconds=180,
        retrieval_corpus=["chapter_summary", "final_summary"],
        retrieval_ranking_profile="hybrid_summary_first",
        capabilities={"whisper": {"transcription": True}},
        engines=[{"id": "whisper", "name": "Whisper", "available": True}],
    )

    assert payload["tenant_mode"] == "organization"
    assert payload["auth"]["provider"] == "neon"
    assert payload["auth"]["supported_providers"] == ["email", "google"]
    assert payload["auth"]["organization_required"] is True
    assert payload["auth"]["onboarding_required"] is True
    assert payload["auth"]["neon"] == {
        "auth_url": "https://project-123.neon.tech/auth",
    }
    assert payload["summary_policy"]["inactivity_timeout_seconds"] == 180
    assert payload["summary_policy"]["raw_audio_retention_days"] == 30
    assert payload["summary_policy"]["full_transcript_retained"] is True


def test_fetch_meeting_allows_hosted_membership_same_tenant_when_app_token_has_no_org_claim(monkeypatch):
    monkeypatch.setattr(
        "backend.server.settings",
        type("SettingsStub", (), {"deployment_mode": "hosted", "is_oss": False})(),
    )
    monkeypatch.setattr(
        "backend.server.fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "tenant-1"},
    )
    monkeypatch.setattr(
        "backend.server.fetch_user_by_id",
        lambda user_id: {"tenant_id": "tenant-1"},
    )

    actor = AuthUser(
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        is_authenticated=True,
    )

    meeting = fetch_meeting(
        DummyMeetingConnection({"id": "meeting-1", "owner_user_id": "user-1", "tenant_id": "tenant-1"}),
        "meeting-1",
        actor,
    )

    assert meeting["id"] == "meeting-1"


def test_fetch_meeting_rejects_cross_tenant_hosted_membership_when_app_token_has_no_org_claim(monkeypatch):
    monkeypatch.setattr(
        "backend.server.settings",
        type("SettingsStub", (), {"deployment_mode": "hosted", "is_oss": False})(),
    )
    monkeypatch.setattr(
        "backend.server.fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "tenant-2"},
    )
    monkeypatch.setattr(
        "backend.server.fetch_user_by_id",
        lambda user_id: {"tenant_id": "tenant-2"},
    )

    actor = AuthUser(
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        is_authenticated=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        fetch_meeting(
            DummyMeetingConnection({"id": "meeting-1", "owner_user_id": "user-1", "tenant_id": "tenant-1"}),
            "meeting-1",
            actor,
        )

    assert exc_info.value.status_code == 404


@pytest.mark.parametrize(
    ("route_fn", "table_name"),
    [
        (get_decisions, "decisions"),
        (get_action_items, "action_items"),
        (get_open_questions, "open_questions"),
    ],
)
def test_generated_record_routes_use_membership_backed_tenant_scope_for_hosted_tokens(
    monkeypatch, route_fn, table_name
):
    monkeypatch.setattr(
        "backend.server.settings",
        type("SettingsStub", (), {"deployment_mode": "hosted", "is_oss": False})(),
    )
    monkeypatch.setattr(
        "backend.server.fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "tenant-1"},
    )
    monkeypatch.setattr(
        "backend.server.fetch_user_by_id",
        lambda user_id: {"tenant_id": "tenant-1"},
    )
    captured = {}

    def fake_list_generated_records(meeting_id, generated_table_name, *, tenant_id):
        captured["table_name"] = generated_table_name
        captured["tenant_id"] = tenant_id
        return []

    monkeypatch.setattr("backend.server._list_generated_records", fake_list_generated_records)
    monkeypatch.setattr(
        "backend.server.get_db_connection",
        lambda: DummyMeetingConnection({"id": "meeting-1", "owner_user_id": "user-1", "tenant_id": "tenant-1"}),
    )

    actor = AuthUser(
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        is_authenticated=True,
    )

    payload = __import__("asyncio").run(route_fn("meeting-1", actor=actor))

    assert payload == {"items": []}
    assert captured["table_name"] == table_name
    assert captured["tenant_id"] == "tenant-1"


@pytest.mark.parametrize("route_fn", [get_decisions, get_action_items, get_open_questions])
def test_generated_record_routes_reject_cross_tenant_hosted_membership(monkeypatch, route_fn):
    monkeypatch.setattr(
        "backend.server.settings",
        type("SettingsStub", (), {"deployment_mode": "hosted", "is_oss": False})(),
    )
    monkeypatch.setattr(
        "backend.server.fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "tenant-2"},
    )
    monkeypatch.setattr(
        "backend.server.fetch_user_by_id",
        lambda user_id: {"tenant_id": "tenant-2"},
    )
    monkeypatch.setattr(
        "backend.server.get_db_connection",
        lambda: DummyMeetingConnection({"id": "meeting-1", "owner_user_id": "user-1", "tenant_id": "tenant-1"}),
    )

    actor = AuthUser(
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        is_authenticated=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        __import__("asyncio").run(route_fn("meeting-1", actor=actor))

    assert exc_info.value.status_code == 404


def test_create_meeting_uses_membership_backed_tenant_scope_for_hosted_tokens(monkeypatch):
    monkeypatch.setattr(
        "backend.server.settings",
        type("SettingsStub", (), {"deployment_mode": "hosted", "is_oss": False})(),
    )
    monkeypatch.setattr(
        "backend.server.fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "tenant-1"},
    )
    monkeypatch.setattr(
        "backend.server.fetch_user_by_id",
        lambda user_id: {"tenant_id": "tenant-1"},
    )
    insert_conn = InsertCaptureConnection()
    monkeypatch.setattr("backend.server.get_db_connection", lambda: insert_conn)
    monkeypatch.setattr("backend.server.reset_speaker_tracker", lambda meeting_id: None)

    actor = AuthUser(
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        is_authenticated=True,
    )

    meeting = __import__("asyncio").run(create_meeting(MeetingCreate(title="Sprint sync"), actor=actor))

    assert meeting.title == "Sprint sync"
    assert insert_conn.capture.executed
    _, params = insert_conn.capture.executed[0]
    assert params[2] == "tenant-1"


def test_runtime_config_payload_does_not_expose_secrets():
    payload = build_runtime_config_payload(
        deployment_mode="hosted",
        auth_required=True,
        auth_provider="neon",
        supported_auth_providers=["email", "google"],
        tenant_mode="organization",
        organization_required=True,
        onboarding_required=True,
        backend_url="http://localhost:8000",
        hosted_auth_url="https://project-123.neon.tech/auth",
        database_provider="neon",
        storage_backend="local",
        raw_audio_retention_days=30,
        transcript_retention_days=-1,
        derived_retention_days=-1,
        state_window_seconds=120,
        chapter_window_seconds=300,
        inactivity_timeout_seconds=180,
        retrieval_corpus=["chapter_summary", "final_summary"],
        retrieval_ranking_profile="hybrid_summary_first",
        capabilities={"whisper": {"transcription": True}},
        engines=[{"id": "whisper", "name": "Whisper", "available": True}],
    )

    payload_dump = str(payload)

    assert "auth_secret" not in payload
    assert "openai_api_key" not in payload
    assert "sarvam_api_key" not in payload
    assert "AUTH_SECRET" not in payload_dump
    assert "OPENAI_API_KEY" not in payload_dump
    assert "SARVAM_API_KEY" not in payload_dump


def test_recent_lines_payload_is_capped_to_three_items():
    payload = build_recent_lines_payload(
        [
            {"speaker_label": "A", "text": "one", "translated_text": None, "timestamp_start": 1},
            {"speaker_label": "B", "text": "two", "translated_text": None, "timestamp_start": 2},
            {"speaker_label": "C", "text": "three", "translated_text": None, "timestamp_start": 3},
            {"speaker_label": "D", "text": "four", "translated_text": "translated four", "timestamp_start": 4},
        ]
    )

    assert payload == {
        "recent_lines": [
            {"speaker_label": "B", "text": "two", "timestamp_start": 2},
            {"speaker_label": "C", "text": "three", "timestamp_start": 3},
            {"speaker_label": "D", "text": "translated four", "timestamp_start": 4},
        ]
    }


def test_state_payload_returns_empty_shape_when_no_record_exists():
    payload = build_state_payload(None)

    assert payload["current_topic"] is None
    assert payload["summary_bullets"] == []
    assert payload["decisions_forming"] == []
    assert payload["blockers"] == []
    assert payload["open_questions"] == []
    assert payload["active_action_items"] == []


def test_chapter_and_generated_item_payloads_preserve_shapes():
    chapters = build_chapter_list_payload([{"id": "chapter-1", "window_label": "0:00-5:00", "boundary_source": "semantic_adjustment"}])
    items = build_generated_items_payload(
        [
            {
                "id": "decision-1",
                "review_status": "promoted",
                "confidence": 0.91,
                "promotion_reason": "decision evidence: proposal + agreement/restatement",
            }
        ]
    )

    assert chapters == {"chapters": [{"id": "chapter-1", "window_label": "0:00-5:00", "boundary_source": "semantic_adjustment"}]}
    assert items == {
        "items": [
            {
                "id": "decision-1",
                "review_status": "promoted",
                "confidence": 0.91,
                "promotion_reason": "decision evidence: proposal + agreement/restatement",
            }
        ]
    }


def test_runtime_config_endpoint_exposes_summary_policy():
    client = TestClient(app)

    response = client.get("/api/runtime-config")

    assert response.status_code == 200
    data = response.json()
    assert data["auth"]["provider"] == "local"
    assert data["auth"]["supported_providers"] == ["email"]
    assert data["tenant_mode"] == "single"
    assert data["auth"]["organization_required"] is False
    assert data["auth"]["onboarding_required"] is False
    assert data["summary_policy"]["inactivity_timeout_seconds"] == 180
    assert data["summary_policy"]["raw_audio_retention_days"] == 0
    assert data["summary_policy"]["full_transcript_retained"] is True


def test_summary_first_materialization_builds_state_chapter_and_generated_records_from_segments():
    artifacts = build_summary_first_materialization(
        meeting={
            "id": "meeting-1",
            "tenant_id": "tenant-1",
            "status": "recording",
            "updated_at": "2026-04-07T10:05:00+00:00",
        },
        transcript_segments=[
            {
                "id": "seg-1",
                "speaker_label": "SPK 1",
                "text": "We decided to delay launch by one week.",
                "translated_text": "We decided to delay launch by one week.",
                "timestamp_start": 0,
                "timestamp_end": 50,
            },
            {
                "id": "seg-2",
                "speaker_label": "SPK 1",
                "text": "Maya will send the release notes by Friday.",
                "translated_text": "Maya will send the release notes by Friday.",
                "timestamp_start": 60,
                "timestamp_end": 100,
            },
            {
                "id": "seg-3",
                "speaker_label": "SPK 1",
                "text": "Who will own post-launch support?",
                "translated_text": "Who will own post-launch support?",
                "timestamp_start": 305,
                "timestamp_end": 320,
            },
        ],
        finalize=False,
    )

    assert artifacts["meeting_states"]
    assert artifacts["chapter_summaries"]
    assert artifacts["generated_records"]["decisions"][0]["review_status"] == "promoted"
    assert artifacts["generated_records"]["action_items"][0]["review_status"] == "promoted"
    assert artifacts["generated_records"]["open_questions"][0]["text"] == "Who will own post-launch support?"
    assert artifacts["generated_records"]["action_items"][0]["owner_user_id"] is None


def test_summary_first_materialization_does_not_emit_zero_length_state_window_at_exact_boundary():
    artifacts = build_summary_first_materialization(
        meeting={
            "id": "meeting-1",
            "tenant_id": "tenant-1",
            "status": "recording",
            "updated_at": "2026-04-07T10:05:00+00:00",
        },
        transcript_segments=[
            {
                "id": "seg-1",
                "speaker_label": "SPK 1",
                "text": "Boundary-aligned state window.",
                "translated_text": "Boundary-aligned state window.",
                "timestamp_start": 0,
                "timestamp_end": 120,
            }
        ],
        finalize=False,
    )

    assert len(artifacts["meeting_states"]) == 1
    assert artifacts["meeting_states"][0]["window_start"] == 0
    assert artifacts["meeting_states"][0]["window_end"] == 120


def test_summary_first_materialization_skips_silent_chapter_windows_without_dropping_later_content():
    artifacts = build_summary_first_materialization(
        meeting={
            "id": "meeting-gap",
            "tenant_id": "tenant-1",
            "status": "recording",
            "updated_at": "2026-04-07T10:20:00+00:00",
        },
        transcript_segments=[
            {
                "id": "seg-1",
                "speaker_label": "SPK 1",
                "text": "We agreed to ship the initial patch today.",
                "translated_text": "We agreed to ship the initial patch today.",
                "timestamp_start": 0,
                "timestamp_end": 90,
            },
            {
                "id": "seg-2",
                "speaker_label": "SPK 2",
                "text": "Priya will validate the rollout before noon.",
                "translated_text": "Priya will validate the rollout before noon.",
                "timestamp_start": 720,
                "timestamp_end": 780,
            },
            {
                "id": "seg-3",
                "speaker_label": "SPK 2",
                "text": "Who will monitor the deployment after release?",
                "translated_text": "Who will monitor the deployment after release?",
                "timestamp_start": 880,
                "timestamp_end": 920,
            },
        ],
        finalize=False,
    )

    assert len(artifacts["chapter_summaries"]) == 2
    assert artifacts["chapter_summaries"][0]["window_start"] == 0
    assert artifacts["chapter_summaries"][1]["window_start"] == 600
    assert any(item["text"] == "Priya will validate the rollout before noon" for item in artifacts["generated_records"]["action_items"])
    assert any(
        item["text"] == "Who will monitor the deployment after release?"
        for item in artifacts["generated_records"]["open_questions"]
    )


def test_summary_first_materialization_does_not_duplicate_boundary_ending_segments_into_next_chapter():
    artifacts = build_summary_first_materialization(
        meeting={
            "id": "meeting-boundary",
            "tenant_id": "tenant-1",
            "status": "stopped",
            "updated_at": "2026-04-07T10:20:00+00:00",
        },
        transcript_segments=[
            {
                "id": "seg-1",
                "speaker_label": "SPK 1",
                "text": "We agreed to freeze scope before launch.",
                "translated_text": "We agreed to freeze scope before launch.",
                "timestamp_start": 0,
                "timestamp_end": 300,
            },
            {
                "id": "seg-2",
                "speaker_label": "SPK 2",
                "text": "Who will own the rollout checklist?",
                "translated_text": "Who will own the rollout checklist?",
                "timestamp_start": 320,
                "timestamp_end": 340,
            },
            {
                "id": "seg-3",
                "speaker_label": "SPK 2",
                "text": "Please confirm the deployment watch rotation today.",
                "translated_text": "Please confirm the deployment watch rotation today.",
                "timestamp_start": 342,
                "timestamp_end": 360,
            },
        ],
        finalize=True,
    )

    assert len(artifacts["chapter_summaries"]) == 2
    assert artifacts["chapter_summaries"][0]["summary_text"] == "We agreed to freeze scope before launch."
    assert "We agreed to freeze scope before launch." not in artifacts["chapter_summaries"][1]["summary_text"]
    assert artifacts["chapter_summaries"][1]["summary_text"].startswith("Who will own the rollout checklist?")
    assert artifacts["generated_records"]["decisions"][0]["chapter_summary_id"] == artifacts["chapter_summaries"][0]["id"]
    assert artifacts["generated_records"]["open_questions"][0]["chapter_summary_id"] == artifacts["chapter_summaries"][1]["id"]


def test_summary_first_materialization_dedupes_cross_chapter_generated_records_from_straddling_segments():
    artifacts = build_summary_first_materialization(
        meeting={
            "id": "meeting-straddle",
            "tenant_id": "tenant-1",
            "status": "stopped",
            "updated_at": "2026-04-07T10:20:00+00:00",
        },
        transcript_segments=[
            {
                "id": "seg-1",
                "speaker_label": "SPK 1",
                "text": "Priya will send the release notes before noon.",
                "translated_text": "Priya will send the release notes before noon.",
                "timestamp_start": 280,
                "timestamp_end": 360,
            },
            {
                "id": "seg-2",
                "speaker_label": "SPK 2",
                "text": "Can someone validate the rollout checklist today?",
                "translated_text": "Can someone validate the rollout checklist today?",
                "timestamp_start": 365,
                "timestamp_end": 390,
            },
        ],
        finalize=True,
    )

    assert len(artifacts["chapter_summaries"]) == 2
    assert len(artifacts["generated_records"]["action_items"]) == 1
    assert artifacts["generated_records"]["action_items"][0]["text"] == "Priya will send the release notes before noon"
    assert artifacts["generated_records"]["action_items"][0]["chapter_summary_id"] == artifacts["chapter_summaries"][0]["id"]


def test_transcribe_audio_triggers_summary_first_materialization(monkeypatch):
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

    monkeypatch.setattr("backend.server.fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id, "engine": "whisper", "duration_seconds": 110})
    monkeypatch.setattr("backend.server.get_speech_provider", lambda engine: FakeProvider())
    monkeypatch.setattr("backend.server.batch_translate_segments_to_english", fake_translate)
    monkeypatch.setattr("backend.server.get_db_connection", lambda: FakeConnection())
    monkeypatch.setattr("backend.server.record_completed_job", lambda **kwargs: None)
    monkeypatch.setattr("backend.server.refresh_summary_first_meeting_memory", fake_materialize)

    actor = AuthUser(id="user-1", email="user@example.com", is_authenticated=True)
    audio = UploadFile(file=BytesIO(b"RIFFdata"), filename="chunk.wav", headers=Headers({"content-type": "audio/wav"}))

    result = __import__("asyncio").run(
        transcribe_audio(
            "meeting-1",
            audio=audio,
            chunk_index=0,
            elapsed_seconds=0.0,
            chunk_duration_seconds=20.0,
            actor=actor,
        )
    )

    assert result["engine"] == "whisper"
    assert calls == [("meeting-1", "user-1", False)]


def test_transcribe_audio_skips_materialization_when_chunk_does_not_cross_boundary(monkeypatch):
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
                    "timestamp_start": 20,
                    "timestamp_end": 40,
                    "created_at": "2026-04-07T10:00:00+00:00",
                    "language_code": "en",
                }
            ]

    async def fake_translate(segments):
        return segments

    async def fake_materialize(meeting_id, actor, *, finalize=False, now=None):
        calls.append((meeting_id, actor.id, finalize))

    monkeypatch.setattr("backend.server.fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id, "engine": "whisper", "duration_seconds": 30})
    monkeypatch.setattr("backend.server.get_speech_provider", lambda engine: FakeProvider())
    monkeypatch.setattr("backend.server.batch_translate_segments_to_english", fake_translate)
    monkeypatch.setattr("backend.server.get_db_connection", lambda: FakeConnection())
    monkeypatch.setattr("backend.server.record_completed_job", lambda **kwargs: None)
    monkeypatch.setattr("backend.server.refresh_summary_first_meeting_memory", fake_materialize)

    actor = AuthUser(id="user-1", email="user@example.com", is_authenticated=True)
    audio = UploadFile(file=BytesIO(b"RIFFdata"), filename="chunk.wav", headers=Headers({"content-type": "audio/wav"}))

    result = __import__("asyncio").run(
        transcribe_audio(
            "meeting-1",
            audio=audio,
            chunk_index=1,
            elapsed_seconds=40.0,
            chunk_duration_seconds=20.0,
            actor=actor,
        )
    )

    assert result["engine"] == "whisper"
    assert calls == []


def test_update_meeting_stopped_triggers_finalized_materialization(monkeypatch):
    calls = []

    class FakeCursor:
        def execute(self, query, params=None):
            self.query = query
            self.params = params

        def fetchone(self):
            return {
                "id": "meeting-1",
                "title": "Sync",
                "status": "stopped",
                "engine": "whisper",
                "created_at": "2026-04-07T10:00:00+00:00",
                "updated_at": "2026-04-07T10:06:00+00:00",
                "duration_seconds": 120,
                "segment_count": 2,
            }

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    async def fake_materialize(meeting_id, actor, *, finalize=False, now=None):
        calls.append((meeting_id, actor.id, finalize))

    monkeypatch.setattr("backend.server.get_db_connection", lambda: FakeConnection())
    monkeypatch.setattr("backend.server.refresh_summary_first_meeting_memory", fake_materialize)

    actor = AuthUser(id="user-1", email="user@example.com", is_authenticated=True)

    result = __import__("asyncio").run(update_meeting("meeting-1", MeetingUpdate(status="stopped"), actor=actor))

    assert result["status"] == "stopped"
    assert calls == [("meeting-1", "user-1", True)]


def test_refresh_summary_first_meeting_memory_uses_all_meeting_segments_and_tenant_scoped_deletes(monkeypatch):
    executed = []

    class FakeCursor:
        def __init__(self):
            self.last_query = ""

        def execute(self, query, params=None):
            self.last_query = " ".join(str(query).split())
            executed.append((self.last_query, params))

        def fetchall(self):
            if "FROM transcript_segments" in self.last_query:
                return []
            return []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        "backend.server.fetch_meeting",
        lambda conn, meeting_id, actor: {"id": meeting_id, "tenant_id": "tenant-1", "status": "recording", "updated_at": "2026-04-07T10:05:00+00:00"},
    )
    monkeypatch.setattr("backend.server.get_db_connection", lambda: FakeConnection())
    monkeypatch.setattr(
        "backend.server.build_summary_first_materialization",
        lambda **kwargs: {"meeting_states": [], "chapter_summaries": [], "generated_records": {"decisions": [], "action_items": [], "open_questions": []}},
    )
    monkeypatch.setattr("backend.server.record_completed_job", lambda **kwargs: None)

    actor = AuthUser(id="user-1", email="user@example.com", is_authenticated=True)

    __import__("asyncio").run(refresh_summary_first_meeting_memory("meeting-1", actor, finalize=False))

    transcript_query = next(query for query, _ in executed if "FROM transcript_segments" in query)
    transcript_params = next(params for query, params in executed if "FROM transcript_segments" in query)
    assert "owner_user_id" not in transcript_query
    assert transcript_params == ("meeting-1",)

    assert any(
        "DELETE FROM meeting_state WHERE meeting_id =" in query and "tenant_id =" in query and params == ("meeting-1", "tenant-1")
        for query, params in executed
    )
    assert any(
        "DELETE FROM chapter_summaries WHERE meeting_id =" in query and "tenant_id =" in query and params == ("meeting-1", "tenant-1")
        for query, params in executed
    )


def test_refresh_summary_first_meeting_memory_uses_open_question_insert_shape_without_owner_user_id(monkeypatch):
    executed = []

    class FakeCursor:
        def __init__(self):
            self.last_query = ""

        def execute(self, query, params=None):
            self.last_query = " ".join(str(query).split())
            executed.append((self.last_query, params))

        def fetchall(self):
            if "FROM transcript_segments" in self.last_query:
                return []
            return []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def commit(self):
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        "backend.server.fetch_meeting",
        lambda conn, meeting_id, actor: {"id": meeting_id, "tenant_id": "tenant-1", "status": "recording", "updated_at": "2026-04-07T10:05:00+00:00"},
    )
    monkeypatch.setattr("backend.server.get_db_connection", lambda: FakeConnection())
    monkeypatch.setattr(
        "backend.server.build_summary_first_materialization",
        lambda **kwargs: {
            "meeting_states": [],
            "chapter_summaries": [],
            "generated_records": {
                "decisions": [],
                "action_items": [],
                "open_questions": [
                    {
                        "id": "oq-1",
                        "meeting_id": "meeting-1",
                        "chapter_summary_id": "chapter-1",
                        "text": "Who owns follow-up?",
                        "evidence_refs": ["seg-1"],
                        "record_origin": "generated",
                        "review_status": "draft",
                        "confidence": 0.7,
                        "promotion_reason": None,
                        "source_window_start": 300,
                        "source_window_end": 320,
                    }
                ],
            },
        },
    )
    monkeypatch.setattr("backend.server.record_completed_job", lambda **kwargs: None)

    actor = AuthUser(id="user-1", email="user@example.com", is_authenticated=True)

    __import__("asyncio").run(refresh_summary_first_meeting_memory("meeting-1", actor, finalize=False))

    open_question_insert = next(query for query, _ in executed if "INSERT INTO open_questions" in query)
    assert "owner_user_id" not in open_question_insert
    assert "source_window_start" in open_question_insert


def test_should_refresh_summary_first_on_read_only_when_materialization_is_missing():
    stopped_meeting = {"status": "stopped", "updated_at": "2026-04-07T10:05:00+00:00"}
    stale_recording = {"status": "recording", "updated_at": "2026-04-07T10:00:00+00:00", "duration_seconds": 340}
    comparison_now = datetime(2026, 4, 7, 10, 4, 0, tzinfo=timezone.utc)

    assert should_refresh_summary_first_on_read(stopped_meeting, has_materialized_state=False, has_materialized_chapters=False) is True
    assert should_refresh_summary_first_on_read(stopped_meeting, has_materialized_state=True, has_materialized_chapters=True) is False
    assert should_refresh_summary_first_on_read(
        stale_recording,
        has_materialized_state=False,
        has_materialized_chapters=False,
        latest_state_end=0,
        latest_chapter_end=0,
        now=comparison_now,
    ) is True
    assert should_refresh_summary_first_on_read(
        stale_recording,
        has_materialized_state=True,
        has_materialized_chapters=True,
        latest_state_end=340,
        latest_chapter_end=300,
        now=comparison_now,
    ) is False
    assert should_refresh_summary_first_on_read(
        stale_recording,
        has_materialized_state=True,
        has_materialized_chapters=True,
        latest_state_end=300,
        latest_chapter_end=300,
        now=comparison_now,
    ) is True
    assert should_refresh_summary_first_on_read(
        stale_recording,
        has_materialized_state=True,
        has_materialized_chapters=True,
        latest_state_end=340,
        latest_chapter_end=340,
        now=comparison_now,
    ) is False


def test_should_materialize_after_transcription_chunk_only_on_window_boundary_crossing():
    assert should_materialize_after_transcription_chunk(previous_max_timestamp=110, new_max_timestamp=140) is True
    assert should_materialize_after_transcription_chunk(previous_max_timestamp=120, new_max_timestamp=140) is True
    assert should_materialize_after_transcription_chunk(previous_max_timestamp=290, new_max_timestamp=320) is True
    assert should_materialize_after_transcription_chunk(previous_max_timestamp=300, new_max_timestamp=320) is True
    assert should_materialize_after_transcription_chunk(previous_max_timestamp=30, new_max_timestamp=40) is False
