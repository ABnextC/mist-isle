# v3.3 데이터: 등급 색, 종결 장비(심장 등급·원정 이름난 물건·퀘스트 전설), 장신구 넓히기(귀걸이),
# 탈것 티어(첫 조랑말은 퀘스트, 좋은 말은 퀘스트를 깨야 열림), 하우징 아이템(트로피·집 길잡이 돌·꾸밈)
# 실행: python3 tools/data/v33_gear.py → python3 tools/data/v31_quests.py(새 퀘스트 권장 레벨을 다시 센다). 여러 번 돌려도 같은 결과
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'data')
def load(f): return json.load(open(os.path.join(D, f + '.json')))
def save(f, d): open(os.path.join(D, f + '.json'), 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

items = load('items')
recipes = load('recipes')
cfg = load('config')
qd = load('quests')
QL = qd['quests']
ex = load('expeditions')
cr = load('creatures')
travel = load('travel')
housing = load('housing')

NEW_ITEMS = []
NEW_RECIPES = []
def item(d): NEW_ITEMS.append(d); return d
def recipe(d): NEW_RECIPES.append(d); return d

# ── 1. 등급(별 → 색) ──
# 만든 물건·재료 묶음의 star(1~5)를 이 다섯 등급으로 보인다. 이름난 물건(named)은 등급이 정해져 있다.
cfg['grades'] = [
    {'id': 'common', 'name': '일반', 'color': '#c9c6bc'},
    {'id': 'uncommon', 'name': '고급', 'color': '#5fd36b'},
    {'id': 'rare', 'name': '희귀', 'color': '#4aa8ff'},
    {'id': 'epic', 'name': '영웅', 'color': '#b876ff'},
    {'id': 'legendary', 'name': '전설', 'color': '#ff9b3d'},
]

# ── 짐승 갈래(트로피가 쓴다): 짐승·사람·영(靈) ──
HUMAN = ('raider', 'surveyor', 'marine', 'ex_yeomcheol')
SPIRIT = ('wraith', 'haetae', 'guardian', 'warden', 'keeper', 'imugi', 'ex_yeogang', 'ex_forge')
for c in cr:
    i = c['id']
    c['kin'] = 'human' if i.startswith(HUMAN) else 'spirit' if any(k in i for k in SPIRIT) else 'beast'
save('creatures', cr)

# ── 2. 심장 등급(T4): 첫 등지기의 심장 조각으로만 벼리는 종결 제작 장비 ──
item({'id': 'heart_core', 'name': '등지기 심장 조각', 'stage': 'raw', 'tier': 4, 'value': 600, 'icon': '❤️‍🔥',
      'note': '「심장 아래」 원정의 첫 등지기에게서만 나온다', 'bind': True})
item({'id': 'ingot_heart', 'name': '심장강 주괴', 'family': 'metal', 'stage': 'refined', 'tier': 4, 'value': 900, 'icon': '🧈', 'bind': True})
recipe({'id': 'rc_ingot_heart', 'type': 'refine', 'name': '심장강 제련', 'skill': 'smelting', 'level': 45, 'station': 'smelter', 'stationTier': 2,
        'slots': [{'key': 'main', 'item': 'ingot_mist', 'qty': 2}, {'key': 'core', 'item': 'heart_core', 'qty': 1}],
        'output': {'item': 'ingot_heart', 'qty': 1}, 'seconds': 14, 'xp': 160})
W4 = [
    ('sword', 'wpn_sword_heart', '심장강 검과 방패', 'smithing', 46, [('blade', 'ingot_heart', 3), ('grip', None, 1)], ('blade', 'grip'), '🗡️', 1.7),
    ('axe', 'wpn_battleaxe_heart', '심장강 대도끼', 'smithing', 48, [('head', 'ingot_heart', 4), ('haft', None, 2)], ('head', 'haft'), '🪓', 3.0),
    ('spear', 'wpn_spear_heart', '심장강 창', 'smithing', 47, [('tip', 'ingot_heart', 2), ('shaft', None, 3)], ('tip', 'shaft'), '🔱', 2.2),
    ('hammer', 'wpn_hammer_heart', '심장강 전투 망치', 'smithing', 49, [('head', 'ingot_heart', 5), ('haft', None, 2)], ('head', 'haft'), '🔨', 3.4),
    ('bow', 'wpn_bow_heart', '심장빛 뿔 활', 'carpentry', 47, [('limb', 'lumber_oak', 4), ('core', 'ingot_heart', 1), ('string', 'cloth_reed', 2)], ('limb', 'string'), '🏹', 1.3),
    ('staff', 'wpn_staff_heart', '심장빛 결정 지팡이', 'carpentry', 48, [('shaft', 'lumber_oak', 4), ('band', 'ingot_heart', 2), ('core', 'gem_cut', 2)], ('shaft', 'band'), '🪄', 1.6),
]
FAMP = {'ingot_heart': 'metal', 'lumber_oak': 'wood', 'cloth_reed': 'fiber', None: 'wood'}
PROP = {'metal': ('hardness', 'toughness'), 'wood': ('strength', 'flex'), 'fiber': ('tenacity', 'softness'), 'leather': ('thickness', 'suppleness')}
def prop_stats(a_key, a_fam, b_key, b_fam):
    pa, pb = PROP[a_fam], PROP[b_fam]
    return {'attack': {f'{a_key}.{pa[0]}': 0.7, f'{b_key}.{pb[0]}': 0.3}, 'durability': {f'{a_key}.{pa[1]}': 0.6, f'{b_key}.{pb[1]}': 0.4}}
for wtype, iid, name, skill, lvl, slots, (ka, kb), icon, wt in W4:
    item({'id': iid, 'name': name, 'kind': 'equipment', 'stage': 'weapon', 'tier': 4, 'value': 2600, 'icon': icon,
          'weapon': {'type': wtype, 'tier': 4}, 'bind': True,
          'statConvert': {'attack': {'base': 24.0, 'per': 0.17, 'round': 1}, 'durability': {'base': 400, 'per': 8, 'round': 0}}, 'weight': wt})
    rs = []
    fam = {}
    for key, it, q in slots:
        if it is None:
            rs.append({'key': key, 'family': 'wood', 'stage': 'refined', 'qty': q})
            fam[key] = 'wood'
        else:
            rs.append({'key': key, 'item': it, 'qty': q})
            fam[key] = FAMP.get(it, 'metal')
    bp = 'bp_' + iid[4:]
    station = 'forge' if skill == 'smithing' else 'workbench'
    recipe({'id': 'rc_' + iid[4:], 'type': 'craft', 'name': name, 'skill': skill, 'level': lvl, 'station': station, 'stationTier': 2,
            'slots': rs, 'stats': prop_stats(ka, fam[ka], kb, fam[kb]), 'output': {'item': iid, 'qty': 1}, 'seconds': 20, 'xp': 260, 'blueprint': bp})
    item({'id': bp, 'name': '설계도: ' + name, 'blueprint': True, 'stage': 'misc', 'tier': 4, 'value': 1200, 'icon': '📘', 'recipe': 'rc_' + iid[4:], 'nogift': True, 'bind': True})
A4 = [('head', 'arm_heart_helm', '심장강 투구', 3.0, 9.6, 3), ('chest', 'arm_heart_cuirass', '심장강 흉갑', 7.6, 15.5, 5), ('legs', 'arm_heart_greaves', '심장강 다리갑', 5.2, 11.4, 4)]
for slot, iid, name, wt, base, q in A4:
    item({'id': iid, 'name': name, 'kind': 'equipment', 'stage': 'armor', 'tier': 4, 'value': 2400, 'icon': {'head': '⛑️', 'chest': '🛡️', 'legs': '👖'}[slot],
          'weight': wt, 'armor': {'slot': slot, 'class': 'heavy'}, 'bind': True,
          'statConvert': {'armor': {'base': base, 'per': 0.12, 'round': 1}, 'durability': {'base': 360, 'per': 7, 'round': 0}}})
    bp = 'bp_' + iid[4:]
    recipe({'id': 'rc_' + iid[4:], 'type': 'craft', 'name': name, 'skill': 'armoring', 'level': 46 + q - 3, 'station': 'armorbench', 'stationTier': 2,
            'slots': [{'key': 'plate', 'item': 'ingot_heart', 'qty': q}, {'key': 'lining', 'item': 'leather', 'qty': 2}],
            'stats': {'armor': {'plate.hardness': 0.7, 'plate.toughness': 0.3}, 'durability': {'plate.toughness': 0.6, 'lining.suppleness': 0.4}},
            'output': {'item': iid, 'qty': 1}, 'seconds': 20, 'xp': 250, 'blueprint': bp})
    item({'id': bp, 'name': '설계도: ' + name, 'blueprint': True, 'stage': 'misc', 'tier': 4, 'value': 1200, 'icon': '📘', 'recipe': 'rc_' + iid[4:], 'nogift': True, 'bind': True})

# ── 3. 원정 이름난 물건(named): 원정마다 둘. 처음 깨면 하나는 꼭, 그 뒤엔 가끔. 등급이 정해져 있고 귀속 ──
def named(iid, name, base_id, grade, score, desc, extra=None):
    b = next(x for x in items + NEW_ITEMS if x['id'] == base_id)
    d = {k: v for k, v in b.items() if k not in ('id', 'name', 'value', 'recipe', 'keepsake')}
    d.update({'id': iid, 'name': name, 'named': True, 'bind': True, 'grade': grade, 'score': score, 'value': b['value'] * 2, 'desc': desc})
    if extra:
        d.update(extra)
    return item(d)
# ── 4. 장신구: 반지(능력치)·목걸이(생명·채집)·귀걸이(물약·말) × 구리·철·안개강 ──
METALS = [('copper', '구리', 1, 'ingot_copper', 6, 300), ('iron', '철', 2, 'ingot_iron', 20, 520), ('mist', '안개강', 3, 'ingot_mist', 34, 900)]
ATTR_NAME = {'str': '힘', 'dex': '민첩', 'int': '지혜', 'foc': '집중', 'con': '체질'}
OLD_JEWEL = {'ring_copper_str', 'ring_copper_dex', 'ring_iron_foc', 'neck_iron_int', 'neck_iron_con', 'neck_gather'}
def jewel_recipe(iid, name, metal_item, lvl, stat, gem=1):
    if 'rc_' + iid[0:] in {r['id'] for r in recipes}:
        return
    recipe({'id': 'rc_' + iid, 'type': 'craft', 'name': name, 'skill': 'jewelcraft', 'level': lvl, 'station': 'stonebench', 'stationTier': 1,
            'slots': [{'key': 'band', 'item': metal_item, 'qty': 2}, {'key': 'gem', 'item': 'gem_cut', 'qty': gem}],
            'stats': {stat: {'band.hardness': 0.5, 'band.toughness': 0.5}, 'durability': {'band.toughness': 1}},
            'output': {'item': iid, 'qty': 1}, 'seconds': 12, 'xp': 60 + lvl * 4})
for m, mn, t, ing, lvl, val in METALS:
    for at, an in ATTR_NAME.items():
        iid = f'ring_{m}_{at}'
        if iid in OLD_JEWEL:
            continue
        item({'id': iid, 'name': f'{mn} {an} 반지', 'kind': 'equipment', 'stage': 'jewel', 'tier': t, 'value': val, 'icon': '💍',
              'jewel': {'slot': 'ring', 'attr': at}, 'statConvert': {'durability': {'base': 200 + 80 * t, 'per': 4, 'round': 0}, 'attr': {'base': 1 + t, 'per': 0.03, 'round': 0}}, 'weight': 0.1})
        jewel_recipe(iid, f'{mn} {an} 반지', ing, lvl + (2 if at in ('int', 'foc') else 0), 'attr')
    iid = f'neck_{m}_life'
    item({'id': iid, 'name': f'{mn} 생명 목걸이', 'kind': 'equipment', 'stage': 'jewel', 'tier': t, 'value': val, 'icon': '📿',
          'jewel': {'slot': 'neck', 'hp': True}, 'statConvert': {'durability': {'base': 200 + 80 * t, 'per': 4, 'round': 0}, 'hp': {'base': 6 + 6 * t, 'per': 0.12, 'round': 0}}, 'weight': 0.1})
    jewel_recipe(iid, f'{mn} 생명 목걸이', ing, lvl + 2, 'hp')
    for kind, kn, base, per in (('potion', '물약', 0.06 + 0.03 * t, 0.0008), ('ride', '말발굽', 0.02 + 0.01 * t, 0.0002)):
        iid = f'ear_{m}_{kind}'
        item({'id': iid, 'name': f'{mn} {kn} 귀걸이', 'kind': 'equipment', 'stage': 'jewel', 'tier': t, 'value': val, 'icon': '🔸',
              'jewel': {'slot': 'ear', kind: True}, 'statConvert': {'durability': {'base': 200 + 80 * t, 'per': 4, 'round': 0}, kind: {'base': round(base, 3), 'per': per, 'round': 3}}, 'weight': 0.05})
        jewel_recipe(iid, f'{mn} {kn} 귀걸이', ing, lvl + 4, kind)
# 채집꾼 목걸이는 구리·안개강도
for m, mn, t, ing, lvl, val in (METALS[0], METALS[2]):
    iid = f'neck_{m}_gather'
    item({'id': iid, 'name': f'{mn} 채집꾼 목걸이', 'kind': 'equipment', 'stage': 'jewel', 'tier': t, 'value': val, 'icon': '📿',
          'jewel': {'slot': 'neck', 'gather': True}, 'statConvert': {'durability': {'base': 200 + 80 * t, 'per': 4, 'round': 0}, 'gather': {'base': 0.01 + 0.02 * t, 'per': 0.0006, 'round': 3}}, 'weight': 0.1})
    jewel_recipe(iid, f'{mn} 채집꾼 목걸이', ing, lvl + 4, 'gather')

# 이름난 물건을 장신구 다음에 다시 만든다(바탕 물건이 위에서 생겼다)
NAMED = {
    'ex_sunken': [
        named('wpn_staff_yeogang', '물빛 여강 지팡이', 'wpn_staff_mist', 4, 86, '여강이 등불 대신 들던 지팡이. 끝에 물방울 같은 빛이 맺힌다.'),
        named('ear_yeogang', '여강의 눈물 귀걸이', 'ear_iron_potion', 4, 86, '물약이 더 깊이 스민다.'),
    ],
    'ex_fort': [
        named('wpn_axe_yeomcheol', '염철의 쇠갈고리', 'wpn_battleaxe_mist', 4, 86, '요새 문을 뜯던 갈고리 도끼. 날 끝에 화약 그을음이 남아 있다.'),
        named('ring_marine', '수병 대장 인장 반지', 'ring_mist_str', 4, 86, '함대 수병 대장의 인장. 힘이 붙는다.'),
    ],
    'ex_kiln': [
        named('wpn_hammer_kiln', '가마불 망치', 'wpn_hammer_mist', 4, 88, '불의 가마 속에서 식지 않은 망치.'),
        named('neck_ember', '꺼지지 않는 불씨 목걸이', 'neck_mist_life', 4, 88, '가슴께가 늘 따뜻하다. 체력이 오른다.'),
    ],
    'ex_heart': [
        named('wpn_sword_keeper', '첫 등지기의 칼', 'wpn_sword_heart', 5, 95, '첫 등지기가 심장을 지키며 들었던 칼. 이 섬에 단 하나.'),
        named('wpn_bow_keeper', '첫 등불 활', 'wpn_bow_heart', 5, 95, '첫 등불을 밝힌 날 만든 활. 시위에서 옅은 빛이 난다.'),
    ],
}
# 퀘스트 전설: 6장 끝 「새 맹약」의 반지(모든 능력치)
named('ring_covenant', '새 맹약의 반지', 'ring_mist_str', 5, 95, '돌보는 만큼 내어 준다. 모든 능력치가 오른다.', {'jewel': {'slot': 'ring', 'attrAll': True}})

for e in ex['list']:
    e['reward']['named'] = [x['id'] for x in NAMED.get(e['id'], [])]
    if e['id'] == 'ex_heart':
        e['reward']['items'] = [x for x in e['reward']['items'] if x['item'] != 'heart_core'] + [{'item': 'heart_core', 'qty': [1, 2]}]
        e['reward']['blueprints'] = [b for b in e['reward']['blueprints'] if not b.endswith('_heart')] + ['bp_' + w[1][4:] for w in W4] + ['bp_' + a[1][4:] for a in A4]
ex['firstOfDay']['named'] = 0.2
ex['again']['named'] = 0.06
save('expeditions', ex)
for q in QL:
    if q['id'] == 'c6_covenant':
        its = [x for x in q['reward'].get('items', []) if x['item'] != 'ring_covenant']
        q['reward']['items'] = its + [{'item': 'ring_covenant', 'qty': 1}]

# ── 5. 탈것 티어 ──
MOUNTS = [
    {'id': 'pony', 'name': '조랑말', 'tier': 1, 'speed': 1.4, 'price': None, 'look': 'pony', 'quest': 'sq_first_pony',
     'desc': '강두가 경비대에서 내준 작은 말. 겁이 많지만 순하다. 살 수 없다.'},
    {'id': 'horse', 'name': '갈기 말', 'tier': 2, 'speed': 1.55, 'price': 1600, 'look': 'horse', 'need': {'quest': 'c3_mistfolk'},
     'desc': '늪 기슭 목장에서 기른 키 큰 말. 늪길에서도 발이 빠지지 않는다.'},
    {'id': 'goat', 'name': '서리 산양', 'tier': 3, 'speed': 1.65, 'price': 2800, 'look': 'goat', 'need': {'quest': 'c5_ridge'},
     'desc': '능선 광부들이 타는 굵은 뿔 산양. 「불의 능선」을 끝낸 개척자에게만 내준다.'},
    {'id': 'mist_deer', 'name': '안개 사슴', 'tier': 3, 'speed': 1.65, 'price': None, 'look': 'mist_deer', 'quest': 'sq_lodge_deer',
     'desc': '범돌이 길들인 안개 사슴. 뿔 끝에 옅은 빛이 돈다. 살 수 없다.'},
    {'id': 'storm_steed', 'name': '폭풍 준마', 'tier': 4, 'speed': 1.8, 'price': None, 'look': 'storm', 'quest': 'sq_storm_steed',
     'desc': '폭풍 늑대를 앞질러 달리는 검푸른 말. 갈기에 번개빛이 흐른다. 6장을 끝내야 만난다.'},
]
travel['mounts'] = MOUNTS
travel['stables'] = {'s_lighthouse': [], 's_port': ['horse'], 's_ash': ['horse', 'goat']}
save('travel', travel)

def q_upsert(q):
    QL[:] = [x for x in QL if x['id'] != q['id']] + [q]
q_upsert({
    'id': 'sq_first_pony', 'kind': 'side', 'giver': 'gangdu', 'requires': ['q4_forest'], 'name': '첫 조랑말',
    'summary': '숲머리까지 다녀온 개척자에게 강두가 경비대 조랑말을 맡기려 한다.',
    'steps': [
        {'type': 'talk', 'npc': 'gangdu', 'text': '강두와 이야기하기',
         'say': '숲머리까지 걸어서 다녀왔다고? 다리가 남아나겠나. 경비대 마구간에 놀고 있는 조랑말이 하나 있네. 먹이를 챙겨 오면 자네한테 맡기지.', 'reply': '먹이를 구해 오겠습니다'},
        {'type': 'have', 'need': {'berry': 6}, 'text': '조랑말 먹이(산딸기 6개) 모으기'},
        {'type': 'talk', 'npc': 'gangdu', 'text': '강두에게 먹이 건네기', 'take': {'berry': 6},
         'say': '옳지. 이제 자네 말일세. 휘파람(V)을 불면 달려온다네. 맞으면 놀라서 내려놓으니 싸울 땐 내려서 싸우게.', 'reply': '고맙습니다'},
    ],
    'reward': {'silver': 30, 'mount': 'pony'},
})
q_upsert({
    'id': 'sq_storm_steed', 'kind': 'side', 'giver': 'suryeon', 'requires': ['c6_covenant'], 'name': '폭풍을 앞지르는 말',
    'summary': '안개가 걷힌 뒤, 순례자 수련이 폭풍 속을 달리는 검푸른 말을 봤다고 한다.',
    'steps': [
        {'type': 'talk', 'npc': 'suryeon', 'text': '수련에게 말 이야기 듣기',
         'say': '심장이 잠잠해진 밤, 폭풍 늑대 떼를 앞질러 달리는 말을 봤어요. 늑대들이 그 아이를 몰고 있었어요. 늑대를 흩어 주면 다가올지도 몰라요.', 'reply': '늑대를 흩겠습니다'},
        {'type': 'kill', 'mobs': ['storm_wolf'], 'count': 6, 'text': '말을 모는 폭풍 늑대 6마리 잡기'},
        {'type': 'have', 'need': {'shard_mist': 4}, 'text': '말을 달랠 안개 결정 4개 모으기'},
        {'type': 'talk', 'npc': 'suryeon', 'text': '수련에게 돌아가기', 'take': {'shard_mist': 4},
         'say': '결정 냄새를 맡고 왔네요. 봐요, 당신을 따라가겠대요. 이 섬에서 가장 빠른 아이예요.', 'reply': '잘 돌보겠습니다'},
    ],
    'reward': {'silver': 200, 'mount': 'storm_steed'},
})
# 범돌의 사슴 부탁(3티어)은 4장 「물러가는 함대」 뒤로(진행 페르소나: 갈기 말을 사자마자 한 레벨 뒤 사슴을 공짜로 얻었다)
for q in QL:
    if q['id'] == 'sq_lodge_deer':
        q['requires'] = ['c4_retreat']

# ── 6. 하우징 아이템 ──
# 트로피: 집에 놓으면 그 갈래 짐승에게 주는 피해나 채집 몫이 오른다. 같은 갈래는 하나만, 집 단계마다 1·2·3개까지
def furn(iid, name, tier, val, icon, comfort, extra=None):
    d = {'id': iid, 'name': name, 'kind': 'equipment', 'stage': 'furniture', 'tier': tier, 'value': val, 'icon': icon,
         'statConvert': {'comfort': {'base': comfort, 'per': 0.5, 'round': 0}, 'durability': {'base': 160, 'per': 4, 'round': 0}}}
    if extra:
        d.update(extra)
    return item(d)
def craft_furn(iid, name, skill, lvl, station, slots, stat_a, stat_b):
    recipe({'id': 'rc_' + iid, 'type': 'craft', 'name': name, 'skill': skill, 'level': lvl, 'station': station, 'stationTier': 1,
            'slots': slots, 'stats': {'comfort': stat_a, 'durability': stat_b}, 'output': {'item': iid, 'qty': 1}, 'seconds': 14, 'xp': 50 + lvl * 4})
WOOD = {'board.flex': 0.5, 'board.strength': 0.5}
WOODD = {'board.strength': 1}
furn('tr_wolf', '늑대 머리 박제', 2, 600, '🐺', 10, {'trophy': {'kind': 'beast', 'value': 0.04}})
craft_furn('tr_wolf', '늑대 머리 박제', 'carpentry', 22, 'workbench', [{'key': 'board', 'item': 'lumber_oak', 'qty': 3}, {'key': 'hide', 'item': 'hide_raw', 'qty': 10}, {'key': 'gem', 'item': 'gem_rough', 'qty': 2}], WOOD, WOODD)
furn('tr_flag', '검은 돛 깃발', 2, 600, '🏴', 10, {'trophy': {'kind': 'human', 'value': 0.04}})
furn('tr_lamp', '망령 등잔', 3, 800, '🏮', 12, {'trophy': {'kind': 'spirit', 'value': 0.04}})
furn('tr_pick', '금빛 곡괭이 걸이', 2, 500, '⛏️', 8, {'trophy': {'kind': 'mining', 'value': 0.05}})
craft_furn('tr_pick', '금빛 곡괭이 걸이', 'smithing', 24, 'forge', [{'key': 'board', 'item': 'lumber_oak', 'qty': 2}, {'key': 'head', 'item': 'ingot_iron', 'qty': 4}, {'key': 'gem', 'item': 'gem_cut', 'qty': 1}], WOOD, WOODD)
furn('tr_axe', '나무꾼 도끼 걸이', 2, 500, '🪓', 8, {'trophy': {'kind': 'logging', 'value': 0.05}})
craft_furn('tr_axe', '나무꾼 도끼 걸이', 'smithing', 18, 'forge', [{'key': 'board', 'item': 'lumber_birch', 'qty': 3}, {'key': 'head', 'item': 'ingot_iron', 'qty': 3}], WOOD, WOODD)
furn('tr_trout', '큰 송어 박제', 3, 600, '🐟', 9, {'trophy': {'kind': 'fishing', 'value': 0.05}})
craft_furn('tr_trout', '큰 송어 박제', 'carpentry', 26, 'workbench', [{'key': 'board', 'item': 'lumber_oak', 'qty': 2}, {'key': 'fish', 'item': 'fish_trout', 'qty': 3}, {'key': 'glow', 'item': 'fish_glow', 'qty': 1}], WOOD, WOODD)
furn('tr_sickle', '약초꾼 낫 걸이', 2, 500, '🌿', 8, {'trophy': {'kind': 'harvesting', 'value': 0.05}})
craft_furn('tr_sickle', '약초꾼 낫 걸이', 'smithing', 16, 'forge', [{'key': 'board', 'item': 'lumber_birch', 'qty': 2}, {'key': 'head', 'item': 'ingot_copper', 'qty': 3}, {'key': 'herb', 'item': 'herb_moon', 'qty': 2}], WOOD, WOODD)
# 원정 첫 트로피(처음 깨면 준다)
TROPHY_OF = {'ex_sunken': 'tr_lamp', 'ex_fort': 'tr_flag'}
for e in ex['list']:
    if e['id'] in TROPHY_OF:
        e['reward']['firstTrophy'] = TROPHY_OF[e['id']]
save('expeditions', ex)

# 집 길잡이 돌: 집에 두면 어느 길잡이 돌에서든 집 앞으로 건너뛴다(값은 귀환 지점 반값과 같다)
furn('furn_hearthstone', '집 길잡이 돌', 3, 900, '🪨', 6, {'hearthstone': True})
recipe({'id': 'rc_furn_hearthstone', 'type': 'craft', 'name': '집 길잡이 돌', 'skill': 'masonry', 'level': 28, 'station': 'stonebench', 'stationTier': 1,
        'slots': [{'key': 'body', 'item': 'stone_cut', 'qty': 12}, {'key': 'core', 'item': 'shard_mist', 'qty': 2}, {'key': 'gem', 'item': 'gem_cut', 'qty': 1}],
        'stats': {'comfort': {'body.density': 1}, 'durability': {'body.grain': 1}}, 'output': {'item': 'furn_hearthstone', 'qty': 1}, 'seconds': 20, 'xp': 200})
# 꾸밈(아늑함)
DECOR = [
    ('furn_screen', '대나무 병풍', 2, 320, '🎋', 16, 'carpentry', 14, 'workbench', [{'key': 'board', 'item': 'lumber_birch', 'qty': 4}, {'key': 'cloth', 'item': 'cloth_reed', 'qty': 4}], {'board.flex': 0.6, 'cloth.softness': 0.4}),
    ('furn_scroll', '등대 족자 그림', 2, 300, '🖼️', 15, 'weaving', 12, 'loom', [{'key': 'cloth', 'item': 'cloth_reed', 'qty': 5}, {'key': 'board', 'item': 'lumber_birch', 'qty': 1}], {'cloth.softness': 0.6, 'board.flex': 0.4}),
    ('furn_plant', '돌 화분', 1, 180, '🪴', 11, 'masonry', 6, 'stonebench', [{'key': 'body', 'item': 'stone_cut', 'qty': 4}, {'key': 'herb', 'item': 'herb_moon', 'qty': 1}], {'body.density': 0.5, 'body.grain': 0.5}),
    ('furn_bookcase', '책장', 2, 360, '📚', 18, 'carpentry', 18, 'workbench', [{'key': 'board', 'item': 'lumber_oak', 'qty': 6}, {'key': 'nail', 'item': 'nails_copper', 'qty': 10}], {'board.strength': 0.6, 'board.flex': 0.4}),
    ('furn_chime', '바람종', 2, 340, '🎐', 14, 'jewelcraft', 12, 'stonebench', [{'key': 'band', 'item': 'ingot_copper', 'qty': 3}, {'key': 'gem', 'item': 'gem_cut', 'qty': 1}], {'band.hardness': 0.5, 'band.toughness': 0.5}),
    ('furn_bearskin', '털가죽 깔개', 2, 380, '🟫', 19, 'tanning', 16, 'tannery', [{'key': 'hide', 'item': 'leather', 'qty': 8}], {'hide.suppleness': 0.6, 'hide.thickness': 0.4}),
    ('furn_armorstand', '갑옷 거치대', 2, 420, '🛡️', 14, 'smithing', 20, 'forge', [{'key': 'head', 'item': 'ingot_iron', 'qty': 4}, {'key': 'board', 'item': 'lumber_oak', 'qty': 2}], {'head.hardness': 0.5, 'board.strength': 0.5}),
    ('furn_tank', '안개 물고기 어항', 3, 520, '🐠', 22, 'masonry', 24, 'stonebench', [{'key': 'body', 'item': 'stone_cut', 'qty': 6}, {'key': 'fish', 'item': 'fish_glow', 'qty': 2}, {'key': 'gem', 'item': 'gem_cut', 'qty': 1}], {'body.density': 0.5, 'body.grain': 0.5}),
]
for iid, name, t, val, icon, comfort, skill, lvl, station, slots, stat in DECOR:
    furn(iid, name, t, val, icon, comfort)
    dkey = next(iter(stat)).split('.')[0]
    craft_furn(iid, name, skill, lvl, station, slots, stat, {next(iter(stat)): 1})
housing['trophies'] = {'max': {'hut': 1, 'house': 2, 'manor': 3}}

un = load('unlocks')
for u in un:
    if u['id'] == 'mount':
        u['desc'] = '강두의 부탁 「첫 조랑말」로 첫 말을 얻고 V로 부른다. 좋은 말은 퀘스트를 깨야 마구간(갈대 나루·잿고개)에 나온다. 맞거나 싸우면 내린다'
save('unlocks', un)

# ── 저장 ──
ids = {x['id'] for x in NEW_ITEMS}
items = [x for x in items if x['id'] not in ids] + NEW_ITEMS
rids = {r['id'] for r in NEW_RECIPES}
recipes = [r for r in recipes if r['id'] not in rids] + NEW_RECIPES
save('items', items)
save('recipes', recipes)
save('quests', qd)
save('housing', housing)
cfg['dataVersion'] = 36
save('config', cfg)
print('물건', len(NEW_ITEMS), '레시피', len(NEW_RECIPES))
