// 물건 재질. 구운 텍스처(A: 색+높이, N: 노멀xy+거칠기+그늘)를 three의 물리 재질에 연결한다.
//  - box: 물체 공간 3면 투영(UV 없이 건물·상자에 무늬를 입힌다. 물체를 돌려도 무늬가 따라 돈다)
//  - uv: 원통(나무줄기·통나무)처럼 UV가 있는 모양
// 바람에 흔들리는 잎·갈대는 같은 시계(G.uTime)를 쓴다.

import * as THREE from 'three';
import { NOISE } from './glsl.js';

export const G = { uTime: { value: 0 }, uWind: { value: 1 }, uDay: { value: 1 } };

const PACKED_N = `
  vec4 pkN = texture2D( normalMap, vNormalMapUv );
  vec3 mapN = vec3( pkN.xy * 2.0 - 1.0, 0.0 );
  mapN.z = sqrt( max( 0.0, 1.0 - dot( mapN.xy, mapN.xy ) ) );`;

// UV로 입히는 재질(N 텍스처의 b = 거칠기, a = 그늘)
export function uvMaterial(t, { repeat = [1, 1], tint = 0xffffff, normalScale = 1, roughness = 1, metalness = 0, vertexColors = false } = {}) {
  // 렌더 타깃 텍스처는 복제하면 비어 버린다. 반복 횟수는 셰이더에서 uv에 곱한다.
  const m = new THREE.MeshStandardMaterial({
    map: t.A, normalMap: t.N, color: tint, roughness, metalness, vertexColors,
    normalScale: new THREE.Vector2(normalScale, normalScale),
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRepeat = { value: new THREE.Vector2(repeat[0], repeat[1]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uRepeat;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv *= uRepeat;\nvNormalMapUv *= uRepeat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', PACKED_N)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * texture2D( normalMap, vNormalMapUv ).b;`)
      .replace('#include <aomap_fragment>', `
        float pAo = texture2D( normalMap, vNormalMapUv ).a;
        reflectedLight.indirectDiffuse *= pAo;
        reflectedLight.directDiffuse *= mix( 1.0, pAo, 0.4 );`);
  };
  return m;
}

// 물체 공간 3면 투영 재질. scale = 텍스처 한 장이 덮는 m
export function boxMaterial(t, { scale = 2, tint = 0xffffff, roughness = 1, metalness = 0, vertexColors = true, world = false, extra = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness, metalness, vertexColors });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tA = { value: t.A };
    sh.uniforms.tN = { value: t.N };
    sh.uniforms.uScale = { value: 1 / scale };
    sh.uniforms.uTime = G.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBP;\nvarying vec3 vBN;\nvarying vec3 vBX;\nvarying vec3 vBY;\nvarying vec3 vBZ;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          mat3 bm = normalMatrix;
          #ifdef USE_INSTANCING
            bm = bm * mat3(instanceMatrix);
          #endif
          vBX = bm * vec3(1.0, 0.0, 0.0);
          vBY = bm * vec3(0.0, 1.0, 0.0);
          vBZ = bm * vec3(0.0, 0.0, 1.0);
        }
        ${world ? `
        vec4 bpw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          bpw = instanceMatrix * bpw;
        #endif
        vBP = (modelMatrix * bpw).xyz;
        vec3 bnw = objectNormal;
        #ifdef USE_INSTANCING
          bnw = mat3(instanceMatrix) * bnw;
        #endif
        vBN = normalize(mat3(modelMatrix) * bnw);` : 'vBP = transformed; vBN = objectNormal;'}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBP;
        varying vec3 vBN;
        varying vec3 vBX;
        varying vec3 vBY;
        varying vec3 vBZ;
        uniform sampler2D tA;
        uniform sampler2D tN;
        uniform float uScale;
        uniform float uTime;
        ${NOISE}
        vec3 gBW;
        vec4 gBN;`)
      .replace('#include <map_fragment>', `
        vec3 bn = normalize(vBN);
        gBW = pow(abs(bn), vec3(5.0));
        gBW /= (gBW.x + gBW.y + gBW.z);
        vec3 bp = vBP * uScale;
        vec4 ax = texture2D(tA, bp.zy);
        vec4 ay = texture2D(tA, bp.xz);
        vec4 az = texture2D(tA, bp.xy);
        vec4 nx = texture2D(tN, bp.zy);
        vec4 ny = texture2D(tN, bp.xz);
        vec4 nz = texture2D(tN, bp.xy);
        vec4 boxA = ax * gBW.x + ay * gBW.y + az * gBW.z;
        gBN = nx * gBW.x + ny * gBW.y + nz * gBW.z;
        diffuseColor.rgb *= boxA.rgb;
        ${extra?.color || ''}`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * gBN.b;
        ${extra?.rough || ''}`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 tnx = vec3(nx.xy * 2.0 - 1.0, 0.0);
          vec3 tny = vec3(ny.xy * 2.0 - 1.0, 0.0);
          vec3 tnz = vec3(nz.xy * 2.0 - 1.0, 0.0);
          vec3 sgn = sign(bn);
          vec3 pert = vec3(0.0, tnx.y, tnx.x * sgn.x) * gBW.x + vec3(tny.x, 0.0, tny.y * sgn.y) * gBW.y + vec3(tnz.x * sgn.z, tnz.y, 0.0) * gBW.z;
          vec3 nObj = normalize(bn + pert * 0.9);
          ${world ? 'normal = normalize((viewMatrix * vec4(nObj, 0.0)).xyz);' : 'normal = normalize(nObj.x * vBX + nObj.y * vBY + nObj.z * vBZ);'}
        }`)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= gBN.a;
        reflectedLight.directDiffuse *= mix(1.0, gBN.a, 0.4);`);
  };
  return m;
}

