# MyFantasyLeague.com Continuously-Updating Season-long Rolling Waiver Priority

Keep a MyFantasyLeague.com (MFL) league's **Custom Waiver Order** on
one continuously-updating rolling priority list, driven by two
specific acquisition types MFL tracks separately:

- **First-Come-First-Served free agency** (instant free agent adds)
- **Waiver free agency** (scheduled-priority claims)

**Why is this needed?**

By default, MFL tracks these two kinds of free-agent pickups
separately and has no built-in way to combine them into one fair,
unified line. Plenty of leagues want that combination, though — it
means every pickup, whichever way it's made, actually costs an owner
something. Without it, an owner can sit on the #1 waiver spot all
season "saving" it for one big name, while freely grabbing everyone
else they want through FCFS in the meantime — which usually isn't
what a league actually intends its waiver system to allow.

This bot doesn't care which of the two types someone used — within a
few minutes (by default) of *any* team picking up a player either way,
that team drops to the bottom of the priority list. Whichever team
has gone longest without a free-agent add (or has never made one)
sits at the top. (MFL tracks other transaction types too — trades, IR
moves, taxi squad, auctions — none of those affect waiver priority,
and this bot ignores them entirely.)

This automation runs entirely on a **Cloudflare Worker** — no server,
no local machine, nothing that depends on your computer being on, and
no headless browser: plain HTTP requests, so each check is
millisecond-fast rather than the ~20-25 seconds a real browser needs.

## Quick start (written for a first-time commissioner — no coding experience assumed)

This whole setup happens entirely in your regular web browser, across
three places: your league on MFL's own site (a few settings), GitHub
(holding your own copy of the code, plus one small required text
edit), and Cloudflare's dashboard (where the automation actually
runs). **No installing anything, no command line/terminal, no
coding.** Every step below is clicking a button or filling in a text
box.

Expect first-time setup to take 20–30 minutes. None of this costs
anything or needs a credit card — Cloudflare's free tier is more than
enough for this, and MFL/GitHub are both already free.

### Part 1 — required (the core automation)

**Step 1 — MFL settings.** Log into MFL as commissioner, open your
league, then go to **Commissioner Setup** *(top navigation menu —
only visible to commissioners)* → *"ADD/DROP AND WAIVERS SETUP"*.

- First, on **Add/Drop Setup**: find **"What Type Of Add/Drop System
  Does Your League Use?"** and make sure it's set to **"Waiver
  Requests For Locked Players, First Come/First Serve For Rest"** —
  MFL's own name for the exact FCFS-plus-Waiver combination this bot
  exists to manage. If your league runs a different system entirely
  (pure FCFS with no waivers at all, Blind Bid/FAAB, etc.), this bot's
  whole premise doesn't apply to you — there'd be nothing for it to
  combine.
- Then go to **Waiver Request Setup** and find **"Waiver Request Sort
  Order"** — select either **"Same"** or **"Reverse"** (both work
  fine — pick either). What matters is that it's *not* left on
  **"Weekly Rolling"** or **"Season-long Rolling"**, which have MFL
  recalculate the order itself and will eventually overwrite whatever
  this bot sets.
- Just below that, set all six **"Waiver Sort Criteria"** dropdowns to
  **"None."** MFL's own label text says "Same"/"Reverse" still use
  "the criteria below" — leaving any of the six on a real criterion
  lets MFL override the order just as surely as Weekly/Season-long
  Rolling would.
- Click **Save** on each page as you go.

