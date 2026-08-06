# -*- coding: utf-8 -*-
"""raw_data.json (SatisfactoryTools 1.0) + raw_ko.json (SCIM 한국어) -> web/data.js 변환"""
import json, os

SRC = os.path.join(os.path.dirname(__file__), '..', 'raw_data.json')
KO = os.path.join(os.path.dirname(__file__), '..', 'raw_ko.json')
DST = os.path.join(os.path.dirname(__file__), '..', 'web', 'data.js')

d = json.load(open(SRC, encoding='utf-8'))
ko = json.load(open(KO, encoding='utf-8'))

def ko_item(cn):
    for sec in ('itemsData', 'toolsData', 'faunaData'):
        e = ko[sec].get(cn)
        if e and e.get('name'):
            return e['name']
    return None

def ko_recipe(cn):
    e = ko['recipesData'].get(cn)
    if not e or not e.get('name'):
        return None
    return e['name'].removeprefix('대체: ')

def ko_machine(cn):
    e = ko['buildingsData'].get(cn.replace('Desc_', 'Build_', 1))
    return e['name'] if e and e.get('name') else None

# 기계 생산 레시피만 (건물 건설 레시피 제외)
recipes = []
used_items = set()
used_machines = set()
for r in d['recipes'].values():
    if not r['inMachine'] or r['forBuilding'] or not r['producedIn']:
        continue
    machine = r['producedIn'][0]
    used_machines.add(machine)
    entry = {
        'id': r['className'],
        'name': r['name'],
        'ko': ko_recipe(r['className']) or r['name'],
        'alt': r['alternate'],
        'hand': r['inHand'],
        'time': r['time'],
        'machine': machine,
        'in': [[i['item'], i['amount']] for i in r['ingredients']],
        'out': [[p['item'], p['amount']] for p in r['products']],
    }
    if r.get('isVariablePower'):
        entry['power'] = (r['minPower'] + r['maxPower']) / 2
    recipes.append(entry)
    for i in r['ingredients']:
        used_items.add(i['item'])
    for p in r['products']:
        used_items.add(p['item'])

used_items.add('Desc_CrystalShard_C')  # 동력 조각 (오버클럭 재화)

items = {}
for cn, it in d['items'].items():
    if cn in used_items:
        items[cn] = {'n': it['name'], 'ko': ko_item(cn) or it['name'],
                     'liq': it['liquid'], 'pts': it.get('sinkPoints', 0)}

machines = {}
for cn in used_machines:
    b = d['buildings'].get(cn)
    if b:
        machines[cn] = {
            'n': b['name'],
            'ko': ko_machine(cn) or b['name'],
            'power': b['metadata'].get('powerConsumption', 0),
        }
    else:
        machines[cn] = {'n': cn, 'ko': ko_machine(cn) or cn, 'power': 0}

# 원자재: 추출 대상 자원 (광석·액체·기체)
raw = sorted({res['item'] for res in d['resources'].values() if res['item'] in used_items})

# 방치형 게임용: 건물 건설 비용 (휴대용 채굴기는 제작 재료로 환산)
BUILDINGS = list(used_machines) + [
    'Desc_MinerMk1_C', 'Desc_WaterPump_C', 'Desc_OilPump_C',
    'Desc_GeneratorCoal_C', 'Desc_GeneratorFuel_C', 'Desc_GeneratorNuclear_C',
]
build = {}
for r in d['recipes'].values():
    if not r['forBuilding'] or not r['products']:
        continue
    target = r['products'][0]['item']
    if target not in BUILDINGS:
        continue
    cost = {}
    for i in r['ingredients']:
        if i['item'] == 'BP_ItemDescriptorPortableMiner_C':
            cost['Desc_IronPlate_C'] = cost.get('Desc_IronPlate_C', 0) + 2 * i['amount']
            cost['Desc_IronRod_C'] = cost.get('Desc_IronRod_C', 0) + 4 * i['amount']
        else:
            cost[i['item']] = cost.get(i['item'], 0) + i['amount']
    build[target] = [[k, v] for k, v in cost.items()]

# 추출기·발전기 한국어 이름
xnames = {}
for cn in ['Desc_MinerMk1_C', 'Desc_WaterPump_C', 'Desc_OilPump_C',
           'Desc_GeneratorCoal_C', 'Desc_GeneratorFuel_C', 'Desc_GeneratorNuclear_C']:
    xnames[cn] = ko_machine(cn) or cn

out = {
    'items': items,
    'recipes': recipes,
    'machines': machines,
    'raw': raw,
    'build': build,
    'xnames': xnames,
}
os.makedirs(os.path.dirname(DST), exist_ok=True)
with open(DST, 'w', encoding='utf-8') as f:
    f.write('window.GAME_DATA = ')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

print('recipes:', len(recipes), '| items:', len(items),
      '| machines:', len(machines), '| raw:', len(raw))
print('machines:', sorted(machines[m]['n'] for m in machines))
print('raw:', [items[r]['n'] for r in raw])
