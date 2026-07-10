import asyncio
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


def make_responder(calls, answer="Model grounded answer."):
    async def responder(context, question):
        calls.append({"context": context, "question": question})
        return answer

    return responder


def test_empty_buddy_query_is_rejected():
    with pytest.raises(ValueError):
        asyncio.run(answer_buddy_query("", current_context="anything", history_context="anything"))


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


def test_buddy_query_sends_meeting_context_and_question_to_the_model():
    calls: list[dict[str, str]] = []

    response = asyncio.run(
        answer_buddy_query(
            "What did we decide about launch?",
            current_context="We decided to launch next week.",
            history_context="",
            responder=make_responder(calls, answer="We decided to launch next week."),
        )
    )

    # The retrieved meeting context and the raw question are handed to the model.
    assert len(calls) == 1
    assert "We decided to launch next week." in calls[0]["context"]
    assert calls[0]["question"] == "What did we decide about launch?"

    # The model answer is returned verbatim (no more hardcoded preview strings).
    assert response["answer"] == "We decided to launch next week."
    assert response["source_kind"] == "meeting"
    assert response["provenance"][0]["source"] == "current_meeting"
    assert response["tool_refs"] == []
    assert response["stub"] is False


def test_buddy_query_includes_history_context_and_provenance():
    calls: list[dict[str, str]] = []

    response = asyncio.run(
        answer_buddy_query(
            "What is the current blocker?",
            current_context="Current blocker: pricing sign-off.",
            history_context="Past decision: use annual billing.",
            responder=make_responder(calls, answer="The blocker is pricing sign-off."),
        )
    )

    assert "Current blocker: pricing sign-off." in calls[0]["context"]
    assert "Past decision: use annual billing." in calls[0]["context"]
    assert response["answer"] == "The blocker is pricing sign-off."
    assert [entry["source"] for entry in response["provenance"]] == ["current_meeting", "past_meetings"]
    assert response["stub"] is False


def test_buddy_query_uses_web_context_when_meeting_context_is_weak():
    calls: list[dict[str, str]] = []
    web_calls: list[str] = []

    def fake_web_search(query: str) -> dict[str, object]:
        web_calls.append(query)
        return {"results": [{"title": "launch", "url": "https://example.com", "snippet": "external fact"}]}

    response = asyncio.run(
        answer_buddy_query(
            "What is the latest guidance?",
            current_context="",
            history_context="",
            responder=make_responder(calls, answer="Latest guidance summarized."),
            web_search_fn=fake_web_search,
        )
    )

    assert web_calls == ["What is the latest guidance?"]
    assert "external fact" in calls[0]["context"]
    assert response["answer"] == "Latest guidance summarized."
    assert response["source_kind"] == "meeting+web"
    assert response["tool_refs"][0]["tool"] == "web_search"
    assert response["provenance"][-1]["source"] == "web"
    assert response["stub"] is False


def test_buddy_query_returns_no_sufficient_context_when_retrieval_is_empty():
    calls: list[dict[str, str]] = []

    response = asyncio.run(
        answer_buddy_query(
            "What is the latest guidance?",
            current_context="",
            history_context="",
            responder=make_responder(calls),
            web_search_fn=None,
        )
    )

    # With no meeting or web context, the model is never called and we do not fabricate an answer.
    assert calls == []
    assert response["answer"] == "No sufficient context found for: What is the latest guidance?"
    assert response["source_kind"] == "meeting"
    assert response["web_search_available"] is False
    assert response["stub"] is True


def test_buddy_query_falls_back_to_preview_when_no_responder_is_configured():
    response = asyncio.run(
        answer_buddy_query(
            "What did we decide about launch?",
            current_context="We decided to launch next week.",
            history_context="",
            responder=None,
        )
    )

    assert response["answer"].startswith("[Preview] Query: What did we decide about launch?")
    assert "We decided to launch next week." in response["answer"]
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
