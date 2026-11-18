// 위치·정착지·도구·장애물처럼 여러 곳에서 쓰는 조회 함수.
// 상태를 읽기만 한다.

export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function settlementAt(ctx, actor) {
  for (const s of Object.values(ctx.state.settlements)) if (dist(actor, s) <= s.radius) return s;
  return null;
}

export function nearestSettlement(ctx, actor) {
  let best = null;
  let bd = Infinity;
  for (const s of Object.values(ctx.state.settlements)) {
    const d = dist(actor, s);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

// 작업대 앞(config.craft.rangeM 안)에 있어야 제작할 수 있다. 맨손 제작은 어디서나.
export function stationFor(ctx, actor, type) {
  if (type === 'hand') return { type: 'hand', tier: 1 };
  const range = ctx.cfg.craft.rangeM;
  for (const s of Object.values(ctx.state.settlements)) {
    for (const st of s.stations) if (st.type === type && dist(actor, st) <= range) return st;
  }
  return null;
}

export function nearestStation(ctx, actor, type) {
  let best = null;
  let bd = Infinity;
  for (const s of Object.values(ctx.state.settlements)) {
    for (const st of s.stations) {
      if (st.type !== type) continue;
      const d = dist(actor, st);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
  }
  return best;
}

// 그 스킬에 쓸 가장 좋은 도구: 티어 → 속도 → uid 순
export function bestTool(ctx, actor, skill) {
  let best = null;
  for (const e of actor.bag) {
    if (!e.uid || e.broken) continue;
    const def = ctx.data.items[e.item];
    if (!def.tool || def.tool.skill !== skill) continue;
    if (!best) {
      best = e;
      continue;
    }
    const bt = ctx.data.items[best.item].tool.tier;
    const et = def.tool.tier;
    if (et > bt || (et === bt && (e.stats.gatherSpeed > best.stats.gatherSpeed ||
      (e.stats.gatherSpeed === best.stats.gatherSpeed && e.uid < best.uid)))) best = e;
  }
  return best;
}

export const toolTier = (ctx, entry) => (entry ? ctx.data.items[entry.item].tool.tier : -1);

// 정착지 건물·장식처럼 움직이지 않는 것들의 자리. 화면과 충돌 판정이 같이 쓴다.
export function layoutStatics(region, terrain) {
  const out = [];
  const s = region.settlement;
  for (const st of s.structures || []) {
    out.push({ kind: st.kind, x: s.x + st.dx, z: s.z + st.dz, r: st.r, rot: st.rot || 0 });
  }
  for (const d of region.decor || []) {
    const [x, z] = terrain.beachPoint(d.x, d.inland);
    out.push({ kind: d.kind, x, z, r: d.r, rot: d.rot || 0 });
  }
  return out;
}

export function stationLayout(region) {
  const s = region.settlement;
  return s.stations.map((st) => ({ type: st.type, tier: st.tier ?? 1, x: s.x + st.dx, z: s.z + st.dz, rot: st.rot || 0 }));
}

// 원형 장애물 격자. 노드가 바뀌면 다시 만든다(상태가 아니라 상태에서 나온 값이다).
export function buildObstacles(ctx) {
  const cell = 8;
  const grid = new Map();
  const add = (x, z, r) => {
    const k = Math.floor(x / cell) + ',' + Math.floor(z / cell);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push({ x, z, r });
  };
  for (const n of Object.values(ctx.state.nodes)) {
    const r = ctx.data.nodes[n.type].solid || 0;
    if (r > 0) add(n.x, n.z, r);
  }
  for (const s of Object.values(ctx.state.settlements)) {
    for (const st of s.stations) add(st.x, st.z, ctx.data.stations[st.type].r || 0.8);
  }
  for (const o of ctx.statics) if (o.r > 0) add(o.x, o.z, o.r);
  return {
    near(x, z) {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      const out = [];
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const arr = grid.get((cx + i) + ',' + (cz + j));
          if (arr) for (const o of arr) out.push(o);
        }
      }
      return out;
    },
  };
}
