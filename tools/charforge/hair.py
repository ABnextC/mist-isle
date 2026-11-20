# 머리카락: 두피에서 뿌리를 고르게 뽑고, 머리 모양(빗질 방향·길이·부피·중력)을 따라 가닥을 길러
# 머리에 부딪히지 않게 밀어낸 뒤, 가닥마다 납작한 띠(카드)를 붙인다. 질감은 가닥 묶음 그림(알파).
import numpy as np
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw, ImageFilter
from stage_skin import scalp_mask, head_frame, smoothstep
from meshutil import vertex_normals

class Head:
    def __init__(self, ctx, B):
        P, T = ctx.P, ctx.T
        hw = ctx.w('head', 'neck')
        sel = np.unique(T[(hw[T] > 0.4).all(1)])
        self.N = vertex_normals(P, T)
        self.pts = P[sel]
        self.nrm = self.N[sel]
        self.tree = cKDTree(self.pts)
        self.F = head_frame(B)
        self.c = self.F['head'] + np.array([0, 0.085, -0.005])   # 머리통 가운데쯤
        self.ctx = ctx
        hv = sel[ctx.w('head')[sel] > 0.6]
        self.top = P[hv][:, 1].max()

    def sd(self, p):
        d, j = self.tree.query(p, k=4)
        q = self.pts[j]
        n = self.nrm[j].mean(1)
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        s = ((p - q.mean(1)) * n).sum(1)
        return s, n

    def push(self, p, off):
        s, n = self.sd(p)
        need = off - s
        m = need > 0
        p = p.copy()
        p[m] += n[m] * need[m, None]
        return p

