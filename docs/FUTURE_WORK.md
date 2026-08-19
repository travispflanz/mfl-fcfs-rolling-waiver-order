# Future Work

Things deliberately not built (or not finished) as part of the initial
Cloudflare migration — tabled by explicit decision, not forgotten.
Nothing here is blocking current operation.

See also `CONFIGURABLE_SETTINGS_IDEAS.md` — a broader brainstorm of
candidate commissioner-facing settings, upstream of this file (ideas
not yet decided on at all, vs. this file's already-decided/tabled
items).

## Open, not yet decided

- **Event-driven trigger via MFL's own email notifications, instead of
  polling** (researched 2026-08-19, prompted by Travis
  questioning why polling is needed at all when MFL already emails
  owners on transactions — a fair challenge to the README's existing
  "confirmed, no better option" line, which turned out to be about the
  *documented API* specifically, not this).
  **Confirmed real, via MFL's own live Help Center** (Login &
  Communication → Email → "How do I use the Commissioner Email Setup
  page?"), not guessed: the Commissioner Email Setup page has a
  **"Waiver/Free Agent Moves"** checkbox, and per MFL's own answer text
  it is a commissioner-level, league-wide option — it is *not* scoped
  to just the commissioner's own franchise the way the equivalent
  Franchise Setup → Contact Info checkbox is for a regular owner. One
  checkbox, one email address, every franchise's waiver/FA move in the
  league.
  **Confirmed real, via Cloudflare's own docs**: [Email
  Routing](https://developers.cloudflare.com/email-service/) lets a
  Worker export an `email()` handler that fires the instant a message
  lands at an address you control — genuine push, not polling.
  Combined, the concept: point that MFL notification at a
  Cloudflare-routed address, parse the incoming email in `email()`,
  and trigger the real waiver-order pipeline only when something
  actually happened — `scheduled()`'s regular tick (now every 2
  minutes; see "Calendar-aware checking is now the default" below)
  becomes a rare fallback safety net instead of the primary trigger.
  **Re-confirmed while researching this**: MFL's documented Import API
  has no webhook/callback registration mechanism of any kind — this
  project already checked the full Import + Misc sections end to end
  while building the failure-alerting feature and found none (no SMS,
  no push, nothing beyond `messageBoard`/`emailMessage`/`chat_save`).
  Email is genuinely the only channel MFL offers for this, not an
  overlooked shortcut.
  **The real trade-off, not yet resolved**: Cloudflare Email Routing
  only works on an actual domain added to Cloudflare as a zone — it
  does **not** work on a bare `*.workers.dev` subdomain, which is all
  this project has ever needed. Building this would mean every
  commissioner setting this up needs to own a domain and add it to
  Cloudflare — a genuine new prerequisite this project has deliberately
  avoided everywhere else, not just a config tweak. Worth a real
  decision from Travis before building: is trading "zero domain
  needed" for "true push instead of polling" worth it, given polling
  already costs nothing on Cloudflare's free tier (see README
  "Schedule")?
  **Two open questions that need live testing, not doc-reading, to
  answer** — neither claimed either way without evidence: (1) how
  promptly MFL actually sends this email (its own Help Center text
  shows at least one *other* notification type is explicitly batched —
  "My Player News... sent nightly at 3am" — so "instant" isn't a safe
  assumption for "Waiver/Free Agent Moves" without checking); (2) how
  structured/parseable the email content actually is (team/player/
  timestamp cleanly extractable, or just a "check your league" nudge)
  — same "prefer structured data over scraping" caution this project
  already applies to HTML, now applied to an email body. Answering both
  means turning the checkbox on for a real account and observing a
  real transaction's email, not something inferable from docs alone.
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
- **GitHub "fill in these values" form on template creation — checked,
  doesn't exist (2026-08-19).** Travis's real request: have "Use this
  template" prompt for `MFL_LEAGUE_URL` etc. right at repo-creation
  time instead of a separate later edit. Confirmed via GitHub's own
  community discussions: this has been an open feature request for
  years (multiple threads asking for exactly this), never built
  natively. Third-party workarounds exist (GitHub Actions-based
  templatizers that rewrite placeholder text on first push), but that
  means trusting and understanding a GitHub Action running on a brand
  new repo before the commissioner has done anything else — real added
  complexity against this project's "one dependency" goal. Revisit
  only if GitHub ships native template variables; not worth building
  a workaround for in the meantime.
