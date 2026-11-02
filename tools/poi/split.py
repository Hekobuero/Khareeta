# Splits data/poi-syria.json (output of pack.py) into small parts for the app: data/poi/index.json + data/poi/pN.json.
# Small parts keep every JSON.parse on the main thread short (no long task / Lighthouse TBT), the app loads them
# one after another after the first map paint. Run from the repo root:  python3 tools/poi/split.py
# "dv" (data version = hash of the source) is written into index.json and every part: the app requests the parts as
# pN.json?dv=… and the service worker keeps one complete set per dv (cache kh-poi-<dv>), so index and parts never mix.
import json, os, glob, hashlib
SRC, DST, ROWS = 'data/poi-syria.json', 'data/poi', 600
raw = open(SRC, 'rb').read()
dv = hashlib.sha1(raw).hexdigest()[:10]
j = json.loads(raw.decode('utf-8'))
f = j.pop('f')
os.makedirs(DST, exist_ok=True)
for old in glob.glob(DST + '/p*.json'): os.remove(old)
parts = [f[i:i + ROWS] for i in range(0, len(f), ROWS)]
for n, p in enumerate(parts):
    open(f'{DST}/p{n}.json', 'w', encoding='utf-8').write(json.dumps({'dv': dv, 'f': p}, ensure_ascii=False, separators=(',', ':')))
j['dv'] = dv; j['parts'] = len(parts); j['rows'] = len(f)
open(f'{DST}/index.json', 'w', encoding='utf-8').write(json.dumps(j, ensure_ascii=False, separators=(',', ':')))
print(len(f), 'rows ->', len(parts), 'parts, dv', dv)
