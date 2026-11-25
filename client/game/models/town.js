// 등대 마을 모형: 집·등대·게시판·거래소·모닥불·작업대 7종·난파선·부두.
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
  // 등명실(v0.5.1: 등명실 유리는 따로 둔다 — 2장에서 불빛이 흐려졌다가 새 등심으로 푸르게 밝아진다)
  add('lens', cyl(1.1, 1.1, 1.7, 16, { y: H1 + 1.05 }));
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

// 거래소: 줄무늬 차양을 친 좌판. 저울과 주괴·자루·바구니를 늘어놓는다.
export function market() {
  const { parts, fx, add } = kit();
  const R = rng(31);
  for (const [x, z, h] of [[-1.35, 0.85, 2.6], [1.35, 0.85, 2.6], [-1.35, -0.85, 2.2], [1.35, -0.85, 2.2]]) {
    add('barkDark', taperTube([V(x, -0.2, z), V(x, h, z)], [0.08, 0.07], { radial: 7, vScale: 1.2 }));
  }
  // 차양: 앞이 높게 기운 줄무늬 천, 앞자락은 짧게 늘어뜨린다
  const slope = Math.atan2(0.4, 1.7);
  for (let i = 0; i < 7; i++) {
    const x = -1.35 + 0.2 + i * 0.383;
    const mat = i % 2 ? 'cloth' : 'clothDyed';
    add(mat, box(0.385, 0.025, 2.05, { x, y: 2.44, rx: -slope }));
    add(mat, box(0.37, 0.24, 0.012, { x, y: 2.5, z: 1.03 }));
  }
  add('planksDark', box(2.85, 0.1, 0.1, { y: 2.6, z: 0.85 }));
  add('planksDark', box(2.85, 0.1, 0.1, { y: 2.2, z: -0.85 }));
  // 계산대
  add('planks', box(2.5, 0.84, 0.55, { y: 0.42, z: 0.55 }));
  add('planksDark', box(2.66, 0.07, 0.72, { y: 0.875, z: 0.55 }));
  add('planksDark', box(2.5, 0.12, 0.05, { y: 0.1, z: 0.84 }));
  // 주괴 더미
  for (let i = 0; i < 5; i++) {
    const row = i < 3 ? 0 : 1;
    const x = -0.95 + (row ? 0.12 : 0) + (i % 3) * 0.24;
    add('copperMetal', box(0.21, 0.07, 0.11, { x, y: 0.945 + row * 0.07, z: 0.6, ry: (R() - 0.5) * 0.1 }));
  }
  // 저울
  add('iron', cyl(0.016, 0.02, 0.46, 6, { x: 0.72, y: 1.14, z: 0.5 }));
  add('iron', box(0.56, 0.02, 0.02, { x: 0.72, y: 1.36, z: 0.5 }));
  for (const dx of [-0.26, 0.26]) {
    add('iron', cyl(0.004, 0.004, 0.2, 3, { x: 0.72 + dx, y: 1.26, z: 0.5 }));
    add('iron', cyl(0.1, 0.075, 0.025, 14, { x: 0.72 + dx, y: 1.155, z: 0.5 }));
  }
  // 산딸기 바구니
  add('sack', lathe([[0, 0], [0.14, 0], [0.18, 0.05], [0.2, 0.14], [0.19, 0.15]], 12).translate(0.05, 0.91, 0.62));
  for (let i = 0; i < 9; i++) add('berry', P(new THREE.SphereGeometry(0.035, 6, 5), 0xa3182f, { x: 0.05 + (R() - 0.5) * 0.2, y: 1.05 + R() * 0.03, z: 0.62 + (R() - 0.5) * 0.2 }));
  // 뒤쪽 짐: 상자·통·자루
  crate(add, 0.6, { x: -0.85, y: 0.3, z: -0.45 });
  crate(add, 0.45, { x: -0.8, y: 0.83, z: -0.45, ry: 0.4 });
  barrel(add, { x: 0.25, z: -0.5 }, R);
  for (let i = 0; i < 2; i++) add('sack', lathe([[0, 0], [0.2, 0.02], [0.24, 0.2], [0.2, 0.42], [0.08, 0.52], [0.0, 0.53]], 10).translate(0.95, 0, -0.4 + i * 0.42));
  // 앞에 세운 작은 간판
  add('planksDark', box(0.06, 1.1, 0.06, { x: 1.75, y: 0.55, z: 1.05 }));
  add('planks', box(0.62, 0.42, 0.05, { x: 1.75, y: 1.0, z: 1.08 }));
  add('paper', box(0.48, 0.3, 0.01, { x: 1.75, y: 1.0, z: 1.11 }));
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
  // 도가니(v0.4.9): 돌턱 위에서 쇳물을 젓는다
  add('clay', lathe([[0, 0], [0.1, 0], [0.13, 0.08], [0.14, 0.17], [0.12, 0.17], [0.11, 0.1], [0, 0.1]], 12).translate(0, 0.61, 0.9));
  add('coal', cyl(0.115, 0.115, 0.012, 12, { y: 0.755, z: 0.9 }));
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
  for (const sz of [-1, 1]) add('planksDark', box(0.08, 0.6, 0.08, { x, y: 0.26, z: sz * 0.17, rx: sz * 0.3 }));
  add('planksDark', box(0.12, 0.1, 0.44, { x, y: 0.52 }));
}

function sawbench() {
  const { parts, fx, add } = kit();
  trestle(add, -0.75);
  trestle(add, 0.75);
  add('barkDark', taperTube([V(-1.2, 0.79, 0), V(1.25, 0.79, 0.02)], [0.24, 0.22], { radial: 12, vScale: 1.2, cap: true }));
  add('woodBox', cyl(0.215, 0.215, 0.02, 16, { x: 1.26, y: 0.79, rz: Math.PI / 2 }));
  add('metal', box(1.0, 0.16, 0.012, { x: 0.3, y: 1.09, z: 0.0, rz: 0.2 }));
  add('planksDark', box(0.06, 0.18, 0.05, { x: -0.25, y: 1.21, rz: 0.2 }));
  add('sawdust', cyl(0.6, 0.75, 0.04, 16, { y: 0.0, x: 0.3, sz: 0.6 }));
  // 켠 널은 일하는 자리(앞)와 겹치지 않게 뒤편에 쌓는다
  for (let i = 0; i < 4; i++) add('planks', box(1.6, 0.05, 0.26, { x: 0, y: 0.03 + i * 0.055, z: -1.05, ry: (i % 2) * 0.05 }));
  return { parts, fx };
}

