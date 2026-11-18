// 풀밭: 16m 조각마다 풀잎을 인스턴스로 심는다. 플레이어 둘레만 그리고, 바람에 흔들리며, 밟으면 눕는다.
// 같은 조각은 언제 다시 만들어도 같은 풀이 난다(조각 좌표로 난수를 정한다).

import * as THREE from 'three';
import { groundAt } from './terrain.js';

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

export function createGrass(scene, { hf, paths, tier, avoid }) {
  const blade = bladeGeometry();
  const U = {
    uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() },
    uRadius: { value: tier.grassR }, uWind: { value: 1 },
  };
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.45 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 iOff;
        attribute vec4 iDat;
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
        vec3 objectNormal = normalize(F * 0.45 + vec3(0.0, 1.0, 0.0) + vec3(windDir.x, 0.0, windDir.y) * bend * 0.4);`)
      .replace('#include <begin_vertex>', `
        float wid = (0.055 + 0.05 * iDat.y) * (0.6 + 0.4 * fade);
        vec3 transformed = iOff.xyz + R * position.x * wid + vec3(0.0, y, 0.0) + off;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vT;
        varying float vVar;`)
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 base = vec3(0.022, 0.05, 0.01);
        vec3 tip = mix(vec3(0.15, 0.30, 0.045), vec3(0.36, 0.33, 0.09), smoothstep(0.66, 0.97, vVar));
        diffuseColor.rgb = mix(base, tip, smoothstep(0.0, 1.0, vT)) * (0.82 + 0.36 * fract(vVar * 7.31));`)
      .replace('#include <aomap_fragment>', `
        float bladeAo = mix(0.35, 1.0, vT);
        reflectedLight.indirectDiffuse *= bladeAo;
        reflectedLight.directDiffuse *= mix(0.55, 1.0, vT);`);
  };

  const chunks = new Map();
  const density = tier.grass / (Math.PI * tier.grassR * tier.grassR * 0.6);
  const group = new THREE.Group();
  scene.add(group);

  function build(cx, cz) {
    const R = rng((cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const off = [];
    const dat = [];
    const cell = 2;
    for (let j = 0; j < CHUNK / cell; j++) {
      for (let i = 0; i < CHUNK / cell; i++) {
        const gx = x0 + (i + 0.5) * cell;
        const gz = z0 + (j + 0.5) * cell;
        const g = groundAt(hf, paths, gx, gz);
        let w = g.grass * (1 - g.path);
        if (g.h < 1.4) w *= Math.max(0, (g.h - 1.1) / 0.3);
        if (w < 0.08) continue;
        if (avoid && avoid(gx, gz)) w *= 0.15;
        const n = Math.round(density * cell * cell * w * (0.6 + R() * 0.8));
        // 포기(덩어리)로 모아 심는다
        let tx = gx;
        let tz = gz;
        for (let k = 0; k < n; k++) {
          if (k % 7 === 0) {
            tx = gx + (R() - 0.5) * cell;
            tz = gz + (R() - 0.5) * cell;
          }
          const x = tx + (R() - 0.5) * 0.55;
          const z = tz + (R() - 0.5) * 0.55;
          const y = hf.height(x, z) - 0.02;
          const tall = 0.22 + R() * 0.3 + (w > 0.7 ? R() * 0.2 : 0);
          off.push(x, y, z, R() * Math.PI * 2);
          dat.push(tall, R(), (R() - 0.5) * 0.8, R());
        }
      }
    }
    if (!off.length) return null;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.setAttribute('position', blade.attributes.position);
    geo.setAttribute('normal', blade.attributes.normal);
    geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(new Float32Array(off), 4));
    geo.setAttribute('iDat', new THREE.InstancedBufferAttribute(new Float32Array(dat), 4));
    geo.instanceCount = off.length / 4;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x0 + CHUNK / 2, hf.height(x0 + CHUNK / 2, z0 + CHUNK / 2), z0 + CHUNK / 2), CHUNK * 0.75 + 4);
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    return m;
  }

  function update(t, player, wind = 1, maxBuild = 3) {
    U.uTime.value = t;
    U.uPlayer.value.copy(player);
    U.uCenter.value.copy(player);
    U.uWind.value = wind;
    const r = U.uRadius.value;
    const pcx = Math.floor(player.x / CHUNK);
    const pcz = Math.floor(player.z / CHUNK);
    const span = Math.ceil(r / CHUNK) + 1;
    let budget = maxBuild;
    const want = new Set();
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const ccx = (cx + 0.5) * CHUNK;
        const ccz = (cz + 0.5) * CHUNK;
        if (Math.hypot(ccx - player.x, ccz - player.z) > r + CHUNK * 0.75) continue;
        const k = cx + ',' + cz;
        want.add(k);
        if (!chunks.has(k) && budget > 0) {
          budget--;
          const m = build(cx, cz);
          chunks.set(k, m);
          if (m) group.add(m);
        }
      }
    }
    for (const [k, m] of chunks) {
      if (want.has(k)) continue;
      if (m) {
        group.remove(m);
        m.geometry.dispose();
      }
      chunks.delete(k);
    }
  }

  function applyTier(t) {
    U.uRadius.value = t.grassR;
  }

  return { update, applyTier };
}
