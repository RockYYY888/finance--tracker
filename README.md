# Personal Asset Tracker

Personal Asset Tracker is a personal portfolio tracker for cash accounts, holdings, liabilities,
and performance history. Agent-facing API documentation lives in
[docs/agent-api.md](docs/agent-api.md).

## Quick Start

### Local Build

```bash
docker compose up -d --build
```

Open `http://127.0.0.1:8080`.
This starts `backend`, `worker`, `frontend`, `caddy`, and `redis`.
The local Redis endpoint is also published at `127.0.0.1:6380` for direct host-side testing.

### Local Redis Connectivity Check

```bash
docker compose up -d redis
cd backend
uv run pytest tests/test_runtime_redis.py
```

The Redis connectivity check exercises the real Redis container instead of a fake fallback.

### Server Or Proxy Build

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.proxy.yml up -d --build
```

The proxy override file defaults to `http://host.docker.internal:7890`.

If your local proxy listens on another port such as `10808`, override it explicitly:

```bash
ASSET_TRACKER_HTTP_PROXY=http://host.docker.internal:10808 \
ASSET_TRACKER_HTTPS_PROXY=http://host.docker.internal:10808 \
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.proxy.yml up -d --build
```

`backend` and `worker` now run Alembic migrations automatically on startup. Schema changes must ship
as Alembic revisions; `create_all()` is no longer the runtime source of truth.

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
git pull
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.proxy.yml up -d --build
```

Deploy startup automatically runs `alembic upgrade head`.
