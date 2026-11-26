// 길잡이 돌(v3.2): 마을과 들판 쉼터에 선 돌. 처음 가까이 가면 길을 익히고(a.ways[id]),
// 익힌 돌 앞에서 다른 익힌 돌로 건너뛴다(시전 castSec, 은화). 움직이거나 맞으면 끊긴다.
// 안개 벽은 안쪽으로만 열려서 등대섬과 본섬 사이는 건너뛸 수 없다. 본섬의 다른 섬(능선·심장)은 건너뛸 수 있다(뱃삯 crossFee).
import { regionAt } from '../terrain.js';
import { feeMult } from './factions.js';
import { runOf } from './expeditions.js';
import { inCombat, dismount } from './mounts.js';

export const waysOf = (a) => (a.ways ||= {});
const TUTORIAL = 'wreck_coast'; // 안개 벽 바깥(돌아올 수 없는 섬)

export function wayStatic(ctx, id) {
  return ctx.statics.find((o) => o.way === id) || null;
}

// 돌 앞 빈자리: 마을(자리) 한가운데 쪽으로 1.8m
export function wayLanding(ctx, id) {
  const o = wayStatic(ctx, id);
  if (!o) return null;
  const w = ctx.data.waystones[id];
  const c = w.at ? ctx.data.settlements[w.at] : ctx.data.sites[w.site];
  const cx = c?.x ?? o.x;
  const cz = c?.z ?? o.z;
  let dx = cx - o.x;
  let dz = cz - o.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5 || !w.at) [dx, dz] = [0, -1];
  else [dx, dz] = [dx / d, dz / d];
  return { x: Math.round((o.x + dx * 1.8) * 1000) / 1000, z: Math.round((o.z + dz * 1.8) * 1000) / 1000 };
}

export function wayNear(ctx, a, range) {
  let best = null;
  for (const o of ctx.statics) {
    if (!o.way) continue;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d <= range + (o.r || 0) && (!best || d < best.d)) best = { way: o.way, d, o };
  }
  return best;
}

// 1초마다: 사람이 돌 가까이 오면 길을 익힌다
export function waystonesTick(ctx) {
  const R = ctx.cfg.fastTravel.attuneRange;
  for (const a of Object.values(ctx.state.actors)) {
    if (a.kind !== 'player') continue;
    const near = wayNear(ctx, a, R);
    if (!near) continue;
    const W = waysOf(a);
    if (W[near.way]) continue;
    W[near.way] = Math.round(ctx.state.t);
    ctx.emit('way.found', { actor: a.id, way: near.way });
  }
}

const crossing = (ctx, a, w) => regionAt(ctx.data.lists.regions, a.x).id !== w.region;

export function travelCost(ctx, a, to) {
  const F = ctx.cfg.fastTravel;
  const w = ctx.data.waystones[to];
  const o = wayStatic(ctx, to);
  if (!w || !o) return null;
  const cross = crossing(ctx, a, w);
  let c = F.base + (cross ? F.crossFee : F.perM * Math.hypot(o.x - a.x, o.z - a.z));
  if (w.at && w.at === a.home) c *= F.homeMult; // 귀환 지점 마을로는 반값
  c *= feeMult(ctx, a, 'ship'); // 뱃사공 단짝·선단 혜택
  return Math.max(1, Math.round(c));
}

export function travelError(ctx, a, to) {
  const F = ctx.cfg.fastTravel;
  const w = ctx.data.waystones[to];
  if (!w || !wayStatic(ctx, to)) return 'bad_args';
  if (!waysOf(a)[to]) return 'unknown_way';
  if (a.action) return 'busy';
  if (a.cb?.downUntil > 0) return 'down';
  if (runOf(ctx, a)) return 'in_expedition';
  if (inCombat(ctx, a, F.combatLockSec)) return 'in_combat';
  const here = wayNear(ctx, a, F.useRange);
  if (!here) return 'too_far';
  if (here.way === to) return 'same_place';
  const from = regionAt(ctx.data.lists.regions, a.x).id;
  if ((from === TUTORIAL) !== (w.region === TUTORIAL)) return 'mist_wall';
  if (a.silver < travelCost(ctx, a, to)) return 'no_silver';
  return null;
}

export function startTravel(ctx, a, to) {
  dismount(ctx, a, 'travel');
  a.dest = a.nav = a.move = null;
  const t = ctx.state.t;
  const cost = travelCost(ctx, a, to);
  a.action = { type: 'travel', to, cost, startedAt: t, endsAt: Math.round((t + ctx.cfg.fastTravel.castSec) * 100) / 100 };
  ctx.emit('travel.started', { actor: a.id, to, cost });
}

export function finishTravel(ctx, a) {
  const { to } = a.action;
  a.action = null;
  // 시전하는 사이 은화가 모자라졌으면 그만둔다
  const cost = travelCost(ctx, a, to);
  if (cost == null || a.silver < cost) {
    ctx.emit('travel.cancelled', { actor: a.id, reason: 'no_silver' });
    return;
  }
  const w = ctx.data.waystones[to];
  const from = regionAt(ctx.data.lists.regions, a.x).id;
  const p = wayLanding(ctx, to);
  a.silver -= cost;
  const ox = a.x;
  const oz = a.z;
  Object.assign(a, { x: p.x, z: p.z, move: null, dest: null, nav: null, stuck: 0 });
  // 동행(v1.7)도 같이 건너뛴다
  for (const al of Object.values(ctx.state.actors)) {
    if (al.kind !== 'ally' || al.ally?.owner !== a.id) continue;
    if (Math.hypot(al.x - ox, al.z - oz) > 40) continue;
    Object.assign(al, { x: Math.round((p.x + 1.2) * 1000) / 1000, z: Math.round((p.z - 1) * 1000) / 1000, move: null, dest: null, nav: null });
  }
  a.stats.travels = (a.stats.travels || 0) + 1;
  ctx.emit('travel.done', { actor: a.id, to, cost, from, region: w.region });
  // 다른 섬이면 화면이 새 섬을 그리게 한다(배와 같은 길)
  if (from !== w.region) ctx.emit('cross', { actor: a.id, from, to: w.region, moved: 0, orders: 0, ferry: true, travel: true });
}

// 지도에 그릴 돌 목록(익힌 것과 아닌 것)
export function wayList(ctx, a) {
  const W = waysOf(a);
  return ctx.data.lists.waystones.map((w) => {
    const o = wayStatic(ctx, w.id);
    return { ...w, x: o?.x ?? 0, z: o?.z ?? 0, known: !!W[w.id], cost: W[w.id] ? travelCost(ctx, a, w.id) : null };
  });
}
