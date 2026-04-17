"""Buddy query routes for summary-first Sprint 1."""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.server import DEFAULT_TENANT_ID, fetch_meeting, get_db_connection, require_authenticated_actor
from backend.services.tool_router import answer_buddy_query, build_agent_invocation_record, build_agent_response_record

router = APIRouter(prefix="/api")


class BuddyQueryRequest(BaseModel):
    message: str = Field(min_length=1)
    current_context: str = ""
    history_context: str = ""

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("message must not be empty")
        return trimmed


@router.post("/meetings/{meeting_id}/buddy/query")
async def query_buddy(meeting_id: str, data: BuddyQueryRequest, actor=Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")

        invocation = build_agent_invocation_record(
            meeting_id=meeting_id,
            speaker_label=getattr(actor, "name", None),
            trigger_text=data.message,
        )
        response = answer_buddy_query(
            data.message,
            current_context=data.current_context,
            history_context=data.history_context,
            web_search_fn=None,
        )
        response_record = build_agent_response_record(
            meeting_id=meeting_id,
            invocation_id=invocation["id"],
            response_text=response["answer"],
            source_kind=response["source_kind"],
            tool_refs=response["tool_refs"],
        )

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO agent_invocations (id, tenant_id, meeting_id, speaker_label, trigger_text, status)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    invocation["id"],
                    meeting.get("tenant_id") or DEFAULT_TENANT_ID,
                    meeting_id,
                    invocation["speaker_label"],
                    invocation["trigger_text"],
                    invocation["status"],
                ),
            )
            cur.execute(
                """
                INSERT INTO agent_responses (id, tenant_id, meeting_id, invocation_id, response_text, source_kind, tool_refs)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    response_record["id"],
                    meeting.get("tenant_id") or DEFAULT_TENANT_ID,
                    meeting_id,
                    response_record["invocation_id"],
                    response_record["response_text"],
                    response_record["source_kind"],
                    json.dumps(response_record["tool_refs"]),
                ),
            )
        conn.commit()
    return {"invocation": invocation, "response": response, "record": response_record}
