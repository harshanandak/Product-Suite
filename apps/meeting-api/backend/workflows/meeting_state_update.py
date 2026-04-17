"""Meeting-state worker helpers."""

from datetime import datetime, timezone

DEFAULT_INACTIVITY_TIMEOUT_SECONDS = 300


def should_halt_due_to_inactivity(
    last_audio_at: datetime,
    now: datetime,
    *,
    inactivity_timeout_seconds: int,
) -> bool:
    elapsed = max((now - last_audio_at).total_seconds(), 0)
    return elapsed >= inactivity_timeout_seconds


def should_halt_due_to_explicit_stop(status: str) -> bool:
    return status.strip().lower() == "stopped"
