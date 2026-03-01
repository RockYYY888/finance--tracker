# Personal Asset Tracker

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
