# 옮긴 동작을 막대 사람으로 그려 본다(소스 vs 게임 뼈대)
import sys, json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from retarget import retarget, BONES, PARENT, quat_to_mat, nrm

REST = {b['name']: b['pos'] for b in json.load(open('/home/claude/mist-isle/client/assets/char/pioneer_m.json'))['bones']}


def target_fk(L, hips_off=None):
    F = len(L['hips'])
    G = {}
    pos = {}
    for b in BONES:
        p = PARENT[b]
        Ml = quat_to_mat(L[b])
        if p is None:
            G[b] = Ml
            base = np.array(REST['hips'])
            pos[b] = np.tile(base, (F, 1)) + (hips_off if hips_off is not None else 0)
        else:
            G[b] = G[p] @ Ml
            off = np.array(REST[b]) - np.array(REST[p])
            pos[b] = pos[p] + np.einsum('fij,j->fi', G[p], off)
    # 발끝·손끝·머리끝(그림용)
    pos['toeL'] = pos['ftL'] + np.einsum('fij,j->fi', G['ftL'], [0, -0.06, 0.15])
    pos['toeR'] = pos['ftR'] + np.einsum('fij,j->fi', G['ftR'], [0, -0.06, 0.15])
    pos['tipL'] = pos['handL'] + np.einsum('fij,j->fi', G['handL'], np.array(REST['handL']) - REST['elL']) * 0.6
    pos['tipR'] = pos['handR'] + np.einsum('fij,j->fi', G['handR'], np.array(REST['handR']) - REST['elR']) * 0.6
    pos['top'] = pos['head'] + np.einsum('fij,j->fi', G['head'], [0, 0.17, 0.02])
    return pos


EDGES_T = [('hips', 'spine'), ('spine', 'chest'), ('chest', 'neck'), ('neck', 'head'), ('head', 'top'),
           ('chest', 'clavL'), ('clavL', 'shL'), ('shL', 'elL'), ('elL', 'handL'), ('handL', 'tipL'),
           ('chest', 'clavR'), ('clavR', 'shR'), ('shR', 'elR'), ('elR', 'handR'), ('handR', 'tipR'),
           ('hips', 'thL'), ('thL', 'knL'), ('knL', 'ftL'), ('ftL', 'toeL'), ('hips', 'thR'), ('thR', 'knR'), ('knR', 'ftR'), ('ftR', 'toeR')]
EDGES_S = [('Hips', 'Spine'), ('Spine', 'Spine1'), ('Spine1', 'Neck1'), ('Neck1', 'Head'), ('Head', 'Head_end'),
           ('Spine1', 'LeftShoulder'), ('LeftShoulder', 'LeftArm'), ('LeftArm', 'LeftForeArm'), ('LeftForeArm', 'LeftHand'),
           ('Spine1', 'RightShoulder'), ('RightShoulder', 'RightArm'), ('RightArm', 'RightForeArm'), ('RightForeArm', 'RightHand'),
           ('Hips', 'LeftUpLeg'), ('LeftUpLeg', 'LeftLeg'), ('LeftLeg', 'LeftFoot'), ('LeftFoot', 'LeftToeBase'),
           ('Hips', 'RightUpLeg'), ('RightUpLeg', 'RightLeg'), ('RightLeg', 'RightFoot'), ('RightFoot', 'RightToeBase')]


def draw(r, pos, idxs, out, cols=8):
    fig, axes = plt.subplots(2, len(idxs), figsize=(2.0 * len(idxs), 6))
    for k, i in enumerate(idxs):
        for row, (ax_i, ax_j) in enumerate(((2, 1), (0, 1))):  # 옆(z,y) / 앞(x,y)
            ax = axes[row, k]
            # 소스(축척, 엉덩이를 게임 엉덩이에 맞춤, 오른쪽으로 비켜 그림)
            S = r['P']
            hip = S['Hips'][i]
            for a, b in EDGES_S:
                pa = (S[a][i] - hip) * r['scale'] + np.array(REST['hips']) + [0.6, 0, 0.6]
                pb = (S[b][i] - hip) * r['scale'] + np.array(REST['hips']) + [0.6, 0, 0.6]
                ax.plot([pa[ax_i], pb[ax_i]], [pa[ax_j], pb[ax_j]], c='#aaa', lw=1.5)
            for a, b in EDGES_T:
                pa, pb = pos[a][i], pos[b][i]
                c = '#d33' if a.endswith('L') or b.endswith('L') or b in ('toeL', 'tipL') else '#33d' if a.endswith('R') or b.endswith('R') or b in ('toeR', 'tipR') else '#222'
                ax.plot([pa[ax_i], pb[ax_i]], [pa[ax_j], pb[ax_j]], c=c, lw=2)
            ax.set_aspect('equal')
            ax.set_xlim(-0.7, 1.4)
            ax.set_ylim(-0.05, 2.0)
            ax.axhline(0, c='#6a6', lw=0.8)
            ax.set_xticks([])
            ax.set_yticks([])
            ax.set_title(f'{i}', fontsize=7)
    plt.tight_layout()
    plt.savefig(out, dpi=70)


if __name__ == '__main__':
    path = sys.argv[1]
    out = sys.argv[2]
    r = retarget(path, REST, heading=float(sys.argv[3]) if len(sys.argv) > 3 else None)
    H = r['hips']
    off = (H - H[0]) * r['scale']
    off[:, [0, 2]] = 0
    off[:, 1] = (H[:, 1] - r['ref']['Hips'][1]) * r['scale']
    pos = target_fk(r['L'], off)
    n = r['F']
    idxs = list(np.linspace(0, n - 1, 8).astype(int))
    draw(r, pos, idxs, out)
    print('frames', n, 'scale', round(r['scale'], 4))
