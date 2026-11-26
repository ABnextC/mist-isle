// 짐승 모형: 해안 게·사슴·멧돼지·늑대·안개 늑대, 안개 망령·돌 해태(v0.5.1). 다리·머리·꼬리를 묶음으로 나눠 걸음과 준비 동작을 움직인다.
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

// 안개 늑대(v0.5): 늑대보다 크고 잿빛·푸른 기가 도는 털, 어둠 속에서 푸르게 빛나는 눈
function mistWolf(seed) {
  const R = rng(seed);
  const fur = C(0x4a5058).lerp(C(0x5c6670), R() * 0.6);
  const q = quadruped({ L: 1.12, H: 0.8, R: 0.27, lr: 0.06, body: fur, belly: C(0x8a929a), dark: C(0x22262b), legLen: 0.76, headLen: 0.35, neckUp: 0.33, seed });
  q.neck.add(mesh(merge([cyl(0.17, 0.13, 0.4, fur, { rx: Math.PI / 2 - 0.2, z: 0.12 }), ell(0.2, 0.17, 0.2, C(0x3e444b), { z: 0.02, y: 0.04 })]), q.m));
  q.head.add(mesh(merge([
    ell(0.155, 0.14, 0.18, fur),
    cyl(0.075, 0.048, 0.26, fur, { rx: Math.PI / 2, z: 0.21, y: -0.03 }),
    ell(0.032, 0.026, 0.032, C(0x0c0d0f), { z: 0.34, y: -0.02 }),
    cone(0.05, 0.16, C(0x30353a), { x: -0.085, y: 0.16, z: -0.03 }),
    cone(0.05, 0.16, C(0x30353a), { x: 0.085, y: 0.16, z: -0.03 }),
  ]), q.m));
  // 빛나는 눈: 조명을 받지 않는 재질(밤에도 보인다)
  const glow = new THREE.MeshBasicMaterial({ color: 0x8fd8ff });
  const eyes = new THREE.Mesh(merge([
    ell(0.024, 0.018, 0.012, C(0xffffff), { x: -0.064, y: 0.045, z: 0.14 }),
    ell(0.024, 0.018, 0.012, C(0xffffff), { x: 0.064, y: 0.045, z: 0.14 }),
  ]), glow);
  q.head.add(eyes);
  q.glow = glow;
  q.tail.add(mesh(merge([ell(0.08, 0.08, 0.34, fur, { z: -0.27, y: -0.1, rx: 0.5 }), ell(0.055, 0.055, 0.12, C(0x22262b), { z: -0.57, y: -0.26, rx: 0.5 })]), q.m));
  return q;
}

