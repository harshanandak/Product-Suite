from backend.services.corpus import normalize_allowed_history_corpora
from backend.services.retrieval import build_history_search_payload, rank_history_matches


def test_history_search_filters_to_allowed_corpora():
    records = [
        {
            "id": "chapter-1",
            "corpus": "chapter_summary",
            "summary_text": "We discussed pricing.",
            "project_name": "Alpha",
            "participants": ["Ada"],
            "tags": ["launch"],
            "meeting_title": "Alpha launch",
        },
        {
            "id": "transcript-1",
            "corpus": "transcript_segment",
            "summary_text": "pricing pricing pricing",
            "project_name": "Alpha",
            "participants": ["Ada"],
            "tags": ["launch"],
            "meeting_title": "Alpha launch",
        },
    ]

    payload = build_history_search_payload("pricing", records, allowed_corpora=["chapter_summary", "final_summary"])

    assert [result["id"] for result in payload["results"]] == ["chapter-1"]


def test_history_search_unknown_allowed_corpus_returns_empty_results():
    records = [
        {
            "id": "chapter-1",
            "corpus": "chapter_summary",
            "summary_text": "We discussed pricing.",
            "project_name": "Alpha",
            "participants": ["Ada"],
            "tags": ["launch"],
            "meeting_title": "Alpha launch",
        }
    ]

    assert normalize_allowed_history_corpora(["unknown_corpus"]) == frozenset()
    assert build_history_search_payload("pricing", records, allowed_corpora=["unknown_corpus"]) == {"results": []}


def test_history_search_boosts_project_participants_tags_and_title():
    records = [
        {
            "id": "match-1",
            "corpus": "chapter_summary",
            "summary_text": "We discussed rollout timing.",
            "project_name": "Alpha",
            "participants": ["Maya", "Noah"],
            "tags": ["pricing", "launch"],
            "meeting_title": "Alpha rollout",
        },
        {
            "id": "match-2",
            "corpus": "chapter_summary",
            "summary_text": "We discussed rollout timing pricing.",
            "project_name": "Beta",
            "participants": ["Zoe"],
            "tags": ["other"],
            "meeting_title": "Beta sync",
        },
    ]

    ranked = rank_history_matches(
        "alpha pricing rollout",
        records,
        allowed_corpora=["chapter_summary", "final_summary"],
        ranking_profile="hybrid_summary_first",
    )

    assert [result["id"] for result in ranked] == ["match-1", "match-2"]


def test_history_search_excludes_zero_score_matches():
    records = [
        {
            "id": "match-1",
            "corpus": "chapter_summary",
            "summary_text": "Discussed launch timing.",
            "project_name": "Alpha",
            "participants": ["Maya"],
            "tags": ["launch"],
            "meeting_title": "Alpha launch",
        },
        {
            "id": "match-2",
            "corpus": "final_summary",
            "summary_text": "Reviewed support rotation.",
            "project_name": "Beta",
            "participants": ["Noah"],
            "tags": ["support"],
            "meeting_title": "Beta sync",
        },
    ]

    ranked = rank_history_matches(
        "pricing",
        records,
        allowed_corpora=["chapter_summary", "final_summary"],
        ranking_profile="hybrid_summary_first",
    )

    assert ranked == []


def test_history_search_rejects_unknown_ranking_profile():
    records = [
        {
            "id": "match-1",
            "corpus": "chapter_summary",
            "summary_text": "Discussed launch timing.",
            "project_name": "Alpha",
            "participants": ["Maya"],
            "tags": ["launch"],
            "meeting_title": "Alpha launch",
        }
    ]

    try:
        rank_history_matches("launch", records, ranking_profile="unsupported")
    except ValueError as exc:
        assert str(exc) == "Unsupported ranking profile: unsupported"
    else:
        raise AssertionError("Expected unsupported ranking profile to fail")
