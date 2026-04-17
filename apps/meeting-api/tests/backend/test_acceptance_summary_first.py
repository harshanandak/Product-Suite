import os
import sys
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.server import app, build_summary_first_materialization, should_finalize_summary_first_meeting

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def test_summary_first_runtime_policy_endpoint_matches_design():
    client = TestClient(app)

    response = client.get("/api/runtime-config")

    assert response.status_code == 200
    data = response.json()
    assert data["summary_policy"]["inactivity_timeout_seconds"] == 180
    assert data["summary_policy"]["raw_audio_retention_days"] == 0
    assert data["summary_policy"]["full_transcript_retained"] is True


def test_readme_documents_windows_python_baseline_and_summary_first_flow():
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "Python 3.13 on Windows" in readme
    assert "summary-first" in readme.lower()
    assert "runtime-config" in readme


def test_summary_first_materialization_skips_sparse_final_chapter_on_finalize():
    artifacts = build_summary_first_materialization(
        meeting={
            "id": "meeting-1",
            "tenant_id": "tenant-1",
            "status": "stopped",
            "updated_at": "2026-04-07T10:05:00+00:00",
        },
        transcript_segments=[
            {
                "id": "seg-1",
                "speaker_label": "SPK 1",
                "text": "Kickoff discussion about launch readiness and blockers.",
                "translated_text": "Kickoff discussion about launch readiness and blockers.",
                "timestamp_start": 0,
                "timestamp_end": 30,
            },
            {
                "id": "seg-2",
                "speaker_label": "SPK 1",
                "text": "tiny tail",
                "translated_text": "tiny tail",
                "timestamp_start": 301,
                "timestamp_end": 305,
            },
        ],
        finalize=True,
    )

    assert len(artifacts["chapter_summaries"]) == 1


def test_recording_meeting_is_finalized_after_inactivity_timeout():
    now = datetime.now(timezone.utc)
    should_finalize = should_finalize_summary_first_meeting(
        {
            "status": "recording",
            "updated_at": (now - timedelta(seconds=181)).isoformat(),
        },
        now=now,
    )

    assert should_finalize is True


def _load_acceptance_fixture(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    ("fixture_name", "meeting_shape"),
    [
        ("status_update_meeting.json", "status update"),
        ("problem_solving_meeting.json", "problem-solving"),
        ("planning_meeting.json", "planning"),
        ("multilingual_meeting.json", "multilingual"),
    ],
)
def test_summary_first_materialization_matches_expected_meeting_shape(fixture_name: str, meeting_shape: str):
    fixture = _load_acceptance_fixture(fixture_name)

    artifacts = build_summary_first_materialization(
        meeting=fixture["meeting"],
        transcript_segments=fixture["transcript_segments"],
        finalize=fixture.get("finalize", True),
    )

    expected = fixture["expected"]
    chapters = artifacts["chapter_summaries"]
    generated_records = artifacts["generated_records"]

    assert len(artifacts["meeting_states"]) >= expected["min_state_records"], meeting_shape
    assert len(chapters) == expected["chapter_count"], meeting_shape
    assert [chapter["window_start"] for chapter in chapters] == sorted(chapter["window_start"] for chapter in chapters), meeting_shape

    for text in expected.get("promoted_decisions", []):
        assert any(
            record["text"] == text and record["review_status"] == "promoted" for record in generated_records["decisions"]
        ), meeting_shape

    for text in expected.get("promoted_action_items", []):
        assert any(
            record["text"] == text and record["review_status"] == "promoted" for record in generated_records["action_items"]
        ), meeting_shape

    for text in expected.get("draft_action_items", []):
        assert any(
            record["text"] == text and record["review_status"] == "draft" for record in generated_records["action_items"]
        ), meeting_shape

    for text in expected.get("open_questions", []):
        assert any(record["text"] == text for record in generated_records["open_questions"]), meeting_shape

    for text in expected.get("excluded_open_questions", []):
        assert all(record["text"] != text for record in generated_records["open_questions"]), meeting_shape

    for text in expected.get("blockers", []):
        assert any(text in state["blockers"] for state in artifacts["meeting_states"]), meeting_shape
