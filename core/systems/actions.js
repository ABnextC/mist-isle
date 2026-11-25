// 이동(30Hz)과 채집 행동 진행.
// 이동은 두 가지다: 입력 방향(actor.move, 플레이어 조작)과 목적지(actor.dest, 봇·클릭 이동).

import { seasonYield } from './calendar.js';
import { jewelGather } from './level.js';
import { pvpBonus } from './pvp.js';
import { seedYield } from './territory.js';
import { extraChance } from './factions.js';
import { addEntry, slotsNeeded } from '../inventory.js';
import { rollQty, skillYieldBonus, round3 } from '../formulas.js';
import { addXp } from './progress.js';
import { combatMove, equipLoad } from './combat.js';
import { finishSkin } from './mobs.js';

// 지형 밖·깊은 물·장애물을 피해 최종 위치를 정한다.
export function resolve(ctx, a, nx, nz) {
  const terrain = ctx.terrain;
  if (!terrain.walkable(nx, nz)) {
    if (terrain.walkable(nx, a.z)) nz = a.z;
    else if (terrain.walkable(a.x, nz)) nx = a.x;
    else return [a.x, a.z];
  }
  const R = ctx.cfg.move.radius;
  for (const o of ctx.obstacles.near(nx, nz)) {
    const dx = nx - o.x;
    const dz = nz - o.z;
    const d = Math.hypot(dx, dz);
    const min = R + o.r;
    if (d < min && d > 1e-6) {
      nx = o.x + (dx / d) * min;
      nz = o.z + (dz / d) * min;
    }
  }
  if (!terrain.walkable(nx, nz)) return [a.x, a.z];
  return [nx, nz];
}

// 목적지로 갈 때 앞이 막히면 막힌 쪽을 따라 돌아간다(벽 타기).
// 각도는 cos·sin 상수표로 돌린다. 어느 JS 엔진에서도 같은 값이 나와야 멀티플레이 재현이 맞는다.
const TURNS = [[0.81915, 0.57358], [0.34202, 0.93969], [-0.25882, 0.96593], [-0.76604, 0.64279]]; // 35·70·105·140°

function tryDir(ctx, a, ux, uz, c, s, sd, len) {
  const vx = ux * c - uz * s * sd;
  const vz = ux * s * sd + uz * c;
  const [x, z] = resolve(ctx, a, a.x + vx * len, a.z + vz * len);
  if (Math.hypot(x - a.x, z - a.z) < len * 0.6) return null;
  return [x, z, vx, vz, (x - a.x) * ux + (z - a.z) * uz];
}

function steer(ctx, a, nav, ux, uz, len) {
  const [sx, sz] = resolve(ctx, a, a.x + ux * len, a.z + uz * len);
  if ((sx - a.x) * ux + (sz - a.z) * uz >= len * 0.7) {
    nav.side = 0;
    return [sx, sz, ux, uz];
  }
  if (nav.side) {
    // 정한 쪽으로 계속 돈다. 그쪽이 다 막혔으면 반대쪽으로 바꾼다.
    for (const sd of [nav.side, -nav.side]) {
      for (const [c, s] of TURNS) {
        const r = tryDir(ctx, a, ux, uz, c, s, sd, len);
        if (r) {
          nav.side = sd;
          return r;
        }
      }
    }
  } else {
    for (const [c, s] of TURNS) {
      const p = tryDir(ctx, a, ux, uz, c, s, 1, len);
      const m = tryDir(ctx, a, ux, uz, c, s, -1, len);
      const pick = p && m ? (p[4] >= m[4] ? p : m) : p || m;
      if (pick) {
        nav.side = pick === p ? 1 : -1;
        return pick;
      }
    }
  }
  return [sx, sz, ux, uz];
}

export function movementTick(ctx, dt) {
  const { state, cfg } = ctx;
  for (const a of Object.values(state.actors)) {
    const cm = combatMove(ctx, a);
    if (cm.lock) continue;
    if (cm.dodge) {
      const [nx, nz] = resolve(ctx, a, a.x + cm.dodge[0] * dt, a.z + cm.dodge[1] * dt);
      a.x = round3(nx);
      a.z = round3(nz);
      continue;
    }
    const step = cfg.move.speed * dt * cm.mult * equipLoad(ctx, a).tier.move;
    if (a.move) {
      const [nx, nz] = resolve(ctx, a, a.x + a.move[0] * step, a.z + a.move[1] * step);
      a.yaw = round3(Math.atan2(a.move[0], a.move[1]));
      a.x = round3(nx);
      a.z = round3(nz);
      continue;
    }
    if (!a.dest) continue;
    const dx = a.dest[0] - a.x;
    const dz = a.dest[1] - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) {
      a.dest = null;
      a.stuck = 0;
      a.nav = null;
      continue;
    }
    const nav = a.nav || (a.nav = { near: null, side: 0 });
    const [nx, nz, vx, vz] = steer(ctx, a, nav, dx / d, dz / d, Math.min(step, d));
    a.yaw = round3(Math.atan2(vx, vz));
    a.x = round3(nx);
    a.z = round3(nz);
    // 3초 동안 목적지에 더 가까워지지 못하면 멈춘다
    const nd = Math.hypot(a.dest[0] - a.x, a.dest[1] - a.z);
    if (nav.near == null || nd < nav.near - 0.05) {
      nav.near = round3(nd);
      a.stuck = 0;
    } else {
      a.stuck = round3((a.stuck || 0) + dt);
      if (a.stuck > 3) {
        const dest = a.dest;
        a.dest = null;
        a.stuck = 0;
        a.nav = null;
        ctx.emit('move.blocked', { actor: a.id, x: a.x, z: a.z, dest });
      }
    }
  }
}

