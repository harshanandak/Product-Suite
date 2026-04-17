import pytest
from fastapi import HTTPException

from backend.security import (
    Actor,
    actor_from_credentials,
    decode_neon_access_token,
    normalize_claims,
    resolve_auth_provider,
)


def test_resolve_auth_provider_defaults_hosted_to_neon():
    assert resolve_auth_provider("hosted") == "neon"


def test_normalize_claims_uses_org_id_as_tenant_id():
    normalized = normalize_claims(
        {
            "sub": "user_123",
            "email": "user@example.com",
            "org_id": "org_123",
        }
    )

    assert normalized["tenant_id"] == "org_123"


def test_decode_neon_access_token_defaults_audience_to_derived_issuer(monkeypatch):
    captured = {}

    class DummySigningKey:
        key = "signing-key"

    class DummyJwksClient:
        def get_signing_key_from_jwt(self, token):
            return DummySigningKey()

    monkeypatch.setattr("backend.services.neon_auth._get_jwks_client", lambda url: DummyJwksClient())

    def fake_decode(token, signing_key, algorithms, issuer, audience, options):
        captured.update(
            {
                "token": token,
                "signing_key": signing_key,
                "algorithms": algorithms,
                "issuer": issuer,
                "audience": audience,
                "options": options,
            }
        )
        return {"sub": "user_123", "exp": 9999999999, "iat": 1111111111, "iss": issuer, "aud": audience}

    monkeypatch.setattr("backend.services.neon_auth.jwt_decode", fake_decode)

    payload = decode_neon_access_token(
        "token-123",
        auth_url="https://project-123.neon.tech/auth",
        issuer="https://project-123.neon.tech",
        jwks_url="https://project-123.neon.tech/auth/.well-known/jwks.json",
    )

    assert payload["aud"] == "https://project-123.neon.tech"
    assert captured["algorithms"] == ["EdDSA"]
    assert captured["audience"] == "https://project-123.neon.tech"
    assert captured["options"]["require"] == ["sub", "exp", "iat", "iss", "aud"]


def test_decode_neon_access_token_accepts_explicit_audience(monkeypatch):
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
        issuer="https://project-123.neon.tech",
        audience="meeting-agent",
        jwks_url="https://project-123.neon.tech/auth/.well-known/jwks.json",
    )

    assert payload["aud"] == "meeting-agent"
    assert captured == {
        "issuer": "https://project-123.neon.tech",
        "audience": "meeting-agent",
    }


def test_actor_from_credentials_rejects_hosted_claims_missing_email():
    with pytest.raises(HTTPException) as exc_info:
        actor_from_credentials(
            deployment_mode="hosted",
            auth_required=True,
            secret="secret",
            issuer="https://project-123.neon.tech",
            credentials=type("Creds", (), {"scheme": "Bearer", "credentials": "token"})(),
            token_kind="app",
        )

    assert exc_info.value.status_code == 401


def test_actor_from_credentials_allows_hosted_app_claims_missing_tenant(monkeypatch):
    monkeypatch.setattr(
        "backend.security.decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user_123",
            "email": "user@example.com",
            "role": "member",
            "permissions": ["meetings:read"],
        },
    )

    actor = actor_from_credentials(
        deployment_mode="hosted",
        auth_required=True,
        secret="secret",
        issuer="https://project-123.neon.tech/auth",
        credentials=type("Creds", (), {"scheme": "Bearer", "credentials": "token"})(),
        token_kind="app",
    )

    assert actor.user_id == "user_123"
    assert actor.tenant_id is None


def test_actor_from_credentials_returns_normalized_hosted_actor(monkeypatch):
    monkeypatch.setattr(
        "backend.security.decode_access_token",
        lambda token, *, secret, algorithm: {
            "sub": "user_123",
            "email": "user@example.com",
            "tenant_id": "org_123",
            "org_id": "org_123",
            "role": "admin",
            "permissions": ["meetings:read", "meetings:write"],
        },
    )

    actor = actor_from_credentials(
        deployment_mode="hosted",
        auth_required=True,
        secret="secret",
        issuer="https://project-123.neon.tech",
        credentials=type("Creds", (), {"scheme": "Bearer", "credentials": "token"})(),
        token_kind="app",
    )

    assert actor == Actor(
        user_id="user_123",
        email="user@example.com",
        tenant_id="org_123",
        org_id="org_123",
        role="admin",
        permissions=("meetings:read", "meetings:write"),
        deployment_mode="hosted",
        authenticated=True,
    )
