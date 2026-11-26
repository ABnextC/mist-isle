"""탈것 타기 동작(v3.2): clips.json에 'ride'(고리)를 더한다. 원본 BVH 없이 지금 묶음의 서기 한 장에서 만든다.

말 등에 걸터앉은 자세: 엉덩이는 서기 높이 그대로 두고(화면이 안장 높이에 맞춰 몸 전체를 올린다)
두 발은 옆으로 벌려 배를 감싸듯 조금 앞에, 무릎은 앞·바깥으로. 두 손은 배꼽 앞에서 고삐를 쥔다.
한 주기 동안 엉덩이가 안장에서 두 번 살짝 들썩이고 몸통이 앞뒤로 조금 흔들린다(화면이 말 걸음 주기에 맞춰 위상을 돌린다).
실행: python3 tools/animforge/ride.py
"""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from retarget import BONES  # noqa: E402
from actions import keyed_clip, keys_at, leg_ik, one_frame  # noqa: E402
from build import fix_legs, fix_arms, pack, fk_full  # noqa: E402

OUT = os.path.join(HERE, '..', '..', 'client', 'assets', 'anim', 'clips.json')


def unpack(c):
    n = c['n']
    q = np.array(c['q'], float).reshape(n, len(BONES), 4)
    out = {'n': n, 'dur': c['dur'], 'stride': c.get('stride', 0), 'src': c.get('src', ''),
           'q': {b: q[:, i, :].copy() for i, b in enumerate(BONES)}, 'h': np.array(c['h'], float).reshape(n, 3)}
    return out


def P(x, y, z):
    return (x, y, z)


def ride_clip(idle):
    stand = one_frame(idle, 0.0)
    _, pos = fk_full(stand['q'], stand['h'])
    hy = float(pos['hips'][0][1])
    # 고리 1초: 두 번 들썩(말 걸음 반 주기마다)
    keys = {
        'hips': [(0, P(0, -0.0, -0.06)), (0.25, P(0, 0.025, -0.05)), (0.5, P(0, 0.0, -0.06)), (0.75, P(0, 0.025, -0.05))],
        'pitch': [(0, 0.16), (0.25, 0.2), (0.5, 0.16), (0.75, 0.2)],
        'neck': [(0, -0.12), (0.25, -0.15), (0.5, -0.12), (0.75, -0.15)],
        'R': [(0, P(-0.11, hy + 0.12, 0.36)), (0.25, P(-0.11, hy + 0.1, 0.37)), (0.5, P(-0.11, hy + 0.12, 0.36)), (0.75, P(-0.11, hy + 0.1, 0.37))],
        'L': [(0, P(0.11, hy + 0.12, 0.36)), (0.25, P(0.11, hy + 0.1, 0.37)), (0.5, P(0.11, hy + 0.12, 0.36)), (0.75, P(0.11, hy + 0.1, 0.37))],
        'poleR': [-0.9, -0.7, -0.3], 'poleL': [0.9, -0.7, -0.3],
    }
    c = keyed_clip(stand, 1.0, keys, loop=True, ev={}, src='77_02+탈것')
    n = c['n']
    for side, sx in (('L', 1), ('R', -1)):
        # 발목: 엉덩이 옆 0.33m, 엉덩이보다 0.5m 아래, 0.12m 앞(등자에 걸친 발)
        T = np.tile([sx * 0.33, hy - 0.52, 0.1], (n, 1))
        T[:, 1] += keys_at([(0, 0.0), (0.25, 0.012), (0.5, 0.0), (0.75, 0.012)], n, True, 1)[:, 0]
        pole = np.tile([sx * 0.75, 0.0, 1.0], (n, 1))
        c = leg_ik(c, side, T, pole=pole)
    return c


if __name__ == '__main__':
    data = json.load(open(OUT))
    idle = unpack(data['clips']['idle'])
    c = fix_arms(fix_legs(ride_clip(idle)))
    _, pos = fk_full(c['q'], c['h'])
    print('ride frames', c['n'], 'hips', np.round(pos['hips'][0], 3), 'ankleL', np.round(pos['ftL'][0], 3), 'handR', np.round(pos['handR'][0], 3))
    data['clips']['ride'] = pack(c)
    json.dump(data, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT)
