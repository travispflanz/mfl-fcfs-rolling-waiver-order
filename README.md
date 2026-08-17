# MFL Custom Waiver Order — Nightly Automation (GitHub Actions)

Sets the Custom Waiver Order for the **Kansas City Keeper** MFL league
(`www44`, league `19186`) every night, ranking franchises by reverse
recency of "Acquired" (waiver/free-agent) transactions: whoever most
recently picked someone up off waivers goes to the bottom of the order;
whoever has gone longest without an add (or never has) goes to the top.

Runs entirely on **GitHub's own hosted runners** via a scheduled Actions
workflow — nothing about this depends on any local machine being on.

## Why a real browser (Playwright), not a Cloudflare Worker

A prior version of this automation ran as a Cloudflare Worker doing plain
`fetch()` calls (login API + manual cookie handling). It reliably got
served a stripped, logged-out-looking page from MFL — even when using a
cookie string captured directly from a real, working browser session. That
rules out "wrong cookie" as the cause. Direct inspection also shows MFL
sitting on bare Apache/mod_perl with no third-party WAF/CDN fingerprint, so
it isn't an obvious edge-network IP block either. The symptom (login
succeeds, the very next request looks anonymous) best fits some kind of
session/origin binding that a serverless `fetch()` can't reproduce but a
single continuous real browser session does automatically. This version
uses a real headless Chromium (via Playwright) for the entire session —
login through submission — so every request looks exactly like one person
clicking through the site.

## One-time setup

### 1. Add repository secrets

**Settings → Secrets and variables → Actions → New repository secret:**

| Name | Value |
|---|---|
| `MFL_USERNAME` | Your MFL account username |
| `MFL_PASSWORD` | Your MFL account password |

Set these yourself directly in GitHub's UI (or via `gh secret set NAME`
in your own terminal) — nothing in this repo or its automation ever
needs to see these values outside of that one write.

### 2. (Optional) Repository variables

These already default to the right values for this league in the
workflow, but you can override them under **Settings → Secrets and
variables → Actions → Variables** if the league ID, host, or year ever
changes:

| Name | Default |
|---|---|
| `MFL_HOST` | `www44` |
| `MFL_YEAR` | `2026` |
| `MFL_LEAGUE` | `19186` |

### 3. Test it manually before trusting the schedule

**Actions tab → "MFL Waiver Order Nightly" → Run workflow.** Leave
**dry_run** checked (the default) for the first run — it logs the current
order, the transactions it found, and the computed target order, but does
**not** submit anything. Open the run's logs and confirm:

- Login succeeded (no "password field still present" error).
- The transactions export returned a sensible number of records.
- The computed target order looks right.

Once that looks correct, run it again with **dry_run unchecked** to do a
real (one-time, on-demand) update, then check the league homepage's
Waiver Wire Order widget to confirm it went live.

## Schedule

The workflow fires at both `07:00` and `08:00` UTC every day — one of
those is 2am Central depending on Daylight Saving Time, the other is 3am
or 1am. The script itself checks the real Central-time clock and no-ops
on whichever of the two firings isn't actually 2am, so only one real
update happens per night. This is the standard workaround for GitHub
Actions' `schedule` trigger being UTC-only with no DST awareness.

## Durability — read this

MFL's own setup page notes: if this league uses **Season Long Rolling**
or **Weekly Rolling** waiver order, a custom order only seeds the
*initial* order — the first time waivers actually process, MFL replaces
it with its own rolling-order calculation, silently. If the league is
**not** on a rolling type, the custom order persists exactly as set. If
you want to confirm which type this league uses, check **League Setup →
Waivers/Free Agents Setup**.

## Files

- `.github/workflows/waiver-order.yml` — the schedule + manual trigger.
- `scripts/update-waiver-order.mjs` — the actual automation (Playwright).
- `package.json` — dependencies (`playwright`).

## How the write itself works

MFL has no public API for setting waiver order — this uses the same
commissioner-only HTML form a person would use
(`csetup?L={league}&C=WAIVORD`), reading its hidden fields
(`input_expires`, `WAIVER_ORDER_LEAGUE_1..N`, etc.) fresh on every run and
POSTing the reordered list back, executed as a real `fetch()` call from
inside the authenticated browser tab (so it carries the exact same
session as everything else in the run). No UI clicking/dragging is
needed — MFL accepts a direct form POST once you're authenticated as
commissioner in that session.

## Reading the acquired-transaction data

Uses MFL's documented `export?TYPE=transactions&JSON=1` API
(`TRANS_TYPE=WAIVER,BBID_WAIVER,FREE_AGENT`) rather than scraping the
HTML transactions report — structured, official data instead of a
regex against a rendered page.
