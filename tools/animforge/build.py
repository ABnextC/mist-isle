# 게임 동작 묶음 만들기: CMU 모션 캡처에서 서기·걷기·달리기를 골라 게임 뼈대로 옮겨 client/assets/anim/clips.json 으로 낸다.
# v0.4.7: 정속 달리기(16_46)·가만히 서기(77_02), 이음매 높이 맞춤, 달리기 위상 비틀기, 발 붙이기 IK, 서기 방향 맞춤.
# 실행: python3 tools/animforge/build.py <CMU BVH 폴더(data/)>   (예: CMU 미러 저장소 data/)
# 원본: CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH 변환 Bruce Hahne(cgspeed). 사용 제한 없음.
import sys, os, json
import numpy as np
from bvh import parse, fk
from retarget import retarget, BONES, nrm

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/mocap/cmu/data'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'client', 'assets', 'anim', 'clips.json')
REST = {b['name']: b['pos'] for b in json.load(open(os.path.join(HERE, '..', '..', 'client', 'assets', 'char', 'pioneer_m.json')))['bones']}
FPS = 30
RUN = os.environ.get('RUN', '016/16_46')
IDLE = os.environ.get('IDLE', '077/77_02')
IDLE_T0 = float(os.environ.get('IDLE_T0', '0'))
IDLE_T1 = float(os.environ.get('IDLE_T1', '99'))
RUN_FOOT = os.environ.get('RUN_FOOT', 'RightFoot')
# 게임 달리기 5m/s에서 1분에 약 190걸음이 되게(원본 그대로면 210걸음으로 너무 잦다)
RUN_STRIDE = float(os.environ.get('RUN_STRIDE', '3.15'))
CYCLE_FPS = 60
OUT = os.environ.get('OUT', OUT)


def qmul(a, b):
    x1, y1, z1, w1 = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    x2, y2, z2, w2 = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2], -1)


def qinv(q):
    return q * np.array([-1, -1, -1, 1.0])


def qpow(q, t):
    """단위 쿼터니언의 t제곱(회전각 × t)"""
    q = np.where(q[..., 3:4] < 0, -q, q)
    w = np.clip(q[..., 3], -1, 1)
    ang = np.arccos(w)
    s = np.sin(ang)
    axis = np.where(s[..., None] > 1e-8, q[..., :3] / np.maximum(s[..., None], 1e-8), 0.0)
    na = ang * np.asarray(t)
    return np.concatenate([axis * np.sin(na)[..., None], np.cos(na)[..., None]], -1)


def slerp(a, b, t):
    d = (a * b).sum(-1, keepdims=True)
    b = np.where(d < 0, -b, b)
    return qmul(a, qpow(qmul(qinv(a), b), t))


def sample(L, H, f0, f1, n):
    """120fps 원본 [f0, f1)을 n장으로(쿼터니언 보간)"""
    ts = f0 + (f1 - f0) * np.arange(n) / n
    i0 = np.floor(ts).astype(int)
    fr = ts - i0
    q = {b: slerp(L[b][i0], L[b][i0 + 1], fr) for b in BONES}
    h = H[i0] * (1 - fr[:, None]) + H[i0 + 1] * fr[:, None]
    return q, h


def loop_fix(q, f_end_q):
    """끝 자세(f_end_q)가 첫 장과 같아지게 차이를 고르게 나눠 지운다"""
    n = len(next(iter(q.values())))
    out = {}
    for b, Q in q.items():
        delta = qmul(f_end_q[b], qinv(Q[0]))  # 처음→끝 어긋남
        t = np.arange(n) / n
        corr = qpow(np.broadcast_to(qinv(delta), Q.shape), t)
        out[b] = qmul(corr, Q)
    return out


def heading_of(P, f0, f1):
    d = P['Hips'][f1] - P['Hips'][f0]
    return float(np.arctan2(d[0], d[2]))


