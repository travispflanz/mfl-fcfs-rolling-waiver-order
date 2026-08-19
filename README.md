# MFL FCFS + Rolling Waiver Order

Automatically keeps a MyFantasyLeague.com (MFL) league's **Custom Waiver
Order** on one continuously-updating rolling priority list, driven by two
specific acquisition types MFL tracks separately:

- **First-Come-First-Served free agency** (instant pickups)
- **Waiver free agency** (scheduled-priority claims)

This bot doesn't care which of those two someone used — within a few
minutes (by default) of *any* franchise picking up a player either way,
it drops to the bottom of the list. Whoever's gone longest without an
add (or never has) sits at the top. (MFL tracks other transaction types
too — trades, IR moves, taxi squad, auctions — none of those affect
waiver priority and this bot ignores them entirely.)

**MFL FCFS + Rolling Waiver Order** runs entirely on a **Cloudflare
Worker** — no server, no local machine, nothing that depends on your
computer being on, and no headless browser: plain HTTP requests, so
each check takes milliseconds rather than the ~20-25 seconds a real
browser needs.

## Quick start (written for a first-time commissioner — no coding experience assumed)

This whole setup happens in two places: MFL's own website (a few
settings), and a free Cloudflare account (where the actual automation
runs). You'll type a handful of commands into a **terminal** — on
Windows that's PowerShell (search "PowerShell" in the Start menu); on
Mac that's Terminal (search Spotlight for "Terminal"). Every command
below is one line — paste it in and press Enter, one at a time.

Budget 20–30 minutes the first time. None of this touches money or
requires a credit card — Cloudflare's free tier is more than enough
for this.

### Part 1 — required (the core automation)

**Step 1 — MFL settings.** Log into MFL as commissioner, open your
league, then go to:

> **Commissioner Setup** *(top navigation menu — only visible to
> commissioners)* → *"ADD/DROP AND WAIVERS SETUP"* → **Waiver
> Request Setup**

- Find **"Waiver Request Sort Order"** and select either **"Same"** or
  **"Reverse"** (both work fine — pick either). What matters is that
  it's *not* left on **"Weekly Rolling"** or **"Season-long Rolling"**,
  which have MFL recalculate the order itself and will eventually
  overwrite whatever this bot sets.
- Just below that, set all six **"Waiver Sort Criteria"** dropdowns to
  **"None."** MFL's own label text says "Same"/"Reverse" still use
  "the criteria below" — leaving any of the six on a real criterion
  lets MFL override the order just as surely as Weekly/Season-long
  Rolling would.
- Click **Save** at the bottom of the page.

(The automation checks both of these itself on every run and logs a
warning if anything's still off — it won't silently break, but it's
better to get it right up front.)

**Optional, only if you want a specific starting order** (like reverse
draft order): set it yourself on **Custom Waiver Order Setup** before
you finish setup below — MFL has no automatic way to create a
draft-order-based starting point; every one of its 12 built-in sort
criteria is standings/performance-based instead. If you don't care
about the starting order, skip this — MFL always has *some* order
already there, and the bot just reorders from whatever that is.

**Step 2 — create a free Cloudflare account.** If you don't already
have one: go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up),
enter an email and password, verify your email. No credit card needed
for anything in this guide.

**Step 3 — get the code.** Above the file list on this page, click
**Use this template** → **Create a new repository**. Give it any name,
choose **Private** (keeps things simpler, and doesn't matter either
way), click **Create repository**. GitHub will take you to your own
new copy of this project — that's the version you'll actually use for
everything below.

(This is the only place GitHub is involved at all — just to hold a
copy of the code for you to download from. Nothing about the
automation itself runs on GitHub or needs a GitHub account beyond this
one step.)

On your new repository's page, click the green **Code** button →
**Download ZIP**, and unzip it somewhere on your computer (e.g. your
Desktop). You now have a folder with a `cloudflare-test` folder inside
it — that's the one you'll work from.

**Step 4 — open a terminal in that folder.**
- **Windows**: open the `cloudflare-test` folder in File Explorer,
  click the address bar at the top, type `powershell`, press Enter.
- **Mac**: open Terminal, type `cd ` (with a trailing space), drag the
  `cloudflare-test` folder from Finder into the Terminal window, press
  Enter.

**Step 5 — log in to Cloudflare from the terminal.** Paste this and
press Enter — it opens a browser tab for you to approve:

```
npx wrangler login
```

