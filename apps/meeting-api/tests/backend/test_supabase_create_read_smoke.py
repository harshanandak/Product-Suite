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


@pytest.mark.skipif(
    not os.environ.get("MEETING_SUPABASE_SMOKE_DATABASE_URL"),
    reason="MEETING_SUPABASE_SMOKE_DATABASE_URL is required for live Supabase create/read smoke coverage",
)
def test_meeting_create_read_smoke_against_supabase_compatible_postgres(monkeypatch):
    database_url = os.environ["MEETING_SUPABASE_SMOKE_DATABASE_URL"]
    tenant_id = f"smoke-tenant-{uuid.uuid4()}"
    user_id = f"smoke-user-{uuid.uuid4()}"
    now = datetime.now(timezone.utc)

    settings = type(
        "SettingsStub",
        (),
        {
            "database_url": database_url,
            "database_provider": "supabase",
            "db_pool_min_size": 1,
            "db_pool_max_size": 2,
            "deployment_mode": "hosted",
            "is_hosted": True,
            "is_oss": False,
        },
    )()

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

        created = asyncio.run(create_meeting(MeetingCreate(title="PR20 Supabase smoke"), actor=actor))
        fetched = asyncio.run(get_meeting(created.id, actor=actor))

        assert fetched.id == created.id
        assert fetched.title == "PR20 Supabase smoke"
    finally:
        with psycopg.connect(database_url, options="-c search_path=meeting,public") as conn:
            with conn.cursor() as cur:
                cur.execute("delete from meeting.meetings where owner_user_id = %s", (user_id,))
                cur.execute("delete from meeting.users where id = %s", (user_id,))
                cur.execute("delete from meeting.tenants where id = %s", (tenant_id,))
        db_module.close_db_pool()
