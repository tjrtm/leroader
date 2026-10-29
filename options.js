import {
  getSettings, updateSettings, normalizeSettings, makeRule, ruleKey, ruleTarget, describeRule, matchRule,
  isReloadableUrl, parseUserUrl, SCOPES, MODES, formatInterval, formatCountdown,
} from './src/shared.js';
import {
  h, icon, createSwitch, createSegmented, createIntervalPicker, faviconTile, fetchState,
} from './src/ui.js';

const $ = (id) => document.getElementById(id);
let settings = await getSettings();
const openRules = new Set();

// ============================================================ header

const master = createSwitch({
  large: true,
  label: 'Auto reload',
  checked: settings.enabled,
  onChange: (v) => updateSettings((s) => { s.enabled = v; }),
});
master.el.id = 'master';
$('master').replaceWith(master.el);

// ============================================================ default interval

const defaultPicker = createIntervalPicker({
  value: settings.defaultInterval,
  label: 'Default reload interval',
  onChange: (sec) => updateSettings((s) => { s.defaultInterval = sec; }),
});
$('defaultPicker').append(defaultPicker.el);

// ============================================================ scope tiles

const SCOPE_ICONS = { active: 'eye', all: 'tabs', rules: 'target' };
const scopeTiles = Object.entries(SCOPES).map(([value, s]) => {
  const tile = h('button', { class: 'tile', type: 'button', role: 'radio', 'data-value': value },
    h('span', { class: 'tile-icon', html: icon(SCOPE_ICONS[value]) }),
    h('span', { class: 'tile-text' }, h('strong', {}, s.label), h('span', {}, s.desc)),
    h('span', { class: 'radio-dot', 'aria-hidden': 'true' }),
  );
  tile.addEventListener('click', () => updateSettings((st) => { st.scope = value; }));
  $('scopeTiles').append(tile);
  return tile;
});

// ============================================================ behaviour rows

function row(title, desc, control) {
  return h('div', { class: 'row' },
    h('div', { class: 'row-text' }, h('strong', {}, title), h('span', {}, desc)),
    control);
}

const hardSwitch = createSwitch({
  label: 'Hard reload',
  checked: settings.hardReload,
  onChange: (v) => updateSettings((s) => { s.hardReload = v; }),
});
const badgeSwitch = createSwitch({
  label: 'Countdown on toolbar icon',
  checked: settings.showBadge,
  onChange: (v) => updateSettings((s) => { s.showBadge = v; }),
});
const kbd = h('span', { class: 'kbd' }, '…');
const changeKey = h('button', { class: 'btn', type: 'button' }, 'Change');
changeKey.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
chrome.commands.getAll().then((cmds) => {
  kbd.textContent = cmds.find((c) => c.name === 'toggle-reload')?.shortcut || 'Not set';
});

$('behaviour').append(
  row('Hard reload', 'Skip the cache on every reload, like Shift + Reload.', hardSwitch.el),
  row('Countdown badge', 'Show the time left on the toolbar icon.', badgeSwitch.el),
  row('Keyboard shortcut', 'Turn auto reload on or off from anywhere.', h('div', { style: 'display:flex;gap:8px;align-items:center' }, kbd, changeKey)),
);

// ============================================================ rules

