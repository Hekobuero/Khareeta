import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../js/saved-core.js';
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const P = (id, extra = {}) => ({ id, name: 'Place ' + id, lon: 36.3, lat: 33.5, ...extra });

test('CRUD and persistence across reload (new reader on same storage)', () => {
  const st = mem();
  S.add(st, P('n1')); S.add(st, P('n2'));
  assert.ok(S.isSaved(st, 'n1'));
  S.update(st, 'n1', 'fav', { label: 'Oma' });
  S.add(st, P('h1'), { kind: 'home' });
  const reload = { getItem: st.getItem }; // fresh read only
  const l = S.load(reload);
  assert.equal(l.length, 3);
  assert.equal(S.sorted(l)[0].kind, 'home');
  assert.equal(S.displayName(S.find(l, 'n1')), 'Oma');
  S.remove(st, 'n2', 'fav'); assert.ok(!S.isSaved(st, 'n2'));
  assert.equal(S.toggle(st, P('n2')), true); assert.equal(S.toggle(st, P('n2')), false);
});
test('home/work are unique', () => {
  const st = mem(); S.add(st, P('a'), { kind: 'home' }); S.add(st, P('b'), { kind: 'home' });
  assert.deepEqual(S.load(st).filter(x => x.kind === 'home').map(x => x.id), ['b']);
});
test('invalid records are dropped, coords validated', () => {
  const st = mem(); st.setItem(S.KEY, JSON.stringify([{ id: 'x', name: 'bad', lon: 999, lat: 0 }, P('ok'), 'junk']));
  assert.deepEqual(S.load(st).map(x => x.id), ['ok']);
  assert.equal(S.coordId(33.512345, 36.276543), 'c:33.51235,36.27654');
});
test('export / import round trip, merge, bad format', () => {
  const st = mem(); S.add(st, P('a')); S.update(st, 'a', 'fav', { label: 'A!' });
  const json = S.exportJson(S.load(st));
  const r = S.importJson(json, [P('b')]);
  assert.equal(r.added, 1); assert.equal(r.list.length, 2);
  assert.equal(S.importJson(json, r.list).added, 0);
  assert.throws(() => S.importJson('{"foo":1}', []), /format/);
  assert.throws(() => S.importJson('not json', []));
});
