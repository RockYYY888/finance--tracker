#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

HOST_PROXY_URL="${ASSET_TRACKER_HOST_PROXY:-}"
CONTAINER_PROXY_URL="${ASSET_TRACKER_CONTAINER_PROXY:-}"

detect_default_host_proxy() {
	python3 - <<'PY'
from __future__ import annotations

import socket

for port in (10808, 7890):
	with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
		sock.settimeout(0.5)
		if sock.connect_ex(("127.0.0.1", port)) == 0:
			print(f"http://127.0.0.1:{port}")
			raise SystemExit(0)

raise SystemExit(1)
PY
}

if [[ -z "$HOST_PROXY_URL" ]]; then
	if detected_host_proxy="$(detect_default_host_proxy)"; then
		HOST_PROXY_URL="$detected_host_proxy"
	fi
fi

if [[ -z "$CONTAINER_PROXY_URL" && -n "$HOST_PROXY_URL" ]]; then
	host_proxy_port="${HOST_PROXY_URL##*:}"
	CONTAINER_PROXY_URL="http://host.docker.internal:${host_proxy_port}"
fi

if [[ -n "$HOST_PROXY_URL" ]]; then
	export http_proxy="$HOST_PROXY_URL"
	export https_proxy="$HOST_PROXY_URL"
	export HTTP_PROXY="$HOST_PROXY_URL"
	export HTTPS_PROXY="$HOST_PROXY_URL"
else
	unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY 2>/dev/null || true
fi
export no_proxy="127.0.0.1,localhost"
export NO_PROXY="127.0.0.1,localhost"

compose=(
	docker compose
	-f docker-compose.yml
	-f docker-compose.production.yml
)

require_command() {
	local name="$1"
	if ! command -v "$name" >/dev/null 2>&1; then
		echo "Missing required command: $name" >&2
		exit 1
	fi
}

wait_healthy() {
	local service="$1"
	local container_id=""
	local status=""

	for _ in $(seq 1 60); do
		container_id="$("${compose[@]}" ps -q "$service" | tail -n 1)"
		if [[ -n "$container_id" ]]; then
			status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
			if [[ "$status" == "healthy" || "$status" == "running" ]]; then
				return 0
			fi
		fi
		sleep 2
	done

	echo "Service $service did not become healthy in time." >&2
	"${compose[@]}" logs --tail=120 "$service" || true
	exit 1
}

require_command git
require_command docker
require_command python3
require_command curl

if [[ ! -f .env ]]; then
	echo "Missing .env in $ROOT_DIR" >&2
	exit 1
fi

if [[ ! -f backend/data/asset_tracker.db ]]; then
	echo "Missing legacy SQLite file at backend/data/asset_tracker.db" >&2
	exit 1
fi

existing_container_proxy="$(python3 - <<'PY'
from pathlib import Path

env_path = Path(".env")
if not env_path.exists():
	raise SystemExit(0)

for raw_line in env_path.read_text(encoding="utf-8").splitlines():
	if raw_line.startswith("ASSET_TRACKER_HTTP_PROXY=") or raw_line.startswith("ASSET_TRACKER_HTTPS_PROXY="):
		_, value = raw_line.split("=", 1)
		value = value.strip()
		if value:
			print(value)
			break
PY
)"

if [[ -n "$CONTAINER_PROXY_URL" || -n "$existing_container_proxy" ]]; then
	compose+=(-f docker-compose.proxy.yml)
fi

tracked_changes="$(git status --porcelain --untracked-files=no)"
if [[ -n "$tracked_changes" ]]; then
	echo "Tracked git changes detected. Commit or stash them before running this migration." >&2
	git status --short
	exit 1
fi

git checkout main
git pull --ff-only origin main

timestamp="$(date +%Y%m%d-%H%M%S)"
cp .env ".env.bak.${timestamp}"

backup_dir="backend/data/legacy-sqlite-backup.${timestamp}"
mkdir -p "$backup_dir"
for file in backend/data/asset_tracker.db backend/data/asset_tracker.db-wal backend/data/asset_tracker.db-shm; do
	if [[ -e "$file" ]]; then
		cp "$file" "$backup_dir/"
	fi
done

export SCRIPT_CONTAINER_PROXY_URL="$CONTAINER_PROXY_URL"

python3 - <<'PY'
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote, urlparse
import secrets


env_path = Path(".env")
original_lines = env_path.read_text(encoding="utf-8").splitlines()

entries: list[tuple[str, str]] = []
index_by_key: dict[str, int] = {}
values: dict[str, str] = {}