(The first run downloads a small tool called `wrangler`, Cloudflare's
own command-line tool — this is normal and only happens once.)

**Step 6 — create a small storage namespace.** This just holds a
"last run OK/failed" note — nothing about your MFL account:

```
npx wrangler kv namespace create waiver-order-status
```

This prints something like `id = "abc123..."`. Open `wrangler.toml`
(in a plain text editor — Notepad on Windows, TextEdit on Mac) and
replace the `id` value under `[[kv_namespaces]]` with the one you just
got.

**Step 7 — set your secrets.** Each of these asks you to type a value
(hidden as you type) and press Enter:

```
npx wrangler secret put MFL_USERNAME
```
```
npx wrangler secret put MFL_PASSWORD
```
```
npx wrangler secret put DIAG_TOKEN
```

`MFL_USERNAME`/`MFL_PASSWORD` are your real MFL commissioner login.
`DIAG_TOKEN` is **not** an MFL credential — it's a password you make up
yourself right now (any random string, e.g. mash the keyboard) that
just lets *you* trigger manual checks later; write it down somewhere.

Forgot it later? Cloudflare secrets can't be read back once set, only
replaced — there's no "recover my token" option. Just make up a new
one and run `npx wrangler secret put DIAG_TOKEN` again; nothing else
needs to change, and the automatic schedule (which needs no token at
all) isn't affected either way.

**Step 8 — point it at your league.** Open `wrangler.toml` again and
find the `MFL_LEAGUE_URL` line. Replace the URL there with any URL from
your own league — your league homepage's address bar is the easiest
place to copy one from. Save the file.

**Step 9 — deploy:**

```
npx wrangler deploy
```

This prints a URL that looks like
`https://kckeeper-waiver-order.YOUR-NAME.workers.dev` — that's your
automation's own address. Save it; you'll need it below and for the
optional widget later. This same command also turns on the schedule
(checks every 5 minutes) — nothing else to switch on separately.

**Step 10 — test before trusting it.** Paste this, replacing both
placeholders with your Worker's URL from step 9 and the `DIAG_TOKEN`
you made up in step 7:

```
curl "https://YOUR-WORKER-URL/run?dry_run=true&token=YOUR_DIAG_TOKEN"
```

This should print a block of JSON showing your real team names and a
computed order, with no `error`. If you see errors, re-check steps
6–8 first (wrong KV id, wrong secret, or wrong league URL are the
most common causes).

**Done.** Nothing else to turn on — the schedule from step 9 is
already running; the first real check happens within 5 minutes (up to
~15 minutes the very first time, while the schedule finishes
activating on Cloudflare's end). Check your league homepage's Waiver
Wire Order widget afterward to confirm.

### Part 2 — optional, do this whenever you like

Two separate add-ons, neither required for the core automation above:

- **A homepage status widget** — see "Optional: status widget for your
  MFL homepage" below.
- **An ambient "Waiver Bot Status" message under the native Waiver
  Wire Order widget** — see "Optional: ambient status message on your
  homepage" below. Needs one MFL setting changed first and one manual
  placement step.

### What actually turns this on

The Cron Trigger declared in `wrangler.toml`'s `[triggers]` block starts
running as soon as you `wrangler deploy` — there's no separate "activate"
switch. New or changed Cron Triggers can take up to ~15 minutes to
actually propagate across Cloudflare's network, so don't be alarmed if
the very first check doesn't fire the instant you deploy.

### If it goes quiet for a while

Nothing accumulates or drifts — every run independently reads your
league's *current* live state (current order + full transaction history)
and recomputes fresh, so a run failing, or the league settings being
changed by hand in the meantime, doesn't leave anything to "fix" later.
The next successful run just picks up from wherever things actually
stand.

Checking on it: `GET /status` on your Worker (no token needed) always
shows the last run's outcome, and the optional homepage widget's
commissioner section (see below) displays the same thing right on your
league page. On top of that, a real failure automatically posts to your
league's Message Board and emails the commissioner directly — both via
MFL's own official Import API (`messageBoard` / `emailMessage`), not a
third-party service, so nothing extra to set up. Only fires once per new
failure — an ongoing outage won't spam a message every 5 minutes.

### Settings-compatibility check

Every run checks MFL's own **Waiver Request Sort Order** (needs to be
"Same" or "Reverse") and all six **Waiver Sort Criteria** (need to be
"None") — the settings from step 1 — before doing anything else, plus a
check that the league is actually set up for FCFS waivers (what this bot
assumes). If anything's off, the run logs a clearly-marked warning
explaining that MFL may silently overwrite whatever this bot sets — and
still proceeds, rather than blocking, in case that's a deliberate choice.

