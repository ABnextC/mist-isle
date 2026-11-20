# 개척자 옷 한 벌: 셔츠(소매 걷음) · 조끼(남)/코르셋 조끼(여) · 바지 · 장화 · 허리띠 · 목수건.
# 영역은 몸 꼭짓점 위 스칼라장(≥0 이 안쪽), 두께는 위치에 따른 함수.
import numpy as np
from garment import smooth_field

GID = {'shirt': 0, 'vest': 1, 'trousers': 2, 'boots': 3, 'belt': 4, 'scarf': 5, 'strap': 6, 'pack': 7, 'metal': 8, 'sole': 9, 'leather': 10}

def limb_param(P, a, b, c):
    """a→b→c 두 마디 위 매개변수 s ∈ [0,2]: 0=a, 1=b, 2=c"""
    def proj(p0, p1):
        d = p1 - p0
        L2 = (d * d).sum()
        t = ((P - p0) @ d) / L2
        q = p0 + np.clip(t, 0, 1)[:, None] * d
        return t, np.linalg.norm(P - q, axis=1)
    tu, du = proj(a, b)
    tl, dl = proj(b, c)
    return np.where(du <= dl, np.minimum(tu, 1.0), 1.0 + np.maximum(tl, 0.0))

class Land:
    """랜드마크와 몸 꼭짓점별 보조장(팔·다리 소속, 마디 매개변수)"""
    def __init__(self, ctx):
        P = ctx.P
        b = ctx.bpos
        self.ctx = ctx
        self.y_neck = b['neck'][1]
        self.y_chest = b['chest'][1]
        self.y_spine = b['spine'][1]
        self.y_hips = b['hips'][1]
        self.neck = b['neck']
        self.head = b['head']
        wl = ctx.w('shL', 'elL', 'handL')
        wr = ctx.w('shR', 'elR', 'handR')
        self.w_arm = smooth_field(ctx, wl + wr, 6)
        self.w_armL = wl
        self.w_armR = wr
        ll = ctx.w('thL', 'knL', 'ftL')
        lr = ctx.w('thR', 'knR', 'ftR')
        self.w_leg = smooth_field(ctx, ll + lr, 4)
        self.w_head = ctx.w('head')
        self.w_neck = ctx.w('neck')
        sL = limb_param(P, b['shL'], b['elL'], b['handL'])
        sR = limb_param(P, b['shR'], b['elR'], b['handR'])
        self.s_arm = np.where(P[:, 0] > 0, sL, sR)
        lL = limb_param(P, b['thL'], b['knL'], b['ftL'])
        lR = limb_param(P, b['thR'], b['knR'], b['ftR'])
        self.s_leg = np.where(P[:, 0] > 0, lL, lR)
        self.arm_len = np.linalg.norm(b['elL'] - b['shL'])
        self.fore_len = np.linalg.norm(b['handL'] - b['elL'])
        self.thigh_len = np.linalg.norm(b['knL'] - b['thL'])
        self.shin_len = np.linalg.norm(b['ftL'] - b['knL'])
        # 허리띠 높이: 골반 위(엉덩뼈 능선 즈음)
        self.y_belt = self.y_hips + 0.6 * (self.y_spine - self.y_hips) + 0.035

def neck_angle(P, neck):
    return np.arctan2(P[:, 0] - neck[0], P[:, 2] - neck[2])

