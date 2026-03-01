# Personal Asset Tracker

## Docker Compose

Local development does not assume a host proxy:

```bash
docker compose up -d --build
```

Server deployment that needs the host `mihomo` proxy should include the proxy override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

If only the backend needs to be refreshed after a pull on the server:

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --force-recreate --no-deps backend
```