/** One collapsible rule card, updated in place so sliders keep focus. */
function createRuleCard(rule) {
  const id = rule.id;
  const edit = (fn) => updateSettings((s) => {
    const r = s.rules.find((x) => x.id === id);
    if (r) fn(r, s);
  });

  const nameStrong = h('strong', { class: 'ellipsis' });
  const nameSub = h('span', { class: 'ellipsis' });
  const pill = h('span', { class: 'pill' });
  const toggle = h('button', { class: 'rule-toggle', type: 'button', 'aria-expanded': 'false' },
    faviconTile(rule.sourceUrl),
    h('span', { class: 'rule-name' }, nameStrong, nameSub),
    pill,
    h('span', { class: 'chev', html: icon('chevron', 'sm') }));

  const enabled = createSwitch({ label: 'Rule enabled', checked: rule.enabled, onChange: (v) => edit((r) => { r.enabled = v; }) });

  const mode = createSegmented({
    label: 'Match',
    value: rule.mode,
    options: [
      { value: 'site', label: MODES.site.label, icon: 'globe', title: MODES.site.desc },
      { value: 'prefix', label: MODES.prefix.label, icon: 'folder', title: MODES.prefix.desc },
      { value: 'page', label: MODES.page.label, icon: 'file', title: MODES.page.desc },
    ],
    onChange: (v) => edit((r) => { Object.assign(r, { mode: v }, ruleTarget(r.sourceUrl, v)); }),
  });
  const modeHint = h('p', { class: 'hint' });

  const action = createSegmented({
    label: 'Action',
    value: rule.action,
    options: [
      { value: 'reload', label: 'Reload on a timer', icon: 'rotate' },
      { value: 'skip', label: 'Never reload', icon: 'ban' },
    ],
    onChange: (v) => edit((r) => { r.action = v; }),
  });

  const picker = createIntervalPicker({
    compact: true,
    value: rule.interval,
    label: 'Rule interval',
    onChange: (sec) => edit((r) => { r.interval = sec; }),
  });
  const pickerWrap = h('div', {}, h('div', { class: 'field-label' }, 'Interval'), picker.el);

  const openBtn = h('button', { class: 'btn ghost', type: 'button', html: `${icon('external', 'sm')}<span>Open page</span>` });
  openBtn.addEventListener('click', () => chrome.tabs.create({ url: rule.sourceUrl }));
  const delBtn = h('button', { class: 'btn danger', type: 'button', html: `${icon('trash', 'sm')}<span>Delete rule</span>` });
  delBtn.addEventListener('click', () => {
    openRules.delete(id);
    updateSettings((s) => { s.rules = s.rules.filter((r) => r.id !== id); });
  });

  const body = h('div', { class: 'rule-body', hidden: true },
    h('div', {}, h('div', { class: 'field-label' }, 'Match'), mode.el, modeHint),
    h('div', {}, h('div', { class: 'field-label' }, 'Action'), action.el),
    pickerWrap,
    h('div', { class: 'rule-foot' }, openBtn, delBtn));

  const el = h('article', { class: 'rule', 'data-id': id },
    h('div', { class: 'rule-head' }, toggle, enabled.el),
    body);

  function setOpen(open) {
    el.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (open) openRules.add(id); else openRules.delete(id);
  }
  toggle.addEventListener('click', () => setOpen(body.hidden));

  function update(r) {
    rule = r;
    const d = describeRule(r);
    nameStrong.textContent = d.title;
    nameSub.textContent = d.sub;
    pill.className = `pill${r.enabled && r.action === 'reload' ? ' on' : ''}`;
    pill.textContent = r.action === 'skip' ? 'Never' : `Every ${formatInterval(r.interval)}`;
    el.classList.toggle('disabled', !r.enabled);
    enabled.set(r.enabled);
    mode.set(r.mode);
    modeHint.textContent = r.mode === 'site'
      ? `Matches ${r.host} and its subdomains.`
      : `Matches ${r.mode === 'prefix' ? 'addresses starting with' : 'exactly'} ${r.url}`;
    action.set(r.action);
    picker.set(r.interval);
    pickerWrap.hidden = r.action === 'skip';
    setOpen(openRules.has(r.id));
  }
  update(rule);
  return { el, update, open: () => { setOpen(true); } };
}

const ruleCards = new Map();

function renderRules() {
  const list = $('rules');
  const ids = new Set(settings.rules.map((r) => r.id));
  for (const [id, card] of ruleCards) {
    if (!ids.has(id)) { card.el.remove(); ruleCards.delete(id); }
  }
  // Newest first.
  const ordered = [...settings.rules].sort((a, b) => b.created - a.created);
  ordered.forEach((r, i) => {
    let card = ruleCards.get(r.id);
    if (!card) { card = createRuleCard(r); ruleCards.set(r.id, card); } else card.update(r);
    if (list.children[i] !== card.el) list.insertBefore(card.el, list.children[i] || null);
  });
  list.querySelector('.empty')?.remove();
  if (!settings.rules.length) {
    list.append(h('div', { class: 'empty', html: `${icon('globe')}<div>No site rules yet. Tap an open tab below to add one.</div>` }));
  }
  $('ruleCount').textContent = settings.rules.length ? `· ${settings.rules.length}` : '';
}

