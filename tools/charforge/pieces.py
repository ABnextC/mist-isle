# 옷 조각(v0.4.5): 머리·몸통·다리를 갑옷 종류(로브·경갑·중갑)마다 따로 만든다. 기본 개척자 옷은 outfit.py.
# 조각은 몸 표면에서 띄운 껍데기(shell) 또는 단면 로프트로 모양을 잡고, 두께(안쪽 면 + 둥근 단)를 준 뒤
# 단·바느질선·수 띠(셰이더)와 징·리벳·버클·단추(기하)로 꾸민다.
import numpy as np
from garment import shell, smooth_field, interp
from outfit import neck_angle, bump, GID
from geom import (G, clip_mesh, compact_g, solidify, merge, body_weights, smooth_attr, restrict_weights, grid_tris,
                  orient_outward, loft, frame_from, dome, disc, sample_curve, rim_info, nearest_on)
from parts import tube, decimate, sdf_mesh, sd_round_box
from meshutil import vertex_normals
from scipy.spatial import cKDTree

# 재질 칸(클라이언트 charmat.js SLOT과 같은 번호). 0~10은 기본 옷(outfit.GID)
SLOT = dict(GID)
SLOT.update({'robe': 11, 'sash': 12, 'hood': 13, 'lthr': 14, 'linen': 15, 'mail': 16, 'plate': 17, 'pad': 18, 'steel': 19, 'cord': 20})


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


ARM_BONES = ('shL', 'elL', 'handL', 'shR', 'elR', 'handR')
_ctx_ref = {}


def soften_armpit(W, base, names, shy):
    """겨드랑이 아래 옆구리 옷이 팔을 따라 늘어나 거미줄처럼 펴지지 않게, 팔 가중치가 낮은 몸통 쪽은 팔 영향을 더 줄인다"""
    ai = [names.index(k) for k in ARM_BONES]
    aw = W[:, ai].sum(1)
    low = base[:, 1] < shy - 0.035
    k = np.where(low, smoothstep(0.1, 0.42, aw), 1.0)
    W2 = W.copy()
    W2[:, ai] *= k[:, None]
    return W2 / np.maximum(W2.sum(1, keepdims=True), 1e-9)


def from_shell(S):
    W = S['w']
    if 'ctx' in _ctx_ref:
        ctx = _ctx_ref['ctx']
        W = soften_armpit(W, S['base'], ctx.names, ctx.bpos['shL'][1])
    return G(S['pos'], S['gtris'], W, src=S['src'], base=S['base'], nrm0=S['nrm0'], d=S['d'])


def use_ctx(ctx):
    _ctx_ref['ctx'] = ctx


def decim(g, keep, min_tris=80):
    """삼각형 줄이기(테두리 유지). 꼭짓점 속성은 가장 가까운 원래 꼭짓점에서 옮긴다."""
    T = g['tris']
    target = max(min_tris, int(len(T) * keep))
    if len(T) <= target:
        return g
    v2, f2 = decimate(g['pos'], T, target)
    tree = cKDTree(g['pos'])
    _, k = tree.query(v2)
    out = {'pos': v2, 'tris': f2}
    n = len(g['pos'])
    for key, v in g.items():
        if key in ('pos', 'tris'):
            continue
        if isinstance(v, np.ndarray) and v.ndim >= 1 and len(v) == n:
            out[key] = v[k]
        else:
            out[key] = v
    return compact_g(out)


def finish(g, slot, thick, band=0.06, keep=None, bulge=0.35):
    """줄이고 → 두께 → 재질 칸 표시. s['outer']: 두께 주기 전 겉면(단·리벳 자리 찾기용)"""
    if keep:
        g = decim(g, keep)
    s = solidify(g, thick, band=band, bulge=bulge)
    s['mat'] = np.full(len(s['pos']), float(SLOT[slot]) if isinstance(slot, str) else float(slot)) if 'mat' not in g else s['mat']
    s['outer'] = g
    return s


def signed_volume(pos, tris):
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    return (np.cross(a, b) * c).sum() / 6


def part(m, slot):
    """덧붙이는 부품(tube·dome 등)을 조각 메시 형식으로. 닫힌 부품은 면이 바깥을 보게 맞춘다"""
    if hasattr(m, 'pos'):  # garment.Mesh
        g = G(m.pos, m.tris, m.w)
    else:
        g = dict(m)
    from meshutil import boundary_edges
    if len(g['tris']) and len(boundary_edges(g['tris'])) == 0:
        c = g['pos'].mean(0)
        if signed_volume(g['pos'] - c, g['tris']) < 0:
            g['tris'] = g['tris'][:, ::-1].copy()
    n = len(g['pos'])
    g['mat'] = np.full(n, float(SLOT[slot]) if isinstance(slot, str) else float(slot))
    g['edge'] = np.full(n, 0.05)
    g['rimc'] = np.zeros(n)
    g['part'] = np.ones(n)
    if 'loose' not in g:
        g['loose'] = np.zeros(n)
    return g


def tag(g, part_flag=0.0):
    if 'part' not in g:
        g['part'] = np.full(len(g['pos']), part_flag)
    if 'loose' not in g:
        g['loose'] = np.zeros(len(g['pos']))
    return g


def onehot(ctx, name):
    r = np.zeros(len(ctx.names))
    r[ctx.bi[name]] = 1
    return r


def wrow(ctx, **kw):
    r = np.zeros(len(ctx.names))
    for k, v in kw.items():
        r[ctx.bi[k]] = v
    return r / r.sum()


# ── 공통 영역 ───────────────────────────────────────────
def neckline(ctx, L, depth, width, lift=0.0, back=0.012):
    P = ctx.P
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    th = neck_angle(P, L.neck)
    front = np.cos(th)
    y_nl = L.y_neck + lift + back * (1 - front) * 0.5 - 0.025 * np.maximum(front, 0) ** 2
    vee = np.clip(1 - np.abs(x - L.neck[0]) / width, 0, 1) * (z > L.neck[2])
    return (y_nl - depth * vee ** 1.4) - y


def armhole(ctx, L, lo=0.3, hi=0.75):
    y = ctx.P[:, 1]
    shy = ctx.bpos['shL'][1]
    thr = lo + (hi - lo) * np.clip((y - (shy - 0.08)) / 0.08, 0, 1)
    return smooth_field(ctx, thr - L.w_arm, 6) * 0.35


def sleeve_to(L, s_end):
    big = 1.0
    return np.where(L.w_arm > 0.35, (s_end - L.s_arm) * L.fore_len, big)


def no_legs(L):
    return (0.45 - L.w_leg)


def no_arms(L):
    return (0.4 - L.w_arm) * 0.3


