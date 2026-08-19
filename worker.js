/**
 * MFL Custom Waiver Order — production automation, plain fetch(), no
 * headless browser, running entirely on Cloudflare Workers.
 *
 * FULL CUTOVER (2026-08-18): this Worker is now the only thing that
 * runs this automatically. The original GitHub Actions workflow,
 * Playwright script, and package.json were deleted from the working
 * tree entirely (recoverable from git history if ever needed — see
 * docs/DEVELOPMENT_NOTES.md). scheduled() below (see wrangler.toml's
 * [triggers]) is what actually keeps the league's waiver order
 * current now, every 2 minutes, unattended — the reliable practical
 * maximum given Workers KV's Free-tier write cap (2026-08-19; see
 * docs/DEVELOPMENT_NOTES.md for the numbers), run essentially
 * continuously specifically so the order is always accurate close to
 * both of MFL's own "Process Waivers" and "Put All Players on
 * Waivers" League Calendar moments, not just on a coarser fixed
 * interval that happens to land nearby.
 *
 * Login → Become Commissioner → settings-compatibility check
 * (including a best-effort, informational-only League Calendar check
 * — see getLeagueCalendarEvents()) → read current order (cross-checked
 * against an independent source) → compute target order from real
 * transaction history → submit (only when something actually changed)
 * → verify on the homepage → record status.
 *
 * HTTP endpoints — all gated by DIAG_TOKEN except /status:
 *
 *   GET /diag                     — read-only pipeline, no write path
 *                                    exists in this handler at all.
 *                                    Add ?check_slot=true to also run
 *                                    the (read-only) ambient-status
 *                                    slot discovery check.
 *   GET /run?dry_run=&force=      — full pipeline, INCLUDING the write.
 *       dry_run defaults to "true" — a bare /run?token=... NEVER
 *       writes. Pass dry_run=false to allow a real POST.
 *       force defaults to "false" — even with dry_run=false, a real
 *       POST is only sent if the computed target order differs from
 *       the current order, UNLESS force=true is also passed (mirrors
 *       this repo's own prior one-time write-path verification
 *       precedent — commit 5c0dd55 → a45e991 — for when there's zero
 *       transaction history to naturally produce a change).
 *   GET /claim-status-slot        — real write. Claims/refreshes the
 *       ambient status Home Page Message slot (see AMBIENT STATUS
 *       below). Separate from /run entirely; not on any schedule.
 *
 * Plus GET /status — public, no token, non-sensitive last-run summary
 * for the league homepage widget to display.
 *
 * AMBIENT STATUS (added 2026-08-18, auto-refresh added 2026-08-19):
 * finds an empty MFL "Home Page Message" slot (checking all 20, MFL's
 * own hard cap, highest-numbered first) and writes a small status
 * table into it. scheduled() refreshes it automatically, at most once
 * per HOUR (Travis's explicit choice — separate from and much less
 * frequent than the 2-minute waiver-order check; see
 * shouldRefreshStatusSlot()); /claim-status-slot remains available for
 * an immediate manual refresh any time. Writing content does NOT make
 * it visible on its own — MFL has no API for editing the module/tab
 * layout (confirmed: checked the Import docs and a third-party
 * open-source library that wraps the whole API; MFL's own tutorial
 * content describes it as a manual drag-and-drop admin action only)
 * — so making it appear on the homepage, positioned under the native
 * Waiver Wire Order module, is a deliberate ONE-TIME MANUAL step (see
 * README). Requires "Use 'Advanced Editor' on league type-in boxes?"
 * (csetup?C=REPSEC) to be set to No — checked and hard-blocked
 * (claimOrRefreshStatusSlotSafely()) if not, since "Yes" would
 * silently mangle the write.
 *
 * FAILURE ALERTING (added 2026-08-18; notification method made
 * configurable 2026-08-19): a real (non-dry-run) failure can post to
 * the league's Message Board and/or email the commissioner, both via
 * MFL's own official, documented Import API (import?TYPE=messageBoard
 * / TYPE=emailMessage) — no third-party service of any kind, same one
 * MFL account this project already requires. Which channel(s) actually
 * fire is controlled by FAILURE_NOTIFICATION_METHOD (see below);
 * default is "email" only. The commissioner's email target is looked
 * up dynamically every time (league.commish_username matched against
 * each franchise's username; falls back to the documented "0000" —
 * MFL's own sentinel for "a commissioner with no owned franchise" —
 * when no franchise matches), so this works whether or not the
 * commissioner owns a team in their league. Only fires once per new
 * failure (a repeat failure while already in a known-bad state
 * doesn't re-alert) — see shouldAlert() below.
 *
 * ── Secrets ── MFL_USERNAME, MFL_PASSWORD, DIAG_TOKEN
 * ── Config vars — set as plain Variables (not Secrets) under the
 *    Worker's own Settings -> Variables and Secrets, not in
 *    wrangler.toml ──
 *    MFL_LEAGUE_URL (required — or set MFL_HOST/MFL_YEAR/MFL_LEAGUE
 *    individually instead)
 *    FAILURE_NOTIFICATION_METHOD (optional — "email" [default],
 *    "message_board", "both", or "none")
 *    WORKER_STATUS_URL (optional, purely cosmetic — your own Worker's
 *    public URL, included as a link in failure alert messages)
 */

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const ACQUIRED_TYPES = ['WAIVER', 'BBID_WAIVER', 'FREE_AGENT'];

