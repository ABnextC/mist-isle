// 개척자 모형(v0.5): MakeHuman(CC0) 실제 사람 몸을 바탕으로 파이썬 생성기(tools/charforge)가 옷·피부 질감·눈·속눈썹·머리카락을 빚은 묶음.
// 뼈는 축이 세계축과 같은 19개(엉덩이·허리·가슴·목·머리·쇄골·어깨·팔꿈치·손·허벅지·무릎·발). R은 해부학적 오른손(-x, 도구 쥐는 손).
// 동작 코드는 예전 관절 이름을 그대로 쓴다(actors-view의 pose가 좌우를 해부학 기준으로 맞춘다).

import * as THREE from 'three';
import { P, merge } from './build.js';
import { loadPack } from './charpack.js';
import { skinMaterial, clothMaterial, eyeMaterial, lashMaterial, hairMaterial } from './charmat.js';

const BASE_URL = new URL('../../assets/char/', import.meta.url).href;
const BODIES = { m: 'pioneer_m', f: 'pioneer_f' };

// 피부 톤(배수), 머리색(선형), 눈동자, 목수건
export const SKIN_TONES = [[1, 1, 1], [0.93, 0.86, 0.8], [1.03, 1.0, 0.97], [0.78, 0.66, 0.56]];
export const HAIR_COLORS = [[0.05, 0.034, 0.024], [0.13, 0.07, 0.035], [0.022, 0.018, 0.016], [0.26, 0.15, 0.07], [0.09, 0.055, 0.03]];
export const IRIS_COLORS = [[0.3, 0.18, 0.1], [0.2, 0.3, 0.38], [0.22, 0.28, 0.15], [0.35, 0.23, 0.12]];
const SCARVES = [0xa8432e, 0xc08a2a, 0x3e6a8a, 0x6a3a6a, 0x8a3a3a];

let BASE = null;
let pending = null;
const texLoader = () => {
  const l = new THREE.ImageBitmapLoader();
  l.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  return l;
};
function loadTex(url, srgb) {
  return new Promise((res, rej) => {
    texLoader().load(url, (bmp) => {
      const t = new THREE.Texture(bmp);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      t.needsUpdate = true;
      res(t);
    }, undefined, rej);
  });
}

export function prepareActorBase() {
  if (BASE) return Promise.resolve(BASE);
  if (pending) return pending;
  pending = (async () => {
    const t0 = performance.now();
    const out = { bodies: {} };
    const shared = await Promise.all([loadTex(BASE_URL + 'eye.webp', true), loadTex(BASE_URL + 'lash.png', true), loadTex(BASE_URL + 'detail.webp', false)]);
    const [eye, lash, detail] = shared;
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    out.tex = { eye, lash, detail };
    await Promise.all(Object.entries(BODIES).map(async ([k, id]) => {
      let pk;
      try {
        pk = await loadPack(BASE_URL + id);
      } catch (e) {
        console.warn('캐릭터 묶음을 못 읽음', id, e);
        return;
      }
      const T = pk.meta.textures;
      const [A, B] = await Promise.all([loadTex(BASE_URL + T.skinA, true), loadTex(BASE_URL + T.skinB, false)]);
      let hair = null;
      if (T.hair) hair = await loadTex(BASE_URL + T.hair, false);
      out.bodies[k] = { pk, A, B, hair };
    }));
    out.ms = Math.round(performance.now() - t0);
    BASE = out;
    return out;
  })();
  return pending;
}

const c3 = (a) => new THREE.Color(a[0], a[1], a[2]);

