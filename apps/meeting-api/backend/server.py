import asyncio
import base64
import hashlib
import hmac
import inspect
import json
import logging
import os
import re
import secrets
import sys
import tempfile
import types
import uuid
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, HTTPException, Response, UploadFile, status
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, EmailStr, Field
import psycopg
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
PROJECT_ROOT = ROOT_DIR.parent
for path in (str(ROOT_DIR), str(PROJECT_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

if "backend" not in sys.modules:
    backend_package = types.ModuleType("backend")
    backend_package.__path__ = [str(ROOT_DIR)]
    sys.modules["backend"] = backend_package
sys.modules.setdefault("backend.server", sys.modules[__name__])

from config import load_settings
from db import assert_schema_ready, close_db_pool, get_db_pool, init_db_pool
from repositories.chapters import ordered_chapter_summaries
from security import (
    AuthError,
    create_access_token,
    decode_access_token,
    decode_neon_access_token,
    enforce_hosted_claims_contract,
    hash_password,
    normalize_claims,
    require_same_tenant_or_404,
    verify_password,
)
from services.chapter_summary import build_chapter_window_payload, dedupe_generated_records_across_chapters, extract_generated_records
from services.storage import build_storage_adapter, should_archive_raw_audio
from workflows.chapter_summary_create import should_keep_partial_window
from workflows.meeting_state_update import should_halt_due_to_explicit_stop, should_halt_due_to_inactivity

def ensure_backend_package_imports() -> None:
    project_root = str(ROOT_DIR.parent)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)


ensure_backend_package_imports()
settings = load_settings()


DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    if isinstance(value, str):
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    return utc_now()


OPENAI_API_KEY = settings.openai_api_key
SARVAM_API_KEY = settings.sarvam_api_key
OPENAI_TEXT_MODEL = settings.openai_text_model
OPENAI_TRANSLATE_MODEL = settings.openai_translate_model
OPENAI_TRANSCRIBE_MODEL = settings.openai_transcribe_model
OPENAI_TTS_MODEL = settings.openai_tts_model
OPENAI_TTS_VOICE = settings.openai_tts_voice

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

SARVAM_SOURCE_LANGUAGE_MAP = {
    "as": "as-IN",
    "bn": "bn-IN",
    "brx": "brx-IN",
    "doi": "doi-IN",
    "en": "en-IN",
    "english": "en-IN",
    "gu": "gu-IN",
    "hi": "hi-IN",
    "kn": "kn-IN",
    "kok": "kok-IN",
    "ks": "ks-IN",
    "mai": "mai-IN",
    "ml": "ml-IN",
    "mni": "mni-IN",
    "mr": "mr-IN",
    "ne": "ne-IN",
    "od": "od-IN",
    "or": "od-IN",
    "pa": "pa-IN",
    "pn": "pa-IN",
    "sa": "sa-IN",
    "sat": "sat-IN",
    "sd": "sd-IN",
    "ta": "ta-IN",
    "te": "te-IN",
    "ur": "ur-IN",
}
ENGLISH_LANGUAGE_CODES = {"en", "en-in", "english"}
TRANSCRIPTION_CONTEXT_SEGMENT_LIMIT = 6
TRANSCRIPTION_CONTEXT_CHAR_LIMIT = 800
SUMMARY_FIRST_STATE_WINDOW_SECONDS = settings.summary_first_state_window_seconds
SUMMARY_FIRST_CHAPTER_WINDOW_SECONDS = settings.summary_first_chapter_window_seconds
SUMMARY_FIRST_INACTIVITY_TIMEOUT_SECONDS = settings.summary_first_inactivity_timeout_seconds


class MeetingCreate(BaseModel):
    title: str = "Untitled Meeting"
    engine: str = "whisper"


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    engine: Optional[str] = None


class Meeting(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "Untitled Meeting"
    status: str = "idle"
    engine: str = "whisper"
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)
    duration_seconds: int = 0
    segment_count: int = 0


class TranslateRequest(BaseModel):
    text: str
    source_language: str = "auto"
    target_language: str = "en-IN"


class TranscriptSegment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    meeting_id: str
    speaker_label: str = "SPK 1"
    text: str = ""
    timestamp_start: float = 0.0
    timestamp_end: float = 0.0
    created_at: str = Field(default_factory=utc_now_iso)
    language_code: str = "unknown"
    translated_text: Optional[str] = None


class SummaryResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    meeting_id: str
    summary_text: str = ""
    action_items: list[str] = Field(default_factory=list)
    key_topics: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now_iso)


class ChatMessageCreate(BaseModel):
    content: str


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    meeting_id: str
    role: str
    content: str
    created_at: str = Field(default_factory=utc_now_iso)


class AuthRegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class AuthUser(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    tenant_id: Optional[str] = None
    org_id: Optional[str] = None
    role: Optional[str] = None
    permissions: list[str] = Field(default_factory=list)
    is_authenticated: bool = False


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUser


class HostedSessionExchangeRequest(BaseModel):
    provider_token: str = Field(min_length=1)
    provider: str | None = None


class HostedOrganization(BaseModel):
    id: str
    name: str
    slug: Optional[str] = None


class HostedOnboardingStateResponse(BaseModel):
    needs_onboarding: bool
    organization: Optional[HostedOrganization] = None
    requires_session_refresh: bool = False
    message: Optional[str] = None


class HostedOnboardingOrganizationRequest(BaseModel):
    name: str = Field(min_length=1)
    slug: Optional[str] = None


class HostedOnboardingInvitationAcceptRequest(BaseModel):
    invite_token: str = Field(min_length=1)


class HostedOnboardingInvitationCreateRequest(BaseModel):
    email: EmailStr
    role: str = Field(default="member", min_length=1)


class HostedOnboardingInvitation(BaseModel):
    id: str
    email: str
    role: str
    invite_token: str
    expires_at: datetime | None = None


class HostedOnboardingResponse(BaseModel):
    organization: HostedOrganization
    user: AuthUser
    access_token: str
    token_type: str = "bearer"
    requires_session_refresh: bool = False


class HostedOnboardingInvitationResponse(BaseModel):
    organization: HostedOrganization
    invitation: HostedOnboardingInvitation


class AudioStorageSessionRequest(BaseModel):
    meeting_id: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    content_type: str = Field(min_length=1)
    expires_in_seconds: int = Field(default=900, ge=60, le=3600)


class JobRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    owner_user_id: str
    meeting_id: Optional[str] = None
    job_type: str
    status: str = "completed"
    stage: str = "finished"
    elapsed_ms: int = 0
    error: Optional[str] = None
    retry_count: int = 0
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


def ensure_openai_client() -> AsyncOpenAI:
    if not openai_client:
        raise HTTPException(status_code=400, detail="OpenAI API key not configured")
    return openai_client


PLACEHOLDER_PATTERN = re.compile(r"\$\d+")


def normalize_query(query: str) -> str:
    return PLACEHOLDER_PATTERN.sub("%s", query)


def get_db_connection():
    return get_db_pool().connection()


def get_storage_adapter():
    return build_storage_adapter(settings)


def archive_audio_chunk(
    *,
    meeting: dict[str, Any],
    filename: str,
    content_type: str,
    chunk_index: int,
    chunk_duration_seconds: float,
    payload: bytes,
) -> dict[str, Any] | None:
    if not should_archive_raw_audio(settings):
        return None

    storage_adapter = get_storage_adapter()
    if not storage_adapter.provider_ready():
        raise HTTPException(status_code=503, detail="Hosted storage is not ready")

    tenant_id = str(meeting.get("tenant_id") or DEFAULT_TENANT_ID)
    stored_object = storage_adapter.store_audio_chunk(
        meeting_id=str(meeting["id"]),
        chunk_index=chunk_index,
        filename=filename,
        content_type=content_type,
        payload=payload,
        retention_days=settings.raw_audio_retention_days,
    )
    asset_id = str(uuid.uuid4())
    created_at = utc_now()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                INSERT INTO audio_assets (
                    id, tenant_id, meeting_id, storage_path, kind, mime_type, duration_ms, retention_expires_at, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """
                ),
                (
                    asset_id,
                    tenant_id,
                    meeting["id"],
                    stored_object.storage_path,
                    "raw_audio_chunk",
                    content_type,
                    int(max(chunk_duration_seconds, 0) * 1000),
                    stored_object.retention_expires_at,
                    created_at,
                ),
            )

    return {
        "id": asset_id,
        "backend": stored_object.backend,
        "storage_path": stored_object.storage_path,
        "download_url": stored_object.download_url,
        "retention_expires_at": serialize_value(stored_object.retention_expires_at),
    }


def create_token_for_user(user: AuthUser) -> str:
    return create_access_token(
        subject=user.id,
        secret=settings.auth_secret,
        algorithm=settings.auth_algorithm,
        expires_minutes=settings.auth_token_ttl_minutes,
        extra_claims={
            "email": user.email,
            "tenant_id": user.tenant_id,
            "org_id": user.org_id,
            "role": user.role,
            "permissions": list(user.permissions),
        },
    )


def fetch_user_by_email(email: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)"),
                (email,),
            )
            return serialize_record(cur.fetchone())


def fetch_user_by_id(user_id: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(normalize_query("SELECT * FROM users WHERE id = $1"), (user_id,))
            return serialize_record(cur.fetchone())


def fetch_user_auth_identity(provider: str, provider_user_id: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT *
                FROM user_auth_identities
                WHERE provider = $1 AND provider_user_id = $2
                """
                ),
                (provider, provider_user_id),
            )
            return serialize_record(cur.fetchone())


def fetch_tenant_by_id(tenant_id: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(normalize_query("SELECT * FROM tenants WHERE id = $1"), (tenant_id,))
            return serialize_record(cur.fetchone())


def fetch_tenant_by_identifier(identifier: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query("SELECT * FROM tenants WHERE id = $1 OR slug = $1"),
                (identifier,),
            )
            return serialize_record(cur.fetchone())


def upsert_tenant_record(tenant_id: str, name: str, slug: Optional[str]) -> dict[str, Any]:
    created_at = utc_now()
    resolved_slug = build_tenant_slug(tenant_id, name, slug)
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    normalize_query(
                        """
                    INSERT INTO tenants (id, slug, name, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO UPDATE
                    SET slug = COALESCE(EXCLUDED.slug, tenants.slug),
                        name = COALESCE(EXCLUDED.name, tenants.name),
                        updated_at = EXCLUDED.updated_at
                    RETURNING *
                    """
                    ),
                    (tenant_id, resolved_slug, name, created_at, created_at),
                )
                return serialize_record(cur.fetchone()) or {
                    "id": tenant_id,
                    "slug": resolved_slug,
                    "name": name,
                    "created_at": created_at,
                    "updated_at": created_at,
                }
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Organization slug '{resolved_slug}' is already taken. Choose a different name or slug.",
        ) from exc


def build_tenant_slug(tenant_id: str, name: str, slug: Optional[str]) -> str:
    def slugify(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")

    provided_slug = slugify(slug or "")
    if provided_slug:
        return provided_slug

    base_slug = slugify(name) or "organization"
    tenant_suffix = re.sub(r"[^a-z0-9]+", "", tenant_id.lower())[-8:] or "workspace"
    return f"{base_slug}-{tenant_suffix}"


def upsert_hosted_user_record(actor: AuthUser, tenant_id: str) -> dict[str, Any]:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            return _upsert_hosted_user_record_with_cursor(cur, actor, tenant_id)


def _upsert_hosted_user_record_with_cursor(cur: Any, actor: AuthUser, tenant_id: str) -> dict[str, Any]:
    created_at = utc_now()
    cur.execute(normalize_query("SELECT * FROM users WHERE id = $1"), (actor.id,))
    existing = serialize_record(cur.fetchone())
    email = (actor.email or (existing.get("email") if existing else "") or f"{actor.id}@hosted.local").strip()
    name = (actor.name or (existing.get("name") if existing else None) or "").strip() or None
    if existing:
        cur.execute(
            normalize_query(
                """
            UPDATE users
            SET email = $1,
                name = $2,
                tenant_id = $3,
                updated_at = $4
            WHERE id = $5
            RETURNING *
            """
            ),
            (email, name, tenant_id, created_at, actor.id),
        )
    else:
        cur.execute(
            normalize_query(
                """
            INSERT INTO users (id, email, password_hash, name, tenant_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            """
            ),
            (
                actor.id,
                email,
                hash_password(str(uuid.uuid4())),
                name,
                tenant_id,
                created_at,
                created_at,
            ),
        )
    return serialize_record(cur.fetchone()) or {
        "id": actor.id,
        "email": email,
        "name": name,
        "tenant_id": tenant_id,
    }


def upsert_user_auth_identity(
    *,
    user_id: str,
    provider: str,
    provider_user_id: str,
    provider_email: str | None,
) -> dict[str, Any]:
    timestamp = utc_now()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                INSERT INTO user_auth_identities (
                    id, user_id, provider, provider_user_id, provider_email, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (provider, provider_user_id) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    provider_email = COALESCE(EXCLUDED.provider_email, user_auth_identities.provider_email),
                    updated_at = EXCLUDED.updated_at
                RETURNING *
                """
                ),
                (
                    str(uuid.uuid4()),
                    user_id,
                    provider,
                    provider_user_id,
                    provider_email,
                    timestamp,
                    timestamp,
                ),
            )
            return serialize_record(cur.fetchone()) or {
                "user_id": user_id,
                "provider": provider,
                "provider_user_id": provider_user_id,
                "provider_email": provider_email,
            }


def fetch_active_organization_membership(user_id: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT *
                FROM organization_memberships
                WHERE user_id = $1 AND status = 'active'
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT 1
                """
                ),
                (user_id,),
            )
            return serialize_record(cur.fetchone())


