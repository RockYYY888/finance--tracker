# TO-DO LIST

## Current Sprint: Daily Feedback Approval Loop

### Completed
- [x] Create personal skill `feedback-approval-session` at `/Users/lyw/.codex/skills/feedback-approval-session`
- [x] Implement `scripts/fetch_open_feedback.py` for admin login and unresolved feedback fetching
- [x] Add `references/approval_flow.md` and `references/api_contract.md`
- [x] Create personal skill `feedback-code-executor` at `/Users/lyw/.codex/skills/feedback-code-executor`
- [x] Implement `scripts/apply_and_test.py` with approval token gating (`批准并执行 #ID`)
- [x] Implement `scripts/push_with_proxy.sh` with default proxy `http://127.0.0.1:10808`
- [x] Add `references/git_policy.md`
- [x] Create personal skill `feedback-reply-closer` at `/Users/lyw/.codex/skills/feedback-reply-closer`
- [x] Implement `scripts/reply_and_close_feedback.py` with approval token gating
- [x] Add `references/reply_template.md`
- [x] Validate all 3 skills with `quick_validate.py` (via temp venv)
- [x] Compile-check all Python scripts with `python3 -m py_compile`
- [x] Add project-local env template `.env.codex-feedback-automation.example`
- [x] Document project-local env loading in `README.md`

### Pending
- [ ] Create Codex automation `Daily Feedback Approval Loop` (09:30 Asia/Shanghai)
- [ ] Create `.env.codex-feedback-automation.local` from example and fill secrets:
  - [ ] `FEEDBACK_API_BASE_URL=http://117.72.217.15:8080`
  - [ ] `FEEDBACK_ADMIN_USER=<admin_user>`
  - [ ] `FEEDBACK_ADMIN_PASSWORD=<admin_password>`
  - [ ] `FEEDBACK_API_TOKEN=<api-token-if-required>`
  - [ ] `http_proxy=http://127.0.0.1:10808`
  - [ ] `https_proxy=http://127.0.0.1:10808`
- [ ] Run first live dry-run against production endpoint and verify approval loop behavior

### Risks / Notes
- Skill validator requires `PyYAML`; local system python is externally managed, so validation was executed with `/tmp/skill-validate-venv`.
- Automation creation requires Codex automation directive/application-level confirmation.
