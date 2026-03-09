# TO-DO LIST

## Current Sprint: Trading Source Of Truth

### Pending
- [ ] Add UI for listing and editing individual holding transactions through the new transaction patch API
- [ ] Introduce cash ledger entries for buy-side cash outflows and full portfolio-history replay
- [ ] Add admin UI controls for manual category/priority/source/status editing (uses classify API)
- [ ] Add Trading Agent ingestion path to create `SYSTEM_TASK` tickets with structured payload
- [ ] Add dashboard-level filter tabs for ticket status/priority in admin inbox

### Risks / Notes
- [x] Holding quantity, cost basis, and holding-date edits no longer overwrite transaction history
- [x] Sell transaction edits and deletes now reverse linked cash proceeds before replaying the new state
- [x] Holding return charts are rebuilt from transaction history instead of current holding snapshots
- [x] Deleting a holding now also reverses linked sell-proceeds cash effects instead of leaving stale cash behind
- [x] Transaction list APIs now expose sell-proceeds handling metadata for agent-side reconciliation
- Skill validator requires `PyYAML`; local system python is externally managed, so validation was executed with `/tmp/skill-validate-venv`.
