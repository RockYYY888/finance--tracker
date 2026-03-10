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

### Server Or Proxy Build

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

The proxy override file defaults to `http://host.docker.internal:7890`.

If your local proxy listens on another port such as `10808`, override it explicitly:

```bash
ASSET_TRACKER_HTTP_PROXY=http://host.docker.internal:10808 \
ASSET_TRACKER_HTTPS_PROXY=http://host.docker.internal:10808 \
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```
