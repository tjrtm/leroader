// Small DOM toolkit: Lucide icons (ISC license, inlined) and touch components.

import {
  INTERVALS, QUICK_PICKS, QUICK_PICKS_COMPACT, TICK_MARKS, snapIndex, splitInterval, formatInterval, formatIntervalLong,
} from './shared.js';

const ICONS = {
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  tabs: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Tiny hyperscript helper. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** On/off switch. */
export function createSwitch({ checked = false, label, onChange, large = false }) {
  const el = h('button', { class: `switch${large ? ' lg' : ''}`, role: 'switch', type: 'button', 'aria-label': label });
  let value = checked;
  const render = () => el.setAttribute('aria-checked', String(value));
  el.addEventListener('click', () => { value = !value; render(); onChange?.(value); });
  render();
  return { el, set(v) { value = !!v; render(); }, get value() { return value; } };
}

/** Segmented control (radio group). options: [{value,label,icon}] */
export function createSegmented({ options, value, label, onChange }) {
  const el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  let current = value;
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', role: 'radio', 'data-value': o.value, html: `${o.icon ? icon(o.icon, 'sm') : ''}<span class="ellipsis">${o.label}</span>`, title: o.title || o.label });
    b.addEventListener('click', () => { if (b.disabled) return; current = o.value; render(); onChange?.(o.value); });
    el.append(b);
    return b;
  });
  const render = () => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === String(current))));
  render();
  return {
    el,
    set(v) { current = v; render(); },
    get value() { return current; },
    disable(v, disabled = true) { buttons.forEach((b) => { if (v === undefined || b.dataset.value === v) b.disabled = disabled; }); },
  };
}

/**
 * Touch-first interval picker: big readout, -/+ steppers, snapping slider, quick chips.
 * No text input anywhere.
 */
export function createIntervalPicker({ value = 30, onChange, compact = false, label = 'Reload interval' }) {
  let idx = snapIndex(value);
  const max = INTERVALS.length - 1;

  const minus = h('button', { class: 'round', type: 'button', 'aria-label': 'Shorter interval', html: icon('minus') });
  const plus = h('button', { class: 'round', type: 'button', 'aria-label': 'Longer interval', html: icon('plus') });
  const num = h('span', { class: 'num' });
  const unit = h('span', { class: 'unit' });
  const readout = h('output', { class: 'readout', 'aria-live': 'polite' }, num, unit);

  const slider = h('input', { class: 'slider', type: 'range', min: 0, max, step: 1, 'aria-label': label });
  const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' },
    TICK_MARKS.map((s) => h('span', { style: `left:${(snapIndex(s) / max) * 100}%` }, formatInterval(s))));

  const chipEls = (compact ? QUICK_PICKS_COMPACT : QUICK_PICKS).map((s) => {
    const c = h('button', { class: 'chip', type: 'button', 'data-sec': s }, formatInterval(s));
    c.addEventListener('click', () => commit(snapIndex(s)));
    return c;
  });

  const el = h('div', { class: `picker${compact ? ' compact' : ''}` },
    h('div', { class: 'picker-head' }, minus, readout, plus),
    h('div', { class: 'slider-wrap' }, slider, ticks),
    h('div', { class: 'chips' }, chipEls),
  );

  function render(i) {
    const sec = INTERVALS[i];
    const { value: v, unit: u } = splitInterval(sec);
    num.textContent = v;
    unit.textContent = u;
    slider.value = String(i);
    slider.style.setProperty('--p', `${(i / max) * 100}%`);
    slider.setAttribute('aria-valuetext', formatIntervalLong(sec));
    minus.disabled = i <= 0;
    plus.disabled = i >= max;
    chipEls.forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.sec) === sec)));
  }

  function commit(i) {
    i = Math.max(0, Math.min(max, i));
    const changed = i !== idx;
    idx = i;
    render(idx);
    if (changed) onChange?.(INTERVALS[idx]);
  }

  slider.addEventListener('input', () => render(Number(slider.value)));
  slider.addEventListener('change', () => commit(Number(slider.value)));
  minus.addEventListener('click', () => commit(idx - 1));
  plus.addEventListener('click', () => commit(idx + 1));

  render(idx);
  return {
    el,
    set(sec) {
      // Don't yank the thumb out from under a finger mid-drag.
      if (document.activeElement === slider && slider.matches(':active')) return;
      idx = snapIndex(sec);
      render(idx);
    },
    get value() { return INTERVALS[idx]; },
  };
}

/** Favicon tile with a letter fallback. Uses the `favicon` permission when no tab icon is known. */
export function faviconTile(url, iconUrl) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  const tile = h('div', { class: 'favicon', 'aria-hidden': 'true' }, (host[0] || '?'));
  const src = iconUrl && /^https?:|^data:/.test(iconUrl)
    ? iconUrl
    : (url && /^https?:/.test(url) ? chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`) : null);
  if (src) {
    const img = h('img', { alt: '', src });
    img.addEventListener('load', () => { tile.textContent = ''; tile.append(img); });
  }
  return tile;
}

/** Ask the worker for live timer state. */
export async function fetchState() {
  try {
    return await chrome.runtime.sendMessage({ type: 'getState' });
  } catch {
    return null;
  }
}
