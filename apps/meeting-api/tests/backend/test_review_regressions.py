import asyncio
import os
import sys
from pathlib import Path

import pytest
import psycopg
from fastapi import HTTPException
from pydantic import ValidationError

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend.server import (
    HostedOnboardingOrganizationRequest,
    HostedOnboardingInvitationAcceptRequest,
    HostedOnboardingInvitationCreateRequest,
    HostedSessionExchangeRequest,
    _list_generated_records,
    app,
    create_organization_invitation,
    get_request_actor,
    require_authenticated_actor,
)


def test_summary_routes_are_registered_once():
    expected_routes = {
        ("GET", "/api/meetings/{meeting_id}/state/current"),
        ("GET", "/api/meetings/{meeting_id}/recent-lines"),
        ("GET", "/api/meetings/{meeting_id}/chapters"),
        ("GET", "/api/meetings/{meeting_id}/decisions"),
        ("GET", "/api/meetings/{meeting_id}/action-items"),
        ("GET", "/api/meetings/{meeting_id}/open-questions"),
    }
    counts = {key: 0 for key in expected_routes}

    for route in app.routes:
        for method in getattr(route, "methods", set()):
            key = (method, getattr(route, "path", ""))
            if key in counts:
                counts[key] += 1

    assert counts == {key: 1 for key in expected_routes}


def test_list_generated_records_rejects_unknown_table_names():
    with pytest.raises(ValueError):
        _list_generated_records("meeting-1", "users", tenant_id="tenant-1")


def test_tool_routes_require_authenticated_actor():
    tool_paths = {
        "/api/tools/search-web",
        "/api/tools/search-workspace",
        "/api/tools/fetch-meeting-link",
    }

    matching_routes = [route for route in app.routes if getattr(route, "path", "") in tool_paths]
    assert len(matching_routes) == 3

    for route in matching_routes:
        dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
        assert require_authenticated_actor in dependency_calls


def test_search_web_route_returns_stub_notice():
    search_web_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/tools/search-web"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = search_web_route.endpoint
    request_model = endpoint.__globals__["WebSearchRequest"]

    payload = asyncio.run(endpoint(request_model(query="pricing"), actor=object()))

    assert payload == {
        "results": [],
        "status": "stub",
        "message": "Web search is not yet configured.",
    }


def test_buddy_query_verifies_meeting_access(monkeypatch):
    calls = []
    executed = []

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

        def commit(self):
            executed.append(("commit", None))

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            executed.append((query, params))

    class DummyActor:
        id = "user-1"
        name = "Ada"
        tenant_id = "tenant-1"
        tenant_id = "tenant-1"
        tenant_id = "tenant-1"
        tenant_id = "tenant-1"

    buddy_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/buddy/query"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = buddy_route.endpoint
    endpoint_globals = endpoint.__globals__

    def fake_fetch_meeting(conn, meeting_id, actor):
        calls.append((meeting_id, actor.id))
        return {"id": meeting_id, "tenant_id": "tenant-1"}

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", fake_fetch_meeting)
    monkeypatch.setitem(
        endpoint_globals,
        "answer_buddy_query",
        lambda *args, **kwargs: {"answer": "ok", "source_kind": "meeting", "tool_refs": []},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "build_agent_invocation_record",
        lambda **kwargs: {"id": "invocation-1", "status": "captured", **kwargs},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "build_agent_response_record",
        lambda **kwargs: {"id": "response-1", **kwargs},
    )

    payload = asyncio.run(
        endpoint(
            "meeting-1",
            endpoint_globals["BuddyQueryRequest"](message="Summarize this"),
            actor=DummyActor(),
        )
    )

    assert calls == [("meeting-1", "user-1")]
    assert payload["response"]["answer"] == "ok"
    assert any("INSERT INTO agent_invocations" in item[0] for item in executed if isinstance(item[0], str))
    assert any("INSERT INTO agent_responses" in item[0] for item in executed if isinstance(item[0], str))
    assert ("commit", None) in executed


def test_buddy_query_raises_404_when_meeting_lookup_fails(monkeypatch):
    class DummyConnection:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    class DummyActor:
        id = "user-1"
        name = "Ada"
        tenant_id = "tenant-1"

    buddy_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/buddy/query"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = buddy_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", lambda conn, meeting_id, actor: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                "missing-meeting",
                endpoint_globals["BuddyQueryRequest"](message="Summarize this"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 404


def test_history_search_uses_meeting_id_to_scope_results(monkeypatch):
    executed = []

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class DummyActor:
        id = "user-1"
        name = "Ada"
        tenant_id = "tenant-1"

    history_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/history/search"
        and "GET" in getattr(route, "methods", set())
    )
    endpoint = history_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id})
    monkeypatch.setitem(
        endpoint_globals,
        "get_db_engine",
        lambda: object(),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_history_records",
        lambda engine, *, tenant_id, excluded_meeting_id, actor_user_id, allowed_corpora: executed.append(
            (tenant_id, excluded_meeting_id, actor_user_id, tuple(allowed_corpora))
        )
        or [],
    )
    monkeypatch.setitem(endpoint_globals, "build_history_search_payload", lambda query, records, **kwargs: {"results": records})
    monkeypatch.setitem(
        endpoint_globals,
        "settings",
        type("SettingsStub", (), {"is_hosted": True, "history_retrieval_corpus": ["chapter_summary", "final_summary"], "history_ranking_profile": "hybrid_summary_first"})(),
    )

    payload = asyncio.run(endpoint("meeting-1", q="pricing", actor=DummyActor()))

    assert payload == {"results": []}
    assert executed == [("tenant-1", "meeting-1", "user-1", ("chapter_summary", "final_summary"))]


