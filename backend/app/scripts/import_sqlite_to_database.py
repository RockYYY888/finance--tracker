from __future__ import annotations

import argparse
from dataclasses import dataclass, asdict
from datetime import date, datetime, timezone
import json
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine, RowMapping
from sqlmodel import SQLModel

from app.database import ALEMBIC_CONFIG_PATH, _build_engine
from app.settings import get_settings

SKIPPED_TABLES = {"alembic_version"}
_USE_SERVER_DEFAULT = object()


@dataclass(slots=True)
class TableImportSummary:
	table: str
	rows_imported: int
	source_columns: list[str]
	target_columns: list[str]


@dataclass(slots=True)
class ImportSummary:
	source_sqlite_path: str
	target_database_url: str
	imported_tables: list[TableImportSummary]
	skipped_tables: list[str]
	total_rows_imported: int


def _parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Copy legacy SQLite data into the configured server database.",
	)
	parser.add_argument(
		"--source",
		required=True,
		help="Path to the source SQLite database file.",
	)
	return parser.parse_args()


def _target_database_url() -> str:
	settings = get_settings()
	target_database_url = settings.database_url_value()
	if target_database_url is None:
		raise ValueError("ASSET_TRACKER_DATABASE_URL must be set for database import.")
	if settings.database_uses_sqlite():
		raise ValueError("Database import requires ASSET_TRACKER_DATABASE_URL to point at a server database.")
	return target_database_url


def _build_source_engine(source_path: Path) -> Engine:
	if not source_path.exists():
		raise FileNotFoundError(f"SQLite source file was not found: {source_path}")

	return _build_engine(f"sqlite:///{source_path}")


def _run_target_migrations(target_database_url: str) -> None:
	alembic_config = Config(str(ALEMBIC_CONFIG_PATH))
	alembic_config.set_main_option("script_location", str(ALEMBIC_CONFIG_PATH.parent / "alembic"))
	alembic_config.set_main_option("sqlalchemy.url", target_database_url)
	command.upgrade(alembic_config, "head")


def _copyable_target_tables(source_engine: Engine) -> tuple[list[sa.Table], list[str]]:
	source_table_names = set(sa.inspect(source_engine).get_table_names())
	target_tables = [
		table
		for table in SQLModel.metadata.sorted_tables
		if table.name not in SKIPPED_TABLES and table.name in source_table_names
	]
	skipped_tables = sorted(
		table.name
		for table in SQLModel.metadata.sorted_tables
		if table.name not in SKIPPED_TABLES and table.name not in source_table_names
	)
	return target_tables, skipped_tables


def _ensure_target_tables_are_empty(target_connection: Connection, target_tables: list[sa.Table]) -> None:
	non_empty_tables: list[str] = []
	for table in target_tables:
		row_count = target_connection.execute(
			sa.select(sa.func.count()).select_from(table),
		).scalar_one()
		if row_count > 0:
			non_empty_tables.append(f"{table.name}({row_count})")

	if non_empty_tables:
		raise RuntimeError(
			"Target database already contains copied tables. "
			"Use an empty target database for the one-time legacy import. "
			f"Non-empty tables: {', '.join(non_empty_tables)}.",
		)


def _normalize_value_for_target(column: sa.Column[Any], value: Any) -> Any:
	if value is None:
		return None

	if isinstance(column.type, sa.DateTime):
		if isinstance(value, str):
			normalized = value.replace("Z", "+00:00")
			value = datetime.fromisoformat(normalized)
		if isinstance(value, datetime) and value.tzinfo is not None and not column.type.timezone:
			return value.astimezone(timezone.utc).replace(tzinfo=None)
		return value

	if isinstance(column.type, sa.Date) and isinstance(value, str):
		return date.fromisoformat(value)

	if isinstance(column.type, sa.Boolean) and isinstance(value, int):
		return bool(value)

	return value


