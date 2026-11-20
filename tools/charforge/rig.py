# 뼈대: MakeHuman 기본 뼈(163개)로 A자세를 게임 자세(팔 내림·손 쥠)로 바꾸고,
# 게임용 뼈(축이 세계축과 같은 16+개)로 가중치를 모은다.
import numpy as np
from mhbase import skeleton, weights as mh_weights
from human import joints

SK = skeleton()
BONES = SK['bones']
ORDER = []
def _walk(b):
    ORDER.append(b)
    for c, d in BONES.items():
        if d['parent'] == b:
            _walk(c)
_walk('root')
BI = {b: i for i, b in enumerate(ORDER)}

def rot_between(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    s = np.linalg.norm(v)
    if s < 1e-9:
        return np.eye(3)
    k = v / s
    return axis_angle(k, np.arctan2(s, c))

def axis_angle(k, ang):
    k = np.asarray(k, float)
    k = k / np.linalg.norm(k)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K

def heads_tails(V):
    J = joints(V)
    H = {b: J[d['head']] for b, d in BONES.items()}
    T = {b: J[d['tail']] for b, d in BONES.items()}
    return J, H, T

def plane_normal(J, b):
    a, c, d = (J[k] for k in SK['planes'][BONES[b]['rotation_plane']])
    n = np.cross(c - a, d - a)
    return n / np.linalg.norm(n)

def transforms(H, rots):
    """rots: 뼈 → 3x3(쉬는 자세의 세계 좌표 기준, 뼈 머리를 축으로). 반환: 뼈 → 4x4"""
    M = {}
    for b in ORDER:
        R = rots.get(b, np.eye(3))
        h = H[b]
        L = np.eye(4)
        L[:3, :3] = R
        L[:3, 3] = h - R @ h
        p = BONES[b]['parent']
        M[b] = (M[p] @ L) if p else L
    return M

_W = None
def weight_matrix(n):
    global _W
    if _W is not None and _W.shape[0] == n:
        return _W
    W = np.zeros((n, len(ORDER)), np.float32)
    for b, lst in mh_weights().items():
        if b not in BI:
            continue
        a = np.array(lst, float)
        idx = a[:, 0].astype(int)
        ok = idx < n
        W[idx[ok], BI[b]] += a[ok, 1]
    s = W.sum(1, keepdims=True)
    W = np.where(s > 0, W / np.maximum(s, 1e-9), 0)
    _W = W
    return W

def lbs(V, M):
    W = weight_matrix(len(V))
    out = np.zeros_like(V)
    Vh = np.concatenate([V, np.ones((len(V), 1))], 1)
    for b, i in BI.items():
        w = W[:, i]
        nz = w > 0
        if not nz.any():
            continue
        out[nz] += w[nz, None] * (Vh[nz] @ M[b].T)[:, :3]
    s = W.sum(1)
    out[s == 0] = V[s == 0]
    return out

def descendants(b):
    out = [b]
    for c, d in BONES.items():
        if d['parent'] == b:
            out += descendants(c)
    return out

def game_pose(V, grip='R', arm_out_deg=12.0, leg_in_deg=3.0, relax=0.35):
    """A자세 → 게임 쉬는 자세. MakeHuman .L(+x)을 게임 R(해부학적 왼쪽)…이 아니라
    여기서는 해부학 그대로 둔다: .L = 캐릭터 왼손(+x), .R = 오른손(-x). grip은 도구 쥐는 손."""
    J, H, T = heads_tails(V)
    rots = {}
    for s, sx in (('L', 1), ('R', -1)):
        up = H[f'lowerarm01.{s}'] - H[f'upperarm01.{s}']
        a = np.radians(arm_out_deg)
        want = np.array([sx * np.sin(a), -np.cos(a), 0.03])
        Rs = rot_between(up, want)
        # 어깨를 아주 조금 내린다(긴장 풀린 어깨)
        rots[f'clavicle.{s}'] = axis_angle([0, 0, 1], -sx * np.radians(4))
        rots[f'upperarm01.{s}'] = Rs
        # 팔꿈치: 아래팔을 위팔 방향으로 펴되 살짝(8°) 굽힘
        fa = T[f'lowerarm02.{s}'] - H[f'lowerarm01.{s}']
        axis = np.cross(fa, up)
        ang = np.arccos(np.clip(np.dot(fa, up) / np.linalg.norm(fa) / np.linalg.norm(up), -1, 1))
        rots[f'lowerarm01.{s}'] = axis_angle(axis, ang - np.radians(8))
        # 손가락 말기: 쥐는 손은 주먹(도구 자루), 다른 손은 편하게
        g = grip == s
        curl = [(1.05, 1.35, 0.8)] if g else [(0.35 + relax * 0.3, 0.55 + relax * 0.3, 0.3 + relax * 0.2)]
        c1, c2, c3 = curl[0]
        for f in range(2, 6):
            nrm = plane_normal(J, f'finger{f}-1.{s}')
            spread = 1.0 + 0.08 * (f - 2)
            for seg, c in ((1, c1), (2, c2), (3, c3)):
                rots[f'finger{f}-{seg}.{s}'] = axis_angle(nrm, -c * spread)
        nrm = plane_normal(J, f'finger1-1.{s}')
        tc = (0.35, 0.5, 0.45) if g else (0.12, 0.2, 0.2)
        for seg, c in zip((1, 2, 3), tc):
            rots[f'finger1-{seg}.{s}'] = axis_angle(nrm, -c)
        # 다리: 살짝 모은다
        rots[f'upperleg01.{s}'] = axis_angle([0, 0, 1], -sx * np.radians(leg_in_deg))
    return rots, J, H, T

# 게임 뼈: 이름, 부모, 위치를 정하는 MakeHuman 관절, 가중치를 모을 MakeHuman 뼈들
def game_bones(H):
    G = [
        ('hips', None, H['spine05'], ['root', 'spine05', 'spine04', 'pelvis.L', 'pelvis.R']),
        ('spine', 'hips', H['spine03'], ['spine03', 'spine02']),
        ('chest', 'spine', H['spine01'], ['spine01', 'breast.L', 'breast.R']),
        ('neck', 'chest', H['neck01'], ['neck01', 'neck02']),
        ('head', 'neck', H['head'], ['neck03', 'head', 'jaw', 'eye.L', 'eye.R', 'tongue00', 'tongue01', 'tongue02', 'tongue03', 'tongue04',
                                     'tongue05.L', 'tongue05.R', 'tongue06.L', 'tongue06.R', 'tongue07.L', 'tongue07.R'] + [b for b in BONES if b.startswith(('levator', 'oculi', 'oris', 'orbicularis', 'risorius', 'temporalis', 'special'))]),
    ]
    for s, gs in (('R', 'R'), ('L', 'L')):
        G += [
            (f'clav{gs}', 'chest', H[f'clavicle.{s}'], [f'clavicle.{s}', f'shoulder01.{s}']),
            (f'sh{gs}', f'clav{gs}', H[f'upperarm01.{s}'], [f'upperarm01.{s}', f'upperarm02.{s}']),
            (f'el{gs}', f'sh{gs}', H[f'lowerarm01.{s}'], [f'lowerarm01.{s}', f'lowerarm02.{s}']),
            (f'hand{gs}', f'el{gs}', H[f'wrist.{s}'], [f'wrist.{s}'] + [b for b in BONES if b.endswith('.' + s) and b.startswith(('finger', 'metacarpal'))]),
            (f'th{gs}', 'hips', H[f'upperleg01.{s}'], [f'upperleg01.{s}', f'upperleg02.{s}']),
            (f'kn{gs}', f'th{gs}', H[f'lowerleg01.{s}'], [f'lowerleg01.{s}', f'lowerleg02.{s}']),
            (f'ft{gs}', f'kn{gs}', H[f'foot.{s}'], [f'foot.{s}'] + [b for b in BONES if b.endswith('.' + s) and b.startswith('toe')]),
        ]
    return G

def game_weights(n, G, top=4):
    W = weight_matrix(n)
    GW = np.zeros((n, len(G)), np.float32)
    for gi, (_, _, _, src) in enumerate(G):
        for b in src:
            if b in BI:
                GW[:, gi] += W[:, BI[b]]
    # 4개만 남기고 합 1
    idx = np.argsort(-GW, axis=1)[:, :top]
    w = np.take_along_axis(GW, idx, 1)
    w = np.where(w < 0.02, 0, w)
    s = w.sum(1, keepdims=True)
    w = np.where(s > 0, w / np.maximum(s, 1e-9), 0)
    idx = np.where(w > 0, idx, 0)
    return idx, w, GW
