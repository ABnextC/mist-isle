// 로우폴리 모형 도우미: 기본 도형에 정점 색을 입히고, 옮기고, 하나로 합친다.
// 텍스처 없이 형태와 색으로만 그린다.

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function place(geo, t = {}) {
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _q.setFromEuler(_e.set(t.rx || 0, t.ry || 0, t.rz || 0));
  _s.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1);
  geo.applyMatrix4(_m.compose(_p, _q, _s));
  return geo;
}

export const part = (geo, color, t) => place(paint(geo, color), t);

export function merge(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// 결정적 의사 난수(모양 흩뿌리기용). 같은 키면 같은 값.
export function rand01(key, i = 0) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < key.length; k++) {
    h ^= key.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export const flatMat = (opts = {}) => new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0, ...opts,
});
