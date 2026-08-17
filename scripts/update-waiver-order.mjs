/**
 * MFL Custom Waiver Order — recurring automation (GitHub Actions + Playwright)
 * ============================================================================
 *
 * Sets the Custom Waiver Order for a MyFantasyLeague.com league by reverse
 * recency of "Acquired" transactions (free agency / waiver pickups): the
 * franchise that most recently acquired a player goes to the BOTTOM of the
 * order (worst priority); a franchise with no qualifying activity — or the
 * least recent activity — goes to the TOP.
 *
 * WHY A REAL BROWSER (Playwright/Chromium) INSTEAD OF PLAIN fetch()
 * -------------------------------------------------------------------------
 * A prior attempt used a Cloudflare Worker doing programmatic HTTP requests
 * (login API + manual cookie jar). It consistently got served a stripped,
 * unauthenticated-looking page from MFL — even when using a cookie string
 * captured directly from a real, working, already-logged-in browser
 * session. That rules out "wrong/incomplete cookie" as the cause (a
 * genuinely valid cookie failed too), and direct probing found MFL sitting
 * on bare Apache/mod_perl with no visible third-party WAF/CDN fingerprint —
 * so it isn't an obvious "Cloudflare vs datacenter IP" block either. The
 * pattern (login succeeds, but the very next authenticated request looks
 * anonymous) is most consistent with some form of session/network-origin
 * binding that a serverless fetch() can't reproduce but a real, single,
 * continuous browser session naturally does — because every request in
 * this script, from login through the final POST, comes from the exact
 * same real Chromium instance, same TLS/HTTP stack, same IP, start to
 * finish, exactly like a human clicking through the site.
 *
 * MECHANISM
 * -------------------------------------------------------------------------
 * - Login: real form submission to the site's own /login page (selectors
 *   verified against MFL's live login HTML: input[name=USERNAME],
 *   input[name=PASSWORD], input[name=REMEMBER][value=Yes]).
 * - Reading current waiver order + the per-page-load `input_expires` token:
 *   real DOM reads on the Custom Waiver Order setup page
 *   (csetup?C=WAIVORD), not regex-on-raw-HTML — far less brittle.
 * - Computing target order: MFL's official `transactions` export API
 *   (export?TYPE=transactions&JSON=1), not HTML scraping of a transactions
 *   report. This is documented, structured data.
 * - Writing the new order: a direct POST to csetup, executed via
 *   `fetch()` *inside* the live authenticated page (page.evaluate), so it
 *   automatically carries the exact same cookies/origin as everything
 *   else in the session. This mirrors the mechanism confirmed to work in
 *   an earlier live browser-console test — just automated.
 *
 * ENV VARS
 * -------------------------------------------------------------------------
 *   MFL_USERNAME    (required, secret)   MFL account username
 *   MFL_PASSWORD    (required, secret)   MFL account password
 *   MFL_LEAGUE_URL  (required, variable) any URL from your league — e.g. its
 *                                        homepage, or the address bar while
 *                                        looking at any league page. The
 *                                        host, season year, and league ID
 *                                        are all parsed out of it — see
 *                                        parseLeagueUrl() below.
 *   DRY_RUN         (default "false")    if "true", computes and logs the
 *                                        target order but does NOT submit it
 *
 * There is no "is it really the right time" guard here — the workflow's
 * cron interval itself IS the schedule (see .github/workflows/waiver-order.yml),
 * and every run is a cheap no-op if nothing changed (see arraysEqual() in
 * main() below), so there's nothing to dedupe or gate on time-of-day.
 */

import { chromium } from 'playwright';

const USERNAME = process.env.MFL_USERNAME;
const PASSWORD = process.env.MFL_PASSWORD;
const DRY_RUN = /^true$/i.test(process.env.DRY_RUN || 'false');

