// 장식 식물과 돌: 섬 가장자리 숲(들어갈 수 없는 곳), 들판의 덤불·들꽃·잔돌.
// v0.4.2: 비탈의 바위 무더기, 숲 속 이끼 바위·쓰러진 나무·그루터기·고사리를 더했다.
// 채집할 수 없는 장식이라 충돌이 없다. 화질 단계에 따라 개수를 줄인다.

import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three-addons';
import { rng, xf, merge, prep, taperTube, bentPath, rockGeo, leafCard, n3 } from '../models/build.js';
import { AREA } from './terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 전나무(v0.4.2): 줄기 + 층층이 돌려나는 가지 카드. 아래 가지는 길고 처지며 위로 갈수록 짧아진다.
// 가까이는 가지가 촘촘한 수관, 멀리는 같은 모양을 큰 카드 몇 장으로 줄인 수관을 쓴다(삼각형 1/5).
function pineCrown(R, H, base, { gap, per, grow, wide }) {
  const cards = [];
  let y = base;
  while (y < H - 0.4) {
    const t = (y - base) / (H - base);
    const len = ((1 - t) * H * 0.24 + 0.45) * grow;
    const nb = per + Math.floor(R() * 3);
    const rot0 = R() * 6.28;
    for (let b = 0; b < nb; b++) {
      const a = rot0 + (b / nb) * Math.PI * 2 + (R() - 0.5) * 0.5;
      const L = len * (0.8 + R() * 0.35);
      const g = new THREE.PlaneGeometry(L, L * wide);
      g.rotateX(-Math.PI / 2);
      g.translate(L / 2 + 0.05, 0, 0);
      xf(g, { rz: -(0.22 + R() * 0.25 + (1 - t) * 0.18), rx: (R() - 0.5) * 0.5 });
      xf(g, { ry: a, y: y + (R() - 0.5) * 0.15 });
      const p = g.attributes.position;
      const n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const d = V(p.getX(i), 0, p.getZ(i)).normalize();
        n.setXYZ(i, d.x * 0.62, 0.78, d.z * 0.62);
      }
      cards.push(g);
    }
    y += gap * (0.5 + R() * 0.3 + t * 0.15);
  }
  const top = new THREE.PlaneGeometry(1.4, 0.5);
  xf(top, { rz: Math.PI / 2, y: H - 0.1 });
  const top2 = top.clone();
  xf(top2, { ry: Math.PI / 2 });
  cards.push(top, top2);
  return merge(cards.map((g) => { const c = g.toNonIndexed(); c.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 3).fill(1), 3)); return c; }));
}

function pine(seed) {
  const R = rng(seed);
  const H = 12 + R() * 6;
  const pts = bentPath(V(0, -0.5, 0), V(0, 1, 0), H, 7, V((R() - 0.5) * 0.08, 0, (R() - 0.5) * 0.08), R);
  const trunk = taperTube(pts, pts.map((_, i) => 0.3 * (1 - (i / (pts.length - 1)) * 0.9)), { radial: 6, vScale: 2 });
  const base = H * (0.2 + R() * 0.1);
  const crown = pineCrown(R, H, base, { gap: 1, per: 5, grow: 1, wide: 0.5 });
  const far = pineCrown(rng(seed * 7 + 3), H, base, { gap: 2.1, per: 4, grow: 1.18, wide: 0.75 });
  return { trunk, crown, far };
}

function bush(seed, size) {
  const R = rng(seed);
  const crown = V(0, size * 0.45, 0);
  const cards = [];
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2;
    const el = R() * 1.2;
    const r = size * (0.5 + R() * 0.4);
    cards.push(leafCard(V(Math.cos(a) * Math.cos(el) * r, size * 0.2 + Math.sin(el) * r * 0.8, Math.sin(a) * Math.cos(el) * r), size * (0.6 + R() * 0.3), R() * 6.28, (R() - 0.5) * 1.4, crown));
  }
  return merge(cards);
}

