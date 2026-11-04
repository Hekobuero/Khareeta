#!/usr/bin/env python3
"""Build Khareeta's optional "Shops (Overture, unverified)" layer: data/overture/index.json + tNNNN_MMM.json.

Reproducible from the public Overture Maps release (anonymous S3, no keys):
    pip install duckdb==1.4.1
    python3 scripts/overture/build_overture.py                       # reads the release directly from S3
    python3 scripts/overture/build_overture.py --input syria.parquet # or a local extract of the same release
Steps (all deterministic): Syria bbox + addresses[0].country = 'SY' → confidence >= 0.7 → business categories only →
no person-like names → drop records with any Foursquare source (Apache-2.0 parts; avoids a NOTICE) → e-mails are never
exported → OSM duplicates removed (similar name within 50 m of a bundled OSM POI from data/poi/) → split into 0.1° tiles.
"""
import argparse, json, math, re, hashlib, os, glob
from difflib import SequenceMatcher
import duckdb

RELEASE = '2026-10-21.0'
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'overture')
BBOX = (35.5, 32.2, 42.5, 37.5)  # Syria incl. margin (W, S, E, N)
TILE = 10                         # tiles of 1/TILE degree
MIN_CONF = 0.7
# Overture basic_category values that are not shops/businesses (public, nature, religious, civic, landmarks …)
NONBIZ = {'historic_site', 'mountain', 'river', 'lake', 'beach', 'geographic_entities', 'land_feature', 'bridge', 'nature_reserve',
          'national_park', 'military_site', 'jail_or_prison', 'political_organization', 'sport_league', 'sport_team', 'media_service',
          'private_lodging', 'astrological_advising', 'adult_entertainment_venue', 'religious_organization', 'civic_organization',
          'youth_organization', 'labor_union', 'family_service', 'social_or_community_service', 'arts_and_entertainment', 'public_plaza',
          'public_fountain', 'pier', 'recreational_trail_or_path', 'monument', 'park', 'garden', 'playground', 'christian_place_of_worship',
          'muslim_place_of_worship', 'jewish_place_of_worship', 'government_office', 'government_department', 'courthouse', 'police_station',
          'embassy', 'community_and_government',
          # extra for a *shops* layer: landmarks and public institutions are not businesses
          'airport', 'castle', 'museum', 'library', 'stadium_arena', 'campus_building', 'community_center', 'landmark_and_historical_building',
          'elementary_school', 'high_school', 'preschool', 'college_university', 'place_of_learning', 'education', 'cemetery', 'public_service',
          'public_restroom', 'public_transit_facility_or_service', 'train_station', 'cultural_center', 'middle_school', 'sport_field',
          'sport_court', 'fairgrounds', 'zoo', 'animal_attraction'}
BIZ_WORDS = r'(shop|store|cafe|caf|restaurant|center|centre|clinic|hotel|market|group|company|co|office|salon|studio|pharmacy|school|academy|lab|gym|house|home|style|fashion|food|motors|tech|art|design|trading|services?)\b'
# Overture category → Khareeta group (DESIGN §3.5 colours) and sprite
GROUP = [('restaurant|eatery|food|bakery|pizza|burger|sandwich|grill|dessert|ice_cream', 'food', 'restaurant'),
         ('cafe|coffee|tea|juice', 'food', 'cafe'), ('bar|lounge|pub|night', 'food', 'bar'),
         ('hotel|lodging|hostel|motel|resort|guest', 'lodging', 'lodging'),
         ('dental', 'health', 'dentist'), ('pharmacy|drug', 'health', 'pharmacy'), ('hospital', 'health', 'hospital'),
         ('clinic|health|medical|doctor|diagnos|surgery|lab|physio|optic|wellness', 'health', 'doctor'),
         ('beauty|hair|barber|salon|spa|nail', 'shopping', 'hairdresser'), ('fashion|apparel|cloth|shoe', 'shopping', 'clothing'),
         ('grocery|supermarket|convenience|food_and_beverage', 'shopping', 'grocery'),
         ('automotive|car_|auto|gas_station|tire', 'transport', 'car'), ('travel|taxi|transport|rental', 'transport', 'generic'),
         ('bank|financial|atm|exchange|insurance', 'civic', 'bank'), ('gym|fitness|sport|swim', 'nature', 'pitch'),
         ('store|shop|market|mall|retail', 'shopping', 'shop')]

def group_of(cat):
    for rx, g, sp in GROUP:
        if re.search(rx, cat or ''): return g, sp
    return 'civic', 'generic'

def norm(x):
    x = (x or '').lower(); x = re.sub('[\u064b-\u065f\u0640]', '', x); x = re.sub('[أإآ]', 'ا', x).replace('ة', 'ه').replace('ى', 'ي')
    x = re.sub(r'\b(ال|al[- ]|el[- ]|the )', '', x); return re.sub(r'[^\w]', '', x)

def similar(a, b):
    return a == b or (len(a) > 3 and len(b) > 3 and (a in b or b in a)) or SequenceMatcher(None, a, b).ratio() >= 0.8

def load_osm():
    """Bundled OSM POIs (data/poi parts): [(lat, lon, {normalised names})] + 0.001° grid."""
    ix = json.load(open(os.path.join(ROOT, 'data', 'poi', 'index.json')))
    pts, grid = [], {}
    for n in range(ix['parts']):
        for r in json.load(open(os.path.join(ROOT, 'data', 'poi', f'p{n}.json')))['f']:
            lon, lat = r[0], r[1]; ns = {norm(v) for v in r[5:8] if isinstance(v, str)} - {''}
            if not ns: continue
            grid.setdefault((int(lat * 1000), int(lon * 1000)), []).append(len(pts)); pts.append((lat, lon, ns))
    return pts, grid

