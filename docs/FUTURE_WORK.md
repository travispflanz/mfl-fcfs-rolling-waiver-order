# Future Work

Things deliberately not built (or not finished) as part of the initial
Cloudflare migration — tabled by explicit decision, not forgotten.
Nothing here is blocking current operation.

See also `CONFIGURABLE_SETTINGS_IDEAS.md` — a broader brainstorm of
candidate commissioner-facing settings, upstream of this file (ideas
not yet decided on at all, vs. this file's already-decided/tabled
items).

## Open, not yet decided

- **`HMPGMOD` reverse-engineering** (automating Home Page module/tab
  placement). Currently a one-time manual step — see
  `DEVELOPMENT_NOTES.md` for why no official API exists for this.
  Explicit decision (2026-08-19): manual is good enough for now,
  revisit later if it becomes annoying in practice. If revisited: the
  research-first discipline in `LESSONS_LEARNED.md` applies — check
  whether MFL has added an API for this before reverse-engineering the
  admin screen's real form/JS behavior.
- **Non-owning-commissioner `SEND_TO` fallback.** The alerting code
  falls back to MFL's documented `"0000"` sentinel when the
  commissioner owns no franchise in their league — grounded in MFL's
  own official docs, but not yet live-tested end-to-end (this
  project's own league has a commissioner who owns a franchise, so the
  fallback path has never actually fired against a real league). Test
  against a league where the commissioner has no franchise if one
  becomes available.
- **GitHub-free distribution — partially resolved (2026-08-19).** The
  primary Quick Start now actively depends on GitHub (repo connected to
  Cloudflare, redeploying on every commit — not just a one-time
  download), which raised the bar rather than lowered it. Confirmed
  live, though, that a genuine GitHub-free path exists: Cloudflare's
  own dashboard lets you paste `worker.js`'s contents directly into a
  Worker (Create a Worker → Start with Hello World! → its built-in code
  editor) and configure secrets/KV/cron through the same dashboard
  forms the main flow already uses — no GitHub account needed at all.
  This is mentioned in README's Support section but not written up as
  a full step-by-step, since it means re-pasting code by hand for any
  future update instead of it living in an owned repo. Worth promoting
  to a full documented path if enough people ask for it. Cloudflare's
  own "Deploy to Cloudflare" button remains rejected for this — it
  still requires a GitHub or GitLab account on the receiving end.

## Explicitly decided against, for now

- **Season auto-detection.** The original Playwright-based script
  probed forward a year at a time and self-corrected `MFL_LEAGUE_URL`
  automatically each season. Not ported to the Cloudflare Worker —
  season rollover is currently a manual one-time-per-year edit. Worth
  porting if the manual step turns out more annoying in practice than
  it sounds; it's a small, self-contained function if picked back up.
- **Ambient status refresh frequency.** Explicit decision (2026-08-19):
  once per hour, not every 5-minute cron tick and not only on
  failures. Revisit if hourly turns out to be too slow or too frequent
  in practice.
- **Recovery notifications.** The failure-alerting system posts once
  when a run transitions from OK to failing, and stays quiet on
  repeated failures. There's no equivalent "it's working again" alert
  when a failing run recovers — `/status` and the ambient status slot
  both reflect recovery implicitly (the next successful run just shows
  OK again), but nothing pushes a notification about it. Not asked
  for; would be a small addition to the same alerting code path if
  wanted later.

## Known, accepted trade-offs (not really "future work," just recorded)

- Home Page Message slot discovery does a 20-way parallel scan the
  first time (or whenever the previously-claimed slot's ownership
  marker goes missing) — cheap in absolute terms (all public reads,
  no auth needed for the check itself), but worth knowing about if MFL
  ever rate-limits the `embed` endpoint more aggressively.
- The two-tier alerting system (Message Board post + commissioner
  email) has a known blind spot: if login itself fails, there's no
  authenticated session to post or send with, so a total auth failure
  produces no alert via either channel — only `/status` would reflect
  it. Not solved; would need a channel that doesn't depend on an MFL
  session at all, which conflicts with the project's "MFL is the only
  dependency" design goal, so this is more of an accepted limitation
  than an open task.
