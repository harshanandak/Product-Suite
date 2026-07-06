"""Per-file behavior tests for ``backend.services.tool_router``.

Focus: ``answer_buddy_query`` routing behavior with an injected responder.
  * grounded-answer path: sufficient meeting context calls the responder and
    returns the model's text with ``stub`` False.
  * empty-context path: no meeting or web context returns the deterministic
    "No sufficient context..." message and NEVER calls the responder.
The responder is a local async stub, so no real LLM/OpenAI call is made.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = APP_ROOT / "backend"
for candidate in (str(APP_ROOT), str(BACKEND_DIR)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.services.tool_router import (
    answer_buddy_query,
    build_agent_invocation_record,
    build_agent_response_record,
)


def make_responder(calls, answer="Grounded model answer."):
    async def responder(context, question):
        calls.append({"context": context, "question": question})
        return answer

    return responder


def test_grounded_answer_path_calls_responder_and_returns_model_text():
    calls = []

    response = asyncio.run(
        answer_buddy_query(
            "What did we decide about launch?",
            current_context="We decided to ship on Friday.",
            history_context="",
            responder=make_responder(calls, answer="We decided to ship on Friday."),
        )
    )

    # Responder is invoked exactly once with the grounded context and question.
    assert len(calls) == 1
    assert "We decided to ship on Friday." in calls[0]["context"]
    assert calls[0]["question"] == "What did we decide about launch?"

    # The model answer is returned verbatim and marked model-backed (not a stub).
    assert response["answer"] == "We decided to ship on Friday."
    assert response["source_kind"] == "meeting"
    assert response["stub"] is False
    assert response["provenance"][0]["source"] == "current_meeting"
    assert response["tool_refs"] == []


def test_empty_context_path_returns_no_sufficient_context_and_skips_responder():
    calls = []

    response = asyncio.run(
        answer_buddy_query(
            "What is the latest guidance?",
            current_context="",
            history_context="",
            responder=make_responder(calls),
            web_search_fn=None,
        )
    )

    # With no meeting/web context the responder is never called and we do not
    # fabricate an answer.
    assert calls == []
    assert response["answer"] == "No sufficient context found for: What is the latest guidance?"
    assert response["source_kind"] == "meeting"
    assert response["stub"] is True
    assert response["web_search_available"] is False


def test_blank_message_is_rejected_before_any_responder_call():
    calls = []

    with pytest.raises(ValueError):
        asyncio.run(
            answer_buddy_query(
                "   ",
                current_context="We decided to ship on Friday.",
                history_context="",
                responder=make_responder(calls),
            )
        )

    assert calls == []


def test_no_responder_falls_back_to_preview_without_a_provider():
    response = asyncio.run(
        answer_buddy_query(
            "What did we decide about launch?",
            current_context="We decided to ship on Friday.",
            history_context="",
            responder=None,
        )
    )

    assert response["answer"].startswith("[Preview] Query: What did we decide about launch?")
    assert "We decided to ship on Friday." in response["answer"]
    assert response["stub"] is True


def test_agent_records_capture_invocation_and_response_provenance():
    invocation = build_agent_invocation_record(
        meeting_id="meeting-1",
        speaker_label="Ada",
        trigger_text="Can you summarize?",
    )
    assert invocation["status"] == "captured"
    assert invocation["meeting_id"] == "meeting-1"
    assert invocation["speaker_label"] == "Ada"
    assert invocation["id"]

    response = build_agent_response_record(
        meeting_id="meeting-1",
        invocation_id=invocation["id"],
        response_text="Summary.",
        source_kind="meeting",
        tool_refs=[{"tool": "current_meeting"}],
    )
    assert response["invocation_id"] == invocation["id"]
    assert response["source_kind"] == "meeting"
    assert response["tool_refs"][0]["tool"] == "current_meeting"
    assert response["id"] != invocation["id"]
