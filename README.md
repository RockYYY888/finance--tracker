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
This starts `backend`, `worker`, `frontend`, `nginx`, `postgres`, and `redis`.
The local Postgres endpoint is also published at `127.0.0.1:5433` for direct host-side testing.
The local Redis endpoint is also published at `127.0.0.1:6380` for direct host-side testing.
Local app data lives in the persistent Postgres database `asset_tracker`.

Local nginx verification:

```bash
curl -I http://127.0.0.1:8080/
curl http://127.0.0.1:8080/api/health
```

If you previously ran the stack with `caddy`, keep `--remove-orphans` so the old container is removed
and `nginx` can bind `127.0.0.1:8080` cleanly.

### Local Redis Connectivity Check

```bash
docker compose up -d postgres redis
cd backend
uv run pytest tests/test_runtime_redis.py
```

The runtime connectivity check exercises the real Postgres and Redis containers instead of local fallbacks.
Backend tests use a persistent local Postgres test database named `asset_tracker_test`; the database is
kept, while test runs recreate its schema before each test for isolation.

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

Compose now provisions `postgres` and `redis` inside the stack. Set
`ASSET_TRACKER_POSTGRES_PASSWORD`, `ASSET_TRACKER_SESSION_SECRET`, and `ASSET_TRACKER_PUBLIC_ORIGIN`
before the first server deployment.

Application data now lives in Postgres (`postgres_data`) for both local compose and production.
Redis only stores runtime cache, queue, and lock state.

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

After a versioned production deploy passes health checks, push the same changelog version into the
in-app release-note stream from local:

```bash
python3 scripts/push_release_note_from_changelog.py \
  --origin https://your-server-origin \
  --title '稳定性与体验更新' \
  --content $'- 第一条用户可见变化\n- 第二条用户可见变化' \
  --admin-password 'your-admin-password' \
  --api-token 'your-api-token'
```

The script verifies the local `CHANGELOG.md` version against the published GitHub release `vX.Y.Z`
before sending the release note. Prefer a short user-facing summary here instead of the full
technical changelog body. Re-running the same version is safe.

If the update touches `backend/alembic/versions/`, `backend/app/models.py`,
`backend/app/database.py`, `backend/app/settings.py`, `backend/pyproject.toml`, or any
`docker-compose*.yml` file, back up `.env` and Postgres before deploying.

Deploy startup automatically runs `alembic upgrade head`.

If your remote host or external reverse proxy referenced the old `caddy` service by name, update it to
the new `nginx` service. If the host only forwarded traffic to port `8080`, no extra host-level route
change is required beyond pulling the latest code and rebuilding the compose stack.

For Codex-assisted deploys, use `$asset-tracker-server-update-sop`. For the post-deploy changelog
push, use `$asset-tracker-changelog-push-sop`.
