# 손 동작 묶음(v0.4.8): 채집·전투·시전 동작을 CMU 모션 캡처에서 잘라 게임 뼈대로 옮긴다.
# build.py가 불러 clips.json에 함께 넣는다. 각 동작은 창(t0~t1), 고리 여부, 방향을 맞출 순간, 사건(때리는 순간 등)을 가진다.
import os
import numpy as np
from bvh import parse, fk
from retarget import retarget, BONES, PARENT, quat_to_mat, mat_to_quat, nrm


def _sample(L, H, f0, f1, n, inclusive):
    from build import slerp
    m = n - 1 if inclusive else n
    ts = f0 + (f1 - f0) * np.arange(n) / max(1, m)
    i0 = np.clip(np.floor(ts).astype(int), 0, len(H) - 2)
    fr = ts - i0
    q = {b: slerp(L[b][i0], L[b][i0 + 1], fr) for b in BONES}
    h = H[i0] * (1 - fr[:, None]) + H[i0 + 1] * fr[:, None]
    return q, h


def _yaw_rotate(q, h, psi):
    """온몸을 -psi만큼 돌린다(엉덩이 회전 앞에 곱하고, 엉덩이 오프셋도 돌린다)"""
    from build import qmul
    rq = np.array([0, np.sin(-psi / 2), 0, np.cos(-psi / 2)])
    q = dict(q)
    q['hips'] = qmul(np.broadcast_to(rq, q['hips'].shape), q['hips'])
    c, s = np.cos(-psi), np.sin(-psi)
    h = h.copy()
    x, z = h[:, 0].copy(), h[:, 2].copy()
    h[:, 0] = c * x + s * z
    h[:, 2] = -s * x + c * z
    return q, h


def _facing(q):
    # 옆축(+x)으로 방향을 잰다 — 앞으로 구르거나 누워도(앞축이 위·아래를 봐도) 흔들리지 않는다
    M = quat_to_mat(q['hips'])
    return np.arctan2(-M[:, 2, 0], M[:, 0, 0])


MIRROR = {b: (b[:-1] + ('L' if b.endswith('R') else 'R')) if b[-1] in 'LR' and b not in ('hips',) else b for b in BONES}


def mirror(c):
    """좌우를 바꾼다(왼손 동작 → 오른손 동작). x=0 평면 대칭: 쿼터니언 (x,y,z,w) → (x,-y,-z,w)"""
    q = {}
    for b in BONES:
        src = c['q'][MIRROR[b]]
        q[b] = src * np.array([1, -1, -1, 1.0])
    h = c['h'].copy()
    h[:, 0] *= -1
    return dict(c, q=q, h=h)


def action_clip(path, t0, t1, fps=30, loop=False, face=None, root='trend', hit=None, events=None, name=''):
    """t0~t1(초) 창을 잘라 동작 하나로.
    loop: 처음·끝을 이어 고리로(채집·시전). 아니면 한 번 재생(끝 장 포함).
    face: 이 시각(초)의 몸 방향을 +z로. None이면 창 평균 방향.
    root: 'trend'=시작→끝 이동을 빼서 제자리로 돌아오게, 'start'=시작 위치 기준(구르기처럼 앞으로 가는 것), 'free'=그대로
    hit/events: 사건 시각(초) → 0~1 위상으로 바꿔 넣는다."""
    from build import loop_fix, REST, FPS
    J, D, dt = parse(path)
    r = retarget(path, REST, heading=None)
    L, H = r['L'], r['hips']
    f0, f1 = int(round(t0 / dt)), min(len(H) - 1, int(round(t1 / dt)))
    dur = (f1 - f0) * dt
    if loop:
        n = max(8, int(round(dur * fps)))
        q, h = _sample(L, H, f0, f1, n, False)
        q = loop_fix(q, {b: L[b][f1] for b in BONES})
        t = np.arange(n)[:, None] / n
        disp = H[f1] - H[f0]
        hh = (h - H[f0] - disp * t) * r['scale']
        hh[:, 1] = (h[:, 1] - disp[1] * t[:, 0] - r['ref']['Hips'][1]) * r['scale']
        hh[:, [0, 2]] -= hh[:, [0, 2]].mean(0)
    else:
        n = max(4, int(round(dur * fps)) + 1)
        q, h = _sample(L, H, f0, f1, n, True)
        hh = (h - H[f0]) * r['scale']
        hh[:, 1] = (h[:, 1] - r['ref']['Hips'][1]) * r['scale']
        if root == 'trend':
            t = np.arange(n)[:, None] / (n - 1)
            hh[:, [0, 2]] -= (hh[-1, [0, 2]] - hh[0, [0, 2]]) * t
    # 방향: 정한 순간(또는 평균)의 몸 방향을 +z로
    yaw = _facing(q)
    if face is None:
        psi = float(np.arctan2(np.sin(yaw).mean(), np.cos(yaw).mean()))
    else:
        k = int(round((face - t0) / dur * (n - 1 if not loop else n))) % n
        psi = float(yaw[k])
    q, hh = _yaw_rotate(q, hh, psi)
    if root != 'free' and not loop:
        # 시작 자세의 엉덩이를 원점 위에(앞뒤·좌우 0)
        hh[:, [0, 2]] -= hh[0, [0, 2]]
    ev = {}
    for k_, v_ in (events or {}).items():
        ev[k_] = round(float((v_ - t0) / dur), 4)
    if hit is not None:
        ev['hit'] = round(float((hit - t0) / dur), 4)
    return dict(q=q, h=hh, n=n, stride=0.0, dur=dur, loop=loop, ev=ev, src=os.path.basename(path),
                win=[round(t0, 3), round(t1, 3)], turned=round(float(np.degrees(psi)), 1))


