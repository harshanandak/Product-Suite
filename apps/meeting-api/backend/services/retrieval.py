"""Retrieval helpers for buddy and history flows."""

from backend.services.corpus import (
    ALLOWED_HISTORY_CORPORA,
    DEFAULT_HISTORY_RANKING_PROFILE,
    normalize_allowed_history_corpora,
)


def is_context_insufficient(current_context: str, history_context: str) -> bool:
    combined = f"{current_context.strip()} {history_context.strip()}".strip()
    if not combined:
        return True

    strong_signals = (
        "decide",
        "decision",
        "latest",
        "current",
        "next",
        "action item",
        "blocker",
        "open question",
    )
    if any(signal in combined.lower() for signal in strong_signals):
        return False

    return len(combined) < 40


def _query_terms(query: str) -> list[str]:
    return [term for term in query.lower().split() if term]


def score_history_match(query: str, record: dict[str, object]) -> float:
    terms = _query_terms(query)
    if not terms:
        return 0.0

    score = 0.0
    summary_text = str(record.get("summary_text") or "").lower()
    project_name = str(record.get("project_name") or "").lower()
    meeting_title = str(record.get("meeting_title") or "").lower()
    tags = [str(tag).lower() for tag in (record.get("tags") or [])]
    participants = [str(participant).lower() for participant in (record.get("participants") or [])]

    for term in terms:
        if term in summary_text:
            score += 1.0
        if term in project_name:
            score += 1.5
        if term in meeting_title:
            score += 1.5
        if any(term in tag for tag in tags):
            score += 1.0
        if any(term in participant for participant in participants):
            score += 0.5

    return score


def rank_history_matches(
    query: str,
    records: list[dict[str, object]],
    *,
    allowed_corpora: list[str] | tuple[str, ...] | None = None,
    ranking_profile: str = DEFAULT_HISTORY_RANKING_PROFILE,
) -> list[dict[str, object]]:
    if ranking_profile != DEFAULT_HISTORY_RANKING_PROFILE:
        raise ValueError(f"Unsupported ranking profile: {ranking_profile}")

    normalized_corpora = normalize_allowed_history_corpora(allowed_corpora)
    if not normalized_corpora:
        return []

    allowed_records = [record for record in records if record.get("corpus") in normalized_corpora]
    scored_records = [
        {**record, "score": score_history_match(query, record)}
        for record in allowed_records
    ]
    scored_records = [record for record in scored_records if record.get("score", 0) > 0]
    scored_records.sort(key=lambda record: record.get("score", 0), reverse=True)
    return scored_records


def build_history_search_payload(
    query: str,
    records: list[dict[str, object]],
    *,
    allowed_corpora: list[str] | tuple[str, ...] | None = None,
    ranking_profile: str = DEFAULT_HISTORY_RANKING_PROFILE,
) -> dict[str, object]:
    return {
        "results": rank_history_matches(
            query,
            records,
            allowed_corpora=allowed_corpora,
            ranking_profile=ranking_profile,
        )
    }