def strikes(P, heading, foot='LeftFoot'):
    fwd = np.array([np.sin(heading), 0, np.cos(heading)])
    rel = (P[foot] - P['Hips']) @ fwd
    w = 12
    return [i for i in range(w, len(rel) - w) if rel[i] == rel[i - w:i + w + 1].max() and rel[i] > np.percentile(rel, 60)]


def cycle_clip(path, pick=0, amp=None, fps=60, foot='LeftFoot'):
    """한 주기를 자른다. foot 발이 가장 앞에 나간 순간부터 다음 같은 순간까지 자르고,
    위상 0은 늘 왼발이 가장 앞에 나간 순간으로 맞춘다(걷기·달리기를 같은 위상으로 섞으려고)"""
    J, D, dt = parse(path)
    P, _ = fk(J, D)
    P = {k: v[1:] for k, v in P.items()}
    hd = heading_of(P, 0, len(P['Hips']) - 1)
    pk = strikes(P, hd, foot)
    f0, f1 = pk[pick], pk[pick + 1]
    r = retarget(path, REST, heading=hd)
    L = r['L']
    H = r['hips']
    n = max(8, int(round((f1 - f0) * dt * fps)))
    q, h = sample(L, H, f0, f1, n)
    end_q = {b: L[b][f1:f1 + 1] for b in BONES}
    q = loop_fix(q, {b: end_q[b][0] for b in BONES})
    disp = (H[f1] - H[f0])
    stride = float(np.linalg.norm(disp[[0, 2]]) * r['scale'])
    # 제자리: 앞뒤·좌우 직선 흐름을 빼고 출렁임만 남긴다
    t = np.arange(n)[:, None] / n
    hh = (h - H[f0] - disp * t) * r['scale']
    # 높이도 처음·끝이 이어지게 어긋남을 고르게 지운다(이음매에서 몸이 툭 떨어지지 않게)
    hh[:, 1] = (h[:, 1] - disp[1] * t[:, 0] - r['ref']['Hips'][1]) * r['scale']
    hh[:, [0, 2]] -= hh[:, [0, 2]].mean(0)
    if amp:
        for b, k in amp.items():
            q[b] = qpow(q[b], k)
    if foot != 'LeftFoot':
        fl = [i for i in strikes(P, hd) if f0 < i < f1]
        if fl:
            k = int(round((fl[0] - f0) / (f1 - f0) * n)) % n
            q = {b: np.roll(Q, -k, axis=0) for b, Q in q.items()}
            hh = np.roll(hh, -k, axis=0)
    return dict(q=q, h=hh, n=n, stride=stride, dur=(f1 - f0) * dt, src=os.path.basename(path), win=[round(f0 * dt, 3), round(f1 * dt, 3)])


def yaw_fix(q, h):
    """엉덩이 앞 방향의 평균이 +z가 되게 온몸을 돌린다(서기 원본은 T자와 다른 쪽을 보고 서 있다)"""
    from retarget import quat_to_mat
    M = quat_to_mat(q['hips'])
    yaw = np.arctan2(M[:, 0, 2], M[:, 2, 2])
    psi = float(np.arctan2(np.sin(yaw).mean(), np.cos(yaw).mean()))
    rq = np.array([0, np.sin(-psi / 2), 0, np.cos(-psi / 2)])
    q = dict(q)
    q['hips'] = qmul(np.broadcast_to(rq, q['hips'].shape), q['hips'])
    c, s_ = np.cos(-psi), np.sin(-psi)
    h = h.copy()
    x, z = h[:, 0].copy(), h[:, 2].copy()
    h[:, 0] = c * x + s_ * z
    h[:, 2] = -s_ * x + c * z
    return q, h, float(np.degrees(psi)), float(np.degrees(np.ptp(np.unwrap(yaw))))


