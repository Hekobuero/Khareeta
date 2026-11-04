// Place details: OSM tags via Overpass (fallback Nominatim), Wikidata/Wikipedia, Wikimedia Commons photos,
// Panoramax street-level images, Open-Meteo weather, nearby places.
import { poiIndexFor, toItem, P as POIS } from './poi.js';
import { $, esc, fetchJSON, nominatim, overpass, fmtDist, fmtDur, fmtCoord, plusEncode, haversine, lsGet, lsSet, toast, nf, digits, settings } from './util.js';
import { t, getLang } from './i18n.js';
import { ic } from './icons.js';
import { App, openSheet, setSheet, closeSheet, setSelMarker, pickName, catLabel, catIcon, refPoint, sheetState, mapPadding, fitTo } from './core.js';
import { ohStatus, ohTable } from './hours.js';
import { phones as phoneList, website as websiteOf, socials as socialList } from './links.js';
import { openDirections } from './route.js';
import { track } from './analytics.js';
import { photoSources, loadPhotos } from './photos.js';

let cur = null, token = 0;
const navActiveSafe = () => document.body.classList.contains('nav');
const onPlaceClose = () => { setSelMarker(null); cur = null; };
export function currentPlace() { return cur; }

const tagCache = new Map();
async function loadTags(item) {
  const key = item.osm_type + item.osm_id;
  if (tagCache.has(key)) return tagCache.get(key);
  let tags = null, ll = null, addr = null, parts = null, thin = false;
  // Nominatim lookup returns all tags (extratags + namedetails) and a formatted address
  try {
    const j = await nominatim(`lookup?osm_ids=${item.osm_type[0].toUpperCase()}${item.osm_id}&format=jsonv2&extratags=1&namedetails=1&addressdetails=1&accept-language=${getLang()}`);
    if (j[0]) {
      tags = Object.assign({}, j[0].extratags, j[0].namedetails, { [j[0].category]: j[0].type }); ll = [+j[0].lon, +j[0].lat];
      thin = !j[0].extratags || !Object.keys(j[0].extratags).length; // Nominatim without extratags → ask Overpass too
      const a = j[0].address || {};
      addr = [a.road ? a.road + (a.house_number ? ' ' + a.house_number : '') : null, a.neighbourhood || a.quarter || a.suburb, a.city || a.town || a.village || a.municipality].filter(Boolean).join(', ');
      parts = { nb: a.neighbourhood || a.quarter || a.suburb, city: a.city || a.town || a.village || a.municipality };
    }
  } catch {}
  if (!tags || thin) {
    try {
      const j = await overpass(`[out:json][timeout:12];${item.osm_type}(${item.osm_id});out tags center 1;`, 12000);
      const el = j.elements[0];
      if (el) { tags = Object.assign({}, tags, el.tags || {}); if (!ll) ll = [el.lon ?? el.center?.lon, el.lat ?? el.center?.lat]; }
    } catch {}
  }
  const r = tags ? { tags, ll, addr, parts } : null;
  if (r) tagCache.set(key, r);
  return r;
}

export function isSaved(id) { return lsGet('kh.saved', []).some(s => s.id === id); }
export function toggleSave(item, kind = 'fav') {
  let list = lsGet('kh.saved', []);
  if (kind !== 'fav') list = list.filter(s => s.kind !== kind);
  const ex = list.find(s => s.id === item.id && s.kind === kind);
  if (ex && kind === 'fav') list = list.filter(s => s !== ex);
  else list.unshift({ id: item.id, osm_type: item.osm_type, osm_id: item.osm_id, name: item.name, sub: item.sub, lon: item.lon, lat: item.lat, tags: slimTags(item.tags), kind, coord: item.coord });
  lsSet('kh.saved', list);
  return !ex;
}
function slimTags(tg = {}) { const o = {}; for (const k of ['name', 'name:ar', 'name:en', 'amenity', 'shop', 'tourism', 'place', 'opening_hours', 'phone', 'contact:phone', 'website', 'addr:street', 'addr:housenumber', 'addr:city', 'cuisine']) if (tg[k]) o[k] = tg[k]; return o; }

