// 등대 마을 모형: 집·등대·게시판·모닥불·작업대 7종·난파선·부두.
// 각 함수는 { 재질이름: [조각...] }과 불·연기·불빛 자리(물체 공간)를 돌려준다. 원점은 바닥 가운데, 앞은 +z.

import * as THREE from 'three';
import { rng, P, xf, merge, taperTube, bentPath, rockGeo, lathe, prep } from './build.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const box = (w, h, d, t = {}, c = 0xffffff) => P(new THREE.BoxGeometry(w, h, d), c, t);
const cyl = (rt, rb, h, seg, t = {}, c = 0xffffff) => P(new THREE.CylinderGeometry(rt, rb, h, seg), c, t);

function kit() {
  const parts = {};
  const fx = { fires: [], smokes: [], lights: [], glows: [] };
  const add = (mat, g) => {
    (parts[mat] ||= []).push(g);
    return g;
  };
  return { parts, fx, add };
}

function barrel(add, t, R) {
  const g = lathe([[0, 0], [0.26, 0], [0.3, 0.2], [0.32, 0.42], [0.3, 0.64], [0.26, 0.84], [0, 0.84]], 14);
  add('planks', xf(g, t));
  for (const y of [0.12, 0.72]) add('iron', xf(P(new THREE.TorusGeometry(0.295, 0.015, 4, 18), 0xffffff, { rx: Math.PI / 2, y }), t));
}

function crate(add, s, t) {
  add('planks', box(s, s, s, t));
  for (const dx of [-1, 1]) add('planksDark', box(0.06, s + 0.02, s + 0.02, { ...t, x: (t.x || 0) + dx * (s / 2 - 0.02) }));
}

function woodpile(add, R, t) {
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 4 - r; i++) {
      const g = taperTube([V(-0.55, 0, 0), V(0.55, 0, 0)], [0.09, 0.09], { radial: 7, vScale: 1, cap: true });
      add('barkDark', xf(g, { ...t, x: (t.x || 0), y: (t.y || 0) + 0.09 + r * 0.16, z: (t.z || 0) + (i - (3 - r) / 2) * 0.19, ry: t.ry || 0 }));
    }
  }
}

