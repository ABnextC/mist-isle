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
    const shared = await Promise.all([loadTex(BASE_URL + 'eye.webp', true), loadTex(BASE_URL + 'lash.png', true), loadTex(BASE_URL + 'detail.webp', false),
      loadTex(BASE_URL + 'detail2.webp', false).catch(() => null)]);
    const [eye, lash, detail, detail2] = shared;
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    if (detail2) detail2.wrapS = detail2.wrapT = THREE.RepeatWrapping;
    out.tex = { eye, lash, detail, detail2 };
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

// 갑옷 종류별 옷 조각 묶음(머리·몸통·다리): 처음 입을 때 읽고 몸마다 한 번만 둔다
const classPacks = {};
export function loadClassPack(kind, cls) {
  const key = `${kind}:${cls}`;
  if (classPacks[key]) return classPacks[key];
  const B = BASE?.bodies[kind];
  const id = B?.pk.meta.extra?.classes?.[cls];
  classPacks[key] = id ? loadPack(BASE_URL + id).catch((e) => { console.warn('옷 조각 묶음을 못 읽음', id, e); delete classPacks[key]; return null; }) : Promise.resolve(null);
  return classPacks[key];
}
const loadedPacks = {}; // 다 읽힌 묶음(동기 확인용)
export const ARMOR_CLASSES = ['robe', 'light', 'heavy'];
const ROBES = [0x2e4a7a, 0x6e2a32, 0x2f5a3a, 0x4a3a6a, 0x6a4a2a];
const SASHES = [0xb0472e, 0xc8a050, 0x8a2a2a, 0x3a6a8a, 0xd0c090];
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

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
  const clothM = clothMaterial(BASE.tex.detail, BASE.tex.detail2);
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

  // 갑옷 칸 색(v0.4.5)
  set(11, lin(ROBES[seed % ROBES.length]));
  set(12, lin(SASHES[(seed + 2) % SASHES.length]));
  set(13, lin(ROBES[seed % ROBES.length]).multiplyScalar(0.85));
  set(14, lin(0x5a3a22));
  set(15, lin(0xd8ccb0));
  set(16, lin(0xa8aeb4));
  set(17, lin(0xb8bec4));
  set(18, lin(0x6a5a46));
  set(19, lin(0xa4aab0));
  set(20, lin(0xb8a888));
  set(21, lin(0xd4a84a));
  set(22, lin(ROBES[seed % ROBES.length]).multiplyScalar(0.55));
  
  const skinned = [];
  const bindSkinned = (geometry, mat) => {
    const o = new THREE.SkinnedMesh(geometry, mat);
    root.add(o);
    o.bind(skeleton, new THREE.Matrix4());
    // 뼈 변환으로 다시 재지 않게 넉넉한 경계 구(팔 들기·구르기까지 덮는다)
    o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.45);
    o.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.6, -1.2), new THREE.Vector3(1.2, 2.5, 1.2));
    o.castShadow = true;
    o.receiveShadow = true;
    skinned.push(o);
    return o;
  };
  const add = (key, mat, parent) => {
    const m = pk.meshes[key];
    if (!m) return null;
    let o;
    if (m.geometry.attributes.skinIndex) {
      o = bindSkinned(m.geometry, mat);
    } else {
      o = new THREE.Mesh(m.geometry, mat);
      (parent || root).add(o);
      o.castShadow = true;
      o.receiveShadow = true;
    }
    return o;
  };
  // 피부: 묶음(늘 보임·아래팔·정수리)마다 재질 칸. 옷이 덮으면 그 칸을 숨긴다(긴 소매·머리 장비)
  const skinGeo = pk.meshes.skin.geometry;
  const groups = pk.meshes.skin.info.groups || [];
  if (!skinGeo.groups.length && groups.length) groups.forEach(([start, count], i) => skinGeo.addGroup(start, count, i));
  const skinRegion = Object.fromEntries(groups.map((g, i) => [g[2], i]));
  const skinMats = groups.length ? groups.map(() => skinM) : skinM;
  const skin = add('skin', skinMats);
  // 기본 옷 조각
  const pieces = {};
  for (const k of ['chest_base', 'legs_base', 'boots']) {
    const o = add(k, clothM);
    if (o) pieces[k] = o;
  }
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
  let hairOn = true;
  const lod = (dist, nearD = 22) => {
    const n = dist < nearD;
    if (n === near) return;
    near = n;
    if (lashes) lashes.visible = n;
    for (const e of eyes) e.visible = n;
    if (hair?.userData.soft) hair.userData.soft.visible = n && hairOn;
  };
  // 옷 입히기(v0.4.5): 머리·몸통·다리 칸마다 갑옷 종류(robe·light·heavy) 또는 null(기본 옷·맨머리)
  let want = { head: null, chest: null, legs: null };
  let outfitVer = 0;
  function pieceMesh(key, pack) {
    if (pieces[key]) return pieces[key];
    const m = pack?.meshes[key];
    if (!m) return null;
    const o = bindSkinned(m.geometry, clothM);
    o.visible = false;
    pieces[key] = o;
    return o;
  }
  function applyOutfit() {
    const w = want;
    const show = {
      chest: w.chest ? `chest_${w.chest}` : 'chest_base',
      legs: w.legs ? `legs_${w.legs}` : 'legs_base',
      head: w.head ? `head_${w.head}` : null,
    };
    for (const [slot, key] of Object.entries(show)) {
      if (!key || pieces[key]) continue;
      const cls = key.split('_')[1];
      const pack = loadedPacks[`${kind}:${cls}`];
      if (!pack) return false; // 아직 읽는 중
      pieceMesh(key, pack);
    }
    const on = new Set(Object.values(show).filter(Boolean));
    for (const [key, o] of Object.entries(pieces)) {
      if (key === 'boots') continue;
      o.visible = on.has(key);
    }
    // 피부 칸: 긴 소매면 아래팔, 머리 장비면 정수리·귀를 숨긴다
    if (Array.isArray(skin.material)) {
      const mats = skin.material.slice();
      if (skinRegion.forearm !== undefined) mats[skinRegion.forearm] = w.chest ? HIDDEN : skinM;
      if (skinRegion.scalp !== undefined) mats[skinRegion.scalp] = w.head ? HIDDEN : skinM;
      skin.material = mats;
    }
    hairOn = !w.head;
    if (hair) {
      hair.visible = hairOn;
      if (hair.userData.soft) hair.userData.soft.visible = hairOn && near;
    }
    return true;
  }
  function setOutfit(o = {}) {
    want = { head: o.head || null, chest: o.chest || null, legs: o.legs || null };
    const ver = ++outfitVer;
    const need = [...new Set([want.head, want.chest, want.legs].filter(Boolean))].filter((c) => !loadedPacks[`${kind}:${c}`]);
    if (!need.length) {
      applyOutfit();
      return Promise.resolve(true);
    }
    return Promise.all(need.map((c) => loadClassPack(kind, c).then((pk2) => { if (pk2) loadedPacks[`${kind}:${c}`] = pk2; })))
      .then(() => (ver === outfitVer ? applyOutfit() : false));
  }
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
    // 안개강(v2.3): 푸른 강철에 영맥 빛이 옅게 돈다
    mist: new THREE.MeshStandardMaterial({ color: 0x8fb2c8, roughness: 0.24, metalness: 0.92, emissive: 0x1b5a6e, emissiveIntensity: 0.35 }),
    mistWood: new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.55, emissive: 0x123848, emissiveIntensity: 0.4 }),
    // 심장강(v3.3): 붉은 금빛 강철, 속에서 불씨가 비친다
    heart: new THREE.MeshStandardMaterial({ color: 0xc87a4a, roughness: 0.22, metalness: 0.95, emissive: 0x8a2a10, emissiveIntensity: 0.55 }),
    heartWood: new THREE.MeshStandardMaterial({ color: 0x3a1e18, roughness: 0.5, emissive: 0x6a2010, emissiveIntensity: 0.5 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x4b3020, roughness: 0.62 }),
    stoneM: new THREE.MeshStandardMaterial({ color: 0x7d7870, roughness: 0.9 }),
    body: skinM,
    cloth: clothM,
    hair: hair ? [hair.material, hair.userData.soft?.material].filter(Boolean) : [],
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
  const gemMat = new THREE.MeshStandardMaterial({ color: 0x7fd6ff, emissive: 0x2a7aa8, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1 });
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
  for (const [tier, metal] of [[1, M.copper], [2, M.metal], [3, M.mist], [4, M.heart]]) {
    w(`sword_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), 0xffffff, { y: 0.0 })], M.leather],
      [[P(new THREE.BoxGeometry(0.17, 0.025, 0.04), 0xffffff, { y: 0.09 }), P(new THREE.BoxGeometry(0.05, 0.6, 0.012), 0xffffff, { y: 0.4 }), P(new THREE.ConeGeometry(0.025, 0.09, 4), 0xffffff, { y: 0.74, sz: 0.25 })], metal],
    ]);
    w(`axe_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.022, 0.026, 0.86, 8), 0xffffff, { y: 0.32 })], M.wood],
      [[P(new THREE.BoxGeometry(0.03, 0.12, 0.1), 0xffffff, { y: 0.68, z: 0.05 }), P(new THREE.CylinderGeometry(0.15, 0.15, 0.022, 14, 1, false, 0, Math.PI), 0xffffff, { y: 0.68, z: 0.1, rz: Math.PI / 2, ry: Math.PI / 2 })], metal],
    ]);
    // 전투 망치(v1.1): 굵은 자루에 네모 쇠머리
    w(`hammer_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.024, 0.028, 0.92, 8), 0xffffff, { y: 0.34 })], M.wood],
      [[P(new THREE.BoxGeometry(0.13, 0.15, 0.26), 0xffffff, { y: 0.76 }), P(new THREE.BoxGeometry(0.15, 0.03, 0.28), 0xffffff, { y: 0.69 })], metal],
    ]);
    // 지팡이(v1.2): 긴 나무 자루 끝에 보석(구리 띠·철 띠)
    w(`staff_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.02, 0.026, 1.55, 8), 0xffffff, { y: 0.42 }), P(new THREE.TorusGeometry(0.06, 0.014, 5, 10), 0xffffff, { y: 1.22, rx: Math.PI / 2 })], M.wood],
      [[P(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 8), 0xffffff, { y: 1.16 })], metal],
      [[P(new THREE.OctahedronGeometry(0.055, 0), 0xffffff, { y: 1.27, sy: 1.5 })], gemMat],
    ]);
    w(`spear_${tier}`, [
      [[P(new THREE.CylinderGeometry(0.018, 0.022, 1.6, 8), 0xffffff, { y: 0.45 })], M.wood],
      [[P(new THREE.ConeGeometry(0.045, 0.26, 4), 0xffffff, { y: 1.37, sz: 0.3 }), P(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 8), 0xffffff, { y: 1.23 })], metal],
    ]);
  }
  // 방패(v1.1): 검과 방패를 들면 왼팔에 둥근 나무 방패
  const shields = {};
  for (const [tier, metal] of [[1, M.copper], [2, M.metal], [3, M.mist], [4, M.heart]]) {
    const g = new THREE.Group();
    g.add(mesh(merge([P(new THREE.CylinderGeometry(0.25, 0.25, 0.035, 18), 0xffffff, { rx: Math.PI / 2 })]), M.wood));
    g.add(mesh(merge([P(new THREE.TorusGeometry(0.25, 0.018, 5, 22), 0xffffff, {}), P(new THREE.SphereGeometry(0.06, 10, 6), 0xffffff, { z: -0.03, sz: 0.6 })]), metal));
    g.visible = false;
    g.position.set(-0.02, 0.02, 0.09);
    g.rotation.y = Math.PI / 2;
    armL.hand.add(g);
    shields[`sword_${tier}`] = g;
  }
  // 활(v1.2): 왼손에 쥐는 굽은 활대와 시위
  // 활의 틀: y = 활대 세로, +z = 과녁 쪽(가운데 손잡이가 원점). 손 방향과 상관없이 몸 방향에 맞춰 세운다(upright)
  for (const [tier, limb] of [[1, M.wood], [2, M.leather], [3, M.mistWood], [4, M.heartWood]]) {
    const g = new THREE.Group();
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.62, -0.16), new THREE.Vector3(0, 0, 0.16), new THREE.Vector3(0, 0.62, -0.16));
    const limbGeo = new THREE.TubeGeometry(curve, 16, 0.016, 5, false);
    g.add(mesh(merge([P(limbGeo, 0xffffff, {}), P(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 6), 0xffffff, {})]), limb));
    g.add(mesh(merge([P(new THREE.CylinderGeometry(0.003, 0.003, 1.24, 3), 0xffffff, { z: -0.16 })]), M.leather));
    g.visible = false;
    g.userData.upright = true;
    armL.hand.add(g);
    shields[`bow_${tier}`] = g;
  }
  // 몸 방향으로 세우는 왼손 물건(활): 위치는 왼손, 방향은 몸(살짝 앞으로 기울임)
  const _bq = new THREE.Quaternion();
  const _bh = new THREE.Quaternion();
  const _tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0.12));
  function aimOff() {
    for (const g of Object.values(shields)) {
      if (!g.visible || !g.userData.upright) continue;
      root.updateMatrixWorld(true);
      root.getWorldQuaternion(_bq).multiply(_tilt);
      armL.hand.getWorldQuaternion(_bh).invert();
      g.quaternion.copy(_bh.multiply(_bq));
      g.position.copy(gripL);
    }
  }
  // 손에 드는 소품(v0.4.9): 가죽 칼·망치·톱·국자, 먹을 것(고기·산딸기 말랭이·국그릇)
  const props = {};
  const pr = (key, list) => {
    const g = new THREE.Group();
    for (const [geo, m] of list) g.add(mesh(merge(geo), m));
    g.visible = false;
    g.rotation.x = Math.PI / 2;
    g.position.set(grip[0], grip[1], grip[2]);
    armR.hand.add(g);
    props[key] = g;
  };
  const red = new THREE.MeshStandardMaterial({ color: 0x9a1c2c, roughness: 0.45 });
  const meat = new THREE.MeshStandardMaterial({ color: 0x7a3e22, roughness: 0.55 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.6 });
  const soup = new THREE.MeshStandardMaterial({ color: 0x5a6a2a, roughness: 0.3 });
  pr('knife', [
    [[P(new THREE.CylinderGeometry(0.016, 0.018, 0.11, 8), 0xffffff, { y: 0.0 })], M.leather],
    [[P(new THREE.BoxGeometry(0.008, 0.17, 0.032), 0xffffff, { y: 0.14, z: 0.006 }), P(new THREE.ConeGeometry(0.016, 0.05, 4), 0xffffff, { y: 0.245, sz: 0.25 })], M.metal],
  ]);
  pr('hammer', [
    [[P(new THREE.CylinderGeometry(0.016, 0.02, 0.36, 8), 0xffffff, { y: 0.1 })], M.wood],
    [[P(new THREE.BoxGeometry(0.05, 0.06, 0.13), 0xffffff, { y: 0.27, z: 0.01 })], M.metal],
  ]);
  pr('saw', [
    [[P(new THREE.BoxGeometry(0.04, 0.12, 0.05), 0xffffff, { y: 0.0 })], M.wood],
    [[P(new THREE.BoxGeometry(0.004, 0.5, 0.1), 0xffffff, { y: 0.3, z: 0.03 })], M.metal],
  ]);
  pr('ladle', [
    [[P(new THREE.CylinderGeometry(0.012, 0.014, 0.5, 6), 0xffffff, { y: 0.2 }), P(new THREE.SphereGeometry(0.045, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, { y: 0.46, rx: Math.PI })], M.wood],
  ]);
  pr('meat', [
    [[P(new THREE.SphereGeometry(0.05, 10, 8), 0xffffff, { y: 0.07, sy: 1.4 })], meat],
    [[P(new THREE.CylinderGeometry(0.012, 0.014, 0.08, 6), 0xffffff, { y: -0.01 })], bone],
  ]);
  pr('berry', [
    [[...[[0, 0.03, 0], [0.025, 0.04, 0.01], [-0.02, 0.045, -0.01], [0.005, 0.06, 0.02], [-0.01, 0.025, 0.025]].map(([x, y, z]) => P(new THREE.SphereGeometry(0.016, 8, 6), 0xffffff, { x, y, z }))], red],
  ]);
  pr('bowl', [
    [[P(new THREE.CylinderGeometry(0.075, 0.05, 0.055, 14, 1, true), 0xffffff, { y: 0.03 }), P(new THREE.CylinderGeometry(0.05, 0.05, 0.008, 14), 0xffffff, { y: 0.004 })], M.wood],
    [[P(new THREE.CylinderGeometry(0.07, 0.07, 0.006, 14), 0xffffff, { y: 0.045 })], soup],
  ]);
  for (const g of Object.values(props)) g.traverse((o) => { if (o.material) o.material.side = THREE.DoubleSide; });
  let shownProp = null;
  function showProp(key) {
    if (key === shownProp) return;
    if (shownProp && props[shownProp]) props[shownProp].visible = false;
    shownProp = key && props[key] ? key : null;
    if (shownProp) props[shownProp].visible = true;
  }

  // 두 손으로 쥐는 도구·무기(v0.4.8): 손잡이가 두 손을 지나게 돌린다.
  // 모션 캡처 손목은 아래팔을 따르기만 해서, 오른손에만 붙이면 도끼날이 엉뚱한 쪽을 본다.
  // from→to 방향이 손잡이(+y), 몸 옆축이 날의 면(+x)이 되게. 두 손이 멀면(한 손 동작) 오른손 방향 그대로.
  const TWO = {
    logging: { mode: 'radial' }, mining: { mode: 'radial' },
    axe_1: { mode: 'radial' }, axe_2: { mode: 'radial' }, club_0: { mode: 'radial' },
    sword_1: { mode: 'radial', far: 0.3 }, sword_2: { mode: 'radial', far: 0.3 },
    hammer_1: { mode: 'radial' }, hammer_2: { mode: 'radial' },
    staff_1: { mode: 'line', far: 0.25 }, staff_2: { mode: 'line', far: 0.25 },
    spear_1: { mode: 'line', far: 0.9 }, spear_2: { mode: 'line', far: 0.9 },
    // 한 손 소품: 오른어깨 → 오른손 쪽으로(톱날·국자가 앞·아래를 본다)
    saw: { mode: 'arm' }, ladle: { mode: 'arm' }, knife: { mode: 'arm', tilt: 0.5 },
  };
  const gripL = new THREE.Vector3(-grip[0], grip[1], grip[2]);
  const gripRv = new THREE.Vector3(grip[0], grip[1], grip[2]);
  const _pR = new THREE.Vector3();
  const _pL = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _z = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _qw = new THREE.Quaternion();
  const _qp = new THREE.Quaternion();
  const _q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  const _o = new THREE.Vector3();
  const _t = new THREE.Vector3();
  // radial: 손잡이 = 두 어깨 가운데 → 두 손 가운데 방향(내려찍을 때 날이 앞·아래로, 들 때 머리 위로)
  // line: 손잡이 = 오른손 → 왼손(창처럼 두 손이 길게 벌어진 경우)
  // over: 동작 묶음이 정한 자루 방향 { dir: [x,y,z](뿌리 공간), up: 날 면 방향, at: 'R'|'L'|'mid' }
  function aimHeld(over = null) {
    let g = null;
    let key = null;
    if (shownProp) {
      g = props[shownProp];
      key = shownProp;
    }
    if (!g) for (const [k, t] of Object.entries(tools)) if (t.visible) { g = t; key = k; }
    if (!g) for (const [k, t] of Object.entries(weapons)) if (t.visible) { g = t; key = k; }
    if (!g) return;
    const cfg = TWO[key];
    if (!cfg && !over) return;
    root.updateMatrixWorld(true);
    _pR.copy(gripRv).applyMatrix4(armR.hand.matrixWorld);
    _pL.copy(gripL).applyMatrix4(armL.hand.matrixWorld);
    if (over) {
      _d.set(over.dir[0], over.dir[1], over.dir[2]).applyQuaternion(root.quaternion);
      if (over.at === 'mid') _o.addVectors(_pR, _pL).multiplyScalar(0.5).addScaledVector(_d, -0.12);
      else _o.copy(over.at === 'L' ? _pL : _pR);
      const up = over.up || [1, 0, 0];
      _x.set(up[0], up[1], up[2]).applyQuaternion(root.quaternion);
      _x.addScaledVector(_d, -_x.dot(_d));
      if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).applyQuaternion(root.quaternion);
      _x.normalize();
      _z.crossVectors(_x, _d);
      _m.makeBasis(_x, _d, _z);
      _qw.setFromRotationMatrix(_m);
      armR.hand.getWorldQuaternion(_qp).invert();
      g.quaternion.copy(_qw.premultiply(_qp));
      armR.hand.worldToLocal(_o);
      g.position.copy(_o);
      return;
    }
    if (cfg.mode === 'arm') {
      // 아래팔 방향을 따라 앞으로 뻗게(손목을 곧게 편 모양), tilt만큼 아래로
      armR.el.getWorldPosition(_s);
      _d.subVectors(_pR, _s).normalize();
      _t.set(0, -1, 0);
      _d.addScaledVector(_t, cfg.tilt ?? 0.25).normalize();
      _o.copy(_pR);
      _x.set(1, 0, 0).applyQuaternion(root.quaternion);
      _x.addScaledVector(_d, -_x.dot(_d));
      if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).applyQuaternion(root.quaternion);
      _x.normalize();
      _z.crossVectors(_x, _d);
      _m.makeBasis(_x, _d, _z);
      _qw.setFromRotationMatrix(_m);
      armR.hand.getWorldQuaternion(_qp).invert();
      g.quaternion.copy(_qw.premultiply(_qp));
      armR.hand.worldToLocal(_o);
      g.position.copy(_o);
      return;
    }
    const dist = _pR.distanceTo(_pL);
    let k;
    if (cfg.mode === 'line') k = 1; // 창은 늘 겨눈다: 두 손이 붙어 있으면 몸 앞쪽 수평으로
    else k = Math.min(1, Math.max(0, ((cfg.far ?? 0.45) + 0.15 - dist) / 0.15));
    if (k <= 0.001) {
      g.quaternion.copy(_q0);
      g.position.copy(gripRv);
      return;
    }
    if (cfg.mode === 'line') {
      const kl = Math.min(1, Math.max(0, (dist - 0.22) / 0.16)) * Math.min(1, Math.max(0, (cfg.far + 0.3 - dist) / 0.3));
      _t.set(0, -0.05, 1).applyQuaternion(root.quaternion).normalize();
      _d.subVectors(_pL, _pR).normalize().multiplyScalar(kl).addScaledVector(_t, 1 - kl).normalize();
      _o.copy(_pR);
    } else {
      armR.sh.getWorldPosition(_s);
      armL.sh.getWorldPosition(_t);
      _s.add(_t).multiplyScalar(0.5);
      _o.addVectors(_pR, _pL).multiplyScalar(0.5);
      _d.subVectors(_o, _s).normalize();
      _o.addScaledVector(_d, -0.12);
    }
    _x.set(1, 0, 0).applyQuaternion(root.quaternion);
    _x.addScaledVector(_d, -_x.dot(_d));
    if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1).applyQuaternion(root.quaternion);
    _x.normalize();
    _z.crossVectors(_x, _d);
    _m.makeBasis(_x, _d, _z);
    _qw.setFromRotationMatrix(_m);
    armR.hand.getWorldQuaternion(_qp).invert();
    _qw.premultiply(_qp); // 오른손 기준으로
    g.quaternion.copy(_q0).slerp(_qw, k);
    armR.hand.worldToLocal(_o);
    g.position.copy(gripRv).lerp(_o, k);
  }

  // 옷 칸 색 바꾸기(v0.5: 약탈단·NPC): { vest: '#1e1b1a', scarf: '#7a1a14', ... } — 칸 이름은 묶음의 gid
  const GID = meta.extra.gid || {};
  function setTints(map) {
    for (const [name, hex] of Object.entries(map || {})) {
      const i = GID[name];
      if (i != null && tints[i]) tints[i].set(hex);
    }
  }

  return {
    root, hips: by.hips, spine: by.spine, chest: by.chest, neck: by.neck, head: by.head,
    armL, armR, legL, legR, tools, weapons, shields, props, aimOff, showProp, materials: M, eyes, setMorph, kind, lod, setOutfit, aimHeld, setTints,
    get outfit() { return { ...want }; },
    hipsY: by.hips.position.y, hipsRest: by.hips.position.clone(), bones: by, buildMs: BASE.ms,
    tris: Object.fromEntries(Object.entries(pk.meshes).map(([k, m]) => [k, m.geometry.index.count / 3])),
  };
}
