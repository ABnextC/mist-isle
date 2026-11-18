// 노드·건물·캐릭터 소품 모형. 원점은 바닥 중심이다.

import * as THREE from 'three';
import { part, merge } from './geo.js';

const C = THREE;

// ── 노드 ──────────────────────────────────────────────
export function birchGeo() {
  return merge([
    part(new C.CylinderGeometry(0.15, 0.24, 3.4, 6), 0xebe6da, { y: 1.7 }),
    part(new C.CylinderGeometry(0.162, 0.162, 0.12, 6), 0x34322e, { y: 0.9 }),
    part(new C.CylinderGeometry(0.155, 0.155, 0.1, 6), 0x34322e, { y: 1.8, rz: 0.08 }),
    part(new C.CylinderGeometry(0.15, 0.15, 0.09, 6), 0x34322e, { y: 2.6 }),
    part(new C.IcosahedronGeometry(1.3, 0), 0x9fc25a, { y: 3.6, sy: 1.15 }),
    part(new C.IcosahedronGeometry(0.95, 0), 0xb7d26c, { x: 0.55, y: 4.4, z: 0.2 }),
    part(new C.IcosahedronGeometry(0.85, 0), 0x86ad4b, { x: -0.6, y: 4.0, z: -0.3 }),
  ]);
}

export function driftwoodGeo() {
  return merge([
    part(new C.CylinderGeometry(0.15, 0.19, 2.3, 5), 0x9c8a74, { y: 0.17, rz: Math.PI / 2, ry: 0.3 }),
    part(new C.CylinderGeometry(0.11, 0.14, 1.7, 5), 0xb3a189, { x: 0.2, y: 0.36, z: 0.3, rz: Math.PI / 2, ry: -0.6 }),
    part(new C.CylinderGeometry(0.1, 0.12, 1.3, 5), 0x857461, { x: -0.3, y: 0.13, z: -0.4, rz: Math.PI / 2, ry: 1.2 }),
  ]);
}

export function stoneGeo() {
  return merge([
    part(new C.DodecahedronGeometry(0.75, 0), 0x8f8b84, { y: 0.45, sy: 0.75 }),
    part(new C.DodecahedronGeometry(0.45, 0), 0xa39f97, { x: 0.65, y: 0.25, z: 0.2, sy: 0.8 }),
    part(new C.DodecahedronGeometry(0.35, 0), 0x77736b, { x: -0.5, y: 0.2, z: 0.45 }),
  ]);
}

export function copperGeo() {
  return merge([
    part(new C.DodecahedronGeometry(1.05, 0), 0x6e6a66, { y: 0.7, sy: 0.85 }),
    part(new C.DodecahedronGeometry(0.6, 0), 0x5f5b57, { x: 0.8, y: 0.35, z: -0.3 }),
    part(new C.OctahedronGeometry(0.28, 0), 0xd9823b, { x: 0.3, y: 1.35, z: 0.35, sy: 1.6 }),
    part(new C.OctahedronGeometry(0.22, 0), 0xe89a52, { x: -0.45, y: 1.1, z: 0.4, sy: 1.5, rz: 0.4 }),
    part(new C.OctahedronGeometry(0.2, 0), 0xc8702e, { x: 0.65, y: 0.9, z: 0.5, sy: 1.4, rz: -0.5 }),
  ]);
}

export function reedGeo() {
  const parts = [];
  const spots = [[0, 0], [0.3, 0.15], [-0.25, 0.2], [0.1, -0.3], [-0.35, -0.2], [0.4, -0.25], [-0.1, 0.4], [0.22, 0.42]];
  spots.forEach(([x, z], i) => {
    const h = 1.3 + (i % 3) * 0.25;
    parts.push(part(new C.ConeGeometry(0.05, h, 4), i % 2 ? 0xc9b47a : 0x97a95c, { x, z, y: h / 2, rz: (x - z) * 0.25 }));
    if (i % 3 === 0) parts.push(part(new C.CylinderGeometry(0.06, 0.06, 0.28, 4), 0x7a5a3a, { x, z, y: h - 0.05 }));
  });
  return merge(parts);
}