// 안개 망령(v0.5.1): 다리 없이 떠 있는 두건 쓴 그림자. 어깨를 덮은 망토가 아래로 갈수록 옅어져 안개로 풀린다.
// 두건 속은 빛을 먹는 어둠이고 푸른 눈 둘만 떠 있다. 넓은 소매 끝에 앙상한 손가락.
// 망토는 정점 알파(RGBA)로 아래쪽을 지운다. 두건 속 어둠은 불투명 재질이라 깊이를 써서 망토가 그 위로 덮인다
const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function withAlpha(geo, fn) {
  const c = geo.attributes.color;
  const p = geo.attributes.position;
  const arr = new Float32Array(c.count * 4);
  for (let i = 0; i < c.count; i++) {
    arr[i * 4] = c.getX(i);
    arr[i * 4 + 1] = c.getY(i);
    arr[i * 4 + 2] = c.getZ(i);
    arr[i * 4 + 3] = fn(p.getX(i), p.getY(i), p.getZ(i));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 4));
  return geo;
}
function wraith(seed) {
  const R = rng(seed);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, emissive: 0x000000, transparent: true, opacity: 0.8, depthWrite: false });
  const pale = C(0xbac7d0).lerp(C(0xa3b4c0), R() * 0.5);
  const fold = C(0x7f8f9b);
  const inner = C(0x252c33);
  const bone = C(0x5d6a74);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.05;
  root.add(torso);
  const ghost = (parts, fade) => new THREE.Mesh(withAlpha(merge(parts), fade || (() => 1)), m);
  // 망토: 어깨 덮개, 몸, 해진 자락. 허리 아래부터 옅어져 무릎께에서 사라진다
  const body = [
    ell(0.31, 0.12, 0.21, pale, { y: 0.15 }),
    cyl(0.35, 0.12, 0.3, pale, { y: 0.04 }),
    P(new THREE.CylinderGeometry(0.29, 0.2, 1.05, 12, 4, true), pale, { y: -0.46 }),
    P(new THREE.CylinderGeometry(0.27, 0.18, 1.0, 12, 1, true), fold, { y: -0.46, ry: 0.26, sx: 0.96, sz: 0.96 }),
  ];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + R() * 0.3;
    body.push(cone(0.07 + R() * 0.03, 0.45 + R() * 0.3, i % 2 ? fold : pale, { x: Math.sin(a) * 0.17, z: Math.cos(a) * 0.15, y: -1.05 - R() * 0.12, rx: Math.PI + Math.cos(a) * 0.22, rz: -Math.sin(a) * 0.22 }));
  }
  torso.add(ghost(body, (x, y) => 0.15 + 0.85 * smooth01(-1.35, -0.25, y)));
  // 두건: 머리를 감싼 껍데기, 이마 위 처마, 등으로 늘어진 자락. 속은 어둠
  const head = new THREE.Group();
  head.position.set(0, 0.4, 0.03);
  torso.add(head);
  head.add(ghost([
    ell(0.2, 0.24, 0.21, pale, { z: -0.03 }),
    ell(0.215, 0.07, 0.11, fold, { y: 0.16, z: 0.08, rx: -0.35 }),
    cone(0.17, 0.42, pale, { y: -0.1, z: -0.18, rx: 2.55 }),
    ell(0.17, 0.06, 0.12, fold, { y: -0.2, z: 0.02 }),
  ]));
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x030405 });
  const face = new THREE.Mesh(merge([ell(0.125, 0.155, 0.06, inner, { y: -0.01, z: 0.155 })]), voidMat);
  head.add(face);
  const glow = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 1 });
  head.add(new THREE.Mesh(merge([
    ell(0.026, 0.017, 0.012, C(0xffffff), { x: -0.046, y: 0.012, z: 0.214 }),
    ell(0.026, 0.017, 0.012, C(0xffffff), { x: 0.046, y: 0.012, z: 0.214 }),
  ]), glow));
  // 팔: 어깨(g)·팔꿈치(kn) 두 마디. 넓은 소매, 끝에 앙상한 손가락 넷
  const arms = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 0.3, 0.12, 0.02);
    torso.add(g);
    g.add(ghost([P(new THREE.CylinderGeometry(0.065, 0.1, 0.44, 9), pale, { y: -0.2 }), ell(0.1, 0.09, 0.1, pale)]));
    const kn = new THREE.Group();
    kn.position.y = -0.4;
    g.add(kn);
    const sleeve = [P(new THREE.CylinderGeometry(0.095, 0.15, 0.32, 10, 1, true), pale, { y: -0.15 }), P(new THREE.CylinderGeometry(0.09, 0.14, 0.3, 10, 1, true), fold, { y: -0.15, ry: 0.3, sx: 0.95, sz: 0.95 })];
    for (let k = 0; k < 2; k++) sleeve.push(cone(0.045, 0.22, fold, { x: (k ? 0.06 : -0.07), z: (k ? -0.05 : 0.04), y: -0.38, rx: Math.PI }));
    kn.add(ghost(sleeve));
    const hand = [ell(0.045, 0.06, 0.035, bone, { y: -0.3 })];
    for (let k = 0; k < 4; k++) hand.push(cyl(0.006, 0.011, 0.21, bone, { x: (k - 1.5) * 0.022, y: -0.43, z: 0.03, rx: -0.35 + k * 0.04 }));
    kn.add(mesh(merge(hand), m));
    arms.push({ g, kn, sx });
  }
  const tail = new THREE.Group();
  tail.position.y = -0.9;
  torso.add(tail);
  tail.add(ghost([0, 1, 2].map((i) => cone(0.08, 0.55, fold, { x: (i - 1) * 0.11, y: -0.25, z: -0.06, rx: Math.PI + 0.25 })), (x, y) => smooth01(-0.6, 0.1, y) * 0.6));
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  return { m, root, torso, legs: [], neck: null, head, tail, arms, glow, face, R, float: true, alpha: 0.8, emis: [0.1, 0.14, 0.18], L: 0.6 };
}

