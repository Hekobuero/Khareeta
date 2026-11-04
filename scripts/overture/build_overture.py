#!/usr/bin/env python3
"""Build Khareeta's optional "Shops (Overture, unverified)" layer: data/overture/index.json + tNNNN_MMM.json.

Reproducible from the public Overture Maps release (anonymous S3, no keys):
    pip install duckdb==1.4.1
    python3 scripts/overture/build_overture.py                       # reads the release directly from S3
    python3 scripts/overture/build_overture.py --input syria.parquet # or a local extract of the same release
Steps (all deterministic, counts per rule are printed): inside the Syria outline (js/overture-data.js OV_SY) and every
address country = 'SY' → confidence >= 0.7 → category ALLOWLIST → privacy rules (homes, clerics, kunya, person-only names,
foreign phones, mobiles only for commercial categories) → junk names (foreign scripts, terrain/gazetteer names,
parenthetical descriptions, person name + filler word) → no locality names, exact duplicates or centroid stacks → drop records with any Foursquare source (Apache-2.0 parts; avoids a NOTICE) → e-mails are never
exported → OSM duplicates removed (similar name within 50 m of a bundled OSM POI from data/poi/) → near-duplicates (same group, same distinctive name within 200 m → keep the entry with most contact data) →
points carrying unrelated places and coarse-grid coordinates dropped → links: webmail dropped, tracking params stripped →
split into 0.1° tiles.
"""
import argparse, json, math, re, hashlib, os, glob
from difflib import SequenceMatcher

RELEASE = '2026-10-21.0'
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'overture')
TILE = 10                         # tiles of 1/TILE degree
MIN_CONF = 0.7
# ALLOWLIST (QA 2026-11-04): only clear businesses. Everything else is dropped ("when in doubt, drop").
# value True = clearly commercial: a Syrian mobile number (+9639… / 09…) may stay; False = landline only.
ALLOW = {**{k: True for k in (
    # food & drink
    'restaurant', 'cafe', 'coffee_shop', 'casual_eatery', 'bar', 'fast_food_restaurant', 'food_and_beverage_store', 'food_and_drink',
    'lounge', 'smoothie_juice_bar', 'non_alcoholic_beverage_venue', 'food_service', 'food_truck_stand', 'alcoholic_beverage_venue',
    'dance_club', 'bakery',
    # retail
    'shopping', 'fashion_and_apparel_store', 'electronics_store', 'hardware_home_and_garden_store', 'shopping_mall',
    'flowers_and_gifts_store', 'books_music_and_video_store', 'personal_care_and_beauty_store', 'market', 'arts_crafts_and_hobby_store',
    'animal_and_pet_store', 'toys_and_games_store', 'department_store', 'discount_store', 'warehouse_club_store', 'office_supply_store',
    'specialty_store', 'sporting_goods_store', 'convenience_store', 'vehicle_parts_store', 'musical_instrument_and_pro_audio_store',
    'grocery_store', 'supermarket',
    # lodging
    'hotel', 'lodging', 'resort',
    # services
    'personal_or_beauty_service', 'automotive_service', 'vehicle_service', 'auto_dealer', 'vehicle_dealer', 'printing_service',
    'laundry_service', 'rental_service', 'bank_or_credit_union', 'gym', 'sport_or_fitness_facility', 'swimming_pool',
    'animal_or_pet_service', 'movie_theater', 'gas_station', 'fueling_station', 'amusement_park', 'arcade',
    # health (facilities)
    'hospital', 'dental_clinic', 'pharmacy_and_drug_store', 'diagnostics_imaging_or_lab_service', 'surgery',
    'outpatient_care_facility', 'vision_or_eye_care_clinic', 'pediatric_clinic', 'specialized_medical_facility', 'emergency_department')},
  **{k: False for k in (
    'travel_service', 'financial_service', 'real_estate_service', 'health_care', 'specialized_health_care', 'medical_service',
    'reproductive_perinatal_and_womens_care', 'physical_medicine_and_rehabilitation', 'behavioral_or_mental_health_clinic',
    'taxi_or_ride_share_service', 'shipping_or_delivery_service')}}
