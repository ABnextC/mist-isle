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

def piece_color(g, seed=0):
    """조각 꼭짓점 색 변화(낡음·바램). 장화는 앞코·뒤꿈치가 밝고 밑단이 어둡다"""
    p = g['pos']
    mat = g['mat'].astype(int)
    v = 1 + 0.10 * (fbm(p, 9, 3, seed) - 0.5) + 0.05 * (fbm(p, 40, 2, seed + 3) - 0.5)
    y = p[:, 1]
    boot = mat == GID['boots']
    v = np.where(boot, v * (1 + 0.18 * np.clip((p[:, 2] - 0.08) / 0.08, 0, 1)) * (1 - 0.25 * np.clip((0.06 - y) / 0.04, 0, 1)), v)
    nrm = vertex_normals(g['pos'], g['tris'])
    up = np.clip(nrm[:, 1], 0, 1)
    v = v * (1 + 0.08 * up)
    return v


def smooth_ao(g, ao):
    """복셀 계단 무늬를 없애려고 같은 자리 꼭짓점을 묶어 면을 따라 고르게 편다"""
    from meshutil import neighbors
    key = np.round(g['pos'] * 2000).astype(np.int64)
    _, weld = np.unique(key, axis=0, return_inverse=True)
    weld = weld.ravel()
    Tw = weld[g['tris']]
    nw = weld.max() + 1
    e, _ = neighbors(Tw, nw)
    a = np.zeros(nw)
    cnt = np.zeros(nw)
    np.add.at(a, weld, ao)
    np.add.at(cnt, weld, 1)
    a /= np.maximum(cnt, 1)
    deg = np.bincount(e[:, 0], minlength=nw).astype(float)
    for _ in range(10):
        s_ = np.zeros(nw)
        np.add.at(s_, e[:, 0], a[e[:, 1]])
        a = a * 0.5 + 0.5 * np.where(deg > 0, s_ / np.maximum(deg, 1), a)
    out = a[weld]
    return np.where(g['part'] > 0.5, np.maximum(out, 0.7), out)


def piece_attrs(g, ao, seed):
    var = piece_color(g, seed)
    col = np.clip(var[:, None] * np.stack([ao, ao, ao], 1) ** 0.85, 0, 1.4) / 1.4
    ci, cw = top4(g['w'])
    return {'position': (g['pos'], 'f32'), 'normal': (vertex_normals(g['pos'], g['tris']), 'i16n'),
            'color': (np.concatenate([col, ao[:, None]], 1), 'u8n'), 'aMat': (g['mat'][:, None], 'u8'),
            'aEdge': (np.clip(g['edge'] / 0.25, 0, 1)[:, None], 'u16n'), 'aRim': (((g['rimc'] % 8.0) / 8.0)[:, None], 'u16n'),
            'skinIndex': (ci, 'u8'), 'skinWeight': (cw, 'u8n')}


def skin_regions(ctx, L, HF, female, T):
    """보이는 피부 면을 묶음으로: 0 늘 보임, 1 아래팔(긴 소매가 덮음), 2 정수리·귀(머리 장비가 덮음)"""
    P = ctx.P
    hv = ctx.w('head') > 0.5
    # 가장 넓은 얼굴 트임(두건)보다 1.2cm 넓게 잡은 바깥만 정수리로 본다
    d = P - np.array([0, 0, HF['zc']])
    az = np.arctan2(d[:, 0], d[:, 2])
    r = np.linalg.norm(d[:, [0, 2]], axis=1)
    u = np.abs(az) * r / (0.085 + 0.012)
    y_lo, y_hi = HF['chin'] - 0.025, HF['eye_y'] + 0.075
    v = np.abs(P[:, 1] - 0.5 * (y_lo + y_hi)) / (0.5 * (y_hi - y_lo))
    inside_face = ((u ** 3 + v ** 3) < 1.0) & (d[:, 2] > -0.02)
    scalp = hv & ~inside_face & (P[:, 1] > HF['chin'] + 0.01)
    fore = (L.w_arm > 0.5) & (L.s_arm > 1.36) & (L.s_arm < 1.84) & (ctx.w('handL', 'handR') < 0.3)
    reg = np.zeros(len(T), np.int64)
    reg[fore[T].all(1)] = 1
    reg[scalp[T].all(1)] = 2
    return reg


