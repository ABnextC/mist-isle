# 주변 가림(AO): 모든 메시를 복셀에 찍고(몸은 속을 채움) 흐린 밀도 단계를 원뿔처럼 따라가며 하늘 가림을 잰다.
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates, binary_fill_holes, binary_dilation

def surface_points(P, T, spacing):
    """삼각형 위에 촘촘히 점을 뿌린다(복셀 크기의 절반 간격)"""
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    L = np.maximum(np.linalg.norm(b - a, axis=1), np.maximum(np.linalg.norm(c - a, axis=1), np.linalg.norm(c - b, axis=1)))
    k = np.clip(np.ceil(L / spacing).astype(int), 1, 40)
    out = [a, b, c]
    for kk in np.unique(k):
        m = k == kk
        if kk <= 1:
            out.append((a[m] + b[m] + c[m]) / 3)
            continue
        ii, jj = np.meshgrid(np.arange(kk + 1), np.arange(kk + 1), indexing='ij')
        ok = ii + jj <= kk
        u = (ii[ok] / kk)[None, :, None]
        v = (jj[ok] / kk)[None, :, None]
        pts = a[m][:, None] * (1 - u - v) + b[m][:, None] * u + c[m][:, None] * v
        out.append(pts.reshape(-1, 3))
    return np.concatenate(out)

class AOField:
    def __init__(self, solids, shells, h=0.006, margin=0.12):
        """solids: [(P, T)] 닫힌 몸(속 채움), shells: [(P, T)] 얇은 겉(옷·머리)"""
        allp = np.concatenate([p for p, _ in solids + shells])
        self.lo = allp.min(0) - margin
        hi = allp.max(0) + margin
        self.h = h
        n = np.ceil((hi - self.lo) / h).astype(int) + 1
        occ = np.zeros(n, bool)
        def stamp(P, T):
            pts = surface_points(P, T, h * 0.5)
            ijk = np.round((pts - self.lo) / h).astype(int)
            ijk = np.clip(ijk, 0, n - 1)
            occ[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
        for P, T in solids:
            stamp(P, T)
        occ = binary_fill_holes(occ)
        for P, T in shells:
            stamp(P, T)
        self.occ = occ.astype(np.float32)
        self.levels = [gaussian_filter(self.occ, s) for s in (0.7, 1.4, 2.8, 5.6)]

    def sample(self, lvl, p):
        c = ((p - self.lo) / self.h).T
        return map_coordinates(self.levels[lvl], c, order=1, mode='constant', cval=0.0)

    def ao(self, P, N, dirs=14, seed=0, strength=1.0):
        rng = np.random.default_rng(seed)
        # 코사인 가중 반구 방향(법선 기준)
        u1 = (np.arange(dirs) + 0.5) / dirs
        u2 = (np.arange(dirs) * 0.618034) % 1.0
        r = np.sqrt(u1)
        th = 2 * np.pi * u2
        local = np.stack([r * np.cos(th), r * np.sin(th), np.sqrt(1 - u1)], 1)
        N = np.nan_to_num(N)
        N = np.where(np.linalg.norm(N, axis=1, keepdims=True) < 0.5, np.array([[0, 1.0, 0]]), N)
        up = np.where(np.abs(N[:, 1:2]) < 0.9, np.array([[0, 1.0, 0]]), np.array([[1.0, 0, 0]]))
        tx = np.cross(up, N)
        tx /= np.linalg.norm(tx, axis=1, keepdims=True)
        ty = np.cross(N, tx)
        h = self.h
        steps = [(1, 2.6), (1, 4.2), (2, 7.0), (3, 12.8), (3, 22.0)]
        vis = np.zeros(len(P))
        base = P + N * h * 2.2
        N = np.nan_to_num(N)
        for d in range(dirs):
            dv = tx * local[d, 0] + ty * local[d, 1] + N * local[d, 2]
            v = np.ones(len(P))
            for lvl, dist in steps:
                o = self.sample(lvl, base + dv * dist * h)
                v *= 1 - np.clip(o * 1.6 * strength, 0, 0.95)
            vis += v
        return vis / dirs
