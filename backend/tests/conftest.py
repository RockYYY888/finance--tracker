from collections.abc import Iterator
import os

import pytest
from sqlalchemy import create_engine as sa_create_engine
from sqlalchemy import text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import OperationalError
from sqlmodel import SQLModel

import app.database as database
from app import runtime_state

DEFAULT_TEST_DATABASE_URL = (
	"postgresql+psycopg://asset_tracker:asset_tracker@127.0.0.1:5433/asset_tracker_test"
)


def _postgres_test_database_url() -> str:
	database_url = os.getenv("ASSET_TRACKER_TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
	parsed_url = make_url(database_url)
	if not parsed_url.drivername.startswith("postgresql"):
		raise RuntimeError("ASSET_TRACKER_TEST_DATABASE_URL must point to PostgreSQL.")
	if not parsed_url.database:
		raise RuntimeError("ASSET_TRACKER_TEST_DATABASE_URL must include a database name.")
	return parsed_url.render_as_string(hide_password=False)


def _ensure_persistent_postgres_database() -> tuple[str, Engine]:
	test_database_url = _postgres_test_database_url()
	test_database_name = make_url(test_database_url).database
	admin_database_url = os.getenv(
		"ASSET_TRACKER_TEST_DATABASE_ADMIN_URL",
		make_url(test_database_url).set(database="postgres").render_as_string(hide_password=False),
	)
	admin_engine = sa_create_engine(
		admin_database_url,
		isolation_level="AUTOCOMMIT",
		pool_pre_ping=True,
	)

	try:
		with admin_engine.connect() as connection:
			database_exists = connection.execute(
				text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
				{"database_name": test_database_name},
			).scalar_one_or_none()
			if database_exists is None:
				connection.execute(text(f'CREATE DATABASE "{test_database_name}"'))
	except OperationalError as exc:
		admin_engine.dispose()
		raise RuntimeError(
			"PostgreSQL test database is unavailable. Start `docker compose up -d postgres redis` "
			"or set ASSET_TRACKER_TEST_DATABASE_URL / ASSET_TRACKER_TEST_DATABASE_ADMIN_URL "
			"to reachable PostgreSQL URLs.",
		) from exc

	engine = database._build_engine(test_database_url)
	admin_engine.dispose()
	return test_database_url, engine


def _reset_public_schema(engine: Engine) -> None:
	with engine.begin() as connection:
		connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
		connection.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session")
def postgres_database() -> Iterator[tuple[str, Engine]]:
	database_url, engine = _ensure_persistent_postgres_database()
	try:
		yield database_url, engine
	finally:
		engine.dispose()


@pytest.fixture
def empty_postgres_engine(postgres_database: tuple[str, Engine]) -> Iterator[Engine]:
	_, engine = postgres_database
	_reset_public_schema(engine)
	yield engine


@pytest.fixture
def postgres_engine(empty_postgres_engine: Engine) -> Iterator[Engine]:
	SQLModel.metadata.create_all(empty_postgres_engine)
	yield empty_postgres_engine


@pytest.fixture
def postgres_database_url(postgres_database: tuple[str, Engine]) -> str:
	database_url, _ = postgres_database
	return database_url


@pytest.fixture(autouse=True)
def reset_actor_source_context() -> Iterator[None]:
	token = runtime_state.current_actor_source_context.set("USER")
	try:
		yield
	finally:
		runtime_state.current_actor_source_context.reset(token)