def forge(name, preset, female, skin_size=1024, seed=1):
    import pieces as PCS
    t0 = time.time()
    log = lambda *a: print(f'[{name} {time.time() - t0:5.1f}s]', *a, flush=True)
    B = make_body(preset, sole=SOLE)
    ctx = Ctx(B)
    L = Land(ctx)
    HF = PCS.head_frame(ctx, B)
    PCS.use_ctx(ctx)
    PC = PCS.base_pieces(ctx, L, female, SOLE)
    for cls in ('robe', 'light', 'heavy'):
        PC['chest_' + cls] = getattr(PCS, 'chest_' + cls)(ctx, L, female)
        PC['legs_' + cls] = getattr(PCS, 'legs_' + cls)(ctx, L, female)
        PC['head_' + cls] = getattr(PCS, 'head_' + cls)(ctx, L, female, B=B)
    log('pieces', {k: len(v['tris']) for k, v in PC.items()})
    Fd = fields(ctx, L, female)
    vis = visible_faces(ctx, Fd)
    E = eyes(B)
    LS = lashes(B)
    Hd = Head(ctx, B)
    roots, rn = scalp_roots(ctx, B, 1000 if female else 720, female, seed=seed, min_dist=0.0048)
    HP, HD, layer, Lr = grow(Hd, roots, rn, 'bob' if female else 'crop', female, seed=seed)
    HC = cards(Hd, HP, HD, layer, Lr, seed=seed, taper=0.25 if female else 0.55)
    log('hair', len(roots), 'strands', len(HC['tris']), 'tris')
    # AO: 기본 옷 한 벌(머리카락 포함), 종류마다 한 벌(머리 장비가 머리카락 대신)
    sets = {'base': ['chest_base', 'legs_base', 'boots'], 'robe': ['chest_robe', 'legs_robe', 'head_robe', 'boots'],
            'light': ['chest_light', 'legs_light', 'head_light', 'boots'], 'heavy': ['chest_heavy', 'legs_heavy', 'head_heavy', 'boots']}
    AO = {}
    for set_name, names in sets.items():
        shells_ = [(PC[k]['pos'], PC[k]['tris']) for k in names]
        if set_name == 'base':
            shells_.append((HC['pos'], HC['tris']))
        field = AOField([(ctx.P, ctx.T)], shells_)
        for k in names:
            if k in AO:
                continue
            nrm = vertex_normals(PC[k]['pos'], PC[k]['tris'])
            AO[k] = smooth_ao(PC[k], field.ao(PC[k]['pos'], nrm))
        if set_name == 'base':
            hao = field.ao(HC['pos'], HC['nrm'], strength=0.6)
            HC['col'][:, 3] *= np.clip(0.35 + 0.65 * hao, 0, 1)
    log('ao')
    R = bake_skin(ctx, B, vis, skin_size, female, seed)
    yy, xx, t, bary, tp, tn = R['tex']
    field_s = AOField([(ctx.P, ctx.T)], [(PC[k]['pos'], PC[k]['tris']) for k in sets['base']])
    sao = field_s.ao(tp, tn)
    R['A'][yy, xx, 3] = np.clip(sao, 0, 1)
    from atlas import dilate
    R['A'][..., 3] = dilate(R['A'][..., 3], R['mask'], 10)
    log('skin bake + ao')

    pk = Packer()
    bones = B['bones']
    names = [b[0] for b in bones]
    pk.meta['bones'] = [{'name': b[0], 'parent': names.index(b[1]) if b[1] else -1, 'pos': [round(float(x), 5) for x in b[2]]} for b in bones]
    # 피부: 보이는 면을 묶음(늘·아래팔·정수리)으로 정렬
    vpos = R['vpos']
    P = ctx.P[vpos]
    Nn = vertex_normals(ctx.P, ctx.T)[vpos]
    si, sw = top4(B['GW'][vpos])
    TI = R['TI']
    reg = skin_regions(ctx, L, HF, female, ctx.T[vis])
    order = np.argsort(reg, kind='stable')
    TI = TI[order]
    reg = reg[order]
    groups = []
    for rid, rname in enumerate(('core', 'forearm', 'scalp')):
        m = np.nonzero(reg == rid)[0]
        if len(m):
            groups.append([int(m[0]) * 3, int(len(m)) * 3, rname])
    morphs = {k: v[vpos] for k, v in B['morphs'].items()}
    pk.mesh('skin', 'skin', {'position': (P, 'f32'), 'normal': (Nn, 'i16n'), 'uv': (R['UV'], 'u16n'),
                             'skinIndex': (si, 'u8'), 'skinWeight': (sw, 'u8n')}, TI, morphs=morphs, extra={'groups': groups})
    # 기본 옷 조각
    for k in sets['base']:
        pk.mesh(k, 'cloth', piece_attrs(PC[k], AO[k], seed), PC[k]['tris'])
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
    for e in E:
        pk.mesh('eye' + e['side'], 'eye', {'position': (e['pos'] - e['center'], 'f32'), 'normal': (e['nrm'], 'i16n'), 'uv': (e['uv'], 'f32')},
                e['tris'], bone='head', extra={'pivot': [round(float(x), 5) for x in e['center']]})
    headPos = np.array([b for b in bones if b[0] == 'head'][0][2])
    pk.mesh('hair', 'hair', {'position': (HC['pos'] - headPos, 'f32'), 'normal': (HC['nrm'], 'i16n'), 'uv': (HC['uv'], 'u16n'),
                             'color': (HC['col'], 'u8n'), 'aTan': (HC['tan'], 'i16n')}, HC['tris'], bone='head', extra={'origin': [float(x) for x in headPos]})
    pk.meta['textures'] = {'skinA': f'{name}-skinA.webp', 'skinB': f'{name}-skinB.webp', 'eye': 'eye.webp', 'lash': 'lash.png', 'hair': 'hair.webp'}
    Hh = B['H']
    knuck = np.mean([Hh[f'finger{f}-1.R'] for f in (2, 3, 4, 5)], 0)
    wrist = np.array(Hh['wrist.R'])
    gripR = knuck - wrist + (np.array([0.0, -0.02, 0.0]))
    pk.meta['extra'] = {'gripR': [round(float(x), 4) for x in gripR], 'female': female, 'hipsY': float(bones[0][2][1]), 'height': float(ctx.P[ctx.body][:, 1].max()),
                        'skinDensity': R['D'], 'gid': PCS.SLOT, 'classes': {c: f'{name}-{c}' for c in ('robe', 'light', 'heavy')}}
    pk.write(f'{OUT}/{name}')
    log('main pack', pk.size // 1024, 'KB')
    # 종류별 묶음(입을 때 읽는다)
    for cls in ('robe', 'light', 'heavy'):
        pc = Packer()
        pc.meta['extra'] = {'class': cls}
        for part_name in ('chest', 'legs', 'head'):
            k = f'{part_name}_{cls}'
            pc.mesh(k, 'cloth', piece_attrs(PC[k], AO[k], seed), PC[k]['tris'])
        pc.write(f'{OUT}/{name}-{cls}')
        log(cls, 'pack', pc.size // 1024, 'KB')
    A8 = (np.clip(R['A'], 0, 1) * 255).astype(np.uint8)
    Image.fromarray(A8, 'RGBA').save(f'{OUT}/{name}-skinA.webp', quality=90, method=6)
    B8 = (np.clip(R['B'], 0, 1) * 255).astype(np.uint8)
    Image.fromarray(B8, 'RGBA').save(f'{OUT}/{name}-skinB.webp', lossless=True, method=6)
    eye_texture([e['iris_uv'] for e in E]).save(f'{OUT}/eye.webp', quality=92, method=6)
    lash_texture().save(f'{OUT}/lash.png', optimize=True)
    hair_texture().save(f'{OUT}/hair.webp', quality=88, alpha_quality=100, method=6)
    from tiles import tiles
    if not os.path.exists(f'{OUT}/detail.webp'):
        tiles().save(f'{OUT}/detail.webp', quality=90, method=6)
    log('done')

if __name__ == '__main__':
    which = sys.argv[1:] or ['m', 'f']
    if 'm' in which:
        forge('pioneer_m', MALE, False)
    if 'f' in which:
        forge('pioneer_f', FEMALE, True, seed=2)
