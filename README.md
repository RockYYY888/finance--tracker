# Personal Asset Tracker

## Project Description

A personal asset tracker for recording holdings and monitoring portfolio performance in CNY.
It helps you organize assets across accounts and keep positions up to date.
It provides a clear view of portfolio changes over time.

## Docker Compose

Local development does not assume a host proxy:

```bash
docker compose up -d --build
```

Default server build command (host deployment, using the host `mihomo` proxy):

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

If only the backend needs to be refreshed after a pull on the server:

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --force-recreate --no-deps backend
```

## Codex Feedback Automation Env

Use a project-local env file instead of global shell env:

```bash
cp .env.codex-feedback-automation.example .env.codex-feedback-automation.local
```

Load it before running feedback automation scripts:

```bash
set -a
source /Users/lyw/Desktop/finance/.env.codex-feedback-automation.local
set +a
```

## License

This project is licensed under **GNU Affero General Public License v3.0** (`AGPL-3.0-only`).
Closed-source commercial use is not permitted unless separately authorized by the author.

See [LICENSE](./LICENSE) for the full license text.

## Authorship

- Author: `Yiwei LI`
- Contact: `lywyoyo0318@gmail.com`
- Copyright (c) 2026 `Yiwei LI`