# ── 로브(몸통): 감싸 여민 V 목, 종 모양 긴 소매, 허리띠(장식 띠), 무릎 아래까지 앞이 트인 치마, 가슴 브로치 ──
def chest_robe(ctx, L, female):
    P = ctx.P
    y = P[:, 1]
    th = neck_angle(P, L.neck)
    front = np.cos(th)
    y_sash = L.y_belt
    armv = L.w_arm > 0.5
    c = np.minimum.reduce([neckline(ctx, L, 0.16 if not female else 0.135, 0.07, lift=0.008),
                           sleeve_to(L, 1.9), np.where(armv, 1.0, y - (y_sash - 0.022)), np.where(armv, 1.0, no_legs(L))])
    arm = np.clip((L.w_arm - 0.3) / 0.4, 0, 1)
    s = L.s_arm
    sl = np.interp(s, [0, 0.6, 1.0, 1.3, 1.6, 1.9], [0.012, 0.015, 0.017, 0.026, 0.042, 0.058])
    chest = 0.006 * bump(y, L.y_belt, L.y_belt + 0.06, L.y_chest, L.y_chest + 0.1) * np.maximum(front, 0)
    D = (0.014 + chest) * (1 - arm) + sl * arm
    S = shell(ctx, c, D, SLOT['robe'], smooth=40)
    body = from_shell(S)
    body['loose'] = 0.45 * smoothstep(1.3, 1.9, interp(L.s_arm, S['src'])) * (interp(L.w_arm, S['src']) > 0.5)
    parts = []
    # 치마: 허리띠 위에서 무릎 아래까지, 앞이 트인 A자
    kn = ctx.bpos['knL']
    y_top = y_sash + 0.012
    y_hem = kn[1] - 0.07
    R, A = 30, 72
    ys = np.linspace(y_top, y_hem, R)
    sel = ((L.w_leg > 0.2) | ((y < y_top + 0.06) & (L.w_arm < 0.2))) & (L.w_arm < 0.2) & (y > y_hem - 0.08) & (y < y_top + 0.08)
    sel &= ctx.w('handL', 'handR', 'elL', 'elR') < 0.05
    cz = []
    for yy in ys:
        m = sel & (np.abs(y - yy) < 0.015)
        zz = P[m, 2] if m.sum() > 5 else P[sel, 2]
        cz.append(0.5 * (zz.min() + zz.max()))
    cz = np.array(cz)
    cz = np.convolve(np.pad(cz, 3, mode='edge'), np.ones(7) / 7, mode='valid')
    centers = np.stack([np.zeros(R), ys, cz], 1)
    frames = [(np.array([0, -1.0, 0]), np.array([0, 0, 1.0]), np.array([-1.0, 0, 0]))] * R
    rng = np.random.default_rng(11 if female else 7)
    ph = rng.uniform(0, 2 * np.pi, 3)
    tt = (y_top - ys) / (y_top - y_hem)

    def off(i, th):
        t = tt[i]
        base = 0.016 + 0.022 * smoothstep(0.0, 0.3, t)
        flare = 0.075 * t ** 1.5
        amp = 0.022 * t ** 1.1 * (0.75 + 0.25 * np.sin(3 * th + ph[2]))
        fold = amp * (0.6 * np.sin(8 * th + ph[0] + 0.6 * t) + 0.4 * np.sin(13 * th + ph[1] - 0.4 * t))
        back = 0.012 * t * np.clip(-np.cos(th), 0, 1)  # 엉덩이 뒤로 조금 더 떨어진다
        return base + flare + fold + back
    pts, rad = loft(ctx, sel, centers, frames, A, off, slab=0.014, smooth_t=3, smooth_a=3)
    pos = pts.reshape(-1, 3)
    tris = grid_tris(R, A, closed=True)
    tris = orient_outward(pos, tris, lambda q: np.stack([np.zeros(len(q)), q[:, 1], np.interp(-q[:, 1], -ys, cz)], 1))
    W = body_weights(ctx, pos, sel=sel & (ctx.w('handL', 'handR') < 0.05), k=14)
    W = smooth_attr(tris, W, len(pos), iters=25)
    W = restrict_weights(ctx, W, ['hips', 'spine', 'thL', 'thR', 'knL', 'knR'])
    # 무릎 아래 가중치는 반만(정강이를 따라 너무 접히지 않게)
    th_g = np.tile(np.linspace(0, 2 * np.pi, A, endpoint=False), R)
    ring = np.repeat(np.arange(R), A)
    sk = G(pos, tris, W, loose=np.clip(tt[ring], 0, 1) ** 1.3)
    # 앞트임: 위에서 2cm → 밑단 16cm(호 길이)
    gap = np.interp(tt[ring], [0, 0.15, 1], [0.0, 0.03, 0.17])
    thw = np.where(th_g > np.pi, th_g - 2 * np.pi, th_g)
    r_here = np.linalg.norm(pos[:, [0, 2]] - centers[ring][:, [0, 2]], axis=1)
    cfield = np.abs(thw) * r_here - gap / 2
    cfield[tt[ring] < 0.08] = 1.0  # 맨 위는 닫힘(허리띠 아래)
    sk = clip_mesh(sk, cfield)
    parts_skirt = finish(sk, 'robe', 0.0035, band=None, keep=0.6)
    body = finish(body, 'robe', 0.003, band=0.1, keep=0.5)
    # 허리띠(장식 띠): 로브 겉과 치마 위를 덮는다
    yb = y_sash
    c_s = np.minimum.reduce([y - (yb - 0.028), (yb + 0.026) - y, no_arms(L), (0.6 - L.w_leg) * 0.3])
    S2 = shell(ctx, c_s, np.full(len(P), 0.03), SLOT['sash'], smooth=8)
    sg = from_shell(S2)
    # 허리 단면 바깥으로 밀어 치마·로브보다 겉에 놓는다
    cz_y = np.interp(-sg['pos'][:, 1], -ys, cz)
    d2 = sg['pos'][:, [0, 2]] - np.stack([np.zeros(len(cz_y)), cz_y], 1)
    rr = np.linalg.norm(d2, axis=1)
    sk_r = np.linalg.norm(parts_skirt['pos'][:, [0, 2]] - np.stack([np.zeros(len(parts_skirt['pos'])), np.interp(-parts_skirt['pos'][:, 1], -ys, cz)], 1), axis=1)
    top = parts_skirt['pos'][:, 1] > y_top - 0.03
    ang = np.arctan2(d2[:, 0], d2[:, 1])
    # 각도별 치마 위(+로브 몸통 아랫단) 반지름
    armw = body['w'][:, [ctx.bi[k] for k in ('shL', 'elL', 'handL', 'shR', 'elR', 'handR')]].sum(1)
    band_body = body['pos'][(body['pos'][:, 1] < yb + 0.03) & (body['pos'][:, 1] > yb - 0.035) & (armw < 0.2)]
    sp = np.concatenate([parts_skirt['pos'][top], band_body])
    sa_ = np.arctan2(sp[:, 0], sp[:, 2] - np.interp(-sp[:, 1], -ys, cz))
    sr_ = np.linalg.norm(np.stack([sp[:, 0], sp[:, 2] - np.interp(-sp[:, 1], -ys, cz)], 1), axis=1)
    bins = 48
    bi = ((sa_ + np.pi) / (2 * np.pi) * bins).astype(int) % bins
    rmax = np.zeros(bins)
    np.maximum.at(rmax, bi, sr_)
    for _ in range(bins):
        z = rmax == 0
        if not z.any():
            break
        rmax[z] = np.maximum(np.roll(rmax, 1), np.roll(rmax, -1))[z]
    rmax = 0.25 * np.roll(rmax, 1) + 0.5 * rmax + 0.25 * np.roll(rmax, -1)
    bj = ((ang + np.pi) / (2 * np.pi) * bins).astype(int) % bins
    target = np.maximum(rmax[bj], rr) + 0.007
    sg['pos'][:, 0] = d2[:, 0] / np.maximum(rr, 1e-6) * target
    sg['pos'][:, 2] = cz_y + d2[:, 1] / np.maximum(rr, 1e-6) * target
    sash = finish(sg, 'sash', 0.005, band=None, keep=0.7)
    # 매듭 + 늘어진 두 자락(왼쪽 앞)
    fr = sg['pos'][(sg['pos'][:, 0] > 0.045) & (sg['pos'][:, 0] < 0.075)]
    knot_c = fr[np.argmax(fr[:, 2])] + np.array([0.0, -0.004, 0.012])
    hips = onehot(ctx, 'hips')
    kn_fn = lambda p: np.minimum(np.linalg.norm((p - knot_c) / [1.0, 0.8, 0.6], axis=1) - 0.018,
                                 np.linalg.norm((p - knot_c - [0.016, -0.004, -0.004]) / [1.0, 0.7, 0.6], axis=1) - 0.012)
    parts.append(sdf_part(kn_fn, knot_c - 0.05, knot_c + 0.05, 0.0022, hips, 'sash', target=500))
    for k, (dx, ln) in enumerate(((-0.006, 0.24), (0.018, 0.19))):
        p0 = knot_c + np.array([dx, -0.014, 0.006])
        steps = 12
        path = np.array([p0 + np.array([0.008 * np.sin(j * 0.45 + k * 1.3), -ln * j / (steps - 1), 0.02 * (j / (steps - 1)) ** 1.5]) for j in range(steps)])
        wv = 0.032 - 0.01 * np.arange(steps) / steps
        rib = ribbon(ctx, path, wv, np.array([0, 0, 1.0]), 0.004, 'sash', side='L')
        parts.append(rib)
    # 브로치: V 아래 끝, 원반 + 보석
    vb = body['pos'][(body['edge'] < 0.002) & (body['pos'][:, 1] > L.y_belt + 0.08) & (body['pos'][:, 2] > L.neck[2])]
    vb = vb[np.abs(vb[:, 0]) < 0.02]
    if len(vb):
        pt = vb[np.argmin(vb[:, 1])] + np.array([0, -0.006, 0.006])
        wr = wrow(ctx, chest=0.7, spine=0.3)
        parts.append(part(disc(pt, np.array([0, 0.15, 1.0]), wr, 0.017, 0.004, seg=20), 'metal'))
        parts.append(part(dome(pt + np.array([0, 0.0005, 0.004]), np.array([0, 0.15, 1.0]), wr, 0.008, 0.005, seg=12, rings=3), 'steel'))
    parts.append(tag(sash))
    out = merge([tag(body), tag(parts_skirt)] + parts)
    return out


def sdf_part(fn, lo, hi, step, w_row, slot, target=360):
    m = sdf_mesh(fn, lo, hi, step, 0, w_row)
    g = G(m.pos, m.tris, m.w)
    g = decim(g, min(1.0, target / max(1, len(g['tris']))), min_tris=60)
    return part(g, slot)


