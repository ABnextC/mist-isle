# 게임 동작 묶음 만들기: CMU 모션 캡처에서 서기·걷기·달리기를 골라 게임 뼈대로 옮겨 client/assets/anim/clips.json 으로 낸다.
# 실행: python3 tools/animforge/build.py <CMU BVH 폴더(data/)>   (예: CMU 미러 저장소 data/)
# 원본: CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH 변환 Bruce Hahne(cgspeed). 사용 제한 없음.
import sys, os, json
import numpy as np
from bvh import parse, fk
from retarget import retarget, BONES, nrm

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/mocap/cmu/data'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'client', 'assets', 'anim', 'clips.json')
REST = {b['name']: b['pos'] for b in json.load(open(os.path.join(HERE, '..', '..', 'client', 'assets', 'char', 'pioneer_m.json')))['bones']}
FPS = 30


def qmul(a, b):
    x1, y1, z1, w1 = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    x2, y2, z2, w2 = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2], -1)


def qinv(q):
    return q * np.array([-1, -1, -1, 1.0])


def qpow(q, t):
    """단위 쿼터니언의 t제곱(회전각 × t)"""
    q = np.where(q[..., 3:4] < 0, -q, q)
    w = np.clip(q[..., 3], -1, 1)
    ang = np.arccos(w)
    s = np.sin(ang)
    axis = np.where(s[..., None] > 1e-8, q[..., :3] / np.maximum(s[..., None], 1e-8), 0.0)
    na = ang * np.asarray(t)
    return np.concatenate([axis * np.sin(na)[..., None], np.cos(na)[..., None]], -1)


def slerp(a, b, t):
    d = (a * b).sum(-1, keepdims=True)
    b = np.where(d < 0, -b, b)
    return qmul(a, qpow(qmul(qinv(a), b), t))


def sample(L, H, f0, f1, n):
    """120fps 원본 [f0, f1)을 n장으로(쿼터니언 보간)"""
    ts = f0 + (f1 - f0) * np.arange(n) / n
    i0 = np.floor(ts).astype(int)
    fr = ts - i0
    q = {b: slerp(L[b][i0], L[b][i0 + 1], fr) for b in BONES}
    h = H[i0] * (1 - fr[:, None]) + H[i0 + 1] * fr[:, None]
    return q, h


def loop_fix(q, f_end_q):
    """끝 자세(f_end_q)가 첫 장과 같아지게 차이를 고르게 나눠 지운다"""
    n = len(next(iter(q.values())))
    out = {}
    for b, Q in q.items():
        delta = qmul(f_end_q[b], qinv(Q[0]))  # 처음→끝 어긋남
        t = np.arange(n) / n
        corr = qpow(np.broadcast_to(qinv(delta), Q.shape), t)
        out[b] = qmul(corr, Q)
    return out


def heading_of(P, f0, f1):
    d = P['Hips'][f1] - P['Hips'][f0]
    return float(np.arctan2(d[0], d[2]))


def strikes(P, heading):
    fwd = np.array([np.sin(heading), 0, np.cos(heading)])
    rel = (P['LeftFoot'] - P['Hips']) @ fwd
    w = 12
    return [i for i in range(w, len(rel) - w) if rel[i] == rel[i - w:i + w + 1].max() and rel[i] > np.percentile(rel, 60)]


def cycle_clip(path, pick=0, amp=None):
    J, D, dt = parse(path)
    P, _ = fk(J, D)
    P = {k: v[1:] for k, v in P.items()}
    hd = heading_of(P, 0, len(P['Hips']) - 1)
    pk = strikes(P, hd)
    f0, f1 = pk[pick], pk[pick + 1]
    r = retarget(path, REST, heading=hd)
    L = r['L']
    H = r['hips']
    n = max(8, int(round((f1 - f0) * dt * FPS)))
    q, h = sample(L, H, f0, f1, n)
    end_q = {b: L[b][f1:f1 + 1] for b in BONES}
    q = loop_fix(q, {b: end_q[b][0] for b in BONES})
    disp = (H[f1] - H[f0])
    stride = float(np.linalg.norm(disp[[0, 2]]) * r['scale'])
    # 제자리: 앞뒤·좌우 직선 흐름을 빼고 출렁임만 남긴다
    t = np.arange(n)[:, None] / n
    hh = (h - H[f0] - disp * t) * r['scale']
    hh[:, 1] = (h[:, 1] - r['ref']['Hips'][1]) * r['scale']
    hh[:, [0, 2]] -= hh[:, [0, 2]].mean(0)
    if amp:
        for b, k in amp.items():
            q[b] = qpow(q[b], k)
    return dict(q=q, h=hh, n=n, stride=stride, dur=(f1 - f0) * dt, src=os.path.basename(path))


