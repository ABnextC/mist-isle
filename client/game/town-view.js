// 정착지 그리기: 작업대·집·등대·게시판·모닥불·난파선·부두·가로등, 숲머리(v0.4)의 천막·오두막·짓는 자리.
// 밤이 되면 창문과 불이 켜지고 등대 불빛이 돈다. 불·연기 자리는 fx에 넘긴다.
// 마을 사업이 끝나면(project.done) 짓는 자리를 걷고 작업대·건물을 세운다. 2단계 작업대엔 깃발을 단다.
// 모닥불·대장간·횃불 불빛은 점광원 두 개를 돌려 쓴다(가까운 곳에만 켠다. 광원 수가 늘면 모든 재질이 무거워진다).

import * as THREE from 'three';
import { STATIONS, house, lighthouse, board, market, campfire, wreck, pier, lampPost, fence, bake, tent, cabin, site, pennant, torch,
  banner, palisade, crates, watchtower, shipBlack, chest, supply, papers, altar, pillar, arch, mural, rubble, brazier } from './models/town.js';

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
uniform vec3 uColor;
varying float vAlong;
varying float vEdge;
void main() {
  float a = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.6) * (1.0 - smoothstep(0.55, 1.0, vEdge));
  gl_FragColor = vec4(uColor * a * uOpacity, 1.0);
}`;

export function createTownView(scene, game, hf, { mats, terrain, region, me = null }) {
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
    // 켜고 끌 수 있는 불(v0.5.1, 옛 화로): 불·불빛 자리를 무리에 달아 둔다
    group.userData.fires = [];
    group.userData.spots = [];
    for (const f of fx.fires) {
      const e = { p: toWorld(f.p), s: f.s, low: !!f.low, off: false };
      fires.push(e);
      group.userData.fires.push(e);
    }
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
          vertexShader: BEAM_V, fragmentShader: BEAM_F, uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.92, 0.7) } },
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
        }));
        beam.position.copy(p);
        scene.add(beam);
      } else {
        const sp = { p, range: l.kind === 'forge' ? 9 : l.kind === 'torch' ? 8 : 14, max: l.kind === 'forge' ? 6 : l.kind === 'torch' ? 4 : 10, always: l.kind === 'forge' ? 0.35 : 0.15, off: false };
        spots.push(sp);
        group.userData.spots.push(sp);
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
      // 검은 돛 약탈단 자리(v0.5)와 퀘스트 물체
      else if (o.kind === 'tent_black') place(tent(houseSeed++ * 31, 'sailBlack'), o.x, o.z, o.rot);
      else if (o.kind === 'tent_red') place(tent(77, 'clothRed'), o.x, o.z, o.rot);
      else if (o.kind === 'watchtower') place(watchtower(), o.x, o.z, o.rot);
      else if (o.kind === 'banner') place(banner(houseSeed++), o.x, o.z, o.rot);
      else if (o.kind === 'palisade') place(palisade(o.len || 8), o.x, o.z, o.rot);
      else if (o.kind === 'crates') place(crates(houseSeed++), o.x, o.z, o.rot);
      else if (o.kind === 'ship_black') place(shipBlack(), o.x, o.z, o.rot, { dy: -0.75, tilt: [0.03, 0.12] });
      else if (o.kind === 'chest') place(chest(houseSeed++), o.x, o.z, o.rot);
      else if (o.kind === 'supply') place(supply(), o.x, o.z, o.rot);
      else if (o.kind === 'papers') place(papers(), o.x, o.z, o.rot);
      // 2장(v0.5.1): 본토 배 난파 자리와 옛 등불터
      else if (o.kind === 'banner_blue') place(banner(houseSeed++, 'clothBlue', 'cloth'), o.x, o.z, o.rot);
      else if (o.kind === 'tent_white') place(tent(houseSeed++ * 31, 'cloth'), o.x, o.z, o.rot);
      else if (o.kind === 'altar') place(altar(), o.x, o.z, o.rot);
      else if (o.kind === 'pillar' || o.kind === 'pillar_broken' || o.kind === 'pillar_fallen') place(pillar(o.kind, houseSeed++), o.x, o.z, o.rot, { dy: -0.06 });
      else if (o.kind === 'arch') place(arch(), o.x, o.z, o.rot, { dy: -0.06 });
      else if (o.kind === 'mural') place(mural(), o.x, o.z, o.rot, { dy: -0.06 });
      else if (o.kind === 'rubble') place(rubble(houseSeed++), o.x, o.z, o.rot);
      else if (o.kind === 'brazier') {
        // 켠 것과 꺼진 것을 둘 다 놓고, 내 퀘스트 진행에 맞춰 하나만 보인다
        const on = place(brazier(true), o.x, o.z, o.rot);
        const off = place(brazier(false), o.x, o.z, o.rot);
        braziers.push({ obj: o.obj, on, off, lit: null });
      }
    }
  }
  const braziers = [];
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

  // 옛 화로: 내가 불을 넣었거나(쓴 물체) 그 퀘스트를 끝냈으면 켠다
  function litFor(a, obj) {
    const Q = a?.quests;
    if (!Q) return false;
    for (const q of game.data.lists.quests) {
      const i = q.steps.findIndex((st) => st.type === 'use' && st.objs.includes(obj));
      if (i < 0) continue;
      if (Q.done[q.id] != null) return true;
      const p = Q.active[q.id];
      if (p && (p.step > i || (p.step === i && p.used.includes(obj)))) return true;
    }
    return false;
  }
  function syncBraziers() {
    const a = me?.();
    for (const b of braziers) {
      const lit = litFor(a, b.obj);
      if (lit === b.lit) continue;
      b.lit = lit;
      b.on.visible = lit;
      b.off.visible = !lit;
      for (const f of b.on.userData.fires) f.off = !lit;
      for (const sp of b.on.userData.spots) sp.off = !lit;
    }
  }
  // 등대 불(v0.5.1): 1장 끝 ~ 2장 「다시 켜는 등불」 전에는 흐리고 깜빡인다. 새 등심을 끼우면 푸른 기가 도는 흰빛
  function beaconState(a) {
    const Q = a?.quests;
    if (!Q) return 'warm';
    if (Q.done.c2_rekindle != null) return 'blue';
    if (Q.done.q8_captain != null) return 'dim';
    return 'warm';
  }
  const BEAM_WARM = new THREE.Color(1.0, 0.92, 0.7);
  const BEAM_BLUE = new THREE.Color(0.78, 0.93, 1.0);
  const LENS_WARM = new THREE.Color(0xffc56a);
  const LENS_BLUE = new THREE.Color(0x8fdcff);
  let beacon = null;
  let syncT = 0;

  const windowMat = mats.window;
  const near = [];
  let pickT = 0;
  function update(time, night, dt, focus = null) {
    syncT -= dt;
    if (syncT <= 0) {
      syncT = 0.5;
      syncBraziers();
      const b = beaconState(me?.());
      if (b !== beacon) {
        beacon = b;
        mats.lens.emissive.copy(b === 'blue' ? LENS_BLUE : LENS_WARM);
        if (beam) beam.material.uniforms.uColor.value.copy(b === 'blue' ? BEAM_BLUE : BEAM_WARM);
      }
    }
    // 흐린 등불: 불빛이 숨을 죽였다 살아났다 한다
    const dimK = beacon === 'dim' ? 0.35 + 0.25 * Math.max(0, Math.sin(time * 0.9) * Math.sin(time * 2.3 + 1)) + (Math.sin(time * 17) > 0.93 ? -0.2 : 0) : 1;
    windowMat.emissiveIntensity = 2.2 * night;
    mats.glass.emissiveIntensity = 0.05 + 3.5 * night;
    mats.lens.emissiveIntensity = (0.05 + 3.5 * night) * dimK;
    mats.coal.emissiveIntensity = 1.4 + 0.6 * Math.sin(time * 3.1) * Math.sin(time * 1.7);
    for (const { l, max, flicker, always = 0 } of lights) {
      const k = Math.max(always, night);
      l.intensity = max * k * dimK * (flicker ? 0.82 + 0.18 * Math.sin(time * 13 + l.position.x) * Math.sin(time * 7.7) : 1);
    }
    // 불빛 풀: 0.3초마다 가장 가까운 불 자리를 고른다
    pickT -= dt;
    if (focus && pickT <= 0) {
      pickT = 0.3;
      near.length = 0;
      for (const sp of spots) {
        if (sp.off) continue;
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
      if (!sp || sp.off) {
        pl.intensity = 0;
        continue;
      }
      const k = Math.max(sp.always, night);
      pl.intensity = sp.max * k * (0.82 + 0.18 * Math.sin(time * 13 + sp.p.x) * Math.sin(time * 7.7));
    }
    if (beam) {
      beam.rotation.y = time * 0.5;
      beam.material.uniforms.uOpacity.value = 0.16 * night * dimK;
      beam.visible = night > 0.02;
    }
  }

  return { update, fires, smokes, glows };
}
