// Map labels must not hide under the floating map controls (QA: «al-Kamishli» under the locate button).
// A transparent, collision-only symbol sits under each control: it is placed first (top layer, icon-allow-overlap)
// and occupies the control's screen box in MapLibre's collision index, so place labels move (variable anchors) or
// yield instead of being drawn invisibly beneath the button. Updated only when the view or the control boxes actually changed. No network.

export const GUARD_SRC = 'kh-ui-guard', GUARD_LAYER = 'kh-ui-guard', GUARD_IMG = 'kh-ui-guard-px';
export const GUARD_SELECTORS = ['#btnLocate', '#fabs .cgroup', '#btnCompass:not(.hide)'];
const IMG_PX = 8;

/** Screen rects of the controls (page px) → guard boxes in map-canvas px, clipped to the canvas, with `pad` px margin. */
export function guardBoxes(rects, mapRect, pad = 6) {
  const out = [];
  for (const r of rects || []) {
    if (!r || !(r.width > 0) || !(r.height > 0)) continue;
    const x = r.left - mapRect.left, y = r.top - mapRect.top;
    if (x + r.width < 0 || y + r.height < 0 || x > mapRect.width || y > mapRect.height) continue;
    out.push({ cx: x + r.width / 2, cy: y + r.height / 2, size: Math.max(r.width, r.height) + pad * 2 });
  }
  return out;
}

export function installLabelGuard(map, doc = document, selectors = GUARD_SELECTORS) {
  const ensure = () => {
    if (!map.hasImage(GUARD_IMG)) map.addImage(GUARD_IMG, { width: IMG_PX, height: IMG_PX, data: new Uint8Array(IMG_PX * IMG_PX * 4) });
    if (!map.getSource(GUARD_SRC)) map.addSource(GUARD_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (!map.getLayer(GUARD_LAYER)) map.addLayer({ id: GUARD_LAYER, type: 'symbol', source: GUARD_SRC, layout: {
      'icon-image': GUARD_IMG, 'icon-size': ['/', ['get', 's'], IMG_PX], 'icon-allow-overlap': true, 'icon-ignore-placement': false,
      'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport' } }); // last layer = placed first
  };
  let lastKey = '';
  const update = (ev) => {
    try {
      const fresh = !map.getSource(GUARD_SRC) || ev?.type === 'style.load';
      ensure();
      const mr = map.getContainer().getBoundingClientRect();
      const rects = selectors.flatMap(s => [...doc.querySelectorAll(s)]).map(el => el.getBoundingClientRect());
      const c = map.getCenter?.(), z = map.getZoom?.(), br = map.getBearing?.(), pt = map.getPitch?.();
      const key = JSON.stringify([guardBoxes(rects, mr).map(b => [Math.round(b.cx), Math.round(b.cy), Math.round(b.size)]),
        c ? [c.lng.toFixed(6), c.lat.toFixed(6)] : 0, z?.toFixed(3), br?.toFixed(1), pt?.toFixed(1), Math.round(mr.width), Math.round(mr.height)]);
      if (!fresh && key === lastKey) return; // nothing moved → no setData, no re-placement
      lastKey = key;
      const features = guardBoxes(rects, mr).map(b => {
        const ll = map.unproject([b.cx, b.cy]);
        return { type: 'Feature', properties: { s: b.size }, geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } };
      });
      map.getSource(GUARD_SRC)?.setData({ type: 'FeatureCollection', features });
    } catch (e) { /* style not ready – next moveend retries */ }
  };
  map.on('style.load', update);
  map.on('moveend', update);
  map.on('resize', update);
  if (map.isStyleLoaded?.()) update(); else map.once('load', update);
  return update;
}
