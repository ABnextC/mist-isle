// 렌더러·빛·안개·물·낮과 밤.

import * as THREE from 'three';

const PAL = {
  day: { sky: 0xb4c9cf, fog: 0xb4c9cf, hemiSky: 0xdcebf0, hemiGround: 0x56633f, hemi: 1.15, sun: 2.7, sunColor: 0xfff1d8 },
  dusk: { sky: 0xd9a682, fog: 0xc9a387, hemiSky: 0xf2c9a2, hemiGround: 0x4b4033, hemi: 0.8, sun: 1.3, sunColor: 0xffae6e },
  night: { sky: 0x1b2534, fog: 0x1e2837, hemiSky: 0x3a4b70, hemiGround: 0x101318, hemi: 0.32, sun: 0, sunColor: 0x9fb4ff },
};

const lerp = (a, b, k) => a + (b - a) * k;

export function createScene(canvas, { touch }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !touch, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !touch;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.day.sky);
  scene.fog = new THREE.Fog(PAL.day.fog, 30, 175);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);

  const hemi = new THREE.HemisphereLight(PAL.day.hemiSky, PAL.day.hemiGround, PAL.day.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, PAL.day.sun);
  sun.castShadow = !touch;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  scene.add(moon, moon.target);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    new THREE.MeshStandardMaterial({ color: 0x2c6e86, transparent: true, opacity: 0.8, roughness: 0.25, metalness: 0.05 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(200, 0, 200);
  scene.add(water);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const ca = new THREE.Color();
  const cb = new THREE.Color();
  const dir = new THREE.Vector3();
  const mix = (key, a, b, k) => ca.set(PAL[a][key]).lerp(cb.set(PAL[b][key]), k);

  // f: 하루 안의 위치(0~1), dayFrac: 낮 비율, focus: 그림자를 둘 중심(플레이어)
  function setTime(f, dayFrac, focus, t) {
    let a;
    let b;
    let k;
    let nightK;
    if (f < dayFrac) {
      const p = f / dayFrac;
      const edge = Math.min(p, 1 - p);
      [a, b, k] = edge < 0.12 ? ['dusk', 'day', edge / 0.12] : ['day', 'day', 0];
      const ang = p * Math.PI;
      dir.set(Math.cos(ang) * 0.8, Math.max(0.1, Math.sin(ang)), 0.35).normalize();
      nightK = 0;
    } else {
      const p = (f - dayFrac) / (1 - dayFrac);
      const edge = Math.min(p, 1 - p);
      [a, b, k] = edge < 0.15 ? ['dusk', 'night', edge / 0.15] : ['night', 'night', 0];
      dir.set(-0.4, 0.8, -0.3).normalize();
      nightK = edge < 0.15 ? edge / 0.15 : 1;
    }
    scene.background.copy(mix('sky', a, b, k));
    scene.fog.color.copy(mix('fog', a, b, k));
    hemi.color.copy(mix('hemiSky', a, b, k));
    hemi.groundColor.copy(mix('hemiGround', a, b, k));
    hemi.intensity = lerp(PAL[a].hemi, PAL[b].hemi, k);
    sun.intensity = lerp(PAL[a].sun, PAL[b].sun, k);
    sun.color.copy(mix('sunColor', a, b, k));
    moon.intensity = 0.38 * nightK;
    sun.position.set(focus.x + dir.x * 120, focus.y + dir.y * 120, focus.z + dir.z * 120);
    sun.target.position.copy(focus);
    moon.position.set(focus.x - 60, focus.y + 100, focus.z - 40);
    moon.target.position.copy(focus);
    scene.fog.near = lerp(30, 16, nightK);
    scene.fog.far = lerp(touch ? 150 : 175, 90, nightK);
    water.material.color.setHex(nightK > 0.5 ? 0x1c3a4a : 0x2c6e86);
    water.position.y = Math.sin(t * 0.6) * 0.04;
    return nightK;
  }

  return { renderer, scene, camera, setTime };
}
