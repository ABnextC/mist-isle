# 옷 조각용 기하 도구(v0.4.5): 일반 메시 자르기, 테두리 정보(거리·둘레 좌표), 두께 주기(안쪽 면 + 둥근 단),
# 축을 따라 단면을 감싸는 로프트, 몸 가중치 옮기기, 징·리벳·단추 같은 작은 장식.
# 모든 메시는 기하 꼭짓점 기준 dict: pos (n,3), tris (m,3), w (n,뼈), 그리고 필요하면 꼭짓점 속성들.
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree, ConvexHull
from meshutil import vertex_normals, boundary_loops


def G(pos, tris, w, **kw):
    d = dict(pos=np.asarray(pos, float), tris=np.asarray(tris, np.int64), w=np.asarray(w, float))
    d.update(kw)
    return d


def edges_of(tris):
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    return np.unique(np.sort(e, axis=1), axis=0)


def clip_mesh(g, c, keep_attrs=('w',)):
    """g를 꼭짓점 값 c ≥ 0 인 곳만 남긴다. 경계는 c=0 등위선으로 보간해 매끈하게 자른다."""
    pos, T = g['pos'], g['tris']
    cv = c[T]
    inside = cv >= 0
    n_in = inside.sum(1)
    key = {}
    new_pos, new_src = [], []  # (a, b, t)

    def vert(a, b, t):
        if t <= 1e-9 or a == b:
            k = (a, a)
            b, t = a, 0.0
        elif t >= 1 - 1e-9:
            k = (b, b)
            a, t = b, 0.0
        else:
            if a > b:
                a, b, t = b, a, 1 - t
            k = (a, b)
        if k not in key:
            key[k] = len(new_src)
            new_src.append((a, b, t))
        return key[k]

    tris = []
    for fi in np.nonzero(n_in == 3)[0]:
        tris.append([vert(T[fi, k], T[fi, k], 0.0) for k in range(3)])
    for fi in np.nonzero((n_in > 0) & (n_in < 3))[0]:
        poly = []
        for k in range(3):
            a, b = k, (k + 1) % 3
            ca, cb = cv[fi, a], cv[fi, b]
            if ca >= 0:
                poly.append(vert(T[fi, a], T[fi, a], 0.0))
            if (ca >= 0) != (cb >= 0):
                poly.append(vert(T[fi, a], T[fi, b], ca / (ca - cb)))
        for k in range(1, len(poly) - 1):
            tris.append([poly[0], poly[k], poly[k + 1]])
    src = np.array(new_src)
    a = src[:, 0].astype(np.int64)
    b = src[:, 1].astype(np.int64)
    t = src[:, 2]

    def lerp(A):
        tt = t[:, None] if A.ndim > 1 else t
        return A[a] * (1 - tt) + A[b] * tt

    out = dict(g)
    out['pos'] = lerp(pos)
    out['tris'] = np.array(tris, np.int64).reshape(-1, 3)
    for k in keep_attrs:
        if k in g and g[k] is not None and len(g[k]) == len(pos):
            out[k] = lerp(np.asarray(g[k], float))
    for k in list(out.keys()):
        if k not in ('pos', 'tris') and k not in keep_attrs and isinstance(out[k], np.ndarray) and len(out[k]) == len(pos):
            out[k] = lerp(np.asarray(out[k], float))
    # 넓이 0 삼각형 버리기
    p = out['pos']
    tr = out['tris']
    ar = np.linalg.norm(np.cross(p[tr[:, 1]] - p[tr[:, 0]], p[tr[:, 2]] - p[tr[:, 0]]), axis=1)
    out['tris'] = tr[ar > 1e-12]
    return compact_g(out)


def compact_g(g):
    used = np.unique(g['tris'])
    n = len(g['pos'])
    remap = -np.ones(n, np.int64)
    remap[used] = np.arange(len(used))
    out = {}
    for k, v in g.items():
        if isinstance(v, np.ndarray) and v.ndim >= 1 and len(v) == n and k != 'tris':
            out[k] = v[used]
        else:
            out[k] = v
    out['tris'] = remap[g['tris']]
    return out