def upsert_organization_membership(
    *,
    tenant_id: str,
    user_id: str,
    role: str,
    status: str = "active",
    invited_by_user_id: str | None = None,
) -> dict[str, Any]:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            return _upsert_organization_membership_with_cursor(
                cur,
                tenant_id=tenant_id,
                user_id=user_id,
                role=role,
                status=status,
                invited_by_user_id=invited_by_user_id,
            )


def _upsert_organization_membership_with_cursor(
    cur: Any,
    *,
    tenant_id: str,
    user_id: str,
    role: str,
    status: str = "active",
    invited_by_user_id: str | None = None,
) -> dict[str, Any]:
    timestamp = utc_now()
    cur.execute(
        normalize_query(
            """
        INSERT INTO organization_memberships (
            id, tenant_id, user_id, role, status, invited_by_user_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            status = EXCLUDED.status,
            invited_by_user_id = COALESCE(EXCLUDED.invited_by_user_id, organization_memberships.invited_by_user_id),
            updated_at = EXCLUDED.updated_at
        RETURNING *
        """
        ),
        (
            str(uuid.uuid4()),
            tenant_id,
            user_id,
            role,
            status,
            invited_by_user_id,
            timestamp,
            timestamp,
        ),
    )
    return serialize_record(cur.fetchone()) or {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "role": role,
        "status": status,
        "invited_by_user_id": invited_by_user_id,
    }


def build_organization_invitation_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_organization_invitation(
    *,
    tenant_id: str,
    email: str,
    role: str,
    invited_by_user_id: str | None,
    expires_at: datetime | None = None,
) -> dict[str, Any]:
    token = secrets.token_urlsafe(24)
    token_hash = build_organization_invitation_token_hash(token)
    timestamp = utc_now()
    expires_at = expires_at or (timestamp + timedelta(days=7))
    normalized_email = email.strip().lower()
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    normalize_query(
                        """
                    INSERT INTO organization_invitations (
                        id, tenant_id, email, role, token_hash, status, invited_by_user_id, expires_at, created_at, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING *
                    """
                    ),
                    (
                        str(uuid.uuid4()),
                        tenant_id,
                        normalized_email,
                        role,
                        token_hash,
                        "pending",
                        invited_by_user_id,
                        expires_at,
                        timestamp,
                        timestamp,
                    ),
                )
                record = serialize_record(cur.fetchone()) or {
                    "tenant_id": tenant_id,
                    "email": normalized_email,
                    "role": role,
                    "expires_at": expires_at.isoformat(),
                }
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active invitation already exists for this email address.",
        ) from exc
    return {**record, "invite_token": token}


def find_organization_invitation_by_token(invite_token: str) -> dict[str, Any] | None:
    token_hash = build_organization_invitation_token_hash(invite_token.strip())
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT *
                FROM organization_invitations
                WHERE token_hash = $1
                LIMIT 1
                """
                ),
                (token_hash,),
            )
            record = serialize_record(cur.fetchone())
    if not record:
        return None
    expires_at = parse_datetime(record["expires_at"]) if record.get("expires_at") else None
    if record.get("status") != "pending" or (expires_at and expires_at < utc_now()):
        return None
    return record


def mark_organization_invitation_accepted(invitation_id: str, accepted_by_user_id: str) -> dict[str, Any] | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            return _mark_organization_invitation_accepted_with_cursor(cur, invitation_id, accepted_by_user_id)


def _mark_organization_invitation_accepted_with_cursor(
    cur: Any,
    invitation_id: str,
    accepted_by_user_id: str,
) -> dict[str, Any] | None:
    timestamp = utc_now()
    cur.execute(
        normalize_query(
            """
        UPDATE organization_invitations
        SET status = 'accepted',
            accepted_by_user_id = $1,
            accepted_at = $2,
            updated_at = $2
        WHERE id = $3
          AND status = 'pending'
        RETURNING *
        """
        ),
        (accepted_by_user_id, timestamp, invitation_id),
    )
    return serialize_record(cur.fetchone())


def delete_tenant_record(tenant_id: str) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(normalize_query("DELETE FROM tenants WHERE id = $1"), (tenant_id,))


def restore_hosted_user_tenant(user_id: str, tenant_id: str | None) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                UPDATE users
                SET tenant_id = $1,
                    updated_at = $2
                WHERE id = $3
                """
                ),
                (tenant_id, utc_now(), user_id),
            )


def provision_hosted_user_from_provider_identity(*, provider: str, payload: dict[str, Any]) -> AuthUser:
    normalized = enforce_hosted_claims_contract(
        payload,
        allow_missing_tenant=True,
        allow_missing_org=True,
    )
    linked_identity = fetch_user_auth_identity(provider, normalized["sub"])
    user_record = fetch_user_by_id(str(linked_identity["user_id"])) if linked_identity else None
    if user_record is None and normalized["email"]:
        user_record = fetch_user_by_email(normalized["email"])

    user_id = str(user_record["id"]) if user_record else str(uuid.uuid4())
    active_membership = fetch_active_organization_membership(user_id) if user_record else None
    timestamp = utc_now()
    email = (normalized["email"] or (user_record.get("email") if user_record else "") or f"{user_id}@hosted.local").strip()
    name = (normalized["display_name"] or (user_record.get("name") if user_record else None) or "").strip() or None
    tenant_id = (
        (active_membership or {}).get("tenant_id")
        or (user_record.get("tenant_id") if user_record else None)
        or normalized["tenant_id"]
    )
    role = str((active_membership or {}).get("role") or normalized["role"] or "member")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if user_record:
                cur.execute(
                    normalize_query(
                        """
                    UPDATE users
                    SET email = $1,
                        name = $2,
                        updated_at = $3
                    WHERE id = $4
                    RETURNING *
                    """
                    ),
                    (email, name, timestamp, user_id),
                )
            else:
                cur.execute(
                    normalize_query(
                        """
                    INSERT INTO users (id, email, password_hash, name, tenant_id, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (email) DO UPDATE
                    SET name = COALESCE(EXCLUDED.name, users.name),
                        tenant_id = COALESCE(users.tenant_id, EXCLUDED.tenant_id),
                        updated_at = EXCLUDED.updated_at
                    RETURNING *
                    """
                    ),
                    (
                        user_id,
                        email,
                        hash_password(str(uuid.uuid4())),
                        name,
                        tenant_id,
                        timestamp,
                        timestamp,
                    ),
                )
            persisted_user = serialize_record(cur.fetchone()) or {
                "id": user_id,
                "email": email,
                "name": name,
                "tenant_id": tenant_id,
            }

    persisted_user_id = str(persisted_user["id"])
    if persisted_user_id != user_id:
        active_membership = fetch_active_organization_membership(persisted_user_id)
    user_id = persisted_user_id
    tenant_id = (
        (active_membership or {}).get("tenant_id")
        or persisted_user.get("tenant_id")
        or tenant_id
    )
    role = str((active_membership or {}).get("role") or normalized["role"] or "member")

    upsert_user_auth_identity(
        user_id=user_id,
        provider=provider,
        provider_user_id=normalized["sub"],
        provider_email=normalized["email"],
    )

    return AuthUser(
        id=str(persisted_user["id"]),
        email=str(persisted_user.get("email") or email),
        name=persisted_user.get("name") or name,
        tenant_id=tenant_id,
        org_id=normalized["org_id"],
        role=role,
        permissions=tuple(normalized["permissions"]),
        is_authenticated=True,
    )


def provision_hosted_user_from_neon_access_token(access_token: str) -> AuthUser:
    payload = decode_neon_access_token(
        access_token,
        auth_url=settings.neon_auth_url,
        issuer=getattr(settings, "neon_issuer", (os.environ.get("NEON_ISSUER") or "").strip() or None),
        jwks_url=getattr(settings, "neon_jwks_url", (os.environ.get("NEON_JWKS_URL") or "").strip() or None),
    )
    return provision_hosted_user_from_provider_identity(provider="neon", payload=payload)


def provision_hosted_user_from_provider_token(access_token: str, *, provider: str | None = None) -> AuthUser:
    resolved_provider = (provider or settings.auth_provider or "").strip().lower()
    if resolved_provider != "neon":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported hosted auth provider")
    return provision_hosted_user_from_neon_access_token(access_token)