def strike_time(path, t0, t1, hand='RightHand', mode='down'):
    """창 안에서 손이 가장 빠르게 내려치는(또는 뻗는) 순간 — 때리는 순간 어림"""
    J, D, dt = parse(path)
    P, _ = fk(J, D)
    P = {k: v[1:] for k, v in P.items()}
    X = P[hand]
    f0, f1 = int(t0 / dt), int(t1 / dt)
    v = np.gradient(X[f0:f1], axis=0) / dt
    if mode == 'down':
        k = int(np.argmin(v[:, 1]))
    else:
        k = int(np.argmax(np.linalg.norm(v, axis=1)))
    return (f0 + k) * dt


# ── 손으로 잇는 합성(v0.4.8): 모션 캡처 자세를 바탕에 두고 팔 끝 위치를 IK로 그린다 ──
def hold(c, t, n, dur):
    """창 안 한 시각(0~1)의 자세를 n장 고리로 늘인다"""
    k = int(round(t * (c['n'] - 1)))
    q = {b: np.repeat(c['q'][b][k:k + 1], n, 0) for b in BONES}
    h = np.repeat(c['h'][k:k + 1], n, 0)
    return dict(c, q=q, h=h, n=n, dur=dur, loop=True)


def resample_n(c, n):
    """고리 클립을 n장으로(시간 길이는 그대로)"""
    from build import slerp
    m = c['n']
    f = np.arange(n) / n * m
    i0 = np.floor(f).astype(int) % m
    i1 = (i0 + 1) % m
    t = f - np.floor(f)
    q = {b: slerp(c['q'][b][i0], c['q'][b][i1], t) for b in BONES}
    h = c['h'][i0] * (1 - t[:, None]) + c['h'][i1] * t[:, None]
    return dict(c, q=q, h=h, n=n)


def arm_ik(c, side, T, pole=None, w=None):
    """side('L'/'R') 손을 T(n,3, 뿌리 공간)로. pole: 팔꿈치가 향할 방향 힌트(n,3). w: 섞는 정도(n,)"""
    from build import fk_full, rot_between
    q, h, n = c['q'], c['h'], c['n']
    G, pos = fk_full(q, h)
    sh, el, hd, cl = 'sh' + side, 'el' + side, 'hand' + side, 'clav' + side
    A, B, C = pos[sh], pos[el], pos[hd]
    l1 = np.linalg.norm(B - A, axis=1)
    l2 = np.linalg.norm(C - B, axis=1)
    if w is None:
        w = np.ones(n)
    T = C + (T - C) * w[:, None]
    d = np.clip(np.linalg.norm(T - A, axis=1), np.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-3)
    u = nrm(T - A)
    pv = (B - A) if pole is None else pole
    pv = pv - (pv * u).sum(1, keepdims=True) * u
    pv = nrm(pv)
    ca = np.clip((l1 ** 2 + d ** 2 - l2 ** 2) / (2 * l1 * d), -1, 1)
    B2 = A + u * (l1 * ca)[:, None] + pv * (l1 * np.sqrt(1 - ca ** 2))[:, None]
    C2 = A + u * d[:, None]
    R1 = rot_between(B - A, B2 - A)
    Gsh = R1 @ G[sh]
    R2 = rot_between(np.einsum('fij,fj->fi', R1, C - B), C2 - B2)
    Gel = R2 @ R1 @ G[el]
    Gp = G[cl]
    q2 = dict(q)
    q2[sh] = mat_to_quat(np.transpose(Gp, (0, 2, 1)) @ Gsh)
    q2[el] = mat_to_quat(np.transpose(Gsh, (0, 2, 1)) @ Gel)
    q2[hd] = mat_to_quat(np.transpose(Gel, (0, 2, 1)) @ G[hd])
    return dict(c, q=q2)


def turn_bone(c, bone, axis, ang):
    """뼈를 뿌리 공간 축(axis) 둘레로 ang(n,)만큼 더 돌린다(자식은 따라온다)"""
    from build import fk_full
    q, h, n = c['q'], c['h'], c['n']
    G, _ = fk_full(q, h)
    p = PARENT[bone]
    a = nrm(np.asarray(axis, float))
    half = np.asarray(ang)[:, None] / 2
    rq = np.concatenate([a[None] * np.sin(half), np.cos(half)], 1)
    R = quat_to_mat(rq)
    Gp = G[p] if p else np.repeat(np.eye(3)[None], n, 0)
    Gn = R @ G[bone]
    q2 = dict(q)
    q2[bone] = mat_to_quat(np.transpose(Gp, (0, 2, 1)) @ Gn)
    return dict(c, q=q2)


def hand_pos(c, side):
    from build import fk_full
    _, pos = fk_full(c['q'], c['h'])
    return pos['hand' + side], pos


def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def harvest_clip(root, dur=1.25, fps=30):
    """낫질(v0.4.10): 한쪽 무릎 꿇고 오른손 낫으로 발 앞 줄기 밑동을 오른쪽→왼쪽으로 빠르게 긋고 천천히 돌아온다.
    왼손은 줄기를 쥐었다 살짝 당긴다. 몸통은 낫을 따라 조금 비튼다(예전: 깊은 쪼그림)."""
    kb = kneel_base(root)
    c = keyed_clip(kb, dur, {
        'pitch': [(0, 0.42), (0.15, 0.5), (0.3, 0.46), (0.65, 0.4)],
        'R': [(0, (-0.3, 0.17, 0.42)), (0.15, (-0.06, 0.14, 0.5)), (0.3, (0.13, 0.15, 0.46)), (0.65, (-0.08, 0.24, 0.44))],
        'L': [(0, (0.12, 0.26, 0.47)), (0.25, (0.12, 0.27, 0.47)), (0.45, (0.12, 0.31, 0.43)), (0.75, (0.12, 0.27, 0.47))],
        'twist': [(0, -0.14), (0.3, 0.12), (0.65, -0.04)],
        'neck': [(0, 0.18)],
    }, fps=fps, ev={'hit': 0.15}, src='23_03+열쇠')
    return c


def build_turn(c, bone, axis, ang):
    return turn_bone(c, bone, axis, ang)


