import os
import subprocess
import sys
from pathlib import Path

from backend.alembic.url_config import normalize_sqlalchemy_database_url


def test_normalize_sqlalchemy_database_url_rewrites_plain_postgresql_urls():
    assert (
        normalize_sqlalchemy_database_url("postgresql://user:pass@db.example.com/app")
        == "postgresql+psycopg://user:pass@db.example.com/app"
    )


def test_normalize_sqlalchemy_database_url_rewrites_postgres_scheme():
    assert (
        normalize_sqlalchemy_database_url("postgres://user:pass@db.example.com/app")
        == "postgresql+psycopg://user:pass@db.example.com/app"
    )


def test_normalize_sqlalchemy_database_url_preserves_existing_driver_url():
    assert (
        normalize_sqlalchemy_database_url("postgresql+psycopg://user:pass@db.example.com/app")
        == "postgresql+psycopg://user:pass@db.example.com/app"
    )


def test_alembic_upgrade_sql_runs_from_backend_workdir_without_repo_root_on_pythonpath():
    repo_root = Path(__file__).resolve().parents[2]
    backend_dir = repo_root / "backend"
    env = os.environ.copy()
    env["PYTHONPATH"] = "."
    env["DATABASE_URL"] = "postgresql://user:pass@db.example.com/app"

    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            "alembic.ini",
            "-x",
            "db_url=postgresql://user:pass@db.example.com/app",
            "upgrade",
            "head",
            "--sql",
        ],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert "CREATE TABLE alembic_version" in completed.stdout
