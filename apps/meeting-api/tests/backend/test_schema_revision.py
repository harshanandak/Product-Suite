from pathlib import Path

from backend import db


REPO_ROOT = Path(__file__).resolve().parents[2]
VERSIONS_DIR = REPO_ROOT / "backend" / "alembic" / "versions"
REVISION_ID = "0005_remove_workos_session_id"
MIGRATION_FILE = VERSIONS_DIR / "0005_remove_workos_session_id.py"


def test_expected_alembic_version_points_to_cleanup_revision():
    assert db.EXPECTED_ALEMBIC_VERSION == REVISION_ID


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