def cast_clip(root, idle):
    """귀환 시전: 서기 동작을 바탕으로 두 손을 가슴 앞에 모아 기운을 모으듯 천천히 오르내린다. 고개는 조금 숙인다."""
    b = dict(idle)
    n = b['n']
    t = np.arange(n) / n
    _, pos = hand_pos(b, 'R')
    ch = pos['chest']
    osc = np.sin(2 * np.pi * t * 2)  # 한 고리(4.9초)에 두 번
    for side, sx in (('R', -1), ('L', 1)):
        T = np.stack([ch[:, 0] + sx * (0.085 + 0.015 * osc), ch[:, 1] - 0.02 + 0.03 * osc, ch[:, 2] + 0.30 + 0.01 * np.cos(2 * np.pi * t * 2)], 1)
        pole = np.tile([sx * 0.9, -0.5, -0.3], (n, 1))
        b = arm_ik(b, side, T, pole=pole)
    b = turn_bone(b, 'neck', [1, 0, 0], np.full(n, 0.22))
    b['ev'] = {}
    b['src'] = idle.get('src', '') + '+합성'
    return b


def straighten(c, t_end=None):
    """구르기처럼 몸이 뒤집히는 동작: 끝 방향이 처음 방향과 같게 엉덩이 회전을 고르게 돌려 바로잡는다"""
    yaw = np.unwrap(_facing(c['q']))
    n = c['n']
    k = n - 1 if t_end is None else int(round(t_end * (n - 1)))
    drift = yaw[k] - yaw[0]
    ramp = np.clip(np.arange(n) / max(1, k), 0, 1) * drift
    from build import qmul
    q = dict(c['q'])
    rq = np.stack([np.zeros(n), np.sin(-ramp / 2), np.zeros(n), np.cos(-ramp / 2)], 1)
    q['hips'] = qmul(rq, q['hips'])
    c = dict(c, q=q)
    c['straightened'] = round(float(np.degrees(drift)), 1)
    return c


# 손 동작 목록: 이름 → (파일, 시작, 끝, 고리, 방향 맞출 시각, 뿌리, 비고)
ACTIONS = {
    # 채집
    'chop': ('079/79_01', 2.1, 3.75, True, None, 'trend', '통나무 패기(위에서 내려찍기)'),
    'mine': ('079/79_01', 0.45, 1.95, True, None, 'trend', '곡괭이질(같은 사람의 다른 내려찍기)'),
    # 전투
    'atk_light': ('002/02_05', 1.15, 2.25, False, 'hit', 'trend', '한 손 내려베기'),
    'atk_heavy': ('079/79_01', 2.35, 4.0, False, 'hit', 'trend', '두 손 머리 위에서 내려찍기'),
    'punch': ('143/143_23', 0.75, 1.45, False, 'hit', 'trend', '오른손 곧은 주먹'),
    'punch_heavy': ('143/143_23', 2.15, 2.95, False, 'hit', 'trend', '한 발 들이며 치는 주먹'),
    'guard': ('143/143_23', 5.95, 6.75, True, None, 'trend', '막기 자세'),
    'roll': ('127/127_23', 0.45, 1.8, False, 0.45, 'trend', '앞구르기'),
    'down': ('090/90_18', 0.45, 1.9, False, 0.45, 'start', '뒤로 넘어짐'),
}


def build_actions(root, idle):
    import build
    out = {}
    for name, (f, t0, t1, loop, face, rt, note) in ACTIONS.items():
        path = f'{root}/{f}.bvh'
        hit = None
        if name in ('chop', 'mine', 'atk_light', 'atk_heavy'):
            hit = strike_time(path, t0, t1, 'RightHand', 'down')
        elif name in ('punch', 'punch_heavy'):
            hit = strike_time(path, t0, t1, 'RightHand', 'fast')
        fc = hit if face == 'hit' else face
        c = action_clip(path, t0, t1, loop=loop, face=fc, root=rt, hit=hit)
        if name == 'roll':
            c = straighten(c, 0.9)
        if name not in ('roll', 'down'):
            build.ground(c)
            c = build.plant(c)
        else:
            # 구르기·넘어짐: 가장 낮은 발목이 땅 높이 아래로 안 가게만
            from build import fk_full
            _, pos = fk_full(c['q'], c['h'])
            lo = min(pos['ftL'][:, 1].min(), pos['ftR'][:, 1].min(), pos['head'][:, 1].min() - 0.03, pos['hips'][:, 1].min() - 0.08)
            c['h'][:, 1] -= min(0.0, lo - 0.0) if lo < 0 else 0.0
            # 서 있는 첫 장의 발이 땅에 닿게
            first = min(pos['ftL'][0, 1], pos['ftR'][0, 1])
            c['h'][:, 1] -= first - build.REST['ftL'][1]
        c['note'] = note
        if name == 'mine':
            c['lock'] = {'L': 0, 'R': 0}  # v0.4.10: 원본은 왼발을 오른발 앞으로 옮겨 다리가 엇갈렸다
        out[name] = c
    # 창: 왼손 앞찌르기(잽)로 왼어깨가 앞으로 나오는 몸놀림을 바탕으로 쓴다(앞손이 왼손이라 멀리 닿는다)
    jab = '/'.join([root, '143/143_23.bvh'])
    for nm, (t0, t1), reach, low in (('spear', (0.1, 0.75), 0.42, 0.0), ('spear_heavy', (1.3, 2.1), 0.55, 0.05)):
        ht = strike_time(jab, t0, t1, 'LeftHand', 'fast')
        cb = action_clip(jab, t0, t1, loop=False, face=ht, root='trend', hit=ht)
        build.ground(cb)
        cb = build.plant(cb)
        out[nm] = spear_clip(cb, reach, low)
    out['spear']['note'] = '창 찌르기(합성)'
    out['spear_heavy']['note'] = '한 발 들이며 깊게 찌르기(합성)'
    h = harvest_clip(root)
    build.ground(h)
    h['note'] = '무릎 꿇고 낫질(합성)'
    out['harvest'] = h
    cst = cast_clip(root, idle)
    cst['note'] = '귀환 시전(서기 + 두 손 모으기)'
    out['cast'] = cst
    out.update(review_clips(root, idle, out))
    out.update(saw_clip(root))
    out.update(hop_clip(root, out))
    return out


