from __future__ import annotations

import os
from pathlib import Path

import pytest
from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import inspect
from sqlalchemy import text

import app.database as database
from app import runtime_state


def test_validate_runtime_redis_connection_raises_when_ping_fails(
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	class FailingRedisClient:
		def ping(self) -> bool:
			raise RedisConnectionError("unreachable")

	monkeypatch.setattr(runtime_state, "redis_url", "redis://127.0.0.1:6380/0")
	monkeypatch.setattr(runtime_state, "redis_client", FailingRedisClient())

	with pytest.raises(RuntimeError, match="Unable to connect to Redis"):
		runtime_state.validate_runtime_redis_connection()


def test_init_db_stamps_legacy_schema_without_version_table(
	tmp_path: Path,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	db_path = tmp_path / "legacy-schema.db"
	engine = database.create_engine(
		f"sqlite:///{db_path}",
		connect_args={"check_same_thread": False},
	)
	database.SQLModel.metadata.create_all(engine)

	monkeypatch.setattr(database, "DATA_DIR", tmp_path)
	monkeypatch.setattr(database, "DATABASE_URL", f"sqlite:///{db_path}")
	monkeypatch.setattr(database, "engine", engine)
	monkeypatch.setattr(database, "MIGRATION_LOCK_PATH", tmp_path / ".migration.lock")

	database.init_db()

	with engine.connect() as connection:
		version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()

	assert version == database.ALEMBIC_BASELINE_REVISION


def test_init_db_rejects_partial_legacy_schema_without_version_table(
	tmp_path: Path,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	db_path = tmp_path / "partial-legacy-schema.db"
	engine = database.create_engine(
		f"sqlite:///{db_path}",
		connect_args={"check_same_thread": False},
	)
	with engine.begin() as connection:
		connection.execute(text("CREATE TABLE useraccount (username TEXT PRIMARY KEY)"))

	monkeypatch.setattr(database, "DATA_DIR", tmp_path)
	monkeypatch.setattr(database, "DATABASE_URL", f"sqlite:///{db_path}")
	monkeypatch.setattr(database, "engine", engine)
	monkeypatch.setattr(database, "MIGRATION_LOCK_PATH", tmp_path / ".migration.lock")

	with pytest.raises(RuntimeError, match="Missing tables"):
		database.init_db()


def test_init_db_applies_migrations_to_empty_database(
	tmp_path: Path,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	db_path = tmp_path / "empty-schema.db"
	engine = database.create_engine(
		f"sqlite:///{db_path}",
		connect_args={"check_same_thread": False},
	)

	monkeypatch.setattr(database, "DATA_DIR", tmp_path)
	monkeypatch.setattr(database, "DATABASE_URL", f"sqlite:///{db_path}")
	monkeypatch.setattr(database, "engine", engine)
	monkeypatch.setattr(database, "MIGRATION_LOCK_PATH", tmp_path / ".migration.lock")

	database.init_db()

	with engine.connect() as connection:
		table_names = set(inspect(connection).get_table_names())
		version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()

	assert "useraccount" in table_names
	assert "cashaccount" in table_names
	assert version == database.ALEMBIC_BASELINE_REVISION


@pytest.mark.integration
def test_configured_redis_endpoint_is_reachable() -> None:
	redis_url = os.getenv("ASSET_TRACKER_REDIS_URL", runtime_state.redis_url)
	client = Redis.from_url(redis_url)

	try:
		assert client.ping() is True
	finally:
		client.close()
