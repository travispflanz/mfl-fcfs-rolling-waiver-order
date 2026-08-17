# MFL FCFS + Rolling Waiver Order

Automatically keeps a MyFantasyLeague.com (MFL) league's **Custom Waiver
Order** on one continuously-updating rolling priority list, driven by two
specific acquisition types MFL tracks separately:

- **First-Come-First-Served free agency** (instant pickups)
- **Waiver free agency** (scheduled-priority claims)

This bot doesn't care which of those two someone used — within an hour
(by default) of *any* franchise picking up a player either way, it
drops to the bottom of the list. Whoever's gone longest without an add
(or never has) sits at the top. (MFL tracks other transaction types too
— trades, IR moves, taxi squad, auctions — none of those affect waiver
priority and this bot ignores them entirely.)

**MFL FCFS + Rolling Waiver Order** runs entirely on GitHub's own hosted
runners — no server, no local machine, nothing that depends on your
computer being on.

## Quick start

Do these in order — the MFL-side settings come first on purpose, so
they're already correct by the time the automation can possibly run
(see "What actually turns this on" below).

1. Settings to change in MFL's own site — nothing to do in GitHub yet.
   Log into MFL as commissioner, open your league, then:

   > **Commissioner Setup** *(top navigation menu — only visible to
   > commissioners)* → *"ADD/DROP AND WAIVERS SETUP"* → **Waiver
   > Request Setup**

   Then:

   - Find **"Waiver Request Sort Order"** and select either **"Same"**
     (a straight line: round 1, 2, ... N, then repeats the same way
     every round) or **"Reverse"** (a snake: 1...N, then N...1,
     alternating each round). Either is fine — what actually matters is
     that MFL isn't left on **"Weekly Rolling"** or **"Season-long
     Rolling"**, which both have MFL recalculating the order itself and
     will eventually overwrite whatever this bot sets.
   - Just below that, find the six **"Waiver Sort Criteria"** dropdowns
     (#1 through #6) and set **all six to "None."** MFL's own label
     text for "Same"/"Reverse" says they use "the criteria below" — so
     if any of the six is left on a real criterion (standings, points,
     etc.) instead of None, MFL can still use it to help compute the
     order, which undoes the point just as surely as leaving Weekly/
     Season-long Rolling on would.

   (The automation checks all of this on every run and logs a warning
   if anything's still off — see "Settings-compatibility check" below.)

   **If your league has a specific starting order in mind** — most
   commonly reverse draft order, but any convention — set it yourself
   on **Custom Waiver Order Setup** before the bot's first run. This
   matters because of what the six Sort Criteria above actually offer:
   confirmed live, all 12 options (Overall Win %, Head-to-Head, Total
   Points, Divisional Win %, All-Play Win %, Reverse Points Against,
   Power Rank, Victory Points, Last Week's Points, Offensive Points,
   Defensive Points, and None) are standings/performance-based — **none
   of them is draft-order-based.** MFL has no automatic way to seed a
   draft-order-derived starting order; manually arranging it yourself,
   once, is the only way to get that specific convention.

   **If you don't have a specific starting order in mind** — no separate
   step needed. Confirmed live, **Custom Waiver Order Setup** always
   shows a populated order already, even before anyone's ever saved a
   custom one, and this bot just adopts whatever's there as its starting
   point and reorders from there.

2. Above the file list on this page:

   > **Use this template** → **Create a new repository**

   Give it any name, and pick **Private**
   — your `MFL_USERNAME`/`MFL_PASSWORD` secrets themselves stay hidden
   either way, but a Public repo's Actions run logs are visible to
   literally anyone on the internet, not just you, so Private is the
   safer default. (Public repos get unlimited free Actions minutes;
   Private ones get a limited free allowance and then draw from your
   account's paid minutes — at this bot's hourly default that's well
   within the free allowance either way, only a real concern if you
   later turn the check frequency up a lot.) Click **Create
   repository**. You now have your own independent copy; nothing you do
   in it ever touches this original repo.

3. In your new repo:

   > **Settings** *(top row, after Code / Issues / Pull requests /
   > Actions)* → **Secrets and variables** → **Actions**

   That page has two sub-tabs near the top, **Secrets** and
   **Variables** — on the Secrets tab, click **New repository secret**
   for each of the first two rows below; on the Variables tab, click
   **New repository variable** for the third:

   | Name | Type | Value |
   |---|---|---|
   | `MFL_USERNAME` | Secret | Your MFL account username |
   | `MFL_PASSWORD` | Secret | Your MFL account password |
   | `MFL_LEAGUE_URL` | Variable | **Any** URL from your league — your league homepage address bar is easiest, e.g. `https://www44.myfantasyleague.com/2026/home/19186` |

   No need to figure out your host, season year, or league ID
   separately — the script pulls all three out of whatever URL you
   paste.

4. Test it with a dry run before trusting it for real.

   > **Actions** *(top row)* → **MFL Waiver Adjustment Check**
   > *(left sidebar)* → **Run workflow** *(button, top-right above the
   > run list)*

   That opens a small panel with three things in it, top to bottom:
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
running for real well before you'd naturally get to steps 4/5 — which
is exactly why the MFL-side settings in step 1 come first: so there's
nothing for it to get wrong even if it
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

Every run checks MFL's own **Waiver Request Sort Order** (needs to be
"Same" or "Reverse") and all six **Waiver Sort Criteria** (need to be
"None") — the settings from step 1 — before doing anything else. If
anything's off, the run logs a clearly-marked warning explaining that
MFL may silently overwrite whatever this bot sets — and still proceeds,
rather than blocking, in case that's a deliberate choice.

## Each new NFL season

MFL has commissioners transfer/export their league forward to a new
season every year. The host and league ID stay the same — only the year
changes. When you do that transfer, update the `MFL_LEAGUE_URL` variable:

> **Settings** → **Secrets and variables** → **Actions** → **Variables**

That's the only yearly maintenance this needs.

## Schedule

Checks **hourly** by default. MFL has no push/webhook for transactions
(confirmed), so this is polling either way — hourly rather than
GitHub Actions' 5-minute floor on purpose, since actual waiver
processing itself runs on its own schedule (hours to days apart, not
minutes), so checking more often than that doesn't change any real
outcome. Each check only actually submits a change when the computed
order differs from what's already there; otherwise it's a fast no-op,
~25 seconds end to end.

Want a different interval? Edit the one `cron:` line near the top of
`.github/workflows/waiver-order.yml` — it's a standard 5-field cron
expression (`0 * * * *` = hourly, `*/5 * * * *` = every 5 minutes,
GitHub's fastest allowed, etc.). See GitHub's own
[cron syntax reference](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
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
