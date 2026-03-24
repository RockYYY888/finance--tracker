from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlmodel import SQLModel

from app.database import _build_engine
from app.models import AssetMutationAudit
from app.scripts import import_sqlite_to_database as sqlite_import


def _create_legacy_source_database(source_path: Path) -> None:
	engine = _build_engine(f"sqlite:///{source_path}")
	with engine.begin() as connection:
		connection.execute(
			sa.text(
				"""
				CREATE TABLE useraccount (
					username VARCHAR(32) PRIMARY KEY,
					email VARCHAR(320),
					password_digest VARCHAR(512) NOT NULL,
					email_digest VARCHAR(64),
					created_at DATETIME NOT NULL,
					updated_at DATETIME NOT NULL
				)
				""",
			),
		)
		connection.execute(
			sa.text(
				"""
				CREATE TABLE assetmutationaudit (
					id INTEGER PRIMARY KEY,
					user_id VARCHAR(32) NOT NULL,
					actor_user_id VARCHAR(32) NOT NULL,
					agent_task_id INTEGER,
					entity_type VARCHAR(32) NOT NULL,
					entity_id INTEGER,
					operation VARCHAR(16) NOT NULL,
					before_state TEXT,
					after_state TEXT,
					reason VARCHAR(500),
					created_at DATETIME NOT NULL
				)
				""",
			),
		)
		connection.execute(
			sa.text(
				"""
				INSERT INTO useraccount (
					username, email, password_digest, email_digest, created_at, updated_at
				) VALUES (
					'tester', 'tester@example.com', 'digest', 'email-digest',
					'2026-03-01 00:00:00', '2026-03-01 00:00:00'
				)
				""",
			),
		)
		connection.execute(
			sa.text(
				"""
				INSERT INTO assetmutationaudit (
					id, user_id, actor_user_id, agent_task_id, entity_type, entity_id,
					operation, before_state, after_state, reason, created_at
				) VALUES (
					1, 'tester', 'tester', NULL, 'CASH_ACCOUNT', 5,
					'CREATE', NULL, '{"balance": 10}', 'legacy import',
					'2026-03-01 00:00:00'
				)
				""",
			),
		)


def test_build_insert_payload_uses_model_default_for_missing_non_nullable_column() -> None:
	target_table = AssetMutationAudit.__table__
	source_row = {
		"id": 1,
		"user_id": "tester",
		"actor_user_id": "tester",
		"agent_task_id": None,
		"entity_type": "CASH_ACCOUNT",
		"entity_id": 5,
		"operation": "CREATE",
		"before_state": None,
		"after_state": '{"balance": 10}',
		"reason": "legacy import",
		"created_at": datetime(2026, 3, 1, 0, 0, 0),
	}

	payload = sqlite_import._build_insert_payload(target_table, source_row)

	assert payload["actor_source"] == "USER"


def test_import_sqlite_to_target_database_copies_legacy_rows(
	tmp_path: Path,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	source_path = tmp_path / "legacy.db"
	target_path = tmp_path / "target.db"
	_create_legacy_source_database(source_path)
	target_engine = _build_engine(f"sqlite:///{target_path}")

	def fake_target_database_url() -> str:
		return f"sqlite:///{target_path}"

	def fake_run_target_migrations(_database_url: str) -> None:
		SQLModel.metadata.create_all(target_engine)

	monkeypatch.setattr(sqlite_import, "_target_database_url", fake_target_database_url)
	monkeypatch.setattr(sqlite_import, "_run_target_migrations", fake_run_target_migrations)

	summary = sqlite_import.import_sqlite_to_target_database(source_path)

	assert summary.total_rows_imported == 2
	assert summary.skipped_tables

	with target_engine.connect() as connection:
		imported_user = connection.execute(
			sa.text("SELECT username, email FROM useraccount"),
		).mappings().one()
		imported_audit = connection.execute(
			sa.text("SELECT actor_source, operation, entity_id FROM assetmutationaudit"),
		).mappings().one()

	assert imported_user["username"] == "tester"
	assert imported_user["email"] == "tester@example.com"
	assert imported_audit["actor_source"] == "USER"
	assert imported_audit["operation"] == "CREATE"
	assert imported_audit["entity_id"] == 5


def test_import_sqlite_to_target_database_rejects_non_empty_target(
	tmp_path: Path,
	monkeypatch: pytest.MonkeyPatch,
) -> None:
	source_path = tmp_path / "legacy.db"
	target_path = tmp_path / "target.db"
	_create_legacy_source_database(source_path)
	target_engine = _build_engine(f"sqlite:///{target_path}")
	SQLModel.metadata.create_all(target_engine)
	with target_engine.begin() as connection:
		connection.execute(
			sa.text(
				"""
				INSERT INTO useraccount (
					username, email, password_digest, email_digest, created_at, updated_at
				) VALUES (
					'existing', NULL, 'digest', NULL,
					'2026-03-01 00:00:00', '2026-03-01 00:00:00'
				)
				""",
			),
		)

	def fake_target_database_url() -> str:
		return f"sqlite:///{target_path}"

	def fake_run_target_migrations(_database_url: str) -> None:
		return None

	monkeypatch.setattr(sqlite_import, "_target_database_url", fake_target_database_url)
	monkeypatch.setattr(sqlite_import, "_run_target_migrations", fake_run_target_migrations)

	with pytest.raises(RuntimeError, match="Target database already contains copied tables"):
		sqlite_import.import_sqlite_to_target_database(source_path)
