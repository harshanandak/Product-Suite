from __future__ import annotations

import importlib.util
import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from alembic.ddl.impl import DefaultImpl
from sqlalchemy import engine_from_config, pool
from sqlalchemy import Column, MetaData, PrimaryKeyConstraint, String, Table


def _load_normalize_sqlalchemy_database_url():
    try:
        from backend.alembic.url_config import normalize_sqlalchemy_database_url
    except ModuleNotFoundError as exc:
        if exc.name != "backend":
            raise

        module_path = Path(__file__).with_name("url_config.py")
        spec = importlib.util.spec_from_file_location("alembic_url_config", module_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Unable to load Alembic URL config from {module_path}") from exc

        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.normalize_sqlalchemy_database_url

    return normalize_sqlalchemy_database_url


normalize_sqlalchemy_database_url = _load_normalize_sqlalchemy_database_url()

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def _version_table_impl_with_long_revision_ids(
    self,
    *,
    version_table: str,
    version_table_schema: str | None,
    version_table_pk: bool,
    **kw,
):
    del self, kw
    version_table_definition = Table(
        version_table,
        MetaData(),
        Column("version_num", String(64), nullable=False),
        schema=version_table_schema,
    )
    if version_table_pk:
        version_table_definition.append_constraint(
            PrimaryKeyConstraint("version_num", name=f"{version_table}_pkc")
        )
    return version_table_definition


DefaultImpl.version_table_impl = _version_table_impl_with_long_revision_ids


def get_database_url() -> str:
    x_args = context.get_x_argument(as_dictionary=True)
    return normalize_sqlalchemy_database_url(
        x_args.get("db_url")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or config.get_main_option("sqlalchemy.url")
    )


def run_migrations_offline() -> None:
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = get_database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
