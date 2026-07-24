"""Unit coverage for the target-DB smoke's configuration seams.

The smoke itself only runs against a live Postgres, so the two decisions that
decide *whether and how* it runs — which env var supplies the URL, and which
provider the settings stub claims — are factored out here and tested without a
database. A half-migrated operator env (old var still set) must not silently
skip the smoke, and the smoke must not be pinned to one provider.
"""

from test_target_db_create_read_smoke import (
    LEGACY_SMOKE_DATABASE_URL_ENV,
    SMOKE_DATABASE_URL_ENV,
    build_settings_stub,
    resolve_smoke_database_url,
)


def test_smoke_env_var_is_provider_neutral():
    assert SMOKE_DATABASE_URL_ENV == "MEETING_TARGET_SMOKE_DATABASE_URL"
    assert LEGACY_SMOKE_DATABASE_URL_ENV == "MEETING_SUPABASE_SMOKE_DATABASE_URL"


def test_resolve_prefers_the_neutral_var():
    env = {
        SMOKE_DATABASE_URL_ENV: "postgresql://neutral",
        LEGACY_SMOKE_DATABASE_URL_ENV: "postgresql://legacy",
    }
    assert resolve_smoke_database_url(env) == "postgresql://neutral"


def test_resolve_falls_back_to_the_legacy_supabase_var():
    # Back-compat: an operator env that only has the old var still RUNS the
    # smoke rather than silently skipping it.
    env = {LEGACY_SMOKE_DATABASE_URL_ENV: "postgresql://legacy"}
    assert resolve_smoke_database_url(env) == "postgresql://legacy"


def test_resolve_returns_none_when_neither_var_is_set():
    assert resolve_smoke_database_url({}) is None


def test_settings_stub_takes_the_provider_as_a_parameter():
    # A neon target is as valid as a supabase one — the smoke proves the
    # database works, not which vendor hosts it.
    neon = build_settings_stub("postgresql://target", "neon")
    assert neon.database_provider == "neon"
    assert neon.database_url == "postgresql://target"

    supabase = build_settings_stub("postgresql://target", "supabase")
    assert supabase.database_provider == "supabase"


def test_settings_stub_keeps_the_hosted_pool_shape():
    stub = build_settings_stub("postgresql://target", "neon")
    assert stub.db_pool_min_size == 1
    assert stub.db_pool_max_size == 2
    assert stub.deployment_mode == "hosted"
    assert stub.is_hosted is True
    assert stub.is_oss is False
