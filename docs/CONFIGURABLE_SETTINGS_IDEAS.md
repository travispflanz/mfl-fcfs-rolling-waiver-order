# Candidate Configurable Settings

A brainstorm, not a decision list — every idea below is a candidate for
a future polished version where commissioners can tune behavior
without editing code. None of these are built. For each: what it does,
why a commissioner might actually want it, roughly how it'd work from
their side, and what additional work it would take (kept high-level on
purpose — this is a catalog to react to, not a spec to build from yet).

Grouped by theme. 16 ideas, more than the "at least 8" asked for,
because once framed as "what would a commissioner reasonably want to
control," more kept surfacing than expected.

## A. Timing & processing cadence

### 1. Configurable processing window (your own example)

**What**: instead of reordering the instant a transaction happens
(current behavior — checks every 5 minutes, acts immediately when
something changed), let a commissioner choose a **scheduled batch
mode** instead — e.g. "only actually process/update once a week, at a
specific day and time" (your example: 1am Tuesday, right after Monday
Night Football ends, mirroring when the commissioner would otherwise
manually run waivers at noon Tuesday).

**Why**: not every league wants instant reordering. Some leagues run
waivers as a weekly ritual and would rather the bot mirror that rhythm
than react in real time.

**How it'd work**: a setting like "Processing mode: Instant / Weekly
batch," and if weekly, a day-of-week + time picker (or just a config
value like `TUESDAY 01:00 America/Chicago`).

**What it'd take**: the Cron Trigger can keep firing every 5 minutes
(cheap, no downside) — the code would just check "is now inside the
configured processing window?" before actually submitting, the same
shape as this project's own retired "only run at 2am Central" guard
from an earlier design. Needs: a config var for the schedule, a
day/time parser, and timezone handling (see #10 — same underlying
question of "whose clock are we using").

### 2. Configurable ambient-status refresh interval

**What**: the homepage status box currently refreshes once an hour,
hardcoded. Could be a setting instead.

**Why**: some commissioners might want it near-real-time; others might
prefer it barely ever changes so it doesn't look "twitchy."

**What it'd take**: trivial — the interval is already an isolated
constant (`STATUS_SLOT_REFRESH_INTERVAL_MS`); just needs to read from
config instead of being fixed.

## B. Waiver logic itself

### 3. Configurable acquired-transaction types

**What**: which transaction types count toward reordering. Currently
hardcoded to `WAIVER, BBID_WAIVER, FREE_AGENT`.