// 바위: 월드 공간 투영 + 윗면 이끼. 구리 광맥은 초록 녹과 구릿빛 금속 줄을 더한다.
export function rockMaterial(t, { moss = 0.6, copper = false, iron = false, wet = false } = {}) {
  const extra = {
    color: `
      float up = smoothstep(0.45, 0.85, bn.y + (fbm3(vBP.xz * 1.7) - 0.5) * 0.5);
      vec3 mossC = mix(vec3(0.10, 0.16, 0.04), vec3(0.22, 0.27, 0.08), fbm3(vBP.xz * 4.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, mossC, up * ${moss.toFixed(2)});
      ${copper ? `
      float vein = smoothstep(0.58, 0.64, fbm3(vBP.xz * 1.3 + vBP.y * 1.9));
      float fleck = smoothstep(0.7, 0.78, fbm3(vBP.xy * 6.0 + vBP.z * 3.0));
      vec3 verd = mix(vec3(0.10, 0.38, 0.30), vec3(0.22, 0.55, 0.45), fbm3(vBP.xz * 8.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, verd, vein * 0.85);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.40, 0.20), fleck * (1.0 - vein));
      float gMetal = fleck * (1.0 - vein);` : iron ? `
      float band = smoothstep(0.52, 0.6, fbm3(vBP.xz * 1.1 + vBP.y * 2.4));
      float spot = smoothstep(0.68, 0.76, fbm3(vBP.xy * 5.0 + vBP.z * 2.0));
      vec3 rust = mix(vec3(0.42, 0.16, 0.06), vec3(0.62, 0.30, 0.12), fbm3(vBP.xz * 7.0));
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.62, rust, band * 0.8);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.31, 0.33), spot * (1.0 - band));
      float gMetal = spot * (1.0 - band) * 0.8;` : 'float gMetal = 0.0;'}
      ${wet ? `
      float wetK = smoothstep(0.9, 0.2, vBP.y);
      diffuseColor.rgb *= mix(1.0, 0.55, wetK);` : 'float wetK = 0.0;'}`,
    rough: `roughnessFactor = mix(roughnessFactor, 0.35, gMetal); roughnessFactor = mix(roughnessFactor, 0.25, wetK);`,
  };
  const m = boxMaterial(t, { scale: 3.2, world: true, roughness: 1, extra });
  if (copper || iron) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh) => {
      prev(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness + gMetal * 0.85;');
    };
  }
  return m;
}