def ensure_oss_user() -> AuthUser:
    existing = fetch_user_by_email(settings.oss_default_email)
    if existing:
        return AuthUser(
            id=existing["id"],
            email=existing["email"],
            name=existing.get("name"),
            tenant_id=existing.get("tenant_id") or DEFAULT_TENANT_ID,
            is_authenticated=False,
        )

    user_id = str(uuid.uuid4())
    created_at = utc_now()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                INSERT INTO users (id, email, password_hash, name, tenant_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """
                ),
                (
                    user_id,
                    settings.oss_default_email,
                    hash_password("oss-local-user"),
                    "Local OSS User",
                    DEFAULT_TENANT_ID,
                    created_at,
                    created_at,
                ),
            )

    return AuthUser(
        id=user_id,
        email=settings.oss_default_email,
        name="Local OSS User",
        tenant_id=DEFAULT_TENANT_ID,
        is_authenticated=False,
    )


def get_request_actor(authorization: Optional[str] = Header(default=None)) -> AuthUser:
    if settings.is_oss and not settings.auth_required:
        return ensure_oss_user()

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization token is required",
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(
            token,
            secret=settings.auth_secret,
            algorithm=settings.auth_algorithm,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        ) from exc

    user = fetch_user_by_id(str(payload.get("sub", "")))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user was not found",
        )

    normalized = (
        enforce_hosted_claims_contract(payload, allow_missing_org=True)
        if settings.is_hosted
        else normalize_claims(payload)
    )
    active_membership = fetch_active_organization_membership(str(user["id"])) if settings.is_hosted else None
    membership_tenant_id = str((active_membership or {}).get("tenant_id") or "").strip() or None
    org_id = membership_tenant_id or normalized["org_id"]
    tenant_id = (
        membership_tenant_id
        if settings.is_hosted
        else normalized["tenant_id"] or user.get("tenant_id") or org_id
    )
    role = str((active_membership or {}).get("role") or normalized["role"] or "member")

    return AuthUser(
        id=user["id"],
        email=normalized["email"] or user["email"],
        name=user.get("name"),
        tenant_id=tenant_id or (DEFAULT_TENANT_ID if settings.is_oss else None),
        org_id=org_id,
        role=role,
        permissions=normalized["permissions"],
        is_authenticated=True,
    )


def require_authenticated_actor(actor: AuthUser = Depends(get_request_actor)) -> AuthUser:
    if settings.is_hosted and not actor.is_authenticated:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return actor


def get_hosted_onboarding_actor(authorization: Optional[str] = Header(default=None)) -> AuthUser:
    current_settings = settings
    if not current_settings.is_hosted:
        reloaded_settings = load_settings()
        if reloaded_settings.is_hosted:
            current_settings = reloaded_settings
    if not current_settings.is_hosted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization token is required",
        )

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(
            token,
            secret=current_settings.auth_secret,
            algorithm=current_settings.auth_algorithm,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
        ) from exc

    normalized = enforce_hosted_claims_contract(
        payload,
        allow_missing_tenant=True,
        allow_missing_org=True,
    )
    return AuthUser(
        id=normalized["sub"],
        email=normalized["email"],
        name=normalized["display_name"],
        tenant_id=normalized["tenant_id"],
        org_id=normalized["org_id"],
        role=normalized["role"],
        permissions=tuple(normalized["permissions"]),
        is_authenticated=True,
    )


def resolve_hosted_tenant_context(actor: AuthUser) -> str | None:
    if actor.tenant_id:
        return actor.tenant_id

    membership = fetch_active_organization_membership(actor.id)
    if membership and membership.get("tenant_id"):
        return str(membership["tenant_id"]).strip() or None

    user_record = fetch_user_by_id(actor.id)
    if user_record and user_record.get("tenant_id"):
        return str(user_record["tenant_id"]).strip() or None
    return None


def resolve_actor_tenant_scope(actor: AuthUser) -> str | None:
    tenant_id = resolve_hosted_tenant_context(actor)
    if tenant_id:
        return tenant_id
    if settings.is_oss:
        return actor.tenant_id or DEFAULT_TENANT_ID
    return None


def create_hosted_app_token(user: AuthUser) -> str:
    return create_access_token(
        subject=user.id,
        secret=settings.auth_secret,
        algorithm=settings.auth_algorithm,
        expires_minutes=settings.auth_token_ttl_minutes,
        extra_claims={
            "email": user.email,
            "tenant_id": user.tenant_id,
            "org_id": user.org_id,
            "role": user.role,
            "permissions": list(user.permissions),
        },
    )


def serialize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, list):
        return [serialize_value(item) for item in value]
    return value


def serialize_record(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return {key: serialize_value(value) for key, value in record.items()}


def serialize_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [serialize_record(record) for record in records if record is not None]


_speaker_tracker: dict[str, dict[str, int]] = {}


def detect_speaker(meeting_id: str, silence_gap: float) -> str:
    if meeting_id not in _speaker_tracker:
        _speaker_tracker[meeting_id] = {"current": 1, "total": 1}

    tracker = _speaker_tracker[meeting_id]
    if silence_gap > 2.0:
        tracker["current"] = (tracker["current"] % max(tracker["total"], 2)) + 1
        if tracker["current"] > tracker["total"]:
            tracker["total"] = tracker["current"]

    return f"SPK {tracker['current']}"


def reset_speaker_tracker(meeting_id: str) -> None:
    _speaker_tracker.pop(meeting_id, None)


def is_english_text(text: str) -> bool:
    if not text:
        return True
    ascii_count = sum(1 for char in text if ord(char) < 128)
    return (ascii_count / len(text)) > 0.85


def is_english_language_code(language_code: str | None) -> bool:
    if not language_code:
        return False
    normalized = language_code.strip().lower().replace("_", "-")
    return normalized == "english" or normalized.startswith("en")


def should_translate_text(text: str, language_code: str | None) -> bool:
    normalized_language = (language_code or "unknown").strip().lower().replace("_", "-")
    if normalized_language in ENGLISH_LANGUAGE_CODES and is_english_text(text):
        return False
    if normalized_language == "unknown":
        return not is_english_text(text)
    return normalized_language not in ENGLISH_LANGUAGE_CODES or not is_english_text(text)


def extract_json_payload(text: str) -> str:
    payload = (text or "").strip()
    fenced_match = re.search(r"```(?:json)?\s*(.*?)```", payload, re.DOTALL)
    if fenced_match:
        payload = fenced_match.group(1).strip()
    return payload


def normalize_sarvam_source_language(source_lang: str | None) -> str:
    if not source_lang:
        return "auto"

    normalized = source_lang.strip().lower().replace("_", "-")
    if normalized in {"", "unknown", "auto"}:
        return "auto"
    if normalized in SARVAM_SOURCE_LANGUAGE_MAP.values():
        return normalized

    base_language = normalized.split("-", 1)[0]
    return SARVAM_SOURCE_LANGUAGE_MAP.get(normalized) or SARVAM_SOURCE_LANGUAGE_MAP.get(base_language, "auto")


async def auto_translate_to_english(text: str, source_lang: str = "auto") -> str:
    if not OPENAI_API_KEY or not text.strip():
        return ""

    try:
        response = await ensure_openai_client().responses.create(
            model=OPENAI_TRANSLATE_MODEL,
            instructions=(
                "Translate the user-provided meeting transcript snippet into natural English. "
                "Return only the translated English text. "
                "If the snippet is already English, return it unchanged."
            ),
            input=(
                f"Source language hint: {source_lang or 'auto'}\n"
                f"Transcript snippet:\n{text[:2000]}"
            ),
        )
        return (getattr(response, "output_text", "") or "").strip()
    except Exception as exc:  # pragma: no cover - provider-specific failures
        logger.warning("Auto-translate failed for language '%s': %s", source_lang, exc)
        return ""


def get_recent_transcript_context(meeting_id: str) -> str:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT text
                FROM transcript_segments
                WHERE meeting_id = $1
                ORDER BY timestamp_start DESC
                LIMIT $2
                """
                ),
                (meeting_id, TRANSCRIPTION_CONTEXT_SEGMENT_LIMIT),
            )
            records = cur.fetchall()

    if not records:
        return ""

    ordered_text = " ".join(
        (record.get("text", "") or "").strip()
        for record in reversed(records)
        if (record.get("text", "") or "").strip()
    )
    return ordered_text[-TRANSCRIPTION_CONTEXT_CHAR_LIMIT:]



def _segment_value(segment: Any, key: str, default: Any = None) -> Any:
    if hasattr(segment, key):
        return getattr(segment, key)
    if isinstance(segment, dict):
        return segment.get(key, default)
    return default


async def build_segment_doc(
    *,
    meeting_id: str,
    text: str,
    timestamp_start: float,
    timestamp_end: float,
    language_code: str,
    source_language: str,
    silence_gap: float,
) -> dict[str, Any]:
    speaker_label = detect_speaker(meeting_id, silence_gap)
    segment = TranscriptSegment(
        meeting_id=meeting_id,
        speaker_label=speaker_label,
        text=text,
        timestamp_start=timestamp_start,
        timestamp_end=timestamp_end,
        language_code=language_code or "unknown",
    )
    return segment.model_dump()


