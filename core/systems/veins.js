// 산지 열기·닫기 (영맥 이동).
// 흔한 산지는 처음부터 끝까지 있다. 순환 산지는 수명이 다하면 닫히고 다른 곳에 새로 열린다.

import { rollProps, round1 } from '../formulas.js';

function pickPlace(ctx, region, nodeId) {
  const used = new Set(
    Object.values(ctx.state.veins)
      .filter((v) => v.region === region.id && v.node === nodeId && v.place)
      .map((v) => v.place),
  );
  const free = region.places.filter((p) => !used.has(p));
  return ctx.rng.pick(free.length ? free : region.places);
}

export function openVein(ctx, region, vc, { common = false, initial = false } = {}) {
  const { state, data, rng } = ctx;
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

  const [x0, z0, x1, z1] = region.bounds;
  const margin = 10;
  const s = region.settlement;
  const count = common ? vc.common : rng.int(vc.nodes[0], vc.nodes[1]);

  if (!common) {
    const r = rng.int(vc.radius[0], vc.radius[1]);
    let cx, cz;
    let tries = 0;
    do {
      cx = rng.range(x0 + margin + r, x1 - margin - r);
      cz = rng.range(z0 + margin + r, z1 - margin - r);
      tries++;
    } while (Math.hypot(cx - s.x, cz - s.z) < s.radius + 15 + r && tries < 30);
    vein.center = [round1(cx), round1(cz)];
    vein.radius = r;
  }

  for (let i = 0; i < count; i++) {
    let x, z;
    if (common) {
      let tries = 0;
      do {
        x = rng.range(x0 + margin, x1 - margin);
        z = rng.range(z0 + margin, z1 - margin);
        tries++;
      } while (Math.hypot(x - s.x, z - s.z) < s.radius + 10 && tries < 30);
    } else {
      const a = rng.range(0, Math.PI * 2);
      const rr = vein.radius * Math.sqrt(rng.next());
      x = vein.center[0] + Math.cos(a) * rr;
      z = vein.center[1] + Math.sin(a) * rr;
    }
    const id = ctx.newId('n');
    state.nodes[id] = {
      id, type: type.id, vein: veinId, x: round1(x), z: round1(z),
      charges: rng.int(type.charges[0], type.charges[1]), respawnAt: null,
    };
    vein.nodes.push(id);
  }

  state.veins[veinId] = vein;
  ctx.emit('vein.opened', { vein: veinId, name, item: item.id, props, closesOnDay, common });
  return vein;
}

export function closeVein(ctx, vein) {
  for (const id of vein.nodes) delete ctx.state.nodes[id];
  delete ctx.state.veins[vein.id];
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
