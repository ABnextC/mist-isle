# 사타구니 이음매 무게 고르기(v0.4.10).
# 몸 무게를 옷 껍데기로 옮기면 가운데 이음매에서 이웃 점끼리 왼·오른 넓적다리 무게가 뒤바뀐다
# (오른다리 1.0 점 옆에 왼다리 0.97 점). 다리를 벌리거나 돌리면 그 삼각형이 늘어나다 뒤집혀
# 허벅지 안쪽이 톱니처럼 깨져 보였다. 가운데 ±band 안에서는 다리 무게를 x로 매끈히 나누고,
# 둘레를 몇 번 고르게 편다. forge.py(새로 만들 때)와 fixweights.py(이미 만든 묶음 고칠 때)가 함께 쓴다.

import numpy as np


def weld(P, eps=1e-5):
    """같은 자리에 겹친 점(UV 이음매로 쪼개진 점)을 한 무리로"""
    key = np.round(np.asarray(P, np.float64) / eps).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.reshape(-1)


def crotch_blend(P, tris, W, bones, band=0.035, iters=4, y_max=1.02):
    """P (n,3) 묶음 자세 위치, tris (m,3), W (n,뼈수) 무게(합 1) → 고친 W"""
    P = np.asarray(P, np.float64)
    W = np.asarray(W, np.float64).copy()
    bi = {b: i for i, b in enumerate(bones)}
    R = [bi['thR'], bi['knR'], bi['ftR']]
    L = [bi['thL'], bi['knL'], bi['ftL']]
    wr, wl = W[:, R].sum(1), W[:, L].sum(1)
    tot = wr + wl
    x = P[:, 0]
    sel = (tot > 1e-4) & (np.abs(x) < band) & (P[:, 1] < y_max)
    if sel.any():
        t = np.clip((x[sel] + band) / (2 * band), 0, 1)
        f = t * t * (3 - 2 * t)  # 왼다리 몫(+x가 몸 왼쪽)
        for idx, share, cur in ((R, 1 - f, wr[sel]), (L, f, wl[sel])):
            want = tot[sel] * share
            sub = W[np.ix_(sel, idx)]
            # 다리 안 나눔(넓적다리·무릎·발)은 지금 비율대로, 그 다리 무게가 없던 점은 넓적다리로
            ratio = np.where(cur[:, None] > 1e-6, sub / np.maximum(cur[:, None], 1e-9), np.array([1.0, 0.0, 0.0])[None])
            W[np.ix_(sel, idx)] = ratio * want[:, None]
    if iters:
        g = weld(P)
        ng = int(g.max()) + 1
        ch = [bi['hips'], bi['thR'], bi['thL']]
        cnt = np.bincount(g, minlength=ng).astype(np.float64)
        Wg = np.zeros((ng, 3))
        np.add.at(Wg, g, W[:, ch])
        Wg /= cnt[:, None]
        Pg = np.zeros((ng, 3))
        np.add.at(Pg, g, P)
        Pg /= cnt[:, None]
        tris = np.asarray(tris, np.int64)
        E = g[np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])]
        E = E[E[:, 0] != E[:, 1]]
        E = np.unique(np.sort(E, 1), axis=0)
        reg = (np.abs(Pg[:, 0]) < 2 * band) & (Pg[:, 1] < y_max) & (Wg[:, 1] + Wg[:, 2] > 1e-4)
        for _ in range(iters):
            acc = np.zeros_like(Wg)
            c = np.zeros(ng)
            np.add.at(acc, E[:, 0], Wg[E[:, 1]])
            np.add.at(acc, E[:, 1], Wg[E[:, 0]])
            np.add.at(c, E[:, 0], 1)
            np.add.at(c, E[:, 1], 1)
            nw = 0.5 * Wg + 0.5 * acc / np.maximum(c, 1)[:, None]
            # 세 칸 합은 그대로(배·무릎 같은 다른 뼈 몫은 건드리지 않는다)
            nw *= Wg.sum(1, keepdims=True) / np.maximum(nw.sum(1, keepdims=True), 1e-12)
            Wg = np.where(reg[:, None], nw, Wg)
        # 무리 값을 각 점에, 점마다 세 칸 합을 지킨다
        s_v = W[:, ch].sum(1, keepdims=True)
        new = Wg[g]
        W[:, ch] = new * (s_v / np.maximum(new.sum(1, keepdims=True), 1e-12))
    s = W.sum(1, keepdims=True)
    return np.where(s > 0, W / np.maximum(s, 1e-12), W)