class SpeechProvider:
    id: str = ""
    name: str = ""
    description: str = ""
    features: list[str] = []

    @property
    def available(self) -> bool:
        raise NotImplementedError

    async def transcribe(
        self,
        *,
        file_path: str,
        meeting_id: str,
        elapsed_seconds: float,
        chunk_duration_seconds: float = 0.0,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    def descriptor(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "features": self.features,
            "available": self.available,
        }


class OpenAIWhisperSpeechProvider(SpeechProvider):
    id = "whisper"
    name = "OpenAI GPT-4o Transcribe"
    description = "OpenAI multilingual transcription optimized for quality and low latency"
    features = ["99+ languages", "Code-switching", "Fast processing"]

    @property
    def available(self) -> bool:
        return bool(OPENAI_API_KEY)

    async def transcribe(
        self,
        *,
        file_path: str,
        meeting_id: str,
        elapsed_seconds: float,
        chunk_duration_seconds: float = 0.0,
    ) -> list[dict[str, Any]]:
        client = ensure_openai_client()
        request_args: dict[str, Any] = {
            "model": OPENAI_TRANSCRIBE_MODEL,
            "file": Path(file_path),
            "response_format": "json",
        }
        prompt = get_recent_transcript_context(meeting_id)
        if prompt:
            request_args["prompt"] = (
                "Continue the same meeting transcript naturally. Preserve names, acronyms, and language context.\n\n"
                f"{prompt}"
            )

        response = await client.audio.transcriptions.create(**request_args)

        transcribed_text = (getattr(response, "text", "") or "").strip()
        if not transcribed_text:
            return []

        detected_lang = getattr(response, "language", None) or "unknown"
        raw_segments = getattr(response, "segments", None) or []
        segments: list[dict[str, Any]] = []

        if raw_segments:
            prev_end = 0.0
            for raw_segment in raw_segments:
                seg_text = str(_segment_value(raw_segment, "text", "")).strip()
                seg_start = float(_segment_value(raw_segment, "start", 0.0) or 0.0)
                seg_end = float(_segment_value(raw_segment, "end", 0.0) or 0.0)
                if not seg_text:
                    continue
                silence_gap = seg_start - prev_end if prev_end > 0 else 0.0
                segments.append(
                    await build_segment_doc(
                        meeting_id=meeting_id,
                        text=seg_text,
                        timestamp_start=elapsed_seconds + seg_start,
                        timestamp_end=elapsed_seconds + seg_end,
                        language_code=detected_lang,
                        source_language=detected_lang,
                        silence_gap=silence_gap,
                    )
                )
                prev_end = seg_end
            return segments

        return [
            await build_segment_doc(
                meeting_id=meeting_id,
                text=transcribed_text,
                timestamp_start=elapsed_seconds,
                timestamp_end=elapsed_seconds + max(chunk_duration_seconds, 1.0),
                language_code=detected_lang,
                source_language=detected_lang,
                silence_gap=0.0,
            )
        ]


class SarvamSpeechProvider(SpeechProvider):
    id = "sarvam"
    name = "Sarvam Saaras v3"
    description = "Indian language specialist transcription"
    features = [
        "22+ Indian languages",
        "Code-mixing (Hindi-English)",
        "Native diarization",
        "Low WER on Indian accents",
    ]

    @property
    def available(self) -> bool:
        return bool(SARVAM_API_KEY)

    async def transcribe(
        self,
        *,
        file_path: str,
        meeting_id: str,
        elapsed_seconds: float,
        chunk_duration_seconds: float = 0.0,
    ) -> list[dict[str, Any]]:
        if not SARVAM_API_KEY:
            raise HTTPException(status_code=400, detail="Sarvam API key not configured")

        from sarvamai import SarvamAI

        sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
        with open(file_path, "rb") as audio_file:
            response = sarvam_client.speech_to_text.transcribe(
                file=audio_file,
                model="saaras:v3",
                mode="transcribe",
            )

        transcribed_text = (getattr(response, "transcript", "") or "").strip()
        if not transcribed_text:
            return []

        detected_lang = getattr(response, "language_code", "unknown")
        return [
            await build_segment_doc(
                meeting_id=meeting_id,
                text=transcribed_text,
                timestamp_start=elapsed_seconds,
                timestamp_end=elapsed_seconds + max(chunk_duration_seconds, 1.0),
                language_code=detected_lang,
                source_language=detected_lang,
                silence_gap=0.0,
            )
        ]


SPEECH_PROVIDERS: dict[str, SpeechProvider] = {
    "whisper": OpenAIWhisperSpeechProvider(),
    "sarvam": SarvamSpeechProvider(),
}


def get_speech_provider(engine: str) -> SpeechProvider:
    provider = SPEECH_PROVIDERS.get(engine)
    if not provider:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")
    if not provider.available:
        if engine == "sarvam":
            raise HTTPException(status_code=400, detail="Sarvam engine is unavailable")
        raise HTTPException(status_code=400, detail="OpenAI transcription engine is unavailable")
    return provider


async def create_text_response(system_message: str, user_message: str) -> str:
    client = ensure_openai_client()
    response = await client.responses.create(
        model=OPENAI_TEXT_MODEL,
        instructions=system_message,
        input=user_message,
    )
    return (getattr(response, "output_text", "") or "").strip()


async def batch_translate_segments_to_english(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not OPENAI_API_KEY or not segments:
        return segments

    candidates = [
        segment
        for segment in segments
        if segment.get("text") and should_translate_text(segment.get("text", ""), segment.get("language_code"))
    ]
    if not candidates:
        return segments

    payload = [
        {
            "id": segment["id"],
            "language_code": segment.get("language_code", "unknown"),
            "text": segment["text"],
        }
        for segment in candidates
    ]

    translations: dict[str, str] = {}
    try:
        response = await ensure_openai_client().responses.create(
            model=OPENAI_TRANSLATE_MODEL,
            instructions=(
                "You translate meeting transcript snippets into English.\n"
                "Return only valid JSON.\n"
                "Output format: {\"translations\":[{\"id\":\"<segment-id>\",\"translated_text\":\"<english text>\"}]}\n"
                "Preserve IDs exactly.\n"
                "Do not omit any item.\n"
                "If a snippet is already English, return the original text as translated_text.\n"
                "Never add commentary."
            ),
            input=json.dumps({"segments": payload}, ensure_ascii=False),
        )
        parsed = json.loads(extract_json_payload(getattr(response, "output_text", "") or "{}"))
        translations = {
            item["id"]: item.get("translated_text", "").strip()
            for item in parsed.get("translations", [])
            if item.get("id")
        }
    except Exception as exc:  # pragma: no cover - integration surface
        logger.warning("Batch segment translation failed, falling back to per-segment translation: %s", exc)
        fallback_results = await asyncio.gather(
            *[
                auto_translate_to_english(
                    segment["text"],
                    segment.get("language_code", "auto"),
                )
                for segment in candidates
            ],
            return_exceptions=True,
        )
        for segment, result in zip(candidates, fallback_results):
            if isinstance(result, Exception):
                continue
            translations[segment["id"]] = (result or "").strip()

    for segment in segments:
        translated_text = translations.get(segment["id"], "").strip()
        if translated_text and translated_text != segment.get("text", "").strip():
            segment["translated_text"] = translated_text

    return segments


async def transcribe_question_with_openai(file_path: str) -> str:
    provider = get_speech_provider("whisper")
    segments = await provider.transcribe(
        file_path=file_path,
        meeting_id=f"voice-{uuid.uuid4()}",
        elapsed_seconds=0.0,
    )
    return " ".join(segment["text"] for segment in segments).strip()


async def generate_speech_base64(text: str) -> str:
    client = ensure_openai_client()
    response = await client.audio.speech.create(
        model=OPENAI_TTS_MODEL,
        voice=OPENAI_TTS_VOICE,
        input=text[:4000],
        response_format="mp3",
        speed=1.1,
    )

    audio_bytes = getattr(response, "content", None)
    if not audio_bytes and hasattr(response, "read"):
        maybe_bytes = response.read()
        audio_bytes = await maybe_bytes if inspect.isawaitable(maybe_bytes) else maybe_bytes
    if not audio_bytes:
        audio_bytes = bytes(response)

    return base64.b64encode(audio_bytes).decode("utf-8")


def parse_summary_sections(response_text: str) -> tuple[str, list[str], list[str]]:
    summary_text = ""
    action_items: list[str] = []
    key_topics: list[str] = []
    current_section = None

    for line in response_text.splitlines():
        stripped_line = line.strip()
        if stripped_line == "## Summary":
            current_section = "summary"
            continue
        if stripped_line == "## Action Items":
            current_section = "actions"
            continue
        if stripped_line == "## Key Topics":
            current_section = "topics"
            continue

        if current_section == "summary" and stripped_line:
            summary_text += f"{stripped_line} "
        elif current_section == "actions" and stripped_line.startswith("- ACTION:"):
            action_items.append(stripped_line.replace("- ACTION:", "", 1).strip())
        elif current_section == "actions" and stripped_line.startswith("-"):
            action_items.append(stripped_line.lstrip("- ").strip())
        elif current_section == "topics" and stripped_line.startswith("- TOPIC:"):
            key_topics.append(stripped_line.replace("- TOPIC:", "", 1).strip())
        elif current_section == "topics" and stripped_line.startswith("-"):
            key_topics.append(stripped_line.lstrip("- ").strip())

    return summary_text.strip() or response_text.strip(), action_items, key_topics


async def ensure_schema() -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                engine TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                segment_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS transcript_segments (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                speaker_label TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp_start DOUBLE PRECISION NOT NULL DEFAULT 0,
                timestamp_end DOUBLE PRECISION NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL,
                language_code TEXT NOT NULL DEFAULT 'unknown',
                translated_text TEXT
            );

            CREATE TABLE IF NOT EXISTS summaries (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
                summary_text TEXT NOT NULL,
                action_items TEXT[] NOT NULL DEFAULT '{}',
                key_topics TEXT[] NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_meetings_created_at
                ON meetings (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_timestamp
                ON transcript_segments (meeting_id, timestamp_start);
            CREATE INDEX IF NOT EXISTS idx_summaries_meeting_id
                ON summaries (meeting_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting_created_at
                ON chat_messages (meeting_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_transcript_segments_text_lower
                ON transcript_segments (LOWER(text));
            """
            )


def fetch_meeting(
    conn: psycopg.Connection,
    meeting_id: str,
    actor: Optional[AuthUser] = None,
) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        if actor:
            cur.execute(
                normalize_query("SELECT * FROM meetings WHERE id = $1 AND owner_user_id = $2"),
                (meeting_id, actor.id),
            )
        else:
            cur.execute(normalize_query("SELECT * FROM meetings WHERE id = $1"), (meeting_id,))
        meeting = serialize_record(cur.fetchone())
        if actor and meeting:
            require_same_tenant_or_404(
                resolve_actor_tenant_scope(actor),
                meeting.get("tenant_id"),
                deployment_mode=settings.deployment_mode,
            )
        return meeting


def record_completed_job(
    *,
    owner_user_id: str,
    meeting_id: Optional[str],
    job_type: str,
    stage: str,
    elapsed_ms: int = 0,
    error: Optional[str] = None,
) -> dict[str, Any]:
    job = JobRecord(
        owner_user_id=owner_user_id,
        meeting_id=meeting_id,
        job_type=job_type,
        status="failed" if error else "completed",
        stage=stage,
        elapsed_ms=elapsed_ms,
        error=error,
    ).model_dump()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                INSERT INTO jobs (
                    id, owner_user_id, meeting_id, job_type, status, stage,
                    elapsed_ms, error, retry_count, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                """
                ),
                (
                    job["id"],
                    job["owner_user_id"],
                    job["meeting_id"],
                    job["job_type"],
                    job["status"],
                    job["stage"],
                    job["elapsed_ms"],
                    job["error"],
                    job["retry_count"],
                    parse_datetime(job["created_at"]),
                    parse_datetime(job["updated_at"]),
                ),
            )

    return job


def _segment_text(segment: dict[str, Any]) -> str:
    return str(segment.get("translated_text") or segment.get("text") or "").strip()


def _segment_ref(segment: dict[str, Any]) -> str:
    return str(segment.get("id") or f"segment:{segment.get('timestamp_start', 0)}")


def _format_topic(text: str, *, word_limit: int = 6) -> str | None:
    words = [word for word in text.split() if word.strip()]
    if not words:
        return None
    return " ".join(words[:word_limit])


def _build_extraction_payload(window_segments: list[dict[str, Any]]) -> dict[str, object]:
    decisions_forming: list[dict[str, object]] = []
    action_items: list[dict[str, object]] = []
    open_questions: list[dict[str, object]] = []

    rendered_texts = [_segment_text(segment) for segment in window_segments]
    for index, text in enumerate(rendered_texts):
        if not text:
            continue

        lower_text = text.lower()
        evidence_refs = [_segment_ref(window_segments[index])]
        source_window_start = window_segments[index].get("timestamp_start")
        source_window_end = window_segments[index].get("timestamp_end")

        if any(keyword in lower_text for keyword in ("decided", "agreed", "confirmed", "finalized")):
            decisions_forming.append(
                {
                    "text": text.rstrip("."),
                    "evidence_refs": evidence_refs,
                    "signals": {"proposal": True, "agreement": True, "restatement": "confirmed" in lower_text or "decided" in lower_text},
                    "confidence": 0.93,
                    "source_window_start": source_window_start,
                    "source_window_end": source_window_end,
                }
            )

        action_match = re.match(r"(?P<owner>[A-Z][a-z]+|I|We)\s+will\s+(?P<task>.+)", text)
        if action_match:
            action_items.append(
                {
                    "text": text.rstrip("."),
                    "evidence_refs": evidence_refs,
                    "signals": {"owner": True, "commitment": True},
                    "owner_user_id": None,
                    "confidence": 0.88,
                    "source_window_start": source_window_start,
                    "source_window_end": source_window_end,
                }
            )
        elif any(keyword in lower_text for keyword in ("need to", "should ", "follow up", "send ", "fix ", "review ")):
            action_items.append(
                {
                    "text": text.rstrip("."),
                    "evidence_refs": evidence_refs,
                    "signals": {"owner": False, "commitment": False},
                    "confidence": 0.4,
                    "source_window_start": source_window_start,
                    "source_window_end": source_window_end,
                }
            )

        is_question = "?" in text or bool(re.match(r"^(who|what|when|where|why|how)\b", lower_text))
        if is_question:
            later_text = " ".join(rendered_texts[index + 1 :]).lower()
            resolution_detected = any(keyword in later_text for keyword in (" owns ", " will own ", " owner is ", " handled by "))
            open_questions.append(
                {
                    "text": text.rstrip(),
                    "evidence_refs": evidence_refs,
                    "signals": {
                        "rhetorical": "why don’t we" in lower_text
                        or "why don't we" in lower_text
                        or lower_text.rstrip().endswith(("right?", "isn't it?", "don't you think?")),
                        "resolved": resolution_detected,
                        "answer_detected": resolution_detected,
                    },
                    "confidence": 0.61,
                    "source_window_start": source_window_start,
                    "source_window_end": source_window_end,
                }
            )

    blockers = [text.rstrip(".") for text in rendered_texts if any(keyword in text.lower() for keyword in ("blocker", "issue", "problem", "bug", "stuck"))]

    return {
        "decisions_forming": decisions_forming,
        "active_action_items": action_items,
        "open_questions": open_questions,
        "blockers": blockers,
    }


def _build_state_records(meeting: dict[str, Any], transcript_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not transcript_segments:
        return []

    tenant_id = meeting.get("tenant_id") or DEFAULT_TENANT_ID
    max_timestamp = max(float(segment.get("timestamp_end") or 0) for segment in transcript_segments)
    state_records: list[dict[str, Any]] = []
    window_start = 0.0

    while window_start < max_timestamp:
        window_end = window_start + SUMMARY_FIRST_STATE_WINDOW_SECONDS
        window_segments = [
            segment
            for segment in transcript_segments
            if float(segment.get("timestamp_start") or 0) < window_end and float(segment.get("timestamp_end") or 0) >= window_start
        ]
        if window_segments:
            rendered_texts = [_segment_text(segment) for segment in window_segments if _segment_text(segment)]
            extraction_payload = _build_extraction_payload(window_segments)
            state_records.append(
                {
                    "id": f"{meeting['id']}:state:{int(window_start)}:{int(min(window_end, max_timestamp))}",
                    "tenant_id": tenant_id,
                    "meeting_id": meeting["id"],
                    "window_start": window_start,
                    "window_end": min(window_end, max_timestamp),
                    "current_topic": _format_topic(rendered_texts[-1] if rendered_texts else ""),
                    "current_goal": _format_topic(rendered_texts[0] if rendered_texts else "", word_limit=10),
                    "summary_bullets": rendered_texts[-3:],
                    "decisions_forming": [item["text"] for item in extraction_payload["decisions_forming"]],
                    "blockers": extraction_payload["blockers"],
                    "open_questions": [item["text"] for item in extraction_payload["open_questions"]],
                    "active_action_items": [item["text"] for item in extraction_payload["active_action_items"]],
                    "confidence": min(0.95, 0.45 + 0.1 * len(window_segments)),
                    "created_at": utc_now_iso(),
                }
            )
        window_start += SUMMARY_FIRST_STATE_WINDOW_SECONDS

    return state_records


def _window_bucket_index(timestamp: float, window_seconds: int) -> int:
    if timestamp <= 0:
        return 0
    return int(max(timestamp - 1e-9, 0) // window_seconds)


def _build_chapter_summaries(
    meeting: dict[str, Any],
    transcript_segments: list[dict[str, Any]],
    *,
    finalize: bool,
) -> list[dict[str, Any]]:
    if not transcript_segments:
        return []

    tenant_id = meeting.get("tenant_id") or DEFAULT_TENANT_ID
    max_timestamp = max(float(segment.get("timestamp_end") or 0) for segment in transcript_segments)
    chapters: list[dict[str, Any]] = []
    chapter_index = 0
    window_start = 0.0

    while window_start < max_timestamp:
        nominal_end = window_start + SUMMARY_FIRST_CHAPTER_WINDOW_SECONDS
        if nominal_end > max_timestamp and not finalize:
            break

        meeting_ended = finalize and nominal_end >= max_timestamp
        candidate_boundaries = [
            float(segment.get("timestamp_end") or 0)
            for segment in transcript_segments
            if abs(float(segment.get("timestamp_end") or 0) - min(nominal_end, max_timestamp)) <= 45
        ]
        window_payload = build_chapter_window_payload(
            window_start=window_start,
            nominal_end=min(nominal_end, max_timestamp),
            candidate_boundaries=candidate_boundaries,
            meeting_ended=meeting_ended,
        )
        chapter_end = min(float(window_payload["window_end"]), max_timestamp)
        chapter_segments = [
            segment
            for segment in transcript_segments
            if float(segment.get("timestamp_start") or 0) < chapter_end and float(segment.get("timestamp_end") or 0) > window_start
        ]
        if not chapter_segments:
            window_start = max(chapter_end, nominal_end)
            continue

        if meeting_ended and not should_keep_partial_window(
            segment_count=len(chapter_segments),
            transcript_text=" ".join(_segment_text(segment) for segment in chapter_segments),
        ):
            break

        rendered_texts = [_segment_text(segment) for segment in chapter_segments if _segment_text(segment)]
        extraction_payload = _build_extraction_payload(chapter_segments)
        chapters.append(
            {
                "id": f"{meeting['id']}:chapter:{chapter_index}",
                "tenant_id": tenant_id,
                "meeting_id": meeting["id"],
                "chapter_index": chapter_index,
                "window_start": window_start,
                "window_end": chapter_end,
                "window_label": window_payload["window_label"],
                "boundary_source": window_payload["boundary_source"],
                "title": _format_topic(rendered_texts[0] if rendered_texts else "", word_limit=5) or f"Chapter {chapter_index + 1}",
                "summary_text": " ".join(rendered_texts[:2]).strip(),
                "decisions": [item["text"] for item in extraction_payload["decisions_forming"]],
                "action_items": [item["text"] for item in extraction_payload["active_action_items"]],
                "open_questions": [item["text"] for item in extraction_payload["open_questions"]],
                "reference_refs": [_segment_ref(segment) for segment in chapter_segments[:4]],
                "created_at": utc_now_iso(),
            }
        )
        chapter_index += 1
        window_start = chapter_end

    return ordered_chapter_summaries(chapters)


def build_summary_first_materialization(
    *,
    meeting: dict[str, Any],
    transcript_segments: list[dict[str, Any]],
    finalize: bool,
) -> dict[str, Any]:
    ordered_segments = sorted(transcript_segments, key=lambda segment: float(segment.get("timestamp_start") or 0))
    meeting_states = _build_state_records(meeting, ordered_segments)
    chapter_summaries = _build_chapter_summaries(meeting, ordered_segments, finalize=finalize)

    generated_records = {"decisions": [], "action_items": [], "open_questions": []}
    for chapter in chapter_summaries:
        chapter_segments = [
            segment
            for segment in ordered_segments
            if float(segment.get("timestamp_start") or 0) < float(chapter["window_end"])
            and float(segment.get("timestamp_end") or 0) > float(chapter["window_start"])
        ]
        chapter_generated = extract_generated_records(
            meeting_id=meeting["id"],
            chapter_summary_id=chapter["id"],
            tenant_id=meeting.get("tenant_id") or DEFAULT_TENANT_ID,
            summary_payload=_build_extraction_payload(chapter_segments),
        )
        for key in generated_records:
            generated_records[key].extend(chapter_generated[key])
    for key in generated_records:
        generated_records[key] = dedupe_generated_records_across_chapters(generated_records[key])

    return {
        "meeting_states": meeting_states,
        "chapter_summaries": chapter_summaries,
        "generated_records": generated_records,
    }


def should_finalize_summary_first_meeting(meeting: dict[str, Any], *, now: datetime | None = None) -> bool:
    status = str(meeting.get("status") or "").strip().lower()
    if should_halt_due_to_explicit_stop(status):
        return True
    if status != "recording":
        return False

    comparison_now = now or utc_now()
    return should_halt_due_to_inactivity(
        parse_datetime(meeting.get("updated_at") or comparison_now.isoformat()),
        comparison_now,
        inactivity_timeout_seconds=SUMMARY_FIRST_INACTIVITY_TIMEOUT_SECONDS,
    )


def should_refresh_summary_first_on_read(
    meeting: dict[str, Any],
    *,
    has_materialized_state: bool,
    has_materialized_chapters: bool,
    latest_state_end: float = 0,
    latest_chapter_end: float = 0,
    now: datetime | None = None,
) -> bool:
    if not should_finalize_summary_first_meeting(meeting, now=now):
        return False
    status = str(meeting.get("status") or "").strip().lower()
    if status == "stopped":
        return not (has_materialized_state and has_materialized_chapters)

    if not has_materialized_state or not has_materialized_chapters:
        return True

    meeting_duration_seconds = float(meeting.get("duration_seconds") or 0)
    if meeting_duration_seconds <= 0:
        return False

    return float(latest_chapter_end or 0) < meeting_duration_seconds and float(latest_state_end or 0) < meeting_duration_seconds


def should_materialize_after_transcription_chunk(*, previous_max_timestamp: float, new_max_timestamp: float) -> bool:
    if new_max_timestamp <= previous_max_timestamp:
        return False

    crossed_state_boundary = _window_bucket_index(previous_max_timestamp, SUMMARY_FIRST_STATE_WINDOW_SECONDS) != _window_bucket_index(
        new_max_timestamp, SUMMARY_FIRST_STATE_WINDOW_SECONDS
    )
    crossed_chapter_boundary = _window_bucket_index(previous_max_timestamp, SUMMARY_FIRST_CHAPTER_WINDOW_SECONDS) != _window_bucket_index(
        new_max_timestamp, SUMMARY_FIRST_CHAPTER_WINDOW_SECONDS
    )
    return crossed_state_boundary or crossed_chapter_boundary


def has_summary_first_materialization(conn: psycopg.Connection, meeting_id: str, tenant_id: str) -> tuple[bool, bool, float, float]:
    with conn.cursor() as cur:
        cur.execute(
            normalize_query("SELECT COUNT(*) AS count, COALESCE(MAX(window_end), 0) AS max_window_end FROM meeting_state WHERE meeting_id = $1 AND tenant_id = $2"),
            (meeting_id, tenant_id),
        )
        state_row = serialize_record(cur.fetchone()) or {}
        state_count = int(state_row.get("count") or 0)
        state_max_window_end = float(state_row.get("max_window_end") or 0)
        cur.execute(
            normalize_query("SELECT COUNT(*) AS count, COALESCE(MAX(window_end), 0) AS max_window_end FROM chapter_summaries WHERE meeting_id = $1 AND tenant_id = $2"),
            (meeting_id, tenant_id),
        )
        chapter_row = serialize_record(cur.fetchone()) or {}
        chapter_count = int(chapter_row.get("count") or 0)
        chapter_max_window_end = float(chapter_row.get("max_window_end") or 0)
    return state_count > 0, chapter_count > 0, state_max_window_end, chapter_max_window_end


async def refresh_summary_first_meeting_memory(
    meeting_id: str,
    actor: AuthUser,
    *,
    finalize: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
        if not meeting:
            return {"meeting_states": [], "chapter_summaries": [], "generated_records": {"decisions": [], "action_items": [], "open_questions": []}}

        should_finalize = finalize or should_finalize_summary_first_meeting(meeting, now=now)
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT id, meeting_id, speaker_label, text, translated_text, timestamp_start, timestamp_end
                FROM transcript_segments
                WHERE meeting_id = $1
                ORDER BY timestamp_start ASC
                """
                ),
                (meeting_id,),
            )
            transcript_segments = serialize_records(cur.fetchall())

        artifacts = build_summary_first_materialization(meeting=meeting, transcript_segments=transcript_segments, finalize=should_finalize)
        tenant_id = meeting.get("tenant_id") or DEFAULT_TENANT_ID

        with conn.cursor() as cur:
            cur.execute(normalize_query("DELETE FROM meeting_state WHERE meeting_id = $1 AND tenant_id = $2"), (meeting_id, tenant_id))
            for record in artifacts["meeting_states"]:
                cur.execute(
                    normalize_query(
                        """
                    INSERT INTO meeting_state (
                        id, tenant_id, meeting_id, window_start, window_end, current_topic, current_goal,
                        summary_bullets, decisions_forming, blockers, open_questions, active_action_items, confidence, created_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14)
                    """
                    ),
                    (
                        record["id"],
                        record["tenant_id"],
                        record["meeting_id"],
                        record["window_start"],
                        record["window_end"],
                        record["current_topic"],
                        record["current_goal"],
                        json.dumps(record["summary_bullets"]),
                        json.dumps(record["decisions_forming"]),
                        json.dumps(record["blockers"]),
                        json.dumps(record["open_questions"]),
                        json.dumps(record["active_action_items"]),
                        record["confidence"],
                        parse_datetime(record["created_at"]),
                    ),
                )

            cur.execute(normalize_query("DELETE FROM chapter_summaries WHERE meeting_id = $1 AND tenant_id = $2"), (meeting_id, tenant_id))
            for chapter in artifacts["chapter_summaries"]:
                cur.execute(
                    normalize_query(
                        """
                    INSERT INTO chapter_summaries (
                        id, tenant_id, meeting_id, chapter_index, window_start, window_end, title, summary_text,
                        decisions, action_items, open_questions, reference_refs, window_label, boundary_source, created_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15)
                    """
                    ),
                    (
                        chapter["id"],
                        chapter["tenant_id"],
                        chapter["meeting_id"],
                        chapter["chapter_index"],
                        chapter["window_start"],
                        chapter["window_end"],
                        chapter["title"],
                        chapter["summary_text"],
                        json.dumps(chapter["decisions"]),
                        json.dumps(chapter["action_items"]),
                        json.dumps(chapter["open_questions"]),
                        json.dumps(chapter["reference_refs"]),
                        chapter["window_label"],
                        chapter["boundary_source"],
                        parse_datetime(chapter["created_at"]),
                    ),
                )

            for table_name in ("decisions", "action_items", "open_questions"):
                cur.execute(
                    normalize_query(f"DELETE FROM {table_name} WHERE meeting_id = $1 AND tenant_id = $2 AND record_origin = 'generated'"),
                    (meeting_id, tenant_id),
                )

            for table_name, records in artifacts["generated_records"].items():
                for record in records:
                    if table_name == "open_questions":
                        cur.execute(
                            normalize_query(
                                """
                            INSERT INTO open_questions (
                                id, tenant_id, meeting_id, chapter_summary_id, text, status, evidence_refs,
                                record_origin, review_status, confidence, promotion_reason, source_window_start, source_window_end,
                                created_at, updated_at
                            )
                            VALUES ($1, $2, $3, $4, $5, 'open', $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14)
                            """
                            ),
                            (
                                record["id"],
                                tenant_id,
                                record["meeting_id"],
                                record["chapter_summary_id"],
                                record["text"],
                                json.dumps(record.get("evidence_refs") or []),
                                record["record_origin"],
                                record["review_status"],
                                record["confidence"],
                                record["promotion_reason"],
                                record.get("source_window_start"),
                                record.get("source_window_end"),
                                utc_now(),
                                utc_now(),
                            ),
                        )
                        continue

                    cur.execute(
                        normalize_query(
                            f"""
                        INSERT INTO {table_name} (
                            id, tenant_id, meeting_id, chapter_summary_id, text, status, owner_user_id, evidence_refs,
                            record_origin, review_status, confidence, promotion_reason, source_window_start, source_window_end,
                            created_at, updated_at
                        )
                        VALUES ($1, $2, $3, $4, $5, 'open', $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15)
                        """
                        ),
                        (
                            record["id"],
                            tenant_id,
                            record["meeting_id"],
                            record["chapter_summary_id"],
                            record["text"],
                            record.get("owner_user_id"),
                            json.dumps(record.get("evidence_refs") or []),
                            record["record_origin"],
                            record["review_status"],
                            record["confidence"],
                            record["promotion_reason"],
                            record.get("source_window_start"),
                            record.get("source_window_end"),
                            utc_now(),
                            utc_now(),
                        ),
                    )
        conn.commit()

    if artifacts["meeting_states"]:
        record_completed_job(owner_user_id=actor.id, meeting_id=meeting_id, job_type="meeting_state_update", stage="stored")
    if artifacts["chapter_summaries"]:
        record_completed_job(owner_user_id=actor.id, meeting_id=meeting_id, job_type="chapter_summary_create", stage="stored")
    return artifacts


async def get_full_transcript_text(meeting_id: str, actor: AuthUser) -> str:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            SELECT speaker_label, text, timestamp_start
            FROM transcript_segments
            WHERE meeting_id = $1 AND owner_user_id = $2
            ORDER BY timestamp_start ASC
            """
                ),
                (meeting_id, actor.id),
            )
            records = cur.fetchall()

    return "\n".join(
        f"[{segment['speaker_label']}] ({float(segment['timestamp_start']):.1f}s): {segment['text']}"
        for segment in records
    )


def build_capability_matrix() -> dict[str, dict[str, bool]]:
    openai_available = bool(OPENAI_API_KEY)
    sarvam_available = bool(SARVAM_API_KEY)
    return {
        "whisper": {
            "transcription": openai_available,
            "translation": openai_available,
            "summarization": openai_available,
            "chat": openai_available,
            "voice_chat": openai_available,
            "tts": openai_available,
        },
        "sarvam": {
            "transcription": sarvam_available,
            "translation": sarvam_available,
            "summarization": False,
            "chat": False,
            "voice_chat": False,
            "tts": False,
        },
    }


@app.on_event("startup")
async def startup() -> None:
    init_db_pool(settings)
    assert_schema_ready()
    if settings.is_oss and not settings.auth_required:
        ensure_oss_user()


@api_router.get("/")
async def root():
    return {
        "message": "Meeting Agent API Running",
        "deployment_mode": settings.deployment_mode,
        "auth_required": settings.auth_required,
    }


@api_router.get("/health")
async def health():
    capability_matrix = build_capability_matrix()
    database_ok = True
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as exc:  # pragma: no cover - runtime integration
        database_ok = False
        logger.warning("Database health check failed: %s", exc)

    storage_ready = get_storage_adapter().provider_ready()
    openai_ready = bool(OPENAI_API_KEY)
    neon_ready = (not settings.is_hosted) or bool(settings.neon_auth_url)
    readiness_failures = []
    if not database_ok:
        readiness_failures.append("database")
    if not openai_ready:
        readiness_failures.append("openai")
    if not neon_ready:
        readiness_failures.append("neon_auth")
    if not storage_ready:
        readiness_failures.append("storage")
    ready = not readiness_failures

    return {
        "api": True,
        "database": database_ok,
        "database_type": "postgresql",
        "database_provider": settings.database_provider,
        "deployment_mode": settings.deployment_mode,
        "auth_required": settings.auth_required,
        "ready": ready,
        "public_baseline_ready": ready,
        "storage": {
            "backend": settings.storage_backend,
            "base_path": settings.storage_base_path,
        },
        "limits": {
            "upload_max_bytes": settings.upload_max_bytes,
            "request_timeout_seconds": settings.request_timeout_seconds,
        },
        "providers": {
            "openai": {"configured": openai_ready},
            "sarvam": {"configured": bool(SARVAM_API_KEY)},
            "neon_auth": {"configured": neon_ready},
            "storage": {"configured": storage_ready},
        },
        "readiness": {
            "database": database_ok,
            "openai": openai_ready,
            "neon_auth": neon_ready,
            "storage": storage_ready,
            "failures": readiness_failures,
        },
        "capabilities": capability_matrix,
        "openai_configured": openai_ready,
        "sarvam_configured": bool(SARVAM_API_KEY),
    }


@api_router.get("/runtime-config")
async def runtime_config():
    capability_matrix = build_capability_matrix()
    from backend.routes.auth import auth_provider_names
    from backend.routes.runtime import build_runtime_config_payload

    return build_runtime_config_payload(
        deployment_mode=settings.deployment_mode,
        auth_required=settings.auth_required,
        auth_provider=settings.auth_provider,
        supported_auth_providers=list(auth_provider_names(settings.auth_provider)),
        tenant_mode=settings.tenant_mode,
        organization_required=settings.organization_required,
        onboarding_required=settings.onboarding_required,
        backend_url=settings.runtime_backend_url,
        hosted_auth_url=settings.neon_auth_url,
        database_provider=settings.database_provider,
        storage_backend=settings.storage_backend,
        raw_audio_retention_days=settings.raw_audio_retention_days,
        transcript_retention_days=settings.transcript_retention_days,
        derived_retention_days=settings.derived_retention_days,
        state_window_seconds=settings.summary_first_state_window_seconds,
        chapter_window_seconds=settings.summary_first_chapter_window_seconds,
        inactivity_timeout_seconds=settings.summary_first_inactivity_timeout_seconds,
        retrieval_corpus=settings.history_retrieval_corpus,
        retrieval_ranking_profile=settings.history_ranking_profile,
        capabilities=capability_matrix,
        engines=[
            {
                **provider.descriptor(),
                "status": "available" if provider.available else "unavailable",
                "capabilities": capability_matrix.get(provider.id, {}),
            }
            for provider in SPEECH_PROVIDERS.values()
        ],
    )


@api_router.post("/storage/audio/session")
async def create_audio_storage_session(
    data: AudioStorageSessionRequest,
    actor: AuthUser = Depends(require_authenticated_actor),
):
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, data.meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not should_archive_raw_audio(settings):
        raise HTTPException(status_code=409, detail="Audio archival is disabled")

    storage_adapter = get_storage_adapter()
    if not storage_adapter.provider_ready():
        raise HTTPException(status_code=503, detail="Hosted storage is not ready")

    session = storage_adapter.create_audio_upload_target(
        meeting_id=data.meeting_id,
        filename=data.filename,
        content_type=data.content_type,
        retention_days=settings.raw_audio_retention_days,
        expires_in_seconds=data.expires_in_seconds,
    )
    return {
        **session,
        "retention_days": settings.raw_audio_retention_days,
    }


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(data: AuthRegisterRequest):
    if settings.is_hosted:
        raise HTTPException(status_code=400, detail="Tenant assignment is required")

    existing = fetch_user_by_email(data.email.strip().lower())
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")

    user = AuthUser(
        id=str(uuid.uuid4()),
        email=data.email.strip().lower(),
        name=(data.name or "").strip() or None,
        tenant_id=DEFAULT_TENANT_ID,
        is_authenticated=True,
    )
    now = utc_now()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                INSERT INTO users (id, email, password_hash, name, tenant_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """
                ),
                (
                    user.id,
                    user.email,
                    hash_password(data.password),
                    user.name,
                    user.tenant_id,
                    now,
                    now,
                ),
            )

    return AuthResponse(access_token=create_token_for_user(user), user=user)


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(data: AuthLoginRequest):
    if settings.is_oss and not settings.auth_required:
        raise HTTPException(status_code=400, detail="Login is disabled in OSS mode")

    user_record = fetch_user_by_email(data.email.strip().lower())
    if not user_record or not verify_password(data.password, user_record["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    if settings.is_hosted and not user_record.get("tenant_id"):
        raise HTTPException(status_code=401, detail="Tenant assignment is required")

    user = AuthUser(
        id=user_record["id"],
        email=user_record["email"],
        name=user_record.get("name"),
        tenant_id=user_record.get("tenant_id") or DEFAULT_TENANT_ID,
        is_authenticated=True,
    )
    return AuthResponse(access_token=create_token_for_user(user), user=user)


@api_router.post("/auth/session/exchange", response_model=AuthResponse)
async def exchange_hosted_session(data: HostedSessionExchangeRequest):
    if not settings.is_hosted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    configured_provider = str(settings.auth_provider).strip().lower()
    requested_provider = (data.provider or configured_provider).strip().lower()
    if requested_provider != configured_provider:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hosted auth provider mismatch")

    try:
        user = provision_hosted_user_from_provider_token(
            data.provider_token,
            provider=configured_provider,
        )
        return AuthResponse(access_token=create_hosted_app_token(user), user=user)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.detail) from exc


@api_router.get("/auth/me", response_model=AuthUser)
async def get_me(actor: AuthUser = Depends(get_request_actor)):
    return actor


@api_router.get("/auth/onboarding/state", response_model=HostedOnboardingStateResponse)
async def get_onboarding_state(actor: AuthUser = Depends(get_hosted_onboarding_actor)):
    current_settings = settings
    if not current_settings.is_hosted:
        reloaded_settings = load_settings()
        if reloaded_settings.is_hosted:
            current_settings = reloaded_settings
    user_record = fetch_user_by_id(actor.id)
    if user_record is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Hosted user is not provisioned")
    membership = fetch_active_organization_membership(actor.id)
    tenant_id = str(actor.tenant_id or (membership or {}).get("tenant_id") or user_record.get("tenant_id") or "").strip() or None
    organization = fetch_tenant_by_id(tenant_id) if tenant_id else None
    needs_onboarding = current_settings.is_hosted and not tenant_id
    return {
        "needs_onboarding": needs_onboarding,
        "organization": (
            {
                "id": organization["id"],
                "name": organization["name"],
                "slug": organization.get("slug"),
            }
            if organization
            else None
        ),
        "requires_session_refresh": False,
        "message": None,
    }


@api_router.post("/auth/onboarding/organizations", response_model=HostedOnboardingResponse)
async def create_onboarding_organization(
    data: HostedOnboardingOrganizationRequest,
    actor: AuthUser = Depends(get_hosted_onboarding_actor),
):
    tenant_id = resolve_hosted_tenant_context(actor)
    if tenant_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Organization already assigned")

    requested_name = data.name.strip()
    requested_slug = data.slug.strip() if data.slug else None
    organization_id = ""
    if requested_slug:
        resolved_slug = build_tenant_slug("pending-hosted-org", requested_name, requested_slug)
        existing_tenant = fetch_tenant_by_identifier(resolved_slug)
        if existing_tenant:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Organization slug '{resolved_slug}' is already taken. Choose a different name or slug.",
            )

    organization_id = str(uuid.uuid4())
    original_user = fetch_user_by_id(actor.id)
    original_tenant_id = str((original_user or {}).get("tenant_id") or "").strip() or None
    created_tenant = None
    updated_user = None

    def rollback_internal_organization_state() -> None:
        try:
            restore_hosted_user_tenant(actor.id, original_tenant_id)
            if created_tenant is not None:
                delete_tenant_record(created_tenant["id"])
        except Exception as rollback_exc:
            logger.error(
                "Hosted internal organization rollback failed: organization_id=%s organization_name=%s",
                organization_id,
                requested_name,
                exc_info=rollback_exc,
            )

    try:
        created_tenant = upsert_tenant_record(
            organization_id,
            requested_name,
            requested_slug,
        )
        updated_user = upsert_hosted_user_record(actor, created_tenant["id"])
        membership = upsert_organization_membership(
            tenant_id=created_tenant["id"],
            user_id=str(updated_user["id"]),
            role="admin",
            status="active",
            invited_by_user_id=str(updated_user["id"]),
        )
    except HTTPException:
        if created_tenant is not None or updated_user is not None:
            rollback_internal_organization_state()
        raise
    except Exception as exc:
        if created_tenant is not None or updated_user is not None:
            rollback_internal_organization_state()
        logger.error(
            "Internal organization provisioning failed: organization_id=%s organization_name=%s",
            organization_id,
            requested_name,
            exc_info=exc,
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Internal organization provisioning failed") from exc
    user = AuthUser(
        id=updated_user["id"],
        email=updated_user.get("email") or actor.email,
        name=updated_user.get("name") or actor.name,
        tenant_id=created_tenant["id"],
        org_id=created_tenant["id"],
        role=membership.get("role") or "admin",
        permissions=list(getattr(actor, "permissions", ())),
        is_authenticated=True,
    )
    return {
        "organization": {
            "id": created_tenant["id"],
            "name": created_tenant["name"],
            "slug": created_tenant.get("slug"),
        },
        "user": user,
        "access_token": create_hosted_app_token(user),
        "requires_session_refresh": False,
    }


@api_router.post("/auth/onboarding/invitations", response_model=HostedOnboardingInvitationResponse)
async def create_onboarding_invitation(
    data: HostedOnboardingInvitationCreateRequest,
    actor: AuthUser = Depends(require_authenticated_actor),
):
    if not settings.is_hosted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    membership = fetch_active_organization_membership(actor.id)
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active organization membership is required",
        )

    tenant_id = str(membership.get("tenant_id") or "").strip() or None
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Organization onboarding is still required")

    if str(membership.get("role") or "").strip().lower() != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only organization admins can send invites")

    organization = fetch_tenant_by_id(tenant_id)
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    invitation = create_organization_invitation(
        tenant_id=tenant_id,
        email=data.email,
        role=data.role,
        invited_by_user_id=actor.id,
    )
    return {
        "organization": {
            "id": organization["id"],
            "name": organization["name"],
            "slug": organization.get("slug"),
        },
        "invitation": {
            "id": invitation["id"],
            "email": invitation["email"],
            "role": invitation["role"],
            "invite_token": invitation["invite_token"],
            "expires_at": invitation.get("expires_at"),
        },
    }


@api_router.post("/auth/onboarding/invitations/accept", response_model=HostedOnboardingResponse)
async def accept_onboarding_invitation(
    data: HostedOnboardingInvitationAcceptRequest,
    actor: AuthUser = Depends(get_hosted_onboarding_actor),
):
    tenant_id = resolve_hosted_tenant_context(actor)
    if tenant_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Organization already assigned")

    invitation = find_organization_invitation_by_token(data.invite_token.strip())
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found or expired")

    invited_email = str(invitation.get("email") or "").strip().lower()
    actor_email = str(actor.email or "").strip().lower()
    if invited_email and (not actor_email or invited_email != actor_email):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invitation does not match authenticated user")

    invitation_id = str(invitation.get("id") or "").strip()
    organization_id = str(invitation.get("tenant_id") or "").strip()
    if not invitation_id or not organization_id:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invitation record is incomplete")
    organization = fetch_tenant_by_id(organization_id)
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                updated_user = _upsert_hosted_user_record_with_cursor(cur, actor, organization_id)
                accepted_invitation = _mark_organization_invitation_accepted_with_cursor(
                    cur,
                    invitation_id,
                    str(updated_user["id"]),
                )
                if accepted_invitation is None:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invitation already accepted")
                membership = _upsert_organization_membership_with_cursor(
                    cur,
                    tenant_id=organization_id,
                    user_id=str(updated_user["id"]),
                    role=str(invitation.get("role") or "member"),
                    status="active",
                    invited_by_user_id=str(invitation.get("invited_by_user_id") or "").strip() or None,
                )
        user = AuthUser(
            id=updated_user["id"],
            email=updated_user.get("email") or actor.email,
            name=updated_user.get("name") or actor.name,
            tenant_id=organization_id,
            org_id=organization_id,
            role=membership.get("role") or "member",
            permissions=list(getattr(actor, "permissions", ())),
            is_authenticated=True,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Internal invitation acceptance failed: invitation_id=%s tenant_id=%s",
            invitation_id,
            organization_id,
            exc_info=exc,
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Internal invitation acceptance failed") from exc
    return {
        "organization": {
            "id": organization["id"],
            "name": organization["name"],
            "slug": organization.get("slug"),
        },
        "user": user,
        "access_token": create_hosted_app_token(user),
        "requires_session_refresh": False,
    }


@api_router.post("/meetings", response_model=Meeting)
async def create_meeting(data: MeetingCreate, actor: AuthUser = Depends(require_authenticated_actor)):
    engine = data.engine if data.engine in SPEECH_PROVIDERS else "whisper"
    meeting = Meeting(title=data.title, engine=engine)
    tenant_id = resolve_actor_tenant_scope(actor)
    is_hosted = getattr(settings, "is_hosted", getattr(settings, "deployment_mode", "oss") == "hosted")
    if is_hosted and not tenant_id:
        raise HTTPException(status_code=403, detail="Complete organization setup before creating meetings")
    tenant_id = tenant_id or DEFAULT_TENANT_ID
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            INSERT INTO meetings (
                id, owner_user_id, tenant_id, title, status, engine, created_at, updated_at, duration_seconds, segment_count
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """
                ),
                (
                    meeting.id,
                    actor.id,
                    tenant_id,
                    meeting.title,
                    meeting.status,
                    meeting.engine,
                    parse_datetime(meeting.created_at),
                    parse_datetime(meeting.updated_at),
                    meeting.duration_seconds,
                    meeting.segment_count,
                ),
            )
    reset_speaker_tracker(meeting.id)
    return meeting


@api_router.get("/engines")
async def list_engines():
    capability_matrix = build_capability_matrix()
    return {
        "deployment_mode": settings.deployment_mode,
        "engines": [
            {
                **provider.descriptor(),
                "status": "available" if provider.available else "unavailable",
                "capabilities": capability_matrix.get(provider.id, {}),
            }
            for provider in SPEECH_PROVIDERS.values()
        ],
    }


@api_router.get("/meetings", response_model=list[Meeting])
async def list_meetings(actor: AuthUser = Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT *
                FROM meetings
                WHERE owner_user_id = $1
                ORDER BY created_at DESC
                LIMIT 500
                """
                ),
                (actor.id,),
            )
            records = cur.fetchall()
    return serialize_records(records)


@api_router.get("/meetings/{meeting_id}", response_model=Meeting)
async def get_meeting(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@api_router.put("/meetings/{meeting_id}", response_model=Meeting)
async def update_meeting(
    meeting_id: str,
    data: MeetingUpdate,
    actor: AuthUser = Depends(require_authenticated_actor),
):
    update_dict = {key: value for key, value in data.model_dump().items() if value is not None}
    if "engine" in update_dict and update_dict["engine"] not in SPEECH_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported engine")

    if data.status == "recording":
        reset_speaker_tracker(meeting_id)

    update_dict["updated_at"] = utc_now()
    if not update_dict:
        with get_db_connection() as conn:
            meeting = fetch_meeting(conn, meeting_id, actor)
    else:
        columns = list(update_dict.keys())
        assignments = ", ".join(f"{column} = %s" for column in columns)
        values = [*[update_dict[column] for column in columns], meeting_id, actor.id]
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE meetings SET {assignments} WHERE id = %s AND owner_user_id = %s RETURNING *",
                    tuple(values),
                )
                meeting = serialize_record(cur.fetchone())

    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if data.status == "stopped":
        await refresh_summary_first_meeting_memory(meeting_id, actor, finalize=True)
    return meeting


@api_router.delete("/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query("DELETE FROM meetings WHERE id = $1 AND owner_user_id = $2"),
                (meeting_id, actor.id),
            )
    reset_speaker_tracker(meeting_id)
    return {"deleted": True}


@api_router.post("/meetings/{meeting_id}/transcribe")
async def transcribe_audio(
    meeting_id: str,
    audio: UploadFile = File(...),
    chunk_index: int = Form(default=0),
    elapsed_seconds: float = Form(default=0.0),
    chunk_duration_seconds: float = Form(default=0.0),
    actor: AuthUser = Depends(require_authenticated_actor),
):
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    engine = meeting.get("engine", "whisper")
    provider = get_speech_provider(engine)

    suffix = ".webm"
    if audio.content_type and "wav" in audio.content_type:
        suffix = ".wav"
    elif audio.content_type and "mp4" in audio.content_type:
        suffix = ".mp4"

    audio_bytes = await audio.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
        tmp_file.write(audio_bytes)
        tmp_path = tmp_file.name

    try:
        archived_audio = archive_audio_chunk(
            meeting=meeting,
            filename=audio.filename or f"chunk-{chunk_index}{suffix}",
            content_type=audio.content_type or "application/octet-stream",
            chunk_index=chunk_index,
            chunk_duration_seconds=chunk_duration_seconds,
            payload=audio_bytes,
        )
        segments_data = await provider.transcribe(
            file_path=tmp_path,
            meeting_id=meeting_id,
            elapsed_seconds=elapsed_seconds,
            chunk_duration_seconds=chunk_duration_seconds,
        )
        if not segments_data:
            return {"segments": [], "message": "No speech detected", "engine": engine}
        segments_data = await batch_translate_segments_to_english(segments_data)
        previous_max_timestamp = float(meeting.get("duration_seconds") or 0)

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(
                    normalize_query(
                        """
                    INSERT INTO transcript_segments (
                        id, owner_user_id, meeting_id, speaker_label, text, timestamp_start, timestamp_end,
                        created_at, language_code, translated_text
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    """
                    ),
                    [
                        (
                            segment["id"],
                            actor.id,
                            segment["meeting_id"],
                            segment["speaker_label"],
                            segment["text"],
                            segment["timestamp_start"],
                            segment["timestamp_end"],
                            parse_datetime(segment["created_at"]),
                            segment["language_code"],
                            segment.get("translated_text"),
                        )
                        for segment in segments_data
                    ],
                )
                cur.execute(
                    normalize_query(
                        "SELECT COUNT(*) AS count FROM transcript_segments WHERE meeting_id = $1 AND owner_user_id = $2"
                    ),
                    (meeting_id, actor.id),
                )
                count = cur.fetchone()["count"]
                max_timestamp = max(segment["timestamp_end"] for segment in segments_data)
                cur.execute(
                    """
                    UPDATE meetings
                    SET segment_count = %s, duration_seconds = %s, updated_at = %s
                    WHERE id = %s AND owner_user_id = %s
                    """,
                    (
                        int(count or 0),
                        int(max(elapsed_seconds, max_timestamp)),
                        utc_now(),
                        meeting_id,
                        actor.id,
                    ),
                )
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="transcription",
            stage="stored",
        )
        if should_materialize_after_transcription_chunk(
            previous_max_timestamp=previous_max_timestamp,
            new_max_timestamp=float(max_timestamp),
        ):
            await refresh_summary_first_meeting_memory(meeting_id, actor, finalize=False)

        return {
            "segments": segments_data,
            "engine": engine,
            "chunk_index": chunk_index,
            "archived_audio": archived_audio,
        }
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - integration surface
        logger.error("Transcription error (%s): %s", engine, exc)
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="transcription",
            stage="failed",
            error=str(exc),
        )
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed ({engine}): {exc}",
        ) from exc
    finally:
        with suppress(FileNotFoundError):
            os.unlink(tmp_path)


@api_router.get("/meetings/{meeting_id}/transcript")
async def get_transcript(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            SELECT *
            FROM transcript_segments
            WHERE meeting_id = $1 AND owner_user_id = $2
            ORDER BY timestamp_start ASC
            """
                ),
                (meeting_id, actor.id),
            )
            records = cur.fetchall()
    return {"segments": serialize_records(records)}


@api_router.post("/meetings/{meeting_id}/summary")
async def generate_summary(
    meeting_id: str,
    actor: AuthUser = Depends(require_authenticated_actor),
):
    transcript_text = await get_full_transcript_text(meeting_id, actor)
    if not transcript_text:
        raise HTTPException(status_code=400, detail="No transcript available for this meeting")

    system_message = """You are an expert meeting analyst. Given a meeting transcript, produce:
1. A concise summary (2-4 paragraphs)
2. A list of action items (each on its own line, prefixed with "- ACTION: ")
3. A list of key topics discussed (each on its own line, prefixed with "- TOPIC: ")

Format your response exactly as:
## Summary
[summary text]

## Action Items
- ACTION: [item]

## Key Topics
- TOPIC: [topic]"""

    try:
        response_text = await create_text_response(
            system_message,
            f"Please analyze this meeting transcript:\n\n{transcript_text[:15000]}",
        )
        summary_text, action_items, key_topics = parse_summary_sections(response_text)
        summary = SummaryResponse(
            meeting_id=meeting_id,
            summary_text=summary_text,
            action_items=action_items,
            key_topics=key_topics,
        )

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    normalize_query(
                        """
                INSERT INTO summaries (
                    id, owner_user_id, meeting_id, summary_text, action_items, key_topics, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (meeting_id)
                DO UPDATE SET
                    id = EXCLUDED.id,
                    owner_user_id = EXCLUDED.owner_user_id,
                    summary_text = EXCLUDED.summary_text,
                    action_items = EXCLUDED.action_items,
                    key_topics = EXCLUDED.key_topics,
                    created_at = EXCLUDED.created_at
                RETURNING *
                """
                    ),
                    (
                        summary.id,
                        actor.id,
                        summary.meeting_id,
                        summary.summary_text,
                        summary.action_items,
                        summary.key_topics,
                        parse_datetime(summary.created_at),
                    ),
                )
                record = cur.fetchone()
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="summary",
            stage="stored",
        )
        return serialize_record(record)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - integration surface
        logger.error("Summary generation error: %s", exc)
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="summary",
            stage="failed",
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=f"Summary generation failed: {exc}") from exc


@api_router.get("/meetings/{meeting_id}/summary")
async def get_summary(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query("SELECT * FROM summaries WHERE meeting_id = $1 AND owner_user_id = $2"),
                (meeting_id, actor.id),
            )
            record = cur.fetchone()
    if not record:
        return {"summary_text": "", "action_items": [], "key_topics": []}
    return serialize_record(record)


@api_router.get("/meetings/{meeting_id}/state/current")
async def get_current_meeting_state(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    from backend.routes.state import build_state_payload

    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        tenant_id = meeting.get("tenant_id") or DEFAULT_TENANT_ID
        has_state, has_chapters, latest_state_end, latest_chapter_end = has_summary_first_materialization(conn, meeting_id, tenant_id)
    if should_refresh_summary_first_on_read(
        meeting,
        has_materialized_state=has_state,
        has_materialized_chapters=has_chapters,
        latest_state_end=latest_state_end,
        latest_chapter_end=latest_chapter_end,
    ):
        await refresh_summary_first_meeting_memory(meeting_id, actor, finalize=True)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT *
                FROM meeting_state
                WHERE meeting_id = $1
                ORDER BY created_at DESC
                LIMIT 1
                """
                ),
                (meeting_id,),
            )
            record = serialize_record(cur.fetchone())

    return build_state_payload(record)


@api_router.get("/meetings/{meeting_id}/chapters")
async def get_meeting_chapters(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    from backend.routes.chapters import build_chapter_list_payload

    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        tenant_id = meeting.get("tenant_id") or DEFAULT_TENANT_ID
        has_state, has_chapters, latest_state_end, latest_chapter_end = has_summary_first_materialization(conn, meeting_id, tenant_id)
    if should_refresh_summary_first_on_read(
        meeting,
        has_materialized_state=has_state,
        has_materialized_chapters=has_chapters,
        latest_state_end=latest_state_end,
        latest_chapter_end=latest_chapter_end,
    ):
        await refresh_summary_first_meeting_memory(meeting_id, actor, finalize=True)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT *
                FROM chapter_summaries
                WHERE meeting_id = $1
                ORDER BY chapter_index ASC, created_at ASC
                """
                ),
                (meeting_id,),
            )
            records = serialize_records(cur.fetchall())

    return build_chapter_list_payload(records)


