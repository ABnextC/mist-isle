# 1단계: 체형 → 게임 자세 → 미터 단위, 게임 뼈·가중치, 몸 삼각형
import numpy as np
from human import build, base, race_units
from meshutil import triangulate, vertex_normals
from rig import game_pose, transforms, lbs, game_bones, game_weights, BONES

def make_body(preset, sole=0.0):
    V0, VT, F, G = base()
    V = build(preset)
    rots, J, H, Tl = game_pose(V)
    M = transforms(H, rots)
    P = lbs(V, M)
    # 뼈 머리의 새 위치: 자기 뼈는 머리를 축으로 돌므로 부모 변환을 쓰면 된다
    Hp = {}
    for b in BONES:
        par = BONES[b]['parent']
        h = np.append(H[b], 1.0)
        Hp[b] = ((M[par] @ h) if par else h)[:3]
    keep = np.array([g == 'body' for g in G])
    T, TT, src = triangulate(F, keep)
    bodyIdx = np.unique(T)
    y0 = P[bodyIdx, 1].min()
    off = np.array([0.0, y0, 0.0])
    S = 0.1
    Pm = (P - off) * S
    Pm[:, 1] += sole
    Hm = {b: (h - off) * S + [0, sole, 0] for b, h in Hp.items()}
    tips = {}
    for side in ('L', 'R'):
        for f in range(1, 6):
            b = f'finger{f}-3.{side}'
            tl = np.append(Tl[b], 1.0)
            tips[f'{f}{side}'] = ((M[b] @ tl)[:3] - off) * S + [0, sole, 0]
    GB = game_bones(Hm)
    idx, w, GW = game_weights(len(Pm), GB)
    # 표정 단위(눈 감기·미소)는 A자세 기준 차이 → 게임 자세에서 같은 뼈 변환을 거쳐 차이로 만든다
    morphs = {}
    for key, unit in (('blinkL', 'eye-left-closure'), ('blinkR', 'eye-right-closure'), ('smile', 'mouth-corner-puller')):
        Vm = build(preset, extra=race_units(preset, unit, 1.0))
        Pmm = lbs(Vm, M)
        d = (Pmm - P) * S
        d[np.linalg.norm(d, axis=1) < 1e-6] = 0
        morphs[key] = d
    return dict(P=Pm, VT=VT, F=F, G=G, T=T, TT=TT, src=src, bones=GB, skin_idx=idx, skin_w=w, GW=GW,
                H=Hm, morphs=morphs, preset=preset, tips=tips)

def groups_of(F, G):
    out = {}
    for (vi, ti), g in zip(F, G):
        out.setdefault(g, set()).update(vi)
    return {g: np.array(sorted(s)) for g, s in out.items()}
