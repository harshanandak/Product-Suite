import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest
import psycopg

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend import db as db_module
import backend.server as server_module
from backend.server import AuthUser, MeetingCreate, create_meeting, get_meeting

# The smoke proves that a target Postgres carrying the `meeting` schema works —
# it is not a statement about who hosts it. The env var is therefore neutral,
# with the original Supabase-specific name kept as a fallback so a
# half-migrated operator env still RUNS the smoke instead of silently skipping.
SMOKE_DATABASE_URL_ENV = "MEETING_TARGET_SMOKE_DATABASE_URL"
LEGACY_SMOKE_DATABASE_URL_ENV = "MEETING_SUPABASE_SMOKE_DATABASE_URL"

# Only used when the caller does not say; any Postgres target is equally valid.
DEFAULT_SMOKE_DATABASE_PROVIDER = "supabase"


def resolve_smoke_database_url(env):
    """Return the smoke target URL from `env`, preferring the neutral var."""
    return env.get(SMOKE_DATABASE_URL_ENV) or env.get(LEGACY_SMOKE_DATABASE_URL_ENV)


def build_settings_stub(database_url, database_provider):
    """A minimal hosted-shaped settings object for the db pool + server module."""
    return type(
        "SettingsStub",
        (),
        {
            "database_url": database_url,
            "database_provider": database_provider,
            "db_pool_min_size": 1,
            "db_pool_max_size": 2,
            "deployment_mode": "hosted",
            "is_hosted": True,
            "is_oss": False,
        },
    )()


@pytest.mark.skipif(
    not resolve_smoke_database_url(os.environ),
    reason=(
        f"{SMOKE_DATABASE_URL_ENV} (or the legacy {LEGACY_SMOKE_DATABASE_URL_ENV}) "
        "is required for live target-database create/read smoke coverage"
    ),
)
def test_meeting_create_read_smoke_against_target_postgres(monkeypatch):
    database_url = resolve_smoke_database_url(os.environ)
    provider = os.environ.get("MEETING_TARGET_SMOKE_DATABASE_PROVIDER", DEFAULT_SMOKE_DATABASE_PROVIDER)
    tenant_id = f"smoke-tenant-{uuid.uuid4()}"
    user_id = f"smoke-user-{uuid.uuid4()}"
    now = datetime.now(timezone.utc)

    settings = build_settings_stub(database_url, provider)

    db_module.close_db_pool()
    db_module.init_db_pool(settings)
    monkeypatch.setattr(server_module, "settings", settings)

    try:
        with psycopg.connect(database_url, options="-c search_path=meeting,public") as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into meeting.tenants (id, slug, name, created_at, updated_at)
                    values (%s, %s, %s, %s, %s)
                    """,
                    (tenant_id, tenant_id, "PR20 smoke tenant", now, now),
                )
                cur.execute(
                    """
                    insert into meeting.users (id, email, password_hash, name, tenant_id, created_at, updated_at)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        f"{user_id}@example.com",
                        "smoke-password-hash",
                        "PR20 Smoke User",
                        tenant_id,
                        now,
                        now,
                    ),
                )

        actor = AuthUser(
            id=user_id,
            email=f"{user_id}@example.com",
            name="PR20 Smoke User",
            tenant_id=tenant_id,
            is_authenticated=True,
        )

        created = asyncio.run(create_meeting(MeetingCreate(title="PR20 target-db smoke"), actor=actor))
        fetched = asyncio.run(get_meeting(created.id, actor=actor))

        assert fetched.id == created.id
        assert fetched.title == "PR20 target-db smoke"
    finally:
        with psycopg.connect(database_url, options="-c search_path=meeting,public") as conn:
            with conn.cursor() as cur:
                cur.execute("delete from meeting.meetings where owner_user_id = %s", (user_id,))
                cur.execute("delete from meeting.users where id = %s", (user_id,))
                cur.execute("delete from meeting.tenants where id = %s", (tenant_id,))
        db_module.close_db_pool()