export function shareUrl(item) {
  const u = new URL(location.href.split('#')[0].split('?')[0]);
  if (item.osm_type && item.osm_id) u.searchParams.set('p', item.osm_type[0] + item.osm_id);
  u.searchParams.set('ll', item.lat.toFixed(6) + ',' + item.lon.toFixed(6));
  if (item.name && item.coord !== true) u.searchParams.set('n', item.name.slice(0, 80));
  return u.toString();
}
export async function share(title, url) {
  track('share', {});
  if (navigator.share) { try { await navigator.share({ title, text: title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast(t('copied')); } catch { prompt(t('share'), url); }
}

function addrFromTags(tg) {
  const st = tg['addr:street'] ? tg['addr:street'] + (tg['addr:housenumber'] ? ' ' + tg['addr:housenumber'] : '') : tg['addr:place'];
  return [st, tg['addr:suburb'] || tg['addr:district'], tg['addr:city']].filter(Boolean).join(', ');
}

// ---------- main ----------
export async function openPlace(item, opts = {}) {
  const my = ++token;
  cur = item; track('place_view', { cat: item.tags?.amenity || item.tags?.shop || item.tags?.tourism || item.tags?.place || (item.coord ? 'pin' : null) });
  const ll = [item.lon, item.lat];
  App.selPoi = poiIndexFor(item);
  if (App.selPoi != null && !item.poi) { const b = toItem(POIS.all[App.selPoi]).tags; item.tags = Object.assign({}, b, item.tags || {}); }
  { const [icn, col] = catIcon(item.tags || {}); setSelMarker(ll, item.coord ? '#E5484D' : col, item.coord ? null : icn, item.tags?.name || item.name); }
  render(item, item.tags || {}, !item.coord && !item.full);
  if (!opts.noFly) {
    const e = item.extent;
    if (e && e.length === 4 && item.osm_type !== 'node' && Math.abs(e[2] - e[0]) > 0.005) {
      fitTo([[Math.min(e[0], e[2]), Math.min(e[1], e[3])], [Math.max(e[0], e[2]), Math.max(e[1], e[3])]], (p => ({ ...p, top: p.top + 20, bottom: p.bottom + 30, left: p.left + 30, right: p.right + 30 }))(mapPadding()), { duration: 700, maxZoom: 16 });
    } else App.map.flyTo({ center: ll, zoom: Math.max(App.map.getZoom(), item.tags?.place === 'city' ? 11 : 16.5), duration: 700, padding: mapPadding() });
  } else if (!navActiveSafe()) {
    // make sure the pin is not under the sheet
    const pt = App.map.project(ll), pad = mapPadding();
    if (pt.y > innerHeight - pad.bottom - 40 || pt.y < pad.top) App.map.easeTo({ center: ll, padding: pad, duration: 400 });
  }
  extras(item, item.tags || {}, my, false);
  if (item.coord || !item.osm_type || item.full) { extras(item, item.tags || {}, my, true); return; }
  await loadDetails(item, my);
}
// Full OSM tags (Nominatim → Overpass) → re-render the sheet when they arrive; offline → note + retry on "online".
async function loadDetails(item, my) {
  const r = await loadTags(item);
  if (my !== token || cur !== item) return;
  if (!r) {
    // offline / Nominatim+Overpass both failed (e.g. deep link while offline): graceful state, retry when back online
    render(item, item.tags || {}, false);
    const n = document.createElement('p'); n.className = 'pnote muted'; n.id = 'pNoData'; n.setAttribute('role', 'status');
    n.textContent = t(navigator.onLine === false ? 'detailsOffline' : 'detailsFailed');
    $('.phead')?.after(n);
    extras(item, item.tags || {}, my, true);
    const retry = () => { if (my === token && cur === item) { $('#pNoData')?.remove(); loadDetails(item, my); } };
    addEventListener('online', retry, { once: true });
    return;
  }
  if (r) { item.tags = Object.assign({}, item.tags, r.tags); if (r.parts) item.addrParts = r.parts; if (r.addr && !addrFromTags(item.tags)) item.sub = r.addr; if (r.ll && r.ll[0] != null && !item.lon) { item.lon = r.ll[0]; item.lat = r.ll[1]; } }
  render(item, item.tags, false);
  extras(item, item.tags, my, true);
}

function irow(label, val, extra = '', cls = '') { return `<div class="irow ${cls}"><div class="iv"><label>${label}</label><div class="val">${val}</div></div>${extra}</div>`; }
function locality(item, tg) {
  const a = item.addrParts || {};
  return [a.nb || tg['addr:suburb'] || tg['addr:district'], a.city || tg['addr:city']].filter(Boolean).join(', ');
}
const etaCache = new Map();
async function driveEta(item) {
  if (!App.me || !navigator.onLine) return null;
  const d = haversine(App.me, [item.lon, item.lat]); if (d < 30 || d > 400000) return null;
  const k = item.lon.toFixed(4) + item.lat.toFixed(4) + App.me.map(x => x.toFixed(3)).join();
  if (etaCache.has(k)) return etaCache.get(k);
  const j = await fetchJSON(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${App.me[0]},${App.me[1]};${item.lon},${item.lat}?overview=false`, {}, 8000);
  const v = j.routes?.[0]?.duration ?? null; etaCache.set(k, v); return v;
}

function render(item, tg, loading) {
  const nm = pickName(tg);
  const title = nm.primary || item.name || t('whatsHere');
  const second = nm.secondary && nm.secondary !== title ? nm.secondary : '';
  const cat = item.coord ? t('droppedPin') : catLabel(tg);
  const st = ohStatus(tg.opening_hours);
  const d = App.me ? fmtDist(haversine(App.me, [item.lon, item.lat])) : '';
  const phones = phoneList(tg), web = websiteOf(tg), soc = socialList(tg);
  const saved = isSaved(item.id);
  const addr = addrFromTags(tg) || item.sub || '';
  const loc = locality(item, tg);
  const rows = [];
  rows.push(irow(t('address'), `<span id="pAddr">${addr ? `<bdi>${esc(addr)}</bdi>` : `<span class="muted">${t('loading')}</span>`}</span>`));
  if (tg.opening_hours) {
    // Parsed → today's line + expandable week (today highlighted). Not parseable → raw OSM text, no status line.
    const tbl = ohTable(tg.opening_hours);
    const td = tbl && (tbl.find(r => r.today) || tbl[0]);
    rows.push(tbl
      ? `<div class="irow click" id="pHours" role="button" tabindex="0" aria-expanded="false" aria-controls="pHoursTbl"><div class="iv"><span class="sr-only">${esc(t('showWeek'))}: </span><label>${t('hours')}</label><div class="val">${st ? `<span class="sr-only">${esc(st.text)}. </span>` : ''}<bdi>${esc(td.day)}</bdi> <bdi dir="ltr">${esc(td.txt)}</bdi><table class="hours hidden" id="pHoursTbl">${tbl.map(r => `<tr class="${r.today ? 'today' : ''}"><td>${esc(r.day)}</td><td><bdi dir="ltr">${esc(r.txt)}</bdi></td></tr>`).join('')}</table><small class="hours-tz hidden">${t('localTime')}</small></div></div><span class="chev">${ic('chevronDown', 'sm')}</span></div>`
      : irow(t('hours'), `<bdi class="oh-raw">${esc(String(tg.opening_hours).slice(0, 300))}</bdi>`));
  }
  phones.forEach(p => rows.push(irow(t('phone'), `<a href="tel:${esc(p.tel)}" dir="ltr">${esc(digits(p.display))}</a>`)));
  if (web) rows.push(irow(t('website'), `<a href="${esc(web.href)}" target="_blank" rel="noopener noreferrer" dir="ltr" class="ell">${esc(web.domain)}</a>`));
  const email = tg.email || tg['contact:email'];
  if (email && /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(email)) rows.push(irow(t('email'), `<a href="mailto:${esc(email)}" dir="ltr">${esc(email)}</a>`));
  rows.push(`<div id="pWikiRow" class="hidden"></div>`);
  rows.push(irow(t('coordinates'), `<span dir="ltr">${esc(plusEncode(item.lat, item.lon))}</span><small dir="ltr">${fmtCoord(item.lat, item.lon)}</small>`, `<button class="ib" id="pCopy" aria-label="${t('copy')}">${ic('copy', 'sm')}</button>`, 'click'));
  const osmEdit = item.osm_type && item.osm_id ? `https://www.openstreetmap.org/edit?${item.osm_type}=${item.osm_id}` : `https://www.openstreetmap.org/note/new#map=19/${item.lat}/${item.lon}`;
  const osmView = item.osm_type && item.osm_id ? `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}` : `https://www.openstreetmap.org/#map=18/${item.lat}/${item.lon}`;
  rows.push(irow(t('suggestEdit'), `<a href="${osmEdit}" target="_blank" rel="noopener">${t('editOsm')}</a> · <a href="${osmView}" target="_blank" rel="noopener">${t('osmLink')}</a>`));
  // facts as tags
  const facts = [];
  if (tg.cuisine) facts.push([ic('cuisine', 'xs'), tg.cuisine.split(';').map(s => s.replace(/_/g, ' ')).join(', ')]);
  if (tg.wheelchair) facts.push([ic('wheelchair', 'xs'), tg.wheelchair === 'yes' ? t('wcYes') : tg.wheelchair === 'limited' ? t('wcLimited') : t('wcNo')]);
  if (tg.internet_access && tg.internet_access !== 'no') facts.push([ic('wifi', 'xs'), tg['internet_access:fee'] === 'no' ? t('wifiFree') : t('wifiYes')]);
  if (tg.outdoor_seating === 'yes') facts.push([ic('outdoor', 'xs'), t('outdoor')]);
  if (tg.takeaway === 'yes' || tg.takeaway === 'only') facts.push([ic('takeaway', 'xs'), t('takeaway')]);
  if (tg.delivery === 'yes') facts.push([ic('delivery', 'xs'), t('delivery')]);
  const pays = Object.keys(tg).filter(k => k.startsWith('payment:') && tg[k] === 'yes').map(k => k.slice(8).replace(/_/g, ' '));
  if (pays.length) facts.push([ic('card', 'xs'), t('payment') + ': ' + pays.join(', ')]);
  if (tg.operator) facts.push([ic('info', 'xs'), t('operator') + ': ' + tg.operator]);
  if (tg.brand && tg.brand !== title) facts.push([ic('info', 'xs'), t('brand') + ': ' + tg.brand]);
  if (tg.level) facts.push([ic('stairs', 'xs'), t('level') + ': ' + tg.level]);
  if (tg.ele) facts.push([ic('elevation', 'xs'), t('elevation') + ': ' + nf(Math.round(+tg.ele)) + ' ' + t('m')]);
  if (tg.population) facts.push([ic('info', 'xs'), '👥 ' + nf(+tg.population || 0)]);
  if (tg.fee === 'yes') facts.push([ic('cash', 'xs'), t('fee')]);

  // 4th action: Call → Website → More
  let fourth;
  if (phones[0]) fourth = `<a class="abtn" href="tel:${esc(phones[0].tel)}">${ic('phone')}<span>${t('call')}</span></a>`;
  else if (web) fourth = `<a class="abtn" href="${esc(web.href)}" target="_blank" rel="noopener noreferrer">${ic('web')}<span>${t('website')}</span></a>`;
  else fourth = `<button class="abtn" id="pMore">${ic('dots')}<span>${t('more')}</span></button>`;
  // Round contact buttons (website, WhatsApp, Telegram, Facebook, Instagram) – only when the place has social links.
  // Call (or website when there is no phone) is already the 4th main action, so it is not repeated here. URLs come from links.js (validated).
  const contacts = soc.length ? [
    web && phones[0] && { href: web.href, icon: 'web', label: t('website'), ext: true }, // not already the 4th action
    ...soc.map(s => ({ href: s.href, icon: s.kind, label: t(s.kind), ext: true })),
  ].filter(Boolean) : [];
  const contactRow = contacts.length ? `<div class="crow" role="group" aria-label="${esc(t('contactRow'))}">${contacts.map(c => `<a class="cbtn" href="${esc(c.href)}"${c.ext ? ' target="_blank" rel="noopener noreferrer"' : ''} aria-label="${esc(c.label)}"><span class="cc">${ic(c.icon)}</span><span class="cl">${esc(c.label)}</span></a>`).join('')}</div>` : '';
  const eta = item._eta;
  const statusHtml = st ? `<p class="pstatus"><span class="${st.cls}">${esc(st.text.split(' · ')[0])}</span>${st.text.includes(' · ') ? ' · ' + esc(st.text.split(' · ').slice(1).join(' · ')) : ''}</p>` : '';
  const html = `
  <div class="phead"><div>
    <h2 class="ptitle" dir="auto">${esc(title)}</h2>
    ${second ? `<p class="psub" dir="auto">${esc(second)}</p>` : ''}
    <p class="psub">${[cat, loc && `<bdi>${esc(loc)}</bdi>`, d].filter(Boolean).map((x, i) => i === 1 ? x : esc(x)).join(' · ')}</p>
    ${statusHtml}
  </div><button class="pclose" id="pClose" aria-label="${t('close')}">${ic('close')}</button></div>
  ${loading && !item.coord ? '<div style="padding:0 16px"><div class="skel" style="width:40%"></div></div>' : ''}
  <div class="arow actions">
    <button class="abtn primary" id="pDir">${ic(App.mode === 'foot' ? 'walk' : App.mode === 'bike' ? 'bike' : 'car')}<span id="pEta">${eta ? fmtDur(eta) : t('directionsBtn')}</span></button>
    <button class="abtn" id="pSave">${ic(saved ? 'bookmark' : 'bookmarkOutline')}<span>${saved ? t('savedOk') : t('save')}</span></button>
    <button class="abtn" id="pShare">${ic('share')}<span>${t('share')}</span></button>
    ${fourth}
  </div>
  ${contactRow}
  ${!settings.lowData && photoSources(tg).any ? photoBox() : ''}
  <div id="pWiki"></div>
  ${facts.length ? `<div class="tags">${facts.map(([i, s]) => `<span class="tag">${i}<bdi>${esc(s)}</bdi></span>`).join('')}</div>` : ''}
  <div class="igroup">${rows.join('')}</div>
  <div class="igroup" id="pWxG"><div class="irow" id="pWx"><div class="iv"><label>${t('weather')}</label><div class="val"><span class="muted">${t('loading')}</span></div></div></div></div>
  <div id="pPano"></div>
  <div id="pNearby"></div>
  <div class="arow" style="margin-top:12px">
    ${App.me ? `<button class="abtn" id="pStart">${ic('navigation')}<span>${t('start')}</span></button>` : ''}
    <button class="abtn" id="pHome">${ic('home')}<span>${t('setHome')}</span></button>
    <button class="abtn" id="pWork">${ic('work')}<span>${t('setWork')}</span></button>
  </div>
  <div style="height:16px"></div>`;
  const keep = sheetState();
  const body = openSheet(html, keep === 'full' || keep === 'half' ? keep : 'half', onPlaceClose);
  const it = { ...item, name: title };
  body.querySelector('#pClose').onclick = () => closeSheet();
  body.querySelector('#pDir').onclick = () => openDirections({ to: it });
  body.querySelector('#pStart')?.addEventListener('click', () => openDirections({ to: it, autostart: true }));
  body.querySelector('#pSave').onclick = () => { const on = toggleSave(it); toast(on ? t('savedOk') : t('remove')); render(item, tg, false); };
  body.querySelector('#pShare').onclick = () => share(title, shareUrl(it));
  body.querySelector('#pMore')?.addEventListener('click', () => { const g = body.querySelector('.igroup'); setSheet('full'); g?.scrollIntoView({ behavior: 'smooth' }); });
  const hr = body.querySelector('#pHours');
  if (hr) {
    const tog = () => { const open = hr.getAttribute('aria-expanded') !== 'true'; hr.setAttribute('aria-expanded', String(open)); hr.classList.toggle('open', open); hr.querySelectorAll('table, .hours-tz').forEach(el => el.classList.toggle('hidden', !open)); };
    hr.addEventListener('click', e => { if (!e.target.closest('a')) tog(); });
    hr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } });
  }
  body.querySelector('#pCopy').onclick = async () => { try { await navigator.clipboard.writeText(plusEncode(item.lat, item.lon) + ' ' + item.lat.toFixed(6) + ',' + item.lon.toFixed(6)); toast(t('copied')); } catch {} };
  body.querySelector('#pHome').onclick = () => { toggleSave({ ...it, name: title }, 'home'); toast(t('savedOk')); };
  body.querySelector('#pWork').onclick = () => { toggleSave({ ...it, name: title }, 'work'); toast(t('savedOk')); };
  if (item._extras) applyExtras(item._extras);
  if (!item._eta && !item._etaTried) { item._etaTried = true; driveEta(item).then(v => { if (!v || cur !== item) return; item._eta = v; const e = $('#pEta'); if (e) e.textContent = fmtDur(v); }).catch(() => {}); }
}

// ---------- async extras ----------
// phase false: coordinate-based (weather, nearby, address) – starts immediately
// phase true: tag-based (photos, Wikipedia, Panoramax) – after tags are known
async function extras(item, tg, my, phase) {
  const ex = item._extras = item._extras || {};
  const jobs = [];
  if (!phase) {
    if (!addrFromTags(tg) && !item.sub) jobs.push(nominatim(`reverse?lat=${item.lat}&lon=${item.lon}&format=jsonv2&zoom=18&accept-language=${getLang()}`).then(j => { ex.addr = (j.display_name || '').split(',').slice(0, 4).join(','); }).catch(() => { ex.addr = ''; }));
    jobs.push(weather(item.lat, item.lon).then(w => ex.wx = w).catch(() => ex.wx = null));
    jobs.push(nearby(item).then(n => ex.nearby = n).catch(() => {}));
    if (!settings.lowData) jobs.push(panoramax(item.lat, item.lon).then(p => ex.pano = p).catch(() => {}));
  } else if (!settings.lowData) {
    if (photoSources(tg).any) jobs.push(loadPhotos(tg, u => fetchJSON(u, {}, 8000)).then(p => {
      ex.photos = p;
      if (p.error === 'offline') addEventListener('online', () => { if (my === token && cur === item) extras(item, tg, my, true); }, { once: true });
    }).catch(() => ex.photos = { photos: [], error: 'offline' }));
    jobs.push(wiki(tg).then(w => ex.wiki = w).catch(() => {}));
  }
  for (const j of jobs) j.then(() => { if (my === token && cur === item) applyExtras(ex); });
  await Promise.allSettled(jobs);
}

function applyExtras(ex) {
  const body = $('#sheetBody');
  if (ex.addr !== undefined) { const a = body.querySelector('#pAddr'); if (a && a.querySelector('.muted')) a.innerHTML = ex.addr ? `<bdi>${esc(ex.addr)}</bdi>` : '—'; }
  if (ex.wx) { const w = body.querySelector('#pWx .val'); if (w) w.innerHTML = ex.wx; }
  else if (ex.wx === null) body.querySelector('#pWxG')?.remove();
  if (ex.photos) {
    const p = body.querySelector('#pPhotos');
    if (p && p.dataset.state === 'loading') fillPhotos(p, ex.photos);
  }
  if (ex.wiki) {
    const w = body.querySelector('#pWiki'); if (w && !w.innerHTML) w.innerHTML = `<p class="wiki-sum" dir="auto">${esc(ex.wiki.extract)}</p>`;
    const r = body.querySelector('#pWikiRow'); if (r && r.classList.contains('hidden')) { r.outerHTML = irow(t('wiki'), `<a href="${esc(ex.wiki.url)}" target="_blank" rel="noopener">${esc(decodeURIComponent(ex.wiki.url.split('/').pop()).replace(/_/g, ' '))}</a><small>CC BY-SA 4.0</small>`); }
  }
  if (ex.pano?.length) { const w = body.querySelector('#pPano'); if (w && !w.innerHTML) w.innerHTML = `<h3 class="sect-title">${t('streetView')}</h3><div class="photos">${ex.pano.map(p => `<figure><a href="${esc(p.link)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(p.src)}" alt=""></a></figure>`).join('')}</div><p class="credit">Panoramax · CC BY-SA</p>`; }
  if (ex.nearby?.length) {
    const w = body.querySelector('#pNearby');
    if (w && !w.innerHTML) {
      w.innerHTML = `<h3 class="sect-title">${t('nearby')}</h3><div class="list">${ex.nearby.map((n, i) => { const [icn, col] = catIcon(n.tags); return `<div class="srow" data-i="${i}"><div class="sic badge" style="background:${col}">${ic(icn)}</div><div class="st"><div class="t1" dir="auto">${esc(n.name)}</div><div class="t2">${esc(catLabel(n.tags))}</div></div><div class="dist">${fmtDist(n.d)}</div></div>`; }).join('')}</div>`;
      w.querySelector('.list').onclick = e => { const r = e.target.closest('.srow'); if (r) openPlace(ex.nearby[+r.dataset.i]); };
    }
  }
}

const WMO = { 0: ['☀️', 'Clear', 'صافٍ', 'Klar'], 1: ['🌤️', 'Mainly clear', 'صافٍ غالبًا', 'Überwiegend klar'], 2: ['⛅', 'Partly cloudy', 'غائم جزئيًا', 'Teilweise bewölkt'], 3: ['☁️', 'Overcast', 'غائم', 'Bedeckt'], 45: ['🌫️', 'Fog', 'ضباب', 'Nebel'], 48: ['🌫️', 'Fog', 'ضباب', 'Nebel'], 51: ['🌦️', 'Drizzle', 'رذاذ', 'Nieselregen'], 53: ['🌦️', 'Drizzle', 'رذاذ', 'Nieselregen'], 55: ['🌦️', 'Drizzle', 'رذاذ', 'Nieselregen'], 61: ['🌧️', 'Rain', 'مطر', 'Regen'], 63: ['🌧️', 'Rain', 'مطر', 'Regen'], 65: ['🌧️', 'Heavy rain', 'مطر غزير', 'Starkregen'], 71: ['🌨️', 'Snow', 'ثلج', 'Schnee'], 73: ['🌨️', 'Snow', 'ثلج', 'Schnee'], 75: ['❄️', 'Heavy snow', 'ثلج كثيف', 'Starker Schneefall'], 80: ['🌦️', 'Showers', 'زخات', 'Schauer'], 81: ['🌧️', 'Showers', 'زخات', 'Schauer'], 82: ['⛈️', 'Heavy showers', 'زخات غزيرة', 'Starke Schauer'], 95: ['⛈️', 'Thunderstorm', 'عاصفة رعدية', 'Gewitter'], 96: ['⛈️', 'Thunderstorm', 'عاصفة رعدية', 'Gewitter'], 99: ['⛈️', 'Thunderstorm', 'عاصفة رعدية', 'Gewitter'] };
export function wmo(code, isDay = 1) { const w = WMO[code] || WMO[Math.floor(code / 10) * 10] || ['🌡️', '', '', '']; const i = getLang() === 'ar' ? 2 : getLang() === 'de' ? 3 : 1; let e = w[0]; if (!isDay && code <= 1) e = '🌙'; return [e, w[i]]; }
const wxCache = new Map();
export async function weatherRaw(lat, lon) {
  const k = lat.toFixed(2) + ',' + lon.toFixed(2);
  const c = wxCache.get(k); if (c && Date.now() - c.t < 15 * 60000) return c.j;
  const j = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`, {}, 8000);
  wxCache.set(k, { t: Date.now(), j }); return j;
}
async function weather(lat, lon) {
  const j = await weatherRaw(lat, lon), c = j.current;
  const [e, txt] = wmo(c.weather_code, c.is_day);
  return `<div class="wx"><span style="font-size:28px">${e}</span><div><div class="t">${nf(Math.round(c.temperature_2m))}°C</div><small>${esc(txt)} · ${t('feels')} ${nf(Math.round(c.apparent_temperature))}° · ↑${nf(Math.round(j.daily.temperature_2m_max[0]))}° ↓${nf(Math.round(j.daily.temperature_2m_min[0]))}°</small><small>${t('wind')} ${nf(Math.round(c.wind_speed_10m))} km/h · ${t('humidity')} ${nf(c.relative_humidity_2m)}% · ${t('elevation')} ${nf(Math.round(j.elevation))} m</small><small><a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0)</small></div></div>`;
}

// ---------- photos (Wikimedia Commons) ----------
// Fixed 4:3 box reserved as soon as the tags name a photo source → no layout jump when the image arrives.
function photoBox() {
  return `<section class="pphotos" id="pPhotos" data-state="loading" aria-label="${esc(t('photos'))}" aria-busy="true"><figure class="ph"><div class="ph-box skel-box"></div><figcaption class="ph-cap"><span class="skel" style="width:60%"></span></figcaption></figure></section>`;
}
function photoEmpty(key) {
  return `<figure class="ph ph-empty"><div class="ph-box" role="img" aria-label="${esc(t(key))}">${ic('image', 'sm')}<span>${esc(t(key))}</span></div></figure>`;
}
function fillPhotos(box, res) {
  box.removeAttribute('aria-busy');
  const list = res.photos || [];
  if (!list.length) { box.dataset.state = 'empty'; box.innerHTML = photoEmpty(res.error === 'offline' || navigator.onLine === false ? 'photoOffline' : 'photoNone'); return; }
  box.dataset.state = 'ok';
  box.innerHTML = list.map(ph => `<figure class="ph">
    <a class="ph-box" href="${esc(ph.page)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('photoOpen'))}: ${esc(ph.alt)}"><img src="${esc(ph.thumb)}" alt="${esc(ph.alt)}" width="${+ph.width}" height="${+ph.height}" loading="lazy" decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer"></a>
    <figcaption class="ph-cap" dir="auto"><bdi>${esc(ph.artist ? t('photoBy', { a: ph.artist }) : t('photoUnknown'))}</bdi>${ph.license ? ` · ${ph.licenseUrl ? `<a href="${esc(ph.licenseUrl)}" target="_blank" rel="noopener noreferrer license"><bdi dir="ltr">${esc(ph.license)}</bdi></a>` : `<bdi dir="ltr">${esc(ph.license)}</bdi>`}` : ''} · <a href="${esc(ph.page)}" target="_blank" rel="noopener noreferrer">${esc(t('photoSource'))}</a></figcaption>
  </figure>`).join('');
  box.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
    img.closest('.ph')?.remove();
    if (!box.querySelector('.ph')) { box.dataset.state = 'empty'; box.innerHTML = photoEmpty(navigator.onLine === false ? 'photoOffline' : 'photoNone'); }
  }, { once: true }));
}

async function wiki(tg) {
  const l = getLang(), order = [l, 'ar', 'en', 'de'].filter((v, i, a) => a.indexOf(v) === i);
  let title = null, wl = null;
  if (tg.wikidata) {
    try {
      const j = await fetchJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${tg.wikidata}&props=sitelinks&format=json&origin=*`, {}, 8000);
      const sl = j.entities?.[tg.wikidata]?.sitelinks || {};
      for (const x of order) if (sl[x + 'wiki']) { title = sl[x + 'wiki'].title; wl = x; break; }
    } catch {}
  }
  if (!title && tg.wikipedia) { const m = tg.wikipedia.match(/^([a-z-]+):(.+)$/); if (m) { wl = m[1]; title = m[2]; } }
  if (!title) return null;
  const j = await fetchJSON(`https://${wl}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, {}, 8000);
  if (!j.extract) return null;
  return { extract: j.extract.length > 420 ? j.extract.slice(0, 400).replace(/\s\S*$/, '') + '…' : j.extract, url: j.content_urls?.mobile?.page || j.content_urls?.desktop?.page };
}

async function panoramax(lat, lon) {
  const d = 0.0008;
  const j = await fetchJSON(`https://api.panoramax.xyz/api/search?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&limit=4`, {}, 7000);
  return (j.features || []).map(f => ({ src: f.assets?.thumb?.href, link: `https://api.panoramax.xyz/#focus=pic&pic=${f.id}&map=18/${lat}/${lon}` })).filter(p => p.src);
}

