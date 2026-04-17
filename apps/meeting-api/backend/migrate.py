from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from db import get_applied_migrations, get_db_connection, migration_files
from settings import settings

MIGRATIONS_DIR = Path(__file__).parent / "migrations"



def apply_migrations() -> None:
    with get_db_connection(settings.database_url) as conn:
        applied = get_applied_migrations(conn)
        with conn.cursor() as cur:
            for migration_path in migration_files(MIGRATIONS_DIR):
                version = migration_path.stem
                if version in applied:
                    continue
                sql = migration_path.read_text(encoding="utf-8")
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (%s, %s)",
                    (version, datetime.now(timezone.utc)),
                )
                applied.add(version)
        conn.commit()


if __name__ == "__main__":
    apply_migrations()
    print("Migrations applied successfully")