export default {
  // Full cutover (2026-08-18): this is now the real production entry
  // point — GitHub Actions' schedule has been removed, this Worker's
  // Cron Trigger (see wrangler.toml) is the only thing running the
  // automation automatically. Normal safe production behavior:
  // dryRun=false, force=false (idempotent — only submits when the
  // computed order actually differs from the current one).
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const report = await runPipeline(env, { dryRun: false, force: false, includeVerify: true });
        console.log(`Scheduled run: ok=${report.ok} action=${report.action || 'n/a'} error=${report.error || 'none'}`);
        try {
          await recordStatus(env, report);
        } catch (err) {
          console.log('Warning: could not record status to KV (non-fatal):', err.message);
        }

        // Ambient status slot (optional feature): refresh at most once
        // per hour, not every 2-minute tick — Travis's explicit choice.
        // Uses its own authenticated session (runPipeline's isn't
        // exposed to the caller) — one extra login/hour, negligible
        // cost. Best-effort: must never affect the real waiver-order
        // run above, which has already completed by this point either
        // way.
        try {
          if (await shouldRefreshStatusSlot(env)) {
            const { jar, BASE, LEAGUE } = await authenticateAsCommissioner(env);
            const result = await claimOrRefreshStatusSlotSafely(env, jar, BASE, LEAGUE, report);
            console.log(`Status slot refresh: ${JSON.stringify(result)}`);
          }
        } catch (err) {
          console.log('Warning: could not refresh status slot (non-fatal):', err.message);
        }
      })()
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Deliberately NOT token-gated — see recordStatus() below for why.
    // CORS enabled so a browser-side fetch() from the MFL homepage
    // widget (a different origin) can read it.
    if (url.pathname === '/status') {
      const raw = env.STATUS_KV ? await env.STATUS_KV.get('last-run') : null;
      const body = raw ? raw : JSON.stringify({ ok: null, message: 'No run recorded yet.' });
      return new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const token = url.searchParams.get('token') || request.headers.get('x-diag-token');
    if (!env.DIAG_TOKEN || !timingSafeEqual(token || '', env.DIAG_TOKEN)) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/diag') {
      const report = await runPipeline(env, { dryRun: true, force: false, includeVerify: true });
      // Opt-in only — does its own login (a few extra requests), so it
      // stays out of the default /diag path to keep normal checks fast.
      if (url.searchParams.get('check_slot') === 'true') {
        try {
          const { jar, LEAGUE, BASE } = await authenticateAsCommissioner(env);
          report.slotCheck = await findEmptyMessageSlot(jar, BASE, LEAGUE);
          const { finalText: appearanceText } = await followWithCookies(`${BASE}/export?TYPE=appearance&L=${LEAGUE}&JSON=1`, { method: 'GET' }, jar);
          report.waiverOrderPlacement = findWaiverOrderPlacement(JSON.parse(appearanceText));
        } catch (err) {
          report.slotCheck = { error: err.message };
        }
      }
      return json(report);
    }

    // Real write — claims (or refreshes) the ambient status Home Page
    // Message slot. Deliberately its own endpoint, not folded into
    // /diag or /run, so /diag's "no write path exists in this handler
    // at all" stays true and this one real, visible side effect is
    // fully described right here rather than buried in a bigger
    // multi-purpose route.
    if (url.pathname === '/claim-status-slot') {
      try {
        const { jar, LEAGUE, BASE } = await authenticateAsCommissioner(env);
        const fakeReport = { ok: true, ranAt: new Date().toISOString() };
        const result = await claimOrRefreshStatusSlotSafely(env, jar, BASE, LEAGUE, fakeReport);
        return json(result);
      } catch (err) {
        return json({ ok: false, error: err.message });
      }
    }

    if (url.pathname === '/run') {
      const dryRun = url.searchParams.get('dry_run') !== 'false'; // default true — safest
      const force = url.searchParams.get('force') === 'true'; // default false
      const report = await runPipeline(env, { dryRun, force, includeVerify: true });
      // Hardening idea #5: record status for /status to serve, but only
      // for real pipeline runs (not /diag) so testing never pollutes
      // what league members would see as "the automation's last run."
      // Best-effort — a KV hiccup must never fail the actual MFL run.
      try {
        await recordStatus(env, report);
      } catch (err) {
        console.log('Warning: could not record status to KV (non-fatal):', err.message);
      }
      return json(report);
    }

    return new Response('Not found. Try /diag, /run, /status, or /claim-status-slot.', { status: 404 });
  },
};

// Best practice per Cloudflare's own Workers examples (workers/examples/
// basic-auth): a plain !== comparison on a secret leaks its value one
// character at a time via response-time differences. crypto.subtle
// .timingSafeEqual is a real, documented Workers runtime API (Web
// Crypto), not a Node-only thing — no nodejs_compat flag needed. Never
// return early on a length mismatch (that alone leaks the token's
// length), so both branches always do a real timingSafeEqual call.
const TEXT_ENCODER = new TextEncoder();
function timingSafeEqual(a, b) {
  const aBytes = TEXT_ENCODER.encode(a);
  const bBytes = TEXT_ENCODER.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) {
    return !crypto.subtle.timingSafeEqual(aBytes, aBytes);
  }
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), { headers: { 'Content-Type': 'application/json' } });
}

// Hardening idea #5: last-run status via Workers KV — same Cloudflare
// account already required for the Worker itself, no new third-party
// signup, no new secret. Deliberately a distilled summary, not the
// full report (no hop-by-hop URLs, no cookie info) — this is served
// with NO token below, on purpose, so a homepage widget's client-side
// JS (running in any league member's browser) can read it directly,
// the same trust model MFL's own public export APIs already use.
async function recordStatus(env, report) {
  if (!env.STATUS_KV) return;
  const summary = {
    ok: report.ok,
    ranAt: report.ranAt,
    action: report.action || null,
    error: report.error || null,
    changed: typeof report.changed === 'boolean' ? report.changed : null,
    currentOrder: report.currentOrder || null,
  };
  await env.STATUS_KV.put('last-run', JSON.stringify(summary));
}

function parseLeagueUrl(url) {
  const hostMatch = url.match(/(?:https?:\/\/)?(www\d+)\.myfantasyleague\.com/i);
  const yearMatch = url.match(/\/(20\d{2})(?:[/?]|$)/);
  const leagueMatch = url.match(/[?&]L=(\d{5})\b/i) || url.match(/\/(\d{5})(?:[/?]|$)/);
  if (!hostMatch || !yearMatch || !leagueMatch) return null;
  return { host: hostMatch[1].toLowerCase(), year: yearMatch[1], league: leagueMatch[1] };
}

// Generic-for-any-league config resolution, used everywhere the Worker
// needs to know which league it's pointed at. Deliberately FAILS LOUD
// if nothing is configured, rather than falling back to any specific
// league's numbers — an earlier version of this defaulted silently to
// this project's own original league (www44/2026/19186), which meant
// a commissioner who forgot to set MFL_LEAGUE_URL would get a Worker
// quietly trying to run against someone else's league instead of a
// clear error telling them what to fix. Matches the original
// Playwright script's own behavior (parseLeagueUrl() there throws the
// same way) — this port had drifted from that.
function getLeagueConfig(env) {
  const parsed = env.MFL_LEAGUE_URL ? parseLeagueUrl(env.MFL_LEAGUE_URL) : null;
  const HOST = env.MFL_HOST || parsed?.host;
  const YEAR = env.MFL_YEAR || parsed?.year;
  const LEAGUE = env.MFL_LEAGUE || parsed?.league;
  if (!HOST || !YEAR || !LEAGUE) {
    throw new Error(
      'No league configured. Set MFL_LEAGUE_URL under your Worker\'s Settings -> Variables and Secrets ' +
        'to any URL from your league (e.g. your league homepage address bar) — or set ' +
        'MFL_HOST/MFL_YEAR/MFL_LEAGUE individually.'
    );
  }
  return { HOST, YEAR, LEAGUE, BASE: `https://${HOST}.myfantasyleague.com/${YEAR}` };
}

