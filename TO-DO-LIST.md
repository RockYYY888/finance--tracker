# TO-DO LIST

## Active

- [ ] Separate broker credential storage and execution APIs from portfolio record APIs
- [ ] Expose agent-safe broker execution adapters after credential vaulting is in place
- [ ] Add broker-execution audit views after broker adapters land

## Recent

- [x] Remove eager agent-workspace prefetch from login, hydrate asset manager directly from dashboard data, and fix summary tabs showing placeholders after sign-in
- [x] Harden holding search against empty upstream search payloads, allow single-character lookup, and show a clearer no-result state
- [x] Restrict editable asset currencies to `USD` / `HKD` / `CNY`, add current-vs-target CNY previews, and enforce CNY-only cash-transfer targets
- [x] Keep the cash account editor focused on the form only, without rendering the account activity section below
- [x] Simplify the trend-card summary to one mode-specific date range, move range filters to the card header, and show return deltas as percentage-point changes
- [x] Merge holding breakdown into asset allocation, move single-holding returns to the left column, hide unavailable trend ranges, and unify asset record time as millisecond-precision operation time