def is_osm_dup(name, lat, lon, pts, grid):
    a = norm(name)
    if not a: return False
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for i in grid.get((int(lat * 1000) + dy, int(lon * 1000) + dx), []):
                ola, olo, ns = pts[i]
                d = math.hypot((ola - lat) * 111320, (olo - lon) * 111320 * math.cos(math.radians(lat)))
                if d < 50 and any(similar(a, b) for b in ns): return True
    return False

SOC = {'facebook': re.compile(r'^https?://([a-z0-9-]+\.)?(facebook\.com|fb\.com|fb\.me)/', re.I),
       'instagram': re.compile(r'^https?://([a-z0-9-]+\.)?(instagram\.com|instagr\.am)/', re.I)}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--input', help='local parquet extract (default: Overture release on S3)')
    ap.add_argument('--release', default=RELEASE); a = ap.parse_args()
    c = duckdb.connect()
    if a.input: src = f"read_parquet('{a.input}')"
    else:
        c.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
        src = f"read_parquet('s3://overturemaps-us-west-2/release/{a.release}/theme=places/type=place/*', hive_partitioning=1)"
    w, s, e, n = BBOX
    nonbiz = ','.join(f"'{x}'" for x in sorted(NONBIZ))
    rows = c.sql(f"""
      SELECT id, names."primary" AS name, basic_category AS cat, confidence,
        round((bbox.xmin + bbox.xmax) / 2, 5) AS lon, round((bbox.ymin + bbox.ymax) / 2, 5) AS lat,
        coalesce(phones, []) AS phones, coalesce(websites, []) AS websites, coalesce(socials, []) AS socials,
        list_contains(list_transform(coalesce(sources, []), x -> x.dataset), 'Foursquare') AS fsq
      FROM {src}
      WHERE bbox.xmin BETWEEN {w} AND {e} AND bbox.ymin BETWEEN {s} AND {n}
        AND addresses[1].country = 'SY' AND confidence >= {MIN_CONF}
        AND basic_category IS NOT NULL AND basic_category NOT IN ({nonbiz})
        AND names."primary" IS NOT NULL
        AND NOT (regexp_matches(names."primary", '^[A-Z][a-z]+( [A-Z][a-z]+){{1,2}}$')
                 AND NOT regexp_matches(lower(names."primary"), '{BIZ_WORDS}'))
      ORDER BY id""").fetchall()
    pts, grid = load_osm()
    stats = {'release': a.release, 'after_filter': len(rows), 'dropped_foursquare': 0, 'dropped_osm_duplicate': 0}
    cats, keep = [], []
    for (oid, name, cat, conf, lon, lat, phs, webs, socs, fsq) in rows:
        if fsq: stats['dropped_foursquare'] += 1; continue
        if is_osm_dup(name, lat, lon, pts, grid): stats['dropped_osm_duplicate'] += 1; continue
        links = [u for u in list(socs) + list(webs) if isinstance(u, str)]
        fb = next((u for u in links if SOC['facebook'].match(u)), '')
        ig = next((u for u in links if SOC['instagram'].match(u)), '')
        web = next((u for u in webs if isinstance(u, str) and re.match(r'^https?://', u, re.I) and not any(r.match(u) for r in SOC.values())), '')
        ph = next((p for p in phs if isinstance(p, str) and re.search(r'\d{6}', re.sub(r'\D', '', p))), '')
        if cat not in cats: cats.append(cat)
        keep.append((lon, lat, name.strip()[:120], cat, ph, web[:300], fb[:300], ig[:300]))
    cats.sort(); ci = {k: i for i, k in enumerate(cats)}
    tiles = {}
    for lon, lat, name, cat, ph, web, fb, ig in keep:
        r = [lon, lat, name, ci[cat], ph, web, fb, ig]
        while r[-1] == '': r.pop()
        tiles.setdefault(f'{math.floor(lon * TILE)}_{math.floor(lat * TILE)}', []).append(r)
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, 't*.json')): os.remove(f)
    body = json.dumps(sorted(tiles.items()), ensure_ascii=False, separators=(',', ':'))
    dv = hashlib.sha1(body.encode()).hexdigest()[:10]
    index = {'v': 1, 'dv': dv, 'release': a.release, 'tile': 1 / TILE,
             'source': '© Overture Maps Foundation · Places: CDLA-Permissive-2.0 (Foursquare records excluded)',
             'license': 'CDLA-Permissive-2.0', 'fields': ['lon', 'lat', 'name', 'cat', 'phone', 'website', 'facebook', 'instagram'],
             'cats': cats, 'groups': [list(group_of(k)) for k in cats], 'rows': len(keep), 'tiles': {}}
    for k, rs in sorted(tiles.items()):
        rs.sort(key=lambda r: (r[1], r[0]))
        with open(os.path.join(OUT, f't{k}.json'), 'w') as fh: json.dump({'dv': dv, 'f': rs}, fh, ensure_ascii=False, separators=(',', ':'))
        index['tiles'][k] = len(rs)
    with open(os.path.join(OUT, 'index.json'), 'w') as fh: json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))
    stats.update(kept=len(keep), tiles=len(tiles), categories=len(cats))
    print(json.dumps(stats, ensure_ascii=False))

if __name__ == '__main__': main()
