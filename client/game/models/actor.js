// 개척자 모형: 관절(엉덩이·허리·목·어깨·팔꿈치·허벅지·무릎)로 나눈 사람 모양과 도구.
// 키는 약 1.78m. 원점은 발바닥 가운데, 앞은 +z.

import * as THREE from 'three';
import { P, lathe, merge, xf } from './build.js';

const cap = (r, len, c, t) => P(new THREE.CapsuleGeometry(r, len, 4, 10), c, t);

function mat(color, roughness = 0.8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
}

const SKIN = [0xd8a37c, 0xc68a62, 0xe3b48f, 0xa8704a];
const HAIR = [0x2e1f14, 0x5a3a1e, 0x1a1512, 0x8a6236];

export function makeActorModel({ tunic = 0x2f7f78, trousers = 0x3e4452, seed = 1 } = {}) {
  const skinC = SKIN[seed % SKIN.length];
  const hairC = HAIR[(seed >> 1) % HAIR.length];
  const M = {
    skin: mat(skinC, 0.55),
    tunic: new THREE.MeshPhysicalMaterial({ color: tunic, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(tunic).multiplyScalar(1.4) }),
    trousers: new THREE.MeshPhysicalMaterial({ color: trousers, roughness: 0.95, sheen: 0.4, sheenRoughness: 0.9 }),
    leather: mat(0x4b3020, 0.62),
    hair: mat(hairC, 0.75),
    dark: mat(0x15100c, 0.4),
    canvas: mat(0xa89272, 0.95),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.32, metalness: 0.92 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc27a4a, roughness: 0.34, metalness: 0.9 }),
    stoneM: mat(0x7d7870, 0.9),
    wood: mat(0x6e4c30, 0.7),
  };
  const mesh = (geo, m) => {
    const o = new THREE.Mesh(geo, m);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.96;
  root.add(hips);
  // 골반·바지 윗부분
  hips.add(mesh(merge([lathe([[0, -0.06], [0.16, -0.06], [0.17, 0.02], [0.155, 0.1], [0, 0.1]], 14)]), M.trousers));
  const spine = new THREE.Group();
  spine.position.y = 0.08;
  hips.add(spine);
  // 웃옷: 허리에서 어깨까지, 아래는 엉덩이를 덮는 자락
  spine.add(mesh(merge([
    lathe([[0, -0.24], [0.2, -0.24], [0.19, -0.1], [0.165, 0.02], [0.175, 0.18], [0.2, 0.34], [0.205, 0.42], [0.16, 0.5], [0.07, 0.54], [0, 0.54]], 16),
  ]), M.tunic));
  spine.add(mesh(merge([P(new THREE.TorusGeometry(0.172, 0.022, 6, 22), 0xffffff, { rx: Math.PI / 2, y: 0.0 })]), M.leather));
  spine.add(mesh(merge([P(new THREE.BoxGeometry(0.06, 0.05, 0.02), 0xffffff, { y: 0.0, z: 0.185 })]), M.metal));
  // 등짐
  spine.add(mesh(merge([
    P(new THREE.BoxGeometry(0.34, 0.4, 0.16), 0xffffff, { y: 0.28, z: -0.25 }),
    P(new THREE.BoxGeometry(0.3, 0.12, 0.17), 0xffffff, { y: 0.52, z: -0.25 }),
  ]), M.canvas));
  spine.add(mesh(merge([
    P(new THREE.CylinderGeometry(0.075, 0.075, 0.4, 10), 0xffffff, { y: 0.55, z: -0.26, rz: Math.PI / 2 }),
  ]), M.wood));
  for (const sx of [-1, 1]) spine.add(mesh(merge([P(new THREE.BoxGeometry(0.035, 0.5, 0.02), 0xffffff, { x: sx * 0.11, y: 0.3, z: 0.19, rx: 0.08 })]), M.leather));
  const neck = new THREE.Group();
  neck.position.y = 0.54;
  spine.add(neck);
  neck.add(mesh(merge([P(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), 0xffffff, { y: 0.04 })]), M.skin));
  const head = new THREE.Group();
  head.position.y = 0.1;
  neck.add(head);
  const headGeo = new THREE.SphereGeometry(0.112, 20, 16);
  const hp = headGeo.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i);
    const z = hp.getZ(i);
    hp.setY(i, y * 1.15);
    if (y < -0.02) hp.setX(i, hp.getX(i) * (1 + y * 1.6));
    if (z > 0.05 && y < 0.0) hp.setZ(i, z * 1.03);
  }
  headGeo.computeVertexNormals();
  head.add(mesh(merge([xf(P(headGeo), { y: 0.12 })]), M.skin));
  head.add(mesh(merge([P(new THREE.ConeGeometry(0.018, 0.045, 6), 0xffffff, { y: 0.11, z: 0.112, rx: Math.PI / 2 - 0.3 })]), M.skin));
  head.add(mesh(merge([
    P(new THREE.SphereGeometry(0.014, 8, 6), 0xffffff, { x: -0.04, y: 0.15, z: 0.098 }),
    P(new THREE.SphereGeometry(0.014, 8, 6), 0xffffff, { x: 0.04, y: 0.15, z: 0.098 }),
  ]), M.dark));
  const hairGeo = new THREE.SphereGeometry(0.122, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  head.add(mesh(merge([
    xf(P(hairGeo), { y: 0.135, sy: 1.12, rx: -0.25 }),
    P(new THREE.SphereGeometry(0.1, 12, 8), 0xffffff, { y: 0.1, z: -0.06, sy: 0.9 }),
  ]), M.hair));
  // 팔
  const arm = (sx) => {
    const sh = new THREE.Group();
    sh.position.set(sx * 0.215, 0.45, 0);
    spine.add(sh);
    sh.add(mesh(merge([cap(0.058, 0.2, 0xffffff, { y: -0.13 })]), M.tunic));
    const el = new THREE.Group();
    el.position.y = -0.29;
    sh.add(el);
    el.add(mesh(merge([cap(0.047, 0.19, 0xffffff, { y: -0.12 })]), M.skin));
    el.add(mesh(merge([P(new THREE.CylinderGeometry(0.054, 0.05, 0.1, 10), 0xffffff, { y: -0.17 })]), M.leather));
    const hand = new THREE.Group();
    hand.position.y = -0.27;
    el.add(hand);
    hand.add(mesh(merge([P(new THREE.BoxGeometry(0.075, 0.09, 0.04), 0xffffff, { y: -0.03 }), P(new THREE.SphereGeometry(0.03, 8, 6), 0xffffff, { y: -0.03, z: 0.03, x: -sx * 0.02 })]), M.leather));
    return { sh, el, hand };
  };
  const armL = arm(-1);
  const armR = arm(1);
  // 다리
  const leg = (sx) => {
    const th = new THREE.Group();
    th.position.set(sx * 0.095, -0.02, 0);
    hips.add(th);
    th.add(mesh(merge([cap(0.072, 0.32, 0xffffff, { y: -0.2 })]), M.trousers));
    const kn = new THREE.Group();
    kn.position.y = -0.44;
    th.add(kn);
    kn.add(mesh(merge([cap(0.058, 0.3, 0xffffff, { y: -0.17 })]), M.trousers));
    kn.add(mesh(merge([P(new THREE.CylinderGeometry(0.068, 0.062, 0.22, 12), 0xffffff, { y: -0.3 })]), M.leather));
    const ft = new THREE.Group();
    ft.position.y = -0.44;
    kn.add(ft);
    ft.add(mesh(merge([P(new THREE.BoxGeometry(0.11, 0.085, 0.25), 0xffffff, { y: -0.03, z: 0.045 }), P(new THREE.CylinderGeometry(0.055, 0.055, 0.11, 10), 0xffffff, { y: -0.03, z: 0.165, rx: Math.PI / 2, sx: 1, sy: 1 })]), M.leather));
    return { th, kn, ft };
  };
  const legL = leg(-1);
  const legR = leg(1);
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
    t.position.set(0, -0.05, 0.02);
    armR.hand.add(t);
  }
  // 무기(v0.3): 돌 몽둥이, 한손검·전투 도끼·창(구리·철)
  const weapons = {};
  const w = (key, parts) => {
    const g = new THREE.Group();
    for (const [geo, m] of parts) g.add(mesh(merge(geo), m));
    g.visible = false;
    g.rotation.x = Math.PI / 2;
    g.position.set(0, -0.05, 0.02);
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
  return { root, hips, spine, neck, head, armL, armR, legL, legR, tools, weapons, materials: M };
}