AR = '\u0600-\u06ff'
# names that describe a home or a person, never a business
HOME = re.compile(r'(^|\s)(منزل|بيت|دار)(\s|$)|\b(house of|home of|haus von)\b', re.I)
CLERIC = re.compile(r'(^|\s)(ال)?(امام|إمام|شيخ|خطيب)(\s|$)', re.I)
KUNYA = re.compile(r'(^|\s)(أبو|ابو|أم|ام)\s*[' + AR + r']', re.I)
INSTITUTION = re.compile(r'نقابة|اتحاد|وزارة|مديرية|محافظة|بلدية|جمعية|مسجد|جامع|كنيسة|مدرسة|جامعة|محكمة|محامي|حزب|'
                         r'\b(bar association|lawyers?|law firm|attorney|ministry|syndicate|union|mosque|church|school|university|party)\b', re.I)
AR_BIZ = set(('مطعم مطاعم مقهى مقهي كافيه كافي كوفي قهوة صيدلية عيادة مركز مجمع فندق محل محلات متجر سوق اسواق أسواق مول مخبز مخابز فرن أفران '
          'معجنات حلويات بوظة عصير عصائر صالون حلاق مكتب شركة مؤسسة معرض مشفى مستشفى مختبر مخبر بنك مصرف صرافة صرافه مطبعة مغسلة كراج ورشة '
          'استراحة منتجع نادي جيم سناك بيتزا شاورما فلافل بروستد مشاوي مشويات كباب الكترونيات إلكترونيات موبايل موبايلات جوال جوالات ألبسة البسة '
          'أحذية احذية عطور عطورات مكتبة أزياء ازياء بوتيك مجوهرات ذهب صاغة ماركت سوبر هايبر تجارية للتجارة التجارية للسياحة سياحة سفريات '
          'تكسي ترافيل كافتيريا سنتر ستور شوب هوتيل اوتيل لاونج بار مركزية محطة وقود بنزين كازية مفروشات أثاث اثاث ستوديو استديو '
          'تصوير نظارات بصريات أدوات ادوات قطع سيارات زراعية مواد بناء ألمنيوم المنيوم حدادة نجارة ديكور تجميل مشغل خياطة '
          'لحوم قصابة دواجن فروج خضار فواكه ألبان البان أجبان اجبان سمانة بقالية بقالة توابل بهارات فول مخللات غاز حمام '
          'جملة مستودع وكالة وكيل معمل مصنع كهربائيات منزلية رياضي فيتنس بلياردو العاب ألعاب ملاهي سينما مسبح كافيتريا').split())
EN_BIZ = (r'\b(shop|store|stores|cafe|caf[eé]|coffee|restaurant|rest|grill|pizza|burger|shawarma|falafel|bakery|sweets|center|centre|clinic|'
          r'hotel|hostel|inn|resort|palace|suites|market|mart|mall|group|company|co|ltd|llc|office|salon|studio|pharmacy|lab|gym|fitness|'
          r'style|fashion|food|foods|motors|auto|cars?|tech|design|trading|services?|bar|lounge|pub|club|kitchen|house|bistro|diner|express|'
          r'snack|juice|ice|cream|bank|exchange|travel|tours?|rent|print|laundry|wash|pets?|toys|books?|gifts?|flowers?|beauty|spa|barber|'
          r'optic(s|al)?|dental|medical|hospital|plaza|outlet|boutique|jewel(ry|lery)|gold|mobile|phones?|electronics?|computers?|furniture|'
          r'decor|garden|tools|pharma|cinema|pool|station|fuel|gas|land|world|zone|point|corner|plus|online|official)\b')