@api_router.get("/meetings/{meeting_id}/chapters/{chapter_id}")
async def get_meeting_chapter(
    meeting_id: str,
    chapter_id: str,
    actor: AuthUser = Depends(require_authenticated_actor),
):
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT *
                FROM chapter_summaries
                WHERE meeting_id = $1 AND id = $2
                LIMIT 1
                """
                ),
                (meeting_id, chapter_id),
            )
            record = serialize_record(cur.fetchone())

    if not record:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return record


@api_router.get("/meetings/{meeting_id}/recent-lines")
async def get_recent_lines(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    from backend.routes.state import build_recent_lines_payload

    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
                SELECT speaker_label, text, translated_text, timestamp_start
                FROM transcript_segments
                WHERE meeting_id = $1
                ORDER BY timestamp_start DESC
                LIMIT 12
                """
                ),
                (meeting_id,),
            )
            records = serialize_records(cur.fetchall())

    return build_recent_lines_payload(records)


def _list_generated_records(meeting_id: str, table_name: str, *, tenant_id: str) -> list[dict[str, Any]]:
    allowed_tables = {"decisions", "action_items", "open_questions"}
    if table_name not in allowed_tables:
        raise ValueError(f"Unsupported generated record table: {table_name}")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                f"""
                SELECT *
                FROM {table_name}
                WHERE meeting_id = $1
                  AND tenant_id = $2
                ORDER BY created_at DESC
                """
                ),
                (meeting_id, tenant_id),
            )
            return serialize_records(cur.fetchall())


