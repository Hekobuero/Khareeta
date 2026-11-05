// "Was ist hier?" sheet (long-press / right-click / ?p=lat,lon deep link) + share links. Pure logic in share-core.js.
import { t, getLang } from './i18n.js';
import { $, esc, toast, fetchJSON, digits } from './util.js';
import { ic } from './icons.js';
import { App, openSheet, closeSheet, setSelMarker } from './core.js';
import { track } from './analytics.js';
import { buildShareUrl, shareText, geoUri, fmt5, RevCache, Throttle, makeReverse, EventGate, pointKey } from './share-core.js';

const cache = new RevCache((() => { try { return localStorage; } catch { return null; } })());
const throttle = new Throttle(), fetchFn = u => fetchJSON(u, {}, 10000);
export const reverse = makeReverse({ fetchFn, cache, throttle });
// long-press lookups: only the latest one is fetched; older ones still waiting in the (shared) throttle are dropped
const reverseLatest = makeReverse({ fetchFn, cache, throttle, latest: true });
const whGate = new EventGate();

let cur = null;
export function openWhatsHere(lnglat, { name = null, route = false } = {}) {
  const [lon, lat] = lnglat;
  const my = cur = { lat, lon, name, addr: null };
  if (whGate.ok(pointKey(lat, lon))) track('whats_here', {}); // max 1 per point / 5 s
  setSelMarker([lon, lat], '#E5484D', null, name || '');
  const coords = fmt5(lat) + ', ' + fmt5(lon);
  const body = openSheet(`
  <div class="phead wh"><div>
    <h2 class="ptitle" dir="auto">${esc(name || t('whTitle'))}</h2>
    <p class="psub" id="whAddr" dir="auto"><span class="muted">${esc(t('whAddrLoading'))}</span></p>
  </div><button class="pclose" id="whClose" aria-label="${esc(t('close'))}">${ic('close')}</button></div>
  <div class="arow actions">
    <button class="abtn primary" id="whRoute">${ic('directions')}<span>${esc(t('whRouteHere'))}</span></button>
    <button class="abtn" id="whShare">${ic('share')}<span>${esc(t('whShare'))}</span></button>
    <button class="abtn" id="whCopy" aria-label="${esc(t('whCopyCoords'))}" title="${esc(t('whCopyCoords'))}">${ic('copy')}<span>${esc(t('whCopyShort'))}</span></button>
  </div>
  <div class="igroup">
    <button class="irow" id="whCoord" type="button"><div class="iv"><label>${esc(t('whCoords'))}</label><div class="val"><bdi dir="ltr">${esc(digits(coords))}</bdi></div></div>${ic('copy', 'sm')}</button>
    <a class="irow" id="whGeo" href="${esc(geoUri(lat, lon))}"><div class="iv"><label>${esc(t('whGeo'))}</label><div class="val"><bdi dir="ltr">${esc(geoUri(lat, lon))}</bdi></div></div></a>
  </div><div style="height:16px"></div>`, 'half', () => { if (cur === my) { setSelMarker(null); cur = null; } });
  App.sheetKind = 'whats-here';
  const copyCoords = async () => { try { await navigator.clipboard.writeText(coords); toast(t('whCoordsCopied')); } catch { prompt(t('whCoords'), coords); } };
  body.querySelector('#whClose').onclick = () => closeSheet();
  body.querySelector('#whCopy').onclick = copyCoords;
  body.querySelector('#whCoord').onclick = copyCoords;
  body.querySelector('#whRoute').onclick = () => routeTo(my);
  body.querySelector('#whShare').onclick = () => sharePoint(my);
  reverseLatest(lat, lon, getLang()).then(a => { my.addr = a; if (cur !== my) return; const el = $('#whAddr'); if (el) el.textContent = a || t('whNoAddr'); })
    .catch(e => { if (e?.name !== 'AbortError' && cur === my) { const el = $('#whAddr'); if (el) el.textContent = t('whNoAddr'); } });
  if (route) routeTo(my, true);
}

async function routeTo(p, fromLink = false) {
  const { openDirections } = await import('./route.js');
  const to = { name: p.name || p.addr || fmt5(p.lat) + ', ' + fmt5(p.lon), lat: p.lat, lon: p.lon };
  if (!App.me && fromLink) {
    // ask for GPS (locate button logic), then open the route from the position; without GPS the panel asks for a start
    toast(t('whNeedGps'), 3000);
    $('#btnLocate')?.click();
    for (let i = 0; i < 40 && !App.me; i++) await new Promise(r => setTimeout(r, 250));
  }
  openDirections({ to });
}

export async function sharePoint(p, { route = false, linkName = true } = {}) {
  const name = p.name || null;
  const url = buildShareUrl({ lat: p.lat, lon: p.lon, name: linkName ? name : null, route });
  const text = shareText({ lang: getLang(), name: name || p.addr, address: p.addr, url, lat: p.lat, lon: p.lon });
  track('share', {}); // never coordinates
  if (navigator.share) {
    try { await navigator.share({ title: t('shareTitle', { n: name || t('whTitle') }), text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  const full = shareText({ lang: getLang(), name: name || p.addr, address: p.addr, url, lat: p.lat, lon: p.lon, geo: true });
  try { await navigator.clipboard.writeText(full); toast(t('whCopied'), 3500); return 'copied'; } catch { prompt(t('whShare'), url); return 'prompt'; }
}

export async function shareMyLocation() {
  if (!App.me) { $('#btnLocate')?.click(); for (let i = 0; i < 40 && !App.me; i++) await new Promise(r => setTimeout(r, 250)); }
  if (!App.me) { toast(t('locErr')); return; }
  const [lon, lat] = App.me;
  let addr = ''; try { addr = await reverse(lat, lon, getLang()); } catch {}
  return sharePoint({ lat, lon, name: t('myLocName'), addr }, { linkName: false }); // no n= in the link (P3)
}
