import osmium, json, sys, collections
# category rules -> (cat, sub); sub is the OSM value used to pick an icon
def classify(t):
    a=t.get('amenity'); tr=t.get('tourism'); sh=t.get('shop'); hi=t.get('historic'); le=t.get('leisure'); hc=t.get('healthcare')
    if tr in ('hotel','motel','hostel','guest_house','apartment','chalet'): return 'hotel',tr
    if a=='atm': return 'money','atm'
    if a in ('bank',): return 'money','bank'
    if a in ('bureau_de_change','money_transfer') or sh=='money_lender': return 'money','exchange'
    if a in ('restaurant','fast_food','food_court'): return 'food',a
    if a in ('cafe','ice_cream'): return 'cafe',a
    if a=='fuel': return 'fuel','fuel'
    if a=='charging_station': return 'fuel','charging_station'
    if a=='pharmacy' or hc=='pharmacy' or sh=='chemist': return 'pharmacy','pharmacy'
    if a=='hospital' or hc=='hospital': return 'hospital','hospital'
    if a in ('clinic','doctors','dentist') or hc in ('clinic','doctor','dentist','centre'): return 'clinic',a or hc
    if sh in ('supermarket','convenience','grocery','greengrocer','general','butcher','deli','mall','department_store'): return 'grocery',sh
    if sh in ('bakery','pastry','confectionery'): return 'bakery',sh
    if a=='place_of_worship':
        r=t.get('religion')
        if r=='muslim': return 'mosque','mosque'
        if r=='christian': return 'church','church'
        return 'worship','worship'
    if a=='parking': return 'parking','parking'
    if a=='police': return 'police','police'
    if tr in ('museum','attraction','viewpoint','zoo','theme_park','gallery') : return 'sight',tr
    if hi in ('castle','monument','ruins','archaeological_site','fort','memorial','citadel','city_gate','tomb'): return 'sight',hi
    if a=='marketplace': return 'shop','marketplace'
    if sh: return 'shop',sh
    if a in ('school','university','college','kindergarten'): return 'edu',a
    if a=='post_office': return 'gov','post'
    if a in ('townhall','courthouse','fire_station','embassy','library'): return 'gov',a
    if a=='bus_station': return 'transport','bus'
    if t.get('aeroway')=='aerodrome': return 'transport','airport'
    if a=='toilets': return 'toilets','toilets'
    if le in ('park','water_park','stadium'): return 'park',le
    if a in ('car_rental','car_repair','car_wash') or sh in ('car','car_repair','car_parts','tyres'): return 'car',a or sh
    if a in ('cinema','theatre','bar','pub','nightclub'): return 'fun',a
    if tr=='information': return None
    if a=='veterinary': return 'clinic','veterinary'
    return None
UNNAMED_OK={'money','fuel','parking','toilets','police','pharmacy','hospital','mosque','church'}
out=[]; seen=0
def rec(o,t,lon,lat):
    c=classify(t)
    if not c: return
    name=t.get('name') or ''
    if not name and not (t.get('name:ar') or t.get('name:en')) and c[0] not in UNNAMED_OK: return
    if not (32.2<=lat<=37.4 and 35.5<=lon<=42.5): return
    out.append(dict(id=o, lon=round(lon,5), lat=round(lat,5), c=c[0], s=c[1], n=name, ar=t.get('name:ar',''), en=t.get('name:en','') or t.get('int_name','') ,
      oh=t.get('opening_hours',''), ph=t.get('phone') or t.get('contact:phone') or t.get('contact:mobile') or t.get('phone:mobile') or '',
      w=t.get('website') or t.get('contact:website') or t.get('contact:facebook') or '', st=t.get('stars',''),
      cu=t.get('cuisine','') if c[0] in ('food','cafe') else '', br=t.get('brand','') or t.get('operator','') if c[0] in ('money','fuel') else ''))
class H(osmium.SimpleHandler):
    def node(self,n):
        if len(n.tags)==0: return
        rec('n%d'%n.id, dict(n.tags), n.location.lon, n.location.lat)
    def way(self,w):
        t=dict(w.tags)
        if not t or not classify(t): return
        xs=[];ys=[]
        for nd in w.nodes:
            if nd.location.valid(): xs.append(nd.location.lon); ys.append(nd.location.lat)
        if xs: rec('w%d'%w.id, t, sum(xs)/len(xs), sum(ys)/len(ys))
H().apply_file(sys.argv[1], locations=True)
json.dump(out, open('pois-full.json','w'), ensure_ascii=False)
print(len(out)); print(collections.Counter(p['c'] for p in out).most_common())
