// 산지 열기·닫기 (영맥 이동).
// 흔한 산지는 처음부터 끝까지 있다. 순환 산지는 수명이 다하면 닫히고 다른 곳에 새로 열린다.
// v0.1부터 노드는 지형의 서식지(높이 범위)에 맞춰 놓인다.

import { rollProps, round1 } from '../formulas.js';
import { fitsHabitat } from '../terrain.js';

function pickPlace(ctx, region, nodeId) {
  const used = new Set(
    Object.values(ctx.state.veins)
      .filter((v) => v.region === region.id && v.node === nodeId && v.place)
      .map((v) => v.place),
  );
  const free = region.places.filter((p) => !used.has(p));
  return ctx.rng.pick(free.length ? free : region.places);
}

// 해안 노드(type.shore = [바다 쪽, 뭍 쪽] m)는 해안선을 따라 고른다
function shoreSpot(rng, terrain, type, xMin, xMax) {
  const x = rng.range(xMin, xMax);
  return [x, terrain.shoreZ(x) + rng.range(type.shore[0], type.shore[1])];
}

// 순환 산지의 중심 고르기
export function pickCenter(rng, terrain, region, type, r) {
  const [x0, z0, x1, z1] = region.bounds;
  let fallback = null;
  for (let i = 0; i < 80; i++) {
    let cx = rng.range(x0 + 14 + r * 0.5, x1 - 14 - r * 0.5);
    let cz = rng.range(z0 + 4 + r * 0.5, z1 - 14 - r * 0.5);
    if (type.shore) [cx, cz] = shoreSpot(rng, terrain, type, x0 + 14 + r * 0.5, x1 - 14 - r * 0.5);
    if (!fitsHabitat(terrain, region, type, cx, cz)) continue;
    if (!fallback) fallback = [cx, cz];
    if (region.settlements.every((t) => Math.hypot(cx - t.x, cz - t.z) >= t.radius + 15 + r * 0.5)) return [round1(cx), round1(cz)];
  }
  return fallback ? [round1(fallback[0]), round1(fallback[1])] : null;
}

// 첫 무리는 상륙 지점 가까이에 둔다. 첫 목표(표류목·돌 줍기)와 첫 음식 재료가 눈에 보이게.
// v0.1.1에서 무리 짓기를 넣자 가장 가까운 돌이 75~190m 밖으로 밀려나 생긴 문제를 막는다.
// 상륙 지점 둘레에 서식지가 없으면(산딸기는 풀밭에만 자란다) 마을 바깥 둘레에서 찾는다.
function startCenter(rng, terrain, region, type, radius) {
  const [sx, sz] = terrain.beachPoint(region.spawn[0], region.spawn[1]);
  const t = region.settlements[0];
  const anchors = [[sx, sz, 0, radius], [t.x, t.z, t.radius + 8, t.radius + 8 + radius]];
  for (const [ax, az, r0, r1] of anchors) {
    for (let i = 0; i < 60; i++) {
      let x;
      let z;
      if (type.shore) {
        [x, z] = shoreSpot(rng, terrain, type, ax - r1, ax + r1);
      } else {
        const a = rng.range(0, Math.PI * 2);
        const rr = r0 + (r1 - r0) * Math.sqrt(rng.next());
        x = ax + Math.cos(a) * rr;
        z = az + Math.sin(a) * rr;
      }
      if (fitsHabitat(terrain, region, type, x, z)) return [round1(x), round1(z)];
    }
  }
  return null;
}

// 노드끼리 겹치지 않게 한다. 둘 다 단단하면(바위·나무) 사이로 지나갈 틈을 남긴다.
// 틈이 없으면 무리 사이에 갇히는 주머니가 생긴다(v0.1.1 페르소나 시험에서 발견).
export function makeSpacing(ctx) {
  const { state, data, cfg } = ctx;
  const gap = 2 * cfg.move.radius + 0.4;
  const list = [];
  for (const n of Object.values(state.nodes)) list.push({ x: n.x, z: n.z, r: data.nodes[n.type].solid || 0 });
  for (const s of Object.values(state.settlements)) {
    for (const st of s.stations) list.push({ x: st.x, z: st.z, r: data.stations[st.type].r || 0.8 });
  }
  for (const o of ctx.statics || []) if (o.r > 0) list.push({ x: o.x, z: o.z, r: o.r });
  const region = ctx.data.lists.regions[0];
  if (region.spawn && ctx.terrain) {
    const [sx, sz] = ctx.terrain.beachPoint(region.spawn[0], region.spawn[1]);
    list.push({ x: sx, z: sz, r: 1 }); // 상륙 지점 바로 위에는 놓지 않는다
  }
  return {
    ok(type, x, z) {
      const r = type.solid || 0;
      for (const o of list) {
        const need = r + o.r + (r > 0 && o.r > 0 ? gap : 0.7);
        const dx = x - o.x;
        const dz = z - o.z;
        if (dx * dx + dz * dz < need * need) return false;
      }
      return true;
    },
    add(type, x, z) {
      list.push({ x, z, r: type.solid || 0 });
    },
  };
}

