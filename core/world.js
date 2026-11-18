// 위치·정착지·도구 고르기처럼 여러 곳에서 쓰는 조회 함수.
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

// v0.0: 정착지 안(반경)에 있으면 그 정착지의 작업대를 모두 쓴다.
// 작업대 앞까지 걸어가는 판정은 3D 화면이 생기는 v0.1에서 넣는다.
export function stationFor(ctx, actor, type) {
  if (type === 'hand') return { type: 'hand', tier: 1 };
  const s = settlementAt(ctx, actor);
  if (!s) return null;
  return s.stations.find((st) => st.type === type) || null;
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
    const bd = ctx.data.items[best.item].tool.tier;
    const ed = def.tool.tier;
    if (ed > bd || (ed === bd && (e.stats.gatherSpeed > best.stats.gatherSpeed ||
      (e.stats.gatherSpeed === best.stats.gatherSpeed && e.uid < best.uid)))) best = e;
  }
  return best;
}

export const toolTier = (ctx, entry) => (entry ? ctx.data.items[entry.item].tool.tier : -1);
