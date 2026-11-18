// 지형 메시: 코어의 높이 함수로 만든 로우폴리 땅. 면마다 색을 하나씩 칠한다.

import * as THREE from 'three';
import { valueNoise } from '../../core/terrain.js';

const SAND = new THREE.Color(0xe0cc98);
const WET = new THREE.Color(0xb7a275);
const GRASS = [new THREE.Color(0x7aa35a), new THREE.Color(0x6c9650), new THREE.Color(0x86ac5f)];
const DRY = new THREE.Color(0xa6a466);
const ROCK = new THREE.Color(0x857f74);
const ROCK2 = new THREE.Color(0x6f6a62);
const _c = new THREE.Color();

const PLAZA = new THREE.Color(0x9d8a68);

function faceColor(h, slope, x, z, seed, town) {
  const n = valueNoise(x / 6, z / 6, seed + 3);
  if (town) {
    const d = Math.hypot(x - town.x, z - town.z) / town.radius;
    if (d < 0.62) return _c.copy(PLAZA).lerp(GRASS[1], Math.max(0, d - 0.35) * 2.2 * n);
  }
  if (h < -0.2) return _c.copy(WET).lerp(SAND, Math.max(0, (h + 3) / 3) * 0.5);
  if (h < 1.15) return _c.copy(SAND).lerp(WET, Math.max(0, 0.4 - h) * 0.8);
  if (slope > 0.75 || h > 17) return _c.copy(n > 0.5 ? ROCK : ROCK2);
  if (h < 1.6) return _c.copy(SAND).lerp(GRASS[0], (h - 1.15) / 0.45);
  const g = GRASS[Math.floor(n * 2.999)];
  _c.copy(g);
  if (slope > 0.45) _c.lerp(ROCK, (slope - 0.45) * 1.6);
  if (h > 11) _c.lerp(DRY, Math.min(1, (h - 11) / 6) * 0.6);
  return _c;
}

export function createTerrainMesh(terrain, { town = null, x0 = -80, z0 = -100, size = 560, n = 160 } = {}) {
  const step = size / n;
  const W = n + 1;
  const H = new Float32Array(W * W);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) H[j * W + i] = terrain.height(x0 + i * step, z0 + j * step);
  }
  const tris = n * n * 2;
  const pos = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);
  let o = 0;
  const push = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
    pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
    pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
    const h = (ay + by + cy) / 3;
    const slope = Math.max(Math.abs(ay - by), Math.abs(ay - cy), Math.abs(by - cy)) / step;
    const c = faceColor(h, slope, (ax + bx + cx) / 3, (az + bz + cz) / 3, terrain.seed, town);
    for (let k = 0; k < 3; k++) {
      col[o + k * 3] = c.r;
      col[o + k * 3 + 1] = c.g;
      col[o + k * 3 + 2] = c.b;
    }
    o += 9;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * step;
      const za = z0 + j * step;
      const xb = xa + step;
      const zb = za + step;
      const a = H[j * W + i];
      const b = H[(j + 1) * W + i];
      const c = H[j * W + i + 1];
      const d = H[(j + 1) * W + i + 1];
      push(xa, a, za, xa, b, zb, xb, c, za);
      push(xb, c, za, xa, b, zb, xb, d, zb);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96 }));
  mesh.receiveShadow = true;
  return mesh;
}

// 미니맵 바탕 그림(위가 북쪽 = z가 큰 쪽)
export function paintMinimap(ctx2d, terrain, bounds, px) {
  const [x0, z0, x1, z1] = bounds;
  const img = ctx2d.createImageData(px, px);
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const x = x0 + ((i + 0.5) / px) * (x1 - x0);
      const z = z1 - ((j + 0.5) / px) * (z1 - z0);
      const h = terrain.height(x, z);
      let c;
      if (h < -0.3) c = [52, 112, 132];
      else if (h < 1.3) c = [214, 196, 146];
      else if (h > 17) c = [128, 122, 112];
      else {
        const g = 0.85 + 0.15 * valueNoise(x / 12, z / 12, 9);
        c = [106 * g + h * 2, 150 * g - h * 1.5, 84 * g];
      }
      const k = (j * px + i) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  }
  ctx2d.putImageData(img, 0, 0);
}
