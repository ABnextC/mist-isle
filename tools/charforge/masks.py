# 얼굴 부위 마스크: MakeHuman 표적이 움직이는 꼭짓점과 크기를 그대로 부위 지도로 쓴다
import numpy as np
from mhbase import target

def tmask(nv, names, power=1.0):
    m = np.zeros(nv)
    for n in names:
        i, d = target(n)
        ok = i < nv
        a = np.linalg.norm(d[ok], axis=1)
        a = a / max(a.max(), 1e-9)
        m[i[ok]] = np.maximum(m[i[ok]], a)
    return np.clip(m, 0, 1) ** power

def face_masks(nv):
    return {
        'lipU': tmask(nv, ['mouth/mouth-upperlip-volume-incr']),
        'lipL': tmask(nv, ['mouth/mouth-lowerlip-volume-incr']),
        'brow': tmask(nv, ['eyebrows/eyebrows-trans-up']),
        'nose': tmask(nv, ['nose/nose-volume-incr']),
        'cheek': tmask(nv, ['cheek/l-cheek-volume-incr', 'cheek/r-cheek-volume-incr']),
        'ear': tmask(nv, ['ears/l-ear-scale-incr', 'ears/r-ear-scale-incr']),
        'bag': tmask(nv, ['eyes/l-eye-bag-incr', 'eyes/r-eye-bag-incr']),
        'lid': tmask(nv, ['eyes/l-eye-height2-incr', 'eyes/r-eye-height2-incr', 'eyes/l-eye-eyefold-down', 'eyes/r-eye-eyefold-down']),
        'chin': tmask(nv, ['chin/chin-prominent-incr']),
        'laugh': tmask(nv, ['mouth/mouth-laugh-lines-in']),
        'philtrum': tmask(nv, ['mouth/mouth-philtrum-volume-incr']),
        'forehead': tmask(nv, ['forehead/forehead-scale-vert-incr']),
    }