async function addRuleFor(url, mode = 'site') {
  const fresh = makeRule(url, mode, settings.defaultInterval);
  if (!fresh) return;
  const existing = settings.rules.find((r) => ruleKey(r) === ruleKey(fresh));
  const id = existing ? existing.id : fresh.id;
  openRules.add(id);
  if (!existing) {
    await updateSettings((s) => { s.rules.push(fresh); });
    renderRules();
  }
  const card = ruleCards.get(id);
  if (card) {
    card.open();
    card.el.classList.remove('flash');
    void card.el.offsetWidth;
    card.el.classList.add('flash');
    card.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ---------------------------------------------------- open tabs picker

let lastTabSig = '';
async function renderTabPicker() {
  const tabs = (await chrome.tabs.query({})).filter((t) => isReloadableUrl(t.url));
  const seen = new Set();
  const unique = tabs.filter((t) => (seen.has(t.url) ? false : seen.add(t.url)));
  const sig = JSON.stringify([unique.map((t) => [t.url, t.title, t.favIconUrl]), settings.rules.map(ruleKey)]);
  if (sig === lastTabSig) return;
  lastTabSig = sig;

  const box = $('tabPicker');
  box.replaceChildren();
  if (!unique.length) {
    box.append(h('div', { class: 'empty' }, 'Open a website in another tab and it will show up here.'));
    return;
  }
  for (const t of unique) {
    const u = new URL(t.url);
    const covered = matchRule(t.url, settings.rules);
    const item = h('button', { class: `tab-item${covered ? ' has-rule' : ''}`, type: 'button', title: `Add a rule for ${u.hostname}` },
      faviconTile(t.url, t.favIconUrl),
      h('span', { class: 'tab-item-text' },
        h('strong', { class: 'ellipsis' }, t.title || u.hostname),
        h('span', { class: 'ellipsis' }, covered ? `Rule: ${describeRule(covered).title}` : (u.hostname || u.protocol))),
      h('span', { class: 'add', html: icon(covered ? 'pencil' : 'plus', 'sm') }));
    item.addEventListener('click', () => {
      if (covered) addRuleFor(covered.sourceUrl, covered.mode);
      else addRuleFor(t.url, 'site');
    });
    box.append(item);
  }
}

$('manualForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hint = $('manualHint');
  const u = parseUserUrl($('manualUrl').value);
  if (!u) {
    hint.className = 'hint error';
    hint.textContent = 'That does not look like a web address. Try example.com or https://example.com/page';
    return;
  }
  const hasPath = (u.pathname && u.pathname !== '/') || u.search;
  await addRuleFor(u.href, hasPath ? 'page' : 'site');
  hint.className = 'hint';
  hint.textContent = `Added ${hasPath ? 'a page' : 'a site'} rule for ${u.hostname}.`;
  $('manualUrl').value = '';
});

// ============================================================ live

const liveRows = new Map();
async function renderLive() {
  const state = await fetchState();
  const timers = settings.enabled ? (state?.timers || []) : [];
  const now = state?.now ?? Date.now();
  const box = $('live');

  const status = $('status');
  status.classList.toggle('on', settings.enabled);
  status.textContent = settings.enabled
    ? `On · ${timers.length} tab${timers.length === 1 ? '' : 's'} on a timer`
    : 'Off · nothing will reload';
  $('masterText').textContent = settings.enabled ? 'Auto reload on' : 'Auto reload off';

  const tabs = new Map((await chrome.tabs.query({})).map((t) => [t.id, t]));
  const keep = new Set();
  for (const t of timers) {
    const tab = tabs.get(t.tabId);
    if (!tab) continue;
    keep.add(t.tabId);
    let r = liveRows.get(t.tabId);
    if (!r) {
      const title = h('strong', { class: 'ellipsis' });
      const sub = h('span', { class: 'ellipsis' });
      const bar = h('i');
      const count = h('span', { class: 'live-count' });
      const btn = h('button', { class: 'round', type: 'button', title: 'Reload now', 'aria-label': 'Reload now', html: icon('rotate', 'sm') });
      btn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'reloadNow', tabId: t.tabId }));
      const el = h('div', { class: 'live-item' },
        faviconTile(tab.url, tab.favIconUrl),
        h('div', { class: 'live-text' }, title, sub, h('div', { class: 'live-bar' }, bar)),
        count, btn);
      r = { el, title, sub, bar, count };
      liveRows.set(t.tabId, r);
      box.append(el);
    }
    const left = Math.max(0, t.due - now);
    r.title.textContent = tab.title || tab.url;
    r.sub.textContent = `Every ${formatInterval(t.interval)} · ${t.source === 'rule' ? 'site rule' : 'default'}${t.reloads ? ` · reloaded ${t.reloads}×` : ''}`;
    r.bar.style.width = `${Math.min(100, (left / (t.interval * 1000)) * 100)}%`;
    r.count.textContent = formatCountdown(left);
  }
  for (const [id, r] of liveRows) {
    if (!keep.has(id)) { r.el.remove(); liveRows.delete(id); }
  }
  box.querySelector('.empty')?.remove();
  if (!liveRows.size) {
    box.append(h('div', { class: 'empty', html: `${icon('timer')}<div>${settings.enabled ? 'No tabs match right now.' : 'Auto reload is off. Flip the switch at the top to start.'}</div>` }));
  }
}

// ============================================================ wiring

function renderAll() {
  master.set(settings.enabled);
  defaultPicker.set(settings.defaultInterval);
  scopeTiles.forEach((t) => t.setAttribute('aria-checked', String(t.dataset.value === settings.scope)));
  hardSwitch.set(settings.hardReload);
  badgeSwitch.set(settings.showBadge);
  renderRules();
  renderTabPicker();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  settings = normalizeSettings(changes.settings.newValue);
  renderAll();
  renderLive();
});
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.title || info.url || info.favIconUrl) renderTabPicker(); });
chrome.tabs.onRemoved.addListener(() => renderTabPicker());
chrome.tabs.onCreated.addListener(() => renderTabPicker());

renderAll();
renderLive();
setInterval(renderLive, 1000);