LATIN_NAME = re.compile(r'^[A-Za-z][a-z]+( [A-Za-z][a-z]+){1,2}$')
# place names (city/district) that are not a business when they are the whole name
PLACE_NAMES = {x.lower() for x in (
    'دمشق حلب حمص حماة حماه اللاذقية طرطوس ادلب إدلب الرقة الحسكة القامشلي درعا السويداء القنيطرة جبلة بانياس تدمر منبج عفرين اعزاز '
    'الباب جرابلس السلمية صافيتا دوما حرستا جرمانا صحنايا قدسيا التل الزبداني يبرود النبك قطنا الكسوة داريا المزة كفرسوسة المالكي '
    'الشعلان القصاع المهاجرين الميدان القابون برزة الصالحية الحميدية الحمدانية الجميلية العزيزية الفرقان سوريا سورية '
    'Damascus Aleppo Homs Hama Latakia Lattakia Tartus Idlib Raqqa Hasakah Qamishli Daraa Suwayda Quneitra Jableh Baniyas Palmyra '
    'Manbij Afrin Azaz Douma Jaramana Mezzeh Malki Midan Salhieh Syria').split()} | {
    'دير الزور', 'باب توما', 'ركن الدين', 'الشيخ مقصود', 'دمشق القديمة', 'حلب القديمة', 'deir ez-zor', 'deir ezzor', 'bab touma', 'old damascus'}
TRACK = re.compile(r'^(fbclid|gclid|dclid|msclkid|yclid|twclid|ttclid|igshid|igsh|mibextid|ref|ref_src|ref_type|__tn__|__cft__\[0\]|hc_ref|fref|si|_rdr|rdid|'
                   r'share_url|sfnsn|stkn|wa_status_inline|g_st|g_ep|authuser|_sg|ev|mc_cid|mc_eid|_hsenc|_hsmi|spm|s|t|feature|utm_[a-z_]+)$', re.I)
# a few params are only tracking on some hosts (r=nametag on Instagram)
TRACK_HOST = {'instagram.com': re.compile(r'^(r|hl)$', re.I), 'google.com': re.compile(r'^(hl|entry|coh)$', re.I)}
# webmail / mail-provider links are never a business website
WEBMAIL = re.compile(r'^https?://([a-z0-9-]+\.)*(mail\.live\.com|live\.com|hotmail\.com|outlook\.(com|live\.com|office\.com|office365\.com)|'
                     r'mail\.google\.com|gmail\.com|mail\.yahoo\.com|yahoo\.com|ymail\.com|aol\.com|mail\.ru|yandex\.(ru|com)|icloud\.com|proton(mail)?\.(me|com))(/|$|\?|:)', re.I)
# QA P3 junk rules
# 1) scripts that are not used for Syrian shop names (Thai, CJK, Cyrillic, Greek, Hebrew, Devanagari, …)
FOREIGN_SCRIPT = re.compile(r'[\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0900-\u0dff\u0e00-\u0eff\u1000-\u109f\u1100-\u11ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]')
# 2) gazetteer / Wikipedia-style terrain names: a terrain word + no business word, or a GeoNames-style transliteration
TERRAIN = re.compile(r'^(tall|tell|tal|jabal|jebel|jbel|wadi|wādī|nahr|khirbat|khirbet|ayn|ain|ʿayn|‘ayn|qaryat|sahl|marj|ra[sʾ]s|'
                     r'تل|تلة|جبل|وادي|نهر|خربة|عين|سهل|مرج|رأس|راس)\b', re.I)
TRANSLIT = re.compile(r'[āīūḩḑṣṭẓḍĀĪŪḨḐṢṬẒḌʿʾ]')
# 3) a parenthetical description of the place in another language (Swedish/German/English bot-made articles, coordinates)
PAREN_DESC = re.compile(r'\((?:[^)]*\b(?:i syrien|in syrien|in syria|kulle|berg|wadi|hill|mountain|river|village|dorf|fluss|lat\s*\d|long\s*\d)\b[^)]*)\)', re.I)
# 4) a person's name plus one generic filler word ("Express AHMAD ASWAD")
GENERIC = re.compile(r'\b(express|group|official|online|plus|point|world|zone)\b', re.I)

