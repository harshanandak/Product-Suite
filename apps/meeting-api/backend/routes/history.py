"""History search routes for summary-first Sprint 1."""

from fastapi import APIRouter, Depends, HTTPException, status

from backend.db import get_db_engine
from backend.repositories.history import fetch_history_records
from backend.services.retrieval import build_history_search_payload
from backend.server import (
    DEFAULT_TENANT_ID,
    fetch_meeting,
    get_db_connection,
    require_authenticated_actor,
    settings,
)

router = APIRouter(prefix="/api")


@router.get("/meetings/{meeting_id}/history/search")
async def search_history(meeting_id: str, q: str = "", actor=Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if settings.is_hosted and not actor.tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant context required for history search")

    if not q.strip():
        return {"results": []}

    tenant_id = actor.tenant_id or DEFAULT_TENANT_ID
    rows = fetch_history_records(
        get_db_engine(),
        tenant_id=tenant_id,
        excluded_meeting_id=meeting_id,
        actor_user_id=actor.id,
        allowed_corpora=settings.history_retrieval_corpus,
    )
    return build_history_search_payload(
        q,
        rows,
        allowed_corpora=settings.history_retrieval_corpus,
        ranking_profile=settings.history_ranking_profile,
    )
