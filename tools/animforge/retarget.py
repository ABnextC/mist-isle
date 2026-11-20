# CMU 모션 캡처(BVH)를 게임 뼈대(19개, 휴식 자세에서 회전 0인 세계축 정렬 뼈)로 옮긴다.
# 팔다리: 뼈 방향을 그대로 맞추고(길이 차이는 무시), 접히는 축(무릎·팔꿈치)으로 비틀림을 정한다.
# 몸통·머리·발: 소스의 T자 기준 자세에 대한 상대 회전을 옮긴다(척추 곡선 차이를 지운다).
import numpy as np
from bvh import parse, fk

BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'clavR', 'shR', 'elR', 'handR', 'thR', 'knR', 'ftR',
         'clavL', 'shL', 'elL', 'handL', 'thL', 'knL', 'ftL']
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
          'clavR': 'chest', 'shR': 'clavR', 'elR': 'shR', 'handR': 'elR', 'thR': 'hips', 'knR': 'thR', 'ftR': 'knR',
          'clavL': 'chest', 'shL': 'clavL', 'elL': 'shL', 'handL': 'elL', 'thL': 'hips', 'knL': 'thL', 'ftL': 'knL'}


def nrm(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def frame(a, b):
    """주축 a(열 0)와 보조축 b(직교화, 열 1)로 회전 행렬. 셋째 열 = a × b"""
    a = nrm(a)
    b = nrm(b - (b * a).sum(-1, keepdims=True) * a)
    c = np.cross(a, b)
    return np.stack([a, b, c], -1)


def torso_frame(left, up):
    """[왼, 위, 앞] 열: 똑바로 서서 +z를 보면 단위 행렬"""
    up = nrm(up)
    left = nrm(left - (left * up).sum(-1, keepdims=True) * up)
    fwd = np.cross(left, up)
    return np.stack([left, up, fwd], -1)


def hinge_track(a, h_raw, fallback):
    """접힘 축을 프레임마다 이어 붙인다: 팔다리가 펴져 축이 불안하면 앞 프레임 축(없으면 대체 축)을 쓴다"""
    n = len(a)
    out = np.zeros_like(h_raw)
    prev = None
    for i in range(n):
        s = np.linalg.norm(h_raw[i])
        cand = h_raw[i] / s if s > 1e-6 else None
        base = prev if prev is not None else fallback[i]
        base = base - (base @ a[i]) * a[i]
        if np.linalg.norm(base) < 1e-6:
            base = fallback[i] - (fallback[i] @ a[i]) * a[i]
        base = base / max(np.linalg.norm(base), 1e-9)
        if cand is not None:
            k = np.clip((s - 0.08) / 0.22, 0, 1)  # 많이 접혔을수록 실제 축을 믿는다
            if cand @ base < 0 and k < 1:
                cand = -cand if s < 0.3 else cand
            h = nrm(base * (1 - k) + cand * k)
        else:
            h = base
        h = h - (h @ a[i]) * a[i]
        h = h / max(np.linalg.norm(h), 1e-9)
        out[i] = h
        prev = h
    return out


def mat_to_quat(M):
    """(N,3,3) → (N,4) x,y,z,w"""
    m = M
    t = m[:, 0, 0] + m[:, 1, 1] + m[:, 2, 2]
    q = np.zeros((len(m), 4))
    for i in range(len(m)):
        a = m[i]
        tr = t[i]
        if tr > 0:
            s = 0.5 / np.sqrt(tr + 1.0)
            q[i] = [(a[2, 1] - a[1, 2]) * s, (a[0, 2] - a[2, 0]) * s, (a[1, 0] - a[0, 1]) * s, 0.25 / s]
        elif a[0, 0] > a[1, 1] and a[0, 0] > a[2, 2]:
            s = 2.0 * np.sqrt(1.0 + a[0, 0] - a[1, 1] - a[2, 2])
            q[i] = [0.25 * s, (a[0, 1] + a[1, 0]) / s, (a[0, 2] + a[2, 0]) / s, (a[2, 1] - a[1, 2]) / s]
        elif a[1, 1] > a[2, 2]:
            s = 2.0 * np.sqrt(1.0 + a[1, 1] - a[0, 0] - a[2, 2])
            q[i] = [(a[0, 1] + a[1, 0]) / s, 0.25 * s, (a[1, 2] + a[2, 1]) / s, (a[0, 2] - a[2, 0]) / s]
        else:
            s = 2.0 * np.sqrt(1.0 + a[2, 2] - a[0, 0] - a[1, 1])
            q[i] = [(a[0, 2] + a[2, 0]) / s, (a[1, 2] + a[2, 1]) / s, 0.25 * s, (a[1, 0] - a[0, 1]) / s]
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    # 이웃 프레임과 같은 반구로(보간이 튀지 않게)
    for i in range(1, len(q)):
        if (q[i] * q[i - 1]).sum() < 0:
            q[i] = -q[i]
    return q


def rot_y(theta):
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def retarget(path, rest, frames=None, heading=None, ref_frame=0, clav_k=0.6, hand_k=0.0):
    """rest: 뼈 이름 → 휴식 위치(게임 몸). frames: 쓸 프레임 범위(slice). heading: 이 방향(라디안, +z 기준)을 +z로 돌린다.
    반환: dict(G: 뼈 → (F,3,3) 세계 회전, L: 뼈 → (F,4) 지역 쿼터니언, hips: (F,3) 엉덩이 위치(소스 단위), scale, fps 등)"""
    J, D, dt = parse(path)
    P, R = fk(J, D)
    ref = {k: v[ref_frame] for k, v in P.items()}
    sl = frames if frames is not None else slice(1, None)
    P = {k: v[sl] for k, v in P.items()}
    F = len(P['Hips'])
    if heading is not None:
        Ry = rot_y(-heading)
        P = {k: v @ Ry.T for k, v in P.items()}
        ref = {k: Ry @ v for k, v in ref.items()}
    # 길이 비율(다리)
    src_leg = np.linalg.norm(ref['LeftLeg'] - ref['LeftUpLeg']) + np.linalg.norm(ref['LeftFoot'] - ref['LeftLeg'])
    dst_leg = np.linalg.norm(np.array(rest['knL']) - rest['thL']) + np.linalg.norm(np.array(rest['ftL']) - rest['knL'])
    scale = dst_leg / src_leg
    up = np.array([0, 1.0, 0])

    def tf(Pp, k=None):
        left_h = Pp['LeftUpLeg'] - Pp['RightUpLeg']
        left_c = Pp['LeftArm'] - Pp['RightArm']
        # CMU 뼈대: LowerBack=Hips, Neck=LeftShoulder=Spine1 자리(길이 0). 마디는 Hips→Spine→Spine1→Neck1→Head→끝
        th = torso_frame(left_h, Pp['Spine1'] - Pp['Hips'])
        sp = torso_frame(0.5 * (nrm(left_h) + nrm(left_c)), Pp['Spine'] - Pp['Hips'])
        ch = torso_frame(left_c, Pp['Neck1'] - Pp['Spine'])
        nk = torso_frame(left_c, Pp['Head'] - Pp['Neck1'])
        hd = torso_frame(left_c, Pp['Head_end'] - Pp['Head'])
        return th, sp, ch, nk, hd
    th, sp, ch, nk, hd = tf(P)
    th0, sp0, ch0, nk0, hd0 = tf({k: v[None] for k, v in ref.items()})
    G = {}
    G['hips'] = th @ np.swapaxes(th0, -1, -2)
    G['spine'] = sp @ np.swapaxes(sp0, -1, -2)
    G['chest'] = ch @ np.swapaxes(ch0, -1, -2)
    G['neck'] = nk @ np.swapaxes(nk0, -1, -2)
    G['head'] = hd @ np.swapaxes(hd0, -1, -2)
    rest = {k: np.array(v, float) for k, v in rest.items()}
    left_h = nrm(P['LeftUpLeg'] - P['RightUpLeg'])
    left_c = nrm(P['LeftArm'] - P['RightArm'])
    for side, S in (('L', 'Left'), ('R', 'Right')):
        # 다리: 허벅지·정강이는 방향을 맞추고 무릎 접힘 축으로 비튼다
        thd = nrm(P[S + 'Leg'] - P[S + 'UpLeg'])
        shd = nrm(P[S + 'Foot'] - P[S + 'Leg'])
        hk = hinge_track(thd, np.cross(thd, shd), left_h)
        hk2 = hinge_track(shd, np.cross(thd, shd), left_h)
        a0 = nrm(rest['kn' + side] - rest['th' + side])
        b0 = np.array([1.0, 0, 0])
        G['th' + side] = frame(thd, hk) @ frame(a0, b0).T
        a1 = nrm(rest['ft' + side] - rest['kn' + side])
        G['kn' + side] = frame(shd, hk2) @ frame(a1, b0).T
        # 발: T자 기준 대비 상대 회전(발끝 방향 + 무릎 축)
        fd = nrm(P[S + 'ToeBase'] - P[S + 'Foot'])
        fd0 = nrm(ref[S + 'ToeBase'] - ref[S + 'Foot'])
        hf = hinge_track(fd, np.cross(shd, fd), hk2)
        h0 = np.cross(nrm(ref[S + 'Foot'] - ref[S + 'Leg']), fd0)
        h0 = h0 / np.linalg.norm(h0) if np.linalg.norm(h0) > 1e-6 else np.array([1.0, 0, 0])
        G['ft' + side] = frame(fd, hf) @ frame(fd0, h0).T
        # 팔: 위팔·아래팔 방향 + 팔꿈치 축
        ua = nrm(P[S + 'ForeArm'] - P[S + 'Arm'])
        fa = nrm(P[S + 'Hand'] - P[S + 'ForeArm'])
        he = hinge_track(ua, -np.cross(ua, fa), left_c)
        he2 = hinge_track(fa, -np.cross(ua, fa), left_c)
        a2 = nrm(rest['el' + side] - rest['sh' + side])
        a3 = nrm(rest['hand' + side] - rest['el' + side])
        G['sh' + side] = frame(ua, he) @ frame(a2, b0).T
        G['el' + side] = frame(fa, he2) @ frame(a3, b0).T
        # 손: 아래팔을 따른다(손목 데이터는 잡음이 많다)
        G['hand' + side] = G['el' + side]
        # 쇄골: 방향을 맞추되 가슴 회전 쪽으로 반쯤 당긴다
        cd = nrm(P[S + 'Arm'] - P[S + 'Shoulder'])
        cd0 = nrm(ref[S + 'Arm'] - ref[S + 'Shoulder'])
        Gc = frame(cd, np.tile(up, (F, 1))) @ frame(cd0, up).T
        G['clav' + side] = slerp_mat(G['chest'], Gc, clav_k)
    # 지역 회전(부모 기준). 휴식 자세 회전이 0이라 그대로 부모⁻¹·자식
    L = {}
    for b in BONES:
        p = PARENT[b]
        Mloc = G[b] if p is None else np.swapaxes(G[p], -1, -2) @ G[b]
        L[b] = mat_to_quat(Mloc)
    return dict(G=G, L=L, hips=P['Hips'], P=P, ref=ref, scale=scale, dt=dt, F=F, src_leg=src_leg)


def slerp_mat(A, B, k):
    """회전 행렬 묶음 A→B 를 k만큼(쿼터니언 보간)"""
    qa = mat_to_quat(A)
    qb = mat_to_quat(B)
    d = (qa * qb).sum(1, keepdims=True)
    qb = np.where(d < 0, -qb, qb)
    q = nrm(qa * (1 - k) + qb * k)
    return quat_to_mat(q)


def quat_to_mat(q):
    x, y, z, w = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    M = np.zeros((len(q), 3, 3))
    M[:, 0, 0] = 1 - 2 * (y * y + z * z)
    M[:, 0, 1] = 2 * (x * y - z * w)
    M[:, 0, 2] = 2 * (x * z + y * w)
    M[:, 1, 0] = 2 * (x * y + z * w)
    M[:, 1, 1] = 1 - 2 * (x * x + z * z)
    M[:, 1, 2] = 2 * (y * z - x * w)
    M[:, 2, 0] = 2 * (x * z - y * w)
    M[:, 2, 1] = 2 * (y * z + x * w)
    M[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return M
