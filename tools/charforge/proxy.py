# MakeHuman .mhclo 맞춤: 꼭짓점마다 기본 메시 세 점의 무게중심 + 축별 비율로 늘인 오프셋
import numpy as np

def load_obj_simple(path):
    V, VT, F = [], [], []
    for line in open(path):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('f '):
            idx = [p.split('/') for p in line.split()[1:]]
            F.append(([int(a[0]) - 1 for a in idx], [int(a[1]) - 1 for a in idx]))
    return np.array(V), np.array(VT), F

def load_mhclo(path):
    refs, scale, verts, mode = [], {}, [], None
    for line in open(path):
        s = line.split()
        if not s or s[0].startswith('#'):
            continue
        if s[0] in ('x_scale', 'y_scale', 'z_scale'):
            scale[s[0][0]] = (int(s[1]), int(s[2]), float(s[3]))
        elif s[0] == 'verts':
            mode = 'v'
        elif s[0] in ('delete_verts', 'weights', 'material', 'obj_file'):
            mode = None if s[0] != 'obj_file' else mode
        elif mode == 'v':
            if len(s) == 1:
                verts.append(([int(s[0])] * 3, [1.0, 0, 0], [0, 0, 0]))
            elif len(s) >= 9:
                verts.append(([int(x) for x in s[:3]], [float(x) for x in s[3:6]], [float(x) for x in s[6:9]]))
    return scale, verts

def fit(P, scale, verts):
    """P: 기본 메시 꼭짓점(현재 모양). 오프셋 단위는 P와 같은 축척으로 맞춘다"""
    sc = np.ones(3)
    for k, ax in (('x', 0), ('y', 1), ('z', 2)):
        if k in scale:
            a, b, ref = scale[k]
            sc[ax] = abs(P[a, ax] - P[b, ax]) / ref
    out = np.zeros((len(verts), 3))
    for i, (v, w, d) in enumerate(verts):
        out[i] = w[0] * P[v[0]] + w[1] * P[v[1]] + w[2] * P[v[2]] + np.array(d) * sc
    return out
