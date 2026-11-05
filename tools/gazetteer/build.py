#!/usr/bin/env python3
"""Build data/gazetteer-sy.json – a compact offline gazetteer of Syrian cities, towns, villages and districts
from OpenStreetMap (ODbL) via the public Overpass API. Run by hand (never in CI / tests):

    python3 tools/gazetteer/build.py                 # query Overpass (one request) and write the file
    python3 tools/gazetteer/build.py --input raw.json  # reuse a saved Overpass answer (offline rebuild)

Output format (kept small, ~300 KB): {"v":1,"date":"YYYY-MM-DD","src":"…","t":[types],"p":[[ar,en,lonE4,latE4,typeIdx,pop?],…]}
Only stdlib. Hamlets are skipped to keep the file small.
"""
import json, sys, urllib.request, urllib.parse, datetime, os, argparse

TYPES = ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'village']
QUERY = ('[out:json][timeout:170];area["ISO3166-1"="SY"][admin_level=2]->.a;'
         '(node["place"~"^(city|town|village|suburb|quarter|neighbourhood)$"]["name"](area.a););out body qt;')
URL = 'https://overpass-api.de/api/interpreter'

def fetch():
    req = urllib.request.Request(URL, data=urllib.parse.urlencode({'data': QUERY}).encode(),
                                 headers={'User-Agent': 'Khareeta-gazetteer-tool/1.0 (github.com/Hekobuero/Khareeta)'})
    with urllib.request.urlopen(req, timeout=200) as r:
        return json.load(r)

def build(raw):
    out = []
    for e in raw.get('elements', []):
        tg = e.get('tags', {}); pl = tg.get('place')
        if pl not in TYPES or 'lat' not in e: continue
        ar = tg.get('name:ar') or tg.get('name') or ''
        en = tg.get('name:en') or (tg.get('name') if tg.get('name') != ar else '') or ''
        if en == ar: en = ''
        try: pop = int(str(tg.get('population', '0')).replace(',', '').split('.')[0] or 0)
        except ValueError: pop = 0
        row = [ar, en, round(e['lon'] * 1e4), round(e['lat'] * 1e4), TYPES.index(pl)]
        if pop: row.append(pop)
        out.append(row)
    out.sort(key=lambda r: (r[4], -(r[5] if len(r) > 5 else 0), r[0]))
    return {'v': 1, 'date': datetime.date.today().isoformat(), 'src': '© OpenStreetMap contributors (ODbL) via Overpass API',
            't': TYPES, 'p': out}

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--input'); ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'gazetteer-sy.json'))
    a = ap.parse_args()
    raw = json.load(open(a.input, encoding='utf-8')) if a.input else fetch()
    g = build(raw)
    with open(a.out, 'w', encoding='utf-8') as f: json.dump(g, f, ensure_ascii=False, separators=(',', ':'))
    print(len(g['p']), 'places ->', a.out, os.path.getsize(a.out), 'bytes')