function workbench() {
  const { parts, fx, add } = kit();
  add('planks', box(2.0, 0.1, 0.85, { y: 0.83 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add('planksDark', box(0.1, 0.79, 0.1, { x: sx * 0.88, y: 0.395, z: sz * 0.33 }));
  add('planksDark', box(1.8, 0.05, 0.6, { y: 0.22 }));
  add('iron', box(0.18, 0.2, 0.22, { x: -0.8, y: 0.98, z: 0.32 }));
  add('metal', cyl(0.015, 0.015, 0.4, 5, { x: -0.8, y: 0.99, z: 0.48, rx: Math.PI / 2 }));
  add('planksDark', box(0.28, 0.1, 0.1, { x: 0.4, y: 0.93, z: -0.1 }));
  add('planksDark', cyl(0.02, 0.02, 0.3, 5, { x: 0.4, y: 0.93, z: 0.08, rx: Math.PI / 2 }));
  add('metal', box(0.02, 0.02, 0.22, { x: 0.68, y: 0.89, z: 0.22, ry: 0.6 }));
  for (let i = 0; i < 3; i++) add('planks', box(1.4, 0.04, 0.2, { x: 0.1, y: 0.27 + i * 0.045, z: (i - 1) * 0.04 }));
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
  add('planks', box(0.3, 0.08, 0.9, { x: 1.45, y: 0.48, z: 0.5 }));
  for (const z of [0.15, 0.85]) add('planksDark', box(0.22, 0.46, 0.08, { x: 1.45, y: 0.23, z }));
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

// 무두질 틀(v0.3): 통나무 틀에 펼친 가죽 두 장, 물통, 긁개
function tannery() {
  const { parts, fx, add } = kit();
  const R = rng(41);
  for (const sx of [-1, 1]) add('barkDark', taperTube([V(sx * 0.8, -0.1, 0), V(sx * 0.8, 1.9, 0)], [0.07, 0.06], { radial: 7, vScale: 1.2 }));
  add('barkDark', taperTube([V(-0.9, 1.75, 0), V(0.9, 1.75, 0)], [0.05, 0.05], { radial: 6, vScale: 1.2 }));
  add('barkDark', taperTube([V(-0.9, 0.25, 0), V(0.9, 0.25, 0)], [0.05, 0.05], { radial: 6, vScale: 1.2 }));
  for (const [x, w, c] of [[-0.36, 0.62, 0x8a5a36], [0.36, 0.58, 0x6e4528]]) {
    add('leather', P(new THREE.PlaneGeometry(w, 1.25, 4, 6), c, { x, y: 1.0, z: 0.02 }));
    for (const dy of [-0.55, 0.55]) add('rope', box(0.02, 0.2, 0.02, { x: x - w / 2, y: 1.0 + dy * 0.9 }));
  }
  add('planks', lathe([[0, 0], [0.32, 0], [0.36, 0.42], [0.34, 0.44], [0, 0.44]], 14).translate(1.4, 0, 0.3));
  add('waterTop', P(new THREE.CircleGeometry(0.31, 14), 0x3a4a3a, { rx: -Math.PI / 2, x: 1.4, y: 0.4, z: 0.3 }));
  crate(add, 0.45, { x: -1.35, y: 0.22, z: 0.35, ry: R() });
  return { parts, fx };
}

// 갑주 작업대(v0.3): 작업 탁자, 가죽 조각, 조끼를 입힌 나무 몸통
function armorbench() {
  const { parts, fx, add } = kit();
  add('planks', box(1.7, 0.08, 0.8, { y: 0.84 }));
  for (const [x, z] of [[-0.75, -0.32], [0.75, -0.32], [-0.75, 0.32], [0.75, 0.32]]) add('planksDark', box(0.08, 0.84, 0.08, { x, y: 0.42, z }));
  add('leather', P(new THREE.PlaneGeometry(0.5, 0.35), 0x7a4e30, { rx: -Math.PI / 2, x: -0.35, y: 0.885, z: 0.05, rz: 0.3 }));
  add('leather', P(new THREE.PlaneGeometry(0.4, 0.3), 0x5e3c24, { rx: -Math.PI / 2, x: 0.25, y: 0.886, z: -0.1, rz: -0.4 }));
  add('iron', box(0.18, 0.02, 0.04, { x: 0.55, y: 0.9, z: 0.15, ry: 0.5 }));
  add('planksDark', taperTube([V(1.35, 0, 0), V(1.35, 1.0, 0)], [0.04, 0.04], { radial: 6, vScale: 1 }));
  add('leather', lathe([[0, 0.95], [0.2, 0.98], [0.22, 1.2], [0.19, 1.42], [0.13, 1.5], [0, 1.52]], 12, 0x6e4528).translate(1.35, 0, 0));
  add('planks', P(new THREE.SphereGeometry(0.1, 10, 8), 0x8a6a4a, { x: 1.35, y: 1.62 }));
  return { parts, fx };
}

// 약제대(v2.4): 작은 화로 위 증류 플라스크, 굽은 관, 약초 다발이 걸린 선반
function alembic() {
  const { parts, fx, add } = kit();
  add('planks', box(1.3, 0.07, 0.65, { y: 0.82 }));
  for (const [x, z] of [[-0.58, -0.26], [0.58, -0.26], [-0.58, 0.26], [0.58, 0.26]]) add('planksDark', box(0.07, 0.82, 0.07, { x, y: 0.41, z }));
  // 화로와 플라스크
  add('stone', cyl(0.2, 0.24, 0.22, 10, { x: -0.25, y: 0.97 }));
  add('glass', lathe([[0, 0], [0.16, 0.02], [0.22, 0.14], [0.2, 0.28], [0.08, 0.38], [0.05, 0.55], [0.06, 0.58], [0, 0.58]], 14).translate(-0.25, 1.08, 0));
  add('spirit', P(new THREE.SphereGeometry(0.15, 12, 8), 0x7fc6a0, { x: -0.25, y: 1.22, sy: 0.7 }));
  add('copperMetal', taperTube([V(-0.25, 1.64, 0), V(0.05, 1.7, 0), V(0.38, 1.45, 0.05), V(0.45, 1.05, 0.05)], [0.022, 0.021, 0.02, 0.018], { radial: 6 }));
  add('glass', lathe([[0, 0], [0.09, 0], [0.1, 0.14], [0.04, 0.2], [0.04, 0.24], [0, 0.24]], 10).translate(0.45, 0.855, 0.05));
  for (let i = 0; i < 3; i++) add('clay', lathe([[0, 0], [0.06, 0], [0.07, 0.1], [0.035, 0.15], [0, 0.15]], 10).translate(0.15 + i * 0.13, 0.855, -0.2));
  // 선반과 약초
  add('planksDark', box(0.06, 1.6, 0.06, { x: 0.9, y: 0.8, z: 0.1 }));
  add('planks', box(0.55, 0.05, 0.3, { x: 0.9, y: 1.35, z: 0.1 }));
  for (let i = 0; i < 3; i++) add('fern', P(new THREE.ConeGeometry(0.07, 0.32, 5), 0x6f8f4a, { x: 0.74 + i * 0.15, y: 1.16, z: 0.1, rx: Math.PI }));
  fx.fires.push({ p: V(-0.25, 1.02, 0), s: 0.22 });
  fx.lights.push({ kind: 'torch', p: V(-0.25, 1.25, 0) });
  return { parts, fx };
}

// 석공대(v2.4): 돌 작업 받침에 걸친 마름돌, 끌·망치, 다듬은 돌 더미
function stonebench() {
  const { parts, fx, add } = kit();
  const R = rng(57);
  add('stone', box(1.2, 0.62, 0.8, { y: 0.31 }));
  add('rockBare', box(0.7, 0.32, 0.45, { x: -0.1, y: 0.78, ry: 0.15 }));
  add('iron', box(0.03, 0.03, 0.22, { x: 0.35, y: 0.64, z: 0.15, ry: 0.6 }));
  add('planksDark', box(0.04, 0.04, 0.32, { x: 0.32, y: 0.65, z: -0.15, ry: -0.4 }));
  add('iron', box(0.12, 0.08, 0.08, { x: 0.38, y: 0.66, z: -0.27, ry: -0.4 }));
  for (let i = 0; i < 6; i++) {
    const row = i < 3 ? 0 : 1;
    add('stone', box(0.34, 0.18, 0.22, { x: 1.0 + (i % 3) * 0.12 - row * 0.05, y: 0.09 + row * 0.19, z: -0.15 + (i % 3) * 0.2 - row * 0.05, ry: (R() - 0.5) * 0.3 }));
  }
  add('sawdust', cyl(0.5, 0.55, 0.02, 12, { y: 0.01, z: 0.4 }));
  return { parts, fx };
}

// 공예대(v2.4): 작업 탁자에 바이스, 감긴 줄, 걸어 둔 낚싯대와 화살 통
function tinkerbench() {
  const { parts, fx, add } = kit();
  add('planks', box(1.5, 0.08, 0.7, { y: 0.84 }));
  for (const [x, z] of [[-0.66, -0.28], [0.66, -0.28], [-0.66, 0.28], [0.66, 0.28]]) add('planksDark', box(0.08, 0.84, 0.08, { x, y: 0.42, z }));
  add('iron', box(0.22, 0.14, 0.16, { x: 0.5, y: 0.95, z: 0.2 }));
  add('iron', cyl(0.015, 0.015, 0.3, 5, { x: 0.5, y: 0.98, z: 0.36, rx: Math.PI / 2 }));
  add('rope', P(new THREE.TorusGeometry(0.1, 0.035, 6, 14), 0xffffff, { x: -0.3, y: 0.9, z: 0.1, rx: Math.PI / 2 }));
  add('copperMetal', cyl(0.06, 0.06, 0.05, 10, { x: 0.05, y: 0.905, z: -0.15, rx: Math.PI / 2 }));
  // 기대 세운 낚싯대 둘
  for (const [x, lean] of [[-0.95, 0.12], [-1.05, -0.08]]) add('birch', taperTube([V(x, 0, -0.25), V(x + lean, 2.3, -0.3)], [0.02, 0.008], { radial: 5 }));
  // 화살 통
  add('leather', cyl(0.11, 0.09, 0.55, 10, { x: 0.95, y: 0.28, z: -0.15 }));
  for (let i = 0; i < 5; i++) add('planks', cyl(0.008, 0.008, 0.5, 3, { x: 0.92 + (i % 3) * 0.03, y: 0.7, z: -0.17 + (i % 2) * 0.04, rz: (i - 2) * 0.05 }));
  return { parts, fx };
}

export const STATIONS = { forge, smelter, sawbench, workbench, loom, kitchen, storage, tannery, armorbench, alembic, stonebench, tinkerbench };

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

// ── 숲머리(v0.4) ───────────────────────────────────
// 천막: 맞배 모양 캔버스, 마룻대·기둥·버팀줄·말뚝. 앞은 열려 있어 안쪽이 어둡게 보인다.
export function tent(seed, cloth = null) {
  const { parts, fx, add } = kit();
  const R = rng(seed);
  const L = 3.0;
  const hw = 1.25;
  const H = 1.95;
  const S = Math.hypot(hw, H);
  const th = Math.atan2(H, hw);
  const mat = cloth || (R() < 0.35 ? 'clothDyed' : 'cloth');
  for (const sx of [-1, 1]) add(mat, box(S + 0.08, 0.03, L, { x: (sx * hw) / 2, y: H / 2, rz: sx * -th + (sx > 0 ? Math.PI : 0) }));
  // 뒤판(삼각)과 앞의 어두운 안쪽
  const tri = (w, h) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w, 0);
    sh.lineTo(w, 0);
    sh.lineTo(0, h);
    sh.closePath();
    return prep(new THREE.ShapeGeometry(sh));
  };
  add(mat, xf(tri(hw, H), { z: -L / 2 }));
  add('ash', xf(tri(hw * 0.62, H * 0.66), { z: L / 2 - 0.25 }));
  // 걷어 올린 앞자락
  for (const sx of [-1, 1]) add(mat, xf(tri(0.42, 1.2), { x: sx * 0.95, y: 0.2, z: L / 2 + 0.02, rz: sx * 0.35 }));
  // 마룻대·기둥
  add('barkDark', taperTube([V(0, H + 0.05, -L / 2 - 0.15), V(0, H + 0.05, L / 2 + 0.15)], [0.045, 0.045], { radial: 6, vScale: 1, cap: true }));
  for (const z of [-L / 2 - 0.05, L / 2 + 0.05]) add('barkDark', taperTube([V(0, -0.15, z), V(0, H + 0.1, z)], [0.05, 0.045], { radial: 6, vScale: 1, cap: true }));
  // 버팀줄과 말뚝
  for (const z of [-1, 1]) {
    const top = V(0, H + 0.08, z * (L / 2 + 0.1));
    for (const sx of [-1, 1]) {
      const peg = V(sx * 1.0, 0.04, z * (L / 2 + 1.0));
      add('rope', taperTube([top, peg], [0.012, 0.012], { radial: 4, vScale: 1 }));
      add('planksDark', box(0.05, 0.22, 0.05, { x: peg.x, y: 0.06, z: peg.z, rx: z * 0.3 }));
    }
  }
  // 둘레 살림: 자루·통·장작 몇 개
  add('sack', lathe([[0, 0], [0.2, 0.02], [0.24, 0.2], [0.2, 0.42], [0.08, 0.52], [0.0, 0.53]], 10).translate(hw + 0.45, 0, 0.6));
  if (R() < 0.6) barrel(add, { x: -hw - 0.5, z: 0.4 }, R);
  else woodpile(add, R, { x: -hw - 0.55, z: 0, ry: Math.PI / 2 });
  return { parts, fx };
}

// 통나무 오두막: 귀를 엇걸어 쌓은 통나무 벽, 너와 지붕, 돌 굴뚝(연기)
export function cabin(seed) {
  const { parts, fx, add } = kit();
  const R = rng(seed);
  const W = 4.4;
  const D = 3.6;
  const rLog = 0.17;
  const rows = 9;
  for (let i = 0; i < rows; i++) {
    const y = 0.15 + i * rLog * 1.85;
    const odd = i % 2;
    for (const sz of [-1, 1]) {
      const z = sz * (D / 2);
      add('barkDark', taperTube([V(-W / 2 - 0.35, y + (odd ? rLog * 0.9 : 0), z), V(W / 2 + 0.35, y + (odd ? rLog * 0.9 : 0), z)], [rLog, rLog * 0.92], { radial: 7, vScale: 1.3, cap: true }));
    }
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2);
      add('barkDark', taperTube([V(x, y + (odd ? 0 : rLog * 0.9), -D / 2 - 0.35), V(x, y + (odd ? 0 : rLog * 0.9), D / 2 + 0.35)], [rLog * 0.95, rLog * 0.9], { radial: 7, vScale: 1.3, cap: true }));
    }
  }
  const top = 0.15 + rows * rLog * 1.85;
  const roofH = 1.6;
  // 박공(널빤지)
  const tri = new THREE.Shape();
  tri.moveTo(-D / 2, 0);
  tri.lineTo(D / 2, 0);
  tri.lineTo(0, roofH);
  tri.closePath();
  for (const sx of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.12, bevelEnabled: false });
    add('planksDark', xf(prep(g), { ry: Math.PI / 2, x: sx * (W / 2) - (sx > 0 ? 0.12 : 0), y: top }));
  }
  const ang = Math.atan2(roofH, D / 2);
  const slope = Math.hypot(D / 2, roofH) + 0.5;
  for (const sz of [-1, 1]) add('shingle', box(W + 1.1, 0.12, slope, { y: top + roofH / 2 + 0.04, z: sz * (D / 4 + 0.18), rx: sz * ang }));
  add('barkDark', taperTube([V(-W / 2 - 0.6, top + roofH + 0.1, 0), V(W / 2 + 0.6, top + roofH + 0.1, 0)], [0.12, 0.11], { radial: 7, vScale: 1.3, cap: true }));
  // 문·창
  add('planks', box(0.9, 1.8, 0.08, { x: -0.7, y: 1.05, z: D / 2 + 0.16 }));
  add('iron', box(0.05, 0.05, 0.08, { x: -0.38, y: 1.1, z: D / 2 + 0.22 }));
  add('window', box(0.7, 0.6, 0.06, { x: 1.0, y: 1.45, z: D / 2 + 0.16 }));
  add('planksDark', box(0.86, 0.08, 0.12, { x: 1.0, y: 1.1, z: D / 2 + 0.2 }));
  fx.glows.push(V(1.0, 1.45, D / 2 + 0.16));
  // 굴뚝
  add('stone', box(0.7, top + roofH + 0.9, 0.7, { x: W / 2 + 0.25, y: (top + roofH + 0.9) / 2, z: -0.7 }));
  fx.smokes.push(V(W / 2 + 0.25, top + roofH + 1.0, -0.7));
  woodpile(add, R, { x: -W / 2 - 0.7, z: 0.4, ry: Math.PI / 2 });
  return { parts, fx };
}

