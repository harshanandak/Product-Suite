from dataclasses import dataclass
from pathlib import Path
import os
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from dotenv import load_dotenv

if TYPE_CHECKING:
    from backend.services.corpus import validate_history_ranking_profile
else:
    try:
        from backend.services.corpus import validate_history_ranking_profile
    except ModuleNotFoundError:  # Railway deploys the backend service from backend/ as the app root.
        from services.corpus import validate_history_ranking_profile


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")


ALLOWED_DEPLOYMENT_MODES = {"oss", "hosted"}
ALLOWED_AUTH_PROVIDERS = {"local", "neon", "clerk"}
LOCAL_DEV_CORS_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:4173,http://127.0.0.1:4173,"
    "http://localhost:4174,http://127.0.0.1:4174,"
    "http://localhost:4175,http://127.0.0.1:4175,"
    "http://localhost:4176,http://127.0.0.1:4176,"
    "http://localhost:5173,http://127.0.0.1:5173"
)


def parse_csv_env(name: str, default: str = "") -> list[str]:
    raw_value = os.environ.get(name, default)
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def parse_bool_env(name: str, default: bool = False) -> bool:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def parse_int_env(name: str, default: int) -> int:
    raw_value = os.environ.get(name)
    if raw_value is None or not raw_value.strip():
        return default
    return int(raw_value.strip())


def derive_neon_issuer(auth_url: str) -> str:
    parsed = urlparse((auth_url or "").strip())
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


@dataclass(frozen=True)
class Settings:
    deployment_mode: str
    database_url: str
    database_provider: str
    openai_api_key: str
    sarvam_api_key: str
    openai_text_model: str
    openai_translate_model: str
    openai_transcribe_model: str
    openai_tts_model: str
    openai_tts_voice: str
    cors_origins: list[str]
    auth_secret: str
    auth_algorithm: str
    auth_token_ttl_minutes: int
    auth_required: bool
    auth_provider: str
    tenant_mode: str
    organization_required: bool
    onboarding_required: bool
    neon_auth_url: str
    neon_issuer: str
    neon_jwks_url: str
    canonical_auth_provider: str
    canonical_auth_issuer: str
    canonical_auth_audience: str
    canonical_auth_jwks_url: str
    storage_backend: str
    storage_base_path: str
    r2_account_id: str
    r2_bucket_name: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_public_base_url: str
    upload_max_bytes: int
    request_timeout_seconds: int
    db_pool_min_size: int
    db_pool_max_size: int
    oss_default_email: str
    runtime_backend_url: str
    raw_audio_retention_days: int
    transcript_retention_days: int
    derived_retention_days: int
    summary_first_state_window_seconds: int
    summary_first_chapter_window_seconds: int
    summary_first_inactivity_timeout_seconds: int
    history_retrieval_corpus: list[str]
    history_ranking_profile: str

    @property
    def is_hosted(self) -> bool:
        return self.deployment_mode == "hosted"

    @property
    def is_oss(self) -> bool:
        return self.deployment_mode == "oss"


