# 덧붙이는 부품: 고리를 따라 감는 관(걷은 소매·장화 접단·테두리 띠), 세운 깃, 둥근 상자(버클·주머니),
# 단추, 밑창. 모두 Mesh(위치·법선·가중치·삼각형·섬 UV)로 돌려준다.
import numpy as np
from skimage.measure import marching_cubes
from scipy.spatial import ConvexHull
from meshutil import vertex_normals
from garment import Mesh

def order_loop(loop, pos):
    return np.array(loop, np.int64)

def resample_loop(P, W, N, n_out, closed=True):
    """고리 점들을 같은 간격으로 다시 뽑는다(가중치·법선도 보간)"""
    Q = np.concatenate([P, P[:1]]) if closed else P
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    t = np.linspace(0, L, n_out, endpoint=not closed)
    idx = np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(seg) - 1)
    f = ((t - s[idx]) / np.maximum(seg[idx], 1e-9))[:, None]
    def lerp(A):
        A2 = np.concatenate([A, A[:1]]) if closed else A
        return A2[idx] * (1 - f) + A2[idx + 1] * f
    n = lerp(N)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    w = lerp(W)
    return lerp(P), w, n, L

def tube(P, W, N, radius, sides=8, n_out=None, closed=True, gid=0, lift=None, squash=1.0, twist_noise=0.0, seed=0):
    """고리(P, 바깥 법선 N)를 따라 관. 관 중심은 표면에서 radius*lift 만큼 띄운다."""
    if n_out:
        P, W, N, L = resample_loop(P, W, N, n_out, closed)
    else:
        L = np.linalg.norm(np.diff(np.concatenate([P, P[:1]]), axis=0), axis=1).sum()
    m = len(P)
    nxt = np.roll(P, -1, axis=0) if closed else np.concatenate([P[1:], P[-1:] * 2 - P[-2:-1]])
    prv = np.roll(P, 1, axis=0) if closed else np.concatenate([P[:1] * 2 - P[1:2], P[:-1]])
    tng = nxt - prv
    tng /= np.linalg.norm(tng, axis=1, keepdims=True)
    nn = N - (N * tng).sum(1, keepdims=True) * tng
    nn /= np.linalg.norm(nn, axis=1, keepdims=True)
    bb = np.cross(tng, nn)
    rng = np.random.default_rng(seed)
    rad = np.full(m, radius) if np.ndim(radius) == 0 else np.asarray(radius)
    if twist_noise:
        k = np.linspace(0, 2 * np.pi, m, endpoint=False)
        rad = rad * (1 + twist_noise * (0.6 * np.sin(k * 3 + rng.uniform(0, 6)) + 0.4 * np.sin(k * 7 + rng.uniform(0, 6))))
    lf = 1.0 if lift is None else lift
    C = P + nn * (rad * lf)[:, None]
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    pos, nrm, uv, w = [], [], [], []
    for i in range(m):
        for j, a in enumerate(ang):
            d = nn[i] * np.cos(a) * squash + bb[i] * np.sin(a)
            dn = nn[i] * np.cos(a) / max(squash, 1e-3) + bb[i] * np.sin(a)
            pos.append(C[i] + d * rad[i])
            nrm.append(dn / np.linalg.norm(dn))
            uv.append((i / (m if closed else m - 1), j / sides))
            w.append(W[i])
    tris = []
    rows = m if closed else m - 1
    for i in range(rows):
        i2 = (i + 1) % m
        for j in range(sides):
            j2 = (j + 1) % sides
            a, b, c, d = i * sides + j, i2 * sides + j, i2 * sides + j2, i * sides + j2
            tris += [(a, b, c), (a, c, d)]
    me = Mesh(pos, nrm, w, tris, uv=np.array(uv), gid=gid)
    me.uv_size = (L, 2 * np.pi * float(np.mean(rad)))
    return me

