# v2.4 데이터: 생활 스킬 완성 — 낚시·약제·석공·장신구·공예
# 작업대 셋(약제대·석공대·공예대), 물고기 넷·달맞이풀, 물약 넷, 다듬은 돌·연마 보석, 장신구 여섯, 낚싯대 셋·화살 둘, 생선 요리 셋
# 실행: python3 tools/data/v24_crafts.py (여러 번 돌려도 같은 결과)
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'data')
def load(f): return json.load(open(os.path.join(D, f + '.json')))
def save(f, d): open(os.path.join(D, f + '.json'), 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

def upsert(L, x):
    for i, y in enumerate(L):
        if y['id'] == x['id']:
            L[i] = x
            return
    L.append(x)

# ── 스킬: 잠겨 있던 다섯을 연다 ──
sk = load('skills')
SL = sk['list'] if isinstance(sk, dict) else sk
for s in SL:
    if s['id'] in ('fishing', 'masonry', 'tinkering', 'jewelcraft', 'alchemy'):
        s.pop('opens', None)
save('skills', sk)

# ── 작업대 셋 ──
st = load('stations')
STL = st if isinstance(st, list) else st['list']
upsert(STL, {'id': 'alembic', 'name': '약제대', 'icon': '⚗️', 'r': 0.9, 'solid': [[0, 0, 0.5], [0.9, 0.1, 0.32]], 'work': [[0, 0.75, 0, 0]]})
upsert(STL, {'id': 'stonebench', 'name': '석공대', 'icon': '🧱', 'r': 1.0, 'solid': [[0, 0, 0.6], [1.0, 0.0, 0.4]], 'work': [[0, 0.85, 0, 0]]})
upsert(STL, {'id': 'tinkerbench', 'name': '공예대', 'icon': '⚙️', 'r': 0.9, 'solid': [[0, 0, 0.55], [-0.9, 0.1, 0.32]], 'work': [[0, 0.75, 0, 0]]})
save('stations', st)

# ── 물건 ──
it = load('items')
IL = it if isinstance(it, list) else it['items']
def I(x): upsert(IL, x)
# 낚시
for fid, name, tier, val in [('fish_small', '은빛 전어', 1, 6), ('fish_eel', '늪 뱀장어', 2, 14), ('fish_trout', '서리 송어', 3, 22), ('fish_glow', '안개 물고기', 3, 30)]:
    I({'id': fid, 'name': name, 'family': 'food', 'stage': 'raw', 'tier': tier, 'value': val, 'icon': '🐟'})
I({'id': 'herb_moon', 'name': '달맞이풀', 'family': 'herb', 'stage': 'raw', 'tier': 2, 'value': 16, 'icon': '🌼', 'note': '밤에만 핀다'})
# 생선 요리
I({'id': 'food_fish_grill', 'name': '전어 구이', 'kind': 'consumable', 'stage': 'food', 'tier': 1, 'value': 22, 'icon': '🐟', 'effect': 'heal', 'statConvert': {'heal': {'base': 26, 'per': 0.5, 'round': 0}}})
I({'id': 'food_eel', 'name': '장어 구이', 'kind': 'consumable', 'stage': 'food', 'tier': 2, 'value': 40, 'icon': '🍢', 'buff': 'gatherYield', 'statConvert': {'buff': {'base': 0.06, 'per': 0.0012, 'round': 3}, 'minutes': {'base': 14, 'per': 0.25, 'round': 0}}})
I({'id': 'food_fish_stew', 'name': '송어 매운탕', 'kind': 'consumable', 'stage': 'food', 'tier': 3, 'value': 60, 'icon': '🍲', 'effect': 'heal', 'statConvert': {'heal': {'base': 48, 'per': 0.8, 'round': 0}}})
# 물약(마시면 바로, 같은 물약 기운은 15초에 한 번)
I({'id': 'potion_heal', 'name': '회복 물약', 'kind': 'consumable', 'stage': 'potion', 'tier': 2, 'value': 45, 'icon': '🧪', 'potion': 'heal', 'statConvert': {'power': {'base': 0.3, 'per': 0.003, 'round': 3}}})
I({'id': 'potion_stamina', 'name': '기력 물약', 'kind': 'consumable', 'stage': 'potion', 'tier': 1, 'value': 30, 'icon': '🧪', 'potion': 'stamina', 'statConvert': {'power': {'base': 0.4, 'per': 0.004, 'round': 3}, 'sec': {'base': 60, 'per': 0.6, 'round': 0}}})
I({'id': 'potion_mana', 'name': '마나 물약', 'kind': 'consumable', 'stage': 'potion', 'tier': 2, 'value': 45, 'icon': '🧪', 'potion': 'mana', 'statConvert': {'power': {'base': 0.4, 'per': 0.004, 'round': 3}}})
I({'id': 'potion_guard', 'name': '강건 물약', 'kind': 'consumable', 'stage': 'potion', 'tier': 3, 'value': 70, 'icon': '🧪', 'potion': 'guard', 'statConvert': {'power': {'base': 0.08, 'per': 0.0008, 'round': 3}, 'sec': {'base': 90, 'per': 0.9, 'round': 0}}})
# 석공
I({'id': 'stone_cut', 'name': '다듬은 돌', 'family': 'stone', 'stage': 'refined', 'tier': 1, 'value': 18, 'icon': '🧱'})
I({'id': 'gem_cut', 'name': '연마 보석', 'stage': 'refined', 'tier': 2, 'value': 150, 'icon': '💎'})
I({'id': 'furn_stone_lamp', 'name': '석등', 'kind': 'equipment', 'stage': 'furniture', 'tier': 2, 'value': 220, 'icon': '🏮',
   'statConvert': {'comfort': {'base': 11, 'per': 0.5, 'round': 0}, 'durability': {'base': 200, 'per': 4, 'round': 0}}})
I({'id': 'furn_hearth', 'name': '돌 화덕', 'kind': 'equipment', 'stage': 'furniture', 'tier': 2, 'value': 260, 'icon': '🔥',
   'statConvert': {'comfort': {'base': 13, 'per': 0.5, 'round': 0}, 'durability': {'base': 220, 'per': 4, 'round': 0}}})
# 장신구: jewel.slot(ring·neck), jewel.attr(능력치) 또는 jewel.gather(채집량)
JW = [
    ('ring_copper_str', '구리 힘 반지', 'ring', 'str', 1, 'ingot_copper'), ('ring_copper_dex', '구리 민첩 반지', 'ring', 'dex', 1, 'ingot_copper'),
    ('ring_iron_foc', '철 집중 반지', 'ring', 'foc', 2, 'ingot_iron'), ('neck_iron_int', '철 지혜 목걸이', 'neck', 'int', 2, 'ingot_iron'),
    ('neck_iron_con', '철 체질 목걸이', 'neck', 'con', 2, 'ingot_iron'), ('neck_gather', '채집꾼 목걸이', 'neck', None, 2, 'ingot_iron'),
]
for jid, name, slot, attr, tier, metal in JW:
    sc = {'durability': {'base': 200 + 80 * tier, 'per': 4, 'round': 0}}
    if attr:
        sc['attr'] = {'base': 1 + tier, 'per': 0.03, 'round': 0}
    else:
        sc['gather'] = {'base': 0.03, 'per': 0.0006, 'round': 3}
    I({'id': jid, 'name': name, 'kind': 'equipment', 'stage': 'jewel', 'tier': tier, 'value': 200 + 160 * tier, 'icon': '💍' if slot == 'ring' else '📿',
       'jewel': {'slot': slot, **({'attr': attr} if attr else {'gather': True})}, 'statConvert': sc, 'weight': 0.1})
# 공예: 낚싯대·화살
for rid, name, tier, val in [('tool_rod_wood', '나무 낚싯대', 1, 40), ('tool_rod_copper', '구리 낚싯대', 2, 200), ('tool_rod_iron', '철 낚싯대', 3, 420)]:
    I({'id': rid, 'name': name, 'kind': 'equipment', 'stage': 'tool', 'tier': tier, 'value': val, 'icon': '🎣', 'tool': {'skill': 'fishing', 'tier': tier},
       'statConvert': {'gatherSpeed': {'base': 1, 'per': 0.0045, 'round': 2}, 'yield': {'base': 0, 'per': 0.002, 'round': 3, 'max': 0.3}, 'durability': {'base': 120 + 40 * tier, 'per': 5, 'round': 0}}, 'weight': 0.8})
I({'id': 'arrows_copper', 'name': '구리 화살', 'family': 'wood', 'stage': 'ammo', 'tier': 1, 'value': 2, 'icon': '➶', 'ammo': {'dmg': 0.12}})
I({'id': 'arrows_iron', 'name': '철 화살', 'family': 'wood', 'stage': 'ammo', 'tier': 2, 'value': 4, 'icon': '➶', 'ammo': {'dmg': 0.22}})
save('items', it)

# ── 제작법 ──
rc = load('recipes')
RL = rc if isinstance(rc, list) else rc['recipes']
def RC(x): upsert(RL, x)
def craft(id, name, skill, level, station, slots, stats, out, sec, xp, tier=1):
    return {'id': id, 'type': 'craft', 'name': name, 'skill': skill, 'level': level, 'station': station, 'stationTier': 1, 'slots': slots, 'stats': stats, 'output': {'item': out, 'qty': 1}, 'seconds': sec, 'xp': xp}
def refine(id, name, skill, level, station, slots, out, qty, sec, xp, tier=1):
    return {'id': id, 'type': 'refine', 'name': name, 'skill': skill, 'level': level, 'station': station, 'stationTier': 1, 'slots': slots, 'output': {'item': out, 'qty': qty}, 'seconds': sec, 'xp': xp}
S = lambda key, item, qty: {'key': key, 'item': item, 'qty': qty}
SF = lambda key, fam, stage, qty: {'key': key, 'family': fam, 'stage': stage, 'qty': qty}
# 공예
RC(craft('rc_rod_wood', '나무 낚싯대', 'tinkering', 1, 'hand', [SF('rod', 'wood', 'refined', 1), S('line', 'fiber_reed', 3)], {'gatherSpeed': {'rod.flex': 0.6, 'line.tenacity': 0.4}, 'durability': {'rod.strength': 0.7, 'line.tenacity': 0.3}}, 'tool_rod_wood', 6, 20))
RC(craft('rc_rod_copper', '구리 낚싯대', 'tinkering', 10, 'tinkerbench', [S('rod', 'lumber_birch', 2), S('reel', 'ingot_copper', 1), S('line', 'cloth_reed', 1)], {'gatherSpeed': {'rod.flex': 0.5, 'reel.hardness': 0.2, 'line.tenacity': 0.3}, 'durability': {'rod.strength': 0.5, 'reel.toughness': 0.5}}, 'tool_rod_copper', 9, 55))
RC(craft('rc_rod_iron', '철 낚싯대', 'tinkering', 22, 'tinkerbench', [S('rod', 'lumber_oak', 2), S('reel', 'ingot_iron', 1), S('line', 'cloth_reed', 2)], {'gatherSpeed': {'rod.flex': 0.5, 'reel.hardness': 0.2, 'line.tenacity': 0.3}, 'durability': {'rod.strength': 0.5, 'reel.toughness': 0.5}}, 'tool_rod_iron', 12, 95, 2))
RC(refine('rc_arrows_copper', '구리 화살', 'tinkering', 6, 'tinkerbench', [SF('shaft', 'wood', 'refined', 1), S('head', 'ingot_copper', 1)], 'arrows_copper', 20, 6, 24))
RC(refine('rc_arrows_iron', '철 화살', 'tinkering', 20, 'tinkerbench', [SF('shaft', 'wood', 'refined', 1), S('head', 'ingot_iron', 1)], 'arrows_iron', 20, 7, 40, 2))
# 석공·장신구
RC(refine('rc_stone_cut', '돌 다듬기', 'masonry', 1, 'stonebench', [S('main', 'stone', 4)], 'stone_cut', 1, 5, 12))
RC(refine('rc_gem_cut', '원석 연마', 'masonry', 14, 'stonebench', [S('main', 'gem_rough', 1), S('grit', 'sand_fine', 2)], 'gem_cut', 1, 8, 40))
RC(craft('rc_stone_lamp', '석등', 'masonry', 8, 'stonebench', [S('body', 'stone_cut', 6), S('wick', 'fiber_reed', 2)], {'comfort': {'body.density': 0.6, 'wick.tenacity': 0.4}, 'durability': {'body.density': 0.7, 'body.grain': 0.3}}, 'furn_stone_lamp', 12, 60))
RC(craft('rc_hearth', '돌 화덕', 'masonry', 16, 'stonebench', [S('body', 'stone_cut', 10), S('grate', 'ingot_iron', 1)], {'comfort': {'body.density': 0.6, 'grate.hardness': 0.4}, 'durability': {'body.grain': 0.6, 'grate.toughness': 0.4}}, 'furn_hearth', 15, 90, 2))
for jid, name, slot, attr, tier, metal in JW:
    lvl = 6 if tier == 1 else 20
    RC(craft('rc_' + jid, name, 'jewelcraft', lvl + (4 if not attr else 0), 'stonebench', [S('band', metal, 2), S('gem', 'gem_cut', 1)],
             {('attr' if attr else 'gather'): {'band.hardness': 0.5, 'band.toughness': 0.5}, 'durability': {'band.toughness': 1.0}},
             jid, 12, 70 + 30 * tier, tier))
# 약제
RC(craft('rc_potion_stamina', '기력 물약', 'alchemy', 1, 'alembic', [S('base', 'sap_birch', 1), S('herb', 'berry', 3)], {'power': {'herb.nutrition': 1.0}, 'sec': {'herb.flavor': 1.0}}, 'potion_stamina', 6, 18))
RC(craft('rc_potion_heal', '회복 물약', 'alchemy', 8, 'alembic', [S('base', 'sap_birch', 1), S('herb', 'herb_moon', 1), S('body', 'mushroom', 2)], {'power': {'herb.potency': 0.6, 'body.nutrition': 0.4}}, 'potion_heal', 7, 30))
RC(craft('rc_potion_mana', '마나 물약', 'alchemy', 14, 'alembic', [S('base', 'sap_birch', 1), S('herb', 'herb_moon', 2), S('dust', 'gem_rough', 1)], {'power': {'herb.potency': 1.0}}, 'potion_mana', 8, 42))
RC(craft('rc_potion_guard', '강건 물약', 'alchemy', 22, 'alembic', [S('herb', 'herb_moon', 2), S('body', 'fish_eel', 1), S('grit', 'stone_cut', 1)], {'power': {'herb.potency': 0.5, 'body.nutrition': 0.5}, 'sec': {'herb.duration': 1.0}}, 'potion_guard', 9, 60, 2))
# 생선 요리
RC(craft('rc_fish_grill', '전어 구이', 'cooking', 2, 'kitchen', [S('main', 'fish_small', 2)], {'heal': {'main.nutrition': 1.0}}, 'food_fish_grill', 5, 14))
RC(craft('rc_eel', '장어 구이', 'cooking', 12, 'kitchen', [S('main', 'fish_eel', 2), S('side', 'sap_birch', 1)], {'buff': {'main.nutrition': 1.0}, 'minutes': {'main.flavor': 1.0}}, 'food_eel', 6, 30))
RC(craft('rc_fish_stew', '송어 매운탕', 'cooking', 22, 'kitchen', [S('main', 'fish_trout', 2), S('side', 'mushroom', 2), S('herb', 'herb_moon', 1)], {'heal': {'main.nutrition': 0.6, 'side.nutrition': 0.2, 'herb.potency': 0.2}}, 'food_fish_stew', 8, 50, 2))
save('recipes', rc)

# ── 채집 노드: 물고기 떼 넷(낚싯대가 있어야 한다), 달맞이풀(밤에만) ──
nd = load('nodes')
NL = nd if isinstance(nd, list) else nd['list']
FISH = [('node_fish', '물고기 떼', '전어', 'fish_small', 1, 1), ('node_fish_eel', '뱀장어 굴', '뱀장어', 'fish_eel', 10, 2), ('node_fish_trout', '송어 여울', '송어', 'fish_trout', 20, 3), ('node_fish_glow', '빛나는 물고기 떼', '안개 물고기', 'fish_glow', 28, 3)]
for nid, name, label, item, lvl, tier in FISH:
    upsert(NL, {'id': nid, 'name': name, 'label': label, 'skill': 'fishing', 'level': lvl, 'tier': tier, 'item': item, 'yield': [1, 2], 'charges': [3, 5], 'seconds': 5,
                'respawnSec': 480, 'xp': 10 + lvl, 'byproducts': [], 'habitat': [-0.75, -0.12], 'solid': 0, 'shore': [-4, 0.5], 'work': 2.6, 'anim': 'harvest'})
upsert(NL, {'id': 'node_moonherb', 'name': '달맞이풀 무리', 'label': '달맞이풀', 'skill': 'harvesting', 'level': 10, 'tier': 1, 'item': 'herb_moon', 'yield': [1, 2], 'charges': [2, 3],
            'seconds': 3, 'respawnSec': 600, 'xp': 18, 'byproducts': [], 'habitat': [2, 16], 'solid': 0, 'work': 0.7, 'anim': 'pick_ground', 'night': True})
save('nodes', nd)

# ── 지역 산지 ──
rg = load('regions')
ADD = {
    'wreck_coast': [('node_fish', 8, [3, 6]), ('node_moonherb', 6, [3, 6])],
    'swamp_shore': [('node_fish', 8, [3, 6]), ('node_fish_eel', 8, [3, 6]), ('node_moonherb', 10, [3, 6])],
    'ember_ridge': [('node_fish_trout', 8, [3, 6]), ('node_moonherb', 6, [3, 6])],
    'mist_heart': [('node_fish_glow', 8, [3, 6]), ('node_moonherb', 8, [3, 6])],
}
for r in rg:
    for node, common, cluster in ADD.get(r['id'], []):
        if not any(v['node'] == node for v in r['veins']):
            r['veins'].append({'node': node, 'common': common, 'cluster': cluster, 'rotating': 0})
save('regions', rg)
cfg = load('config'); cfg['dataVersion'] = 29; cfg.setdefault('combat', {})['potionCd'] = 15; save('config', cfg)
print('ok')