def ribbon(ctx, path, width, nrm_hint, thick, slot, side='L'):
    """경로를 따라 내려오는 납작한 띠(허리띠 자락): 두께 있는 상자 단면"""
    n = len(path)
    tng = np.gradient(path, axis=0)
    tng /= np.linalg.norm(tng, axis=1, keepdims=True)
    nn = nrm_hint - (tng @ nrm_hint)[:, None] * tng
    nn /= np.linalg.norm(nn, axis=1, keepdims=True)
    bb = np.cross(tng, nn)
    w = np.broadcast_to(np.asarray(width, float), (n,))
    corners = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
    pos = []
    for i in range(n):
        for cx, cy in corners:
            pos.append(path[i] + bb[i] * cx * w[i] + nn[i] * cy * thick)
    pos = np.array(pos)
    tris = grid_tris(n, 4, closed=True)
    # 끝 막기
    tris = np.concatenate([tris, [[0, 2, 1], [0, 3, 2], [(n - 1) * 4, (n - 1) * 4 + 1, (n - 1) * 4 + 2], [(n - 1) * 4, (n - 1) * 4 + 2, (n - 1) * 4 + 3]]])
    ptree = cKDTree(path)
    tris = orient_outward(pos, tris, lambda q: path[ptree.query(q)[1]])
    th = 'thL' if side == 'L' else 'thR'
    W = np.zeros((len(pos), len(ctx.names)))
    t = np.repeat(np.linspace(0, 1, n), 4)
    W[:, ctx.bi['hips']] = 1 - 0.7 * t
    W[:, ctx.bi[th]] = 0.7 * t
    g = G(pos, tris, W, loose=t ** 1.2)
    return part(g, slot)


# ── 공통 손질 ────────────────────────────────────────────
def armw_of(ctx, W):
    return W[:, [ctx.bi[k] for k in ('shL', 'elL', 'handL', 'shR', 'elR', 'handR')]].sum(1)


def convexify_torso(ctx, g, y_lo, y_hi, extra=0.0, slab=0.02, strength=1.0, z_c=None):
    """몸통 옷을 높이 띠마다 볼록 껍질까지 밀어 근육 골(가슴·배·척추)을 덮는다. 팔 쪽은 건드리지 않는다."""
    from geom import hull_radius
    pos = g['pos']
    aw = armw_of(ctx, g['w'])
    torso = aw < 0.25
    y = pos[:, 1]
    nA = 96
    for y0 in np.arange(y_lo, y_hi, slab * 0.5):
        m = torso & (np.abs(y - y0) < slab)
        if m.sum() < 12:
            continue
        cz = 0.5 * (pos[m, 2].min() + pos[m, 2].max()) if z_c is None else z_c
        q = np.stack([pos[m, 0], pos[m, 2] - cz], 1)
        r = hull_radius(q, nA)
        if r is None:
            continue
        mm = torso & (np.abs(y - y0) < slab * 0.25)
        idx = np.nonzero(mm)[0]
        d = np.stack([pos[idx, 0], pos[idx, 2] - cz], 1)
        rr = np.linalg.norm(d, axis=1)
        ang = np.arctan2(d[:, 1], d[:, 0])
        ai = np.round((ang % (2 * np.pi)) / (2 * np.pi) * nA).astype(int) % nA
        k = np.clip((y[idx] - y_lo) / 0.03, 0, 1) * np.clip((y_hi - y[idx]) / 0.03, 0, 1) * strength * (1 - np.clip(aw[idx] / 0.25, 0, 1))
        tgt = np.maximum(r[ai] + extra, rr)
        nr = rr + (tgt - rr) * k
        pos[idx, 0] = d[:, 0] / np.maximum(rr, 1e-6) * nr
        pos[idx, 2] = cz + d[:, 1] / np.maximum(rr, 1e-6) * nr
    g['pos'] = pos
    return g


def rim_loops(g):
    from meshutil import boundary_loops
    return [np.array(l, np.int64) for l in boundary_loops(g['tris']) if len(l) > 5]


def edge_tubes(g, radius, slot, pick=None, lift=0.3, squash=0.75, step=0.009, sides=6):
    """테두리 고리를 따라 말린 단(관)"""
    g = g.get('outer', g)
    out = []
    N = vertex_normals(g['pos'], g['tris'])
    if radius <= 0.0045:
        sides = min(sides, 5)
        step = max(step, 0.012)
    for lp in rim_loops(g):
        P = g['pos'][lp]
        if pick is not None and not pick(P):
            continue
        L = np.linalg.norm(np.diff(np.concatenate([P, P[:1]]), axis=0), axis=1).sum()
        n_out = max(16, int(L / step))
        out.append(part(tube(P, g['w'][lp], N[lp], radius, sides=sides, n_out=n_out, gid=0, lift=lift, squash=squash), slot))
    return out


def rivets_on_rims(g, spacing, inset, r, h, slot, pick=None, seg=6):
    """테두리에서 inset만큼 안쪽에 spacing 간격으로 리벳·징"""
    g = g.get('outer', g)
    out = []
    N = vertex_normals(g['pos'], g['tris'])
    for lp in rim_loops(g):
        P = g['pos'][lp]
        if pick is not None and not pick(P):
            continue
        Nl = N[lp]
        tng = np.roll(P, -1, axis=0) - np.roll(P, 1, axis=0)
        tng /= np.maximum(np.linalg.norm(tng, axis=1, keepdims=True), 1e-9)
        inward = -np.cross(tng, Nl)
        pts, i, f = sample_curve(P, spacing, closed=True, start=spacing * 0.5)
        for p, k in zip(pts, i):
            q = p + inward[k] * inset
            pp, nn, ww = nearest_on(g, q[None])
            out.append(part(dome(pp[0] + nn[0] * 0.0005, nn[0], ww[0], r, h, seg=seg, rings=2), slot))
    return out


def merge_parts(lst):
    return merge([tag(x) for x in lst])


def head_frame(ctx, B):
    H = B['H']
    P = ctx.P
    eL, eR = np.array(H['eye.L']), np.array(H['eye.R'])
    hv = ctx.w('head') > 0.5
    top = P[hv, 1].max()
    eye_y = 0.5 * (eL[1] + eR[1])
    front_z = P[hv, 2].max()
    # 턱 끝: 얼굴 앞쪽(코보다 아래)에서 가장 낮은 머리 점
    fm = hv & (P[:, 2] > ctx.bpos['head'][2] + 0.03) & (np.abs(P[:, 0]) < 0.03)
    chin = P[fm, 1].min() if fm.any() else eye_y - 0.11
    zc = 0.5 * (P[hv, 2].min() + P[hv, 2].max())
    return dict(top=top, eye_y=eye_y, chin=chin, zc=zc, front_z=front_z, eL=eL, eR=eR)


def head_loft(ctx, L, HF, y_top, y_bot, offset_fn, R=30, A=64, cowl_to=None, slab=0.008):
    """머리를 감싸는 고리 로프트(정수리 → 목 → (어깨 덮개)). 정수리는 부채꼴로 막는다."""
    P = ctx.P
    y = P[:, 1]
    hv = (ctx.w('head', 'neck') > 0.4)
    sel_head = hv
    sel_body = (L.w_arm < 0.3) & (y > L.y_chest - 0.05)
    ys = y_top - (y_top - y_bot) * (1 - np.cos(np.linspace(0, np.pi / 2, R))) ** 0.8  # 위쪽 촘촘
    ys = np.linspace(y_top, y_bot, R)
    centers = []
    for yy in ys:
        m = (sel_head if yy > L.y_neck - 0.01 else sel_body) & (np.abs(y - yy) < 0.012)
        if m.sum() > 5:
            centers.append([0.0, yy, 0.5 * (P[m, 2].min() + P[m, 2].max())])
        else:
            centers.append([0.0, yy, HF['zc']])
    centers = np.array(centers)
    centers[:, 2] = np.convolve(np.pad(centers[:, 2], 2, mode='edge'), np.ones(5) / 5, mode='valid')
    frames = [(np.array([0, -1.0, 0]), np.array([0, 0, 1.0]), np.array([-1.0, 0, 0]))] * R
    sel = sel_head | sel_body
    pts, rad = loft(ctx, sel, centers, frames, A, lambda i, th: offset_fn(ys[i], th), slab=slab, smooth_t=2, smooth_a=2)
    # 머리 꼭대기 위는 단면이 없으니 둥근 지붕으로 닫는다
    y0 = HF['top'] - 0.04
    if y_top > y0:
        for i, yy in enumerate(ys):
            if yy > y0:
                k = np.sqrt(max(0.0, 1 - ((yy - y0) / (y_top - y0 + 1e-6)) ** 2))
                c0 = centers[i]
                pts[i] = c0 + (pts[i] - c0) * max(k, 0.06)
    pos = pts.reshape(-1, 3)
    tris = grid_tris(R, A, closed=True)
    # 정수리 막기
    apex = len(pos)
    pos = np.concatenate([pos, [centers[0] + [0, 0.0015, 0]]])
    cap = np.array([[apex, j, (j + 1) % A] for j in range(A)])
    tris = np.concatenate([tris, cap])
    cen_fn = lambda q: np.stack([np.zeros(len(q)), np.clip(q[:, 1], y_bot, y_top - 0.03), np.interp(-q[:, 1], -ys, centers[:, 2])], 1)
    tris = orient_outward(pos, tris, cen_fn)
    return pos, tris, ys, centers


