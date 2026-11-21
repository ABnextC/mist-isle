# 이미 만든 캐릭터 묶음(json+bin)의 옷 무게만 다시 고른다(v0.4.10).
#   python3 fixweights.py ../../client/assets/char/pioneer_m.json [...]
# 1) 사타구니 이음매(crotch.py), 2) 겹친 옷 무게 맞추기(layers.py).
# 같은 자리·같은 크기로 skinIndex·skinWeight만 덮어쓴다. 원본 묶음에 한 번만 돌린다(두 번 돌리면 더 고르게 펴진다).

import json
import sys

import numpy as np

from crotch import crotch_blend
from layers import layer_sync

TYPES = {'f32': np.float32, 'i16n': np.int16, 'u8n': np.uint8, 'u8': np.uint8, 'u16n': np.uint16, 'u16': np.uint16, 'u32': np.uint32}


def top4(W):
    idx = np.argsort(-W, axis=1)[:, :4]
    w = np.take_along_axis(W, idx, 1)
    w = np.where(w < 0.01, 0, w)
    s = w.sum(1, keepdims=True)
    w = np.where(s > 0, w / np.maximum(s, 1e-9), 0)
    q = np.round(w * 255)
    q[:, 0] += 255 - q.sum(1)
    idx = np.where(q > 0, idx, 0)
    return idx.astype(np.uint8), q.astype(np.uint8)


def fix_pack(path):
    meta = json.load(open(path))
    binp = path[:-5] + '.bin'
    buf = bytearray(open(binp, 'rb').read())
    # 갑옷 묶음(pioneer_m-heavy 등)은 뼈 목록이 비어 있으면 몸 묶음(pioneer_m)의 것을 쓴다
    base = path if meta.get('bones') else path.rsplit('-', 1)[0] + '.json'
    bones = [b['name'] for b in json.load(open(base))['bones']]
    bi = {b: i for i, b in enumerate(bones)}

    def view(a):
        return np.frombuffer(buf, TYPES[a['type']], a['count'] * a['size'], a['offset']).reshape(a['count'], a['size'])
    parts = []
    for m in meta['meshes']:
        at = m['attributes']
        if 'skinIndex' not in at or 'aMat' not in at:
            continue  # 피부·속눈썹은 빼고 옷만
        P = view(at['position']).astype(np.float64)
        N = view(at['normal']).astype(np.float64) / 32767.0
        SI = view(at['skinIndex']).astype(np.int64)
        SW = view(at['skinWeight']).astype(np.float64) / 255.0
        slot = view(at['aMat'])[:, 0].astype(np.int64)
        ix = m['index']
        T = np.frombuffer(buf, TYPES[ix['type']], ix['count'], ix['offset']).reshape(-1, 3).astype(np.int64)
        W = np.zeros((len(P), len(bones)))
        for k in range(4):
            np.add.at(W, (np.arange(len(P)), SI[:, k]), SW[:, k])
        W0 = W.copy()
        if (W[:, bi['thR']] > 0.01).any() and (W[:, bi['thL']] > 0.01).any():
            W = crotch_blend(P, T, W, bones)
        parts.append(dict(m=m, P=P, N=N, T=T, W=W, W0=W0, slot=slot))
    # 겹친 옷: 한 묶음 안의 옷 조각을 모두 모아 속→겉 무게를 맞춘다
    off = np.cumsum([0] + [len(p['P']) for p in parts])
    P = np.concatenate([p['P'] for p in parts])
    N = np.concatenate([p['N'] for p in parts])
    T = np.concatenate([p['T'] + off[i] for i, p in enumerate(parts)])
    W = np.concatenate([p['W'] for p in parts])
    slot = np.concatenate([p['slot'] for p in parts])
    W, n_layer = layer_sync(P, N, T, W, slot)
    done = []
    for i, p in enumerate(parts):
        Wi = W[off[i]:off[i + 1]]
        si, sw = top4(Wi)
        a, b = p['m']['attributes']['skinIndex'], p['m']['attributes']['skinWeight']
        buf[a['offset']:a['offset'] + si.nbytes] = si.tobytes()
        buf[b['offset']:b['offset'] + sw.nbytes] = sw.tobytes()
        done.append((p['m']['name'], int((np.abs(Wi - p['W0']).sum(1) > 0.05).sum())))
    open(binp, 'wb').write(bytes(buf))
    return done, n_layer


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p, fix_pack(p))