// 노드 자리: 흔한 산지는 섬 전체에서, 순환 산지는 중심 둘레에서 서식지에 맞는 곳
export function pickNodeSpot(rng, terrain, region, type, center, radius, spacing = null) {
  const [x0, z0, x1, z1] = region.bounds;
  for (let i = 0; i < 40; i++) {
    let x;
    let z;
    if (type.shore) {
      [x, z] = center
        ? shoreSpot(rng, terrain, type, center[0] - radius, center[0] + radius)
        : shoreSpot(rng, terrain, type, x0 + 14, x1 - 14);
    } else if (center) {
      const a = rng.range(0, Math.PI * 2);
      const rr = radius * Math.sqrt(rng.next());
      x = center[0] + Math.cos(a) * rr;
      z = center[1] + Math.sin(a) * rr;
    } else {
      x = rng.range(x0 + 14, x1 - 14);
      z = rng.range(z0 + 2, z1 - 14);
    }
    if (!fitsHabitat(terrain, region, type, x, z)) continue;
    const rx = round1(x);
    const rz = round1(z);
    if (spacing && !spacing.ok(type, rx, rz)) continue;
    return [rx, rz];
  }
  return null;
}

export function openVein(ctx, region, vc, { common = false, initial = false } = {}) {
  const { state, data, rng, terrain } = ctx;
  const type = data.nodes[vc.node];
  const item = data.items[type.item];
  const dist = region.propDist;
  const day = ctx.clock.day(state.t);

  let props;
  if (common) {
    props = {};
    for (const p of item.props) props[p] = rng.int(dist.common[0], dist.common[1]);
  } else {
    props = rollProps(item.props, dist, rng);
  }

  const veinId = ctx.newId('v');
  const lotId = ctx.newId('L');
  const place = common ? null : pickPlace(ctx, region, type.id);
  const name = common ? `흔한 ${type.label} 산지` : `${place} ${type.label} 산지`;
  let closesOnDay = null;
  if (!common) closesOnDay = day + (initial ? rng.int(2, vc.life[1]) : rng.int(vc.life[0], vc.life[1]));

  state.lots[lotId] = { id: lotId, item: item.id, name, props, vein: veinId, mix: false };
  const vein = {
    id: veinId, region: region.id, node: type.id, item: item.id, lot: lotId,
    name, place, common, center: null, radius: null, closesOnDay, nodes: [],
  };

  const count = common ? vc.common : rng.int(vc.nodes[0], vc.nodes[1]);
  if (!common) {
    vein.radius = rng.int(vc.radius[0], vc.radius[1]);
    vein.center = pickCenter(rng, terrain, region, type, vein.radius);
  }
  // 흔한 산지도 숲·바위 지대처럼 무리 지어 놓는다 (cluster: [무리당 노드 수, 반경])
  let groups = null;
  if (common && vc.cluster) {
    const [size, r] = vc.cluster;
    groups = [];
    for (let k = 0; k < Math.ceil(count / size); k++) {
      const c = (k === 0 && vc.start && startCenter(rng, terrain, region, type, vc.start)) ||
        pickCenter(rng, terrain, region, type, r);
      if (c) groups.push({ c, r });
    }
    if (!groups.length) groups = null;
  }
  if (common || vein.center) {
    const spacing = makeSpacing(ctx);
    for (let i = 0; i < count; i++) {
      const g = groups ? groups[i % groups.length] : null;
      const spot = g
        ? pickNodeSpot(rng, terrain, region, type, g.c, g.r, spacing)
        : pickNodeSpot(rng, terrain, region, type, vein.center, vein.radius, spacing);
      if (!spot) continue;
      spacing.add(type, spot[0], spot[1]);
      const id = ctx.newId('n');
      state.nodes[id] = {
        id, type: type.id, vein: veinId, x: spot[0], z: spot[1],
        charges: rng.int(type.charges[0], type.charges[1]), respawnAt: null,
      };
      vein.nodes.push(id);
    }
  }

  state.veins[veinId] = vein;
  ctx.obstaclesDirty = true;
  ctx.emit('vein.opened', { vein: veinId, name, item: item.id, props, closesOnDay, common, nodes: vein.nodes.length });
  return vein;
}

export function closeVein(ctx, vein) {
  for (const id of vein.nodes) delete ctx.state.nodes[id];
  delete ctx.state.veins[vein.id];
  ctx.obstaclesDirty = true;
  ctx.emit('vein.closed', { vein: vein.id, name: vein.name, item: vein.item });
}

// 하루에 한 번: 수명이 다한 산지를 닫고 빈자리를 새 산지로 채운다.
export function dailyVeins(ctx) {
  const { state, data } = ctx;
  const day = ctx.clock.day(state.t);
  for (const region of data.lists.regions) {
    for (const vc of region.veins) {
      if (!vc.rotating) continue;
      const mine = () => Object.values(state.veins)
        .filter((v) => v.region === region.id && v.node === vc.node && !v.common);
      for (const v of mine()) if (v.closesOnDay <= day) closeVein(ctx, v);
      for (let i = mine().length; i < vc.rotating; i++) openVein(ctx, region, vc);
    }
  }
}
