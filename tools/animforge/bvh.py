# BVH 읽기와 정운동학(관절 세계 위치·회전). CMU 모션 캡처(cgspeed 변환)를 게임 뼈대로 옮기는 데 쓴다.
import numpy as np


class Joint:
    def __init__(self, name, parent):
        self.name = name
        self.parent = parent
        self.offset = np.zeros(3)
        self.channels = []
        self.children = []
        self.end = None  # End Site 오프셋


def parse(path):
    toks = open(path).read().split()
    i = 0
    joints = []
    stack = []
    cur = None
    while True:
        t = toks[i]
        if t in ('ROOT', 'JOINT'):
            j = Joint(toks[i + 1], stack[-1] if stack else None)
            if j.parent:
                j.parent.children.append(j)
            joints.append(j)
            cur = j
            i += 2
        elif t == 'End':
            # End Site { OFFSET x y z }
            cur_end = np.array([float(x) for x in toks[i + 4:i + 7]])
            stack[-1].end = cur_end
            i += 8
            continue
        elif t == '{':
            stack.append(cur)
            i += 1
        elif t == '}':
            stack.pop()
            i += 1
        elif t == 'OFFSET':
            stack[-1].offset = np.array([float(x) for x in toks[i + 1:i + 4]])
            i += 4
        elif t == 'CHANNELS':
            n = int(toks[i + 1])
            stack[-1].channels = toks[i + 2:i + 2 + n]
            i += 2 + n
        elif t == 'MOTION':
            break
        else:
            i += 1
    nf = int(toks[i + 2])
    dt = float(toks[i + 5])
    nch = sum(len(j.channels) for j in joints)
    data = np.array(toks[i + 6:i + 6 + nf * nch], float).reshape(nf, nch)
    return joints, data, dt


def rot(axis, deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    n = len(a)
    R = np.zeros((n, 3, 3))
    if axis == 'X':
        R[:, 0, 0] = 1
        R[:, 1, 1], R[:, 1, 2], R[:, 2, 1], R[:, 2, 2] = c, -s, s, c
    elif axis == 'Y':
        R[:, 1, 1] = 1
        R[:, 0, 0], R[:, 0, 2], R[:, 2, 0], R[:, 2, 2] = c, s, -s, c
    else:
        R[:, 2, 2] = 1
        R[:, 0, 0], R[:, 0, 1], R[:, 1, 0], R[:, 1, 1] = c, -s, s, c
    return R


def fk(joints, data):
    """관절마다 세계 위치 (F,3)와 회전 (F,3,3). 끝점(End Site)은 이름+'_end'."""
    nf = len(data)
    col = 0
    pos, R = {}, {}
    for j in joints:
        Rl = np.tile(np.eye(3), (nf, 1, 1))
        tr = np.zeros((nf, 3))
        for ch in j.channels:
            v = data[:, col]
            col += 1
            if ch.endswith('position'):
                tr[:, 'XYZ'.index(ch[0])] = v
            else:
                Rl = Rl @ rot(ch[0], v)
        if j.parent is None:
            pos[j.name] = j.offset + tr
            R[j.name] = Rl
        else:
            pR = R[j.parent.name]
            pos[j.name] = pos[j.parent.name] + np.einsum('fij,j->fi', pR, j.offset)
            R[j.name] = pR @ Rl
        if j.end is not None:
            pos[j.name + '_end'] = pos[j.name] + np.einsum('fij,j->fi', R[j.name], j.end)
    return pos, R