export function house(seed) {
  const R = rng(seed);
  const { parts, fx, add } = kit();
  const W = 5.0;
  const D = 4.2;
  const base = 0.45;
  const wallH = 2.6;
  const top = base + wallH;
  const roofH = 2.0;
  add('stone', box(W + 0.3, 0.75, D + 0.3, { y: base - 0.375 - 0.12 }));
  add('plaster', box(W, wallH, D, { y: base + wallH / 2 }));
  // 박공벽(양 끝 세모)
  const tri = new THREE.Shape();
  tri.moveTo(-D / 2, 0);
  tri.lineTo(D / 2, 0);
  tri.lineTo(0, roofH);
  tri.closePath();
  for (const sx of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false });
    add('plaster', xf(prep(g), { ry: Math.PI / 2, x: sx * (W / 2) - (sx > 0 ? 0.2 : 0), y: top }));
  }
  // 목조 뼈대
  const beam = (w, h, d, t) => add('planksDark', box(w, h, d, t));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam(0.2, wallH, 0.2, { x: sx * (W / 2 - 0.05), y: base + wallH / 2, z: sz * (D / 2 - 0.05) });
  for (const sz of [-1, 1]) {
    beam(W + 0.1, 0.18, 0.2, { y: base + 0.09, z: sz * (D / 2 - 0.02) });
    beam(W + 0.1, 0.18, 0.2, { y: top - 0.09, z: sz * (D / 2 - 0.02) });
    beam(0.16, wallH, 0.18, { x: 0.25, y: base + wallH / 2, z: sz * (D / 2 - 0.01) });
    const L = Math.hypot(W / 2 - 0.4, wallH - 0.3);
    beam(0.14, L, 0.16, { x: -1.2, y: base + wallH / 2, z: sz * (D / 2 - 0.01), rz: Math.atan2(W / 2 - 0.4, wallH - 0.3) * 0.75 });
  }
  for (const sx of [-1, 1]) {
    beam(0.2, 0.18, D + 0.1, { x: sx * (W / 2 - 0.02), y: base + 0.09 });
    beam(0.2, 0.18, D + 0.1, { x: sx * (W / 2 - 0.02), y: top - 0.09 });
  }
  // 지붕
  const ang = Math.atan2(roofH, D / 2);
  const slope = Math.hypot(D / 2, roofH) + 0.55;
  for (const sz of [-1, 1]) {
    add('shingle', box(W + 0.9, 0.14, slope, {
      y: top + roofH / 2 + 0.02, z: sz * (D / 4 + 0.2), rx: sz * ang,
    }));
  }
  beam(W + 1.0, 0.2, 0.26, { y: top + roofH + 0.06 });
  // 굴뚝
  add('stone', box(0.62, 2.6, 0.62, { x: 1.3, y: top + 1.0, z: -0.85 }));
  add('stone', box(0.75, 0.16, 0.75, { x: 1.3, y: top + 2.3, z: -0.85 }));
  fx.smokes.push(V(1.3, top + 2.45, -0.85));
  // 문·창
  add('planks', box(0.96, 1.95, 0.08, { x: -0.9, y: base + 0.98, z: D / 2 + 0.03 }));
  beam(1.16, 0.12, 0.12, { x: -0.9, y: base + 2.0, z: D / 2 + 0.06 });
  add('iron', box(0.05, 0.05, 0.08, { x: -0.55, y: base + 1.0, z: D / 2 + 0.09 }));
  add('stone', box(1.3, 0.22, 0.7, { x: -0.9, y: 0.05, z: D / 2 + 0.4 }));
  const win = (x, z, ry) => {
    add('window', box(0.78, 0.8, 0.06, { x, y: base + 1.45, z, ry }));
    const fz = 0.05;
    const along = (dx) => (ry ? { x: x + (ry > 0 ? fz : -fz), z: z + dx } : { x: x + dx, z: z + fz * Math.sign(z) });
    beam(ry ? 0.08 : 0.92, 0.1, ry ? 0.92 : 0.08, { ...along(0), y: base + 1.88 });
    beam(ry ? 0.08 : 0.92, 0.1, ry ? 0.92 : 0.08, { ...along(0), y: base + 1.02 });
    beam(ry ? 0.08 : 0.06, 0.8, ry ? 0.06 : 0.08, { ...along(0), y: base + 1.45 });
    fx.glows.push(V(x, base + 1.45, z));
  };
  win(1.15, D / 2 + 0.02, 0);
  win(0.25 - 1.6, -D / 2 - 0.02, 0);
  win(W / 2 + 0.02, 0.6, Math.PI / 2);
  // 둘레 살림살이
  barrel(add, { x: W / 2 + 0.55, z: D / 2 - 0.4 }, R);
  if (R() < 0.7) barrel(add, { x: W / 2 + 0.6, z: D / 2 - 1.15, ry: 1 }, R);
  crate(add, 0.55, { x: -W / 2 - 0.5, y: 0.27, z: D / 2 - 0.5, ry: 0.3 });
  woodpile(add, R, { x: -W / 2 - 0.45, z: -0.6, ry: Math.PI / 2 });
  add('planks', box(1.5, 0.08, 0.36, { x: 1.3, y: 0.45, z: D / 2 + 0.55 }));
  for (const dx of [-0.6, 0.6]) add('planksDark', box(0.1, 0.42, 0.3, { x: 1.3 + dx, y: 0.21, z: D / 2 + 0.55 }));
  return { parts, fx };
}

