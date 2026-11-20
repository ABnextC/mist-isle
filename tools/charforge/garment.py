# 옷 만들기: 몸 표면에서 영역(스칼라장 c ≥ 0)을 잘라내 바깥으로 띄운 껍데기.
# 꼭짓점은 몸 꼭짓점 두 개 사이 보간(a, b, t)으로 기억해 가중치·UV·법선을 그대로 옮긴다.
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from meshutil import vertex_normals

class Ctx:
    def __init__(self, B):
        self.P = B['P']
        self.VT = B['VT']
        self.T = B['T']
        self.TT = B['TT']
        self.GW = B['GW']
        self.bones = B['bones']
        self.names = [b[0] for b in B['bones']]
        self.bi = {n: i for i, n in enumerate(self.names)}
        self.bpos = {b[0]: np.array(b[2]) for b in B['bones']}
        self.H = B['H']
        self.N = vertex_normals(self.P, self.T)
        self.body = np.unique(self.T)

    def w(self, *names):
        return sum(self.GW[:, self.bi[n]] for n in names)

class Mesh:
    """일반 메시: 위치·법선·가중치(뼈 수)·UV(섬 단위 원본)·삼각형·부품 정보"""
    def __init__(self, pos, nrm, w, tris, uv=None, island=None, gid=0, base=None, rim=None):
        self.pos = np.asarray(pos, float)
        self.nrm = np.asarray(nrm, float)
        self.w = np.asarray(w, float)
        self.tris = np.asarray(tris, np.int64)
        self.uv = None if uv is None else np.asarray(uv, float)
        self.island = island
        self.gid = gid
        self.base = base
        self.rim = rim

def clip(ctx, c, extra_keep=None):
    """몸 삼각형(UV 나뉜 꼭짓점 기준)을 c ≥ 0 영역으로 자른다.
    반환: dict(geo: (a,b,t) 보간표, sv_geo, sv_uv, tris)"""
    T, TT = ctx.T, ctx.TT
    cv = c[T]
    inside = cv >= 0
    n_in = inside.sum(1)
    keep_full = n_in == 3
    part = (n_in > 0) & (n_in < 3)
    geo_key = {}
    geo = []          # (a, b, t)
    sv_key = {}
    sv = []           # (geo id, uv a, uv b, t)

    def gvert(a, b, t):
        if t <= 1e-9 or a == b:
            k = (a, a)
            t, b = 0.0, a
        elif t >= 1 - 1e-9:
            k = (b, b)
            a, t = b, 0.0
        else:
            if a > b:
                a, b, t = b, a, 1 - t
            k = (a, b)
        if k not in geo_key:
            geo_key[k] = len(geo)
            geo.append((a, b, t))
        return geo_key[k]

    def svert(pa, pb, ua, ub, t):
        g = gvert(pa, pb, t)
        if pa > pb and 1e-9 < t < 1 - 1e-9:
            ua, ub, t2 = ub, ua, 1 - t
        else:
            t2 = t
        if t2 <= 1e-9:
            ub = ua
            t2 = 0.0
        elif t2 >= 1 - 1e-9:
            ua = ub
            t2 = 0.0
        k = (g, ua, ub, round(t2, 6))
        if k not in sv_key:
            sv_key[k] = len(sv)
            sv.append((g, ua, ub, t2))
        return sv_key[k]

    tris = []
    for fi in np.nonzero(keep_full)[0]:
        tris.append([svert(T[fi, k], T[fi, k], TT[fi, k], TT[fi, k], 0.0) for k in range(3)])
    for fi in np.nonzero(part)[0]:
        poly = []
        for k in range(3):
            a, b = k, (k + 1) % 3
            ca, cb = cv[fi, a], cv[fi, b]
            if ca >= 0:
                poly.append(svert(T[fi, a], T[fi, a], TT[fi, a], TT[fi, a], 0.0))
            if (ca >= 0) != (cb >= 0):
                t = ca / (ca - cb)
                poly.append(svert(T[fi, a], T[fi, b], TT[fi, a], TT[fi, b], t))
        for k in range(1, len(poly) - 1):
            tris.append([poly[0], poly[k], poly[k + 1]])
    tris = np.array(tris, np.int64)
    # 넓이가 거의 0인 삼각형은 버린다
    geo = np.array(geo)
    sv = np.array(sv)
    return dict(geo=geo, sv=sv, tris=tris)

def interp(arr, geo):
    a = geo[:, 0].astype(np.int64)
    b = geo[:, 1].astype(np.int64)
    t = geo[:, 2]
    if np.ndim(arr) > 1:
        t = t[:, None]
    return arr[a] * (1 - t) + arr[b] * t

