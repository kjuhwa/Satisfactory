# -*- coding: utf-8 -*-
"""아이템/건물 아이콘을 SatisfactoryTools 저장소에서 game/icons/ 로 다운로드"""
import json, os, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'game', 'icons')
os.makedirs(OUT, exist_ok=True)

raw = json.load(open(os.path.join(ROOT, 'raw_data.json'), encoding='utf-8'))
data_src = open(os.path.join(ROOT, 'web', 'data.js'), encoding='utf-8').read()
data = json.loads(data_src[data_src.index('=') + 1:].rstrip().rstrip(';'))

BASE = 'https://raw.githubusercontent.com/greeny/SatisfactoryTools/master/www/assets/images'

jobs = []  # (url, dest cn)
for cn in data['items']:
    it = raw['items'].get(cn)
    if it and it.get('icon'):
        jobs.append((f"{BASE}/items/{it['icon']}_64.png", cn))
# 건물 아이콘도 items/ 폴더에 있음
for cn in list(data['machines']) + list(data['xnames']):
    b = raw['buildings'].get(cn)
    if b and b.get('icon'):
        jobs.append((f"{BASE}/items/{b['icon']}_64.png", cn))

def fetch(job):
    url, cn = job
    dest = os.path.join(OUT, cn + '.png')
    if os.path.exists(dest):
        return (cn, 'skip')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'x'})
        body = urllib.request.urlopen(req, timeout=20).read()
        with open(dest, 'wb') as f:
            f.write(body)
        return (cn, 'ok')
    except Exception as e:
        return (cn, f'FAIL {e}')

with ThreadPoolExecutor(8) as ex:
    results = list(ex.map(fetch, jobs))

ok = sum(1 for _, s in results if s in ('ok', 'skip'))
fails = [(cn, s) for cn, s in results if s.startswith('FAIL')]
print(f'{ok}/{len(jobs)} ok')
for cn, s in fails:
    print(cn, s)
