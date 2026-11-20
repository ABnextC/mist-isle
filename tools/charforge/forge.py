# 캐릭터 대장간: 체형 → 옷 → 보이는 피부 → 눈·속눈썹 → (머리카락) → AO → 질감 → 묶음 내보내기
import numpy as np, time, json, sys, os
from PIL import Image
from stage_body import make_body
from garment import Ctx, geodesic_from_rim
from outfit import Land, fields, build_outfit, GID
from stage_skin import visible_faces, bake_skin
from stage_face import eyes, eye_texture, lashes, lash_texture
from meshutil import vertex_normals, split_uv
from noise import fbm
from ao import AOField
from pack import Packer
from presets import MALE, FEMALE
from hair import Head, scalp_roots, grow, cards, hair_texture

OUT = os.environ.get('CHAR_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'client', 'assets', 'char'))
SOLE = 0.02

def top4(W):
    idx = np.argsort(-W, axis=1)[:, :4]
    w = np.take_along_axis(W, idx, 1)
    w = np.where(w < 0.01, 0, w)
    s = w.sum(1, keepdims=True)
    w = np.where(s > 0, w / np.maximum(s, 1e-9), 0)
    # 합이 정확히 1이 되도록(8비트 반올림 오차는 가장 큰 쪽에)
    q = np.round(w * 255)
    q[:, 0] += 255 - q.sum(1)
    return idx.astype(np.uint8), q / 255

def merge_cloth(ctx, meshes, parts, S):
    P, N, W, T, MAT, EDGE, NAMES = [], [], [], [], [], [], []
    off = 0
    shells = {k: v for k, v in S.items()}
    for name, me in meshes.items():
        edge = np.ones(len(me.pos))
        if name in shells and hasattr(me, 'geo'):
            g = shells[name]
            d = geodesic_from_rim(g['pos'], g['gtris'], g['rim'])
            edge = d[me.geo]
        P.append(me.pos); N.append(me.nrm); W.append(me.w); T.append(me.tris + off)
        MAT.append(np.full(len(me.pos), me.gid)); EDGE.append(edge)
        off += len(me.pos)
    for me in parts:
        P.append(me.pos); N.append(me.nrm); W.append(me.w); T.append(me.tris + off)
        MAT.append(np.full(len(me.pos), me.gid)); EDGE.append(np.full(len(me.pos), 2.0))
        off += len(me.pos)
    return dict(pos=np.concatenate(P), nrm=np.concatenate(N), w=np.concatenate(W), tris=np.concatenate(T),
                mat=np.concatenate(MAT), edge=np.concatenate(EDGE))

def decimate_cloth(C, keep):
    """옷 삼각형 줄이기(이차 오차). 속성은 가장 가까운 원래 꼭짓점에서 옮긴다. 재질 칸마다 따로 줄인다"""
    from parts import decimate
    from scipy.spatial import cKDTree
    P, N, W, T, MAT, EDGE = [], [], [], [], [], []
    off = 0
    for g in np.unique(C['mat']):
        tm = C['mat'][C['tris'][:, 0]] == g
        tri = C['tris'][tm]
        used = np.unique(tri)
        remap = -np.ones(len(C['pos']), np.int64)
        remap[used] = np.arange(len(used))
        v = C['pos'][used]
        f = remap[tri]
        # 같은 자리 꼭짓점을 먼저 합친다(UV로 나뉜 것)
        key = np.round(v * 1e5).astype(np.int64)
        _, inv, first = np.unique(key, axis=0, return_inverse=True, return_index=True)[0:0] or (None, None, None)
        uk, idx0, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        inv = inv.ravel()
        vw = v[idx0]
        fw = inv[f]
        fw = fw[(fw[:, 0] != fw[:, 1]) & (fw[:, 1] != fw[:, 2]) & (fw[:, 0] != fw[:, 2])]
        target = max(60, int(len(fw) * keep))
        v2, f2 = decimate(vw, fw, target)
        tree = cKDTree(C['pos'][used])
        _, k = tree.query(v2)
        src = used[k]
        nrm = vertex_normals(v2, f2)
        P.append(v2); N.append(nrm); W.append(C['w'][src]); T.append(f2 + off)
        MAT.append(np.full(len(v2), g)); EDGE.append(C['edge'][src])
        off += len(v2)
    out = dict(pos=np.concatenate(P), nrm=np.concatenate(N), w=np.concatenate(W), tris=np.concatenate(T),
               mat=np.concatenate(MAT), edge=np.concatenate(EDGE))
    out['part'] = out['edge'] > 1.5
    out['edge'] = np.minimum(out['edge'], 1.0)
    print('  cloth decimated', len(C['tris']), '->', len(out['tris']))
    return out

def cloth_color(C, L, seed=0):
    p = C['pos']
    mat = C['mat']
    v = 1 + 0.10 * (fbm(p, 9, 3, seed) - 0.5) + 0.05 * (fbm(p, 40, 2, seed + 3) - 0.5)
    y = p[:, 1]
    # 장화: 발끝·뒤꿈치 닳음(밝게), 밑단 흙(어둡게)
    boot = mat == GID['boots']
    v = np.where(boot, v * (1 + 0.18 * np.clip((p[:, 2] - 0.08) / 0.08, 0, 1)) * (1 - 0.25 * np.clip((0.06 - y) / 0.04, 0, 1)), v)
    # 조끼·바지: 어깨·허벅지 앞이 햇빛에 바램
    up = np.clip(C['nrm'][:, 1], 0, 1)
    v = np.where((mat == GID['vest']) | (mat == GID['trousers']), v * (1 + 0.1 * up), v)
    # 테두리 근처는 살짝 어둡게(솔기·두께)
    e = np.clip(C['edge'] / 0.006, 0, 1)
    v = v * (0.88 + 0.12 * e)
    return v

def forge(name, preset, female, skin_size=1024, seed=1):
    t0 = time.time()
    log = lambda *a: print(f'[{name} {time.time() - t0:5.1f}s]', *a, flush=True)
    B = make_body(preset, sole=SOLE)
    ctx = Ctx(B)
    L = Land(ctx)
    meshes, parts, S = build_outfit(ctx, L, female, SOLE)
    Fd = fields(ctx, L, female)
    log('outfit')
    vis = visible_faces(ctx, Fd)
    C = merge_cloth(ctx, meshes, parts, S)
    C = decimate_cloth(C, 0.45)
    E = eyes(B)
    LS = lashes(B)
    log('cloth', len(C['pos']), 'verts', len(C['tris']), 'tris')
    Hd = Head(ctx, B)
    roots, rn = scalp_roots(ctx, B, 1000 if female else 720, female, seed=seed, min_dist=0.0048)
    HP, HD, layer, Lr = grow(Hd, roots, rn, 'bob' if female else 'crop', female, seed=seed)
    HC = cards(Hd, HP, HD, layer, Lr, seed=seed, taper=0.25 if female else 0.55)
    log('hair', len(roots), 'strands', len(HC['tris']), 'tris')
    # AO 장: 몸 전체(속 채움) + 옷 겉 + 머리카락
    field = AOField([(ctx.P, ctx.T)], [(C['pos'], C['tris']), (HC['pos'], HC['tris'])])
    cao = field.ao(C['pos'], C['nrm'])
    # 복셀 계단 무늬를 없애려고 옷 면을 따라 AO를 고르게 편다(같은 자리 꼭짓점도 묶어서)
    from meshutil import neighbors
    key = np.round(C['pos'] * 2000).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    Tw = weld[C['tris']]
    nw = weld.max() + 1
    e, _ = neighbors(Tw, nw)
    a = np.zeros(nw)
    cnt = np.zeros(nw)
    np.add.at(a, weld, cao)
    np.add.at(cnt, weld, 1)
    a /= np.maximum(cnt, 1)
    deg = np.bincount(e[:, 0], minlength=nw).astype(float)
    for _ in range(12):
        s = np.zeros(nw)
        np.add.at(s, e[:, 0], a[e[:, 1]])
        a = a * 0.5 + 0.5 * np.where(deg > 0, s / np.maximum(deg, 1), a)
    cao = a[weld]
    # 덧붙인 부품(걷은 소매·접단·매듭)은 몸통 껍데기에 반쯤 묻혀 있어 AO가 과하다
    part = C.get('part')
    if part is not None:
        cao = np.where(part, np.maximum(cao, 0.72), cao)
    hao = field.ao(HC['pos'], HC['nrm'], strength=0.6)
    HC['col'][:, 3] *= np.clip(0.35 + 0.65 * hao, 0, 1)
    log('cloth ao')
    R = bake_skin(ctx, B, vis, skin_size, female, seed)
    yy, xx, t, bary, tp, tn = R['tex']
    # 피부 AO에는 머리카락을 넣지 않는다(실제 그림자는 게임 그림자 지도가 낸다. 앞머리가 얼굴에 얼룩을 남기지 않게)
    field_s = AOField([(ctx.P, ctx.T)], [(C['pos'], C['tris'])])
    sao = field_s.ao(tp, tn)
    R['A'][yy, xx, 3] = np.clip(sao, 0, 1)
    from atlas import dilate
    R['A'][..., 3] = dilate(R['A'][..., 3], R['mask'], 10)
    log('skin bake + ao')

    pk = Packer()
    bones = B['bones']
    names = [b[0] for b in bones]
    pk.meta['bones'] = [{'name': b[0], 'parent': names.index(b[1]) if b[1] else -1, 'pos': [round(float(x), 5) for x in b[2]]} for b in bones]
    # 피부
    vpos = R['vpos']
    P = ctx.P[vpos]
    Nn = vertex_normals(ctx.P, ctx.T)[vpos]
    si, sw = top4(B['GW'][vpos])
    TI = R['TI']
    morphs = {k: v[vpos] for k, v in B['morphs'].items()}
    pk.mesh('skin', 'skin', {'position': (P, 'f32'), 'normal': (Nn, 'i16n'), 'uv': (R['UV'], 'u16n'),
                             'skinIndex': (si, 'u8'), 'skinWeight': (sw, 'u8n')}, TI, morphs=morphs)
    # 옷
    var = cloth_color(C, L, seed)
    col = np.clip(var[:, None] * np.stack([cao, cao, cao], 1) ** 0.85, 0, 1.4) / 1.4
    ci, cw = top4(C['w'])
    pk.mesh('cloth', 'cloth', {'position': (C['pos'], 'f32'), 'normal': (C['nrm'], 'i16n'), 'color': (np.concatenate([col, cao[:, None]], 1), 'u8n'),
                               'aMat': (C['mat'][:, None], 'u8'), 'aEdge': (np.clip(C['edge'] / 0.03, 0, 1)[:, None], 'u8n'),
                               'skinIndex': (ci, 'u8'), 'skinWeight': (cw, 'u8n')}, C['tris'])
    # 속눈썹(눈 감기 표적 포함)
    lp, lu, lt, lm = [], [], [], {k: [] for k in B['morphs']}
    off = 0
    for l in LS:
        lp.append(ctx.P[l['vpos']])
        lu.append(l['uv'])
        lt.append(l['tris'] + off)
        for k in lm:
            lm[k].append(B['morphs'][k][l['vpos']])
        off += len(l['vpos'])
    lp = np.concatenate(lp)
    lt = np.concatenate(lt)
    head = names.index('head')
    pk.mesh('lashes', 'lash', {'position': (lp, 'f32'), 'normal': (vertex_normals(lp, lt), 'i16n'), 'uv': (np.concatenate(lu), 'f32'),
                               'skinIndex': (np.tile([head, 0, 0, 0], (len(lp), 1)), 'u8'), 'skinWeight': (np.tile([1.0, 0, 0, 0], (len(lp), 1)), 'u8n')},
            lt, morphs={k: np.concatenate(v) for k, v in lm.items()})
    # 눈알(머리 뼈에 붙임, 중심 기준 좌표)
    for e in E:
        pk.mesh('eye' + e['side'], 'eye', {'position': (e['pos'] - e['center'], 'f32'), 'normal': (e['nrm'], 'i16n'), 'uv': (e['uv'], 'f32')},
                e['tris'], bone='head', extra={'pivot': [round(float(x), 5) for x in e['center']]})
    hp = np.array(B['H']['head']) if 'head' in B['H'] else None
    headPos = np.array([b for b in bones if b[0] == 'head'][0][2])
    pk.mesh('hair', 'hair', {'position': (HC['pos'] - headPos, 'f32'), 'normal': (HC['nrm'], 'i16n'), 'uv': (HC['uv'], 'u16n'),
                             'color': (HC['col'], 'u8n'), 'aTan': (HC['tan'], 'i16n')}, HC['tris'], bone='head', extra={'origin': [float(x) for x in headPos]})
    pk.meta['textures'] = {'skinA': f'{name}-skinA.webp', 'skinB': f'{name}-skinB.webp', 'eye': 'eye.webp', 'lash': 'lash.png', 'hair': 'hair.webp'}
    Hh = B['H']
    knuck = np.mean([Hh[f'finger{f}-1.R'] for f in (2, 3, 4, 5)], 0)
    wrist = np.array(Hh['wrist.R'])
    gripR = (knuck - wrist) * 0.55 + np.array([0.0, -0.012, 0.0])
    gripR = knuck - wrist + (np.array([0.0, -0.02, 0.0]))
    pk.meta['extra'] = {'gripR': [round(float(x), 4) for x in gripR], 'female': female, 'hipsY': float(bones[0][2][1]), 'height': float(ctx.P[ctx.body][:, 1].max()),
                        'skinDensity': R['D'], 'gid': GID}
    pk.write(f'{OUT}/{name}')
    A8 = (np.clip(R['A'], 0, 1) * 255).astype(np.uint8)
    Image.fromarray(A8, 'RGBA').save(f'{OUT}/{name}-skinA.webp', quality=90, method=6)
    B8 = (np.clip(R['B'], 0, 1) * 255).astype(np.uint8)
    Image.fromarray(B8, 'RGBA').save(f'{OUT}/{name}-skinB.webp', lossless=True, method=6)
    eye_texture([e['iris_uv'] for e in E]).save(f'{OUT}/eye.webp', quality=92, method=6)
    lash_texture().save(f'{OUT}/lash.png', optimize=True)
    if True:
        hair_texture().save(f'{OUT}/hair.webp', quality=88, alpha_quality=100, method=6)
    from tiles import tiles
    if not os.path.exists(f'{OUT}/detail.webp'):
        tiles().save(f'{OUT}/detail.webp', quality=90, method=6)
    log('done', pk.size // 1024, 'KB')

if __name__ == '__main__':
    which = sys.argv[1:] or ['m', 'f']
    if 'm' in which:
        forge('pioneer_m', MALE, False)
    if 'f' in which:
        forge('pioneer_f', FEMALE, True, seed=2)