function flowerTuft() {
  const a = new THREE.PlaneGeometry(0.42, 0.42);
  a.translate(0, 0.2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const out = [a, b].map((g) => {
    const c = g.toNonIndexed();
    c.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 3).fill(1), 3));
    const n = c.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0.3);
    return c;
  });
  return merge(out);
}

// 모난 바위(절벽 조각): 울퉁불퉁한 공을 무작위 평면 여러 장으로 깎고, 가로 결(지층)을 살짝 계단지게 한다
function crag(seed) {
  const R = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const planes = [];
  for (let i = 0; i < 9; i++) planes.push([V(R() - 0.5, (R() - 0.5) * 0.8, R() - 0.5).normalize(), 0.55 + R() * 0.3]);
  planes.push([V((R() - 0.5) * 0.3, 1, (R() - 0.5) * 0.3).normalize(), 0.45 + R() * 0.25]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.9 + (n3(v.x * 2.1 + seed, v.y * 2.1, v.z * 2.1) - 0.5) * 0.35);
    for (const [n, d] of planes) {
      const t = v.dot(n);
      if (t > d) v.addScaledVector(n, -(t - d));
    }
    const ys = Math.round(v.y / 0.22) * 0.22;
    v.y += (ys - v.y) * 0.35;
    if (v.y < -0.55) v.y = -0.55 + (v.y + 0.55) * 0.2;
    p.setXYZ(i, v.x, v.y + 0.55, v.z);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return prep(toCreasedNormals(m, 0.6));
}

// 쓰러진 나무: 휘어진 통나무 + 부러진 가지 두셋. 땅에 반쯤 묻히게 놓는다
function log(seed) {
  const R = rng(seed);
  const L = 3.5 + R() * 3;
  const r0 = 0.22 + R() * 0.12;
  const pts = bentPath(V(-L / 2, r0 * 0.75, 0), V(1, 0, 0), L, 8, V(0, (R() - 0.5) * 0.04, (R() - 0.5) * 0.15), R);
  const parts = [taperTube(pts, pts.map((_, i) => r0 * (1 - (i / (pts.length - 1)) * 0.35)), { radial: 9, vScale: 2, cap: true })];
  const nb = 2 + Math.floor(R() * 2);
  for (let b = 0; b < nb; b++) {
    const base = pts[Math.floor((0.25 + R() * 0.6) * (pts.length - 1))];
    const dir = V((R() - 0.5) * 0.6, 0.5 + R() * 0.6, (R() > 0.5 ? 1 : -1) * (0.5 + R() * 0.5)).normalize();
    parts.push(taperTube([base.clone(), base.clone().addScaledVector(dir, 0.5 + R() * 0.9)], [r0 * 0.3, r0 * 0.14], { radial: 6, vScale: 2, cap: true }));
  }
  return merge(parts);
}

// 그루터기: 짧은 줄기와 뿌리 넷
function stump(seed) {
  const R = rng(seed);
  const r = 0.28 + R() * 0.14;
  const h = 0.35 + R() * 0.45;
  const parts = [taperTube([V(0, -0.15, 0), V(0, h * 0.5, 0), V(0, h, 0)], [r * 1.25, r * 1.02, r], { radial: 10, vScale: 1.2, cap: true })];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + R() * 0.6;
    parts.push(taperTube([V(Math.cos(a) * r * 0.6, 0.14, Math.sin(a) * r * 0.6), V(Math.cos(a) * r * 2, -0.08, Math.sin(a) * r * 2)], [r * 0.35, r * 0.1], { radial: 6, vScale: 1 }));
  }
  return merge(parts);
}