export function berryGeo() {
  const parts = [part(new C.IcosahedronGeometry(0.8, 0), 0x3f6d34, { y: 0.6, sy: 0.8 }),
    part(new C.IcosahedronGeometry(0.55, 0), 0x4d7d3e, { x: 0.45, y: 0.45, z: 0.2 })];
  const dots = [[0.5, 0.9, 0.3], [-0.4, 0.85, 0.45], [0.2, 1.05, -0.4], [-0.55, 0.6, -0.2], [0.7, 0.55, -0.15], [0, 0.7, 0.7], [-0.15, 1.1, 0.1]];
  for (const [x, y, z] of dots) parts.push(part(new C.IcosahedronGeometry(0.11, 0), 0xd23b46, { x, y, z }));
  return merge(parts);
}

export function seaweedGeo() {
  const parts = [part(new C.DodecahedronGeometry(0.7, 0), 0x4c4f4a, { y: 0.15, sy: 0.45 })];
  const fronds = [[0.2, 0.1], [-0.25, 0.2], [0.05, -0.3], [-0.3, -0.25], [0.35, -0.2]];
  fronds.forEach(([x, z], i) => {
    parts.push(part(new C.ConeGeometry(0.09, 0.9 + (i % 2) * 0.3, 4), i % 2 ? 0x3d7a4a : 0x5a8f3c, { x, y: 0.55, z, rz: x * 0.8, rx: z * 0.8 }));
  });
  return merge(parts);
}

export function mushroomGeo() {
  const parts = [];
  const set = [[0, 0, 1], [0.35, 0.2, 0.75], [-0.3, 0.25, 0.65], [0.1, -0.35, 0.55]];
  for (const [x, z, s] of set) {
    parts.push(part(new C.CylinderGeometry(0.06, 0.08, 0.35, 5), 0xece3cf, { x, z, y: 0.17 * s, s }));
    parts.push(part(new C.ConeGeometry(0.24, 0.2, 7), 0xb6542f, { x, z, y: 0.42 * s, s }));
  }
  return merge(parts);
}

export const NODE_GEOS = {
  node_birch: birchGeo,
  node_driftwood: driftwoodGeo,
  node_stone: stoneGeo,
  node_copper: copperGeo,
  node_reed: reedGeo,
  node_berry: berryGeo,
  node_seaweed: seaweedGeo,
  node_mushroom: mushroomGeo,
};

// 채집할 때 튀는 조각 색
export const NODE_CHIP = {
  node_birch: 0xd9cfb4, node_driftwood: 0xa89377, node_stone: 0x9a968e, node_copper: 0xd9823b,
  node_reed: 0xc9b47a, node_berry: 0xd23b46, node_seaweed: 0x5a8f3c, node_mushroom: 0xb6542f,
};

// ── 작업대·건물 ───────────────────────────────────────
const box = (w, h, d) => new C.BoxGeometry(w, h, d);

