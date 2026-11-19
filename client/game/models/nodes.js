// 자원 노드 모형. 종류마다 모양 변형을 몇 개 만들고, 조각(줄기·가지·잎 등)마다 재질이 다르다.
// when: 'live'는 캘 수 있을 때만, 'empty'는 다 캤을 때만, 'both'는 늘 보인다.
// shrink: 다 캤을 때 줄어드는 비율(1이면 그대로).

import * as THREE from 'three';
import { rng, P, xf, merge, taperTube, bentPath, rockGeo, leafCard, lathe, prep } from './build.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function birch(seed) {
  const R = rng(seed);
  const H = 7.4 + R() * 1.8;
  const pts = bentPath(V(0, -0.35, 0), V(0, 1, 0), H, 16, V((R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3), R);
  const radii = pts.map((_, i) => 0.2 * Math.pow(1 - (i / (pts.length - 1)) * 0.86, 1.15) + (i < 2 ? 0.04 : 0));
  const trunk = taperTube(pts, radii, { radial: 10, vScale: 2.2 });
  const branches = [];
  const centers = [];
  const nb = 9 + Math.floor(R() * 3);
  for (let b = 0; b < nb; b++) {
    const t = 0.36 + (b / nb) * 0.56 + (R() - 0.5) * 0.06;
    const i = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const yaw = b * 2.4 + R() * 0.8;
    const dir = V(Math.cos(yaw), 0.55 + R() * 0.5, Math.sin(yaw));
    const L = (1.5 + R() * 1.3) * (1.15 - t * 0.55);
    const bp = bentPath(pts[i], dir, L, 5, V(0, 0.5, 0), R);
    branches.push(taperTube(bp, bp.map((_, k) => radii[i] * 0.42 * (1 - (k / (bp.length - 1)) * 0.85)), { radial: 5, vScale: 2.2 }));
    for (let k = 2; k < bp.length; k++) centers.push(bp[k]);
  }
  for (let k = 0; k < 6; k++) centers.push(pts[pts.length - 1 - k]);
  const crown = V(0, H * 0.7, 0);
  const cards = [];
  for (const c of centers) {
    for (let k = 0; k < 4; k++) {
      const o = V((R() - 0.5) * 1.1, (R() - 0.65) * 1.0, (R() - 0.5) * 1.1);
      cards.push(leafCard(c.clone().add(o), 1.15 + R() * 0.55, R() * Math.PI * 2, (R() - 0.5) * 1.1, crown));
    }
  }
  const stump = taperTube([V(0, -0.3, 0), V(0, 0.2, 0), V(0, 0.42, 0)], [0.26, 0.21, 0.2], { radial: 10, vScale: 2.2, cap: true });
  return [
    { geo: trunk, mat: 'birch', when: 'live' },
    { geo: merge(branches), mat: 'birch', when: 'live' },
    { geo: merge(cards), mat: 'birchLeaves', when: 'live', leaves: 'birchLeaves' },
    { geo: stump, mat: 'birch', when: 'empty' },
  ];
}

function stonePile(seed) {
  const R = rng(seed);
  const parts = [];
  const n = 3 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 0.5 + R() * 0.2 : 0.22 + R() * 0.25;
    const a = R() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.45 + R() * 0.35;
    parts.push(xf(rockGeo(seed * 7 + i, r, { sy: 0.55 + R() * 0.3, sx: 0.9 + R() * 0.3, rough: 0.3 }), {
      x: Math.cos(a) * d, z: Math.sin(a) * d, y: -0.05, ry: R() * 6,
    }));
  }
  return [{ geo: merge(parts), mat: 'rock', when: 'both', shrink: 0.45 }];
}

function copperRock(seed) {
  const R = rng(seed);
  const parts = [xf(rockGeo(seed * 5 + 1, 1.0, { sy: 0.78, sx: 1.15, rough: 0.34, detail: 4 }), { y: -0.1, ry: R() * 6 })];
  for (let i = 0; i < 3; i++) {
    const a = R() * Math.PI * 2;
    parts.push(xf(rockGeo(seed * 5 + 2 + i, 0.3 + R() * 0.25, { sy: 0.7, rough: 0.3 }), { x: Math.cos(a) * 1.15, z: Math.sin(a) * 1.15, y: -0.06 }));
  }
  return [{ geo: merge(parts), mat: 'copper', when: 'both', shrink: 0.6 }];
}