// 잎·갈대: 알파 테스트 카드, 바람에 흔들림, 뒷면이 어두워지지 않게 한쪽 노멀을 쓴다.
// sway: 높이 1m당 흔들림(m). 키가 클수록 많이 흔들린다.
export function foliageMaterial({ map = null, color = 0xffffff, sway = 0.08, alphaTest = 0.45, roughness = 0.75, translucency = 0.35, vertexColors = false } = {}) {
  const m = new THREE.MeshStandardMaterial({
    map, color, alphaTest: map ? alphaTest : 0, side: THREE.DoubleSide, roughness, metalness: 0, vertexColors,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.uTime;
    sh.uniforms.uWind = G.uWind;
    sh.uniforms.uDay = G.uDay;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 rootW = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            rootW = instanceMatrix * rootW;
          #endif
          rootW = modelMatrix * rootW;
          float ph = rootW.x * 0.37 + rootW.z * 0.23;
          float hgt = max(transformed.y, 0.0);
          float k = hgt * hgt * ${sway.toFixed(3)} * 0.12 * uWind;
          vec2 w = vec2(sin(uTime * 1.25 + ph) + 0.35 * sin(uTime * 3.1 + ph * 2.0 + transformed.x * 2.0),
                        cos(uTime * 1.05 + ph * 1.3) * 0.6);
          vec3 dirW = vec3(w.x, 0.0, w.y + 0.4);
          #ifdef USE_INSTANCING
            dirW = transpose(mat3(instanceMatrix)) * dirW;
          #endif
          transformed += dirW * k;
          transformed += normal * sin(uTime * 6.0 + ph * 3.0 + transformed.y * 4.0) * 0.012 * hgt * uWind;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDay;')
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // 잎을 통과해 오는 빛(투과)을 흉내 낸다
        reflectedLight.indirectDiffuse += diffuseColor.rgb * ${translucency.toFixed(2)} * 0.35 * uDay;`);
  };
  return m;
}

export function plainMaterial(color, { roughness = 0.85, metalness = 0, emissive = 0x000000, emissiveIntensity = 1, vertexColors = false, side = THREE.FrontSide } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity, vertexColors, side });
}

export function makeMaterials(tex, ctex) {
  const m = {
    rock: rockMaterial(tex.rock, { moss: 0.55 }),
    rockBare: rockMaterial(tex.rock, { moss: 0.12 }),
    rockWet: rockMaterial(tex.rock, { moss: 0.0, wet: true }),
    copper: rockMaterial(tex.rock, { moss: 0.25, copper: true }),
    ironOre: rockMaterial(tex.rock, { moss: 0.35, iron: true }),
    birch: uvMaterial(tex.birch, { repeat: [1, 2], roughness: 1 }),
    barkDark: uvMaterial(tex.barkDark, { repeat: [1, 1.5], roughness: 1 }),
    driftwood: uvMaterial(tex.driftwood, { repeat: [1, 1], roughness: 1 }),
    planks: boxMaterial(tex.planks, { scale: 1.6 }),
    planksDark: boxMaterial(tex.planks, { scale: 1.6, tint: 0x8a7a6a }),
    plaster: boxMaterial(tex.plaster, { scale: 2.5 }),
    stone: boxMaterial(tex.stone, { scale: 2.2 }),
    shingle: boxMaterial(tex.shingle, { scale: 2.4 }),
    woodBox: boxMaterial(tex.driftwood, { scale: 1.2, tint: 0xb59a7c }),
    birchLeaves: foliageMaterial({ map: ctex.birchLeaves, sway: 0.09, translucency: 0.45 }),
    bushLeaves: foliageMaterial({ map: ctex.bushLeaves, sway: 0.12, translucency: 0.35 }),
    pineNeedles: foliageMaterial({ map: ctex.pineNeedles, sway: 0.04, translucency: 0.15, roughness: 0.85, alphaTest: 0.32 }),
    flowers: foliageMaterial({ map: ctex.flowers, sway: 0.3, translucency: 0.3, roughness: 0.7, alphaTest: 0.5 }),
    reed: foliageMaterial({ color: 0xffffff, sway: 0.25, translucency: 0.3, vertexColors: true, roughness: 0.7 }),
    seaweed: foliageMaterial({ color: 0xffffff, sway: 0.35, translucency: 0.2, vertexColors: true, roughness: 0.55 }),
    plantSolid: foliageMaterial({ color: 0xffffff, sway: 0.06, translucency: 0.1, vertexColors: true, roughness: 0.6 }),
    metal: plainMaterial(0x8d9399, { roughness: 0.38, metalness: 0.9 }),
    iron: plainMaterial(0x3a3c40, { roughness: 0.55, metalness: 0.85 }),
    copperMetal: plainMaterial(0xb4643a, { roughness: 0.32, metalness: 0.95 }),
    rope: plainMaterial(0x9d8460, { roughness: 0.95 }),
    cloth: plainMaterial(0xd8cfb8, { roughness: 0.95, side: THREE.DoubleSide }),
    painted: plainMaterial(0xffffff, { roughness: 0.6, vertexColors: true }),
    berry: plainMaterial(0xffffff, { roughness: 0.28, vertexColors: true }),
    mushroom: plainMaterial(0xffffff, { roughness: 0.62, vertexColors: true }),
    coal: plainMaterial(0x1a1410, { roughness: 0.9, emissive: 0xff5a10, emissiveIntensity: 1.5 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xfff1c8, roughness: 0.08, metalness: 0, transmission: 0, emissive: 0xffc56a, emissiveIntensity: 0.05 }),
    window: plainMaterial(0x1d2228, { roughness: 0.2, emissive: 0xffb050, emissiveIntensity: 0.0 }),
    paper: plainMaterial(0xe3dac0, { roughness: 0.9 }),
    ash: plainMaterial(0x2a2724, { roughness: 1 }),
    waterTop: plainMaterial(0x16262a, { roughness: 0.05 }),
    leather: plainMaterial(0x4a2e1c, { roughness: 0.75 }),
    thread: plainMaterial(0xd8ccb0, { roughness: 0.9 }),
    clothDyed: plainMaterial(0x34507a, { roughness: 0.95, side: THREE.DoubleSide }),
    soup: plainMaterial(0x6a3e1a, { roughness: 0.25 }),
    clay: plainMaterial(0x8e5236, { roughness: 0.8 }),
    sack: plainMaterial(0xb09a72, { roughness: 1 }),
    sawdust: plainMaterial(0xc4a474, { roughness: 1 }),
  };
  m.plasterTint = m.plaster;
  m.wreckWood = boxMaterial(tex.driftwood, { scale: 1.5, tint: 0x8a7a66 });
  return m;
}
