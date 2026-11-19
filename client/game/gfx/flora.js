// 장식 식물과 돌: 섬 가장자리 숲(들어갈 수 없는 곳), 들판의 덤불·들꽃·잔돌.
// 채집할 수 없는 장식이라 충돌이 없다. 화질 단계에 따라 개수를 줄인다.

import * as THREE from 'three';
import { rng, xf, merge, taperTube, bentPath, rockGeo, leafCard } from '../models/build.js';
import { AREA, groundAt } from './terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 전나무: 줄기 + 실루엣 카드 4장을 엇갈려 세운다
function pine(seed) {
  const R = rng(seed);
  const H = 12 + R() * 6;
  const pts = bentPath(V(0, -0.5, 0), V(0, 1, 0), H, 10, V((R() - 0.5) * 0.08, 0, (R() - 0.5) * 0.08), R);
  const trunk = taperTube(pts, pts.map((_, i) => 0.3 * (1 - (i / (pts.length - 1)) * 0.9)), { radial: 8, vScale: 2 });
  const crownH = H * (0.78 + R() * 0.1);
  const base = H - crownH;
  const crown = V(0, base + crownH * 0.4, 0);
  const cards = [];
  for (let k = 0; k < 4; k++) {
    const w = crownH * (0.62 + R() * 0.1);
    const g = new THREE.PlaneGeometry(w, crownH);
    xf(g, { ry: (k / 4) * Math.PI + R() * 0.2, y: base + crownH / 2 });
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const d = V(p.getX(i) - crown.x, (p.getY(i) - crown.y) * 0.6, p.getZ(i) - crown.z).normalize();
      n.setXYZ(i, d.x * 0.7, d.y * 0.7 + 0.35, d.z * 0.7);
    }
    cards.push(g);
  }
  return { trunk, crown: merge(cards.map((g) => { const c = g.toNonIndexed(); c.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 3).fill(1), 3)); return c; })) };
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

function instanced(scene, geo, mat, list, { shadow = false, depthMap = null } = {}) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  list.forEach((t, i) => {
    d.position.set(t.x, t.y, t.z);
    d.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    d.scale.setScalar(t.s || 1);
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

export function createFlora(scene, { hf, paths, region, tier, mats, ctex, game }) {
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
  pines.forEach((p, i) => {
    instanced(scene, p.trunk, mats.barkDark, pineLists[i], { shadow: tier.id === 'high' });
    instanced(scene, p.crown, mats.pineNeedles, pineLists[i], { shadow: tier.id === 'high', depthMap: ctex.pineNeedles });
  });
  bushGeo.forEach((g, i) => instanced(scene, g, mats.bushLeaves, bushLists[i], { shadow: tier.id !== 'low', depthMap: ctex.bushLeaves }));
  instanced(scene, flowerTuft(), mats.flowers, flowers);
  instanced(scene, rockGeo(41, 0.3, { sy: 0.6, detail: 2 }), mats.rockBare, rocks[0], { shadow: true });
  instanced(scene, rockGeo(42, 0.24, { sy: 0.7, detail: 2 }), mats.rock, rocks[1], { shadow: true });
  return { counts: { pines: pineLists.flat().length, bushes: bushLists.flat().length, flowers: flowers.length, rocks: rocks.flat().length } };
}
