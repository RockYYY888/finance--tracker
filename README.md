# Personal Asset Tracker

## Authorship

- Author: `Yiwei LI`
- Contact: `lywyoyo0318@gmail.com`
- Copyright (c) 2026 `Yiwei LI`

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
