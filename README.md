# MFL FCFS + Rolling Waiver Order

Automatically keeps a MyFantasyLeague.com (MFL) league's **Custom Waiver
Order** on one continuously-updating rolling priority list, driven by two
specific acquisition types MFL tracks separately:

- **First-Come-First-Served free agency** (instant pickups)
- **Waiver free agency** (scheduled-priority claims)

This bot doesn't care which of those two someone used — usually within
minutes of *any* franchise picking up a player either way, it drops to
the bottom of the list. Whoever's gone longest without an add (or never
has) sits at the top. (MFL tracks other transaction types too — trades,
IR moves, taxi squad, auctions — none of those affect waiver priority
and this bot ignores them entirely.)

**mfl-fcfs-rolling-waiver-order** runs entirely on GitHub's own hosted
runners — no server, no local machine, nothing that depends on your
computer being on.

## Quick start

Do these in order — the MFL-side settings come first on purpose, so
they're already correct by the time the automation can possibly run
(see "What actually turns this on" below).

1. Two settings to change in the **Commissioner Setup** area of your
   MyFantasyLeague.com site — nothing to do in GitHub yet. Log into MFL
   as commissioner, open your league, and click **Commissioner Setup**
   (top navigation menu — only visible to commissioners).

   - **Set an initial waiver order.** On the **Commissioner Setup** page,
     look under "ADD/DROP AND WAIVERS SETUP" and click **Custom Waiver
     Order Setup**. Set *some* starting order there, even an arbitrary
     one. This bot only *reorders* whatever's already there — it
     doesn't invent an order from nothing.
   - **Turn off MFL's own automatic waiver-order adjustment.** Back on
     **Commissioner Setup**, same "ADD/DROP AND WAIVERS SETUP" section,
     click **Waiver Request Setup**. Find **"Waiver Request Sort
     Order"** and select **"Same"** (*"Every round is same order, using
     the criteria below"*). MFL's other three options (Reverse, Weekly
     Rolling, Season-long Rolling) all have MFL silently recalculating
     the order itself — if one of those stays on, it'll periodically
     overwrite whatever this bot sets. (The automation checks for this
     on every run and logs a warning if it's not set to "Same" — see
     "Settings-compatibility check" below.)

2. Click **Use this template** — green button, top-right above the file
   list on this page — then **Create a new repository**. Give it any
   name, and pick **Private** — your `MFL_USERNAME`/`MFL_PASSWORD`
   secrets themselves stay hidden either way, but a Public repo's Actions
   run logs are visible to literally anyone on the internet, not just
   you, so Private is the safer default. (One tradeoff: Public repos get
   unlimited free Actions minutes, Private ones get a limited free
   allowance and then draw from your account's paid minutes — checking
   every 5 minutes adds up to roughly 3,600 minutes/month. Worth knowing
   if that tips your choice.) Click **Create repository**. You now have
   your own independent copy; nothing you do in it ever touches this
   original repo.

3. In your new repo, click the **Settings** tab (top row of the repo
   page, after Code / Issues / Pull requests / Actions). In the left
   sidebar, click **Secrets and variables**, then **Actions**. That page
   has two sub-tabs near the top, **Secrets** and **Variables** — on the
   Secrets tab, click **New repository secret** for each of the first
   two rows below; on the Variables tab, click **New repository
   variable** for the third:

   | Name | Type | Value |
   |---|---|---|
   | `MFL_USERNAME` | Secret | Your MFL account username |
   | `MFL_PASSWORD` | Secret | Your MFL account password |
   | `MFL_LEAGUE_URL` | Variable | **Any** URL from your league — your league homepage address bar is easiest, e.g. `https://www44.myfantasyleague.com/2026/home/19186` |

   No need to figure out your host, season year, or league ID
   separately — the script pulls all three out of whatever URL you
   paste.

4. Test it with a dry run before trusting it for real. Click the
   **Actions** tab (top row of the repo page). In the left sidebar,
   click **MFL Waiver Adjustment Check**. Above the list of runs
   (top-right), click the **Run workflow** button — a small panel drops
   down with three things in it, top to bottom:
   - a **Branch** dropdown — leave it as-is (your default branch)
   - a **dry_run** checkbox — leave it checked (checked by default)
   - a green **Run workflow** button — click this one to actually start it

   Wait about a minute, then a new row appears in the run list below —
   click it, then open the **update-waiver-order** job to see the log.
   Confirm it logged your real franchises and a sensible target order,
   with no errors.

5. Run it again the same way, but this time **uncheck dry_run** in that
   same panel before clicking the green **Run workflow** button — this
   does one real, one-time update. Check your league homepage's Waiver
   Wire Order widget to confirm it went live.

6. Done — from here on it runs on its own automatically.

### What actually turns this on

