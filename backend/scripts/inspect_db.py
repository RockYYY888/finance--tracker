from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
import os
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, inspect, text

from app.database import DATABASE_URL

UTC = ZoneInfo("UTC")
ASIA_SHANGHAI = ZoneInfo("Asia/Shanghai")
TIMESTAMP_COLUMN_NAMES = {
	"created_at",
	"updated_at",
	"replied_at",
	"reply_seen_at",
	"resolved_at",
	"last_updated",
	"market_time",
}
SAFE_TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SENSITIVE_COLUMN_NAMES = {"password_digest", "email_digest"}


def resolve_default_db_url() -> str:
	return os.getenv("ASSET_TRACKER_DATABASE_URL", DATABASE_URL)


def parse_utc_timestamp(value: str) -> datetime | None:
	normalized_value = value.strip()
	if not normalized_value:
		return None

	normalized_value = normalized_value.replace(" ", "T", 1)
	if normalized_value.endswith("Z"):
		normalized_value = normalized_value.replace("Z", "+00:00")

	try:
		parsed_value = datetime.fromisoformat(normalized_value)
	except ValueError:
		return None

	if parsed_value.tzinfo is None:
		return parsed_value.replace(tzinfo=UTC)

	return parsed_value.astimezone(UTC)


def is_timestamp_column(column_name: str) -> bool:
	return column_name in TIMESTAMP_COLUMN_NAMES or column_name.endswith("_at")


def _default_order_by_clause(database_url: str, table_name: str) -> str:
	engine = create_engine(database_url, pool_pre_ping=True)
	try:
		inspector = inspect(engine)
		column_names = {column_info["name"] for column_info in inspector.get_columns(table_name)}
	finally:
		engine.dispose()

	if {"created_at", "id"} <= column_names:
		return " ORDER BY created_at DESC, id DESC"
	if "id" in column_names:
		return " ORDER BY id DESC"
	return ""


def inspect_table(database_url: str, table_name: str, limit: int) -> None:
	if not SAFE_TABLE_NAME_PATTERN.fullmatch(table_name):
		raise ValueError("Unsafe table name.")

	order_by_clause = _default_order_by_clause(database_url, table_name)
	engine = create_engine(database_url, pool_pre_ping=True)
	try:
		with engine.connect() as connection:
			rows = connection.execute(
				text(f'SELECT * FROM "{table_name}"{order_by_clause} LIMIT :limit'),
				{"limit": limit},
			).mappings()
			for row in rows:
				output_row = dict(row)
				for column_name, column_value in dict(row).items():
					if column_name in SENSITIVE_COLUMN_NAMES:
						output_row[column_name] = "[REDACTED]"
						continue

					if not is_timestamp_column(column_name) or not isinstance(column_value, str):
						continue

					parsed_value = parse_utc_timestamp(column_value)
					if parsed_value is None:
						continue

					output_row[f"{column_name}_utc"] = parsed_value.isoformat().replace("+00:00", "Z")
					output_row[f"{column_name}_asia_shanghai"] = parsed_value.astimezone(
						ASIA_SHANGHAI,
					).isoformat()

				print(json.dumps(output_row, ensure_ascii=False))
	finally:
		engine.dispose()


def main() -> None:
	parser = argparse.ArgumentParser(
		description="Inspect PostgreSQL rows with UTC and Asia/Shanghai timestamp expansion.",
	)
	parser.add_argument("table", help="Table name to inspect.")
	parser.add_argument("--limit", type=int, default=20, help="Number of rows to print.")
	parser.add_argument(
		"--db-url",
		default=resolve_default_db_url(),
		help="SQLAlchemy database URL. Defaults to ASSET_TRACKER_DATABASE_URL or the local Postgres URL.",
	)
	args = parser.parse_args()

	inspect_table(args.db_url, args.table, args.limit)


if __name__ == "__main__":
	main()
