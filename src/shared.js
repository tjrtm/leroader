// Shared model: settings, interval scale, rule matching, formatting.
// Imported by the service worker, popup and options page.

/** Snap points for the interval slider (seconds), 5 s … 5 h. */
export const INTERVALS = [
  5, 10, 15, 20, 30, 40, 50,
  60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2700,
  3600, 5400, 7200, 10800, 14400, 18000,
];

/** Quick-pick chips shown under the slider. */
export const QUICK_PICKS = [10, 30, 60, 300, 900, 3600];
export const QUICK_PICKS_COMPACT = [10, 30, 60, 300, 3600];

/** Labels drawn under the slider track. */
export const TICK_MARKS = [5, 30, 60, 300, 3600, 18000];

export const SCOPES = {
  active: {
    label: 'Visible tab',
    short: 'Visible',
    desc: 'Only the tab you are looking at, in each window. Switching tabs restarts the countdown.',
  },
  all: {
    label: 'All tabs',
    short: 'All tabs',
    desc: 'Every open web tab. Sleeping (discarded) tabs are left alone.',
  },
  rules: {
    label: 'Site rules only',
    short: 'Rules only',
    desc: 'Nothing reloads unless a site rule matches the page.',
  },
};

export const MODES = {
  site: { label: 'Whole site', desc: 'Any page on this domain and its subdomains' },
  prefix: { label: 'Path & below', desc: 'This path and everything under it' },
  page: { label: 'Exact page', desc: 'Only this exact address' },
};

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  defaultInterval: 30,
  scope: 'active',
  hardReload: false,
  showBadge: true,
  rules: [],
});

// ---------------------------------------------------------------- settings

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.enabled = !!s.enabled;
  s.hardReload = !!s.hardReload;
  s.showBadge = s.showBadge !== false;
  if (!SCOPES[s.scope]) s.scope = DEFAULT_SETTINGS.scope;
  s.defaultInterval = snapInterval(s.defaultInterval);
  s.rules = Array.isArray(s.rules) ? s.rules.map(normalizeRule).filter(Boolean) : [];
  return s;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

/** Read-modify-write. `fn` receives a draft copy and may mutate or return a new object. */
export async function updateSettings(fn) {
  const cur = await getSettings();
  const draft = structuredClone(cur);
  const next = normalizeSettings(fn(draft) ?? draft);
  await chrome.storage.local.set({ settings: next });
  return next;
}

// ---------------------------------------------------------------- intervals

