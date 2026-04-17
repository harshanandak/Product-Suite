"""Meeting state repository helpers for summary-first memory."""

from datetime import datetime

LIST_FIELDS = (
    "summary_bullets",
    "decisions_forming",
    "blockers",
    "open_questions",
    "active_action_items",
)


def empty_meeting_state_record() -> dict[str, object]:
    return {
        "current_topic": None,
        "current_goal": None,
        "summary_bullets": [],
        "decisions_forming": [],
        "blockers": [],
        "open_questions": [],
        "active_action_items": [],
        "confidence": 0,
    }


def normalize_meeting_state_record(record: dict[str, object] | None) -> dict[str, object]:
    normalized = empty_meeting_state_record()
    if not record:
        return normalized

    normalized.update({key: value for key, value in record.items() if value is not None})
    for field_name in LIST_FIELDS:
        value = normalized.get(field_name)
        normalized[field_name] = value if isinstance(value, list) else []

    confidence = normalized.get("confidence")
    normalized["confidence"] = confidence if isinstance(confidence, (int, float)) else 0
    return normalized


def _state_sort_key(record: dict[str, object]) -> tuple[float, datetime]:
    window_end = float(record.get("window_end") or 0)
    created_at = record.get("created_at")
    if isinstance(created_at, datetime):
        timestamp = created_at
    else:
        try:
            timestamp = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        except ValueError:
            timestamp = datetime.min
    return window_end, timestamp


def latest_meeting_state_record(records: list[dict[str, object]]) -> dict[str, object] | None:
    if not records:
        return None
    return max(records, key=_state_sort_key)


def upsert_meeting_state_record(
    existing_records: list[dict[str, object]],
    next_record: dict[str, object],
) -> list[dict[str, object]]:
    normalized_next = dict(next_record)
    remaining_records = [
        record
        for record in existing_records
        if not (
            record.get("meeting_id") == normalized_next.get("meeting_id")
            and record.get("window_start") == normalized_next.get("window_start")
            and record.get("window_end") == normalized_next.get("window_end")
        )
    ]
    remaining_records.append(normalized_next)
    return sorted(remaining_records, key=_state_sort_key)