// 돌 해태(v0.5.1): 옛터 제단을 지키는 돌짐승. 다부진 몸, 굵은 다리, 곱슬 갈기와 외뿔, 넓은 입과 송곳니.
// 깎은 돌처럼 보이게 낮은 다면체에 면 그림자(flatShading)를 쓴다. 가슴에 맑은 영석이 박혀 있어
// 깨어나면 눈과 영석이 새파랗게 빛난다(glow 재질). 뼈대는 네발짐승과 같아서 걸음새·앉은 자세를 그대로 쓴다
const ellF = (rx, ry, rz, c, t = {}) => P(new THREE.IcosahedronGeometry(1, 1), c, { ...t, sx: rx, sy: ry, sz: rz });
const cylF = (r0, r1, h, c, t = {}) => P(new THREE.CylinderGeometry(r1, r0, h, 7), c, t);
const coneF = (r, h, c, t = {}) => P(new THREE.ConeGeometry(r, h, 5), c, t);
function haetae(seed) {
  const R0 = rng(seed);
  const stone = C(0xbfb7a5);
  const light = C(0xd3cbb9);
  const curl = C(0xa9a291);
  const dark = C(0x7a756a);
  const moss = C(0x6c7a4a);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, emissive: 0x000000, flatShading: true });
  const L = 1.5;
  const R = 0.42;
  const legLen = 0.75;
  const H = legLen + 0.2 * R;
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = H;
  root.add(torso);
  const body = [
    ellF(R * 0.95, R * 0.9, L * 0.48, stone),
    ellF(R * 1.06, R * 1.02, R * 1.0, stone, { z: L * 0.28, y: 0.05 }),
    ellF(R * 0.96, R * 0.92, R * 0.94, stone, { z: -L * 0.3, y: 0.02 }),
    ellF(R * 0.74, R * 0.5, L * 0.34, light, { y: -R * 0.46 }),
  ];
  // 등줄기 비늘판, 이끼 낀 자리
  for (let i = 0; i < 6; i++) body.push(ellF(0.15 - i * 0.008, 0.055, 0.12, i % 2 ? dark : stone, { y: R * 0.9 - Math.abs(i - 2.5) * 0.012, z: L * 0.3 - i * 0.2, rx: 0.12 }));
  for (let i = 0; i < 4; i++) body.push(ellF(0.13 + R0() * 0.07, 0.035, 0.11 + R0() * 0.05, moss, { x: (R0() - 0.5) * 0.36, y: R * 0.86, z: (R0() - 0.5) * 0.9, rz: (R0() - 0.5) * 0.4 }));
  // 목둘레 곱슬 갈기와 가슴의 영석 테두리
  for (let i = 0; i < 11; i++) {
    const a = -Math.PI * 0.85 + (i / 10) * Math.PI * 1.7;
    body.push(ellF(0.085, 0.085, 0.075, i % 2 ? curl : stone, { x: Math.sin(a) * R * 0.95, y: Math.cos(a) * R * 0.85 + 0.08, z: L * 0.36 }));
  }
  body.push(ellF(0.15, 0.18, 0.05, dark, { y: 0.0, z: L * 0.28 + R * 0.98 }));
  torso.add(mesh(merge(body), m));
  // 다리: 엉덩이(g)·무릎(kn) 두 마디. 굵은 다리 끝에 넓적한 발과 발톱 셋
  const legs = [];
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const g = new THREE.Group();
    g.position.set(sx * R * 0.6, -R * 0.2, sz * L * 0.36);
    torso.add(g);
    const l1 = legLen * 0.55;
    const l2 = legLen * 0.45;
    g.add(mesh(merge([cylF(0.15, 0.115, l1 * 1.05, stone, { y: -l1 * 0.5 }), ellF(0.17, 0.17, 0.19, stone, { y: -0.02 })]), m));
    const kn = new THREE.Group();
    kn.position.y = -l1;
    g.add(kn);
    const foot = [cylF(0.115, 0.1, l2 * 0.95, stone, { y: -l2 * 0.45 }), ellF(0.13, 0.075, 0.17, light, { y: -l2 + 0.03, z: 0.04 })];
    for (let k = -1; k <= 1; k++) foot.push(coneF(0.028, 0.09, dark, { x: k * 0.06, y: -l2 + 0.02, z: 0.2, rx: Math.PI / 2 }));
    kn.add(mesh(merge(foot), m));
    legs.push({ g, kn, ph, front: sz > 0, sx, l1, l2, hip: H - R * 0.2 });
  }
  const neckUp = 0.5;
  const neck = new THREE.Group();
  neck.position.set(0, R * 0.4, L * 0.42);
  neck.rotation.x = -neckUp;
  torso.add(neck);
  const nk = [ellF(0.27, 0.29, 0.3, stone, { z: 0.08 })];
  for (let i = 0; i < 6; i++) nk.push(ellF(0.08, 0.08, 0.075, i % 2 ? stone : curl, { x: (i % 2 ? -1 : 1) * 0.15, y: 0.2 - Math.floor(i / 2) * 0.12, z: -0.1 - Math.floor(i / 2) * 0.02 }));
  neck.add(mesh(merge(nk), m));
  const head = new THREE.Group();
  head.position.set(0, 0, 0.3);
  head.rotation.x = neckUp * 0.8;
  neck.add(head);
  const hd = [
    ellF(0.3, 0.27, 0.27, stone),
    ellF(0.27, 0.06, 0.1, dark, { y: 0.13, z: 0.17 }),
    ellF(0.075, 0.055, 0.04, dark, { x: -0.12, y: 0.05, z: 0.215 }),
    ellF(0.075, 0.055, 0.04, dark, { x: 0.12, y: 0.05, z: 0.215 }),
    ellF(0.22, 0.14, 0.17, light, { y: -0.08, z: 0.22 }),
    ellF(0.1, 0.06, 0.05, dark, { y: -0.02, z: 0.38 }),
    ellF(0.2, 0.05, 0.1, C(0x3a3732), { y: -0.17, z: 0.28 }),
    ellF(0.19, 0.065, 0.14, light, { y: -0.25, z: 0.2 }),
    coneF(0.055, 0.26, dark, { y: 0.32, z: 0.03, rx: -0.3 }),
    coneF(0.06, 0.13, stone, { x: -0.26, y: 0.15, z: -0.05, rz: 1.0 }),
    coneF(0.06, 0.13, stone, { x: 0.26, y: 0.15, z: -0.05, rz: -1.0 }),
  ];
  for (let k = 0; k < 5; k++) hd.push(P(new THREE.BoxGeometry(0.035, 0.035, 0.03), C(0xe0dacb), { x: (k - 2) * 0.042, y: -0.15, z: 0.355 - Math.abs(k - 2) * 0.012 }));
  for (const sx of [-1, 1]) hd.push(coneF(0.026, 0.11, C(0xe0dacb), { x: sx * 0.12, y: -0.18, z: 0.33, rx: Math.PI }));
  // 얼굴을 두르는 곱슬 갈기 두 겹과 볼 곱슬
  for (let i = 0; i < 13; i++) {
    const a = -Math.PI * 0.9 + (i / 12) * Math.PI * 1.8;
    hd.push(ellF(0.075, 0.075, 0.065, i % 2 ? curl : stone, { x: Math.sin(a) * 0.32, y: Math.cos(a) * 0.3 + 0.02, z: -0.08 }));
  }
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.8 + (i / 8) * Math.PI * 1.6;
    hd.push(ellF(0.06, 0.06, 0.055, i % 2 ? stone : curl, { x: Math.sin(a) * 0.25, y: Math.cos(a) * 0.23 + 0.04, z: -0.17 }));
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) hd.push(ellF(0.055, 0.055, 0.05, k ? curl : stone, { x: sx * (0.24 - k * 0.03), y: -0.1 - k * 0.09, z: 0.1 }));
  head.add(mesh(merge(hd), m));
  const glow = new THREE.MeshBasicMaterial({ color: 0x2e3438 });
  head.add(new THREE.Mesh(merge([
    ell(0.042, 0.032, 0.022, C(0xffffff), { x: -0.12, y: 0.05, z: 0.24 }),
    ell(0.042, 0.032, 0.022, C(0xffffff), { x: 0.12, y: 0.05, z: 0.24 }),
  ]), glow));
  torso.add(new THREE.Mesh(merge([ellF(0.085, 0.11, 0.05, C(0xffffff), { y: 0.0, z: L * 0.28 + R * 1.02 })]), glow));
  // 꼬리: 불꽃처럼 위로 말려 오르는 곱슬 덩이
  const tail = new THREE.Group();
  tail.position.set(0, R * 0.4, -L * 0.48);
  torso.add(tail);
  tail.add(mesh(merge([0, 1, 2, 3].map((i) => ellF(0.12 - i * 0.018, 0.11 - i * 0.015, 0.1 - i * 0.015, i % 2 ? curl : stone, { y: 0.06 + i * 0.11, z: -0.08 - Math.sin(i * 1.1) * 0.12 }))), m));
  root.scale.setScalar(1.45);
  return { m, root, torso, legs, neck, head, tail, glow, R: R0, L, H, rad: R, statue: true };
}

