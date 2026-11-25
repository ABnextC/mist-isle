// 풀밭: 16m 조각마다 풀잎을 인스턴스로 심는다. 플레이어 둘레만 그리고, 바람에 흔들리며, 밟으면 눕는다.
// 같은 조각은 언제 다시 만들어도 같은 풀이 난다(조각 좌표로 난수를 정한다).

import * as THREE from 'three';
import { SEASON_GLSL, seasonUniforms } from './materials.js';

const CHUNK = 16;

function bladeGeometry() {
  // 아래에서 위로 4마디, 끝은 한 점
  const ys = [0, 0.3, 0.58, 0.82, 1];
  const ws = [1, 0.86, 0.66, 0.4, 0];
  const pos = [];
  const idx = [];
  for (let i = 0; i < ys.length; i++) {
    if (ws[i] > 0) pos.push(-0.5 * ws[i], ys[i], 0, 0.5 * ws[i], ys[i], 0);
    else pos.push(0, ys[i], 0);
  }
  for (let i = 0; i < ys.length - 2; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (ys.length - 2) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGrass(scene, { hf, ground, tier, avoid }) {
  const blade = bladeGeometry();
  const U = {
    uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() },
    uRadius: { value: tier.grassR }, uWind: { value: 1 },
  };
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.45 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    seasonUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 iOff;
        attribute vec4 iDat;
        attribute vec3 iTint;
        varying vec3 vTint;
        uniform float uTime;
        uniform vec3 uPlayer;
        uniform vec3 uCenter;
        uniform float uRadius;
        uniform float uWind;
        varying float vT;
        varying float vVar;`)
      .replace('#include <beginnormal_vertex>', `
        float t = position.y;
        float cy = cos(iOff.w);
        float sy = sin(iOff.w);
        vec3 R = vec3(cy, 0.0, sy);
        vec3 F = vec3(-sy, 0.0, cy);
        float dc = length(iOff.xz - uCenter.xz);
        float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, dc);
        float hgt = iDat.x * fade;
        // 바람: 큰 물결 + 잔떨림
        float gust = sin(uTime * 1.3 + iOff.x * 0.11 + iOff.z * 0.07) * 0.5 + 0.5;
        float flutter = sin(uTime * 4.1 + iDat.w * 6.28 + iOff.x * 0.9);
        vec2 windDir = normalize(vec2(1.0, 0.35));
        float bend = (0.12 + 0.35 * gust * uWind + 0.05 * flutter) * t * t;
        vec3 off = (F * iDat.z * 0.6 + vec3(windDir.x, 0.0, windDir.y) * bend) * hgt;
        // 밟힌 풀은 바깥으로 눕는다
        vec2 dp = iOff.xz - uPlayer.xz;
        float dpl = length(dp);
        float push = smoothstep(1.2, 0.25, dpl);
        off.xz += (dp / max(dpl, 0.001)) * push * 0.7 * t * hgt;
        float y = t * hgt * (1.0 - 0.25 * bend - 0.45 * push * t);
        vT = t;
        vVar = iDat.y;
        vTint = iTint;
        vec3 objectNormal = normalize(F * 0.45 + vec3(0.0, 1.0, 0.0) + vec3(windDir.x, 0.0, windDir.y) * bend * 0.4);`)
      .replace('#include <begin_vertex>', `
        float wid = (0.055 + 0.05 * iDat.y) * (0.6 + 0.4 * fade);
        vec3 transformed = iOff.xyz + R * position.x * wid + vec3(0.0, y, 0.0) + off;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${SEASON_GLSL}
        varying float vT;
        varying float vVar;
        varying vec3 vTint;`)
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 base = vec3(0.028, 0.055, 0.014);
        vec3 tip = mix(vec3(0.12, 0.25, 0.04), vec3(0.27, 0.27, 0.08), smoothstep(0.8, 0.98, vVar));
        diffuseColor.rgb = seasonize(mix(base, tip, smoothstep(0.0, 1.0, vT)) * (0.84 + 0.32 * fract(vVar * 7.31)) * vTint, 1.0);`)
      .replace('#include <aomap_fragment>', `
        float bladeAo = mix(0.35, 1.0, vT);
        reflectedLight.indirectDiffuse *= bladeAo;
        reflectedLight.directDiffuse *= mix(0.55, 1.0, vT);`);
  };

  const chunks = new Map();
  const density = tier.grass / (Math.PI * tier.grassR * tier.grassR * 0.6);
  const group = new THREE.Group();
  scene.add(group);

  // 한 조각 최대 풀잎 수(밀도 × 칸 넓이 × 최대 배율)로 버퍼를 한 번만 잡아 두고 재사용한다(쓰레기 수거를 줄인다)
  const CELL = 2;
  const MAXN = Math.ceil(density * CELL * CELL * 1.45) * (CHUNK / CELL) * (CHUNK / CELL);
  const bufOff = new Float32Array(MAXN * 4);
  const bufDat = new Float32Array(MAXN * 4);
  const bufTint = new Float32Array(MAXN * 3);

  function build(cx, cz) {
    const R = rng((cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    let c = 0;
    for (let j = 0; j < CHUNK / CELL; j++) {
      for (let i = 0; i < CHUNK / CELL; i++) {
        const gx = x0 + (i + 0.5) * CELL;
        const gz = z0 + (j + 0.5) * CELL;
        const g = ground.groundAt(gx, gz);
        let w = g.grass * (1 - g.path);
        if (g.h < 1.4) w *= Math.max(0, (g.h - 1.1) / 0.3);
        if (w < 0.08) continue;
        if (avoid && avoid(gx, gz)) w *= 0.15;
        const n = Math.min(Math.round(density * CELL * CELL * w * (0.6 + R() * 0.8)), MAXN - c);
        // 땅 셰이더와 같은 빛깔 얼룩(마른 들·짙은 들·숲 그늘)
        const a = g.m2;
        const mk = Math.min(1, Math.max(0, (g.macro - 0.3) / 0.4));
        const mm = mk * mk * (3 - 2 * mk);
        const zk = 1 - 0.28 * g.zone * 0.8;
        const tr = (1.08 + (0.92 - 1.08) * a) * (1.12 + (0.86 - 1.12) * mm) * zk;
        const tg = (0.98 + (1.04 - 0.98) * a) * (1.02 + (1.0 - 1.02) * mm) * (1 - 0.16 * g.zone * 0.8);
        const tb = (0.78 + (0.98 - 0.78) * a) * (0.72 + (0.94 - 0.72) * mm) * zk;
        // 포기(덩어리)로 모아 심는다
        let tx = gx;
        let tz = gz;
        for (let k = 0; k < n; k++) {
          if (k % 7 === 0) {
            tx = gx + (R() - 0.5) * CELL;
            tz = gz + (R() - 0.5) * CELL;
          }
          const x = tx + (R() - 0.5) * 0.55;
          const z = tz + (R() - 0.5) * 0.55;
          const o = c * 4;
          bufOff[o] = x;
          bufOff[o + 1] = hf.height(x, z) - 0.02;
          bufOff[o + 2] = z;
          bufOff[o + 3] = R() * Math.PI * 2;
          bufDat[o] = 0.22 + R() * 0.3 + (w > 0.7 ? R() * 0.2 : 0);
          bufDat[o + 1] = R();
          bufDat[o + 2] = (R() - 0.5) * 0.8;
          bufDat[o + 3] = R();
          bufTint[c * 3] = tr;
          bufTint[c * 3 + 1] = tg;
          bufTint[c * 3 + 2] = tb;
          c++;
        }
      }
    }
    if (!c) return null;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.setAttribute('position', blade.attributes.position);
    geo.setAttribute('normal', blade.attributes.normal);
    geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(bufOff.slice(0, c * 4), 4));
    geo.setAttribute('iDat', new THREE.InstancedBufferAttribute(bufDat.slice(0, c * 4), 4));
    geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(bufTint.slice(0, c * 3), 3));
    geo.instanceCount = c;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CHUNK / 2, hf.height(x0 + CHUNK / 2, z0 + CHUNK / 2), z0 + CHUNK / 2), CHUNK * 0.75 + 4);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    return m;
  }

  // 조각 관리(v0.4.3): 보이는 반경보다 한 조각 더 멀리 미리 지어 두고(숨겨 둠), 가까운 것부터 시간 예산 안에서만 짓는다.
  // 반경을 벗어나도 두 조각 넘게 멀어질 때까지는 버리지 않는다(왔다 갔다 할 때 다시 짓지 않게).
  const missing = [];
  function update(t, player, wind = 1, maxBuild = 3, budgetMs = 2) {
    U.uTime.value = t;
    U.uPlayer.value.copy(player);
    U.uCenter.value.copy(player);
    U.uWind.value = wind;
    const r = U.uRadius.value;
    const show = r + CHUNK * 0.75;
    const want = r + CHUNK * 1.75;
    const drop = r + CHUNK * 2.75;
    const pcx = Math.floor(player.x / CHUNK);
    const pcz = Math.floor(player.z / CHUNK);
    const span = Math.ceil(want / CHUNK) + 1;
    missing.length = 0;
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const d = Math.hypot((cx + 0.5) * CHUNK - player.x, (cz + 0.5) * CHUNK - player.z);
        if (d > want) continue;
        const k = cx + ',' + cz;
        const e = chunks.get(k);
        if (e === undefined) missing.push([d, cx, cz, k]);
        else if (e.m) e.m.visible = d <= show;
      }
    }
    if (missing.length) {
      missing.sort((p, q) => p[0] - q[0]);
      const t0 = performance.now();
      let built = 0;
      for (const [d, cx, cz, k] of missing) {
        // 눈앞(보이는 반경 안) 조각은 한 프레임에 하나는 꼭 짓는다
        if (built >= maxBuild) break;
        if (built > 0 && performance.now() - t0 > budgetMs) break;
        const m = build(cx, cz);
        chunks.set(k, { m, cx, cz });
        if (m) {
          m.visible = d <= show;
          group.add(m);
        }
        built++;
      }
    }
    for (const [k, e] of chunks) {
      if (Math.hypot((e.cx + 0.5) * CHUNK - player.x, (e.cz + 0.5) * CHUNK - player.z) <= drop) continue;
      if (e.m) {
        group.remove(e.m);
        e.m.geometry.dispose();
      }
      chunks.delete(k);
    }
  }

  function applyTier(t) {
    U.uRadius.value = t.grassR;
  }

  return { update, applyTier };
}
