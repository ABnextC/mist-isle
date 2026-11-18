// 높이 안개: 낮은 곳일수록 짙고, 멀수록 하늘빛에 묻힌다(공기 원근).
// three의 기본 안개 조각(ShaderChunk)을 바꿔 모든 재질에 한 번에 적용한다. FogExp2를 쓸 때만 바뀐다.

import * as THREE from 'three';

let done = false;

export function installHeightFog() {
  if (done) return;
  done = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  // 뷰 공간 위치에서 월드 위치를 되돌린다(카메라 행렬은 회전+이동뿐이다)
  C.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogRay = vFogWorldPos - cameraPosition;
    float fogDist = length(fogRay);
    const float FALL = 0.045;
    float hc = max(cameraPosition.y, -1.0);
    float hp = max(vFogWorldPos.y, -1.0);
    float dh = hp - hc;
    float integ = abs(dh) > 0.05 ? (exp(-FALL * hc) - exp(-FALL * hp)) / (FALL * dh) : exp(-FALL * hc);
    float fogFactor = 1.0 - exp(-fogDensity * fogDist * (0.35 + integ));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}