def test_history_search_requires_tenant_context_in_hosted_mode(monkeypatch):
    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class DummyActor:
        id = "user-1"
        name = "Ada"
        tenant_id = None

    history_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/history/search"
        and "GET" in getattr(route, "methods", set())
    )
    endpoint = history_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id})
    monkeypatch.setitem(endpoint_globals, "settings", type("SettingsStub", (), {"is_hosted": True})())

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(endpoint("meeting-1", q="pricing", actor=DummyActor()))

    assert exc_info.value.status_code == 403


def test_create_meeting_requires_hosted_tenant_context(monkeypatch):
    meeting_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = meeting_route.endpoint
    endpoint_globals = endpoint.__globals__

    class DummyActor:
        id = "user-1"
        email = "ada@example.com"
        tenant_id = None
        org_id = None
        role = "member"
        permissions = []
        is_authenticated = True

    monkeypatch.setitem(endpoint_globals, "resolve_actor_tenant_scope", lambda actor: None)
    monkeypatch.setitem(endpoint_globals, "settings", type("SettingsStub", (), {"is_hosted": True})())
    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: pytest.fail("DB should not be touched"))

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(endpoint(endpoint_globals["MeetingCreate"](title="Hosted"), actor=DummyActor()))

    assert exc_info.value.status_code == 403


def test_generated_record_routes_use_meeting_tenant_when_actor_scope_changes(monkeypatch):
    decisions_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/decisions"
        and "GET" in getattr(route, "methods", set())
    )
    endpoint = decisions_route.endpoint
    endpoint_globals = endpoint.__globals__
    captured = {}

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class DummyActor:
        id = "user-1"
        tenant_id = "tenant-new"

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id, "tenant_id": "tenant-original"})
    monkeypatch.setitem(endpoint_globals, "resolve_actor_tenant_scope", lambda actor: "tenant-new")
    monkeypatch.setitem(
        endpoint_globals,
        "_list_generated_records",
        lambda meeting_id, table_name, *, tenant_id: captured.update(
            {"meeting_id": meeting_id, "table_name": table_name, "tenant_id": tenant_id}
        ) or [],
    )

    payload = asyncio.run(endpoint("meeting-1", actor=DummyActor()))

    assert payload == {"items": []}
    assert captured == {
        "meeting_id": "meeting-1",
        "table_name": "decisions",
        "tenant_id": "tenant-original",
    }