def fields(ctx, L, female=False):
    P = ctx.P
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    th = neck_angle(P, L.neck)
    front = np.cos(th)
    big = 1.0
    arm = L.w_arm > 0.5
    leg = L.w_leg > 0.5
    F = {}

    # ── 셔츠: 목둘레(앞은 V로 트임), 소매는 아래팔 40%에서 걷어 올림, 아래는 바지 속으로
    y_nl = L.y_neck + 0.006 + 0.012 * (1 - front) * 0.5 - 0.03 * np.maximum(front, 0) ** 2
    vdepth = 0.085 if not female else 0.07
    vw = 0.05
    vee = np.clip(1 - np.abs(x - L.neck[0]) / vw, 0, 1) * (z > L.neck[2])
    y_nl = y_nl - vdepth * vee ** 1.6
    c_neck = y_nl - y
    sleeve_end = 1.0 + (0.42 if not female else 0.5)
    c_sleeve = np.where(L.w_arm > 0.35, (sleeve_end - L.s_arm) * L.fore_len, big)
    c_bottom = y - (L.y_belt - 0.075)
    c_noleg = (0.45 - L.w_leg)
    F['shirt'] = np.minimum.reduce([c_neck, c_sleeve, c_bottom])

    # ── 바지: 허리띠 바로 위에서 시작, 정강이 55%에서 끝(장화 속)
    c_top = (L.y_belt + 0.022) - y
    c_end = np.where(leg, (1.55 - L.s_leg) * L.shin_len, big)
    c_noarm = (0.4 - L.w_arm) * 0.3
    F['trousers'] = np.minimum.reduce([c_top, c_end, c_noarm])

    # ── 장화: 무릎 아래 12%부터 발끝까지
    c_boot = np.where(L.w_leg > 0.5, (L.s_leg - 1.13) * L.shin_len, -big)
    F['boots'] = c_boot

    # ── 조끼
    if not female:
        y_vn = L.y_neck - 0.005 + 0.01 * (1 - front) * 0.5 - 0.02 * np.maximum(front, 0) ** 2
        vee2 = np.clip(1 - np.abs(x - L.neck[0]) / 0.075, 0, 1) * (z > L.neck[2])
        y_vn = y_vn - 0.15 * vee2 ** 1.3
        c_vn = y_vn - y
        c_vbot = y - (L.y_belt - 0.012)
        shy = ctx.bpos['shL'][1]
        thr = 0.22 + 0.5 * np.clip((y - (shy - 0.07)) / 0.08, 0, 1)
        c_hole = smooth_field(ctx, (thr - L.w_arm), 6) * 0.35
        F['vest'] = np.minimum.reduce([c_vn, c_vbot, c_hole])
    else:
        # 코르셋 조끼: 가슴 아래(앞은 하트 모양 위선)부터 엉덩이 위까지, 어깨는 덮지 않는다
        yb = L.y_chest - 0.02
        heart = 0.03 * np.clip(1 - np.abs(np.abs(x - L.neck[0]) - 0.045) / 0.045, 0, 1)
        y_top = np.where(z > L.neck[2] - 0.02, yb + heart, yb + 0.035)
        c_top2 = y_top - y
        c_vbot = y - (L.y_belt - 0.012)
        c_hole = (0.2 - L.w_arm) * 0.35
        F['vest'] = np.minimum.reduce([smooth_field(ctx, c_top2, 8), c_vbot, c_hole])

    # ── 허리띠(조끼 위)
    hw = 0.021
    yb = L.y_belt - 0.004 * np.maximum(front, 0)
    F['belt'] = np.minimum.reduce([y - (yb - hw), (yb + hw) - y, (0.3 - L.w_arm) * 0.3, (0.6 - L.w_leg) * 0.3])

    # ── 목수건: 목 아래쪽을 두르는 띠
    y0 = L.y_neck - 0.016 - 0.012 * np.maximum(front, 0)
    y1 = L.y_neck + (0.014 if not female else 0.004) - 0.012 * np.maximum(front, 0)
    neckish = (L.w_neck + ctx.w('chest') + L.w_head) > 0.5
    F['scarf'] = np.where(neckish, np.minimum(y - y0, y1 - y), -big)
    dx = np.abs(x - L.neck[0])
    tip = L.y_neck - (0.13 if not female else 0.1)
    c_tri = np.minimum.reduce([(y - tip) - dx * 1.25, (L.y_neck - 0.006) - y, (z - L.neck[2]) * 2])
    F['scarf_tri'] = c_tri
    return F

def bump(x, a, b, c, d):
    """a에서 b까지 오르고 c에서 d까지 내리는 사다리꼴(0~1)"""
    up = np.clip((x - a) / max(b - a, 1e-6), 0, 1)
    dn = np.clip((d - x) / max(d - c, 1e-6), 0, 1)
    u = up * dn
    return u * u * (3 - 2 * u)

