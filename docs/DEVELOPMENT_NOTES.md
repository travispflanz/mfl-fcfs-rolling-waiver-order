# Development Notes

For a human or an AI picking this project up cold — everything you'd
otherwise have to rediscover by trial and error. If you're an AI agent
starting a new session on this repo: **read this file before touching
any MFL endpoint you haven't seen referenced here.** Almost everything
non-obvious about MyFantasyLeague.com's behavior took real live
testing to pin down; this file exists so that cost isn't paid twice.
See also `LESSONS_LEARNED.md` (how *not* to re-derive things) and
`FUTURE_WORK.md` (what's intentionally not done yet).

## What this project is

Keeps one MFL league's Custom Waiver Order continuously updated by
reverse recency of "Acquired" transactions (FCFS free agency + Waiver
free agency). Runs as a Cloudflare Worker — plain `fetch()`, no
headless browser — on a Cron Trigger. See `README.md` for the
end-user-facing description and setup instructions; this file is the
technical/historical reference.

## Architecture, in one paragraph

`worker.js` is the entire automation: one `fetch()`
handler (manual endpoints, all token-gated except `/status`) and one
`scheduled()` handler (the real production trigger, every 5 minutes
per `wrangler.toml`). Everything talks to MFL over plain HTTP — no
browser, no Playwright (that existed once; fully retired, see below).
State lives in one Cloudflare KV namespace (`STATUS_KV`): last-run
status, the ambient-status Home Page Message slot number, and its
last-refresh timestamp.

## Confirmed MFL mechanics — the reference that would otherwise take hours to re-derive

Every fact below was verified live against a real league (originally
`www44`/`19186`/2026 — a different league will have different IDs but
identical mechanics), not assumed. Treat anything not in this list as
unverified if you encounter it.

### Authentication

- **Login**: `POST {BASE}/login` (not `/login?L={league}` — confirmed
  via live DOM inspection of the actual form) with body `LEAGUE_ID`,
  `URL` (redirect target), `USERNAME`, `PASSWORD`, `REMEMBER=Yes`.
- **Become Commissioner** (critical, easy to miss): logging in is
  **not** enough to act as commissioner. A separate step is required:
  `GET {BASE}/logout?L={league}&BECOME=0000` — despite the path
  literally being `logout`, it does not end the session; it *adds*
  commissioner privileges for that league. This is the single fact
  that explains an entire earlier failed attempt at this project
  (a prior Cloudflare Worker got served stripped/anonymous-looking
  pages and was wrongly diagnosed as an IP block — it was just missing
  this step). The `MFL_IS_COMMISH` cookie only appears after this hop.
- **Cookie handling matters**: a real session carries 5 auth-relevant
  cookies (`MFL_USER_ID`, `MFL_IS_COMMISH`, `MFL_LINK_FRANCHISE`,
  `MFL_PW_SEQ`, `MFL_LAST_LEAGUE_ID`). Build a real cookie jar across
  every request. Cloudflare Workers' `Headers` expose multiple
  `Set-Cookie` values via `getSetCookie()` — the standard `.get()`
  would coalesce them into one comma-joined string and lose data.
- **Follow redirects manually**, not via `fetch()`'s automatic
  following — `redirect: 'manual'` plus a hop loop, so `Set-Cookie`
  headers at *every* hop get merged into the jar. This was the actual
  fix that made the plain-HTTP approach work at all (see
  `followWithCookies()` in the code).

### Reading data (official, documented API — prefer these over scraping)

- `export?TYPE=league&L={league}&JSON=1` — **public, no auth needed at
  all** (confirmed live). Returns franchise names/abbrevs, and a
  `waiverSortOrder` per franchise that's an independent encoding of
  the current waiver order — used as a cross-check against the scraped
  WAIVORD page (see below). Also includes `commish_username` (real,
  observed live, but **not named in MFL's published schema** — same
  confidence tier as `waiverSortOrder`) and `currentWaiverType` (the
  league's overall waiver processing mode — FCFS vs. traditional vs.
  budget/FAAB — a *different* setting than the WAIVREQ sort-order
  setting below, confirmed by checking; this export's only two
  waiver-related fields are `currentWaiverType` and
  `maxWaiverRounds`).
- `export?TYPE=transactions&L={league}&TRANS_TYPE=WAIVER,BBID_WAIVER,FREE_AGENT&JSON=1`
  — official, documented. This is what drives the reverse-recency
  computation.
- `export?TYPE=appearance&L={league}&JSON=1` — **public, no auth**.
  Lists every module actually placed on every tab
  (`{"name":"WAIVER_ORDER=N"}` etc.). Critical distinction: a Home
  Page Message slot having *content* and being *placed on a tab* are
  two independent things — this export tells you what's actually
  wired up to display, not what merely has text saved. Used to locate
  `WAIVER_ORDER`'s exact position generically (`findWaiverOrderPlacement()`).
- `embed?L={league}&MODULE={name}` — a real, MFL-generated JSONP-style
  `<script src>` embed (legally sidesteps MFL's own documented ban on
  cross-origin `fetch()`, since script tags aren't subject to CORS the
  way `fetch`/XHR are). Discovered by inspecting the actual `<script>`
  tags on a real external site that embeds MFL data. Given an invalid
  `MODULE` name, it returns MFL's **complete, authoritative module
  list** — this is how the Home Page Message slot cap (exactly 20:
  `MESSAGE`, `MESSAGE2`..`MESSAGE20`) was confirmed, not guessed. Also
  includes a real `WAIVER_ORDER` module (public read of the live
  order) and dozens of others (`STANDINGS`, `TRANSACTIONS`, etc.) —
  useful if a future feature needs to read/display something publicly
  without authentication.

### Writing data

- **Waiver order** (`csetup?L={league}&C=WAIVORD`, the only mechanism
  — no API exists): `GET` to read hidden fields (`input_expires` — a
  per-session token required for the POST — and
  `WAIVER_ORDER_LEAGUE_1..N`), then `POST` to `csetup` with
  `form_name=WAIVORD`, `LEAGUE_ID`, `C=WAIVORD`, `input_expires`,
  `WAIVER_ORDER_LEAGUE_COUNT`, `WAIVER_ORDER_LEAGUE_SHOW_INDEX`, and
  the reordered `WAIVER_ORDER_LEAGUE_1..N`. **Deliberately never
  include `DELETE_CUSTOM`** — even an empty/unchecked value risks
  being read as "delete the custom order."
- **Message Board / Email** (official, documented Import API —
  discovered only after live-probing the legacy `topic_add.pl` form
  first and getting a 404; see `LESSONS_LEARNED.md`):
  `import?TYPE=messageBoard&L={league}&FRANCHISE_ID=0000&SUBJECT=...&BODY=...`
  (posts as Commissioner — `0000` is MFL's own documented sentinel for
  that) and `import?TYPE=emailMessage&L={league}&SEND_TO={franchise}&SUBJECT=...&BODY=...`.
  **Never omit `SEND_TO`** — omitting it emails the entire league.
- **Home Page Message content** (`csetup?L={league}&C=HMPGMSG&SEQNO={n}`,
  no API — confirmed via checking Import docs and a third-party
  open-source API wrapper library that also only implements the
  read-side `appearance` export): `GET` with `SEQNO={n}` (2 through
  20 — **`SEQNO=1` is broken, it creates a new unlisted message
  instead of opening slot #1's own editor**, confirmed live, so slot
  #1 is excluded as a candidate anywhere in this codebase) to read
  hidden fields (`LEAGUE_ID`, `NAME` — encodes the slot itself, e.g.
  `"message19"`, not a separate `SEQNO` field — `LABEL`, `IN_HEADER`,
  `IN_FOOTER`) and the `MSG` textarea content, then `POST` to
  `{BASE}/message` resubmitting those fields with a new `MSG`.
  **`IN_HEADER`/`IN_FOOTER` must be forced to `"No"`** — their
  untouched default is `"Yes"`, which means "inject this raw HTML into
  the header/footer of every page on the site," a completely different
  mechanism than the tab/module placement system this feature's design
  depends on. Shipping this with the defaults preserved was a real,
  live bug this session (see `LESSONS_LEARNED.md`) — it duplicated
  content across every page on the site until caught by checking the
  actual rendered page source, not the API.

### Settings that affect correctness

- `csetup?C=WAIVREQ` — `WAIVER_ORDER` radio must be `SAME` or
  `REVERSE` (not `WEEKLY`/`ROTATE`, which have MFL recompute the order
  itself) and all six `WAIVER_SORT_0..5` selects must be `NONE` (MFL's
  own label text says "Same"/"Reverse" still "use the criteria below,"
  so a non-`NONE` criterion can override just as surely as the wrong
  order type). Checked every run, warns but doesn't block.
- `csetup?C=REPSEC` — `USE_ADVANCED_EDITOR` radio. Must be `"No"` for
  the ambient-status write specifically — `"Yes"` runs a WYSIWYG editor
  over type-in boxes that mangles raw HTML on save. This one is a hard
  stop, not a warning (unlike WAIVREQ above), since it would corrupt
  the write immediately rather than just risk MFL overriding it later.
- No API exists for editing the module/tab layout at all (checked
  Import docs + a third-party library; MFL's own tutorial content
  describes it as a manual drag-and-drop admin screen only) — this is
  why the ambient-status feature's homepage placement is a deliberate
  one-time manual step, not automated. See `FUTURE_WORK.md`.

## Key design decisions and why

- **Full cutover to Cloudflare, GitHub Actions retired to nothing**
  (2026-08-18/19, Travis's explicit instruction). The original
  Playwright/GitHub-Actions script, its workflow file, and
  `package.json` were deleted from the working tree (fully recoverable
  via git history — nothing destroyed, just superseded).
- **Cron interval: 5 minutes**, not GitHub Actions' old hourly
  compromise — that compromise existed specifically because of GitHub
  Actions' per-minute billing, which Cloudflare's free tier removes.
- **Fail loud on missing config**, not silent fallback to any specific
  league (`getLeagueConfig()`) — an earlier version of this silently
  defaulted to this project's own original league if `MFL_LEAGUE_URL`
  wasn't set, which would have meant a new commissioner's misconfigured
  Worker quietly trying to run against someone else's league. Fixed
  specifically because this is meant to be generic template for any
  commissioner.
- **HTMLRewriter over regex** for all HTML field extraction — a
  Cloudflare Workers runtime global, real streaming CSS-selector
  parser, immune to the attribute-order/whitespace fragility that
  broke an earlier two-pass-regex approach.
- **Alerting via MFL's own official Import API**, not a third-party
  service (Slack/Discord/email provider/etc.) — deliberately, because
  the whole project's design goal is "one dependency" (Cloudflare +
  MFL, nothing else) for an average commissioner setting this up.
- **Ambient status placement is manual, content is automatic** — see
  the settings section above. This was an explicit, discussed
  trade-off, not an oversight: no API exists for the automated
  alternative, and reverse-engineering an undocumented drag-and-drop
  admin screen was judged a bigger, riskier lift than the feature
  warranted right now. Revisit in `FUTURE_WORK.md` if it matters more
  later.
- **Timing-safe token comparison, current `compatibility_date`** —
  added during an explicit "would a real developer approve this"
  review pass; both are Cloudflare's own documented best practices
  (their Basic Auth example, their Workers Best Practices guide),
  found by checking Cloudflare's docs, not guessed.
- **Commissioner setup requires zero terminal use, full stop**
  (2026-08-19, Travis's explicit, repeated instruction — this is not
  the same requirement as "make CLI use approachable," which an
  earlier pass mistakenly treated as satisfying it). The Quick Start
  now runs entirely through MFL's site, GitHub's web UI, and
  Cloudflare's dashboard: "Continue with GitHub" for deploy, GitHub's
  own file editor for the non-secret `wrangler.toml` values, and
  Cloudflare's Settings -> Variables and Secrets / Bindings / Trigger
  events forms for everything else — all confirmed live to exist and
  work exactly this way, not assumed from docs prose. `wrangler`
  CLI/`wrangler.toml` itself didn't need to change at all for this —
  it was only ever the *setup instructions* that were terminal-first;
  Cloudflare Workers as a platform never required that. The CLI path
  still works and remains documented as an alternative for anyone who
  wants it, it's just no longer what a commissioner is told to do.
  One real trap this created: since the Worker stays connected to the
  GitHub repo, `wrangler.toml` is what Cloudflare actually redeploys
  from on every commit — a value changed only in the Cloudflare
  dashboard for something `wrangler.toml` also declares (the KV
  binding, the cron schedule) would get silently reverted on the next
  push. README calls this out explicitly; keep that framing intact if
  this section changes again.

## File map

- `worker.js` — the entire automation.
- `wrangler.toml` — Cron Trigger, KV binding, league config (`[vars]`
  — must be edited per-deployment). Both files live at the repo root
  (no subfolder) so Cloudflare's GitHub-connected deploy finds
  `wrangler.toml` at its default expected location — a real
  requirement, not a style choice: an earlier `cloudflare-test/`
  subfolder (a leftover name from this project's original feasibility
  test, never a deliberate structure) would have needed a "Root
  directory" override in Cloudflare's build settings to work at all.
- `home-page-status-snippet.html` — optional, separate feature (a
  client-side JS widget, different mechanism than the ambient-status
  Home Page Message — see README for the distinction).
- `LICENSE` — MIT.
- `docs/` — this file and its siblings.

## Extending this project

- Preserve the "capture and resubmit real hidden fields" pattern (see
  `claimMessageSlot()`, the WAIVORD write in `runPipeline()`) for any
  new MFL form write — don't hand-construct a POST body from assumed
  field names.
- Preserve the "check for an official API before scraping a form"
  discipline — see `LESSONS_LEARNED.md` for exactly how expensive
  skipping this step was, more than once, in this same project.
- KV keys currently in use: `last-run` (status), `status-slot`
  (claimed ambient-status slot number), `status-slot-last-update`
  (throttle timestamp). Namespaced simply since there's only one KV
  binding — reconsider a prefix scheme if this grows much further.
- `getLeagueConfig()` is shared by every entry point. `authenticateAsCommissioner()`
  (login + Become Commissioner) is shared by `/diag?check_slot` and
  `/claim-status-slot` specifically — `/run` and `scheduled()` go
  through `runPipeline()`, which has its own separate copy of the same
  login sequence (it interleaves this with report/log building enough
  that sharing wasn't a clean fit — see the comment above
  `authenticateAsCommissioner()` in the code). Extend whichever of the
  two you're actually touching rather than assuming they're one thing.
- **`home-page-status-snippet.html` exists in two places** — the file
  itself, and byte-for-byte inline inside README.md's "Optional: status
  widget" section (so a commissioner can paste directly from the README
  with no separate file to find — Travis's explicit ask, 2026-08-19,
  after a prior pass updated the file but not the README's copy of it).
  If you edit the file, regenerate the README's copy from it
  mechanically (read the file, replace the contents of the fenced
  \`\`\`html block in that section, verify the two are identical
  character-for-character) rather than hand-editing or retyping the
  README's copy — this is the actual failure mode that made this note
  necessary in the first place. Do this for *any* edit, including a
  one-line comment change.
