// 개척자 모형(v0.4.3): 거리장으로 깎은 이음매 없는 몸(스킨드 메시) + 얼굴·머리카락(머리 뼈에 붙은 고해상도 메시) + 배낭.
// 옷은 몸 부분을 부풀린 겹이다: 셔츠·조끼·바지·장화·허리띠·팔토시·장갑·목도리(접은 두건). 키 약 1.76m, 원점은 발바닥, 앞은 +z.
// 뼈 이름과 축은 예전 관절 모형과 같다(엉덩이·허리·목·머리·어깨·팔꿈치·손·허벅지·무릎·발). 동작 코드는 그대로 쓴다.

import * as THREE from 'three';
import { P, merge } from './build.js';
import { noise3 } from './sdf.js';
import { SKIN, HAIR, SCARF, IRIS, L, SURF, BONE, BONE_ORDER, PARENT, FACE, HEAD_DROP, buildBase } from './actor-shape.js';

// 모양은 한 번만 만들어 모든 캐릭터가 나눠 쓴다. 로딩 첫머리에 워커로 미리 만들어 둔다(prepareActorBase)
let BASE = null;
let pending = null;
export function prepareActorBase() {
  if (BASE) return Promise.resolve(BASE);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    let w;
    try {
      w = new Worker(new URL('./actor-worker.js', import.meta.url), { type: 'module' });
    } catch {
      BASE = buildBase();
      resolve(BASE);
      return;
    }
    w.onmessage = (e) => {
      BASE = e.data;
      w.terminate();
      resolve(BASE);
    };
    w.onerror = () => {
      w.terminate();
      BASE = BASE || buildBase();
      resolve(BASE);
    };
  });
  return pending;
}

function geometry(m, layerOf, palette, offset, extra = null, layer2 = null, blend = null) {
  const g = new THREE.BufferGeometry();
  const P2 = new Float32Array(m.positions);
  if (offset) {
    for (let i = 0; i < m.count; i++) {
      P2[i * 3] -= offset[0];
      P2[i * 3 + 1] -= offset[1];
      P2[i * 3 + 2] -= offset[2];
    }
  }
  const col = new Float32Array(m.count * 3);
  const surf = new Float32Array(m.count * 2);
  const c = new THREE.Color();
  for (let i = 0; i < m.count; i++) {
    const x = m.positions[i * 3];
    const y = m.positions[i * 3 + 1];
    const z = m.positions[i * 3 + 2];
    const l = layerOf[i];
    c.copy(palette[l] || palette[L.skin]);
    if (blend && blend[i]) c.lerp(palette[layer2[i]] || palette[L.skin], blend[i] / 255);
    // 바탕 얼룩(천 결·가죽 닳음)
    const n = noise3(x * 40, y * 40, z * 40);
    c.multiplyScalar(0.92 + 0.16 * n);
    if (l === L.skin && extra?.face) {
      // 볼에 혈색, 코끝은 살짝 붉게
      const blush = Math.max(0, 1 - Math.hypot(Math.abs(x) - 0.045, (y - 1.69) * 1.4, z - 0.08) / 0.03);
      const nose = Math.max(0, 1 - Math.hypot(x, y - 1.7, z - 0.11) / 0.02);
      c.lerp(palette.blush, Math.min(0.45, blush * 0.35 + nose * 0.25));
    }
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    const [r, mt] = SURF[l] || [0.8, 0];
    surf[i * 2] = r;
    surf[i * 2 + 1] = mt;
  }
  g.setAttribute('position', new THREE.BufferAttribute(P2, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m.normals), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

// 겹마다 거칠기·금속성을 꼭짓점 속성(aSurf)으로 받는 재질
function bodyMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSurf;\nvarying vec2 vSurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSurf;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;');
  };
  m.customProgramCacheKey = () => 'actor-body';
  return m;
}