for raw_line in original_lines:
	stripped = raw_line.strip()
	if not stripped or stripped.startswith("#") or "=" not in raw_line:
		entries.append(("", raw_line))
		continue

	key, value = raw_line.split("=", 1)
	key = key.strip()
	value = value.strip()
	index_by_key[key] = len(entries)
	values[key] = value
	entries.append((key, value))


def set_value(key: str, value: str) -> None:
	values[key] = value
	if key in index_by_key:
		entries[index_by_key[key]] = (key, value)
		return
	index_by_key[key] = len(entries)
	entries.append((key, value))


def ensure_value(key: str, value: str) -> None:
	if values.get(key):
		return
	set_value(key, value)


def remove_value(key: str) -> None:
	values.pop(key, None)
	if key not in index_by_key:
		return
	entries[index_by_key[key]] = ("", "")


public_origin = values.get("ASSET_TRACKER_PUBLIC_ORIGIN", "").strip()
domain = values.get("ASSET_TRACKER_DOMAIN", "").strip()
if not public_origin:
	if domain.startswith(("http://", "https://")):
		public_origin = domain
	elif domain:
		public_origin = f"http://{domain}:8080"
	else:
		public_origin = "http://127.0.0.1:8080"

origin_host = urlparse(public_origin).hostname or "127.0.0.1"

ensure_value("ASSET_TRACKER_SESSION_SECRET", secrets.token_urlsafe(48))
ensure_value("ASSET_TRACKER_POSTGRES_DB", "asset_tracker")
ensure_value("ASSET_TRACKER_POSTGRES_USER", "asset_tracker")
ensure_value("ASSET_TRACKER_POSTGRES_PASSWORD", secrets.token_hex(16))

postgres_user = values["ASSET_TRACKER_POSTGRES_USER"]
postgres_password = values["ASSET_TRACKER_POSTGRES_PASSWORD"]
postgres_db = values["ASSET_TRACKER_POSTGRES_DB"]
encoded_password = quote(postgres_password, safe="")

set_value("ASSET_TRACKER_APP_ENV", "production")
set_value("ASSET_TRACKER_PUBLIC_ORIGIN", public_origin)
ensure_value("ASSET_TRACKER_ALLOWED_ORIGINS", public_origin)
ensure_value("ASSET_TRACKER_ALLOWED_HOSTS", f"{origin_host},localhost,127.0.0.1")
set_value(
	"ASSET_TRACKER_DATABASE_URL",
	f"postgresql+psycopg://{postgres_user}:{encoded_password}@postgres:5432/{postgres_db}",
)
set_value("ASSET_TRACKER_REDIS_URL", "redis://redis:6379/0")

container_proxy_url = os.environ.get("SCRIPT_CONTAINER_PROXY_URL", "").strip()
if container_proxy_url:
	set_value("ASSET_TRACKER_HTTP_PROXY", container_proxy_url)
	set_value("ASSET_TRACKER_HTTPS_PROXY", container_proxy_url)
	set_value(
		"ASSET_TRACKER_NO_PROXY",
		values.get("ASSET_TRACKER_NO_PROXY")
		or "localhost,127.0.0.1,backend,worker,frontend,nginx,redis,postgres",
	)
else:
	remove_value("ASSET_TRACKER_HTTP_PROXY")
	remove_value("ASSET_TRACKER_HTTPS_PROXY")

rendered_lines: list[str] = []
for key, value in entries:
	if not key:
		if value:
			rendered_lines.append(value)
		continue
	rendered_lines.append(f"{key}={values[key]}")

env_path.write_text("\n".join(rendered_lines).rstrip() + "\n", encoding="utf-8")
PY

"${compose[@]}" down --remove-orphans || true
"${compose[@]}" build backend worker frontend nginx
"${compose[@]}" up -d postgres redis

wait_healthy postgres
wait_healthy redis

"${compose[@]}" run --rm backend python - <<'PY'
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
import json
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
import sqlalchemy as sa
from sqlalchemy.engine import Connection, RowMapping
from sqlmodel import SQLModel

from app.database import ALEMBIC_CONFIG_PATH, _build_engine
from app.settings import get_settings
import app.models  # noqa: F401

SKIPPED_TABLES = {"alembic_version"}
USE_SERVER_DEFAULT = object()


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


def target_database_url() -> str:
	settings = get_settings()
	database_url = settings.database_url_value()
	if database_url is None:
		raise ValueError("ASSET_TRACKER_DATABASE_URL must be set.")
	if settings.database_uses_sqlite():
		raise ValueError("Production import target cannot be SQLite.")
	return database_url