// Shared login + Become Commissioner sequence for the two manual
// diagnostic/action endpoints (/diag?check_slot, /claim-status-slot) —
// previously duplicated inline in both; the main runPipeline() has its
// own copy since it interleaves this with report/log building
// differently enough that sharing wasn't a clean fit.
async function authenticateAsCommissioner(env) {
  const { HOST, YEAR, LEAGUE, BASE } = getLeagueConfig(env);
  const jar = {};
  const loginBody = new URLSearchParams({
    LEAGUE_ID: LEAGUE,
    URL: `${BASE}/home/${LEAGUE}`,
    USERNAME: env.MFL_USERNAME,
    PASSWORD: env.MFL_PASSWORD,
    REMEMBER: 'Yes',
  });
  await followWithCookies(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: loginBody.toString() }, jar);
  await followWithCookies(`${BASE}/logout?L=${LEAGUE}&BECOME=0000`, { method: 'GET' }, jar);
  return { jar, HOST, YEAR, LEAGUE, BASE };
}

async function runPipeline(env, { dryRun, force, includeVerify }) {
  const log = [];
  const report = { ok: true, ranAt: new Date().toISOString(), log };
  const l = (msg) => log.push(msg);

  let HOST, YEAR, LEAGUE, BASE;
  try {
    ({ HOST, YEAR, LEAGUE, BASE } = getLeagueConfig(env));
  } catch (err) {
    report.ok = false;
    report.error = err.message;
    return report;
  }
  report.config = { HOST, YEAR, LEAGUE, dryRun, force };

  const { MFL_USERNAME, MFL_PASSWORD } = env;
  if (!MFL_USERNAME || !MFL_PASSWORD) {
    report.ok = false;
    report.error = 'Missing MFL_USERNAME / MFL_PASSWORD secrets.';
    return report;
  }

  const jar = {};

  try {
    // ── Login ──────────────────────────────────────────────────
    const body = new URLSearchParams({
      LEAGUE_ID: LEAGUE,
      URL: `${BASE}/home/${LEAGUE}`,
      USERNAME: MFL_USERNAME,
      PASSWORD: MFL_PASSWORD,
      REMEMBER: 'Yes',
    });
    const login = await followWithCookies(
      `${BASE}/login`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
      jar
    );
    if (/name=["']PASSWORD["']/i.test(login.finalText)) {
      throw new Error('Login appears to have failed — password field present after submit.');
    }
    l(`Login OK (${login.hops.length} hop(s)).`);

    // ── Become Commissioner ───────────────────────────────────
    const become = await followWithCookies(`${BASE}/logout?L=${LEAGUE}&BECOME=0000`, { method: 'GET' }, jar);
    if (/name=["']PASSWORD["']/i.test(become.finalText)) {
      throw new Error('After Become Commissioner, session looks logged out.');
    }
    l(`Become Commissioner OK. MFL_IS_COMMISH present: ${'MFL_IS_COMMISH' in jar}.`);

    // ── Settings compatibility check (WAIVREQ) — warn only ────
    const reqPage = await followWithCookies(`${BASE}/csetup?L=${LEAGUE}&C=WAIVREQ`, { method: 'GET' }, jar);
    const waiverOrderValue = await extractCheckedRadio(reqPage.finalText, 'WAIVER_ORDER');
    const sortCriteria = [];
    for (let i = 0; i < 6; i++) sortCriteria.push(await extractSelectedOption(reqPage.finalText, `WAIVER_SORT_${i}`));
    report.settingsCheck = { waiverOrderValue, sortCriteria };
    const problems = [];
    if (waiverOrderValue !== 'SAME' && waiverOrderValue !== 'REVERSE') problems.push(`WAIVER_ORDER="${waiverOrderValue}"`);
    const nonNone = sortCriteria.filter((v) => v && v !== 'NONE');
    if (nonNone.length) problems.push(`Sort Criteria not all None: ${nonNone.join(',')}`);
    if (problems.length) l(`⚠ Settings warning (non-blocking): ${problems.join('; ')}`);
    else l('Waiver settings compatible (SAME/REVERSE + all Sort Criteria None).');

    // ── Calendar check (Process Waivers event) — informational only,
    // never affects the real pipeline. See getLeagueCalendarEvents()
    // for why this is deliberately loose/best-effort.
    try {
      const calendar = await getLeagueCalendarEvents(jar, BASE, LEAGUE);
      report.calendarCheck = calendar.summary;
      if (!calendar.summary.hasProcessWaiversEvent) {
        l('⚠ No "Process Waivers" League Calendar event found (best-effort check — see README). ' +
          'Without one, locked players never unlock back to FCFS; double-check League Calendar Setup.');
      }
    } catch (err) {
      l(`Note: could not read League Calendar (non-fatal, informational only): ${err.message}`);
    }

    // ── Franchise names + independent order cross-check (hardening
    // ideas #1 and #2) — MFL's own export?TYPE=league is public,
    // structured JSON, no auth needed, and includes a per-franchise
    // waiverSortOrder that's an independent encoding of the same
    // "current order" WAIVORD's hidden fields describe. Verified live
    // 2026-08-18 to match exactly. This replaces the old options?O=01
    // regex scrape, which was silently returning "Basic" for every
    // franchise.
    let franchiseNames = {};
    let leagueExportOrder = null;
    try {
      const leagueData = await getLeagueExportData(jar, BASE, LEAGUE);
      franchiseNames = leagueData.namesByFid;
      if (Object.keys(leagueData.sortOrderByFid).length) {
        leagueExportOrder = Object.entries(leagueData.sortOrderByFid)
          .sort((a, b) => a[1] - b[1])
          .map(([fid]) => fid);
      }
      l(`Franchise names resolved via league export: ${Object.keys(franchiseNames).length}.`);
      report.waiverType = leagueData.currentWaiverType;
      if (leagueData.currentWaiverType && leagueData.currentWaiverType !== 'WAIVERS_FCFS') {
        l(`⚠ League waiver type is "${leagueData.currentWaiverType}", not WAIVERS_FCFS — this bot is ` +
          `designed for FCFS leagues; the order it maintains may not mean what you expect here.`);
      }
    } catch (err) {
      l(`Warning: could not fetch league export (non-fatal for names, but cross-check skipped): ${err.message}`);
    }

    // ── Read current waiver order (WAIVORD) ────────────────────
    const setupPage = await followWithCookies(`${BASE}/csetup?L=${LEAGUE}&C=WAIVORD`, { method: 'GET' }, jar);
    const fields = await parseHiddenFields(setupPage.finalText);
    if (!fields.input_expires) {
      throw new Error(
        `Could not read input_expires from WAIVORD page — commissioner mode may not have taken. ` +
          `totalInputs=${(setupPage.finalText.match(/<input\b/gi) || []).length}`
      );
    }
    const franchiseCount = parseInt(fields.WAIVER_ORDER_LEAGUE_COUNT || '0', 10);
    if (!franchiseCount) throw new Error('WAIVER_ORDER_LEAGUE_COUNT missing or zero.');
    const currentOrder = [];
    for (let i = 1; i <= franchiseCount; i++) {
      const fid = fields[`WAIVER_ORDER_LEAGUE_${i}`];
      if (!fid) throw new Error(`Missing WAIVER_ORDER_LEAGUE_${i}.`);
      currentOrder.push(fid);
    }
    l(`Read ${franchiseCount} franchises, input_expires=${fields.input_expires}.`);

    // ── Hardening idea #4: fail loud on structurally unsound data
    // instead of silently proceeding with it. ──
    assertSaneOrder(currentOrder, franchiseCount);
    assertSaneToken(fields.input_expires);

    // ── Hardening idea #2: cross-check against the independent
    // source fetched above. Any disagreement is treated as a hard
    // stop — either MFL changed markup this run hasn't adapted to,
    // or the two views are out of sync for a reason worth a human
    // looking at before trusting either one to write.
    if (leagueExportOrder) {
      if (!arraysEqual(currentOrder, leagueExportOrder)) {
        throw new Error(
          `Cross-check failed: WAIVORD page order [${currentOrder.join(',')}] does not match league ` +
            `export's waiverSortOrder [${leagueExportOrder.join(',')}]. Refusing to proceed.`
        );
      }
      l('Cross-check OK: WAIVORD order matches league export waiverSortOrder.');
    } else {
      l('Cross-check skipped — league export data unavailable this run.');
    }

    // ── Transactions → compute target order ────────────────────
    const types = ACQUIRED_TYPES.join(',');
    const txPage = await followWithCookies(
      `${BASE}/export?TYPE=transactions&L=${LEAGUE}&TRANS_TYPE=${encodeURIComponent(types)}&JSON=1`,
      { method: 'GET' },
      jar
    );
    const parsed = JSON.parse(txPage.finalText);
    let list = parsed?.transactions?.transaction ?? [];
    if (!Array.isArray(list)) list = list ? [list] : [];
    l(`Transactions export returned ${list.length} matching transaction(s).`);

    const rankByFranchise = {};
    for (const tx of list) {
      const fid = String(tx.franchise || '').padStart(4, '0');
      const ts = Number(tx.timestamp || 0);
      if (!fid || !ts) continue;
      if (!rankByFranchise[fid] || ts > rankByFranchise[fid]) rankByFranchise[fid] = ts;
    }

    const targetOrder = currentOrder
      .map((fid, idx) => ({ fid, idx, ts: rankByFranchise[fid] || 0 }))
      .sort((a, b) => a.ts - b.ts || a.idx - b.idx)
      .map((x) => x.fid);

    const withName = (fid) => (franchiseNames[fid] ? `${fid} (${franchiseNames[fid]})` : fid);
    report.currentOrder = currentOrder.map(withName);
    report.targetOrder = targetOrder.map(withName);
    const changed = !arraysEqual(currentOrder, targetOrder);
    report.changed = changed;

    // ── Decide whether to submit ────────────────────────────────
    if (dryRun) {
      report.action = 'dry_run_no_submit';
      l('DRY_RUN — not submitting.');
      return report;
    }
    if (!changed && !force) {
      report.action = 'skipped_no_change';
      l('Target order identical to current order — nothing to submit (pass force=true to override, e.g. for a one-time write-path test).');
      return report;
    }

    // ── Submit ───────────────────────────────────────────────────
    const postBody = new URLSearchParams();
    postBody.append('form_name', 'WAIVORD');
    postBody.append('LEAGUE_ID', LEAGUE);
    postBody.append('C', 'WAIVORD');
    postBody.append('input_expires', fields.input_expires);
    postBody.append('WAIVER_ORDER_LEAGUE_COUNT', String(franchiseCount));
    postBody.append('WAIVER_ORDER_LEAGUE_SHOW_INDEX', fields.WAIVER_ORDER_LEAGUE_SHOW_INDEX || '1');
    targetOrder.forEach((fid, i) => postBody.append(`WAIVER_ORDER_LEAGUE_${i + 1}`, fid));
    // Deliberately NOT including DELETE_CUSTOM.

    const submit = await followWithCookies(
      `${BASE}/csetup`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: postBody.toString() },
      jar
    );
    report.submitStatus = submit.res.status;
    report.action = changed ? 'submitted_new_order' : 'submitted_unchanged_order_forced_test';
    l(`POST to csetup returned HTTP ${submit.res.status}.`);

    // ── Verify ───────────────────────────────────────────────────
    if (includeVerify) {
      const home = await followWithCookies(`${BASE}/home/${LEAGUE}`, { method: 'GET' }, jar);
      const customInEffect = /custom waiver order in effect/i.test(home.finalText);
      const widgetIdx = home.finalText.search(/waiver wire order/i);
      report.verify = {
        customWaiverOrderInEffectTextPresent: customInEffect,
        widgetAreaSample:
          widgetIdx >= 0
            ? home.finalText.slice(widgetIdx, widgetIdx + 700).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            : null,
      };
      l(`Verify: "Custom Waiver Order In Effect" present: ${customInEffect}.`);
    }

    return report;
  } catch (err) {
    report.ok = false;
    report.error = String(err && err.message ? err.message : err);

    // Alert on real failures only — never for /diag or a dry_run=true
    // /run, so testing can never trigger a real message-board post or
    // a real email. Best-effort: an alerting problem is recorded on
    // the report but must never crash the pipeline further or hide
    // the original error above.
    if (!dryRun) {
      try {
        if (await shouldAlert(env)) {
          report.alert = await sendFailureAlert(env, jar, BASE, LEAGUE, report.error);
        } else {
          report.alert = { skipped: 'already alerted for an ongoing failure' };
        }
      } catch (alertErr) {
        report.alert = { error: `Failed to send failure alert: ${alertErr.message}` };
      }
    }

    return report;
  }
}

// ────────────────────────────────────────────────────────────────────────

async function followWithCookies(startUrl, options, jar, maxHops = 8) {
  let currentUrl = startUrl;
  let currentOptions = { ...options };
  const hops = [];

  for (let i = 0; i <= maxHops; i++) {
    const headers = new Headers(currentOptions.headers || {});
    for (const [k, v] of Object.entries(BROWSER_HEADERS)) headers.set(k, v);
    headers.set('Cookie', jarToHeader(jar));

    const res = await fetch(currentUrl, { ...currentOptions, headers, redirect: 'manual' });
    const setCookieCount = mergeSetCookies(jar, res);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      await res.text().catch(() => {});
      hops.push({ url: currentUrl, status: res.status, location, setCookieCount });
      // Fail loud rather than silently returning an empty body — an
      // empty finalText here used to surface downstream as a confusing
      // "Could not read input_expires" or JSON.parse error with no clue
      // the real cause was a broken/looping redirect chain.
      if (!location) throw new Error(`Redirect (HTTP ${res.status}) from ${currentUrl} had no Location header.`);
      if (i === maxHops) throw new Error(`Too many redirects (>${maxHops}) starting from ${startUrl}.`);
      const nextUrl = new URL(location, currentUrl).toString();
      const nextMethod =
        res.status === 303 || ((res.status === 301 || res.status === 302) && currentOptions.method === 'POST')
          ? 'GET'
          : currentOptions.method || 'GET';
      currentOptions = {
        method: nextMethod,
        headers: currentOptions.headers,
        body: nextMethod === 'GET' ? undefined : currentOptions.body,
      };
      currentUrl = nextUrl;
      continue;
    }

    const finalText = await res.text();
    hops.push({ url: currentUrl, status: res.status, location: null, setCookieCount });
    Object.defineProperty(res, 'url', { value: currentUrl, configurable: true });
    return { res, hops, finalText };
  }

  // Unreachable with the default maxHops (every loop iteration above
  // returns or throws before falling out the bottom) — kept as a
  // defensive backstop in case maxHops is ever passed as 0 or negative
  // by a future caller.
  throw new Error(`Too many redirects starting from ${startUrl}.`);
}

