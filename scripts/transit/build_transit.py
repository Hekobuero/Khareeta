#!/usr/bin/env python3
"""Build static transit-line data (Servis / microbus / bus) for Damascus and Aleppo from OpenStreetMap.

Polite: ONE Overpass query per city, answers cached in scripts/transit/.cache/ (reused unless --refresh),
descriptive User-Agent, pause between cities. Output: data/transit/<city>.json (+ data/transit/index.json,
scripts/transit/last_build_stats.json size report). Data © OpenStreetMap contributors, ODbL.
Only what OSM contains is written – nothing is invented.
Usage: python3 scripts/transit/build_transit.py [--refresh] [--city damascus]
"""
import json, math, os, sys, time, urllib.parse, urllib.request, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(os.path.dirname(__file__), '.cache')
OUT = os.path.join(ROOT, 'data', 'transit')
ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
UA = 'Khareeta-transit-build/1.0 (+https://khareeta.app; static OSM data build)'
# bbox: south, west, north, east (city + suburbs reachable by Servis)
CITIES = {
    'damascus': {'name': 'Damascus', 'name_ar': 'دمشق', 'bbox': (33.36, 36.12, 33.62, 36.48)},
    'aleppo': {'name': 'Aleppo', 'name_ar': 'حلب', 'bbox': (36.10, 37.02, 36.30, 37.30)},
}
ROUTES = 'bus|share_taxi|minibus'
TOL_M = 8  # Douglas-Peucker tolerance (metres)
KEYS = ['name', 'name:ar', 'name:en', 'ref', 'from', 'to', 'operator', 'network']

def query(bbox):
    b = ','.join(str(x) for x in bbox)
    return f"""[out:json][timeout:240];
rel["type"="route"]["route"~"^({ROUTES})$"]({b})->.r;
(.r; rel(br.r)["type"="route_master"];)->.all;
.all out body;
way(r.r);
out geom;
node(r.r);
out;"""

def fetch(city, refresh):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, city + '.json')
    if os.path.exists(path) and not refresh:
        return json.load(open(path, encoding='utf-8'))
    data = urllib.parse.urlencode({'data': query(CITIES[city]['bbox'])}).encode()
    last = None
    for ep in ENDPOINTS * 2:  # few retries, with pauses (transient TLS/504 errors)
        try:
            req = urllib.request.Request(ep, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=300) as r:
                j = json.loads(r.read().decode('utf-8'))
            json.dump(j, open(path, 'w', encoding='utf-8'))
            return j
        except Exception as e:
            last = e; print(f'  {ep} failed: {e}', file=sys.stderr); time.sleep(30)
    raise SystemExit(f'Overpass failed for {city}: {last}')

def dp(pts, tol):
    """Douglas-Peucker on [lon, lat] points; tolerance in metres (local equirectangular projection)."""
    if len(pts) < 3: return pts
    lat0 = math.radians(pts[0][1]); kx = 111320 * math.cos(lat0); ky = 110540
    xy = [(p[0] * kx, p[1] * ky) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); ax, ay = xy[a]; bx, by = xy[b]; dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if L == 0: d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L)); d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best: best, bi = d, i
        if best > tol: keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

def chain(ways):
    """Join member ways (lists of [lon,lat]) into as few lines as possible: member order first, then any shared endpoints."""
    lines = []
    for w in ways:
        if len(w) < 2: continue
        if lines:
            cur = lines[-1]
            if cur[-1] == w[0]: cur.extend(w[1:]); continue
            if cur[-1] == w[-1]: cur.extend(w[-2::-1]); continue
            if len(lines) == 1:  # first way may point the wrong way
                if cur[0] == w[0]: cur.reverse(); cur.extend(w[1:]); continue
                if cur[0] == w[-1]: cur.reverse(); cur.extend(w[-2::-1]); continue
        lines.append(list(w))
    merged = True
    while merged and len(lines) > 1:
        merged = False
        for i in range(len(lines)):
            for j in range(len(lines)):
                if i == j: continue
                a, b = lines[i], lines[j]
                if a[-1] == b[0]: a.extend(b[1:])
                elif a[-1] == b[-1]: a.extend(b[-2::-1])
                else: continue
                del lines[j]; merged = True; break
            if merged: break
    return lines

r5 = lambda v: round(v, 5)

