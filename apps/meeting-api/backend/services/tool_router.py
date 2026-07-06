"""Buddy tool routing and provenance helpers."""

from __future__ import annotations

import uuid
from typing import Callable

from backend.services.llm import BuddyResponder
from backend.services.meeting_state import compose_buddy_context
from backend.services.retrieval import is_context_insufficient


def build_agent_invocation_record(*, meeting_id: str, speaker_label: str | None, trigger_text: str) -> dict[str, object]:
    return {
        "id": str(uuid.uuid4()),
        "meeting_id": meeting_id,
        "speaker_label": speaker_label,
        "trigger_text": trigger_text,
        "status": "captured",
    }


def build_agent_response_record(
    *,
    meeting_id: str,
    invocation_id: str | None,
    response_text: str,
    source_kind: str,
    tool_refs: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "id": str(uuid.uuid4()),
        "meeting_id": meeting_id,
        "invocation_id": invocation_id,
        "response_text": response_text,
        "source_kind": source_kind,
        "tool_refs": tool_refs,
    }


async def _generate_grounded_answer(
    responder: BuddyResponder | None,
    context: str,
    question: str,
) -> tuple[str, bool]:
    """Return ``(answer, model_backed)`` for the given grounded ``context``.

    When a ``responder`` is configured and returns a non-empty answer, that
    model answer is used. Otherwise a deterministic preview fallback keeps the
    endpoint functional without a provider (e.g. when no API key is set).
    """

    if responder is not None:
        try:
            model_answer = (await responder(context, question)).strip()
        except Exception:
            # Provider timeout/rate-limit/network errors must not fail the buddy
            # request; degrade gracefully to the deterministic preview fallback.
            model_answer = ""
        if model_answer:
            return model_answer, True

    fallback = f"[Preview] Query: {question}"
    if context:
        fallback = f"{fallback}\n\n{context}"
    return fallback, False


async def answer_buddy_query(
    message: str,
    *,
    current_context: str,
    history_context: str,
    responder: BuddyResponder | None = None,
    web_search_fn: Callable[[str], dict[str, object]] | None = None,
) -> dict[str, object]:
    clean_message = message.strip()
    if not clean_message:
        raise ValueError("message is required")

    context = compose_buddy_context(current_context, history_context)
    provenance: list[dict[str, object]] = []
    tool_refs: list[dict[str, object]] = []

    if not is_context_insufficient(current_context, history_context):
        provenance.append({"source": "current_meeting", "detail": "meeting memory"})
        if history_context.strip():
            provenance.append({"source": "past_meetings", "detail": "history memory"})
        answer, model_backed = await _generate_grounded_answer(responder, context, clean_message)
        return {
            "answer": answer,
            "source_kind": "meeting",
            "tool_refs": tool_refs,
            "provenance": provenance,
            "web_search_available": web_search_fn is not None,
            "stub": not model_backed,
        }

    web_result: dict[str, object] = {}
    if web_search_fn is not None:
        web_result = web_search_fn(clean_message) or {}
        tool_refs.append({"tool": "web_search", "query": clean_message})
        provenance.append({"source": "web", "detail": "external search"})

    raw_results = web_result.get("results") if web_result else None
    if isinstance(raw_results, list):
        external_snippet = "\n".join(
            str(item.get("snippet", item)) if isinstance(item, dict) else str(item)
            for item in raw_results
        ).strip()
    else:
        external_snippet = str(raw_results or "").strip()
    grounded_sections: list[str] = []
    if context:
        grounded_sections.append(f"Meeting context:\n{context}")
    if external_snippet:
        grounded_sections.append(f"Web context:\n{external_snippet}")
    grounded_context = "\n\n".join(grounded_sections)

    if not grounded_context:
        # Retrieval is empty and no external context is available: preserve the
        # "no sufficient context" behavior instead of fabricating an answer.
        return {
            "answer": f"No sufficient context found for: {clean_message}",
            "source_kind": "meeting+web" if external_snippet else "meeting",
            "tool_refs": tool_refs,
            "provenance": [p for p in provenance if p["source"] != "web"]
            or [{"source": "current_meeting", "detail": "meeting memory"}],
            "web_search_available": web_search_fn is not None,
            "stub": True,
        }

    answer, model_backed = await _generate_grounded_answer(responder, grounded_context, clean_message)
    return {
        "answer": answer,
        "source_kind": "meeting+web" if tool_refs else "meeting",
        "tool_refs": tool_refs,
        "provenance": provenance or [{"source": "current_meeting", "detail": "meeting memory"}],
        "web_search_available": web_search_fn is not None,
        "stub": not model_backed,
    }
