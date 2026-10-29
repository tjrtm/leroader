// Leroader service worker: owns every countdown and performs the reloads.
//
// While auto reload is ON a 1-second loop runs (each tick makes extension API
// calls, which keeps the MV3 worker alive). A 30 s alarm restarts the loop if
// the browser ever suspends the worker. While OFF nothing runs at all.

import {
  getSettings, normalizeSettings, planForTab, badgeText, formatInterval, updateSettings,
} from './src/shared.js';

const ALARM = 'leroader-wake';
const BADGE_ON = '#1f8f6a';

let settings = normalizeSettings();
/** tabId -> { due, interval, source, ruleId, started, reloads } */
let timers = new Map();
/** tabId -> last badge text we set (so we only touch what changed) */
const badges = new Map();
let loopTimer = null;
let loopAlive = false;

const ready = (async () => {
  settings = await getSettings();
  const { timers: saved } = await chrome.storage.session.get('timers');
  timers = new Map(Object.entries(saved || {}).map(([k, v]) => [Number(k), v]));
  await applyChrome();
})();

function persist() {
  chrome.storage.session.set({ timers: Object.fromEntries(timers) }).catch(() => {});
}

// ------------------------------------------------------------------ chrome UI

async function applyChrome() {
  const on = settings.enabled;
  const set = on ? 'on' : 'off';
  await chrome.action.setIcon({
    path: { 16: `icons/${set}-16.png`, 32: `icons/${set}-32.png`, 48: `icons/${set}-48.png`, 128: `icons/${set}-128.png` },
  }).catch(() => {});
  await chrome.action.setTitle({ title: on ? `Leroader: on (default ${formatInterval(settings.defaultInterval)})` : 'Leroader: off' });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_ON }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' })?.catch?.(() => {});
  if (on) {
    chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  } else {
    await chrome.alarms.clear(ALARM);
  }
}

async function clearAllBadges() {
  for (const tabId of badges.keys()) {
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
  badges.clear();
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}

function setBadge(tabId, text) {
  if (badges.get(tabId) === text) return;
  badges.set(tabId, text);
  chrome.action.setBadgeText({ tabId, text }).catch(() => badges.delete(tabId));
}

// ------------------------------------------------------------------ the loop

async function tick() {
  clearTimeout(loopTimer);
  loopTimer = null;
  await ready;

  if (!settings.enabled) {
    loopAlive = false;
    if (timers.size) { timers.clear(); persist(); }
    await clearAllBadges();
    return;
  }
  loopAlive = true;

  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch { /* window closing */ }
  const now = Date.now();
  const seen = new Set();
  let changed = false;

  for (const tab of tabs) {
    if (tab.discarded) continue; // asleep: it will load fresh when you open it
    const plan = planForTab(tab, settings);
    if (!plan) continue;
    seen.add(tab.id);

    let t = timers.get(tab.id);
    if (!t || t.interval !== plan.interval || t.ruleId !== plan.ruleId || t.source !== plan.source) {
      t = { ...plan, started: now, due: now + plan.interval * 1000, reloads: t?.reloads || 0 };
      timers.set(tab.id, t);
      changed = true;
    } else if (now >= t.due) {
      chrome.tabs.reload(tab.id, { bypassCache: settings.hardReload }).catch(() => {});
      t.started = now;
      t.due = now + t.interval * 1000;
      t.reloads = (t.reloads || 0) + 1;
      t.lastReload = now;
      changed = true;
    }
  }

  for (const id of [...timers.keys()]) {
    if (!seen.has(id)) { timers.delete(id); changed = true; }
  }
  if (changed) persist();

  // Badge: only the active tab of each window is visible on the toolbar.
  for (const tab of tabs) {
    if (!tab.active) continue;
    const t = timers.get(tab.id);
    setBadge(tab.id, settings.showBadge && t ? badgeText(t.due - now) : '');
  }
  for (const id of [...badges.keys()]) {
    if (!timers.has(id) && badges.get(id)) setBadge(id, '');
  }

  // Wake at the next whole second (badge) or the next reload, whichever is sooner.
  const nowAfter = Date.now();
  let wait = 1000 - (nowAfter % 1000) + 20;
  for (const t of timers.values()) wait = Math.min(wait, Math.max(15, t.due - nowAfter + 5));
  loopTimer = setTimeout(tick, wait);
}

function kick() {
  tick().catch((err) => {
    console.error('[leroader] tick failed', err);
    loopTimer = setTimeout(kick, 2000);
  });
}

// ------------------------------------------------------------------ events

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = settings;
  settings = normalizeSettings(changes.settings.newValue);
  if (before.enabled !== settings.enabled || before.defaultInterval !== settings.defaultInterval) applyChrome();
  if (!settings.showBadge) clearAllBadges();
  kick();
});

// Count from when the page finished loading, not from when the reload began.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // The browser wipes per-tab badge text on navigation; forget our cache so it is re-set.
  if (info.status === 'loading') badges.delete(tabId);
  if (info.status !== 'complete') return;
  const t = timers.get(tabId);
  if (!t) return;
  const now = Date.now();
  t.started = now;
  t.due = now + t.interval * 1000;
  persist();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  badges.delete(tabId);
  if (timers.delete(tabId)) persist();
});

chrome.tabs.onActivated.addListener(() => { if (settings.enabled) kick(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM && !loopAlive) kick();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-reload') {
    await updateSettings((s) => { s.enabled = !s.enabled; });
  }
});

chrome.runtime.onStartup.addListener(kick);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const { settings: existing } = await chrome.storage.local.get('settings');
    if (!existing) await chrome.storage.local.set({ settings: normalizeSettings() });
  }
  kick();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    await ready;
    switch (msg?.type) {
      case 'getState': {
        reply({
          now: Date.now(),
          settings,
          timers: [...timers.entries()].map(([tabId, t]) => ({ tabId, ...t })),
        });
        break;
      }
      case 'reloadNow': {
        const tab = await chrome.tabs.get(msg.tabId).catch(() => null);
        if (tab) {
          await chrome.tabs.reload(tab.id, { bypassCache: settings.hardReload }).catch(() => {});
          const t = timers.get(tab.id);
          if (t) {
            t.started = Date.now();
            t.due = t.started + t.interval * 1000;
            t.reloads = (t.reloads || 0) + 1;
            persist();
          }
        }
        reply({ ok: !!tab });
        break;
      }
      default:
        reply({ ok: false });
    }
  })();
  return true; // async reply
});

kick();