// 짓는 자리: 네 귀 말뚝과 줄, 쌓아 둔 판재·돌, 작은 팻말
export function site(seed, r = 1) {
  const { parts, fx, add } = kit();
  const R = rng(seed);
  const e = r + 0.45;
  const corners = [[-e, -e], [e, -e], [e, e], [-e, e]];
  for (const [x, z] of corners) add('barkDark', taperTube([V(x, -0.15, z), V(x, 0.75, z)], [0.045, 0.035], { radial: 6, vScale: 1, cap: true }));
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    add('rope', taperTube([V(ax, 0.62, az), V((ax + bx) / 2, 0.55, (az + bz) / 2), V(bx, 0.62, bz)], [0.012, 0.012, 0.012], { radial: 4, vScale: 1 }));
  }
  for (let i = 0; i < 6; i++) add('planks', box(1.4, 0.06, 0.22, { x: -0.25 + (R() - 0.5) * 0.06, y: 0.05 + i * 0.065, z: -0.25 + (i % 2) * 0.24, ry: (R() - 0.5) * 0.12 }));
  for (let i = 0; i < 5; i++) add('rockBare', xf(rockGeo(700 + seed * 7 + i, 0.16 + R() * 0.08, { sy: 0.7, detail: 1 }), { x: 0.55 + (R() - 0.5) * 0.4, y: 0.02, z: 0.45 + (R() - 0.5) * 0.4 }));
  add('planksDark', box(0.06, 0.95, 0.06, { x: -e - 0.4, y: 0.45, z: e }));
  add('planks', box(0.5, 0.34, 0.04, { x: -e - 0.4, y: 0.85, z: e + 0.03 }));
  add('paper', box(0.38, 0.24, 0.01, { x: -e - 0.4, y: 0.85, z: e + 0.06 }));
  return { parts, fx };
}

