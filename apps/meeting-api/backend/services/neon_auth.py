from __future__ import annotations

import threading
from urllib.parse import urlparse

from jwt import PyJWKClient, decode as jwt_decode
from jwt.exceptions import InvalidTokenError, PyJWKClientError


class NeonAuthError(Exception):
    pass


_jwks_lock = threading.Lock()
_jwks_clients: dict[str, PyJWKClient] = {}


def neon_auth_origin(auth_url: str) -> str:
    parsed = urlparse((auth_url or "").strip())
    if not parsed.scheme or not parsed.netloc:
        raise NeonAuthError("Neon Auth URL is not configured")
    return f"{parsed.scheme}://{parsed.netloc}"


def neon_jwks_url(auth_url: str) -> str:
    return f"{auth_url.rstrip('/')}/.well-known/jwks.json"


def _get_jwks_client(url: str) -> PyJWKClient:
    if url not in _jwks_clients:
        with _jwks_lock:
            if url not in _jwks_clients:
                _jwks_clients[url] = PyJWKClient(url, cache_keys=True)
    return _jwks_clients[url]


def decode_neon_access_token(
    token: str,
    *,
    auth_url: str,
    issuer: str | None = None,
    audience: str | None = None,
    jwks_url: str | None = None,
) -> dict[str, object]:
    """Decode a Neon Auth JWT.

    Neon-hosted deployments currently issue tokens with aud == iss by default, so
    the derived issuer remains the audience fallback unless an explicit audience is
    configured by the caller.
    """
    resolved_auth_url = (auth_url or "").strip().rstrip("/")
    if not resolved_auth_url:
        raise NeonAuthError("Neon Auth URL is not configured")

    derived_issuer = neon_auth_origin(resolved_auth_url)
    configured_issuer = (issuer or "").strip()
    configured_audience = (audience or "").strip() or derived_issuer
    candidate_issuers = [configured_issuer] if configured_issuer else []
    if derived_issuer and derived_issuer not in candidate_issuers:
        candidate_issuers.append(derived_issuer)
    resolved_jwks_url = (jwks_url or neon_jwks_url(resolved_auth_url)).strip()

    try:
        signing_key = _get_jwks_client(resolved_jwks_url).get_signing_key_from_jwt(token).key
        last_error: InvalidTokenError | None = None
        for expected_issuer in candidate_issuers:
            try:
                return jwt_decode(
                    token,
                    signing_key,
                    algorithms=["EdDSA"],
                    issuer=expected_issuer,
                    audience=configured_audience,
                    options={"require": ["sub", "exp", "iat", "iss", "aud"]},
                )
            except InvalidTokenError as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise NeonAuthError("Invalid or expired token")
    except (InvalidTokenError, PyJWKClientError, ValueError) as exc:
        raise NeonAuthError("Invalid or expired token") from exc
