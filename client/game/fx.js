// 효과: 대상 고리, 채집 조각과 먼지, 굴뚝·대장간 연기, 불꽃과 불티, 갈매기, 밤의 반딧불.
// 연기·불은 카메라를 향하는 사각형(빌보드) 인스턴스로 그린다.

import * as THREE from 'three';

const BILL_V = `
attribute vec3 iPos;
attribute vec4 iData; // size, alpha, rot, heat
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vAlpha = iData.y;
  vHeat = iData.w;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iData.z);
  float s = sin(iData.z);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iData.x;
  vec3 wp = iPos + right * q.x + up * q.y;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const BILL_F = `
uniform sampler2D map;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uAdd;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  vec3 col = mix(uColor, uHot, vHeat);
  gl_FragColor = vec4(col * t.rgb, t.a * vAlpha);
  if (uAdd > 0.5) gl_FragColor = vec4(col * t.rgb * t.a * vAlpha, 1.0);
  #include <fog_fragment>
}`;

function billboards(scene, max, { map, color, hot = color, additive = false, fog = true, order = 3 }) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const pos = new Float32Array(max * 3);
  const dat = new Float32Array(max * 4);
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('iData', new THREE.InstancedBufferAttribute(dat, 4).setUsage(THREE.DynamicDrawUsage));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    vertexShader: BILL_V, fragmentShader: BILL_F, fog,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: map }, uColor: { value: new THREE.Color(color) }, uHot: { value: new THREE.Color(hot) }, uAdd: { value: additive ? 1 : 0 },
    }]),
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.uniforms.map.value = map;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  scene.add(mesh);
  let n = 0;
  return {
    mat,
    begin() { n = 0; },
    push(x, y, z, size, alpha, rot = 0, heat = 0) {
      if (n >= max) return;
      pos[n * 3] = x;
      pos[n * 3 + 1] = y;
      pos[n * 3 + 2] = z;
      dat[n * 4] = size;
      dat[n * 4 + 1] = alpha;
      dat[n * 4 + 2] = rot;
      dat[n * 4 + 3] = heat;
      n++;
    },
    end() {
      geo.instanceCount = n;
      geo.attributes.iPos.needsUpdate = true;
      geo.attributes.iData.needsUpdate = true;
    },
  };
}

function gull() {
  const m = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.8 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 4, 8), m);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), m);
  head.position.set(0, 0.04, 0.24);
  g.add(head);
  const wing = (sx) => {
    const p = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.1);
    shape.lineTo(0.55 * sx, -0.02);
    shape.lineTo(0.75 * sx, -0.12);
    shape.lineTo(0.5 * sx, -0.18);
    shape.lineTo(0, -0.22);
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, 0.12);
    const w = new THREE.Mesh(geo, m);
    w.material = m;
    const tip = new THREE.Mesh(new THREE.ShapeGeometry((() => {
      const s2 = new THREE.Shape();
      s2.moveTo(0.55 * sx, -0.02);
      s2.lineTo(0.75 * sx, -0.12);
      s2.lineTo(0.55 * sx, -0.14);
      return s2;
    })()).rotateX(Math.PI / 2).translate(0, 0.002, 0.12), dark);
    p.add(w, tip);
    g.add(p);
    return p;
  };
  for (const c of g.children) c.material.side = THREE.DoubleSide;
  const L = wing(1);
  const R = wing(-1);
  L.children.forEach((c) => { c.material.side = THREE.DoubleSide; });
  R.children.forEach((c) => { c.material.side = THREE.DoubleSide; });
  g.traverse((o) => { o.castShadow = true; });
  return { g, L, R };
}

export function createFx(scene, { textures, hf, town, terrain, region }) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.18, 40),
    new THREE.MeshBasicMaterial({ color: 0x9ff0d8, transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 4;
  scene.add(ring);

  // 채집 조각
  const N = 90;
  const chips = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.06, 0), new THREE.MeshStandardMaterial({ roughness: 0.85 }), N);
  chips.frustumCulled = false;
  chips.castShadow = true;
  chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(chips);
  const parts = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0 }));
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let next = 0;
  for (let i = 0; i < N; i++) chips.setColorAt(i, col.set(0xffffff));

  const smoke = billboards(scene, 260, { map: textures.smoke, color: 0x8c8a86 });
  const dust = billboards(scene, 80, { map: textures.smoke, color: 0xa08a6a, order: 4 });
  const fire = billboards(scene, 90, { map: textures.flame, color: 0xff9a40, hot: 0xffe6b0, additive: true, fog: false, order: 5 });
  const sparks = billboards(scene, 160, { map: textures.glow, color: 0xff8a30, hot: 0xffd890, additive: true, fog: false, order: 6 });
  const glows = billboards(scene, 60, { map: textures.glow, color: 0xffb25a, additive: true, fog: false, order: 6 });
  const flies = billboards(scene, 60, { map: textures.glow, color: 0xcfff7a, additive: true, fog: false, order: 6 });

  const puffs = [];
  const embers = [];
  const dusts = [];
  const emit = (town?.smokes || []).map((p, i) => ({ p, acc: i * 0.37, rate: 1.6 }));
  const firePts = town?.fires || [];
  const windowGlows = town?.glows || [];

  // 갈매기: 바닷가 위를 돈다
  const gulls = [];
  for (let i = 0; i < 7; i++) {
    const b = gull();
    scene.add(b.g);
    const cx = 60 + i * 45 + Math.random() * 20;
    gulls.push({ ...b, cx, cz: terrain.shoreZ(cx) - 6 + Math.random() * 12, r: 10 + Math.random() * 14, h: 13 + Math.random() * 12, w: (0.25 + Math.random() * 0.2) * (Math.random() < 0.5 ? -1 : 1), a: Math.random() * 6.28, flap: Math.random() * 6 });
  }
  const fireflies = Array.from({ length: 40 }, () => ({ p: new THREE.Vector3(), ph: Math.random() * 100, base: new THREE.Vector3() }));
  let fliesCenter = new THREE.Vector3(1e9, 0, 0);

  function burst(x, y, z, color, count = 10) {
    for (let k = 0; k < count; k++) {
      const p = parts[next];
      p.life = 0.7 + Math.random() * 0.4;
      p.p.set(x + (Math.random() - 0.5) * 0.6, y + 0.5 + Math.random() * 0.7, z + (Math.random() - 0.5) * 0.6);
      p.v.set((Math.random() - 0.5) * 3.5, 2.2 + Math.random() * 2.4, (Math.random() - 0.5) * 3.5);
      p.r = Math.random() * 6;
      chips.setColorAt(next, col.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
      next = (next + 1) % N;
    }
    chips.instanceColor.needsUpdate = true;
    for (let k = 0; k < 4; k++) dusts.push({ p: new THREE.Vector3(x + (Math.random() - 0.5) * 0.8, y + 0.3, z + (Math.random() - 0.5) * 0.8), age: 0, life: 1.2 + Math.random() * 0.6, rot: Math.random() * 6 });
  }

  function setTarget(x, y, z, ok, radius) {
    if (x == null) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.position.set(x, y + 0.06, z);
    ring.scale.setScalar(radius || 1);
    ring.material.color.setHex(ok ? 0x9ff0d8 : 0xf0a090);
  }

  function update(dt, t, { night = 0, day = 1, player = null, sunColor = null } = {}) {
    // 마을 사업으로 굴뚝이 새로 서면(v0.4) 연기 자리도 늘린다
    const sm = town?.smokes || [];
    for (let i = emit.length; i < sm.length; i++) emit.push({ p: sm[i], acc: i * 0.37, rate: 1.6 });
    ring.material.opacity = 0.5 + 0.25 * Math.sin(t * 5);
    for (let i = 0; i < N; i++) {
      const p = parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.v.y -= 11 * dt;
        p.p.addScaledVector(p.v, dt);
        p.r += dt * 8;
        dummy.position.copy(p.p);
        dummy.rotation.set(p.r, p.r * 0.7, 0);
        dummy.scale.setScalar(Math.max(0, Math.min(1, p.life * 2)));
      } else {
        dummy.scale.setScalar(0);
      }
      dummy.updateMatrix();
      chips.setMatrixAt(i, dummy.matrix);
    }
    chips.instanceMatrix.needsUpdate = true;

    // 연기
    const wind = new THREE.Vector3(0.45, 0, 0.18);
    for (const e of emit) {
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        puffs.push({ p: e.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2)), age: 0, life: 6 + Math.random() * 3, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.4 });
      }
    }
    smoke.mat.uniforms.uColor.value.setRGB(0.55, 0.54, 0.52).multiplyScalar(0.06 + 0.94 * day);
    smoke.begin();
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.age += dt;
      if (q.age >= q.life) {
        puffs.splice(i, 1);
        continue;
      }
      const k = q.age / q.life;
      q.p.y += dt * (0.9 - k * 0.4);
      q.p.addScaledVector(wind, dt * (0.3 + k));
      q.rot += q.spin * dt;
      smoke.push(q.p.x, q.p.y, q.p.z, 0.5 + k * 2.8, Math.min(1, k * 6) * (1 - k) * 0.55, q.rot);
    }
    smoke.end();

    dust.begin();
    for (let i = dusts.length - 1; i >= 0; i--) {
      const q = dusts[i];
      q.age += dt;
      if (q.age >= q.life) {
        dusts.splice(i, 1);
        continue;
      }
      const k = q.age / q.life;
      q.p.y += dt * 0.4;
      dust.push(q.p.x, q.p.y, q.p.z, 0.6 + k * 1.4, (1 - k) * 0.35, q.rot);
    }
    dust.end();

    // 불꽃과 불티
    fire.begin();
    sparks.begin();
    for (let f = 0; f < firePts.length; f++) {
      const { p, s, low } = firePts[f];
      const n = low ? 3 : 5;
      for (let k = 0; k < n; k++) {
        const ph = t * (6 + k) + f * 3 + k * 1.7;
        const fl = 0.75 + 0.25 * Math.sin(ph) * Math.sin(ph * 0.53);
        const h = (low ? 0.35 : 0.75) * s * fl;
        fire.push(p.x + Math.sin(k * 2.1 + t) * 0.08 * s, p.y + h * 0.42, p.z + Math.cos(k * 1.7 + t) * 0.08 * s, h * (0.8 + k * 0.1), 0.85, Math.sin(ph * 0.3) * 0.15, k / n);
      }
      if (Math.random() < dt * (low ? 2 : 5)) embers.push({ p: p.clone(), v: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6), age: 0, life: 1 + Math.random() * 1.5 });
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const q = embers[i];
      q.age += dt;
      if (q.age >= q.life) {
        embers.splice(i, 1);
        continue;
      }
      q.p.addScaledVector(q.v, dt);
      q.p.addScaledVector(wind, dt * 0.8);
      q.v.x += (Math.random() - 0.5) * dt * 2;
      sparks.push(q.p.x, q.p.y, q.p.z, 0.08, 1 - q.age / q.life, 0, 1 - q.age / q.life);
    }
    fire.end();
    sparks.end();

    // 창문 불빛(밤에만)
    glows.begin();
    if (night > 0.05) for (const g of windowGlows) glows.push(g.x, g.y, g.z, 1.3, 0.55 * night, 0);
    glows.end();

    // 반딧불(밤, 플레이어 둘레 풀밭)
    flies.begin();
    if (night > 0.2 && player) {
      if (fliesCenter.distanceTo(player) > 25) {
        fliesCenter = player.clone();
        for (const f of fireflies) {
          const a = Math.random() * 6.28;
          const d = 4 + Math.random() * 16;
          f.base.set(player.x + Math.cos(a) * d, 0, player.z + Math.sin(a) * d);
          f.base.y = hf.height(f.base.x, f.base.z) + 0.5 + Math.random() * 1.2;
        }
      }
      for (const f of fireflies) {
        if (f.base.y < 1.6) continue;
        const ph = t * 0.6 + f.ph;
        const blink = Math.max(0, Math.sin(t * 2.2 + f.ph * 3));
        flies.push(f.base.x + Math.sin(ph) * 0.8, f.base.y + Math.sin(ph * 1.7) * 0.3, f.base.z + Math.cos(ph * 0.8) * 0.8, 0.22, blink * night, 0);
      }
    }
    flies.end();

    // 갈매기
    for (const b of gulls) {
      b.a += dt * b.w * 0.5;
      const x = b.cx + Math.cos(b.a) * b.r;
      const z = b.cz + Math.sin(b.a) * b.r;
      const y = b.h + Math.sin(b.a * 2 + b.cx) * 1.5;
      b.g.position.set(x, y, z);
      b.g.rotation.set(0, Math.atan2(-Math.sin(b.a) * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w)), -Math.sign(b.w) * 0.35);
      b.flap += dt * 9;
      const glide = Math.sin(b.a * 0.7 + b.cx) > 0.2;
      const f = glide ? 0.12 : Math.sin(b.flap) * 0.6;
      b.L.rotation.z = f;
      b.R.rotation.z = -f;
      b.g.visible = day > 0.2;
    }
  }

  return { burst, setTarget, update };
}
