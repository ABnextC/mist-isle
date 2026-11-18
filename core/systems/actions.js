// 이동과 채집 행동 진행.

import { addEntry, slotsNeeded } from '../inventory.js';
import { rollQty, skillYieldBonus, round2, round3 } from '../formulas.js';
import { addXp } from './progress.js';

export function movementTick(ctx) {
  const step = ctx.cfg.move.speed; // 1틱(1초)에 가는 거리
  for (const a of Object.values(ctx.state.actors)) {
    if (!a.dest) continue;
    const dx = a.dest[0] - a.x;
    const dz = a.dest[1] - a.z;
    const d = Math.hypot(dx, dz);
    if (d <= step) {
      a.x = a.dest[0];
      a.z = a.dest[1];
      a.dest = null;
    } else {
      a.x = round2(a.x + (dx / d) * step);
      a.z = round2(a.z + (dz / d) * step);
    }
  }
}

export function actionsTick(ctx) {
  for (const a of Object.values(ctx.state.actors)) {
    if (a.action && a.action.endsAt <= ctx.state.t) resolveGather(ctx, a);
  }
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
  const mult = 1 + skillYieldBonus(skill.level, type.level, cfg) + (tool?.stats.yield ?? 0) + (buff ? buff.value : 0);
  const base = rng.int(type.yield[0], type.yield[1]);
  const qty = Math.max(1, rollQty(base * mult, rng));
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