def band(P, W, N, up, height, out=0.0, gid=0, n_out=None, closed=True, rows=3, flare=0.0):
    """고리에서 위(up 방향, 표면을 따라)로 세운 띠(깃·접단). out: 바깥으로 기울기"""
    if n_out:
        P, W, N, L = resample_loop(P, W, N, n_out, closed)
    else:
        L = np.linalg.norm(np.diff(np.concatenate([P, P[:1]]), axis=0), axis=1).sum()
    m = len(P)
    pos, uv, w = [], [], []
    for r in range(rows + 1):
        f = r / rows
        for i in range(m):
            p = P[i] + up[i] * height * f + N[i] * (out * f + flare * f * f)
            pos.append(p)
            uv.append((i / m, f))
            w.append(W[i])
    tris = []
    cols = m if closed else m - 1
    for r in range(rows):
        for i in range(cols):
            i2 = (i + 1) % m
            a, b, c, d = r * m + i, r * m + i2, (r + 1) * m + i2, (r + 1) * m + i
            tris += [(a, b, c), (a, c, d)]
    pos = np.array(pos)
    tris = np.array(tris)
    nrm = vertex_normals(pos, tris)
    me = Mesh(pos, nrm, w, tris, uv=np.array(uv), gid=gid)
    me.uv_size = (L, height)
    return me

def sdf_mesh(sdf, lo, hi, step, gid, weight_row):
    """부호 거리 함수 → marching cubes 메시(가중치는 한 줄로 고정)"""
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    n = np.ceil((hi - lo) / step).astype(int) + 1
    xs = [lo[k] + np.arange(n[k]) * step for k in range(3)]
    X, Y, Z = np.meshgrid(*xs, indexing='ij')
    D = sdf(np.stack([X, Y, Z], -1).reshape(-1, 3)).reshape(X.shape)
    v, f, nrm, _ = marching_cubes(D, 0.0, spacing=(step, step, step))
    v = v + lo
    vol = (np.cross(v[f[:, 0]], v[f[:, 1]]) * v[f[:, 2]]).sum() / 6
    if vol < 0:
        f = f[:, ::-1]
    nrm = vertex_normals(v, f)
    w = np.tile(weight_row, (len(v), 1))
    me = Mesh(v, nrm, w, f, gid=gid)
    # 상자 투영 UV(박스 매핑)
    a = np.abs(nrm)
    ax = a.argmax(1)
    uv = np.where(ax[:, None] == 0, v[:, [2, 1]], np.where(ax[:, None] == 1, v[:, [0, 2]], v[:, [0, 1]]))
    me.uv = (uv - uv.min(0))
    ext = me.uv.max(0)
    me.uv_size = (max(ext[0], 1e-3), max(ext[1], 1e-3))
    me.uv = me.uv / np.maximum(ext, 1e-6)
    return me

def sd_round_box(p, c, half, r, R=None):
    """R: 3x3 회전(로컬→세계). p는 세계 좌표"""
    q = p - c
    if R is not None:
        q = q @ R
    d = np.abs(q) - (np.asarray(half) - r)
    return np.linalg.norm(np.maximum(d, 0), axis=1) + np.minimum(d.max(1), 0) - r

