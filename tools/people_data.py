# v1.4 사람들의 섬 데이터를 넣은 스크립트(기록용, 이미 data에 들어가 있다)
import json, copy
D = '/home/claude/mist-isle/data/'
def load(f): return json.load(open(D + f + '.json'))
def pretty(f, d): open(D + f + '.json', 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

rg = load('regions')
R = {r['id']: r for r in rg}
S = lambda t, dx, dz, rot=0: {'type': t, 'dx': dx, 'dz': dz, 'rot': rot}
K = lambda k, dx, dz, r, rot=0: {'kind': k, 'dx': dx, 'dz': dz, 'r': r, 'rot': rot}

# ── 새 마을 ──
NEW_TOWNS = {
    'wreck_coast': {'id': 's_gull', 'name': '갈매기 포구', 'x': 330, 'z': 105, 'radius': 15, 'flat': 'local', 'pop': 8, 'cap': 12,
                    'stations': [S('storage', -1, -8), S('kitchen', 7, -5, -2.4), S('workbench', -8, 4, 1.4)],
                    'structures': [K('board', 3, -3, 0.5), K('campfire', 0, 2, 0.7), K('cabin', -12, -9, 2.6, 0.8), K('cabin', 12, 9, 2.6, -2.3),
                                   K('house', 0, 13, 3.2, 3.14), K('crates', 10, -10, 0.8, 0.3), K('tent', -12, 10, 1.9, 2.2)]},
    'swamp_shore': {'id': 's_willow', 'name': '버들 여울', 'x': 1090, 'z': 200, 'radius': 16, 'flat': 'local', 'pop': 9, 'cap': 13,
                    'stations': [S('storage', -1, -9), S('kitchen', 8, -5, -2.4), S('loom', -9, -3, 1.5), S('tannery', -9, 6, 1.6), S('workbench', 9, 5, -1.6)],
                    'structures': [K('board', 3, -3, 0.5), K('campfire', 0, 2, 0.7), K('house', -13, -12, 3.2, 0.7), K('house', 13, -12, 3.2, -0.7),
                                   K('cabin', 0, 14, 2.6, 3.14), K('cabin', -14, 13, 2.6, 2.4), K('crates', 14, 12, 0.8, 0.6)]},
    'ember_ridge': {'id': 's_kiln', 'name': '숯가마 마을', 'x': 2330, 'z': 100, 'radius': 15, 'flat': 'local', 'pop': 7, 'cap': 11,
                    'stations': [S('storage', -1, -8), S('kitchen', 7, -5, -2.4), S('smelter', -9, 2, 1.5), S('forge', 8, 6, -2.2)],
                    'structures': [K('board', 3, -3, 0.5), K('campfire', 0, 2, 0.7), K('cabin', -12, -10, 2.6, 0.8), K('cabin', 0, 13, 2.6, 3.14),
                                   K('tent', 13, -9, 1.9, -0.8), K('tent', -13, 10, 1.9, 2.2), K('crates', 12, 12, 0.8, 0.2)]},
}
for rid, t in NEW_TOWNS.items():
    if not any(s['id'] == t['id'] for s in R[rid]['settlements']):
        R[rid]['settlements'].append(t)

# ── NPC가 머무는 곳(무리 없는 자리) ──
NEW_SITES = {
    'wreck_coast': [
        {'id': 'hermit_hut', 'name': '솔바람 오두막', 'x': 60, 'z': 300, 'r': 9, 'flat': 'local',
         'structures': [K('cabin', 0, 5, 2.6, 3.14), K('campfire', 0, -1.5, 0.7), K('crates', 4, 3, 0.8, 0.4), K('altar', -4, 2, 0.8, 0.6)]},
        {'id': 'fish_rock', 'name': '바위 낚시터', 'beach': [110, 3.5], 'r': 7,
         'structures': [K('tent', -3, 3, 1.9, 2.6), K('crates', 3, 2, 0.8, 0.3), K('campfire', 0, -1, 0.7)]},
    ],
    'swamp_shore': [
        {'id': 'ferry_inn', 'name': '물레방아 주막', 'x': 1268, 'z': 118, 'r': 11, 'flat': 'local',
         'structures': [K('house', 0, 6, 3.2, 3.14), K('campfire', -3, -2, 0.7), K('crates', 6, 2, 0.8, 0.5), K('banner', -7, -3, 0.25, 0),
                        K('tent', 7, -5, 1.9, -0.6)]},
        {'id': 'hunter_lodge', 'name': '사냥꾼 쉼터', 'x': 1420, 'z': 300, 'r': 10, 'flat': 'local',
         'structures': [K('cabin', 0, 5, 2.6, 3.14), K('campfire', 0, -1.5, 0.7), K('tent_red', -6, 0, 1.9, 1.6), K('crates', 6, 1, 0.8, 0.2)]},
    ],
    'ember_ridge': [
        {'id': 'miner_camp', 'name': '광부 굴막', 'x': 2080, 'z': 200, 'r': 10, 'flat': 'local',
         'structures': [K('tent', -5, 4, 1.9, 2.4), K('tent', 5, 4, 1.9, -2.4), K('campfire', 0, -1, 0.7), K('crates', 7, -3, 0.8, 0.4), K('rubble', -7, -4, 0, 0.3)]},
    ],
    'mist_heart': [
        {'id': 'pilgrim_cairn', 'name': '순례자 돌무지', 'x': 3100, 'z': 300, 'r': 9, 'flat': 'local',
         'structures': [K('altar', 0, 4, 0.8, 3.14), K('pillar_broken', -4, 4, 0.6, 0.4), K('pillar_broken', 4, 4, 0.6, 2.4), K('tent_white', -5, -3, 1.9, 1.2),
                        K('campfire', 1, -1.5, 0.7)]},
    ],
}
for rid, sites in NEW_SITES.items():
    have = {s['id'] for s in R[rid]['sites']}
    for s in sites:
        if s['id'] not in have:
            R[rid]['sites'].append(s)
pretty('regions', rg)

# ── 마을 사람 ──
def look(body, seed, **kw):
    lk = {'body': body, 'seed': seed, 'chest': kw.pop('chest', 'light'), 'legs': kw.pop('legs', 'light')}
    if 'head' in kw: lk['head'] = kw.pop('head')
    if 'weapon' in kw: lk['weapon'] = kw.pop('weapon')
    lk['tint'] = kw
    return lk

def N(id, name, title, where, dx, dz, yaw, lk, chat):
    n = {'id': id, 'name': name, 'title': title, 'dx': dx, 'dz': dz, 'yaw': yaw, 'look': lk, 'chat': chat}
    n['at' if where.startswith('s_') else 'site'] = where
    return n

NPCS = [
    # 등대 마을
    N('seondeok', '순덕', '생선 장수', 's_lighthouse', -9, 6, 1.2, look('f', 101, chest='robe', robe='#6a5a48', sash='#c87a3a', shirt='#e0d6c0', trousers='#3a342c'),
      ['오늘 고등어는 눈이 맑아. 살 거면 지금 사.', '검은 돛이 사라진 뒤로 장이 좀 서는구먼.']),
    N('makdong', '막동', '견습 선원', 's_lighthouse', 11, 4, -1.4, look('m', 102, shirt='#c8c0a8', vest='#4a5a6a', trousers='#3a3a3a', scarf='#a83a2a'),
      ['배만 있으면 당장이라도 바다로 나갈 텐데요.', '강두 대장님은 무섭지만 노는 잘 저어요.']),
    # 숲머리
    N('soli', '솔이', '약초꾼', 's_forest', -10, -4, 1.0, look('f', 103, chest='robe', head='robe', robe='#4a6a3a', sash='#c8b070', hood='#3e5a32', shirt='#d8d0b8', trousers='#3a3228'),
      ['버섯은 그늘진 참나무 밑에 숨어 있어요.', '산딸기는 볕 드는 덤불이 제일 달아요.']),
    N('gombo', '곰보 영감', '나무꾼', 's_forest', 11, -7, -1.0, look('m', 104, shirt='#a8a090', vest='#5a4630', trousers='#3a3026', lthr='#4a3420', weapon='wpn_battleaxe_copper'),
      ['나무는 베는 만큼 심어야 하는 법이여.', '요새 밤마다 늑대 우는 소리가 가까워.']),
    # 갈매기 포구(새 마을)
    N('jogae', '조개댁', '어부', 's_gull', -6, -4, 0.6, look('f', 105, shirt='#d0c8b0', vest='#3a5a6a', trousers='#2e3a44', scarf='#d8b048'),
      ['포구 이름이 갈매기인 건, 갈매기가 우리보다 먼저 와 살았기 때문이지.', '그물만 성하면 굶을 일은 없어.']),
    N('noseon', '노 선장', '물러난 뱃사람', 's_gull', 6, 5, -2.2, look('m', 106, chest='heavy', shirt='#d8d4c8', vest='#2a3a4a', trousers='#2a2e36', scarf='#8a8f98'),
      ['마흔 해를 바다에서 살았지. 이젠 파도 소리만 들어도 날씨를 알아.', '내 배 「물수리」가 이 근처에서 가라앉았어.']),
    N('baram', '바람', '그물 짓는 이', 's_gull', -4, 8, 2.6, look('f', 107, chest='robe', robe='#5a6a7a', sash='#a8c0c8', shirt='#e0dcd0', trousers='#34383e'),
      ['갈대를 꼬아 줄을 만들고, 줄을 엮어 그물을 만들지.', '바닷바람이 그물을 금방 삭게 해.']),
    # 솔바람 오두막·바위 낚시터
    N('cheongun', '청운', '숲의 은자', 'hermit_hut', 2, -3, 0.2, look('m', 108, chest='robe', head='robe', robe='#5a5248', sash='#8a7a5a', hood='#4a443a', shirt='#c8c0ac', trousers='#3a362e'),
      ['숲은 말이 없지만 다 기억하네.', '밤에 오래된 등불터 쪽에서 우는 것들이 있지.']),
    N('darae', '다래', '낚시꾼', 'fish_rock', 2, -2, -0.4, look('f', 109, shirt='#c8b898', vest='#6a5038', trousers='#3a3428', scarf='#5a8a6a'),
      ['물고기는 기다리는 사람한테만 와.', '고기 굽는 냄새는 멧돼지 고기가 제일이지.']),
    # 갈대 나루
    N('doseon', '도선', '뱃사공', 's_port', -12, 4, 1.3, look('m', 110, shirt='#b8b098', vest='#3a4a3a', trousers='#2e3228', scarf='#6a8aa8'),
      ['나루에서 느티골까지 물길로 반나절이면 가.', '물안개 사람들은 배를 잘 안 타. 늪이 길이라 그런가.']),
    N('pal', '팔복', '장꾼', 's_port', 13, -2, -1.6, look('m', 111, shirt='#d0c4a8', vest='#7a4a2a', trousers='#3a302a', scarf='#c8a050'),
      ['싸게 사서 비싸게 판다. 장사는 그게 다야.', '함대가 물러가니 물건이 다시 돈다니까.']),
    # 느티골
    N('okhwa', '옥화', '느티골 촌장', 's_valley', -8, -8, 0.7, look('f', 112, chest='robe', robe='#7a5a3a', sash='#d8b060', shirt='#e8e0cc', trousers='#3a3228'),
      ['느티나무가 마을을 지켜 준다고들 하지.', '밭이 넓어지니 멧돼지가 먼저 알고 오는구먼.']),
    N('hansol', '한솔', '목수', 's_valley', 9, 8, -2.4, look('m', 113, shirt='#c8b490', vest='#6a5236', trousers='#3a3026', lthr='#4a3420'),
      ['나무는 결을 따라 켜야 안 터져요.', '개울 건너는 다리가 삐걱대서 큰일이에요.']),
    N('ggul', '꿀벌댁', '양봉가', 's_valley', 4, -11, -0.3, look('f', 114, shirt='#e0d098', vest='#8a6a2a', trousers='#4a3a28', scarf='#e0b030'),
      ['벌이 들꽃을 찾아가는 길이 곧 계절이야.', '꿀은 아침 일찍 떠야 맑아.']),
    # 버들 여울(새 마을)
    N('beodeul', '버들 할매', '여울 어른', 's_willow', -5, -5, 0.7, look('f', 115, chest='robe', head='robe', robe='#5a6a4a', sash='#a8b080', hood='#4a5a3e', shirt='#d8d4c0', trousers='#3a3a30'),
      ['여울물 소리가 바뀌면 손님이 오는 게야.', '물안개 사람들과는 오래 이웃이었지.']),
    N('jaegan', '재간', '대장장이', 's_willow', 7, 8, -2.2, look('m', 116, chest='heavy', shirt='#a89880', vest='#3a3028', trousers='#2e2a26', lthr='#3a2818'),
      ['쇠는 거짓말을 안 해. 두드린 만큼 단단해지지.', '구리가 모자라서 못도 제대로 못 쳐.']),
    N('miru', '미루', '물들이는 이', 's_willow', -11, 3, 1.6, look('f', 117, chest='robe', robe='#8a3a5a', sash='#d8a8c0', shirt='#e8dcd8', trousers='#3a2e36'),
      ['산딸기를 끓이면 고운 붉은빛이 나요.', '갈대 천에 물을 들이면 늪 사람들도 좋아해요.']),
    # 물레방아 주막·사냥꾼 쉼터
    N('jumo', '금순', '주막 주모', 'ferry_inn', -1, 1, 0.1, look('f', 118, chest='robe', robe='#7a4a3a', sash='#e0c080', shirt='#ece4d4', trousers='#3a302a'),
      ['국밥 한 그릇에 나루 소식 한 숟갈 얹어 줄게.', '뱃사람, 사냥꾼, 학자 양반… 여긴 다 모여.']),
    N('aksa', '소리', '떠돌이 악사', 'ferry_inn', 4, -3, -1.0, look('m', 119, shirt='#d8c8a8', vest='#3a4a6a', trousers='#2e3040', scarf='#c84a4a'),
      ['노래는 길에서 주워 길에 두고 가는 거요.', '물안개 사람들 노래는 늪 냄새가 나지.']),
    N('beomdol', '범돌', '늙은 사냥꾼', 'hunter_lodge', -2, -3, 0.3, look('m', 120, shirt='#8a7a5a', vest='#5a4028', trousers='#3a3020', lthr='#4a3018', weapon='wpn_spear_copper'),
      ['짐승은 발자국보다 냄새를 먼저 남기지.', '여울이 아비 여강하곤 같이 사냥을 다녔어.']),
    N('nallae', '날래', '사냥꾼', 'hunter_lodge', 4, -2, -0.6, look('f', 121, shirt='#9a8a6a', vest='#4a5a3a', trousers='#2e3226', lthr='#3a2a18', weapon='wpn_spear_copper'),
      ['안개 늑대는 무리 우두머리부터 끊어야 해요.', '범돌 어른 잔소리는 반만 들으면 돼요.']),
    # 잿고개·숯가마 마을(새)·광부 굴막
    N('seoksu', '석수', '잿고개 광부', 's_ash', 9, -9, -1.0, look('m', 122, shirt='#8a8478', vest='#3a3430', trousers='#2a2826', lthr='#2a2018'),
      ['잿빛 비탈 밑엔 좋은 구리가 숨어 있어.', '늑대가 굴 앞까지 내려와서 일을 못 해.']),
    N('musoe', '무쇠', '숯가마 주인', 's_kiln', -5, -5, 0.6, look('m', 123, chest='heavy', shirt='#7a7068', vest='#2a2622', trousers='#2a2624', lthr='#2a1e14'),
      ['좋은 숯은 참나무에서 나와. 여긴 참나무가 없어 탈이지.', '불은 사흘 밤낮을 지켜야 숯이 돼.']),
    N('danbi', '단비', '숯가마 약사', 's_kiln', 6, 6, -2.3, look('f', 124, chest='robe', robe='#3a5a6a', sash='#a8d0d8', shirt='#e0e4e4', trousers='#2e343a'),
      ['서리 늑대 가죽은 동상에 좋아요.', '숯 연기에 기침하는 사람이 많아서 약이 늘 모자라요.']),
    N('gangjang', '갱장', '광부 우두머리', 'miner_camp', 0, -3, 0.0, look('m', 125, chest='heavy', shirt='#9a9080', vest='#4a3a2a', trousers='#2e2a24', lthr='#3a2818', weapon='wpn_hammer_copper'),
      ['굴은 산의 혈관이야. 함부로 파면 산이 앓지.', '함대 수병들이 굴 입구를 막고 쇠를 실어 갔어.']),
    # 심장 문 야영지·순례자 돌무지
    N('boreum', '보름', '야영지 요리사', 's_gate', 6, 6, -2.3, look('f', 126, shirt='#d8cca8', vest='#6a4a3a', trousers='#3a302a', scarf='#d89a3a'),
      ['심장 앞에서도 배는 고파요.', '여기 물은 이상하게 달아요. 영맥 탓일까요.']),
    N('suryeon', '수련', '순례자', 'pilgrim_cairn', 2, -3, 0.2, look('f', 127, chest='robe', head='robe', robe='#d8d4c8', sash='#8aa0c8', hood='#c8c4b8', shirt='#ece8e0', trousers='#5a5a64'),
      ['첫 등지기는 돌무지 하나하나에 이름을 새겼대요.', '심장은 무서운 게 아니에요. 아픈 거예요.']),
]
npcs = load('npcs'); have = {n['id'] for n in npcs}
npcs += [n for n in NPCS if n['id'] not in have]
pretty('npcs', npcs)

# ── 부가 퀘스트 ──
def take(npc, text, need, say, reply='여기 있습니다'):
    return {'type': 'talk', 'npc': npc, 'text': text, 'take': need, 'say': say, 'reply': reply}
def tk(npc, text, say, reply='알겠습니다'):
    return {'type': 'talk', 'npc': npc, 'text': text, 'say': say, 'reply': reply}
def kill(mobs, n, text):
    return {'type': 'kill', 'mobs': mobs, 'count': n, 'text': text}
def SQ(id, giver, name, summary, req, steps, silver, items=None):
    q = {'id': id, 'kind': 'side', 'giver': giver, 'requires': req, 'name': name, 'summary': summary, 'steps': steps, 'reward': {'silver': silver}}
    if items: q['reward']['items'] = [{'item': i, 'qty': n} for i, n in items]
    return q

SIDE = [
    # 등대섬
    SQ('sq_lh_fish', 'seondeok', '저녁 찬거리', '순덕이 국에 넣을 미역을 찾는다. 바닷가 바위에 붙은 걸 따 오면 된다.', ['q2_chest'],
       [take('seondeok', '순덕에게 미역 4 건네기', {'seaweed': 4}, ['이 정도면 한 솥 끓이겠네.', '국 끓으면 한 그릇 떠 줄 테니 들고 가.'])], 40, [('food_soup', 2)]),
    SQ('sq_lh_drift', 'makdong', '등대 땔감', '막동이 등대 불 지킬 땔감을 모은다. 마른 표류목이 필요하다.', ['q1_ashore'],
       [take('makdong', '막동에게 표류목 6 건네기', {'log_drift': 6}, ['우와, 이거면 사흘은 버티겠어요!', '해림 할머니한테 칭찬받겠다.'], '보태 줄게')], 30),
    SQ('sq_fo_mush', 'soli', '버섯 바구니', '솔이가 약을 지을 버섯을 찾는다.', ['q4_forest'],
       [take('soli', '솔이에게 버섯 5 건네기', {'mushroom': 5}, ['향이 좋네요. 그늘에서 잘 자란 거예요.', '이건 고마움의 표시예요. 산딸기 말랭이, 걷다가 드세요.'])], 50, [('food_berry', 2)]),
    SQ('sq_fo_wolves', 'gombo', '늑대 울음', '곰보 영감네 나무터에 늑대가 내려온다.', ['q4_forest'],
       [kill(['wolf'], 4, '숲의 늑대 4마리 쫓아내기'), tk('gombo', '곰보 영감에게 알리기', ['허허, 이제 좀 조용하겠구먼.', '고마운 김에 하나 일러 주지. 참나무는 북쪽 숲이 제일 곧아.'])], 70),
    SQ('sq_gu_crab', 'jogae', '그물 끊는 놈들', '갈매기 포구 그물을 해안 게들이 끊어 놓는다.', ['q2_chest'],
       [kill(['crab'], 6, '해안 게 6마리 잡기'), tk('jogae', '조개댁에게 알리기', ['그물이 성하니 내일은 만선이겠어.', '국 한 솥 끓였어. 가져가.'])], 45, [('food_soup', 2)]),
    SQ('sq_gu_log', 'noseon', '빛바랜 항해일지', '노 선장의 옛 배 「물수리」가 남쪽 작은 만에 가라앉았다. 무엇이 남았는지 보고 와 달라 한다.', ['q2_chest'],
       [{'type': 'go', 'site': 'cove', 'text': '남쪽 작은 만에 가 보기'},
        tk('noseon', '노 선장에게 본 것 전하기', ['…돛대 끝이 아직 물 위에 있더라고? 그 녀석, 끝까지 버티는구먼.', '고맙네. 마흔 해 동안 묻어 둔 걸 이제야 내려놓겠어.'], '편히 쉬세요')], 60),
    SQ('sq_gu_net', 'baram', '새 그물', '바람이 새 그물을 엮을 갈대와 갈대 천을 모은다.', ['q4_forest'],
       [take('baram', '바람에게 갈대 8·갈대 천 2 건네기', {'fiber_reed': 8, 'cloth_reed': 2}, ['이거면 그물 두 채는 엮겠어.', '포구 사람들이 고마워할 거야.'])], 80),
    SQ('sq_he_spirit', 'cheongun', '숲의 망령', '청운이 밤마다 숲에서 우는 망령을 잠재워 달라 한다. 망령은 밤에만 나온다.', ['c2_ruins'],
       [kill(['mist_wraith'], 3, '밤에 안개 망령 3 잠재우기'), tk('cheongun', '청운에게 돌아가기', ['조용해졌구먼. 저것들도 원래는 길 잃은 넋이었네.', '이 돌을 가져가게. 숲이 준 게야.'], '감사합니다')], 120, [('gem_rough', 1)]),
    SQ('sq_fi_boar', 'darae', '멧돼지 고기', '다래가 낚시터 사람들과 나눌 고기를 구한다.', ['q5_supplies'],
       [take('darae', '다래에게 날고기 3 건네기', {'meat_raw': 3}, ['오늘 밤은 낚시터에서 잔치네!', '구운 걸로 하나 챙겨 가.'])], 60, [('food_meat', 1)]),
    # 본섬 늪 기슭
    SQ('sq_po_errand', 'doseon', '느티골 편지', '도선이 느티골 촌장 옥화에게 소식을 전해 달라 한다. 다리를 놓을지 묻는 편지다.', ['c3_mistfolk'],
       [tk('okhwa', '느티골 옥화에게 편지 전하기', ['도선이 보냈다고? 다리 이야기구먼.', '좋다고 전해 주게. 목수 한솔이가 마침 손이 빈다네.'], '전하겠습니다'),
        tk('doseon', '도선에게 답 전하기', ['촌장님이 좋다고? 하하, 이제 노 젓는 날도 끝이구먼.', '아니지, 다리가 놓여도 배 탈 사람은 타겠지.'])], 60),
    SQ('sq_va_boar', 'okhwa', '밭을 망치는 멧돼지', '느티골 밭을 멧돼지가 파헤친다.', ['c3_wall'],
       [kill(['boar'], 3, '멧돼지 3마리 쫓아내기'), tk('okhwa', '옥화에게 알리기', ['올가을 수확은 지켰구먼.', '마을 사람들이 조금씩 모은 걸세. 받아 두게.'])], 90),
    SQ('sq_va_bridge', 'hansol', '다리 고치기', '한솔이 개울 다리를 고칠 널빤지와 못을 모은다.', ['c3_wall'],
       [take('hansol', '한솔에게 자작 목재 8·구리 못 10 건네기', {'lumber_birch': 8, 'nails_copper': 10}, ['결이 곧네요. 좋은 목재예요.', '다리 다 놓으면 첫 번째로 건너세요.'])], 120),
    SQ('sq_wi_wraith', 'beodeul', '여울의 밤', '버들 할매가 늪 쪽에서 밤마다 나오는 망령을 걱정한다.', ['c3_mistfolk'],
       [kill(['mist_wraith'], 4, '늪의 안개 망령 4 잠재우기'), tk('beodeul', '버들 할매에게 돌아가기', ['여울물 소리가 다시 맑아졌구먼.', '아라한테도 고맙다고 전해 주게. 늪 사람들 덕도 있을 테니.'])], 110),
    SQ('sq_wi_copper', 'jaegan', '쇠가 모자라', '재간의 대장간에 구리가 떨어졌다.', ['c3_wall'],
       [take('jaegan', '재간에게 구리 주괴 6 건네기', {'ingot_copper': 6}, ['이야, 이제 망치질 좀 하겠네.', '덤이야. 못 한 줌 쳐 줄게.'])], 100, [('nails_copper', 10)]),
    SQ('sq_wi_dye', 'miru', '물감 열매', '미루가 갈대 천을 붉게 물들일 산딸기를 찾는다.', ['c3_wall'],
       [take('miru', '미루에게 산딸기 10 건네기', {'berry': 10}, ['이 빛깔 좀 봐요. 늪 노을 같아요.', '물들인 천은 여울 사람들 옷이 될 거예요.'])], 70),
    SQ('sq_in_soup', 'jumo', '주막 국솥', '금순의 주막에 손님이 몰려 국이 모자란다.', ['c3_wall'],
       [take('jumo', '금순에게 국 3 건네기', {'food_soup': 3}, ['살았다! 오늘 밤 손님은 다 받겠네.', '자, 이건 품삯. 국값보다 후하게 쳤어.'])], 90),
    SQ('sq_in_flute', 'aksa', '잃어버린 피리', '악사 소리가 늪 탑 근처에서 피리를 떨어뜨렸다고 한다. 탑까지 다녀와 달라 한다.', ['c3_beast'],
       [{'type': 'go', 'site': 'swamp_tower', 'text': '늪의 탑 근처 살피기'},
        tk('aksa', '소리에게 돌아가기', ['찾았소? …아니, 부러졌다고? 하하, 괜찮소. 그 피리는 거기서 제 노래를 다 불렀나 보오.', '대신 그 이야기로 새 노래를 지으리다.'], '기대할게요')], 100),
    SQ('sq_hu_hides', 'beomdol', '가죽 다섯 장', '범돌이 겨울 채비로 짐승 가죽을 모은다.', ['c3_wall'],
       [take('beomdol', '범돌에게 날가죽 5 건네기', {'hide_raw': 5}, ['손질이 깔끔하구먼. 제법이야.', '무두질한 걸 두 장 줄 테니 쓰게.'])], 90, [('leather', 2)]),
    SQ('sq_hu_mistwolf', 'nallae', '안개 늑대 무리', '날래가 사냥꾼 쉼터를 맴도는 안개 늑대 무리를 함께 끊자고 한다. 늑대는 밤에 나온다.', ['c3_beast'],
       [kill(['mist_wolf'], 5, '밤에 안개 늑대 5마리 잡기'), tk('nallae', '날래에게 알리기', ['우두머리부터 끊었어요? 역시.', '범돌 어른도 이번엔 잔소리 안 할 거예요.'])], 140),
    # 불과 서리 능선
    SQ('sq_as_wolves', 'seoksu', '잿빛 이빨', '석수의 굴 앞까지 잿빛 늑대가 내려온다.', ['c5_ridge'],
       [kill(['ash_wolf'], 5, '잿빛 늑대 5마리 쫓아내기'), tk('seoksu', '석수에게 알리기', ['이제 굴에 들어가 보겠구먼.', '처음 캔 구리는 자네 몫이야.'])], 180, [('ingot_copper', 4)]),
    SQ('sq_ki_oak', 'musoe', '숯가마 장작', '무쇠의 숯가마에 참나무 통나무가 필요하다. 능선엔 참나무가 없다.', ['c5_ridge'],
       [take('musoe', '무쇠에게 참나무 통나무 6 건네기', {'log_oak': 6}, ['이 무게 좀 봐. 이게 진짜 숯감이지.', '사흘 뒤 숯이 나오면 마을이 따뜻해질 거야.'])], 160),
    SQ('sq_ki_frost', 'danbi', '서리 늑대 가죽', '단비가 동상 약을 만들 서리 늑대를 찾는다.', ['c5_watcher'],
       [kill(['frost_wolf'], 4, '서리 늑대 4마리 잡기'), tk('danbi', '단비에게 돌아가기', ['고마워요. 올겨울엔 손발 잃는 사람이 없을 거예요.', '약초차예요. 몸이 노곤할 때 드세요.'])], 200, [('food_tea', 2)]),
    SQ('sq_mi_marines', 'gangjang', '굴을 막은 수병', '갱장이 굴 입구를 막은 함대 수병들을 몰아내 달라 한다.', ['c5_ridge'],
       [kill(['marine', 'marine_spear'], 3, '함대 수병 3 물리치기'), tk('gangjang', '갱장에게 알리기', ['굴이 다시 숨을 쉬는구먼.', '쇠는 우리가 캐서 우리가 쓴다. 이건 고마움이야.'])], 200, [('ingot_iron', 3)]),
    # 안개의 심장
    SQ('sq_ga_food', 'boreum', '야영지 솥', '보름이 야영지 사람들 먹일 고기 요리를 모은다.', ['c6_gate'],
       [take('boreum', '보름에게 구운 고기 4 건네기', {'food_meat': 4}, ['오늘 밤은 다들 배부르게 자겠네요.', '심장 앞에서 먹는 밥이라니, 언젠가 이야깃거리가 될 거예요.'])], 220),
    SQ('sq_pi_storm', 'suryeon', '폭풍을 달래다', '수련이 돌무지 둘레를 떠도는 폭풍 망령을 잠재워 달라 한다.', ['c6_gate'],
       [kill(['storm_wraith'], 4, '폭풍 망령 4 잠재우기'), tk('suryeon', '수련에게 돌아가기', ['돌무지에 새 이름을 하나 새길게요. 당신이 잠재운 넋들의 몫으로요.', '심장이 조금 덜 아파하는 것 같아요.'], '고마워요')], 300, [('gem_rough', 2)]),
]
qd = load('quests'); have = {q['id'] for q in qd['quests']}
qd['quests'] += [q for q in SIDE if q['id'] not in have]
pretty('quests', qd)

cfg = load('config'); cfg['dataVersion'] = 20
for tid, base in (('s_gull', 's_lighthouse'), ('s_willow', 's_valley'), ('s_kiln', 's_ash')):
    if tid not in cfg['econ']['food']: cfg['econ']['food'][tid] = copy.deepcopy(cfg['econ']['food'].get(base) or cfg['econ']['food']['s_ash'])
    def dup(o):
        if isinstance(o, dict):
            for v in list(o.values()): dup(v)
            if base in o and tid not in o: o[tid] = copy.deepcopy(o[base])
    for d in (cfg['settle'], cfg['town'], cfg['orders']): dup(d)
    cfg['orders']['open'][tid] = 0
pretty('config', cfg)
print('npcs', len(NPCS), 'quests', len(SIDE))
