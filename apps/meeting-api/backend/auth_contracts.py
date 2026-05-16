from __future__ import annotations

from typing import Any

from .security import Actor


def map_actor_to_auth_claims(actor: Actor) -> dict[str, Any]:
    if not actor.user_id:
        return _auth_claims_error(["subject"])

    roles = [actor.role] if actor.role else []
    if actor.authenticated and "authenticated" not in roles:
        roles.append("authenticated")
    claims: dict[str, Any] = {
        "provider": "meeting-api",
        "subject": actor.user_id,
    }

    if actor.email:
        claims["email"] = actor.email
    if actor.tenant_id:
        claims["tenant_id"] = actor.tenant_id
    if roles:
        claims["roles"] = roles

    claims["provider_claims"] = {
        "deployment_mode": actor.deployment_mode,
        "org_id": actor.org_id,
        "permissions": list(actor.permissions),
    }

    return {"ok": True, "claims": claims}


def _auth_claims_error(missing: list[str]) -> dict[str, Any]:
    return {
        "ok": False,
        "error": {
            "code": "AUTH_CLAIMS_INVALID",
            "missing": missing,
        },
    }
