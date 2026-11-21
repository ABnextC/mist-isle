// 짐승 모형: 해안 게·사슴·멧돼지·늑대. 다리·머리·꼬리를 묶음으로 나눠 걸음과 준비 동작을 움직인다.
// 색은 정점 색으로 칠하고, 짐승마다 재질을 따로 둬서 맞을 때·준비 동작 때 번쩍임을 넣는다.

import * as THREE from 'three';
import { P, merge, rng } from './build.js';

const C = (h) => new THREE.Color(h);

function material() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, emissive: 0x000000 });
}

function mesh(geo, m) {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const ell = (rx, ry, rz, c, t = {}) => P(new THREE.SphereGeometry(1, 16, 12), c, { ...t, sx: rx, sy: ry, sz: rz });
const cyl = (r0, r1, h, c, t = {}) => P(new THREE.CylinderGeometry(r1, r0, h, 8), c, t);
const cone = (r, h, c, t = {}) => P(new THREE.ConeGeometry(r, h, 7), c, t);

// 네발짐승: 몸통 길이 L, 높이 H(어깨), 다리 두께 lr
function quadruped({ L, H, R, lr, body, belly, dark, legLen, headLen, neckUp, seed }) {
  const m = material();
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = H;
  root.add(torso);
  torso.add(mesh(merge([
    ell(R, R * 0.92, L * 0.5, body, { z: 0 }),
    ell(R * 0.82, R * 0.55, L * 0.38, belly, { y: -R * 0.42, z: 0.02 }),
    ell(R * 1.02, R * 0.98, R * 1.05, body, { z: L * 0.32, y: R * 0.08 }),
  ]), m));
  // 다리(v0.4.8): 윗다리(엉덩이 관절 g)와 아랫다리(무릎 kn) 두 마디. 앞다리는 관절이 앞으로, 뒷다리는 뒤로 접힌다
  const legs = [];
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const g = new THREE.Group();
    g.position.set(sx * R * 0.55, -R * 0.2, sz * L * 0.36);
    torso.add(g);
    const len = legLen;
    g.add(mesh(merge([cyl(lr, lr * 0.75, len * 0.58, body, { y: -len * 0.27 })]), m));
    const kn = new THREE.Group();
    kn.position.y = -len * 0.55;
    g.add(kn);
    kn.add(mesh(merge([
      cyl(lr * 0.72, lr * 0.5, len * 0.5, dark, { y: -len * 0.2 }),
      ell(lr * 0.75, lr * 0.5, lr * 0.95, dark, { y: -len * 0.45, z: lr * 0.2 }),
    ]), m));
    legs.push({ g, kn, ph, front: sz > 0, sx, l1: len * 0.55, l2: len * 0.45, hip: H - R * 0.2 });
  }
  const neck = new THREE.Group();
  neck.position.set(0, R * 0.35, L * 0.45);
  neck.rotation.x = -neckUp;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0, headLen * 0.7);
  head.rotation.x = neckUp * 0.8; // 목이 서도 머리는 거의 수평(v0.4.9: 사슴이 하늘을 보던 자세)
  neck.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, R * 0.3, -L * 0.5);
  torso.add(tail);
  return { m, root, torso, legs, neck, head, tail, R: rng(seed), L, H };
}

function deer(seed) {
  const q = quadruped({ L: 1.25, H: 1.0, R: 0.27, lr: 0.06, body: C(0x8a5a36), belly: C(0xd8c4a4), dark: C(0x3a2618), legLen: 0.95, headLen: 0.42, neckUp: 0.95, seed });
  q.neck.add(mesh(merge([cyl(0.13, 0.1, 0.6, C(0x8a5a36), { rx: Math.PI / 2, z: 0.25 })]), q.m));
  const antler = q.R() < 0.55;
  const parts = [
    ell(0.12, 0.13, 0.24, C(0x8a5a36), { rx: 0.35 }),
    ell(0.07, 0.07, 0.12, C(0x3a2618), { z: 0.2, y: -0.06 }),
    cone(0.05, 0.16, C(0x6e4528), { x: -0.11, y: 0.13, z: -0.08, rz: 0.9 }),
    cone(0.05, 0.16, C(0x6e4528), { x: 0.11, y: 0.13, z: -0.08, rz: -0.9 }),
  ];
  if (antler) {
    for (const sx of [-1, 1]) {
      parts.push(cyl(0.018, 0.012, 0.38, C(0xcab48c), { x: sx * 0.07, y: 0.3, z: -0.02, rz: -sx * 0.35 }));
      parts.push(cyl(0.012, 0.008, 0.2, C(0xcab48c), { x: sx * 0.16, y: 0.42, z: 0.06, rz: -sx * 0.9, rx: 0.5 }));
      parts.push(cyl(0.012, 0.008, 0.2, C(0xcab48c), { x: sx * 0.12, y: 0.48, z: -0.06, rz: -sx * 0.4, rx: -0.6 }));
    }
  }
  q.head.add(mesh(merge(parts), q.m));
  q.tail.add(mesh(merge([ell(0.06, 0.09, 0.05, C(0xf0e8da), { y: -0.04, z: -0.02 })]), q.m));
  return q;
}