def shell(ctx, c, d_body, gid, smooth=0, smooth_lam=0.5, pin_rim=True):
    """c: 몸 꼭짓점별 영역 값, d_body: 몸 꼭짓점별 띄울 거리(m). smooth: 드레이프 반복 수(오목한 곳만 메움)."""
    R = clip(ctx, c)
    geo, sv, tris = R['geo'], R['sv'], R['tris']
    base = interp(ctx.P, geo)
    nrm = interp(ctx.N, geo)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    w = interp(ctx.GW, geo)
    w /= np.maximum(w.sum(1, keepdims=True), 1e-9)
    gtris = sv[tris, 0].astype(np.int64)
    d = interp(d_body, geo)
    pos = base + nrm * d[:, None]
    # 테두리 꼭짓점
    rim = rim_vertices(gtris, len(pos))
    if smooth:
        pos = drape(pos, gtris, base, nrm, d, smooth, smooth_lam, pin=rim if pin_rim else None)
    uv_a = ctx.VT[sv[:, 1].astype(np.int64)]
    uv_b = ctx.VT[sv[:, 2].astype(np.int64)]
    uv = uv_a * (1 - sv[:, 3:4]) + uv_b * sv[:, 3:4]
    # 섬 번호: 원래 몸 UV 섬
    return dict(pos=pos, base=base, nrm0=nrm, w=w, gtris=gtris, sv_geo=sv[:, 0].astype(np.int64), sv_uv=uv, stris=tris,
                gid=gid, d=d, rim=rim, src=geo)

def rim_vertices(tris, n):
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    key = np.sort(e, axis=1)
    u, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    be = u[cnt == 1]
    m = np.zeros(n, bool)
    m[be.ravel()] = True
    return m

def edges_of(tris, n):
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    e = np.unique(np.sort(e, axis=1), axis=0)
    return e

def drape(pos, tris, base, nrm, min_d, iters, lam, pin=None):
    """라플라스로 오목한 곳을 메우되, 몸 표면(기준점+법선) 바깥 min_d 아래로는 못 들어가게."""
    n = len(pos)
    e = edges_of(tris, n)
    e2 = np.concatenate([e, e[:, ::-1]])
    deg = np.bincount(e2[:, 0], minlength=n).astype(float)
    pos = pos.copy()
    for _ in range(iters):
        s = np.zeros_like(pos)
        np.add.at(s, e2[:, 0], pos[e2[:, 1]])
        avg = s / np.maximum(deg, 1)[:, None]
        dp = (avg - pos) * lam
        if pin is not None:
            dp[pin] = 0
        pos += dp
        h = ((pos - base) * nrm).sum(1)
        md = min_d if np.ndim(min_d) else np.full(n, min_d)
        low = h < md
        pos[low] += nrm[low] * (md[low] - h[low])[:, None]
    return pos

def geodesic_from_rim(pos, tris, rim):
    n = len(pos)
    e = edges_of(tris, n)
    l = np.linalg.norm(pos[e[:, 0]] - pos[e[:, 1]], axis=1)
    A = coo_matrix((l, (e[:, 0], e[:, 1])), shape=(n, n))
    src = np.nonzero(rim)[0]
    if len(src) == 0:
        return np.full(n, 1.0)
    # 여러 출발점: 가상의 꼭짓점 하나에서 0 길이로 잇는다
    A2 = coo_matrix((np.concatenate([l, np.full(len(src), 1e-9)]),
                     (np.concatenate([e[:, 0], np.full(len(src), n)]), np.concatenate([e[:, 1], src]))), shape=(n + 1, n + 1))
    d = dijkstra(A2, directed=False, indices=n)
    return d[:n]

def loops(tris, n):
    """테두리 고리들(꼭짓점 번호 목록, 면 방향을 따라)."""
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    key = np.sort(e, axis=1)
    u, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    be = e[cnt[inv] == 1]
    nxt = {}
    for a, b in be:
        nxt.setdefault(int(a), []).append(int(b))
    out, seen = [], set()
    for s in list(nxt):
        if s in seen:
            continue
        loop, v = [], s
        while v not in seen:
            seen.add(v)
            loop.append(v)
            nb = [x for x in nxt.get(v, []) if x not in seen]
            if not nb:
                break
            v = nb[0]
        if len(loop) > 2:
            out.append(loop)
    return out

def smooth_field(ctx, f, iters=10, lam=0.5):
    """몸 꼭짓점 위 스칼라장 다듬기(영역 경계를 매끈하게)."""
    T = ctx.T
    n = len(ctx.P)
    e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    deg = np.bincount(e[:, 0], minlength=n).astype(float)
    f = f.astype(float).copy()
    used = deg > 0
    for _ in range(iters):
        s = np.zeros(n)
        np.add.at(s, e[:, 0], f[e[:, 1]])
        avg = np.where(used, s / np.maximum(deg, 1), f)
        f += (avg - f) * lam
    return f