function driftwood(seed) {
  const R = rng(seed);
  const logs = [];
  const n = 2 + Math.floor(R() * 2);
  for (let i = 0; i < n; i++) {
    const L = 1.8 + R() * 1.4;
    const yaw = R() * Math.PI * 2;
    const r0 = 0.13 + R() * 0.07;
    const start = V(Math.cos(yaw) * -L / 2 + (R() - 0.5) * 0.6, r0 * 0.75 + i * 0.12, Math.sin(yaw) * -L / 2 + (R() - 0.5) * 0.6);
    const pts = bentPath(start, V(Math.cos(yaw), 0.02, Math.sin(yaw)), L, 8, V((R() - 0.5) * 0.4, 0, (R() - 0.5) * 0.4), R);
    logs.push(taperTube(pts, pts.map((_, k) => r0 * (1 - (k / (pts.length - 1)) * 0.45)), { radial: 9, vScale: 1.4, cap: true }));
    // 뿌리 쪽 혹과 잔가지
    if (R() < 0.7) {
      for (let k = 0; k < 3; k++) {
        const a = R() * Math.PI * 2;
        const rp = bentPath(start, V(Math.cos(a) * 0.6 - Math.cos(yaw), Math.sin(a) * 0.5, Math.sin(a) * 0.6 - Math.sin(yaw)), 0.35 + R() * 0.3, 3, V(0, -0.4, 0), R);
        logs.push(taperTube(rp, rp.map((_, q) => r0 * 0.45 * (1 - q / (rp.length - 1) * 0.8)), { radial: 5, vScale: 1.4 }));
      }
    }
  }
  return [{ geo: merge(logs), mat: 'driftwood', when: 'both', shrink: 0.4 }];
}

function bladeStrip(x, z, h, w, lean, yaw, c0, c1, segs = 4) {
  const g = new THREE.PlaneGeometry(w, h, 1, segs);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(c0);
  const b = new THREE.Color(c1);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) * (1 - t * 0.85));
    p.setZ(i, lean * t * t * h);
    c.copy(a).lerp(b, t);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  xf(g, { ry: yaw });
  g.translate(x, 0, z);
  return prep(g);
}

function reeds(seed) {
  const R = rng(seed);
  const parts = [];
  for (let i = 0; i < 46; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * 0.75;
    parts.push(bladeStrip(Math.cos(a) * d, Math.sin(a) * d, 1.1 + R() * 0.9, 0.05 + R() * 0.03, 0.15 + R() * 0.35, R() * 6.28, 0x2d4a1a, R() < 0.3 ? 0xb8a860 : 0x7d9a45));
  }
  for (let i = 0; i < 9; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * 0.6;
    const h = 1.5 + R() * 0.5;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    parts.push(P(new THREE.CylinderGeometry(0.008, 0.012, h, 4), 0x6f7f3a, { x, y: h / 2, z }));
    parts.push(P(new THREE.CapsuleGeometry(0.03, 0.18, 2, 6), 0x5a3a20, { x, y: h - 0.12, z }));
  }
  return [{ geo: merge(parts), mat: 'reed', when: 'both', shrink: 0.3 }];
}

