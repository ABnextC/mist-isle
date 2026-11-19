// 지형: 높이장(촘촘한 높이 표본), 길·광장 마스크, 땅 재질(풀·흙·모래·바위를 섞는 셰이더).
// 화면에 놓는 물건(풀·나무·캐릭터)은 메시와 같은 높이장(hf.height)을 써서 떠 보이지 않게 한다.

import * as THREE from 'three';
import { NOISE } from './glsl.js';

export const AREA = { x0: -80, z0: -100, size: 560 };

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
  const data = new Uint8Array(N * N);
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
      data[j * N + i] = Math.round(v * 255);
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const sample = (x, z) => {
    const i = Math.floor(((x - x0) / size) * N);
    const j = Math.floor(((z - z0) / size) * N);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    return data[j * N + i] / 255;
  };
  return { tex, sample };
}

// 셰이더와 같은 규칙으로 그 자리의 땅 비율(풀·흙·모래·바위)을 낸다. 풀과 장식 배치에 쓴다.
export function groundAt(hf, paths, x, z) {
  const h = hf.height(x, z);
  const slope = hf.slope(x, z);
  const m1 = fbm3(x * 0.045, z * 0.045);
  const m2 = fbm3(x * 0.21 + 11, z * 0.21 + 11);
  const path = paths.sample(x, z);
  let sand = 1 - sstep(1.15, 1.85, h + (m2 - 0.5) * 0.7);
  let rock = Math.min(1, sstep(0.42, 0.62, slope + (m1 - 0.5) * 0.15) + sstep(24, 30, h + m1 * 4));
  let dirt = Math.max(path, sstep(0.68, 0.78, m1) * 0.55) * (1 - sand);
  let grass = (1 - sand) * (1 - dirt);
  grass *= 1 - rock;
  dirt *= 1 - rock;
  sand *= 1 - rock * 0.7;
  return { h, grass, dirt, sand, rock, path };
}