(The automation checks all of this itself on every run and logs a
clear warning if anything's still off — but it doesn't refuse to run
over it, for two different reasons. First: every run reads your
league's real transaction history fresh, from scratch, every single
time — there's no memory of past runs to get "stuck" or drift out of
sync, so a run with a setting still wrong just produces an order that
may not mean what you'd expect, never a broken one. Second: maybe
you've set something up that way on purpose, for a reason of your
own — this bot would rather warn you clearly and let you decide than
assume it knows better and stop you. See "Every MFL setting this bot
cares about" below for the complete list, including the one setting
that's a hard stop instead of a warning.)

**Required: set your starting order.** Go to **Custom Waiver Order
Setup** (`csetup?L={your league ID}&C=WAIVORD`) and enter the order
you want your league to start with — this is worth a real decision,
not a rubber stamp: waiver spot #1 is meaningfully more valuable than
spot #12, so whoever's sitting there when this goes live gets a real
head start. A common, fair default if you don't already have a
preference: reverse of your actual draft order. This is a manual,
one-time step for now — a fully automatic option (computed straight
from your real draft results) is a real, researched candidate for a
future version; see `docs/CONFIGURABLE_SETTINGS_IDEAS.md` if you're
curious. Once you've set it, the bot takes over completely from your
league's real activity going forward.

**Step 2 — get your own copy of the code.** GitHub projects like this
one can serve as a "template" — think of it as a master copy you can
stamp your own personal copy out of, without touching the original or
needing anyone's permission to do it. Above the file list at the top
of this page, click the green **Use this template** button, then
**Create a new repository**. Give your copy any name you like. Leave
it set to **Private** — the simpler default, nothing to think about.
(If you'd rather make it **Public** instead, that's completely safe
too: no secrets or anything personal ever live in this repo, and
"public" only means other people could look at the code if they
wanted to — it never lets anyone else touch, edit, or affect your
copy in any way. Either choice works identically for everything
below.) Then click **Create repository**. GitHub
takes you straight to your brand-new copy — that's the one you'll
actually work with for everything below. You're not downloading or
installing anything here; the next few steps just edit and connect
this copy directly, through GitHub's and Cloudflare's own websites.

**Step 3 — point the code at your league.** You're already on this
repository's GitHub page, so do this now before switching anywhere
else: click `wrangler.toml`, then click the pencil (✏️) icon in the
top right to edit it. Change one line:
- `MFL_LEAGUE_URL = "..."` — replace the URL with any URL from your own
  league (your league homepage's address bar is the easiest place to
  copy one from).

Scroll down, leave it set to commit directly to your repository's
default branch (already selected), click **Commit changes**.

**Step 4 — create a free Cloudflare account.** If you don't already
have one: go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up),
enter an email and password, verify your email. No credit card needed
for anything in this guide.

**Step 5 — connect it to Cloudflare and deploy.** In the Cloudflare
dashboard: **Compute (Workers)** → **Workers & Pages** → **Create** →
**Create a Worker** → **Continue with GitHub**. The first time, GitHub
asks you to approve Cloudflare's access — approve it for the repository
you created in step 2 (or all repositories, your choice). Select your
repository, then click **Save and Deploy**.

This kicks off a real (short) build — Cloudflare fetches your repo,
sets up its storage automatically, and deploys it all, which takes
roughly a minute, not instant. When it finishes, you'll see a URL that
looks like `https://mfl-waiver-order.YOUR-SUBDOMAIN.workers.dev` (the
first part comes from `name` in `wrangler.toml`, not your repository's
name) — that's your automation's own address. Save it; you'll need it
below.

**Step 6 — set your secrets.** This one has to come after step 5, not
before — there's nowhere to add secrets to a Worker that doesn't exist
yet. Still on your Worker's page in Cloudflare: **Settings** →
**Variables and Secrets** → **Add variable**, three times, marking
each one **Secret**:

| Name | Value |
|---|---|
| `MFL_USERNAME` | your real MFL commissioner login |
| `MFL_PASSWORD` | your real MFL commissioner password |
| `DIAG_TOKEN` | any random text you make up right now (mash the keyboard) — write it down |

Why `DIAG_TOKEN` exists at all: your Worker's address is public —
anyone who finds or guesses it could type it into their own browser.
Two of the things this bot responds to (`/run` and
`/claim-status-slot`) can make a *real* change to your league, and
even the read-only diagnostic one still logs into MFL for real, using
your actual credentials. `DIAG_TOKEN` is the one thing standing
between "only you can trigger these" and "anyone on the internet can."
It isn't an MFL credential itself — just a password you make up
yourself, right now, that only you ever need to know. Click **Deploy**
at the bottom to apply.

Forgot it later? Cloudflare secrets can't be read back once set, only
replaced — there's no "recover my token" option. Just add it again
with a new value; nothing else needs to change, and the automatic
schedule (which needs no token at all) isn't affected either way.

Want full manual control instead of checking automatically every 5
minutes? That's already possible, no extra setup needed: set
`wrangler.toml`'s `crons` line to an empty list (`crons = []`, same
edit as step 3) and nothing runs on its own at all — you'd trigger a
real check yourself, any time you like, by visiting
`/run?dry_run=false&token=YOUR_DIAG_TOKEN` in your browser whenever
you want one. Most commissioners won't want this, since it means
remembering to actually go do it, but it's there if you'd rather have
full control than convenience.