**Why**: some leagues might want trades to also affect waiver position;
others might want to exclude one of the three (e.g. FCFS-only leagues
that don't use traditional waivers at all).

**What it'd take**: a config var (comma-separated list), validated
against MFL's documented transaction types.

### 4. Configurable tie-breaking rule

**What**: when multiple franchises have identical "last acquired"
status (commonly: nobody's acquired anything yet, preseason), current
behavior keeps them in their existing relative order (stable sort).
Could offer alternatives (alphabetical, random-but-fixed-once, etc.).

**Why**: mostly a preseason/edge-case concern, but a real one — several
franchises are tied at "no activity" for a while every season.

**What it'd take**: small — an alternate comparator function, selected
by config.

### 5. Configurable order direction

**What**: currently, most-recently-active goes to the **bottom**
(worst priority) — standard "reward patience" FCFS convention. A
config could flip this so recent activity goes to the top instead.

**Why**: unusual, but some leagues might define their convention the
opposite way. Low priority — flagging for completeness more than
expecting real demand.

**What it'd take**: trivial, a single sort-direction flag.

### 6. Auto-computed starting order (draft-based) instead of manual MFL entry

**What**: right now, giving the league a deliberate starting order
(reverse draft order, same as draft order, random, etc. — see README's
Quick Start) means the commissioner manually typing that order into
MFL's Custom Waiver Order Setup themselves, once, before going live.
This would let the Worker do it instead: a one-time (or on-demand)
`INITIAL_ORDER_STRATEGY` setting (`reverse_draft` / `same_as_draft` /
`random` / `leave_as_is`), computed automatically and submitted
through the exact same WAIVORD write path the bot already uses every
5 minutes.

**Why**: this genuinely matters, not a nice-to-have — waiver spot #1 is
a real, meaningful competitive advantage over spot #12 from day one,
whether or not that's what the commissioner intended. Manual entry
into MFL works, but it means correctly reconstructing your own draft
order by hand and typing 10-14 franchise names in the right sequence
without a mistake — exactly the kind of fiddly, error-prone step this
whole project exists to remove elsewhere.

**What it'd take**: moderate — confirmed live that MFL's
`export?TYPE=draftResults` is a real, officially documented endpoint
(league-owner auth required, same access level the Worker already has
for everything else). Draft-based strategies read that export once,
compute the target order (reverse or same), and submit it through the
same POST `runPipeline()`'s write path already builds. "Random" needs
no new data at all — a one-time shuffle. Needs a decision on *when*
this runs: automatically on first successful deploy only, or as a
deliberate one-time endpoint the commissioner triggers themselves
(closer in spirit to `/claim-status-slot` than to the automatic
schedule) — the latter is probably safer, since a first-deploy-only
trigger has no clean way to be re-run if something about it goes
wrong.

## C. Notifications & communication

### 7. Notify the league on every order change, not just failures

**What**: currently, the Message Board / email alerting only fires on
a *failure*. This would add an optional, separate notification
whenever the order actually *changes* — "waiver order updated: X is
now at the top."

**Why**: some leagues would enjoy the visibility/engagement; others
would find it noisy. Clearly opt-in.

**What it'd take**: moderate — reuses the existing `messageBoard`/
`emailMessage` machinery, but needs its own on/off setting and its own
message template, separate from the failure-alert path.

### 8. Toggle which alert channels are active

**What**: independently turn Message Board posting and commissioner
email on/off (currently both always fire together on a failure).

**Why**: some commissioners might find a message-board post sufficient
and not want an email for every hiccup, or vice versa.

**What it'd take**: small — two booleans gating the two already-
separate code paths in `sendFailureAlert()`.

### 9. Customizable alert/status message text

**What**: let a commissioner set their own caption/wording for the
ambient status box and/or the alert messages, instead of the fixed
"Waiver Bot Status" / "MFL Waiver Bot — automation failure" text.

**Why**: branding/tone — some leagues have a whole in-league personality
(nicknames, running jokes) and might want the bot to match it.

**What it'd take**: small — template strings become config-driven
instead of hardcoded, in `buildStatusSlotContent()` and
`sendFailureAlert()`.

### 10. Display timezone for timestamps

**What**: timestamps shown in alerts and the status box currently use
the Worker runtime's default rendering (effectively UTC-ish), not the
league's own local time. A league full of Central-time owners seeing
"3:12 AM" with no timezone label is genuinely ambiguous.

**Why**: real clarity issue, not cosmetic — directly relevant to #1
above too (a "process at 1am Tuesday" setting needs to know *whose*
1am).

**What it'd take**: moderate — a timezone config value (IANA name,
e.g. `America/Chicago`) threaded through every place a timestamp is
formatted, using `Intl.DateTimeFormat` with an explicit `timeZone`
option instead of the current bare `toLocaleString()`.

## D. Safety & onboarding

### 11. "Shadow mode" — scheduled runs behave as dry runs

**What**: a global switch that makes even the *automatic* scheduled
runs compute-and-log only, never actually submit — effectively running
`/diag` on a schedule instead of `/run`. Distinct from the existing
per-request `dry_run` flag, which only affects manual calls.

**Why**: lets a new commissioner watch the bot "decide" for a real
stretch of time (a few weeks, through real transactions) before
trusting it to actually change anything — much lower-stakes onboarding
than "flip it on and hope."

**What it'd take**: small — one config flag read at the top of
`scheduled()`, passed through to `runPipeline()`'s existing `dryRun`
parameter.

### 12. Auto-graduate out of shadow mode after N clean runs

**What**: a companion to #11 — automatically flip shadow mode off
after some number of consecutive successful dry runs, instead of
requiring the commissioner to remember to come back and turn it off
themselves.

**Why**: reduces the "set it up, forget to finish setup, wonder why
it's not really running" failure mode.

**What it'd take**: moderate — needs a counter in KV, incremented on
each clean shadow-mode run, and a threshold config value.

## E. Ambient status feature itself

### 13. Make the ambient status feature fully optional via a single setting

**What**: right now, the ambient-status feature is present in the code
either way — it's the *manual placement step* that makes it truly
opt-in in practice. A polished version might have an explicit setting
(`ENABLE_AMBIENT_STATUS=true/false`) so it's a deliberate choice rather
than "build it and don't place it if you don't want it."

**Why**: clearer, more discoverable opt-in than "just don't do the
manual step" — especially relevant if #11/#12 make onboarding more
automatic and this needs to be part of that same first-run experience.

**What it'd take**: small — a single guard around the
`claimOrRefreshStatusSlotSafely()` call in `scheduled()`.

### 14. Let a commissioner pin a specific slot number instead of auto-discovery

**What**: if a commissioner already knows they want to use, say, slot
#15 specifically (maybe they've already manually placed it and don't
want the bot's own discovery logic to potentially pick a different
one later), let them specify it directly instead of relying on
auto-discovery.

**Why**: gives an experienced commissioner direct control, and sidesteps
any edge case in the auto-discovery logic entirely for someone who'd
rather just say "use #15."

**What it'd take**: small — an optional config var that, if set, skips
`findEmptyMessageSlot()` and uses that number directly (still runs the
ownership-marker check before overwriting anything).

## F. League-settings compatibility strictness

### 15. Strict mode for the WAIVREQ settings check

**What**: currently, if `WAIVER_ORDER`/Sort Criteria aren't compatible,
the run logs a warning and proceeds anyway. A "strict mode" setting
could make this a hard stop instead — refuse to run (and alert) until
the commissioner fixes the settings, rather than quietly continuing
with something that might get overridden.

**Why**: some commissioners would rather know immediately and loudly
than have the bot "work around" a misconfiguration indefinitely.

**What it'd take**: small — change the existing warning path to
optionally `throw` instead, gated by config.

### 16. Strict mode for the `currentWaiverType` (FCFS) check

**What**: same idea as #15, applied to the "is this league actually
FCFS?" check — currently warn-only, could be configurable to hard-stop.

**Why**: this bot's entire design assumes FCFS; a commissioner
installing it on a non-FCFS league by mistake might prefer a hard
refusal over a working-but-meaningless order.

**What it'd take**: trivial — same pattern as #15, applied to the other
existing warning.

---

## If you want to prioritize

Purely a read of "value vs. effort" from the descriptions above, not a
recommendation to build any of it now: **#1 (processing window)** is
clearly the flagship idea — it's the one you came in with, it's high
value, and it's a moderate, well-scoped lift. **#6 (auto-computed
starting order)** is the other standout — it directly replaces a real,
error-prone manual step with something the Worker already has all the
pieces to do itself. **#10 (timezone)** is small effort and quietly
important since #1 depends on it making sense. **#11 (shadow mode)**
and **#7/#8 (notification toggles)** are each small, standalone, and
reasonable next additions whenever a "v2 settings" pass happens. The
rest are lower urgency, listed for completeness.

See `FUTURE_WORK.md` for items already explicitly decided/tabled — this
file is upstream of that one: ideas that haven't been decided on yet at
all.