def spear_clip(base, reach=0.42, low=0.0):
    """창 찌르기: 주먹 동작(몸통 비틀기·체중 이동)을 바탕으로 두 손을 창대 위에 두고 앞으로 찌른다.
    오른손은 오른 허리 뒤, 왼손은 그 앞 0.45m. 맞는 순간(ev.hit)에 가장 멀리 뻗는다."""
    import build
    b = dict(base)
    n = b['n']
    t = np.arange(n) / (n - 1)
    hp = b['ev'].get('hit', 0.5)
    # 뻗기: 살짝 당겼다(0.6hp) → 맞는 순간 최대 → 잠깐 머문 뒤 돌아옴
    e = np.where(t < 0.6 * hp, -0.12 * smooth01(t / (0.6 * hp)),
        np.where(t < hp, -0.12 + 1.12 * smooth01((t - 0.6 * hp) / (0.4 * hp)),
        np.where(t < hp + 0.1, 1.0, 1.0 - smooth01((t - hp - 0.1) / (0.9 - hp)))))
    _, pos = hand_pos(b, 'R')
    hip = pos['hips']
    fwd = np.array([0.0, -0.06, 1.0])
    fwd /= np.linalg.norm(fwd)
    R0 = np.stack([hip[:, 0] - 0.10, hip[:, 1] + 0.07 + 0 * t, hip[:, 2] - 0.12], 1)
    TR = R0 + fwd[None] * (reach * e)[:, None]
    TL = TR + fwd[None] * 0.42 + np.array([0.04, 0.02 - low, 0.0])[None]
    # 왼팔이 닿는 데까지만(안 닿으면 창이 옆으로 꺾인다): 두 손을 함께 뒤로 물린다
    armL = np.linalg.norm(np.array(build.REST['elL']) - build.REST['shL']) + np.linalg.norm(np.array(build.REST['handL']) - build.REST['elL'])
    for _ in range(3):
        over = np.linalg.norm(TL - pos['shL'], axis=1) - 0.93 * armL
        back = np.clip(over, 0, None)
        TR = TR - fwd[None] * back[:, None]
        TL = TL - fwd[None] * back[:, None]
    b = arm_ik(b, 'R', TR, pole=np.tile([-0.8, -0.6, -0.4], (n, 1)))
    b = arm_ik(b, 'L', TL, pole=np.tile([0.7, -0.7, -0.1], (n, 1)))
    b['src'] = base.get('src', '') + '+창'
    return b