def face_opening(pos, HF, half_w, y_lo, y_hi, round_k=0.6):
    """얼굴 트임(둥근 사각): 안쪽이 음수인 장. 호 길이 기준"""
    d = pos - np.array([0, 0, HF['zc']])
    az = np.arctan2(d[:, 0], d[:, 2])
    r = np.linalg.norm(d[:, [0, 2]], axis=1)
    u = np.abs(az) * r / half_w
    yc = 0.5 * (y_lo + y_hi)
    v = np.abs(pos[:, 1] - yc) / (0.5 * (y_hi - y_lo))
    p = 2.0 + 4.0 * (1 - round_k)
    e = (u ** p + v ** p) ** (1 / p) - 1.0
    e = np.where(d[:, 2] < 0, 1.0, e)  # 뒤쪽은 늘 남김
    return e * 0.05


# ── 머리: 로브 두건(어깨 덮개까지) ───────────────────────
def head_robe(ctx, L, female, B=None):
    HF = head_frame(ctx, B)
    y_top = HF['top'] + 0.03
    y_bot = L.y_neck - 0.13
    kn = L.y_neck

    def off(yy, th):
        crown = smoothstep(HF['eye_y'] - 0.02, HF['top'], yy)
        back = np.clip(-np.cos(th), 0, 1)
        base = 0.024 + 0.012 * crown * back + 0.01 * smoothstep(kn + 0.03, kn - 0.06, yy)
        flare = 0.03 * smoothstep(kn - 0.02, kn - 0.13, yy)
        fold = 0.004 * np.sin(7 * th + 1.3) * smoothstep(kn, kn - 0.12, yy)
        return base + flare + fold
    pos, tris, ys, centers = head_loft(ctx, L, HF, y_top, y_bot, off, R=34, A=64)
    # 뒤쪽 정수리를 살짝 뾰족하게(두건 꼬리)
    d = pos - np.array([0, HF['top'], HF['zc']])
    tip = np.exp(-((pos[:, 1] - HF['top']) ** 2) / 0.003) * np.clip(-d[:, 2] / 0.1, 0, 1)
    pos[:, 1] += 0.025 * tip
    pos[:, 2] -= 0.03 * tip
    W = body_weights(ctx, pos, sel=(ctx.w('head', 'neck', 'chest', 'clavL', 'clavR', 'spine') > 0.5) & (L.w_arm < 0.2), k=10)
    W = smooth_attr(tris, W, len(pos), iters=20)
    W = restrict_weights(ctx, W, ['head', 'neck', 'chest', 'clavL', 'clavR'])
    g = G(pos, tris, W, loose=0.35 * smoothstep(kn - 0.04, kn - 0.13, pos[:, 1]))
    c = face_opening(pos, HF, 0.085 if not female else 0.08, HF['chin'] - 0.012, HF['eye_y'] + 0.06, round_k=0.75)
    g = clip_mesh(g, c)
    hood = finish(g, 'hood', 0.004, band=0.09, keep=0.7, bulge=0.6)
    parts = edge_tubes(hood, 0.0075, 'hood', pick=lambda P: P[:, 2].mean() > HF['zc'] + 0.02, lift=0.2, squash=0.85)
    return merge_parts([hood] + parts)


