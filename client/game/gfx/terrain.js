// 지형: 높이장(촘촘한 높이 표본), 길·광장 마스크, 땅 재질(풀·흙·모래·바위를 섞는 셰이더).
// 화면에 놓는 물건(풀·나무·캐릭터)은 메시와 같은 높이장(hf.height)을 써서 떠 보이지 않게 한다.

import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { SEASON_GLSL, seasonUniforms } from './materials.js';

export const AREA = { x0: -80, z0: -100, size: 560 };
// 지역마다 그리는 땅(v0.6): 지역 경계 둘레로 바깥 80m(남쪽 바다 100m)까지
export function setArea(bounds) {
  const [x0, z0, x1, z1] = bounds;
  Object.assign(AREA, { x0: x0 - 80, z0: z0 - 100, size: Math.max(x1 - x0, z1 - z0) + 160 });
}

// ── CPU 잡음(셰이더 vnoise·fbm3와 같은 식) ───────────────────
const fract = (x) => x - Math.floor(x);
function hash12(px, py) {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.1031);
  let z = fract(px * 0.1031);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d;
  y += d;
  z += d;
  return fract((x + y) * z);
}
function vnoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash12(ix, iz);
  const b = hash12(ix + 1, iz);
  const c = hash12(ix, iz + 1);
  const d = hash12(ix + 1, iz + 1);
  return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
}
export function fbm3(x, z) {
  return vnoise(x, z) * 0.5 + vnoise(x * 2.03 + 7.1, z * 2.03 + 7.1) * 0.3 + vnoise(x * 4.11 + 3.7, z * 4.11 + 3.7) * 0.2;
}
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ── 높이장 ──────────────────────────────────────────
export function buildHeightField(terrain, n) {
  const { x0, z0, size } = AREA;
  const step = size / n;
  const W = n + 1;
  const H = new Float32Array(W * W);
  for (let j = 0; j <= n; j++) {
    const z = z0 + j * step;
    for (let i = 0; i <= n; i++) H[j * W + i] = terrain.height(x0 + i * step, z);
  }
  function height(x, z) {
    let fx = (x - x0) / step;
    let fz = (z - z0) / step;
    if (fx < 0 || fz < 0 || fx > n || fz > n) return terrain.height(x, z);
    const i = Math.min(n - 1, Math.floor(fx));
    const j = Math.min(n - 1, Math.floor(fz));
    fx -= i;
    fz -= j;
    const a = H[j * W + i];
    const b = H[j * W + i + 1];
    const c = H[(j + 1) * W + i];
    const d = H[(j + 1) * W + i + 1];
    // 메시 삼각형과 같은 대각선으로 나눠 보간한다
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
  function slope(x, z) {
    const e = step;
    const dx = (height(x + e, z) - height(x - e, z)) / (2 * e);
    const dz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    const ny = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    return 1 - ny;
  }
  return { H, n, W, step, height, slope };
}

// ── 길과 광장 ────────────────────────────────────────
export function makePathMask(region, terrain) {
  const N = 512;
  const { x0, z0, size } = AREA;
  const data = new Uint8Array(N * N * 2);
  const t = region.settlements[0];
  const f = region.settlements[1];
  const segs = [];
  const add = (ax, az, bx, bz, w) => segs.push([ax, az, bx, bz, w]);
  for (const town of region.settlements) {
    for (const st of town.stations) add(town.x, town.z, town.x + st.dx * 0.85, town.z + st.dz * 0.85, town === t ? 1.6 : 1.3);
    for (const s of town.structures) if (s.kind !== 'campfire' && s.kind !== 'board') add(town.x, town.z, town.x + s.dx * 0.8, town.z + s.dz * 0.8, town === t ? 1.5 : 1.2);
  }
  const [sx, sz] = terrain.beachPoint(region.spawn[0], region.spawn[1]);
  const mx = (t.x + sx) / 2 + 6;
  const mz = (t.z + sz) / 2 + 4;
  add(t.x, t.z, mx, mz, 1.8);
  add(mx, mz, sx + 4, sz + 2, 1.6);
  add(t.x, t.z, t.x + 12, t.z + 62, 1.6);
  add(t.x + 12, t.z + 62, t.x - 6, t.z + 130, 1.4);
  // 숲머리까지 이어지는 길(v0.4)
  if (f) {
    add(t.x - 6, t.z + 130, f.x + 6, (t.z + 130 + f.z) / 2 + 4, 1.4);
    add(f.x + 6, (t.z + 130 + f.z) / 2 + 4, f.x, f.z, 1.35);
    add(f.x, f.z, f.x - 4, f.z + 34, 1.1);
  }
  const plazas = region.settlements.map((town, i) => ({ x: town.x, z: town.z + (i ? 0 : 1), r: i ? 8 : 13 }));
  const cell = size / N;
  for (let j = 0; j < N; j++) {
    const z = z0 + (j + 0.5) * cell;
    for (let i = 0; i < N; i++) {
      const x = x0 + (i + 0.5) * cell;
      let v = 0;
      for (const pl of plazas) {
        const dp = Math.hypot(x - pl.x, z - pl.z);
        if (dp < pl.r + 5) v = Math.max(v, sstep(pl.r + 4, pl.r - 2, dp + (fbm3(x * 0.3, z * 0.3) - 0.5) * 3));
      }
      if (v < 1) {
        for (const [ax, az, bx, bz, w] of segs) {
          const vx = bx - ax;
          const vz = bz - az;
          const L2 = vx * vx + vz * vz;
          let k = ((x - ax) * vx + (z - az) * vz) / L2;
          k = Math.max(0, Math.min(1, k));
          const d = Math.hypot(x - (ax + vx * k), z - (az + vz * k));
          if (d > w + 3) continue;
          const wob = (fbm3(x * 0.4, z * 0.4) - 0.5) * 1.2;
          v = Math.max(v, sstep(w + 1.2, w - 0.6, d + wob) * 0.92);
        }
      }
      data[(j * N + i) * 2] = Math.round(v * 255);
      // 해안 띠: 모래 바로 위 몇 m(자갈이 깔리는 곳)
      const d = z - terrain.shoreZ(x) + (fbm3(x * 0.09, z * 0.09) - 0.5) * 6;
      data[(j * N + i) * 2 + 1] = Math.round(sstep(3, 7, d) * (1 - sstep(11, 18, d)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const sample = (x, z) => {
    const i = Math.floor(((x - x0) / size) * N);
    const j = Math.floor(((z - z0) / size) * N);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return data[(j * N + i) * 2] / 255;
  };
  const coast = (x, z) => {
    const i = Math.floor(((x - x0) / size) * N);
    const j = Math.floor(((z - z0) / size) * N);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return data[(j * N + i) * 2 + 1] / 255;
  };
  return { tex, sample, coast };
}

// ── 나무 그늘 지도(v0.4.2) ─────────────────────────────
// 나무·덤불이 선 자리를 칠해 둔다. 셰이더는 이 값으로 낙엽 바닥을 깔고, 그림자 범위 밖 숲도 어둡게 한다.
export function makeCanopyMap() {
  const N = 512;
  const { x0, z0, size } = AREA;
  const data = new Uint8Array(N * N);
  const cell = size / N;
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  // r: 수관 반지름(m), k: 짙기(0~1)
  function add(x, z, r, k = 1) {
    const i0 = Math.max(0, Math.floor((x - r - x0) / cell));
    const i1 = Math.min(N - 1, Math.ceil((x + r - x0) / cell));
    const j0 = Math.max(0, Math.floor((z - r - z0) / cell));
    const j1 = Math.min(N - 1, Math.ceil((z + r - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      const cz = z0 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const cx = x0 + (i + 0.5) * cell;
        const d = Math.hypot(cx - x, cz - z) / r;
        if (d >= 1) continue;
        const v = Math.round(255 * k * sstep(1, 0.2, d));
        const o = j * N + i;
        // 겹치면 더 짙어진다(최대 1)
        data[o] = Math.min(255, Math.max(data[o], v) + (data[o] && v ? Math.round(v * 0.25) : 0));
      }
    }
  }
  const sample = (x, z) => {
    const fx = ((x - x0) / size) * N - 0.5;
    const fz = ((z - z0) / size) * N - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return 0;
    const u = fx - i;
    const v = fz - j;
    const a = data[j * N + i];
    const b = data[j * N + i + 1];
    const c = data[(j + 1) * N + i];
    const d = data[(j + 1) * N + i + 1];
    return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) / 255;
  };
  return { tex, add, sample, commit: () => { tex.needsUpdate = true; } };
}

// 셰이더와 같은 규칙으로 그 자리의 땅 비율(풀·낙엽·흙·모래·바위·자갈)을 낸다. 풀과 장식 배치에 쓴다.
export function groundAt(hf, paths, x, z, extra = null) {
  const h = hf.height(x, z);
  const slope = hf.slope(x, z);
  const m1 = fbm3(x * 0.045, z * 0.045);
  const m2 = fbm3(x * 0.21 + 11, z * 0.21 + 11);
  const m3 = fbm3(x * 0.13 + 23, z * 0.13 + 23);
  const path = paths.sample(x, z);
  const canopy = extra?.canopy ? extra.canopy.sample(x, z) : 0;
  const zone = extra?.zone ? sstep(extra.zone[0] - extra.zone[1], extra.zone[0] + extra.zone[1], z + (m1 - 0.5) * 10) : 0;
  // 늪(v0.6)엔 모래가 없다: 낮은 땅도 진흙·풀이다
  const zone2 = extra?.zone2 ? sstep(extra.zone2[0] - extra.zone2[1], extra.zone2[0] + extra.zone2[1], z + (m1 - 0.5) * 10) : 0;
  let sand = (1 - sstep(1.15, 1.85, h + (m2 - 0.5) * 0.7)) * (1 - zone2);
  const rock = Math.min(1, sstep(0.42, 0.62, slope + (m1 - 0.5) * 0.15) + sstep(24, 30, h + m1 * 4));
  const shore = paths.coast(x, z) * sstep(1.0, 1.4, h);
  const scree = sstep(0.3, 0.42, slope) * (1 - sstep(0.52, 0.62, slope));
  let gravel = Math.min(1, shore * sstep(0.48, 0.66, m3) + scree * sstep(0.42, 0.6, m3) * 0.8) * (1 - rock);
  let dirt = Math.max(path, sstep(0.68, 0.78, m1) * 0.5) * (1 - sand) * (1 - rock);
  const rag = (m2 - 0.5) * 0.35 + (fbm3(x * 0.9 + 3.1, z * 0.9 + 3.1) - 0.5) * 0.3;
  let litter = Math.min(1, sstep(0.15, 0.55, canopy + rag) + zone * sstep(0.3, 0.55, m2) * 0.9) * (1 - sand) * (1 - rock) * (1 - path);
  // 맨땅 구역(v0.9 잿빛 능선·설원): 풀이 자라지 않는다
  const bare = extra?.bare ? extra.bare[0] * zone * (1 - zone2) + extra.bare[1] * zone2 : 0;
  const grass = (1 - sand) * (1 - dirt) * (1 - litter) * (1 - rock) * (1 - gravel) * (1 - bare);
  sand *= (1 - rock * 0.7) * (1 - gravel * 0.6);
  dirt *= 1 - gravel * 0.5;
  litter *= 1 - gravel;
  const macro = fbm3(x * 0.012 + 41, z * 0.012 + 41);
  return { h, grass, dirt, sand, rock, gravel, litter, path, canopy, zone, zone2, m2, macro };
}

// ── 땅 재질 ─────────────────────────────────────────
// 여섯 층(풀·낙엽·흙·모래·절벽·자갈)을 텍스처 배열에서 읽고, 높이로 섞는다(돌이 흙 위로 솟고, 풀이 흙 틈을 메운다).
// 같은 무늬가 되풀이되지 않게 구역마다 텍스처를 엇갈려 읽고(두 번 읽어 섞기), 바위는 세 방향에서 투영한다.
const TILE = ['4.0', '3.5', '4.0', '5.0', '7.0', '3.0'];
function terrainMaterial(tex, paths, canopy, tier, zone = [1e9, 10], zone2 = null, zone1 = null) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const U = {
    tTerA: { value: tex.terrain.A }, tTerN: { value: tex.terrain.N },
    tTopA: { value: tex.rock.A }, tTopN: { value: tex.rock.N },
    tPath: { value: paths.tex }, tCanopy: { value: canopy.tex },
    uArea: { value: new THREE.Vector3(AREA.x0, AREA.z0, AREA.size) },
    uZone: { value: new THREE.Vector2(zone[0], zone[1]) },
    // 둘째 구역(v0.6 안개 늪): 경계와 땅빛
    uZone2: { value: new THREE.Vector2(zone2?.z0 ?? 1e9, zone2?.fade ?? 10) },
    uTint2: { value: new THREE.Vector3(...(zone2?.tint || [1, 1, 1])) },
    // 구역 땅빛 덧칠(v0.9): 재·눈. a = 덮는 정도
    uPaint1: { value: new THREE.Vector4(...(zone1?.paint || [1, 1, 1, 0])) },
    uPaint2: { value: new THREE.Vector4(...(zone2?.paint || [1, 1, 1, 0])) },
    uShadowFar: { value: tier.shadowRange },
  };
  const anti = tier.id !== 'low';
  mat.userData.uniforms = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    seasonUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNor = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${SEASON_GLSL}
        varying vec3 vWPos;
        varying vec3 vWNor;
        uniform highp sampler2DArray tTerA;
        uniform highp sampler2DArray tTerN;
        uniform sampler2D tTopA, tTopN, tPath, tCanopy;
        uniform vec3 uArea;
        uniform vec2 uZone;
        uniform vec2 uZone2;
        uniform vec4 uPaint1;
        uniform vec4 uPaint2;
        uniform vec3 uTint2;
        uniform float uShadowFar;
        ${NOISE}
        vec2 gDX;
        vec2 gDY;
        // 한 층 읽기. 반복 깨기: 잡음 k로 고른 두 오프셋을 읽어 높이를 보며 섞는다
        void samp(float layer, float tile, float k, out vec4 A, out vec4 N) {
          vec2 uv = vWPos.xz / tile;
          vec2 dx = gDX / tile;
          vec2 dy = gDY / tile;
          ${anti ? `
          float l = k * 8.0;
          float ia = floor(l);
          float f = fract(l);
          vec2 oa = sin(vec2(3.0, 7.0) * ia);
          vec2 ob = sin(vec2(3.0, 7.0) * (ia + 1.0));
          vec4 A1 = textureGrad(tTerA, vec3(uv + oa, layer), dx, dy);
          vec4 A2 = textureGrad(tTerA, vec3(uv + ob, layer), dx, dy);
          float b = smoothstep(0.25, 0.75, f + (A2.a - A1.a) * 0.4);
          A = mix(A1, A2, b);
          N = mix(textureGrad(tTerN, vec3(uv + oa, layer), dx, dy), textureGrad(tTerN, vec3(uv + ob, layer), dx, dy), b);` : `
          A = textureGrad(tTerA, vec3(uv, layer), dx, dy);
          N = textureGrad(tTerN, vec3(uv, layer), dx, dy);`}
        }
        vec2 tn(vec4 n) { return n.xy * 2.0 - 1.0; }
        float gAo;
        float gShadeDir;
        float gShadeInd;
        vec3 gNorW;`)
      .replace('#include <map_fragment>', `
        vec3 Nw = normalize(vWNor);
        float hgt = vWPos.y;
        float slope = 1.0 - Nw.y;
        vec2 xz = vWPos.xz;
        gDX = dFdx(xz);
        gDY = dFdy(xz);
        vec3 dPx = dFdx(vWPos);
        vec3 dPy = dFdy(vWPos);
        float m1 = fbm3(xz * 0.045);
        float m2 = fbm3(xz * 0.21 + 11.0);
        float m3 = fbm3(xz * 0.13 + 23.0);
        float kv = fbm3(xz * 0.07 + 5.0);
        vec2 auv = (xz - uArea.xy) / uArea.z;
        vec2 pathT = texture2D(tPath, auv).rg;
        float path = pathT.r;
        float canopy = texture2D(tCanopy, auv).r;
        float zoneF = smoothstep(uZone.x - uZone.y, uZone.x + uZone.y, vWPos.z + (m1 - 0.5) * 10.0);
        float zoneF2 = smoothstep(uZone2.x - uZone2.y, uZone2.x + uZone2.y, vWPos.z + (m1 - 0.5) * 10.0);
        // 층 비율(groundAt과 같은 규칙)
        float wSand = (1.0 - smoothstep(1.15, 1.85, hgt + (m2 - 0.5) * 0.7)) * (1.0 - zoneF2);
        float wRock = clamp(smoothstep(0.42, 0.62, slope + (m1 - 0.5) * 0.15) + smoothstep(24.0, 30.0, hgt + m1 * 4.0), 0.0, 1.0);
        float shore = pathT.g * smoothstep(1.0, 1.4, hgt);
        float scree = smoothstep(0.3, 0.42, slope) * (1.0 - smoothstep(0.52, 0.62, slope));
        float wGrav = clamp(shore * smoothstep(0.48, 0.66, m3) + scree * smoothstep(0.42, 0.6, m3) * 0.8, 0.0, 1.0) * (1.0 - wRock);
        float wDirt = max(path, smoothstep(0.68, 0.78, m1) * 0.5) * (1.0 - wSand) * (1.0 - wRock);
        float rag = (m2 - 0.5) * 0.35 + (fbm3(xz * 0.9 + 3.1) - 0.5) * 0.3;
        float wLit = clamp(smoothstep(0.15, 0.55, canopy + rag) + zoneF * smoothstep(0.3, 0.55, m2) * 0.9, 0.0, 1.0) * (1.0 - wSand) * (1.0 - wRock) * (1.0 - path);
        float wGrass = (1.0 - wSand) * (1.0 - wDirt) * (1.0 - wLit) * (1.0 - wRock) * (1.0 - wGrav);
        wSand *= (1.0 - wRock * 0.7) * (1.0 - wGrav * 0.6);
        wDirt *= 1.0 - wGrav * 0.5;
        wLit *= 1.0 - wGrav;
        vec4 A0 = vec4(0.0); vec4 N0 = vec4(0.5, 0.5, 1.0, 1.0);
        vec4 A1 = A0; vec4 N1 = N0;
        vec4 A2 = A0; vec4 N2 = N0;
        vec4 A3 = A0; vec4 N3 = N0;
        vec4 A5 = A0; vec4 N5 = N0;
        if (wGrass > 0.003) samp(0.0, ${TILE[0]}, kv, A0, N0);
        if (wLit > 0.003) samp(1.0, ${TILE[1]}, kv, A1, N1);
        if (wDirt > 0.003) samp(2.0, ${TILE[2]}, kv, A2, N2);
        if (wSand > 0.003) samp(3.0, ${TILE[3]}, kv, A3, N3);
        if (wGrav > 0.003) samp(5.0, ${TILE[5]}, kv, A5, N5);
        // 바위: 옆면은 절벽 결(지층), 윗면은 바윗돌 결
        vec3 bw = pow(abs(Nw), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        vec4 rA = vec4(0.0);
        vec4 rNx = vec4(0.5, 0.5, 1.0, 1.0);
        vec4 rNy = rNx;
        vec4 rNz = rNx;
        if (wRock > 0.003) {
          float rt = ${TILE[4]};
          vec4 ax = textureGrad(tTerA, vec3(vWPos.zy / rt, 4.0), dPx.zy / rt, dPy.zy / rt);
          vec4 az = textureGrad(tTerA, vec3(vWPos.xy / rt, 4.0), dPx.xy / rt, dPy.xy / rt);
          vec4 ay = textureGrad(tTopA, xz / 6.0, gDX / 6.0, gDY / 6.0);
          rNx = textureGrad(tTerN, vec3(vWPos.zy / rt, 4.0), dPx.zy / rt, dPy.zy / rt);
          rNz = textureGrad(tTerN, vec3(vWPos.xy / rt, 4.0), dPx.xy / rt, dPy.xy / rt);
          rNy = textureGrad(tTopN, xz / 6.0, gDX / 6.0, gDY / 6.0);
          rA = ax * bw.x + ay * bw.y + az * bw.z;
        }
        // 높이 섞기: 비율 + 높이가 가장 큰 층 근처만 남긴다
        float s0 = wGrass > 0.003 ? A0.a + wGrass * 1.4 : -9.0;
        float s1 = wLit > 0.003 ? A1.a + wLit * 1.4 : -9.0;
        float s2 = wDirt > 0.003 ? A2.a + wDirt * 1.4 : -9.0;
        float s3 = wSand > 0.003 ? A3.a + wSand * 1.4 : -9.0;
        float s4 = wRock > 0.003 ? rA.a + wRock * 1.4 : -9.0;
        float s5 = wGrav > 0.003 ? A5.a + wGrav * 1.4 : -9.0;
        float ma = max(max(max(s0, s1), max(s2, s3)), max(s4, s5)) - 0.22;
        float b0 = max(s0 - ma, 0.0);
        float b1 = max(s1 - ma, 0.0);
        float b2 = max(s2 - ma, 0.0);
        float b3 = max(s3 - ma, 0.0);
        float b4 = max(s4 - ma, 0.0);
        float b5 = max(s5 - ma, 0.0);
        float bs = b0 + b1 + b2 + b3 + b4 + b5 + 1e-5;
        b0 /= bs; b1 /= bs; b2 /= bs; b3 /= bs; b4 /= bs; b5 /= bs;
        // 풀빛: 마른 곳·짙은 곳, 숲 속은 그늘져 짙다
        float macro = fbm3(xz * 0.012 + 41.0);
        vec3 gcol = A0.rgb * mix(vec3(1.08, 0.98, 0.78), vec3(0.92, 1.04, 0.98), m2);
        gcol *= mix(vec3(1.12, 1.02, 0.72), vec3(0.86, 1.0, 0.94), smoothstep(0.3, 0.7, macro));
        gcol *= mix(vec3(1.0), vec3(0.72, 0.84, 0.7), zoneF * 0.8 * (1.0 - uPaint1.a));
        // 늪: 탁한 풀빛, 물가는 젖어서 더 어둡다
        gcol *= mix(vec3(1.0), uTint2 * mix(0.78, 1.0, smoothstep(0.1, 1.2, hgt)), zoneF2);
        vec3 lcol = A1.rgb * mix(vec3(0.72, 0.74, 0.8), vec3(1.05, 1.0, 0.95), smoothstep(0.25, 0.75, m3));
        gcol = seasonize(gcol, 1.0);
        vec3 alb = gcol * b0 + lcol * b1 + A2.rgb * b2 + A3.rgb * b3 + rA.rgb * b4 + A5.rgb * b5;
        // 물가는 젖어서 어둡고 매끈하다. 물속은 푸르게 가라앉는다.
        float wet = smoothstep(0.75, 0.15, hgt) * (b3 + b5 + b2 * 0.5);
        alb *= mix(1.0, 0.58, wet);
        alb *= mix(vec3(1.0), vec3(0.55, 0.72, 0.72), smoothstep(0.0, -2.5, hgt));
        alb *= 0.92 + 0.16 * m2;
        // 재·눈 덧칠: 결(밝기)은 남기고 빛깔만 바꾼다. 가파른 바위엔 덜 쌓인다
        {
          float pz1 = uPaint1.a * zoneF * (1.0 - zoneF2);
          float pz2 = uPaint2.a * zoneF2;
          float pk = (pz1 + pz2) * (1.0 - b4 * 0.55 * (1.0 - smoothstep(0.35, 0.6, m3))) * smoothstep(0.4, 1.4, hgt);
          if (pk > 0.002) {
            vec3 pc = (uPaint1.rgb * pz1 + uPaint2.rgb * pz2) / max(pz1 + pz2, 1e-4);
            float lum = dot(alb, vec3(0.3, 0.59, 0.11));
            vec3 painted = pc * clamp(0.62 + lum * 1.3, 0.55, 1.15);
            alb = mix(alb, painted, clamp(pk, 0.0, 1.0));
          }
        }
        diffuseColor.rgb = alb;
        vec2 tTop = tn(N0) * b0 + tn(N1) * b1 + tn(N2) * b2 + tn(N3) * b3 + tn(N5) * b5 + tn(rNy) * b4 * bw.y;
        vec2 tx = tn(rNx) * b4 * bw.x;
        vec2 tz = tn(rNz) * b4 * bw.z;
        gNorW = normalize(Nw + vec3(tTop.x, 0.0, tTop.y) + vec3(0.0, tx.y, tx.x) + vec3(tz.x, tz.y, 0.0));
        ${anti ? `
        // 땅의 잔 굴곡(메시보다 잘다): 두 크기의 잡음 기울기로 빛만 흔든다
        {
          vec2 q1 = xz * 0.45 + 7.0;
          float c1 = fbm3(q1);
          vec2 g1 = vec2(fbm3(q1 + vec2(0.16, 0.0)) - c1, fbm3(q1 + vec2(0.0, 0.16)) - c1) / 0.35;
          vec2 q2 = xz * 0.11 + 19.0;
          float c2 = fbm3(q2);
          vec2 g2 = vec2(fbm3(q2 + vec2(0.06, 0.0)) - c2, fbm3(q2 + vec2(0.0, 0.06)) - c2) / 0.55;
          vec2 gg = (g1 * 0.35 + g2 * 0.6) * (1.0 - b4) * (1.0 - wSand * 0.6);
          gNorW = normalize(gNorW - vec3(gg.x, 0.0, gg.y));
        }` : ''}
        float rAo = rNx.a * bw.x + rNy.a * bw.y + rNz.a * bw.z;
        float rRough = rNx.b * bw.x + rNy.b * bw.y + rNz.b * bw.z;
        gAo = N0.a * b0 + N1.a * b1 + N2.a * b2 + N3.a * b3 + N5.a * b5 + rAo * b4;
        float gRough = N0.b * b0 + N1.b * b1 + N2.b * b2 + N3.b * b3 + N5.b * b5 + rRough * b4;
        gRough = mix(gRough, 0.32, wet);
        // 나무 아래: 하늘빛이 덜 들고, 그림자 지도 밖(먼 숲)에서는 해빛도 가린다
        float far = smoothstep(uShadowFar * 0.7, uShadowFar * 1.05, length(vWPos - cameraPosition));
        gShadeInd = 1.0 - canopy * 0.45;
        gShadeDir = 1.0 - canopy * mix(0.15, 0.6, far);
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNorW, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= gAo * gShadeInd;
        reflectedLight.indirectSpecular *= gAo * gShadeInd;
        reflectedLight.directDiffuse *= mix(1.0, gAo, 0.5) * gShadeDir;
        reflectedLight.directSpecular *= gShadeDir;`);
  };
  return mat;
}

function gridGeometry(hf) {
  const { n, W, step, H } = hf;
  const pos = new Float32Array(W * W * 3);
  const nor = new Float32Array(W * W * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * W + i;
      pos[k * 3] = AREA.x0 + i * step;
      pos[k * 3 + 1] = H[k];
      pos[k * 3 + 2] = AREA.z0 + j * step;
      const hl = H[j * W + Math.max(0, i - 1)];
      const hr = H[j * W + Math.min(n, i + 1)];
      const hd = H[Math.max(0, j - 1) * W + i];
      const hu = H[Math.min(n, j + 1) * W + i];
      const nx = (hl - hr) / (2 * step);
      const nz = (hd - hu) / (2 * step);
      const L = Math.hypot(nx, 1, nz);
      nor[k * 3] = nx / L;
      nor[k * 3 + 1] = 1 / L;
      nor[k * 3 + 2] = nz / L;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let o = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

// 바깥 먼 땅: 굵은 격자. 안쪽 지형과 겹치는 곳은 땅속으로 내려 숨긴다.
function outerGeometry(terrain) {
  const x0 = -560;
  const z0 = -560;
  const size = 1520;
  const n = 95;
  const step = size / n;
  const geo = new THREE.PlaneGeometry(size, size, n, n);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + x0 + size / 2;
    const z = p.getZ(i) + z0 + size / 2;
    const inside = x > AREA.x0 + step && x < AREA.x0 + AREA.size - step && z > AREA.z0 + step && z < AREA.z0 + AREA.size - step;
    let h = terrain.height(x, z);
    // 섬 밖 먼 곳은 바다 쪽(남)만 낮게, 나머지는 산줄기로 이어지게
    if (x < AREA.x0 || x > AREA.x0 + AREA.size || z > AREA.z0 + AREA.size) h = Math.max(h, 14 + 18 * fbm3(x * 0.01, z * 0.01));
    p.setXYZ(i, x, inside ? h - 6 : h, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createTerrain(scene, { terrain, region, tier, tex }) {
  const hf = buildHeightField(terrain, tier.terrainN);
  const paths = makePathMask(region, terrain);
  const canopy = makeCanopyMap();
  const zone = [region.zones?.[0]?.z0 ?? 1e9, region.zones?.[0]?.fade ?? 10];
  const mat = terrainMaterial(tex, paths, canopy, tier, zone, region.zones?.[1] || null, region.zones?.[0] || null);
  const mesh = new THREE.Mesh(gridGeometry(hf), mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const outer = new THREE.Mesh(outerGeometry(terrain), mat);
  outer.receiveShadow = false;
  scene.add(outer);
  const z2 = region.zones?.[1];
  const z1 = region.zones?.[0];
  const extra = { canopy, zone, zone2: z2 ? [z2.z0, z2.fade] : null, bare: [z1?.bare || 0, z2?.bare || 0] };
  return {
    hf, paths, canopy, zone, mesh, material: mat,
    groundAt: (x, z) => groundAt(hf, paths, x, z, extra),
    applyTier(t) { mat.userData.uniforms.uShadowFar.value = t.shadowRange; },
  };
}