function berryBush(seed) {
  const R = rng(seed);
  const cards = [];
  const stems = [];
  const berries = [];
  const crown = V(0, 0.55, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + R() * 0.5;
    const sp = bentPath(V(0, 0, 0), V(Math.cos(a) * 0.7, 1, Math.sin(a) * 0.7), 0.9 + R() * 0.3, 4, V(Math.cos(a) * 0.4, -0.5, Math.sin(a) * 0.4), R);
    stems.push(taperTube(sp, sp.map((_, k) => 0.025 * (1 - k / (sp.length - 1) * 0.7)), { radial: 4, vScale: 1 }));
  }
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2;
    const el = R() * 1.2;
    const r = 0.45 + R() * 0.35;
    const c = V(Math.cos(a) * Math.cos(el) * r * 1.1, 0.25 + Math.sin(el) * r * 0.8, Math.sin(a) * Math.cos(el) * r * 1.1);
    cards.push(leafCard(c, 0.55 + R() * 0.3, R() * 6.28, (R() - 0.5) * 1.4, crown));
  }
  const berry = new THREE.Color();
  for (let i = 0; i < 16; i++) {
    const a = R() * Math.PI * 2;
    const el = R() * 1.0;
    const r = 0.62 + R() * 0.18;
    const cx = Math.cos(a) * Math.cos(el) * r * 1.1;
    const cy = 0.28 + Math.sin(el) * r * 0.8;
    const cz = Math.sin(a) * Math.cos(el) * r * 1.1;
    for (let k = 0; k < 3; k++) {
      berry.setHSL(0.985 + R() * 0.02, 0.75, 0.32 + R() * 0.1);
      berries.push(P(new THREE.IcosahedronGeometry(0.032 + R() * 0.01, 1), berry.getHex(), { x: cx + (R() - 0.5) * 0.08, y: cy + (R() - 0.5) * 0.06, z: cz + (R() - 0.5) * 0.08 }));
    }
  }
  return [
    { geo: merge(cards), mat: 'bushLeaves', when: 'both', leaves: 'bushLeaves', shrink: 0.85 },
    { geo: merge(stems), mat: 'barkDark', when: 'both', shrink: 0.85 },
    { geo: merge(berries), mat: 'berry', when: 'live' },
  ];
}

function seaweed(seed) {
  const R = rng(seed);
  const rock = xf(rockGeo(seed * 3 + 2, 0.75, { sy: 0.5, sx: 1.2, rough: 0.32 }), { y: -0.12 });
  const strips = [];
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2;
    const g = bladeStrip(0, 0, 0.9 + R() * 0.6, 0.12 + R() * 0.06, -0.6, 0, 0x4a4418, R() < 0.5 ? 0x8a7a2a : 0x5e6a24, 6);
    // 바위 위에서 바깥으로 늘어진다
    xf(g, { rx: Math.PI / 2 - 0.35, ry: a });
    g.translate(Math.cos(a) * 0.25, 0.42, Math.sin(a) * 0.25);
    strips.push(g);
  }
  return [
    { geo: rock, mat: 'rockWet', when: 'both' },
    { geo: merge(strips), mat: 'seaweed', when: 'live' },
  ];
}

function mushrooms(seed) {
  const R = rng(seed);
  const parts = [];
  const n = 6 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * 0.45;
    const s = 0.7 + R() * 0.8;
    const tilt = (R() - 0.5) * 0.4;
    const capC = new THREE.Color().setHSL(0.07 + R() * 0.03, 0.45 + R() * 0.2, 0.28 + R() * 0.14);
    const stem = lathe([[0.0, 0], [0.032, 0], [0.036, 0.04], [0.028, 0.12], [0.03, 0.15], [0, 0.15]], 10, 0xd9cdb4);
    const cap = lathe([[0, 0.205], [0.05, 0.2], [0.1, 0.18], [0.135, 0.145], [0.14, 0.13], [0.11, 0.128], [0.05, 0.145], [0, 0.15]], 16, capC.getHex());
    const capG = cap;
    // 갓 아랫면(주름)은 밝게
    const col = capG.attributes.color;
    const pos = capG.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < 0.15 && Math.hypot(pos.getX(k), pos.getZ(k)) < 0.13) col.setXYZ(k, 0.78, 0.7, 0.58);
    }
    parts.push(xf(merge([stem, capG]), { s, rz: tilt, rx: tilt * 0.6, x: Math.cos(a) * d, z: Math.sin(a) * d }));
  }
  return [{ geo: merge(parts), mat: 'mushroom', when: 'both', shrink: 0.35 }];
}

