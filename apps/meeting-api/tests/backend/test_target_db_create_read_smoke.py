import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest
import psycopg

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/meeting_agent")

from backend import db as db_module
from backend import config as config_module
import backend.server as server_module
from backend.server import AuthUser, MeetingCreate, create_meeting, get_meeting

# The smoke targets the canonical public schema on the hosted Neon authority.
SMOKE_DATABASE_URL_ENV = "MEETING_TARGET_SMOKE_DATABASE_URL"

# The smoke always exercises the hosted Neon path.
DEFAULT_SMOKE_DATABASE_PROVIDER = "neon"


def resolve_smoke_database_url(env):
    """Return the canonical Neon smoke target URL from ``env``."""
    return env.get(SMOKE_DATABASE_URL_ENV)


def build_settings_stub(database_url, database_provider=DEFAULT_SMOKE_DATABASE_PROVIDER):
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
    reason=f"{SMOKE_DATABASE_URL_ENV} is required for live target-database create/read smoke coverage",
)
def test_meeting_create_read_smoke_against_target_postgres(monkeypatch):
    database_url = resolve_smoke_database_url(os.environ)
    config_module.validate_hosted_database_url(database_url)
    tenant_id = f"smoke-tenant-{uuid.uuid4()}"
    user_id = f"smoke-user-{uuid.uuid4()}"
    now = datetime.now(timezone.utc)

    settings = build_settings_stub(database_url)

    db_module.close_db_pool()
    db_module.init_db_pool(settings)
    monkeypatch.setattr(server_module, "settings", settings)

    try:
        with psycopg.connect(database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    insert into public.tenants (id, slug, name, created_at, updated_at)
                    values (%s, %s, %s, %s, %s)
                    """,
                    (tenant_id, tenant_id, "PR20 smoke tenant", now, now),
                )
                cur.execute(
                    """
                    insert into public.users (id, email, password_hash, name, tenant_id, created_at, updated_at)
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
        with psycopg.connect(database_url) as conn:
            with conn.cursor() as cur:
                cur.execute("delete from public.meetings where owner_user_id = %s", (user_id,))
                cur.execute("delete from public.users where id = %s", (user_id,))
                cur.execute("delete from public.tenants where id = %s", (tenant_id,))
        db_module.close_db_pool()
