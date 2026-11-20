# 2단계: 보이는 피부(머리·목·손·걷은 팔뚝)만 남기고, 섬을 아틀라스로 다시 묶어 피부 질감을 굽는다.
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from meshutil import split_uv, vertex_normals
from atlas import islands, tri_area3, tri_area2, layout, rasterize, bake_attr, dilate
from masks import face_masks
from noise import fbm, cells, value3

def region_dist(ctx, inside):
    """영역 안 꼭짓점의 경계까지 측지 거리(영역 밖은 0)"""
    T = ctx.T
    P = ctx.P
    n = len(P)
    e = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    e = np.unique(np.sort(e, axis=1), axis=0)
    l = np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1)
    cross = inside[e[:, 0]] != inside[e[:, 1]]
    src = np.unique(np.where(inside[e[cross, 0]], e[cross, 0], e[cross, 1]))
    keep = inside[e[:, 0]] & inside[e[:, 1]]
    ee = e[keep]
    ll = l[keep]
    rows = np.concatenate([ee[:, 0], np.full(len(src), n)])
    cols = np.concatenate([ee[:, 1], src])
    vals = np.concatenate([ll, np.full(len(src), 1e-9)])
    A = coo_matrix((vals, (rows, cols)), shape=(n + 1, n + 1))
    d = dijkstra(A, directed=False, indices=n)[:n]
    d[~inside] = 0
    d[~np.isfinite(d)] = 0
    return d

def visible_faces(ctx, Fd, margin=0.018, names=('shirt', 'vest', 'trousers', 'boots', 'belt')):
    hidden = np.zeros(len(ctx.P), bool)
    for g in names:
        inside = Fd[g] >= 0
        d = region_dist(ctx, inside)
        hidden |= inside & (d > margin)
    return ~hidden[ctx.T].all(1)

def orig_islands(ctx):
    T, TT = ctx.T, ctx.TT
    vpos, vuv, TI = split_uv(T, TT)
    lab_t, _ = islands(TI, len(vpos))
    return lab_t

def head_frame(B):
    H = B['H']
    eL, eR = np.array(H['eye.L']), np.array(H['eye.R'])
    return dict(eL=eL, eR=eR, eye_y=eL[1], mouth=np.array(H['oris04.L']), head=np.array(H['head']))

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def brow_mask(p, n, F, female):
    """눈썹: 눈 위 아치. 얼굴 앞에서 본 (x, y)로 그린다. 반환 (밀도 0~1, 털 방향 각)"""
    out = np.zeros(len(p))
    ang = np.zeros(len(p))
    front = n[:, 2] > 0.15
    for sx, e in ((1, F['eL']), (-1, F['eR'])):
        x = (p[:, 0] - e[0]) * sx      # 바깥쪽 +
        y = p[:, 1] - e[1]
        t = np.clip((x + 0.019) / 0.047, 0, 1)   # 0=안쪽 끝, 1=바깥 끝
        inside_x = (x > -0.021) & (x < 0.03)
        peak = 0.62
        yc = (0.0205 + 0.006 * np.sin(np.clip(t / peak, 0, 1) * np.pi / 2) - 0.010 * np.clip((t - peak) / (1 - peak), 0, 1) ** 1.4)
        if female:
            yc = yc + 0.0015 + 0.0015 * np.sin(t * np.pi)
        half = (0.0042 if not female else 0.0034) * (1 - 0.55 * t) + 0.0011
        dy = np.abs(y - yc)
        m = (1 - smoothstep(half * 0.55, half, dy)) * smoothstep(-0.021, -0.016, x) * (1 - smoothstep(0.024, 0.03, x))
        m = m * front * inside_x
        out = np.maximum(out, m)
        a = np.where(t < 0.25, 1.2, 0.25 - 0.5 * t) * sx
        ang = np.where(m > 0, a, ang)
    return out, ang

def scalp_mask(p, n, F, female):
    """머리털이 나는 곳(정수리·옆·뒤). 머리 중심 기준 구면 각으로 이마 선·귀 둘레를 정한다"""
    c = F['head'] + np.array([0, 0.075, 0.0])
    d = p - c
    r = np.linalg.norm(d, axis=1) + 1e-9
    el = np.arcsin(np.clip(d[:, 1] / r, -1, 1))          # 위 +
    az = np.arctan2(d[:, 0], d[:, 2])                     # 앞 0, 옆 ±π/2, 뒤 ±π
    a = np.abs(az)
    # 앞(이마 선)은 높고, 관자놀이에서 내려가고, 귀 위(옆)를 지나 뒤통수 아래(목덜미)까지
    hairline = np.interp(a, [0, 0.45, 0.8, 1.15, 1.45, 1.75, 2.3, np.pi], [0.69, 0.6, 0.36, 0.22, 0.24, 0.02, -0.38, -0.55])
    if female:
        hairline = hairline - 0.02
    m = smoothstep(hairline - 0.01, hairline + 0.045, el) ** 1.3
    # 귀 앞 구레나룻 가늘게
    return m