def sole(boot_pos, ft_row, y_bottom, thick, heel=0.012, grow=0.004, gid=0, steps=48):
    """장화 바닥 둘레(아래쪽 꼭짓점의 볼록 껍질)를 키워 두께 있는 밑창 + 뒤굽"""
    low = boot_pos[boot_pos[:, 1] < y_bottom + thick + 0.015]
    pts = low[:, [0, 2]]
    hull = ConvexHull(pts)
    poly = pts[hull.vertices]
    c = poly.mean(0)
    # 고르게 다시 뽑고 바깥으로 키운다
    ang = np.arctan2(poly[:, 1] - c[1], poly[:, 0] - c[0])
    o = np.argsort(ang)
    poly = poly[o]
    seg = np.linalg.norm(np.diff(np.concatenate([poly, poly[:1]]), axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, s[-1], steps, endpoint=False)
    idx = np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(poly) - 1)
    f = ((t - s[idx]) / np.maximum(seg[idx], 1e-9))[:, None]
    P2 = np.concatenate([poly, poly[:1]])
    ring = P2[idx] * (1 - f) + P2[idx + 1] * f
    d = ring - c
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    ring = ring + d * grow
    zmin, zmax = ring[:, 1].min(), ring[:, 1].max()
    # 뒤꿈치 쪽(앞뒤 축 z가 작은 쪽)은 굽만큼 더 높다
    back = np.clip((zmin + 0.35 * (zmax - zmin) - ring[:, 1]) / (0.1 * (zmax - zmin)), 0, 1)
    top = y_bottom + thick + heel * back
    rows = [(ring, np.full(steps, y_bottom + 0.002), 0.0), (ring + d * 0.002, np.full(steps, y_bottom + 0.002), 0.0)]
    pos, tris = [], []
    # 옆면: 아래 → 위 4줄(모서리 둥글게)
    prof = [(-0.0015, 0.0), (0.0, 0.0025), (0.0, 0.7), (-0.001, 1.0)]
    for k, (inset, fy) in enumerate(prof):
        for i in range(steps):
            y = y_bottom + (top[i] - y_bottom) * fy
            q = ring[i] + d[i] * inset
            pos.append((q[0], y, q[1]))
    for k in range(len(prof) - 1):
        for i in range(steps):
            i2 = (i + 1) % steps
            a, b, cc, dd = k * steps + i, k * steps + i2, (k + 1) * steps + i2, (k + 1) * steps + i
            tris += [(a, cc, b), (a, dd, cc)]
    # 바닥·윗면 부채꼴
    cb = len(pos)
    pos.append((c[0], y_bottom, c[1]))
    for i in range(steps):
        i2 = (i + 1) % steps
        tris.append((cb, i, i2))
    ct = len(pos)
    pos.append((c[0], y_bottom + thick, c[1]))
    base = (len(prof) - 1) * steps
    for i in range(steps):
        i2 = (i + 1) % steps
        tris.append((ct, base + i2, base + i))
    pos = np.array(pos)
    tris = np.array(tris)
    nrm = vertex_normals(pos, tris)
    w = np.tile(ft_row, (len(pos), 1))
    uv = np.stack([(pos[:, 0] - pos[:, 0].min()), (pos[:, 2] - pos[:, 2].min())], 1)
    me = Mesh(pos, nrm, w, tris, uv=uv / np.maximum(uv.max(0), 1e-6), gid=gid)
    me.uv_size = tuple(np.maximum(uv.max(0), 1e-3))
    return me

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)

def decimate(v, f, target):
    import fast_simplification as fs
    if len(f) <= target:
        return v, f
    v2, f2 = fs.simplify(v.astype(np.float32), f.astype(np.int64), target_reduction=1 - target / len(f), agg=6)
    return v2.astype(float), f2.astype(np.int64)

def cyl_uv(v, f, center, height0, height1):
    """세로축 원통 UV(뒤쪽이 이음매). 이음매를 지나는 삼각형은 꼭짓점을 복제한다"""
    u = (np.arctan2(v[:, 0] - center[0], -(v[:, 2] - center[1])) / (2 * np.pi)) % 1.0
    vv = (v[:, 1] - height0) / (height1 - height0)
    uv = np.stack([u, vv], 1)
    f = f.copy()
    extra_v, extra_uv = [], []
    n = len(v)
    for i in range(len(f)):
        us = uv[f[i], 0]
        if us.max() - us.min() > 0.5:
            for k in range(3):
                if us[k] < 0.5:
                    extra_v.append(v[f[i, k]])
                    extra_uv.append((uv[f[i, k], 0] + 1, uv[f[i, k], 1]))
                    f[i, k] = n + len(extra_v) - 1
    if extra_v:
        v = np.concatenate([v, extra_v])
        uv = np.concatenate([uv, extra_uv])
    return v, f, uv

