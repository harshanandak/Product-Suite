import pytest
from fastapi import HTTPException
from jwt.exceptions import InvalidTokenError

import backend.security as security_module
from backend.routes.auth import auth_provider_names
from backend.security import (
    AuthError,
    actor_from_credentials,
    create_access_token,
    decode_access_token,
    decode_neon_access_token,
    normalize_claims,
    require_same_tenant_or_404,
)
from fastapi.security import HTTPAuthorizationCredentials


def test_normalize_claims_handles_supabase_style_payload():
    payload = {
        "sub": "user-1",
        "email": "user@example.com",
        "role": "member",
        "tenant_id": "tenant-1",
        "app_metadata": {"providers": ["email", "google"]},
        "user_metadata": {"full_name": "Example User"},
    }

    normalized = normalize_claims(payload)

    assert normalized == {
        "sub": "user-1",
        "email": "user@example.com",
        "org_id": None,
        "role": "member",
        "roles": [],
        "tenant_id": "tenant-1",
        "permissions": [],
        "providers": ["email", "google"],
        "display_name": "Example User",
    }


def test_normalize_claims_handles_hosted_provider_payload():
    payload = {
        "sub": "user_123",
        "email": "user@example.com",
        "org_id": "org_123",
        "role": "org_admin",
        "roles": ["org_admin"],
        "permissions": ["meetings:read", "meetings:write"],
        "name": "Example User",
    }

    normalized = normalize_claims(payload)

    assert normalized == {
        "sub": "user_123",
        "email": "user@example.com",
        "org_id": "org_123",
        "role": "org_admin",
        "roles": ["org_admin"],
        "tenant_id": "org_123",
        "permissions": ["meetings:read", "meetings:write"],
        "providers": [],
        "display_name": "Example User",
    }


def test_decode_neon_access_token_falls_back_to_auth_origin_when_override_is_stale(monkeypatch):
    captured_issuers = []

    class DummySigningKey:
        key = "signing-key"

    class DummyJwksClient:
        def get_signing_key_from_jwt(self, token):
            return DummySigningKey()

    monkeypatch.setattr("backend.services.neon_auth._get_jwks_client", lambda url: DummyJwksClient())

    def fake_decode(token, signing_key, algorithms, issuer, audience, options):
        captured_issuers.append((issuer, audience))
        if issuer == "https://stale.neon.example":
            raise InvalidTokenError("issuer mismatch")
        return {"sub": "user_123", "exp": 9999999999, "iat": 1111111111, "iss": issuer, "aud": audience}

    monkeypatch.setattr("backend.services.neon_auth.jwt_decode", fake_decode)

    payload = decode_neon_access_token(
        "token-123",
        auth_url="https://project-123.neon.tech/auth",
        issuer="https://stale.neon.example",
        jwks_url="https://project-123.neon.tech/auth/.well-known/jwks.json",
    )

    assert payload["iss"] == "https://project-123.neon.tech"
    assert captured_issuers == [
        ("https://stale.neon.example", "https://project-123.neon.tech"),
        ("https://project-123.neon.tech", "https://project-123.neon.tech"),
    ]


def test_decode_neon_access_token_accepts_explicit_audience_override(monkeypatch):
    captured = {}

    class DummySigningKey:
        key = "signing-key"

    class DummyJwksClient:
        def get_signing_key_from_jwt(self, token):
            return DummySigningKey()

    monkeypatch.setattr("backend.services.neon_auth._get_jwks_client", lambda url: DummyJwksClient())

    def fake_decode(token, signing_key, algorithms, issuer, audience, options):
        captured["issuer"] = issuer
        captured["audience"] = audience
        return {"sub": "user_123", "exp": 9999999999, "iat": 1111111111, "iss": issuer, "aud": audience}

    monkeypatch.setattr("backend.services.neon_auth.jwt_decode", fake_decode)

    payload = decode_neon_access_token(
        "token-123",
        auth_url="https://project-123.neon.tech/auth",
        audience="meeting-agent",
        jwks_url="https://project-123.neon.tech/auth/.well-known/jwks.json",
    )

    assert payload["aud"] == "meeting-agent"
    assert captured == {
        "issuer": "https://project-123.neon.tech",
        "audience": "meeting-agent",
    }


def test_hosted_mode_requires_credentials():
    with pytest.raises(AuthError):
        normalize_claims({})