// 고사리: 휘어진 잎 카드 6~8장을 둥글게. 잎자루에서 솟았다가 끝으로 늘어진다
function fern(seed) {
  const R = rng(seed);
  const n = 6 + Math.floor(R() * 3);
  const fronds = [];
  for (let f = 0; f < n; f++) {
    const yaw = (f / n) * Math.PI * 2 + R() * 0.5;
    const L = 0.7 + R() * 0.45;
    const W = 0.36 * L;
    const seg = 6;
    const up0 = 0.95 + R() * 0.3;
    const pos = [];
    const uv = [];
    const nor = [];
    const idx = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const ang = up0 - t * (up0 + 0.35);
      if (i > 0) {
        x += Math.cos(ang) * L / seg;
        y += Math.sin(ang) * L / seg;
      }
      const wk = t < 0.12 ? t / 0.12 : 1;
      for (const sd of [-1, 1]) {
        const w = W * 0.5 * sd * wk;
        pos.push(x, y + Math.abs(w) * 0.18, w);
        uv.push(sd < 0 ? 0 : 1, t);
        nor.push(0.25, 1, 0);
      }
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    fronds.push(xf(prep(g), { ry: yaw }));
  }
  const out = merge(fronds);
  const nn = out.attributes.normal;
  for (let i = 0; i < nn.count; i++) {
    const v = V(nn.getX(i), nn.getY(i), nn.getZ(i)).normalize();
    nn.setXYZ(i, v.x, v.y, v.z);
  }
  return out;
}

function instanced(scene, geo, mat, list, { shadow = false, depthMap = null } = {}) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  list.forEach((t, i) => {
    d.position.set(t.x, t.y, t.z);
    d.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    if (t.sx) d.scale.set(t.sx, t.sy, t.sz);
    else d.scale.setScalar(t.s || 1);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  });
  m.castShadow = shadow;
  m.receiveShadow = true;
  if (depthMap) m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: depthMap, alphaTest: 0.45 });
  m.computeBoundingSphere();
  scene.add(m);
  return m;
}