export function stationGeo(type) {
  switch (type) {
    case 'forge':
      return merge([
        part(box(1.8, 0.9, 1.3), 0x5d5853, { y: 0.45 }),
        part(box(1.9, 0.12, 1.4), 0x4a4642, { y: 0.92 }),
        part(new C.CylinderGeometry(0.22, 0.3, 0.6, 6), 0x6b4a32, { x: 1.4, y: 0.3 }),
        part(box(0.55, 0.22, 0.26), 0x2f3236, { x: 1.4, y: 0.72 }),
        part(new C.ConeGeometry(0.11, 0.35, 5), 0x2f3236, { x: 1.78, y: 0.72, rz: Math.PI / 2 }),
        part(box(0.5, 1.6, 0.5), 0x5d5853, { x: -0.6, y: 1.6, z: -0.35 }),
      ]);
    case 'smelter':
      return merge([
        part(new C.CylinderGeometry(0.65, 1.05, 2.0, 8), 0x9a5b3c, { y: 1.0 }),
        part(new C.CylinderGeometry(0.3, 0.45, 0.8, 8), 0x7d4a31, { y: 2.4 }),
        part(new C.TorusGeometry(0.85, 0.08, 4, 8), 0x5e3826, { y: 0.9, rx: Math.PI / 2 }),
      ]);
    case 'sawbench':
      return merge([
        part(box(0.12, 1.0, 0.12), 0x7a5a3a, { x: -0.7, y: 0.45, z: 0.25, rx: 0.3 }),
        part(box(0.12, 1.0, 0.12), 0x7a5a3a, { x: -0.7, y: 0.45, z: -0.25, rx: -0.3 }),
        part(box(0.12, 1.0, 0.12), 0x7a5a3a, { x: 0.7, y: 0.45, z: 0.25, rx: 0.3 }),
        part(box(0.12, 1.0, 0.12), 0x7a5a3a, { x: 0.7, y: 0.45, z: -0.25, rx: -0.3 }),
        part(new C.CylinderGeometry(0.22, 0.22, 2.2, 7), 0xb39b78, { y: 1.05, rz: Math.PI / 2 }),
        part(box(0.9, 0.35, 0.03), 0xb8bec4, { x: 0.25, y: 1.45, rz: -0.2 }),
      ]);
    case 'workbench':
      return merge([
        part(box(1.9, 0.12, 1.0), 0x9b7650, { y: 0.92 }),
        ...[[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]].map(([x, z]) => part(box(0.12, 0.9, 0.12), 0x6e4f33, { x, y: 0.45, z })),
        part(box(0.5, 0.18, 0.3), 0x6e4f33, { x: -0.4, y: 1.07, z: 0.1 }),
        part(box(0.08, 0.08, 0.6), 0xb8bec4, { x: 0.45, y: 1.02, z: -0.1, ry: 0.4 }),
      ]);
    case 'loom':
      return merge([
        part(box(0.12, 1.8, 0.12), 0x7a5a3a, { x: -0.8, y: 0.9 }),
        part(box(0.12, 1.8, 0.12), 0x7a5a3a, { x: 0.8, y: 0.9 }),
        part(box(1.8, 0.12, 0.12), 0x7a5a3a, { y: 1.8 }),
        part(box(1.5, 1.1, 0.04), 0xd8c89a, { y: 1.1 }),
        part(box(1.6, 0.1, 0.5), 0x8b6a45, { y: 0.45, z: 0.6 }),
      ]);
    case 'kitchen':
      return merge([
        part(box(0.08, 1.4, 0.08), 0x5a4330, { x: -0.5, y: 0.65, rz: 0.3 }),
        part(box(0.08, 1.4, 0.08), 0x5a4330, { x: 0.5, y: 0.65, rz: -0.3 }),
        part(box(1.1, 0.06, 0.06), 0x5a4330, { y: 1.3 }),
        part(new C.CylinderGeometry(0.32, 0.26, 0.4, 8), 0x2e2f33, { y: 0.75 }),
        part(new C.CylinderGeometry(0.5, 0.55, 0.15, 7), 0x6f6a63, { y: 0.07 }),
        part(box(0.9, 0.08, 0.6), 0x9b7650, { x: 1.2, y: 0.75 }),
        part(box(0.08, 0.75, 0.08), 0x6e4f33, { x: 1.2, y: 0.37 }),
      ]);
    case 'storage':
      return merge([
        part(box(0.9, 0.9, 0.9), 0x8f6b43, { x: -0.5, y: 0.45 }),
        part(box(0.9, 0.9, 0.9), 0x7f5d39, { x: 0.5, y: 0.45, ry: 0.2 }),
        part(box(0.8, 0.8, 0.8), 0x9b7650, { x: -0.1, y: 1.3, ry: -0.3 }),
        part(new C.CylinderGeometry(0.35, 0.35, 0.95, 8), 0x6e4f33, { x: 0.3, y: 0.47, z: 0.85 }),
      ]);
    default:
      return merge([part(box(1, 1, 1), 0x888888, { y: 0.5 })]);
  }
}

// 빛나는 부분(화덕·용광로 입구·모닥불)
export function glowGeo(type) {
  switch (type) {
    case 'forge': return part(box(1.1, 0.1, 0.7), 0xffffff, { y: 1.03 });
    case 'smelter': return part(box(0.5, 0.45, 0.2), 0xffffff, { y: 0.55, z: 0.92 });
    case 'kitchen': return part(new C.ConeGeometry(0.28, 0.45, 5), 0xffffff, { y: 0.3 });
    case 'campfire': return part(new C.ConeGeometry(0.35, 0.8, 5), 0xffffff, { y: 0.42 });
    default: return null;
  }
}