# ── 머리: 경갑 가죽 두건(꼭 맞음, 가운데 솔기 + 목 덮개) ──
def head_light(ctx, L, female, B=None):
    HF = head_frame(ctx, B)
    y_top = HF['top'] + 0.016
    y_bot = L.y_neck - 0.06
    kn = L.y_neck

    def off(yy, th):
        return 0.013 + 0.004 * np.clip(-np.cos(th), 0, 1) + 0.016 * smoothstep(kn + 0.02, kn - 0.06, yy)
    pos, tris, ys, centers = head_loft(ctx, L, HF, y_top, y_bot, off, R=30, A=64)
    W = body_weights(ctx, pos, sel=(ctx.w('head', 'neck', 'chest', 'clavL', 'clavR') > 0.5) & (L.w_arm < 0.2), k=10)
    W = smooth_attr(tris, W, len(pos), iters=16)
    W = restrict_weights(ctx, W, ['head', 'neck', 'chest'])
    g = G(pos, tris, W)
    c = face_opening(pos, HF, 0.07 if not female else 0.066, HF['chin'] - 0.004, HF['eye_y'] + 0.042, round_k=0.8)
    g = clip_mesh(g, c)
    coif = finish(g, 'lthr', 0.0045, band=0.07, keep=0.65, bulge=0.5)
    parts = edge_tubes(coif, 0.0042, 'leather', lift=0.25)
    # 정수리 가운데 솔기(앞→뒤 둥근 능선)
    ridge = coif['pos'][(np.abs(coif['pos'][:, 0]) < 0.004) & (coif['pos'][:, 1] > HF['eye_y'] + 0.045)]
    if len(ridge) > 8:
        order = np.argsort(np.arctan2(ridge[:, 2] - HF['zc'], ridge[:, 1] - HF['eye_y']))
        rp = ridge[order]
        rp = rp[::max(1, len(rp) // 40)]
        Wr = body_weights(ctx, rp, sel=ctx.w('head') > 0.5, k=4)
        Nr = rp - np.array([0, HF['eye_y'], HF['zc']])
        Nr /= np.linalg.norm(Nr, axis=1, keepdims=True)
        parts.append(part(tube(rp, Wr, Nr, 0.0028, sides=6, closed=False, gid=0, lift=0.1, squash=0.7), 'lthr'))
    return merge_parts([coif] + parts)


# ── 머리: 중갑 코받이 투구 + 사슬 목가리개 ───────────────
def head_heavy(ctx, L, female, B=None):
    HF = head_frame(ctx, B)
    y_rim = HF['eye_y'] + 0.028
    y_top = HF['top'] + 0.03
    head = onehot(ctx, 'head')

    def off_dome(yy, th):
        t = smoothstep(y_rim, HF['top'] + 0.02, yy)
        return 0.024 + 0.006 * (1 - t)
    pos, tris, ys, centers = head_loft(ctx, L, HF, y_top, y_rim, off_dome, R=22, A=64)
    # 꼭대기를 살짝 뾰족하게(스팡겐헬름)
    t = smoothstep(HF['top'] - 0.06, HF['top'] + 0.04, pos[:, 1])
    rr = np.linalg.norm(pos[:, [0, 2]] - np.array([0, HF['zc']]), axis=1)
    pos[:, 1] += 0.011 * t ** 2 * np.exp(-(rr / 0.06) ** 2)
    W = np.tile(head, (len(pos), 1))
    dome_g = G(pos, tris, W)
    helm = finish(dome_g, 'plate', 0.0025, band=0.04, keep=0.8, bulge=0.4)
    parts = []
    # 이마 띠(테두리 관) + 리벳
    parts += edge_tubes(helm, 0.006, 'plate', lift=0.4, squash=0.9, step=0.008, sides=7)
    parts += rivets_on_rims(helm, 0.032, 0.0, 0.0045, 0.003, 'steel')
    # 코받이: 이마 띠 앞에서 코등을 따라 내려오는 판
    nf = helm['outer']['pos'][(np.abs(helm['outer']['pos'][:, 0]) < 0.012)]
    if len(nf):
        p0 = nf[np.argmin(nf[:, 1] - nf[:, 2] * 3)]
        P = ctx.P
        hv = ctx.w('head') > 0.5
        yb = HF['eye_y'] - 0.032
        nb = hv & (np.abs(P[:, 0]) < 0.006) & (np.abs(P[:, 1] - yb) < 0.005)
        zb = P[nb, 2].max() + 0.009 if nb.any() else p0[2] - 0.01
        p_top = p0 + np.array([0, 0.012, 0.004])
        p_bot = np.array([0.0, yb - 0.01, zb])
        path = np.stack([p_top + (p_bot - p_top) * f for f in np.linspace(0, 1, 6)])
        wv = np.linspace(0.026, 0.018, 6)
        nas = ribbon(ctx, path, wv, np.array([0, 0.25, 1.0]), 0.0035, 'plate', side='L')
        nas['w'][:] = head
        parts.append(nas)
    # 사슬 목가리개: 투구 아랫단 안쪽에서 어깨까지, 얼굴은 트임
    y_av_top = y_rim + 0.01
    y_av_bot = L.y_neck - 0.09
    kn = L.y_neck

    def off_av(yy, th):
        return 0.02 + 0.012 * smoothstep(kn + 0.02, kn - 0.04, yy) + 0.03 * smoothstep(kn - 0.02, kn - 0.09, yy)
    pos2, tris2, ys2, c2 = head_loft(ctx, L, HF, y_av_top, y_av_bot, off_av, R=24, A=64)
    keep_t = np.ones(len(tris2), bool)
    pos2 = pos2[:-1]
    tris2 = tris2[(tris2 < len(pos2)).all(1)]
    W2 = body_weights(ctx, pos2, sel=(ctx.w('head', 'neck', 'chest', 'clavL', 'clavR') > 0.5) & (L.w_arm < 0.2), k=10)
    W2 = smooth_attr(tris2, W2, len(pos2), iters=16)
    W2 = restrict_weights(ctx, W2, ['head', 'neck', 'chest'])
    top_rows = pos2[:, 1] > y_rim - 0.02
    W2[top_rows] = head
    g2 = G(pos2, tris2, W2)
    c = face_opening(pos2, HF, 0.068 if not female else 0.064, HF['chin'] - 0.008, y_rim + 0.05, round_k=0.85)
    g2 = clip_mesh(g2, c)
    mail = finish(g2, 'mail', 0.003, band=0.06, keep=0.7, bulge=0.5)
    parts += edge_tubes(mail, 0.0035, 'leather', pick=lambda P: P[:, 1].mean() < kn, lift=0.2)
    return merge_parts([helm, mail] + parts)


# ── 다리 공통: 다리 매개변수로 자른 바지 껍데기 ─────────────
def trouser_shell(ctx, L, slot, extra=0.0, s_end=1.55, smooth=40, convex=True):
    P = ctx.P
    y = P[:, 1]
    leg = L.w_leg > 0.5
    c = np.minimum.reduce([(L.y_belt + 0.022) - y, np.where(leg, (s_end - L.s_leg) * L.shin_len, 1.0), (0.4 - L.w_arm) * 0.3])
    sl = L.s_leg
    legd = np.interp(sl, [0, 0.3, 0.8, 1.02, 1.15, 1.6], [0.016, 0.024, 0.022, 0.017, 0.0095, 0.008]) + extra * np.interp(sl, [0, 1.0, 1.1, 1.6], [1, 1, 0.3, 0.0])
    lw = np.clip((L.w_leg - 0.2) / 0.5, 0, 1)
    D = (0.0105 + extra * 0.5) * (1 - lw) + legd * lw
    S = shell(ctx, c, D, SLOT[slot] if isinstance(slot, str) else slot, smooth=smooth)
    if convex:
        from outfit import tube_band
        sl_t = interp(L.s_leg, S['src'])
        tube_band(S, sl_t, ctx, lo=0.18, hi=1.1, extra=0.005 + extra * 0.4)
        low = np.clip((sl_t - 1.08) / 0.08, 0, 1)[:, None]
        S['pos'] = S['pos'] * (1 - low) + (S['base'] + S['nrm0'] * S['d'][:, None]) * low
    return from_shell(S)


def leg_patch(ctx, L, s0, s1, ang, d, slot, smooth=30, side_w=1.0):
    """다리 앞쪽 판(허벅지판·무릎덮개·정강이판): 다리 매개변수 s0~s1, 앞에서 ±ang(라디안)"""
    P = ctx.P
    out = []
    for sx, side in ((1, 'L'), (-1, 'R')):
        th_, kn_, ft_ = ctx.bpos['th' + side], ctx.bpos['kn' + side], ctx.bpos['ft' + side]
        on = (L.w_leg > 0.5) & (P[:, 0] * sx > 0)
        # 다리 축에서 본 앞 방향 각
        axis_pt = np.where((L.s_leg <= 1.0)[:, None], th_ + (kn_ - th_) * np.clip(L.s_leg, 0, 1)[:, None], kn_ + (ft_ - kn_) * np.clip(L.s_leg - 1, 0, 1)[:, None])
        dv = P - axis_pt
        az = np.arctan2(dv[:, 0] * sx, dv[:, 2])  # 앞 0, 바깥 +
        c = np.where(on, np.minimum.reduce([(L.s_leg - s0) * 0.3, (s1 - L.s_leg) * 0.3, (ang - np.abs(az - 0.15 * side_w)) * 0.05]), -1.0)
        S = shell(ctx, smooth_field(ctx, c, 4), np.full(len(P), d) if np.ndim(d) == 0 else d, SLOT[slot] if isinstance(slot, str) else slot, smooth=smooth)
        out.append(from_shell(S))
    return out


def plate_up(g, iters=40):
    """판금처럼 매끈하게: 오목한 곳을 크게 메운다"""
    from garment import drape
    g['pos'] = drape(g['pos'], g['tris'], g['base'], g['nrm0'], g['d'], iters, 0.5, pin=None)
    return g


def strap_band(ctx, L, limb, s_at, width, d, slot, side, angle_skip=None):
    """팔·다리를 두르는 가죽 끈(띠)"""
    P = ctx.P
    if limb == 'leg':
        on = (L.w_leg > 0.5) & (P[:, 0] * (1 if side == 'L' else -1) > 0)
        s = L.s_leg
        Ln = L.thigh_len if s_at < 1 else L.shin_len
    else:
        on = (L.w_arm > 0.5) & (P[:, 0] * (1 if side == 'L' else -1) > 0)
        s = L.s_arm
        Ln = L.arm_len if s_at < 1 else L.fore_len
    half = width / Ln / 2
    c = np.where(on, np.minimum(s - (s_at - half), (s_at + half) - s), -1.0)
    S = shell(ctx, c, np.full(len(P), d), SLOT[slot] if isinstance(slot, str) else slot, smooth=6)
    return from_shell(S)


# ── 팔·다리 축 로프트(판·띠·팔뚝 가리개) ───────────────────
def limb_chain(ctx, limb, side):
    if limb == 'leg':
        return ctx.bpos['th' + side], ctx.bpos['kn' + side], ctx.bpos['ft' + side]
    return ctx.bpos['sh' + side], ctx.bpos['el' + side], ctx.bpos['hand' + side]


def limb_frame(ctx, limb, side, s):
    A, Bk, C = limb_chain(ctx, limb, side)
    if s <= 1:
        c = A + (Bk - A) * s
    else:
        c = Bk + (C - Bk) * (s - 1)
    a1 = (Bk - A) / np.linalg.norm(Bk - A)
    a2 = (C - Bk) / np.linalg.norm(C - Bk)
    k = smoothstep(0.85, 1.15, s)
    a = a1 * (1 - k) + a2 * k
    return c, frame_from(a)


def limb_loft(ctx, L, limb, side, s0, s1, offset_fn, R=10, A=48, arc=None, slab=0.012, extra_sel=None):
    """팔·다리를 따라 고리(또는 앞쪽 호). offset_fn(s, theta). arc=(가운데 각, 반폭): 열린 판."""
    P = ctx.P
    sx = 1 if side == 'L' else -1
    if limb == 'leg':
        sel = (L.w_leg > 0.5) & (P[:, 0] * sx > 0)
    else:
        sel = (L.w_arm > 0.5) & (P[:, 0] * sx > 0) & (ctx.w('hand' + side) < 0.5)
    if extra_sel is not None:
        sel &= extra_sel
    ss = np.linspace(s0, s1, R)
    cf = [limb_frame(ctx, limb, side, s) for s in ss]
    centers = np.array([c for c, _ in cf])
    frames = [f for _, f in cf]
    nA_full = 96
    pts, rad = loft(ctx, sel, centers, frames, nA_full, lambda i, th: offset_fn(ss[i], th), slab=slab, smooth_t=2, smooth_a=3)
    th_full = np.linspace(0, 2 * np.pi, nA_full, endpoint=False)
    if arc is None:
        idx = np.round(np.linspace(0, nA_full, A, endpoint=False)).astype(int) % nA_full
        pos = pts[:, idx].reshape(-1, 3)
        tris = grid_tris(R, A, closed=True)
        Acols = A
    else:
        cth, half = arc
        # v축이 몸 안쪽/바깥을 가르므로 왼·오른쪽이 같은 '바깥'을 쓰도록 부호를 맞춘다
        cth = cth * (-sx)
        tq = cth + np.linspace(-half, half, A)
        # 원 각도 표를 보간
        out = np.zeros((R, A, 3))
        for i in range(R):
            c = centers[i]
            a, u, v = frames[i]
            rr = np.interp(tq % (2 * np.pi), np.concatenate([th_full, [2 * np.pi]]), np.concatenate([rad[i], rad[i][:1]]))
            rr = rr + offset_fn(ss[i], tq)
            out[i] = c + (np.outer(np.cos(tq), u) + np.outer(np.sin(tq), v)) * rr[:, None]
        pos = out.reshape(-1, 3)
        tris = grid_tris(R, A, closed=False)
        Acols = A
    ring = np.repeat(np.arange(R), Acols)
    cen_fn_c = centers
    tris = orient_outward(pos, tris, lambda q: cen_fn_c[np.argmin(((q[:, None, :] - cen_fn_c[None]) ** 2).sum(2), axis=1)])
    W = body_weights(ctx, pos, sel=sel, k=10)
    W = smooth_attr(tris, W, len(pos), iters=10)
    return G(pos, tris, W), ss


def ring_band(ctx, L, limb, side, s_at, width, off, slot, thick=0.003, A=40):
    """팔·다리를 두르는 띠(끈·붕대)"""
    Ln = (L.thigh_len if s_at < 1 else L.shin_len) if limb == 'leg' else (L.arm_len if s_at < 1 else L.fore_len)
    ds = width / Ln / 2
    g, _ = limb_loft(ctx, L, limb, side, s_at - ds, s_at + ds, lambda s, th: off, R=3, A=A)
    return finish(g, slot, thick, band=None, keep=None, bulge=0.6)


def limb_plate(ctx, L, limb, side, s0, s1, off, half_ang, slot='plate', thick=0.0025, R=14, A=22, center_ang=0.0, rivet=0.032, rim_r=0.004):
    g, ss = limb_loft(ctx, L, limb, side, s0, s1, off, R=R, A=A, arc=(center_ang, half_ang))
    k = finish(g, slot, thick, band=None, keep=None, bulge=0.45)
    out = [k]
    out += edge_tubes(k, rim_r, slot, lift=0.35, squash=0.9, step=0.008)
    if rivet:
        out += rivets_on_rims(k, rivet, 0.011, 0.004, 0.0028, 'steel' if slot == 'plate' else 'metal')
    return out


def legs_robe(ctx, L, female):
    g = trouser_shell(ctx, L, 'linen', extra=0.006)
    tr = finish(g, 'linen', 0.0025, band=0.06, keep=0.6)
    parts = []
    # 무릎 아래를 여민 끈 두 줄
    for side in ('L', 'R'):
        for s_at, o in ((1.2, 0.024), (1.3, 0.021)):
            parts.append(ring_band(ctx, L, 'leg', side, s_at, 0.007, o, 'cord', thick=0.004))
    return merge_parts([tr] + parts)


def legs_light(ctx, L, female):
    g = trouser_shell(ctx, L, 'lthr', extra=0.003)
    tr = finish(g, 'lthr', 0.0035, band=0.06, keep=0.6)
    parts = []
    for side in ('L', 'R'):
        # 무릎 덮개(둥근 가죽, 징)
        parts += limb_plate(ctx, L, 'leg', side, 0.86, 1.14, lambda s, th: 0.026 + 0.012 * np.sin(np.clip((s - 0.86) / 0.28, 0, 1) * np.pi), 1.05,
                            slot='lthr', thick=0.0045, R=10, A=16, rivet=0.028, rim_r=0.0032)
        # 무릎 위·아래 끈
        parts.append(ring_band(ctx, L, 'leg', side, 0.83, 0.016, 0.027, 'leather', thick=0.003))
        parts.append(ring_band(ctx, L, 'leg', side, 1.17, 0.014, 0.022, 'leather', thick=0.003))
    return merge_parts([tr] + parts)


def legs_heavy(ctx, L, female):
    g = trouser_shell(ctx, L, 'pad', extra=0.007)
    tr = finish(g, 'pad', 0.004, band=0.06, keep=0.6)
    parts = []
    for side in ('L', 'R'):
        # 허벅지판(앞·바깥), 무릎덮개, 정강이판(장화 위)
        parts += limb_plate(ctx, L, 'leg', side, 0.2, 0.86, lambda s, th: 0.036, 1.25, R=14, A=20, center_ang=0.35)
        parts += limb_plate(ctx, L, 'leg', side, 0.82, 1.15, lambda s, th: 0.04 + 0.014 * np.sin(np.clip((s - 0.82) / 0.33, 0, 1) * np.pi), 1.3, R=10, A=18)
        parts += limb_plate(ctx, L, 'leg', side, 1.16, 1.84, lambda s, th: 0.03 + 0.01 * smoothstep(1.7, 1.16, s), 1.35, R=14, A=18)
        for s_at in (0.4, 0.72):
            parts.append(ring_band(ctx, L, 'leg', side, s_at, 0.018, 0.033, 'leather', thick=0.003))
        for s_at in (1.34, 1.66):
            parts.append(ring_band(ctx, L, 'leg', side, s_at, 0.016, 0.026, 'leather', thick=0.003))
    return merge_parts([tr] + parts)


def ring_radius_fn(meshes, y0, half, zc, bins=72, armw_ctx=None):
    """여러 메시의 y0±half 높이 점들로 (각도 → 최대 반지름) 표"""
    pts = []
    for m in meshes:
        p = m['pos']
        sel = np.abs(p[:, 1] - y0) < half
        if armw_ctx is not None:
            sel &= armw_of(armw_ctx, m['w']) < 0.2
        pts.append(p[sel])
    pts = np.concatenate(pts) if pts else np.zeros((0, 3))
    a = np.arctan2(pts[:, 0], pts[:, 2] - zc)
    r = np.linalg.norm(np.stack([pts[:, 0], pts[:, 2] - zc], 1), axis=1)
    bi = ((a + np.pi) / (2 * np.pi) * bins).astype(int) % bins
    rmax = np.zeros(bins)
    np.maximum.at(rmax, bi, r)
    for _ in range(bins):
        z = rmax == 0
        if not z.any():
            break
        rmax[z] = np.maximum(np.roll(rmax, 1), np.roll(rmax, -1))[z]
    rmax = np.maximum.reduce([np.roll(rmax, 1), rmax, np.roll(rmax, -1)])  # 봉우리를 깎지 않게 최댓값으로 편다
    return lambda ang: rmax[((ang + np.pi) / (2 * np.pi) * bins).astype(int) % bins]


def waist_band(ctx, L, y0, half_h, refs, gap, slot, thick, zc=None, keep=0.8):
    """허리를 두르는 띠(허리띠·허리 판): 몸 띠를 잘라 refs 바깥(gap)으로 민다"""
    P = ctx.P
    y = P[:, 1]
    c = np.minimum.reduce([y - (y0 - half_h), (y0 + half_h) - y, no_arms(L), (0.6 - L.w_leg) * 0.3])
    S = shell(ctx, c, np.full(len(P), 0.02), SLOT[slot] if isinstance(slot, str) else slot, smooth=6)
    g = from_shell(S)
    if zc is None:
        m = (np.abs(y - y0) < 0.02) & (L.w_arm < 0.2)
        m[np.setdiff1d(np.arange(len(P)), ctx.body)] = False
        zc = 0.5 * (P[m, 2].min() + P[m, 2].max())
    rf = ring_radius_fn(refs, y0, half_h + 0.012, zc, armw_ctx=ctx)
    d = g['pos'][:, [0, 2]] - np.array([0, zc])
    rr = np.linalg.norm(d, axis=1)
    ang = np.arctan2(d[:, 0], d[:, 1])
    tgt = np.maximum(rf(ang), rr) + gap
    g['pos'][:, 0] = d[:, 0] / np.maximum(rr, 1e-6) * tgt
    g['pos'][:, 2] = zc + d[:, 1] / np.maximum(rr, 1e-6) * tgt
    return finish(g, slot, thick, band=None, keep=keep, bulge=0.4)


def hip_skirt(ctx, L, y_top, y_hem, off, R=24, A=72, slits=None, seed=3, segments=None):
    """허리에서 늘어지는 치마 로프트(두 다리를 함께 감쌈). slits: [(가운데 각, 반폭 m)], segments: 조각 치마(각 범위 목록)"""
    P = ctx.P
    y = P[:, 1]
    ys = np.linspace(y_top, y_hem, R)
    sel = ((L.w_leg > 0.2) | ((y < y_top + 0.06) & (L.w_arm < 0.2))) & (L.w_arm < 0.2) & (y > y_hem - 0.08) & (y < y_top + 0.08)
    sel &= ctx.w('handL', 'handR', 'elL', 'elR') < 0.05
    bm = np.zeros(len(P), bool)
    bm[ctx.body] = True
    sel &= bm
    cz = []
    for yy in ys:
        m = sel & (np.abs(y - yy) < 0.015)
        zz = P[m, 2] if m.sum() > 5 else P[sel, 2]
        cz.append(0.5 * (zz.min() + zz.max()))
    cz = np.convolve(np.pad(np.array(cz), 3, mode='edge'), np.ones(7) / 7, mode='valid')
    centers = np.stack([np.zeros(R), ys, cz], 1)
    frames = [(np.array([0, -1.0, 0]), np.array([0, 0, 1.0]), np.array([-1.0, 0, 0]))] * R
    tt = (y_top - ys) / (y_top - y_hem)
    pts, rad = loft(ctx, sel, centers, frames, A, lambda i, th: off(tt[i], th), slab=0.014, smooth_t=3, smooth_a=3)
    pos = pts.reshape(-1, 3)
    tris = grid_tris(R, A, closed=True)
    tris = orient_outward(pos, tris, lambda q: np.stack([np.zeros(len(q)), q[:, 1], np.interp(-q[:, 1], -ys, cz)], 1))
    W = body_weights(ctx, pos, sel=sel, k=14)
    W = smooth_attr(tris, W, len(pos), iters=25)
    W = restrict_weights(ctx, W, ['hips', 'spine', 'thL', 'thR', 'knL', 'knR'])
    th_g = np.tile(np.linspace(0, 2 * np.pi, A, endpoint=False), R)
    ring = np.repeat(np.arange(R), A)
    g = G(pos, tris, W, loose=np.clip(tt[ring], 0, 1) ** 1.3)
    thw = np.where(th_g > np.pi, th_g - 2 * np.pi, th_g)
    r_here = np.linalg.norm(pos[:, [0, 2]] - centers[ring][:, [0, 2]], axis=1)
    c = np.full(len(pos), 1.0)
    for ca, half in (slits or []):
        dth = np.abs((thw - ca + np.pi) % (2 * np.pi) - np.pi)
        h = half(tt[ring]) if callable(half) else half
        c = np.minimum(c, dth * r_here - h)
    if segments:
        cs = np.full(len(pos), -1.0)
        for a0, a1 in segments:
            mid = 0.5 * (a0 + a1)
            hw = 0.5 * (a1 - a0)
            dth = np.abs((thw - mid + np.pi) % (2 * np.pi) - np.pi)
            cs = np.maximum(cs, (hw - dth) * r_here)
        c = np.minimum(c, np.where(tt[ring] < 0.04, 1.0, cs))
    if slits or segments:
        g = clip_mesh(g, c)
    return g, (ys, cz)


# ── 경갑: 리넨 속셔츠 + 가죽 조끼 갑옷(앞 끈·버클, 징), 어깨받이 두 겹, 팔뚝 가리개(끈 엮음), 허리띠, 가죽 치마 조각 ──
def chest_light(ctx, L, female):
    from outfit import offsets as base_offsets
    P = ctx.P
    y = P[:, 1]
    D0 = base_offsets(ctx, L, female)
    armv = L.w_arm > 0.5
    # 속셔츠: 소매 손목까지, 둥근 목
    c_sh = np.minimum.reduce([neckline(ctx, L, 0.025, 0.06, lift=0.004), sleeve_to(L, 1.9), np.where(armv, 1.0, y - (L.y_belt - 0.075)), np.where(armv, 1.0, no_legs(L))])
    sl = np.interp(L.s_arm, [0, 0.5, 1.0, 1.5, 1.9], [0.007, 0.01, 0.013, 0.015, 0.018])
    arm = np.clip((L.w_arm - 0.3) / 0.4, 0, 1)
    Dsh = D0['shirt'] * (1 - arm) + sl * arm
    shirt = from_shell(shell(ctx, c_sh, Dsh, SLOT['linen'], smooth=30))
    shirt = finish(shirt, 'linen', 0.0025, band=0.07, keep=0.4)
    # 가죽 조끼 갑옷: 목은 셔츠보다 조금 아래, 팔 구멍, 엉덩이 위까지
    c_j = np.minimum.reduce([neckline(ctx, L, 0.06, 0.075, lift=-0.012), armhole(ctx, L, 0.22, 0.7), y - (L.y_hips + 0.005), no_legs(L) + 0.2])
    Dj = Dsh + 0.011 + 0.004 * bump(y, L.y_belt - 0.05, L.y_belt, L.y_chest, L.y_chest + 0.08)
    jg = from_shell(shell(ctx, c_j, Dj, SLOT['lthr'], smooth=40))
    jg = convexify_torso(ctx, jg, L.y_hips, L.y_neck - 0.02, extra=0.003)
    jer = finish(jg, 'lthr', 0.0045, band=0.06, keep=0.32, bulge=0.45)
    parts = []
    parts += edge_tubes(jer, 0.0038, 'leather', lift=0.25)
    parts += rivets_on_rims(jer, 0.03, 0.013, 0.0042, 0.003, 'metal', pick=lambda Pp: Pp[:, 1].mean() < L.y_chest)
    # 앞가슴 끈 넷(가운데를 가로지르는 끈 + 버클)
    jo = jer['outer']
    for k, yk in enumerate(np.linspace(L.y_belt + 0.06, L.y_chest + 0.02, 4)):
        m = (np.abs(jo['pos'][:, 1] - yk) < 0.03) & (jo['pos'][:, 2] > 0) & (np.abs(jo['pos'][:, 0]) < 0.09)
        if m.sum() < 4:
            continue
        sp = jo['pos'][m]
        xs = np.linspace(-0.045, 0.045, 9)
        path = []
        for xv in xs:
            near = sp[np.argmin(np.abs(sp[:, 0] - xv) + 3 * np.abs(sp[:, 1] - yk))]
            path.append([xv, yk, near[2] + 0.0035])
        path = np.array(path)
        st = ribbon(ctx, path, np.full(len(path), 0.016), np.array([0, 0, 1.0]), 0.003, 'leather', side='L')
        st['w'][:] = body_weights(ctx, path.mean(0)[None], sel=(L.w_arm < 0.1), k=8)[0]
        parts.append(st)
        bc = path[6] + np.array([0, 0, 0.003])
        wr = st['w'][0]
        bfn = lambda p, bc=bc: np.maximum(sd_round_box(p, bc, (0.012, 0.011, 0.0028), 0.0016), -sd_round_box(p, bc, (0.008, 0.007, 0.01), 0.001))
        parts.append(sdf_part(bfn, bc - 0.02, bc + 0.02, 0.0011, wr, 'metal', target=220))
    # 어깨받이(가죽 두 겹)
    for side in ('L', 'R'):
        parts += limb_plate(ctx, L, 'arm', side, -0.02, 0.3, lambda s, th: 0.03 + 0.006 * smoothstep(0.0, 0.3, s), 1.45, slot='lthr', thick=0.0045,
                            R=10, A=18, center_ang=np.pi / 2, rivet=0.03, rim_r=0.0032)
        parts += limb_plate(ctx, L, 'arm', side, 0.22, 0.46, lambda s, th: 0.035 + 0.004 * smoothstep(0.22, 0.46, s), 1.3, slot='lthr', thick=0.0045,
                            R=8, A=16, center_ang=np.pi / 2, rivet=0.03, rim_r=0.0032)
        # 팔뚝 가리개(가죽 통) + 양 끝 단
        g, ss = limb_loft(ctx, L, 'arm', side, 1.38, 1.86, lambda s, th: 0.021 + 0.004 * smoothstep(1.5, 1.86, s), R=10, A=32)
        vb = finish(g, 'lthr', 0.004, band=None, keep=None, bulge=0.5)
        parts.append(vb)
        parts += edge_tubes(vb, 0.003, 'leather', lift=0.25)
        # 안쪽 엮은 끈(지그재그)
        cpts = []
        for j, s in enumerate(np.linspace(1.42, 1.82, 9)):
            c, (a, u, v) = limb_frame(ctx, 'arm', side, s)
            sx = 1 if side == 'L' else -1
            ang = (-np.pi / 2) * (-sx) + (0.22 if j % 2 else -0.22)
            q = vb['outer']['pos']
            dd = q - c
            on = np.abs(dd @ a) < 0.01
            if on.sum() < 3:
                continue
            ds = dd[on]
            angs = np.arctan2(ds @ v, ds @ u)
            k = np.argmin(np.abs((angs - ang + np.pi) % (2 * np.pi) - np.pi))
            cpts.append(q[on][k] + (q[on][k] - c) / np.linalg.norm(q[on][k] - c) * 0.002)
        if len(cpts) > 3:
            cpts = np.array(cpts)
            Wc = body_weights(ctx, cpts, sel=ctx.w('el' + side, 'hand' + side) > 0.3, k=6)
            Nc = vertex_normals(cpts, np.zeros((0, 3), np.int64)) if False else (cpts - cpts.mean(0))
            Nc /= np.maximum(np.linalg.norm(Nc, axis=1, keepdims=True), 1e-9)
            parts.append(part(tube(cpts, Wc, Nc, 0.0018, sides=5, closed=False, gid=0, lift=0.0, squash=1.0), 'cord'))
    # 허리띠 + 버클 + 주머니
    belt = waist_band(ctx, L, L.y_belt - 0.01, 0.019, [jer], 0.004, 'leather', 0.004)
    parts.append(belt)
    bo = belt['outer']['pos']
    fr = bo[np.argmax(bo[:, 2] - 2 * np.abs(bo[:, 0]))]
    hips = onehot(ctx, 'hips')
    bc = fr + np.array([0, 0, 0.004])
    parts.append(sdf_part(lambda p: np.maximum(sd_round_box(p, bc, (0.026, 0.022, 0.0045), 0.0025), -sd_round_box(p, bc, (0.017, 0.013, 0.02), 0.0015)), bc - 0.035, bc + 0.035, 0.0014, hips, 'metal', target=300))
    side_pt = bo[np.argmin(bo[:, 0] + 0.5 * np.abs(bo[:, 2]))]
    pc = side_pt + np.array([-0.02, -0.05, 0.0])
    parts.append(sdf_part(lambda p: sd_round_box(p, pc, (0.02, 0.045, 0.055), 0.011), pc - 0.07, pc + 0.07, 0.003, hips, 'leather', target=400))
    # 가죽 치마 조각 6개(엉덩이~허벅지 가운데)
    nseg = 6
    gapa = 0.07
    segs = [(-np.pi + k * 2 * np.pi / nseg + gapa, -np.pi + (k + 1) * 2 * np.pi / nseg - gapa) for k in range(nseg)]
    sk, _ = hip_skirt(ctx, L, L.y_hips + 0.012, L.y_hips - 0.17, lambda t, th: 0.036 + 0.018 * t, R=12, A=96, segments=segs)
    skirt = finish(sk, 'lthr', 0.0045, band=None, keep=None, bulge=0.45)
    parts.append(skirt)
    parts += edge_tubes(skirt, 0.003, 'leather', lift=0.25)
    parts += rivets_on_rims(skirt, 0.04, 0.012, 0.004, 0.003, 'metal', pick=lambda Pp: True)
    return merge_parts([shirt, jer] + parts)


# ── 중갑: 사슬 갑옷(소매 손목까지, 높은 깃, 앞뒤 트인 치마) + 가슴·등판 + 허리 판 두 단 + 어깨 판 세 겹 + 팔뚝 판 ──
def chest_heavy(ctx, L, female):
    P = ctx.P
    y = P[:, 1]
    armv = L.w_arm > 0.5
    c_m = np.minimum.reduce([neckline(ctx, L, 0.0, 0.05, lift=0.03), sleeve_to(L, 1.86), np.where(armv, 1.0, y - (L.y_belt - 0.03)), np.where(armv, 1.0, no_legs(L))])
    sl = np.interp(L.s_arm, [0, 0.5, 1.0, 1.5, 1.86], [0.01, 0.012, 0.014, 0.015, 0.016])
    arm = np.clip((L.w_arm - 0.3) / 0.4, 0, 1)
    Dm = 0.013 * (1 - arm) + sl * arm
    mg = from_shell(shell(ctx, c_m, Dm, SLOT['mail'], smooth=35))
    mg = convexify_torso(ctx, mg, L.y_belt - 0.03, L.y_neck, extra=0.002)
    mail = finish(mg, 'mail', 0.003, band=0.07, keep=0.38, bulge=0.5)
    parts = []
    parts += edge_tubes(mail, 0.0035, 'leather', pick=lambda Pp: Pp[:, 1].mean() > L.y_chest, lift=0.25)
    # 사슬 치마(앞뒤 트임) 허벅지 아래까지
    y_hem = ctx.bpos['knL'][1] + 0.16
    sk, (ys, cz) = hip_skirt(ctx, L, L.y_belt - 0.0, y_hem, lambda t, th: 0.016 + 0.045 * smoothstep(0.0, 0.35, t) + 0.02 * t ** 1.4 + 0.006 * t * np.sin(7 * th + 0.5),
                             R=20, A=72, slits=[(0.0, lambda t: 0.004 + 0.05 * smoothstep(0.35, 1.0, t)), (np.pi, lambda t: 0.004 + 0.045 * smoothstep(0.45, 1.0, t))])
    mskirt = finish(sk, 'mail', 0.003, band=None, keep=None, bulge=0.5)
    parts.append(mskirt)
    # 가슴·등판: 사슬 위, 아주 매끈한 판
    c_p = np.minimum.reduce([neckline(ctx, L, 0.018, 0.07, lift=-0.035, back=0.02), armhole(ctx, L, 0.12, 0.55), y - (L.y_belt - 0.012), no_legs(L) + 0.3])
    Dp = np.full(len(P), 0.036)
    pg = from_shell(shell(ctx, smooth_field(ctx, c_p, 6), Dp, SLOT['plate'], smooth=60))
    pg = convexify_torso(ctx, pg, L.y_belt - 0.02, L.y_neck, extra=0.004)
    pg = plate_up(pg, 30)
    pg = convexify_torso(ctx, pg, L.y_belt - 0.02, L.y_neck, extra=0.0)
    # 가운데 능선(앞)
    q = pg['pos']
    ridge = np.clip(1 - np.abs(q[:, 0]) / 0.07, 0, 1) ** 2 * (q[:, 2] > 0.02) * smoothstep(L.y_belt, L.y_belt + 0.08, q[:, 1])
    nrm = vertex_normals(q, pg['tris'])
    pg['pos'] = q + nrm * (0.007 * ridge)[:, None]
    pg['w'] = restrict_weights(ctx, pg['w'], ['spine', 'chest', 'neck'])
    plate = finish(pg, 'plate', 0.0025, band=None, keep=0.3, bulge=0.4)
    parts.append(plate)
    parts += edge_tubes(plate, 0.005, 'plate', lift=0.4, squash=0.9, step=0.008, sides=7)
    parts += rivets_on_rims(plate, 0.034, 0.012, 0.0045, 0.003, 'steel', pick=lambda Pp: Pp[:, 1].mean() < L.y_chest)
    # 허리 판 두 단(겹침)
    f1 = waist_band(ctx, L, L.y_belt - 0.035, 0.024, [plate, mskirt], 0.004, 'plate', 0.0025, keep=0.9)
    f2 = waist_band(ctx, L, L.y_belt - 0.075, 0.024, [plate, mskirt, f1], 0.003, 'plate', 0.0025, keep=0.9)
    for f in (f1, f2):
        f['w'] = restrict_weights(ctx, f['w'], ['hips', 'spine'])
        parts.append(f)
        parts += edge_tubes(f, 0.0038, 'plate', pick=lambda Pp: True, lift=0.4, squash=0.9, step=0.008)
        parts += rivets_on_rims(f, 0.05, 0.01, 0.004, 0.0028, 'steel', pick=lambda Pp: Pp[:, 1].mean() < L.y_belt - 0.05 if False else True)
    # 어깨 판 세 겹, 팔뚝 판
    for side in ('L', 'R'):
        for s0, s1, o in ((-0.06, 0.18, 0.05), (0.13, 0.31, 0.054), (0.26, 0.45, 0.056)):
            pl = limb_plate(ctx, L, 'arm', side, s0, s1, lambda s, th, o=o: o + 0.006 * np.sin(np.clip((s - s0) / (s1 - s0), 0, 1) * np.pi), 1.55,
                            R=9, A=20, center_ang=np.pi / 2, rivet=0.035)
            for pp in pl:
                pp['w'] = restrict_weights(ctx, pp['w'], ['sh' + side, 'clav' + side])
            parts += pl
        parts += limb_plate(ctx, L, 'arm', side, 1.36, 1.84, lambda s, th: 0.03 + 0.006 * smoothstep(1.5, 1.84, s), 2.6, R=10, A=26, center_ang=np.pi / 2, rivet=0.03)
    return merge_parts([mail, mskirt] + parts[1:] if False else [mail] + parts)



# ── 기본 개척자 옷을 조각으로: 몸통(셔츠·조끼·목수건·허리띠), 다리(바지), 장화 ──
def base_pieces(ctx, L, female, sole_h=0.02):
    from outfit import build_outfit
    use_ctx(ctx)
    meshes, parts, S = build_outfit(ctx, L, female, sole_h)
    spec = {'shirt': ('chest', 'shirt', 0.0025, 0.06), 'vest': ('chest', 'vest', 0.004, 0.06), 'belt': ('chest', 'belt', 0.0045, None),
            'scarf': ('chest', 'scarf', 0.003, None), 'scarf_tri': ('chest', 'scarf', 0.003, None), 'trousers': ('legs', 'trousers', 0.003, 0.06)}
    out = {'chest_base': [], 'legs_base': [], 'boots': []}
    for name, (pc, slot, th, band) in spec.items():
        g = from_shell(S[name])
        out[pc + '_base'].append(finish(g, slot, th, band=band, keep=0.5))
    for k in ('bootL', 'bootR'):
        me = meshes[k]
        out['boots'].append(part(G(me.pos, me.tris, me.w), 'boots'))
    for me in parts:
        gid = me.gid
        dst = 'boots' if gid in (GID['boots'], GID['sole']) else 'legs_base' if gid == GID['trousers'] else 'chest_base'
        out[dst].append(part(me, gid))
    return {k: merge_parts(v) for k, v in out.items()}
