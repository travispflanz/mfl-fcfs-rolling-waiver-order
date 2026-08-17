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

1. Click **Use this template** — green button, top-right above the file
   list on this page — then **Create a new repository**. Give it any
   name, pick Public or Private, click **Create repository**. You now
   have your own independent copy; nothing you do in it ever touches
   this original repo.

2. In your new repo, click the **Settings** tab (top row of the repo
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

3. Two settings you need to change in the **Commissioner Setup** area of
   your MyFantasyLeague.com site (or similar wording — nothing to do in
   GitHub for this step). Log into MFL as commissioner, open your
   league, and click **Commissioner Setup** (top navigation menu —
   only visible to commissioners). Or skip the menu-hunting and jump
   straight to each page: take the league URL you used above and
   swap its path for the two addresses below.

   - **Set an initial waiver order.** On **Commissioner Setup**, look
     under "ADD/DROP AND WAIVERS SETUP" for **Custom Waiver Order
     Setup** — or go directly to `csetup?L={your league ID}&C=WAIVORD`.
     Set *some* starting order there, even an arbitrary one. This bot
     only *reorders* whatever's already there — it doesn't invent an
     order from nothing.
   - **Turn off MFL's own automatic waiver-order adjustment.** Same
     area, look for **Waiver Request Setup** — or go directly to
     `csetup?L={your league ID}&C=WAIVREQ`. Under **"Waiver Request Sort
     Order"** select **"Same"** (*"Every round is same order, using the
     criteria below"*). MFL's other three options (Reverse, Weekly
     Rolling, Season-long Rolling) all have MFL silently recalculating
     the order itself — if one of those stays on, it'll periodically
     overwrite whatever this bot sets.

4. Back in GitHub, click the **Actions** tab. In the left sidebar, click
   **MFL Waiver Adjustment Check**. On the right, click the **Run
   workflow** dropdown, leave the **dry_run** checkbox checked (it's
   checked by default), click the green **Run workflow** button inside
   that dropdown. Wait about a minute, click into the run that appears,
   and open its log — confirm it logged your real franchises and a
   sensible target order, with no errors.

5. Run it again the same way, but this time **uncheck dry_run** before
   clicking **Run workflow** — this does one real, one-time update.
   Check your league homepage's Waiver Wire Order widget to confirm it
   went live.

6. Done — from here on it runs on its own automatically.

## Each new NFL season

MFL has commissioners transfer/export their league forward to a new
season every year. The host and league ID stay the same — only the year
changes. When you do that transfer, update the `MFL_LEAGUE_URL` variable
(**Settings → Secrets and variables → Actions → Variables**) to point at
the new season's URL. That's the only yearly maintenance this needs.

## Schedule

Checks every **5 minutes** by default — GitHub Actions' shortest allowed
interval, so that's as close to real-time as this can get. Each check is
cheap: it only actually submits a change to MFL when the computed order
is different from what's already there, otherwise it's a quick no-op.

MFL itself has no push/webhook mechanism for transactions (confirmed —
even MFL's own official "Text Alerts" don't cover waiver/free-agent
pickups, and a well-known third-party MFL app's own developers describe
their "live" updates as periodic polling too), so checking on an
interval is the closest any tool can get to instant.

Want to check less often — e.g. to go easier on your Actions minutes
while this repo is still private? Edit the one `cron:` line in
`.github/workflows/waiver-order.yml`. It's a plain 5-field cron
expression: `*/5 * * * *` is every 5 minutes, `*/30 * * * *` is every 30,
`0 * * * *` is hourly, and so on — no timezone/DST math involved, since
this no longer targets one specific time of day.

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