function boar(seed) {
  const q = quadruped({ L: 1.15, H: 0.56, R: 0.36, lr: 0.075, body: C(0x4a3a30), belly: C(0x5e4c3e), dark: C(0x241a14), legLen: 0.45, headLen: 0.3, neckUp: -0.15, seed });
  q.torso.add(mesh(merge([0, 1, 2, 3, 4, 5].map((i) => cone(0.05, 0.16, C(0x2a201a), { y: 0.36, z: 0.4 - i * 0.14, rx: -0.3 }))), q.m));
  q.head.add(mesh(merge([
    ell(0.2, 0.2, 0.28, C(0x4a3a30), { z: 0.02 }),
    cyl(0.1, 0.08, 0.2, C(0x6a4e44), { rx: Math.PI / 2, z: 0.28, y: -0.04 }),
    ell(0.085, 0.07, 0.03, C(0x2a1814), { z: 0.38, y: -0.04 }),
    cone(0.025, 0.16, C(0xece2c8), { x: -0.09, y: -0.02, z: 0.28, rx: -0.9 }),
    cone(0.025, 0.16, C(0xece2c8), { x: 0.09, y: -0.02, z: 0.28, rx: -0.9 }),
    cone(0.05, 0.12, C(0x3a2c24), { x: -0.12, y: 0.17, z: -0.05, rz: 0.6 }),
    cone(0.05, 0.12, C(0x3a2c24), { x: 0.12, y: 0.17, z: -0.05, rz: -0.6 }),
  ]), q.m));
  q.tail.add(mesh(merge([cyl(0.015, 0.01, 0.2, C(0x2a201a), { y: -0.1, rx: 0.3 })]), q.m));
  return q;
}

function wolf(seed) {
  const R = rng(seed);
  const grey = C(0x6f6e6a).lerp(C(0x8a7f70), R() * 0.6);
  const q = quadruped({ L: 1.0, H: 0.72, R: 0.24, lr: 0.055, body: grey, belly: C(0xc9c2b6), dark: C(0x3a3836), legLen: 0.68, headLen: 0.32, neckUp: 0.35, seed });
  q.neck.add(mesh(merge([cyl(0.15, 0.12, 0.36, grey, { rx: Math.PI / 2 - 0.2, z: 0.12 })]), q.m));
  q.head.add(mesh(merge([
    ell(0.14, 0.13, 0.17, grey),
    cyl(0.07, 0.045, 0.24, grey, { rx: Math.PI / 2, z: 0.2, y: -0.03 }),
    ell(0.03, 0.025, 0.03, C(0x111111), { z: 0.32, y: -0.02 }),
    cone(0.045, 0.14, grey, { x: -0.08, y: 0.15, z: -0.03 }),
    cone(0.045, 0.14, grey, { x: 0.08, y: 0.15, z: -0.03 }),
    ell(0.02, 0.016, 0.01, C(0xe8c040), { x: -0.06, y: 0.04, z: 0.13 }),
    ell(0.02, 0.016, 0.01, C(0xe8c040), { x: 0.06, y: 0.04, z: 0.13 }),
  ]), q.m));
  q.tail.add(mesh(merge([ell(0.07, 0.07, 0.3, grey, { z: -0.25, y: -0.1, rx: 0.5 }), ell(0.05, 0.05, 0.1, C(0x2e2c2a), { z: -0.52, y: -0.24, rx: 0.5 })]), q.m));
  return q;
}

function crab(seed) {
  const m = material();
  const R = rng(seed);
  const shell = C(0xb3402a).lerp(C(0xc86a2a), R() * 0.5);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.2;
  root.add(torso);
  torso.add(mesh(merge([
    ell(0.32, 0.12, 0.24, shell),
    ell(0.025, 0.025, 0.025, C(0x111111), { x: -0.08, y: 0.12, z: 0.2 }),
    ell(0.025, 0.025, 0.025, C(0x111111), { x: 0.08, y: 0.12, z: 0.2 }),
    cyl(0.01, 0.01, 0.08, shell, { x: -0.08, y: 0.08, z: 0.19 }),
    cyl(0.01, 0.01, 0.08, shell, { x: 0.08, y: 0.08, z: 0.19 }),
  ]), m));
  const legs = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.set(sx * 0.26, -0.02, 0.1 - i * 0.11);
      g.rotation.z = sx * 0.6;
      torso.add(g);
      g.add(mesh(merge([cyl(0.02, 0.014, 0.28, shell, { x: sx * 0.13, y: -0.02, rz: sx * 1.3 })]), m));
      legs.push({ g, ph: i * 2.1 + (sx > 0 ? Math.PI : 0), side: true });
    }
  }
  const head = new THREE.Group();
  head.position.set(0, 0, 0.22);
  torso.add(head);
  // 집게: 팔 밑동을 축으로 돌 수 있게 따로 묶는다(v0.4.9 — 들기·집기)
  const claws = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 0.12, 0, 0);
    head.add(g);
    g.add(mesh(merge([
      cyl(0.025, 0.02, 0.18, shell, { x: sx * 0.04, z: 0.06, rx: Math.PI / 2, rz: sx * 0.4 }),
      ell(0.09, 0.06, 0.12, shell, { x: sx * 0.1, z: 0.18 }),
    ]), m));
    claws.push({ g, sx });
  }
  return { m, root, torso, legs, neck: null, head, tail: null, claws, R };
}

const MAKERS = { crab, deer, boar, wolf };

export function makeCreature(type, seed) {
  const q = MAKERS[type](seed);
  q.type = type;
  return q;
}