export function createFlora(scene, { hf, paths, ground, region, tier, mats, ctex, game }) {
  const groundAt = (_hf, _paths, x, z) => ground.groundAt(x, z);
  const canopy = ground.canopy;
  const R = rng(region.id.length * 9973 + 17);
  const k = tier.flora;
  const [bx0, bz0, bx1, bz1] = region.bounds;
  const edge = region.terrain.edge ?? 12;
  const towns = region.settlements;
  const nodes = Object.values(game.state.nodes);
  const nearNode = (x, z, r) => nodes.some((n) => Math.abs(n.x - x) < r && Math.abs(n.z - z) < r && Math.hypot(n.x - x, n.z - z) < r);

  // 가장자리 숲
  const pines = [pine(1), pine(2), pine(3)];
  const pineLists = [[], [], []];
  const bushGeo = [bush(5, 1.0), bush(6, 1.4)];
  const bushLists = [[], []];
  const step = 7.5 / Math.sqrt(k);
  for (let z = AREA.z0; z < AREA.z0 + AREA.size; z += step) {
    for (let x = AREA.x0; x < AREA.x0 + AREA.size; x += step) {
      const px = x + (R() - 0.5) * step * 0.9;
      const pz = z + (R() - 0.5) * step * 0.9;
      const inBand = px < bx0 + edge - 1 || px > bx1 - edge + 1 || pz > bz1 - edge + 1;
      if (!inBand) continue;
      const h = hf.height(px, pz);
      if (h < 2.2 || hf.slope(px, pz) > 0.7) continue;
      const v = Math.floor(R() * 3);
      pineLists[v].push({ x: px, y: h - 0.2, z: pz, ry: R() * 6.28, s: 0.75 + R() * 0.5 });
      if (R() < 0.5) bushLists[Math.floor(R() * 2)].push({ x: px + (R() - 0.5) * 4, y: h - 0.1, z: pz + (R() - 0.5) * 4, ry: R() * 6.28, s: 0.8 + R() * 0.6 });
    }
  }

  // 참나무 숲(v0.3): 구역 안쪽에 배경 나무와 덤불을 촘촘히 세운다(캘 수 있는 참나무는 노드로 따로 있다)
  const zone = (region.zones || [])[0];
  if (zone) {
    const fstep = 9 / Math.sqrt(k);
    const groups = Object.values(game.state.mobGroups || {});
    for (let z = zone.z0 + 4; z < bz1 - edge; z += fstep) {
      for (let x = bx0 + edge; x < bx1 - edge; x += fstep) {
        const px = x + (R() - 0.5) * fstep * 0.9;
        const pz = z + (R() - 0.5) * fstep * 0.9;
        if (R() > 0.3 + Math.min(0.25, (pz - zone.z0) / 300)) continue;
        if (nearNode(px, pz, 4.5) || groups.some((g) => Math.hypot(g.x - px, g.z - pz) < g.radius + 3)) continue;
        if (towns.some((town) => Math.hypot(px - town.x, pz - town.z) < town.radius + 6)) continue;
        const g = groundAt(hf, paths, px, pz);
        if (g.path > 0.15 || hf.slope(px, pz) > 0.6) continue;
        const v = Math.floor(R() * 3);
        pineLists[v].push({ x: px, y: g.h - 0.2, z: pz, ry: R() * 6.28, s: 0.6 + R() * 0.45 });
        if (R() < 0.6) bushLists[Math.floor(R() * 2)].push({ x: px + (R() - 0.5) * 5, y: g.h - 0.1, z: pz + (R() - 0.5) * 5, ry: R() * 6.28, s: 0.7 + R() * 0.6 });
      }
    }
  }

  // 나무 그늘 지도: 낙엽 바닥을 깔고, 그림자 범위 밖 숲을 어둡게 한다
  if (canopy) {
    for (const list of pineLists) for (const t of list) canopy.add(t.x, t.z, 3.2 * t.s, 1);
    for (const list of bushLists) for (const t of list) canopy.add(t.x, t.z, 1.3 * t.s, 0.5);
    for (const n of nodes) {
      if (n.type === 'node_oak') canopy.add(n.x, n.z, 5, 0.9);
      else if (n.type === 'node_birch') canopy.add(n.x, n.z, 3, 0.6);
    }
    canopy.commit();
  }

  // 들판: 덤불·들꽃·잔돌
  const flowers = [];
  const rocks = [[], []];
  const inner = 3 / Math.sqrt(k);
  for (let z = bz0 + 2; z < bz1 - edge; z += inner) {
    for (let x = bx0 + edge; x < bx1 - edge; x += inner) {
      const px = x + (R() - 0.5) * inner;
      const pz = z + (R() - 0.5) * inner;
      if (towns.some((town) => Math.hypot(px - town.x, pz - town.z) < town.radius + 4)) continue;
      const g = groundAt(hf, paths, px, pz);
      if (g.path > 0.2) continue;
      const roll = R();
      if (g.grass > 0.6 && g.h > 1.8) {
        if (roll < 0.05 * k * 3 && !nearNode(px, pz, 2.5)) flowers.push({ x: px, y: g.h - 0.02, z: pz, ry: R() * 6.28, s: 0.7 + R() * 0.6 });
        else if (roll > 0.994 && !nearNode(px, pz, 3)) bushLists[Math.floor(R() * 2)].push({ x: px, y: g.h - 0.1, z: pz, ry: R() * 6.28, s: 0.55 + R() * 0.35 });
      }
      if ((g.rock > 0.3 || (g.sand > 0.5 && g.h > 0.4)) && roll > 0.97 && !nearNode(px, pz, 2)) {
        rocks[Math.floor(R() * 2)].push({ x: px, y: g.h - 0.05, z: pz, ry: R() * 6.28, s: 0.5 + R() * 0.7 });
      }
    }
  }
  // 바위 무더기: 비탈(경사)에 모여 있고, 숲 속에는 이끼 바위가 드문드문, 들판에는 아주 드물게
  const cragGeo = [crag(301), crag(302), crag(303), crag(304)];
  const cragBare = [[], [], [], []];
  const cragMoss = [[], [], [], []];
  const cstep = 5.5 / Math.sqrt(k);
  const inZone = (z) => zone && z > zone.z0;
  for (let z = bz0 + 4; z < bz1 - 4; z += cstep) {
    for (let x = bx0 + 4; x < bx1 - 4; x += cstep) {
      const px = x + (R() - 0.5) * cstep * 0.9;
      const pz = z + (R() - 0.5) * cstep * 0.9;
      const h = hf.height(px, pz);
      if (h < 1.2) continue;
      const sl = hf.slope(px, pz);
      let p = sl > 0.3 ? Math.min(1, (sl - 0.3) / 0.25) * 0.55 : 0;
      if (inZone(pz)) p += 0.035;
      p += 0.004;
      if (R() > p) continue;
      if (towns.some((town) => Math.hypot(px - town.x, pz - town.z) < town.radius + 8)) continue;
      if (paths.sample(px, pz) > 0.05 || nearNode(px, pz, 4)) continue;
      const g = groundAt(hf, paths, px, pz);
      const mossy = inZone(pz) || g.canopy > 0.3 || R() < 0.3;
      const n = 1 + Math.floor(R() * (sl > 0.35 ? 3 : 2));
      for (let i = 0; i < n; i++) {
        const qx = px + (R() - 0.5) * 4;
        const qz = pz + (R() - 0.5) * 4;
        const s = (sl > 0.35 ? 1.1 : 0.7) + R() * (sl > 0.35 ? 1.8 : 1.0);
        const v = Math.floor(R() * 4);
        (mossy ? cragMoss : cragBare)[v].push({
          x: qx, y: hf.height(qx, qz) - s * 0.28, z: qz, ry: R() * 6.28, rx: (R() - 0.5) * 0.3, rz: (R() - 0.5) * 0.3,
          sx: s * (0.8 + R() * 0.6), sy: s * (0.55 + R() * 0.45), sz: s * (0.8 + R() * 0.6),
        });
      }
    }
  }

  // 숲 바닥: 쓰러진 나무·그루터기·고사리(참나무 숲과 가장자리 숲 안쪽)
  const logGeo = [log(401), log(402), log(403)];
  const stumpGeo = [stump(501), stump(502)];
  const fernGeo = [fern(601), fern(602), fern(603)];
  const logLists = [[], [], []];
  const stumpLists = [[], []];
  const fernLists = [[], [], []];
  const fstep2 = 2.6 / Math.sqrt(k);
  for (let z = bz0 + 4; z < bz1 - 2; z += fstep2) {
    for (let x = bx0 + 2; x < bx1 - 2; x += fstep2) {
      const px = x + (R() - 0.5) * fstep2;
      const pz = z + (R() - 0.5) * fstep2;
      const band = px < bx0 + edge + 6 || px > bx1 - edge - 6 || pz > bz1 - edge - 6;
      const wood = inZone(pz) || band;
      if (!wood) continue;
      const g = groundAt(hf, paths, px, pz);
      if (g.path > 0.1 || g.h < 1.6 || g.rock > 0.4) continue;
      const shade = Math.max(g.canopy, inZone(pz) ? 0.5 : 0);
      if (shade < 0.25) continue;
      const roll = R();
      if (nearNode(px, pz, 2.5)) continue;
      if (roll < 0.3 * shade) {
        fernLists[Math.floor(R() * 3)].push({ x: px, y: g.h - 0.05, z: pz, ry: R() * 6.28, s: 0.7 + R() * 0.6 });
      } else if (roll > 0.988 - 0.008 * shade) {
        const v = Math.floor(R() * 3);
        const ry = R() * 6.28;
        const L = 5;
        const dx = Math.cos(ry) * L * 0.5;
        const dz = -Math.sin(ry) * L * 0.5;
        const dh = hf.height(px + dx, pz + dz) - hf.height(px - dx, pz - dz);
        logLists[v].push({ x: px, y: g.h - 0.12, z: pz, ry, rz: Math.atan2(dh, L), s: 0.85 + R() * 0.35 });
      } else if (roll > 0.976 - 0.008 * shade) {
        stumpLists[Math.floor(R() * 2)].push({ x: px, y: g.h - 0.05, z: pz, ry: R() * 6.28, s: 0.8 + R() * 0.5 });
      }
    }
  }
  const hiShadow = tier.id === 'high';
  cragGeo.forEach((geo, i) => {
    instanced(scene, geo, mats.rockBare, cragBare[i], { shadow: tier.id !== 'low' });
    instanced(scene, geo, mats.rock, cragMoss[i], { shadow: tier.id !== 'low' });
  });
  logGeo.forEach((geo, i) => instanced(scene, geo, mats.barkDark, logLists[i], { shadow: tier.id !== 'low' }));
  stumpGeo.forEach((geo, i) => instanced(scene, geo, mats.barkDark, stumpLists[i], { shadow: hiShadow }));
  fernGeo.forEach((geo, i) => instanced(scene, geo, mats.fern, fernLists[i], { shadow: false }));

  // 전나무: 줄기는 한 벌, 수관은 가까운 것(촘촘)과 먼 것(성김) 두 벌. 플레이어가 움직이면 나눠 담는다
  const nearR = tier.id === 'high' ? 70 : tier.id === 'medium' ? 55 : 40;
  const tmp = new THREE.Object3D();
  const pineSets = pines.map((p, i) => {
    const list = pineLists[i];
    instanced(scene, p.trunk, mats.barkDark, list, { shadow: tier.id === 'high' });
    const near = instanced(scene, p.crown, mats.pineNeedles, list, { shadow: tier.id === 'high', depthMap: ctex.pineNeedles });
    const far = instanced(scene, p.far, mats.pineNeedles, list, { shadow: tier.id === 'high', depthMap: ctex.pineNeedles });
    const m4 = list.map((t) => {
      tmp.position.set(t.x, t.y, t.z);
      tmp.rotation.set(0, t.ry || 0, 0);
      tmp.scale.setScalar(t.s || 1);
      tmp.updateMatrix();
      return tmp.matrix.clone();
    });
    return { list, near, far, m4 };
  });
  let lastX = 1e9;
  let lastZ = 1e9;
  function update(px, pz) {
    if (Math.hypot(px - lastX, pz - lastZ) < 6) return;
    lastX = px;
    lastZ = pz;
    for (const S of pineSets) {
      if (!S.near) continue;
      let n = 0;
      let f = 0;
      for (let i = 0; i < S.list.length; i++) {
        const t = S.list[i];
        if (Math.hypot(t.x - px, t.z - pz) < nearR) S.near.setMatrixAt(n++, S.m4[i]);
        else S.far.setMatrixAt(f++, S.m4[i]);
      }
      S.near.count = n;
      S.far.count = f;
      S.near.instanceMatrix.needsUpdate = true;
      S.far.instanceMatrix.needsUpdate = true;
    }
  }
  bushGeo.forEach((g, i) => instanced(scene, g, mats.bushLeaves, bushLists[i], { shadow: tier.id !== 'low', depthMap: ctex.bushLeaves }));
  instanced(scene, flowerTuft(), mats.flowers, flowers);
  instanced(scene, rockGeo(41, 0.3, { sy: 0.6, detail: 2 }), mats.rockBare, rocks[0], { shadow: true });
  instanced(scene, rockGeo(42, 0.24, { sy: 0.7, detail: 2 }), mats.rock, rocks[1], { shadow: true });
  return {
    update,
    counts: {
      pines: pineLists.flat().length, bushes: bushLists.flat().length, flowers: flowers.length, rocks: rocks.flat().length,
      crags: cragBare.flat().length + cragMoss.flat().length, logs: logLists.flat().length, stumps: stumpLists.flat().length, ferns: fernLists.flat().length,
    },
  };
}
