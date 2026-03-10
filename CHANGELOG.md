# Changelog

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