def shell_mesh(S):
    """껍데기(나뉜 꼭짓점) → Mesh. 법선은 껍데기 모양에서 새로 구한다"""
    gn = vertex_normals(S['pos'], S['gtris'])
    sv = S['sv_geo']
    me = Mesh(S['pos'][sv], gn[sv], S['w'][sv], S['stris'], uv=S['sv_uv'], gid=S['gid'])
    me.geo = sv
    me.rimv = S['rim'][sv]
    return me

def rim_loops_geo(S):
    """껍데기 테두리 고리(기하 꼭짓점 번호)"""
    return loops(S['gtris'], len(S['pos']))

def extra_smooth(S, mask, iters, lam=0.5):
    """일부 꼭짓점만 더 다듬는다(장화 발가락 뭉치기 등). 몸 바깥 조건 유지"""
    S['pos'] = drape(S['pos'], S['gtris'], S['base'], S['nrm0'], S['d'], iters, lam, pin=~mask)
    return S


def hull_push(S, mask, pts, offset, rounds=5, smooth_iters=8):
    """mask 꼭짓점을 pts의 볼록 껍질 바깥(offset)으로 밀어 신발 골 모양을 만든다"""
    from scipy.spatial import ConvexHull
    H = ConvexHull(pts)
    A = H.equations[:, :3]
    b = H.equations[:, 3]
    idx = np.nonzero(mask)[0]
    for r in range(rounds):
        p = S['pos'][idx]
        sd = p @ A.T + b
        k = sd.argmax(1)
        m = sd[np.arange(len(idx)), k]
        need = offset - m
        p += A[k] * need[:, None]
        S['pos'][idx] = p
        if r < rounds - 1:
            S['pos'] = drape(S['pos'], S['gtris'], S['base'], S['nrm0'], np.zeros(len(S['pos'])) - 1, smooth_iters, 0.5, pin=~mask)
    return S


def soft_hull_project(S, wgt, pts, offset, r=0.006, iters=6, smooth_iters=4):
    """둥근 볼록 껍질(평면 거리의 log-sum-exp) 위 offset 자리로 꼭짓점을 옮긴다. wgt: 0~1 섞는 비율"""
    from scipy.spatial import ConvexHull
    H = ConvexHull(pts)
    A = H.equations[:, :3]
    b = H.equations[:, 3]
    idx = np.nonzero(wgt > 0)[0]
    p0 = S['pos'][idx].copy()
    p = p0.copy()
    for _ in range(iters):
        z = (p @ A.T + b) / r
        zm = z.max(1, keepdims=True)
        e = np.exp(z - zm)
        se = e.sum(1, keepdims=True)
        sd = r * (np.log(se) + zm)[:, 0]
        g = (e / se) @ A
        gl2 = np.maximum((g * g).sum(1), 1e-9)
        p -= ((sd - offset) / gl2)[:, None] * g
    w = wgt[idx][:, None]
    S['pos'][idx] = p0 * (1 - w) + p * w
    if smooth_iters:
        S['pos'] = drape(S['pos'], S['gtris'], S['base'], S['nrm0'], np.zeros(len(S['pos'])) - 1, smooth_iters, 0.4, pin=~(wgt > 0))
    return S


def voxel_hull_project(S, wgt, pts, offset, h=0.0015, blur=1.6, iters=5):
    """볼록 껍질을 격자에 그려 거리장(EDT)을 만들고 흐려 모서리를 둥글린 뒤, 그 offset 등위면으로 옮긴다"""
    from scipy.spatial import ConvexHull
    from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates
    H = ConvexHull(pts)
    A = H.equations[:, :3]
    b = H.equations[:, 3]
    lo = pts.min(0) - 0.035
    hi = pts.max(0) + 0.035
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = [lo[k] + np.arange(n[k]) * h for k in range(3)]
    X, Y, Z = np.meshgrid(*xs, indexing='ij')
    G = np.stack([X, Y, Z], -1).reshape(-1, 3)
    inside = np.ones(len(G), bool)
    for k in range(len(A)):
        inside &= (G @ A[k] + b[k]) <= 0
    inside = inside.reshape(X.shape)
    sdf = (distance_transform_edt(~inside) - distance_transform_edt(inside)) * h
    sdf = gaussian_filter(sdf, blur)
    gx, gy, gz = np.gradient(sdf, h)
    idx = np.nonzero(wgt > 0)[0]
    p0 = S['pos'][idx].copy()
    p = p0.copy()
    for _ in range(iters):
        c = ((p - lo) / h).T
        d = map_coordinates(sdf, c, order=1, mode='nearest')
        g = np.stack([map_coordinates(q, c, order=1, mode='nearest') for q in (gx, gy, gz)], 1)
        gl2 = np.maximum((g * g).sum(1), 1e-6)
        p -= ((d - offset) / gl2)[:, None] * g
    w = wgt[idx][:, None]
    S['pos'][idx] = p0 * (1 - w) + p * w
    return S
