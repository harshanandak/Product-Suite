from backend.alembic.url_config import normalize_sqlalchemy_database_url


def test_url_config_keeps_existing_psycopg_urls_unchanged():
    assert (
        normalize_sqlalchemy_database_url("postgresql+psycopg://user:pass@db.example.com/app")
        == "postgresql+psycopg://user:pass@db.example.com/app"
    )
