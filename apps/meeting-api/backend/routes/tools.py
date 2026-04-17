"""Tool routes for summary-first Sprint 1."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.server import require_authenticated_actor

router = APIRouter(prefix="/api")


class WebSearchRequest(BaseModel):
    query: str = Field(min_length=1)


@router.post("/tools/search-web")
async def search_web(data: WebSearchRequest, actor=Depends(require_authenticated_actor)):
    return {
        "results": [],
        "status": "stub",
        "message": "Web search is not yet configured.",
    }


@router.post("/tools/search-workspace")
async def search_workspace(actor=Depends(require_authenticated_actor)):
    return {"results": [], "status": "stub"}


@router.post("/tools/fetch-meeting-link")
async def fetch_meeting_link(actor=Depends(require_authenticated_actor)):
    return {"link": None, "status": "stub"}