// ── 땅 재질 ─────────────────────────────────────────
function terrainMaterial(tex, paths, tier, forest = [1e9, 10]) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const U = {
    tGrassA: { value: tex.grass.A }, tGrassN: { value: tex.grass.N },
    tDirtA: { value: tex.dirt.A }, tDirtN: { value: tex.dirt.N },
    tSandA: { value: tex.sand.A }, tSandN: { value: tex.sand.N },
    tRockA: { value: tex.rock.A }, tRockN: { value: tex.rock.N },
    tPath: { value: paths.tex },
    uArea: { value: new THREE.Vector3(AREA.x0, AREA.z0, AREA.size) },
    uForest: { value: new THREE.Vector2(forest[0], forest[1]) },
  };
  const hq = tier.id !== 'low';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNor = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNor;
        uniform sampler2D tGrassA, tGrassN, tDirtA, tDirtN, tSandA, tSandN, tRockA, tRockN, tPath;
        uniform vec3 uArea;
        uniform vec2 uForest;
        ${NOISE}
        // 같은 무늬가 반복돼 보이지 않게 두 배율을 섞는다
        vec4 tri(sampler2D t, vec2 uv, float k) {
          vec4 a = texture2D(t, uv);
          ${hq ? 'vec4 b = texture2D(t, uv * 0.27 + vec2(0.31, 0.57)); return mix(a, b, k);' : 'return a;'}
        }
        vec3 tnorm(vec4 n) { vec2 xy = n.xy * 2.0 - 1.0; return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))); }
        float gAo;
        vec3 gNorW;`)
      .replace('#include <map_fragment>', `
        vec3 Nw = normalize(vWNor);
        float hgt = vWPos.y;
        float slope = 1.0 - Nw.y;
        float m1 = fbm3(vWPos.xz * 0.045);
        float m2 = fbm3(vWPos.xz * 0.21 + 11.0);
        float mk = smoothstep(0.3, 0.7, fbm3(vWPos.xz * 0.08 + 5.0));
        float path = texture2D(tPath, (vWPos.xz - uArea.xy) / uArea.z).r;
        float wSand = 1.0 - smoothstep(1.15, 1.85, hgt + (m2 - 0.5) * 0.7);
        float wRock = clamp(smoothstep(0.42, 0.62, slope + (m1 - 0.5) * 0.15) + smoothstep(24.0, 30.0, hgt + m1 * 4.0), 0.0, 1.0);
        float wDirt = max(path, smoothstep(0.68, 0.78, m1) * 0.55) * (1.0 - wSand);
        float wGrass = (1.0 - wSand) * (1.0 - wDirt);
        wGrass *= 1.0 - wRock;
        wDirt *= 1.0 - wRock;
        wSand *= 1.0 - wRock * 0.7;
        vec2 uvG = vWPos.xz / 2.6;
        vec2 uvD = vWPos.xz / 3.2;
        vec2 uvS = vWPos.xz / 3.6;
        vec4 gA = tri(tGrassA, uvG, mk);
        vec4 dA = tri(tDirtA, uvD, mk);
        vec4 sA = tri(tSandA, uvS, mk);
        // 바위는 경사면에서 옆으로도 투영한다
        vec3 bw = pow(abs(Nw), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        vec4 rAy = texture2D(tRockA, vWPos.xz / 5.0);
        vec4 rAx = texture2D(tRockA, vWPos.zy / 5.0);
        vec4 rAz = texture2D(tRockA, vWPos.xy / 5.0);
        vec4 rA = rAx * bw.x + rAy * bw.y + rAz * bw.z;
        vec4 w = vec4(wGrass, wDirt, wSand, wRock) * (vec4(gA.a, dA.a, sA.a, rA.a) * 0.7 + 0.3);
        w = pow(w + 1e-4, vec4(3.0));
        w /= (w.x + w.y + w.z + w.w);
        vec3 alb = gA.rgb * w.x + dA.rgb * w.y + sA.rgb * w.z + rA.rgb * w.w;
        // 물가는 젖어서 어둡고 매끈하다. 물속은 푸르게 가라앉는다.
        float wet = smoothstep(0.75, 0.15, hgt) * (w.z + w.y * 0.5);
        alb *= mix(1.0, 0.58, wet);
        alb *= mix(vec3(1.0), vec3(0.55, 0.72, 0.72), smoothstep(0.0, -2.5, hgt));
        // 참나무 숲(북쪽 구역): 풀이 짙고, 낙엽 깔린 흙이 섞인다
        float forest = smoothstep(uForest.x - uForest.y, uForest.x + uForest.y, vWPos.z + (m1 - 0.5) * 10.0);
        vec3 litter = mix(vec3(0.20, 0.14, 0.08), vec3(0.30, 0.22, 0.12), m2);
        vec3 deep = alb * vec3(0.62, 0.78, 0.58);
        alb = mix(alb, mix(deep, litter, smoothstep(0.45, 0.75, m1) * (w.x + w.y) * 0.85), forest * (1.0 - w.w * 0.6));
        // 큰 얼룩으로 색을 조금씩 흔든다
        alb *= 0.9 + 0.2 * m2;
        diffuseColor.rgb = alb;
        vec4 gN = tri(tGrassN, uvG, mk);
        vec4 dN = tri(tDirtN, uvD, mk);
        vec4 sN = tri(tSandN, uvS, mk);
        vec4 rNy = texture2D(tRockN, vWPos.xz / 5.0);
        vec4 rNx = texture2D(tRockN, vWPos.zy / 5.0);
        vec4 rNz = texture2D(tRockN, vWPos.xy / 5.0);
        vec3 tTop = tnorm(gN) * w.x + tnorm(dN) * w.y + tnorm(sN) * w.z + tnorm(rNy) * w.w * bw.y;
        vec3 tx = tnorm(rNx) * w.w * bw.x;
        vec3 tz = tnorm(rNz) * w.w * bw.z;
        float bumpK = 0.9;
        gNorW = normalize(Nw + vec3(tTop.x, 0.0, tTop.y) * bumpK + vec3(0.0, tx.y, tx.x) * bumpK + vec3(tz.x, tz.y, 0.0) * bumpK);
        gAo = gN.a * w.x + dN.a * w.y + sN.a * w.z + (rNx.a * bw.x + rNy.a * bw.y + rNz.a * bw.z) * w.w;
        float gRough = gN.b * w.x + dN.b * w.y + sN.b * w.z + (rNx.b * bw.x + rNy.b * bw.y + rNz.b * bw.z) * w.w;
        gRough = mix(gRough, 0.32, wet);
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNorW, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= gAo;
        reflectedLight.indirectSpecular *= gAo;
        reflectedLight.directDiffuse *= mix(1.0, gAo, 0.5);`);
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
  const mat = terrainMaterial(tex, paths, tier, [region.zones?.[0]?.z0 ?? 1e9, region.zones?.[0]?.fade ?? 10]);
  const mesh = new THREE.Mesh(gridGeometry(hf), mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const outer = new THREE.Mesh(outerGeometry(terrain), mat);
  outer.receiveShadow = false;
  scene.add(outer);
  return { hf, paths, mesh, material: mat };
}