async function nearby(item) {
  const q = `[out:json][timeout:12];(nwr(around:250,${item.lat},${item.lon})["name"]["amenity"~"^(restaurant|cafe|fast_food|pharmacy|hospital|clinic|bank|atm|fuel|place_of_worship|school|university|bureau_de_change|parking)$"];nwr(around:250,${item.lat},${item.lon})["name"]["shop"];nwr(around:250,${item.lat},${item.lon})["name"]["tourism"~"^(hotel|museum|attraction|guest_house)$"];);out center tags 30;`;
  const j = await overpass(q, 12000);
  return j.elements.filter(e => !(e.type === item.osm_type && e.id == item.osm_id)).map(e => {
    const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
    return { id: e.type[0].toUpperCase() + e.id, osm_type: e.type, osm_id: e.id, name: pickName(e.tags).primary, tags: e.tags, lon, lat, full: true, d: haversine([item.lon, item.lat], [lon, lat]) };
  }).sort((a, b) => a.d - b.d).slice(0, 8);
}

// "What's here" – long press / right click
export function openPoint(lnglat) {
  const item = { id: 'pt' + lnglat[0].toFixed(5) + lnglat[1].toFixed(5), coord: true, name: t('whatsHere'), lon: lnglat[0], lat: lnglat[1], tags: {} };
  track('whats_here', {});
  openPlace(item, { noFly: true });
}
