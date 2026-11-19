// 모형 도우미: 가늘어지는 관(나무줄기·가지·통나무), 울퉁불퉁한 바위, 잎 카드, 회전체.
// 모든 조각은 position·normal·uv·color 네 속성을 맞춰 두고 하나로 합친다.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three-addons';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// 색 속성을 붙이고(없으면 흰색), uv가 없으면 0을 채운다
export function prep(geo, color = 0xffffff) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.color) {
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

export function xf(geo, t = {}) {
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _q.setFromEuler(_e.set(t.rx || 0, t.ry || 0, t.rz || 0, t.order || 'XYZ'));
  _s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
  geo.applyMatrix4(_m.compose(_p, _q, _s));
  return geo;
}

export const P = (geo, color, t) => xf(prep(geo, color), t);

export function merge(list) {
  const g = mergeGeometries(list.filter(Boolean), false);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// 경로를 따라 가늘어지는 관. uv: u = 둘레(0~1), v = 길이(m / vScale)
export function taperTube(points, radii, { radial = 8, vScale = 1, cap = false, color = 0xffffff, twist = 0 } = {}) {
  const n = points.length;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  let prevN = null;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (i < n - 1) T.subVectors(points[i + 1], p).normalize();
    else T.subVectors(p, points[i - 1]).normalize();
    if (!prevN) {
      N.set(0, 1, 0);
      if (Math.abs(T.dot(N)) > 0.9) N.set(1, 0, 0);
      N.sub(T.clone().multiplyScalar(N.dot(T))).normalize();
    } else {
      N.copy(prevN).sub(T.clone().multiplyScalar(prevN.dot(T))).normalize();
    }
    prevN = N.clone();
    B.crossVectors(T, N);
    if (i > 0) len += p.distanceTo(points[i - 1]);
    for (let r = 0; r <= radial; r++) {
      const a = (r / radial) * Math.PI * 2 + twist * i;
      const cx = Math.cos(a);
      const sx = Math.sin(a);
      const dx = N.x * cx + B.x * sx;
      const dy = N.y * cx + B.y * sx;
      const dz = N.z * cx + B.z * sx;
      pos.push(p.x + dx * radii[i], p.y + dy * radii[i], p.z + dz * radii[i]);
      nor.push(dx, dy, dz);
      uv.push(r / radial, len / vScale);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let r = 0; r < radial; r++) {
      const a = i * row + r;
      const b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (cap) {
    const c = points[n - 1];
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    nor.push(T.x, T.y, T.z);
    uv.push(0.5, len / vScale);
    for (let r = 0; r < radial; r++) idx.push((n - 1) * row + r, (n - 1) * row + r + 1, ci);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return prep(g, color);
}

// 휘어진 경로(시작점, 방향, 길이, 굽힘)
export function bentPath(start, dir, length, steps, bend = new THREE.Vector3(), R = Math.random) {
  const pts = [];
  const d = dir.clone().normalize();
  const p = start.clone();
  for (let i = 0; i <= steps; i++) {
    pts.push(p.clone());
    const k = length / steps;
    d.addScaledVector(bend, k / length).add(new THREE.Vector3((R() - 0.5) * 0.05, (R() - 0.5) * 0.03, (R() - 0.5) * 0.05)).normalize();
    p.addScaledVector(d, k);
  }
  return pts;
}

// 3D 값 잡음(바위 표면용)
function h3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function n3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(
    L(L(h3(ix, iy, iz), h3(ix + 1, iy, iz), u), L(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), u), v),
    L(L(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), u), L(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}

// 바위: 다듬은 이코사면체를 잡음으로 울퉁불퉁하게, 바닥은 납작하게
export function rockGeo(seed, radius, { detail = 3, sx = 1, sy = 0.7, sz = 1, rough = 0.28, sink = 0.25, color = 0xffffff } = {}) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const off = seed * 13.17;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const n = n3(x * 1.6 + off, y * 1.6, z * 1.6) * 0.6 + n3(x * 3.7 + off, y * 3.7, z * 3.7) * 0.3 + n3(x * 8 + off, y * 8, z * 8) * 0.1;
    // 깎인 면 느낌: 잡음을 계단처럼
    const f = 1 + (n - 0.5) * 2 * rough;
    x *= f * sx;
    y *= f * sy;
    z *= f * sz;
    if (y < -sink) y = -sink + (y + sink) * 0.15;
    p.setXYZ(i, x * radius, (y + sink) * radius, z * radius);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const ng = mergeVertices(g, 1e-4);
  ng.computeVertexNormals();
  return prep(ng, color);
}

// 잎 카드 하나: 중심 c, 크기 s, 방향(yaw, pitch), 노멀은 수관 중심에서 바깥으로(둥글게 보이게)
export function leafCard(c, s, yaw, pitch, crown, { aspect = 1 } = {}) {
  const g = new THREE.PlaneGeometry(s, s * aspect);
  xf(g, { rx: pitch, ry: yaw, order: 'YXZ' });
  g.translate(c.x, c.y, c.z);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const d = new THREE.Vector3(p.getX(i) - crown.x, (p.getY(i) - crown.y) * 1.3, p.getZ(i) - crown.z).normalize();
    n.setXYZ(i, d.x * 0.8, d.y * 0.8 + 0.25, d.z * 0.8);
  }
  return prep(g);
}

export function lathe(profile, segs = 16, color = 0xffffff) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  return prep(g, color);
}
