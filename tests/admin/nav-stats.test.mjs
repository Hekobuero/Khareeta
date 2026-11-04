// Admin nav stats: migration SQL expectations + admin.html rendering with mocked old/new kh_dashboard payloads.
// Pure Node, no network: nothing is sent to Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20261104_nav_stats.sql', root), 'utf8');
const html = readFileSync(new URL('admin.html', root), 'utf8');
const route = readFileSync(new URL('js/route.js', root), 'utf8');
const base = readFileSync(new URL('supabase.sql', root), 'utf8');

test('migration: event names, sim split, distinct install_id excluding anon', () => {
  assert.match(sql, /create or replace function public\.kh_dashboard\(p_days int default 30\)/i);
  assert.doesNotMatch(sql, /drop function/i);
  assert.match(sql, /'nav_arrive'/); assert.match(sql, /'reroute'/);
  assert.match(sql, /props->>'sim'/);
  assert.match(sql, /count\(distinct install_id\)[^;]*install_id <> 'anon'/);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /kh_is_admin\(\)/);
  assert.match(sql, /revoke all on function public\.kh_dashboard\(int\) from public, anon/);
  assert.doesNotMatch(sql, /service_role|eyJ[A-Za-z0-9_-]{20,}|password/i);
  // every existing output key is kept
  const keys = s => [...s.slice(s.indexOf('function public.kh_dashboard')).matchAll(/^\s{4}'(\w+)',/gm)].map(m => m[1]);
  for (const k of keys(base)) assert.ok(keys(sql).includes(k), 'missing key ' + k);
  assert.ok(keys(sql).includes('nav'));
  // balanced parens / dollar quotes
  assert.equal((sql.match(/\(/g) || []).length, (sql.match(/\)/g) || []).length);
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0);
});

test('app sends sim flag on nav_arrive and reroute', () => {
  assert.match(route, /track\('nav_arrive', \{[^}]*sim: !!N\.isSim/);
  assert.match(route, /track\('reroute', \{[^}]*sim: !!N\.isSim/);
});

const src = html.slice(html.indexOf('// nav-stats:begin'), html.indexOf('// nav-stats:end'));
const ctx = { nf: n => new Intl.NumberFormat('en-GB').format(n || 0) }; vm.createContext(ctx);
vm.runInContext(src, ctx);
const today = new Date().toISOString().slice(0, 10);

test('admin renders old payload (no nav) with dashes', () => {
  const h = ctx.navHtml(undefined, 30);
  assert.match(h, /Arrivals \(real\)/); assert.match(h, /Reroutes \(sim\)/);
  assert.doesNotMatch(h, /<b>\d/);
  assert.match(h, /<b>–<\/b>/);
  assert.equal((h.match(/<tr>/g) || []).length, 31);
});

test('admin renders new payload', () => {
  const s = (t, d, l, n) => ({ total: t, devices: d, last7: l, daily: [{ day: today, n, devices: 1 }] });
  const nav = { arrive: { real: s(1234, 87, 40, 5), sim: s(9, 2, 3, 2) }, reroute: { real: s(55, 20, 7, 1), sim: s(0, 0, 0, 0) } };
  const h = ctx.navHtml(nav, 7);
  assert.match(h, /<b>1,234<\/b><span>87 devices · 7 d: 40/);
  assert.match(h, /<b>9<\/b>/);
  assert.match(h, new RegExp(`<td>${today}</td><td>5</td><td>2</td><td>1</td><td>0</td>`));
  assert.doesNotMatch(h, /<b>–<\/b>/);
});

test('admin.html wires navHtml into load()', () => {
  assert.match(html, /\$\('#navstats'\)\.innerHTML = navHtml\(d\.nav, days\)/);
});
