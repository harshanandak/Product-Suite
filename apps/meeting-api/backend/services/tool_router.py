"""Buddy tool routing and provenance helpers."""

from __future__ import annotations

import uuid
from typing import Callable

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


def answer_buddy_query(
    message: str,
    *,
    current_context: str,
    history_context: str,
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
        answer = f"[Preview] Query: {clean_message}"
        if context:
            answer = f"{answer}\n\nMeeting context:\n{context}"
        return {
            "answer": answer,
            "source_kind": "meeting",
            "tool_refs": tool_refs,
            "provenance": provenance,
            "web_search_available": web_search_fn is not None,
            "stub": True,
        }

    web_result: dict[str, object] = {}
    if web_search_fn is not None:
        web_result = web_search_fn(clean_message) or {}
        tool_refs.append({"tool": "web_search", "query": clean_message})
        provenance.append({"source": "web", "detail": "external search"})

    if web_search_fn is None:
        answer = f"[Preview] No sufficient context found for: {clean_message}"
    else:
        external_snippet = str(web_result.get("results", "")).strip()
        answer_sections = []
        if context:
            answer_sections.append(f"Meeting context:\n{context}")
        if external_snippet:
            answer_sections.append(f"Web context:\n{external_snippet}")
        answer = f"[Preview] Query: {clean_message}"
        if answer_sections:
            answer = f"{answer}\n\n" + "\n\n".join(answer_sections)
    return {
        "answer": answer,
        "source_kind": "meeting+web" if tool_refs else "meeting",
        "tool_refs": tool_refs,
        "provenance": provenance or [{"source": "current_meeting", "detail": "meeting memory"}],
        "web_search_available": web_search_fn is not None,
        "stub": True,
    }
