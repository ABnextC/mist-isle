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
    """쪼그려 앉아 낫질: 쪼그린 자세(69_70)를 바탕으로 오른손은 발 앞을 오른쪽→왼쪽으로 빠르게 긋고 천천히 돌아오고,
    왼손은 줄기를 쥐었다 살짝 당긴다. 몸통은 낫을 따라 조금 비튼다."""
    import build
    c = action_clip(f'{root}/069/69_70.bvh', 2.6, 3.6, loop=False, face=3.05)
    build.ground(c)
    hy = c['h'][:, 1]
    k = int(np.argmin(np.abs(hy - (hy.min() + 0.10))[: int(np.argmin(hy)) + 1]))  # 바닥보다 10cm 높은 순간(덜 깊게)
    n = int(round(dur * fps))
    b = hold(c, k / (c['n'] - 1), n, dur)
    t = np.arange(n) / n
    # 긋기: 0~0.3 빠르게 오른→왼, 0.3~1 천천히 돌아옴
    s = np.where(t < 0.3, smooth01(t / 0.3), 1 - smooth01((t - 0.3) / 0.7))
    up = np.where(t < 0.3, 0.0, np.sin(np.clip((t - 0.3) / 0.7, 0, 1) * np.pi)) * 0.07
    b['h'] = b['h'].copy()
    b['h'][:, 1] += 0.006 * np.sin(2 * np.pi * t)
    b = build_turn(b, 'spine', [0, 1, 0], 0.16 * (s - 0.5) * 2)
    hR, pos = hand_pos(b, 'R')
    ft = (pos['ftL'][0] + pos['ftR'][0]) / 2
    TR = np.stack([ft[0] - 0.30 + 0.42 * s, np.full(n, 0.14) + up, ft[2] + 0.42 + 0.08 * np.sin(np.pi * s)], 1)
    pole = np.tile([-0.6, -0.5, -0.2], (n, 1))
    b = arm_ik(b, 'R', TR, pole=pole)
    TL = np.stack([np.full(n, ft[0] + 0.12), 0.24 + 0.05 * smooth01((t - 0.25) / 0.2) * (1 - smooth01((t - 0.75) / 0.25)), np.full(n, ft[2] + 0.45)], 1)
    b = arm_ik(b, 'L', TL, pole=np.tile([0.6, -0.5, -0.2], (n, 1)))
    b['ev'] = {'hit': 0.15}
    b['src'] = '69_70.bvh+합성'
    return b


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
    h['note'] = '쪼그려 낫질(합성)'
    out['harvest'] = h
    cst = cast_clip(root, idle)
    cst['note'] = '귀환 시전(서기 + 두 손 모으기)'
    out['cast'] = cst
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
