from __future__ import annotations

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from sqlalchemy import JSON, MetaData, Table, Column, DateTime, Float, Integer, String, Text, create_engine
from sqlalchemy.engine import Engine

EXPECTED_ALEMBIC_VERSION = "0005_remove_workos_session_id"

metadata = MetaData()

meetings_table = Table(
    "meetings",
    metadata,
    Column("id", String, primary_key=True),
    Column("tenant_id", String, nullable=False),
    Column("owner_user_id", String, nullable=False),
    Column("visibility", String, nullable=False),
    Column("title", Text),
    Column("project_name", Text),
    Column("tags", JSON),
    Column("participant_labels", JSON),
    Column("created_at", DateTime(timezone=True)),
)

chapter_summaries_table = Table(
    "chapter_summaries",
    metadata,
    Column("id", String, primary_key=True),
    Column("meeting_id", String, nullable=False),
    Column("chapter_index", Integer),
    Column("summary_text", Text),
    Column("window_start", Float),
    Column("window_end", Float),
    Column("created_at", DateTime(timezone=True)),
)

summaries_table = Table(
    "summaries",
    metadata,
    Column("id", String, primary_key=True),
    Column("meeting_id", String, nullable=False),
    Column("summary_text", Text),
    Column("created_at", DateTime(timezone=True)),
)

audio_assets_table = Table(
    "audio_assets",
    metadata,
    Column("id", String, primary_key=True),
    Column("tenant_id", String, nullable=False),
    Column("meeting_id", String, nullable=False),
    Column("storage_path", Text, nullable=False),
    Column("kind", Text, nullable=False),
    Column("mime_type", Text, nullable=False),
    Column("duration_ms", Integer, nullable=False),
    Column("retention_expires_at", DateTime(timezone=True)),
    Column("created_at", DateTime(timezone=True)),
)

user_auth_identities_table = Table(
    "user_auth_identities",
    metadata,
    Column("id", String, primary_key=True),
    Column("user_id", String, nullable=False),
    Column("provider", String, nullable=False),
    Column("provider_user_id", String, nullable=False),
    Column("provider_email", Text),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

organization_memberships_table = Table(
    "organization_memberships",
    metadata,
    Column("id", String, primary_key=True),
    Column("tenant_id", String, nullable=False),
    Column("user_id", String, nullable=False),
    Column("role", String, nullable=False),
    Column("status", String, nullable=False),
    Column("invited_by_user_id", String),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
)

organization_invitations_table = Table(
    "organization_invitations",
    metadata,
    Column("id", String, primary_key=True),
    Column("tenant_id", String, nullable=False),
    Column("email", Text, nullable=False),
    Column("role", String, nullable=False),
    Column("token_hash", Text, nullable=False),
    Column("status", String, nullable=False),
    Column("invited_by_user_id", String),
    Column("accepted_by_user_id", String),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("updated_at", DateTime(timezone=True)),
    Column("accepted_at", DateTime(timezone=True)),
)


def normalize_sqlalchemy_database_url(database_url: str) -> str:
    if database_url.startswith("postgresql+"):
        return database_url
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    return database_url


def create_db_engine(database_url: str) -> Engine:
    return create_engine(
        normalize_sqlalchemy_database_url(database_url),
        future=True,
        pool_pre_ping=True,
    )

_db_pool: ConnectionPool | None = None
_db_engine: Engine | None = None


def init_db_pool(settings) -> None:
    global _db_pool, _db_engine
    if _db_pool is None:
        _db_pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    if _db_engine is None:
        _db_engine = create_db_engine(settings.database_url)


def get_db_pool() -> ConnectionPool:
    if _db_pool is None:
        raise RuntimeError("Database pool has not been initialized")
    return _db_pool


def get_db_engine() -> Engine:
    if _db_engine is None:
        raise RuntimeError("Database engine has not been initialized")
    return _db_engine


def close_db_pool() -> None:
    global _db_pool, _db_engine
    if _db_pool is not None:
        _db_pool.close()
    if _db_engine is not None:
        _db_engine.dispose()
    _db_engine = None
    _db_pool = None


def assert_schema_ready() -> None:
    with get_db_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'alembic_version'
                ) AS has_alembic
                """
            )
            has_alembic = bool(cur.fetchone()["has_alembic"])
            if not has_alembic:
                raise RuntimeError("Database schema is not initialized. Run `alembic upgrade head` in the backend directory.")

            cur.execute("SELECT version_num FROM alembic_version LIMIT 1")
            row = cur.fetchone()
            version = row["version_num"] if row else None
            if version != EXPECTED_ALEMBIC_VERSION:
                raise RuntimeError(
                    f"Database schema version is '{version}'. Expected '{EXPECTED_ALEMBIC_VERSION}'. Run `alembic upgrade head`."
                )
