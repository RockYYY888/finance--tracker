from collections.abc import Generator, Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from app.settings import get_settings

DEFAULT_LOCAL_DATABASE_URL = (
	"postgresql+psycopg://asset_tracker:asset_tracker@127.0.0.1:5433/asset_tracker"
)
DATABASE_URL = get_settings().database_url_value() or DEFAULT_LOCAL_DATABASE_URL
ALEMBIC_CONFIG_PATH = Path(__file__).resolve().parent.parent / "alembic.ini"
ALEMBIC_VERSION_TABLE = "alembic_version"
ALEMBIC_BASELINE_REVISION = "20260310_01"
MIGRATION_ADVISORY_LOCK_ID = 88290045133101


def _build_engine(database_url: str):
	engine = create_engine(
		database_url,
		pool_pre_ping=True,
	)
	return engine


engine = _build_engine(DATABASE_URL)


def _build_alembic_config() -> Config:
	config = Config(str(ALEMBIC_CONFIG_PATH))
	config.set_main_option("script_location", str(ALEMBIC_CONFIG_PATH.parent / "alembic"))
	config.set_main_option("sqlalchemy.url", DATABASE_URL)
	return config


@contextmanager
def _migration_lock() -> Iterator[None]:
	with engine.connect() as connection:
		connection.execute(
			text("SELECT pg_advisory_lock(:lock_id)"),
			{"lock_id": MIGRATION_ADVISORY_LOCK_ID},
		)
		try:
			yield
		finally:
			connection.execute(
				text("SELECT pg_advisory_unlock(:lock_id)"),
				{"lock_id": MIGRATION_ADVISORY_LOCK_ID},
			)


def _has_legacy_schema_without_alembic_version() -> bool:
	with engine.connect() as connection:
		table_names = set(inspect(connection).get_table_names())

	return bool(table_names - {ALEMBIC_VERSION_TABLE}) and ALEMBIC_VERSION_TABLE not in table_names


def _validate_legacy_schema_matches_baseline() -> None:
	with engine.connect() as connection:
		table_names = set(inspect(connection).get_table_names()) - {ALEMBIC_VERSION_TABLE}

	expected_table_names = set(SQLModel.metadata.tables)
	missing_tables = sorted(expected_table_names - table_names)
	extra_tables = sorted(table_names - expected_table_names)
	if not missing_tables and not extra_tables:
		return

	raise RuntimeError(
		"Legacy schema bootstrap requires a database that already matches the Alembic baseline. "
		f"Missing tables: {missing_tables or 'none'}. "
		f"Extra tables: {extra_tables or 'none'}.",
	)


def init_db() -> None:
	"""Apply schema migrations on startup.

	Existing deployments created before Alembic are stamped at the baseline revision once,
	then upgraded normally from that point onward.
	"""
	with _migration_lock():
		alembic_config = _build_alembic_config()
		if _has_legacy_schema_without_alembic_version():
			_validate_legacy_schema_matches_baseline()
			command.stamp(alembic_config, ALEMBIC_BASELINE_REVISION)
		command.upgrade(alembic_config, "head")


def get_session() -> Generator[Session, None, None]:
	"""Yield a database session for request handlers."""
	with Session(engine) as session:
		yield session
