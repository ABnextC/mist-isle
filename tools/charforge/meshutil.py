# 메시 도구: 사각형 → 삼각형, (위치, UV) 짝으로 꼭짓점 나누기, 부드러운 법선, 이웃 목록, 라플라스 다듬기
import numpy as np

def triangulate(faces, keep=None):
    """faces: [(vi list, ti list)] → (N,3) 위치 번호, (N,3) uv 번호, 원래 면 번호"""
    tv, tt, src = [], [], []
    for fi, (vi, ti) in enumerate(faces):
        if keep is not None and not keep[fi]:
            continue
        for k in range(1, len(vi) - 1):
            tv.append((vi[0], vi[k], vi[k + 1]))
            tt.append((ti[0], ti[k], ti[k + 1]))
            src.append(fi)
    return np.array(tv, np.int64), np.array(tt, np.int64), np.array(src, np.int64)

def vertex_normals(V, T):
    n = np.zeros_like(V)
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, T[:, k], fn)
    l = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(l, 1e-12)

def split_uv(T, TT):
    """(위치, uv) 짝마다 꼭짓점 하나. 반환: 꼭짓점의 위치 번호, uv 번호, 새 삼각형"""
    pair = T.astype(np.int64) * 10000000 + TT.astype(np.int64)
    uniq, inv = np.unique(pair.ravel(), return_inverse=True)
    vpos = uniq // 10000000
    vuv = uniq % 10000000
    return vpos, vuv, inv.reshape(-1, 3)

def neighbors(T, n):
    e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    e = np.unique(e, axis=0)
    e = e[(e[:, 0] < n) & (e[:, 1] < n)]
    order = np.argsort(e[:, 0], kind='stable')
    e = e[order]
    start = np.searchsorted(e[:, 0], np.arange(n + 1))
    return e, start

def laplacian(V, T, iters=1, lam=0.5, mask=None):
    """mask: 움직여도 되는 꼭짓점(True). 균일 가중 라플라스."""
    n = len(V)
    e, _ = neighbors(T, n)
    deg = np.bincount(e[:, 0], minlength=n).astype(float)
    V = V.copy()
    for _ in range(iters):
        s = np.zeros_like(V)
        np.add.at(s, e[:, 0], V[e[:, 1]])
        avg = s / np.maximum(deg, 1)[:, None]
        d = (avg - V) * lam
        if mask is not None:
            d[~mask] = 0
        d[deg == 0] = 0
        V += d
    return V

def boundary_edges(T):
    e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    key = np.sort(e, axis=1)
    u, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    return e[cnt[inv] == 1]

def boundary_loops(T):
    be = boundary_edges(T)
    nxt = {int(a): int(b) for a, b in be}
    loops, seen = [], set()
    for s in list(nxt):
        if s in seen:
            continue
        loop, v = [], s
        while v not in seen and v in nxt:
            seen.add(v)
            loop.append(v)
            v = nxt[v]
        loops.append(loop)
    return loops

def compact(V, T, *attrs):
    used = np.unique(T)
    remap = -np.ones(len(V), np.int64)
    remap[used] = np.arange(len(used))
    out = [V[used], remap[T]] + [a[used] for a in attrs]
    return out, used