// 2단계 작업대 깃발
export function pennant(n = 2) {
  const { parts, fx, add } = kit();
  add('barkDark', taperTube([V(0, -0.2, 0), V(0, 2.9, 0)], [0.04, 0.03], { radial: 6, vScale: 1, cap: true }));
  for (let i = 0; i < n - 1; i++) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(0.75, -0.17);
    sh.lineTo(0, -0.36);
    sh.closePath();
    add('clothDyed', xf(prep(new THREE.ShapeGeometry(sh)), { x: 0.03, y: 2.85 - i * 0.45 }));
  }
  return { parts, fx };
}

// 횃불 기둥(숲머리 길목)
export function torch() {
  const { parts, fx, add } = kit();
  add('barkDark', taperTube([V(0, -0.25, 0), V(0, 1.9, 0)], [0.07, 0.06], { radial: 7, vScale: 1.2, cap: true }));
  add('iron', lathe([[0, 0], [0.14, 0.02], [0.17, 0.16], [0.15, 0.18], [0, 0.12]], 10).translate(0, 1.9, 0));
  add('coal', P(new THREE.SphereGeometry(0.11, 8, 6), 0xffffff, { y: 2.02, sy: 0.6 }));
  fx.fires.push({ p: V(0, 2.08, 0), s: 0.45, low: true });
  fx.lights.push({ kind: 'torch', p: V(0, 2.3, 0) });
  return { parts, fx };
}