def run_target_migrations(database_url: str) -> None:
	alembic_config = Config(str(ALEMBIC_CONFIG_PATH))
	alembic_config.set_main_option("script_location", str(ALEMBIC_CONFIG_PATH.parent / "alembic"))
	alembic_config.set_main_option("sqlalchemy.url", database_url)
	command.upgrade(alembic_config, "head")


def copyable_target_tables(source_engine) -> tuple[list[sa.Table], list[str]]:
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


def normalize_value_for_target(column: sa.Column[Any], value: Any) -> Any:
	if value is None:
		return None
	if isinstance(column.type, sa.DateTime):
		if isinstance(value, str):
			value = datetime.fromisoformat(value.replace("Z", "+00:00"))
		if isinstance(value, datetime) and value.tzinfo is not None and not column.type.timezone:
			return value.astimezone(timezone.utc).replace(tzinfo=None)
		return value
	if isinstance(column.type, sa.Date) and isinstance(value, str):
		return date.fromisoformat(value)
	if isinstance(column.type, sa.Boolean) and isinstance(value, int):
		return bool(value)
	return value


def resolve_missing_column_value(column: sa.Column[Any]) -> Any:
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
		return USE_SERVER_DEFAULT
	if column.nullable:
		return None
	raise RuntimeError(
		f"Target column {column.table.name}.{column.name} is required but missing from the SQLite source.",
	)


def build_insert_payload(target_table: sa.Table, source_row: RowMapping[str, Any]) -> dict[str, Any]:
	payload: dict[str, Any] = {}
	for column in target_table.columns:
		if column.name in source_row:
			payload[column.name] = normalize_value_for_target(column, source_row[column.name])
			continue
		missing_value = resolve_missing_column_value(column)
		if missing_value is USE_SERVER_DEFAULT:
			continue
		payload[column.name] = missing_value
	return payload


def ensure_target_tables_are_empty(target_connection: Connection, target_tables: list[sa.Table]) -> None:
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
			f"Non-empty tables: {', '.join(non_empty_tables)}.",
		)


def copy_table_rows(
	source_connection: Connection,
	target_connection: Connection,
	target_table: sa.Table,
) -> TableImportSummary:
	source_table = sa.Table(target_table.name, sa.MetaData(), autoload_with=source_connection)
	source_rows = source_connection.execute(sa.select(source_table)).mappings()
	rows_imported = 0
	for source_row in source_rows:
		payload = build_insert_payload(target_table, source_row)
		target_connection.execute(target_table.insert().values(**payload))
		rows_imported += 1
	return TableImportSummary(
		table=target_table.name,
		rows_imported=rows_imported,
		source_columns=[column.name for column in source_table.columns],
		target_columns=[column.name for column in target_table.columns],
	)


def reset_postgres_sequences(target_connection: Connection, target_tables: list[sa.Table]) -> None:
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


source_path = Path("/app/data/asset_tracker.db")
if not source_path.exists():
	raise FileNotFoundError(f"SQLite source file was not found: {source_path}")

database_url = target_database_url()
source_engine = _build_engine(f"sqlite:///{source_path}")
target_engine = _build_engine(database_url)

run_target_migrations(database_url)
target_tables, skipped_tables = copyable_target_tables(source_engine)
if not target_tables:
	raise RuntimeError("No overlapping tables were found between the SQLite source and the current schema.")

with source_engine.connect() as source_connection, target_engine.begin() as target_connection:
	ensure_target_tables_are_empty(target_connection, target_tables)
	imported_tables = [
		copy_table_rows(source_connection, target_connection, table)
		for table in target_tables
	]
	reset_postgres_sequences(target_connection, target_tables)

summary = ImportSummary(
	source_sqlite_path=str(source_path),
	target_database_url=database_url,
	imported_tables=imported_tables,
	skipped_tables=skipped_tables,
	total_rows_imported=sum(table.rows_imported for table in imported_tables),
)
print(json.dumps(asdict(summary), ensure_ascii=False, indent=2))
PY

"${compose[@]}" up -d --build --remove-orphans

health_ok=""
for _ in $(seq 1 60); do
	if curl -fsS http://127.0.0.1:8080/api/health >/tmp/asset-tracker-health.json 2>/dev/null; then
		health_ok="yes"
		break
	fi
	sleep 2
done

if [[ "$health_ok" != "yes" ]]; then
	echo "Health check failed after redeploy." >&2
	"${compose[@]}" logs --tail=120 backend worker postgres redis nginx || true
	exit 1
fi

"${compose[@]}" ps
cat /tmp/asset-tracker-health.json
echo
"${compose[@]}" logs --tail=120 backend worker postgres redis nginx

echo
echo "SQLite backup directory: $backup_dir"
echo "Env backup file: .env.bak.${timestamp}"
