// 하늘·해·달·별·구름, 하늘에서 받아 오는 반사광(PMREM), 안개 색.
// 하늘은 물리식(Preetham)으로 계산한다. 해가 움직이면 반사광을 다시 굽는다.

import * as THREE from 'three';
import { Sky } from 'three-addons';

const MAX_ELEV = 0.95; // 정오 고도(라디안, 약 54°)
const C = (r, g, b) => new THREE.Color(r, g, b);
const SUN = { high: C(1.0, 0.95, 0.88), low: C(1.0, 0.66, 0.40), set: C(1.0, 0.42, 0.18) };

export function createSky(renderer, scene, { tier, textures }) {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  sky.material.uniforms.turbidity.value = 3.2;
  sky.material.uniforms.rayleigh.value = 1.4;
  sky.material.uniforms.mieCoefficient.value = 0.004;
  sky.material.uniforms.mieDirectionalG.value = 0.82;
  sky.renderOrder = -10;
  scene.add(sky);

  // 별
  const starGeo = new THREE.BufferGeometry();
  const N = 2600;
  const sp = new Float32Array(N * 3);
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const u = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const y = Math.abs(u) * 0.95 + 0.03;
    const q = Math.sqrt(1 - y * y);
    sp[i * 3] = Math.cos(a) * q * 2000;
    sp[i * 3 + 1] = y * 2000;
    sp[i * 3 + 2] = Math.sin(a) * q * 2000;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, color: 0xdfe8ff, transparent: true, opacity: 0, depthWrite: false, fog: false,
  }));
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  scene.add(stars);

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.moon, transparent: true, fog: false, depthWrite: false }));
  moon.scale.setScalar(110);
  moon.renderOrder = -8;
  scene.add(moon);

  // 구름은 하늘 셰이더(three r187 Sky)의 구름을 쓴다. 반사광 하늘에도 같은 구름이 들어간다.
  const skies = [];

  // 반사광용 장면: 하늘 + 아래쪽 땅빛
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(200);
  envScene.add(envSky);
  skies.push(sky, envSky);
  // 하늘 밝기를 장면 빛과 맞추는 배율(물리식 하늘은 한낮에 너무 밝다)
  const skyScale = { value: 0.3 };
  for (const s2 of skies) {
    s2.material.uniforms.uSkyScale = skyScale;
    s2.material.fragmentShader = s2.material.fragmentShader
      .replace('uniform float time;', 'uniform float time;\nuniform float uSkyScale;')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * uSkyScale, 1.0 );');
    s2.material.needsUpdate = true;
    const u = s2.material.uniforms;
    u.cloudCoverage.value = 0.38;
    u.cloudDensity.value = 0.55;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00003;
    u.cloudElevation.value = 0.45;
  }
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x3c4a2a, side: THREE.BackSide });
  const ground = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 12, 0, Math.PI * 2, Math.PI / 2 + 0.04, Math.PI / 2 - 0.04), groundMat);
  envScene.add(ground);
  let envRT = null;
  const lastEnvDir = new THREE.Vector3(0, -2, 0);
  let lastEnvAt = -1e9;
  // 반사광(v0.4.3): 하늘 큐브맵을 한 프레임에 한 면씩 그리고, 여섯 면이 차면 같은 타깃에 다시 거른다.
  // 한꺼번에 굽고 타깃을 새로 만들던 때는 몇 초마다 화면이 튀었다(휴대폰).
  const cubeRT = new THREE.WebGLCubeRenderTarget(tier.envSize, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, depthBuffer: true });
  const cubeCam = new THREE.CubeCamera(0.1, 400, cubeRT);
  let envFace = -1;
  function stepEnv(full) {
    const prev = renderer.getRenderTarget();
    if (full) {
      cubeCam.update(renderer, envScene);
      envFace = 6;
    } else if (envFace >= 0 && envFace < 6) {
      renderer.setRenderTarget(cubeRT, envFace);
      renderer.render(envScene, cubeCam.children[envFace]);
      envFace++;
      renderer.setRenderTarget(prev);
      return;
    }
    if (envFace === 6) {
      envRT = pmrem.fromCubemap(cubeRT.texture, envRT);
      scene.environment = envRT.texture;
      envFace = -1;
    }
    renderer.setRenderTarget(prev);
  }

  // 안개 색: 카메라가 보는 쪽 지평선 하늘을 작게 그려 읽어 온다(낮·노을·밤 모두 하늘과 맞는다)
  const probeRT = new THREE.WebGLRenderTarget(16, 8, { depthBuffer: false });
  const probeCam = new THREE.PerspectiveCamera(16, 2, 0.1, 400);
  probeCam.rotation.order = 'YXZ';
  const probeBuf = new Uint8Array(16 * 8 * 4);
  const fogTarget = new THREE.Color(0.6, 0.69, 0.78);
  let lastProbe = -1e9;
  const PROBE_SCALE = 0.5;
  const probeDir = new THREE.Vector3();
  let probing = false;
  // 픽셀을 GPU에서 기다리지 않고(비동기) 읽는다. 기다리면 그 프레임이 통째로 멈춘다.
  function probeFog(camera) {
    if (probing) return;
    camera.getWorldDirection(probeDir);
    probeCam.rotation.set(0.12, Math.atan2(-probeDir.x, -probeDir.z), 0);
    const prev = renderer.getRenderTarget();
    const keep = skyScale.value;
    skyScale.value = keep * PROBE_SCALE;
    renderer.setRenderTarget(probeRT);
    renderer.render(envScene, probeCam);
    renderer.setRenderTarget(prev);
    skyScale.value = keep;
    probing = true;
    const read = renderer.readRenderTargetPixelsAsync
      ? renderer.readRenderTargetPixelsAsync(probeRT, 0, 0, 16, 8, probeBuf)
      : Promise.resolve(renderer.readRenderTargetPixels(probeRT, 0, 0, 16, 8, probeBuf));
    read.then(() => {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < 16 * 8; i++) {
        r += probeBuf[i * 4];
        g += probeBuf[i * 4 + 1];
        b += probeBuf[i * 4 + 2];
      }
      const k = 1 / (16 * 8 * 255 * PROBE_SCALE);
      fogTarget.setRGB(r * k, g * k, b * k);
    }).catch(() => {}).finally(() => { probing = false; });
  }

  const sunDir = new THREE.Vector3(0, 1, 0);
  const moonDir = new THREE.Vector3(0, 1, 0);
  const fogColor = new THREE.Color(0, 0, 0);
  const sunColor = new THREE.Color();
  const tmp = new THREE.Color();
  const state = { day: 1, night: 0, gold: 0, sunElev: 0 };

  function sunPath(f, dayFrac) {
    let A;
    let E;
    if (f < dayFrac) {
      const p = f / dayFrac;
      A = Math.PI * p;
      E = MAX_ELEV * Math.sin(Math.PI * p) - 0.03;
    } else {
      const p = (f - dayFrac) / (1 - dayFrac);
      A = Math.PI + Math.PI * p;
      E = -0.03 - 0.35 * Math.sin(Math.PI * p);
    }
    // 해는 동(+x)에서 떠서 남쪽(바다, -z) 하늘을 지나 서(-x)로 진다
    sunDir.set(Math.cos(A) * Math.cos(E), Math.sin(E), -Math.sin(A) * Math.cos(E)).normalize();
    // 달은 밤 동안 해와 반대쪽 하늘(바다 위)을 지난다
    const mA = A + Math.PI;
    const mE = f < dayFrac ? -0.2 : 0.12 + 0.7 * Math.sin(Math.PI * (f - dayFrac) / (1 - dayFrac));
    moonDir.set(Math.cos(mA) * Math.cos(mE), Math.sin(mE), -Math.sin(mA) * Math.cos(mE)).normalize();
    return E;
  }

  function update(f, dayFrac, t, camera, nowMs) {
    const E = sunPath(f, dayFrac);
    const elev = Math.sin(E);
    const day = THREE.MathUtils.smoothstep(elev, -0.08, 0.1);
    const gold = (1 - THREE.MathUtils.smoothstep(elev, 0.05, 0.35)) * day;
    state.day = day;
    state.night = 1 - THREE.MathUtils.smoothstep(elev, -0.2, -0.02);
    state.gold = gold;
    state.sunElev = elev;
    for (const s2 of skies) {
      s2.material.uniforms.sunPosition.value.copy(sunDir);
      s2.material.uniforms.time.value = t;
    }
    sky.material.uniforms.rayleigh.value = 1.4 + gold * 1.2;
    envSky.material.uniforms.rayleigh.value = sky.material.uniforms.rayleigh.value;
    sunColor.copy(SUN.high).lerp(SUN.low, gold);
    if (elev < 0.08) sunColor.lerp(SUN.set, THREE.MathUtils.smoothstep(0.08 - elev, 0, 0.12));
    if (nowMs - lastProbe > 1000) {
      probeFog(camera);
      lastProbe = nowMs;
    }
    // 하늘빛보다 조금 어둡고 덜 푸르게(땅에서 올라온 습기 느낌)
    tmp.copy(fogTarget).multiplyScalar(0.92);
    tmp.lerp(tmp.clone().setScalar((tmp.r + tmp.g + tmp.b) / 3), 0.18);
    if (fogColor.r + fogColor.g + fogColor.b === 0) fogColor.copy(tmp);
    else fogColor.lerp(tmp, 0.08);
    groundMat.color.copy(tmp.set(0x3a4628).multiplyScalar(0.25 + 0.75 * day));
    stars.material.opacity = state.night * 0.95;
    stars.position.copy(camera.position);
    moon.material.opacity = Math.max(0, Math.min(1, moonDir.y * 6)) * (0.35 + 0.65 * state.night);
    moon.position.copy(camera.position).addScaledVector(moonDir, 1500);

    // 반사광: 해가 0.7° 넘게 움직였거나 15초가 지났으면 한 면씩 다시 그린다(처음 한 번은 한꺼번에)
    if (!envRT) {
      stepEnv(true);
      lastEnvDir.copy(sunDir);
      lastEnvAt = nowMs;
    } else if (envFace >= 0) {
      stepEnv(false);
    } else if ((sunDir.angleTo(lastEnvDir) > 0.012 && nowMs - lastEnvAt > 3000) || nowMs - lastEnvAt > 15000) {
      envFace = 0;
      lastEnvDir.copy(sunDir);
      lastEnvAt = nowMs;
    }
    return state;
  }

  return { update, sunDir, moonDir, fogColor, sunColor, state, sky, skyScale };
}
