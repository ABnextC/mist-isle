// 계절 입자(v2.0): 봄 꽃잎, 여름 반딧불(밤)·꽃가루(낮), 가을 낙엽, 겨울 눈.
// 카메라 둘레 상자 안에서 세계에 붙어 떠다니고(헤엄치지 않게), 상자 밖으로 나가면 반대편으로 돌아온다.
// 계산은 모두 정점 셰이더에서 한다(매 프레임 CPU 일 없음).

import * as THREE from 'three';

const KINDS = {
  spring: { col: [1.0, 0.78, 0.86], col2: [1.0, 0.92, 0.95], size: 0.11, fall: 0.55, sway: 0.9, flat: 0.55, glow: 0, add: false, alpha: 0.9 },
  summer: { col: [1.0, 0.97, 0.82], col2: [0.95, 1.0, 0.85], size: 0.05, fall: 0.06, sway: 0.5, flat: 1.0, glow: 0, add: false, alpha: 0.55 },
  summerNight: { col: [0.78, 1.0, 0.42], col2: [1.0, 0.92, 0.45], size: 0.13, fall: -0.02, sway: 0.7, flat: 1.0, glow: 1, add: true, alpha: 1.0 },
  autumn: { col: [0.95, 0.48, 0.14], col2: [0.85, 0.22, 0.1], size: 0.15, fall: 0.8, sway: 1.3, flat: 0.45, glow: 0, add: false, alpha: 0.95 },
  winter: { col: [0.96, 0.98, 1.0], col2: [0.88, 0.93, 1.0], size: 0.075, fall: 1.1, sway: 0.4, flat: 1.0, glow: 0, add: false, alpha: 0.9 },
};

export function createParticles(scene, { count = 700, box = 34 } = {}) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 4);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    pos.set([(Math.random() - 0.5) * box * 2, Math.random() * box * 0.6, (Math.random() - 0.5) * box * 2], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const U = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uGround: { value: 0 },
    uCol: { value: new THREE.Color() }, uCol2: { value: new THREE.Color() }, uSize: { value: 0.1 }, uFall: { value: 0.5 }, uSway: { value: 1 },
    uFlat: { value: 1 }, uGlow: { value: 0 }, uAlpha: { value: 0 }, uScale: { value: 600 }, uDensity: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 aSeed;
      uniform float uTime, uBox, uGround, uSize, uFall, uSway, uScale, uGlow, uDensity;
      uniform vec3 uCam;
      varying vec4 vS;
      varying float vFade;
      void main() {
        vS = aSeed;
        float t = uTime * (0.6 + 0.8 * aSeed.y);
        vec3 p = position;
        p.y -= uFall * (0.7 + 0.6 * aSeed.x) * uTime;
        p.x += sin(t * 0.9 + aSeed.z * 6.28) * uSway + uTime * 0.25 * uSway;
        p.z += cos(t * 0.7 + aSeed.w * 6.28) * uSway * 0.8;
        // 반딧불은 위아래로 천천히 떠다닌다
        p.y += uGlow * sin(t * 0.6 + aSeed.x * 6.28) * 0.8;
        vec3 r = mod(p - uCam + vec3(uBox, uBox * 0.6, uBox), vec3(uBox * 2.0, uBox * 1.2, uBox * 2.0)) - vec3(uBox, uBox * 0.6, uBox);
        vec3 w = uCam + r;
        w.y = max(w.y, uGround + 0.15 + aSeed.y * 0.3 * uGlow);
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float far = 1.0 - smoothstep(uBox * 0.55, uBox, length(r.xz));
        vFade = far * step(aSeed.w, uDensity);
        gl_PointSize = uSize * (0.7 + 0.6 * aSeed.z) * uScale / max(-mv.z, 0.1);
      }`,
    fragmentShader: `
      uniform vec3 uCol, uCol2;
      uniform float uFlat, uGlow, uAlpha, uTime;
      varying vec4 vS;
      varying float vFade;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        // 꽃잎·잎은 납작하게, 돌며 떨어지게
        float a = vS.x * 6.28 + uTime * (0.8 + vS.y);
        q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
        q.y /= max(uFlat, 0.2);
        float d = length(q) * 2.0;
        float m = uGlow > 0.5 ? exp(-d * d * 3.5) * (0.55 + 0.45 * sin(uTime * 2.3 + vS.z * 40.0)) : smoothstep(1.0, 0.7, d);
        float al = m * uAlpha * vFade;
        if (al < 0.01) discard;
        gl_FragColor = vec4(mix(uCol, uCol2, vS.y), al);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  scene.add(pts);
  let kind = null;
  let level = 0;
  return {
    // season: 계절 id, night 0~1, cam 위치, ground: 카메라 아래 땅 높이, dt
    update(season, night, cam, ground, t, dt, h) {
      const want = season === 'summer' && night > 0.5 ? 'summerNight' : season;
      if (want !== kind) {
        level = Math.max(0, level - dt * 1.5);
        if (level <= 0.01 || kind == null) {
          if (kind == null) level = 1;
          kind = want;
          const K = KINDS[kind] || KINDS.spring;
          U.uCol.value.setRGB(...K.col);
          U.uCol2.value.setRGB(...K.col2);
          U.uSize.value = K.size;
          U.uFall.value = K.fall;
          U.uSway.value = K.sway;
          U.uFlat.value = K.flat;
          U.uGlow.value = K.glow;
          mat.blending = K.add ? THREE.AdditiveBlending : THREE.NormalBlending;
          mat.needsUpdate = true;
        }
      } else level = Math.min(1, level + dt * 0.8);
      const K = KINDS[kind];
      U.uAlpha.value = K.alpha * level;
      U.uTime.value = t;
      U.uCam.value.copy(cam);
      U.uGround.value = ground;
      U.uScale.value = h * 0.9;
    },
    setDensity(k) { U.uDensity.value = k; },
    get mesh() { return pts; },
  };
}