@api_router.get("/meetings/{meeting_id}/decisions")
async def get_decisions(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    from backend.routes.meetings import build_generated_items_payload

    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    tenant_id = meeting.get("tenant_id") or resolve_actor_tenant_scope(actor) or DEFAULT_TENANT_ID
    return build_generated_items_payload(
        _list_generated_records(meeting_id, "decisions", tenant_id=tenant_id)
    )


@api_router.get("/meetings/{meeting_id}/action-items")
async def get_action_items(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    from backend.routes.meetings import build_generated_items_payload

    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    tenant_id = meeting.get("tenant_id") or resolve_actor_tenant_scope(actor) or DEFAULT_TENANT_ID
    return build_generated_items_payload(
        _list_generated_records(meeting_id, "action_items", tenant_id=tenant_id)
    )


@api_router.get("/meetings/{meeting_id}/open-questions")
async def get_open_questions(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    from backend.routes.meetings import build_generated_items_payload

    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    tenant_id = meeting.get("tenant_id") or resolve_actor_tenant_scope(actor) or DEFAULT_TENANT_ID
    return build_generated_items_payload(
        _list_generated_records(meeting_id, "open_questions", tenant_id=tenant_id)
    )


@api_router.post("/meetings/{meeting_id}/chat")
async def chat_about_meeting(
    meeting_id: str,
    data: ChatMessageCreate,
    actor: AuthUser = Depends(require_authenticated_actor),
):
    transcript_text = await get_full_transcript_text(meeting_id, actor)
    if not transcript_text:
        raise HTTPException(status_code=400, detail="No transcript available for this meeting")

    user_msg_doc = ChatMessage(
        meeting_id=meeting_id,
        role="user",
        content=data.content,
    ).model_dump()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            INSERT INTO chat_messages (id, owner_user_id, meeting_id, role, content, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            """
                ),
                (
                    user_msg_doc["id"],
                    actor.id,
                    user_msg_doc["meeting_id"],
                    user_msg_doc["role"],
                    user_msg_doc["content"],
                    parse_datetime(user_msg_doc["created_at"]),
                ),
            )

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    normalize_query(
                        """
                    SELECT *
                    FROM chat_messages
                    WHERE meeting_id = $1 AND owner_user_id = $2
                    ORDER BY created_at ASC
                    LIMIT 50
                    """
                    ),
                    (meeting_id, actor.id),
                )
                history = serialize_records(cur.fetchall())
        history_text = "\n".join(
            f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content']}"
            for msg in history[:-1]
        )

        system_message = f"""You are an expert meeting assistant. You have access to a meeting transcript and must answer questions about it accurately and helpfully.

MEETING TRANSCRIPT:
{transcript_text[:12000]}

PREVIOUS CONVERSATION:
{history_text}

Answer questions based on the transcript. Be specific, cite speaker labels and times when relevant. If information isn't in the transcript, say so clearly."""

        response_text = await create_text_response(system_message, data.content)
        assistant_doc = ChatMessage(
            meeting_id=meeting_id,
            role="assistant",
            content=response_text,
        ).model_dump()

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    normalize_query(
                        """
                INSERT INTO chat_messages (id, owner_user_id, meeting_id, role, content, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                """
                    ),
                    (
                        assistant_doc["id"],
                        actor.id,
                        assistant_doc["meeting_id"],
                        assistant_doc["role"],
                        assistant_doc["content"],
                        parse_datetime(assistant_doc["created_at"]),
                    ),
                )
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="chat",
            stage="stored",
        )
        return assistant_doc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - integration surface
        logger.error("Chat error: %s", exc)
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="chat",
            stage="failed",
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=f"Chat failed: {exc}") from exc


@api_router.get("/meetings/{meeting_id}/chat")
async def get_chat_history(meeting_id: str, actor: AuthUser = Depends(require_authenticated_actor)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            SELECT *
            FROM chat_messages
            WHERE meeting_id = $1 AND owner_user_id = $2
            ORDER BY created_at ASC
            LIMIT 200
            """
                ),
                (meeting_id, actor.id),
            )
            records = cur.fetchall()
    return {"messages": serialize_records(records)}


@api_router.post("/meetings/{meeting_id}/voice-chat")
async def voice_chat_about_meeting(
    meeting_id: str,
    audio: UploadFile = File(...),
    actor: AuthUser = Depends(require_authenticated_actor),
):
    transcript_text = await get_full_transcript_text(meeting_id, actor)
    if not transcript_text:
        raise HTTPException(status_code=400, detail="No transcript available for this meeting")

    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    suffix = ".webm"
    if audio.content_type and "wav" in audio.content_type:
        suffix = ".wav"
    elif audio.content_type and "mp4" in audio.content_type:
        suffix = ".mp4"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
        tmp_file.write(await audio.read())
        tmp_path = tmp_file.name

    try:
        question_text = ""
        engine = meeting.get("engine", "whisper")
        if engine == "sarvam" and SARVAM_API_KEY:
            try:
                question_segments = await SPEECH_PROVIDERS["sarvam"].transcribe(
                    file_path=tmp_path,
                    meeting_id=f"voice-{meeting_id}",
                    elapsed_seconds=0.0,
                )
                question_text = " ".join(seg["text"] for seg in question_segments).strip()
            except Exception as exc:  # pragma: no cover - integration surface
                logger.warning("Sarvam STT failed, falling back to OpenAI transcription: %s", exc)

        if not question_text:
            question_text = await transcribe_question_with_openai(tmp_path)

        if not question_text:
            return {"error": "Could not understand the question. Please try again."}

        user_msg_doc = ChatMessage(
            meeting_id=meeting_id,
            role="user",
            content=question_text,
        ).model_dump()
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    normalize_query(
                        """
                INSERT INTO chat_messages (id, owner_user_id, meeting_id, role, content, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                """
                    ),
                    (
                        user_msg_doc["id"],
                        actor.id,
                        user_msg_doc["meeting_id"],
                        user_msg_doc["role"],
                        user_msg_doc["content"],
                        parse_datetime(user_msg_doc["created_at"]),
                    ),
                )

        answer_text = await create_text_response(
            f"""You are a helpful meeting assistant. Answer questions about the meeting concisely and clearly. Keep responses brief (2-4 sentences) since they will be read aloud.

MEETING TRANSCRIPT:
{transcript_text[:12000]}""",
            question_text,
        )

        assistant_doc = ChatMessage(
            meeting_id=meeting_id,
            role="assistant",
            content=answer_text,
        ).model_dump()
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    normalize_query(
                        """
                INSERT INTO chat_messages (id, owner_user_id, meeting_id, role, content, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                """
                    ),
                    (
                        assistant_doc["id"],
                        actor.id,
                        assistant_doc["meeting_id"],
                        assistant_doc["role"],
                        assistant_doc["content"],
                        parse_datetime(assistant_doc["created_at"]),
                    ),
                )
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="voice_chat",
            stage="stored",
        )

        return {
            "question_text": question_text,
            "answer_text": answer_text,
            "audio_base64": await generate_speech_base64(answer_text),
            "message": assistant_doc,
        }
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - integration surface
        logger.error("Voice chat error: %s", exc)
        record_completed_job(
            owner_user_id=actor.id,
            meeting_id=meeting_id,
            job_type="voice_chat",
            stage="failed",
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=f"Voice chat failed: {exc}") from exc
    finally:
        with suppress(FileNotFoundError):
            os.unlink(tmp_path)


@api_router.get("/meetings/search/transcripts")
async def search_transcripts(q: str = "", actor: AuthUser = Depends(require_authenticated_actor)):
    if not q or len(q.strip()) < 2:
        return {"results": []}

    safe_query = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            SELECT *
            FROM transcript_segments
            WHERE text ILIKE '%' || $1 || '%' ESCAPE '\\' AND owner_user_id = $2
            ORDER BY meeting_id ASC, timestamp_start ASC
            LIMIT 100
            """
                ),
                (safe_query, actor.id),
            )
            segment_records = cur.fetchall()

        segments = serialize_records(segment_records)
        meeting_ids = sorted({segment["meeting_id"] for segment in segments})
        if meeting_ids:
            cur.execute(
                normalize_query("SELECT * FROM meetings WHERE id = ANY($1::text[]) AND owner_user_id = $2"),
                (meeting_ids, actor.id),
            )
            meeting_records = cur.fetchall()
            meeting_map = {
                meeting["id"]: meeting for meeting in serialize_records(meeting_records)
            }
        else:
            meeting_map = {}

    results = []
    for meeting_id in meeting_ids:
        matching_segments = [segment for segment in segments if segment["meeting_id"] == meeting_id]
        results.append(
            {
                "meeting": meeting_map.get(meeting_id, {}),
                "matching_segments": matching_segments[:5],
                "match_count": len(matching_segments),
            }
        )

    return {"results": results}


@api_router.get("/meetings/{meeting_id}/export")
async def export_transcript(
    meeting_id: str,
    format: str = "txt",
    actor: AuthUser = Depends(require_authenticated_actor),
):
    with get_db_connection() as conn:
        meeting = fetch_meeting(conn, meeting_id, actor)
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")

        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            SELECT *
            FROM transcript_segments
            WHERE meeting_id = $1 AND owner_user_id = $2
            ORDER BY timestamp_start ASC
            """
                ),
                (meeting_id, actor.id),
            )
            records = cur.fetchall()
        segments = serialize_records(records)

    if format == "json":
        return {"meeting": meeting, "segments": segments}

    lines = [
        f"Meeting: {meeting['title']}",
        f"Date: {meeting['created_at']}",
        f"Duration: {meeting.get('duration_seconds', 0)}s",
        "",
    ]
    for segment in segments:
        timestamp = float(segment.get("timestamp_start", 0))
        mins = int(timestamp // 60)
        secs = int(timestamp % 60)
        lines.append(
            f"[{segment['speaker_label']}] ({mins:02d}:{secs:02d}) {segment['text']}"
        )
    return {"content": "\n".join(lines), "filename": f"{meeting['title'].replace(' ', '_')}.txt"}


@api_router.put("/meetings/{meeting_id}/segments/{segment_id}/speaker")
async def update_speaker_label(
    meeting_id: str,
    segment_id: str,
    speaker_label: str = Form(...),
    actor: AuthUser = Depends(require_authenticated_actor),
):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            UPDATE transcript_segments
            SET speaker_label = $3
            WHERE id = $1 AND meeting_id = $2 AND owner_user_id = $4
            """
                ),
                (segment_id, meeting_id, speaker_label, actor.id),
            )
    return {"updated": True}


