// 등대 마을 그리기: 작업대·집·등대·게시판·모닥불·난파선·부두·가로등.
// 밤이 되면 창문과 불이 켜지고 등대 불빛이 돈다. 불·연기 자리는 fx에 넘긴다.

import * as THREE from 'three';
import { STATIONS, house, lighthouse, board, market, campfire, wreck, pier, lampPost, fence, bake } from './models/town.js';

const BEAM_V = `
varying float vAlong;
varying float vEdge;
void main() {
  vAlong = -position.z / 70.0;
  vEdge = length(position.xy) / max(0.001, 5.0 * vAlong + 0.3);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BEAM_F = `
uniform float uOpacity;
varying float vAlong;
varying float vEdge;
void main() {
  float a = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.6) * (1.0 - smoothstep(0.55, 1.0, vEdge));
  gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * a * uOpacity, 1.0);
}`;

export function createTownView(scene, game, hf, { mats, terrain, region }) {
  const fires = [];
  const smokes = [];
  const glows = [];
  const lights = [];
  let beam = null;
  const tmp = new THREE.Vector3();
  const rotY = new THREE.Matrix4();

  function place(model, x, z, rot = 0, { dy = 0, tilt = null } = {}) {
    const y = hf.height(x, z) + dy;
    const geos = bake(model);
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.set(tilt ? tilt[0] : 0, rot, tilt ? tilt[1] : 0);
    for (const [mat, geo] of Object.entries(geos)) {
      const m = new THREE.Mesh(geo, mats[mat] || mats.painted);
      m.castShadow = mat !== 'glass' && mat !== 'window';
      m.receiveShadow = true;
      group.add(m);
    }
    scene.add(group);
    group.updateMatrixWorld(true);
    const toWorld = (p) => p.clone().applyMatrix4(group.matrixWorld);
    const fx = model.fx;
    for (const f of fx.fires) fires.push({ p: toWorld(f.p), s: f.s, low: !!f.low });
    for (const s of fx.smokes) smokes.push(toWorld(s));
    for (const g of fx.glows) glows.push(toWorld(g));
    for (const l of fx.lights) {
      const p = toWorld(l.p);
      if (l.kind === 'lighthouse') {
        const pl = new THREE.PointLight(0xffd69a, 0, 50, 1.6);
        pl.position.copy(p);
        scene.add(pl);
        lights.push({ l: pl, max: 40 });
        const cone = new THREE.ConeGeometry(5, 70, 24, 1, true);
        cone.translate(0, -35, 0);
        cone.rotateX(-Math.PI / 2);
        beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({
          vertexShader: BEAM_V, fragmentShader: BEAM_F, uniforms: { uOpacity: { value: 0 } },
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
        }));
        beam.position.copy(p);
        scene.add(beam);
      } else {
        const pl = new THREE.PointLight(0xff9a48, 0, l.kind === 'forge' ? 9 : 14, 1.7);
        pl.position.copy(p);
        scene.add(pl);
        lights.push({ l: pl, max: l.kind === 'forge' ? 6 : 10, flicker: true, always: l.kind === 'forge' ? 0.35 : 0.15 });
      }
    }
    return group;
  }

  for (const s of Object.values(game.state.settlements)) {
    for (const st of s.stations) {
      const make = STATIONS[st.type];
      if (make) place(make(), st.x, st.z, st.rot);
    }
  }
  let houseSeed = 1;
  for (const o of game.statics) {
    if (o.kind === 'house') place(house(houseSeed++ * 97), o.x, o.z, o.rot);
    else if (o.kind === 'lighthouse') place(lighthouse(), o.x, o.z, o.rot);
    else if (o.kind === 'board') place(board(), o.x, o.z, o.rot || 0.2);
    else if (o.kind === 'market') place(market(), o.x, o.z, o.rot || 0);
    else if (o.kind === 'campfire') place(campfire(), o.x, o.z, 0);
    else if (o.kind === 'wreck') place(wreck(), o.x, o.z, o.rot, { dy: -0.55, tilt: [0.05, 0.16] });
  }

  // 마을 앞 바닷가 부두와 길가 가로등·울타리(충돌 없는 장식)
  const t = region.settlement;
  const px = t.x + 16;
  const pz = terrain.shoreZ(px) + 5;
  const pm = pier(hf, px, pz, 18);
  {
    const g = place(pm, px, pz, 0);
    g.position.y = 0;
  }
  const [sx, sz] = terrain.beachPoint(region.spawn[0], region.spawn[1]);
  for (const k of [0.32, 0.62]) {
    const lx = t.x + (sx - t.x) * k + 2.4;
    const lz = t.z + (sz - t.z) * k + 1.5;
    place(lampPost(), lx, lz, Math.atan2(sx - t.x, sz - t.z));
  }
  place(fence(8), t.x + 14, t.z + 20, -0.5);
  place(fence(6.4), t.x - 26, t.z + 6, 1.4);

  const windowMat = mats.window;
  function update(time, night, dt) {
    windowMat.emissiveIntensity = 2.2 * night;
    mats.glass.emissiveIntensity = 0.05 + 3.5 * night;
    mats.coal.emissiveIntensity = 1.4 + 0.6 * Math.sin(time * 3.1) * Math.sin(time * 1.7);
    for (const { l, max, flicker, always = 0 } of lights) {
      const k = Math.max(always, night);
      l.intensity = max * k * (flicker ? 0.82 + 0.18 * Math.sin(time * 13 + l.position.x) * Math.sin(time * 7.7) : 1);
    }
    if (beam) {
      beam.rotation.y = time * 0.5;
      beam.material.uniforms.uOpacity.value = 0.16 * night;
      beam.visible = night > 0.02;
    }
  }

  return { update, fires, smokes, glows };
}