def test_cross_tenant_access_uses_not_found_policy():
    with pytest.raises(HTTPException) as exc:
        require_same_tenant_or_404("tenant-a", "tenant-b", deployment_mode="hosted")

    assert exc.value.status_code == 404
    assert exc.value.detail == "Meeting not found"


def test_missing_tenant_context_is_denied_in_hosted_mode():
    with pytest.raises(HTTPException) as exc:
        require_same_tenant_or_404(None, "tenant-b", deployment_mode="hosted")

    assert exc.value.status_code == 404


def test_missing_resource_tenant_is_denied_in_hosted_mode():
    with pytest.raises(HTTPException) as exc:
        require_same_tenant_or_404("tenant-a", None, deployment_mode="hosted")

    assert exc.value.status_code == 404


def test_hosted_auth_exposes_email_and_google_provider_names():
    assert auth_provider_names("neon") == ("email", "google")


def test_actor_from_credentials_propagates_tenant_id(monkeypatch):
    monkeypatch.setenv("AUTH_PROVIDER", "local")
    monkeypatch.setattr(
        "backend.security.decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user-1",
            "email": "user@example.com",
            "tenant_id": "tenant-1",
            "org_id": "tenant-1",
        },
    )
    token = "payload.signature"
    actor = actor_from_credentials(
        deployment_mode="hosted",
        auth_required=True,
        secret="secret",
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=token),
    )

    assert actor.tenant_id == "tenant-1"


def test_actor_from_credentials_uses_neon_identity_context(monkeypatch):
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)
    monkeypatch.setenv("NEON_AUTH_URL", "https://project-123.neon.tech/auth")
    captured = {}
    monkeypatch.setattr(
        "backend.security.decode_neon_access_token",
        lambda token, *, auth_url=None, issuer=None, audience=None, jwks_url=None: captured.update(
            {"token": token, "auth_url": auth_url, "issuer": issuer, "audience": audience, "jwks_url": jwks_url}
        )
        or {
            "sub": "user_123",
            "email": "user@example.com",
            "name": "Example User",
        },
    )

    actor = actor_from_credentials(
        deployment_mode="hosted",
        auth_required=True,
        secret="unused",
        issuer="https://project-123.neon.tech/auth",
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
        token_kind="neon",
    )

    assert actor.user_id == "user_123"
    assert actor.email == "user@example.com"
    assert actor.tenant_id is None
    assert actor.org_id is None
    assert actor.role == "member"
    assert actor.permissions == ()
    assert captured["auth_url"] == "https://project-123.neon.tech/auth"
    assert captured["issuer"] is None
    assert captured["audience"] is None


def test_actor_from_credentials_rejects_invalid_neon_token(monkeypatch):
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)
    monkeypatch.setattr(
        "backend.security.decode_neon_access_token",
        lambda token, *, auth_url=None, issuer=None, audience=None, jwks_url=None: (_ for _ in ()).throw(AuthError("Invalid or expired token")),
    )

    with pytest.raises(AuthError):
        actor_from_credentials(
            deployment_mode="hosted",
            auth_required=True,
            secret="unused",
            issuer="https://project-123.neon.tech/auth",
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
            token_kind="neon",
        )


def test_actor_from_credentials_defaults_to_app_token_in_hosted_mode(monkeypatch):
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)
    monkeypatch.setattr(
        "backend.security.decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user_123",
            "email": "user@example.com",
            "tenant_id": "org_123",
            "org_id": "org_123",
        },
    )

    actor = actor_from_credentials(
        deployment_mode="hosted",
        auth_required=True,
        secret="secret",
        issuer="https://project-123.neon.tech",
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
    )

    assert actor.user_id == "user_123"
    assert actor.tenant_id == "org_123"


def test_actor_from_credentials_allows_hosted_app_token_without_org_claim(monkeypatch):
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)
    monkeypatch.setattr(
        "backend.security.decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user_123",
            "email": "user@example.com",
            "tenant_id": "tenant_123",
            "role": "member",
            "permissions": ["meetings:read"],
        },
    )

    actor = actor_from_credentials(
        deployment_mode="hosted",
        auth_required=True,
        secret="secret",
        issuer="https://project-123.neon.tech",
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="token"),
    )

    assert actor.user_id == "user_123"
    assert actor.tenant_id == "tenant_123"
    assert actor.org_id is None


