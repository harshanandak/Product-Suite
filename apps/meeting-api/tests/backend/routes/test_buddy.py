"""Per-file behavior tests for ``backend.routes.buddy``.

These exercise the buddy query route directly (bypassing FastAPI dependency
injection, as the existing regression suite does). The DB connection is a dummy
and ``answer_buddy_query`` is stubbed, so no real provider or database is used.
The key behavior under test: the route builds the real OpenAI responder when an
``openai_client`` is configured, passes it into the answering pipeline, and
returns the produced answer.
"""

import asyncio
import os
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = APP_ROOT / "backend"
for candidate in (str(APP_ROOT), str(BACKEND_DIR)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.server import app


class DummyCursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params):
        return None


class DummyConnection:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return DummyCursor()

    def commit(self):
        return None


class DummyActor:
    id = "user-1"
    name = "Ada"
    tenant_id = "tenant-1"


def _buddy_endpoint():
    route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/buddy/query"
        and "POST" in getattr(route, "methods", set())
    )
    return route.endpoint


def test_route_builds_real_responder_when_openai_client_is_configured(monkeypatch):
    endpoint = _buddy_endpoint()
    endpoint_globals = endpoint.__globals__
    captured = {}

    fake_client = object()  # truthy -> route should build a responder
    sentinel_responder = object()

    def fake_build_responder(client, model, **kwargs):
        captured["client"] = client
        captured["model"] = model
        return sentinel_responder

    async def fake_answer_buddy_query(message, *, current_context, history_context, responder=None, web_search_fn=None):
        captured["responder"] = responder
        captured["message"] = message
        return {"answer": "Grounded route answer.", "source_kind": "meeting", "tool_refs": []}

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id, "tenant_id": "tenant-1"})
    monkeypatch.setitem(endpoint_globals, "openai_client", fake_client)
    monkeypatch.setitem(endpoint_globals, "OPENAI_CHAT_MODEL", "gpt-route-model")
    monkeypatch.setitem(endpoint_globals, "build_openai_buddy_responder", fake_build_responder)
    monkeypatch.setitem(endpoint_globals, "answer_buddy_query", fake_answer_buddy_query)

    payload = asyncio.run(
        endpoint(
            "meeting-1",
            endpoint_globals["BuddyQueryRequest"](message="Summarize this"),
            actor=DummyActor(),
        )
    )

    # Responder is built from the configured client + model...
    assert captured["client"] is fake_client
    assert captured["model"] == "gpt-route-model"
    # ...and handed into the answering pipeline...
    assert captured["responder"] is sentinel_responder
    assert captured["message"] == "Summarize this"
    # ...and the produced answer is returned to the caller.
    assert payload["response"]["answer"] == "Grounded route answer."
    assert payload["invocation"]["status"] == "captured"
    assert payload["record"]["response_text"] == "Grounded route answer."


def test_route_uses_no_responder_when_openai_client_is_absent(monkeypatch):
    endpoint = _buddy_endpoint()
    endpoint_globals = endpoint.__globals__
    captured = {}

    def fail_build(*args, **kwargs):
        raise AssertionError("responder must not be built without an openai client")

    async def fake_answer_buddy_query(message, *, current_context, history_context, responder=None, web_search_fn=None):
        captured["responder"] = responder
        return {"answer": "Preview answer.", "source_kind": "meeting", "tool_refs": []}

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id, "tenant_id": "tenant-1"})
    monkeypatch.setitem(endpoint_globals, "openai_client", None)
    monkeypatch.setitem(endpoint_globals, "build_openai_buddy_responder", fail_build)
    monkeypatch.setitem(endpoint_globals, "answer_buddy_query", fake_answer_buddy_query)

    payload = asyncio.run(
        endpoint(
            "meeting-1",
            endpoint_globals["BuddyQueryRequest"](message="Summarize this"),
            actor=DummyActor(),
        )
    )

    assert captured["responder"] is None
    assert payload["response"]["answer"] == "Preview answer."