export function fence(len) {
  const { parts, fx, add } = kit();
  const R = rng(Math.floor(len * 100));
  for (let x = 0; x <= len; x += 1.6) add('barkDark', taperTube([V(x, -0.2, 0), V(x, 1.0 + R() * 0.1, 0)], [0.06, 0.05], { radial: 6, vScale: 1, cap: true }));
  for (const y of [0.45, 0.85]) add('planksDark', box(len + 0.2, 0.08, 0.05, { x: len / 2, y }));
  return { parts, fx };
}

// ── 검은 돛 약탈단(v0.5) ──────────────────────────
// 검은 돛 깃발: 장대 끝에 가로대, 타르 먹인 검은 천(끝이 찢겨 있다)과 붉은 줄
// 본토 배 깃발(v0.5.1)은 같은 꼴에 푸른 천·흰 줄
export function banner(seed = 1, cloth = 'sailBlack', stripe = 'clothRed') {
  const { parts, fx, add } = kit();
  const R = rng(seed + 300);
  add('barkDark', taperTube([V(0, -0.3, 0), V(0.04, 4.2, 0)], [0.075, 0.05], { radial: 7, vScale: 1.2, cap: true }));
  add('barkDark', taperTube([V(-0.05, 3.95, 0), V(1.35, 3.95, 0.02)], [0.035, 0.03], { radial: 6, vScale: 1, cap: true }));
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.lineTo(1.25, 0);
  // 아래 끝은 너덜너덜
  const n = 7;
  for (let i = n; i >= 0; i--) sh.lineTo((i / n) * 1.25, -1.75 - (i % 2 ? 0.22 : 0) - R() * 0.12);
  sh.closePath();
  add(cloth, xf(prep(new THREE.ShapeGeometry(sh)), { x: 0.05, y: 3.92, z: 0.02 }));
  add(stripe, box(1.2, 0.12, 0.01, { x: 0.68, y: 3.3, z: 0.03 }));
  add('rope', taperTube([V(0.04, 4.15, 0), V(1.3, 3.97, 0.02)], [0.01, 0.01], { radial: 4, vScale: 1 }));
  return { parts, fx };
}

// 끝을 깎은 말뚝 울타리(약탈단 야영지)
export function palisade(len = 8) {
  const { parts, fx, add } = kit();
  const R = rng(Math.floor(len * 37));
  for (let x = 0; x <= len; x += 0.42) {
    const h = 1.6 + R() * 0.45;
    const lean = (R() - 0.5) * 0.08;
    add('barkDark', taperTube([V(x, -0.3, 0), V(x + lean, h, 0)], [0.11, 0.1], { radial: 7, vScale: 1.2 }));
    add('planksDark', P(new THREE.ConeGeometry(0.1, 0.32, 7), 0xffffff, { x: x + lean, y: h + 0.16 }));
  }
  for (const y of [0.5, 1.25]) add('rope', taperTube([V(-0.1, y, 0.11), V(len + 0.1, y, 0.11)], [0.018, 0.018], { radial: 4, vScale: 1 }));
  return { parts, fx };
}

// 상자 더미: 상자 셋·통 하나·자루
export function crates(seed = 1) {
  const { parts, fx, add } = kit();
  const R = rng(seed + 900);
  crate(add, 0.7, { x: -0.4, y: 0.35, ry: R() * 0.3 });
  crate(add, 0.6, { x: 0.35, y: 0.3, z: 0.15, ry: -R() * 0.4 });
  crate(add, 0.5, { x: -0.3, y: 0.95, z: 0.05, ry: R() * 0.6 });
  barrel(add, { x: 0.45, z: -0.6 }, R);
  add('sack', lathe([[0, 0], [0.2, 0.02], [0.24, 0.2], [0.2, 0.42], [0.08, 0.52], [0.0, 0.53]], 10).translate(-0.9, 0, -0.4));
  return { parts, fx };
}

// 망루: 통나무 기둥 넷, 4m 높이 발판·난간, 사다리, 꼭대기 검은 깃발과 횃불
export function watchtower() {
  const { parts, fx, add } = kit();
  const H = 3.6;
  const w = 1.25;
  const corners = [[-w, -w], [w, -w], [w, w], [-w, w]];
  for (const [x, z] of corners) add('barkDark', taperTube([V(x * 1.12, -0.3, z * 1.12), V(x * 0.92, H + 1.15, z * 0.92)], [0.13, 0.1], { radial: 8, vScale: 1.4, cap: true }));
  // 엇갈린 버팀대
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    add('barkDark', taperTube([V(ax * 1.08, 0.3, az * 1.08), V(bx * 0.96, H - 0.4, bz * 0.96)], [0.06, 0.06], { radial: 5, vScale: 1 }));
  }
  add('planks', box(w * 2.3, 0.12, w * 2.3, { y: H }));
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    add('planksDark', taperTube([V(ax * 0.95, H + 0.95, az * 0.95), V(bx * 0.95, H + 0.95, bz * 0.95)], [0.05, 0.05], { radial: 5, vScale: 1 }));
    if (i !== 2) add('planksDark', box(Math.hypot(bx - ax, bz - az) * 0.95, 0.5, 0.05, { x: (ax + bx) * 0.475, y: H + 0.4, z: (az + bz) * 0.475, ry: Math.atan2(-(bz - az), bx - ax) }));
  }
  // 사다리(앞쪽)
  for (const x of [-0.28, 0.28]) add('barkDark', taperTube([V(x, -0.1, w * 1.55), V(x, H + 0.2, w * 1.05)], [0.04, 0.04], { radial: 5, vScale: 1 }));
  for (let k = 1; k < 10; k++) {
    const f = k / 10;
    add('planksDark', taperTube([V(-0.3, f * H, w * (1.55 - 0.5 * f)), V(0.3, f * H, w * (1.55 - 0.5 * f))], [0.025, 0.025], { radial: 4, vScale: 1 }));
  }
  // 지붕 대신 걸어 둔 검은 천
  add('sailBlack', box(w * 2.2, 0.03, w * 2.2, { y: H + 1.25, rx: 0.08 }));
  const b = banner(7);
  for (const [mat, list] of Object.entries(b.parts)) for (const g of list) add(mat, xf(g, { x: -w * 0.9, y: H - 0.2, z: -w * 0.9, sx: 0.6, sy: 0.6, sz: 0.6 }));
  fx.fires.push({ p: V(w * 0.9, H + 1.35, w * 0.9), s: 0.4, low: true });
  fx.lights.push({ kind: 'torch', p: V(w * 0.9, H + 1.5, w * 0.9) });
  add('iron', lathe([[0, 0], [0.12, 0.02], [0.15, 0.14], [0.13, 0.16], [0, 0.1]], 10).translate(w * 0.9, H + 1.2, w * 0.9));
  return { parts, fx };
}

