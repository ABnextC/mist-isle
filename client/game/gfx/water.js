// 바다: 게르스트너 파도, 잔물결 노멀, 깊이에 따른 색과 투명도, 물가와 물마루의 물거품.
// 빛과 반사는 three의 물리 재질(MeshPhysicalMaterial)에 맡기고 모양·색만 셰이더로 바꾼다.

import * as THREE from 'three';
import { AREA } from './terrain.js';
import { NOISE } from './glsl.js';

// 카메라를 따라다니는 원형 격자: 가까울수록 촘촘하다
function polarGrid(rings, segs) {
  const radii = [0];
  let r = 0;
  while (radii.length < rings) {
    r += Math.max(0.9, r * 0.05);
    radii.push(r);
  }
  const pos = [];
  const idx = [];
  pos.push(0, 0, 0);
  for (let k = 1; k < radii.length; k++) {
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * radii[k], 0, Math.sin(a) * radii[k]);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let k = 1; k < radii.length - 1; k++) {
    const a0 = 1 + (k - 1) * segs;
    const b0 = 1 + k * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, b0 + s);
      idx.push(a0 + s1, b0 + s1, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

// 지형 높이를 물 셰이더가 읽도록 반정밀 텍스처로
function heightTexture(hf) {
  const N = 512;
  const data = new Uint16Array(N * N);
  for (let j = 0; j < N; j++) {
    const z = AREA.z0 + ((j + 0.5) / N) * AREA.size;
    for (let i = 0; i < N; i++) {
      const x = AREA.x0 + ((i + 0.5) / N) * AREA.size;
      data[j * N + i] = THREE.DataUtils.toHalfFloat(hf.height(x, z));
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const WAVES = [
  // 방향(x,z), 파장 m, 진폭 m, 가파름
  [0.15, 1.0, 24, 0.20, 0.55],
  [-0.35, 0.9, 13, 0.11, 0.6],
  [0.55, 0.8, 7.5, 0.06, 0.6],
  [-0.1, 1.0, 4.2, 0.035, 0.5],
];

export function createWater(scene, { hf, tex, tier, still = 1e9 }) {
  const hTex = heightTexture(hf);
  const rings = Math.round(tier.water * 0.62);
  const segs = Math.round(tier.water * 0.75);
  const geo = polarGrid(rings, segs);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0d3640, roughness: 0.06, metalness: 0, ior: 1.333, transparent: true,
    specularIntensity: 1, envMapIntensity: 1.0, side: THREE.FrontSide,
  });
  const U = {
    uTime: { value: 0 }, tHeight: { value: hTex }, tRipple: { value: tex.water.N },
    uArea: { value: new THREE.Vector3(AREA.x0, AREA.z0, AREA.size) },
    // 늪 물(v0.6): 이 z보다 북쪽은 파도·거품 없이 고인 물
    uStill: { value: still },
  };
  const waveGLSL = WAVES.map(([dx, dz, L, A, Q], i) => {
    const len = Math.hypot(dx, dz);
    return `gerstner(p, vec2(${(dx / len).toFixed(4)}, ${(dz / len).toFixed(4)}), ${L.toFixed(2)}, ${A.toFixed(3)} * amp, ${Q.toFixed(2)}, disp, tang, bin, crest);`;
  }).join('\n');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uStill;
        uniform sampler2D tHeight;
        uniform vec3 uArea;
        varying vec3 vWPos;
        varying float vDepth;
        varying float vCrest;
        void gerstner(vec2 p, vec2 D, float L, float A, float Q, inout vec3 disp, inout vec3 tang, inout vec3 bin, inout float crest) {
          float k = 6.2831853 / L;
          float w = sqrt(9.8 * k);
          float f = k * dot(D, p) - w * uTime;
          float c = cos(f);
          float s = sin(f);
          disp += vec3(Q * A * D.x * c, A * s, Q * A * D.y * c);
          tang += vec3(-Q * D.x * D.x * k * A * s, D.x * k * A * c, -Q * D.x * D.y * k * A * s);
          bin += vec3(-Q * D.x * D.y * k * A * s, D.y * k * A * c, -Q * D.y * D.y * k * A * s);
          crest += s * A;
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec4 wp0 = modelMatrix * vec4(position, 1.0);
        vec2 p = wp0.xz;
        float ground = texture2D(tHeight, (p - uArea.xy) / uArea.z).r;
        float depth = max(0.0, -ground);
        // 얕은 곳에서는 파도가 낮아진다
        float amp = (smoothstep(0.15, 5.0, depth) * 0.85 + 0.15 * smoothstep(0.0, 0.6, depth)) * (1.0 - 0.9 * smoothstep(uStill - 20.0, uStill, p.y));
        vec3 disp = vec3(0.0);
        vec3 tang = vec3(1.0, 0.0, 0.0);
        vec3 bin = vec3(0.0, 0.0, 1.0);
        float crest = 0.0;
        ${waveGLSL}
        vDepth = depth;
        vCrest = crest;
        vec3 objectNormal = normalize(cross(bin, tang));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + disp;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uStill;
        uniform sampler2D tRipple;
        varying vec3 vWPos;
        varying float vDepth;
        varying float vCrest;
        ${NOISE}
        float gFoam;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float d = vDepth;
        vec3 shallow = vec3(0.10, 0.36, 0.34);
        vec3 deep = vec3(0.012, 0.06, 0.085);
        diffuseColor.rgb = mix(deep, shallow, exp(-d * 0.45));
        float shore = smoothstep(0.7, 0.0, d);
        float fn = fbm3(vWPos.xz * 0.9 + vec2(uTime * 0.25, uTime * 0.1)) ;
        float band = sin(d * 14.0 - uTime * 1.6 + fn * 4.0) * 0.5 + 0.5;
        float foamShore = shore * smoothstep(0.35, 0.8, fn * 0.6 + band * 0.55);
        float foamCrest = smoothstep(0.16, 0.3, vCrest) * smoothstep(0.45, 0.7, fbm3(vWPos.xz * 0.35 - uTime * 0.2));
        float still = smoothstep(uStill - 20.0, uStill, vWPos.z);
        gFoam = clamp(foamShore + foamCrest * 0.7, 0.0, 1.0) * (1.0 - still);
        // 늪 물: 이탄에 물든 갈색 녹빛
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.05, 0.07, 0.04), vec3(0.16, 0.19, 0.11), exp(-d * 1.4)), still);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.95), gFoam);
        diffuseColor.a = clamp(1.0 - exp(-d * 1.1) + 0.18 + gFoam, 0.0, 1.0) * smoothstep(0.0, 0.08, d + gFoam * 0.1);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.7, gFoam);')
      .replace('#include <normal_fragment_maps>', `
        vec2 r1 = texture2D(tRipple, vWPos.xz / 9.0 + vec2(uTime * 0.021, uTime * 0.013)).xy * 2.0 - 1.0;
        vec2 r2 = texture2D(tRipple, vWPos.xz / 3.7 - vec2(uTime * 0.03, -uTime * 0.017)).xy * 2.0 - 1.0;
        vec2 rr = (r1 * 0.6 + r2 * 0.4) * mix(0.55, 0.15, gFoam);
        vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix) + vec3(rr.x, 0.0, rr.y));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    mesh,
    update(t, camera) {
      U.uTime.value = t;
      mesh.position.set(Math.round(camera.position.x / 2) * 2, 0, Math.round(camera.position.z / 2) * 2);
    },
  };
}
