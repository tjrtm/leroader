// End-to-end test: loads the unpacked extension into a real Chromium (or Brave)
// and counts actual page reloads against a local HTTP server.
//
//   node tests/e2e.mjs                 # Playwright Chromium, headless
//   BROWSER=brave node tests/e2e.mjs   # your installed Brave, throwaway profile
//
// Uses an isolated temporary profile; never touches your real browser profile.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'tests', 'artifacts');
fs.mkdirSync(ART, { recursive: true });

const hits = {};
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  hits[p] = (hits[p] || 0) + 1;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(`<!doctype html><title>Test page ${p}</title><body style="background:#222;color:#eee;font:20px system-ui"><h1>${p}</h1><p>load ${hits[p]}</p>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Observed flake: `worker.evaluate` on our own extension worker threw
 * "ReferenceError: chrome is not defined" right after attach. Probe until the
 * extension APIs exist, report what the first probe saw, and fail loudly on timeout.
 */
async function waitForExtensionApis(worker, timeoutMs = 5000) {
  const start = Date.now();
  let attempts = 0;
  let first = null;
  let last = null;
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const ok = await worker.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage);
      last = ok ? 'ready' : 'chrome.storage missing';
    } catch (err) {
      last = `threw: ${String(err.message).split('\n')[0]}`;
    }
    first ??= last;
    if (last === 'ready') return { attempts, ms: Date.now() - start, first };
    await sleep(100);
  }
  throw new Error(`extension worker APIs not ready after ${timeoutMs}ms (${attempts} probes, last: ${last})`);
}

const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'leroader-e2e-'));
const useBrave = process.env.BROWSER === 'brave';
// Prefer an explicit CHROMIUM path, else the newest cached Chrome for Testing, else Playwright's default.
function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const d of dirs) {
    const exe = path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}
const chromiumExe = findChromium();
const ctx = await chromium.launchPersistentContext(profile, {
  ...(useBrave
    ? { executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' }
    : chromiumExe ? { executablePath: chromiumExe } : { channel: 'chromium' }),
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--no-first-run', '--no-default-browser-check'],
});

const pageErrors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`${label} console: ${m.text()}`); });
};

try {
  const ours = (w) => w.url().startsWith('chrome-extension://') && w.url().endsWith('/background.js');
  let sw = ctx.serviceWorkers().find(ours);
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { predicate: ours, timeout: 15000 });
  const readiness = await waitForExtensionApis(sw);
  console.log(`worker APIs ready after ${readiness.attempts} probe(s), ${readiness.ms}ms; first probe: ${readiness.first}`);
  const extId = new URL(sw.url()).host;
  console.log(`browser: ${useBrave ? 'Brave' : 'Chromium'} ${ctx.browser()?.version() ?? ''}  extension: ${extId}`);

  const setSettings = (patch) => sw.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...p } });
  }, patch);
  const getSettings = () => sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  const tabIdFor = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  const badgeFor = (tabId) => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  const delta = async (paths, ms) => {
    const before = Object.fromEntries(paths.map((p) => [p, hits[p] || 0]));
    await sleep(ms);
    return Object.fromEntries(paths.map((p) => [p, (hits[p] || 0) - before[p]]));
  };

  // ---------------------------------------------------------------- behaviour
  const pageA = ctx.pages()[0] || await ctx.newPage();
  await pageA.goto(`${BASE}/a`);
  let s0;
  for (let i = 0; i < 30 && !s0; i++) { s0 = await getSettings(); if (!s0) await sleep(100); }
  check('installs with auto reload OFF and 30s default', s0?.enabled === false && s0.defaultInterval === 30 && s0.scope === 'active');

  let d = await delta(['/a'], 6500);
  check('OFF: page is never reloaded', d['/a'] === 0, `reloads=${d['/a']}`);

  await setSettings({ enabled: true, defaultInterval: 5, scope: 'active' });
  d = await delta(['/a'], 12500);
  check('ON, 5s, visible tab: reloads about every 5s', d['/a'] >= 2 && d['/a'] <= 3, `reloads in 12.5s=${d['/a']}`);
  const tabA = await tabIdFor(`${BASE}/a`);
  let badge = '';
  for (let i = 0; i < 3 && !badge; i++) { badge = await badgeFor(tabA); if (!badge) await sleep(1000); }
  check('toolbar badge shows countdown', /^\d+s$/.test(badge), `badge="${badge}"`);

  const pageB = await ctx.newPage();
  await pageB.goto(`${BASE}/b`);
  await pageB.bringToFront();
  d = await delta(['/a', '/b'], 13500);
  check('Visible-tab scope: only the visible tab reloads', d['/b'] >= 2 && d['/a'] === 0, JSON.stringify(d));

  await setSettings({ scope: 'rules', rules: [{ id: 'r1', sourceUrl: `${BASE}/a`, mode: 'page', interval: 5 }] });
  d = await delta(['/a', '/b'], 12500);
  check('Rules-only scope: background rule page reloads, others do not', d['/a'] >= 2 && d['/b'] === 0, JSON.stringify(d));

  await setSettings({ scope: 'all', rules: [{ id: 'r1', sourceUrl: `${BASE}/a`, mode: 'page', interval: 5, action: 'skip' }] });
  d = await delta(['/a', '/b'], 12500);
  check('All-tabs scope + "never reload" rule excludes that page', d['/b'] >= 2 && d['/a'] === 0, JSON.stringify(d));

  await setSettings({ enabled: false });
  await sleep(1500);
  d = await delta(['/a', '/b'], 7000);
  check('switching OFF stops everything', d['/a'] === 0 && d['/b'] === 0, JSON.stringify(d));
  const badgeOff = await badgeFor(await tabIdFor(`${BASE}/b`));
  check('badge cleared when OFF', badgeOff === '', `badge="${badgeOff}"`);

  // ---------------------------------------------------------------- options page UI
  const opt = await ctx.newPage();
  watch(opt, 'options');
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForSelector('.tile');

  await opt.click('#master');
  await sleep(300);
  check('options: master switch turns ON', (await getSettings()).enabled === true);

  await opt.click('#defaultPicker [aria-label="Longer interval"]');
  await sleep(300);
  check('options: + button steps default 5s -> 10s', (await getSettings()).defaultInterval === 10);

  await opt.click('#defaultPicker .chip[data-sec="300"]');
  await sleep(300);
  check('options: quick chip sets 5m', (await getSettings()).defaultInterval === 300);

  // Drag the slider all the way to the right with a real pointer.
  const box = await opt.locator('#defaultPicker .slider').boundingBox();
  await opt.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await opt.mouse.down();
  await opt.mouse.move(box.x + box.width + 40, box.y + box.height / 2, { steps: 8 });
  await opt.mouse.up();
  await sleep(300);
  check('options: dragging slider to the end gives 5 hours', (await getSettings()).defaultInterval === 18000);

  await opt.click('.tile[data-value="active"]');
  await sleep(300);
  check('options: scope tile selects Visible tab', (await getSettings()).scope === 'active');

  // Add a rule by tapping an open tab (no typing).
  await opt.locator('.tab-item', { hasText: 'Test page /b' }).click();
  await sleep(500);
  let st = await getSettings();
  const added = st.rules.find((r) => r.sourceUrl === `${BASE}/b`);
  check('options: tapping an open tab adds a whole-site rule', !!added && added.mode === 'site' && added.host === '127.0.0.1');
  check('options: new rule card is expanded', await opt.locator(`.rule[data-id="${added?.id}"] .rule-body`).isVisible());

  await opt.locator(`.rule[data-id="${added.id}"] .seg button[data-value="page"]`).click();
  await opt.locator(`.rule[data-id="${added.id}"] .chip[data-sec="60"]`).click();
  await sleep(400);
  st = await getSettings();
  const edited = st.rules.find((r) => r.id === added.id);
  check('options: rule match + interval editable by tapping', edited.mode === 'page' && edited.interval === 60 && edited.url === `${BASE}/b`);

  await opt.click('.manual summary');
  await opt.fill('#manualUrl', 'example.com/dashboard');
  await opt.click('#manualForm button');
  await sleep(400);
  st = await getSettings();
  check('options: typed address fallback adds a page rule', st.rules.some((r) => r.url === 'https://example.com/dashboard' && r.mode === 'page'));

  await opt.locator(`.rule[data-id="${added.id}"] .btn.danger`).click();
  await sleep(400);
  check('options: delete rule', !(await getSettings()).rules.some((r) => r.id === added.id));

  // Layout audit at several widths.
  for (const [w, hgt] of [[1440, 1000], [1024, 900], [768, 1000], [390, 844]]) {
    await opt.setViewportSize({ width: w, height: hgt });
    await sleep(250);
    const m = await opt.evaluate(() => {
      const de = document.documentElement;
      const small = [...document.querySelectorAll('button, .switch, input[type=range]')]
        .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 34)
        .map((b) => b.className || b.tagName);
      const wide = [...document.querySelectorAll('body *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > de.clientWidth + 1)
        .map((e) => `${e.tagName}.${e.className}`).slice(-4);
      if (de.scrollWidth > de.clientWidth) small.push(...wide);
      // Nothing may poke out of its card.
      for (const card of document.querySelectorAll('.card')) {
        const cr = card.getBoundingClientRect();
        for (const e of card.querySelectorAll('*')) {
          if (!e.offsetParent || e.closest('.tab-picker') && e !== e.closest('.tab-picker')) continue;
          const r = e.getBoundingClientRect();
          if (r.right > cr.right + 1 || r.left < cr.left - 1) { small.push(`out:${e.tagName}.${e.className}`); break; }
        }
      }
      const cols = getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length;
      return { overflow: de.scrollWidth - de.clientWidth, small, cols };
    });
    check(`options @${w}px: no horizontal overflow, touch-size controls`, m.overflow <= 0 && m.small.length === 0, `cols=${m.cols} overflow=${m.overflow} small=${m.small.slice(0, 4).join('|')}`);
    await opt.screenshot({ path: path.join(ART, `options-${w}.png`), fullPage: true });
  }

  // ---------------------------------------------------------------- popup UI
  // The preview opens as a tab (a real popup does not), so use All-tabs scope to keep tab A on a timer.
  await setSettings({ enabled: true, defaultInterval: 30, scope: 'all', rules: [] });
  const pop = await ctx.newPage();
  watch(pop, 'popup');
  await pop.setViewportSize({ width: 368, height: 600 });
  await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabA}`);
  await pop.waitForSelector('.picker');
  await sleep(1200);
  const popInfo = await pop.evaluate(() => ({
    host: document.getElementById('host').textContent,
    why: document.getElementById('why').textContent,
    count: document.getElementById('count').textContent,
    height: document.body.scrollHeight, // body is capped at 600px; scrollHeight shows true content height
    parts: [...document.querySelectorAll('header, main > section, footer, .picker-head, .slider-wrap, .chips')].map((e) => `${e.id || e.className.split(' ')[0] || e.tagName}:${Math.round(e.getBoundingClientRect().height)}`).join(' '),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  check('popup: shows the tab and a live countdown', popInfo.host === '127.0.0.1' && /^0:\d\d$/.test(popInfo.count), `${popInfo.count} · ${popInfo.why}`);
  check('popup: fits the 368×600 popup without scrolling', popInfo.overflow <= 0 && popInfo.height <= 600, `height=${popInfo.height}px ${popInfo.parts}`);
  await pop.screenshot({ path: path.join(ART, 'popup-on.png'), fullPage: true });

  await pop.click('.seg button[data-value="site"]');
  await sleep(300);
  await pop.click('[aria-label="Shorter interval"]');
  await sleep(400);
  st = await getSettings();
  check('popup: "This site" creates a rule; − edits the rule, not the default',
    st.rules.length === 1 && st.rules[0].mode === 'site' && st.rules[0].interval === 20 && st.defaultInterval === 30,
    JSON.stringify(st.rules.map((r) => [r.mode, r.interval])));
  await pop.screenshot({ path: path.join(ART, 'popup-rule.png'), fullPage: true });

  await pop.click('.seg button[data-value="default"]');
  await sleep(300);
  check('popup: "Default" removes the site rule again', (await getSettings()).rules.length === 0);

  await pop.click('#master');
  await sleep(1300);
  check('popup: master switch turns OFF', (await getSettings()).enabled === false);
  await pop.screenshot({ path: path.join(ART, 'popup-off.png'), fullPage: true });

  // Keyboard shortcut command exists.
  const cmds = await opt.evaluate(() => chrome.commands.getAll());
  check('shortcut command registered', cmds.some((c) => c.name === 'toggle-reload'), cmds.map((c) => `${c.name}=${c.shortcut}`).join(', '));

  check('no page errors in popup/options', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('test run completed', false, err.stack || String(err));
} finally {
  await ctx.close().catch(() => {});
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
