# Personal Asset Tracker

Personal Asset Tracker is a personal portfolio tracker for cash accounts, holdings, liabilities,
and performance history. Agent-facing API documentation lives in
[docs/agent-api.md](docs/agent-api.md).

## Quick Start

### Local Build

```bash
docker compose up -d --build --remove-orphans
```

Open `http://127.0.0.1:8080`.
This starts `backend`, `worker`, `frontend`, `nginx`, and `redis`.
The local Redis endpoint is also published at `127.0.0.1:6380` for direct host-side testing.

Local nginx verification:

```bash
curl -I http://127.0.0.1:8080/
curl http://127.0.0.1:8080/api/health
```

If you previously ran the stack with `caddy`, keep `--remove-orphans` so the old container is removed
and `nginx` can bind `127.0.0.1:8080` cleanly.

### Local Redis Connectivity Check

```bash
docker compose up -d redis
cd backend
uv run pytest tests/test_runtime_redis.py
```

The Redis connectivity check exercises the real Redis container instead of a fake fallback.

### Server Or Proxy Build

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.proxy.yml up -d --build --remove-orphans
```

The proxy override file defaults to `http://host.docker.internal:7890`.

If your local proxy listens on another port such as `10808`, override it explicitly:

```bash
ASSET_TRACKER_HTTP_PROXY=http://host.docker.internal:10808 \
ASSET_TRACKER_HTTPS_PROXY=http://host.docker.internal:10808 \
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.proxy.yml up -d --build --remove-orphans
```

`backend` and `worker` now run Alembic migrations automatically on startup. Schema changes must ship
as Alembic revisions; `create_all()` is no longer the runtime source of truth.

Production compose now provisions `postgres` and `redis` inside the stack. Set
`ASSET_TRACKER_POSTGRES_PASSWORD`, `ASSET_TRACKER_SESSION_SECRET`, and `ASSET_TRACKER_PUBLIC_ORIGIN`
before the first server deployment.

Production data now lives in Postgres (`postgres_data`). `backend/data/asset_tracker.db` is only the
local/development SQLite file and should not be treated as the production database.

## Schema Migrations

When `backend/app/models.py` changes:

```bash
cd backend
uv run alembic revision --autogenerate -m "describe change"
uv run alembic upgrade head
uv run pytest
```

Server deploy:

```bash
git checkout main
git pull --ff-only origin main
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.proxy.yml up -d --build --remove-orphans
```

Routine server updates should use the command above.

If the update touches `backend/alembic/versions/`, `backend/app/models.py`,
`backend/app/database.py`, `backend/app/settings.py`, `backend/pyproject.toml`, or any
`docker-compose*.yml` file, back up `.env` and Postgres before deploying.

Deploy startup automatically runs `alembic upgrade head`.

If your remote host or external reverse proxy referenced the old `caddy` service by name, update it to
the new `nginx` service. If the host only forwarded traffic to port `8080`, no extra host-level route
change is required beyond pulling the latest code and rebuilding the compose stack.

For Codex-assisted deploys, use `$asset-tracker-server-update-sop`.