SARVAM_LANGUAGES = [
    {"code": "en-IN", "name": "English"},
    {"code": "hi-IN", "name": "Hindi"},
    {"code": "ta-IN", "name": "Tamil"},
    {"code": "te-IN", "name": "Telugu"},
    {"code": "kn-IN", "name": "Kannada"},
    {"code": "ml-IN", "name": "Malayalam"},
    {"code": "mr-IN", "name": "Marathi"},
    {"code": "gu-IN", "name": "Gujarati"},
    {"code": "bn-IN", "name": "Bengali"},
    {"code": "pa-IN", "name": "Punjabi"},
    {"code": "or-IN", "name": "Odia"},
    {"code": "ur-IN", "name": "Urdu"},
]


@api_router.get("/languages")
async def list_languages():
    return {"languages": SARVAM_LANGUAGES, "sarvam_available": bool(SARVAM_API_KEY)}


@api_router.post("/translate")
async def translate_text(
    data: TranslateRequest,
    actor: AuthUser = Depends(require_authenticated_actor),
):
    if not SARVAM_API_KEY:
        raise HTTPException(status_code=400, detail="Sarvam API key not configured")

    try:
        from sarvamai import SarvamAI

        sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
        response = sarvam_client.text.translate(
            input=data.text[:2000],
            source_language_code=data.source_language,
            target_language_code=data.target_language,
        )
        return {
            "translated_text": response.translated_text,
            "source_language": data.source_language,
            "target_language": data.target_language,
        }
    except Exception as exc:  # pragma: no cover - provider-specific failures
        logger.error("Translation error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Translation failed: {exc}") from exc


