from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Literal

from fastapi import HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError

if TYPE_CHECKING:
    from backend.services.neon_auth import NeonAuthError, decode_neon_access_token as service_decode_neon_access_token
else:
    try:
        from backend.services.neon_auth import NeonAuthError, decode_neon_access_token as service_decode_neon_access_token
    except ModuleNotFoundError:  # Railway deploys the backend service from backend/ as the app root.
        from services.neon_auth import NeonAuthError, decode_neon_access_token as service_decode_neon_access_token

bearer_scheme = HTTPBearer(auto_error=False)
PBKDF2_ITERATIONS = 390000
_jwks_lock = threading.Lock()
_jwks_clients: dict[str, PyJWKClient] = {}


@dataclass(frozen=True)
class Actor:
    user_id: str
    email: str | None
    deployment_mode: str
    authenticated: bool
    tenant_id: str | None = None
    org_id: str | None = None
    role: str | None = None
    permissions: tuple[str, ...] = ()


class AuthError(HTTPException):
    def __init__(self, detail: str = "Authentication required") -> None:
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def normalize_claims(payload: dict[str, Any]) -> dict[str, Any]:
    subject = str(payload.get("sub") or "").strip()
    if not subject:
        raise AuthError("Token payload is missing subject")

    app_metadata = payload.get("app_metadata") or {}
    user_metadata = payload.get("user_metadata") or {}
    providers = app_metadata.get("providers") or []

    return {
        "sub": subject,
        "email": str(payload.get("email") or "").strip() or None,
        "org_id": str(payload.get("org_id") or payload.get("organization_id") or "").strip() or None,
        "role": str(payload.get("role") or "member").strip() or "member",
        "roles": [str(role).strip() for role in (payload.get("roles") or []) if str(role).strip()],
        "tenant_id": str(payload.get("tenant_id") or payload.get("org_id") or payload.get("organization_id") or "").strip() or None,
        "permissions": [str(permission).strip() for permission in (payload.get("permissions") or []) if str(permission).strip()],
        "providers": [str(provider) for provider in providers],
        "display_name": str(user_metadata.get("full_name") or payload.get("name") or "").strip() or None,
    }


def enforce_hosted_claims_contract(
    payload: dict[str, Any],
    *,
    allow_missing_tenant: bool = False,
    allow_missing_org: bool = False,
) -> dict[str, Any]:
    normalized = normalize_claims(payload)

    if not allow_missing_tenant and not normalized["tenant_id"]:
        raise AuthError("Token payload is missing tenant context")
    if not normalized["email"]:
        raise AuthError("Token payload is missing email")
    if not allow_missing_org and not normalized["org_id"]:
        raise AuthError("Token payload is missing organization context")

    return normalized


def require_same_tenant_or_404(
    actor_tenant_id: str | None,
    resource_tenant_id: str | None,
    *,
    deployment_mode: str,
) -> None:
    if deployment_mode.strip().lower() == "oss":
        return
    if actor_tenant_id is None or resource_tenant_id is None or actor_tenant_id != resource_tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")



def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")



def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)



def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${_b64encode(salt)}${_b64encode(digest)}"



def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, iteration_str, salt_token, digest_token = password_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iteration_str)
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            _b64decode(salt_token),
            iterations,
        )
        return hmac.compare_digest(derived, _b64decode(digest_token))
    except Exception:
        return False



def create_access_token(
    subject: str,
    *,
    secret: str,
    algorithm: str = "HS256",
    expires_minutes: int = 60,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    if algorithm != "HS256":
        raise ValueError(f"Only HS256 is supported by this token implementation, got {algorithm!r}")
    issued_at = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + timedelta(minutes=expires_minutes)).timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)

    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_token = _b64encode(payload_bytes)
    signature = hmac.new(secret.encode("utf-8"), payload_token.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_token}.{_b64encode(signature)}"



def decode_access_token(
    token: str,
    *,
    secret: str,
    algorithm: str = "HS256",
) -> dict[str, Any]:
    if algorithm != "HS256":
        raise ValueError(f"Only HS256 is supported by this token implementation, got {algorithm!r}")
    try:
        payload_token, signature_token = token.split(".", 1)
    except ValueError as exc:
        raise AuthError("Invalid or expired token") from exc

    expected_signature = hmac.new(secret.encode("utf-8"), payload_token.encode("utf-8"), hashlib.sha256).digest()
    provided_signature = _b64decode(signature_token)
    if not hmac.compare_digest(expected_signature, provided_signature):
        raise AuthError("Invalid or expired token")

    try:
        payload = json.loads(_b64decode(payload_token).decode("utf-8"))
    except Exception as exc:
        raise AuthError("Invalid or expired token") from exc

    if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
        raise AuthError("Invalid or expired token")

    return payload



def decode_neon_access_token(
    token: str,
    *,
    auth_url: str | None = None,
    issuer: str | None = None,
    audience: str | None = None,
    jwks_url: str | None = None,
) -> dict[str, Any]:
    resolved_auth_url = (auth_url or os.environ.get("NEON_AUTH_URL") or os.environ.get("NEON_AUTH_BASE_URL") or "").strip()
    try:
        return service_decode_neon_access_token(
            token,
            auth_url=resolved_auth_url,
            issuer=issuer,
            audience=audience,
            jwks_url=jwks_url,
        )
    except NeonAuthError as exc:
        raise AuthError("Invalid or expired token") from exc


def _get_jwks_client(url: str) -> PyJWKClient:
    if url not in _jwks_clients:
        with _jwks_lock:
            if url not in _jwks_clients:
                _jwks_clients[url] = PyJWKClient(url, cache_keys=True)
    return _jwks_clients[url]


def resolve_auth_provider(deployment_mode: str, issuer: str | None = None) -> str:
    configured_provider = str(os.environ.get("AUTH_PROVIDER") or "").strip().lower()
    if configured_provider:
        return configured_provider
    if deployment_mode == "hosted":
        return "neon"
    return "local"


def actor_from_credentials(
    *,
    deployment_mode: str,
    auth_required: bool,
    secret: str,
    issuer: str | None = None,
    algorithm: str = "HS256",
    credentials: HTTPAuthorizationCredentials | None,
    token_kind: Literal["app", "neon"] = "app",
) -> Actor:
    if not auth_required and deployment_mode == "oss":
        return Actor(user_id="oss-local-user", email=None, deployment_mode=deployment_mode, authenticated=False)

    if not credentials or credentials.scheme.lower() != "bearer":
        raise AuthError()

    if token_kind == "neon":
        payload = decode_neon_access_token(
            credentials.credentials,
            auth_url=(os.environ.get("NEON_AUTH_URL") or os.environ.get("NEON_AUTH_BASE_URL") or "").strip(),
            issuer=(os.environ.get("NEON_ISSUER") or "").strip() or None,
            audience=(os.environ.get("NEON_AUDIENCE") or "").strip() or None,
            jwks_url=(os.environ.get("NEON_JWKS_URL") or "").strip() or None,
        )
    else:
        payload = decode_access_token(credentials.credentials, secret=secret, algorithm=algorithm)
    normalized = (
        enforce_hosted_claims_contract(
            payload,
            allow_missing_tenant=True,
            allow_missing_org=True,
        )
        if deployment_mode == "hosted"
        else normalize_claims(payload)
    )

    return Actor(
        user_id=normalized["sub"],
        email=normalized["email"],
        tenant_id=normalized["tenant_id"],
        org_id=normalized["org_id"],
        role=normalized["role"],
        permissions=tuple(normalized["permissions"]),
        deployment_mode=deployment_mode,
        authenticated=True,
    )
