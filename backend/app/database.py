from collections.abc import Generator, Iterator
from contextlib import contextmanager
import fcntl
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import event, inspect
from sqlalchemy.engine import make_url
from sqlmodel import Session, SQLModel, create_engine

from app.settings import get_settings

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_LOCAL_DATABASE_URL = f"sqlite:///{DATA_DIR / 'asset_tracker.db'}"
DATABASE_URL = get_settings().database_url_value() or DEFAULT_LOCAL_DATABASE_URL
ALEMBIC_CONFIG_PATH = Path(__file__).resolve().parent.parent / "alembic.ini"
ALEMBIC_VERSION_TABLE = "alembic_version"
ALEMBIC_BASELINE_REVISION = "20260310_01"
MIGRATION_LOCK_PATH = DATA_DIR / ".migration.lock"


def _is_sqlite_database_url(database_url: str) -> bool:
	return make_url(database_url).get_backend_name() == "sqlite"


def _build_engine(database_url: str):
	connect_args: dict[str, object] = {}
	if _is_sqlite_database_url(database_url):
		connect_args = {
			"check_same_thread": False,
			"timeout": 30,
		}

	engine = create_engine(
		database_url,
		connect_args=connect_args,
		pool_pre_ping=not _is_sqlite_database_url(database_url),
	)
	if _is_sqlite_database_url(database_url):
		@event.listens_for(engine, "connect")
		def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
			cursor = dbapi_connection.cursor()
			cursor.execute("PRAGMA foreign_keys=ON")
			cursor.execute("PRAGMA journal_mode=WAL")
			cursor.execute("PRAGMA busy_timeout=30000")
			cursor.close()

	return engine


engine = _build_engine(DATABASE_URL)


def _build_alembic_config() -> Config:
	config = Config(str(ALEMBIC_CONFIG_PATH))
	config.set_main_option("script_location", str(ALEMBIC_CONFIG_PATH.parent / "alembic"))
	config.set_main_option("sqlalchemy.url", DATABASE_URL)
	return config


@contextmanager
def _migration_lock() -> Iterator[None]:
	MIGRATION_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
	with MIGRATION_LOCK_PATH.open("a+b") as lock_file:
		fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
		try:
			yield
		finally:
			fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


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
