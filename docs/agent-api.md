# Agent API

For the current phase, HTTP JSON APIs are enough. You do not need MCP first.

Use MCP later only if you need a broker-agnostic tool layer, typed tool discovery, or
multi-tool coordination across several agent runtimes. Right now the faster path is:

1. Expose stable backend HTTP APIs
2. Let the agent call them with `Bearer token`
3. Keep broker execution and broker-secret storage as a separate later step

## Auth Model

All authenticated asset APIs support either:

- Browser session cookie for the web app
- `Authorization: Bearer <agent_token>` for agents and scripts

If the server sets `ASSET_TRACKER_API_TOKEN`, every request must also send:

```http
X-API-Key: <server_api_token>
```

That server token is a deployment gate. It is not the per-user trading token.

## Bootstrap An Agent Token

Use the account password only once to issue a per-user agent token:

```bash
curl -X POST http://127.0.0.1:8080/api/agent/tokens/issue \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <server_api_token_if_configured>' \
  -d '{
    "user_id": "tester",
    "password": "your-login-password",
    "name": "quant-runner",
    "expires_in_days": 180
  }'
```

Response shape:

```json
{
  "id": 1,
  "name": "quant-runner",
  "token_hint": "...f3a9c1",
  "created_at": "2026-03-09T12:00:00Z",
  "updated_at": "2026-03-09T12:00:00Z",
  "last_used_at": null,
  "expires_at": "2026-09-05T12:00:00Z",
  "revoked_at": null,
  "access_token": "atrk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

After that, the agent should stop sending the password and only use:

```http
Authorization: Bearer <access_token>
```

If you are already logged in through the web session, you can also manage tokens through:

- `POST /api/agent/tokens`
- `GET /api/agent/tokens`
- `DELETE /api/agent/tokens/{token_id}`

These session-based token-management routes are meant for interactive human control.

## Core Endpoints

Trading events are the source of truth for holdings and holding-return charts.
Use holding routes only for metadata reads or metadata-only edits.

- `GET /api/agent/context`
  Returns portfolio summary, cash accounts, holdings, recent holding transactions, pending sync count, and warnings
- `GET /api/dashboard`
  Returns the full dashboard including timeline series
- `GET /api/accounts`
  Lists cash accounts
- `POST /api/accounts`
  Creates a cash account
- `PUT /api/accounts/{account_id}`
  Updates a cash account
- `DELETE /api/accounts/{account_id}`
  Deletes a cash account
- `GET /api/holdings`
  Lists current holdings
- `PUT /api/holdings/{holding_id}`
  Metadata-only edit for fields such as broker or note
- `DELETE /api/holdings/{holding_id}`
  Deletes a holding, its transaction history, and linked sell-proceeds cash effects
- `GET /api/holding-transactions`
  Lists all buy and sell transactions, supports `symbol`, `market`, `side`, `limit`
- `GET /api/holdings/{holding_id}/transactions`
  Lists transactions for one holding
- `POST /api/holding-transactions`
  Appends a buy or sell transaction and rebuilds holding projection
- `PATCH /api/holding-transactions/{transaction_id}`
  Edits one transaction and replays holding projection plus linked sell-proceeds cash effects
- `DELETE /api/holding-transactions/{transaction_id}`
  Deletes one transaction, reconciles holding projection, and rolls back linked sell-proceeds cash effects
- `GET /api/securities/search?q=...`
  Searches tradable symbols
- `GET /api/securities/quote?symbol=...&market=...`
  Fetches the latest cached or live quote for a symbol

## Minimal Agent Call Pattern

1. `GET /api/agent/context`
2. `GET /api/securities/search`
3. `GET /api/securities/quote`
4. `POST /api/holding-transactions`
5. `GET /api/agent/context`

If the agent needs to correct a previously recorded trade, prefer
`PATCH /api/holding-transactions/{transaction_id}`.
Do not patch `/api/holdings/{holding_id}` for quantity, cost, or dates.

## Buy Example

```bash
curl -X POST http://127.0.0.1:8080/api/holding-transactions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'X-API-Key: <server_api_token_if_configured>' \
  -d '{
    "side": "BUY",
    "symbol": "AAPL",
    "name": "Apple",
    "quantity": 2,
    "price": 188.5,
    "fallback_currency": "USD",
    "market": "US",
    "broker": "Futu",
    "traded_on": "2026-03-09",
    "note": "agent buy"
  }'
```

## Sell Example

```bash
curl -X POST http://127.0.0.1:8080/api/holding-transactions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'X-API-Key: <server_api_token_if_configured>' \
  -d '{
    "side": "SELL",
    "symbol": "AAPL",
    "name": "Apple",
    "quantity": 1,
    "price": 190,
    "fallback_currency": "USD",
    "market": "US",
    "broker": "Futu",
    "traded_on": "2026-03-09",
    "note": "agent sell",
    "sell_proceeds_handling": "ADD_TO_EXISTING_CASH",
    "sell_proceeds_account_id": 9
  }'
```

## Trade Correction Example

```bash
curl -X PATCH http://127.0.0.1:8080/api/holding-transactions/42 \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'X-API-Key: <server_api_token_if_configured>' \
  -d '{
    "traded_on": "2026-03-07",
    "quantity": 2,
    "price": 191.2,
    "note": "corrected after broker confirmation"
  }'
```

## Chart Semantics

- Holding return charts are rebuilt from transaction history
- Editing a transaction date moves the affected holding return curve because replay starts from the updated trade date
- Portfolio total value charts still use stored portfolio snapshots rather than a full cash-ledger replay

## Secret Handling

- Backend login password
  Send it only once when issuing an agent token, and only over HTTPS in production
- Agent token
  Store it in the agent runtime secret store or environment, not in prompt text or source code
- Broker account, broker password, broker API secret
  Do not pass them through `/api/holding-transactions` or other asset-record APIs

At this stage the backend is a portfolio and transaction system, not a broker execution gateway.
When broker execution is introduced later, use a separate credential API or secret vault with:

- A dedicated encryption key from environment or external secret manager
- Narrowly scoped execution tokens
- Audit logging per execution request
- Explicit broker adapters instead of generic free-form secret blobs
