import {
  getSettings, updateSettings, normalizeSettings, isReloadableUrl, matchRule, ruleMatches, makeRule, ruleKey,
  SCOPES, formatInterval, formatCountdown,
} from './src/shared.js';
import {
  icon, createSwitch, createSegmented, createIntervalPicker, fetchState,
} from './src/ui.js';

const $ = (id) => document.getElementById(id);
const RING = 2 * Math.PI * 28;

let settings = await getSettings();
// `?tabId=` lets the popup be previewed against a specific tab (used by tests).
const forcedTab = Number(new URLSearchParams(location.search).get('tabId'));
const [tab] = forcedTab
  ? [await chrome.tabs.get(forcedTab).catch(() => undefined)]
  : await chrome.tabs.query({ active: true, currentWindow: true });
const reloadable = !!tab && isReloadableUrl(tab.url);
const tabUrl = reloadable ? new URL(tab.url) : null;

// ------------------------------------------------------------- controls

const master = createSwitch({
  large: true,
  label: 'Auto reload',
  checked: settings.enabled,
  onChange: (v) => updateSettings((s) => { s.enabled = v; }),
});
$('master').replaceWith(master.el);
master.el.id = 'master';

const target = createSegmented({
  label: 'What this interval applies to',
  value: 'default',
  options: [
    { value: 'default', label: 'Default', icon: 'tabs', title: 'Use the default interval' },
    { value: 'site', label: 'This site', icon: 'globe', title: 'Create a rule for this whole site' },
    { value: 'page', label: 'This page', icon: 'file', title: 'Create a rule for this exact page' },
  ],
  onChange: setTarget,
});
$('target').replaceWith(target.el);
if (!reloadable) { target.disable('site'); target.disable('page'); }

const picker = createIntervalPicker({
  compact: true,
  value: settings.defaultInterval,
  onChange: (sec) => updateSettings((s) => {
    const rule = currentRule(s);
    if (rule) s.rules.find((r) => r.id === rule.id).interval = sec;
    else s.defaultInterval = sec;
  }),
});
$('picker').append(picker.el);

const scope = createSegmented({
  label: 'Which tabs reload',
  value: settings.scope,
  options: Object.entries(SCOPES).map(([value, s]) => ({ value, label: s.short, title: s.label })),
  onChange: (v) => updateSettings((s) => { s.scope = v; }),
});
$('scope').replaceWith(scope.el);

$('reloadNow').innerHTML = icon('rotate');
$('reloadNow').disabled = !reloadable;
$('reloadNow').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'reloadNow', tabId: tab.id });
  refresh();
});

$('openOptions').innerHTML = icon('sliders');
$('openOptions').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

chrome.commands.getAll().then((cmds) => {
  const c = cmds.find((x) => x.name === 'toggle-reload');
  master.el.title = c?.shortcut ? `Auto reload on/off (${c.shortcut})` : 'Auto reload on/off';
});

// ------------------------------------------------------------- rule logic

function currentRule(s = settings) {
  return reloadable ? matchRule(tab.url, s.rules) : null;
}

/** Popup target switch: Default removes rules for this tab; Site/Page creates one. */
async function setTarget(kind) {
  const carry = picker.value;
  await updateSettings((s) => {
    if (kind === 'default') {
      s.rules = s.rules.filter((r) => !(r.enabled && ruleMatches(r, tab.url)));
      return;
    }
    const fresh = makeRule(tab.url, kind, carry);
    // Drop matching rules that would override the one being chosen.
    s.rules = s.rules.filter((r) => !(r.enabled && ruleMatches(r, tab.url) && ruleKey(r) !== ruleKey(fresh)));
    const existing = s.rules.find((r) => ruleKey(r) === ruleKey(fresh));
    if (existing) { existing.enabled = true; existing.action = 'reload'; } else s.rules.push(fresh);
  });
}

function renderControls() {
  master.set(settings.enabled);
  scope.set(settings.scope);
  scope.el.title = SCOPES[settings.scope].desc;

  const rule = currentRule();
  const kind = rule ? (rule.mode === 'prefix' ? 'prefix' : rule.mode) : 'default';
  target.set(kind);

  const hint = $('targetHint');
  if (!reloadable) {
    $('pickerTitle').textContent = 'Default interval';
    hint.textContent = '· browser pages cannot be reloaded';
  } else if (rule?.action === 'skip') {
    $('pickerTitle').textContent = 'Never reload';
    hint.textContent = '· a rule excludes this page';
  } else if (rule) {
    const where = rule.mode === 'site' ? rule.host : rule.mode === 'page' ? 'this page' : 'this path';
    $('pickerTitle').textContent = `Interval for ${where}`;
    hint.textContent = rule.mode === 'prefix' ? '· path rule from settings' : '· site rule';
  } else {
    $('pickerTitle').textContent = 'Default interval';
    hint.textContent = '· tabs without a site rule';
  }
  picker.el.hidden = rule?.action === 'skip';
  picker.set(rule ? rule.interval : settings.defaultInterval);
}

// ------------------------------------------------------------- live state

async function refresh() {
  const state = await fetchState();
  const timers = state?.timers || [];
  const mine = timers.find((t) => t.tabId === tab?.id);
  const now = state?.now ?? Date.now();

  const status = $('status');
  status.classList.toggle('on', settings.enabled);
  status.textContent = settings.enabled
    ? `On · ${timers.length} tab${timers.length === 1 ? '' : 's'} on a timer`
    : 'Off';

  $('host').textContent = tabUrl ? (tabUrl.hostname || tabUrl.protocol.replace(':', '')) : (tab?.title || 'This tab');
  const card = $('nowCard');
  const why = $('why');
  const count = $('count');
  const ring = $('ringFg');

  if (mine && settings.enabled) {
    const left = Math.max(0, mine.due - now);
    card.classList.remove('idle');
    count.textContent = formatCountdown(left);
    ring.style.strokeDashoffset = String(RING * (1 - Math.min(1, left / (mine.interval * 1000))));
    why.textContent = `Every ${formatInterval(mine.interval)} · ${mine.source === 'rule' ? 'site rule' : 'default'}${mine.reloads ? ` · ${mine.reloads}× so far` : ''}`;
    return;
  }

  card.classList.add('idle');
  count.textContent = '--';
  ring.style.strokeDashoffset = String(RING);
  const rule = currentRule();
  if (!settings.enabled) why.textContent = 'Auto reload is off';
  else if (!reloadable) why.textContent = 'Browser pages are never reloaded';
  else if (rule?.action === 'skip') why.textContent = 'Excluded by a site rule';
  else if (settings.scope === 'rules' && !rule) why.textContent = 'No rule here. Pick "This site" to add one.';
  else why.textContent = 'Starting…';
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  settings = normalizeSettings(changes.settings.newValue);
  renderControls();
  setTimeout(refresh, 60);
});

renderControls();
refresh();
setInterval(refresh, 1000);