**Step 7 — check that it's actually working.** The easiest check
needs nothing pasted in at all: visit
`https://YOUR-WORKER-URL/status` (your Worker's own URL from step 5,
no token needed) any time after its first automatic check has run —
up to 15 minutes after you deployed in step 5 (see "What actually
turns this on" below). You should see `"ok":true` and a real, computed
order, not an error.

Don't want to wait that long? You can trigger a real check yourself
right now instead. Paste this into your browser's address bar,
replacing both placeholders with your Worker's URL from step 5 and the
`DIAG_TOKEN` you made up in step 6, and press Enter:

```
https://YOUR-WORKER-URL/run?dry_run=true&token=YOUR_DIAG_TOKEN
```

Either way, you should see a block of JSON with your real team names
and a computed order, and no `error`. If you do see an error, re-check
steps 3, 5, and 6 first (a wrong secret or a wrong league URL are the
most common causes; see `docs/DEVELOPMENT_NOTES.md` if storage itself
seems to be the problem).

**Done.** Nothing else to turn on — the schedule already started the
moment your Worker deployed in step 5; the first real check happens
within 5 minutes (up to ~15 minutes the very first time, while the
schedule finishes activating on Cloudflare's end). Check your league
homepage's Waiver Wire Order widget afterward to confirm.

*Prefer the command line?* Nothing above is required to be done that
way, but `wrangler.toml` is fully compatible with Cloudflare's own
`wrangler` CLI exactly as documented in their docs (`wrangler login`,
`wrangler deploy`, `wrangler secret put`) if you'd rather work that
way — see `docs/DEVELOPMENT_NOTES.md`.

**That's it — the core automation is fully live at this point.** There
were previously two optional homepage-display add-ons documented here
(a status widget and an ambient status message); both are deliberately
tabled for now to keep this guide focused on getting the core bot
tested and running. See `docs/FUTURE_WORK.md` if you're curious what
they were or want to help decide their direction.

### What actually turns this on

You don't have to flip anything on separately — the schedule set in
`wrangler.toml`'s `[triggers]` block starts running the moment your
Worker successfully deploys in step 5. There's no extra "activate"
switch hiding anywhere. One thing worth knowing so you don't worry for
nothing: a brand-new or just-changed schedule can take up to ~15
minutes to actually start firing across Cloudflare's network, so don't
be alarmed if the very first check doesn't happen the instant you
deploy — give it a few minutes.

### If it goes quiet for a while

Good news here: nothing piles up, and nothing gets "out of sync."
Every single run reads your league's real, current state fresh — the
current order plus the full transaction history — and recomputes from
scratch every time. So if a run fails, or you change a league setting
by hand in the meantime, there's nothing left to clean up afterward;
the next successful run just picks up from wherever things actually
stand right now.

Want to check on it yourself? Visit `GET /status` on your own Worker's
URL any time (no token needed) and it'll show you the last run's
outcome. And if something does actually break, you won't need to go
looking for it — a real failure automatically posts to your league's
Message Board and emails you directly, both through
MFL's own official tools, not some third-party service you'd have to
sign up for separately. It only sends that alert once per new
failure, too, so one ongoing problem won't spam you every 5 minutes.

### Every MFL setting this bot cares about, in one place

This bot never changes an MFL *setting* on your behalf — only the
actual waiver order data itself. Every setting below is something you
set once yourself, in Step 1; this table just makes clear what's
checked automatically afterward, and what happens if something
drifts, so nothing here is a surprise later.

| Setting | Where | Bot checks it | If it's wrong |
|---|---|---|---|
| Add/Drop System | `csetup?C=ADDDROP` | Every run (indirectly, via `currentWaiverType`) | Warns, still runs |
| Waiver Request Sort Order | `csetup?C=WAIVREQ` | Every run | Warns, still runs |
| Waiver Sort Criteria (×6) | `csetup?C=WAIVREQ` | Every run | Warns, still runs |
| Starting order | `csetup?C=WAIVORD` | Never (nothing to check — any value is a valid starting point) | N/A |

All of these are checked on *every single run*, before it does
anything else. If any of them have drifted, the run logs a clear,
unmissable warning explaining that MFL might quietly override
whatever this bot sets — but it still goes ahead and runs anyway,
rather than refusing outright, in case you changed something on
purpose for a reason of your own.

## Each new NFL season

Every year, MFL has you transfer your league forward into the new
season. The host and league ID stay exactly the same — only the year
changes. When you do that transfer, just edit `MFL_LEAGUE_URL` in
`wrangler.toml` the same way you did in Quick Start step 3 — right
there on GitHub, in your browser — and commit the change. Cloudflare
picks it up and redeploys automatically within a minute or two;
there's no separate "deploy" step to remember.

(A previous version of this bot actually figured a season rollover
out on its own, probing forward each run to detect it. That hasn't
been rebuilt yet, so for now this one edit is on you, once a year.
Worth automating properly if it turns out to be more of a hassle in
practice than it sounds.)

## Schedule

This checks your league **every 5 minutes**. MFL doesn't offer any
kind of push notification for transactions (confirmed — there's
genuinely no better option available), so polling is the only way to
do this either way, and Cloudflare's free tier makes frequent checks
effectively free — there's no cost reason to check any less often.
Most of those checks won't actually change anything, either: a
submission only happens when the computed order is genuinely
different from what's already there, so an unchanged check is fast
and cheap, milliseconds start to finish.

Want it checking more or less often? Edit the `crons` line in
`wrangler.toml`'s `[triggers]` block the same way you edited it in
Quick Start step 3 — on GitHub, in your browser — using a standard
5-field cron expression, like `*/5 * * * *` for every 5 minutes or
`*/15 * * * *` for every 15. Commit the change and Cloudflare
redeploys automatically. See
[Cloudflare's cron syntax reference](https://developers.cloudflare.com/workers/configuration/cron-triggers/#supported-cron-expressions)
if you want the exact format rules.

One thing worth knowing: Cloudflare's dashboard also has its own Cron
Trigger editor (your Worker's Settings → Trigger events), and it's
tempting to just use that instead. Don't — since your Worker stays
connected to your GitHub repo, `wrangler.toml` is what actually
controls this long-term. The next time anything triggers a redeploy,
it'll quietly overwrite a dashboard-only change back to whatever the
file says. Always make this edit in `wrangler.toml` itself, and
nothing will get reverted on you by surprise.

Prefer to trigger checks yourself instead of on any automatic
schedule at all? Set `crons = []` the same way and nothing runs on its
own — see Quick Start step 6 for how to trigger a real check manually
whenever you want one.

## Why plain HTTP works now (it didn't used to)

Curious why this works at all, given how finicky this kind of thing
usually is? Here's the short version. An earlier attempt at this ran
as a Cloudflare Worker doing plain `fetch()` calls, and it reliably
got served a stripped-down, logged-out-looking page from MFL — even
using a cookie string captured directly from a real, working browser
session, which ruled out "wrong cookie" as the culprit at the time.
The real cause, found later: MFL treats "logged in" and "acting as
commissioner for this league" as two genuinely different session
states. A league-scoped "Become Commissioner" step
(`logout?L={league}&BECOME=0000`, despite what the URL says) is
required even for an account that already *is* the commissioner. The
original attempt never did this step, simply because nobody knew it
was necessary yet. Once that one step is included, a plain `fetch()`
pipeline — login, become commissioner, read, write — works exactly as
well as a real browser, just without the ~20-second browser startup
and navigation overhead every single time. Confirmed live, end to
end, including a real write, before this became the production path.

## How the write itself works

MFL doesn't offer any public API for setting the waiver order, so
this automation uses the exact same commissioner-only web form a
person would click through by hand (`csetup?L={league}&C=WAIVORD`).
It reads that form's hidden fields fresh on every single run
(`input_expires`, `WAIVER_ORDER_LEAGUE_1..N`, and a few others), then
submits the reordered list straight back. Nothing gets clicked or
dragged anywhere — MFL is happy to accept a direct form submission
once the session is authenticated as commissioner, exactly as if a
person had filled it in themselves.

## Reading the acquired-transaction data — and the current order itself

Transaction history comes from MFL's own documented
`export?TYPE=transactions&JSON=1` API (filtered to
`TRANS_TYPE=WAIVER,BBID_WAIVER,FREE_AGENT`) — real, structured,
official data, not anything scraped off a rendered page. Franchise
names and the current order get checked the same honest way, against
`export?TYPE=league&JSON=1` (also public, also structured JSON) —
independent of the one HTML page (`WAIVORD`) that has no API
equivalent at all and genuinely has to be read directly, just for its
one-time-use `input_expires` token. If those two sources ever
disagree with each other, that's treated as a hard stop rather than
quietly trusting either one — and whenever HTML does need to be read,
it's done with Cloudflare's own `HTMLRewriter` (a real streaming,
CSS-selector-based parser), not hand-rolled regex, specifically so it
stays resilient if MFL ever changes its markup.

## Files

- `worker.js` — the automation itself, running on Cloudflare Workers.
- `wrangler.toml` — Worker config: Cron Trigger, KV namespace binding,
  league config.
- `home-page-status-snippet.html` — optional homepage widget, currently
  tabled; see `docs/FUTURE_WORK.md`.
- `docs/` — deeper reference material for anyone (human or AI)
  extending this project; see "For developers" below.
- `LICENSE` — MIT.

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
editor) and configure secrets and the Cron Trigger through the same
dashboard forms the main flow uses in step 6 and the Schedule section
— no GitHub account needed at all. One real difference from the main
flow: this path's automatic storage provisioning (step 5 above) is
tied specifically to deploying `wrangler.toml` through Cloudflare's
build system, so it doesn't apply here — you'd create the KV
namespace yourself first, the same manual way the main flow used to,
under **Storage & Databases → Workers KV → Create Instance**, then add
its binding (`STATUS_KV`) under the Worker's own Settings → Bindings.
This isn't written up as a full step-by-step above since it means
re-pasting the code by hand for any future update instead of it just
being there in your own repo, but it works. Open an issue if you'd
like this turned into a fully documented alternate path.