def test_create_organization_invitation_returns_conflict_for_duplicate_pending_invite(monkeypatch):
    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            raise psycopg.errors.UniqueViolation("duplicate pending invite")

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr("backend.server.get_db_connection", lambda: DummyConnection())

    with pytest.raises(HTTPException) as exc_info:
        create_organization_invitation(
            tenant_id="tenant-1",
            email="ada@example.com",
            role="member",
            invited_by_user_id="user-1",
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "An active invitation already exists for this email address."


def test_exchange_hosted_session_rejects_provider_override(monkeypatch):
    session_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/session/exchange"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = session_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "settings",
        type("SettingsStub", (), {"is_hosted": True, "auth_provider": "neon"})(),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "provision_hosted_user_from_provider_token",
        lambda *args, **kwargs: pytest.fail("provider exchange should not run"),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                HostedSessionExchangeRequest(
                    provider_token="provider-token",
                    provider="local",
                )
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Hosted auth provider mismatch"


def test_exchange_hosted_session_uses_configured_provider(monkeypatch):
    session_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/session/exchange"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = session_route.endpoint
    endpoint_globals = endpoint.__globals__
    captured = {}

    monkeypatch.setitem(
        endpoint_globals,
        "settings",
        type(
            "SettingsStub",
            (),
            {
                "is_hosted": True,
                "auth_provider": "neon",
                "auth_secret": "secret",
                "auth_algorithm": "HS256",
                "auth_token_ttl_minutes": 60,
            },
        )(),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "provision_hosted_user_from_provider_token",
        lambda token, *, provider: captured.update({"token": token, "provider": provider})
        or endpoint_globals["AuthUser"](
            id="user-1",
            email="user@example.com",
            tenant_id=None,
            is_authenticated=True,
        ),
    )
    monkeypatch.setitem(endpoint_globals, "create_hosted_app_token", lambda user: "app-token")

    response = asyncio.run(
        endpoint(
            HostedSessionExchangeRequest(
                provider_token="provider-token",
                provider="neon",
            )
        )
    )

    assert response.access_token == "app-token"
    assert captured == {"token": "provider-token", "provider": "neon"}


def test_provision_hosted_user_from_neon_access_token_forwards_override_metadata(monkeypatch):
    import backend.server as server_module

    captured = {}
    monkeypatch.setenv("NEON_ISSUER", "https://issuer.example.com")
    monkeypatch.setenv("NEON_JWKS_URL", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setattr(
        server_module,
        "settings",
        type("SettingsStub", (), {"neon_auth_url": "https://auth.example.com"})(),
    )
    monkeypatch.setattr(
        server_module,
        "decode_neon_access_token",
        lambda token, *, auth_url, issuer=None, jwks_url=None: captured.update(
            {
                "token": token,
                "auth_url": auth_url,
                "issuer": issuer,
                "jwks_url": jwks_url,
            }
        )
        or {"sub": "user-1"},
    )
    monkeypatch.setattr(
        server_module,
        "provision_hosted_user_from_provider_identity",
        lambda *, provider, payload: {"provider": provider, "payload": payload},
    )

    result = server_module.provision_hosted_user_from_neon_access_token("provider-token")

    assert captured == {
        "token": "provider-token",
        "auth_url": "https://auth.example.com",
        "issuer": "https://issuer.example.com",
        "jwks_url": "https://issuer.example.com/.well-known/jwks.json",
    }
    assert result == {"provider": "neon", "payload": {"sub": "user-1"}}


def test_provision_hosted_user_from_provider_identity_reuses_existing_email_without_500(monkeypatch):
    import backend.server as server_module

    executed = []
    linked = {}

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            executed.append((query, params))

        def fetchone(self):
            return {
                "id": "existing-user",
                "email": "user@example.com",
                "name": "Ada",
                "tenant_id": None,
            }

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr(
        server_module,
        "enforce_hosted_claims_contract",
        lambda payload, **kwargs: {
            "sub": "provider-user-1",
            "email": "user@example.com",
            "display_name": "Ada",
            "tenant_id": None,
            "org_id": None,
            "role": "member",
            "permissions": (),
        },
    )
    monkeypatch.setattr(server_module, "fetch_user_auth_identity", lambda provider, sub: None)
    monkeypatch.setattr(server_module, "fetch_user_by_id", lambda user_id: None)
    monkeypatch.setattr(server_module, "fetch_user_by_email", lambda email: None)
    monkeypatch.setattr(
        server_module,
        "fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "org_123", "role": "admin"} if user_id == "existing-user" else None,
    )
    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setattr(server_module, "hash_password", lambda value: "hashed-password")
    monkeypatch.setattr(
        server_module,
        "upsert_user_auth_identity",
        lambda **kwargs: linked.update(kwargs),
    )

    actor = server_module.provision_hosted_user_from_provider_identity(provider="neon", payload={"sub": "provider-user-1"})

    assert "ON CONFLICT (email) DO UPDATE" in executed[0][0]
    assert actor.id == "existing-user"
    assert actor.tenant_id == "org_123"
    assert actor.role == "admin"
    assert linked["user_id"] == "existing-user"


def test_hosted_onboarding_invitation_create_requires_valid_email():
    with pytest.raises(ValidationError):
        HostedOnboardingInvitationCreateRequest(email="abc", role="member")


def test_get_request_actor_uses_live_membership_over_stale_tenant_claim(monkeypatch):
    import backend.server as server_module

    monkeypatch.setattr(
        server_module,
        "settings",
        type(
            "SettingsStub",
            (),
            {
                "is_oss": False,
                "is_hosted": True,
                "auth_required": True,
                "auth_secret": "secret",
                "auth_algorithm": "HS256",
            },
        )(),
    )
    monkeypatch.setattr(
        server_module,
        "decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user-1",
            "email": "user@example.com",
            "tenant_id": "tenant-stale",
            "org_id": "tenant-stale",
            "role": "member",
            "permissions": ["meetings:read"],
        },
    )
    monkeypatch.setattr(
        server_module,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "name": "Ada", "tenant_id": "tenant-old"},
    )
    monkeypatch.setattr(server_module, "fetch_active_organization_membership", lambda user_id: None)

    actor = server_module.get_request_actor("Bearer token")

    assert actor.tenant_id is None
    assert actor.org_id == "tenant-stale"


def test_accept_onboarding_invitation_runs_writes_in_single_transaction(monkeypatch):
    import backend.server as server_module

    endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/invitations/accept"
        and "POST" in getattr(route, "methods", set())
    )

    actor = server_module.AuthUser(
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        permissions=[],
        is_authenticated=True,
    )
    invitation = {
        "id": "invite-1",
        "tenant_id": "tenant-1",
        "email": "user@example.com",
        "role": "member",
        "invited_by_user_id": "admin-1",
    }
    connection_calls = []

    class DummyCursor:
        def __init__(self):
            self.fetch_results = [
                None,
                {
                    "id": "user-1",
                    "email": "user@example.com",
                    "name": "Ada",
                    "tenant_id": "tenant-1",
                },
                {
                    "id": "invite-1",
                    "tenant_id": "tenant-1",
                    "status": "accepted",
                },
                {
                    "tenant_id": "tenant-1",
                    "user_id": "user-1",
                    "role": "member",
                    "status": "active",
                },
            ]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            return None

        def fetchone(self):
            return self.fetch_results.pop(0)

    class DummyConnection:
        def __enter__(self):
            connection_calls.append("enter")
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr(server_module, "resolve_hosted_tenant_context", lambda actor: None)
    monkeypatch.setattr(server_module, "find_organization_invitation_by_token", lambda token: invitation)
    monkeypatch.setattr(
        server_module,
        "fetch_tenant_by_id",
        lambda tenant_id: {"id": "tenant-1", "name": "Acme", "slug": "acme"},
    )
    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setattr(server_module, "create_hosted_app_token", lambda user: "app-token")

    response = asyncio.run(
        endpoint(
            HostedOnboardingInvitationAcceptRequest(invite_token="invite-token"),
            actor=actor,
        )
    )

    assert response["access_token"] == "app-token"
    assert connection_calls == ["enter"]


