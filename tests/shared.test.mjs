// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERVALS, snapInterval, formatInterval, splitInterval, formatCountdown, badgeText,
  makeRule, matchRule, planForTab, normalizeSettings, parseUserUrl, ruleKey,
} from '../src/shared.js';

test('interval scale covers 5s..5h and snaps', () => {
  assert.equal(INTERVALS[0], 5);
  assert.equal(INTERVALS.at(-1), 5 * 3600);
  for (const v of [5, 10, 20, 30, 40, 50, 60, 120, 300, 600, 1200, 1800, 18000]) assert.ok(INTERVALS.includes(v), `${v} missing`);
  assert.equal(snapInterval(29), 30);
  assert.equal(snapInterval(99999), 18000);
  assert.equal(snapInterval('junk'), 30);
});

test('formatting', () => {
  assert.equal(formatInterval(5), '5s');
  assert.equal(formatInterval(90), '1m 30s');
  assert.equal(formatInterval(5400), '1h 30m');
  assert.deepEqual(splitInterval(30), { value: '30', unit: 'sec' });
  assert.deepEqual(splitInterval(90), { value: '1:30', unit: 'min' });
  assert.deepEqual(splitInterval(3600), { value: '1', unit: 'hour' });
  assert.equal(formatCountdown(7000), '0:07');
  assert.equal(formatCountdown(3723000), '1:02:03');
  assert.equal(badgeText(12000), '12s');
  assert.equal(badgeText(300000), '5m');
  assert.equal(badgeText(18000000), '5h');
});

test('rule matching: site / prefix / page and specificity', () => {
  const site = makeRule('https://www.example.com/a', 'site', 60);
  const prefix = makeRule('https://example.com/dash', 'prefix', 20);
  const page = makeRule('https://example.com/dash/live?x=1', 'page', 5);
  const rules = [site, prefix, page];

  assert.equal(site.host, 'example.com');
  assert.equal(matchRule('https://news.example.com/', rules).id, site.id);
  assert.equal(matchRule('https://example.com/other', rules).id, site.id);
  assert.equal(matchRule('https://example.com/dash/foo', rules).id, prefix.id);
  assert.equal(matchRule('https://example.com/dash/live?x=1#frag', rules).id, page.id);
  assert.equal(matchRule('https://example.org/', rules), null);
  assert.equal(matchRule('https://notexample.com/', rules), null);

  page.enabled = false;
  assert.equal(matchRule('https://example.com/dash/live?x=1', rules).id, prefix.id);
  assert.notEqual(ruleKey(site), ruleKey(prefix));
});

test('planForTab respects scope, rules and skip', () => {
  const s = normalizeSettings({ enabled: true, defaultInterval: 30, scope: 'active' });
  const active = { url: 'https://a.com/', active: true };
  const bg = { url: 'https://a.com/x', active: false };
  assert.deepEqual(planForTab(active, s), { interval: 30, source: 'default', ruleId: null });
  assert.equal(planForTab(bg, s), null);
  assert.equal(planForTab({ url: 'chrome://settings', active: true }, s), null);

  s.scope = 'all';
  assert.equal(planForTab(bg, s).interval, 30);
  assert.equal(planForTab({ ...bg, discarded: true }, s), null);

  s.scope = 'rules';
  assert.equal(planForTab(active, s), null);
  const r = makeRule('https://a.com/x', 'page', 10);
  s.rules = [r];
  assert.deepEqual(planForTab(bg, s), { interval: 10, source: 'rule', ruleId: r.id });

  s.scope = 'all';
  r.action = 'skip';
  assert.equal(planForTab(bg, s), null);
  assert.equal(planForTab(active, s).source, 'default');
});

test('user typed addresses', () => {
  assert.equal(parseUserUrl('example.com/foo').href, 'https://example.com/foo');
  assert.equal(parseUserUrl('http://localhost:3000/').hostname, 'localhost');
  assert.equal(parseUserUrl('hello'), null);
  assert.equal(parseUserUrl('javascript:alert(1)'), null);
});
