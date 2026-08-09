"""Unit coverage for the canonical Neon target-DB smoke configuration."""

from test_target_db_create_read_smoke import (
    DEFAULT_SMOKE_DATABASE_PROVIDER,
    SMOKE_DATABASE_URL_ENV,
    SMOKE_DATABASE_PROVIDER_ENV,
    build_settings_stub,
    resolve_smoke_database_url,
    resolve_smoke_database_provider,
)


def test_smoke_uses_only_the_canonical_neon_env_var():
    assert SMOKE_DATABASE_URL_ENV == "MEETING_TARGET_SMOKE_DATABASE_URL"
    assert SMOKE_DATABASE_PROVIDER_ENV == "MEETING_TARGET_SMOKE_DATABASE_PROVIDER"
    assert DEFAULT_SMOKE_DATABASE_PROVIDER == "neon"


def test_resolve_returns_the_canonical_target_url():
    env = {SMOKE_DATABASE_URL_ENV: "postgresql://neutral"}

    assert resolve_smoke_database_url(env) == "postgresql://neutral"


def test_resolve_does_not_accept_legacy_supabase_var():
    env = {"MEETING_SUPABASE_SMOKE_DATABASE_URL": "postgresql://legacy"}

    assert resolve_smoke_database_url(env) is None


def test_resolve_returns_none_when_target_var_is_unset():
    assert resolve_smoke_database_url({}) is None


def test_resolve_provider_defaults_to_neon_and_accepts_transient_postgres():
    assert resolve_smoke_database_provider({}) == "neon"
    assert resolve_smoke_database_provider({SMOKE_DATABASE_PROVIDER_ENV: "postgres"}) == "postgres"


def test_settings_stub_defaults_to_neon():
    settings = build_settings_stub("postgresql://target")

    assert settings.database_provider == "neon"
    assert settings.database_url == "postgresql://target"


def test_settings_stub_keeps_the_hosted_pool_shape():
    stub = build_settings_stub("postgresql://target", "neon")

    assert stub.db_pool_min_size == 1
    assert stub.db_pool_max_size == 2
    assert stub.deployment_mode == "hosted"
    assert stub.is_hosted is True
    assert stub.is_oss is False


def test_settings_stub_supports_the_transient_ci_postgres_target():
    stub = build_settings_stub("postgresql://target", "postgres", "oss")
    assert stub.database_provider == "postgres"
    assert stub.is_hosted is False
    assert stub.is_oss is True
