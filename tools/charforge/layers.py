# 겹친 옷의 무게 맞추기(v0.4.10).
# 셔츠(속)와 조끼(겉)는 같은 몸 점에서 띄운 껍데기지만 무게를 따로 가다듬어(겉은 뻣뻣하게) 팔을 들거나
# 몸을 숙이면 속옷이 겉옷을 뚫고 나왔다(조끼 어깨에 흰 조각). 속옷 점에서 바깥(법선)으로 쏜 반직선이
# 가까이(dmax) 더 바깥 겹의 면에 닿으면, 그 면의 무게를 그대로 가져온다 — 두 겹이 같이 움직여 간격이 지켜진다.

import numpy as np
from scipy.spatial import cKDTree

# 재질 칸(aMat) → 겹 순서(클수록 바깥). outfit.GID + pieces.SLOT
RANK = {0: 1, 2: 1, 15: 1, 18: 1,          # 셔츠·바지·리넨 속옷·누비
        1: 2, 10: 2, 11: 2, 14: 2, 16: 2,  # 조끼·가죽·로브·가죽 갑옷·사슬
        3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 9: 3, 12: 3, 13: 3, 17: 3,  # 장화·허리띠·목수건·끈·짐·밑창·띠·두건·판금
        8: 4, 19: 4, 20: 4}                 # 쇠붙이·징·끈 매듭


def layer_sync(P, N, T, W, slot, dmax=0.025, dfull=0.012, reach=0.05, prox=0.022, pfull=0.006):
    """P,N (n,3) 묶음 자세 위치·법선, T (m,3), W (n,뼈) 무게, slot (n,) 재질 칸 → (고친 W, 바뀐 점 수)"""
    P = np.asarray(P, np.float64)
    N = np.asarray(N, np.float64)
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    T = np.asarray(T, np.int64)
    W = np.asarray(W, np.float64)
    rank = np.array([RANK.get(int(s), 2) for s in slot])
    trank = rank[T].min(1)
    A, B, C = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    cent = (A + B + C) / 3
    tree = cKDTree(cent)
    e1, e2 = B - A, C - A
    out = W.copy()
    changed = 0
    inner = np.where(rank < rank.max())[0]
    cands = tree.query_ball_point(P[inner], r=reach)
    for v, cl in zip(inner, cands):
        if not cl:
            continue
        cl = np.asarray(cl)
        cl = cl[trank[cl] > rank[v]]
        if not len(cl):
            continue
        o, d = P[v], N[v]
        # 뫼ller–Trumbore: 법선 방향 반직선과 삼각형
        p = np.cross(d, e2[cl])
        det = (e1[cl] * p).sum(1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
        s = o - A[cl]
        u = (s * p).sum(1) * inv
        q = np.cross(s, e1[cl])
        w = (d * q).sum(1) * inv
        t = (e2[cl] * q).sum(1) * inv
        hit = ok & (u >= -1e-6) & (w >= -1e-6) & (u + w <= 1 + 1e-6) & (t > 0) & (t < dmax)
        if not hit.any():
            continue
        k = np.argmin(np.where(hit, t, np.inf))
        tri = T[cl[k]]
        bary = np.array([1 - u[k] - w[k], u[k], w[k]])
        Wh = (bary[:, None] * W[tri]).sum(0)
        a = np.clip((dmax - t[k]) / (dmax - dfull), 0, 1)
        a = a * a * (3 - 2 * a)
        out[v] = (1 - a) * W[v] + a * Wh
        changed += 1
    # 반직선이 빗나간 속옷 점(겉옷 가장자리·겨드랑이처럼 법선이 옆을 보는 곳)은 가장 가까운 겉옷 점과 거리로 섞는다
    hitm = np.zeros(len(P), bool)
    hitm[np.where(np.abs(out - W).sum(1) > 1e-9)[0]] = True
    for r in np.unique(rank[inner]):
        oset = np.where(rank > r)[0]
        if not len(oset):
            continue
        tr = cKDTree(P[oset])
        vs = np.where((rank == r) & ~hitm)[0]
        d, j = tr.query(P[vs], distance_upper_bound=prox)
        ok = np.isfinite(d)
        vs, d, j = vs[ok], d[ok], j[ok]
        a = np.clip((prox - d) / (prox - pfull), 0, 1)
        a = a * a * (3 - 2 * a)
        out[vs] = (1 - a)[:, None] * W[vs] + a[:, None] * W[oset[j]]
        changed += int((a > 0.05).sum())
    s = out.sum(1, keepdims=True)
    return np.where(s > 0, out / np.maximum(s, 1e-12), out), changed