def offsets(ctx, L, female=False):
    """옷마다 몸 꼭짓점에서 띄울 거리(m)"""
    P = ctx.P
    y = P[:, 1]
    th = neck_angle(P, L.neck)
    front = np.cos(th)
    D = {}
    arm = np.clip((L.w_arm - 0.3) / 0.4, 0, 1)
    s = L.s_arm
    sleeve = np.interp(s, [0, 0.5, 1.0, 1.5], [0.006, 0.009, 0.013, 0.017])
    blouse = 0.008 * bump(y, L.y_belt + 0.004, L.y_belt + 0.03, L.y_belt + 0.07, L.y_belt + 0.15) * (0.6 + 0.4 * np.maximum(front, 0))
    D['shirt'] = 0.0035 + blouse * (1 - arm) + (sleeve - 0.0035) * arm
    sl = L.s_leg
    legd = np.interp(sl, [0, 0.3, 0.8, 1.02, 1.15, 1.6], [0.016, 0.024, 0.022, 0.017, 0.0095, 0.008])
    lw = np.clip((L.w_leg - 0.2) / 0.5, 0, 1)
    D['trousers'] = 0.0105 * (1 - lw) + legd * lw
    D['boots'] = np.interp(sl, [1.1, 1.2, 1.7, 1.95, 2.2], [0.019, 0.018, 0.014, 0.011, 0.007])
    D['vest'] = np.maximum(D['shirt'] + 0.0055, 0.0125 * bump(y, -9, -8, L.y_belt + 0.03, L.y_belt + 0.06))
    D['belt'] = np.full(len(P), 0.0175)
    D['scarf'] = 0.011 + 0.007 * np.maximum(front, 0)
    D['scarf_tri'] = np.maximum(D['vest'], D['shirt']) + 0.0045
    return D


# ── 조립 ─────────────────────────────────────────────
from garment import shell, shell_mesh, rim_loops_geo, extra_smooth, interp, Mesh, hull_push, soft_hull_project, voxel_hull_project
from parts import tube, band, sdf_mesh, sd_round_box, sole, sdf_boot
from meshutil import vertex_normals

def loop_data(S, loop):
    idx = np.array(loop)
    P = S['pos'][idx]
    W = S['w'][idx]
    gn = vertex_normals(S['pos'], S['gtris'])
    N = gn[idx]
    return P, W, N

def pick_loops(S, pred):
    out = []
    for lp in rim_loops_geo(S):
        P = S['pos'][np.array(lp)]
        if pred(P):
            out.append(lp)
    return out

def onehot(ctx, name):
    r = np.zeros(len(ctx.names))
    r[ctx.bi[name]] = 1
    return r

def tube_band(g, s, ctx, lo, hi, extra=0.004, bins=26, angles=96):
    """다리마다 높이 띠로 나눠 xz 단면의 볼록 껍질 반지름까지 밀어낸다(천이 근육 골을 덮게)"""
    from scipy.spatial import ConvexHull
    pos = g['pos']
    w_ramp = np.clip((s - lo) / 0.08, 0, 1) * np.clip((hi - s) / 0.08, 0, 1)
    for sx in (1, -1):
        side = (pos[:, 0] * sx > 0) & (s > lo - 0.05) & (s < hi + 0.05)
        edges = np.linspace(lo - 0.05, hi + 0.05, bins + 1)
        for b in range(bins):
            m = side & (s >= edges[b]) & (s < edges[b + 1])
            idx = np.nonzero(m)[0]
            if len(idx) < 8:
                continue
            q = pos[idx][:, [0, 2]]
            c = q.mean(0)
            try:
                hull = ConvexHull(q)
            except Exception:
                continue
            hp = q[hull.vertices]
            # 껍질 둘레를 촘촘히 뽑아 각도별 최대 반지름
            hp2 = np.concatenate([hp, hp[:1]])
            pts = np.concatenate([hp2[k] + (hp2[k + 1] - hp2[k]) * np.linspace(0, 1, 12)[:, None] for k in range(len(hp))])
            d = pts - c
            ang = np.arctan2(d[:, 1], d[:, 0])
            rad = np.linalg.norm(d, axis=1)
            ai = ((ang + np.pi) / (2 * np.pi) * angles).astype(int) % angles
            rmax = np.zeros(angles)
            np.maximum.at(rmax, ai, rad)
            # 빈 칸 메우기
            for _ in range(3):
                z = rmax == 0
                rmax[z] = np.maximum(np.roll(rmax, 1), np.roll(rmax, -1))[z]
            dv = q - c
            a = np.arctan2(dv[:, 1], dv[:, 0])
            r = np.linalg.norm(dv, axis=1)
            ai = ((a + np.pi) / (2 * np.pi) * angles).astype(int) % angles
            rt = rmax[ai] + extra
            k = np.clip(w_ramp[idx], 0, 1)
            nr = r + (np.maximum(rt, r) - r) * k
            newq = c + dv / np.maximum(r, 1e-9)[:, None] * nr[:, None]
            pos[idx, 0] = newq[:, 0]
            pos[idx, 2] = newq[:, 1]
    g['pos'] = pos