def test_create_onboarding_organization_restores_previous_tenant_on_membership_failure(monkeypatch):
    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/organizations"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__
    calls = []

    actor = endpoint_globals["AuthUser"](
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        permissions=[],
        is_authenticated=True,
    )

    monkeypatch.setitem(endpoint_globals, "resolve_hosted_tenant_context", lambda actor: None)
    monkeypatch.setitem(endpoint_globals, "fetch_tenant_by_identifier", lambda identifier: None)
    monkeypatch.setitem(endpoint_globals, "fetch_user_by_id", lambda user_id: {"id": user_id, "tenant_id": "tenant-old"})
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_tenant_record",
        lambda tenant_id, name, slug: {"id": tenant_id, "name": name, "slug": slug},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_hosted_user_record",
        lambda actor, tenant_id: {"id": actor.id, "email": actor.email, "name": actor.name, "tenant_id": tenant_id},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_organization_membership",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("membership failed")),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "restore_hosted_user_tenant",
        lambda user_id, tenant_id: calls.append(("restore", user_id, tenant_id)),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "delete_tenant_record",
        lambda tenant_id: calls.append(("delete", tenant_id)),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                HostedOnboardingOrganizationRequest(name="Acme"),
                actor=actor,
            )
        )

    assert exc_info.value.status_code == 502
    assert calls[0] == ("restore", "user-1", "tenant-old")
    assert calls[1][0] == "delete"


def test_create_onboarding_organization_preserves_http_conflicts(monkeypatch):
    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/organizations"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__
    calls = []

    actor = endpoint_globals["AuthUser"](
        id="user-1",
        email="user@example.com",
        name="Ada",
        tenant_id=None,
        permissions=[],
        is_authenticated=True,
    )

    monkeypatch.setitem(endpoint_globals, "resolve_hosted_tenant_context", lambda actor: None)
    monkeypatch.setitem(endpoint_globals, "fetch_tenant_by_identifier", lambda identifier: None)
    monkeypatch.setitem(endpoint_globals, "fetch_user_by_id", lambda user_id: {"id": user_id, "tenant_id": "tenant-old"})
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_tenant_record",
        lambda tenant_id, name, slug: (_ for _ in ()).throw(
            HTTPException(status_code=409, detail="Organization slug 'acme' is already taken.")
        ),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "restore_hosted_user_tenant",
        lambda user_id, tenant_id: calls.append(("restore", user_id, tenant_id)),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "delete_tenant_record",
        lambda tenant_id: calls.append(("delete", tenant_id)),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                HostedOnboardingOrganizationRequest(name="Acme", slug="acme"),
                actor=actor,
            )
        )

    assert exc_info.value.status_code == 409
    assert "already taken" in exc_info.value.detail
    assert calls == []


def test_recent_lines_are_scoped_only_by_meeting_id(monkeypatch):
    executed_params = []

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            executed_params.append(params)

        def fetchall(self):
            return []

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    class DummyActor:
        id = "user-1"
        name = "Ada"
        tenant_id = "tenant-1"

    recent_lines_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/meetings/{meeting_id}/recent-lines"
        and "GET" in getattr(route, "methods", set())
    )
    endpoint = recent_lines_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "fetch_meeting", lambda conn, meeting_id, actor: {"id": meeting_id})
    monkeypatch.setitem(endpoint_globals, "serialize_records", lambda rows: [])

    import backend.routes.state as state_module

    monkeypatch.setattr(state_module, "build_recent_lines_payload", lambda records: {"recent_lines": records})

    payload = asyncio.run(endpoint("meeting-1", actor=DummyActor()))

    assert payload == {"recent_lines": []}
    assert executed_params == [("meeting-1",)]


def test_get_request_actor_rejects_missing_hosted_tenant_context(monkeypatch):
    import backend.server as server_module

    settings_stub = type(
        "SettingsStub",
        (),
        {
            "is_oss": False,
            "is_hosted": True,
            "auth_required": True,
            "auth_provider": "neon",
            "auth_secret": "secret",
            "auth_algorithm": "HS256",
        },
    )()

    monkeypatch.setattr(server_module, "settings", settings_stub)
    monkeypatch.setattr(
        server_module,
        "decode_access_token",
        lambda token, *, secret, algorithm: {"sub": "user-1"},
    )
    monkeypatch.setattr(
        server_module,
        "fetch_user_by_id",
        lambda user_id: {"id": "user-1", "email": "user@example.com", "name": "Ada", "tenant_id": None},
    )

    with pytest.raises(HTTPException) as exc_info:
        get_request_actor("Bearer token")

    assert exc_info.value.status_code == 401


def test_fetch_meeting_uses_settings_deployment_mode_for_cross_tenant_guard(monkeypatch):
    import backend.server as server_module

    monkeypatch.delenv("DEPLOYMENT_MODE", raising=False)
    monkeypatch.setattr(
        server_module,
        "settings",
        type("SettingsStub", (), {"deployment_mode": "hosted"})(),
    )

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            return None

        def fetchone(self):
            return {"id": "meeting-1", "tenant_id": "tenant-b", "owner_user_id": "user-1"}

    class DummyConnection:
        def cursor(self):
            return DummyCursor()

    actor = type("Actor", (), {"id": "user-1", "tenant_id": "tenant-a"})()

    with pytest.raises(HTTPException) as exc_info:
        server_module.fetch_meeting(DummyConnection(), "meeting-1", actor)

    assert exc_info.value.status_code == 404


def test_onboarding_state_reports_missing_org_context(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/state"
        and "GET" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)
    monkeypatch.setitem(endpoint_globals, "fetch_tenant_by_id", lambda tenant_id: None)
    monkeypatch.setitem(
        endpoint_globals,
        "settings",
        type("SettingsStub", (), {"is_hosted": True, "onboarding_required": True})(),
    )

    payload = asyncio.run(endpoint(actor=DummyActor()))

    assert payload == {
        "needs_onboarding": True,
        "organization": None,
        "requires_session_refresh": False,
        "message": None,
    }