def test_access_token_helpers_reject_non_hs256_algorithms():
    with pytest.raises(ValueError, match="Only HS256 is supported"):
        create_access_token("user-1", secret="secret", algorithm="RS256")

    token = create_access_token("user-1", secret="secret")

    with pytest.raises(ValueError, match="Only HS256 is supported"):
        decode_access_token(token, secret="secret", algorithm="RS256")


def test_hosted_onboarding_actor_allows_missing_tenant_context(monkeypatch):
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-test")
    monkeypatch.setenv("NEON_AUTH_URL", "https://project-123.neon.tech/auth")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "meeting-audio")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key-123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret-123")
    monkeypatch.setattr(
        "backend.server.decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user_123",
            "email": "user@example.com",
            "name": "Example User",
        },
    )

    from backend.server import get_hosted_onboarding_actor

    actor = get_hosted_onboarding_actor("Bearer token")

    assert actor.id == "user_123"
    assert actor.email == "user@example.com"
    assert actor.tenant_id is None
    assert actor.org_id is None


def test_decode_neon_access_token_reuses_jwks_client(monkeypatch):
    calls = {"jwks_init": 0, "jwt_decode": 0}

    class DummySigningKey:
        def __init__(self, key):
            self.key = key

    class DummyJWKClient:
        def __init__(self, url, cache_keys=False):
            calls["jwks_init"] += 1
            self.url = url
            self.cache_keys = cache_keys

        def get_signing_key_from_jwt(self, token):
            return DummySigningKey("signing-key")

    def fake_jwt_decode(token, key, algorithms, issuer, audience, options):
        calls["jwt_decode"] += 1
        return {"sub": "user_123", "exp": 9999999999, "iat": 1}

    monkeypatch.setattr("backend.services.neon_auth._jwks_clients", {})
    monkeypatch.setattr("backend.services.neon_auth.PyJWKClient", DummyJWKClient)
    monkeypatch.setattr("backend.services.neon_auth.jwt_decode", fake_jwt_decode)

    decode_neon_access_token(
        "token-1",
        auth_url="https://project-123.neon.tech/auth",
        jwks_url="https://project-123.neon.tech/auth/.well-known/jwks.json",
    )
    decode_neon_access_token(
        "token-2",
        auth_url="https://project-123.neon.tech/auth",
        jwks_url="https://project-123.neon.tech/auth/.well-known/jwks.json",
    )

    assert calls["jwks_init"] == 1
    assert calls["jwt_decode"] == 2


def test_provision_hosted_user_from_neon_access_token_issues_app_user(monkeypatch):
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-test")
    monkeypatch.setenv("NEON_AUTH_URL", "https://project-123.neon.tech/auth")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "meeting-audio")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key-123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret-123")

    import backend.server as server_module

    monkeypatch.setattr(
        server_module,
        "decode_neon_access_token",
        lambda token, auth_url=None, issuer=None, jwks_url=None: {
            "sub": "provider-user-123",
            "email": "user@example.com",
            "name": "Example User",
            "exp": 9999999999,
            "iat": 1111111111,
            "iss": "https://project-123.neon.tech",
            "aud": "https://project-123.neon.tech",
        },
    )
    monkeypatch.setattr(server_module, "fetch_user_auth_identity", lambda provider, provider_user_id: None)
    monkeypatch.setattr(server_module, "fetch_user_by_id", lambda user_id: None)
    monkeypatch.setattr(server_module, "fetch_user_by_email", lambda email: None)

    captured_identity = {}
    monkeypatch.setattr(
        server_module,
        "upsert_user_auth_identity",
        lambda **kwargs: captured_identity.update(kwargs) or kwargs,
    )

    class FakeCursor:
        params = None

        def execute(self, query, params=None):
            self.params = params

        def fetchone(self):
            return {
                "id": self.params[0],
                "email": self.params[1],
                "name": self.params[3],
                "tenant_id": self.params[4],
            }

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class FakeConnection:
        def cursor(self):
            return FakeCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(server_module, "get_db_connection", lambda: FakeConnection())

    user = server_module.provision_hosted_user_from_neon_access_token("provider-token")

    assert user.email == "user@example.com"
    assert user.tenant_id is None
    assert captured_identity["provider"] == "neon"
    assert captured_identity["provider_user_id"] == "provider-user-123"