// Every MFL league URL — its homepage, a report, a setup page, whatever
// someone happens to paste — follows the same three deterministic rules:
//   host:   "www" + digits, e.g. www44
//   year:   4 digits starting with "20", as its own path segment
//   league: always 5 digits, either an "L=" query param or a bare path
//           segment (e.g. .../2026/home/19186 vs .../options?L=19186&...)
// so a single pasted URL is enough to derive all three.
function parseLeagueUrl(url) {
  if (!url) {
    throw new Error(
      'MFL_LEAGUE_URL is not set. Paste any URL from your league — for example ' +
        'the address bar while viewing your league homepage, ' +
        'e.g. https://www44.myfantasyleague.com/2026/home/19186'
    );
  }

  const hostMatch = url.match(/(?:https?:\/\/)?(www\d+)\.myfantasyleague\.com/i);
  const yearMatch = url.match(/\/(20\d{2})(?:[/?]|$)/);
  const leagueMatch = url.match(/[?&]L=(\d{5})\b/i) || url.match(/\/(\d{5})(?:[/?]|$)/);

  const problems = [];
  if (!hostMatch) problems.push('a host like "www44" (expected https://www<digits>.myfantasyleague.com/...)');
  if (!yearMatch) problems.push('a 4-digit season year starting with "20" as its own path segment');
  if (!leagueMatch) problems.push('a 5-digit league ID, either as "L=12345" or its own path segment');

  if (problems.length) {
    throw new Error(
      `Could not parse MFL_LEAGUE_URL="${url}" — missing: ${problems.join('; ')}. ` +
        `Example of a URL that works: https://www44.myfantasyleague.com/2026/home/19186`
    );
  }

  return { host: hostMatch[1].toLowerCase(), year: yearMatch[1], league: leagueMatch[1] };
}

// Populated by assertConfig() at the start of main(), not at module load —
// so a bad/missing MFL_LEAGUE_URL fails the same clean, logged way as a
// missing secret, instead of as a raw uncaught exception before anything
// else runs.
let HOST, YEAR, LEAGUE, BASE;

// Transaction types that represent an "Acquired via free agency/waivers"
// event, per MFL's documented `transactions` export TRANS_TYPE values.
// Deliberately excludes TRADE, IR, TAXI, DRAFT, AUCTION_*, etc. — this is
// about waiver-wire activity specifically, not all roster moves.
const ACQUIRED_TYPES = ['WAIVER', 'BBID_WAIVER', 'FREE_AGENT'];

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function assertConfig() {
  const missing = [];
  if (!USERNAME) missing.push('MFL_USERNAME');
  if (!PASSWORD) missing.push('MFL_PASSWORD');
  if (missing.length) {
    throw new Error(`Missing required secret(s): ${missing.join(', ')}`);
  }

  ({ host: HOST, year: YEAR, league: LEAGUE } = parseLeagueUrl(process.env.MFL_LEAGUE_URL));
  BASE = `https://${HOST}.myfantasyleague.com/${YEAR}`;
}

