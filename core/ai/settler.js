// 개척민 기본형 AI.
// 플레이어와 똑같이 명령(ctx.command)으로만 움직인다. 기억은 actor.ai.mem(상태 안)에 둔다.
// 흐름: 채집 → 가방이 차면 귀환 → 창고에 넣기 → 정제·제작 → 다시 채집
// v0.0에서는 엔진 점검용이다. 3단계 페르소나 봇은 이 위에 성향 값을 얹는다.

import { keyOf, avgProps, countItem } from '../inventory.js';
import { dist, settlementAt, nearestSettlement, bestTool, toolTier } from '../world.js';

const REFINES = ['rc_ingot_copper', 'rc_lumber_birch', 'rc_lumber_drift', 'rc_cloth_reed'];

export function thinkSettler(ctx, actor) {
  const prof = ctx.data.agents[actor.ai.profile] || ctx.data.agents.settler;
  const mem = actor.ai.mem;
  if (!mem.mode) Object.assign(mem, { mode: 'gather', skill: null, streak: 0, rounds: 0, misses: 0 });
  if (actor.action || actor.dest) return;
  if (mem.mode === 'gather') return gatherStep(ctx, actor, prof, mem);
  if (mem.mode === 'return') return returnStep(ctx, actor, mem);
  if (mem.mode === 'craft') return craftStep(ctx, actor, prof, mem);
}

function goHome(ctx, actor) {
  const s = nearestSettlement(ctx, actor);
  ctx.command({ type: 'MOVE', actor: actor.id, x: s.x, z: s.z });
}

function rawCount(ctx, actor) {
  let n = 0;
  for (const e of actor.bag) if (!e.uid && ctx.data.items[e.item].stage === 'raw') n += e.qty;
  return n;
}

function lowestSkill(actor, skills) {
  let best = skills[0];
  for (const s of skills) {
    const a = actor.skills[s];
    const b = actor.skills[best];
    if (a.level < b.level || (a.level === b.level && a.xp < b.xp)) best = s;
  }
  return best;
}

function chooseNode(ctx, actor, skill) {
  const { state, data } = ctx;
  const tool = bestTool(ctx, actor, skill);
  const level = actor.skills[skill].level;
  const lists = [actor.bag, actor.storage];
  let best = null;
  let bestScore = Infinity;
  for (const node of Object.values(state.nodes)) {
    if (node.charges <= 0) continue;
    const type = data.nodes[node.type];
    if (type.skill !== skill || type.level > level) continue;
    if (!tool && type.tier > 0) continue;
    const lot = state.lots[state.veins[node.vein].lot];
    let score = dist(actor, node) - type.tier * 60 - (avgProps(lot.props) - 40);
    if (countItem(lists, type.item) < 12) score -= 40; // 모자란 재료 우선
    if (score < bestScore) {
      bestScore = score;
      best = { node, type };
    }
  }
  return best;
}

function gatherStep(ctx, actor, prof, mem) {
  const { cfg, data } = ctx;
  if (rawCount(ctx, actor) >= prof.trip || cfg.bag.slots - actor.bag.length <= 3) {
    mem.mode = 'return';
    goHome(ctx, actor);
    return;
  }
  if (!actor.buffs.some((b) => b.type === 'gatherYield')) {
    const food = actor.bag.find((e) => !e.uid && data.items[e.item].kind === 'consumable');
    if (food) {
      ctx.command({ type: 'EAT', actor: actor.id, key: keyOf(food) });
      return;
    }
  }
  if (!mem.skill || mem.streak >= prof.streak) {
    mem.skill = lowestSkill(actor, prof.skills);
    mem.streak = 0;
  }
  const target = chooseNode(ctx, actor, mem.skill);
  if (!target) {
    // 이 스킬로 캘 곳이 없으면 다른 스킬로. 계속 없으면 귀환.
    mem.skill = prof.skills[(prof.skills.indexOf(mem.skill) + 1) % prof.skills.length];
    mem.streak = 0;
    if (++mem.misses > prof.skills.length) {
      mem.misses = 0;
      mem.mode = 'return';
      goHome(ctx, actor);
    }
    return;
  }
  mem.misses = 0;
  if (dist(actor, target.node) <= cfg.gather.rangeM) {
    const useFocus = prof.useFocus && (target.type.byproducts || []).length > 0 &&
      actor.focus >= prof.focusReserve + cfg.focus.cost.gather;
    const r = ctx.command({ type: 'GATHER', actor: actor.id, node: target.node.id, focus: useFocus });
    if (r.ok) mem.streak++;
    else mem.streak = prof.streak;
  } else {
    ctx.command({ type: 'MOVE', actor: actor.id, x: target.node.x, z: target.node.z });
  }
}