// 늪 이무기(v0.6.1): 용이 되지 못한 큰 뱀. 마디마다 따로 움직여 몸을 굽이친다(mobs-view의 serpentPose)
function imugi(seed) {
  const R0 = rng(seed);
  const back = C(0x26301f);
  const scale = C(0x3d4a2f);
  const belly = C(0x9a9460);
  const ridge = C(0x151a12);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const N = 16;
  const segs = [];
  const segZ = [];
  const segY = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const r = 0.5 * (1 - k * 0.82) + 0.06;
    const parts = [
      ell(r, r * 0.86, r * 1.25, scale),
      ell(r * 0.78, r * 0.4, r * 1.15, belly, { y: -r * 0.5 }),
      cone(r * 0.32, r * 0.9, ridge, { y: r * 0.95, rx: -0.5 }),
    ];
    if (i % 2 === 0) parts.push(ell(r * 0.5, r * 0.25, r * 0.7, back, { y: r * 0.7, z: -r * 0.2 }));
    const g = new THREE.Group();
    g.add(mesh(merge(parts), m));
    segZ.push(-i * 0.5);
    segY.push(r * 0.75);
    g.position.set(0, segY[i], segZ[i]);
    torso.add(g);
    segs.push(g);
  }
  // 머리: 길쭉한 주둥이, 눈두덩, 작은 뿔 둘(용이 되다 만 흔적), 수염
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.55);
  torso.add(head);
  const hd = [
    ell(0.42, 0.3, 0.55, scale, { z: 0.15 }),
    ell(0.3, 0.2, 0.42, back, { z: 0.55, y: -0.04 }),
    ell(0.34, 0.12, 0.5, belly, { y: -0.2, z: 0.3 }),
  ];
  for (const sx of [-1, 1]) {
    hd.push(ell(0.12, 0.08, 0.14, ridge, { x: sx * 0.24, y: 0.2, z: 0.28 }));
    hd.push(cone(0.06, 0.38, C(0x8a8470), { x: sx * 0.18, y: 0.3, z: -0.08, rx: -1.1, rz: -sx * 0.3 }));
    hd.push(cone(0.015, 0.7, C(0x6a6a50), { x: sx * 0.22, y: -0.08, z: 0.78, rx: 1.9, rz: sx * 0.5 }));
  }
  head.add(mesh(merge(hd), m));
  const eye = new THREE.MeshBasicMaterial({ color: 0xffc84a });
  head.add(new THREE.Mesh(merge([ell(0.06, 0.05, 0.04, C(0xffffff), { x: -0.27, y: 0.18, z: 0.38 }), ell(0.06, 0.05, 0.04, C(0xffffff), { x: 0.27, y: 0.18, z: 0.38 })]), eye));
  root.scale.setScalar(1.3 + R0() * 0.05);
  return { m, root, torso, legs: [], neck: null, head, tail: null, segs, segZ, segY, R: R0, L: 3.2, serpent: true };
}

