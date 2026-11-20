# 옷 결 보조 타일(512², 이음매 없음, v0.4.6): R 큰 얼룩(바램·때), G 금속(망치 자국 + 긁힘), B 중간 잡음(닳음 끊기), A 가죽 주름 골
import numpy as np
from PIL import Image
from tiles import periodic_noise, fbm2, worley


def scratches(n, count, rng):
    """주기 경계를 넘나드는 가는 긁힘 선(높이 0~1, 1=긁힘 없음)"""
    img = np.ones((n, n))
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    for _ in range(count):
        x0, y0 = rng.random(2) * n
        ang = rng.normal(0.35, 0.5)
        L = rng.uniform(n * 0.05, n * 0.35)
        w = rng.uniform(0.5, 1.3)
        depth = rng.uniform(0.15, 0.55)
        dx, dy = np.cos(ang), np.sin(ang)
        # 주기 거리
        rx = (xx - x0 + n / 2) % n - n / 2
        ry = (yy - y0 + n / 2) % n - n / 2
        t = rx * dx + ry * dy
        d = np.abs(-rx * dy + ry * dx)
        m = (t > 0) & (t < L)
        img = np.where(m, np.minimum(img, 1 - depth * np.exp(-(d / w) ** 2)), img)
    return img


def creases(n, count, rng):
    """가죽 접힌 골: 굽은 가는 선"""
    img = np.zeros((n, n))
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    for _ in range(count):
        x0, y0 = rng.random(2) * n
        ang = rng.uniform(0, np.pi)
        L = rng.uniform(n * 0.08, n * 0.3)
        curv = rng.normal(0, 0.004)
        w = rng.uniform(1.2, 3.0)
        rx = (xx - x0 + n / 2) % n - n / 2
        ry = (yy - y0 + n / 2) % n - n / 2
        dx, dy = np.cos(ang), np.sin(ang)
        t = rx * dx + ry * dy
        d = np.abs(-rx * dy + ry * dx - curv * t * t)
        m = (t > -L / 2) & (t < L / 2)
        fall = np.clip(1 - np.abs(t) / (L / 2), 0, 1) ** 0.5
        img = np.maximum(img, np.where(m, np.exp(-(d / w) ** 2) * fall, 0))
    return img


def tiles2(n=512, seed=11):
    rng = np.random.default_rng(seed)
    big = fbm2(n, 4, 4, rng)
    # 금속: 망치 자국(세포 중심이 오목) + 긁힘 + 결
    w = worley(n, 11, rng)
    ham = 1 - np.exp(-(w * 2.1) ** 2)
    sc = scratches(n, 70, rng)
    metal = 0.55 * ham + 0.3 * sc + 0.15 * fbm2(n, 64, 3, rng)
    mid = fbm2(n, 16, 4, rng)
    cr = 1 - creases(n, 38, rng) * 0.9
    out = np.stack([big, metal, mid, cr], 2)
    lo = out.reshape(-1, 4).min(0)
    hi = out.reshape(-1, 4).max(0)
    out = (out - lo) / (hi - lo)
    return Image.fromarray((out * 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
    import sys
    tiles2().save(sys.argv[1] if len(sys.argv) > 1 else 'detail2.webp', lossless=True, method=6)
