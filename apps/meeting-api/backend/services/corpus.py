"""Shared corpus and ranking policy helpers for history retrieval."""

from __future__ import annotations


ALLOWED_HISTORY_CORPORA = frozenset({"chapter_summary", "final_summary"})
DEFAULT_HISTORY_RANKING_PROFILE = "hybrid_summary_first"
ALLOWED_HISTORY_RANKING_PROFILES = frozenset({DEFAULT_HISTORY_RANKING_PROFILE})


def normalize_allowed_history_corpora(
    allowed_corpora: list[str] | tuple[str, ...] | set[str] | frozenset[str] | None,
) -> frozenset[str]:
    if not allowed_corpora:
        return ALLOWED_HISTORY_CORPORA

    normalized = {
        str(corpus).strip().lower()
        for corpus in allowed_corpora
        if str(corpus).strip()
    }
    return frozenset(normalized & ALLOWED_HISTORY_CORPORA)


def validate_history_ranking_profile(profile: str) -> str:
    normalized = profile.strip()
    if normalized not in ALLOWED_HISTORY_RANKING_PROFILES:
        raise ValueError(f"Unsupported history ranking profile: {normalized}")
    return normalized