def clean_url(u):
    """strip tracking params; m.me/<page> (Messenger) → facebook.com/<page>"""
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    u = (u or '').strip()
    if not re.match(r'^https?://', u, re.I): return ''
    if re.match(r'^https?://(drive|docs)\.google\.', u, re.I): return ''  # file shares are not a website
    p = urlsplit(u)
    if p.netloc.lower() in ('m.me', 'www.m.me'):
        page = p.path.strip('/').split('/')[0]
        return 'https://www.facebook.com/' + page if page else ''
    if WEBMAIL.match(u): return ''
    host = p.netloc.lower().split(':')[0].removeprefix('www.')
    th = next((rx for h, rx in TRACK_HOST.items() if host == h or host.endswith('.' + h)), None)
    q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if not TRACK.match(k) and not (th and th.match(k))]
    return urlunsplit((p.scheme.lower(), p.netloc, p.path, urlencode(q), ''))

def phone_kind(p):
    """'sy' landline, 'mob' Syrian mobile, 'foreign', or '' (unusable)"""
    d = re.sub(r'[^\d+]', '', p or '')
    if d.startswith('00'): d = '+' + d[2:]
    if d.startswith('+'):
        if not d.startswith('+963'): return 'foreign'
        rest = d[4:]
    elif d.startswith('963') and len(d) >= 11: rest = d[3:]
    elif d.startswith('0'): rest = d[1:]
    else: return ''
    rest = rest.lstrip('0')
    if not re.fullmatch(r'\d{6,10}', rest): return ''
    return 'mob' if rest.startswith('9') and len(rest) == 9 else 'sy'

def person_rule(name):
    """privacy rule hit by a name ('' = looks like a business)"""
    n = re.sub(r'[\u064b-\u065f\u0640]', '', name).strip()
    if HOME.search(n): return 'home'
    if CLERIC.search(n): return 'cleric'
    if KUNYA.search(n): return 'kunya'
    words = re.sub(r'[^\w\s]', ' ', n).split()
    if words and len(words) <= 4 and all(re.fullmatch('[' + AR + ']+', w) for w in words):
        forms = set(words) | {w[2:] for w in words if w.startswith('ال')} | {w[1:] for w in words if w[:1] in 'لبو'}
        forms |= {w[3:] for w in words if w.startswith(('بال', 'وال', 'لل'))}
        if not forms & AR_BIZ: return 'arabic_person_name'
    if LATIN_NAME.match(n) and not re.search(EN_BIZ, n.lower()): return 'latin_person_name'
    return ''

def junk_rule(name):
    """QA P3: names that are not a business at all ('' = ok)"""
    n = name.strip()
    if FOREIGN_SCRIPT.search(n): return 'foreign_script'
    if PAREN_DESC.search(n): return 'parenthetical_description'
    low = n.lower()
    biz = re.search(EN_BIZ, low) or any(w in AR_BIZ for w in re.sub(r'[^\w\s]', ' ', n).split())
    if not biz and (TERRAIN.match(n) or TRANSLIT.search(n)): return 'terrain_name'
    rest = re.sub(r'\s+', ' ', GENERIC.sub(' ', n)).strip()
    if rest != n and re.fullmatch(r'[A-Za-z]+( [A-Za-z]+){1,2}', rest) and not re.search(EN_BIZ, rest.lower()) and LATIN_NAME.match(rest.title()):
        return 'person_name_generic'
    return ''

def best_of(rs):
    """near-duplicate cluster → the entry with most contact data, then highest confidence, then longest name, then id"""
    return max(rs, key=lambda r: (sum(1 for x in r[5:9] if x), r[9], len(r[3]), r[0]))

def coarse(x):
    """True for a coordinate on a 0.01° or 1/60° grid (as printed with 4 decimals)"""
    return abs(x * 100 - round(x * 100)) < 1e-3 or abs(x * 60 - round(x * 60)) < 3.1e-3

