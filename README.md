# MyFantasyLeague.com Continuously-Updating Season-long Rolling Waiver Priority 

Keep a MyFantasyLeague.com (MFL) league's **Custom Waiver
Order** on one continuously-updating rolling priority list, driven by two
specific acquisition types MFL tracks separately:

- **First-Come-First-Served free agency** (instant free agent adds)
- **Waiver free agency** (scheduled-priority claims)

**Why is this needed?**

By default MFL is not capable of treating every free agent acquisition the same to figure the current waiver order. Many fantasy football leagues find a benefit to combining these two types of free agent acquisitions to make each decision to add a player carry some weight for a fantasy team owner. With FCFS and Waiver free agent acquisitions separate, an owner can hang on to their #1 waiver priority all season waitig for "someone special" while filling all their other free agency needs through FCFS. 

This bot doesn't care which of those two someone used — within a few
minutes (by default) of *any* team picking up a player either way,
drops to the bottom of the waiver priority list. The tam that has gone longest without a free agent add (or never has) sits at the top. (MFL tracks other transaction types
 — trades, IR moves, taxi squad, auctions — none of those affect
waiver priority and this bot ignores them entirely.)

**MFL FCFS + Rolling Waiver Order** runs entirely on a **Cloudflare
Worker** — no server, no local machine, nothing that depends on your
computer being on, and no headless browser: plain HTTP requests, so
each transaction logs check and waiver priority update takes milliseconds.

## Quick start (written for a first-time commissioner — no coding experience assumed)

This whole setup happens entirely in your regular web browser, across
three sites: Your fantasy football league in MFL's own site (a few settings), GitHub (here, holding your own
copy of the code, and one small REQUIRED manual text edit), and Cloudflare's dashboard
(where the automation actually runs). **No installing anything, no
command line/terminal, no coding.** Every step below is clicking a
button or filling in a text box.

Expect first-time setup to take 20–30 minutes. None of this requires money or payment or
requires a credit card — Cloudflare's free tier is more than enough
for this, and MFL/GitHub are both already free.

### Part 1 — required (the core automation)

**Step 1 — MFL settings.** Log into MFL as commissioner, open your
league, then go to:

> **Commissioner Setup** *(top navigation menu — only visible to
> commissioners)* → *"ADD/DROP AND WAIVERS SETUP"* → **Waiver
> Request Setup**

<UPDATE_NOTE> i noticed another required setting. sample url structure https://www44.myfantasyleague.com/2026/csetup?L=52689&C=ADDDROP What Type Of Add/Drop System Does Your League Use? - need to require "Waiver Requests For Locked Players, First Come/First Serve For Rest" i believe because if the system doesn't use fcfs along with waivers - then there's no point to using this script</UPDATE_NOTE>

- Find **"Waiver Request Sort Order"** and select either **"Same"** or
  **"Reverse"** (both work fine — pick either). What matters is that
  it's *not* left on **"Weekly Rolling"** or **"Season-long Rolling"**,
  which have MFL recalculate the order itself and will eventually
  overwrite whatever this bot sets.
- Just below that, set all six **"Waiver Sort Criteria"** dropdowns to
  **"None."** MFL's own label text says "Same"/"Reverse" still use
  "the criteria below" — leaving any of the six on a real criterion
  lets MFL override the order.
- Click **Save** at the bottom of the page.

(The automation checks both of these itself on every run and logs a
warning if anything's still off — it won't silently break without notification)

<UPDATE_NOTE>this following optional section reads weirdly. need to find out default new league initial waiver order logic and initial waiver order if commish copy league from previous season <UPDATE_NOTE>
**Optional, only if you want a specific starting order** (like reverse
draft order): set it yourself on **Custom Waiver Order Setup** before
you finish setup below — MFL has no automatic way to create a
draft-order-based starting point; every one of its 12 built-in sort
criteria is standings/performance-based instead. If you don't care
about the starting order, skip this — MFL always has *some* order
already there, and the bot just reorders from whatever that is.

