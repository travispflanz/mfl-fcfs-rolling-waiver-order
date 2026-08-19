# Lessons Learned

This document exists because the same mistake happened more than once
in this project's history, and the person directing the work had to
catch it each time rather than it being caught proactively. Read this
before doing exploratory work against any external, established
platform (MFL or otherwise) that this project — or a future one —
integrates with.

## The core mistake: live reverse-engineering before checking whether the answer was already documented

**What happened, concretely, in this project:**

MyFantasyLeague.com has been running in essentially its current form
for 20+ years and has multiple mature third-party applications built
against it. That means most integration questions have almost
certainly been answered already — in MFL's own official API docs,
MFL's own blog/help content, or in an existing open-source project
that already solved the same problem. More than once in this session,
the actual approach taken was: hit a real, live, undocumented page,
guess at its structure, get it wrong, iterate against the live site —
*then*, after a direct correction, go check the documentation that had
been sitting there the whole time.

**The clearest example**: needing a way to post an automated alert
somewhere visible to the league. The approach taken was to find the
Message Board's "Add Topic" link on a real page and hit its target
(`topic_add.pl`) directly with a plain HTTP request. It 404'd. Only
after being told directly — *"why aren't you going out to research
when you run into these questions? ... this platform has been around
for 20+ years... go research"* — did a search of MFL's own official
API documentation turn up `import?TYPE=messageBoard` and
`import?TYPE=emailMessage`: real, documented, working endpoints that
made the entire `topic_add.pl` investigation unnecessary. The
documentation was one search away the whole time.

**Why this is expensive, specifically**: live probing against someone
else's real, production service is not a neutral way to "just check" —
every request is a real interaction with infrastructure you don't
control, guessing-then-correcting via more live requests compounds
that cost, and a wrong guess can produce a plausible-looking but
subtly incorrect result that isn't caught until much later (see the
`IN_HEADER`/`IN_FOOTER` example below, which passed every check *except*
looking at the actual rendered page). A five-minute documentation
search is strictly cheaper and often gives a complete, authoritative
answer directly, instead of a partial one assembled from trial and
error.

## The corrected process

Before writing exploratory code against any undocumented behavior of
an external platform:

1. **The platform's own official API/developer documentation.** For
   MFL: `api.myfantasyleague.com/{year}/api_info?STATE=details` — check
   *both* Export and Import sections, since a read/write pair often
   exists even when only one side is obviously discoverable from a
   page's UI.
2. **The platform's own blog/help/tutorial content.** Often describes
   a feature's *only* intended mechanism in plain English — itself
   useful evidence (e.g., confirms something is UI-only, not
   API-backed, which is exactly what settled the Home Page module
   placement question in this project — see below).
3. **Existing open-source projects that already integrate with it.**
   What they *implement* and *don't* implement is itself a signal —
   two independent sources (MFL's own docs and a third-party library)
   both treating something as read-only is corroborating evidence, not
   a coincidence.
4. **A documentation-search tool, if available** (this project has
   access to Context7). Checked directly for this project: no
   dedicated MFL API documentation exists there, only one loosely
   related third-party app that didn't cover any of the specific
   mechanics needed. Worth checking anyway — cheap, and this project's
   own experience shows it *can* turn up something real elsewhere — but
   don't expect it to always have niche platforms indexed, and don't
   skip steps 1–3 on the assumption it will.
5. **Only then, live verification** against the real site — and
   scoped specifically to the gap the above didn't resolve, not as the
   first move.

## A second, related lesson: an API response and the real rendered output are not always interchangeable

Separate from the "should have researched first" pattern above: this
project also shipped a real bug — the ambient-status Home Page Message
feature initially left `IN_HEADER`/`IN_FOOTER` at their untouched
default of `"Yes"`, which caused the status content to be injected
into the header and footer of *every page on the entire site*, not
shown as a homepage module the way it was designed to be. This passed
verification against MFL's own `embed` and `appearance` APIs — both
correctly reported the slot's *content* — because neither of those
APIs surfaces header/footer-injection behavior at all. It was only
caught when directly told to *"go look at the league home page
source"* and inspecting `document.documentElement.outerHTML` on the
real, live page. **Verifying via a platform's official API is
necessary but not always sufficient — for anything that affects how
content actually renders on a real page, check the real rendered page
too, especially the first time a new write path goes live.**

## A third, related lesson: silent design decisions vs. surfaced choices

A smaller-scale version of the same underlying problem: an early
version of the ambient-status slot-discovery logic silently restricted
candidate slots to ones already placed on a visible tab — a real
design decision (favoring "already visible" over "actually empty by
content"), made and shipped without flagging it as a choice with
trade-offs. It was corrected only after being told directly that this
was "a massive decision... made without discussion." The general
version of this lesson: when an implementation detail actually encodes
a design decision (not just a mechanical necessity), say so explicitly
before or while building it, rather than making the call silently and
letting it surface later as a surprise.

## Resources confirmed useful for this project specifically

- `api.myfantasyleague.com/{year}/api_info?STATE=details` — official
  Import/Export API reference. Prose descriptions, not a strict
  per-field schema, but the query parameters listed there are a real
  contract.
- `api.myfantasyleague.com/{year}/api_info` (no `STATE=` param) — the
  General Information page, easy to skim past. Contains real
  platform-wide conventions (e.g., the `"0000"` commissioner-operation
  sentinel, and the "if the commissioner has no franchise and none is
  given, it returns an error" behavior) that aren't repeated on the
  per-endpoint reference page.
- `myfantasyleague.wordpress.com` — MFL's own blog, useful for
  feature-level "how this is intended to work" context (found the
  Home Page Modules placement being manual-only here).
- Third-party open-source libraries wrapping the MFL API (found via
  ordinary web search, e.g. a Python `python-mfl` package) — useful as
  corroborating evidence for "does a write-side API exist," since a
  mature wrapper library not implementing something is real signal.
- Cloudflare's own docs (`developers.cloudflare.com`) — used correctly
  in this project *before* being told to, for Cloudflare-specific
  questions (`HTMLRewriter`, `crypto.subtle.timingSafeEqual`, Cron
  Trigger syntax, Workers Best Practices). Worth noting as the
  positive counter-example: the same research-first discipline that
  was missed for MFL-specific questions was already the default
  approach for Cloudflare-specific ones.
