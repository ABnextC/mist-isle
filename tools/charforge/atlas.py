# 질감 아틀라스: 섬 묶기(선반 쌓기), 삼각형 → 텍셀 래스터(삼각형 번호 + 무게중심 좌표), 가장자리 번짐 채우기
import numpy as np
import cv2
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

def islands(tris, nv):
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]]])
    A = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv))
    nc, lab = connected_components(A, directed=False)
    return lab[tris[:, 0]], lab

def tri_area3(P, T):
    return 0.5 * np.linalg.norm(np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]), axis=1)

def tri_area2(U, T):
    a = U[T[:, 1]] - U[T[:, 0]]
    b = U[T[:, 2]] - U[T[:, 0]]
    return 0.5 * np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])

def pack(rects, size, pad):
    """rects: [(w, h)] 픽셀. MaxRects(짧은 변 맞춤). 반환: [(x, y)] 또는 None(넘침)"""
    free = [(0, 0, size, size)]
    order = sorted(range(len(rects)), key=lambda i: -max(rects[i]) * min(rects[i]))
    pos = [None] * len(rects)
    for i in order:
        w, h = rects[i][0] + 2 * pad, rects[i][1] + 2 * pad
        best = None
        for fx, fy, fw, fh in free:
            if w <= fw and h <= fh:
                ss = min(fw - w, fh - h)
                key = (ss, max(fw - w, fh - h))
                if best is None or key < best[0]:
                    best = (key, fx, fy)
        if best is None:
            return None
        _, x, y = best
        pos[i] = (x + pad, y + pad)
        # 겹치는 빈 칸을 쪼갠다
        nf = []
        for fx, fy, fw, fh in free:
            if x >= fx + fw or x + w <= fx or y >= fy + fh or y + h <= fy:
                nf.append((fx, fy, fw, fh))
                continue
            if x > fx:
                nf.append((fx, fy, x - fx, fh))
            if x + w < fx + fw:
                nf.append((x + w, fy, fx + fw - x - w, fh))
            if y > fy:
                nf.append((fx, fy, fw, y - fy))
            if y + h < fy + fh:
                nf.append((fx, y + h, fw, fy + fh - y - h))
        # 다른 칸에 들어가는 칸은 지운다
        free = [a for a in nf if not any(a != b and a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2] and a[1] + a[3] <= b[1] + b[3] for b in nf)]
    return pos

def pack_shelf(rects, size, pad):
    """rects: [(w, h)] 픽셀. 선반 쌓기. 반환: [(x, y)] 또는 None(넘침)"""
    order = sorted(range(len(rects)), key=lambda i: -rects[i][1])
    pos = [None] * len(rects)
    x = y = shelf = 0
    for i in order:
        w, h = rects[i]
        w += 2 * pad
        h += 2 * pad
        if w > size:
            return None
        if x + w > size:
            y += shelf
            x = 0
            shelf = 0
        if y + h > size:
            return None
        pos[i] = (x + pad, y + pad)
        x += w
        shelf = max(shelf, h)
    return pos

def layout(groups, size, pad=4):
    """groups: [dict(uv(k,2) 원래 UV(섬 안에서 연속), weight 밀도 배율, area3 m², area_uv)]
    → 밀도(px/m)를 이분 탐색으로 최대화해 배치. 반환: 새 UV 목록, 밀도"""
    def try_density(D):
        rects = []
        for g in groups:
            lo, hi = g['uv'].min(0), g['uv'].max(0)
            k = D * g['weight'] * np.sqrt(g['area3'] / max(g['area_uv'], 1e-12))
            w = int(np.ceil((hi[0] - lo[0]) * k)) + 1
            h = int(np.ceil((hi[1] - lo[1]) * k)) + 1
            rects.append((w, h, k, lo))
        p = pack([(r[0], r[1]) for r in rects], size, pad)
        return p, rects
    lo_d, hi_d = 10.0, 20000.0
    best = None
    for _ in range(30):
        mid = (lo_d + hi_d) / 2
        p, rects = try_density(mid)
        if p is None:
            hi_d = mid
        else:
            lo_d = mid
            best = (p, rects, mid)
    p, rects, D = best
    out = []
    for g, (x, y), (w, h, k, lo) in zip(groups, p, rects):
        uvp = (g['uv'] - lo) * k + [x, y]
        out.append(uvp / size)
    return out, D

def rasterize(UV, T, size):
    """UV(0~1, v는 위로) 삼각형을 그려 텍셀마다 (삼각형 번호, 무게중심) — 번호 -1은 빈 곳"""
    ids = np.zeros((size, size, 3), np.uint8)
    px = np.stack([UV[:, 0] * size, (1 - UV[:, 1]) * size], 1)
    for i, t in enumerate(T):
        c = i + 1
        col = (c & 255, (c >> 8) & 255, (c >> 16) & 255)
        pts = np.round(px[t] * 16).astype(np.int32)
        cv2.fillConvexPoly(ids, pts, col, lineType=cv2.LINE_8, shift=4)
    tid = ids[..., 0].astype(np.int64) + (ids[..., 1].astype(np.int64) << 8) + (ids[..., 2].astype(np.int64) << 16) - 1
    yy, xx = np.nonzero(tid >= 0)
    t = tid[yy, xx]
    p = np.stack([xx + 0.5, yy + 0.5], 1)
    a, b, c = px[T[t, 0]], px[T[t, 1]], px[T[t, 2]]
    v0, v1, v2 = b - a, c - a, p - a
    d00 = (v0 * v0).sum(1)
    d01 = (v0 * v1).sum(1)
    d11 = (v1 * v1).sum(1)
    d20 = (v2 * v0).sum(1)
    d21 = (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-12, 1e-12, den)
    w1 = (d11 * d20 - d01 * d21) / den
    w2 = (d00 * d21 - d01 * d20) / den
    w0 = 1 - w1 - w2
    bary = np.clip(np.stack([w0, w1, w2], 1), 0, 1)
    bary /= bary.sum(1, keepdims=True)
    return tid, yy, xx, t, bary

def bake_attr(attr, T, t, bary):
    a = attr[T[t]]
    return (a * bary[..., None]).sum(1) if a.ndim == 3 else (a * bary).sum(1)

def dilate(img, mask, iters=8):
    """빈 텍셀을 이웃 평균으로 채운다(밉맵 번짐 방지)"""
    img = img.astype(np.float32).copy()
    m = mask.astype(np.float32)
    k = np.ones((3, 3), np.float32)
    for _ in range(iters):
        if img.ndim == 3:
            s = cv2.filter2D(img * m[..., None], -1, k, borderType=cv2.BORDER_CONSTANT)
        else:
            s = cv2.filter2D(img * m, -1, k, borderType=cv2.BORDER_CONSTANT)
        c = cv2.filter2D(m, -1, k, borderType=cv2.BORDER_CONSTANT)
        new = (c > 0) & (m == 0)
        if img.ndim == 3:
            img[new] = s[new] / c[new][:, None]
        else:
            img[new] = s[new] / c[new]
        m = np.maximum(m, (c > 0).astype(np.float32))
    return img