def load_settings() -> Settings:
    deployment_mode = os.environ.get("DEPLOYMENT_MODE", "oss").strip().lower()
    if deployment_mode not in ALLOWED_DEPLOYMENT_MODES:
        deployment_mode = "oss"

    database_url = (os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or "").strip()
    if not database_url:
        raise KeyError("DATABASE_URL")

    database_provider = (os.environ.get("DATABASE_PROVIDER") or ("supabase" if deployment_mode == "hosted" else "postgres")).strip().lower()
    auth_secret = os.environ.get("AUTH_SECRET", "meeting-agent-dev-secret")
    auth_algorithm = (os.environ.get("AUTH_ALGORITHM") or "HS256").strip()
    if auth_algorithm != "HS256":
        raise ValueError(f"Unsupported auth algorithm: {auth_algorithm}")
    cors_origins = parse_csv_env(
        "CORS_ORIGINS",
        LOCAL_DEV_CORS_ORIGINS if deployment_mode == "oss" else "",
    )
    auth_provider = (os.environ.get("AUTH_PROVIDER") or ("clerk" if deployment_mode == "hosted" else "local")).strip().lower()
    if auth_provider not in ALLOWED_AUTH_PROVIDERS:
        raise ValueError(f"Unsupported auth provider: {auth_provider}")
    tenant_mode = (os.environ.get("TENANT_MODE") or ("organization" if deployment_mode == "hosted" else "single")).strip().lower()
    organization_required = parse_bool_env(
        "AUTH_ORGANIZATION_REQUIRED",
        default=tenant_mode == "organization",
    )
    onboarding_required = parse_bool_env(
        "AUTH_ONBOARDING_REQUIRED",
        default=organization_required,
    )
    neon_auth_url = (
        os.environ.get("NEON_AUTH_URL")
        or os.environ.get("NEON_AUTH_BASE_URL")
        or ""
    ).strip().rstrip("/")
    neon_issuer = (os.environ.get("NEON_ISSUER") or derive_neon_issuer(neon_auth_url)).strip()
    neon_jwks_url = (os.environ.get("NEON_JWKS_URL") or (f"{neon_auth_url}/.well-known/jwks.json" if neon_auth_url else "")).strip()
    canonical_auth_provider = (os.environ.get("CANONICAL_AUTH_PROVIDER") or auth_provider).strip().lower()
    canonical_auth_issuer = (os.environ.get("CANONICAL_AUTH_ISSUER") or neon_issuer).strip()
    canonical_auth_audience = (
        os.environ.get("CANONICAL_AUTH_AUDIENCE")
        or os.environ.get("NEON_AUDIENCE")
        or canonical_auth_issuer
    ).strip()
    canonical_auth_jwks_url = (os.environ.get("CANONICAL_AUTH_JWKS_URL") or neon_jwks_url).strip()
    storage_backend = (os.environ.get("STORAGE_BACKEND") or ("r2" if deployment_mode == "hosted" else "local")).strip().lower()
    r2_account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
    r2_bucket_name = os.environ.get("R2_BUCKET_NAME", "").strip()
    r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    r2_public_base_url = os.environ.get("R2_PUBLIC_BASE_URL", "").strip()
    raw_audio_retention_days = parse_int_env("RAW_AUDIO_RETENTION_DAYS", 30 if deployment_mode == "hosted" else 0)
    transcript_retention_days = parse_int_env("TRANSCRIPT_RETENTION_DAYS", -1)
    derived_retention_days = parse_int_env("DERIVED_RETENTION_DAYS", -1)
    state_window_seconds = parse_int_env("SUMMARY_FIRST_STATE_WINDOW_SECONDS", 120)
    chapter_window_seconds = parse_int_env("SUMMARY_FIRST_CHAPTER_WINDOW_SECONDS", 300)
    inactivity_timeout_seconds = parse_int_env("SUMMARY_FIRST_INACTIVITY_TIMEOUT_SECONDS", 180)
    history_retrieval_corpus = parse_csv_env("HISTORY_RETRIEVAL_CORPUS", "chapter_summary,final_summary")
    history_ranking_profile = validate_history_ranking_profile(
        (os.environ.get("HISTORY_RANKING_PROFILE") or "hybrid_summary_first").strip()
    )

    if deployment_mode == "hosted" and not os.environ.get("OPENAI_API_KEY", "").strip():
        raise KeyError("OPENAI_API_KEY")

    if deployment_mode == "hosted" and auth_provider == "neon" and not neon_auth_url:
        raise KeyError("NEON_AUTH_URL")
    if deployment_mode == "hosted" and auth_provider != "neon":
        if not canonical_auth_issuer:
            raise KeyError("CANONICAL_AUTH_ISSUER")
        if not canonical_auth_audience:
            raise KeyError("CANONICAL_AUTH_AUDIENCE")
        if not canonical_auth_jwks_url:
            raise KeyError("CANONICAL_AUTH_JWKS_URL")
    if deployment_mode == "hosted" and storage_backend == "r2":
        if not r2_account_id:
            raise KeyError("R2_ACCOUNT_ID")
        if not r2_bucket_name:
            raise KeyError("R2_BUCKET_NAME")
        if not r2_access_key_id:
            raise KeyError("R2_ACCESS_KEY_ID")
        if not r2_secret_access_key:
            raise KeyError("R2_SECRET_ACCESS_KEY")

    return Settings(
        deployment_mode=deployment_mode,
        database_url=database_url,
        database_provider=database_provider,
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        sarvam_api_key=os.environ.get("SARVAM_API_KEY", ""),
        openai_text_model=os.environ.get("OPENAI_TEXT_MODEL", "gpt-5.4-nano"),
        openai_translate_model=os.environ.get("OPENAI_TRANSLATE_MODEL", os.environ.get("OPENAI_TEXT_MODEL", "gpt-5.4-nano")),
        openai_transcribe_model=os.environ.get("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
        openai_tts_model=os.environ.get("OPENAI_TTS_MODEL", "tts-1"),
        openai_tts_voice=os.environ.get("OPENAI_TTS_VOICE", "nova"),
        cors_origins=cors_origins,
        auth_secret=auth_secret,
        auth_algorithm=auth_algorithm,
        auth_token_ttl_minutes=int(os.environ.get("AUTH_TOKEN_TTL_MINUTES", "10080")),
        auth_required=parse_bool_env("AUTH_REQUIRED", default=deployment_mode == "hosted"),
        auth_provider=auth_provider,
        tenant_mode=tenant_mode,
        organization_required=organization_required,
        onboarding_required=onboarding_required,
        neon_auth_url=neon_auth_url,
        neon_issuer=neon_issuer,
        neon_jwks_url=neon_jwks_url,
        canonical_auth_provider=canonical_auth_provider,
        canonical_auth_issuer=canonical_auth_issuer,
        canonical_auth_audience=canonical_auth_audience,
        canonical_auth_jwks_url=canonical_auth_jwks_url,
        storage_backend=storage_backend,
        storage_base_path=os.environ.get("STORAGE_BASE_PATH", str(ROOT_DIR / "storage")),
        r2_account_id=r2_account_id,
        r2_bucket_name=r2_bucket_name,
        r2_access_key_id=r2_access_key_id,
        r2_secret_access_key=r2_secret_access_key,
        r2_public_base_url=r2_public_base_url,
        upload_max_bytes=int(os.environ.get("UPLOAD_MAX_BYTES", str(25 * 1024 * 1024))),
        request_timeout_seconds=int(os.environ.get("REQUEST_TIMEOUT_SECONDS", "60")),
        db_pool_min_size=int(os.environ.get("DB_POOL_MIN_SIZE", "1")),
        db_pool_max_size=int(os.environ.get("DB_POOL_MAX_SIZE", "10")),
        oss_default_email=os.environ.get("OSS_DEFAULT_EMAIL", "local@meeting-agent.oss"),
        runtime_backend_url=os.environ.get("FRONTEND_RUNTIME_BACKEND_URL", ""),
        raw_audio_retention_days=raw_audio_retention_days,
        transcript_retention_days=transcript_retention_days,
        derived_retention_days=derived_retention_days,
        summary_first_state_window_seconds=state_window_seconds,
        summary_first_chapter_window_seconds=chapter_window_seconds,
        summary_first_inactivity_timeout_seconds=inactivity_timeout_seconds,
        history_retrieval_corpus=history_retrieval_corpus,
        history_ranking_profile=history_ranking_profile,
    )