async function main() {
  assertConfig();

  log(`Proceeding. DRY_RUN=${DRY_RUN} host=${HOST} year=${YEAR} league=${LEAGUE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    const authStart = Date.now();
    await login(page);
    await becomeCommissioner(page);
    log(`Auth phase (login + become commissioner) took ${Date.now() - authStart}ms.`);

    const franchises = await getFranchiseNames(page).catch((err) => {
      log('Warning: could not fetch franchise names (non-fatal):', err.message);
      return {};
    });

    const { fields, currentOrder } = await readWaiverSetupPage(page);
    const rankByFranchise = await computeAcquiredRanks(page);
    const targetOrder = computeTargetOrder(currentOrder, rankByFranchise);

    logOrderTable('CURRENT order', currentOrder, rankByFranchise, franchises);
    logOrderTable('TARGET  order', targetOrder, rankByFranchise, franchises);

    if (DRY_RUN) {
      log('DRY_RUN=true — not submitting. Exiting.');
      return;
    }

    if (arraysEqual(currentOrder, targetOrder)) {
      log('Target order is identical to current order — nothing to submit.');
      return;
    }

    await submitWaiverOrder(page, fields, targetOrder);
    log('Submitted new waiver order:', targetOrder.join(','));

    await verifyOnHomePage(page, targetOrder, franchises);
  } finally {
    await browser.close();
  }
}

// ────────────────────────────────────────────────────────────────────────

async function login(page) {
  // Including L={league} on the login URL itself (rather than the bare
  // /login) — confirmed live by the league owner via manual browser testing
  // as part of a 3-URL login shortcut (login?L=... -> logout?L=...&BECOME=0000
  // -> csetup?L=...&C=WAIVORD), which this function and becomeCommissioner()
  // below now follow directly instead of discovering the "Become
  // Commissioner" link via a DOM search on an intermediate home-page visit.
  const loginUrl = `${BASE}/login?L=${LEAGUE}`;
  log('Navigating to login page:', loginUrl);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

  await page.fill('input[name="USERNAME"]', USERNAME);
  await page.fill('input[name="PASSWORD"]', PASSWORD);
  const rememberYes = page.locator('input[name="REMEMBER"][value="Yes"]');
  if (await rememberYes.count()) {
    await rememberYes.check();
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('input[type="submit"][value="Login"]'),
  ]);

  const stillHasPasswordField = await page.locator('input[name="PASSWORD"]').count();
  if (stillHasPasswordField > 0) {
    const title = await page.title();
    const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 800);
    throw new Error(
      `Login appears to have failed — password field still present after submit. ` +
        `page title="${title}" url=${page.url()} bodySample="${bodyText}"`
    );
  }
  log('Login OK. Landed on:', page.url());
}

// Direct 3-URL shortcut (login?L=... -> logout?L=...&BECOME=0000 ->
// csetup?...): navigates straight to the known "Become Commissioner" URL
// instead of loading an intermediate page and DOM-searching for the link.
// Faster (one fewer full page load + no DOM query) and more robust (not
// dependent on the nav/dropdown markup that made a simulated .click() fail
// earlier). readWaiverSetupPage() still falls back to the DOM-search
// version (activateCommissionerModeIfNeeded) if this ever stops working.
async function becomeCommissioner(page) {
  const url = `${BASE}/logout?L=${LEAGUE}&BECOME=0000`;
  log('Navigating directly to "Become Commissioner" URL:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const loggedOut = await page.locator('input[name="PASSWORD"]').count();
  if (loggedOut > 0) {
    throw new Error(
      `After navigating to the "Become Commissioner" URL, the session looks logged out ` +
        `(a password field is present again) at url=${page.url()}.`
    );
  }
  log('Commissioner mode active. Landed on:', page.url(), '—', await page.title());
}

// MFL treats "authenticated" and "acting as commissioner for this league"
// as two separate session states — confirmed live: the account's own
// login is not enough on its own, but a league-scoped "Become
// Commissioner" link (href pattern: logout?L={league}&BECOME=0000) is
// present on league pages and switches the session into commissioner
// mode. Must be done on a page with league context (?L={league}) — it
// is NOT present on the generic post-login landing page.
//
// Fallback only (see becomeCommissioner() above for the normal path):
// discovers the link via DOM search instead of assuming the URL, used by
// readWaiverSetupPage() if commissioner mode didn't take for some reason.
async function activateCommissionerModeIfNeeded(page) {
  const link = page.locator('a', { hasText: /become\s+commissioner/i }).first();
  const count = await link.count();
  if (!count) {
    log('No "Become Commissioner" link found on this page — assuming already in commissioner mode.');
    return false;
  }
  const href = await link.getAttribute('href');
  log(`Found "Become Commissioner" link (href="${href}"). Navigating directly to it — it's a plain <a href>`);
  log(`sitting in a hover-only dropdown, so a simulated .click() fails Playwright's visibility/viewport checks.`);
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  log('After following "Become Commissioner":', page.url(), '—', await page.title());

  // The href's path is literally "logout" — sanity-check we're still an
  // authenticated session afterward and didn't just get logged all the way out.
  const loggedOut = await page.locator('input[name="PASSWORD"]').count();
  if (loggedOut > 0) {
    throw new Error(
      `After navigating to the "Become Commissioner" link, the session looks logged out ` +
        `(a password field is present again) at url=${page.url()}.`
    );
  }
  return true;
}

async function getFranchiseNames(page) {
  const url = `${BASE}/options?L=${LEAGUE}&O=01`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const names = await page.evaluate(() => {
    const out = {};
    // Franchise Information rows link to franchise?...&F=00NN and show the
    // owner/team name as link text. Be liberal in what we match — this is
    // best-effort logging context, not something the write path depends on.
    document.querySelectorAll('a[href*="F=00"]').forEach((a) => {
      const m = a.getAttribute('href').match(/F=(\d{4})/);
      if (m && a.textContent.trim()) {
        out[m[1]] = out[m[1]] || a.textContent.trim();
      }
    });
    return out;
  });
  return names;
}

async function readHiddenFields(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('input[type="hidden"]').forEach((el) => {
      if (el.name) out[el.name] = el.value;
    });
    return out;
  });
}