def rim_info(pos, tris):
    """테두리에서의 표면 거리와, 가장 가까운 테두리 점의 둘레 좌표(m). 테두리 고리 목록도 돌려준다."""
    n = len(pos)
    loops = [np.array(l, np.int64) for l in boundary_loops(tris) if len(l) > 2]
    arc = np.zeros(n)
    rim = np.zeros(n, bool)
    for lp in loops:
        P = pos[lp]
        seg = np.linalg.norm(np.diff(np.concatenate([P, P[:1]]), axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)[:-1]])
        arc[lp] = s
        rim[lp] = True
    if not rim.any():
        return np.full(n, 1.0), np.zeros(n), loops
    e = edges_of(tris)
    l = np.linalg.norm(pos[e[:, 0]] - pos[e[:, 1]], axis=1)
    A = coo_matrix((l, (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    src = np.nonzero(rim)[0]
    d, _, srcs = dijkstra(A, directed=False, indices=src, min_only=True, return_predecessors=True)
    d[~np.isfinite(d)] = 1.0
    srcs = np.where(srcs < 0, src[0], srcs)
    return d, arc[srcs], loops


def solidify(g, thick, band=None, bulge=0.35, inner=True):
    """겉면을 안쪽으로 thick만큼 두께를 준다: 안쪽 면(테두리에서 band 안쪽만) + 둥글게 말린 단.
    g['pos'] 면 방향은 바깥을 향해야 한다. 반환 메시는 edge(테두리 거리 m)·rimc(둘레 좌표 m)를 가진다."""
    pos, T, W = g['pos'], g['tris'], g['w']
    n = len(pos)
    N = vertex_normals(pos, T)
    dist, arc, loops = rim_info(pos, T)
    th = np.full(n, thick) if np.ndim(thick) == 0 else np.asarray(thick)
    P = [pos]
    Wl = [W]
    E = [dist]
    R = [arc]
    tris = [T]
    extra = {k: [v] for k, v in g.items() if isinstance(v, np.ndarray) and v.ndim >= 1 and len(v) == n and k not in ('pos', 'tris', 'w')}
    if not inner:
        out = dict(g)
        out['edge'] = dist
        out['rimc'] = arc
        return out
    keep = np.ones(n, bool) if band is None else dist <= band
    # 테두리 꼭짓점은 안쪽 면에도 꼭 있어야 한다
    inn = -np.ones(n, np.int64)
    idx = np.nonzero(keep)[0]
    inn[idx] = n + np.arange(len(idx))
    P.append(pos[idx] - N[idx] * th[idx, None])
    Wl.append(W[idx])
    E.append(dist[idx])
    R.append(arc[idx])
    for k in extra:
        extra[k].append(extra[k][0][idx])
    ft = keep[T].all(1)
    tris.append(inn[T[ft]][:, ::-1])
    base = n + len(idx)
    # 둥근 단: 테두리 고리마다 가운데 줄(바깥으로 볼록)을 넣어 겉→가운데→안을 잇는다
    mids = []
    for lp in loops:
        m = len(lp)
        Pl = pos[lp]
        tng = np.roll(Pl, -1, axis=0) - np.roll(Pl, 1, axis=0)
        tng /= np.maximum(np.linalg.norm(tng, axis=1, keepdims=True), 1e-12)
        out_dir = np.cross(tng, N[lp])
        out_dir /= np.maximum(np.linalg.norm(out_dir, axis=1, keepdims=True), 1e-12)
        mid = Pl - N[lp] * (th[lp, None] * 0.5) + out_dir * (th[lp, None] * bulge)
        mi = base + np.arange(m)
        base += m
        P.append(mid)
        Wl.append(W[lp])
        E.append(np.zeros(m))
        R.append(arc[lp])
        for k in extra:
            extra[k].append(extra[k][0][lp])
        o = lp
        o2 = np.roll(lp, -1)
        m0 = mi
        m2 = np.roll(mi, -1)
        i0 = inn[lp]
        i2 = np.roll(inn[lp], -1)
        # 겉 → 가운데: (b, a, a') (b, a', b')  — 고리는 면 방향을 따른다(a→b)
        tris.append(np.stack([o2, o, m0], 1))
        tris.append(np.stack([o2, m0, m2], 1))
        tris.append(np.stack([m2, m0, i0], 1))
        tris.append(np.stack([m2, i0, i2], 1))
        mids.append(mi)
    out = dict(pos=np.concatenate(P), w=np.concatenate(Wl), tris=np.concatenate(tris), edge=np.concatenate(E), rimc=np.concatenate(R))
    for k, v in extra.items():
        out[k] = np.concatenate(v)
    for k, v in g.items():
        if k not in out and not (isinstance(v, np.ndarray) and v.ndim >= 1):
            out[k] = v
    return out


def merge(meshes):
    """여러 메시를 하나로(같은 속성 키만)."""
    keys = set.intersection(*[set(k for k, v in m.items() if isinstance(v, np.ndarray) and k != 'tris') for m in meshes])
    out = {k: [] for k in keys}
    tris = []
    off = 0
    for m in meshes:
        n = len(m['pos'])
        for k in keys:
            out[k].append(m[k])
        tris.append(m['tris'] + off)
        off += n
    res = {k: np.concatenate(v) for k, v in out.items()}
    res['tris'] = np.concatenate(tris)
    return res


def body_weights(ctx, pts, sel=None, k=8, power=2.0):
    """점마다 가까운 몸 꼭짓점 k개의 가중치를 거리 역수로 섞는다."""
    bm = np.zeros(len(ctx.P), bool)
    bm[ctx.body] = True
    idx = np.nonzero(sel & bm)[0] if sel is not None else ctx.body
    tree = cKDTree(ctx.P[idx])
    d, j = tree.query(pts, k=k)
    wk = 1.0 / np.maximum(d, 1e-4) ** power
    wk /= wk.sum(1, keepdims=True)
    W = (ctx.GW[idx[j]] * wk[:, :, None]).sum(1)
    return W / np.maximum(W.sum(1, keepdims=True), 1e-9)


def smooth_attr(tris, A, n, iters=10, lam=0.5, pin=None):
    e = edges_of(tris)
    e2 = np.concatenate([e, e[:, ::-1]])
    deg = np.bincount(e2[:, 0], minlength=n).astype(float)
    A = A.astype(float).copy()
    for _ in range(iters):
        s = np.zeros_like(A)
        np.add.at(s, e2[:, 0], A[e2[:, 1]])
        avg = s / np.maximum(deg, 1).reshape((-1,) + (1,) * (A.ndim - 1))
        d = (avg - A) * lam
        d[deg == 0] = 0
        if pin is not None:
            d[pin] = 0
        A += d
    return A


def restrict_weights(ctx, W, names, keep_shape=True):
    """뼈 목록 밖의 가중치를 빼고 다시 1로 맞춘다(판금은 팔 따라 휘지 않게)."""
    m = np.zeros(W.shape[1])
    for nm in names:
        m[ctx.bi[nm]] = 1
    W2 = W * m
    s = W2.sum(1, keepdims=True)
    bad = s[:, 0] < 1e-6
    if bad.any():
        W2[bad, ctx.bi[names[0]]] = 1
        s = W2.sum(1, keepdims=True)
    return W2 / s


def grid_tris(R, A, closed=True, flip=False):
    """R줄 × A칸 격자 삼각형(줄마다 A개 점). closed: 둘레가 닫힘."""
    tris = []
    cols = A if closed else A - 1
    for r in range(R - 1):
        for i in range(cols):
            i2 = (i + 1) % A
            a, b, c, d = r * A + i, r * A + i2, (r + 1) * A + i2, (r + 1) * A + i
            tris += [(a, b, c), (a, c, d)]
    t = np.array(tris, np.int64)
    return t[:, ::-1] if flip else t


def orient_outward(pos, tris, center_fn, per_face=True):
    """면 법선이 바깥(center_fn(면 중심)에서 멀어지는 쪽)을 보게 뒤집는다."""
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    cen = (a + b + c) / 3
    out = cen - center_fn(cen)
    s = (fn * out).sum(1)
    if not per_face:
        return tris[:, ::-1] if s.sum() < 0 else tris
    t = tris.copy()
    t[s < 0] = t[s < 0][:, ::-1]
    return t


def hull_radius(pts2, nA, extra=0.0):
    """2D 점들의 볼록 껍질을 원점에서 각도별 반지름으로(빈 칸은 이웃으로 메움)."""
    if len(pts2) < 4:
        return None
    try:
        h = ConvexHull(pts2)
    except Exception:
        return None
    hp = pts2[h.vertices]
    hp2 = np.concatenate([hp, hp[:1]])
    dense = np.concatenate([hp2[k] + (hp2[k + 1] - hp2[k]) * np.linspace(0, 1, 16, endpoint=False)[:, None] for k in range(len(hp))])
    ang = np.arctan2(dense[:, 1], dense[:, 0])
    rad = np.linalg.norm(dense, axis=1)
    ai = np.round((ang % (2 * np.pi)) / (2 * np.pi) * nA).astype(int) % nA
    r = np.zeros(nA)
    np.maximum.at(r, ai, rad)
    for _ in range(nA):
        z = r == 0
        if not z.any():
            break
        r[z] = np.maximum(np.roll(r, 1), np.roll(r, -1))[z]
    return r + extra


def loft(ctx, sel, centers, frames, nA, offset, slab=0.012, smooth_t=2, smooth_a=2, min_r=0.01):
    """축을 따라 몸 단면(볼록 껍질)을 감싸는 고리들. centers (R,3), frames [(a,u,v)], offset(i, theta)->(nA,).
    반환: (R, nA, 3) 점, 반지름 표."""
    P = ctx.P
    R = len(centers)
    th = np.linspace(0, 2 * np.pi, nA, endpoint=False)
    rad = np.zeros((R, nA))
    have = np.zeros(R, bool)
    bm = np.zeros(len(P), bool)
    bm[ctx.body] = True  # 몸 꼭짓점만(MakeHuman 도우미 메시 제외)
    idx = np.nonzero(sel & bm)[0]
    Q = P[idx]
    for i, (c, (a, u, v)) in enumerate(zip(centers, frames)):
        d = Q - c
        h = d @ a
        m = np.abs(h) < slab
        if m.sum() < 6:
            continue
        x = d[m] @ u
        y = d[m] @ v
        r = hull_radius(np.stack([x, y], 1), nA)
        if r is None:
            continue
        rad[i] = r
        have[i] = True
    # 빈 고리는 위아래로 메운다
    if not have.all():
        ok = np.nonzero(have)[0]
        for i in np.nonzero(~have)[0]:
            j = ok[np.argmin(np.abs(ok - i))]
            rad[i] = rad[j]
    # 매끈하게(둘레·축 방향)
    for _ in range(smooth_a):
        rad = 0.25 * np.roll(rad, 1, 1) + 0.5 * rad + 0.25 * np.roll(rad, -1, 1)
    for _ in range(smooth_t):
        r2 = rad.copy()
        r2[1:-1] = 0.25 * rad[:-2] + 0.5 * rad[1:-1] + 0.25 * rad[2:]
        rad = r2
    pts = np.zeros((R, nA, 3))
    for i, (c, (a, u, v)) in enumerate(zip(centers, frames)):
        rr = np.maximum(rad[i] + offset(i, th), min_r)
        pts[i] = c + (np.outer(np.cos(th), u) + np.outer(np.sin(th), v)) * rr[:, None]
    return pts, rad


def frame_from(a, front=np.array([0.0, 0.0, 1.0])):
    a = a / np.linalg.norm(a)
    u = front - (front @ a) * a
    if np.linalg.norm(u) < 1e-6:
        u = np.array([1.0, 0, 0]) - a[0] * a
    u /= np.linalg.norm(u)
    v = np.cross(a, u)
    return a, u, v


def dome(c, nrm, w_row, r, h, seg=10, rings=3, gid=8):
    """반구 모양 징·리벳·단추 하나(바닥은 열림, 표면에 묻힌다)."""
    a, u, v = frame_from(nrm)
    pos = [c + a * h]
    for k in range(1, rings + 1):
        phi = (k / rings) * (np.pi / 2)
        rr = r * np.sin(phi)
        hh = h * np.cos(phi) - h * 0.15 * (k == rings)
        for j in range(seg):
            t = 2 * np.pi * j / seg
            pos.append(c + a * hh + (u * np.cos(t) + v * np.sin(t)) * rr)
    pos = np.array(pos)
    tris = []
    for j in range(seg):
        tris.append((0, 1 + j, 1 + (j + 1) % seg))
    for k in range(rings - 1):
        b0 = 1 + k * seg
        b1 = 1 + (k + 1) * seg
        for j in range(seg):
            j2 = (j + 1) % seg
            tris += [(b0 + j, b1 + j, b1 + j2), (b0 + j, b1 + j2, b0 + j2)]
    tris = np.array(tris, np.int64)
    # 바깥을 보게
    tris = orient_outward(pos, tris, lambda q: c - a * h)
    return G(pos, tris, np.tile(w_row, (len(pos), 1)), gid=gid)


def disc(c, nrm, w_row, r, h, seg=16, gid=8, bevel=0.3):
    """납작한 원반(단추·브로치 바탕): 옆면 + 윗면(가장자리 둥글게)."""
    a, u, v = frame_from(nrm)
    ring = np.array([u * np.cos(t) + v * np.sin(t) for t in np.linspace(0, 2 * np.pi, seg, endpoint=False)])
    rows = [(-h * 0.2, 1.0), (h * (1 - bevel), 1.0), (h, 1.0 - bevel * 0.6)]
    pos = []
    for y, s in rows:
        pos.append(c + a * y + ring * r * s)
    pos = np.concatenate(pos)
    top = len(pos)
    pos = np.concatenate([pos, [c + a * h]])
    tris = []
    for k in range(len(rows) - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            p0, p1 = k * seg + j, k * seg + j2
            q0, q1 = (k + 1) * seg + j, (k + 1) * seg + j2
            tris += [(p0, p1, q1), (p0, q1, q0)]
    last = (len(rows) - 1) * seg
    for j in range(seg):
        tris.append((last + j, last + (j + 1) % seg, top))
    tris = np.array(tris, np.int64)
    tris = orient_outward(pos, tris, lambda q: c)
    return G(pos, tris, np.tile(w_row, (len(pos), 1)), gid=gid)


def sample_curve(P, step, closed=True, start=0.0):
    """폴리라인 위를 step 간격으로 뽑는다. 반환: 점, 각 점의 원래 구간 번호와 비율."""
    Q = np.concatenate([P, P[:1]]) if closed else P
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    t = np.arange(start, L - (0 if closed else 1e-9), step)
    i = np.clip(np.searchsorted(s, t, side='right') - 1, 0, len(seg) - 1)
    f = (t - s[i]) / np.maximum(seg[i], 1e-9)
    return Q[i] * (1 - f[:, None]) + Q[i + 1] * f[:, None], i, f


def nearest_on(g, pts):
    """점마다 메시의 가장 가까운 꼭짓점(위치·법선·가중치)."""
    tree = cKDTree(g['pos'])
    _, j = tree.query(pts)
    N = vertex_normals(g['pos'], g['tris'])
    return g['pos'][j], N[j], g['w'][j]