export function lighthouse() {
  const { parts, fx, add } = kit();
  add('stone', lathe([[0, 0], [2.85, 0], [2.85, 1.0], [2.55, 1.25], [0, 1.25]], 8).translate(0, -0.3, 0));
  const H0 = 0.95;
  const H1 = 13.2;
  const rAt = (y) => 2.25 + (1.62 - 2.25) * ((y - H0) / (H1 - H0));
  const bands = [[H0, 3.4, 0xe8e4da], [3.4, 5.0, 0xa02a1f], [5.0, 7.8, 0xe8e4da], [7.8, 9.4, 0xa02a1f], [9.4, 12.0, 0xe8e4da], [12.0, H1, 0xa02a1f]];
  for (const [a, b, c] of bands) add('plasterTint', lathe([[0, a], [rAt(a), a], [rAt(b), b], [0, b]], 24, c));
  add('planks', box(0.95, 1.9, 0.12, { y: H0 + 0.95, z: 2.18, rx: -0.05 }));
  add('stone', box(1.25, 0.2, 0.55, { y: H0 - 0.05, z: 2.45 }));
  for (const [y, a] of [[5.6, 0.4], [9.0, 2.5], [11.0, 4.6]]) {
    const r = rAt(y) + 0.01;
    add('window', box(0.38, 0.6, 0.08, { x: Math.sin(a) * r, y, z: Math.cos(a) * r, ry: a }));
  }
  // 전망대와 난간
  add('iron', cyl(2.35, 2.2, 0.18, 24, { y: H1 + 0.09 }));
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    add('iron', cyl(0.025, 0.025, 0.9, 5, { x: Math.cos(a) * 2.2, y: H1 + 0.62, z: Math.sin(a) * 2.2 }));
  }
  add('iron', P(new THREE.TorusGeometry(2.2, 0.035, 5, 40), 0xffffff, { rx: Math.PI / 2, y: H1 + 1.08 }));
  // 등명실
  add('glass', cyl(1.1, 1.1, 1.7, 16, { y: H1 + 1.05 }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add('iron', box(0.06, 1.75, 0.06, { x: Math.cos(a) * 1.12, y: H1 + 1.05, z: Math.sin(a) * 1.12, ry: -a }));
  }
  add('iron', lathe([[0, H1 + 1.9], [1.35, H1 + 1.9], [1.2, H1 + 2.1], [0.45, H1 + 2.75], [0.12, H1 + 2.95], [0, H1 + 3.0]], 16));
  add('iron', P(new THREE.SphereGeometry(0.16, 10, 8), 0xffffff, { y: H1 + 3.1 }));
  add('iron', cyl(0.015, 0.015, 0.8, 4, { y: H1 + 3.5 }));
  fx.lights.push({ kind: 'lighthouse', p: V(0, H1 + 1.05, 0) });
  return { parts, fx };
}

export function board() {
  const { parts, fx, add } = kit();
  for (const x of [-0.75, 0.75]) add('barkDark', taperTube([V(x, -0.3, 0), V(x, 2.25, 0)], [0.07, 0.06], { radial: 7, vScale: 1.2 }));
  add('planks', box(1.7, 1.05, 0.07, { y: 1.45 }));
  add('planksDark', box(1.9, 0.08, 0.12, { y: 2.0 }));
  add('shingle', box(2.0, 0.07, 0.55, { y: 2.18, z: 0.05, rx: 0.35 }));
  const R = rng(5);
  for (let i = 0; i < 6; i++) {
    const w = 0.28 + R() * 0.12;
    add('paper', box(w, w * 1.3, 0.01, { x: -0.6 + (i % 3) * 0.5 + (R() - 0.5) * 0.08, y: 1.68 - Math.floor(i / 3) * 0.48, z: 0.045, rz: (R() - 0.5) * 0.15 }));
  }
  return { parts, fx };
}

export function campfire() {
  const { parts, fx, add } = kit();
  const R = rng(3);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    add('rockBare', xf(rockGeo(900 + i, 0.17 + R() * 0.06, { sy: 0.7, detail: 2 }), { x: Math.cos(a) * 0.62, z: Math.sin(a) * 0.62, y: -0.03 }));
  }
  add('ash', cyl(0.5, 0.52, 0.04, 16, { y: 0.01 }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const g = taperTube([V(Math.cos(a) * 0.42, 0.02, Math.sin(a) * 0.42), V(Math.cos(a) * 0.05, 0.62, Math.sin(a) * 0.05)], [0.06, 0.045], { radial: 6, vScale: 1, cap: true });
    add('barkDark', g);
  }
  fx.fires.push({ p: V(0, 0.18, 0), s: 1.0 });
  fx.lights.push({ kind: 'fire', p: V(0, 0.9, 0) });
  fx.smokes.push(V(0, 1.1, 0));
  return { parts, fx };
}