async function readWaiverSetupPage(page) {
  const url = `${BASE}/csetup?L=${LEAGUE}&C=WAIVORD`;
  log('Navigating to waiver setup page:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  let fields = await readHiddenFields(page);

  if (!fields.input_expires) {
    // Fallback: commissioner mode wasn't picked up on the league home page
    // for some reason — try activating it directly from this page (it was
    // observed to be present here too) and reload once before giving up.
    log('input_expires missing on first load — checking for a "Become Commissioner" link on this page.');
    const followed = await activateCommissionerModeIfNeeded(page);
    if (followed) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      fields = await readHiddenFields(page);
    }
  }

  if (!fields.input_expires) {
    const title = await page.title();
    const inputCount = await page.locator('input').count();
    // Grab the main content area rather than the first N chars of body
    // text, which on MFL pages is dominated by the mega-menu nav. Also
    // dump every commissioner-related link on the page verbatim so the
    // real mechanism is visible instead of guessed at again.
    const diag = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'))
        .filter((a) => /commiss/i.test(a.textContent || '') || /commiss/i.test(a.getAttribute('href') || ''))
        .map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') }));
      const main = document.querySelector('#content, .content, main, #main') || document.body;
      return { links, mainText: (main.innerText || '').slice(0, 1500) };
    });
    throw new Error(
      `Could not find input_expires on the waiver setup page — login may not have carried ` +
        `through, or this session isn't in commissioner mode, or MFL changed the page. ` +
        `url=${url} title="${title}" totalInputs=${inputCount} ` +
        `commissionerLinks=${JSON.stringify(diag.links)} mainTextSample="${diag.mainText}"`
    );
  }

  const count = parseInt(fields.WAIVER_ORDER_LEAGUE_COUNT || '0', 10);
  if (!count) {
    throw new Error(`WAIVER_ORDER_LEAGUE_COUNT missing or zero. Fields seen: ${JSON.stringify(fields)}`);
  }

  const currentOrder = [];
  for (let i = 1; i <= count; i++) {
    const fid = fields[`WAIVER_ORDER_LEAGUE_${i}`];
    if (!fid) throw new Error(`Missing WAIVER_ORDER_LEAGUE_${i} among hidden fields.`);
    currentOrder.push(fid);
  }

  log(`Read ${count} franchises, input_expires=${fields.input_expires}`);
  return { fields, currentOrder };
}

