# TO-DO LIST

## Current Sprint: Daily Feedback Approval Loop

### Pending
- [ ] Add admin UI controls for manual category/priority/source/status editing (uses classify API)
- [ ] Add Trading Agent ingestion path to create `SYSTEM_TASK` tickets with structured payload
- [ ] Add dashboard-level filter tabs for ticket status/priority in admin inbox

### Risks / Notes
- Skill validator requires `PyYAML`; local system python is externally managed, so validation was executed with `/tmp/skill-validate-venv`.