// 얼굴 그림(v0.4.3): 눈·눈썹·입·볼 혈색을 얼굴 판에 그린다. 판 좌표는 FACE(머리 배율 적용 전 m)
const faceTex = new Map();
function faceTexture(iris, brow) {
  const key = iris + brow;
  if (faceTex.has(key)) return faceTex.get(key);
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const W = FACE.x1 - FACE.x0;
  const H = FACE.y1 - FACE.y0;
  const X = (x) => ((x - FACE.x0) / W) * S;
  const Y = (y) => (1 - (y - FACE.y0) / H) * S;
  const px = (m) => (m / W) * S;
  g.clearRect(0, 0, S, S);
  // 볼 혈색
  for (const sx of [-1, 1]) {
    const cx = X(sx * 0.046);
    const cy = Y(1.697);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, px(0.016));
    gr.addColorStop(0, 'rgba(214,110,92,0.22)');
    gr.addColorStop(1, 'rgba(214,110,92,0)');
    g.fillStyle = gr;
    g.fillRect(cx - 60, cy - 60, 120, 120);
  }
  for (const sx of [-1, 1]) {
    const cx = X(sx * 0.031);
    const cy = Y(1.726);
    const w = px(0.03) / 2;
    const h = px(0.0178) / 2;
    const inner = cx - sx * w;
    const outer = cx + sx * w;
    const almond = () => {
      g.beginPath();
      g.moveTo(inner, cy + h * 0.15);
      g.bezierCurveTo(cx - sx * w * 0.5, cy - h * 1.25, cx + sx * w * 0.55, cy - h * 1.3, outer, cy - h * 0.1);
      g.bezierCurveTo(cx + sx * w * 0.5, cy + h * 1.05, cx - sx * w * 0.5, cy + h * 1.0, inner, cy + h * 0.15);
      g.closePath();
    };
    // 흰자
    almond();
    g.fillStyle = '#f2ebe0';
    g.fill();
    // 홍채·동공·빛
    g.save();
    almond();
    g.clip();
    const ir = h * 1.05;
    const ix = cx + sx * w * 0.04;
    const iy = cy - h * 0.12;
    const gr = g.createRadialGradient(ix, iy, ir * 0.2, ix, iy, ir);
    gr.addColorStop(0, iris);
    gr.addColorStop(0.75, iris);
    gr.addColorStop(1, '#1c130d');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(ix, iy, ir, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d0907';
    g.beginPath();
    g.arc(ix, iy, ir * 0.45, 0, Math.PI * 2);
    g.fill();
    // 윗눈꺼풀 그늘
    const sh = g.createLinearGradient(0, cy - h * 1.3, 0, cy - h * 0.2);
    sh.addColorStop(0, 'rgba(60,35,25,0.55)');
    sh.addColorStop(1, 'rgba(60,35,25,0)');
    g.fillStyle = sh;
    g.fillRect(cx - w * 1.2, cy - h * 1.5, w * 2.4, h * 1.4);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.arc(ix - ir * 0.35, iy - ir * 0.38, ir * 0.22, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(ix + ir * 0.3, iy + ir * 0.3, ir * 0.1, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 윗눈꺼풀 선(속눈썹)과 바깥 끝 살짝 올린 꼬리, 아래 눈꺼풀
    g.strokeStyle = '#24170f';
    g.lineCap = 'round';
    g.lineWidth = px(0.0017);
    g.beginPath();
    g.moveTo(inner, cy + h * 0.1);
    g.bezierCurveTo(cx - sx * w * 0.5, cy - h * 1.25, cx + sx * w * 0.55, cy - h * 1.3, outer, cy - h * 0.1);
    g.lineTo(outer + sx * w * 0.16, cy - h * 0.38);
    g.stroke();
    g.strokeStyle = 'rgba(110,70,55,0.55)';
    g.lineWidth = px(0.0006);
    g.beginPath();
    g.moveTo(inner + sx * w * 0.15, cy + h * 0.45);
    g.bezierCurveTo(cx - sx * w * 0.4, cy + h * 1.05, cx + sx * w * 0.5, cy + h * 1.0, outer - sx * w * 0.05, cy + h * 0.1);
    g.stroke();
    // 쌍꺼풀 선(옅게)
    g.strokeStyle = 'rgba(120,70,55,0.22)';
    g.lineWidth = px(0.0007);
    g.beginPath();
    g.moveTo(cx - sx * w * 0.6, cy - h * 1.35);
    g.quadraticCurveTo(cx + sx * w * 0.1, cy - h * 1.9, cx + sx * w * 0.9, cy - h * 1.05);
    g.stroke();
    // 눈썹: 안쪽이 굵고 바깥으로 가늘어진다
    const bx0 = X(sx * 0.016);
    const bx1 = X(sx * 0.049);
    const by0 = Y(1.7515);
    const by1 = Y(1.7505);
    const steps = 18;
    for (let k = 0; k < steps; k++) {
      const t = k / (steps - 1);
      const bx = bx0 + (bx1 - bx0) * t;
      const by = by0 + (by1 - by0) * t - Math.sin(t * Math.PI) * px(0.0028);
      g.fillStyle = brow;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.ellipse(bx, by, px(0.0018), px(0.0026) * (1 - t * 0.55), sx * 0.15, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  // 입: 살짝 웃는 선과 아랫입술 그늘
  const mx = X(0);
  const my = Y(1.6625);
  const mw = px(0.0115);
  g.strokeStyle = '#7a3c34';
  g.lineWidth = px(0.0011);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(mx - mw, my - px(0.0008));
  g.quadraticCurveTo(mx, my + px(0.0026), mx + mw, my - px(0.0008));
  g.stroke();
  const lg = g.createRadialGradient(mx, my + px(0.0045), 0, mx, my + px(0.0045), px(0.009));
  lg.addColorStop(0, 'rgba(176,86,76,0.3)');
  lg.addColorStop(1, 'rgba(176,86,76,0)');
  g.fillStyle = lg;
  g.fillRect(mx - 60, my - 20, 120, 60);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  faceTex.set(key, t);
  return t;
}

export function makeActorModel({ tunic = 0x2f7f78, trousers = 0x3e4452, seed = 1 } = {}) {
  if (!BASE) BASE = buildBase();
  const base = BASE;
  const col = (hex) => new THREE.Color(hex);
  const skinC = col(SKIN[seed % SKIN.length]);
  const hairC = col(HAIR[(seed >> 1) % HAIR.length]);
  const palette = {
    [L.skin]: skinC, [L.shirt]: col(0xd8cbb0), [L.vest]: col(tunic), [L.trousers]: col(trousers), [L.boots]: col(0x4a3122),
    [L.sole]: col(0x2a211b), [L.belt]: col(0x6b4a2e), [L.metal]: col(0xb9a27a), [L.bracer]: col(0x5a3d26), [L.glove]: skinC.clone().multiplyScalar(0.93),
    [L.scarf]: col(SCARF[seed % SCARF.length]), [L.hair]: hairC, [L.lips]: skinC.clone().lerp(col(0xa2584e), 0.45),
    [L.canvas]: col(0xa39071), [L.wool]: col(0x7d4a3a),
    blush: skinC.clone().lerp(col(0xd0705a), 0.6),
  };
  const mat = bodyMaterial();

  // 뼈(예전 관절과 같은 이름·위치 관계)
  const root = new THREE.Group();
  const bones = {};
  for (const k of BONE_ORDER) {
    const b = new THREE.Bone();
    b.name = k;
    bones[k] = b;
  }
  for (const k of BONE_ORDER) {
    const p = BONE[k];
    const par = PARENT[k];
    const pp = par ? BONE[par] : [0, 0, 0];
    bones[k].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    (par ? bones[par] : root).add(bones[k]);
  }
  const bodyGeo = geometry(base.body, base.bl, palette, null, null, base.bl2, base.blend);
  bodyGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(base.skinIdx, 4));
  bodyGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(base.skinW, 4));
  const body = new THREE.SkinnedMesh(bodyGeo, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  root.add(body);
  root.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(BONE_ORDER.map((k) => bones[k])));

  // 머리(얼굴), 머리카락 껍데기, 얼굴 그림판
  const headOff = [BONE.head[0], BONE.head[1] + HEAD_DROP, BONE.head[2]];
  const head = new THREE.Mesh(geometry(base.head, base.hl, palette, headOff, { face: true }), mat);
  head.castShadow = true;
  head.receiveShadow = true;
  bones.head.add(head);
  const hair = new THREE.Mesh(geometry(base.hair, base.hrl, palette, headOff), mat);
  hair.castShadow = true;
  hair.receiveShadow = true;
  bones.head.add(hair);
  const fg = new THREE.BufferGeometry();
  const fp = new Float32Array(base.face.positions);
  for (let i = 0; i < fp.length; i += 3) {
    fp[i + 1] -= headOff[1];
  }
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  fg.setAttribute('uv', new THREE.BufferAttribute(base.face.uvs, 2));
  fg.setIndex(new THREE.BufferAttribute(base.face.indices, 1));
  fg.computeVertexNormals();
  const browC = '#' + hairC.clone().multiplyScalar(0.7).getHexString(THREE.SRGBColorSpace);
  const face = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({
    map: faceTexture(IRIS[seed % IRIS.length], browC), transparent: true, depthWrite: false, roughness: 0.55,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }));
  face.renderOrder = 1;
  bones.head.add(face);
  // 배낭
  const pack = new THREE.Mesh(geometry(base.pack, base.pl, palette, BONE.spine), mat);
  pack.castShadow = true;
  pack.receiveShadow = true;
  bones.spine.add(pack);

  const M = {
    wood: new THREE.MeshStandardMaterial({ color: 0x6e4c30, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.32, metalness: 0.92 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc27a4a, roughness: 0.34, metalness: 0.9 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4b3020, roughness: 0.62 }),
    stoneM: new THREE.MeshStandardMaterial({ color: 0x7d7870, roughness: 0.9 }),
    body: mat,
  };
  const mesh = (geo, m) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };
  const armL = { sh: bones.shL, el: bones.elL, hand: bones.handL };
  const armR = { sh: bones.shR, el: bones.elR, hand: bones.handR };
  const legL = { th: bones.thL, kn: bones.knL, ft: bones.ftL };
  const legR = { th: bones.thR, kn: bones.knR, ft: bones.ftR };

  // 도구(오른손)
  const tools = {};
  const handle = (len) => P(new THREE.CylinderGeometry(0.018, 0.022, len, 8), 0xffffff, { y: len / 2 - 0.08 });
  tools.logging = new THREE.Group();
  tools.logging.add(mesh(merge([handle(0.72)]), M.wood));
  tools.logging.add(mesh(merge([P(new THREE.BoxGeometry(0.03, 0.11, 0.17), 0xffffff, { y: 0.58, z: 0.07 }), P(new THREE.BoxGeometry(0.012, 0.16, 0.06), 0xffffff, { y: 0.58, z: 0.17 })]), M.metal));
  tools.mining = new THREE.Group();
  tools.mining.add(mesh(merge([handle(0.75)]), M.wood));
  tools.mining.add(mesh(merge([P(new THREE.CylinderGeometry(0.018, 0.03, 0.55, 6), 0xffffff, { y: 0.62, rx: Math.PI / 2, sz: 1 }), P(new THREE.BoxGeometry(0.06, 0.07, 0.07), 0xffffff, { y: 0.62 })]), M.metal));
  tools.harvesting = new THREE.Group();
  tools.harvesting.add(mesh(merge([handle(0.36)]), M.wood));
  tools.harvesting.add(mesh(merge([P(new THREE.TorusGeometry(0.15, 0.012, 4, 14, Math.PI * 1.15), 0xffffff, { y: 0.3, z: 0.12, ry: Math.PI / 2, rz: 0.3 })]), M.metal));
  for (const t of Object.values(tools)) {
    t.visible = false;
    t.rotation.x = Math.PI / 2;
    t.position.set(0, -0.06, 0.02);
    armR.hand.add(t);
  }
  // 무기(v0.3): 돌 몽둥이, 한손검·전투 도끼·창(구리·철)
  const weapons = {};
  const w = (key, list) => {
    const g = new THREE.Group();
    for (const [geo, m] of list) g.add(mesh(merge(geo), m));
    g.visible = false;
    g.rotation.x = Math.PI / 2;
    g.position.set(0, -0.06, 0.02);
    armR.hand.add(g);
    weapons[key] = g;
  };
  w('club_0', [
    [[P(new THREE.CylinderGeometry(0.03, 0.022, 0.62, 8), 0xffffff, { y: 0.23 })], M.wood],
    [[P(new THREE.DodecahedronGeometry(0.085, 0), 0xffffff, { y: 0.55, sx: 1.1, sz: 0.9 })], M.stoneM],
  ]);
  for (const [tier, metal] of [[1, M.copper], [2, M.metal]]) {
    w(`sword_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), 0xffffff, { y: 0.0 })], M.leather],
      [[P(new THREE.BoxGeometry(0.17, 0.025, 0.04), 0xffffff, { y: 0.09 }), P(new THREE.BoxGeometry(0.05, 0.6, 0.012), 0xffffff, { y: 0.4 }), P(new THREE.ConeGeometry(0.025, 0.09, 4), 0xffffff, { y: 0.74, sz: 0.25 })], metal],
    ]);
    w(`axe_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.022, 0.026, 0.86, 8), 0xffffff, { y: 0.32 })], M.wood],
      [[P(new THREE.BoxGeometry(0.03, 0.12, 0.1), 0xffffff, { y: 0.68, z: 0.05 }), P(new THREE.CylinderGeometry(0.15, 0.15, 0.022, 14, 1, false, 0, Math.PI), 0xffffff, { y: 0.68, z: 0.1, rz: Math.PI / 2, ry: Math.PI / 2 })], metal],
    ]);
    w(`spear_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.018, 0.022, 1.6, 8), 0xffffff, { y: 0.45 })], M.wood],
      [[P(new THREE.ConeGeometry(0.045, 0.26, 4), 0xffffff, { y: 1.37, sz: 0.3 }), P(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 8), 0xffffff, { y: 1.23 })], metal],
    ]);
  }
  root.rotation.order = 'YXZ';
  return {
    root, hips: bones.hips, spine: bones.spine, neck: bones.neck, head: bones.head,
    armL, armR, legL, legR, tools, weapons, materials: M, buildMs: base.ms,
    tris: { body: base.body.indices.length / 3, head: base.head.indices.length / 3, hair: base.hair.indices.length / 3, pack: base.pack.indices.length / 3 },
  };
}