function mergeSetCookies(jar, response) {
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    const nameValue = sc.split(';')[0];
    const eq = nameValue.indexOf('=');
    if (eq > 0) jar[nameValue.slice(0, eq).trim()] = nameValue.slice(eq + 1).trim();
  }
  return setCookies.length;
}

function jarToHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Hardening idea #3: Cloudflare's own streaming HTML parser
// (HTMLRewriter, a Workers runtime global — no import needed) instead
// of hand-rolled regex. Real CSS selectors, immune to the whole class
// of thing that broke the old two-pass regex (attribute order,
// whitespace, quoting) — it's what Cloudflare's own docs recommend for
// exactly this. Operates on a Response reconstructed from the
// already-fetched HTML string, so followWithCookies() and its
// redirect-following logic don't need to change at all. Note:
// HTMLRewriter is lazy/streaming — .transform() alone does nothing;
// the output has to actually be consumed (.text()) to drive parsing.
//
// Deliberately NOT converted: the simple substring checks elsewhere
// (login/logout detection, "Custom Waiver Order In Effect", "Waiver
// Wire Order") — those aren't attribute-order-fragile the way
// name/value extraction was, so converting them would add ceremony
// without reducing any real fragility.

async function parseHiddenFields(html) {
  const fields = {};
  class InputCollector {
    element(el) {
      const name = el.getAttribute('name');
      if (name) fields[name] = el.getAttribute('value') || '';
    }
  }
  const rewritten = new HTMLRewriter()
    .on('input', new InputCollector())
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  await rewritten.text(); // drive the stream — parsing happens as this is consumed
  return fields;
}