// ── 작업대 ─────────────────────────────────────────
function forge() {
  const { parts, fx, add } = kit();
  add('stone', box(1.6, 0.86, 1.15, { y: 0.43 }));
  add('coal', box(1.15, 0.1, 0.72, { y: 0.9 }));
  add('stone', box(1.45, 0.5, 1.0, { y: 2.05, z: -0.05, sx: 1, sz: 1 }));
  add('stone', box(1.15, 0.35, 0.8, { y: 2.45, z: -0.08 }));
  add('stone', box(0.6, 1.5, 0.6, { y: 3.35, z: -0.12 }));
  for (const x of [-0.7, 0.7]) add('planksDark', box(0.12, 1.3, 0.12, { x, y: 1.5, z: 0.45 }));
  add('barkDark', taperTube([V(1.35, -0.2, 0.2), V(1.35, 0.5, 0.2)], [0.24, 0.22], { radial: 10, vScale: 1, cap: true }));
  add('iron', box(0.24, 0.22, 0.2, { x: 1.35, y: 0.62, z: 0.2 }));
  add('iron', box(0.5, 0.12, 0.22, { x: 1.35, y: 0.78, z: 0.2 }));
  add('iron', P(new THREE.ConeGeometry(0.08, 0.32, 8), 0xffffff, { x: 1.74, y: 0.78, z: 0.2, rz: -Math.PI / 2 }));
  add('metal', box(0.05, 0.05, 0.35, { x: 1.3, y: 0.88, z: 0.25, ry: 0.4 }));
  barrel(add, { x: -1.25, z: 0.3 }, rng(4));
  add('waterTop', cyl(0.27, 0.27, 0.02, 14, { x: -1.25, y: 0.8, z: 0.3 }));
  fx.fires.push({ p: V(0, 0.98, 0.0), s: 0.7, low: true });
  fx.lights.push({ kind: 'forge', p: V(0, 1.3, 0.3) });
  fx.smokes.push(V(0, 4.15, -0.12));
  return { parts, fx };
}

function smelter() {
  const { parts, fx, add } = kit();
  add('stone', lathe([[0, 0], [0.95, 0], [0.9, 0.8], [0.7, 1.6], [0.5, 2.25], [0.42, 2.45], [0.3, 2.45], [0.3, 2.2], [0, 2.2]], 14));
  add('coal', box(0.45, 0.32, 0.12, { y: 0.32, z: 0.86 }));
  add('stone', box(0.7, 0.12, 0.3, { y: 0.55, z: 0.9 }));
  add('planksDark', box(0.6, 0.12, 0.35, { x: 1.2, y: 0.55, ry: 0.3 }));
  add('leather', box(0.5, 0.22, 0.3, { x: 1.2, y: 0.7, ry: 0.3 }));
  add('planksDark', box(0.08, 0.08, 0.7, { x: 1.0, y: 0.6, z: 0.35, ry: 0.3 }));
  const R = rng(8);
  for (let i = 0; i < 7; i++) add('copper', xf(rockGeo(700 + i, 0.14 + R() * 0.08, { sy: 0.7, detail: 2 }), { x: -1.0 + (R() - 0.5) * 0.5, z: 0.4 + (R() - 0.5) * 0.5, y: -0.02 }));
  fx.fires.push({ p: V(0, 0.25, 0.8), s: 0.45, low: true });
  fx.smokes.push(V(0, 2.55, 0));
  return { parts, fx };
}

function trestle(add, x) {
  for (const sz of [-1, 1]) add('planksDark', box(0.08, 0.95, 0.08, { x, y: 0.42, z: sz * 0.25, rx: sz * 0.28 }));
  add('planksDark', box(0.12, 0.1, 0.5, { x, y: 0.86 }));
}

function sawbench() {
  const { parts, fx, add } = kit();
  trestle(add, -0.75);
  trestle(add, 0.75);
  add('barkDark', taperTube([V(-1.2, 1.12, 0), V(1.25, 1.12, 0.02)], [0.24, 0.22], { radial: 12, vScale: 1.2, cap: true }));
  add('woodBox', cyl(0.215, 0.215, 0.02, 16, { x: 1.26, y: 1.12, rz: Math.PI / 2 }));
  add('metal', box(1.0, 0.16, 0.012, { x: 0.3, y: 1.42, z: 0.0, rz: 0.2 }));
  add('planksDark', box(0.06, 0.18, 0.05, { x: -0.25, y: 1.54, rz: 0.2 }));
  add('sawdust', cyl(0.6, 0.75, 0.04, 16, { y: 0.0, x: 0.3, sz: 0.6 }));
  for (let i = 0; i < 4; i++) add('planks', box(1.6, 0.05, 0.26, { x: 0, y: 0.03 + i * 0.055, z: 0.85, ry: (i % 2) * 0.05 }));
  return { parts, fx };
}

