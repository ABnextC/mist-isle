# MakeHuman hm08 기본 메시·표적·뼈대 읽기(모두 CC0 자료)
import numpy as np, json, collections
import os
D = os.environ.get('MH_DATA', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data'))

def load_obj(path=f'{D}/3dobjs/base.obj'):
    V, VT, faces, groups = [], [], [], []
    g = None
    for line in open(path):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            g = line.split()[1]
        elif line.startswith('f '):
            idx = [p.split('/') for p in line.split()[1:]]
            faces.append(([int(a[0]) - 1 for a in idx], [int(a[1]) - 1 if len(a) > 1 and a[1] else -1 for a in idx]))
            groups.append(g)
    return np.array(V, np.float64), np.array(VT, np.float64), faces, groups

_npz = None
def target(name):
    global _npz
    if _npz is None:
        _npz = np.load(f'{D}/targets.npz', allow_pickle=False)
    i = _npz[f'targets/{name}.index'].astype(np.int64)
    v = _npz[f'targets/{name}.vector'].astype(np.float64) / 1000.0
    return i, v

def target_names():
    global _npz
    if _npz is None:
        _npz = np.load(f'{D}/targets.npz', allow_pickle=False)
    return sorted(k[len('targets/'):-len('.index')] for k in _npz.keys() if k.endswith('.index'))

def apply(V, mods):
    V = V.copy()
    for name, w in mods:
        if abs(w) < 1e-6:
            continue
        i, v = target(name)
        V[i] += v * w
    return V

def skeleton():
    return json.load(open(f'{D}/rigs/default.mhskel'))

def weights():
    return json.load(open(f'{D}/rigs/default_weights.mhw'))['weights']