async function extractCheckedRadio(html, name) {
  let value = null;
  class RadioCollector {
    element(el) {
      if (el.getAttribute('checked') !== null) value = el.getAttribute('value') || '';
    }
  }
  const rewritten = new HTMLRewriter()
    .on(`input[name="${name}"]`, new RadioCollector())
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  await rewritten.text();
  return value;
}

async function extractSelectedOption(html, name) {
  let value = null;
  class OptionCollector {
    element(el) {
      if (el.getAttribute('selected') !== null) value = el.getAttribute('value') || '';
    }
  }
  const rewritten = new HTMLRewriter()
    .on(`select[name="${name}"] option`, new OptionCollector())
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  await rewritten.text();
  return value;
}

// textarea content is child text, not an attribute — HTMLRewriter's
// text() handler streams the raw text chunks inside a matched element
// (textarea is a spec-defined "raw text element", so this comes
// through as-is, not re-parsed as nested HTML).
async function extractTextareaValue(html, name) {
  let value = '';
  let found = false;
  class TextareaCollector {
    element() {
      found = true;
    }
    text(chunk) {
      value += chunk.text;
    }
  }
  const rewritten = new HTMLRewriter()
    .on(`textarea[name="${name}"]`, new TextareaCollector())
    .transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  await rewritten.text();
  return found ? value : null;
}