export function snapIndex(sec) {
  let best = 0;
  let bestDist = Infinity;
  INTERVALS.forEach((v, i) => {
    const d = Math.abs(Math.log(v) - Math.log(Math.max(1, Number(sec) || 30)));
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

export function snapInterval(sec) {
  return INTERVALS[snapIndex(sec)];
}

/** Short label: 5s, 1m 30s, 2h. */
export function formatInterval(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Spoken label for screen readers: "1 minute 30 seconds". */
export function formatIntervalLong(sec) {
  const parts = [];
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (s) parts.push(`${s} second${s > 1 ? 's' : ''}`);
  return parts.join(' ');
}

/** Big readout split into value + unit: {value:'1:30', unit:'min'}. */
export function splitInterval(sec) {
  if (sec < 60) return { value: String(sec), unit: 'sec' };
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return { value: r ? `${m}:${String(r).padStart(2, '0')}` : String(m), unit: 'min' };
  }
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return { value: m ? `${h}:${String(m).padStart(2, '0')}` : String(h), unit: h === 1 && !m ? 'hour' : 'hours' };
}

/** Countdown clock: 0:07, 4:05, 1:02:03. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Toolbar badge (max ~4 chars). */
export function badgeText(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 6000) return `${Math.ceil(sec / 60)}m`;
  return `${Math.ceil(sec / 3600)}h`;
}

// ---------------------------------------------------------------- rules

export function isReloadableUrl(url) {
  return typeof url === 'string' && /^(https?|file):/i.test(url);
}

function safeUrl(url) {
  try { return new URL(url); } catch { return null; }
}

export function siteHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

/** Turn something the user typed ("example.com/foo") into a URL. */
export function parseUserUrl(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const u = safeUrl(t) || safeUrl(`https://${t}`);
  if (!u || !isReloadableUrl(u.href) || (u.protocol !== 'file:' && !u.hostname.includes('.') && u.hostname !== 'localhost')) return null;
  return u;
}

/** Compute the stored match target for a rule from its source URL + mode. */
export function ruleTarget(sourceUrl, mode) {
  const u = safeUrl(sourceUrl);
  if (!u) return null;
  if (mode === 'site') return { host: siteHost(u.hostname) || u.protocol, url: '' };
  if (mode === 'prefix') return { host: siteHost(u.hostname), url: `${u.origin}${u.pathname}` };
  return { host: siteHost(u.hostname), url: `${u.origin}${u.pathname}${u.search}` };
}

export function makeRule(sourceUrl, mode = 'site', interval = 30) {
  const target = ruleTarget(sourceUrl, mode);
  if (!target) return null;
  return normalizeRule({
    id: (crypto.randomUUID?.() || String(Date.now() + Math.random())),
    sourceUrl,
    mode,
    ...target,
    interval,
    action: 'reload',
    enabled: true,
    created: Date.now(),
  });
}

export function normalizeRule(r) {
  if (!r || !r.sourceUrl) return null;
  const mode = MODES[r.mode] ? r.mode : 'site';
  const target = ruleTarget(r.sourceUrl, mode);
  if (!target) return null;
  return {
    id: String(r.id || crypto.randomUUID()),
    sourceUrl: r.sourceUrl,
    mode,
    host: target.host,
    url: target.url,
    interval: snapInterval(r.interval),
    action: r.action === 'skip' ? 'skip' : 'reload',
    enabled: r.enabled !== false,
    created: r.created || Date.now(),
  };
}

/** Identity used to avoid duplicate rules. */
export function ruleKey(rule) {
  return rule.mode === 'site' ? `site:${rule.host}` : `${rule.mode}:${rule.url}`;
}

export function ruleMatches(rule, url) {
  const u = safeUrl(url);
  if (!u) return false;
  switch (rule.mode) {
    case 'site': {
      const host = siteHost(u.hostname);
      return host === rule.host || host.endsWith(`.${rule.host}`);
    }
    case 'prefix':
      return `${u.origin}${u.pathname}${u.search}`.startsWith(rule.url);
    case 'page':
      return `${u.origin}${u.pathname}${u.search}` === rule.url;
    default:
      return false;
  }
}

function specificity(rule) {
  const base = { page: 3e6, prefix: 2e6, site: 1e6 }[rule.mode] || 0;
  return base + (rule.mode === 'site' ? rule.host.length : rule.url.length);
}

/** Most specific enabled rule matching `url`, or null. */
export function matchRule(url, rules) {
  let best = null;
  for (const r of rules || []) {
    if (!r.enabled || !ruleMatches(r, url)) continue;
    if (!best || specificity(r) > specificity(best)) best = r;
  }
  return best;
}

export function describeRule(rule) {
  const u = safeUrl(rule.sourceUrl);
  if (rule.mode === 'site') return { title: rule.host, sub: 'Whole site' };
  const path = u ? `${u.pathname}${rule.mode === 'page' ? u.search : ''}` : rule.url;
  return {
    title: rule.host || (u ? u.protocol : rule.url),
    sub: `${rule.mode === 'prefix' ? 'Path & below' : 'Exact page'} · ${path}`,
  };
}

/**
 * Decide whether/how a tab should be reloaded.
 * Returns { interval, source: 'rule'|'default', ruleId } or null.
 */
export function planForTab(tab, settings) {
  if (!tab || !isReloadableUrl(tab.url)) return null;
  const rule = matchRule(tab.url, settings.rules);
  if (rule) {
    if (rule.action === 'skip') return null;
    return { interval: rule.interval, source: 'rule', ruleId: rule.id };
  }
  const def = { interval: settings.defaultInterval, source: 'default', ruleId: null };
  if (settings.scope === 'all') return tab.discarded ? null : def;
  if (settings.scope === 'active') return tab.active ? def : null;
  return null;
}
