"""Meeting state payload helpers for summary-first Sprint 1."""

from backend.repositories.state import empty_meeting_state_record, normalize_meeting_state_record
from backend.repositories.transcripts import recent_display_lines


def build_state_payload(record: dict[str, object] | None) -> dict[str, object]:
    if record is None:
        return empty_meeting_state_record()

    return normalize_meeting_state_record(record)


def build_recent_lines_payload(rows: list[dict[str, object]]) -> dict[str, object]:
    return {"recent_lines": recent_display_lines(rows)}
