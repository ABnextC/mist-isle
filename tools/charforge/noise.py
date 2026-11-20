# 3D 값 잡음·세포 잡음(벡터화). 질감 굽기에 쓴다
import numpy as np

def _hash(ix, iy, iz, seed=0):
    """splitmix64 마무리 섞기(격자 무늬가 생기지 않게)"""
    with np.errstate(over='ignore'):
        h = (np.asarray(ix, np.int64).astype(np.uint64) * np.uint64(0x9E3779B97F4A7C15)
             + np.asarray(iy, np.int64).astype(np.uint64) * np.uint64(0xC2B2AE3D27D4EB4F)
             + np.asarray(iz, np.int64).astype(np.uint64) * np.uint64(0x165667B19E3779F9)
             + np.uint64(seed * 0x27D4EB2F165667C5 % (1 << 64)))
        h ^= h >> np.uint64(30)
        h *= np.uint64(0xBF58476D1CE4E5B9)
        h ^= h >> np.uint64(27)
        h *= np.uint64(0x94D049BB133111EB)
        h ^= h >> np.uint64(31)
    return (h >> np.uint64(40)).astype(np.float64) / float(1 << 24)

def value3(p, scale, seed=0):
    q = p * scale
    i = np.floor(q).astype(np.int64)
    f = q - i
    u = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out

def fbm(p, scale, octaves=4, seed=0, gain=0.5):
    a, s, tot, norm = 1.0, scale, 0.0, 0.0
    for o in range(octaves):
        tot = tot + a * value3(p, s, seed + o * 17)
        norm += a
        a *= gain
        s *= 2.03
    return tot / norm

def cells(p, scale, seed=0):
    """세포 잡음 F1(가까운 점까지 거리, 0~1쯤)"""
    q = p * scale
    i = np.floor(q).astype(np.int64)
    best = np.full(len(p), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i + [dx, dy, dz]
                o = np.stack([_hash(c[:, 0], c[:, 1], c[:, 2], seed + k) for k in range(3)], 1)
                d = np.linalg.norm(c + o - q, axis=1)
                best = np.minimum(best, d)
    return best