export function structureGeo(kind) {
  switch (kind) {
    case 'lighthouse': {
      const parts = [part(new C.CylinderGeometry(2.4, 2.8, 1.2, 10), 0x77736b, { y: 0.6 })];
      const bands = 6;
      for (let i = 0; i < bands; i++) {
        const r0 = 2.0 - i * 0.16;
        parts.push(part(new C.CylinderGeometry(r0 - 0.16, r0, 2.0, 10), i % 2 ? 0xb8463c : 0xf1ece0, { y: 2.2 + i * 2.0 }));
      }
      parts.push(part(new C.CylinderGeometry(1.4, 1.4, 0.3, 10), 0x3c3c3c, { y: 13.3 }));
      parts.push(part(new C.CylinderGeometry(1.1, 1.1, 0.25, 10), 0x3c3c3c, { y: 15.4 }));
      parts.push(part(new C.ConeGeometry(1.2, 1.2, 10), 0xb8463c, { y: 16.1 }));
      return merge(parts);
    }
    case 'house':
      return merge([
        part(box(4.2, 2.6, 3.4), 0xd8cdb6, { y: 1.3 }),
        part(new C.ConeGeometry(3.4, 1.9, 4), 0x8c4a32, { y: 3.55, ry: Math.PI / 4, sz: 0.85 }),
        part(box(0.9, 1.6, 0.1), 0x6e4f33, { y: 0.8, z: 1.72 }),
        part(box(0.7, 0.6, 0.1), 0x4f6b78, { x: 1.3, y: 1.6, z: 1.72 }),
        part(box(0.6, 1.4, 0.6), 0x8a857c, { x: -1.2, y: 4.1, z: -0.6 }),
      ]);
    case 'board':
      return merge([
        part(box(0.15, 2.0, 0.15), 0x6e4f33, { x: -0.7, y: 1.0 }),
        part(box(0.15, 2.0, 0.15), 0x6e4f33, { x: 0.7, y: 1.0 }),
        part(box(1.7, 1.0, 0.08), 0x9b7650, { y: 1.45 }),
        part(box(0.4, 0.3, 0.02), 0xefe6cf, { x: -0.4, y: 1.55, z: 0.05 }),
        part(box(0.35, 0.45, 0.02), 0xefe6cf, { x: 0.15, y: 1.4, z: 0.05, rz: 0.08 }),
        part(box(0.3, 0.25, 0.02), 0xefe6cf, { x: 0.55, y: 1.65, z: 0.05, rz: -0.1 }),
      ]);
    case 'campfire': {
      const parts = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(part(new C.DodecahedronGeometry(0.22, 0), 0x6f6a63, { x: Math.cos(a) * 0.6, z: Math.sin(a) * 0.6, y: 0.1 }));
      }
      parts.push(part(new C.CylinderGeometry(0.08, 0.1, 0.9, 5), 0x5a4330, { y: 0.15, rz: Math.PI / 2, ry: 0.5 }));
      parts.push(part(new C.CylinderGeometry(0.08, 0.1, 0.9, 5), 0x5a4330, { y: 0.15, rz: Math.PI / 2, ry: -0.7 }));
      return merge(parts);
    }
    case 'wreck': {
      const parts = [part(new C.CylinderGeometry(2.0, 2.0, 9, 10, 1, true, 0, Math.PI), 0x6b5440, { y: 1.2, rz: Math.PI / 2, rx: 0.2 })];
      for (let i = -3; i <= 3; i += 1.5) parts.push(part(new C.TorusGeometry(2.0, 0.1, 4, 10, Math.PI), 0x4f3d2e, { x: i, y: 1.2, rz: Math.PI, ry: Math.PI / 2 }));
      parts.push(part(new C.CylinderGeometry(0.14, 0.18, 5, 6), 0x5a4330, { x: 0.8, y: 2.5, rz: 0.55 }));
      parts.push(part(box(2.4, 1.4, 0.05), 0xcfc6b0, { x: 1.9, y: 3.4, z: 0.3, rz: 0.55, ry: 0.2 }));
      return merge(parts);
    }
    default:
      return merge([part(box(1, 1, 1), 0x888888, { y: 0.5 })]);
  }
}