def _resolve_missing_column_value(column: sa.Column[Any]) -> Any:
	default = column.default
	if default is not None:
		if default.is_scalar:
			return default.arg
		if default.is_callable:
			try:
				return default.arg()
			except TypeError:
				return default.arg(None)

	if column.server_default is not None:
		return _USE_SERVER_DEFAULT

	if column.nullable:
		return None

	raise RuntimeError(
		f"Target column {column.table.name}.{column.name} is required but missing from the SQLite source "
		"and has no default value.",
	)


def _build_insert_payload(target_table: sa.Table, source_row: RowMapping[str, Any]) -> dict[str, Any]:
	payload: dict[str, Any] = {}
	for column in target_table.columns:
		if column.name in source_row:
			payload[column.name] = _normalize_value_for_target(column, source_row[column.name])
			continue

		missing_value = _resolve_missing_column_value(column)
		if missing_value is _USE_SERVER_DEFAULT:
			continue
		payload[column.name] = missing_value

	return payload


def _copy_table_rows(
	source_connection: Connection,
	target_connection: Connection,
	target_table: sa.Table,
) -> TableImportSummary:
	source_table = sa.Table(target_table.name, sa.MetaData(), autoload_with=source_connection)
	source_rows = source_connection.execute(sa.select(source_table)).mappings()
	source_column_names = [column.name for column in source_table.columns]
	target_column_names = [column.name for column in target_table.columns]

	rows_imported = 0
	for source_row in source_rows:
		payload = _build_insert_payload(target_table, source_row)
		target_connection.execute(target_table.insert().values(**payload))
		rows_imported += 1

	return TableImportSummary(
		table=target_table.name,
		rows_imported=rows_imported,
		source_columns=source_column_names,
		target_columns=target_column_names,
	)


def _reset_postgres_sequences(target_connection: Connection, target_tables: list[sa.Table]) -> None:
	if target_connection.dialect.name != "postgresql":
		return

	identifier_preparer = target_connection.dialect.identifier_preparer
	for table in target_tables:
		primary_key_columns = list(table.primary_key.columns)
		if len(primary_key_columns) != 1:
			continue

		primary_key_column = primary_key_columns[0]
		if not isinstance(primary_key_column.type, sa.Integer):
			continue

		quoted_table_name = identifier_preparer.quote(table.name)
		quoted_column_name = identifier_preparer.quote(primary_key_column.name)
		target_connection.execute(
			sa.text(
				"SELECT setval("
				f"pg_get_serial_sequence('{table.name}', '{primary_key_column.name}'), "
				f"COALESCE(MAX({quoted_column_name}), 1), "
				f"COALESCE(MAX({quoted_column_name}), 0) > 0"
				f") FROM {quoted_table_name}",
			),
		)


def import_sqlite_to_target_database(source_path: Path) -> ImportSummary:
	target_database_url = _target_database_url()
	source_engine = _build_source_engine(source_path)
	target_engine = _build_engine(target_database_url)

	_run_target_migrations(target_database_url)
	target_tables, skipped_tables = _copyable_target_tables(source_engine)
	if not target_tables:
		raise RuntimeError("No overlapping tables were found between the SQLite source and the current schema.")

	with source_engine.connect() as source_connection, target_engine.begin() as target_connection:
		_ensure_target_tables_are_empty(target_connection, target_tables)
		imported_tables = [
			_copy_table_rows(source_connection, target_connection, table)
			for table in target_tables
		]
		_reset_postgres_sequences(target_connection, target_tables)

	return ImportSummary(
		source_sqlite_path=str(source_path),
		target_database_url=target_database_url,
		imported_tables=imported_tables,
		skipped_tables=skipped_tables,
		total_rows_imported=sum(table.rows_imported for table in imported_tables),
	)


def main() -> None:
	args = _parse_args()
	summary = import_sqlite_to_target_database(Path(args.source).expanduser().resolve())
	print(json.dumps(asdict(summary), ensure_ascii=False, indent=2))


if __name__ == "__main__":
	main()