// 정박한 검은 돛 배: 모래톱에 얹힌 선체에 높은 돛대와 검은 돛
export function shipBlack(sailMat = 'sailBlack') {
  const base = wreck();
  const { parts, fx } = base;
  const add = (mat, g) => (parts[mat] ||= []).push(g);
  add('barkDark', taperTube([V(0.6, 0.2, 0), V(0.55, 8.2, 0)], [0.2, 0.12], { radial: 9, vScale: 1.5, cap: true }));
  add('barkDark', taperTube([V(0.55, 7.2, -2.4), V(0.55, 7.2, 2.4)], [0.08, 0.07], { radial: 6, vScale: 1, cap: true }));
  add('barkDark', taperTube([V(0.58, 3.4, -2.0), V(0.58, 3.4, 2.0)], [0.07, 0.07], { radial: 6, vScale: 1, cap: true }));
  // 돛: 바람에 조금 부푼 사각 천
  const sail = new THREE.PlaneGeometry(4.4, 3.6, 8, 6);
  const pos = sail.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / 2.2;
    const v = pos.getY(i) / 1.8;
    pos.setZ(i, (1 - u * u) * (1 - v * v * 0.6) * 0.45);
  }
  sail.computeVertexNormals();
  add(sailMat, xf(sail, { x: 0.75, y: 5.3, ry: Math.PI / 2 }));
  for (const z of [-2.3, 2.3]) add('rope', taperTube([V(0.55, 8.0, 0), V(4.6, 0.5, z)], [0.015, 0.015], { radial: 4, vScale: 1 }));
  add('rope', taperTube([V(0.55, 8.0, 0), V(-4.8, 0.6, 0)], [0.015, 0.015], { radial: 4, vScale: 1 }));
  return { parts, fx };
}

// 늪 탑(v0.6.1): 등대와 같은 옛 등불탑이지만 불빛 자리가 없고 유리는 흐린 돌빛이다
export function towerOld() {
  const t = lighthouse();
  t.fx.lights = [];
  t.fx.glows = [];
  if (t.parts.lens) {
    (t.parts.rockBare ||= []).push(...t.parts.lens);
    delete t.parts.lens;
  }
  if (t.parts.window) {
    (t.parts.barkDark ||= []).push(...t.parts.window);
    delete t.parts.window;
  }
  return t;
}

// 영맥 펌프 시제품(v0.6.1): 쇠통, 땅에 박힌 관, 돌리는 바퀴
export function pump() {
  const { parts, fx, add } = kit();
  add('planksDark', box(2.2, 0.25, 1.6, { y: 0.12 }));
  add('iron', P(new THREE.CylinderGeometry(0.55, 0.6, 1.5, 14), 0xffffff, { y: 1.0 }));
  add('copperMetal', P(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 14), 0xffffff, { y: 0.45 }));
  add('copperMetal', P(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 14), 0xffffff, { y: 1.55 }));
  add('iron', taperTube([V(0.5, 1.2, 0), V(1.0, 1.0, 0), V(1.1, 0.2, 0), V(1.1, -0.6, 0)], [0.09, 0.09, 0.09, 0.09], { radial: 8, vScale: 1, cap: true }));
  add('iron', P(new THREE.TorusGeometry(0.42, 0.04, 6, 18), 0xffffff, { x: -0.62, y: 1.25, ry: Math.PI / 2 }));
  for (let i = 0; i < 4; i++) add('iron', box(0.04, 0.8, 0.04, { x: -0.62, y: 1.25, rx: (i * Math.PI) / 4 }));
  add('spirit', P(new THREE.SphereGeometry(0.14, 10, 8), 0xffffff, { y: 1.85 }));
  return { parts, fx };
}

// 퀘스트 물체(v0.5) ─ 바다 궤짝: 쇠띠를 두른 나무 궤짝, 뚜껑은 반달
export function chest(seed = 1) {
  const { parts, fx, add } = kit();
  const W = 0.9;
  const D = 0.55;
  add('planksDark', box(W, 0.45, D, { y: 0.225 }));
  add('planksDark', P(new THREE.CylinderGeometry(D / 2, D / 2, W, 12, 1, false, 0, Math.PI), 0xffffff, { y: 0.45, rz: Math.PI / 2, ry: 0 }));
  for (const x of [-0.3, 0.3]) {
    add('iron', box(0.06, 0.47, D + 0.02, { x, y: 0.235 }));
    add('iron', P(new THREE.CylinderGeometry(D / 2 + 0.012, D / 2 + 0.012, 0.06, 12, 1, true, 0, Math.PI), 0xffffff, { x, y: 0.45, rz: Math.PI / 2 }));
  }
  add('copperMetal', box(0.12, 0.14, 0.03, { y: 0.4, z: D / 2 + 0.01 }));
  // 둘레에 엉킨 해초 한 줌
  const R = rng(seed + 50);
  for (let i = 0; i < 3; i++) add('rope', taperTube(bentPath(V(-0.4 + i * 0.35, 0.02, D / 2 + 0.05), V(0.2, 0.1, 0.3), 0.5, 5, V(0, -0.1, 0), R), new Array(6).fill(0.012), { radial: 4 }));
  return { parts, fx };
}

// 숲머리 보급 상자: 초록 천을 묶고 숲머리 표식(나무 꼴)을 그은 상자
export function supply() {
  const { parts, fx, add } = kit();
  crate(add, 0.72, { y: 0.36 });
  add('clothGreen', box(0.74, 0.12, 0.76, { y: 0.48 }));
  add('clothGreen', box(0.12, 0.74, 0.76, { y: 0.36 }));
  add('rope', P(new THREE.TorusGeometry(0.42, 0.015, 4, 16), 0xffffff, { y: 0.36, ry: Math.PI / 2 }));
  add('paper', box(0.22, 0.26, 0.01, { y: 0.5, z: 0.37 }));
  return { parts, fx };
}

