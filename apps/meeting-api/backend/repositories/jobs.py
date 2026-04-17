"""Job repository helpers."""


def _normalize_window_value(value: int | float) -> str:
    numeric = float(value)
    if numeric.is_integer():
        return str(int(numeric))
    return f"{numeric:.3f}".rstrip("0").rstrip(".")


def build_job_idempotency_key(
    meeting_id: str,
    job_type: str,
    window_start: int | float,
    window_end: int | float,
) -> str:
    return ":".join(
        [
            meeting_id,
            job_type,
            _normalize_window_value(window_start),
            _normalize_window_value(window_end),
        ]
    )