export function actionsTick(ctx) {
  for (const a of Object.values(ctx.state.actors)) {
    if (!a.action || a.action.endsAt > ctx.state.t) continue;
    if (a.action.type === 'recall') resolveRecall(ctx, a);
    else if (a.action.type === 'skin') finishSkin(ctx, a);
    else resolveGather(ctx, a);
  }
}

// 귀환: 시전이 끝나면 귀환 지점 마을의 창고 앞으로 옮겨진다
function resolveRecall(ctx, actor) {
  const s = ctx.state.settlements[actor.action.settlement];
  actor.action = null;
  const storage = s.stations.find((st) => st.type === 'storage') || s;
  actor.x = round3(storage.x + 2.2);
  actor.z = round3(storage.z);
  actor.dest = null;
  actor.nav = null;
  actor.move = null;
  actor.recallReadyAt = ctx.state.t + ctx.cfg.recall.cooldownSec;
  ctx.emit('recall.done', { actor: actor.id, settlement: s.id });
}

function resolveGather(ctx, actor) {
  const { state, data, cfg, rng } = ctx;
  const act = actor.action;
  actor.action = null;

  const fail = (reason) => {
    if (act.focus) actor.focus += cfg.focus.cost.gather; // 쓴 집중력은 돌려준다
    ctx.emit('gather.failed', { actor: actor.id, node: act.node, reason });
  };

  const node = state.nodes[act.node];
  if (!node) return fail('node_gone');
  if (node.charges <= 0) return fail('node_empty');
  let tool = null;
  if (act.tool) {
    tool = actor.bag.find((e) => e.uid === act.tool);
    if (!tool || tool.broken) return fail('no_tool');
  }

  const type = data.nodes[node.type];
  const item = data.items[type.item];
  const vein = state.veins[node.vein];
  const skill = actor.skills[type.skill];
  const buff = actor.buffs.find((b) => b.type === 'gatherYield');
  // 계절(v1.8): 많이 나는 철과 덜 나는 철
  const mult = (1 + skillYieldBonus(skill.level, type.level, cfg) + (tool?.stats.yield ?? 0) + (buff ? buff.value : 0) + jewelGather(ctx, actor) + pvpBonus(ctx, actor) + seedYield(ctx, actor)) * (ctx.clock ? seasonYield(ctx, item.id) : 1);
  const base = rng.int(type.yield[0], type.yield[1]);
  // 세력 혜택(v0.7): 확률로 하나 더
  const fx = extraChance(ctx, actor, 'gather', type.skill);
  const qty = Math.max(1, rollQty(base * mult, rng)) + (fx > 0 && rng.next() < fx ? 1 : 0);
  const main = { item: item.id, lot: vein.lot, bonus: null, qty };

  const extras = [];
  for (const bp of type.byproducts || []) {
    if (rng.chance(bp.chance * (act.focus ? 2 : 1))) extras.push({ item: bp.item, lot: null, bonus: null, qty: 1 });
  }

  if (actor.bag.length + slotsNeeded(actor.bag, [main]) > cfg.bag.slots) return fail('bag_full');

  // 여기부터는 실패하지 않는다.
  addEntry(actor.bag, main);
  const kept = [];
  for (const e of extras) {
    if (actor.bag.length + slotsNeeded(actor.bag, [e]) <= cfg.bag.slots) {
      addEntry(actor.bag, e);
      kept.push({ item: e.item, qty: 1 });
    }
  }

  node.charges -= 1;
  const region = state.regions[vein.region];
  const fam = item.family;
  if (fam && region.density[fam] != null) {
    region.density[fam] = Math.max(cfg.density.floor, round3(region.density[fam] - cfg.density.perGather));
  }
  if (node.charges <= 0) {
    const f = Math.max(cfg.density.minFactor, fam ? region.density[fam] : 1);
    node.respawnAt = state.t + Math.round(type.respawnSec / f);
  }

  if (tool) {
    tool.dur -= 1;
    if (tool.dur <= 0) {
      tool.dur = 0;
      tool.broken = true;
      ctx.emit('tool.broken', { actor: actor.id, item: tool.item, uid: tool.uid });
    }
  }

  if (act.focus) actor.stats.focusUsed += cfg.focus.cost.gather;
  actor.stats.gather[type.skill] = (actor.stats.gather[type.skill] || 0) + 1;
  addXp(ctx, actor, type.skill, type.xp);
  ctx.emit('gather.done', {
    actor: actor.id, node: node.id, nodeType: type.id, skill: type.skill,
    item: item.id, lot: vein.lot, qty, byproducts: kept, xp: type.xp,
  });
}
