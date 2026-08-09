from pathlib import Path

import pytest

from backend import db


REPO_ROOT = Path(__file__).resolve().parents[2]
VERSIONS_DIR = REPO_ROOT / "backend" / "alembic" / "versions"
REVISION_ID = "0005_remove_workos_session_id"
MIGRATION_FILE = VERSIONS_DIR / "0005_remove_workos_session_id.py"


def test_readiness_uses_the_canonical_drizzle_reconciliation_floor():
    assert db.CANONICAL_SCHEMA_REVISION == "0019_neon_authority_reconciliation"
    assert db.CANONICAL_SCHEMA_MIGRATION_HASH
    assert not hasattr(db, "EXPECTED_ALEMBIC_VERSION")


class _Cursor:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.queries = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=None):
        self.queries.append((query, params))

    def fetchone(self):
        return next(self.responses)


class _Connection:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self.cursor_value


class _Pool:
    def __init__(self, cursor):
        self.connection_value = _Connection(cursor)

    def connection(self):
        return self.connection_value


def test_readiness_passes_on_clean_canonical_schema_without_alembic(monkeypatch):
    cursor = _Cursor(
        [
            {"has_drizzle_journal": True},
            {"has_reconciliation": True},
            {"has_canonical_schema": True},
        ]
    )
    monkeypatch.setattr(db, "get_db_pool", lambda: _Pool(cursor))

    db.assert_schema_ready()

    assert all("alembic_version" not in query.lower() for query, _params in cursor.queries)


def test_readiness_rejects_database_before_canonical_reconciliation(monkeypatch):
    cursor = _Cursor(
        [
            {"has_drizzle_journal": True},
            {"has_reconciliation": False},
        ]
    )
    monkeypatch.setattr(db, "get_db_pool", lambda: _Pool(cursor))

    with pytest.raises(RuntimeError, match="0019_neon_authority_reconciliation"):
        db.assert_schema_ready()


def test_readiness_rejects_missing_drizzle_journal(monkeypatch):
    cursor = _Cursor([{"has_drizzle_journal": False}])
    monkeypatch.setattr(db, "get_db_pool", lambda: _Pool(cursor))

    with pytest.raises(RuntimeError, match="Drizzle"):
        db.assert_schema_ready()


def test_cleanup_revision_file_exists():
    assert MIGRATION_FILE.exists()


def test_cleanup_revision_removes_legacy_workos_session_column():
    content = MIGRATION_FILE.read_text(encoding="utf-8")

    required_snippets = [
        'revision = "0005_remove_workos_session_id"',
        'down_revision = "0004_auth_provider_redesign"',
        "ALTER TABLE users DROP COLUMN IF EXISTS workos_session_id",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS workos_session_id TEXT",
    ]

    for snippet in required_snippets:
        assert snippet in content