def test_onboarding_state_requires_local_user_record(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/state"
        and "GET" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(endpoint_globals, "fetch_user_by_id", lambda user_id: None)
    monkeypatch.setitem(
        endpoint_globals,
        "settings",
        type("SettingsStub", (), {"is_hosted": True, "onboarding_required": True})(),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(endpoint(actor=DummyActor()))

    assert exc_info.value.status_code == 401


def test_onboarding_state_uses_internal_membership_without_session_refresh(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/state"
        and "GET" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "org_123", "role": "admin", "status": "active"},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_tenant_by_id",
        lambda tenant_id: {"id": tenant_id, "name": "Acme", "slug": "acme"} if tenant_id == "org_123" else None,
    )
    monkeypatch.setitem(
        endpoint_globals,
        "settings",
        type("SettingsStub", (), {"is_hosted": True, "onboarding_required": True})(),
    )

    payload = asyncio.run(endpoint(actor=DummyActor()))

    assert payload["needs_onboarding"] is False
    assert payload["requires_session_refresh"] is False
    assert payload["message"] is None
    assert payload["organization"] == {"id": "org_123", "name": "Acme", "slug": "acme"}


def test_create_organization_persists_tenant_and_assigns_user(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/organizations"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)
    monkeypatch.setitem(endpoint_globals, "fetch_tenant_by_identifier", lambda identifier: None)
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_tenant_record",
        lambda tenant_id, name, slug: {"id": tenant_id, "name": name, "slug": slug},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_hosted_user_record",
        lambda actor, tenant_id: {"id": actor.id, "email": actor.email, "name": actor.name, "tenant_id": tenant_id},
    )
    membership_calls = []
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_organization_membership",
        lambda **kwargs: membership_calls.append(kwargs) or kwargs,
    )
    monkeypatch.setitem(endpoint_globals, "create_hosted_app_token", lambda user: "app-token-123")

    payload = asyncio.run(
        endpoint(
            endpoint_globals["HostedOnboardingOrganizationRequest"](name="Acme", slug="acme"),
            actor=DummyActor(),
        )
    )

    assert payload["organization"]["name"] == "Acme"
    assert payload["organization"]["slug"] == "acme"
    assert payload["user"].tenant_id == payload["organization"]["id"]
    assert payload["user"].org_id == payload["organization"]["id"]
    assert payload["access_token"] == "app-token-123"
    assert payload["requires_session_refresh"] is False
    assert membership_calls == [
        {
            "tenant_id": payload["organization"]["id"],
            "user_id": "user-1",
            "role": "admin",
            "status": "active",
            "invited_by_user_id": "user-1",
        }
    ]


def test_create_organization_rejects_slug_collision_before_local_side_effects(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    calls = []

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/organizations"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)
    monkeypatch.setitem(endpoint_globals, "fetch_tenant_by_identifier", lambda identifier: {"id": "org_existing", "slug": identifier})
    monkeypatch.setitem(endpoint_globals, "upsert_tenant_record", lambda *args, **kwargs: calls.append(("upsert_tenant_record", args, kwargs)))
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_organization_membership",
        lambda **kwargs: calls.append(("upsert_organization_membership", kwargs)),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingOrganizationRequest"](name="Acme", slug="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 409
    assert "already taken" in exc_info.value.detail
    assert calls == []


def test_create_organization_logs_internal_org_failure(monkeypatch, caplog):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/organizations"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)
    monkeypatch.setitem(endpoint_globals, "fetch_tenant_by_identifier", lambda identifier: None)
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_tenant_record",
        lambda tenant_id, name, slug: (_ for _ in ()).throw(RuntimeError("db write failed")),
    )
    monkeypatch.setitem(endpoint_globals, "delete_tenant_record", lambda tenant_id: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingOrganizationRequest"](name="Acme", slug="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 502
    assert any("Internal organization provisioning failed" in record.getMessage() for record in caplog.records)


def test_create_organization_rolls_back_internal_tenant_when_membership_creation_fails(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/organizations"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)
    monkeypatch.setitem(endpoint_globals, "fetch_tenant_by_identifier", lambda identifier: None)
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_tenant_record",
        lambda tenant_id, name, slug: {"id": tenant_id, "name": name, "slug": slug},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_hosted_user_record",
        lambda actor, tenant_id: {"id": actor.id, "email": actor.email, "name": actor.name, "tenant_id": tenant_id},
    )
    rollback_calls = []
    monkeypatch.setitem(
        endpoint_globals,
        "upsert_organization_membership",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("membership failed")),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "restore_hosted_user_tenant",
        lambda user_id, tenant_id: rollback_calls.append(("restore", user_id, tenant_id)),
    )
    monkeypatch.setitem(
        endpoint_globals,
        "delete_tenant_record",
        lambda tenant_id: rollback_calls.append(("delete", tenant_id)),
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                data=HostedOnboardingOrganizationRequest(name="Acme", slug="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 502
    assert rollback_calls[0] == ("restore", "user-1", None)
    assert rollback_calls[1][0] == "delete"


def test_upsert_tenant_record_generates_slug_when_missing(monkeypatch):
    import backend.server as server_module

    executed = []

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            executed.append((" ".join(str(query).split()), params))

        def fetchone(self):
            query, params = executed[-1]
            return {
                "id": params[0],
                "slug": params[1],
                "name": params[2],
                "created_at": "2026-04-05T00:00:00+00:00",
                "updated_at": "2026-04-05T00:00:00+00:00",
            }

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())

    record = server_module.upsert_tenant_record("org_12345678", "Acme Team", None)

    assert record["slug"] == "acme-team-12345678"


def test_upsert_tenant_record_rejects_explicit_slug_collision(monkeypatch):
    import backend.server as server_module

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            raise server_module.psycopg.errors.UniqueViolation("duplicate tenant slug")

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())

    with pytest.raises(HTTPException) as exc_info:
        server_module.upsert_tenant_record("org_999", "Acme Team", "acme")

    assert exc_info.value.status_code == 409
    assert "already taken" in exc_info.value.detail


