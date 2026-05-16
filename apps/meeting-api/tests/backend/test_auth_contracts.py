from backend.auth_contracts import map_actor_to_auth_claims
from backend.security import Actor


def test_maps_actor_to_shared_auth_claims_without_tokens():
    result = map_actor_to_auth_claims(
        Actor(
            user_id="user_123",
            email="user@example.com",
            deployment_mode="production",
            authenticated=True,
            tenant_id="tenant_123",
            org_id="org_123",
            role="member",
            permissions=("meetings:read",),
        )
    )

    assert result == {
        "ok": True,
        "claims": {
            "provider": "meeting-api",
            "subject": "user_123",
            "email": "user@example.com",
            "tenant_id": "tenant_123",
            "roles": ["member", "authenticated"],
            "provider_claims": {
                "deployment_mode": "production",
                "org_id": "org_123",
                "permissions": ["meetings:read"],
            },
        },
    }


def test_actor_mapping_fails_closed_without_subject():
    result = map_actor_to_auth_claims(
        Actor(user_id="", email=None, deployment_mode="production", authenticated=True)
    )

    assert result == {
        "ok": False,
        "error": {"code": "AUTH_CLAIMS_INVALID", "missing": ["subject"]},
    }