# ── 열쇠 자세로 그리는 합성(v0.4.9): 바탕 자세 한 장 + 시간 열쇠(몸통 비틀기·숙이기·고개·엉덩이·두 손 위치) ──
def keys_at(keys, n, loop, dim):
    """keys: [(t 0~1, 값)] → (n, dim). 열쇠 사이는 Catmull-Rom 곡선(고리면 끝과 처음을 잇는다)"""
    ks = sorted(keys, key=lambda k: k[0])
    T = np.array([k[0] for k in ks], float)
    V = np.array([np.atleast_1d(np.asarray(k[1], float)) for k in ks])
    if loop:
        T = np.concatenate([T[-2:] - 1, T, T[:2] + 1])
        V = np.concatenate([V[-2:], V, V[:2]])
    else:
        T = np.concatenate([[T[0] - 1e-3], T, [T[-1] + 1e-3]])
        V = np.concatenate([V[:1], V, V[-1:]])
    ts = np.arange(n) / (n if loop else max(1, n - 1))
    out = np.zeros((n, dim))
    for i, t in enumerate(ts):
        j = int(np.searchsorted(T, t, side='right')) - 1
        j = min(max(j, 1), len(T) - 3)
        t0, t1 = T[j], T[j + 1]
        u = 0.0 if t1 - t0 < 1e-9 else (t - t0) / (t1 - t0)
        p0, p1, p2, p3 = V[j - 1], V[j], V[j + 1], V[j + 2]
        m1 = (p2 - p0) / max(1e-6, T[j + 1] - T[j - 1]) * (t1 - t0)
        m2 = (p3 - p1) / max(1e-6, T[j + 2] - T[j]) * (t1 - t0)
        u2, u3 = u * u, u * u * u
        out[i] = (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2
    return out


def keyed_clip(base, dur, keys, fps=30, loop=True, ev=None, src=''):
    """base: 바탕 자세(한 장이면 늘이고, 여러 장이면 그대로 n에 맞춰 다시 뽑는다)"""
    n = int(round(dur * fps)) if loop else int(round(dur * fps)) + 1
    if base['n'] == 1:
        b = {**base, 'q': {k: np.repeat(v[:1], n, 0) for k, v in base['q'].items()}, 'h': np.repeat(base['h'][:1], n, 0), 'n': n}
    else:
        b = resample_n(dict(base), n)
    b = dict(b, dur=dur, loop=loop, stride=0.0)
    if 'hips' in keys:
        b['h'] = b['h'] + keys_at(keys['hips'], n, loop, 3)
    if 'pitch' in keys:
        a = keys_at(keys['pitch'], n, loop, 1)[:, 0]
        b = turn_bone(b, 'spine', [1, 0, 0], a * 0.5)
        b = turn_bone(b, 'chest', [1, 0, 0], a * 0.5)
    if 'twist' in keys:
        a = keys_at(keys['twist'], n, loop, 1)[:, 0]
        b = turn_bone(b, 'spine', [0, 1, 0], a * 0.5)
        b = turn_bone(b, 'chest', [0, 1, 0], a * 0.5)
    if 'neck' in keys:
        a = keys_at(keys['neck'], n, loop, 1)[:, 0]
        b = turn_bone(b, 'neck', [1, 0, 0], a)
    for side in ('R', 'L'):
        if side in keys:
            T = keys_at(keys[side], n, loop, 3)
            sx = -1 if side == 'R' else 1
            pole = np.tile(keys.get('pole' + side, [sx * 0.7, -0.6, -0.2]), (n, 1))
            b = arm_ik(b, side, T, pole=pole)
    if 'tool' in keys:
        td = keys_at(keys['tool'], n, loop, 3)
        b['td'] = td / np.linalg.norm(td, axis=1, keepdims=True)
        b['tn'] = list(keys.get('toolUp', [1, 0, 0]))
        b['to'] = keys.get('toolAt', 'R')
    b['ev'] = ev or {}
    b['src'] = src
    return b


def one_frame(c, t):
    """클립의 한 순간(0~1)을 한 장짜리 바탕으로"""
    k = int(round(t * (c['n'] - 1)))
    return dict(c, q={b: c['q'][b][k:k + 1] for b in BONES}, h=c['h'][k:k + 1], n=1)


def squat_base(root):
    import build
    c = action_clip(f'{root}/069/69_70.bvh', 2.6, 3.6, loop=False, face=3.05)
    build.ground(c)
    hy = c['h'][:, 1]
    k = int(np.argmin(np.abs(hy - (hy.min() + 0.10))[: int(np.argmin(hy)) + 1]))
    return one_frame(c, k / (c['n'] - 1))


def kneel_base(root):
    """한쪽 무릎 꿇기(v0.4.10, 23_03 B가 무릎 꿇는 순간): 오른무릎을 땅에 대고 왼발은 앞에 디딘다.
    예전 깊은 쪼그림(69_70)은 무릎이 153° 접혀 바지·장화가 찌그러지고 다리를 개구리처럼 벌렸다."""
    import build
    c = action_clip(f'{root}/023/23_03.bvh', 2.4, 3.8, loop=False, face=3.0)
    build.ground(c)
    b = one_frame(c, 0.5)
    _, pos = build.fk_full(b['q'], b['h'])
    ftL, ftR = pos['ftL'].copy(), pos['ftR'].copy()
    # 오른무릎 관절이 땅 위 6cm(무릎 살이 땅에 닿게)가 되도록 엉덩이를 내리고 두 발목은 제자리
    dy = float(pos['knR'][0, 1] - 0.06)
    b['h'] = b['h'].copy()
    b['h'][:, 1] -= dy
    b = leg_ik(b, 'L', ftL, pole=np.array([[0.1, 0.2, 1.0]]))
    b = leg_ik(b, 'R', ftR, pole=np.array([[0.0, -0.3, 1.0]]))
    b['src'] = '23_03'
    return b


def review_clips(root, idle, out):
    """v0.4.9 적절성 검토로 더한 동작들"""
    import build
    stand = one_frame(idle, 0.0)
    wide = one_frame(out['mine'], 0.0)  # 79_01 내려찍기 앞 자세(발을 벌리고 선)
    kb = kneel_base(root)
    R = {}
    # 선 나무 베기: 오른어깨 뒤로 들었다가 허리 높이에서 비스듬히 앞·왼쪽으로 벤다(0.58에 닿음), 잠깐 박혔다 뺀다
    R['chop_tree'] = keyed_clip(wide, 1.4, {
        'twist': [(0, 0.0), (0.4, -0.6), (0.5, -0.35), (0.58, 0.14), (0.66, 0.16), (0.85, 0.04)],
        'pitch': [(0, 0.08), (0.4, -0.02), (0.58, 0.22), (0.66, 0.24), (0.85, 0.12)],
        'R': [(0, (-0.07, 1.0, 0.42)), (0.4, (-0.42, 1.46, -0.02)), (0.5, (-0.3, 1.22, 0.32)), (0.58, (-0.01, 1.02, 0.52)), (0.66, (0.01, 1.0, 0.5)), (0.85, (-0.05, 1.03, 0.45))],
        'L': [(0, (0.03, 0.95, 0.41)), (0.4, (-0.33, 1.38, 0.02)), (0.5, (-0.22, 1.15, 0.33)), (0.58, (0.07, 0.96, 0.5)), (0.66, (0.09, 0.94, 0.48)), (0.85, (0.03, 0.98, 0.44))],
        'neck': [(0, 0.1), (0.4, 0.0), (0.58, 0.15), (1.0, 0.1)],
        # 도끼 자루 방향(뿌리 공간): 앞아래 → 오른어깨 뒤 수평 → 오른쪽 → 앞·왼쪽 수평(줄기에 박힘) → 앞아래
        'tool': [(0, (-0.3, -0.55, 0.78)), (0.4, (-0.62, 0.22, -0.75)), (0.5, (-0.92, 0.05, 0.25)), (0.58, (0.42, -0.08, 0.9)), (0.66, (0.44, -0.1, 0.89)), (0.85, (-0.1, -0.45, 0.88))],
        'toolUp': [0, 1, 0], 'toolAt': 'mid',
    }, ev={'hit': 0.58}, src='79_01+열쇠')
    # 산딸기: 몸을 숙여 덤불 속으로 손을 넣어 따고 왼손(주머니)에 담는다. 두 번
    R['pick_bush'] = keyed_clip(stand, 1.8, {
        'pitch': [(0, 0.6), (0.15, 0.7), (0.4, 0.55), (0.65, 0.72), (0.9, 0.55)],
        'neck': [(0, 0.12), (0.5, 0.08)],
        'twist': [(0, -0.08), (0.15, -0.14), (0.4, 0.0), (0.65, 0.12), (0.9, 0.0)],
        'R': [(0, (-0.13, 0.95, 0.36)), (0.15, (-0.17, 0.84, 0.44)), (0.25, (-0.15, 0.87, 0.4)), (0.4, (-0.01, 1.0, 0.26)), (0.5, (-0.01, 1.0, 0.26)),
              (0.65, (0.03, 0.82, 0.45)), (0.75, (0.02, 0.86, 0.41)), (0.9, (-0.01, 1.0, 0.26))],
        'L': [(0, (0.1, 1.0, 0.24)), (0.45, (0.07, 1.02, 0.26)), (0.6, (0.11, 0.98, 0.24)), (0.95, (0.07, 1.02, 0.26))],
    }, ev={'hit': 0.15, 'hit2': 0.65}, src='77_02+열쇠')
    # 버섯(v0.4.10): 한쪽 무릎 꿇고 몸을 숙여 오른손으로 비틀어 뽑고 왼손에 모은다. 두 번
    R['pick_ground'] = keyed_clip(kb, 1.6, {
        'pitch': [(0, 0.5), (0.2, 0.58), (0.45, 0.48), (0.8, 0.58), (0.95, 0.5)],
        'R': [(0, (-0.03, 0.3, 0.42)), (0.2, (0.0, 0.13, 0.52)), (0.27, (0.01, 0.14, 0.51)), (0.34, (-0.01, 0.14, 0.52)), (0.45, (0.02, 0.3, 0.45)),
              (0.58, (0.09, 0.33, 0.38)), (0.66, (0.09, 0.33, 0.38)), (0.8, (0.04, 0.13, 0.54)), (0.86, (0.05, 0.14, 0.53)), (0.95, (0.01, 0.28, 0.44))],
        'L': [(0, (0.13, 0.34, 0.37)), (0.6, (0.12, 0.36, 0.37))],
        'twist': [(0, 0.0), (0.2, -0.06), (0.6, 0.06), (0.85, 0.04)],
        'neck': [(0, 0.22)],
    }, ev={'hit': 0.3, 'hit2': 0.86}, src='23_03+열쇠')
    # 가죽 벗기기(v0.4.10): 무릎 꿇고 왼손으로 가죽을 잡아당기며 오른손 칼로 길게 가른다
    R['skin'] = keyed_clip(kb, 1.5, {
        'pitch': [(0, 0.45), (0.35, 0.55), (0.7, 0.45)],
        'R': [(0, (-0.2, 0.26, 0.46)), (0.35, (0.1, 0.18, 0.54)), (0.45, (0.13, 0.2, 0.52)), (0.7, (-0.18, 0.28, 0.45))],
        'L': [(0, (0.16, 0.24, 0.47)), (0.35, (0.18, 0.33, 0.42)), (0.7, (0.16, 0.26, 0.46))],
        'twist': [(0, -0.1), (0.35, 0.08), (0.7, -0.06)],
        'neck': [(0, 0.2)],
    }, ev={'hit': 0.25}, src='23_03+열쇠')
    # 먹기: 오른손을 입에 두 번 가져간다(한 번 재생)
    R['eat'] = keyed_clip(stand, 1.8, {
        'R': [(0, (-0.2, 0.95, 0.1)), (0.22, (-0.06, 1.42, 0.17)), (0.34, (-0.04, 1.46, 0.14)), (0.42, (-0.06, 1.42, 0.18)), (0.54, (-0.04, 1.46, 0.14)),
              (0.64, (-0.07, 1.4, 0.19)), (0.86, (-0.16, 1.05, 0.2)), (1.0, (-0.2, 0.95, 0.1))],
        'neck': [(0, 0.0), (0.3, 0.12), (0.4, 0.04), (0.52, 0.12), (0.7, 0.02), (1.0, 0.0)],
        'poleR': [-0.6, -0.8, 0.0],
    }, loop=False, ev={'bite': 0.34}, src='77_02+열쇠')
    # 마시기: 두 손으로 그릇을 들어 입에 대고 고개를 젖힌다(한 번 재생)
    R['drink'] = keyed_clip(stand, 2.2, {
        'R': [(0, (-0.18, 0.95, 0.12)), (0.25, (-0.06, 1.38, 0.24)), (0.35, (-0.05, 1.44, 0.2)), (0.7, (-0.05, 1.46, 0.19)), (0.85, (-0.07, 1.12, 0.28)), (1.0, (-0.18, 0.95, 0.12))],
        'L': [(0, (0.18, 0.95, 0.12)), (0.25, (0.07, 1.36, 0.25)), (0.35, (0.06, 1.42, 0.21)), (0.7, (0.06, 1.44, 0.2)), (0.85, (0.08, 1.1, 0.28)), (1.0, (0.18, 0.95, 0.12))],
        'neck': [(0, 0.0), (0.3, 0.02), (0.45, -0.28), (0.7, -0.3), (0.85, 0.0), (1.0, 0.0)],
        'poleR': [-0.6, -0.8, 0.0], 'poleL': [0.6, -0.8, 0.0],
        'tool': [(0, (0, 1, 0)), (0.3, (0, 1, 0.1)), (0.45, (0, 0.62, -0.78)), (0.7, (0, 0.55, -0.83)), (0.85, (0, 1, 0)), (1.0, (0, 1, 0))],
        'toolUp': [1, 0, 0], 'toolAt': 'mid',
    }, loop=False, src='77_02+열쇠')
    # 망치질(대장간·갑주·목공대): 모루 앞에서 들었다 내려치기 두 번
    R['hammer'] = keyed_clip(stand, 1.4, {
        'pitch': [(0, 0.16), (0.3, 0.2), (0.8, 0.2)],
        'neck': [(0, 0.25)],
        'R': [(0, (-0.18, 1.02, 0.4)), (0.18, (-0.24, 1.38, 0.26)), (0.3, (-0.15, 1.02, 0.44)), (0.42, (-0.19, 1.16, 0.38)), (0.68, (-0.24, 1.38, 0.26)), (0.8, (-0.15, 1.02, 0.44)), (0.92, (-0.19, 1.12, 0.39))],
        'L': [(0, (0.08, 0.99, 0.4)), (0.5, (0.07, 1.0, 0.42)), (0.95, (0.08, 0.99, 0.4))],
        # 망치 자루: 들 때 위·뒤, 칠 때 앞·아래(머리가 모루에 닿게)
        'tool': [(0, (0.05, -0.35, 0.94)), (0.18, (0.0, 0.75, -0.66)), (0.3, (0.05, -0.4, 0.92)), (0.42, (0.03, 0.2, 0.98)), (0.68, (0.0, 0.75, -0.66)), (0.8, (0.05, -0.4, 0.92)), (0.92, (0.03, 0.15, 0.99))],
        'toolAt': 'R',
    }, ev={'hit': 0.3, 'hit2': 0.8}, src='77_02+열쇠')
    # 젓기(조리대·제련로): 오른손 국자로 솥을 원을 그리며 젓고 왼손은 솥 가장자리를 잡는다
    th = np.linspace(0, 1, 9)[:-1]
    R['stir'] = keyed_clip(stand, 1.6, {
        'pitch': [(0, 0.14)], 'neck': [(0, 0.3)],
        'R': [(t, (-0.1 + 0.08 * np.cos(2 * np.pi * t), 1.05 + 0.012 * np.sin(4 * np.pi * t), 0.36 + 0.07 * np.sin(2 * np.pi * t))) for t in th],
        'L': [(0, (0.15, 1.0, 0.34)), (0.5, (0.15, 1.01, 0.35))],
        'tool': [(t, (0.15 * np.cos(2 * np.pi * t), -0.9, 0.42 + 0.1 * np.sin(2 * np.pi * t))) for t in th],
        'toolAt': 'R',
        'twist': [(t, 0.06 * np.cos(2 * np.pi * t)) for t in th],
    }, src='77_02+열쇠')
    # 베 짜기: 바디를 당기고(두 손) 북을 오른손→왼손으로 넘긴다
    R['weave'] = keyed_clip(stand, 1.8, {
        'pitch': [(0, 0.08)], 'neck': [(0, 0.22)],
        'R': [(0, (-0.18, 1.14, 0.44)), (0.12, (-0.18, 1.12, 0.3)), (0.25, (-0.18, 1.14, 0.44)), (0.45, (0.06, 1.1, 0.42)), (0.6, (-0.12, 1.08, 0.42)), (0.85, (-0.18, 1.14, 0.44))],
        'L': [(0, (0.18, 1.14, 0.44)), (0.12, (0.18, 1.12, 0.3)), (0.25, (0.18, 1.14, 0.44)), (0.45, (0.1, 1.1, 0.42)), (0.6, (0.18, 1.1, 0.42)), (0.85, (0.18, 1.14, 0.44))],
    }, src='77_02+열쇠')
    # 무두질: 틀에 걸린 가죽을 두 손 칼로 위에서 아래로 훑어 내린다
    R['scrape'] = keyed_clip(stand, 1.4, {
        'pitch': [(0, 0.18), (0.45, 0.3)], 'neck': [(0, 0.15)],
        'R': [(0, (-0.1, 1.3, 0.38)), (0.45, (-0.08, 1.0, 0.43)), (0.6, (-0.09, 1.04, 0.4)), (0.9, (-0.1, 1.28, 0.37))],
        'L': [(0, (0.1, 1.28, 0.38)), (0.45, (0.09, 0.99, 0.43)), (0.6, (0.09, 1.02, 0.4)), (0.9, (0.1, 1.26, 0.37))],
    }, src='77_02+열쇠')
    # 손으로 짓기(작업대 없이): 배 앞에서 두 손으로 꼬고 묶는다
    R['handwork'] = keyed_clip(stand, 2.0, {
        'pitch': [(0, 0.1)], 'neck': [(0, 0.35)],
        'R': [(0, (-0.08, 1.02, 0.3)), (0.25, (-0.05, 1.05, 0.33)), (0.5, (-0.1, 1.0, 0.31)), (0.75, (-0.06, 1.04, 0.28))],
        'L': [(0, (0.08, 1.02, 0.3)), (0.25, (0.1, 1.0, 0.29)), (0.5, (0.06, 1.05, 0.32)), (0.75, (0.1, 1.01, 0.3))],
    }, src='77_02+열쇠')
    # 무기 막기(v0.4.9): 권투 자세의 다리 위에, 무기를 몸 앞에 비스듬히 가로질러 든다.
    # 뒤(카메라)에서 봐도 대각선으로 읽히게 손끝 위치와 날 방향을 정한다.
    guard0 = one_frame(out['guard'], 0.0)
    sway = lambda p, d: [(0, p), (0.5, tuple(p[i] + d[i] for i in range(3)))]
    # 창: 오른손은 오른허리 앞, 왼손은 왼어깨 앞 — 창대가 몸 앞을 왼쪽 위로 가로지른다
    R['guard_spear'] = keyed_clip(guard0, 1.6, {
        'R': sway((-0.24, 1.04, 0.28), (0, 0.01, 0)),
        'L': sway((0.22, 1.36, 0.34), (0, 0.012, -0.005)),
    }, src='143_23+열쇠')
    # 한손검·몽둥이: 칼자루를 오른가슴 앞에 두고 날을 왼쪽 위로 세운다(머리 앞을 가린다), 왼주먹은 배 앞
    R['guard_sword'] = keyed_clip(guard0, 1.6, {
        'R': sway((-0.1, 1.28, 0.34), (0, 0.012, 0)),
        'L': sway((0.16, 1.12, 0.26), (0, 0.01, 0)),
        'tool': [(0, (0.45, 0.8, 0.3)), (0.5, (0.46, 0.79, 0.31))],
        'toolUp': [1, 0, 0], 'toolAt': 'R',
    }, src='143_23+열쇠')
    # 전투 도끼: 오른손은 자루 끝을 오른허리 앞에, 왼손은 자루 위쪽을 왼가슴 앞에 — 날은 앞을 본다
    ad = np.array([0.34, 0.28, 0.06])
    ad = ad / np.linalg.norm(ad)
    aR = np.array([-0.22, 1.02, 0.3])
    aL = aR + 0.42 * ad
    R['guard_axe'] = keyed_clip(guard0, 1.6, {
        'R': sway(tuple(aR), (0, 0.01, 0)),
        'L': sway(tuple(aL), (0, 0.01, 0)),
        'tool': [(0, tuple(ad)), (0.5, tuple(ad))],
        'toolUp': [0, 0, 1], 'toolAt': 'R',  # 전투 도끼 날은 묶음의 x쪽으로 뻗는다 → x를 앞으로
    }, src='143_23+열쇠')
    for k, c in R.items():
        if k in ('chop_tree', 'hammer', 'stir', 'weave', 'scrape', 'handwork'):
            build.ground(c)
            R[k] = build.plant(c)
    return R


def leg_ik(c, side, T, pole=None):
    """side 발목을 T(n,3, 뿌리 공간)로. 무릎은 pole(기본: 앞) 쪽으로 굽고 발 방향은 그대로"""
    from build import fk_full, rot_between
    q, h, n = c['q'], c['h'], c['n']
    G, pos = fk_full(q, h)
    th, kn, ft = 'th' + side, 'kn' + side, 'ft' + side
    A, B, C = pos[th], pos[kn], pos[ft]
    l1 = np.linalg.norm(B - A, axis=1)
    l2 = np.linalg.norm(C - B, axis=1)
    d = np.clip(np.linalg.norm(T - A, axis=1), np.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-3)
    u = nrm(T - A)
    pv = np.tile([0.0, 0.0, 1.0], (n, 1)) if pole is None else pole
    pv = pv - (pv * u).sum(1, keepdims=True) * u
    pv = nrm(pv)
    ca = np.clip((l1 ** 2 + d ** 2 - l2 ** 2) / (2 * l1 * d), -1, 1)
    B2 = A + u * (l1 * ca)[:, None] + pv * (l1 * np.sqrt(1 - ca ** 2))[:, None]
    C2 = A + u * d[:, None]
    R1 = rot_between(B - A, B2 - A)
    Gth = R1 @ G[th]
    R2 = rot_between(np.einsum('fij,fj->fi', R1, C - B), C2 - B2)
    Gkn = R2 @ R1 @ G[kn]
    q2 = dict(q)
    q2[th] = mat_to_quat(np.transpose(G[PARENT[th]], (0, 2, 1)) @ Gth)
    q2[kn] = mat_to_quat(np.transpose(Gth, (0, 2, 1)) @ Gkn)
    q2[ft] = mat_to_quat(np.transpose(Gkn, (0, 2, 1)) @ G[ft])
    return dict(c, q=q2)


def hop_clip(root, out):
    """무거운 갑옷 피하기: 구르지 않고 몸을 낮췄다가 짧게 뛰어 비켜 딛는다(한 번 재생).
    0~0.18 웅크림 → 0.5 공중(두 발 들림) → 0.78 착지 웅크림 → 1 일어섬"""
    import build
    from build import fk_full
    stand = one_frame(out['guard'], 0.0)
    n = int(round(0.75 * 30)) + 1
    c = keyed_clip(stand, 0.75, {
        'hips': [(0, (0, 0, 0)), (0.18, (0, -0.13, 0)), (0.5, (0, 0.05, 0)), (0.78, (0, -0.12, 0)), (1.0, (0, 0, 0))],
        'pitch': [(0, 0.05), (0.18, 0.34), (0.5, 0.24), (0.78, 0.3), (1.0, 0.06)],
        'R': [(0, (-0.13, 1.24, 0.26)), (0.5, (-0.16, 1.2, 0.2)), (1.0, (-0.13, 1.24, 0.26))],
        'L': [(0, (0.12, 1.28, 0.28)), (0.5, (0.16, 1.22, 0.22)), (1.0, (0.12, 1.28, 0.28))],
    }, loop=False, src='143_23+열쇠')
    _, pos = fk_full(c['q'], c['h'])
    t = np.arange(n) / (n - 1)
    lift = np.clip(np.sin(np.clip((t - 0.26) / 0.44, 0, 1) * np.pi), 0, None) * 0.2
    for side, dz in (('L', 0.12), ('R', -0.12)):
        f0 = pos['ft' + side][0]
        stride = dz * np.clip((t - 0.2) / 0.6, 0, 1)
        T = np.stack([np.full(n, f0[0]), np.full(n, f0[1]) + lift, f0[2] + stride], 1)
        c = leg_ik(c, side, T, pole=np.tile([0.15 * (1 if side == 'L' else -1), 0.0, 1.0], (n, 1)))
    c['ev'] = {}
    return {'hop': c}


def saw_clip(root):
    """톱질(제재대): 62_03 손톱질에서 처음·끝이 닮은 1~1.6초 창을 골라 고리로"""
    import build
    f = f'{root}/062/62_03.bvh'
    J, D, dt = parse(f)
    r = retarget(f, build.REST, heading=None)
    L = r['L']
    feat = np.concatenate([L[b] for b in ('spine', 'chest', 'shR', 'elR', 'shL', 'elL', 'thL', 'thR')], 1)
    best = None
    for i in range(int(4.2 / dt), int(8.4 / dt), 3):
        for j in range(i + int(1.0 / dt), i + int(1.6 / dt), 3):
            dd = np.abs(np.abs((feat[i].reshape(-1, 4) * feat[j].reshape(-1, 4)).sum(1)) - 1).sum()
            if best is None or dd < best[0]:
                best = (dd, i, j)
    _, i, j = best
    c = action_clip(f, i * dt, j * dt, loop=True)
    build.ground(c)
    c = build.plant(c)
    c['ev'] = {}
    return {'saw': c}
