# v2.6 데이터: 필드 PvP·분쟁 구역·다른 세력 개척자
# 실행: python3 tools/data/v26_pvp.py (여러 번 돌려도 같은 결과)
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'data')
def load(f): return json.load(open(os.path.join(D, f + '.json')))
def save(f, d): open(os.path.join(D, f + '.json'), 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

# 분쟁 구역: 안개 늪·서리 설원·안개 폭풍 지대
rg = load('regions')
DISPUTED = {('swamp_shore', 'swamp'), ('ember_ridge', 'snow'), ('mist_heart', 'storm')}
for r in rg:
    for z in r.get('zones', []):
        if (r['id'], z['id']) in DISPUTED:
            z['disputed'] = True
            if '분쟁 구역' not in z['enter']:
                z['enter'] = z['enter'] + ' · 분쟁 구역: PvP가 켜진다'
save('regions', rg)

cfg = load('config')
cfg['pvp'] = {'dmgMult': 0.55, 'flagBonus': 0.1, 'disputedBonus': 0.1, 'minOnSec': 300, 'combatLockSec': 60,
              'cargoLoss': 0.25, 'honorPerKill': 10, 'killXpMult': 2.5, 'killInf': 25}
cfg['dataVersion'] = 31
save('config', cfg)

un = load('unlocks')
for u in un:
    if u['id'] == 'pvp':
        u['soon'] = False
        u['desc'] = '깃발을 켜면 다른 세력과 들판에서 겨룬다(채집·숙련 +10%). 분쟁 구역에선 늘 켜진다'
save('unlocks', un)

LEATHER = {'head': 'arm_leather_hood', 'chest': 'arm_leather_vest', 'legs': 'arm_leather_pants'}
CLOTH = {'head': 'arm_cloth_hood', 'chest': 'arm_robe', 'legs': 'arm_cloth_pants'}
IRON = {'head': 'arm_iron_helm', 'chest': 'arm_iron_cuirass', 'legs': 'arm_iron_greaves'}
rivals = {
    'respawnSec': 240, 'aggro': 16, 'leash': 42, 'fallSec': 2.5,
    'names': ['강도윤', '박서진', '최한결', '윤가람', '임도하', '한새봄', '오지후', '서이안', '신다온', '권하람', '배수호', '남궁 율',
              '정바다', '홍여름', '문태오', '조은결', '유시안', '황보 결', '김라온', '양하늘', '송누리', '안채운', '장마루', '구해솔'],
    'bands': [
        {'id': 'swamp', 'name': '자유 선단 사략꾼', 'region': 'swamp_shore', 'zone': 'swamp', 'faction': 'fleet', 'count': 3, 'level': 20, 'score': 55,
         'weapons': ['wpn_spear_iron', 'wpn_sword_copper', 'wpn_bow_birch'], 'armor': LEATHER, 'potions': 1, 'read': 0.35, 'silver': [30, 70],
         'tint': {'shirt': '#c9d4d8', 'vest': '#2f5a7a', 'trousers': '#2a3440', 'lthr': '#4a3420'}},
        {'id': 'snow', 'name': '안개 학회 탐사대', 'region': 'ember_ridge', 'zone': 'snow', 'faction': 'scholars', 'count': 3, 'level': 30, 'score': 65,
         'weapons': ['wpn_staff_oak', 'wpn_sword_iron', 'wpn_bow_oak'], 'armor': CLOTH, 'potions': 2, 'read': 0.45, 'silver': [50, 110],
         'tint': {'shirt': '#d8d0e4', 'vest': '#4a3a6e', 'trousers': '#2e2a3a', 'lthr': '#3a2c40'}},
        {'id': 'storm', 'name': '등불단 결사대', 'region': 'mist_heart', 'zone': 'storm', 'faction': 'lantern', 'count': 4, 'level': 42, 'score': 75,
         'weapons': ['wpn_hammer_iron', 'wpn_battleaxe_iron', 'wpn_sword_mist', 'wpn_spear_mist'], 'armor': IRON, 'potions': 2, 'read': 0.55, 'silver': [80, 160],
         'tint': {'shirt': '#e8d8b0', 'vest': '#8a5a1a', 'trousers': '#3a2e22', 'lthr': '#5a3a1a'}},
    ],
}
save('rivals', rivals)
print('ok')