def test_accept_invite_assigns_existing_tenant(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/invitations/accept"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "find_organization_invitation_by_token",
        lambda token: {"id": "inv_123", "email": "user@example.com", "tenant_id": "org_123", "role": "member"},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_tenant_by_id",
        lambda tenant_id: {"id": tenant_id, "name": "Acme", "slug": "acme"} if tenant_id == "org_123" else None,
    )

    class DummyCursor:
        def __init__(self):
            self.fetch_results = [
                None,
                {"id": "user-1", "email": "user@example.com", "name": "Ada", "tenant_id": "org_123"},
                {"id": "inv_123", "accepted_by_user_id": "user-1", "status": "accepted"},
                {"tenant_id": "org_123", "user_id": "user-1", "role": "member", "status": "active"},
            ]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            return None

        def fetchone(self):
            return self.fetch_results.pop(0)

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "create_hosted_app_token", lambda user: "refreshed-token-123")

    payload = asyncio.run(
        endpoint(
            endpoint_globals["HostedOnboardingInvitationAcceptRequest"](invite_token="acme"),
            actor=DummyActor(),
        )
    )

    assert payload["organization"] == {"id": "org_123", "name": "Acme", "slug": "acme"}
    assert payload["user"].tenant_id == "org_123"
    assert payload["access_token"] == "refreshed-token-123"
    assert payload["requires_session_refresh"] is False


def test_create_invite_persists_internal_invitation_for_admin(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "owner@example.com"
        name = "Ada"
        tenant_id = "org_123"
        role = "admin"
        is_authenticated = True

    invite_route = next(
        route
        for route in app.routes
        if getattr(route, "path", None) == "/api/auth/onboarding/invitations"
        and getattr(route, "methods", None) == {"POST"}
    )
    endpoint = invite_route.endpoint
    endpoint_globals = endpoint.__globals__
    monkeypatch.setitem(endpoint_globals, "settings", type("SettingsStub", (), {"is_hosted": True})())

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "org_123", "role": "admin"} if user_id == "user-1" else None,
    )
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_tenant_by_id",
        lambda tenant_id: {"id": tenant_id, "name": "Acme", "slug": "acme"} if tenant_id == "org_123" else None,
    )
    invite_calls = []
    monkeypatch.setitem(
        endpoint_globals,
        "create_organization_invitation",
        lambda **kwargs: invite_calls.append(kwargs)
        or {
            "id": "invite-1",
            "email": kwargs["email"],
            "role": kwargs["role"],
            "invite_token": "invite-token-123",
            "expires_at": "2026-04-15T00:00:00+00:00",
        },
    )

    payload = asyncio.run(
        endpoint(
            endpoint_globals["HostedOnboardingInvitationCreateRequest"](
                email="new-user@example.com",
                role="member",
            ),
            actor=DummyActor(),
        )
    )

    assert payload["organization"] == {"id": "org_123", "name": "Acme", "slug": "acme"}
    assert payload["invitation"]["id"] == "invite-1"
    assert payload["invitation"]["invite_token"] == "invite-token-123"
    assert invite_calls == [
        {
            "tenant_id": "org_123",
            "email": "new-user@example.com",
            "role": "member",
            "invited_by_user_id": "user-1",
        }
    ]


def test_create_invite_rejects_non_admin_members(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "member@example.com"
        name = "Ada"
        tenant_id = "org_123"
        role = "member"
        is_authenticated = True

    invite_route = next(
        route
        for route in app.routes
        if getattr(route, "path", None) == "/api/auth/onboarding/invitations"
        and getattr(route, "methods", None) == {"POST"}
    )
    endpoint = invite_route.endpoint
    endpoint_globals = endpoint.__globals__
    monkeypatch.setitem(endpoint_globals, "settings", type("SettingsStub", (), {"is_hosted": True})())

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_active_organization_membership",
        lambda user_id: {"tenant_id": "org_123", "role": "member"} if user_id == "user-1" else None,
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingInvitationCreateRequest"](
                    email="new-user@example.com",
                    role="member",
                ),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Only organization admins can send invites"


def test_create_invite_requires_active_membership_even_with_admin_claims(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "admin@example.com"
        name = "Ada"
        tenant_id = "org_123"
        role = "admin"
        is_authenticated = True

    invite_route = next(
        route
        for route in app.routes
        if getattr(route, "path", None) == "/api/auth/onboarding/invitations"
        and getattr(route, "methods", None) == {"POST"}
    )
    endpoint = invite_route.endpoint
    endpoint_globals = endpoint.__globals__
    monkeypatch.setitem(endpoint_globals, "settings", type("SettingsStub", (), {"is_hosted": True})())
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingInvitationCreateRequest"](
                    email="new-user@example.com",
                    role="member",
                ),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Active organization membership is required"