def build(city, raw):
    els = raw.get('elements', [])
    ways = {e['id']: [[r5(g['lon']), r5(g['lat'])] for g in e.get('geometry', [])] for e in els if e['type'] == 'way'}
    nodes = {e['id']: e for e in els if e['type'] == 'node'}
    rels = [e for e in els if e['type'] == 'relation']
    routes = [r for r in rels if r.get('tags', {}).get('type') == 'route']
    masters = [r for r in rels if r.get('tags', {}).get('type') == 'route_master']
    master_of = {}
    for m in masters:
        for mem in m.get('members', []):
            if mem['type'] == 'relation': master_of[mem['ref']] = m
    stops, stop_ix, lines, dropped = [], {}, [], 0
    def is_stop(n, role):
        t = n.get('tags', {})
        return role.startswith(('stop', 'platform')) or t.get('public_transport') in ('platform', 'stop_position') or t.get('highway') == 'bus_stop'
    for r in sorted(routes, key=lambda r: r['id']):
        tg = r.get('tags', {}); m = master_of.get(r['id'])
        mt = m.get('tags', {}) if m else {}
        info = {k.replace(':', '_'): (tg.get(k) or mt.get(k)) for k in KEYS}
        info = {k: v for k, v in info.items() if v}
        geom = chain([ways[mem['ref']] for mem in r.get('members', []) if mem['type'] == 'way' and mem['ref'] in ways and not mem.get('role', '').startswith('platform')])
        geom = [dp(g, TOL_M) for g in geom]
        if not any(len(g) > 1 for g in geom): dropped += 1; continue  # no drawable path in OSM → not shown (stops not added either)
        sids = []
        for mem in r.get('members', []):
            if mem['type'] != 'node' or mem['ref'] not in nodes: continue
            n = nodes[mem['ref']]
            if not is_stop(n, mem.get('role', '')): continue
            nt = n.get('tags', {}); nm = nt.get('name:ar') or nt.get('name') or nt.get('name:en') or ''
            key = (nm, round(n['lat'], 3), round(n['lon'], 3)) if nm else ('#' + str(n['id']),)
            if key not in stop_ix:
                s = {'i': len(stops), 'id': n['id'], 'c': [r5(n['lon']), r5(n['lat'])]}
                for k in ('name', 'name:ar', 'name:en'):
                    if nt.get(k): s[k.replace(':', '_')] = nt[k]
                stop_ix[key] = s['i']; stops.append(s)
            si = stop_ix[key]
            if si not in sids: sids.append(si)
        lines.append({'id': r['id'], 'mode': tg.get('route'), **info, **({'master': m['id']} if m else {}), 'stops': sids, 'geom': geom})
    for s in stops: s.pop('i', None)
    bb = CITIES[city]['bbox']
    return {
        'city': city, 'name': CITIES[city]['name'], 'name_ar': CITIES[city]['name_ar'], 'bbox': [bb[1], bb[0], bb[3], bb[2]],
        'source': 'OpenStreetMap', 'license': 'ODbL 1.0', 'attribution': '© OpenStreetMap contributors',
        'osm_base': raw.get('osm3s', {}).get('timestamp_osm_base'),
        'counts': {'routes': len(lines), 'route_masters': len(masters), 'stops': len(stops),
                   'by_mode': {m: sum(1 for l in lines if l['mode'] == m) for m in sorted({l['mode'] for l in lines})},
                   'with_geometry': sum(1 for l in lines if l['geom']), 'dropped_no_path': dropped, 'with_stops': sum(1 for l in lines if l['stops'])},
        'lines': lines, 'stops': stops,
    }

def main():
    refresh = '--refresh' in sys.argv
    only = sys.argv[sys.argv.index('--city') + 1] if '--city' in sys.argv else None
    os.makedirs(OUT, exist_ok=True); stats = {}
    for i, city in enumerate(CITIES):
        if only and city != only: continue
        if i and refresh: time.sleep(15)  # polite pause between Overpass queries
        print('city', city); d = build(city, fetch(city, refresh))
        s = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
        open(os.path.join(OUT, city + '.json'), 'w', encoding='utf-8').write(s)
        import gzip
        stats[city] = {**d['counts'], 'bytes': len(s.encode()), 'gzip_bytes': len(gzip.compress(s.encode())), 'osm_base': d['osm_base']}
        print(' ', stats[city])
    ix = {'v': max((stats[c]['osm_base'] or '') for c in stats)[:10].replace('-', '') or datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d'), 'source': 'OpenStreetMap', 'license': 'ODbL 1.0', 'cities': {c: {'name': CITIES[c]['name'], 'name_ar': CITIES[c]['name_ar'], 'bbox': [CITIES[c]['bbox'][1], CITIES[c]['bbox'][0], CITIES[c]['bbox'][3], CITIES[c]['bbox'][2]], **{k: stats[c][k] for k in ('routes', 'stops', 'bytes')}} for c in stats}}
    json.dump(ix, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    json.dump(stats, open(os.path.join(os.path.dirname(__file__), 'last_build_stats.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