// 참나무(T2): 굵고 짧은 줄기, 옆으로 퍼지는 큰 가지, 짙은 잎 덩이
function oak(seed) {
  const R = rng(seed);
  const H = 4.2 + R() * 1.0;
  const pts = bentPath(V(0, -0.4, 0), V(0, 1, 0), H, 10, V((R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5), R);
  const radii = pts.map((_, i) => 0.42 * Math.pow(1 - (i / (pts.length - 1)) * 0.7, 1.1) + (i < 2 ? 0.12 : 0));
  const trunk = taperTube(pts, radii, { radial: 12, vScale: 1.5 });
  const branches = [];
  const centers = [];
  const nb = 6 + Math.floor(R() * 3);
  for (let b = 0; b < nb; b++) {
    const t = 0.5 + (b / nb) * 0.45;
    const i = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const yaw = b * 2.3 + R() * 0.7;
    const dir = V(Math.cos(yaw), 0.35 + R() * 0.35, Math.sin(yaw));
    const L = 2.4 + R() * 1.6;
    const bp = bentPath(pts[i], dir, L, 6, V(0, 0.35, 0), R);
    branches.push(taperTube(bp, bp.map((_, k) => radii[i] * 0.55 * (1 - (k / (bp.length - 1)) * 0.8)), { radial: 6, vScale: 1.5 }));
    for (let k = 2; k < bp.length; k++) centers.push(bp[k]);
  }
  for (let k = 0; k < 4; k++) centers.push(pts[pts.length - 1 - k]);
  const crown = V(0, H + 1.2, 0);
  const cards = [];
  for (const c of centers) {
    for (let k = 0; k < 5; k++) {
      const o = V((R() - 0.5) * 1.6, (R() - 0.4) * 1.1, (R() - 0.5) * 1.6);
      cards.push(leafCard(c.clone().add(o), 1.5 + R() * 0.7, R() * Math.PI * 2, (R() - 0.5) * 0.9, crown));
    }
  }
  const stump = taperTube([V(0, -0.35, 0), V(0, 0.25, 0), V(0, 0.5, 0)], [0.6, 0.5, 0.47], { radial: 12, vScale: 1.5, cap: true });
  return [
    { geo: trunk, mat: 'barkDark', when: 'live' },
    { geo: merge(branches), mat: 'barkDark', when: 'live' },
    { geo: merge(cards), mat: 'bushLeaves', when: 'live', leaves: 'bushLeaves' },
    { geo: stump, mat: 'barkDark', when: 'empty' },
  ];
}

function ironRock(seed) {
  const R = rng(seed);
  const parts = [xf(rockGeo(seed * 7 + 3, 1.15, { sy: 0.85, sx: 1.05, rough: 0.4, detail: 4 }), { y: -0.12, ry: R() * 6 })];
  for (let i = 0; i < 4; i++) {
    const a = R() * Math.PI * 2;
    parts.push(xf(rockGeo(seed * 7 + 4 + i, 0.28 + R() * 0.3, { sy: 0.8, rough: 0.35 }), { x: Math.cos(a) * 1.25, z: Math.sin(a) * 1.25, y: -0.05 }));
  }
  return [{ geo: merge(parts), mat: 'ironOre', when: 'both', shrink: 0.6 }];
}

// 종류 → 변형 목록(변형마다 조각 목록)
export function buildNodeModels() {
  return {
    node_birch: [birch(101), birch(202), birch(303)],
    node_stone: [stonePile(11), stonePile(12), stonePile(13)],
    node_copper: [copperRock(21), copperRock(22)],
    node_driftwood: [driftwood(31), driftwood(32), driftwood(33)],
    node_reed: [reeds(41), reeds(42)],
    node_berry: [berryBush(51), berryBush(52)],
    node_seaweed: [seaweed(61), seaweed(62)],
    node_mushroom: [mushrooms(71), mushrooms(72)],
    node_oak: [oak(81), oak(82), oak(83)],
    node_iron: [ironRock(91), ironRock(92)],
  };
}

// 채집할 때 튀는 조각 색
export const NODE_CHIP = {
  node_driftwood: 0xa59a88, node_birch: 0xe8e2d2, node_stone: 0x8c8780, node_copper: 0xc07a45,
  node_reed: 0x9aa860, node_berry: 0xb02838, node_seaweed: 0x4a5a22, node_mushroom: 0x9a7048,
  node_oak: 0x6a4a2c, node_iron: 0x6a4a3a,
};