def layer_resolve(ctx, S, order, gap=0.003):
    """바깥 옷이 같은 몸 점에서 안쪽 옷보다 gap 이상 높게(겹침 뚫림 방지)"""
    n = len(ctx.P)
    hmax = np.full(n, -1.0)
    for name in order:
        g = S[name]
        a = g['src'][:, 0].astype(np.int64)
        b = g['src'][:, 1].astype(np.int64)
        t = g['src'][:, 2]
        h = ((g['pos'] - g['base']) * g['nrm0']).sum(1)
        need = (hmax[a] * (1 - t) + hmax[b] * t) + gap
        low = (hmax[a] > 0) & (hmax[b] > 0) & (h < need)
        g['pos'][low] += g['nrm0'][low] * (need[low] - h[low])[:, None]
        h = ((g['pos'] - g['base']) * g['nrm0']).sum(1)
        # 이 옷의 높이를 몸 꼭짓점에 기록(원래 꼭짓점과 가장자리 보간점 모두 가까운 쪽에)
        near = np.where(t < 0.5, a, b)
        np.maximum.at(hmax, near, h)

def build_outfit(ctx, L, female=False, sole_h=0.02):
    Fd = fields(ctx, L, female)
    D = offsets(ctx, L, female)
    meshes = {}
    parts = []
    S = {}
    S['shirt'] = shell(ctx, Fd['shirt'], D['shirt'], GID['shirt'], smooth=30)
    S['vest'] = shell(ctx, Fd['vest'], D['vest'], GID['vest'], smooth=35)
    S['trousers'] = shell(ctx, Fd['trousers'], D['trousers'], GID['trousers'], smooth=40)
    S['belt'] = shell(ctx, Fd['belt'], D['belt'], GID['belt'], smooth=6)
    # 바지 통: 허벅지~무릎 단면을 볼록하게(다리 근육을 따라 붙지 않고 천이 걸쳐지게) + 약간 여유
    tr = S['trousers']
    sl_t = interp(L.s_leg, tr['src'])
    tube_band(tr, sl_t, ctx, lo=0.18, hi=1.1, extra=0.005)
    # 장화 속 바지는 부풀리지 않는다(장화 뚫림 방지)
    tr = S['trousers']
    sl_t = interp(L.s_leg, tr['src'])
    low = np.clip((sl_t - 1.08) / 0.08, 0, 1)[:, None]
    tr['pos'] = tr['pos'] * (1 - low) + (tr['base'] + tr['nrm0'] * tr['d'][:, None]) * low
    S['scarf'] = shell(ctx, Fd['scarf'], D['scarf'], GID['scarf'], smooth=12)
    S['scarf_tri'] = shell(ctx, Fd['scarf_tri'], D['scarf_tri'], GID['scarf'], smooth=10)
    layer_resolve(ctx, S, ['shirt', 'trousers', 'vest', 'scarf', 'scarf_tri', 'belt'], gap=0.003)
    for k, v in S.items():
        meshes[k] = shell_mesh(v)
    # 걷은 소매: 소매 끝 고리 둘(팔 쪽)
    for lp in pick_loops(S['shirt'], lambda P: P[:, 1].mean() < L.y_chest - 0.1 and np.abs(P[:, 0]).mean() > 0.12):
        P, W, N = loop_data(S['shirt'], lp)
        parts.append(tube(P, W, N, 0.0105 if not female else 0.012, sides=10, n_out=40, gid=GID['shirt'], lift=0.55, squash=0.8, twist_noise=0.12, seed=len(parts)))
        parts.append(tube(P, W, N, 0.0075, sides=8, n_out=36, gid=GID['shirt'], lift=0.2, squash=0.7, twist_noise=0.2, seed=len(parts) + 7))
    # 목수건 위 가장자리를 도톰하게(꼬인 천)
    for lp in pick_loops(S['scarf'], lambda P: True):
        P, W, N = loop_data(S['scarf'], lp)
        if P[:, 1].mean() > L.y_neck - 0.01:
            parts.append(tube(P, W, N, 0.0045, sides=8, n_out=48, gid=GID['scarf'], lift=0.3, squash=0.8, twist_noise=0.3, seed=3))
    # 조끼 테두리 띠
    for lp in rim_loops_geo(S['vest']):
        P, W, N = loop_data(S['vest'], lp)
        parts.append(tube(P, W, N, 0.0032, sides=6, n_out=max(24, int(len(lp) * 1.5)), gid=GID['leather'], lift=0.3))
    # 장화(거리장으로 빚음) + 접단 + 밑창
    for sx, side in ((1, 'L'), (-1, 'R')):
        kn = ctx.bpos['kn' + side]
        ft = ctx.bpos['ft' + side]
        y_top = kn[1] - 0.12 * (kn[1] - ft[1])
        bm = sdf_boot(ctx, L, sx, sole_h, y_top, GID['boots'])
        meshes['boot' + side] = bm
        from garment import loops as _loops
        print('  boot loops before seam', bm.n_loops, 'top', len(bm.top_loops))
        for Pl, Wl in bm.top_loops:
            c0 = Pl.mean(0)
            Nl = Pl - c0
            Nl[:, 1] = 0
            Nl /= np.linalg.norm(Nl, axis=1, keepdims=True)
            parts.append(tube(Pl, Wl, Nl, 0.012, sides=10, n_out=44, gid=GID['boots'], lift=0.15, squash=0.6))
        parts.append(sole(bm.pos, onehot(ctx, 'ft' + side), 0.0, sole_h, heel=0.01, gid=GID['sole']))
    # 허리띠 버클·주머니
    bw = interp(ctx.GW, S['belt']['src'])
    hips = onehot(ctx, 'hips')
    belt_front = S['belt']['pos'][np.argmax(S['belt']['pos'][:, 2])]
    c = belt_front + [0, 0, 0.004]
    parts.append(sdf_mesh(lambda p: np.maximum(sd_round_box(p, c, (0.03, 0.026, 0.005), 0.003), -sd_round_box(p, c, (0.02, 0.016, 0.02), 0.002)),
                          c - 0.04, c + 0.04, 0.002, GID['metal'], hips))
    # 오른쪽 엉덩이 주머니(해부학적 오른쪽 = -x)
    yb = L.y_belt
    pb = S['belt']['pos']
    sel = pb[np.abs(pb[:, 1] - yb) < 0.02]
    side = sel[np.argmin(sel[:, 0] + 0.6 * np.abs(sel[:, 2] - 0.0))]
    pc = side + np.array([-0.022, -0.055, 0.0])
    R = np.eye(3)
    parts.append(sdf_mesh(lambda p: sd_round_box(p, pc, (0.022, 0.05, 0.06), 0.012),
                          pc - 0.08, pc + 0.08, 0.004, GID['leather'], hips))
    # 목수건 매듭과 앞 삼각 자락
    sc = S['scarf']['pos']
    kn = sc[np.argmax(sc[:, 2] - 0.3 * np.abs(sc[:, 0]))] + [0.01, -0.008, 0.004]
    neckrow = interp(ctx.GW, S['scarf']['src']).mean(0)
    knot = lambda p: np.minimum(np.linalg.norm((p - kn) / [1.0, 0.7, 0.55], axis=1) - 0.011, np.linalg.norm((p - kn - [-0.012, -0.004, -0.002]) / [1.0, 0.6, 0.5], axis=1) - 0.008)
    parts.append(sdf_mesh(knot, kn - 0.035, kn + 0.035, 0.0015, GID['scarf'], neckrow / neckrow.sum()))
    return meshes, parts, S