function returnStep(ctx, actor, mem) {
  if (!settlementAt(ctx, actor)) {
    goHome(ctx, actor);
    return;
  }
  ctx.command({ type: 'STORE', actor: actor.id, all: true });
  // 부서졌거나 더 좋은 도구에 밀린 도구도 창고로
  for (const e of [...actor.bag]) {
    if (!e.uid) continue;
    const def = ctx.data.items[e.item];
    if (!def.tool) continue;
    if (e.broken || bestTool(ctx, actor, def.tool.skill) !== e) ctx.command({ type: 'STORE', actor: actor.id, key: e.uid });
  }
  mem.mode = 'craft';
  mem.rounds = 0;
}

function craftStep(ctx, actor, prof, mem) {
  const { data, cfg } = ctx;
  if (actor.queue.length) return; // 대기열이 빌 때까지 기다린다
  if (mem.rounds >= 3) {
    mem.mode = 'gather';
    return;
  }
  mem.rounds++;
  const lists = [actor.bag, actor.storage];
  const count = (id) => countItem(lists, id);
  const room = () => actor.queue.length < cfg.craft.queueMax;
  let queued = 0;
  const tryCraft = (cmd) => {
    if (!room()) return false;
    const full = { actor: actor.id, type: 'CRAFT', auto: 'best', ...cmd };
    if (!ctx.check(full).ok) return false;
    const ok = ctx.command(full).ok;
    if (ok) queued++;
    return ok;
  };
  const focusOk = (cost) => prof.useFocus && actor.focus >= prof.focusReserve + cost;

  // 1) 도구: 구리 도구가 없으면 만들고, 아무것도 없으면 돌 도구
  for (const skill of prof.skills) {
    const tier = toolTier(ctx, bestTool(ctx, actor, skill));
    if (tier < 1 && tryCraft({ recipe: prof.tools[skill][1] })) continue;
    if (tier < 0) tryCraft({ recipe: prof.tools[skill][0] });
  }

  // 2) 정제 (돌 도구 재료는 조금 남긴다)
  for (const id of REFINES) {
    const r = data.recipes[id];
    const input = r.slots[0].item;
    const keep = prof.keep[input] || 0;
    let n = 0;
    while (n < 6 && room() && count(input) - r.slots[0].qty >= keep &&
      tryCraft({ recipe: id, catalyst: 'auto', focus: focusOk(cfg.focus.cost.refine) })) n++;
  }

  // 3) 음식
  let foods = 0;
  for (const e of actor.bag) if (!e.uid && data.items[e.item].kind === 'consumable') foods += e.qty;
  if (foods < prof.foodTarget) {
    if (!tryCraft({ recipe: 'rc_soup' })) tryCraft({ recipe: 'rc_dried_berry' });
  }

  // 4) 숙련용 제작: 대장 레벨이 구리 도구에 못 미치면 못부터
  const copperLevel = data.recipes[prof.tools[prof.skills[0]][1]].level;
  if (actor.skills.smithing.level < copperLevel) {
    for (let i = 0; i < 3; i++) tryCraft({ recipe: 'rc_nails_copper' });
  } else if (count('ingot_copper') > 9 && count('nails_copper') < 12) {
    tryCraft({ recipe: 'rc_nails_copper' });
  }
  if (count('lumber_drift') >= 4 && count('stake_wood') < 40) tryCraft({ recipe: 'rc_stake_wood', auto: 'cheap' });
  if (count('nails_copper') >= 6 && count('crate_wood') < 4) tryCraft({ recipe: 'rc_crate' });

  if (!queued) mem.mode = 'gather';
}
