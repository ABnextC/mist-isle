// 렌더러·카메라·빛·하늘·안개·후처리를 묶는다. 화질 단계에 따라 그림자·후처리·해상도가 바뀐다.

import * as THREE from 'three';
import { installHeightFog } from './gfx/fog.js';
import { createSky } from './gfx/sky.js';
import { createPost } from './gfx/post.js';

const lerp = THREE.MathUtils.lerp;

export function createScene(canvas, { tier, textures }) {
  installHeightFog();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb0c0, 0.003);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.12, 6000);

  // 해(낮)와 달(밤)을 번갈아 맡는 주광 하나. 그림자는 이 빛만 드리운다.
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;
  key.shadow.radius = 2;
  scene.add(key, key.target);
  const fill = new THREE.HemisphereLight(0x5a6c90, 0x161a1e, 0);
  scene.add(fill);

  const sky = createSky(renderer, scene, { tier, textures });
  const post = createPost(renderer, scene, camera);
  let current = tier;

  function applyTier(t) {
    current = t;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.maxDpr));
    key.shadow.mapSize.set(t.shadow, t.shadow);
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
    const r = t.shadowRange;
    Object.assign(key.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 420 });
    key.shadow.camera.updateProjectionMatrix();
    resize();
    post.configure(t);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.setSize();
  }
  window.addEventListener('resize', resize);

  // 그림자 지도가 움직일 때 떨리지 않게 빛 공간의 텍셀 단위로 맞춘다
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const snapped = new THREE.Vector3();
  function placeKey(dir, focus) {
    fwd.copy(dir).negate();
    right.crossVectors(Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : THREE.Object3D.DEFAULT_UP, fwd).normalize();
    up.crossVectors(fwd, right);
    const texel = (2 * current.shadowRange) / current.shadow;
    const a = Math.round(focus.dot(right) / texel) * texel;
    const b = Math.round(focus.dot(up) / texel) * texel;
    const c = focus.dot(fwd);
    snapped.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(fwd, c);
    key.target.position.copy(snapped);
    key.position.copy(snapped).addScaledVector(dir, 200);
    key.target.updateMatrixWorld();
  }

  // f: 하루 안 위치(0~1). 낮·밤·노을 정도를 돌려준다.
  function setTime(f, dayFrac, focus, t, nowMs) {
    const st = sky.update(f, dayFrac, t, camera, nowMs);
    const night = st.night;
    if (st.sunElev > -0.02) {
      key.color.copy(sky.sunColor);
      key.intensity = 4.2 * st.day;
      placeKey(sky.sunDir, focus);
    } else {
      key.color.setRGB(0.62, 0.72, 1.0);
      key.intensity = 0.9 * night;
      placeKey(sky.moonDir, focus);
    }
    fill.intensity = 0.55 * night;
    // 해가 낮을수록 그림자 여드름이 생기니 띄움을 키운다
    const lowSun = 1 - THREE.MathUtils.smoothstep(Math.abs(st.sunElev), 0.08, 0.45);
    key.shadow.normalBias = 0.035 + 0.12 * lowSun;
    key.shadow.bias = -0.0004 - 0.0012 * lowSun;
    scene.fog.color.copy(sky.fogColor);
    scene.fog.density = lerp(lerp(0.0026, 0.0042, st.gold), 0.0085, night);
    scene.environmentIntensity = lerp(lerp(0.7, 1.0, st.gold), 1.2, night);
    renderer.toneMappingExposure = lerp(lerp(0.72, 1.15, st.gold), 1.3, night);
    return st;
  }

  applyTier(tier);
  return {
    renderer, scene, camera, key, setTime, applyTier, resize,
    render: () => post.render(),
    get tier() { return current; },
  };
}
