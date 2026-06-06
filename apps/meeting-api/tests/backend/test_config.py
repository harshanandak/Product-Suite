import pytest

from backend.config import load_settings, parse_bool_env, parse_csv_env


@pytest.fixture(autouse=True)
def clear_relevant_env(monkeypatch):
    for key in [
        "DEPLOYMENT_MODE",
        "DATABASE_URL",
        "POSTGRES_URL",
        "OPENAI_API_KEY",
        "CORS_ORIGINS",
        "AUTH_REQUIRED",
        "AUTH_PROVIDER",
        "AUTH_ALGORITHM",
        "TENANT_MODE",
        "AUTH_ORGANIZATION_REQUIRED",
        "AUTH_ONBOARDING_REQUIRED",
        "NEON_AUTH_URL",
        "NEON_AUTH_BASE_URL",
        "NEON_API_KEY",
        "NEON_CLIENT_ID",
        "NEON_ISSUER",
        "NEON_AUDIENCE",
        "NEON_JWKS_URL",
        "CANONICAL_AUTH_PROVIDER",
        "CANONICAL_AUTH_ISSUER",
        "CANONICAL_AUTH_AUDIENCE",
        "CANONICAL_AUTH_JWKS_URL",
        "NEON_REDIRECT_URI",
        "FRONTEND_RUNTIME_BACKEND_URL",
        "DATABASE_PROVIDER",
        "STORAGE_BACKEND",
        "R2_ACCOUNT_ID",
        "R2_BUCKET_NAME",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_PUBLIC_BASE_URL",
        "RAW_AUDIO_RETENTION_DAYS",
        "TRANSCRIPT_RETENTION_DAYS",
        "DERIVED_RETENTION_DAYS",
        "SUMMARY_FIRST_STATE_WINDOW_SECONDS",
        "SUMMARY_FIRST_CHAPTER_WINDOW_SECONDS",
        "SUMMARY_FIRST_INACTIVITY_TIMEOUT_SECONDS",
        "HISTORY_RETRIEVAL_CORPUS",
        "HISTORY_RANKING_PROFILE",
    ]:
        monkeypatch.delenv(key, raising=False)


def test_parse_csv_env_splits_and_trims(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", " http://localhost:3000, ,http://127.0.0.1:3000 ")

    assert parse_csv_env("CORS_ORIGINS") == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_parse_bool_env_honors_truthy_values(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "YES")

    assert parse_bool_env("AUTH_REQUIRED") is True


def test_load_settings_uses_hosted_mode_defaults(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("NEON_AUTH_URL", "https://project-123.neon.tech/auth")
    monkeypatch.setenv("FRONTEND_RUNTIME_BACKEND_URL", "http://localhost:8000")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "meeting-agent-audio")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "r2-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "r2-secret")

    settings = load_settings()

    assert settings.deployment_mode == "hosted"
    assert settings.database_url == "postgresql://localhost/test"
    assert settings.database_provider == "supabase"
    assert settings.auth_required is True
    assert settings.auth_provider == "neon"
    assert settings.tenant_mode == "organization"
    assert settings.organization_required is True
    assert settings.onboarding_required is True
    assert settings.storage_backend == "r2"
    assert settings.neon_auth_url == "https://project-123.neon.tech/auth"
    assert settings.neon_issuer == "https://project-123.neon.tech"
    assert settings.neon_jwks_url == "https://project-123.neon.tech/auth/.well-known/jwks.json"
    assert settings.canonical_auth_provider == "neon"
    assert settings.canonical_auth_issuer == "https://project-123.neon.tech"
    assert settings.canonical_auth_audience == "https://project-123.neon.tech"
    assert settings.canonical_auth_jwks_url == "https://project-123.neon.tech/auth/.well-known/jwks.json"
    assert settings.raw_audio_retention_days == 30
    assert settings.transcript_retention_days == -1
    assert settings.derived_retention_days == -1
    assert settings.summary_first_state_window_seconds == 120
    assert settings.summary_first_chapter_window_seconds == 300
    assert settings.summary_first_inactivity_timeout_seconds == 180
    assert settings.history_retrieval_corpus == ["chapter_summary", "final_summary"]
    assert settings.history_ranking_profile == "hybrid_summary_first"
    assert settings.runtime_backend_url == "http://localhost:8000"
    assert settings.r2_account_id == "account-123"
    assert settings.r2_bucket_name == "meeting-agent-audio"


def test_load_settings_does_not_accept_redirect_uris_as_neon_auth_url(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("AUTH_PROVIDER", "neon")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "meeting-agent-audio")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "r2-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "r2-secret")

    with pytest.raises(KeyError, match="NEON_AUTH_URL"):
        load_settings()


def test_load_settings_prefers_explicit_canonical_auth_config(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("AUTH_PROVIDER", "neon")
    monkeypatch.setenv("NEON_AUTH_URL", "https://project-123.neon.tech/auth")
    monkeypatch.setenv("CANONICAL_AUTH_PROVIDER", "neon")
    monkeypatch.setenv("CANONICAL_AUTH_ISSUER", "https://issuer.example.com")
    monkeypatch.setenv("CANONICAL_AUTH_AUDIENCE", "meeting-api")
    monkeypatch.setenv("CANONICAL_AUTH_JWKS_URL", "https://issuer.example.com/.well-known/jwks.json")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "meeting-agent-audio")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "r2-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "r2-secret")

    settings = load_settings()

    assert settings.canonical_auth_provider == "neon"
    assert settings.canonical_auth_issuer == "https://issuer.example.com"
    assert settings.canonical_auth_audience == "meeting-api"
    assert settings.canonical_auth_jwks_url == "https://issuer.example.com/.well-known/jwks.json"


def test_load_settings_requires_database_url():
    with pytest.raises(KeyError, match="DATABASE_URL"):
        load_settings()


def test_load_settings_requires_neon_auth_url_in_hosted_mode(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("AUTH_PROVIDER", "neon")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "meeting-agent-audio")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "r2-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "r2-secret")

    with pytest.raises(KeyError, match="NEON_AUTH_URL"):
        load_settings()


def test_load_settings_requires_openai_api_key_in_hosted_mode(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "meeting-agent-audio")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "r2-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "r2-secret")

    with pytest.raises(KeyError, match="OPENAI_API_KEY"):
        load_settings()


def test_load_settings_requires_r2_configuration_in_hosted_mode(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
    monkeypatch.setenv("NEON_AUTH_URL", "https://project-123.neon.tech/auth")

    with pytest.raises(KeyError, match="R2_ACCOUNT_ID"):
        load_settings()


def test_load_settings_rejects_unsupported_auth_provider(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("AUTH_PROVIDER", "legacy")

    with pytest.raises(ValueError, match="Unsupported auth provider: legacy"):
        load_settings()


def test_load_settings_rejects_clerk_until_hosted_exchange_supports_it(monkeypatch):
    monkeypatch.setenv("DEPLOYMENT_MODE", "hosted")
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("AUTH_PROVIDER", "clerk")

    with pytest.raises(ValueError, match="Unsupported auth provider: clerk"):
        load_settings()


def test_load_settings_rejects_unknown_history_ranking_profile(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("HISTORY_RANKING_PROFILE", "typo-profile")

    with pytest.raises(ValueError, match="Unsupported history ranking profile: typo-profile"):
        load_settings()


def test_load_settings_rejects_unknown_auth_algorithm(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/test")
    monkeypatch.setenv("AUTH_ALGORITHM", "RS256")

    with pytest.raises(ValueError, match="Unsupported auth algorithm: RS256"):
        load_settings()