@api_router.post("/meetings/{meeting_id}/translate")
async def translate_meeting_transcript(
    meeting_id: str,
    target_language: str = Form(default="en-IN"),
    actor: AuthUser = Depends(require_authenticated_actor),
):
    if not SARVAM_API_KEY:
        raise HTTPException(status_code=400, detail="Sarvam API key not configured")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                normalize_query(
                    """
            SELECT *
            FROM transcript_segments
            WHERE meeting_id = $1 AND owner_user_id = $2
            ORDER BY timestamp_start ASC
            """
                ),
                (meeting_id, actor.id),
            )
            records = cur.fetchall()
    segments = serialize_records(records)
    if not segments:
        raise HTTPException(status_code=400, detail="No transcript to translate")

    try:
        from sarvamai import SarvamAI

        sarvam_client = SarvamAI(api_subscription_key=SARVAM_API_KEY)
        translated_segments = []
        for segment in segments:
            try:
                response = sarvam_client.text.translate(
                    input=segment["text"][:2000],
                    source_language_code="auto",
                    target_language_code=target_language,
                )
                translated_segments.append(
                    {
                        **segment,
                        "translated_text": response.translated_text,
                        "target_language": target_language,
                    }
                )
            except Exception:
                translated_segments.append(
                    {
                        **segment,
                        "translated_text": segment["text"],
                        "target_language": target_language,
                    }
                )

        return {"segments": translated_segments, "target_language": target_language}
    except Exception as exc:  # pragma: no cover - provider-specific failures
        logger.error("Meeting translation error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Translation failed: {exc}") from exc


def register_feature_routers(application: FastAPI) -> None:
    from backend.routes.buddy import router as buddy_router
    from backend.routes.history import router as history_router
    from backend.routes.tools import router as tools_router

    application.include_router(buddy_router)
    application.include_router(tools_router)
    application.include_router(history_router)


app.include_router(api_router)
register_feature_routers(app)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    close_db_pool()
