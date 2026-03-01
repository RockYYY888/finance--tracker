from __future__ import annotations

import argparse
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

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


def resolve_default_db_path() -> Path:
	return Path(__file__).resolve().parents[1] / "data" / "asset_tracker.db"


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


def inspect_table(db_path: Path, table_name: str, limit: int) -> None:
	if not SAFE_TABLE_NAME_PATTERN.fullmatch(table_name):
		raise ValueError("Unsafe table name.")

	with sqlite3.connect(db_path) as connection:
		connection.row_factory = sqlite3.Row
		rows = connection.execute(
			f"SELECT * FROM {table_name} ORDER BY rowid DESC LIMIT ?",
			(limit,),
		).fetchall()

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


def main() -> None:
	parser = argparse.ArgumentParser(
		description="Inspect SQLite rows with UTC and Asia/Shanghai timestamp expansion.",
	)
	parser.add_argument("table", help="Table name to inspect.")
	parser.add_argument("--limit", type=int, default=20, help="Number of rows to print.")
	parser.add_argument(
		"--db",
		type=Path,
		default=resolve_default_db_path(),
		help="Path to the SQLite database file.",
	)
	args = parser.parse_args()

	inspect_table(args.db, args.table, args.limit)


if __name__ == "__main__":
	main()
