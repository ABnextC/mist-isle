# v2.3 데이터: 원정 넷, 원정 두목 넷, 안개 결정·안개강, 안개강 장비 아홉, 설계도 아홉, 원정 동료 셋
# 실행: python3 tools/data/v23_expeditions.py (여러 번 돌려도 같은 결과)
import json, os, copy
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'data')
def load(f): return json.load(open(os.path.join(D, f + '.json')))
def save(f, d): open(os.path.join(D, f + '.json'), 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

items = load('items')
IL = items if isinstance(items, list) else items['items']
IB = {x['id']: x for x in IL}
def put(x):
    if x['id'] in IB:
        IB[x['id']].clear(); IB[x['id']].update(x)
    else:
        IL.append(x); IB[x['id']] = x

# ── 재료 ──
put({'id': 'shard_mist', 'name': '안개 결정', 'stage': 'raw', 'tier': 3, 'value': 140, 'icon': '🔷', 'note': '원정 두목과 깊은 곳 짐승에게서만 나온다'})
put({'id': 'ingot_mist', 'name': '안개강 주괴', 'family': 'metal', 'stage': 'refined', 'tier': 3, 'value': 320, 'icon': '🧈'})

# ── 안개강 장비(철 장비의 1.3배 안팎, 무게는 조금 가볍게) ──
MIST = {
    'wpn_sword_mist': ('wpn_sword_iron', '안개강 검과 방패'), 'wpn_battleaxe_mist': ('wpn_battleaxe_iron', '안개강 대도끼'),
    'wpn_spear_mist': ('wpn_spear_iron', '안개강 창'), 'wpn_hammer_mist': ('wpn_hammer_iron', '안개강 전투 망치'),
    'wpn_bow_mist': ('wpn_bow_oak', '영맥 뿔 활'), 'wpn_staff_mist': ('wpn_staff_oak', '영맥 결정 지팡이'),
    'arm_mist_helm': ('arm_iron_helm', '안개강 투구'), 'arm_mist_cuirass': ('arm_iron_cuirass', '안개강 흉갑'), 'arm_mist_greaves': ('arm_iron_greaves', '안개강 다리갑'),
}
for nid, (src, name) in MIST.items():
    x = copy.deepcopy(IB[src])
    x['id'] = nid; x['name'] = name; x['tier'] = 3; x['value'] = int(x['value'] * 2.6)
    if 'weapon' in x: x['weapon']['tier'] = 3
    for k, sc in x['statConvert'].items():
        sc['base'] = round(sc['base'] * 1.32, 1) if k != 'durability' else int(sc['base'] * 1.3)
    if 'weight' in x: x['weight'] = round(x['weight'] * 0.9, 1)
    put(x)

# ── 설계도: 읽으면 그 장비 제작법을 안다 ──
BP = {}
for nid, (src, name) in MIST.items():
    bid = 'bp_' + nid.split('_', 1)[1]
    BP[nid] = bid
    put({'id': bid, 'name': f'설계도: {name}', 'blueprint': True, 'stage': 'misc', 'tier': 3, 'value': 600, 'icon': '📘', 'recipe': 'rc_' + nid.split('_', 1)[1], 'nogift': True})
save('items', items)

# ── 제작법 ──
rec = load('recipes')
RL = rec if isinstance(rec, list) else rec['recipes']
RB = {x['id']: x for x in RL}
def rput(x):
    if x['id'] in RB:
        RB[x['id']].clear(); RB[x['id']].update(x)
    else:
        RL.append(x); RB[x['id']] = x
rput({'id': 'rc_ingot_mist', 'type': 'refine', 'name': '안개강 제련', 'skill': 'smelting', 'level': 30, 'station': 'smelter', 'stationTier': 2,
      'slots': [{'key': 'main', 'item': 'ingot_iron', 'qty': 2}, {'key': 'core', 'item': 'shard_mist', 'qty': 1}],
      'output': {'item': 'ingot_mist', 'qty': 1}, 'seconds': 10, 'xp': 60})
SRC_RC = {'wpn_sword_iron': 'rc_sword_iron', 'wpn_battleaxe_iron': None, 'wpn_spear_iron': None, 'wpn_hammer_iron': None, 'wpn_bow_oak': 'rc_bow_oak', 'wpn_staff_oak': None,
          'arm_iron_helm': None, 'arm_iron_cuirass': 'rc_iron_cuirass', 'arm_iron_greaves': None}
by_out = {r['output']['item']: r for r in RL if r.get('output')}
for nid, (src, name) in MIST.items():
    r = copy.deepcopy(by_out[src])
    r['id'] = 'rc_' + nid.split('_', 1)[1]
    r['name'] = name
    r['level'] = r['level'] + 14
    r['xp'] = int(r['xp'] * 1.8)
    r['seconds'] = r['seconds'] + 4
    r['blueprint'] = BP[nid]
    r['output'] = {'item': nid, 'qty': 1}
    swapped = False
    for s in r['slots']:
        if s.get('item') == 'ingot_iron':
            s['item'] = 'ingot_mist'; swapped = True
    if not swapped:  # 활·지팡이: 영맥이 깃든 결정을 한 칸 더한다
        r['slots'].append({'key': 'core', 'item': 'shard_mist', 'qty': 2})
    rput(r)
save('recipes', rec)

# ── 원정 두목(이야기 두목을 바탕으로 더 세게) ──
cre = load('creatures')
CL = cre if isinstance(cre, list) else cre['creatures']
CB = {x['id']: x for x in CL}
BOSS = {
    'ex_yeogang': ('yeogang_wraith', '깊은 탑의 여강', 22, 1.75, 1.2, {'mist_wraith': 2}),
    'ex_yeomcheol': ('marine_captain', '요새 밑의 염철', 28, 1.7, 1.2, {'marine': 2}),
    'ex_forge': ('fire_guardian', '가마의 파수꾼', 36, 1.6, 1.22, {'ash_wolf': 2}),
    'ex_keeper': ('gate_warden', '심장 아래 문지기', 48, 1.6, 1.25, {'storm_wraith': 2}),
}
for bid, (src, name, lvl, hpk, dk, adds) in BOSS.items():
    x = copy.deepcopy(CB[src])
    x.update({'id': bid, 'name': name, 'model': CB[src].get('model', src), 'level': lvl, 'hp': int(CB[src]['hp'] * hpk), 'dmg': round(CB[src]['dmg'] * dk, 1),
              'wake': None, 'respawn': [999999, 999999], 'zone': None, 'leash': 60, 'expedition': True})
    x['drops'] = {'silver': [0, 0], 'items': []}  # 원정 보상은 원정이 한꺼번에 준다
    x['phases'] = [{'at': 0.6, 'summon': adds, 'haste': 1.1, 'note': f'{name}이(가) 깊은 곳의 무리를 부른다.'}, {'at': 0.3, 'haste': 1.25, 'note': f'{name}의 눈빛이 짙어진다.'}]
    x.pop('habitat', None)
    if bid in CB:
        CB[bid].clear(); CB[bid].update(x)
    else:
        CL.append(x); CB[bid] = x
save('creatures', cre)

# ── 원정 ──
EX = {
    'mercs': {
        'cost': 60,
        'list': [
            {'id': 'shield', 'name': '등불단 방패수', 'weapon': 'wpn_sword_iron', 'look': {'body': 'm', 'seed': 301, 'chest': 'heavy', 'legs': 'heavy', 'tint': {'shirt': '#c8c0a8', 'trousers': '#3a3632', 'sash': '#c8a050'}}},
            {'id': 'archer', 'name': '선단 궁수', 'weapon': 'wpn_bow_oak', 'look': {'body': 'f', 'seed': 302, 'chest': 'light', 'legs': 'light', 'tint': {'shirt': '#d8d0b8', 'vest': '#3e6a8a', 'trousers': '#2e3238'}}},
            {'id': 'mage', 'name': '학회 술사', 'weapon': 'wpn_staff_oak', 'look': {'body': 'm', 'seed': 303, 'chest': 'robe', 'legs': 'light', 'tint': {'robe': '#2e4a6e', 'sash': '#d8d0b8', 'trousers': '#2a2e38'}}},
        ],
    },
    'list': [
        {'id': 'ex_sunken', 'name': '가라앉은 탑 깊은 곳', 'icon': '🏚️', 'site': 'sunken_tower', 'requires': 'c3_sunken', 'level': 16, 'minutes': 12,
         'desc': '물에 잠긴 탑 아래층. 측량대가 남긴 장비와 여강의 그림자가 아직 떠돈다.',
         'waves': [{'mist_wraith': 3}, {'surveyor': 2, 'surveyor_spear': 1}, {'mist_wraith': 2, 'surveyor': 2}], 'boss': 'ex_yeogang',
         'reward': {'silver': [180, 240], 'xp': 1200, 'items': [{'item': 'shard_mist', 'qty': [2, 3]}, {'item': 'gem_rough', 'qty': [1, 2]}, {'item': 'ingot_iron', 'qty': [2, 3]}],
                    'blueprints': ['bp_sword_mist', 'bp_spear_mist', 'bp_mist_helm']}},
        {'id': 'ex_fort', 'name': '잿빛 요새 지하 창고', 'icon': '🏰', 'site': 'gray_fort', 'requires': 'c4_fort', 'level': 24, 'minutes': 12,
         'desc': '함대가 버리고 간 요새의 지하. 남은 수병들이 화약과 안개 결정을 지킨다.',
         'waves': [{'marine': 2, 'marine_spear': 1}, {'marine': 2, 'marine_spear': 2}, {'marine': 3, 'marine_spear': 2}], 'boss': 'ex_yeomcheol',
         'reward': {'silver': [240, 320], 'xp': 2200, 'items': [{'item': 'shard_mist', 'qty': [3, 4]}, {'item': 'ingot_iron', 'qty': [3, 5]}, {'item': 'leather', 'qty': [2, 3]}],
                    'blueprints': ['bp_battleaxe_mist', 'bp_hammer_mist', 'bp_mist_greaves']}},
        {'id': 'ex_kiln', 'name': '불의 가마', 'icon': '🌋', 'site': 'ember_tower', 'requires': 'c5_fourth', 'level': 33, 'minutes': 14,
         'desc': '불 파수꾼이 지키던 탑 밑 가마. 재와 서리의 늑대가 굴을 메운다.',
         'waves': [{'ash_wolf': 3}, {'frost_wolf': 2, 'ash_wolf': 2}, {'ash_wolf': 3, 'frost_wolf': 2}], 'boss': 'ex_forge',
         'reward': {'silver': [320, 420], 'xp': 3600, 'items': [{'item': 'shard_mist', 'qty': [4, 5]}, {'item': 'gem_rough', 'qty': [2, 3]}],
                    'blueprints': ['bp_bow_mist', 'bp_staff_mist', 'bp_mist_cuirass']}},
        {'id': 'ex_heart', 'name': '심장 아래', 'icon': '💠', 'site': 'heart_core', 'requires': 'c6_keeper', 'level': 45, 'minutes': 15,
         'desc': '첫 등지기가 잠든 뒤에도 심장 아래에서는 폭풍이 인다. 섬에서 가장 깊은 곳.',
         'waves': [{'storm_wraith': 3}, {'storm_wolf': 2, 'storm_wraith': 2}, {'storm_wolf': 3, 'storm_wraith': 2}], 'boss': 'ex_keeper',
         'reward': {'silver': [420, 560], 'xp': 5600, 'items': [{'item': 'shard_mist', 'qty': [5, 7]}, {'item': 'gem_rough', 'qty': [3, 4]}],
                    'blueprints': ['bp_sword_mist', 'bp_battleaxe_mist', 'bp_spear_mist', 'bp_hammer_mist', 'bp_bow_mist', 'bp_staff_mist', 'bp_mist_helm', 'bp_mist_cuirass', 'bp_mist_greaves']}},
    ],
    # 하루 첫 공략: 설계도 확률이 높고 보상이 온전하다. 같은 날 다시 하면 보상 절반·설계도 낮은 확률
    'firstOfDay': {'bp': 0.35, 'mult': 1.0},
    'again': {'bp': 0.08, 'mult': 0.5},
    'failM': 46,
}
save('expeditions', EX)

un = load('unlocks')
for u in un:
    if u['id'] == 'expedition':
        u['soon'] = False
        u['desc'] = '옛 탑·요새·가마·심장 아래를 친다. 동료를 데려갈 수 있고, 두목은 설계도를 떨군다.'
save('unlocks', un)
cfg = load('config'); cfg['dataVersion'] = 28; save('config', cfg)
print('ok', len(MIST), 'gear', len(BOSS), 'bosses', len(EX['list']), 'expeditions')
