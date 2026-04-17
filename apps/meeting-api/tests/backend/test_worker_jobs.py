from datetime import datetime, timedelta, timezone

from backend.repositories.jobs import build_job_idempotency_key
from backend.services.chapter_summary import build_chapter_window_payload
from backend.workflows.chapter_summary_create import (
    clamp_chapter_window_end,
    resolve_chapter_boundary,
    should_keep_partial_window,
)
from backend.workflows.meeting_state_update import should_halt_due_to_inactivity, should_halt_due_to_explicit_stop
from backend.workflows.post_meeting_finalize import should_finalize_meeting


def test_job_idempotency_key_is_stable_for_duplicate_windows():
    first = build_job_idempotency_key("meeting-1", "meeting_state_update", 0, 120)
    second = build_job_idempotency_key("meeting-1", "meeting_state_update", 0, 120)

    assert first == second


def test_job_idempotency_key_normalizes_equivalent_numeric_windows():
    first = build_job_idempotency_key("meeting-1", "chapter_summary_create", 0, 300)
    second = build_job_idempotency_key("meeting-1", "chapter_summary_create", 0.0, 300.000)

    assert first == second


def test_inactivity_timeout_stops_worker_after_three_minutes_without_audio():
    now = datetime.now(timezone.utc)
    last_audio = now - timedelta(seconds=181)

    assert should_halt_due_to_inactivity(last_audio, now, inactivity_timeout_seconds=180) is True


def test_explicit_stop_halts_worker_immediately():
    assert should_halt_due_to_explicit_stop("stopped") is True


def test_partial_final_window_is_skipped_when_content_is_too_sparse():
    assert should_keep_partial_window(segment_count=1, transcript_text="hello") is False


def test_partial_final_window_is_kept_when_multiple_segments_and_words_exist():
    assert (
        should_keep_partial_window(
            segment_count=2,
            transcript_text="We agreed to fix the billing bug tomorrow morning.",
        )
        is True
    )


def test_chapter_window_end_is_clamped_to_guardrails_for_active_meeting():
    assert clamp_chapter_window_end(window_start=0, proposed_end=60, meeting_ended=False) == 120
    assert clamp_chapter_window_end(window_start=0, proposed_end=480, meeting_ended=False) == 420


def test_chapter_window_end_can_be_shorter_when_meeting_has_ended():
    assert clamp_chapter_window_end(window_start=0, proposed_end=60, meeting_ended=True) == 60


def test_semantic_boundary_prefers_nearest_valid_candidate_within_adjustment_band():
    chosen = resolve_chapter_boundary(
        window_start=0,
        nominal_end=300,
        candidate_boundaries=[255, 282, 318, 360],
        meeting_ended=False,
    )

    assert chosen == 282


def test_build_chapter_window_payload_uses_adjusted_boundary_and_label():
    payload = build_chapter_window_payload(
        window_start=0,
        nominal_end=300,
        candidate_boundaries=[282, 318],
        meeting_ended=False,
    )

    assert payload == {
        "window_start": 0,
        "window_end": 282.0,
        "window_label": "0:00-4:42",
        "boundary_source": "semantic_adjustment",
    }


def test_build_chapter_window_payload_marks_fixed_window_when_no_candidate_boundary_exists():
    payload = build_chapter_window_payload(
        window_start=0,
        nominal_end=300,
        candidate_boundaries=[],
        meeting_ended=False,
    )

    assert payload["boundary_source"] == "fixed_window"


def test_finalize_meeting_triggers_on_explicit_end_or_inactivity():
    assert should_finalize_meeting(has_transcript=False, ended_explicitly=True, halted_due_to_inactivity=False) is True
    assert should_finalize_meeting(has_transcript=False, ended_explicitly=False, halted_due_to_inactivity=True) is True
    assert should_finalize_meeting(has_transcript=False, ended_explicitly=False, halted_due_to_inactivity=False) is False


def test_finalize_meeting_does_not_trigger_from_transcript_presence_alone():
    assert should_finalize_meeting(has_transcript=True, ended_explicitly=False, halted_due_to_inactivity=False) is False