## Each new NFL season

MFL has commissioners transfer/export their league forward to a new
season every year. The host and league ID stay the same — only the year
changes. When you do that transfer, update `MFL_LEAGUE_URL` in
`wrangler.toml`'s `[vars]` block and redeploy (`npx wrangler deploy`).

(A previous version of this auto-detected a season rollover on its own,
probing forward each run; that hasn't been ported yet, so this one step
is manual for now. Worth automating if a once-a-year manual edit turns
out to be more annoying in practice than it sounds.)

## Schedule

Checks **every 5 minutes**. MFL has no push/webhook for transactions
(confirmed), so this is polling either way — but Cloudflare's free tier
makes frequent checks effectively free, so there's no cost reason to
space them out further. Each check only actually submits a change when
the computed order differs from what's already there; otherwise it's a
fast no-op, milliseconds end to end.

Want a different interval? Edit the `crons` line in
`cloudflare-test/wrangler.toml`'s `[triggers]` block — a standard
5-field cron expression, e.g. `*/5 * * * *` (every 5 minutes) or
`*/15 * * * *` (every 15) — then redeploy. See
[Cloudflare's cron syntax reference](https://developers.cloudflare.com/workers/configuration/cron-triggers/#supported-cron-expressions)
for the exact format.

## Why plain HTTP works now (it didn't used to)

An earlier version of this ran as a Cloudflare Worker doing plain
`fetch()` calls and reliably got served a stripped, logged-out-looking
page from MFL — even with a cookie string captured directly from a real,
working browser session, which ruled out "wrong cookie" as the cause at
the time. The real cause, found later: MFL treats "logged in" and
"acting as commissioner for this league" as two different session
states — a league-scoped "Become Commissioner" step
(`logout?L={league}&BECOME=0000`, despite the URL) is required even for
an account that already *is* the commissioner. The original Worker never
did this step, because nobody knew it was necessary yet. Once that step
is included, a plain `fetch()` pipeline — login, become commissioner,
read, write — works exactly as well as a real browser, just without the
~20-second browser startup/navigation overhead each time. Confirmed live
end-to-end, including a real write, before this became the production
path.

## How the write itself works

MFL has no public API for setting waiver order — this uses the same
commissioner-only HTML form a person would use
(`csetup?L={league}&C=WAIVORD`), reading its hidden fields
(`input_expires`, `WAIVER_ORDER_LEAGUE_1..N`, etc.) fresh on every run
and POSTing the reordered list back. No UI clicking/dragging needed —
MFL accepts a direct form POST once the session is authenticated as
commissioner.

## Reading the acquired-transaction data — and the current order itself

Transactions use MFL's documented `export?TYPE=transactions&JSON=1` API
(`TRANS_TYPE=WAIVER,BBID_WAIVER,FREE_AGENT`) — structured, official
data, not scraping of a rendered HTML report. Franchise names and the
current order are cross-checked the same way, against
`export?TYPE=league&JSON=1` (also public, structured JSON) — independent
of the one HTML page (`WAIVORD`) that has no API equivalent and has to
be scraped for its per-session `input_expires` token. Any disagreement
between the two sources is treated as a hard stop rather than silently
trusted, and HTML parsing itself uses Cloudflare's own `HTMLRewriter`
(a real streaming CSS-selector-based parser) rather than hand-rolled
regex, specifically to be resilient to MFL markup changes.

## Files

- `cloudflare-test/worker.js` — the automation itself, running on
  Cloudflare Workers.
- `cloudflare-test/wrangler.toml` — Worker config: Cron Trigger, KV
  namespace binding, league config.
- `home-page-status-snippet.html` — optional, see below.
- `docs/` — deeper reference material for anyone (human or AI)
  extending this project; see "For developers" below.
- `LICENSE` — MIT.

## Optional: status widget for your MFL homepage

`home-page-status-snippet.html` is a small widget you can paste into an
MFL Home Page Message — for the whole league, not just the
commissioner. Every owner sees their own current waiver position and
when they last acquired a player, the full order annotated with each
team's last-acquired date, recent league-wide activity, a couple of
simple season stats, and a consistency check that flags "the bot hasn't
caught up to this yet" instead of leaving people to wonder. A separate
commissioner-only section adds the season-rollover reminder and the
automation's actual last-run status, read live from your Worker's own
`/status` endpoint (no login/token needed for that — it's a public,
non-sensitive summary).

It reuses MFL's own table styling (`report`/`oddtablerow`/`eventablerow`
classes) instead of hardcoded colors, so it automatically matches
whatever skin your specific league has active — no per-league
customization needed for that part. It changes nothing about whether
the automation runs; it's purely a display, computed from data any
logged-in league member can already see with their own MFL session, plus
one small public status read. Read the comments at the top of that file
before using it, and edit the small config block near the top (your
Worker's `/status` URL, your actual check interval, and your
commissioner franchise ID if "0000" doesn't match).

## Optional: ambient status message on your homepage

Separate from the widget above — a small always-there status table
("Waiver Bot Status: OK, last checked ...") that the Worker itself
writes directly into one of MFL's built-in **Home Page Message** slots
(the same feature used for things like league fee reminders), rather
than something you paste in yourself.

**One-time prerequisite**: **Commissioner Setup → Appearance Setup →
Reports and Security Settings**, find *"Use 'Advanced Editor' on league
type-in boxes?"* and set it to **No**. If it's left on "Yes," MFL runs a
WYSIWYG editor over the message box that mangles raw HTML on save — the
Worker checks this itself before writing and refuses (rather than
writing garbled output) if it's still "Yes."

**How it works**: `GET /claim-status-slot?token=...` finds an empty
message slot (checking all 20 for real content, highest-numbered first —
MFL hard-caps these at 20 regardless of skin/customization) and writes
the status table into it, remembering which slot it used so future
calls update the same one instead of hunting again. It marks its own
content with a hidden comment so it can tell later whether it still owns
that slot, or a human has reused the number for something else — if so,
it picks a new one instead of overwriting them.

You only need to call `/claim-status-slot` yourself **once**, to claim a
slot in the first place (and note which one, for the manual placement
step below). After that it keeps itself current on its own — the same
5-minute schedule that checks waivers also refreshes this content, at
most once an hour (no point re-writing a page element that often for
something that's just an "is this thing alive" indicator). Calling
`/claim-status-slot` again any time is fine too — e.g. for an immediate
refresh instead of waiting up to an hour — it's just not required.

**One-time manual step**: writing content into a slot doesn't make it
*visible* — confirmed live, a Home Page Message only renders once it's
placed on a tab via **Commissioner Setup → Appearance Setup → Home Page
Modules and Tabs Setup**, independent of whether it has content saved.
MFL has no API for editing that layout (checked their own Import docs
and a third-party open-source library that wraps the whole API — module
placement is a manual drag-and-drop admin screen only), so after calling
`/claim-status-slot` once, note which slot number it used (in the JSON
response) and manually place that one "Home Page Message #N" module
directly beneath the native **Waiver Wire Order** module on your Main
tab. One-time, a couple of minutes — the content itself stays current on
its own after that.

## For developers (human or AI) continuing this project

Everything above is written for a commissioner setting this up. Want
the short version of *how it all works and why*, in plain language,
before the technical details? See `docs/HOW_IT_WORKS.md`. For
extending the code itself, `docs/DEVELOPMENT_NOTES.md` has the
full technical reference — every confirmed MFL mechanic (exact
endpoints, field names, what's officially documented vs. reverse
engineered), the design decisions and why, and how to extend it
without re-deriving things that already took real live testing to pin
down. `docs/LESSONS_LEARNED.md` covers process mistakes worth not
repeating. `docs/FUTURE_WORK.md` lists what was deliberately tabled
and why. `docs/CONFIGURABLE_SETTINGS_IDEAS.md` is a brainstorm of
commissioner-facing settings worth considering for a future polished
version.

## Support

This project's own source lives on GitHub, purely as a place to store
and read code from — that's incidental hosting, not part of the
automation, which is 100% Cloudflare end to end. **Use this template**
above gets you your own copy; deploy your own Cloudflare Worker from it
and you're done. If you'd rather not touch GitHub at all, even just to
read the source, open an issue and say so — there's no zero-GitHub
distribution path built yet (Cloudflare's own "Deploy to Cloudflare"
button still requires a GitHub or GitLab account to receive the cloned
copy, so it wouldn't fully solve this either), but it's worth exploring
if enough people want it.
