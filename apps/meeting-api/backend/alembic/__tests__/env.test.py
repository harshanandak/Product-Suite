from backend.alembic.url_config import normalize_sqlalchemy_database_url


def test_env_uses_psycopg_driver_for_plain_postgres_urls():
    assert (
        normalize_sqlalchemy_database_url("postgresql://user:pass@db.example.com/app")
        == "postgresql+psycopg://user:pass@db.example.com/app"
    )