// 망루 탁자: 받침 둘에 판자, 펼친 종이·장부·등잔
export function papers() {
  const { parts, fx, add } = kit();
  trestle(add, -0.5);
  trestle(add, 0.5);
  add('planks', box(1.5, 0.06, 0.7, { y: 0.6 }));
  const R = rng(77);
  for (let i = 0; i < 5; i++) add('paper', box(0.24 + R() * 0.1, 0.006, 0.32, { x: -0.45 + i * 0.22, y: 0.635, z: (R() - 0.5) * 0.2, ry: (R() - 0.5) * 0.6 }));
  add('leather', box(0.26, 0.05, 0.34, { x: 0.5, y: 0.655, z: 0.1, ry: 0.3 }));
  add('iron', lathe([[0, 0], [0.06, 0], [0.07, 0.05], [0.04, 0.12], [0.05, 0.16], [0, 0.17]], 10).translate(-0.55, 0.63, -0.2));
  fx.glows.push(V(-0.55, 0.77, -0.2));
  return { parts, fx };
}

// ── 옛 등불터(v0.5.1) ─────────────────────────────
// 등지기 제단: 여덟모 돌 기단 두 단, 가운데 받침 위 불씨 그릇. 기단 모서리에 작은 돌 등잔 넷
export function altar() {
  const { parts, fx, add } = kit();
  add('rock', cyl(1.3, 1.42, 0.3, 8, { y: 0.15 }));
  add('stone', cyl(0.98, 1.06, 0.28, 8, { y: 0.44 }));
  add('rock', box(0.95, 0.16, 0.4, { y: 0.38, z: 1.32 }));
  add('stone', box(0.52, 0.68, 0.52, { y: 0.92 }));
  add('stone', box(0.74, 0.12, 0.74, { y: 1.32 }));
  add('stone', lathe([[0, 0], [0.36, 0], [0.45, 0.12], [0.47, 0.22], [0.41, 0.22], [0.34, 0.1], [0, 0.1]], 12).translate(0, 1.38, 0));
  add('ash', cyl(0.35, 0.35, 0.02, 12, { y: 1.49 }));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    add('stone', box(0.16, 0.22, 0.16, { x: Math.sin(a) * 0.82, y: 0.69, z: Math.cos(a) * 0.82, ry: a }));
    add('stone', box(0.22, 0.05, 0.22, { x: Math.sin(a) * 0.82, y: 0.82, z: Math.cos(a) * 0.82, ry: a }));
  }
  return { parts, fx };
}

// 돌기둥: 받침·몸·기둥머리(작은 돌 등잔). broken은 허리에서 부러졌고, fallen은 마디째 쓰러져 있다
export function pillar(kind = 'pillar', seed = 1) {
  const { parts, fx, add } = kit();
  const R = rng(seed + 610);
  if (kind === 'pillar_fallen') {
    add('rock', box(0.8, 0.28, 0.8, { y: 0.14 }));
    let z = 0.55;
    for (let i = 0; i < 3; i++) {
      const len = 0.85 + R() * 0.3;
      add('rock', box(0.5, 0.5, len, { x: (R() - 0.5) * 0.3, y: 0.24, z: z + len / 2, ry: (R() - 0.5) * 0.35, rz: (R() - 0.5) * 0.25 }));
      z += len + 0.1 + R() * 0.25;
    }
    add('stone', box(0.78, 0.18, 0.78, { x: 0.5, y: 0.12, z: z + 0.3, ry: 0.5, rx: 0.2 }));
    return { parts, fx };
  }
  const broken = kind === 'pillar_broken';
  const H = broken ? 1.1 + R() * 0.6 : 2.9;
  add('rock', box(0.86, 0.28, 0.86, { y: 0.14 }));
  add('stone', box(0.64, 0.12, 0.64, { y: 0.34 }));
  add('rock', box(0.5, H, 0.5, { y: 0.4 + H / 2 }));
  add('stone', box(0.55, 0.08, 0.55, { y: 0.4 + Math.min(H - 0.1, 1.8) }));
  if (!broken) {
    add('stone', box(0.66, 0.14, 0.66, { y: 0.4 + H + 0.07 }));
    add('stone', box(0.8, 0.18, 0.8, { y: 0.4 + H + 0.23 }));
    add('stone', lathe([[0, 0], [0.14, 0], [0.18, 0.1], [0.1, 0.2], [0.13, 0.26], [0, 0.27]], 8).translate(0, 0.4 + H + 0.32, 0));
  } else {
    for (let i = 0; i < 3; i++) add('rock', box(0.2 + R() * 0.15, 0.16 + R() * 0.2, 0.2 + R() * 0.15, { x: (R() - 0.5) * 0.28, y: 0.4 + H + 0.04, z: (R() - 0.5) * 0.28, rx: R() * 0.6, rz: R() * 0.6 }));
    add('rock', box(0.48, 0.48, 0.85, { x: 0.8, y: 0.22, z: 0.35, ry: 0.7, rx: 0.12 }));
  }
  return { parts, fx };
}

// 돌 문: 기둥 둘에 두 겹 들보. 들보 가운데 둥근 등불 새김, 떨어져 나간 들보 끝 한 토막
export function arch() {
  const { parts, fx, add } = kit();
  const W = 1.7;
  const H = 3.1;
  for (const sx of [-1, 1]) {
    add('rock', box(0.78, 0.3, 0.78, { x: sx * W, y: 0.15 }));
    add('rock', box(0.56, H, 0.56, { x: sx * W, y: 0.3 + H / 2 }));
    add('stone', box(0.68, 0.14, 0.68, { x: sx * W, y: 0.3 + H + 0.07 }));
  }
  add('stone', box(W * 2 + 0.9, 0.36, 0.7, { y: 0.3 + H + 0.32 }));
  add('rock', box(W * 2 + 0.3, 0.24, 0.55, { x: -0.3, y: 0.3 + H + 0.62 }));
  add('stone', cyl(0.32, 0.32, 0.08, 16, { y: 0.3 + H + 0.32, z: 0.37, rx: Math.PI / 2 }));
  add('spiritDim', cyl(0.12, 0.12, 0.09, 12, { y: 0.3 + H + 0.32, z: 0.38, rx: Math.PI / 2 }));
  add('rock', box(0.62, 0.36, 0.55, { x: W + 1.2, y: 0.18, z: 0.7, ry: 0.5, rz: 0.2 }));
  return { parts, fx };
}

