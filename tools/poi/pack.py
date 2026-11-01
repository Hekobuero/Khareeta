import json, collections
P=json.load(open('pois-full.json'))
cats=sorted(set(p['c'] for p in P)); subs=sorted(set(p['s'] for p in P))
f=[]
for p in P:
    ar=p['ar'] if p['ar']!=p['n'] else ''
    en=p['en'] if p['en']!=p['n'] else ''
    r=[p['lon'],p['lat'],cats.index(p['c']),subs.index(p['s']),p['id'],p['n'],ar,en,p['oh'],p['ph'],p['w'],p['st'],p['cu'] or p['br']]
    while r[-1]=='': r.pop()
    f.append(r)
meta={'v':1,'date':'2026-10-31','source':'© OpenStreetMap contributors, ODbL 1.0 (Geofabrik extract syria-261031)','license':'ODbL-1.0',
 'fields':['lon','lat','cat','sub','osm','name','name_ar','name_en','hours','phone','website','stars','extra'],'cats':cats,'subs':subs,
 'counts':dict(collections.Counter(p['c'] for p in P)),'f':f}
import os; os.makedirs('/workspace/khareeta/data',exist_ok=True)
s=json.dumps(meta,ensure_ascii=False,separators=(',',':'))
open('/workspace/khareeta/data/poi-syria.json','w').write(s)
print(len(s.encode()))
named=sum(1 for p in P if p['n'] or p['en']); print('named',named,'hours',sum(1 for p in P if p['oh']),'phone',sum(1 for p in P if p['ph']))
print(collections.Counter(p['s'] for p in P if p['c']=='money'))