HOSPITAL = re.compile(r'مشفى|مستشفى|hospital', re.I)
# Overture also files single doctors, clinics and labs under 'hospital' – those are not exempt
NOT_HOSPITAL = re.compile(r'(^|\s)(ال)?(دكتور|دكتورة|د\.|عيادة|مخبر|مختبر)|\b(dr|doctor|clinic|lab|laboratory)\b', re.I)
def is_hospital(r):
    """real hospitals are exempt from the stack/coarse-coordinate rules (their location still helps; privacy rules stay)"""
    if HOSPITAL.search(r[3]): return True
    return r[4] == 'hospital' and not NOT_HOSPITAL.search(r[3])

def stack_filter(rows, max_same=2):
    """QA P3 stacks. A point carrying unrelated places (different category groups) is a geocoder fallback → drop them;
    coordinates on a coarse grid (0.01° or 1 arc-minute) are a town/district centroid → drop; a point with more than
    `max_same` places of one group keeps only the best `max_same`. Hospitals are exempt from all three.
    Returns (kept, {rule: count})."""
    grp, cnt = {}, {'mixed_stack': 0, 'coarse_coordinates': 0, 'same_group_stack': 0}
    for r in rows:
        grp.setdefault((r[1], r[2]), set()).add(group_of(r[4])[0])
    out, at = [], {}
    for r in rows:
        if is_hospital(r): out.append(r); continue
        if len(grp[(r[1], r[2])]) > 1: cnt['mixed_stack'] += 1; continue
        if coarse(r[1]) and coarse(r[2]): cnt['coarse_coordinates'] += 1; continue
        at.setdefault((r[1], r[2]), []).append(r)
    for rs in at.values():
        best = sorted(rs, key=lambda r: (sum(1 for x in r[5:9] if x), r[9], len(r[3]), r[0]), reverse=True)[:max_same]
        cnt['same_group_stack'] += len(rs) - len(best); out += best
    out.sort(key=lambda r: r[0])
    return out, cnt

def dist_m(a, b):
    return math.hypot((a[2] - b[2]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(a[2])))

# generic category words do not identify a place ("Sea Cafe" ≠ "Sham Cafe", "Dental Clinic" ≠ "Whity Dental Clinic")
GEN_WORDS = re.compile(r'\b(restaurant|rest|cafe|café|coffee|pharmacy|hospital|clinic|dental|medical|center|centre|hotel|gym|club|pool|'
                       r'salon|shop|store|market|bakery|station|and|&)\b|(^|\s)(و?(ال)?(مطعم|مقهى|كافيه|كافي|صيدلية|مشفى|مستشفى|عيادة|فندق|'
                       r'محطة|مسبح|نادي|صالون|مركز|محل|مخبز|سوبر|ماركت))(?=\s|$)', re.I)
def dedup_key(name):
    return norm(GEN_WORDS.sub(' ', name.lower()))

def same_place(a, b):
    """stricter than similar(): the distinctive part must match (equal, contained with >= 5 chars, or ratio >= 0.9)"""
    if not a or not b or min(len(a), len(b)) < 3: return False
    if a == b: return True
    if min(len(a), len(b)) >= 5 and (a in b or b in a): return True
    return SequenceMatcher(None, a, b).ratio() >= 0.9

