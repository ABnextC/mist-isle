// 정착지 그리기: 작업대·집·등대·게시판·모닥불·난파선·부두·가로등, 숲머리(v0.4)의 천막·오두막·짓는 자리.
// 밤이 되면 창문과 불이 켜지고 등대 불빛이 돈다. 불·연기 자리는 fx에 넘긴다.
// 마을 사업이 끝나면(project.done) 짓는 자리를 걷고 작업대·건물을 세운다. 2단계 작업대엔 깃발을 단다.
// 모닥불·대장간·횃불 불빛은 점광원 두 개를 돌려 쓴다(가까운 곳에만 켠다. 광원 수가 늘면 모든 재질이 무거워진다).

import * as THREE from 'three';
import { STATIONS, house, lighthouse, board, market, campfire, wreck, pier, lampPost, fence, bake, tent, cabin, site, pennant, torch } from './models/town.js';

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
  const spots = []; // 불빛 자리(점광원 풀이 가까운 것부터 맡는다)
  let beam = null;
  const POOL = 2;
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const pl = new THREE.PointLight(0xff9a48, 0, 14, 1.7);
    scene.add(pl);
    pool.push(pl);
  }

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
        spots.push({ p, range: l.kind === 'forge' ? 9 : l.kind === 'torch' ? 8 : 14, max: l.kind === 'forge' ? 6 : l.kind === 'torch' ? 4 : 10, always: l.kind === 'forge' ? 0.35 : 0.15 });
      }
    }
    return group;
  }

  function drop(group) {
    if (!group) return;
    scene.remove(group);
    group.traverse((o) => o.geometry?.dispose());
  }

  // 작업대·짓는 자리·깃발: 상태가 바뀌면 맞춰 다시 놓는다
  const placed = {};
  const sites = {};
  const flags = {};
  const key = (sid, type) => sid + ':' + type;
  function syncStations() {
    for (const s of Object.values(game.state.settlements)) {
      const sdef = region.settlements.find((x) => x.id === s.id);
      for (const st of s.stations) {
        const k = key(s.id, st.type);
        if (!placed[k] && STATIONS[st.type]) {
          placed[k] = place(STATIONS[st.type](), st.x, st.z, st.rot);
          drop(sites[k]);
          delete sites[k];
        }
        const want = st.tier >= 2;
        if (want && !flags[k]) {
          const fx = Math.sin(st.rot || 0) * -1.4 + Math.cos(st.rot || 0) * 1.3;
          const fz = Math.cos(st.rot || 0) * -1.4 - Math.sin(st.rot || 0) * 1.3;
          flags[k] = place(pennant(st.tier), st.x + fx, st.z + fz, st.rot || 0);
        } else if (!want && flags[k]) {
          drop(flags[k]);
          delete flags[k];
        }
      }
      for (const st of sdef?.stations || []) {
        if (!st.build) continue;
        const k = key(s.id, st.type);
        if (placed[k] || sites[k]) continue;
        sites[k] = place(site(st.type.length * 13 + st.dx * 7, game.data.stations[st.type].r || 1), s.x + st.dx, s.z + st.dz, st.rot || 0);
      }
    }
  }
  syncStations();

  // 집·천막·오두막·게시판 같은 정적 건물: 사업으로 생긴 것은 끝난 뒤에 더한다
  const shown = new Set();
  let houseSeed = 1;
  function syncStatics() {
    for (const o of game.statics) {
      const k = `${o.kind}@${o.x.toFixed(1)},${o.z.toFixed(1)}`;
      if (shown.has(k)) continue;
      shown.add(k);
      if (o.kind === 'house') place(house(houseSeed++ * 97), o.x, o.z, o.rot);
      else if (o.kind === 'lighthouse') place(lighthouse(), o.x, o.z, o.rot);
      else if (o.kind === 'board') place(board(), o.x, o.z, o.rot || 0.2);
      else if (o.kind === 'market') place(market(), o.x, o.z, o.rot || 0);
      else if (o.kind === 'campfire') place(campfire(), o.x, o.z, 0);
      else if (o.kind === 'tent') place(tent(houseSeed++ * 31), o.x, o.z, o.rot);
      else if (o.kind === 'cabin') place(cabin(houseSeed++ * 53), o.x, o.z, o.rot);
      else if (o.kind === 'wreck') place(wreck(), o.x, o.z, o.rot, { dy: -0.55, tilt: [0.05, 0.16] });
    }
  }
  syncStatics();
  game.on('project.done', () => {
    syncStations();
    syncStatics();
  });
  game.on('station.down', syncStations);
  game.on('station.up', syncStations);

  // 마을 앞 바닷가 부두와 길가 가로등·울타리(충돌 없는 장식)
  const t = region.settlements[0];
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

  // 숲머리: 길목 횃불 두 개와 숲 쪽 울타리
  const f = region.settlements[1];
  if (f) {
    const road = Math.atan2(t.x - f.x, t.z - f.z);
    for (const side of [-1, 1]) {
      const a = road + side * 0.32;
      place(torch(), f.x + Math.sin(a) * (f.radius - 2), f.z + Math.cos(a) * (f.radius - 2), 0);
    }
    place(fence(9.6), f.x - 15, f.z + 16, 0.15);
    place(fence(8), f.x + 8, f.z + 17.5, -0.2);
    place(fence(6.4), f.x + 17, f.z + 6, -1.35);
  }

  const windowMat = mats.window;
  const near = [];
  let pickT = 0;
  function update(time, night, dt, focus = null) {
    windowMat.emissiveIntensity = 2.2 * night;
    mats.glass.emissiveIntensity = 0.05 + 3.5 * night;
    mats.coal.emissiveIntensity = 1.4 + 0.6 * Math.sin(time * 3.1) * Math.sin(time * 1.7);
    for (const { l, max, flicker, always = 0 } of lights) {
      const k = Math.max(always, night);
      l.intensity = max * k * (flicker ? 0.82 + 0.18 * Math.sin(time * 13 + l.position.x) * Math.sin(time * 7.7) : 1);
    }
    // 불빛 풀: 0.3초마다 가장 가까운 불 자리를 고른다
    pickT -= dt;
    if (focus && pickT <= 0) {
      pickT = 0.3;
      near.length = 0;
      for (const sp of spots) {
        const d = (sp.p.x - focus.x) ** 2 + (sp.p.z - focus.z) ** 2;
        if (d < 60 * 60) near.push({ sp, d });
      }
      near.sort((x, y) => x.d - y.d);
      for (let i = 0; i < POOL; i++) {
        const sp = near[i]?.sp;
        pool[i].userData.sp = sp || null;
        if (sp) {
          pool[i].position.copy(sp.p);
          pool[i].distance = sp.range;
        }
      }
    }
    for (const pl of pool) {
      const sp = pl.userData.sp;
      if (!sp) {
        pl.intensity = 0;
        continue;
      }
      const k = Math.max(sp.always, night);
      pl.intensity = sp.max * k * (0.82 + 0.18 * Math.sin(time * 13 + sp.p.x) * Math.sin(time * 7.7));
    }
    if (beam) {
      beam.rotation.y = time * 0.5;
      beam.material.uniforms.uOpacity.value = 0.16 * night;
      beam.visible = night > 0.02;
    }
  }

  return { update, fires, smokes, glows };
}