def sdf_boot(ctx, L, sx, sole_h, y_top, gid, h=0.0022, target=5000):
    """장화 한 짝: 종아리·발 표면 거리장을 흐려(발가락 지움) 두께만큼 부풀린 등위면 → 줄인 메시"""
    from scipy.spatial import cKDTree
    from scipy.ndimage import gaussian_filter
    P, T, N = ctx.P, ctx.T, ctx.N
    vsel = (L.w_leg > 0.5) & (L.s_leg > 0.9) & (P[:, 0] * sx > 0)
    tsel = vsel[T].all(1)
    tri = T[tsel]
    cen = P[tri].mean(1)
    fn = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True)
    vid = np.unique(tri)
    S = np.concatenate([P[vid], cen])
    SN = np.concatenate([N[vid], fn])
    lo = S.min(0) - 0.04
    hi = S.max(0) + 0.04
    lo[1] = sole_h - 0.01
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = [lo[k] + np.arange(n[k]) * h for k in range(3)]
    X, Y, Z = np.meshgrid(*xs, indexing='ij')
    G = np.stack([X, Y, Z], -1).reshape(-1, 3)
    tree = cKDTree(S)
    d, j = tree.query(G, workers=-1)
    sgn = np.sign(((G - S[j]) * SN[j]).sum(1))
    sd = (d * sgn).reshape(X.shape)
    sd_shaft = gaussian_filter(sd, 1.6)
    sd_foot = gaussian_filter(sd, 2.5) - 0.0035
    yk = L.y_hips  # 자리표시(쓰지 않음)
    y_ank = ctx.bpos['ft' + ('L' if sx > 0 else 'R')][1]
    blend = np.clip((y_ank + 0.03 - Y) / 0.05, 0, 1)
    thick = np.interp(Y, [sole_h, y_ank - 0.02, y_ank + 0.04, (y_ank + y_top) / 2, y_top], [0.0075, 0.0085, 0.0105, 0.0135, 0.0175])
    sdf = sd_shaft * (1 - blend) + sd_foot * blend - thick
    sdf = np.maximum(sdf, Y - y_top)
    sdf = np.maximum(sdf, (sole_h - 0.0015) - Y)
    v, f, _, _ = marching_cubes(sdf, 0.0, spacing=(h, h, h))
    v = v + lo
    f = f[:, ::-1]
    # 윗뚜껑(평평한 위쪽 면) 지우기
    fnv = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    fnv /= np.maximum(np.linalg.norm(fnv, axis=1, keepdims=True), 1e-12)
    vol = (np.cross(v[f[:, 0]], v[f[:, 1]]) * v[f[:, 2]]).sum() / 6
    if vol < 0:
        f = f[:, ::-1]
        fnv = -fnv
    cap = (fnv[:, 1] > 0.9) & (v[f].mean(1)[:, 1] > y_top - h * 1.5)
    f = f[~cap]
    from meshutil import laplacian
    v = laplacian(v, f, iters=4, lam=0.5)
    v, f = decimate(v, f, target)
    v = laplacian(v, f, iters=3, lam=0.45)
    used = np.unique(f)
    remap = -np.ones(len(v), np.int64)
    remap[used] = np.arange(len(used))
    v = v[used]
    f = remap[f]
    # 가중치: 가장 가까운 몸 꼭짓점(다리 쪽)
    bt = cKDTree(P[np.nonzero(vsel)[0]])
    _, k = bt.query(v)
    w = ctx.GW[np.nonzero(vsel)[0][k]]
    from garment import loops as _loops
    lps = [np.array(l) for l in _loops(f, len(v))]
    top_loops = [(v[l], w[l]) for l in lps if len(l) > 12 and v[l, 1].mean() > y_top - 0.03]
    c = P[vsel].mean(0)
    v2, f2, uv = cyl_uv(v, f, (c[0], c[2]), sole_h, y_top)
    _, k2 = bt.query(v2)
    w2 = ctx.GW[np.nonzero(vsel)[0][k2]]
    nrm = vertex_normals(v2, f2)
    me = Mesh(v2, nrm, w2, f2, uv=uv, gid=gid)
    circ = 2 * np.pi * np.sqrt(((v[:, [0, 2]] - c[[0, 2]]) ** 2).sum(1)).mean()
    me.uv_size = (circ, y_top - sole_h)
    me.uv = np.stack([uv[:, 0] / 1.0, uv[:, 1]], 1)
    me.uv_wrap = True
    me.top_loops = top_loops
    me.n_loops = len(lps)
    return me
