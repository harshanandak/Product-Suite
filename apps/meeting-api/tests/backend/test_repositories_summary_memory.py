from sqlalchemy import create_engine

from backend.db import (
    chapter_summaries_table,
    close_db_pool,
    create_db_engine,
    get_db_pool,
    init_db_pool,
    meetings_table,
    metadata,
    normalize_sqlalchemy_database_url,
    summaries_table,
)
from backend.repositories.history import fetch_history_records
from backend.repositories.jobs import build_job_idempotency_key
from backend.repositories.chapters import ordered_chapter_summaries, upsert_chapter_summary
from backend.repositories.meetings import meeting_visible_to_actor
from backend.repositories.state import (
    empty_meeting_state_record,
    latest_meeting_state_record,
    upsert_meeting_state_record,
)
from backend.repositories.transcripts import recent_display_lines


def test_normalize_sqlalchemy_database_url_uses_psycopg_driver_for_postgres():
    assert normalize_sqlalchemy_database_url("postgresql://user:pass@db.example.com/app") == "postgresql+psycopg://user:pass@db.example.com/app"


def test_create_db_engine_preserves_sqlite_urls_for_local_testing():
    engine = create_db_engine("sqlite:///:memory:")

    assert str(engine.url) == "sqlite:///:memory:"


def test_init_db_pool_uses_connection_pool(monkeypatch):
    import backend.db as db_module

    created = {}

    class DummyPool:
        def __init__(self, conninfo, min_size, max_size, kwargs, open):
            created.update(
                {
                    "conninfo": conninfo,
                    "min_size": min_size,
                    "max_size": max_size,
                    "kwargs": kwargs,
                    "open": open,
                }
            )

        def close(self):
            created["closed"] = True

    class DummyEngine:
        def dispose(self):
            created["disposed"] = True

    monkeypatch.setattr(db_module, "ConnectionPool", DummyPool)
    monkeypatch.setattr(db_module, "create_db_engine", lambda database_url: DummyEngine())
    monkeypatch.setattr(db_module, "_db_pool", None)
    monkeypatch.setattr(db_module, "_db_engine", None)

    settings = type(
        "SettingsStub",
        (),
        {
            "database_url": "postgresql://user:pass@db.example.com/app",
            "db_pool_min_size": 2,
            "db_pool_max_size": 7,
        },
    )()

    try:
        init_db_pool(settings)

        assert created == {
            "conninfo": "postgresql://user:pass@db.example.com/app",
            "min_size": 2,
            "max_size": 7,
            "kwargs": {"row_factory": db_module.dict_row},
            "open": True,
        }
        assert get_db_pool().__class__ is DummyPool
    finally:
        close_db_pool()
        assert created["closed"] is True
        assert created["disposed"] is True


def test_fetch_history_records_uses_sqlalchemy_core_and_honors_allowed_corpus():
    engine = create_engine("sqlite:///:memory:")
    metadata.create_all(engine, tables=[meetings_table, chapter_summaries_table, summaries_table])

    with engine.begin() as conn:
        conn.execute(
            meetings_table.insert(),
            [
                {
                    "id": "meeting-current",
                    "tenant_id": "tenant-1",
                    "owner_user_id": "user-1",
                    "visibility": "private",
                    "title": "Current meeting",
                    "project_name": "Alpha",
                    "tags": ["current"],
                    "participant_labels": ["Ada"],
                },
                {
                    "id": "meeting-history",
                    "tenant_id": "tenant-1",
                    "owner_user_id": "user-1",
                    "visibility": "team",
                    "title": "Launch sync",
                    "project_name": "Alpha",
                    "tags": ["launch"],
                    "participant_labels": ["Ada", "Maya"],
                },
            ],
        )
        conn.execute(
            chapter_summaries_table.insert(),
            [
                {
                    "id": "chapter-1",
                    "meeting_id": "meeting-history",
                    "chapter_index": 0,
                    "summary_text": "We discussed launch pricing.",
                }
            ],
        )
        conn.execute(
            summaries_table.insert(),
            [
                {
                    "id": "summary-1",
                    "meeting_id": "meeting-history",
                    "summary_text": "Final summary about launch pricing.",
                }
            ],
        )

    rows = fetch_history_records(
        engine,
        tenant_id="tenant-1",
        excluded_meeting_id="meeting-current",
        actor_user_id="user-1",
        allowed_corpora=["chapter_summary"],
    )

    assert [row["id"] for row in rows] == ["chapter-1"]
    assert rows[0]["corpus"] == "chapter_summary"


def test_fetch_history_records_returns_empty_for_unknown_corpus_configuration():
    engine = create_engine("sqlite:///:memory:")
    metadata.create_all(engine, tables=[meetings_table, chapter_summaries_table, summaries_table])

    rows = fetch_history_records(
        engine,
        tenant_id="tenant-1",
        excluded_meeting_id="meeting-current",
        actor_user_id="user-1",
        allowed_corpora=["unknown_corpus"],
    )

    assert rows == []


def test_private_meeting_visibility_is_limited_to_the_owner():
    meeting = {"owner_user_id": "user-1", "visibility": "private"}

    assert meeting_visible_to_actor(meeting, "user-1") is True
    assert meeting_visible_to_actor(meeting, "user-2") is False


