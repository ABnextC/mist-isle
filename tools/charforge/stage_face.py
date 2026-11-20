# 눈알(MakeHuman 고해상 눈, CC0)과 속눈썹(기본 메시 도우미 띠) + 그 질감
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from proxy import load_obj_simple, load_mhclo, fit
from meshutil import triangulate, vertex_normals, split_uv
from human import base

from mhbase import D

def eyes(B):
    V, VT, F = load_obj_simple(f'{D}/eyes/high-poly/high-poly.obj')
    scale, verts = load_mhclo(f'{D}/eyes/high-poly/high-poly.mhclo')
    P = fit(B['P'], scale, verts)
    out = []
    # 각막(UV 오른쪽 아래 흰 원)은 빼고 눈알만
    tv, tt = [], []
    for vi, ti in F:
        c = VT[ti].mean(0)
        if np.hypot(c[0] - 0.94, c[1] - 0.06) < 0.07:
            continue
        for k in range(1, len(vi) - 1):
            tv.append((vi[0], vi[k], vi[k + 1]))
            tt.append((ti[0], ti[k], ti[k + 1]))
    tv, tt = np.array(tv), np.array(tt)
    for sx, side in ((1, 'L'), (-1, 'R')):
        m = (P[tv].mean(1)[:, 0] * sx) > 0
        T, TT = tv[m], tt[m]
        vpos, vuv, TI = split_uv(T, TT)
        pos = P[vpos]
        used = np.unique(T)
        # 공 맞춤(최소제곱): |p|² = 2c·p + k
        Q = P[used]
        A = np.concatenate([2 * Q, np.ones((len(Q), 1))], 1)
        sol, *_ = np.linalg.lstsq(A, (Q * Q).sum(1), rcond=None)
        c = sol[:3]
        # 공 중심: 점들에서 가장 먼 거리의 절반쯤 → 평균으로 충분
        nrm = pos - c
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        front = vpos[np.argmax(pos[:, 2])]
        iris_uv = VT[vuv[np.argmax(pos[:, 2])]]
        out.append(dict(side=side, pos=pos, nrm=nrm, uv=VT[vuv], tris=TI, center=c, iris_uv=iris_uv,
                        radius=float(np.linalg.norm(pos - c, axis=1).mean())))
    return out

PUPILS = [(0.2929, 0.2899), (0.7089, 0.702)]

def eye_texture(iris_uvs=None, size=512):
    im = Image.open(f'{D}/eyes/materials/brown_eye.png').convert('RGB').resize((size, size), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    yy, xx = np.mgrid[0:size, 0:size]
    u = (xx + 0.5) / size
    v = 1 - (yy + 0.5) / size
    mask = np.zeros((size, size), np.float32)
    for c in PUPILS:
        r = np.hypot(u - c[0], v - c[1])
        mask = np.maximum(mask, np.clip((0.119 - r) / 0.01, 0, 1))
    luma = (a * [0.3, 0.55, 0.15]).sum(2)
    sclera = a * 0.9 + 0.1 * luma[..., None]
    sclera = np.clip(sclera * [1.06, 1.03, 1.02], 0, 1)
    iris = np.clip(luma / 0.12 * 0.5, 0, 1)
    rgb = sclera * (1 - mask[..., None]) + iris[..., None] * mask[..., None]
    disc = np.zeros((size, size), np.float32)
    for c in PUPILS:
        disc = np.maximum(disc, np.clip((0.27 - np.hypot(u - c[0], v - c[1])) / 0.03, 0, 1))
    avg = np.median(sclera[(disc > 0.9) & (mask < 0.01)], axis=0)
    rgb = rgb * disc[..., None] + avg * (1 - disc[..., None])
    out = np.concatenate([np.clip(rgb, 0, 1), mask[..., None]], 2)
    return Image.fromarray((out * 255).astype(np.uint8), 'RGBA')

def lashes(B):
    """속눈썹 띠: UV를 새로 준다. u = 눈 안쪽(0) → 바깥(1), v = 끝(0) → 뿌리(1, 눈꺼풀)"""
    from scipy.spatial import cKDTree
    V0, VT, F, G = base()
    P = B['P']
    body = cKDTree(P[:13380])
    out = []
    for side in ('l', 'r'):
        for kind, g in (('up', f'helper-{side}-eyelashes-2'), ('dn', f'helper-{side}-eyelashes-1')):
            fs = [(vi, ti) for (vi, ti), gg in zip(F, G) if gg == g]
            T, TT, _ = triangulate(fs)
            vpos, vuv, TI = split_uv(T, TT)
            p = P[vpos]
            ax = np.abs(p[:, 0])
            u = (ax - ax.min()) / max(ax.max() - ax.min(), 1e-9)
            d, _ = body.query(p)
            v = 1 - (d - d.min()) / max(d.max() - d.min(), 1e-9)
            out.append(dict(kind=kind, side=side, vpos=vpos, uv=np.stack([u, v], 1), tris=TI))
    return out

def lash_texture(w=256, h=64, seed=4):
    """속눈썹 띠: 뿌리(v=0)에서 끝으로 휘며 가늘어진다. 안쪽 끝은 성기고 짧다"""
    rng = np.random.default_rng(seed)
    S = 4
    W, H = w * S, h * S
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for i in range(95):
        u = rng.uniform(0.03, 0.97)
        x0 = u * W
        L = H * rng.uniform(0.35, 0.85) * (0.45 + 0.55 * np.sin(np.pi * min(1, u * 1.15)))
        curl = rng.uniform(0.1, 0.3) * L
        lean = (u - 0.35) * 0.5 * L
        pts = [(x0 + lean * t + curl * t * t * 0.3, t * L) for t in np.linspace(0, 1, 10)]
        for k in range(9):
            t = k / 9
            wdt = max(1, int(round(2.6 * (1 - t) + 0.6)))
            d.line([pts[k], pts[k + 1]], fill=int(235 * (1 - 0.55 * t)), width=wdt)
    # 뿌리 쪽 속눈썹 선(멀리서 눈매가 또렷하게)
    d.rectangle([0, 0, W, int(H * 0.12)], fill=235)
    im = im.filter(ImageFilter.GaussianBlur(0.8)).resize((w, h), Image.LANCZOS)
    a = np.asarray(im)
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = a
    return Image.fromarray(rgba, 'RGBA')