function workbench() {
  const { parts, fx, add } = kit();
  add('planks', box(2.0, 0.1, 0.85, { y: 0.92 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('planksDark', box(0.1, 0.88, 0.1, { x: sx * 0.88, y: 0.44, z: sz * 0.33 }));
  add('planksDark', box(1.8, 0.05, 0.6, { y: 0.25 }));
  add('iron', box(0.18, 0.2, 0.22, { x: -0.8, y: 1.07, z: 0.32 }));
  add('metal', cyl(0.015, 0.015, 0.4, 5, { x: -0.8, y: 1.08, z: 0.48, rx: Math.PI / 2 }));
  add('planksDark', box(0.28, 0.1, 0.1, { x: 0.4, y: 1.02, z: 0.1 }));
  add('planksDark', cyl(0.02, 0.02, 0.3, 5, { x: 0.4, y: 1.02, z: 0.28, rx: Math.PI / 2 }));
  add('metal', box(0.02, 0.02, 0.22, { x: 0.1, y: 0.98, z: -0.1, ry: 0.6 }));
  for (let i = 0; i < 3; i++) add('planks', box(1.4, 0.04, 0.2, { x: 0.1, y: 0.3 + i * 0.045, z: (i - 1) * 0.04 }));
  add('sawdust', cyl(0.5, 0.6, 0.03, 14, { x: 0.2, y: 0.0, z: 0.2, sz: 0.7 }));
  return { parts, fx };
}

function loom() {
  const { parts, fx, add } = kit();
  for (const x of [-0.85, 0.85]) {
    add('planksDark', box(0.12, 1.9, 0.12, { x, y: 0.95, z: -0.2 }));
    add('planksDark', box(0.12, 1.0, 0.12, { x, y: 0.5, z: 0.45 }));
    add('planksDark', box(0.1, 0.1, 0.75, { x, y: 0.95, z: 0.12 }));
  }
  add('planksDark', box(1.85, 0.12, 0.12, { y: 1.85, z: -0.2 }));
  add('planksDark', box(1.85, 0.1, 0.1, { y: 0.35, z: -0.2 }));
  add('planksDark', cyl(0.07, 0.07, 1.8, 10, { y: 1.0, z: 0.45, rz: Math.PI / 2 }));
  for (let i = 0; i < 26; i++) add('thread', cyl(0.005, 0.005, 1.45, 3, { x: -0.72 + i * 0.058, y: 1.1, z: -0.2 }));
  add('clothDyed', box(1.5, 0.55, 0.012, { y: 0.66, z: -0.2 }));
  add('clothDyed', cyl(0.1, 0.1, 1.55, 12, { y: 1.0, z: 0.45, rz: Math.PI / 2 }));
  add('planks', box(0.9, 0.08, 0.3, { y: 0.48, z: 0.95 }));
  for (const x of [-0.35, 0.35]) add('planksDark', box(0.08, 0.46, 0.22, { x, y: 0.23, z: 0.95 }));
  return { parts, fx };
}

function kitchen() {
  const { parts, fx, add } = kit();
  const R = rng(17);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    add('rockBare', xf(rockGeo(800 + i, 0.18, { sy: 0.8, detail: 2 }), { x: Math.cos(a) * 0.6, z: Math.sin(a) * 0.6 }));
  }
  add('ash', cyl(0.5, 0.52, 0.04, 16, { y: 0.01 }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add('iron', taperTube([V(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75), V(0, 1.55, 0)], [0.025, 0.02], { radial: 5 }));
  }
  add('iron', lathe([[0, 0.38], [0.2, 0.4], [0.33, 0.55], [0.36, 0.75], [0.33, 0.9], [0.35, 0.93], [0.3, 0.93], [0.28, 0.88]], 16));
  add('soup', cyl(0.28, 0.28, 0.02, 16, { y: 0.86 }));
  add('iron', cyl(0.006, 0.006, 0.65, 3, { y: 1.22 }));
  add('planks', box(1.3, 0.07, 0.6, { x: 1.4, y: 0.85, z: 0.2, ry: -0.4 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('planksDark', box(0.07, 0.82, 0.07, { x: 1.4 + sx * 0.55 * Math.cos(0.4) + sz * 0.25 * Math.sin(0.4), y: 0.41, z: 0.2 + sz * 0.25 * Math.cos(0.4) - sx * 0.55 * Math.sin(0.4) }));
  for (let i = 0; i < 3; i++) add('clay', lathe([[0, 0], [0.09, 0], [0.12, 0.06], [0.13, 0.1], [0.11, 0.1]], 12).translate(1.2 + i * 0.25, 0.89, 0.25 - i * 0.1));
  woodpile(add, R, { x: -1.2, z: 0.2, ry: 0.4 });
  fx.fires.push({ p: V(0, 0.16, 0), s: 0.75 });
  fx.smokes.push(V(0, 1.15, 0));
  return { parts, fx };
}

function storage() {
  const { parts, fx, add } = kit();
  for (const [x, z, h] of [[-1.3, -0.9, 2.5], [1.3, -0.9, 2.5], [-1.3, 0.9, 2.0], [1.3, 0.9, 2.0]]) add('barkDark', taperTube([V(x, -0.2, z), V(x, h, z)], [0.09, 0.08], { radial: 7, vScale: 1.2 }));
  add('shingle', box(3.2, 0.12, 2.5, { y: 2.32, rx: 0.2 }));
  add('planksDark', box(3.0, 0.14, 0.14, { y: 2.45, z: -0.9 }));
  add('planksDark', box(3.0, 0.14, 0.14, { y: 1.98, z: 0.9 }));
  const R = rng(23);
  crate(add, 0.7, { x: -0.7, y: 0.35, z: -0.45 });
  crate(add, 0.55, { x: -0.65, y: 0.98, z: -0.45, ry: 0.3 });
  crate(add, 0.6, { x: 0.15, y: 0.3, z: -0.55, ry: -0.2 });
  barrel(add, { x: 0.95, z: -0.5 }, R);
  barrel(add, { x: 0.95, z: 0.25, ry: 1 }, R);
  add('planks', box(0.9, 0.5, 0.55, { x: -0.1, y: 0.25, z: 0.45 }));
  add('iron', box(0.92, 0.05, 0.57, { x: -0.1, y: 0.4, z: 0.45 }));
  for (let i = 0; i < 3; i++) add('sack', lathe([[0, 0], [0.2, 0.02], [0.24, 0.2], [0.2, 0.42], [0.08, 0.52], [0.0, 0.53]], 10).translate(-1.0 + i * 0.32, 0, 0.55 + (i % 2) * 0.12));
  return { parts, fx };
}

export const STATIONS = { forge, smelter, sawbench, workbench, loom, kitchen, storage };

export function wreck() {
  const { parts, fx, add } = kit();
  const R = rng(41);
  const L = 10.5;
  const beam = 3.3;
  const depth = 2.2;
  const N = 14;
  const hull = (u) => 1 - Math.pow(Math.abs(u), 2.2) * 0.85;
  // 판자: 한쪽 옆구리는 군데군데 부서져 있다
  for (const side of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const th = (k / 8) * (Math.PI / 2) * 0.95;
      if (side > 0 && k > 3 && k < 8 && R() < 0.55) continue;
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * 2 - 1;
        const w = hull(u) * (beam / 2);
        const y = depth - Math.cos(th) * depth * (0.55 + 0.45 * hull(u)) - 0.1;
        pts.push(V(u * L / 2, y, side * Math.sin(th) * w));
      }
      const g = taperTube(pts, pts.map(() => 0.09), { radial: 4, vScale: 1.5 });
      add('wreckWood', xf(g, { sz: 1 }));
    }
  }
  // 늑골
  for (let i = 1; i < 10; i++) {
    const u = (i / 10) * 2 - 1;
    const w = hull(u) * (beam / 2);
    const pts = [];
    for (let k = -8; k <= 8; k++) {
      const th = (k / 8) * (Math.PI / 2) * 0.98;
      pts.push(V(u * L / 2, depth - Math.cos(th) * depth * (0.55 + 0.45 * hull(u)) - 0.05, Math.sin(th) * w * 0.97));
    }
    add('wreckWood', taperTube(pts, pts.map(() => 0.08), { radial: 5, vScale: 1.2 }));
  }
  add('wreckWood', box(L * 0.95, 0.25, 0.3, { y: 0.0 }));
  add('barkDark', taperTube([V(-0.5, 0.2, 0), V(-0.7, 3.8, 0.4)], [0.2, 0.15], { radial: 9, vScale: 1.5, cap: true }));
  add('rope', taperTube(bentPath(V(-0.7, 3.4, 0.35), V(1, -0.6, 0.3), 3.2, 8, V(0, -0.8, 0), R), new Array(9).fill(0.025), { radial: 4 }));
  return { parts, fx };
}

export function pier(hf, x0, zStart, length) {
  const { parts, fx, add } = kit();
  const deckY = 1.25;
  for (let i = 0; i <= length; i += 2.2) {
    for (const sx of [-1, 1]) {
      const z = zStart - i;
      const g = hf.height(x0 + sx * 0.95, z);
      add('barkDark', taperTube([V(sx * 0.95, g - 0.6, -i), V(sx * 0.95, deckY + 0.35, -i)], [0.11, 0.1], { radial: 7, vScale: 1.2, cap: true }));
    }
    add('planksDark', box(2.2, 0.14, 0.18, { y: deckY - 0.12, z: -i }));
  }
  for (let i = 0; i < length / 0.32; i++) {
    add('planks', box(2.15, 0.06, 0.28, { y: deckY, z: -i * 0.32, ry: (i % 3 - 1) * 0.01 }));
  }
  barrel(add, { x: 0.55, y: deckY, z: -length + 1.5 }, rng(9));
  crate(add, 0.5, { x: -0.5, y: deckY + 0.28, z: -length + 2.2, ry: 0.4 });
  add('rope', P(new THREE.TorusGeometry(0.22, 0.04, 6, 16), 0xffffff, { rx: Math.PI / 2, x: -0.5, y: deckY + 0.06, z: -length + 0.8 }));
  // 작은 배
  const boat = lathe([[0, 0.05], [0.45, 0.08], [0.62, 0.3], [0.66, 0.5], [0.6, 0.52]], 14);
  const pb = boat.attributes.position;
  for (let i = 0; i < pb.count; i++) pb.setZ(i, pb.getZ(i) * 2.6);
  boat.computeVertexNormals();
  add('planks', xf(boat, { x: 2.3, y: 0.0, z: -length * 0.6, ry: 0.15 }));
  add('planksDark', box(1.1, 0.06, 0.25, { x: 2.3, y: 0.42, z: -length * 0.6 + 0.3, ry: 0.15 }));
  return { parts, fx, deckY };
}

export function lampPost() {
  const { parts, fx, add } = kit();
  add('barkDark', taperTube([V(0, -0.3, 0), V(0, 2.6, 0)], [0.08, 0.07], { radial: 8, vScale: 1.2 }));
  add('planksDark', box(0.6, 0.07, 0.07, { x: 0.22, y: 2.5 }));
  add('iron', box(0.24, 0.05, 0.24, { x: 0.45, y: 2.32 }));
  add('glass', box(0.18, 0.26, 0.18, { x: 0.45, y: 2.15 }));
  add('iron', P(new THREE.ConeGeometry(0.17, 0.14, 4), 0xffffff, { x: 0.45, y: 2.38, ry: Math.PI / 4 }));
  fx.glows.push(V(0.45, 2.15, 0));
  return { parts, fx };
}

export function fence(len) {
  const { parts, fx, add } = kit();
  const R = rng(Math.floor(len * 100));
  for (let x = 0; x <= len; x += 1.6) add('barkDark', taperTube([V(x, -0.2, 0), V(x, 1.0 + R() * 0.1, 0)], [0.06, 0.05], { radial: 6, vScale: 1, cap: true }));
  for (const y of [0.45, 0.85]) add('planksDark', box(len + 0.2, 0.08, 0.05, { x: len / 2, y }));
  return { parts, fx };
}

// 같은 재질 조각끼리 합친다
export function bake(model) {
  const out = {};
  for (const [mat, list] of Object.entries(model.parts)) out[mat] = merge(list);
  return out;
}