def idle_clip(path, t0, t1):
    """조용한 구간에서 처음·끝이 닮은 창을 골라 고리로"""
    J, D, dt = parse(path)
    P, _ = fk(J, D)
    P = {k: v[1:] for k, v in P.items()}
    r = retarget(path, REST, heading=None)
    L = r['L']
    H = r['hips']
    a0, a1 = int(t0 / dt), int(t1 / dt)
    # 머리·엉덩이 방향을 보고 이 구간 평균 방향을 +z로
    fw = r['G']['hips'][a0:a1, :, 2]
    hd = float(np.arctan2(fw[:, 0].mean(), fw[:, 2].mean()))
    r = retarget(path, REST, heading=hd)
    L, H = r['L'], r['hips']
    feat = np.concatenate([L[b] for b in ('hips', 'spine', 'chest', 'neck', 'head', 'shL', 'shR', 'thL', 'thR')], 1)
    best = None
    for i in range(a0, a1 - int(5 / dt), 6):
        for j in range(i + int(5 / dt), min(a1, i + int(9 / dt)), 6):
            d = np.abs(np.abs((feat[i].reshape(-1, 4) * feat[j].reshape(-1, 4)).sum(1)) - 1).sum() + 0.02 * np.linalg.norm(H[i] - H[j])
            if best is None or d < best[0]:
                best = (d, i, j)
    _, f0, f1 = best
    n = int(round((f1 - f0) * dt * FPS))
    q, h = sample(L, H, f0, f1, n)
    q = loop_fix(q, {b: L[b][f1] for b in BONES})
    t = np.arange(n)[:, None] / n
    disp = H[f1] - H[f0]
    hh = (h - H[f0] - disp * t) * r['scale']
    hh[:, 1] = (h[:, 1] - r['ref']['Hips'][1]) * r['scale']
    hh[:, [0, 2]] -= hh[:, [0, 2]].mean(0)
    return dict(q=q, h=hh, n=n, stride=0.0, dur=(f1 - f0) * dt, src=os.path.basename(path), win=[round(f0 * dt, 2), round(f1 * dt, 2)])


def ground(c, mode='const'):
    """딛는 발이 땅(휴식 발목 높이)에 닿게 엉덩이 높이를 맞춘다"""
    from check import target_fk
    L = {b: c['q'][b] for b in BONES}
    pos = target_fk(L, c['h'])
    lo = np.minimum(pos['ftL'][:, 1], pos['ftR'][:, 1])
    rest = REST['ftL'][1]
    c['h'][:, 1] -= np.percentile(lo, 10) - rest
    return c


def pack(c):
    q = np.stack([c['q'][b] for b in BONES], 1)  # (n, 19, 4)
    return {'n': int(c['n']), 'dur': round(float(c['dur']), 4), 'stride': round(float(c['stride']), 4), 'src': c['src'],
            'q': [round(float(x), 4) for x in q.reshape(-1)], 'h': [round(float(x), 4) for x in c['h'].reshape(-1)]}


if __name__ == '__main__':
    clips = {}
    clips['idle'] = idle_clip(f'{ROOT}/137/137_28.bvh', 2.0, 28.0)
    clips['walk'] = cycle_clip(f'{ROOT}/035/35_01.bvh', pick=0)
    clips['run'] = cycle_clip(f'{ROOT}/127/127_06.bvh', pick=0)
    for k in ('walk', 'run'):
        ground(clips[k])
    for k, c in clips.items():
        print(k, 'frames', c['n'], 'dur', round(c['dur'], 3), 'stride', round(c['stride'], 3), c.get('win', ''), 'hips y', np.round(c['h'][:, 1].min(), 3), np.round(c['h'][:, 1].max(), 3))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    data = {'fps': FPS, 'bones': BONES, 'clips': {k: pack(c) for k, c in clips.items()},
            'credit': 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH: Bruce Hahne (cgspeed)'}
    json.dump(data, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