async function computeAcquiredRanks(page) {
  const types = ACQUIRED_TYPES.join(',');
  const url = `${BASE}/export?TYPE=transactions&L=${LEAGUE}&TRANS_TYPE=${encodeURIComponent(types)}&JSON=1`;
  log('Fetching transactions export:', url);

  const raw = await page.evaluate(async (u) => {
    const res = await fetch(u, { credentials: 'include' });
    const text = await res.text();
    return { status: res.status, text };
  }, url);

  if (raw.status !== 200) {
    throw new Error(`Transactions export returned HTTP ${raw.status}. Body sample: ${raw.text.slice(0, 500)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.text);
  } catch (err) {
    throw new Error(`Transactions export did not return valid JSON. Body sample: ${raw.text.slice(0, 500)}`);
  }

  if (parsed.error) {
    throw new Error(`Transactions export returned an error: ${JSON.stringify(parsed.error)}`);
  }

  let list = parsed?.transactions?.transaction ?? [];
  if (!Array.isArray(list)) list = list ? [list] : [];

  log(`Transactions export returned ${list.length} matching transaction(s) (types: ${types}).`);
  if (DRY_RUN && list.length) {
    log('Sample transaction record(s):', JSON.stringify(list.slice(0, 3), null, 2));
  }

  // Most-recent-timestamp-wins per franchise.
  const rankByFranchise = {};
  for (const tx of list) {
    const fid = String(tx.franchise || '').padStart(4, '0');
    const ts = Number(tx.timestamp || 0);
    if (!fid || !ts) continue;
    if (!rankByFranchise[fid] || ts > rankByFranchise[fid]) {
      rankByFranchise[fid] = ts;
    }
  }
  return rankByFranchise;
}

function computeTargetOrder(currentOrder, rankByFranchise) {
  // Ascending by most-recent-acquisition timestamp: franchises with no
  // qualifying activity (undefined -> 0) sort first (top = best waiver
  // priority); the most recently active franchise sorts last (bottom =
  // worst priority). Stable sort preserves current relative order among
  // ties (e.g. multiple franchises with zero activity).
  return currentOrder
    .map((fid, idx) => ({ fid, idx, ts: rankByFranchise[fid] || 0 }))
    .sort((a, b) => (a.ts - b.ts) || (a.idx - b.idx))
    .map((x) => x.fid);
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function logOrderTable(label, order, rankByFranchise, franchises) {
  log(`${label}:`);
  order.forEach((fid, i) => {
    const ts = rankByFranchise[fid];
    const when = ts ? new Date(ts * 1000).toISOString() : '(no acquisitions on record)';
    const name = franchises[fid] ? ` — ${franchises[fid]}` : '';
    log(`  ${i + 1}. F${fid}${name}  last acquired: ${when}`);
  });
}

async function submitWaiverOrder(page, fields, targetOrder) {
  const postUrl = `${BASE}/csetup`;
  const body = new URLSearchParams();
  body.append('form_name', 'WAIVORD');
  body.append('LEAGUE_ID', LEAGUE);
  body.append('C', 'WAIVORD');
  body.append('input_expires', fields.input_expires);
  body.append('WAIVER_ORDER_LEAGUE_COUNT', String(targetOrder.length));
  body.append('WAIVER_ORDER_LEAGUE_SHOW_INDEX', fields.WAIVER_ORDER_LEAGUE_SHOW_INDEX || '1');
  targetOrder.forEach((fid, i) => body.append(`WAIVER_ORDER_LEAGUE_${i + 1}`, fid));
  // Deliberately NOT including DELETE_CUSTOM — even an unchecked/empty
  // value risks being read as "delete the custom order".

  const result = await page.evaluate(
    async ({ url, bodyStr }) => {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyStr,
      });
      return { status: res.status, text: (await res.text()).slice(0, 500) };
    },
    { url: postUrl, bodyStr: body.toString() }
  );

  if (result.status < 200 || result.status >= 400) {
    throw new Error(`POST to ${postUrl} failed with HTTP ${result.status}. Body sample: ${result.text}`);
  }
  log(`POST to csetup returned HTTP ${result.status}.`);
}

async function verifyOnHomePage(page, targetOrder, franchises) {
  const url = `${BASE}/home/${LEAGUE}`;
  log('Verifying on league home page:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const widgetText = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const header = all.find((el) => /waiver wire order/i.test(el.textContent || '') && el.children.length < 5);
    if (!header) return null;
    // Walk up to a reasonably-sized ancestor container and grab its text.
    let container = header;
    for (let i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;
    return container.innerText;
  });

  if (!widgetText) {
    log('Warning: could not locate a "Waiver Wire Order" widget on the home page to verify against — check manually.');
    return;
  }

  const customInEffect = /custom waiver order in effect/i.test(widgetText);
  log(`Home page widget found. "Custom Waiver Order In Effect" notice present: ${customInEffect}`);
  log('Home page widget text:\n' + widgetText.trim());
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