def stubble_mask(p, n, F, M):
    c = F['head']
    y = p[:, 1]
    mouth_y = F['mouth'][1]
    front = smoothstep(-0.02, 0.05, p[:, 2] - c[2])
    under_nose = 1 - smoothstep(mouth_y + 0.012, mouth_y + 0.03, y)
    below_cheek = 1 - smoothstep(mouth_y + 0.0, mouth_y + 0.04, y + np.abs(p[:, 0]) * 0.15)
    jaw = smoothstep(mouth_y - 0.075, mouth_y - 0.055, y)
    lip = np.maximum(M['lipU'], M['lipL'])
    m = np.maximum(under_nose * (np.abs(p[:, 0]) < 0.03), below_cheek) * jaw * front * (1 - smoothstep(0.1, 0.4, lip))
    return np.clip(m, 0, 1)

def bake_skin(ctx, B, vis, size=1024, female=False, seed=1):
    T, TT, VT, P = ctx.T, ctx.TT, ctx.VT, ctx.P
    lab = orig_islands(ctx)
    Tv, TTv, labv = T[vis], TT[vis], lab[vis]
    vpos, vuv, TI = split_uv(Tv, TTv)
    sub_t, _ = islands(TI, len(vpos))
    groups = []
    gl = []
    for k in np.unique(sub_t):
        m = sub_t == k
        tv = TI[m]
        used = np.unique(tv)
        o = labv[m][0]
        dens = {0: 1.0, 4: 0.55, 7: 0.55, 3: 0.35, 6: 0.35, 1: 0.2}.get(int(o), 0.45)
        a3 = tri_area3(P[vpos], tv).sum()
        auv = tri_area2(VT[vuv], tv).sum()
        groups.append(dict(uv=VT[vuv[used]], weight=dens, area3=a3, area_uv=auv, used=used))
        gl.append(o)
    uvs, D = layout(groups, size, pad=4)
    UV = np.zeros((len(vpos), 2))
    for g, u in zip(groups, uvs):
        UV[g['used']] = u
    N = vertex_normals(P, T)
    Mv = face_masks(len(P))
    # 표적 꼭짓점 집합의 가장자리가 선으로 보이지 않게 몸 면을 따라 부드럽게 편다
    from garment import smooth_field
    Mv = {k: np.clip(smooth_field(ctx, v, 8, 0.5), 0, 1) for k, v in Mv.items()}
    F = head_frame(B)
    tid, yy, xx, t, bary = rasterize(UV, TI, size)
    p = bake_attr(P[vpos], TI, t, bary)
    nn = bake_attr(N[vpos], TI, t, bary)
    nn /= np.linalg.norm(nn, axis=1, keepdims=True)
    mk = {k: bake_attr(v[vpos], TI, t, bary) for k, v in Mv.items()}
    reg_head = bake_attr(ctx.GW[vpos][:, ctx.bi['head']], TI, t, bary)
    reg_hand = bake_attr((ctx.w('handL', 'handR'))[vpos], TI, t, bary)
    texel = 1.0 / D
    print(f'  skin atlas {size}: {D / 1000:.2f} px/mm(머리 기준), texels {len(t)}')

    # ── 바탕색(sRGB 0~1)
    base = np.array([0.89, 0.69, 0.57])
    col = np.tile(base, (len(t), 1))
    mot = fbm(p, 28, 3, seed) - 0.5
    mot2 = fbm(p, 90, 3, seed + 5) - 0.5
    col *= (1 + 0.07 * mot)[:, None]
    col += np.outer(mot2, [0.025, -0.006, -0.012])
    redc = np.array([0.88, 0.5, 0.46])
    red = 0.5 * mk['cheek'] ** 1.3 + 0.45 * mk['nose'] ** 1.5 + 0.3 * mk['ear'] ** 2 + 0.25 * mk['chin'] ** 2
    red = red * reg_head
    col = col * (1 - 0.32 * red[:, None]) + redc * 0.32 * red[:, None]
    col = col * (1 - 0.22 * mk['bag'][:, None] ** 1.5) + np.array([0.72, 0.56, 0.55]) * 0.22 * mk['bag'][:, None] ** 1.5
    lid = mk['lid'] ** 1.2
    col = col * (1 - 0.28 * lid[:, None]) + np.array([0.76, 0.55, 0.5]) * 0.28 * lid[:, None]
    lip = smoothstep(0.12, 0.5, np.maximum(mk['lipU'], mk['lipL']))
    lipc = np.array([0.78, 0.5, 0.48]) if female else np.array([0.74, 0.5, 0.46])
    lipm = lip * (0.7 if female else 0.55)
    col = col * (1 - lipm[:, None]) + lipc * lipm[:, None]
    # 손: 손가락 마디·손끝 붉게
    knuck = np.zeros(len(t))
    nails = np.zeros(len(t))
    H = B['H']
    for s in ('L', 'R'):
        for f in range(1, 6):
            for seg in (1, 2, 3):
                j = np.array(H[f'finger{f}-{seg}.{s}'])
                knuck = np.maximum(knuck, 1 - smoothstep(0.004, 0.011, np.linalg.norm(p - j, axis=1)))
            tip = np.array(B['tips'][f'{f}{s}'])
            nails = np.maximum(nails, 1 - smoothstep(0.004, 0.0085, np.linalg.norm(p - tip, axis=1)))
    knuck *= reg_hand
    nails *= reg_hand
    col = col * (1 - 0.25 * knuck[:, None]) + redc * 0.25 * knuck[:, None]
    col = col * (1 - 0.35 * nails[:, None]) + np.array([0.93, 0.76, 0.72]) * 0.35 * nails[:, None]

    # ── 털 가면: 정수리·눈썹(0.5~1), 수염(0~0.5)
    bm, bang = brow_mask(p, nn, F, female)
    # 눈썹 털결: 비스듬한 줄무늬 잡음
    rot = np.stack([np.cos(bang), np.sin(bang)], 1)
    q = p[:, 0] * rot[:, 1] - p[:, 1] * rot[:, 0]
    strands = 0.5 + 0.5 * np.sin(q * 2 * np.pi / 0.0011 + 6 * value3(p, 700, seed + 3))
    browd = bm * (0.55 + 0.45 * strands) * reg_head
    scalp = scalp_mask(p, nn, F, female) * reg_head
    hairm = np.clip(np.maximum(scalp, browd), 0, 1)
    stub = np.zeros(len(t)) if female else stubble_mask(p, nn, F, mk) * reg_head
    if not female:
        dots = smoothstep(0.42, 0.18, cells(p, 1800, seed + 9))
        stub = stub * (0.35 + 0.65 * dots) * 0.55
    col = col * (1 - 0.12 * browd[:, None])
    hm = np.where(hairm > 0.02, 0.5 + 0.5 * hairm, 0.5 - 0.5 * stub)

    # ── 거칠기
    rough = 0.52 - 0.1 * lip - 0.08 * mk['nose'] ** 1.5 * reg_head - 0.05 * mk['forehead'] * reg_head + 0.05 * mk['cheek'] - 0.22 * nails
    rough = rough + 0.2 * hairm
    # ── 높이(미세 요철) → 법선
    pore = smoothstep(0.38, 0.0, cells(p, 650, seed + 11))
    poreamt = 0.000035 * (0.4 + 0.6 * np.maximum(mk['nose'], mk['cheek'])) * reg_head + 0.00001
    h = -pore * poreamt + 0.000018 * (fbm(p, 1400, 2, seed + 13) - 0.5)
    h += lip * 0.000025 * np.sin(p[:, 0] * 2 * np.pi / 0.0016) * (1 - smoothstep(0.0, 0.004, np.abs(p[:, 0]) - 0.012))
    h += knuck * 0.00004 * np.sin(p[:, 1] * 2 * np.pi / 0.0013)
    rough = rough + 0.06 * pore * reg_head

    img = lambda ch: np.zeros((size, size, ch), np.float32)
    A = img(4)
    Bt = img(4)
    hm_img = np.zeros((size, size), np.float32)
    mask = np.zeros((size, size), bool)
    mask[yy, xx] = True
    A[yy, xx, :3] = np.clip(col, 0, 1)
    A[yy, xx, 3] = 1.0
    hm_img[yy, xx] = h
    # 높이 기울기(텍셀 단위) → 접선 공간 법선. 행은 아래로 갈수록 v 감소
    hd = dilate(hm_img, mask, 3)
    gx = (np.roll(hd, -1, 1) - np.roll(hd, 1, 1)) / (2 * texel)
    gy = -(np.roll(hd, -1, 0) - np.roll(hd, 1, 0)) / (2 * texel)
    nz = 1.0 / np.sqrt(1 + gx * gx + gy * gy)
    Bt[..., 0] = 0.5 - 0.5 * gx * nz
    Bt[..., 1] = 0.5 - 0.5 * gy * nz
    Bt[yy, xx, 2] = np.clip(rough, 0.2, 0.95)
    Bt[yy, xx, 3] = hm
    A = dilate(A, mask, 10)
    Bt[..., 2:] = dilate(Bt[..., 2:], mask, 10)
    return dict(UV=UV, vpos=vpos, vuv=vuv, TI=TI, A=A, B=Bt, D=D, mask=mask, tex=(yy, xx, t, bary, p, nn))