def test_accept_invite_logs_internal_invitation_failure(monkeypatch, caplog):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/invitations/accept"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "find_organization_invitation_by_token",
        lambda token: {"id": "inv_123", "email": "user@example.com", "tenant_id": "org_123", "role": "member"},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_tenant_by_id",
        lambda tenant_id: {"id": tenant_id, "name": "Acme", "slug": "acme"},
    )

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            if "INSERT INTO users" in query or "UPDATE users" in query:
                raise RuntimeError("db write failed")

        def fetchone(self):
            return None

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingInvitationAcceptRequest"](invite_token="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 502
    assert any("invitation_id=inv_123" in record.getMessage() and "tenant_id=org_123" in record.getMessage() for record in caplog.records)


def test_accept_invite_rejects_already_accepted_invitation(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/invitations/accept"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "find_organization_invitation_by_token",
        lambda token: {"id": "inv_123", "email": "user@example.com", "tenant_id": "org_123", "role": "member"},
    )
    monkeypatch.setitem(
        endpoint_globals,
        "fetch_tenant_by_id",
        lambda tenant_id: {"id": tenant_id, "name": "Acme", "slug": "acme"},
    )
    class DummyCursor:
        def __init__(self):
            self.fetch_results = [
                None,
                {"id": "user-1", "email": "user@example.com", "name": "Ada", "tenant_id": "org_123"},
                None,
            ]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params):
            return None

        def fetchone(self):
            return self.fetch_results.pop(0)

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingInvitationAcceptRequest"](invite_token="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Invitation already accepted"


def test_accept_invite_rejects_email_mismatch(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/invitations/accept"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": "user@example.com", "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)
    monkeypatch.setitem(
        endpoint_globals,
        "find_organization_invitation_by_token",
        lambda token: {"id": "inv_123", "email": "different@example.com", "tenant_id": "org_123", "role": "member"},
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingInvitationAcceptRequest"](invite_token="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 403


def test_accept_invite_rejects_targeted_invitation_when_actor_has_no_email(monkeypatch):
    class DummyActor:
        id = "user-1"
        email = None
        name = "Ada"
        tenant_id = None
        org_id = None
        is_authenticated = True

    onboarding_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/invitations/accept"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = onboarding_route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(
        endpoint_globals,
        "fetch_user_by_id",
        lambda user_id: {"id": user_id, "email": None, "tenant_id": None, "name": "Ada"},
    )
    monkeypatch.setitem(endpoint_globals, "fetch_active_organization_membership", lambda user_id: None)
    monkeypatch.setitem(
        endpoint_globals,
        "find_organization_invitation_by_token",
        lambda token: {"id": "inv_123", "email": "user@example.com", "tenant_id": "org_123", "role": "member"},
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingInvitationAcceptRequest"](invite_token="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 403


def test_onboarding_mutations_reject_existing_tenant_context():
    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = "tenant-123"
        org_id = "tenant-123"
        is_authenticated = True

    create_route = next(
        route
        for route in app.routes
        if getattr(route, "path", "") == "/api/auth/onboarding/organizations"
        and "POST" in getattr(route, "methods", set())
    )
    endpoint = create_route.endpoint
    endpoint_globals = endpoint.__globals__

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            endpoint(
                endpoint_globals["HostedOnboardingOrganizationRequest"](name="Acme", slug="acme"),
                actor=DummyActor(),
            )
        )

    assert exc_info.value.status_code == 409




def test_create_hosted_app_token_uses_configured_ttl(monkeypatch):
    import backend.server as server_module

    captured = {}

    monkeypatch.setattr(
        server_module,
        "create_access_token",
        lambda **kwargs: captured.update(kwargs) or "token_123",
    )
    monkeypatch.setattr(
        server_module,
        "settings",
        type(
            "SettingsStub",
            (),
            {
                "auth_secret": "secret",
                "auth_algorithm": "HS256",
                "auth_token_ttl_minutes": 720,
            },
        )(),
    )

    token = server_module.create_hosted_app_token(
        server_module.AuthUser(
            id="user_123",
            email="user@example.com",
            tenant_id="org_123",
            org_id="org_123",
            role="admin",
            permissions=("meetings:read",),
            is_authenticated=True,
        )
    )

    assert token == "token_123"
    assert captured["expires_minutes"] == 720


def test_create_meeting_persists_hosted_actor_tenant_context(monkeypatch):
    executed = []

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params=None):
            executed.append((query, params))

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = "org_123"

    route = next(
        current_route
        for current_route in app.routes
        if getattr(current_route, "path", "") == "/api/meetings"
        and "POST" in getattr(current_route, "methods", set())
    )
    endpoint = route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())

    payload = asyncio.run(
        endpoint(endpoint_globals["MeetingCreate"](title="Hosted planning", engine="whisper"), actor=DummyActor())
    )

    assert payload.title == "Hosted planning"
    assert any("INSERT INTO meetings" in query for query, _ in executed)
    insert_params = next(params for query, params in executed if "INSERT INTO meetings" in query)
    assert insert_params[2] == "org_123"


