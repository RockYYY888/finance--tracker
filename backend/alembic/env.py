from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from app.database import DATABASE_URL
import app.models  # noqa: F401

config = context.config

if config.config_file_name is not None:
	fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def _database_url() -> str:
	x_arguments = context.get_x_argument(as_dictionary=True)
	return x_arguments.get("db_url", DATABASE_URL)


def run_migrations_offline() -> None:
	context.configure(
		url=_database_url(),
		target_metadata=target_metadata,
		literal_binds=True,
		dialect_opts={"paramstyle": "named"},
		compare_type=True,
		compare_server_default=True,
	)

	with context.begin_transaction():
		context.run_migrations()


def run_migrations_online() -> None:
	configuration = config.get_section(config.config_ini_section, {})
	configuration["sqlalchemy.url"] = _database_url()
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
			compare_server_default=True,
		)

		with context.begin_transaction():
			context.run_migrations()


if context.is_offline_mode():
	run_migrations_offline()
else:
	run_migrations_online()