def test_public_meeting_visibility_allows_any_actor():
    meeting = {"owner_user_id": "user-1", "visibility": "public"}

    assert meeting_visible_to_actor(meeting, "user-1") is True
    assert meeting_visible_to_actor(meeting, "user-2") is True


def test_team_meeting_visibility_requires_same_tenant():
    meeting = {"owner_user_id": "user-1", "visibility": "team", "tenant_id": "tenant-1"}

    assert meeting_visible_to_actor(meeting, "user-1", actor_tenant_id="tenant-2") is True
    assert meeting_visible_to_actor(meeting, "user-2", actor_tenant_id="tenant-1") is True
    assert meeting_visible_to_actor(meeting, "user-2", actor_tenant_id="tenant-2") is False


def test_recent_display_lines_returns_at_most_three_sorted_lines():
    rows = [
        {"speaker_label": "A", "text": "one", "translated_text": None, "timestamp_start": 1},
        {"speaker_label": "B", "text": "two", "translated_text": None, "timestamp_start": 2},
        {"speaker_label": "C", "text": "three", "translated_text": None, "timestamp_start": 3},
        {"speaker_label": "D", "text": "four", "translated_text": "translated four", "timestamp_start": 4},
    ]

    assert recent_display_lines(rows) == [
        {"speaker_label": "B", "text": "two", "timestamp_start": 2},
        {"speaker_label": "C", "text": "three", "timestamp_start": 3},
        {"speaker_label": "D", "text": "translated four", "timestamp_start": 4},
    ]


def test_job_idempotency_key_is_stable_for_same_window():
    key = build_job_idempotency_key(
        meeting_id="meeting-1",
        job_type="meeting_state_update",
        window_start=0,
        window_end=120,
    )

    assert key == "meeting-1:meeting_state_update:0:120"


def test_upsert_meeting_state_replaces_existing_window_record():
    existing_records = [
        {
            "id": "state-1",
            "meeting_id": "meeting-1",
            "tenant_id": "tenant-1",
            "window_start": 0,
            "window_end": 120,
            "current_topic": "Old topic",
            "summary_bullets": ["Old bullet"],
            "created_at": "2026-04-07T10:00:00+00:00",
        }
    ]
    next_record = {
        "id": "state-2",
        "meeting_id": "meeting-1",
        "tenant_id": "tenant-1",
        "window_start": 0,
        "window_end": 120,
        "current_topic": "New topic",
        "summary_bullets": ["New bullet"],
        "created_at": "2026-04-07T10:02:00+00:00",
    }

    updated = upsert_meeting_state_record(existing_records, next_record)

    assert updated == [next_record]


def test_latest_meeting_state_prefers_largest_window_then_latest_timestamp():
    records = [
        {
            "id": "state-1",
            "meeting_id": "meeting-1",
            "tenant_id": "tenant-1",
            "window_start": 0,
            "window_end": 120,
            "current_topic": "Kickoff",
            "created_at": "2026-04-07T10:00:00+00:00",
        },
        {
            "id": "state-2",
            "meeting_id": "meeting-1",
            "tenant_id": "tenant-1",
            "window_start": 120,
            "window_end": 240,
            "current_topic": "Rollout",
            "created_at": "2026-04-07T10:02:00+00:00",
        },
        {
            "id": "state-3",
            "meeting_id": "meeting-1",
            "tenant_id": "tenant-1",
            "window_start": 120,
            "window_end": 240,
            "current_topic": "Updated rollout",
            "created_at": "2026-04-07T10:03:00+00:00",
        },
    ]

    assert latest_meeting_state_record(records)["id"] == "state-3"


def test_empty_meeting_state_record_returns_ui_safe_defaults():
    assert empty_meeting_state_record() == {
        "current_topic": None,
        "current_goal": None,
        "summary_bullets": [],
        "decisions_forming": [],
        "blockers": [],
        "open_questions": [],
        "active_action_items": [],
        "confidence": 0,
    }


def test_upsert_chapter_summary_replaces_existing_chapter_index():
    existing_records = [
        {
            "id": "chapter-1",
            "meeting_id": "meeting-1",
            "chapter_index": 0,
            "window_start": 0,
            "window_end": 282,
            "title": "Old chapter",
        }
    ]
    next_record = {
        "id": "chapter-2",
        "meeting_id": "meeting-1",
        "chapter_index": 0,
        "window_start": 0,
        "window_end": 300,
        "title": "Updated chapter",
    }

    updated = upsert_chapter_summary(existing_records, next_record)

    assert updated == [next_record]


def test_ordered_chapter_summaries_sort_by_index_then_window():
    records = [
        {"id": "chapter-2", "meeting_id": "meeting-1", "chapter_index": 1, "window_start": 300, "window_end": 600},
        {"id": "chapter-1b", "meeting_id": "meeting-1", "chapter_index": 0, "window_start": 10, "window_end": 120},
        {"id": "chapter-1a", "meeting_id": "meeting-1", "chapter_index": 0, "window_start": 0, "window_end": 110},
    ]

    assert [record["id"] for record in ordered_chapter_summaries(records)] == ["chapter-1a", "chapter-1b", "chapter-2"]