def test_list_meetings_reuses_authenticated_actor_identity_in_hosted_mode(monkeypatch):
    executed = []

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params=None):
            executed.append((query, params))

        def fetchall(self):
            return []

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    class DummyActor:
        id = "user-1"
        email = "user@example.com"
        name = "Ada"
        tenant_id = "org_123"

    route = next(
        current_route
        for current_route in app.routes
        if getattr(current_route, "path", "") == "/api/meetings"
        and "GET" in getattr(current_route, "methods", set())
    )
    endpoint = route.endpoint
    endpoint_globals = endpoint.__globals__

    monkeypatch.setitem(endpoint_globals, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setitem(endpoint_globals, "serialize_records", lambda rows: rows)

    payload = asyncio.run(endpoint(actor=DummyActor()))

    assert payload == []
    assert executed == [
        (
            executed[0][0],
            ("user-1",),
        )
    ]
    assert "FROM meetings" in executed[0][0]


def test_get_request_actor_uses_hosted_org_claim_for_tenant_context(monkeypatch):
    import backend.server as server_module

    settings_stub = type(
        "SettingsStub",
        (),
        {
            "is_oss": False,
            "is_hosted": True,
            "auth_required": True,
            "auth_provider": "neon",
            "auth_secret": "secret",
            "auth_algorithm": "HS256",
        },
    )()

    monkeypatch.setattr(server_module, "settings", settings_stub)
    monkeypatch.setattr(
        server_module,
        "decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user-1",
            "email": "user@example.com",
            "org_id": "org-123",
            "role": "org_admin",
            "permissions": ["meetings:read"],
        },
    )
    monkeypatch.setattr(
        server_module,
        "fetch_user_by_id",
        lambda user_id: {"id": "user-1", "email": "user@example.com", "name": "Ada", "tenant_id": None},
    )
    monkeypatch.setattr(server_module, "fetch_active_organization_membership", lambda user_id: None)

    actor = get_request_actor("Bearer token")

    assert actor.tenant_id is None
    assert actor.org_id == "org-123"
    assert actor.role == "org_admin"


def test_get_request_actor_allows_hosted_app_tokens_without_org_claim(monkeypatch):
    import backend.server as server_module

    settings_stub = type(
        "SettingsStub",
        (),
        {
            "is_oss": False,
            "is_hosted": True,
            "auth_required": True,
            "auth_provider": "neon",
            "auth_secret": "secret",
            "auth_algorithm": "HS256",
        },
    )()

    monkeypatch.setattr(server_module, "settings", settings_stub)
    monkeypatch.setattr(
        server_module,
        "decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user-1",
            "email": "user@example.com",
            "tenant_id": "tenant-123",
            "role": "member",
            "permissions": ["meetings:read"],
        },
    )
    monkeypatch.setattr(
        server_module,
        "fetch_user_by_id",
        lambda user_id: {"id": "user-1", "email": "user@example.com", "name": "Ada", "tenant_id": None},
    )
    monkeypatch.setattr(server_module, "fetch_active_organization_membership", lambda user_id: None)

    actor = get_request_actor("Bearer token")

    assert actor.tenant_id is None
    assert actor.org_id is None


def test_login_rejects_hosted_user_without_tenant_assignment(monkeypatch):
    import backend.server as server_module

    settings_stub = type(
        "SettingsStub",
        (),
        {
            "is_oss": False,
            "is_hosted": True,
            "auth_required": True,
        },
    )()

    monkeypatch.setattr(server_module, "settings", settings_stub)
    monkeypatch.setattr(
        server_module,
        "fetch_user_by_email",
        lambda email: {
            "id": "user-1",
            "email": email,
            "name": "Ada",
            "password_hash": "stored",
            "tenant_id": None,
        },
    )
    monkeypatch.setattr(server_module, "verify_password", lambda password, password_hash: True)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server_module.login(server_module.AuthLoginRequest(email="user@example.com", password="secret")))

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Tenant assignment is required"


def test_register_rejects_hosted_without_tenant_assignment(monkeypatch):
    import backend.server as server_module

    settings_stub = type(
        "SettingsStub",
        (),
        {
            "is_oss": False,
            "is_hosted": True,
            "auth_required": True,
        },
    )()

    monkeypatch.setattr(server_module, "settings", settings_stub)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            server_module.register(
                server_module.AuthRegisterRequest(
                    email="user@example.com",
                    password="secret",
                    name="Ada",
                )
            )
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Tenant assignment is required"


def test_register_allows_oss_local_registration(monkeypatch):
    import backend.server as server_module

    executed = []

    class DummyCursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, query, params=None):
            executed.append((query, params))

    class DummyConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return DummyCursor()

    settings_stub = type(
        "SettingsStub",
        (),
        {
            "is_oss": True,
            "is_hosted": False,
            "auth_required": False,
        },
    )()

    monkeypatch.setattr(server_module, "settings", settings_stub)
    monkeypatch.setattr(server_module, "fetch_user_by_email", lambda email: None)
    monkeypatch.setattr(server_module, "get_db_connection", lambda: DummyConnection())
    monkeypatch.setattr(server_module, "hash_password", lambda value: "hashed-password")
    monkeypatch.setattr(server_module, "create_token_for_user", lambda user: "app-token")

    result = asyncio.run(
        server_module.register(
            server_module.AuthRegisterRequest(
                email="user@example.com",
                password="secret123",
                name="Ada",
            )
        )
    )

    assert result.access_token == "app-token"
    assert result.user.email == "user@example.com"
    assert result.user.tenant_id == server_module.DEFAULT_TENANT_ID
    assert executed


def test_server_adds_project_root_for_backend_package_imports(monkeypatch):
    import backend.server as server_module

    filtered_path = [entry for entry in sys.path if entry != str(REPO_ROOT)]
    monkeypatch.setattr(sys, "path", filtered_path.copy())

    server_module.ensure_backend_package_imports()

    assert str(REPO_ROOT) in sys.path