// Hardening idea #1: MFL's own structured export, not HTML scraping.
// Public — confirmed live to need no auth/cookies at all — but we pass
// the jar anyway since this runs mid-pipeline with cookies already set.
async function getLeagueExportData(jar, BASE, LEAGUE) {
  const { finalText } = await followWithCookies(`${BASE}/export?TYPE=league&L=${LEAGUE}&JSON=1`, { method: 'GET' }, jar);
  const data = JSON.parse(finalText);
  const franchisesRaw = data?.league?.franchises?.franchise;
  const list = Array.isArray(franchisesRaw) ? franchisesRaw : franchisesRaw ? [franchisesRaw] : [];
  const namesByFid = {};
  const sortOrderByFid = {};
  for (const f of list) {
    if (!f.id) continue;
    namesByFid[f.id] = f.name || f.abbrev || f.id;
    if (f.waiverSortOrder) sortOrderByFid[f.id] = Number(f.waiverSortOrder);
  }
  // Hardening idea #6 follow-up: this is a DIFFERENT setting than
  // WAIVER_ORDER on csetup?C=WAIVREQ (confirmed live — it's the only
  // waiver-related field in this export, alongside maxWaiverRounds) —
  // it's the league's overall waiver processing mode (FCFS vs.
  // traditional priority vs. budget/FAAB), not the sort-order setting.
  // So it doesn't let us drop the WAIVREQ scrape, but it's a useful
  // extra check on its own: this whole bot assumes an FCFS league.
  const currentWaiverType = data?.league?.currentWaiverType || null;

  // Commissioner send-target for alerting (emailMessage's SEND_TO),
  // determined dynamically rather than assumed — confirmed live this
  // varies per league. `commish_username` is real (verified in a live
  // response) but NOT named in MFL's published API schema, so treat a
  // missing/non-matching value as "couldn't determine it" rather than
  // an error — the caller falls back to MFL's own documented "0000"
  // sentinel for "commissioner with no owned franchise" (see the
  // General Information page's "Franchises" section) when no
  // franchise's username matches. That specific fallback path is
  // expected-per-the-docs but not yet live-tested end to end (no
  // access to a no-owned-franchise league to confirm against).
  const commishUsername = data?.league?.commish_username || null;
  let commissionerFranchiseId = null;
  if (commishUsername) {
    const match = list.find((f) => f.username === commishUsername);
    commissionerFranchiseId = match ? match.id : '0000';
  }

  return { namesByFid, sortOrderByFid, currentWaiverType, commishUsername, commissionerFranchiseId };
}

// MFL's official calendar export — confirmed real via MFL's own public
// API docs (api.myfantasyleague.com/{year}/api_info, checked
// 2026-08-19): export?TYPE=calendar&L={league}&JSON=1, "Returns a
// summary of the league calendar events," access restricted to league
// owners (same tier this bot already authenticates at, so no new
// capability needed). What's NOT yet confirmed: the exact JSON field
// names for an event's type/name — that's inferred from MFL's League
// Calendar Setup Help Center page's event-type list ("Process
// Waivers", "Put All Players on Waivers", etc.), not observed against
// real output. Parsing below is deliberately loose — a case-
// insensitive substring search across each event's own JSON, not a
// specific field path — specifically so a wrong guess about the exact
// schema fails soft (event just doesn't match, no warning fires)
// instead of throwing. This only ever feeds an informational warning
// (see runPipeline()); it can never affect the real waiver-order
// pipeline even if this parsing is completely wrong. Tighten to exact
// field paths once live-verified against a real league's output.
async function getLeagueCalendarEvents(jar, BASE, LEAGUE) {
  const { finalText } = await followWithCookies(`${BASE}/export?TYPE=calendar&L=${LEAGUE}&JSON=1`, { method: 'GET' }, jar);
  const data = JSON.parse(finalText);
  const eventsRaw = data?.calendar?.event ?? data?.calendar?.events ?? data?.leagueCalendar?.event ?? [];
  const list = Array.isArray(eventsRaw) ? eventsRaw : eventsRaw ? [eventsRaw] : [];

  const eventMentions = (ev, needles) => {
    const haystack = JSON.stringify(ev).toLowerCase();
    return needles.every((n) => haystack.includes(n));
  };

  const processWaiversEvents = list.filter((ev) => eventMentions(ev, ['process', 'waiver']));
  const putAllOnWaiversEvents = list.filter((ev) => eventMentions(ev, ['put', 'waiver']));

  return {
    raw: list,
    summary: {
      hasProcessWaiversEvent: processWaiversEvents.length > 0,
      hasPutAllOnWaiversEvent: putAllOnWaiversEvents.length > 0,
      processWaiversEvents,
      putAllOnWaiversEvents,
    },
  };
}

// Hardening idea #4: structural sanity checks, fail loud instead of
// silently proceeding on data that doesn't look right. This is what
// would have caught the franchise-name bug immediately instead of it
// sitting silent until a human noticed "Basic" on every row.
function assertSaneOrder(order, expectedCount) {
  if (order.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} franchises in order, got ${order.length}: [${order.join(',')}]`);
  }
  if (new Set(order).size !== order.length) {
    throw new Error(`Duplicate franchise ID in order: [${order.join(',')}]`);
  }
  const malformed = order.filter((id) => !/^\d{4}$/.test(id));
  if (malformed.length) {
    throw new Error(`Malformed franchise ID(s) in order: [${malformed.join(',')}]`);
  }
}

function assertSaneToken(inputExpires) {
  if (!/^\d{9,10}$/.test(inputExpires || '')) {
    throw new Error(`input_expires doesn't look like a unix timestamp: "${inputExpires}"`);
  }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Finding a Home Page Message slot to use for an ambient status
