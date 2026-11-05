// Builds sprites/khareeta-{light,dark}[@2x|@3x].{png,json} from Maki (CC0) glyphs.
// Usage: cd tools/sprite && npm ci && node build-sprite.mjs   (writes ../../sprites/*)
// Copied from the design hand-over (khareeta-design/scripts); palette.mjs is the single source of the badge list.
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { POI_CATEGORIES, POI_ICONS } from './palette.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const MAKI = path.join(HERE, 'node_modules/@mapbox/maki/icons');
const OUT = path.join(ROOT, 'sprites');

const CUSTOM = {
  atm: '<path fill-rule="evenodd" d="M2.2 3h10.6c.66 0 1.2.54 1.2 1.2v6.6c0 .66-.54 1.2-1.2 1.2H2.2C1.54 12 1 11.46 1 10.8V4.2C1 3.54 1.54 3 2.2 3zM1 5.2v1.6h13V5.2zM2.8 8.8v1.2h4.4V8.8z"/>',
  exchange: '<path d="M2 5h10M9.5 2.5L12 5 9.5 7.5M13 10H3M5.5 7.5L3 10l2.5 2.5" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};
const inner = (name) => name.startsWith('custom:') ? CUSTOM[name.slice(7)] : fs.readFileSync(path.join(MAKI, name + '.svg'), 'utf8')
  .replace(/<\?xml[^>]*>/, '').replace(/<svg[^>]*>/, '').replace('</svg>', '')
  .replace(/\sfill="[^"]*"/g, '').replace(/\sid="[^"]*"/g, '');

function build(theme) {
  const ring = theme === 'light' ? '#FFFFFF' : '#1C1C1E';
  const items = []; // {name,w,h,svg(1x units), extra}
  // POI badges: 22x22 @1x. 20px disc + 1px ring (ring drawn as 1.5 stroke inside bounds), 12px glyph.
  for (const [name, maki, cat] of POI_ICONS) {
    const c = POI_CATEGORIES[cat][theme];
    items.push({ name, w: 22, h: 22, svg:
      `<circle cx="11" cy="11" r="10.25" fill="${c}" stroke="${ring}" stroke-width="1.5"/>` +
      `<g transform="translate(5 5) scale(${12 / 15})" fill="#FFFFFF">${inner(maki)}</g>` });
  }
  // Generic badge
  items.push({ name: 'generic', w: 22, h: 22, svg:
    `<circle cx="11" cy="11" r="10.25" fill="${POI_CATEGORIES.civic[theme]}" stroke="${ring}" stroke-width="1.5"/><circle cx="11" cy="11" r="3" fill="#FFFFFF"/>` });
  // Low-zoom category dots: 10x10
  for (const [cat, v] of Object.entries(POI_CATEGORIES)) {
     items.push({ name: 'dot-' + cat, w: 10, h: 10, svg: `<circle cx="5" cy="5" r="3.75" fill="${v[theme]}" stroke="${ring}" stroke-width="1.5"/>` });
  }
  // Road shield (stretchable rounded rect) 24x20
  const sf = theme === 'light' ? '#FFFFFF' : '#3A3D43', ss = theme === 'light' ? '#C9C4BB' : '#55595F';
  items.push({ name: 'shield', w: 24, h: 20, svg: `<rect x="0.75" y="0.75" width="22.5" height="18.5" rx="4.5" fill="${sf}" stroke="${ss}" stroke-width="1.5"/>`,
    extra: { stretchX: [[6, 18]], stretchY: [[6, 14]], content: [5, 3, 19, 17] } });
  // Oneway arrow 12x8 (points to +x, rotated along line by MapLibre)
  const oc = theme === 'light' ? '#A49E94' : '#6E727A';
  items.push({ name: 'oneway', w: 12, h: 8, svg: `<path d="M1 4h8M6.5 1.5L9.5 4l-3 2.5" fill="none" stroke="${oc}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>` });
  // Dropped pin 28x36, anchor bottom
  items.push({ name: 'pin', w: 28, h: 36, svg:
    `<path d="M14 35c0 0 11.5-11.2 11.5-20.5A11.5 11.5 0 0 0 2.5 14.5C2.5 23.8 14 35 14 35z" fill="#E5484D" stroke="${ring}" stroke-width="1.5"/><circle cx="14" cy="14.5" r="4.25" fill="#FFFFFF"/>` });
  // Selected-POI halo 34x34
  items.push({ name: 'halo', w: 34, h: 34, svg: `<circle cx="17" cy="17" r="16" fill="${theme === 'light' ? 'rgba(26,115,232,0.18)' : 'rgba(76,155,255,0.25)'}"/>` });

  // Pack in rows of width 256 (1x)
  const PAD = 2, ROW_W = 256;
  let x = 0, y = 0, rowH = 0;
  for (const it of items) {
    if (x + it.w > ROW_W) { x = 0; y += rowH + PAD; rowH = 0; }
    it.x = x; it.y = y; x += it.w + PAD; rowH = Math.max(rowH, it.h);
  }
  const H = y + rowH;
  for (const ratio of [1, 2, 3]) {
    const body = items.map(it => `<g transform="translate(${it.x} ${it.y})">${it.svg}</g>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ROW_W}" height="${H}" viewBox="0 0 ${ROW_W} ${H}">${body}</svg>`;
    const png = new Resvg(svg, { fitTo: { mode: 'zoom', value: ratio }, shapeRendering: 2 }).render().asPng();
    const json = {};
    for (const it of items) {
      json[it.name] = { x: it.x * ratio, y: it.y * ratio, width: it.w * ratio, height: it.h * ratio, pixelRatio: ratio };
      if (it.extra) {
        json[it.name].stretchX = it.extra.stretchX.map(a => a.map(v => v * ratio));
        json[it.name].stretchY = it.extra.stretchY.map(a => a.map(v => v * ratio));
        json[it.name].content = it.extra.content.map(v => v * ratio);
      }
    }
    const sfx = ratio === 1 ? '' : `@${ratio}x`;
    fs.writeFileSync(path.join(OUT, `khareeta-${theme}${sfx}.png`), png);
    fs.writeFileSync(path.join(OUT, `khareeta-${theme}${sfx}.json`), JSON.stringify(json));
  }
  return items.length;
}
console.log('light', build('light'), 'icons; dark', build('dark'), 'icons');