**Step 2 — get the code.** Above the file list on this page, click
**Use this template** → **Create a new repository**. Give it any name,
choose **Private** or **Public** (either is fine — it's your own
independent copy either way), click **Create repository**. GitHub
takes you to your own new copy of this project. You won't download or
install anything from it — the next few steps edit and connect it
directly through GitHub's and Cloudflare's own websites.

**Step 3 — create a free Cloudflare account.** If you don't already
have one: go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up),
enter an email and password, verify your email. No credit card needed
for anything in this guide.

**Step 4 — create a small storage namespace.** This just holds a "last
run OK/failed" note — nothing about your MFL account. In the Cloudflare
dashboard: **Storage & Databases** *(left sidebar)* → **Workers KV** →
**Create Instance**. Name it anything (e.g. `waiver-order-status`),
click **Create**. You'll land back on the list with a new row — copy
the long **ID** shown next to it; you'll paste it in the next step.

**Step 5 — point the code at your league and your storage.** Back on
your new repository's GitHub page, click `wrangler.toml`, then click
the pencil (✏️) icon in the top right to edit it. Change two lines:
- `MFL_LEAGUE_URL = "..."` — replace the URL with any URL from your own
  league (your league homepage's address bar is the easiest place to
  copy one from).
- Under `[[kv_namespaces]]`, `id = "..."` — replace it with the ID you
  copied in step 4.

Optionally, also change the `name` at the very top of the file (it's
just a starting default) — this becomes the first part of your
Worker's address in step 6, so pick anything you like.

Scroll down, leave it set to commit directly to your repository's
default branch (already selected), click **Commit changes**.

**Step 6 — connect it to Cloudflare and deploy.** In the Cloudflare
dashboard: **Compute (Workers)** → **Workers & Pages** → **Create** →
**Create a Worker** → **Continue with GitHub**. The first time, GitHub
asks you to approve Cloudflare's access — approve it for the repository
you created in step 2 (or all repositories, your choice). Select your
repository, then click **Save and Deploy**.

This kicks off a real (short) build — Cloudflare fetches your repo and
deploys it, which takes roughly a minute, not instant. When it
finishes, you'll see a URL that looks like
`https://mfl-waiver-order.YOUR-SUBDOMAIN.workers.dev` (the first part
comes from `name` in `wrangler.toml`, not your repository's name — see
step 5) — that's your automation's own address. Save it; you'll need
it below and for the optional widget later.

**Step 7 — set your secrets.** Still on your Worker's page in
Cloudflare: **Settings** → **Variables and Secrets** → **Add variable**,
three times, marking each one **Secret**:

| Name | Value |
|---|---|
| `MFL_USERNAME` | your real MFL commissioner login |
| `MFL_PASSWORD` | your real MFL commissioner password |
| `DIAG_TOKEN` | any random text you make up right now (mash the keyboard) — write it down |

`DIAG_TOKEN` is **not** an MFL credential — it's just a password you
make up yourself that lets *you* trigger manual checks later. Click
**Deploy** at the bottom to apply.

Forgot it later? Cloudflare secrets can't be read back once set, only
replaced — there's no "recover my token" option. Just add it again
with a new value; nothing else needs to change, and the automatic
schedule (which needs no token at all) isn't affected either way.

**Step 8 — test before trusting it.** Paste this into your browser's
address bar, replacing both placeholders with your Worker's URL from
step 6 and the `DIAG_TOKEN` you made up in step 7, and press Enter:

```
https://YOUR-WORKER-URL/run?dry_run=true&token=YOUR_DIAG_TOKEN
```

This should show a block of JSON with your real team names and a
computed order, and no `error`. If you see errors, re-check steps 4–6
first (wrong KV id, wrong secret, or wrong league URL are the most
common causes).

