# v3.1 데이터: 서브퀘스트 18개 더하기 + 모든 퀘스트에 권장 레벨(level) 매기기
# 실행: python3 tools/data/v31_quests.py (여러 번 돌려도 같은 결과)
#
# 권장 레벨
#   메인: 장마다 레벨 폭을 두고 장 안 순서대로 고르게 나눈다
#   서브·세력·현상금: 앞선 퀘스트(requires) 레벨 +1, 잡을 짐승 레벨, 막을 물결 짐승 레벨 중 가장 높은 값
#   오늘의 부탁·마음의 부탁·생일: 고정 레벨 없음(플레이어 레벨을 따른다)
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'data')
def load(f): return json.load(open(os.path.join(D, f + '.json')))
def save(f, d): open(os.path.join(D, f + '.json'), 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

qd = load('quests')
QL = qd if isinstance(qd, list) else qd.get('list') or qd['quests']

def upsert(x):
    for i, y in enumerate(QL):
        if y['id'] == x['id']:
            QL[i] = x
            return
    QL.append(x)

def talk(npc, text, say, reply='알겠습니다', take=None):
    s = {'type': 'talk', 'npc': npc, 'text': text, 'say': say, 'reply': reply}
    if take:
        s['take'] = take
    return s
def kill(mobs, n, text):
    return {'type': 'kill', 'mobs': mobs, 'count': n, 'text': text}
def have(need, text, nodes=None):
    s = {'type': 'have', 'need': need, 'text': text}
    if nodes:
        s['goal'] = {'node': [n for n, _ in nodes], 'nodeFor': [i for _, i in nodes]}
    return s
def side(id, giver, req, name, summary, steps, silver, items=None):
    r = {'silver': silver}
    if items:
        r['items'] = [{'item': i, 'qty': q} for i, q in items]
    return {'id': id, 'kind': 'side', 'giver': giver, 'requires': req, 'name': name, 'summary': summary, 'steps': steps, 'reward': r}

NEW = [
    # ── 1장 등대섬 ──
    side('sq_lh_rod', 'makdong', ['q4_forest'], '첫 낚싯대', '견습 선원 막동이 저녁에 구울 전어를 낚아 오란다.', [
        have({'tool_rod_wood': 1}, '나무 낚싯대 만들기 — 제작(C) 손 제작: 판재 1 + 갈대 섬유 3'),
        have({'fish_small': 3}, '바닷가 물고기 떼에서 은빛 전어 3마리 낚기', [('node_fish', 'fish_small')]),
        talk('makdong', '막동에게 전어 3마리 건네기', ['오, 진짜 낚았네요! 저는 맨날 줄만 엉켜요.', '선장님 몰래 구워 먹을 거예요. 하나는 형 몫이에요.'], '맛있게 먹어', {'fish_small': 3}),
    ], 45, [('food_fish_grill', 2)]),
    side('sq_fo_moon', 'soli', ['q5_supplies'], '밤에 피는 꽃', '약초꾼 솔이가 밤에만 피는 달맞이풀을 찾는다.', [
        have({'herb_moon': 3}, '해가 진 뒤 달맞이풀 3포기 캐기(채취 10)', [('node_moonherb', 'herb_moon')]),
        talk('soli', '솔이에게 달맞이풀 건네기', ['밤이슬 머금은 그대로네요. 낮에 캐면 이 빛이 안 나요.', '약제대에서 기력 물약을 달여 봤어요. 하나 가져가요.'], '고마워', {'herb_moon': 3}),
    ], 60, [('potion_stamina', 2)]),
    side('sq_gu_raiders', 'baram', ['q6_lt'], '그물 도둑', '바람이 짠 그물을 약탈단이 걷어 간다.', [
        kill(['raider_scout'], 3, '약탈단 정찰꾼 3명 쫓아내기'),
        kill(['raider', 'raider_spear', 'raider_axe'], 2, '약탈단 졸개 2명 쓰러뜨리기'),
        talk('baram', '바람에게 알리기', ['그 녀석들, 그물만 걷어 가는 게 아니라 찢어 놓고 가요.', '이제 좀 손이 덜 가겠네요. 고마워요.']),
    ], 90),
    # ── 2장 꺼져 가는 등불 ──
    side('sq_he_wraith2', 'cheongun', ['c2_ruins'], '은자의 밤길', '숲의 은자 청운이 밤마다 늪 쪽에서 오는 망령을 걱정한다.', [
        kill(['mist_wraith'], 5, '밤에 나오는 안개 망령 5체 흩기'),
        talk('cheongun', '청운에게 돌아가기', ['망령은 이 섬이 잊은 것들이야. 미워하지는 말게.', '불빛을 멀리하는 것들이니, 등불을 꺼뜨리지 말게.']),
    ], 120),
    side('sq_fo_potion', 'soli', ['c2_forge'], '약제대의 첫 불', '솔이가 숲머리 약제대에서 물약을 달여 보라고 한다.', [
        have({'potion_stamina': 1}, '숲머리 약제대에서 기력 물약 달이기 — 수액 1 + 산딸기 3'),
        talk('soli', '솔이에게 물약 보여 주기', ['색이 맑네요. 처음 치곤 잘했어요.', '물약은 G를 누르면 바로 마셔요. 싸움 중에 꼭 기억해요.'], '알았어', {'potion_stamina': 1}),
    ], 80, [('potion_heal', 1)]),
    side('sq_lh_lamp', 'seondeok', ['c2_core'], '돌 등 하나', '순덕이 장터 어귀에 석등을 세우고 싶어 한다.', [
        have({'stone_cut': 6}, '석공대에서 돌 다듬기 6개 — 돌 4개마다 1개'),
        talk('seondeok', '순덕에게 다듬은 돌 건네기', ['어머, 반듯하기도 하지. 저녁 장이 환해지겠네.', '생선 굽는 냄새 맡고 오는 사람이 더 늘겠어.'], '잘 쓰세요', {'stone_cut': 6}),
    ], 110),
    # ── 3장 늪의 불씨 ──
    side('sq_po_eel', 'doseon', ['c3_mistfolk'], '뱃사공의 장어', '뱃사공 도선이 늪 뱀장어로 기운을 차리고 싶어 한다.', [
        have({'fish_eel': 3}, '늪 뱀장어 굴에서 뱀장어 3마리 낚기(낚시 10)', [('node_fish_eel', 'fish_eel')]),
        talk('doseon', '도선에게 뱀장어 건네기', ['이놈들 힘 좋은 거 봐. 노 젓는 팔에 딱이야.', '장어 구이 하나 줄 테니 먹고 다녀. 채집이 손에 붙을 걸세.'], '고마워요', {'fish_eel': 3}),
    ], 130, [('food_eel', 2)]),
    side('sq_va_ring', 'okhwa', ['c3_survey'], '촌장의 반지', '느티골 촌장 옥화가 잃어버린 반지를 새로 맞추고 싶어 한다.', [
        have({'gem_rough': 2, 'ingot_copper': 4}, '원석 2개와 구리주괴 4개 모으기'),
        talk('okhwa', '옥화에게 재료 건네기', ['남편이 처음 준 반지였는데… 비슷하게라도 맞춰 볼게요.', '석공대에서 원석을 갈면 장신구가 된대요. 자네도 하나 해 봐요.'], '그렇게요', {'gem_rough': 2, 'ingot_copper': 4}),
    ], 150, [('gem_cut', 1)]),
    # ── 4장 잿빛 함대 ──
    side('sq_po_survey', 'pal', ['c4_sails'], '측량 천막 치우기', '장꾼 팔복이 늪길을 막은 본토 측량대 때문에 장사를 못 한다.', [
        kill(['surveyor', 'surveyor_spear'], 5, '본토 측량 천막의 측량대 5명 쫓아내기'),
        talk('pal', '팔복에게 알리기', ['길이 뚫리면 늪 너머 마을까지 물건이 가요.', '장사꾼은 길이 목숨이지. 이건 내 성의일세.']),
    ], 220, [('potion_heal', 2)]),
    side('sq_hu_arrows', 'nallae', ['c4_offer'], '화살 스무 대', '사냥꾼 날래가 함대가 오기 전에 화살을 넉넉히 두고 싶어 한다.', [
        have({'arrows_copper': 20}, '공예대에서 구리 화살 20대 만들기'),
        talk('nallae', '날래에게 화살 건네기', ['깃이 고르게 붙었네요. 바람에 안 흔들려요.', '활은 가방의 좋은 화살부터 써요. 철 화살이면 더 아프고요.'], '잘 쓰세요', {'arrows_copper': 20}),
    ], 200),
    side('sq_wi_iron', 'jaegan', ['c4_mother'], '모자란 쇠', '대장장이 재간이 함대에 맞설 칼날을 벼릴 쇠가 모자라다.', [
        have({'ingot_iron': 6}, '철주괴 6개 모으기'),
        talk('jaegan', '재간에게 철주괴 건네기', ['이 정도면 창날 스무 개는 나와.', '여울 사람들 손에 쥐여 줄 걸세. 고마우이.'], '부탁해요', {'ingot_iron': 6}),
    ], 240),
    side('sq_in_marines', 'aksa', ['c4_fort'], '노래를 막는 수병', '떠돌이 악사 소리가 잿빛 요새 수병 때문에 늪길 공연을 못 간다.', [
        kill(['marine', 'marine_spear'], 4, '잿빛 요새 수병 4명 쓰러뜨리기'),
        talk('aksa', '소리에게 돌아가기', ['이제 늪 너머 마을에도 노래를 들려줄 수 있겠어요.', '새 곡 제목은 「안개를 뚫은 사람」이에요. 누군지 알죠?']),
    ], 280),
    # ── 5장 불과 서리의 탑 ──
    side('sq_as_trout', 'seoksu', ['c5_ridge'], '서리 송어', '광부 석수가 고된 갱 일 뒤에 먹을 송어를 바란다.', [
        have({'fish_trout': 3}, '능선 송어 여울에서 서리 송어 3마리 낚기(낚시 20)', [('node_fish_trout', 'fish_trout')]),
        talk('seoksu', '석수에게 송어 건네기', ['찬물 송어는 살이 달아. 매운탕 끓이면 갱 먼지가 씻기지.', '자네 몫으로 한 그릇 떠 왔네.'], '잘 먹을게요', {'fish_trout': 3}),
    ], 300, [('food_fish_stew', 1)]),
    side('sq_mi_wolves', 'gangjang', ['c5_watcher'], '갱도 앞 늑대', '광부 우두머리 갱장의 갱도 앞을 늑대 떼가 지킨다.', [
        kill(['ash_wolf'], 4, '잿빛 늑대 4마리 쫓아내기'),
        kill(['frost_wolf'], 2, '서리 늑대 2마리 쫓아내기'),
        talk('gangjang', '갱장에게 알리기', ['이제 광부들이 해 지기 전에 내려올 수 있겠어.', '갱에서 나온 원석일세. 연마하면 값이 꽤 나가.']),
    ], 340, [('gem_rough', 3)]),
    side('sq_ki_guard', 'danbi', ['c5_pass'], '강건 물약', '약사 단비가 탑으로 가는 사람들에게 줄 강건 물약을 함께 달이자고 한다.', [
        have({'herb_moon': 2, 'fish_eel': 1}, '달맞이풀 2포기와 늪 뱀장어 1마리 모으기'),
        talk('danbi', '단비에게 재료 건네기', ['이 둘을 다듬은 돌가루와 달이면 몸이 돌처럼 단단해져요.', '처음 달인 것 하나는 당신 몫이에요.'], '고마워요', {'herb_moon': 2, 'fish_eel': 1}),
    ], 320, [('potion_guard', 2)]),
    # ── 6장 안개의 심장 ──
    side('sq_ga_glow', 'boreum', ['c6_storm'], '빛나는 물고기', '야영지 요리사 보름이 심장의 빛나는 물고기로 기운 나는 국을 끓이려 한다.', [
        have({'fish_glow': 4}, '심장의 물가에서 안개 물고기 4마리 낚기(낚시 28)', [('node_fish_glow', 'fish_glow')]),
        talk('boreum', '보름에게 물고기 건네기', ['국물이 은은하게 빛나요. 먹으면 안개가 덜 무섭대요.', '싸우러 가는 사람들 몫으로 넉넉히 끓일게요.'], '부탁해요', {'fish_glow': 4}),
    ], 380, [('food_fish_stew', 2)]),
    side('sq_pi_wraiths', 'suryeon', ['c6_gate'], '심장의 망령', '순례자 수련이 심장 가까이 맴도는 폭풍 망령을 달래 달란다.', [
        kill(['storm_wraith'], 4, '폭풍 망령 4체 흩기'),
        talk('suryeon', '수련에게 돌아가기', ['저들도 한때 이 섬을 지키던 이들이에요.', '이제야 조용히 잠들겠네요.']),
    ], 420),
    side('sq_pi_storm2', 'suryeon', ['sq_pi_wraiths', 'c6_machine'], '폭풍 늑대의 길', '수련이 순례길을 막은 폭풍 늑대 떼를 걱정한다.', [
        kill(['storm_wolf'], 5, '폭풍 늑대 5마리 쫓아내기'),
        talk('suryeon', '수련에게 알리기', ['길이 열렸어요. 심장 앞 돌무지까지 다녀올 수 있겠어요.', '순례자들이 모은 안개 결정이에요. 받아 주세요.']),
    ], 480, [('shard_mist', 2)]),
]
for q in NEW:
    upsert(q)

# ── 짐승 손보기(진행 페르소나 결과) ──
# 1장은 구리 장비 시기다. 구리 검·가죽 갑옷으로 부두목·두목을 이길 수 있게 조금 누른다
cr = load('creatures')
TUNE = {
    'raider_lt': {'hp': 360, 'dmg': 14, 'assist': 9},
    # 야영지 졸개: 한 놈을 끌면 셋·넷이 같이 왔다 → 곁의 동료만(7m)
    'raider': {'assist': 7}, 'raider_spear': {'assist': 7}, 'raider_axe': {'assist': 7},
    'raider_thrower': {'assist': 7}, 'raider_scout': {'assist': 7},
    'raider_captain': {'hp': 580, 'dmg': 17, 'assist': 10},
    # 6장: 5장 끝 레벨(33 안팎)에서 이어지게 끌어내린다
    'storm_wraith': {'level': 34},
    'storm_wolf': {'level': 35},
    'gate_warden': {'level': 38},
    'first_keeper': {'level': 41, 'hp': 2300, 'dmg': 25},
    # 2장 돌 해태: 같은 레벨 보통 실력 승률 40% → 조금 누른다
    'stone_haetae': {'hp': 740, 'dmg': 19},
}
for c in cr:
    for k, v in TUNE.get(c['id'], {}).items():
        c[k] = v
# 첫 등지기 부르는 망령: 2·3 → 1·2(같은 레벨 보통 실력 승률 10%였다)
for c in cr:
    if c['id'] == 'first_keeper':
        c['phases'][0]['summon'] = {'storm_wraith': 1}
        c['phases'][1]['summon'] = {'storm_wraith': 2}
save('creatures', cr)

# 등대를 지켜라: 1장 구리 장비로 다섯이 한꺼번에 오면 벽이다. 둘째 물결을 둘로 나눈다
for x in QL:
    if x['id'] == 'q7_raid':
        for s in x['steps']:
            if s['type'] == 'defend':
                s['waves'] = [{'raider_scout': 2, 'raider': 1}, {'raider': 1, 'raider_spear': 1, 'raider_thrower': 1}, {'raider': 1, 'raider_axe': 1}]

# ── 권장 레벨 ──
CL = {c['id']: c.get('level', 1) for c in cr}
chapters = load('chapters') if os.path.exists(os.path.join(D, 'chapters.json')) else None
BAND = {'ch1': (1, 9), 'ch2': (11, 15), 'ch3': (15, 21), 'ch4': (21, 27), 'ch5': (27, 33), 'ch6': (33, 40)}
byid = {q['id']: q for q in QL}
lv = {}
mains = {}
for q in QL:
    if q['kind'] == 'main':
        mains.setdefault(q['chapter'], []).append(q['id'])
BOSS = {c['id'] for c in cr if c.get('boss')}
def step_mob_level(q):
    # 졸개는 그 레벨, 두목은 레벨 −2(혼자 잡을 만한 선)
    m = 0
    for s in q.get('steps', []):
        for t in s.get('mobs', []):
            m = max(m, CL.get(t, 0) - (2 if t in BOSS else 0))
        for w in s.get('waves', []):
            for t in w:
                m = max(m, CL.get(t, 0))
    return m
prev = 0
for ch in sorted(mains):
    ids = mains[ch]
    a, b = BAND[ch]
    for i, qid in enumerate(ids):
        lv[qid] = prev = max(prev, round(a + (b - a) * (i / max(1, len(ids) - 1))), step_mob_level(byid[qid]))

def mob_level(q):
    m = 0
    for s in q.get('steps', []):
        for t in s.get('mobs', []):
            m = max(m, CL.get(t, 0))
        for w in s.get('waves', []):
            for t in w:
                m = max(m, CL.get(t, 0))
    return m

def level_of(qid, seen=()):
    if qid in lv:
        return lv[qid]
    q = byid.get(qid)
    if not q or qid in seen:
        return 0
    if q.get('repeat') in ('daily', 'birthday') or q.get('bond'):
        lv[qid] = None
        return 0
    base = max([level_of(r, seen + (qid,)) or 0 for r in q.get('requires', [])] + [0])
    v = max(base + 1 if base else 1, step_mob_level(q))
    lv[qid] = v
    return v

for q in QL:
    level_of(q['id'])
for q in QL:
    v = lv.get(q['id'])
    if v:
        q['level'] = v
    else:
        q.pop('level', None)
save('quests', qd)

cfg = load('config')
L = cfg['level']
L['questFrac'] = {'main': 0.55, 'side': 0.28, 'faction': 0.35, 'bounty': 0.45, 'daily': 0.12, 'bond': 0.25, 'birthday': 0.1}
# 레벨 차이(공격하는 쪽 − 맞는 쪽): 낮으면 덜 아프게, 높으면 조금 더 아프게
L['gap'] = {'grace': 2, 'lowPer': 0.06, 'lowMin': 0.45, 'highPer': 0.03, 'highMax': 1.3, 'maxGap': 10}
# 창: 같은 레벨 두목 승률이 다른 무기보다 낮았다(진행 페르소나) → 배율 0.95 → 1.0
cfg['combat']['weapons']['spear']['mult'] = 1.0
cfg['dataVersion'] = max(cfg.get('dataVersion', 0), 34)
save('config', cfg)

side_lv = sorted((q['level'], q['id']) for q in QL if q['kind'] == 'side' and q.get('level') and not q.get('faction'))
print('새 서브퀘스트', len(NEW), '· 레벨 매긴 퀘스트', sum(1 for q in QL if q.get('level')))
print(' '.join(f'{i}:{l}' for l, i in side_lv))
