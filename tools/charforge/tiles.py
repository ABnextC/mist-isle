# 옷 결 타일(512², 이음매 없음): R 리넨 평직, G 모직 능직, B 가죽 오돌토돌, A 잔 잡음
import numpy as np
from PIL import Image

def periodic_noise(n, cells, rng):
    """주기 n의 값 잡음: 격자 cells×cells 무작위를 이음매 없이 보간"""
    g = rng.random((cells, cells))
    x = np.arange(n) / n * cells
    i = np.floor(x).astype(int)
    f = x - i
    f = f * f * (3 - 2 * f)
    i0, i1 = i % cells, (i + 1) % cells
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]

def fbm2(n, base, oct, rng):
    s, a, t, w = base, 1.0, 0, 0
    for _ in range(oct):
        t = t + a * periodic_noise(n, s, rng)
        w += a
        a *= 0.5
        s *= 2
    return t / w

def worley(n, cells, rng):
    pts = (np.arange(cells)[:, None] + rng.random((cells, cells, 2)).transpose(2, 0, 1).reshape(2, -1).T.reshape(cells, cells, 2) * 0) 
    jit = rng.random((cells, cells, 2))
    yy, xx = np.mgrid[0:n, 0:n] / n * cells
    best = np.full((n, n), 9.0)
    ci, cj = np.floor(yy).astype(int), np.floor(xx).astype(int)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ii, jj = ci + di, cj + dj
            o = jit[ii % cells, jj % cells]
            d = np.hypot(yy - (ii + o[..., 0]), xx - (jj + o[..., 1]))
            best = np.minimum(best, d)
    return best

def tiles(n=512, seed=7):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    # 리넨: 칸 16px, 실마다 굵기 흔들림
    p = 16
    ci, cj = (yy // p).astype(int), (xx // p).astype(int)
    fy, fx = (yy % p) / p, (xx % p) / p
    prof = lambda t: np.sqrt(np.clip(1 - (2 * t - 1) ** 2, 0, 1))
    slub_r = periodic_noise(n, 32, rng)
    slub_c = periodic_noise(n, 32, rng)
    over = (ci + cj) % 2 == 0
    warp = prof(fx) * (0.75 + 0.5 * slub_c[0][xx.astype(int) % n][None] if False else 1)
    lin = np.where(over, prof(fx) * (0.8 + 0.4 * slub_c), prof(fy) * (0.8 + 0.4 * slub_r))
    lin = 0.65 * lin + 0.35 * fbm2(n, 64, 3, rng)
    # 능직: 대각선 골(주기 12px) + 털 잡음
    q = ((xx + yy) % 12) / 12
    tw = prof(q) * 0.7 + 0.3 * fbm2(n, 128, 3, rng)
    tw = tw * (0.85 + 0.3 * fbm2(n, 16, 2, rng))
    # 가죽: 세포 결 + 큰 주름
    w1 = worley(n, 48, rng)
    w2 = worley(n, 20, rng)
    le = 1 - np.clip(w1 / 0.75, 0, 1) ** 0.7
    le = 0.6 * le + 0.25 * (1 - np.clip(w2 / 0.8, 0, 1)) + 0.15 * fbm2(n, 8, 3, rng)
    nz = fbm2(n, 64, 4, rng)
    out = np.stack([lin, tw, le, nz], 2)
    lo = out.reshape(-1, 4).min(0)
    hi = out.reshape(-1, 4).max(0)
    out = (out - lo) / (hi - lo)
    return Image.fromarray((out * 255).astype(np.uint8), 'RGBA')

if __name__ == '__main__':
    im = tiles()
    import sys
    im.save(sys.argv[1] if len(sys.argv) > 1 else 'detail.webp', lossless=True, method=6)