export function makeActorModel({ tunic = 0x2f7f78, trousers = 0x3e4452, seed = 1, body = null } = {}) {
  if (!BASE) throw new Error('prepareActorBase()를 먼저 기다려야 한다');
  const kind = body || (seed % 3 === 1 ? 'f' : 'm');
  const B = BASE.bodies[kind] || BASE.bodies.m;
  const pk = B.pk;
  const meta = pk.meta;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  // 뼈: 세계축 정렬, 위치만 부모 기준
  const bones = meta.bones.map((b) => {
    const o = new THREE.Bone();
    o.name = b.name;
    return o;
  });
  meta.bones.forEach((b, i) => {
    const pp = b.parent >= 0 ? meta.bones[b.parent].pos : [0, 0, 0];
    bones[i].position.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2]);
    (b.parent >= 0 ? bones[b.parent] : root).add(bones[i]);
  });
  const by = Object.fromEntries(meta.bones.map((b, i) => [b.name, bones[i]]));
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  const tone = c3(SKIN_TONES[(seed * 7) % SKIN_TONES.length]);
  const hairC = c3(HAIR_COLORS[(seed * 3 + 1) % HAIR_COLORS.length]);
  const skinM = skinMaterial(B.A, B.B);
  skinM.userData.u.uTone.value.copy(tone);
  skinM.userData.u.uHair.value.copy(hairC);
  const clothM = clothMaterial(BASE.tex.detail);
  const tints = clothM.userData.u.uTint.value;
  const lin = (hex) => new THREE.Color(hex);
  const set = (i, c) => tints[i].copy(c);
  set(0, lin(0xd9cdb4));
  set(1, lin(tunic));
  set(2, lin(trousers));
  set(3, lin(0x6a4128));
  set(4, lin(0x5a3a22));
  set(5, lin(SCARVES[seed % SCARVES.length]));
  set(6, lin(0x4a3020));
  set(7, lin(0x9a8a6a));
  set(8, lin(0xc8a868));
  set(9, lin(0x2a221c));
  set(10, lin(0x3e2a1c));
  const eyeM = eyeMaterial(BASE.tex.eye);
  eyeM.userData.u.uIris.value.copy(c3(IRIS_COLORS[(seed * 5 + 2) % IRIS_COLORS.length]));
  const lashM = lashMaterial(BASE.tex.lash);

  const skinned = [];
  const add = (key, mat, parent) => {
    const m = pk.meshes[key];
    if (!m) return null;
    let o;
    if (m.geometry.attributes.skinIndex) {
      o = new THREE.SkinnedMesh(m.geometry, mat);
      root.add(o);
      o.bind(skeleton, new THREE.Matrix4());
      // 뼈 변환으로 다시 재지 않게 넉넉한 경계 구(팔 들기·구르기까지 덮는다)
      o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.45);
      o.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.6, -1.2), new THREE.Vector3(1.2, 2.5, 1.2));
      skinned.push(o);
    } else {
      o = new THREE.Mesh(m.geometry, mat);
      (parent || root).add(o);
    }
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };
  const skin = add('skin', skinM);
  const cloth = add('cloth', clothM);
  const lashes = add('lashes', lashM);
  lashes.castShadow = false;
  // 눈: 머리 뼈 아래 중심점(피벗)에서 돈다
  const headPos = meta.bones[meta.bones.findIndex((b) => b.name === 'head')].pos;
  const eyes = [];
  for (const k of ['eyeL', 'eyeR']) {
    const m = pk.meshes[k];
    if (!m) continue;
    const piv = new THREE.Object3D();
    const pv = m.info.pivot;
    piv.position.set(pv[0] - headPos[0], pv[1] - headPos[1], pv[2] - headPos[2]);
    by.head.add(piv);
    const o = new THREE.Mesh(m.geometry, eyeM);
    o.castShadow = false;
    o.receiveShadow = true;
    piv.add(o);
    eyes.push(piv);
  }
  // 머리카락(머리 뼈에 고정)
  let hair = null;
  if (pk.meshes.hair && B.hair) {
    // 2단: 속(알파 자르기, 그림자·깊이) + 겉(부드러운 가닥 끝, 반투명)
    const hm = hairMaterial(B.hair);
    hm.userData.u.uHair.value.copy(hairC);
    const hs = hairMaterial(B.hair, true);
    hs.userData.u.uHair.value.copy(hairC);
    hair = new THREE.Mesh(pk.meshes.hair.geometry, hm);
    hair.castShadow = true;
    hair.receiveShadow = true;
    by.head.add(hair);
    const soft = new THREE.Mesh(pk.meshes.hair.geometry, hs);
    soft.receiveShadow = true;
    soft.renderOrder = 2;
    by.head.add(soft);
    hair.userData.soft = soft;
  }
  // 멀리 있으면 잔 부품(속눈썹·눈알·머리카락 부드러운 끝)을 끈다
  let near = true;
  const lod = (dist) => {
    const n = dist < 22;
    if (n === near) return;
    near = n;
    if (lashes) lashes.visible = n;
    for (const e of eyes) e.visible = n;
    if (hair?.userData.soft) hair.userData.soft.visible = n;
  };
  const morphIdx = {};
  (pk.meshes.skin?.morphs || []).forEach((n, i) => { morphIdx[n] = i; });
  const setMorph = (name, v) => {
    const i = morphIdx[name];
    if (i === undefined) return;
    for (const o of [skin, lashes]) if (o && o.morphTargetInfluences) o.morphTargetInfluences[i] = v;
  };

  const armL = { sh: by.shL, el: by.elL, hand: by.handL, clav: by.clavL };
  const armR = { sh: by.shR, el: by.elR, hand: by.handR, clav: by.clavR };
  const legL = { th: by.thL, kn: by.knL, ft: by.ftL };
  const legR = { th: by.thR, kn: by.knR, ft: by.ftR };
  const grip = meta.extra.gripR || [0, -0.085, 0.012];

  const M = {
    wood: new THREE.MeshStandardMaterial({ color: 0x6e4c30, roughness: 0.7 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.32, metalness: 0.92 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc27a4a, roughness: 0.34, metalness: 0.9 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4b3020, roughness: 0.62 }),
    stoneM: new THREE.MeshStandardMaterial({ color: 0x7d7870, roughness: 0.9 }),
    body: skinM,
  };
  const mesh = (geo, m) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };

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
    t.position.set(grip[0], grip[1], grip[2]);
    armR.hand.add(t);
  }
  // 무기(v0.3): 돌 몽둥이, 한손검·전투 도끼·창(구리·철)
  const weapons = {};
  const w = (key, list) => {
    const g = new THREE.Group();
    for (const [geo, m] of list) g.add(mesh(merge(geo), m));
    g.visible = false;
    g.rotation.x = Math.PI / 2;
    g.position.set(grip[0], grip[1], grip[2]);
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
  return {
    root, hips: by.hips, spine: by.spine, chest: by.chest, neck: by.neck, head: by.head,
    armL, armR, legL, legR, tools, weapons, materials: M, eyes, setMorph, kind, lod,
    hipsY: by.hips.position.y, buildMs: BASE.ms,
    tris: Object.fromEntries(Object.entries(pk.meshes).map(([k, m]) => [k, m.geometry.index.count / 3])),
  };
}