def idle_clip(path, t0, t1, lo=4.0, hi=8.0):
    """조용한 구간에서 처음·끝이 닮고, 몸이 덜 돌고, 발이 안 움직이는 창을 골라 고리로"""
    J, D, dt = parse(path)
    P, _ = fk(J, D)
    P = {k: v[1:] for k, v in P.items()}
    r = retarget(path, REST, heading=None)
    L, H = r['L'], r['hips']
    a0, a1 = int(t0 / dt), min(len(H) - 1, int(t1 / dt))
    feat = np.concatenate([L[b] for b in ('hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'thL', 'thR')], 1)
    Mh = r['G']['hips']
    yaw = np.unwrap(np.arctan2(Mh[:, 0, 2], Mh[:, 2, 2]))
    feet = np.concatenate([P['LeftFoot'][:, [0, 2]], P['RightFoot'][:, [0, 2]]], 1) * r['scale']
    best = None
    st = 6
    for i in range(a0, a1 - int(lo / dt), st):
        for j in range(i + int(lo / dt), min(a1, i + int(hi / dt)), st):
            pose = np.abs(np.abs((feat[i].reshape(-1, 4) * feat[j].reshape(-1, 4)).sum(1)) - 1).sum()
            seg = slice(i, j + 1)
            ys = np.degrees(np.ptp(yaw[seg]))
            fm = np.abs(feet[seg] - feet[i]).max()
            dd = pose + 0.02 * np.linalg.norm(H[i] - H[j]) + 0.002 * ys + (0.5 if fm > 0.04 else 0) + 0.3 * np.abs(feet[j] - feet[i]).max()
            if best is None or dd < best[0]:
                best = (dd, i, j, ys, fm)
    _, f0, f1, ys, fm = best
    n = int(round((f1 - f0) * dt * FPS))
    q, h = sample(L, H, f0, f1, n)
    q = loop_fix(q, {b: L[b][f1] for b in BONES})
    t = np.arange(n)[:, None] / n
    disp = H[f1] - H[f0]
    hh = (h - H[f0] - disp * t) * r['scale']
    hh[:, 1] = (h[:, 1] - disp[1] * t[:, 0] - r['ref']['Hips'][1]) * r['scale']
    hh[:, [0, 2]] -= hh[:, [0, 2]].mean(0)
    q, hh, psi, yr = yaw_fix(q, hh)
    return dict(q=q, h=hh, n=n, stride=0.0, dur=(f1 - f0) * dt, src=os.path.basename(path),
                win=[round(f0 * dt, 2), round(f1 * dt, 2)], info=dict(turned=round(psi, 1), yaw_range=round(yr, 1), feet_move_cm=round(fm * 100, 1)))


def soles(q, h):
    """발바닥(뒤꿈치·앞꿈치) 중 낮은 점의 높이 — 발마다"""
    from retarget import PARENT, quat_to_mat
    G, pos = {}, {}
    for b in BONES:
        p = PARENT[b]
        Ml = quat_to_mat(q[b])
        if p is None:
            G[b] = Ml
            pos[b] = np.array(REST['hips']) + h
        else:
            G[b] = G[p] @ Ml
            pos[b] = pos[p] + np.einsum('fij,j->fi', G[p], np.array(REST[b]) - np.array(REST[p]))
    out = {}
    for s_ in 'LR':
        f = 'ft' + s_
        heel = pos[f] + np.einsum('fij,j->fi', G[f], [0, -0.088, -0.05])
        ball = pos[f] + np.einsum('fij,j->fi', G[f], [0, -0.088, 0.12])
        out[s_] = np.minimum(heel[:, 1], ball[:, 1])
    return out


def fk_full(q, h):
    from retarget import PARENT, quat_to_mat
    G, pos = {}, {}
    for b in BONES:
        p = PARENT[b]
        Ml = quat_to_mat(q[b])
        if p is None:
            G[b] = Ml
            pos[b] = np.array(REST['hips']) + h
        else:
            G[b] = G[p] @ Ml
            pos[b] = pos[p] + np.einsum('fij,j->fi', G[p], np.array(REST[b]) - np.array(REST[p]))
    return G, pos


def rot_between(a, b):
    """(F,3) a 방향을 b 방향으로 돌리는 최소 회전 행렬 (F,3,3)"""
    a = nrm(a)
    b = nrm(b)
    v = np.cross(a, b)
    c = (a * b).sum(-1)
    K = np.zeros((len(a), 3, 3))
    K[:, 0, 1], K[:, 0, 2], K[:, 1, 2] = -v[:, 2], v[:, 1], -v[:, 0]
    K[:, 1, 0], K[:, 2, 0], K[:, 2, 1] = v[:, 2], -v[:, 1], v[:, 0]
    f = (1 / np.maximum(1 + c, 1e-6))[:, None, None]
    return np.eye(3)[None] + K + K @ K * f


def plant(c, reach=0.03, soft=0.035):
    """딛는 발바닥이 땅(y=0)에 붙게 발마다 높이를 고치고 다리 두 마디 IK로 맞춘다(발 방향은 그대로).
    옮긴 뼈대는 다리 좌우가 조금 달라 한 발은 땅에 묻히고 한 발은 떠 있었다."""
    from retarget import PARENT, mat_to_quat
    q, h, n = c['q'], c['h'], c['n']
    G, pos = fk_full(q, h)
    fix = {}
    for s_ in 'LR':
        th, kn, ft = 'th' + s_, 'kn' + s_, 'ft' + s_
        heel = pos[ft] + np.einsum('fij,j->fi', G[ft], [0, -0.088, -0.05])
        ball = pos[ft] + np.einsum('fij,j->fi', G[ft], [0, -0.088, 0.12])
        y = np.minimum(heel[:, 1], ball[:, 1])
        st = y < y.min() + reach
        dy = np.where(st, -y, 0.0)
        m = max(1, int(round(soft * n)))
        ker = np.hanning(2 * m + 3)[1:-1]
        ker /= ker.sum()
        # 딛는 구간 경계에서 툭 끊기지 않게: 구간을 넓혀 매끈히 이어 붙인다
        wide = np.convolve(np.concatenate([st[-m:], st, st[:m]]).astype(float), ker, 'valid')
        val = np.convolve(np.concatenate([dy[-m:], dy, dy[:m]]), ker, 'valid')
        cnt = np.convolve(np.concatenate([st[-m:], st, st[:m]]).astype(float), ker, 'valid')
        dy = np.where(st, -y, np.where(cnt > 1e-6, val / np.maximum(cnt, 1e-6), 0.0) * np.clip(wide * 2, 0, 1))
        A, B, C = pos[th], pos[kn], pos[ft]
        C2 = C + np.stack([np.zeros(n), dy, np.zeros(n)], 1)
        l1 = np.linalg.norm(B - A, axis=1)
        l2 = np.linalg.norm(C - B, axis=1)
        d = np.clip(np.linalg.norm(C2 - A, axis=1), np.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
        u = nrm(C2 - A)
        pole = (B - A) - ((B - A) * u).sum(1, keepdims=True) * u
        pole = nrm(pole)
        ca = np.clip((l1 ** 2 + d ** 2 - l2 ** 2) / (2 * l1 * d), -1, 1)
        B2 = A + u * (l1 * ca)[:, None] + pole * (l1 * np.sqrt(1 - ca ** 2))[:, None]
        C2 = A + u * d[:, None]
        R1 = rot_between(B - A, B2 - A)
        Gth = R1 @ G[th]
        R2 = rot_between(np.einsum('fij,fj->fi', R1, C - B), C2 - B2)
        Gkn = R2 @ R1 @ G[kn]
        Gp = G[PARENT[th]]
        fix[th] = mat_to_quat(np.transpose(Gp, (0, 2, 1)) @ Gth)
        fix[kn] = mat_to_quat(np.transpose(Gth, (0, 2, 1)) @ Gkn)
        fix[ft] = mat_to_quat(np.transpose(Gkn, (0, 2, 1)) @ G[ft])
        c.setdefault('plant', {})[s_] = [round(float(dy.min() * 100), 1), round(float(dy.max() * 100), 1)]
    q2 = dict(q)
    q2.update(fix)
    return dict(c, q=q2)


def _frame_to(r_rest, x_rest, r_world, x_world):
    """쉬는 자세의 뼈 방향 r_rest와 경첩 x_rest를 세계의 r_world·x_world로 옮기는 회전 (F,3,3)"""
    def basis(r, x):
        a1 = nrm(r)
        a2 = nrm(x - (x * a1).sum(-1, keepdims=True) * a1)
        return np.stack([a1, a2, np.cross(a1, a2)], -1)
    Fr = basis(np.broadcast_to(r_rest, r_world.shape), np.broadcast_to(x_rest, x_world.shape))
    Fw = basis(r_world, x_world)
    return Fw @ np.transpose(Fr, (0, 2, 1))


def fix_legs(c, info=None):
    """다리 비틀림·무릎 방향 바로잡기(v0.4.10).
    옮긴 동작 일부(79_01)는 넓적다리·정강이가 제 축으로 180° 돌고 발이 거꾸로 되돌려 앞을 봤다.
    세계 위치는 맞아 보여도 피부가 엉덩이·발목에서 꼬여 허벅지가 깨져 보였고, 무릎은 뒤로 접혔다.
    엉덩이·발목 자리와 발 방향은 그대로 두고, 무릎은 늘 앞(엉덩이·발끝 쪽)으로 굽게 두 마디 IK로 다시 풀며
    비틀림은 무릎 경첩 면에서 정한다."""
    from retarget import PARENT, mat_to_quat
    q, h, n = c['q'], c['h'], c['n']
    G, pos = fk_full(q, h)
    fix = {}
    rep = {}
    ex = np.array([1.0, 0, 0])
    for s_ in 'LR':
        th, kn, ft = 'th' + s_, 'kn' + s_, 'ft' + s_
        r1 = np.array(REST[kn]) - np.array(REST[th])
        r2 = np.array(REST[ft]) - np.array(REST[kn])
        l1, l2 = np.linalg.norm(r1), np.linalg.norm(r2)
        H, K, A = pos[th], pos[kn], pos[ft]
        Gp, Gf = G[PARENT[th]], G[ft]
        lk = (c.get('lock') or {}).get(s_)
        if lk is not None:
            # 제자리 동작: 발을 한 장(lk)의 자리·방향에 묶는다(곡괭이질 중 발을 옮겨 다리가 엇갈리던 것)
            A = np.broadcast_to(A[lk], A.shape).copy()
            Gf = np.broadcast_to(Gf[lk], Gf.shape).copy()
        D = np.clip(np.linalg.norm(A - H, axis=1), abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
        d = nrm(A - H)
        # 무릎이 갈 쪽(앞): 엉덩이 앞과 발끝 앞을 섞어 엉덩이-발목 선에 수직으로
        f = nrm(0.4 * Gp[:, :, 2] + 0.6 * Gf[:, :, 2])
        fp = f - (f * d).sum(1, keepdims=True) * d
        fp = nrm(fp + 1e-6 * np.cross(d, ex))
        po = (K - H) - ((K - H) * d).sum(1, keepdims=True) * d
        m = np.linalg.norm(po, axis=1)
        back = (po * fp).sum(1) < 0
        pn = nrm(np.where(back[:, None], -po, po) + 1e-9)
        w = np.clip((m - 0.01) / 0.03, 0, 1)
        w = w * w * (3 - 2 * w)
        if lk is not None:
            w = np.zeros(n)  # 발을 묶으면 원래 무릎 자리는 다른 발목에 맞춘 것이라 쓰지 않는다
        pole = nrm(w[:, None] * pn + (1 - w)[:, None] * fp)
        pole = nrm(pole - (pole * d).sum(1, keepdims=True) * d)
        ca = np.clip((l1 ** 2 + D ** 2 - l2 ** 2) / (2 * l1 * D), -1, 1)
        K2 = H + d * (l1 * ca)[:, None] + pole * (l1 * np.sqrt(1 - ca ** 2))[:, None]
        A2 = H + d * D[:, None]
        u, v = nrm(K2 - H), nrm(A2 - K2)
        hinge = nrm(np.cross(pole, d))
        Gth = _frame_to(r1, ex, u, hinge)
        Gkn = _frame_to(r2, ex, v, hinge)
        fix[th] = mat_to_quat(np.transpose(Gp, (0, 2, 1)) @ Gth)
        fix[kn] = mat_to_quat(np.transpose(Gth, (0, 2, 1)) @ Gkn)
        fix[ft] = mat_to_quat(np.transpose(Gkn, (0, 2, 1)) @ Gf)
        rep[s_] = dict(back=int((back & (m > 0.01)).sum()), moved=round(float(np.linalg.norm(K2 - K, axis=1).max() * 100), 1))
    q2 = dict(q)
    q2.update(fix)
    if info is not None:
        info.update(rep)
    return dict(c, q=q2, legfix=rep)


def _twist_angle(R, axis):
    """회전 행렬 R(F,3,3)의 axis(지역) 둘레 비틀림 각(라디안)"""
    from retarget import mat_to_quat
    qq = mat_to_quat(R)
    a = np.asarray(axis, float)
    p = (qq[:, :3] @ a)
    ang = 2 * np.arctan2(p, qq[:, 3])
    return (ang + np.pi) % (2 * np.pi) - np.pi


def _axis_rot(axis, ang):
    """지역 축 axis 둘레 ang(F,) 회전 행렬 (F,3,3)"""
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    s_, c_ = np.sin(ang)[:, None, None], np.cos(ang)[:, None, None]
    return np.eye(3)[None] + s_ * K[None] + (1 - c_) * (K @ K)[None]


def fix_arms(c):
    """팔 비틀림 바로잡기(v0.4.10).
    손끝 IK로 만든 동작은 손 방향을 세계에 붙든 채 팔만 옮겨 손목이 100~150° 비틀리고(소매·손목 살이 꼬임),
    아래팔도 팔꿈치에서 통째로 돌았다. 어깨·팔꿈치·손목 자리와 손 방향은 그대로 두고,
    위팔 비틀림은 팔꿈치 경첩 면에서 정하고, 아래팔 돌림(엎침·뒤침)은 팔꿈치와 손목이 반씩 나눠 진다.
    팔꿈치가 뒤로 꺾인 장은 어깨-손목 선 너머로 뒤집어 앞으로 굽힌다."""
    from retarget import PARENT, mat_to_quat
    q, h, n = c['q'], c['h'], c['n']
    G, pos = fk_full(q, h)
    fix = {}
    rep = {}
    ex = np.array([1.0, 0, 0])
    for s_ in 'LR':
        sh, el, hd = 'sh' + s_, 'el' + s_, 'hand' + s_
        r1 = np.array(REST[el]) - np.array(REST[sh])
        r2 = np.array(REST[hd]) - np.array(REST[el])
        l1, l2 = np.linalg.norm(r1), np.linalg.norm(r2)
        S, E, Hd = pos[sh], pos[el], pos[hd]
        Gp, Gh = G[PARENT[sh]], G[hd]
        D = np.clip(np.linalg.norm(Hd - S, axis=1), abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
        d = nrm(Hd - S)
        # 팔꿈치가 갈 쪽: 원래 위팔 뼈의 뒤(-z)를 어깨-손목 선에 수직으로(팔은 굽히면 팔꿈치가 몸 뒤·바깥으로 간다)
        back_ref = -G[sh][:, :, 2]
        bp = nrm(back_ref - (back_ref * d).sum(1, keepdims=True) * d + 1e-6 * np.cross(d, ex))
        po = (E - S) - ((E - S) * d).sum(1, keepdims=True) * d
        m = np.linalg.norm(po, axis=1)
        # 굽힘 방향 검사: 아래팔이 위팔의 앞(+z, 원래 위팔 뼈 기준)으로 가야 정상
        u0, v0 = nrm(E - S), nrm(Hd - E)
        fwd = (np.einsum('fji,fj->fi', G[sh], v0))[:, 2]
        bend = np.degrees(np.arccos(np.clip((u0 * v0).sum(1), -1, 1)))
        hyper = np.zeros(n, bool)
        pn = nrm(po + 1e-9)
        w = np.clip((m - 0.01) / 0.03, 0, 1)
        w = w * w * (3 - 2 * w)
        pole = nrm(w[:, None] * pn + (1 - w)[:, None] * bp)
        pole = nrm(pole - (pole * d).sum(1, keepdims=True) * d)
        ca = np.clip((l1 ** 2 + D ** 2 - l2 ** 2) / (2 * l1 * D), -1, 1)
        E2 = S + d * (l1 * ca)[:, None] + pole * (l1 * np.sqrt(1 - ca ** 2))[:, None]
        H2 = S + d * D[:, None]
        u, v = nrm(E2 - S), nrm(H2 - E2)
        # 팔꿈치 굽힘은 위팔 지역 -x 둘레 양의 회전 → 위팔 +x = -(u×v) 쪽. 곧은 팔은 원래 위팔 +x를 쓴다
        hinge_bent = nrm(np.cross(d, pole))  # 위팔 +x = -(u×v) = d×pole (팔꿈치가 pole 쪽으로 나갈 때)
        x_orig = G[sh][:, :, 0]
        x_orig = nrm(x_orig - (x_orig * u).sum(1, keepdims=True) * u + 1e-6 * hinge_bent)
        xa = nrm(w[:, None] * hinge_bent + (1 - w)[:, None] * x_orig)
        Gsh = _frame_to(r1, ex, u, xa)
        Gel0 = _frame_to(r2, ex, v, xa)
        # 아래팔 돌림: 손 방향을 지키며 팔꿈치·손목이 반씩
        rf = r2 / l2
        Lh = np.transpose(Gel0, (0, 2, 1)) @ Gh
        tau = _twist_angle(Lh, rf)
        # 아래팔 돌림은 ±110°까지(사람 팔의 엎침·뒤침 폭). 넘치는 몫은 손을 되돌린다 — 든 것의 방향은
        # 클립 도구 트랙·두 손 선으로 따로 정하므로 손등 돌림만 바뀐다
        tc = np.clip(tau, -np.radians(110), np.radians(110))
        Gh = Gel0 @ _axis_rot(rf, tc - tau) @ Lh
        tau = tc
        Gel = Gel0 @ _axis_rot(rf, 0.5 * tau)
        fix[sh] = mat_to_quat(np.transpose(Gp, (0, 2, 1)) @ Gsh)
        fix[el] = mat_to_quat(np.transpose(Gsh, (0, 2, 1)) @ Gel)
        fix[hd] = mat_to_quat(np.transpose(Gel, (0, 2, 1)) @ Gh)
        rep[s_] = dict(hyper=int(hyper.sum()), tw=int(np.degrees(np.abs(tau)).max()), moved=round(float(np.linalg.norm(E2 - E, axis=1).max() * 100), 1))
    q2 = dict(q)
    q2.update(fix)
    return dict(c, q=q2, armfix=rep)


def resample(c, n_out, target=None):
    """고리 클립을 n_out장으로 다시 뽑는다.
    target(한 주기 보폭)이 있으면 딛는 동안은 빠르게·떠 있는 동안은 느리게 위상을 비틀어
    발이 미끄러지지 않으면서 보폭이 target이 되게 한다(같은 속도에서 걸음이 덜 잦아진다)."""
    q, h, n = c['q'], c['h'], c['n']
    w = np.ones(n)
    if target:
        k = target / c['stride']
        so = soles(q, h)
        st = np.zeros(n, bool)
        for y in so.values():
            st |= y < y.min() + 0.03
        cf = st.mean()
        ws = 1.0 / k
        wf = (1 - cf * ws) / (1 - cf)
        w = np.where(st, ws, wf)
        m = max(1, int(round(0.035 * n)))
        ker = np.ones(2 * m + 1) / (2 * m + 1)
        w = np.convolve(np.concatenate([w[-m:], w, w[:m]]), ker, 'valid')
        c['warp'] = dict(stance=round(float(cf), 3), k=round(float(k), 3), flight_rate=round(float(1 / wf), 3))
    psi = np.concatenate([[0.0], np.cumsum(w)]) / w.sum()
    phi = np.arange(n + 1) / n
    f = np.interp(np.arange(n_out) / n_out, psi, phi) * n
    i0 = np.floor(f).astype(int) % n
    i1 = (i0 + 1) % n
    t = f - np.floor(f)
    q2 = {b: slerp(q[b][i0], q[b][i1], t) for b in BONES}
    h2 = h[i0] * (1 - t[:, None]) + h[i1] * t[:, None]
    out = dict(c, q=q2, h=h2, n=n_out)
    if target:
        out['stride'] = float(target)
    return out


def ground(c, mode='const'):
    """딛는 발이 땅(휴식 발목 높이)에 닿게 엉덩이 높이를 맞춘다"""
    from check import target_fk
    L = {b: c['q'][b] for b in BONES}
    pos = target_fk(L, c['h'])
    lo = np.minimum(pos['ftL'][:, 1], pos['ftR'][:, 1])
    rest = REST['ftL'][1]
    c['h'][:, 1] -= np.percentile(lo, 10) - rest
    return c


def pack(c):
    q = np.stack([c['q'][b] for b in BONES], 1)  # (n, 19, 4)
    out = {'n': int(c['n']), 'dur': round(float(c['dur']), 4), 'stride': round(float(c['stride']), 4), 'src': c['src'],
           'q': [round(float(x), 3) for x in q.reshape(-1)], 'h': [round(float(x), 4) for x in c['h'].reshape(-1)]}
    if 'loop' in c:
        out['loop'] = bool(c['loop'])
    if c.get('ev'):
        out['ev'] = c['ev']
    if c.get('td') is not None:
        # 손에 든 것의 자루 방향(뿌리 공간, 장마다), 날 면 방향, 붙는 손
        out['td'] = [round(float(x), 3) for x in np.asarray(c['td']).reshape(-1)]
        out['tn'] = [round(float(x), 3) for x in c['tn']]
        out['to'] = c['to']
    return out


if __name__ == '__main__':
    clips = {}
    clips['idle'] = idle_clip(f'{ROOT}/{IDLE}.bvh', IDLE_T0, IDLE_T1)
    walk = cycle_clip(f'{ROOT}/035/35_01.bvh', pick=0, fps=600)
    run = cycle_clip(f'{ROOT}/{RUN}.bvh', pick=0, foot=RUN_FOOT, fps=600)
    clips['walk'] = resample(walk, int(round(walk['dur'] * CYCLE_FPS)))
    clips['run'] = resample(run, int(round(run['dur'] * CYCLE_FPS)), RUN_STRIDE)
    for k in ('walk', 'run'):
        ground(clips[k])
        clips[k] = plant(clips[k])
    # 손 동작(v0.4.8): 채집·전투·시전
    from actions import build_actions
    for k, c in build_actions(ROOT, clips['idle']).items():
        clips[k] = c
    # 다리 비틀림·무릎 방향 바로잡기(v0.4.10): 모든 동작 마지막에
    for k in list(clips):
        clips[k] = fix_arms(fix_legs(clips[k]))
    for k, c in clips.items():
        print(k, 'frames', c['n'], 'dur', round(c['dur'], 3), 'stride', round(c['stride'], 3), c.get('win', ''), c.get('warp', ''), c.get('plant', ''), c.get('info', ''), c.get('ev', ''), c.get('straightened', ''), c.get('legfix', ''), c.get('armfix', ''), 'hips y', np.round(c['h'][:, 1].min(), 3), np.round(c['h'][:, 1].max(), 3))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    data = {'fps': FPS, 'bones': BONES, 'clips': {k: pack(c) for k, c in clips.items()},
            'credit': 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH: Bruce Hahne (cgspeed)'}
    json.dump(data, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
