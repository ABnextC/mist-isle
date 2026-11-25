# v2.7 데이터: 영지전 — 본섬 마을 다섯을 두고 조합끼리 싸운다
# 실행: python3 tools/data/v27_territory.py (여러 번 돌려도 같은 결과)
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'data')
def load(f): return json.load(open(os.path.join(D, f + '.json')))
def save(f, d): open(os.path.join(D, f + '.json'), 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

LEATHER = {'head': 'arm_leather_hood', 'chest': 'arm_leather_vest', 'legs': 'arm_leather_pants'}
IRON = {'head': 'arm_iron_helm', 'chest': 'arm_iron_cuirass', 'legs': 'arm_iron_greaves'}
terr = {
    # 영지가 되는 마을과 처음 주인
    'holds': [
        {'settlement': 's_port', 'owner': 'ai:anchor'},
        {'settlement': 's_valley', 'owner': 'ai:lamp'},
        {'settlement': 's_willow', 'owner': 'ai:anchor'},
        {'settlement': 's_ash', 'owner': 'ai:ledger'},
        {'settlement': 's_kiln', 'owner': 'ai:lamp'},
    ],
    'aiGuilds': [
        {'id': 'anchor', 'name': '잿빛 닻 조합', 'faction': 'fleet', 'color': '#3f7fb0', 'icon': '⚓', 'level': 24, 'score': 60,
         'weapons': ['wpn_spear_iron', 'wpn_sword_iron', 'wpn_bow_oak'], 'armor': LEATHER,
         'tint': {'shirt': '#c9d4d8', 'vest': '#2f5a7a', 'trousers': '#2a3440', 'lthr': '#4a3420'}},
        {'id': 'lamp', 'name': '등불 수호회', 'faction': 'lantern', 'color': '#d9a83a', 'icon': '🏮', 'level': 26, 'score': 62,
         'weapons': ['wpn_hammer_iron', 'wpn_sword_iron', 'wpn_battleaxe_iron'], 'armor': IRON,
         'tint': {'shirt': '#e8d8b0', 'vest': '#8a5a1a', 'trousers': '#3a2e22', 'lthr': '#5a3a1a'}},
        {'id': 'ledger', 'name': '푸른 기록회', 'faction': 'scholars', 'color': '#7a5ac0', 'icon': '📘', 'level': 30, 'score': 66,
         'weapons': ['wpn_staff_oak', 'wpn_bow_oak', 'wpn_spear_iron'], 'armor': LEATHER,
         'tint': {'shirt': '#d8d0e4', 'vest': '#4a3a6e', 'trousers': '#2e2a3a', 'lthr': '#3a2c40'}},
    ],
    # 전쟁 물자: 넣으면 공성 점수가 된다(물건 하나당)
    'supply': [
        {'stage': 'potion', 'points': 12, 'name': '물약'},
        {'stage': 'food', 'points': 6, 'name': '음식'},
        {'stage': 'ammo', 'points': 0.6, 'name': '화살'},
        {'item': 'stone_cut', 'points': 4, 'name': '다듬은 돌(성벽)'},
        {'item': 'lumber_oak', 'points': 3, 'name': '참나무 판재(공성 사다리)'},
        {'item': 'lumber_birch', 'points': 2, 'name': '자작나무 판재'},
        {'item': 'ingot_iron', 'points': 5, 'name': '철주괴(병장기)'},
        {'item': 'ingot_copper', 'points': 2, 'name': '구리주괴'},
        {'item': 'nails_copper', 'points': 1, 'name': '못'},
    ],
}
save('territory', terr)

cfg = load('config')
cfg['war'] = {
    'declareSilver': 800, 'prepDays': 1, 'siegeSec': 600, 'captureSec': 45, 'flagR': 7, 'nearR': 60,
    'baseDefenders': 6, 'defPerPoints': 60, 'maxDefenders': 14, 'baseAttackers': 6, 'attPerPoints': 60, 'maxAttackers': 14,
    'wave': 5, 'militiaPerPoints': 80, 'maxMilitia': 4, 'aiSupplyPerDay': 120, 'aiDeclareEvery': 4, 'aiWarChance': 0.5,
    'taxPerDay': 120, 'marketMult': 0.95, 'seedYield': 0.1, 'defendBonus': 1.15, 'cooldownDays': 2,
}
cfg['dataVersion'] = 32
save('config', cfg)

un = load('unlocks')
for u in un:
    if u['id'] == 'territory':
        u['soon'] = False
        u['desc'] = '조합으로 본섬 마을에 선전포고하고, 전쟁 물자를 모아 공성으로 영지를 차지한다(T)'
save('unlocks', un)

it = load('items')
IL = it if isinstance(it, list) else it['items']
for x in IL:
    if x['id'] == 'seed_territory':
        x['note'] = '심장이 돌봄의 대가로 내어 준 씨앗. 우리 조합 영지에 심으면 그 땅의 채집량이 10% 오른다.'
save('items', it)
print('ok')