def near_dups(rows, radius=200):
    """merge rows of the same category group with the same distinctive name within `radius` m; returns (kept, merged_count)"""
    grid = {}
    for i, r in enumerate(rows): grid.setdefault((int(r[2] * 500), int(r[1] * 500)), []).append(i)   # ~200 m cells
    parent = list(range(len(rows)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    keys = [dedup_key(r[3]) for r in rows]
    for i, r in enumerate(rows):
        gy, gx = int(r[2] * 500), int(r[1] * 500)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for j in grid.get((gy + dy, gx + dx), []):
                    if j <= i or find(i) == find(j): continue
                    if dist_m(r, rows[j]) <= radius and group_of(r[4])[0] == group_of(rows[j][4])[0] and same_place(keys[i], keys[j]): parent[find(j)] = find(i)
    cl = {}
    for i in range(len(rows)): cl.setdefault(find(i), []).append(rows[i])
    kept = [best_of(rs) for rs in cl.values()]
    kept.sort(key=lambda r: r[0])
    return kept, len(rows) - len(kept)

def recategorise(name, cat):
    n = name.lower()
    if re.search(r'صيدلية|pharmacy', n): return 'pharmacy_and_drug_store'
    if re.search(r'مستشفى|مشفى|hospital', n): return 'hospital'
    if re.search(r'فندق|hotel', n) and cat in ('restaurant', 'cafe', 'bar', 'casual_eatery', 'shopping'): return 'hotel'
    return cat

def load_polygon():
    src = open(os.path.join(ROOT, 'js', 'overture-data.js'), encoding='utf8').read()
    return json.loads(re.search(r'export const OV_SY = (\[\[.*?\]\]);', src).group(1))

def in_poly(lon, lat, poly):
    ins = False; j = len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi: ins = not ins
        j = i
    return ins

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
    import duckdb  # only needed for a build; the rule helpers are importable without it (tests)
    ap = argparse.ArgumentParser(); ap.add_argument('--input', help='local parquet extract (default: Overture release on S3)')
    ap.add_argument('--release', default=RELEASE); a = ap.parse_args()
    c = duckdb.connect()
    if a.input: src = f"read_parquet('{a.input}')"
    else:
        c.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
        src = f"read_parquet('s3://overturemaps-us-west-2/release/{a.release}/theme=places/type=place/*', hive_partitioning=1)"
    poly = load_polygon()
    w, s, e, n = min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly)
    rows = c.sql(f"""
      SELECT id, names."primary" AS name, basic_category AS cat, confidence,
        round((bbox.xmin + bbox.xmax) / 2, 5) AS lon, round((bbox.ymin + bbox.ymax) / 2, 5) AS lat,
        coalesce(phones, []) AS phones, coalesce(websites, []) AS websites, coalesce(socials, []) AS socials,
        list_contains(list_transform(coalesce(sources, []), x -> x.dataset), 'Foursquare') AS fsq,
        len(coalesce(addresses, [])) > 0 AND list_bool_and(list_transform(addresses, x -> coalesce(x.country, 'SY') = 'SY')) AS sy
      FROM {src}
      WHERE bbox.xmin BETWEEN {w} AND {e} AND bbox.ymin BETWEEN {s} AND {n}
        AND confidence >= {MIN_CONF} AND names."primary" IS NOT NULL
      ORDER BY id""").fetchall()
    pts, grid = load_osm()
    st = {'release': a.release, 'input_conf_ge_0_7_in_bbox': len(rows)}
    def drop(rule): st['dropped_' + rule] = st.get('dropped_' + rule, 0) + 1
    placen = {norm(x) for x in PLACE_NAMES}
    cand = []
    for (oid, name, cat, conf, lon, lat, phs, webs, socs, fsq, sy) in rows:
        name = re.sub(r'\s+', ' ', name or '').strip()
        if not sy: drop('non_sy_address'); continue
        if not in_poly(lon, lat, poly): drop('outside_syria_outline'); continue
        if fsq: drop('foursquare'); continue
        kinds = [(p, phone_kind(p)) for p in phs if isinstance(p, str)]
        if any(k == 'foreign' for _, k in kinds): drop('foreign_phone'); continue
        if INSTITUTION.search(name): drop('institution_or_wrong_category'); continue
        cat = recategorise(name, cat or '')
        if cat not in ALLOW: drop('category_not_allowlisted'); continue
        if name.lower() in PLACE_NAMES or norm(name) in placen: drop('locality_name'); continue
        jr = junk_rule(name)
        if jr: drop('junk_' + jr); continue
        pr = person_rule(name)
        if pr: drop('name_' + pr); continue
        ph = next((p for p, k in kinds if k == 'sy'), '') or (next((p for p, k in kinds if k == 'mob'), '') if ALLOW[cat] else '')
        if not ph and any(k == 'mob' for _, k in kinds): st['phone_stripped_mobile_noncommercial'] = st.get('phone_stripped_mobile_noncommercial', 0) + 1
        if is_osm_dup(name, lat, lon, pts, grid): drop('osm_duplicate'); continue
        links = [clean_url(u) for u in list(socs) + list(webs) if isinstance(u, str)]
        fb = next((u for u in links if SOC['facebook'].match(u)), '')
        ig = next((u for u in links if SOC['instagram'].match(u)), '')
        web = next((u for u in (clean_url(x) for x in webs if isinstance(x, str)) if u and not any(r.match(u) for r in SOC.values())), '')
        cand.append((oid, lon, lat, name[:120], cat, ph, web[:300], fb[:300], ig[:300], conf or 0))
    # exact duplicates (same name + coordinates) → keep the first; centroid stacks (> 3 places on one point) → drop all
    seen, uniq = set(), []
    for r in cand:
        k = (norm(r[3]), r[1], r[2])
        if k in seen: drop('exact_duplicate'); continue
        seen.add(k); uniq.append(r)
    at = {}
    for r in uniq: at[(r[1], r[2])] = at.get((r[1], r[2]), 0) + 1
    keep = []
    for r in uniq:
        if at[(r[1], r[2])] > 3: drop('centroid_stack'); continue
        keep.append(r)
    keep, nd = near_dups(keep)
    keep, sc = stack_filter(keep)
    for k, v in sc.items():
        if v: st['dropped_' + k] = st.get('dropped_' + k, 0) + v
    if nd: st['dropped_near_duplicate_200m'] = nd
    cats = sorted({r[4] for r in keep})
    ci = {k: i for i, k in enumerate(cats)}
    tiles = {}
    for oid, lon, lat, name, cat, ph, web, fb, ig, _ in keep:
        r = [lon, lat, re.sub('[^0-9a-f]', '', oid.lower())[:12], name, ci[cat], ph, web, fb, ig]
        while r[-1] == '': r.pop()
        tiles.setdefault(f'{math.floor(lon * TILE)}_{math.floor(lat * TILE)}', []).append(r)
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, 't*.json')): os.remove(f)
    body = json.dumps(sorted(tiles.items()), ensure_ascii=False, separators=(',', ':'))
    dv = hashlib.sha1(body.encode()).hexdigest()[:10]
    index = {'v': 2, 'dv': dv, 'release': a.release, 'tile': 1 / TILE,
             'source': '© Overture Maps Foundation · Places: CDLA-Permissive-2.0 (Foursquare records excluded)',
             'license': 'CDLA-Permissive-2.0', 'fields': ['lon', 'lat', 'id', 'name', 'cat', 'phone', 'website', 'facebook', 'instagram'],
             'cats': cats, 'groups': [list(group_of(k)) for k in cats], 'rows': len(keep), 'tiles': {}}
    for k, rs in sorted(tiles.items()):
        rs.sort(key=lambda r: (r[1], r[0]))
        with open(os.path.join(OUT, f't{k}.json'), 'w') as fh: json.dump({'dv': dv, 'f': rs}, fh, ensure_ascii=False, separators=(',', ':'))
        index['tiles'][k] = len(rs)
    with open(os.path.join(OUT, 'index.json'), 'w') as fh: json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))
    st.update(kept=len(keep), tiles=len(tiles), categories=len(cats))
    st['bytes'] = sum(os.path.getsize(f) for f in glob.glob(os.path.join(OUT, '*.json')))
    with open(os.path.join(ROOT, 'scripts', 'overture', 'last_build_stats.json'), 'w') as fh: json.dump(st, fh, ensure_ascii=False, indent=1)
    print(json.dumps(st, ensure_ascii=False, indent=1))

if __name__ == '__main__': main()
