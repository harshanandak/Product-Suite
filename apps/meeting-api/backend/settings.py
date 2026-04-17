from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
LOCAL_DEV_CORS_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:4173,http://127.0.0.1:4173,"
    "http://localhost:4174,http://127.0.0.1:4174,"
    "http://localhost:4175,http://127.0.0.1:4175,"
    "http://localhost:4176,http://127.0.0.1:4176,"
    "http://localhost:5173,http://127.0.0.1:5173"
)


def _parse_csv_env(name: str, default: str = "") -> list[str]:
    raw_value = os.environ.get(name, default)
    return [item.strip() for item in raw_value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    deployment_mode: str
    database_url: str
    openai_api_key: str
    sarvam_api_key: str
    openai_text_model: str
    openai_translate_model: str
    openai_transcribe_model: str
    openai_tts_model: str
    openai_tts_voice: str
    auth_secret: str
    auth_issuer: str
    access_token_ttl_minutes: int
    cors_origins: list[str]
    storage_backend: str
    max_upload_bytes: int
    request_timeout_seconds: int

    @property
    def auth_required(self) -> bool:
        return self.deployment_mode == "hosted"



def load_settings() -> Settings:
    deployment_mode = (os.environ.get("DEPLOYMENT_MODE", "oss") or "oss").strip().lower()
    if deployment_mode not in {"oss", "hosted"}:
        raise ValueError("DEPLOYMENT_MODE must be 'oss' or 'hosted'")

    database_url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not database_url:
        raise KeyError("DATABASE_URL")

    auth_secret = os.environ.get("AUTH_SECRET", "")
    if deployment_mode == "hosted" and not auth_secret:
        raise KeyError("AUTH_SECRET")

    openai_text_model = os.environ.get("OPENAI_TEXT_MODEL", "gpt-5.4-nano")

    return Settings(
        deployment_mode=deployment_mode,
        database_url=database_url,
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        sarvam_api_key=os.environ.get("SARVAM_API_KEY", ""),
        openai_text_model=openai_text_model,
        openai_translate_model=os.environ.get("OPENAI_TRANSLATE_MODEL", openai_text_model),
        openai_transcribe_model=os.environ.get("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe"),
        openai_tts_model=os.environ.get("OPENAI_TTS_MODEL", "tts-1"),
        openai_tts_voice=os.environ.get("OPENAI_TTS_VOICE", "nova"),
        auth_secret=auth_secret,
        auth_issuer=os.environ.get("AUTH_ISSUER", "meeting-agent"),
        access_token_ttl_minutes=int(os.environ.get("ACCESS_TOKEN_TTL_MINUTES", "480")),
        cors_origins=_parse_csv_env(
            "CORS_ORIGINS",
            LOCAL_DEV_CORS_ORIGINS if deployment_mode == "oss" else "",
        ),
        storage_backend=os.environ.get("STORAGE_BACKEND", "local"),
        max_upload_bytes=int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024))),
        request_timeout_seconds=int(os.environ.get("REQUEST_TIMEOUT_SECONDS", "45")),
    )


settings = load_settings()