// 벽화: 무너진 벽 한 토막. 가운데 둥근 심장과 둘레의 탑 다섯을 돋을새김했다. 서쪽(늪) 탑 하나만 불이 꺼져 있다
export function mural() {
  const { parts, fx, add } = kit();
  add('rock', box(3.0, 0.3, 0.72, { y: 0.15 }));
  add('stone', box(2.8, 2.1, 0.42, { y: 1.35 }));
  add('rock', box(1.25, 0.34, 0.44, { x: -0.75, y: 2.55, rz: 0.08 }));
  add('rock', box(0.7, 0.24, 0.44, { x: 0.95, y: 2.47, rz: -0.12 }));
  const cy = 1.4;
  add('muralPaint', P(new THREE.TorusGeometry(0.62, 0.035, 6, 32), 0xffffff, { y: cy, z: 0.22 }));
  add('muralPaint', P(new THREE.TorusGeometry(0.2, 0.03, 6, 20), 0xffffff, { y: cy, z: 0.22 }));
  add('spirit', P(new THREE.CircleGeometry(0.15, 16), 0xffffff, { y: cy, z: 0.222 }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = Math.sin(a) * 0.62;
    const y = cy + Math.cos(a) * 0.62;
    add('muralPaint', box(0.1, 0.26, 0.03, { x, y: y + 0.02, z: 0.228 }));
    add('muralPaint', box(0.16, 0.04, 0.03, { x, y: y + 0.16, z: 0.228 }));
    add(i === 3 ? 'ash' : 'spiritDim', box(0.08, 0.07, 0.035, { x, y: y + 0.22, z: 0.232 }));
    // 탑에서 심장으로 이어지는 맥(가는 선)
    add('muralPaint', box(0.02, 0.36, 0.02, { x: x * 0.62, y: cy + (y - cy) * 0.62, z: 0.226, rz: -a }));
  }
  return { parts, fx };
}

// 무너진 돌 더미
export function rubble(seed = 1) {
  const { parts, fx, add } = kit();
  const R = rng(seed + 720);
  for (let i = 0; i < 8; i++) {
    const s0 = 0.22 + R() * 0.4;
    add(i % 3 ? 'rock' : 'stone', box(s0 * (1 + R()), s0, s0 * (0.8 + R() * 0.6), { x: (R() - 0.5) * 2.4, y: s0 * 0.38, z: (R() - 0.5) * 1.8, ry: R() * 3, rx: (R() - 0.5) * 0.5, rz: (R() - 0.5) * 0.5 }));
  }
  return { parts, fx };
}

// 옛 화로(퀘스트 물체): 돌 받침 위 쇠 화로. lit이면 숯이 달아 있고 불이 탄다
export function brazier(lit = false) {
  const { parts, fx, add } = kit();
  add('rock', box(0.62, 0.34, 0.62, { y: 0.17 }));
  add('stone', cyl(0.15, 0.2, 0.46, 8, { y: 0.57 }));
  add('iron', lathe([[0, 0], [0.12, 0], [0.34, 0.12], [0.44, 0.3], [0.42, 0.32], [0.3, 0.18], [0, 0.16]], 12).translate(0, 0.8, 0));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.5;
    add('iron', box(0.04, 0.32, 0.04, { x: Math.sin(a) * 0.3, y: 0.92, z: Math.cos(a) * 0.3, rx: Math.cos(a) * 0.45, rz: -Math.sin(a) * 0.45 }));
  }
  add(lit ? 'coal' : 'ash', P(new THREE.SphereGeometry(0.3, 10, 6), 0xffffff, { y: 0.98, sy: 0.32 }));
  if (lit) {
    fx.fires.push({ p: V(0, 1.04, 0), s: 0.75 });
    fx.lights.push({ kind: 'torch', p: V(0, 1.5, 0) });
  }
  return { parts, fx };
}

// 같은 재질 조각끼리 합친다
export function bake(model) {
  const out = {};
  for (const [mat, list] of Object.entries(model.parts)) out[mat] = merge(list);
  return out;
}

// 안개의 심장(v1.3): 땅에서 솟은 푸른 결정 다발. 가운데 큰 결정이 숨 쉬듯 빛난다
export function heartCrystal() {
  const { parts, fx, add } = kit();
  add('rockBare', P(new THREE.CylinderGeometry(2.4, 2.9, 0.6, 12), 0xffffff, { y: 0.2 }));
  add('spirit', P(new THREE.OctahedronGeometry(1.0, 0), 0xffffff, { y: 2.6, sy: 2.0 }));
  const R = rng(77);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + R() * 0.3;
    const d = 1.2 + R() * 0.9;
    const h = 0.6 + R() * 1.2;
    add(i % 3 === 0 ? 'spirit' : 'spiritDim', P(new THREE.OctahedronGeometry(0.32 + R() * 0.2, 0), 0xffffff,
      { x: Math.cos(a) * d, z: Math.sin(a) * d, y: 0.6 + h * 0.6, sy: 1.6 + h, rz: (R() - 0.5) * 0.6, rx: (R() - 0.5) * 0.6 }));
  }
  // 땅 밑으로 뻗는 영맥 줄기
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add('spiritDim', box(0.18, 0.05, 3.2, { x: Math.cos(a) * 3.2, z: Math.sin(a) * 3.2, y: 0.03, ry: -a + Math.PI / 2 }));
  }
  fx.glows.push(V(0, 2.6, 0));
  return { parts, fx };
}

// 해든의 채굴 장치(v1.3): 쇠 틀 망루 아래 땅에 박힌 굴착 관, 김을 뿜는 통 둘
export function drillRig() {
  const { parts, fx, add } = kit();
  add('planksDark', box(4.2, 0.3, 4.2, { y: 0.15 }));
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    add('iron', P(new THREE.CylinderGeometry(0.1, 0.14, 5.2, 8), 0xffffff, { x: x * 0.8, z: z * 0.8, y: 2.6, rx: -z * 0.05, rz: x * 0.05 }));
  }
  for (const y of [1.6, 3.4]) add('iron', P(new THREE.TorusGeometry(1.35, 0.06, 4, 4), 0xffffff, { y, rx: Math.PI / 2, rz: Math.PI / 4 }));
  add('copperMetal', P(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), 0xffffff, { y: 5.3 }));
  add('iron', P(new THREE.CylinderGeometry(0.22, 0.22, 5.6, 10), 0xffffff, { y: 2.5 }));
  add('spirit', P(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 10), 0xffffff, { y: 0.45 }));
  for (const x of [-2.4, 2.4]) {
    add('iron', P(new THREE.CylinderGeometry(0.6, 0.65, 1.6, 12), 0xffffff, { x, y: 0.95 }));
    add('copperMetal', P(new THREE.CylinderGeometry(0.66, 0.66, 0.1, 12), 0xffffff, { x, y: 1.75 }));
    add('iron', taperTube([V(x * 0.8, 1.2, 0), V(x * 0.4, 1.4, 0), V(0.25 * Math.sign(x), 1.1, 0)], [0.08, 0.08, 0.08], { radial: 6, vScale: 1, cap: true }));
    fx.smokes.push(V(x, 1.9, 0));
  }
  return { parts, fx };
}
