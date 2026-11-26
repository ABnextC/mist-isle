# v3.2 데이터: 길잡이 돌(빠른 이동)과 탈것
# 실행: python3 tools/data/v32_travel.py (여러 번 돌려도 같은 결과)
#
# 길잡이 돌: 마을마다 하나 + 들판 쉼터 여섯. 처음 가까이 가면 길을 익히고(attune), 익힌 돌 사이를 은화를 내고 건너뛴다
# 탈것: 마구간(등대 마을·갈대 나루·잿고개)에서 사고, 범돌의 부탁으로 안개 사슴을 얻는다. 안장·편자로 조금 더 빨라진다
import json, math, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'data')
def load(f): return json.load(open(os.path.join(D, f + '.json')))
def save(f, d): open(os.path.join(D, f + '.json'), 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

regions = load('regions')
npcs = load('npcs')

# ── 자리 고르기: 마을 건물·작업대·사람과 겹치지 않는 가장 알맞은 곳 ──
def taken_in_town(s):
    out = []
    for st in s.get('stations', []):
        out.append((st['dx'], st['dz'], 1.8))
    for st in s.get('structures', []):
        if st['kind'] in ('waystone', 'stable'):
            continue
        out.append((st['dx'], st['dz'], st.get('r', 0.5)))
    for n in npcs:
        if n.get('at') == s['id']:
            out.append((n.get('dx', 0), n.get('dz', 0), 0.8))
    return out

def taken_in_site(s):
    out = [(st['dx'], st['dz'], st.get('r', 0.5) or 0.5) for st in s.get('structures', []) if st['kind'] != 'waystone']
    out += [(o['dx'], o['dz'], 0.8) for o in s.get('objects', [])]
    out += [(m['dx'], m['dz'], 0.8) for m in s.get('members', [])]
    for n in npcs:
        if n.get('site') == s['id']:
            out.append((n.get('dx', 0), n.get('dz', 0), 0.8))
    return out

def pick(taken, r, gap, rmin, rmax, prefer):
    best = None
    for ring in range(int(rmin * 2), int(rmax * 2) + 1):
        rr = ring / 2
        n = max(12, int(rr * 4))
        for k in range(n):
            ang = 2 * math.pi * k / n
            x, z = round(math.sin(ang) * rr, 1), round(math.cos(ang) * rr, 1)
            ok = all(math.hypot(x - tx, z - tz) >= r + tr + gap for tx, tz, tr in taken)
            if not ok:
                continue
            score = abs(rr - prefer) + 0.01 * k
            if best is None or score < best[0]:
                best = (score, x, z)
    assert best, 'no spot'
    return best[1], best[2]

# 길잡이 돌 목록(이름은 자리 이름을 따른다)
WAY_TOWNS = ['s_lighthouse', 's_forest', 's_gull', 's_port', 's_valley', 's_willow', 's_ash', 's_kiln', 's_gate']
WAY_SITES = ['hermit_hut', 'mist_village', 'ferry_inn', 'hunter_lodge', 'miner_camp', 'frost_pass', 'pilgrim_cairn']
STABLES = {'s_lighthouse': ['pony'], 's_port': ['pony', 'horse'], 's_ash': ['pony', 'horse', 'goat']}

ways = []
for r in regions:
    for s in r['settlements']:
        s['structures'] = [x for x in s['structures'] if x['kind'] not in ('waystone', 'stable')]
        if s['id'] in WAY_TOWNS:
            x, z = pick(taken_in_town(s), 0.7, 2.4, 6, s['radius'] - 4, 8)
            wid = 'w_' + s['id'][2:]
            s['structures'].append({'kind': 'waystone', 'dx': x, 'dz': z, 'r': 0.7, 'way': wid})
            ways.append({'id': wid, 'name': s['name'], 'region': r['id'], 'at': s['id']})
        if s['id'] in STABLES:
            t = taken_in_town(s) + [(st['dx'], st['dz'], st['r']) for st in s['structures'] if st['kind'] == 'waystone']
            x, z = pick(t, 2.4, 1.6, 10, s['radius'] + 2, s['radius'] - 4)
            s['structures'].append({'kind': 'stable', 'dx': x, 'dz': z, 'r': 2.4, 'rot': round(math.atan2(-x, -z), 2)})
    for s in r.get('sites', []):
        s['structures'] = [x for x in s.get('structures', []) if x['kind'] != 'waystone']
        if s['id'] in WAY_SITES:
            x, z = pick(taken_in_site(s), 0.7, 2.0, 4, s.get('r', 9) - 1, 6)
            wid = 'w_' + s['id']
            s['structures'].append({'kind': 'waystone', 'dx': x, 'dz': z, 'r': 0.7, 'way': wid})
            ways.append({'id': wid, 'name': s['name'], 'region': r['id'], 'site': s['id']})
save('regions', regions)

travel = {
    'waystones': ways,
    'mounts': [
        {'id': 'pony', 'name': '조랑말', 'speed': 1.45, 'price': 450, 'look': 'pony',
         'desc': '등대섬 들판에서 자란 작은 말. 겁이 많지만 순하고, 먹이를 가리지 않는다.'},
        {'id': 'horse', 'name': '갈기 말', 'speed': 1.6, 'price': 1600, 'look': 'horse', 'need': {'quest': 'c3_mistfolk'},
         'desc': '늪 기슭 목장에서 기른 키 큰 말. 늪길에서도 발이 빠지지 않는다.'},
        {'id': 'goat', 'name': '서리 산양', 'speed': 1.7, 'price': 2800, 'look': 'goat', 'need': {'quest': 'c5_ridge'},
         'desc': '능선 광부들이 타는 굵은 뿔 산양. 비탈을 가리지 않는다.'},
        {'id': 'mist_deer', 'name': '안개 사슴', 'speed': 1.7, 'price': None, 'look': 'mist_deer', 'quest': 'sq_lodge_deer',
         'desc': '범돌이 길들인 안개 사슴. 뿔 끝에 옅은 빛이 돈다. 살 수 없다.'},
    ],
    'stables': STABLES,
}
save('travel', travel)

# ── 안장·편자(만들어 다는 탈것 장비) ──
items = load('items')
GEAR = [
    {'id': 'mg_saddle_leather', 'name': '가죽 안장', 'family': 'leather', 'stage': 'mountgear', 'tier': 1, 'value': 60, 'icon': '🐎', 'mountGear': {'slot': 'saddle', 'speed': 0.04}},
    {'id': 'mg_saddle_fine', 'name': '수놓은 안장', 'family': 'leather', 'stage': 'mountgear', 'tier': 2, 'value': 220, 'icon': '🐎', 'mountGear': {'slot': 'saddle', 'speed': 0.07}},
    {'id': 'mg_shoes_iron', 'name': '쇠 편자', 'family': 'metal', 'stage': 'mountgear', 'tier': 2, 'value': 70, 'icon': '🧲', 'mountGear': {'slot': 'shoes', 'speed': 0.04}},
    {'id': 'mg_shoes_mist', 'name': '안개강 편자', 'family': 'metal', 'stage': 'mountgear', 'tier': 3, 'value': 260, 'icon': '🧲', 'mountGear': {'slot': 'shoes', 'speed': 0.07}},
]
ids = {g['id'] for g in GEAR}
items = [x for x in items if x['id'] not in ids] + GEAR
save('items', items)
recipes = load('recipes')
REC = [
    {'id': 'rc_saddle_leather', 'type': 'refine', 'name': '가죽 안장', 'skill': 'armoring', 'level': 8, 'station': 'armorbench',
     'slots': [{'key': 'seat', 'item': 'leather', 'qty': 6}, {'key': 'pad', 'item': 'cloth_reed', 'qty': 2}], 'output': {'item': 'mg_saddle_leather', 'qty': 1}, 'seconds': 10, 'xp': 50},
    {'id': 'rc_saddle_fine', 'type': 'refine', 'name': '수놓은 안장', 'skill': 'armoring', 'level': 30, 'station': 'armorbench',
     'slots': [{'key': 'seat', 'item': 'leather', 'qty': 10}, {'key': 'pad', 'item': 'cloth_reed', 'qty': 4}, {'key': 'gem', 'item': 'gem_cut', 'qty': 1}], 'output': {'item': 'mg_saddle_fine', 'qty': 1}, 'seconds': 14, 'xp': 120},
    {'id': 'rc_shoes_iron', 'type': 'refine', 'name': '쇠 편자', 'skill': 'smithing', 'level': 18, 'station': 'forge', 'stationTier': 2,
     'slots': [{'key': 'main', 'item': 'ingot_iron', 'qty': 3}], 'output': {'item': 'mg_shoes_iron', 'qty': 1}, 'seconds': 9, 'xp': 60},
    {'id': 'rc_shoes_mist', 'type': 'refine', 'name': '안개강 편자', 'skill': 'smithing', 'level': 40, 'station': 'forge', 'stationTier': 2,
     'slots': [{'key': 'main', 'item': 'ingot_mist', 'qty': 2}], 'output': {'item': 'mg_shoes_mist', 'qty': 1}, 'seconds': 12, 'xp': 140},
]
rids = {r['id'] for r in REC}
recipes = [x for x in recipes if x['id'] not in rids] + REC
save('recipes', recipes)

# ── 범돌의 부탁: 안개 사슴 길들이기 ──
qd = load('quests')
QL = qd['quests']
DEER = {
    'id': 'sq_lodge_deer', 'kind': 'side', 'giver': 'beomdol', 'requires': ['c3_mistfolk'], 'name': '안개 사슴 길들이기',
    'summary': '사냥꾼 쉼터의 범돌이 다친 안개 사슴을 돌보고 있다. 사슴이 마음을 열면 태워 줄지도 모른다.',
    'steps': [
        {'type': 'talk', 'npc': 'beomdol', 'text': '범돌에게 사슴 이야기 듣기',
         'say': ['덫에 걸린 놈을 데려왔는데, 안개 사슴이야. 사람을 안 태우는 놈들이지. 그래도 이 녀석은 자네를 자꾸 쳐다보는구먼. 산딸기를 좋아하네.'], 'reply': '산딸기를 구해 오겠습니다'},
        {'type': 'have', 'need': {'berry': 8}, 'text': '산딸기 8개 모으기'},
        {'type': 'talk', 'npc': 'beomdol', 'text': '범돌에게 산딸기 건네기', 'take': {'berry': 8},
         'say': ['옳지, 잘 먹는다. 그런데 밤마다 안개 늑대가 냄새를 맡고 쉼터 둘레를 돈다네. 저것들을 쫓아야 이 녀석이 마음 놓고 자.'], 'reply': '늑대를 쫓겠습니다'},
        {'type': 'kill', 'mobs': ['mist_wolf'], 'count': 3, 'text': '쉼터를 노리는 안개 늑대 3마리 잡기'},
        {'type': 'talk', 'npc': 'beomdol', 'text': '범돌에게 돌아가기',
         'say': ['봐, 자네가 오니 고개를 숙이지 않나. 이제 자네 짐승일세. 휘파람(V)을 불면 안개 속에서도 달려올 게야.'], 'reply': '고맙습니다, 어르신'},
    ],
    'reward': {'silver': 120, 'mount': 'mist_deer'},
}
QL[:] = [x for x in QL if x['id'] != 'sq_lodge_deer'] + [DEER]
save('quests', qd)

# ── 열리는 것·설정 ──
un = load('unlocks')
un[:] = [u for u in un if u['id'] != 'mount']
un.insert(0, {'id': 'mount', 'name': '탈것', 'icon': '🐎', 'when': {'quest': 'q4_forest'}, 'hint': '1장 「숲머리로」 뒤에 열린다',
              'desc': '등대 마을·갈대 나루·잿고개 마구간(미니맵 말굽)에서 탈것을 사서 V로 부른다. 맞거나 싸우면 내린다'})
save('unlocks', un)

cfg = load('config')
cfg['fastTravel'] = {'castSec': 4, 'useRange': 4, 'attuneRange': 7, 'base': 5, 'perM': 0.04, 'crossFee': 30, 'homeMult': 0.5, 'combatLockSec': 8}
cfg['mount'] = {'summonSec': 1.5, 'combatLockSec': 5, 'stableRange': 4.5}
cfg['dataVersion'] = max(cfg.get('dataVersion', 0), 35)
save('config', cfg)
print('길잡이 돌', len(ways), '·', ', '.join(w['id'] for w in ways))
