# Changelog

## v0.7.0 - 2026-03-24

- Legacy server migration and production hardening
- Added a one-command first-server migration script that backs up .env and legacy SQLite files, rewrites production env settings, provisions Redis and Postgres, imports overlapping legacy data, and rebuilds the stack.
- Switched production deployment to a Redis + Postgres + Alembic model, with explicit non-SQLite enforcement and startup-time schema upgrades.
- Added nginx proxy rollout, agent registration and actor-source audit support, plus multi-user concurrency and cache hardening.
- Fixed analytics timeline alignment, workspace state regressions, and several asset-management UI issues.
- GitHub Release: https://github.com/RockYYY888/finance--tracker/releases/tag/v0.7.0

## v0.6.5 - 2026-03-10

- Split the background job worker into a dedicated process and compose service
- Stopped the API process from starting or owning portfolio rebuild and agent task execution loops

## v0.6.4 - 2026-03-10

- Moved portfolio snapshot rebuilds and agent task execution onto durable background jobs
- Made dashboard reads query-only and appended transient live points without request-time writes

## v0.6.3 - 2026-03-10

- Added transfer editing, manual cash-ledger corrections, and agent-linked audit traces
- Added cash correction and audit panels to the records workspace

## v0.6.2 - 2026-03-10

- Added cash-ledger replay, cash transfers, and buy-side cash settlements
- Added holding transaction history editing and agent idempotency/task APIs
- Fixed asset-form auto-refresh resets and tightened sell/transfer quantity guards

## v0.6.1 - 2026-03-10

- Switched holdings to transaction-first semantics and added agent-ready trade correction APIs
- Reconciled sell proceeds on trade edits, trade deletes, and holding deletes
- Simplified holding buy and sell flows and refined analytics chart baselines

## v0.6.0 - 2026-03-05

- Improved trend-chart readability and hover summaries
- Consolidated release-note delivery into a single rolling inbox card

## v0.5.0 - 2026-03-05

- Added release-note drafting, publishing, and user inbox delivery
