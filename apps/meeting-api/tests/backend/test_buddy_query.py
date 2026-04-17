import os
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.server import app
from backend.services.tool_router import answer_buddy_query, build_agent_invocation_record, build_agent_response_record


def test_empty_buddy_query_is_rejected():
    with pytest.raises(ValueError):
        answer_buddy_query("", current_context="anything", history_context="anything")


def test_whitespace_only_buddy_query_is_rejected_at_request_validation():
    buddy_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/buddy/query"
        and "POST" in getattr(route, "methods", set())
    )
    request_model = buddy_route.endpoint.__globals__["BuddyQueryRequest"]

    with pytest.raises(ValidationError):
        request_model(message="   ")


def test_buddy_query_uses_current_context_without_web_search():
    calls: list[str] = []

    def fake_web_search(query: str) -> dict[str, object]:
        calls.append(query)
        return {"results": [{"title": "web", "url": "https://example.com", "snippet": "ignored"}]}

    response = answer_buddy_query(
        "What did we decide about launch?",
        current_context="We decided to launch next week.",
        history_context="",
        web_search_fn=fake_web_search,
    )

    assert calls == []
    assert response["answer"].startswith("[Preview] Query: What did we decide about launch?")
    assert "Meeting context:\nWe decided to launch next week." in response["answer"]
    assert response["source_kind"] == "meeting"
    assert response["provenance"][0]["source"] == "current_meeting"
    assert response["tool_refs"] == []
    assert response["stub"] is True


def test_buddy_query_auto_searches_web_when_context_is_weak():
    calls: list[str] = []

    def fake_web_search(query: str) -> dict[str, object]:
        calls.append(query)
        return {"results": [{"title": "launch", "url": "https://example.com", "snippet": "external fact"}]}

    response = answer_buddy_query(
        "What is the latest guidance?",
        current_context="",
        history_context="",
        web_search_fn=fake_web_search,
    )

    assert calls == ["What is the latest guidance?"]
    assert response["answer"].startswith("[Preview] Query: What is the latest guidance?")
    assert response["source_kind"] == "meeting+web"
    assert response["tool_refs"][0]["tool"] == "web_search"
    assert response["provenance"][-1]["source"] == "web"
    assert response["stub"] is True


def test_buddy_query_can_answer_from_open_question_context_without_web_search():
    calls: list[str] = []

    def fake_web_search(query: str) -> dict[str, object]:
        calls.append(query)
        return {"results": [{"title": "ignored", "url": "https://example.com", "snippet": "ignored"}]}

    response = answer_buddy_query(
        "What is still unresolved?",
        current_context="Open questions:\n- Who will own post-launch support?",
        history_context="",
        web_search_fn=fake_web_search,
    )

    assert calls == []
    assert "Open questions:\n- Who will own post-launch support?" in response["answer"]
    assert response["source_kind"] == "meeting"


def test_buddy_query_marks_web_search_unavailable_when_no_provider_is_configured():
    response = answer_buddy_query(
        "What is the latest guidance?",
        current_context="",
        history_context="",
        web_search_fn=None,
    )

    assert response["answer"] == "[Preview] No sufficient context found for: What is the latest guidance?"
    assert response["source_kind"] == "meeting"
    assert response["web_search_available"] is False
    assert response["stub"] is True


def test_buddy_records_capture_invocation_and_response_provenance():
    invocation = build_agent_invocation_record(
        meeting_id="meeting-1",
        speaker_label="Buddy",
        trigger_text="Can you summarize?",
    )
    response = build_agent_response_record(
        meeting_id="meeting-1",
        invocation_id=invocation["id"],
        response_text="Summary.",
        source_kind="meeting",
        tool_refs=[{"tool": "current_meeting"}],
    )

    assert invocation["status"] == "captured"
    assert response["source_kind"] == "meeting"
    assert response["tool_refs"][0]["tool"] == "current_meeting"
