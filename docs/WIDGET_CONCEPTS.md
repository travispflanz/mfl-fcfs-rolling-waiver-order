# The "super-widget" — concept catalog

This is a reference of every idea developed for the optional MFL homepage
widget, with the technical mechanism behind each one. It's deliberately
**not** tied to any specific hosting platform for the backend automation
— everything below refers to "the automation" / "the backend" generically,
because none of these ideas depend on which platform runs it. Swap in
whatever's actually true for your deployment.

The current shipped widget covers a fraction of this list (a status
indicator + last-run timestamp). That's the floor, not the ceiling — this
doc is the rest of it.

## Design philosophy

Two organizing ideas drove everything here:

1. **It's for the whole league, not just the commissioner.** Most of
   what's useful (your own position, recent activity, season stats)
   is interesting to every franchise owner. Only a couple of things
   (season-rollover config reminders, raw automation health) are
   commissioner-specific, so those get gated off rather than shown to
   everyone or left out entirely.
2. **Split ideas into "needs nothing new" vs. "needs a small backend."**
   A homepage widget is static HTML/JS running in each visitor's
   browser — it has no server of its own. That's a hard line: some
   ideas are pure display computed from data the visitor's own MFL
   session can already read, and some require a live control channel
   to the automation, which means a small backend component has to
   exist somewhere. Keeping that distinction explicit avoids both
   overpromising and underbuilding.

## Tier 1 — zero new infrastructure (pure client-side)

Every idea in this tier works today, needs no backend beyond the
automation itself, and uses only two data sources: MFL's own session
(the widget runs on an MFL page, so it inherits whatever franchise the
visitor is logged in as) and MFL's own transaction history API.

### 1. Personalized position callout
"You're currently **#4** in waiver priority. Last acquisition: 6 days
ago." Every visitor has their own `franchise_id` exposed by MFL as a
page-level JS variable — no extra permission needed to know who's
looking at the page, so personalizing the message per-viewer is nearly
free.

### 2. Order annotated with *why*, not just the list
MFL's native waiver-order display is a bare numbered list. This shows
the same order but with each team's last-acquired date next to their
name — the actual reasoning behind the order, which the native widget
doesn't surface at all.

### 3. Consistency check
Recompute the ranking client-side from the same transaction data the
automation itself uses, and compare it to what the page is currently
showing. If they differ, say so plainly ("the automation hasn't caught
up to this yet — next check in ~X min") instead of leaving people to
wonder whether something's broken. This is a real diagnostic, not
decoration — it directly answers "is this actually working" without
needing to check anything outside the MFL page itself.

### 4. Recent activity feed
Last 3–5 acquisitions league-wide, with team names and how long ago.
Turns the widget into something people would actually glance at
regularly, not just check once during setup.

### 5. Next-check countdown
"Next automatic check in ~23 min." Pure arithmetic from the known
check interval and the current time — no data fetch needed at all.

### 6. Season stats
Most active team (most pickups), longest current streak without a
pickup, maybe average days between adds league-wide. Genuinely fun,
league-wide content computed from the same transaction history — the
kind of thing that makes people actually read a homepage widget instead
of ignoring it.

### 7. Status indicator + last-run time
The one idea that survived into the simplified version. Useful, but on
its own it's a diagnostic for one person (whoever's checking whether
the automation is healthy), not something the whole league gets value
from. Fine as one line among the others above, thin as the entire
widget.

## Tier 2 — needs a small backend (real control, not just display)

The hard constraint: a public-facing widget **cannot safely hold
write-credentials** for the automation. Anything embedded in a script
sitting on a page every league member can view-source is not a secret
— so a checkbox that directly disabled the automation, or a dropdown
that directly rewrote its schedule, can't be built as pure client-side
code without exposing a real write-access credential to the whole
league.

The clean way around this: a minimal backend component — call it a
control surface — that itself holds no write-credential either, only a
couple of plain flags (e.g. `enabled: true/false`, a desired check
interval). That component exposes:
- a **safe-to-expose public read** (what today's "last run status" line
  already uses)
- a **narrow, low-stakes write** (just flag values, nothing else) that
  the widget can call directly

The automation, on its side, checks those same flags at the start of
each run:
- if `enabled: false` → no-op immediately, don't do anything
- if not enough time has passed to satisfy the desired interval → no-op

This gets you a real on/off toggle and a real frequency control, safely
— because the actual scheduling trigger stays fixed at whatever the
platform's floor is, and the *effective* frequency becomes adjustable
without ever touching platform-level configuration (which would need
real write-credentials to change). The risk profile of exposing this
narrow write is low: worst case, someone toggles their own league's
automation off, not a security or data-exposure incident.

This is real, additional infrastructure to design, deploy, and
maintain — not a README-sized change like Tier 1. Worth doing
deliberately, once Tier 1 is solid, not folded in as an afterthought.

## Tier 3 — bigger, more speculative ideas

Not scoped or designed in detail, but worth keeping on the list:

- **A small leaderboard** of recent waiver activity — light
  gamification of priority position across the league.
- **A "notify me" opt-in** — flag your own franchise so you get some
  kind of nudge when you're about to drop in priority (mechanism
  TBD — could be as simple as a per-browser reminder, or as involved
  as a real notification channel; not designed).
- **Deeper league stats over a full season** — trends over time rather
  than just current-state snapshots.

## Cross-cutting technical techniques

A few implementation decisions that apply across most of the ideas
above, worth keeping regardless of which specific features get built:

- **Theme inheritance, not hardcoded styling.** MFL leagues run
  different site skins with different colors. Reusing MFL's own
  semantic table/report CSS classes (rather than any hardcoded color
  values) makes a widget automatically match whatever skin a given
  league has active, with zero per-league customization needed.
- **Read what's already on the page instead of requesting elevated
  access.** MFL's native waiver-order widget is already visible to
  every owner on the homepage — reading it directly out of the page's
  own DOM avoids needing any commissioner-only data source for
  something regular owners can already see anyway.
- **Gate commissioner-only content by the page's own viewer-identity
  variable**, not by a separate login or permission check — MFL
  already exposes who's looking at the page; use that instead of
  building new auth.
- **Treat league-controlled text (team names, etc.) as untrusted
  input** when rendering it into the page — owners can rename their
  own team to anything, including markup, so anything user-controlled
  needs escaping before it's inserted into the widget's HTML.