There's no separate "activate" switch — the schedule in
`.github/workflows/waiver-order.yml` starts running as soon as (a) the
workflow file exists on your repo's default branch, which happens the
moment you create it from the template, and (b) Actions is enabled for
your repo, which is the default. In practice that means it can start
running for real within minutes of finishing step 2 — well before you'd
naturally get to steps 4/5 — which is exactly why the MFL-side settings
in step 1 come first: so there's nothing for it to get wrong even if it
fires before you finish the rest of this checklist. (One caveat seen
during testing: a *brand-new* repo's workflow can take a short moment to
be indexed by GitHub after the first push — if step 4 shows no "MFL
Waiver Adjustment Check" in the sidebar yet, wait a minute and refresh.)

### If it goes quiet for a while

Nothing accumulates or drifts — every run independently reads your
league's *current* live state (current order + full transaction
history) and recomputes fresh, so a run failing, or the league settings
being changed by hand in the meantime, doesn't leave anything to "fix"
later. The next successful run just picks up from wherever things
actually stand.

Two things worth knowing about failures specifically:
- GitHub automatically emails/notifies (per your own notification
  settings) whoever created the workflow when a scheduled run fails —
  nothing extra to configure for that.
- Separately, GitHub auto-disables scheduled workflows in public repos
  after **60 days with no repository activity at all** (any commit
  resets this) — worth knowing about for a long off-season, unrelated to
  whether the script itself is working.

### Settings-compatibility check

Every run checks whether MFL's own **Waiver Request Sort Order** is set
to "Same" (the setting from step 1) before doing anything else. If it
isn't, the run logs a clearly-marked warning explaining that MFL may
silently overwrite whatever this bot sets — and still proceeds, rather
than blocking, in case that's a deliberate choice.

## Each new NFL season

MFL has commissioners transfer/export their league forward to a new
season every year. The host and league ID stay the same — only the year
changes. When you do that transfer, update the `MFL_LEAGUE_URL` variable
(**Settings → Secrets and variables → Actions → Variables**) to point at
the new season's URL. That's the only yearly maintenance this needs.

## Schedule

Checks every **5 minutes** by default (GitHub Actions' shortest allowed
interval — MFL has no push/webhook for transactions, confirmed, so
polling on an interval is as close to real-time as this can get). Each
check only actually submits a change when the computed order differs
from what's already there; otherwise it's a fast no-op, ~25 seconds
end to end.

Want to check less often? Edit the one `cron:` line near the top of
`.github/workflows/waiver-order.yml` — it's a standard 5-field cron
expression (`*/5 * * * *` = every 5 minutes, `0 * * * *` = hourly, etc.).
See GitHub's own [cron syntax reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
for the exact format and its quirks.

## Why a real browser (Playwright), not plain HTTP calls

An earlier version of this ran as a Cloudflare Worker doing plain
`fetch()` calls. It reliably got served a stripped, logged-out-looking
page from MFL — even with a cookie string captured directly from a real,
working browser session, which rules out "wrong cookie" as the cause.
Separately, MFL turned out to treat "logged in" and "acting as
commissioner for this league" as two different session states — a
league-scoped "Become Commissioner" step is required even for an account
that already *is* the commissioner. A plain login API call has no way to
discover or follow that step; a real, continuous browser session does the
whole thing — login, become-commissioner, read, write — exactly like a
person clicking through the site, so nothing about authentication is
ever guessed or reconstructed by hand.

## How the write itself works

MFL has no public API for setting waiver order — this uses the same
commissioner-only HTML form a person would use
(`csetup?L={league}&C=WAIVORD`), reading its hidden fields
(`input_expires`, `WAIVER_ORDER_LEAGUE_1..N`, etc.) fresh on every run and
POSTing the reordered list back, executed as a real `fetch()` call from
inside the authenticated browser tab. No UI clicking/dragging needed —
MFL accepts a direct form POST once the session is authenticated as
commissioner.

## Reading the acquired-transaction data

Uses MFL's documented `export?TYPE=transactions&JSON=1` API
(`TRANS_TYPE=WAIVER,BBID_WAIVER,FREE_AGENT`) — structured, official data,
not scraping of a rendered HTML report.

## Files

- `.github/workflows/waiver-order.yml` — the schedule + manual trigger.
- `scripts/update-waiver-order.mjs` — the automation itself (Playwright).
- `home-page-status-snippet.html` — optional, see below.
- `package.json` — dependencies (`playwright`).

## Optional: status widget for your MFL homepage

`home-page-status-snippet.html` is a small, commissioner-only status box
you can paste into an MFL Home Page Message — shows when this last ran
and reminds you each off-season to check `MFL_LEAGUE_URL` before the new
year starts. It changes nothing about whether the automation runs; it's
purely a display. Read the comments at the top of that file before using
it — it explains plainly what the commissioner-only check does and
doesn't actually hide.

## Support

This is set up as a GitHub template on purpose — click **Use this
template**, add your three settings, done. If you'd rather not use GitHub
at all, open an issue on this repo and say so; if enough people ask for a
different setup path, it's worth building one.

One candidate already on the list: an earlier version of this ran as a
Cloudflare Worker (see "Why a real browser" above) and hit what looked
at the time like a hard blocker. In hindsight, the real cause was almost
certainly the missing "Become Commissioner" step — something a Worker
doing plain HTTP requests could just as easily do once it knows to. That
makes a lightweight, no-browser Worker version worth revisiting as a
faster/cheaper alternative to the Playwright approach here, for anyone
who'd rather run this off GitHub Actions entirely.