const MAKERS = { crab, deer, boar, wolf, mist_wolf: mistWolf, mist_wraith: wraith, stone_haetae: haetae, imugi,
  // 여강의 망령(v0.6.1): 큰 망령
  yeogang_wraith: (seed) => {
    const q = wraith(seed);
    q.root.scale.setScalar(1.3);
    q.emis = [0.18, 0.16, 0.1];
    return q;
  },
  // 불과 서리 능선(v0.9): 기존 몸에 색을 입힌다(재질 색 × 꼭짓점 색)
  ash_wolf: (seed) => tint(wolf(seed), 0x6a625c, 0x3a1206, 1.08),
  frost_wolf: (seed) => tint(mistWolf(seed), 0xdfeaf6, 0x0a1622, 1.05),
  fire_guardian: (seed) => tint(haetae(seed), 0x9a7466, 0x5a1a04, 1.12),
  frost_guardian: (seed) => tint(haetae(seed), 0xd8e6f2, 0x123048, 1.12),
  // 안개의 심장(v1.3)
  storm_wraith: (seed) => tint(wraith(seed), 0x8a90c8, 0x1a2a58, 1.12),
  storm_wolf: (seed) => tint(mistWolf(seed), 0x7a7ca0, 0x101a3a, 1.1),
  gate_warden: (seed) => tint(haetae(seed), 0x9aa4c8, 0x1e3070, 1.2),
  first_keeper: (seed) => {
    const q = tint(wraith(seed), 0xf2e2b0, 0x6a5010, 1.7);
    return q;
  },
};

function tint(q, color, emissive, scale) {
  q.m.color.setHex(color);
  const e = new THREE.Color(emissive);
  q.emis = [e.r, e.g, e.b];
  q.root.scale.multiplyScalar(scale);
  return q;
}

export function makeCreature(type, seed) {
  const q = MAKERS[type](seed);
  q.type = type;
  return q;
}

// 탈것(v3.2)이 같은 몸 짜기를 쓴다
export { quadruped, material, mesh, ell, cyl, cone };