**Done.** Nothing else to turn on — the schedule already started the
moment your Worker deployed in step 6; the first real check happens
within 5 minutes (up to ~15 minutes the very first time, while the
schedule finishes activating on Cloudflare's end). Check your league
homepage's Waiver Wire Order widget afterward to confirm.

*Prefer the command line?* Nothing above is required to be done that
way, but `wrangler.toml` is fully compatible with Cloudflare's own
`wrangler` CLI exactly as documented in their docs (`wrangler login`,
`wrangler deploy`, `wrangler secret put`) if you'd rather work that
way — see `docs/DEVELOPMENT_NOTES.md`.

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
running as soon as your Worker successfully deploys — there's no
separate "activate" switch, and no step beyond connecting the repo in
step 6 above. New or changed Cron Triggers can take up to ~15 minutes to
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
changes. When you do that transfer, edit `MFL_LEAGUE_URL` in
`wrangler.toml` the same way as Quick Start step 5 — on GitHub, in your
browser — and commit. Cloudflare redeploys automatically within a
minute or two of any commit to your repository; no separate deploy step
needed.

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
`wrangler.toml`'s `[triggers]` block the same way as
Quick Start step 5 — on GitHub, in your browser — with a standard
5-field cron expression, e.g. `*/5 * * * *` (every 5 minutes) or
`*/15 * * * *` (every 15), then commit; Cloudflare redeploys
automatically. See
[Cloudflare's cron syntax reference](https://developers.cloudflare.com/workers/configuration/cron-triggers/#supported-cron-expressions)
for the exact format.

(Cloudflare's dashboard also has its own Cron Trigger editor, under
your Worker's Settings → Trigger events — but since your Worker is
connected to your GitHub repo, `wrangler.toml` is the actual source of
truth long-term: the next commit-triggered redeploy would silently
overwrite a dashboard-only change back to whatever the file says. Edit
it in `wrangler.toml`, not the dashboard, so nothing gets quietly
reverted later.)

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

- `worker.js` — the automation itself, running on Cloudflare Workers.
- `wrangler.toml` — Worker config: Cron Trigger, KV namespace binding,
  league config.
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

### Inline copy — paste directly from here

Kept byte-for-byte identical to `home-page-status-snippet.html` in this repo
(that file is the backup/reference copy — copy from either, they must always
match). Select everything in the code block below and paste it into your Home
Page Message, as described above.

```html
<!--
  SYNC NOTE: this file is mirrored byte-for-byte inside README.md's
  "Optional: status widget" section (an inline copy so a commissioner
  can paste directly from the README, no separate file needed). If you
  edit this file, copy the exact same change into README.md's copy —
  do not paraphrase or retype it there, and diff the two before
  committing. This file is the reference/backup copy of the two.

  MFL WAIVER BOT WIDGET — optional, for the whole league, not just the
  commissioner. This is NOT the automation trigger — the actual waiver
  order update runs entirely on a Cloudflare Worker's own Cron Trigger
  (see worker.js + wrangler.toml) and needs no page
  load, no button, and no code on MFL's site at all to function.
  Everything below is pure display, computed live from data any
  logged-in league member can already see, using their own MFL session
  — plus one small public status read from the Worker itself (see
  WORKER_STATUS_URL below), which needs no login/token of its own.

  WHAT IT SHOWS (visible to every franchise owner, not gated):
    - Your own current waiver position + when you last acquired a player
    - The full order, annotated with each team's last-acquired date
    - A consistency check: does the order on this page match what the
      bot would currently compute? (Catches "hasn't run yet" confusion
      without needing to check anything else at all.)
    - Recent league-wide acquisition activity
    - A couple of simple season stats (most active team, longest streak
      without a pickup)
    - A rough "next automatic check" estimate

  Commissioner-only section (see the franchise_id check below): a
  reminder to update MFL_LEAGUE_URL each new season, and the automation's
  actual last-run status (ok/fail, when, what happened) straight from
  the Cloudflare Worker. This needs action only a commissioner can take,
  so it's hidden from regular owners rather than cluttering the page.

  DESIGN NOTE — theme inheritance: different MFL leagues run different
  site skins with different colors. This widget deliberately does NOT
  hardcode any color — it reuses MFL's own semantic table classes
  (report / oddtablerow / eventablerow / reportnavigation, the same
  ones MFL uses for every report on the site) so it automatically
  matches whatever skin *your* league has active, with no per-league
  customization needed.

  HOW THE COMMISSIONER-ONLY CHECK WORKS, AND WHAT IT DOESN'T HIDE: MFL
  exposes a client-side `franchise_id` variable on every page. The
  commissioner-only block below only renders when franchise_id is
  "0000", the placeholder MFL uses for a commissioner acting without an
  owned franchise. If your commissioner account also owns a real
  franchise (a very common setup), your franchise_id will be that
  franchise's own ID instead (e.g. "0003") — check yours under Franchise
  Information and edit COMMISSIONER_FRANCHISE_ID below if "0000" never
  shows that section for you. Either way, this check only controls
  whether that section RENDERS for a given viewer — it does NOT hide the
  underlying HTML/JS itself; anyone who views page source can see this
  code. It contains no secrets (no username, password, token), so that's
  an acceptable amount of exposure — don't extend this snippet to hold
  anything sensitive.

  TO USE: paste this into a league Home Page Message (Commissioner Setup
  → Appearance Setup → Home Page Modules and Tabs Setup), marked as a
  Header or Footer message. Turn off "Advanced Editor" under Appearance
  Setup → Reports and Security Settings first, or MFL will mangle the
  raw HTML/script when you save it. Then edit the config block just
  below: your WORKER_STATUS_URL (your own deployed Worker's /status
  endpoint — only used for the commissioner-only "last run" line, and
  it's a public read with no token, so it's safe to leave visible in
  page source), your CHECK_INTERVAL_MINUTES (must match your Worker's
  Cron Trigger — this widget can't read that automatically), and
  COMMISSIONER_FRANCHISE_ID if needed.
-->
<div id="mfl-waiver-bot-widget"></div>

<script>
(function () {
  // ── Config — edit these three ──────────────────────────────────────
  var WORKER_STATUS_URL = 'https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/status'; // <-- REQUIRED: replace with your own Worker's URL (shown on your Worker's page in the Cloudflare dashboard once deployed)
  var CHECK_INTERVAL_MINUTES = 5;           // <-- edit to match your Worker's Cron Trigger
  var COMMISSIONER_FRANCHISE_ID = '0000';   // <-- edit if "0000" doesn't show the commissioner section for you
  // ─────────────────────────────────────────────────────────────────

  var root = document.getElementById('mfl-waiver-bot-widget');
  if (!root || typeof franchise_id === 'undefined') return;

  var ACQUIRED_TYPES = ['WAIVER', 'BBID_WAIVER', 'FREE_AGENT'];
  var myFid = String(franchise_id).padStart ? String(franchise_id).padStart(4, '0') : franchise_id;
  var isCommissioner = String(franchise_id) === String(COMMISSIONER_FRANCHISE_ID);

  // Reads the native "Waiver Wire Order" widget already rendered on
  // this page, rather than calling a commissioner-only endpoint — every
  // owner can already see this widget, so this just reads what's there.
  function readNativeOrder() {
    var all = Array.prototype.slice.call(document.querySelectorAll('*'));
    var header = all.find(function (el) {
      return /waiver wire order/i.test(el.textContent || '') && el.children.length < 5;
    });
    if (!header) return null;
    var container = header;
    for (var i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;
    var rows = Array.prototype.slice.call(container.querySelectorAll('tr')).filter(function (tr) {
      return /^\s*\d+\.?\s*$/.test((tr.children[0] && tr.children[0].textContent) || '');
    });
    return rows.map(function (tr) {
      return (tr.children[1] && tr.children[1].textContent || '').trim();
    }).filter(Boolean);
  }

  function fetchTransactions() {
    var url = window.location.origin + window.location.pathname.replace(/\/home\/.*$/, '') +
      '/export?TYPE=transactions&L=' + (typeof league_id !== 'undefined' ? league_id : '') +
      '&TRANS_TYPE=' + ACQUIRED_TYPES.join(',') + '&JSON=1';
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var list = data && data.transactions && data.transactions.transaction;
        if (!list) return [];
        return Array.isArray(list) ? list : [list];
      })
      .catch(function () { return []; });
  }

  // Franchise names are owner-controlled free text (anyone can rename
  // their own team to anything, including HTML), and the strings below
  // get assigned via innerHTML — escaped on principle so a mischievous
  // or careless team name can never break the widget or run script in
  // a fellow league member's browser.
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtAgo(ts) {
    if (!ts) return 'no record';
    var days = Math.floor((Date.now() / 1000 - ts) / 86400);
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    return days + ' days ago';
  }

  fetchTransactions().then(function (txs) {
    // Most-recent-acquisition timestamp per franchise, and a lightweight
    // per-franchise name lookup from the same records.
    var lastByFid = {};
    var nameByFid = {};
    txs.forEach(function (tx) {
      var fid = String(tx.franchise || '').padStart ? String(tx.franchise).padStart(4, '0') : tx.franchise;
      var ts = Number(tx.timestamp || 0);
      if (!fid || !ts) return;
      if (!lastByFid[fid] || ts > lastByFid[fid]) lastByFid[fid] = ts;
    });
    document.querySelectorAll('a[href*="F=00"]').forEach(function (a) {
      var m = a.getAttribute('href').match(/F=(\d{4})/);
      if (m && a.textContent.trim()) nameByFid[m[1]] = nameByFid[m[1]] || a.textContent.trim();
    });

    var nativeOrderNames = readNativeOrder();

    var html = '';

    // My own position — personalized, shown to every viewer.
    var myLast = lastByFid[myFid];
    html += '<table class="report"><caption>Waiver Bot</caption><tbody>';
    html += '<tr class="oddtablerow"><td>Your last acquisition</td><td>' + fmtAgo(myLast) + '</td></tr>';

    // Recent league-wide activity (last 5).
    var recent = txs.filter(function (t) { return t.timestamp; })
      .sort(function (a, b) { return b.timestamp - a.timestamp; })
      .slice(0, 5);
    if (recent.length) {
      html += '<tr class="eventablerow"><td colspan="2"><span class="reportnavigationheader">Recent activity</span></td></tr>';
      recent.forEach(function (t, i) {
        var fid = String(t.franchise || '').padStart ? String(t.franchise).padStart(4, '0') : t.franchise;
        var name = nameByFid[fid] || ('Franchise ' + fid);
        var row = i % 2 === 0 ? 'oddtablerow' : 'eventablerow';
        html += '<tr class="' + row + '"><td>' + escapeHtml(name) + '</td><td>' + fmtAgo(t.timestamp) + '</td></tr>';
      });
    }

    // Simple season stats: most-active team, longest current streak
    // without a pickup (among franchises that have ever acquired).
    var fids = Object.keys(lastByFid);
    if (fids.length) {
      var counts = {};
      txs.forEach(function (t) {
        var fid = String(t.franchise || '').padStart ? String(t.franchise).padStart(4, '0') : t.franchise;
        if (fid) counts[fid] = (counts[fid] || 0) + 1;
      });
      var mostActiveFid = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      var longestQuietFid = fids.sort(function (a, b) { return lastByFid[a] - lastByFid[b]; })[0];
      html += '<tr class="oddtablerow"><td>Most active team</td><td>' +
        escapeHtml(nameByFid[mostActiveFid] || mostActiveFid) + ' (' + counts[mostActiveFid] + ' pickups)</td></tr>';
      html += '<tr class="eventablerow"><td>Longest without a pickup</td><td>' +
        escapeHtml(nameByFid[longestQuietFid] || longestQuietFid) + ' — ' + fmtAgo(lastByFid[longestQuietFid]) + '</td></tr>';
    }

    // Consistency check: does the order actually shown on this page
    // match what the bot would compute right now from this same
    // transaction data? Uses the same ascending-by-recency logic as the
    // Worker itself (worker.js, inside runPipeline()).
    if (nativeOrderNames && nativeOrderNames.length) {
      var byName = {};
      Object.keys(nameByFid).forEach(function (fid) { byName[nameByFid[fid]] = fid; });
      var ordered = nativeOrderNames.slice().sort(function (a, b) {
        var fa = byName[a], fb = byName[b];
        return (lastByFid[fa] || 0) - (lastByFid[fb] || 0);
      });
      var matches = ordered.every(function (name, i) { return name === nativeOrderNames[i]; });
      html += '<tr class="oddtablerow"><td colspan="2">' +
        (matches
          ? '&#10003; Order above matches what the bot currently computes.'
          : 'Order above doesn\'t match the bot\'s current computation yet — next check in up to ' +
            CHECK_INTERVAL_MINUTES + ' min.') +
        '</td></tr>';
    }

    html += '<tr class="eventablerow"><td colspan="2"><span class="reportnavigation">Auto-checks every ~' +
      CHECK_INTERVAL_MINUTES + ' min via Cloudflare Worker — this widget is just a display, not a control.</span></td></tr>';

    // ── Commissioner-only section ──────────────────────────────────
    if (isCommissioner) {
      var month = new Date().getMonth() + 1;
      var seasonNote = (month >= 2 && month <= 7)
        ? ' New season coming — once you transfer this league forward, double-check MFL_LEAGUE_URL (README, &ldquo;Each new NFL season&rdquo;).'
        : '';
      html += '<tr class="oddtablerow"><td colspan="2"><span class="reportnavigationheader">Commissioner</span>' + seasonNote + '</td></tr>';
      html += '<tr id="mfl-waiver-bot-cfstatus" class="eventablerow"><td colspan="2">Checking last run status&hellip;</td></tr>';
      fetch(WORKER_STATUS_URL)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          var cell = document.querySelector('#mfl-waiver-bot-cfstatus td');
          if (!cell) return;
          if (!data || data.ok === null) { cell.textContent = 'No run recorded yet, or status unavailable.'; return; }
          var when = data.ranAt ? new Date(data.ranAt).toLocaleString() : 'unknown time';
          if (data.ok === false) {
            cell.textContent = '⚠ Last run FAILED at ' + when + ': ' + (data.error || 'unknown error') + '.';
          } else {
            cell.textContent = 'Last run: ' + (data.action || 'ok') + ' at ' + when +
              (typeof data.changed === 'boolean' ? (data.changed ? ' (order changed).' : ' (no change needed).') : '.');
          }
        })
        .catch(function () {
          var cell = document.querySelector('#mfl-waiver-bot-cfstatus td');
          if (cell) cell.textContent = 'Status unavailable (Worker offline or unreachable).';
        });
    }

    html += '</tbody></table>';
    root.innerHTML = html;
  });
})();
</script>
```

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

**How it works**: `GET /claim-status-slot?token=...` (open that URL
directly in your browser, same as Quick Start step 8) finds an empty
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

This project's own source lives on GitHub. In the Quick Start flow
above, GitHub plays two roles: a one-time copy of the code (**Use this
template**) and, once connected to Cloudflare, the actual source of
truth Cloudflare redeploys from on every commit — not merely incidental
hosting. The automation *itself* still only ever talks to MFL and
Cloudflare at runtime; GitHub is part of how the code gets there and
stays configured, not part of what runs every 5 minutes.

If you'd rather not touch GitHub at all, even just to hold a copy of
the code: Cloudflare's dashboard also lets you paste a Worker's code in
directly (Create a Worker → Start with Hello World! → its built-in code
editor) and configure everything else (secrets, the KV binding, the
Cron Trigger) through the same dashboard forms as Quick Start steps
4–7 — no GitHub account needed at all. This isn't written up as a full
step-by-step above since it means re-pasting the code by hand for any
future update instead of it just being there in your own repo, but it
works. Open an issue if you'd like this turned into a fully documented
alternate path.