- **Better UX for `DIAG_TOKEN` than "make up a random string yourself."**
  Travis's instinct (2026-08-19): the current "mash the keyboard, write
  it down" step is the weakest, most manual-feeling part of an
  otherwise fully guided setup, even though every specific alternative
  considered so far (obscure URL paths, checking the `Referer` header,
  reusing MFL credentials directly) turned out to be either weaker
  security or a real downgrade — see README's explanation. Candidate
  directions worth real research, none committed to yet:
  - **Worker generates its own token on first run and displays it
    once.** Instead of asking the commissioner to invent a string,
    have the Worker check `STATUS_KV` for an existing token on first
    request, generate one with `crypto.randomUUID()` if missing, store
    it there, and show it back once via a dedicated bootstrap
    endpoint/message ("here's your token, save it, this won't be shown
    again"). Removes the "what should I type" step entirely and is
    arguably *more* secure than a hand-typed string, at the cost of
    moving the check from a Cloudflare Secret to a KV read (worth
    thinking through whether that's an acceptable security-boundary
    change — both still require Cloudflare account access to read).
  - **Cloudflare Access in front of the manual endpoints**, using the
    commissioner's own already-logged-in Cloudflare account as the
    auth instead of a new invented secret. Genuinely promising if it
    works, but real open questions before committing to it: does
    Cloudflare Access gate a plain `workers.dev` subdomain without a
    custom domain, and is it available on the free tier this whole
    project otherwise stays within. Needs real research, not assumed.
  - ~~If the widget ends up hosted on Cloudflare, it could generate a
    strong random token client-side.~~ Retired as an idea (2026-08-19)
    — see the widget-hosting item below; hosting the widget on
    Cloudflare turned out to be the wrong direction on its own merits,
    so this doesn't apply either.
- **Optional homepage widget + ambient status message — deferred to
  focus on getting the core bot live-tested (2026-08-19).** Both
  features are fully built and working in the code — `worker.js` was
  not touched, only README's documentation of them was removed, to
  keep the setup guide focused on the required core automation while
  Travis gets other commissioners testing it. Reviving either is just
  restoring the relevant README section(s); nothing needs rebuilding.
  Two real findings from this pass that should inform any revival,
  so they're not re-litigated from scratch:
  - **Do not host the widget externally on Cloudflare with a short
    `<script src>` snippet** — this was seriously proposed and
    researched this same session, then reversed after checking how
    real, established MFL community script authors (Habman's live,
    donation-supported scripts; a second active contributor at
    mflscripts.com) actually do this. Both use one large, fully
    self-contained pasted `<script>` block with inline `var` config at
    the top — never an externally hosted file. The likely reason:
    self-containment means a league's widget keeps working forever
    even if the script author's own server or domain ever goes away;
    externally hosting it would make every league's widget depend on
    that one server staying up indefinitely. Worth adopting regardless
    of this decision: Habman's scripts guard every config var with
    `if (x == undefined) var x = default;` right after the "don't edit
    below this line" marker, so an updated script version with a new
    setting doesn't break someone's older pasted copy. Our widget
    doesn't currently do this.
  - **The widget's placement instructions had a real, live bug**,
    found and fixed this same pass: they said to mark it a "Header or
    Footer message," which — per this project's own earlier
    live-confirmed finding for the ambient status feature — actually
    injects content into every page on the site, not just the
    homepage. The fix (already applied in `home-page-status-snippet.html`,
    preserved even though the section isn't currently in README): use
    the same module/tab placement the ambient status message already
    correctly uses, not header/footer.

## Explicitly decided against, for now

- **Calendar-timestamp precision gating for "Process Waivers"/"Put All
  Players on Waivers"** (researched and designed 2026-08-19, then
  superseded during the same session — full trail in
  `DEVELOPMENT_NOTES.md`'s "Key design decisions"). What *was* built
  from this research: the cron interval moved from 5 to 2 minutes (the
  real reliable ceiling, given Workers KV's Free-tier write cap), and
  a best-effort, informational-only warning if no "Process Waivers"
  League Calendar event is configured (`getLeagueCalendarEvents()`,
  `report.calendarCheck`). What was designed but *not* built: reading
  exact calendar timestamps and gating a dedicated check specifically
  before each "Process Waivers" event and after each "Put All Players
  on Waivers" event. Once the cron interval was set to its 2-minute
  ceiling, that gating logic became functionally redundant to build —
  the pipeline already runs unconditionally on every tick regardless
  of calendar state, already landing within 2 minutes of both moments
  by construction. Revisit only if the cron interval ever has to drop
  below 2-minute reliability (KV limits changing, writes becoming
  conditional instead of every tick, etc.) — until then, the simpler
  always-on approach already delivers the same practical guarantee.
- **Season auto-detection.** The original Playwright-based script
  probed forward a year at a time and self-corrected `MFL_LEAGUE_URL`
  automatically each season. Not ported to the Cloudflare Worker —
  season rollover is currently a manual one-time-per-year edit. Worth
  porting if the manual step turns out more annoying in practice than
  it sounds; it's a small, self-contained function if picked back up.
- **Ambient status refresh frequency.** Explicit decision (2026-08-19):
  once per hour, not every cron tick (now every 2 minutes) and not
  only on failures. Revisit if hourly turns out to be too slow or too
  frequent in practice.
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
