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
// built: 끝난 마을 사업 id 모음. 사업으로 짓는 건물(build)은 끝난 뒤에만 들어간다.
export function layoutStatics(region, terrain, built = null) {
  const out = [];
  for (const s of region.settlements) {
    for (const st of s.structures || []) {
      if (st.build && !(built && built.has(st.build))) continue;
      out.push({ kind: st.kind, x: s.x + st.dx, z: s.z + st.dz, r: st.r, rot: st.rot || 0, at: s.id, build: st.build || null });
    }
  }
  for (const d of region.decor || []) {
    const [x, z] = terrain.beachPoint(d.x, d.inland);
    out.push({ kind: d.kind, x, z, r: d.r, rot: d.rot || 0 });
  }
  return out;
}

// 처음부터 있는 작업대. 마을 사업으로 짓는 작업대(build)는 빠진다.
export function stationLayout(sdef) {
  return sdef.stations.filter((st) => !st.build).map((st) => stationAt(sdef, st));
}

export function stationAt(sdef, st, tier = st.tier ?? 1) {
  return { type: st.type, tier, base: tier, x: sdef.x + st.dx, z: sdef.z + st.dz, rot: st.rot || 0 };
}

// 작업대 좌표(모형 기준, 회전 전) → 월드. 화면의 rotation.y와 같은 방향으로 돈다.
export function stationPoint(st, lx, lz) {
  const c = Math.cos(st.rot || 0);
  const s = Math.sin(st.rot || 0);
  return [st.x + lx * c + lz * s, st.z - lx * s + lz * c];
}

// 몸이 못 들어가는 원들(v0.4.9). 모양대로 여러 원을 두어 탁자 앞에 바짝 설 수 있게 한다.
export function stationSolids(data, st) {
  const def = data.stations[st.type];
  if (!def.solid) return [{ x: st.x, z: st.z, r: def.r || 0.8 }];
  return def.solid.map(([lx, lz, r]) => {
    const [x, z] = stationPoint(st, lx, lz);
    return { x, z, r };
  });
}

// 일하는 자리(v0.4.9): 선 곳과 바라보는 점. 작업 동작이 작업면에 닿도록 작업대마다 정했다.
export function workSpots(data, st) {
  const def = data.stations[st.type];
  return (def.work || []).map(([lx, lz, fx, fz]) => {
    const [x, z] = stationPoint(st, lx, lz);
    const [ax, az] = stationPoint(st, fx, fz);
    return { x, z, ax, az };
  });
}

// 끝난 마을 사업 id 모음(상태에서 읽는다)
export function builtSet(state) {
  return new Set(Object.values(state.projects || {}).filter((p) => p.done).map((p) => p.id));
}

// 기여 명성 단계(v0.4): 그 마을에서 받는 수수료·운송비 할인
export function standingTier(ctx, actor, sid) {
  const pts = actor?.standing?.[sid] || 0;
  let tier = ctx.cfg.settle.standing[0];
  for (const t of ctx.cfg.settle.standing) if (pts >= t.min) tier = t;
  return tier;
}

// ── 창고(v0.4: 정착지마다 따로) ─────────────────────────
export function storeOf(actor, sid) {
  if (!actor.storages) actor.storages = {};
  return actor.storages[sid] || (actor.storages[sid] = []);
}

// 지금 서 있는 마을의 창고. 마을 밖이면 null
export function localStore(ctx, actor) {
  const s = settlementAt(ctx, actor);
  return s ? storeOf(actor, s.id) : null;
}

// 가방 + (마을 안이면) 그 마을 창고
export function reachable(ctx, actor) {
  const st = localStore(ctx, actor);
  return st ? [actor.bag, st] : [actor.bag];
}

// 그 마을에 그 종류 작업대가 있는가(티어 이상)
export function hasStation(s, type, tier = 1) {
  return s.stations.some((st) => st.type === type && st.tier >= tier);
}

export function stationIn(s, type) {
  return s.stations.find((st) => st.type === type) || null;
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
    for (const st of s.stations) for (const o of stationSolids(ctx.data, st)) add(o.x, o.z, o.r);
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
