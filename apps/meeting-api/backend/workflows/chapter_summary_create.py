"""Chapter summary worker helpers."""


NOMINAL_CHAPTER_WINDOW_SECONDS = 300
MIN_CHAPTER_WINDOW_SECONDS = 120
MAX_CHAPTER_WINDOW_SECONDS = 420
BOUNDARY_ADJUSTMENT_SECONDS = 45
MIN_PARTIAL_WINDOW_SEGMENTS = 2
MIN_PARTIAL_WINDOW_WORDS = 6


def _word_count(text: str) -> int:
    return len([word for word in text.split() if word.strip()])


def should_keep_partial_window(*, segment_count: int, transcript_text: str) -> bool:
    return segment_count >= MIN_PARTIAL_WINDOW_SEGMENTS and _word_count(transcript_text) >= MIN_PARTIAL_WINDOW_WORDS


def clamp_chapter_window_end(*, window_start: int | float, proposed_end: int | float, meeting_ended: bool) -> float:
    if meeting_ended:
        return float(proposed_end)

    minimum_end = float(window_start) + MIN_CHAPTER_WINDOW_SECONDS
    maximum_end = float(window_start) + MAX_CHAPTER_WINDOW_SECONDS
    return min(max(float(proposed_end), minimum_end), maximum_end)


def resolve_chapter_boundary(
    *,
    window_start: int | float,
    nominal_end: int | float,
    candidate_boundaries: list[int | float],
    meeting_ended: bool,
) -> float:
    normalized_nominal_end = clamp_chapter_window_end(
        window_start=window_start,
        proposed_end=nominal_end,
        meeting_ended=meeting_ended,
    )
    valid_candidates = [
        float(candidate)
        for candidate in candidate_boundaries
        if abs(float(candidate) - float(nominal_end)) <= BOUNDARY_ADJUSTMENT_SECONDS
    ]
    if not valid_candidates:
        return normalized_nominal_end

    preferred = min(
        valid_candidates,
        key=lambda candidate: (abs(candidate - float(nominal_end)), candidate > float(nominal_end), candidate),
    )
    return clamp_chapter_window_end(
        window_start=window_start,
        proposed_end=preferred,
        meeting_ended=meeting_ended,
    )
