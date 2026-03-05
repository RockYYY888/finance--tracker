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
- [x] Implement dashboard correction model/API for historical point override/delete
- [x] Implement asset mutation audit model/API for CRUD operations
- [x] Update timeline schema/analytics to include `timestamp_utc` and `corrected`
- [x] Add backend tests for correction application and audit log generation
- [x] Run backend regression tests (58 passed)
- [x] Execute approved workflow for feedback `#7` (code/test/push/reply/close)
- [x] Execute approved workflow for feedback `#6`:
  - [x] Implement return chart option B (zero-baseline positive/negative area)
  - [x] Apply colorblind-friendly palette:
    - [x] Positive: `#009BC1` (Malaysia Sky Blue)
    - [x] Negative: `#D7336C` (Pioneering Pink)
  - [x] Add frontend test for positive/negative split dataset mapping
  - [x] Run frontend tests and build validation
- [x] Optimize frontend bundle splitting:
  - [x] Lazy-load analytics module in `App.tsx`
  - [x] Add Vite `manualChunks` for react/charts vendors
  - [x] Rebuild and verify chunk-size warning cleared
- [x] Audit and align other charts:
  - [x] Fix `PortfolioTrendChart` negative-series empty-state bug
  - [x] Upgrade `PortfolioTrendChart` to zero-baseline positive/negative area style
  - [x] Add `PortfolioTrendChart` data split unit test
- [x] Implement feedback `#5` feature set (awaiting acceptance before push):
  - [x] Add backend release-note models: `ReleaseNote` and `ReleaseNoteDelivery`
  - [x] Add admin APIs for release-note draft creation/listing/publish
  - [x] Add user APIs for release-note inbox listing and mark-seen
  - [x] Merge release-note unread count into user feedback summary badge
  - [x] Add admin UI for versioned update-log drafting and publish
  - [x] Add user inbox UI for station-pushed release notes
  - [x] Add backend tests for publish delivery flow and semantic version uniqueness
  - [x] Run backend/frontend test and build validation
- [x] Execute approved workflow for feedback `#5`:
  - [x] Push branch `codex/feedback-fix-5-20260305`
  - [x] Reply and close feedback ticket `#5`
- [x] Implement feedback `#4` dynamic chart strategy (local, awaiting acceptance before push):
  - [x] Add `calculateDynamicAxisLayout` (median centerline + adaptive domain)
  - [x] Apply dynamic y-domain + median reference line to `PortfolioTrendChart`
  - [x] Apply dynamic y-domain + median reference line to `ReturnTrendChart`
  - [x] Keep return chart zero-baseline semantic line while adding median line
  - [x] Add tests for dynamic axis layout and custom center split
  - [x] Run frontend tests and build validation
- [x] Refactor release-note inbox delivery to stream mode:
  - [x] Keep max one release-note notification per user
  - [x] New publish updates same delivery row and resets unseen flag
  - [x] User release-note content returns cumulative markdown history
  - [x] Add backend test for multi-publish single-message behavior
  - [x] Add repository `CHANGELOG.md` as persistent update history file

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
