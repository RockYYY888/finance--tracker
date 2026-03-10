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

Issuing the first token for a given `name` also creates or re-activates a stable
Agent registration record. Registrations stay visible even if you later rotate or
revoke individual tokens.

## Core Endpoints

Trading events are the source of truth for holdings and holding-return charts.
Cash ledger events are the source of truth for cash balances and portfolio-total replay.
Use holding routes only for metadata reads or metadata-only edits.

- `GET /api/agent/context`
  Returns portfolio summary, cash accounts, holdings, recent holding transactions, pending sync count, and warnings
- `GET /api/agent/registrations`
  Lists registered agents for the current account. Admin may pass `include_all_users=true`
  to inspect which app accounts have connected which agents
- `GET /api/dashboard`
  Returns the full dashboard including timeline series from cached or rebuilt projections
- `GET /api/accounts`
  Lists cash accounts
- `POST /api/accounts`
  Creates a cash account
- `PUT /api/accounts/{account_id}`
  Updates account metadata and reconciles the initial-balance ledger entry
- `DELETE /api/accounts/{account_id}`
  Deletes a cash account only when it has no non-baseline ledger activity
- `GET /api/cash-ledger`
  Lists ledger entries, supports `account_id` and `limit`
- `POST /api/cash-ledger/adjustments`
  Appends a manual cash-ledger correction and replays cash balance plus portfolio total history
- `PATCH /api/cash-ledger/adjustments/{entry_id}`
  Edits one manual ledger correction, only for `MANUAL_ADJUSTMENT` entries
- `DELETE /api/cash-ledger/adjustments/{entry_id}`
  Deletes one manual ledger correction and rolls back its cash effect
- `GET /api/cash-transfers`
  Lists account-to-account transfer events
- `POST /api/cash-transfers`
  Creates a transfer event and writes paired ledger entries
- `PATCH /api/cash-transfers/{transfer_id}`
  Edits a transfer event and replays both sides of the paired ledger entries
- `DELETE /api/cash-transfers/{transfer_id}`
  Deletes a transfer event and rolls back paired ledger entries
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
  Edits one transaction and replays holding projection plus linked cash settlement effects
- `DELETE /api/holding-transactions/{transaction_id}`
  Deletes one transaction, reconciles holding projection, and rolls back linked cash settlement effects
- `GET /api/agent/tasks`
  Lists structured agent tasks
- `POST /api/agent/tasks`
  Queues a validated task envelope for buy, sell, transfer, transfer correction, or ledger correction
- `GET /api/asset-records`
  Lists immutable asset records, supports `limit`, `asset_class`, `operation_kind`, and `source`
- `GET /api/securities/search?q=...`
  Searches tradable symbols
- `GET /api/securities/quote?symbol=...&market=...`
  Fetches the latest cached or live quote for a symbol

## Idempotency

For agent-triggered create calls, send:

```http
Idempotency-Key: <unique_key_per_intent>
```

Supported now:

- `POST /api/holding-transactions`
- `POST /api/cash-transfers`
- `POST /api/cash-ledger/adjustments`
- `POST /api/agent/tasks`

If the same key is reused with the same request body, the backend replays the original response.
If the key is reused with a different body, the backend returns `409`.

## Agent Task Execution Model

- Agent registrations are the durable identity of an agent runtime
- Agent tokens are revocable credentials attached to a registration
- Registration status is `ACTIVE` when at least one token is still usable, otherwise `INACTIVE`
- `POST /api/agent/tasks` returns the created task immediately
- Task status moves through `PENDING` -> `RUNNING` -> `DONE` or `FAILED`
- Poll `GET /api/agent/tasks` to observe completion and read `result`
- Agent-triggered writes schedule snapshot rebuild jobs asynchronously
- Those background jobs are executed by the dedicated `worker` process, not by the API process
- `GET /api/dashboard` stays read-only and does not execute pending rebuild jobs inline

## Minimal Agent Call Pattern

1. `GET /api/agent/context`
2. `GET /api/agent/registrations`
3. `GET /api/securities/search`
4. `GET /api/securities/quote`
5. `POST /api/holding-transactions`
6. `GET /api/agent/context`

For cash movement:

1. `GET /api/agent/context`
2. `GET /api/cash-ledger`
3. `POST /api/cash-transfers`
4. `GET /api/agent/context`

For cash-ledger anomaly correction:

1. `GET /api/cash-ledger`
2. `PATCH /api/cash-transfers/{transfer_id}` or `PATCH /api/cash-ledger/adjustments/{entry_id}`
3. `GET /api/asset-records?source=AGENT`
   Read the immutable AGENT-side records after the task has been executed
4. `GET /api/agent/context`

If the agent needs to correct a previously recorded trade, prefer
`PATCH /api/holding-transactions/{transaction_id}`.
Do not patch `/api/holdings/{holding_id}` for quantity, cost, or dates.

## Buy Example

```bash
curl -X POST http://127.0.0.1:8080/api/holding-transactions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Idempotency-Key: buy-aapl-20260309-001' \
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
    "note": "agent buy",
    "buy_funding_handling": "DEDUCT_FROM_EXISTING_CASH",
    "buy_funding_account_id": 3
  }'
```

## Sell Example

```bash
curl -X POST http://127.0.0.1:8080/api/holding-transactions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Idempotency-Key: sell-aapl-20260309-001' \
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

## Cash Transfer Example

```bash
curl -X POST http://127.0.0.1:8080/api/cash-transfers \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Idempotency-Key: transfer-20260309-001' \
  -H 'X-API-Key: <server_api_token_if_configured>' \
  -d '{
    "from_account_id": 3,
    "to_account_id": 9,
    "source_amount": 500,
    "transferred_on": "2026-03-09",
    "note": "rebalance broker cash"
  }'
```

## Manual Ledger Adjustment Example

```bash
curl -X POST http://127.0.0.1:8080/api/cash-ledger/adjustments \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Idempotency-Key: ledger-adjustment-20260310-001' \
  -H 'X-API-Key: <server_api_token_if_configured>' \
  -d '{
    "cash_account_id": 3,
    "amount": -18.6,
    "happened_on": "2026-03-10",
    "note": "bank reconciliation difference"
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
    "note": "corrected after broker confirmation",
    "sell_proceeds_handling": "ADD_TO_EXISTING_CASH",
    "sell_proceeds_account_id": 9
  }'
```

## Agent Task Example

```bash
curl -X POST http://127.0.0.1:8080/api/agent/tasks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Idempotency-Key: task-20260309-001' \
  -H 'X-API-Key: <server_api_token_if_configured>' \
  -d '{
    "task_type": "CREATE_CASH_TRANSFER",
    "payload": {
      "from_account_id": 3,
      "to_account_id": 9,
      "source_amount": 500,
      "transferred_on": "2026-03-09"
    }
  }'
```

Agent task types currently include:

- `CREATE_BUY_TRANSACTION`
- `CREATE_SELL_TRANSACTION`
- `UPDATE_HOLDING_TRANSACTION`
- `CREATE_CASH_TRANSFER`
- `UPDATE_CASH_TRANSFER`
- `CREATE_CASH_LEDGER_ADJUSTMENT`
- `UPDATE_CASH_LEDGER_ADJUSTMENT`
- `DELETE_CASH_LEDGER_ADJUSTMENT`

## Chart Semantics

- Holding return charts are rebuilt from transaction history
- Editing a transaction date moves the affected holding return curve because replay starts from the updated trade date
- Portfolio total value charts are rebuilt from cash-ledger events, holding transactions, and asset start dates
- Buy-side cash deductions and account transfers now change both current totals and replayed timeline history

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