def scalp_roots(ctx, B, n_roots, female, seed=0, min_dist=0.005):
    P, T = ctx.P, ctx.T
    F = head_frame(B)
    N = vertex_normals(P, T)
    hw = ctx.w('head')
    ok = (hw[T] > 0.6).all(1)
    tri = T[ok]
    cen = P[tri].mean(1)
    cn = N[tri].mean(1)
    m = scalp_mask(cen, cn, F, female)
    tri = tri[m > 0.55]
    a = 0.5 * np.linalg.norm(np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]]), axis=1)
    rng = np.random.default_rng(seed)
    k = rng.choice(len(tri), size=n_roots * 4, p=a / a.sum())
    r1 = np.sqrt(rng.random(len(k)))
    r2 = rng.random(len(k))
    w = np.stack([1 - r1, r1 * (1 - r2), r1 * r2], 1)
    pts = (P[tri[k]] * w[..., None]).sum(1)
    nrm = (N[tri[k]] * w[..., None]).sum(1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    # 포아송 원판 솎기
    keep = []
    tree_pts = []
    order = rng.permutation(len(pts))
    from scipy.spatial import cKDTree as KD
    grid = {}
    cell = min_dist
    for i in order:
        p = pts[i]
        key = tuple((p // cell).astype(int))
        bad = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in grid.get((key[0] + dx, key[1] + dy, key[2] + dz), []):
                        if np.sum((pts[j] - p) ** 2) < min_dist * min_dist:
                            bad = True
                            break
                    if bad:
                        break
                if bad:
                    break
            if bad:
                break
        if not bad:
            grid.setdefault(key, []).append(i)
            keep.append(i)
            if len(keep) >= n_roots:
                break
    keep = np.array(keep)
    return pts[keep], nrm[keep]

def comb_dir(p, n, H, style, part_x):
    """뿌리 위치별 빗질 방향(접평면)과 길이·들림"""
    c = H.c
    d = p - c
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    up = np.array([0, 1.0, 0])
    side = np.sign(x - part_x + 1e-6)          # 가르마 기준 어느 쪽
    face_front = z > 0.03
    n1 = np.ones(len(p))
    if style == 'crop':
        # 흐름: 윗머리는 앞으로(가르마 반대쪽으로 비스듬히), 뒤는 아래로, 옆은 아래·뒤로. 소용돌이 구멍이 없게 고른 흐름
        top = smoothstep(0.02, 0.07, y)
        backw = smoothstep(-0.0, -0.06, z)
        fwd = np.stack([-0.45 * n1, -0.15 * n1, 1.0 * n1], 1)
        down = np.stack([0.15 * np.sign(x), -1.0 * n1, -0.35 * n1], 1)
        want = fwd * (top * (1 - backw))[:, None] + down * (1 - top * (1 - backw))[:, None]
        fr = smoothstep(0.0, 0.06, z) * smoothstep(0.02, 0.07, y)
        bang = np.stack([-0.55 * n1, -0.8 * n1, 0.45 * n1], 1)
        want = want * (1 - fr[:, None]) + bang * fr[:, None]
        L = 0.032 + 0.045 * top + 0.035 * fr
        lift = 0.1 + 0.25 * top * (1 - fr) - 0.05 * fr
    else:
        # 단발: 가르마에서 양옆으로 갈라져 아래로, 앞머리는 이마를 비스듬히
        fr = smoothstep(0.035, 0.075, z) * smoothstep(0.0, 0.05, y)
        part = np.stack([np.where(x > part_x, 1.0, -1.0), -0.35 * np.ones(len(p)), -0.25 * np.ones(len(p))], 1)
        want = part
        bang = np.stack([-0.55 * np.ones(len(p)), -1.0 * np.ones(len(p)), 0.3 * np.ones(len(p))], 1)
        want = want * (1 - fr[:, None]) + bang * fr[:, None]
        back = smoothstep(-0.0, -0.07, z)
        want = want * (1 - back[:, None] * 0.6) + np.array([0, -1.0, -0.4]) * back[:, None] * 0.6
        # 턱선 근처까지: 뿌리 높이에 따라
        chin_y = H.F['mouth'][1] - 0.035
        L = np.clip(p[:, 1] - chin_y, 0.05, 0.25) * 1.12 + 0.03
        brow_y = H.F['eL'][1] + 0.018
        Lb = np.clip(p[:, 1] - brow_y, 0.02, 0.1) * 1.25 + 0.012 + 0.025 * np.clip((part_x - x) / 0.06, 0, 1)
        L = L * (1 - fr) + Lb * fr
        lift = (0.22 + 0.35 * smoothstep(0.04, 0.1, y)) * (1 - 0.8 * fr)
    want = want - (want * n).sum(1, keepdims=True) * n
    want /= np.maximum(np.linalg.norm(want, axis=1, keepdims=True), 1e-6)
    return want, L, lift

def grow(H, roots, rn, style, female, seed=0, steps=None):
    steps = steps or (10 if female else 8)
    rng = np.random.default_rng(seed)
    part_x = 0.032 if not female else 0.028
    want, L, lift = comb_dir(roots, rn, H, style, part_x)
    n = len(roots)
    # 가닥마다 흔들림(뭉침: 이웃끼리 비슷하게)
    from noise import value3
    jit = np.stack([value3(roots, 45, seed + k) - 0.5 for k in range(3)], 1) * 0.35 + rng.normal(0, 0.04, (n, 3))
    Lr = L * (0.85 + 0.3 * rng.random(n))
    layer = rng.random(n)            # 0 안쪽 ~ 1 겉
    off0 = 0.0015 + 0.004 * layer
    vol = ((0.006 + 0.012 * layer) if female else (0.003 + 0.009 * layer)) * (0.6 + 0.8 * lift)
    dirs = rn * (lift[:, None] * (0.6 + 0.6 * layer[:, None])) + want + jit * 0.6
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    P = [roots + rn * off0[:, None]]
    D = [dirs]
    p = P[0].copy()
    d = dirs.copy()
    g = np.array([0, -1.0, 0])
    for s in range(1, steps + 1):
        t = s / steps
        step = (Lr / steps)[:, None]
        # 빗질 방향은 점점 약해지고 중력은 길이에 따라 세진다
        grav = (0.3 + 1.4 * (Lr / 0.12)) * (0.4 + t) * (1.25 if female else 1.0)
        cw = want - (want * d).sum(1, keepdims=True) * d * 0.0
        d = d + cw * (0.35 * (1 - t)) + g * (grav[:, None] * 0.12)
        if style == 'bob' and t > 0.7:
            inw = H.c - p
            inw[:, 1] = 0
            inw /= np.maximum(np.linalg.norm(inw, axis=1, keepdims=True), 1e-6)
            d = d + inw * 0.18 * (t - 0.7) / 0.3
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        p = p + d * step
        # 머리 바깥 + 부피만큼 띄우기(뿌리 가까이는 얇게)
        off = off0 + vol * smoothstep(0.0, 0.35, t)
        p = H.push(p, off)
        P.append(p.copy())
        D.append(d.copy())
    P = np.stack(P, 1)
    # 방향은 실제 모양에서 다시
    Dd = np.gradient(P, axis=1)
    Dd /= np.maximum(np.linalg.norm(Dd, axis=2, keepdims=True), 1e-9)
    return P, Dd, layer, Lr

def cards(H, P, D, layer, Lr, seed=0, cols=8, taper=0.55):
    rng = np.random.default_rng(seed + 1)
    n, m, _ = P.shape
    pos, nrm, uv, tan, col = [], [], [], [], []
    tris = []
    base = 0
    for i in range(n):
        w0 = (0.026 - 0.01 * layer[i]) * (0.8 + 0.4 * rng.random())
        col_i = rng.integers(0, cols)
        u0 = col_i / cols
        twist = rng.normal(0, 0.25)
        bright = 0.85 + 0.3 * rng.random()
        for k in range(m):
            t = k / (m - 1)
            p = P[i, k]
            d = D[i, k]
            out = p - H.c
            out /= np.linalg.norm(out)
            wv = np.cross(d, out)
            wv /= max(np.linalg.norm(wv), 1e-9)
            # 살짝 비틀기
            ang = twist * t
            nv = np.cross(wv, d)
            wv = wv * np.cos(ang) + nv * np.sin(ang)
            w = w0 * (1 - taper * t ** 1.5) * 0.5
            cn = np.cross(wv, d)
            if np.dot(cn, out) < 0:
                cn = -cn
            nn = cn * 0.35 + out * 0.65
            nn /= np.linalg.norm(nn)
            for sgn in (-1, 1):
                pos.append(p + wv * w * sgn)
                nrm.append(nn)
                uv.append((u0 + (0.5 + 0.5 * sgn) / cols * 0.98 + 0.01 / cols, 1 - t))
                tan.append(d)
                ao = (0.62 + 0.38 * layer[i]) * (0.72 + 0.28 * smoothstep(0.0, 0.3, t))
                col.append((bright, bright, bright, ao))
        for k in range(m - 1):
            a = base + k * 2
            tris += [(a, a + 1, a + 3), (a, a + 3, a + 2)]
        base += m * 2
    return dict(pos=np.array(pos), nrm=np.array(nrm), uv=np.array(uv), tan=np.array(tan), col=np.clip(np.array(col), 0, 1.25) / 1.25, tris=np.array(tris))

def hair_texture(size=1024, cols=8, seed=3):
    """가닥 묶음 그림: 열마다 가닥 60~90개. 뿌리(위, v=1)에서 끝(아래)으로 가늘어진다"""
    rng = np.random.default_rng(seed)
    S = 4
    W, Hh = size * S, size * S
    A = Image.new('L', (W, Hh), 0)
    R = Image.new('L', (W, Hh), 128)
    Bc = Image.new('L', (W, Hh), 128)
    da, dr, db = ImageDraw.Draw(A), ImageDraw.Draw(R), ImageDraw.Draw(Bc)
    cw = W // cols
    for c in range(cols):
        x0 = c * cw
        # 뿌리 쪽 바탕(촘촘한 부분)
        for s in range(int(rng.integers(70, 100))):
            sx = x0 + cw * (0.06 + 0.88 * rng.random())
            Ls = Hh * (0.45 + 0.55 * rng.random() ** 0.6)
            wav = rng.uniform(2, 10) * S
            fq = rng.uniform(0.5, 2.0)
            ph = rng.uniform(0, 6.28)
            pts = []
            for k in range(25):
                t = k / 24
                y = t * Ls
                x = sx + np.sin(t * fq * 6.28 + ph) * wav * t + (sx - (x0 + cw / 2)) * -0.25 * t
                pts.append((x, y))
            br = int(rng.integers(70, 255))
            sid = int(rng.integers(0, 255))
            wid = rng.uniform(1.6, 3.2) * S * 0.5
            for k in range(24):
                t = k / 24
                ww = max(1, int(wid * (1 - 0.8 * t)))
                a = int(255 * (1 - 0.75 * t ** 2))
                da.line([pts[k], pts[k + 1]], fill=a, width=ww)
                dr.line([pts[k], pts[k + 1]], fill=br, width=ww)
                db.line([pts[k], pts[k + 1]], fill=sid, width=ww)
    A = A.filter(ImageFilter.GaussianBlur(S * 0.35)).resize((size, size), Image.LANCZOS)
    R = R.resize((size, size), Image.LANCZOS)
    Bc = Bc.resize((size, size), Image.LANCZOS)
    a = np.asarray(A).astype(np.float32) / 255
    # 묶음 속 그늘: 열 가운데·뿌리 쪽이 어둡다
    yy, xx = np.mgrid[0:size, 0:size]
    fx = (xx % (size // cols)) / (size // cols)
    g = 0.55 + 0.45 * (yy / size)
    a = a * (0.55 + 0.45 * np.clip(yy / (size * 0.08), 0, 1))
    out = np.stack([np.asarray(R), (np.clip(g, 0, 1) * 255).astype(np.uint8), np.asarray(Bc), (np.clip(a * 1.15, 0, 1) * 255).astype(np.uint8)], 2)
    return Image.fromarray(out.astype(np.uint8), 'RGBA')
