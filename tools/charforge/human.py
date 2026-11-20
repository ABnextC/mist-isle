# 사람 모양 만들기: MakeHuman(CC0)의 기본 메시에 거시 표적(성별·나이·근육·체중·키·비율·인종)과
# 얼굴 세부 표적을 섞는다. 가중치 공식은 MakeHuman apps/human.py의 _set*Vals를 그대로 옮겼다.
import numpy as np
from mhbase import load_obj, target, target_names, skeleton

_BASE = None
def base():
    global _BASE
    if _BASE is None:
        _BASE = load_obj()
    return _BASE

def macro_vals(p):
    g, a, m, w = p.get('gender', 0.5), p.get('age', 0.5), p.get('muscle', 0.5), p.get('weight', 0.5)
    h, pr = p.get('height', 0.5), p.get('proportions', 0.5)
    bs, bf = p.get('breast_size', 0.5), p.get('breast_firmness', 0.5)
    v = {'male': g, 'female': 1 - g}
    if a < 0.5:
        v['old'] = 0.0
        v['baby'] = max(0.0, 1 - a * 5.333)
        v['young'] = max(0.0, (a - 0.1875) * 3.2)
        v['child'] = max(0.0, min(1.0, 5.333 * a) - v['young'])
    else:
        v['child'] = v['baby'] = 0.0
        v['old'] = max(0.0, a * 2 - 1)
        v['young'] = 1 - v['old']
    def tri(x, lo, av, hi):
        v[hi] = max(0.0, x * 2 - 1)
        v[lo] = max(0.0, 1 - x * 2)
        v[av] = 1 - (v[hi] + v[lo])
    tri(m, 'minmuscle', 'averagemuscle', 'maxmuscle')
    tri(w, 'minweight', 'averageweight', 'maxweight')
    tri(h, 'minheight', 'averageheight', 'maxheight')
    tri(pr, 'uncommonproportions', 'regularproportions', 'idealproportions')
    tri(bs, 'mincup', 'averagecup', 'maxcup')
    tri(bf, 'minfirmness', 'averagefirmness', 'maxfirmness')
    race = np.array([p.get('african', 1 / 3), p.get('asian', 1 / 3), p.get('caucasian', 1 / 3)], float)
    race = race / race.sum()
    v['african'], v['asian'], v['caucasian'] = race
    v['universal'] = 1.0
    return v

def macro_mods(p):
    v = macro_vals(p)
    mods = []
    for n in target_names():
        if n.startswith('macrodetails/') or (n.startswith('breast/') and n.count('-') >= 5):
            name = n.split('/')[-1]
            f = 1.0
            for tok in name.split('-'):
                f *= v.get(tok, 0.0)
                if f == 0.0:
                    break
            if f > 1e-4:
                mods.append((n, f))
    return mods

def race_units(p, unit, w):
    # 표정 단위는 인종별로 따로 있다. 인종 비율로 섞는다
    v = macro_vals(p)
    return [(f'expression/units/{r}/{unit}', w * v[r]) for r in ('african', 'asian', 'caucasian') if v[r] > 1e-3]

def build(p, extra=()):
    V, VT, F, G = base()
    mods = macro_mods(p) + [(n, w) for n, w in p.get('mods', {}).items()] + list(extra)
    out = V.copy()
    for name, w in mods:
        if abs(w) < 1e-6:
            continue
        i, d = target(name)
        out[i] += d * w
    return out

def joints(V):
    sk = skeleton()
    return {k: V[idx].mean(0) for k, idx in sk['joints'].items()}

def bone_points(V):
    sk = skeleton()
    J = joints(V)
    return {b: (J[d['head']], J[d['tail']]) for b, d in sk['bones'].items()}