// display, and where to place it. Two genuinely separate questions,
// both answerable from MFL's real, public, documented `appearance`
// export (export?TYPE=appearance, no auth needed):
//
// (1) WHICH slot has saved content vs. is genuinely empty — checked
//     across ALL 20 slots via the public embed endpoint (confirmed
//     live: embed?MODULE=MESSAGE18 returns real content even though
//     #18 isn't placed on any tab right now — embed doesn't care
//     about placement, only content), highest-numbered first, on the
//     theory people fill these in starting from #1.
// (2) WHERE the native Waiver Wire Order widget sits in the tab/module
//     layout, so the chosen slot can be placed directly beneath it —
//     located generically (whichever tab/column it's actually in, for
//     any league) rather than assumed to be on a specific tab.
//
// NOTE: placing the chosen slot into the layout (editing Home Page
// Modules and Tabs Setup itself) is a confirmed-necessary, deliberate
// ONE-TIME MANUAL step (see README) — not automated. MFL's own
// developer API (checked: Import docs, and a third-party library that
// wraps the whole API) has no write/import counterpart to the real
// `appearance` export, and MFL's own tutorial content describes
// module placement as a manual drag-and-drop admin action. Automating
// that specifically would mean reverse-engineering an undocumented,
// UI-driven form with no official contract at all — a bigger, riskier
// lift than this feature needs, and a decision Travis wanted to make
// deliberately rather than have built silently.
//
// Slot #1 is deliberately excluded as a candidate — confirmed live
// that csetup?C=HMPGMSG&SEQNO=1 doesn't open slot #1's own editor (it
// creates a new, different, unlisted message instead), so it can't be
// reliably claimed via this mechanism even though it can be checked.
async function findEmptyMessageSlot(jar, BASE, LEAGUE) {
  const checks = await Promise.all(
    Array.from({ length: 20 }, (_, i) => 20 - i).map(async (slotNum) => {
      const moduleName = slotNum === 1 ? 'MESSAGE' : `MESSAGE${slotNum}`;
      const { finalText } = await followWithCookies(`${BASE}/embed?L=${LEAGUE}&MODULE=${moduleName}`, { method: 'GET' }, jar);
      const inner = finalText
        .replace(/^document\.write\('/, '')
        .replace(/'\);\s*$/, '')
        .replace(/<!--\s*Start Home Page Message \d+\s*-->/i, '')
        .replace(/<!--\s*End Home Page Message \d+\s*-->/i, '')
        .replace(/\\\r?\n/g, '')
        .trim();
      return { slot: slotNum, empty: inner.length === 0 };
    })
  );
  const found = checks.find((c) => c.empty && c.slot !== 1);
  return { slot: found ? found.slot : null, checks: checks.sort((a, b) => b.slot - a.slot) };
}

// A short, greppable marker identifying content this automation wrote
// — lets a future run verify it still owns a previously-claimed slot
// (rather than silently overwriting something a human put there after
// reclaiming the slot number) and lets a human recognize what this is
// if they stumble on it in the admin UI.
const STATUS_SLOT_MARKER = '<!-- mfl-waiver-order-automation:managed -->';

// report.error is normally a static, developer-written string, but on
// the generic catch-all path it's whatever err.message happened to be
// (e.g. a JSON.parse SyntaxError can echo a snippet of the response
// body it choked on) — escaped before going into HTML on principle,
// so this table can never come apart no matter what an error message
// contains.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildStatusSlotContent(report) {
  const when = report.ranAt ? new Date(report.ranAt).toLocaleString() : 'unknown time';
  const statusText = report.ok === false ? `⚠ Last run failed: ${escapeHtml(report.error || 'unknown error')}` : 'OK';
  return (
    `${STATUS_SLOT_MARKER}\n` +
    `<table class="report"><caption>Waiver Bot Status</caption><tbody>` +
    `<tr class="oddtablerow"><td>Status</td><td>${statusText}</td></tr>` +
    `<tr class="eventablerow"><td>Last checked</td><td>${when}</td></tr>` +
    `</tbody></table>`
  );
}

// Reads a slot's real edit-form fields (not guessed) — the hidden
// NAME field itself encodes which slot ("message" for #1, "message19"
// for #19, etc.), confirmed live; there's no separate SEQNO field to
// guess at.
async function readMessageSlotForm(jar, BASE, LEAGUE, slotNum) {
  const { finalText } = await followWithCookies(`${BASE}/csetup?L=${LEAGUE}&C=HMPGMSG&SEQNO=${slotNum}`, { method: 'GET' }, jar);
  const fields = await parseHiddenFields(finalText);
  const currentMsg = await extractTextareaValue(finalText, 'MSG');
  return { fields, currentMsg };
}

// Writes new content into a slot, resubmitting every other hidden
// field exactly as read (LABEL, etc.) — same "capture and resubmit,
// change only what's intended" pattern already proven for the
// WAIVORD write — EXCEPT IN_HEADER/IN_FOOTER, which are deliberately
// forced to "No" rather than preserved.
//
// Real error, confirmed live and corrected same-session: an unclaimed
// slot's untouched defaults are IN_HEADER=Yes, IN_FOOTER=Yes — which
// don't mean "show as a homepage module" (that's the separate
// tab/layout system entirely, per the manual-placement design this
// whole feature depends on) but "inject this raw HTML into the
// header/footer of every page on the site, sitewide, independent of
// any module placement." First live test preserved that default and
// the status table ended up injected above the entire page content
// area on every page, nowhere near Waiver Wire Order — not merely a
// wrong homepage position, sitewide injection. This is why slot #1
// (Travis's real "Fees Paid" message) never showed up in earlier
// visibility testing: not because IN_HEADER doesn't affect display,
// but because Travis had already turned it off on that specific slot
// when he originally set it up. This feature's entire design is
// "content only shows via the module the commissioner manually
// places" — IN_HEADER/IN_FOOTER=Yes bypasses and defeats that
// entirely, so both are explicitly forced off here, every time.
async function claimMessageSlot(jar, BASE, LEAGUE, slotNum, msgContent, label) {
  const { fields } = await readMessageSlotForm(jar, BASE, LEAGUE, slotNum);
  const body = new URLSearchParams(fields);
  body.set('MSG', msgContent);
  body.set('IN_HEADER', 'No');
  body.set('IN_FOOTER', 'No');
  if (label && !fields.LABEL) body.set('LABEL', label);
  const { res, finalText } = await followWithCookies(
    `${BASE}/message`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    jar
  );
  return { status: res.status, response: finalText.slice(0, 500) };
}

// Finds (or re-verifies) a slot to use, caching the result in KV so
// this only re-runs the expensive 20-slot scan when actually needed —
// first use, or if the cached slot's content no longer carries our
// marker (claimed by a human in the meantime). Does NOT place the
// slot in the homepage layout — see the big comment on
// findEmptyMessageSlot() above for why that's a deliberate one-time
// manual step instead.
async function findOrClaimStatusSlot(env, jar, BASE, LEAGUE, report) {
  const content = buildStatusSlotContent(report);
  const cachedRaw = env.STATUS_KV ? await env.STATUS_KV.get('status-slot') : null;
  const cachedSlot = cachedRaw ? parseInt(cachedRaw, 10) : null;

  if (cachedSlot) {
    const { finalText } = await followWithCookies(`${BASE}/embed?L=${LEAGUE}&MODULE=MESSAGE${cachedSlot}`, { method: 'GET' }, jar);
    if (finalText.includes(STATUS_SLOT_MARKER)) {
      const result = await claimMessageSlot(jar, BASE, LEAGUE, cachedSlot, content);
      return { slot: cachedSlot, newlyClaimed: false, write: result };
    }
    // Marker gone — a human claimed the number since we last used it.
    // Fall through to a fresh discovery rather than overwrite them.
  }

  const { slot } = await findEmptyMessageSlot(jar, BASE, LEAGUE);
  if (!slot) return { slot: null, error: 'No empty Home Page Message slot available (all 20 in use).' };
  const result = await claimMessageSlot(jar, BASE, LEAGUE, slot, content, 'Waiver Bot Status');
  if (env.STATUS_KV) await env.STATUS_KV.put('status-slot', String(slot));
  return { slot, newlyClaimed: true, write: result };
}

// Shared by both callers (the manual /claim-status-slot endpoint and
// the automatic hourly refresh from scheduled()) so the
// USE_ADVANCED_EDITOR safety check can't accidentally be skipped by
// one of them — single source of truth instead of two copies that
// could drift.
async function claimOrRefreshStatusSlotSafely(env, jar, BASE, LEAGUE, report) {
  // Confirmed live (csetup?C=REPSEC): "Yes" here runs a WYSIWYG editor
  // over type-in boxes that mangles raw HTML on save — unlike the
  // WAIVREQ settings check (which only warns, since MFL *might* later
  // override the order), this would corrupt the write immediately, so
  // it's a hard stop, not a warning.
  const { finalText: repsecText } = await followWithCookies(`${BASE}/csetup?L=${LEAGUE}&C=REPSEC`, { method: 'GET' }, jar);
  const advancedEditor = await extractCheckedRadio(repsecText, 'USE_ADVANCED_EDITOR');
  if (advancedEditor === 'Yes') {
    return {
      ok: false,
      error:
        `"Use 'Advanced Editor' on league type-in boxes?" is set to Yes (csetup?C=REPSEC) — this ` +
        `would mangle the raw HTML this feature writes. Set it to No first, then retry.`,
    };
  }
  const result = await findOrClaimStatusSlot(env, jar, BASE, LEAGUE, report);
  if (env.STATUS_KV) await env.STATUS_KV.put('status-slot-last-update', String(Date.now()));
  return result;
}

// Travis's explicit choice: refresh the ambient status once per hour,
// not every 2-minute cron tick — no point re-authenticating and
// re-writing a page element that frequently for something that's just
// an "is this thing alive" indicator, not real-time data.
const STATUS_SLOT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
async function shouldRefreshStatusSlot(env) {
  if (!env.STATUS_KV) return true;
  const raw = await env.STATUS_KV.get('status-slot-last-update');
  if (!raw) return true;
  const last = parseInt(raw, 10);
  return Number.isNaN(last) || Date.now() - last >= STATUS_SLOT_REFRESH_INTERVAL_MS;
}

// Locates WAIVER_ORDER generically — whichever tab and column it's
// actually placed in, for any league's layout, not assumed to be a
// specific tab. Returns the tab id/name and the module's index within
// that tab's module array (needed to insert something immediately
// after it later).
function findWaiverOrderPlacement(appearanceJson) {
  const tabsRaw = appearanceJson?.appearance?.tab;
  const tabs = Array.isArray(tabsRaw) ? tabsRaw : tabsRaw ? [tabsRaw] : [];
  for (const tab of tabs) {
    const modsRaw = tab?.module;
    const mods = Array.isArray(modsRaw) ? modsRaw : modsRaw ? [modsRaw] : [];
    const idx = mods.findIndex((m) => String(m?.name || '').startsWith('WAIVER_ORDER'));
    if (idx >= 0) return { tabId: tab.id, tabName: tab.name, index: idx, moduleNames: mods.map((m) => m.name) };
  }
  return null;
}

// Only alert on a NEW failure (previous run was ok), not on every tick
// of an ongoing outage — a 2-minute cron would otherwise spam the
// message board and the commissioner's inbox every 2 minutes for as
// long as something stays broken. If KV is unavailable or empty,
// default to alerting rather than staying silent.
async function shouldAlert(env) {
  if (!env.STATUS_KV) return true;
  const raw = await env.STATUS_KV.get('last-run');
  if (!raw) return true;
  try {
    const prev = JSON.parse(raw);
    return prev.ok !== false;
  } catch {
    return true;
  }
}

// FAILURE_NOTIFICATION_METHOD (Cloudflare dashboard Variable, not
// wrangler.toml) picks which channel(s) below actually fire. Default
// "email" (Travis's explicit choice, 2026-08-19) — deliberately not
// "both", so an unattended Message Board post isn't the default for
// every commissioner. Unrecognized value: warn and fall back to
// "email" rather than silently doing nothing, same "don't go quiet by
// accident" philosophy as shouldAlert() below.
const VALID_NOTIFICATION_METHODS = ['email', 'message_board', 'both', 'none'];

// Both channels use MFL's own official, documented Import API — not
// scraping, not a third-party service. Best-effort: failures here are
// caught and reported but never thrown, so a broken alert can't mask
// or replace the real error in the report.
async function sendFailureAlert(env, jar, BASE, LEAGUE, errorMessage) {
  let method = (env.FAILURE_NOTIFICATION_METHOD || 'email').trim().toLowerCase();
  if (!VALID_NOTIFICATION_METHODS.includes(method)) {
    console.log(`Warning: unrecognized FAILURE_NOTIFICATION_METHOD "${method}" — falling back to "email".`);
    method = 'email';
  }
  const wantsMessageBoard = method === 'message_board' || method === 'both';
  const wantsEmail = method === 'email' || method === 'both';

  const subject = 'MFL Waiver Bot — automation failure';
  const body =
    `The waiver-order automation hit an error and could not complete its run.\n\n` +
    `Error: ${errorMessage}\n\n` +
    (env.WORKER_STATUS_URL ? `Status: ${env.WORKER_STATUS_URL}\n\n` : '') +
    `(This is an automated message from the Cloudflare Worker automation.)`;

  const result = { method, messageBoard: null, email: null };

  if (wantsMessageBoard) {
    try {
      const params = new URLSearchParams({ TYPE: 'messageBoard', L: LEAGUE, FRANCHISE_ID: '0000', SUBJECT: subject, BODY: body });
      const { res, finalText } = await followWithCookies(`${BASE}/import?${params.toString()}`, { method: 'GET' }, jar);
      result.messageBoard = { status: res.status, response: finalText.slice(0, 500) };
    } catch (err) {
      result.messageBoard = { error: err.message };
    }
  } else {
    result.messageBoard = { skipped: `FAILURE_NOTIFICATION_METHOD=${method}` };
  }

  if (wantsEmail) {
    let sendTo = null;
    try {
      const leagueData = await getLeagueExportData(jar, BASE, LEAGUE);
      sendTo = leagueData.commissionerFranchiseId;
    } catch (err) {
      result.email = { skipped: `could not determine commissioner send target: ${err.message}` };
    }

    if (sendTo) {
      try {
        const params = new URLSearchParams({ TYPE: 'emailMessage', L: LEAGUE, SEND_TO: sendTo, SUBJECT: subject, BODY: body });
        const { res, finalText } = await followWithCookies(`${BASE}/import?${params.toString()}`, { method: 'GET' }, jar);
        result.email = { sentTo: sendTo, status: res.status, response: finalText.slice(0, 500) };
      } catch (err) {
        result.email = { sentTo: sendTo, error: err.message };
      }
    }
  } else {
    result.email = { skipped: `FAILURE_NOTIFICATION_METHOD=${method}` };
  }

  return result;
}
