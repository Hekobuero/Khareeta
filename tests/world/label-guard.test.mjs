// P3 bundle 3 (#37 follow-up): map labels keep clear of floating controls and town names (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guardBoxes, installLabelGuard, GUARD_LAYER } from '../../js/label-guard.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('guardBoxes: control rects → canvas-space boxes (padded), off-canvas/hidden skipped', () => {
  const map = { left: 0, top: 0, width: 390, height: 844 };
  const b = guardBoxes([{ left: 330, top: 700, width: 48, height: 48 }, { left: 0, top: 0, width: 0, height: 0 }, { left: 500, top: 10, width: 44, height: 44 }], map);
  assert.equal(b.length, 1);
  assert.deepEqual(b[0], { cx: 354, cy: 724, size: 60 });
});

test('installLabelGuard adds a top collision-only layer and feeds it the locate button box', () => {
  const layers = [], srcData = {}; const handlers = {};
  const map = {
    hasImage: () => false, addImage() {}, getSource: id => srcData[id] ? { setData: d => { srcData[id].data = d; } } : null,
    addSource(id, s) { srcData[id] = s; }, getLayer: id => layers.find(l => l.id === id), addLayer(l) { layers.push(l); },
    on(ev, f) { handlers[ev] = f; }, once() {}, isStyleLoaded: () => true,
    getContainer: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) }),
    unproject: ([x, y]) => ({ lng: x / 10, lat: y / 10 }),
  };
  const doc = { querySelectorAll: s => s === '#btnLocate' ? [{ getBoundingClientRect: () => ({ left: 330, top: 700, width: 48, height: 48 }) }] : [] };
  installLabelGuard(map, doc);
  const l = layers.find(x => x.id === GUARD_LAYER);
  assert.ok(l && l.layout['icon-allow-overlap'] === true && l.layout['icon-ignore-placement'] === false);
  assert.ok(!('text-field' in l.layout));
  const f = srcData['kh-ui-guard'].data.features;
  assert.equal(f.length, 1); assert.equal(f[0].properties.s, 60);
  assert.ok(handlers.moveend && handlers['style.load']);
  let sets = 0; const src = map.getSource; map.getSource = id => { const r = src(id); return r && { setData: d => { sets++; r.setData(d); } }; };
  handlers.moveend({ type: 'moveend' }); handlers.moveend({ type: 'moveend' });
  assert.equal(sets, 0, 'unchanged view + controls → no setData');
  map.getCenter = () => ({ lng: 1, lat: 2 }); handlers.moveend({ type: 'moveend' });
  assert.equal(sets, 1, 'view changed → one update');
  assert.match(read('js/app.js'), /installLabelGuard\(map\)/);
  assert.match(read('sw.js'), /'js\/label-guard\.js'/);
});

test('town/city labels reserve collision padding so pale village/neighbourhood names stay off them (Nusaybin z13)', () => {
  for (const f of ['map-style-light.json', 'map-style-dark.json']) {
    const st = JSON.parse(read(f));
    for (const id of ['place-town', 'place-city']) assert.ok(st.layers.find(l => l.id === id).layout['text-padding'] >= 8, `${f} ${id}`);
    const i = id => st.layers.findIndex(l => l.id === id);
    assert.ok(i('place-town') > i('place-village') && i('place-town') > i('place-neighbourhood'), 'town placed before village labels');
  }
});
