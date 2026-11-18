// 개척민 AI (기본형 + 페르소나 성향).
// 플레이어와 똑같이 명령(ctx.command)으로만 움직인다. 기억은 actor.ai.mem(상태 안, 순수 데이터)에 둔다.
// 흐름: 채집 → 가방이 차면 귀환 → 창고에 넣기 → 작업대마다 걸어가 정제·제작 → 다시 채집
//
// 성향 값 (data/agents.json)
//   thinkEvery  판단 간격(초). 반응이 느릴수록 크다
//   quality     속성 1점에 몇 m를 더 걸을 의향이 있는가
//   explore     처음 보는 순환 산지에 주는 가산(m)
//   detour      가장 좋은 노드 대신 엉뚱한 노드를 고를 확률(실수)
//   tune        도구를 만들 때 집중력으로 조율하는가

import { keyOf, avgProps, countItem } from '../inventory.js';
import { dist, settlementAt, nearestSettlement, nearestStation, bestTool, toolTier } from '../world.js';

const REFINES = ['rc_ingot_copper', 'rc_lumber_birch', 'rc_lumber_drift', 'rc_cloth_reed'];

export function thinkSettler(ctx, actor) {
  const prof = ctx.data.agents[actor.ai.profile] || ctx.data.agents.settler;
  const mem = actor.ai.mem;
  const t = ctx.state.t;
  if (!mem.mode) {
    Object.assign(mem, {
      mode: 'gather', skill: null, streak: 0, rounds: 0, misses: 0,
      next: 0, target: null, plan: null, queued: 0, avoid: {}, seen: [],
    });
  }
  if (actor.action || actor.dest || actor.move) return;
  if (t < mem.next) return;
  mem.next = t + (prof.thinkEvery ?? 0.4);
  pruneAvoid(mem, t);
  if (mem.mode === 'gather') return gatherStep(ctx, actor, prof, mem);
  if (mem.mode === 'return') return returnStep(ctx, actor, mem);
  if (mem.mode === 'craft') return craftStep(ctx, actor, prof, mem);
}

function pruneAvoid(mem, t) {
  const keys = Object.keys(mem.avoid);
  if (keys.length < 40) return;
  for (const k of keys) if (mem.avoid[k] <= t) delete mem.avoid[k];
}

// 대상 둘레 standoff m 지점으로 걸어간다. 행위자 쪽부터 30°씩 돌며
// 다른 장애물이나 물에 걸리지 않는 자리를 고른다.
const RING = [[1, 0], [0.86603, 0.5], [0.5, 0.86603], [0, 1], [-0.5, 0.86603], [-0.86603, 0.5], [-1, 0]];

function clearSpot(ctx, x, z) {
  if (!ctx.terrain.walkable(x, z)) return false;
  const R = ctx.cfg.move.radius + 0.05;
  for (const o of ctx.obstacles.near(x, z)) if (Math.hypot(x - o.x, z - o.z) < o.r + R) return false;
  return true;
}

function moveNear(ctx, actor, target, standoff) {
  const dx = actor.x - target.x;
  const dz = actor.z - target.z;
  const d = Math.hypot(dx, dz);
  const ux = d < 0.01 ? 1 : dx / d;
  const uz = d < 0.01 ? 0 : dz / d;
  const [x0, z0, x1, z1] = ctx.data.lists.regions[0].bounds;
  const at = (vx, vz) => [
    Math.min(x1 - 2, Math.max(x0 + 2, target.x + vx * standoff)),
    Math.min(z1 - 2, Math.max(z0 + 2, target.z + vz * standoff)),
  ];
  let spot = at(ux, uz);
  search: for (const [c, s] of RING) {
    for (const sd of s ? [1, -1] : [1]) {
      const p = at(ux * c - uz * s * sd, ux * s * sd + uz * c);
      if (clearSpot(ctx, p[0], p[1])) {
        spot = p;
        break search;
      }
    }
  }
  ctx.command({ type: 'MOVE', actor: actor.id, x: spot[0], z: spot[1] });
}

// 멀면 귀환을 쓰고, 가깝거나 재사용 대기 중이면 걷는다
function goHome(ctx, actor) {
  const s = nearestSettlement(ctx, actor);
  if (dist(actor, s) > 60 && (actor.recallReadyAt || 0) <= ctx.state.t && ctx.command({ type: 'RECALL', actor: actor.id }).ok) return;
  moveNear(ctx, actor, s, 4);
}

function rawCount(ctx, actor) {
  let n = 0;
  for (const e of actor.bag) if (!e.uid && ctx.data.items[e.item].stage === 'raw') n += e.qty;
  return n;
}

function foods(ctx, actor) {
  let n = 0;
  for (const e of actor.bag) if (!e.uid && ctx.data.items[e.item].kind === 'consumable') n += e.qty;
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

function chooseNode(ctx, actor, skill, prof, mem) {
  const { state, data } = ctx;
  const tool = bestTool(ctx, actor, skill);
  const level = actor.skills[skill].level;
  const lists = [actor.bag, actor.storage];
  const cand = [];
  for (const node of Object.values(state.nodes)) {
    if (node.charges <= 0) continue;
    if (mem.avoid[node.id] > state.t) continue;
    const type = data.nodes[node.type];
    if (type.skill !== skill || type.level > level) continue;
    if (!tool && type.tier > 0) continue;
    const vein = state.veins[node.vein];
    const lot = state.lots[vein.lot];
    let score = dist(actor, node) - type.tier * 60 - (avgProps(lot.props) - 40) * (prof.quality ?? 1);
    if (countItem(lists, type.item) < 12) score -= 40; // 모자란 재료 우선
    if (prof.explore && !vein.common && !mem.seen.includes(vein.lot)) score -= prof.explore;
    cand.push({ node, type, score });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => a.score - b.score || (a.node.id < b.node.id ? -1 : 1));
  if (prof.detour && ctx.rng.chance(prof.detour)) return cand[Math.min(cand.length - 1, ctx.rng.int(1, 4))];
  return cand[0];
}

function gatherStep(ctx, actor, prof, mem) {
  const { cfg, data, state } = ctx;
  if (rawCount(ctx, actor) >= prof.trip || cfg.bag.slots - actor.bag.length <= 3) {
    mem.mode = 'return';
    mem.target = null;
    goHome(ctx, actor);
    return;
  }
  if (prof.foodTarget > 0 && !actor.buffs.some((b) => b.type === 'gatherYield')) {
    const food = actor.bag.find((e) => !e.uid && data.items[e.item].kind === 'consumable');
    if (food) {
      ctx.command({ type: 'EAT', actor: actor.id, key: keyOf(food) });
      return;
    }
  }

  // 노리던 노드에 닿았으면 캔다(빌 때까지 이어서)
  if (mem.target) {
    const node = state.nodes[mem.target];
    // 가는 길에 도구가 부서졌으면 티어 1 노드는 포기하고 다시 고른다
    const toolGone = node && data.nodes[node.type].tier > 0 && !bestTool(ctx, actor, data.nodes[node.type].skill);
    if (node && node.charges > 0 && !toolGone) {
      if (dist(actor, node) <= cfg.gather.rangeM) {
        const type = data.nodes[node.type];
        const useFocus = prof.useFocus && (type.byproducts || []).length > 0 &&
          actor.focus >= prof.focusReserve + cfg.focus.cost.gather;
        if (ctx.command({ type: 'GATHER', actor: actor.id, node: node.id, focus: useFocus }).ok) {
          mem.streak++;
          const lot = state.veins[node.vein].lot;
          if (!mem.seen.includes(lot)) {
            mem.seen.push(lot);
            if (mem.seen.length > 80) mem.seen.shift();
          }
          return;
        }
      }
      mem.avoid[node.id] = state.t + 60; // 막혀서 못 닿았거나 캘 수 없음
    }
    mem.target = null;
  }

  if (!mem.skill || mem.streak >= prof.streak) {
    mem.skill = lowestSkill(actor, prof.skills);
    mem.streak = 0;
  }
  const target = chooseNode(ctx, actor, mem.skill, prof, mem);
  if (!target) {
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
  mem.target = target.node.id;
  if (dist(actor, target.node) > cfg.gather.rangeM - 0.4) {
    moveNear(ctx, actor, target.node, (target.type.solid || 0) + 0.9);
  }
}

function returnStep(ctx, actor, mem) {
  if (!settlementAt(ctx, actor)) {
    goHome(ctx, actor);
    return;
  }
  ctx.command({ type: 'STORE', actor: actor.id, all: true });
  for (const e of [...actor.bag]) {
    if (!e.uid) continue;
    const def = ctx.data.items[e.item];
    if (!def.tool) continue;
    if (e.broken || bestTool(ctx, actor, def.tool.skill) !== e) ctx.command({ type: 'STORE', actor: actor.id, key: e.uid });
  }
  mem.mode = 'craft';
  mem.rounds = 0;
  mem.plan = null;
}

// 이번 라운드에 만들 것 (순수 데이터 목록)
function makePlan(ctx, actor, prof) {
  const { data } = ctx;
  const lists = [actor.bag, actor.storage];
  const count = (id) => countItem(lists, id);
  const plan = [];
  for (const skill of prof.skills) {
    const tier = toolTier(ctx, bestTool(ctx, actor, skill));
    const [stone, copper] = prof.tools[skill];
    if (tier < 1) plan.push({ recipe: copper, n: 1, tune: 'gatherSpeed' });
    if (tier < 0) plan.push({ recipe: stone, n: 1, skipIfTool: skill });
  }
  for (const id of REFINES) {
    const r = data.recipes[id];
    const input = r.slots[0].item;
    plan.push({ recipe: id, n: 6, catalyst: true, focus: true, keepItem: input, keepNeed: r.slots[0].qty, keepQty: prof.keep?.[input] || 0 });
  }
  if (prof.foodTarget > 0 && foods(ctx, actor) < prof.foodTarget) {
    plan.push({ recipe: 'rc_soup', n: 1 });
    plan.push({ recipe: 'rc_dried_berry', n: 1, skipIfFood: true });
  }
  const copperLevel = data.recipes[prof.tools[prof.skills[0]][1]].level;
  if (actor.skills.smithing.level < copperLevel) plan.push({ recipe: 'rc_nails_copper', n: 3 });
  else if (count('ingot_copper') > 9 && count('nails_copper') < 12) plan.push({ recipe: 'rc_nails_copper', n: 1 });
  if (count('lumber_drift') >= 4 && count('stake_wood') < 40) plan.push({ recipe: 'rc_stake_wood', n: 1, auto: 'cheap' });
  if (count('nails_copper') >= 6 && count('crate_wood') < 4) plan.push({ recipe: 'rc_crate', n: 1 });
  return plan;
}

function craftStep(ctx, actor, prof, mem) {
  const { data, cfg } = ctx;
  if (!mem.plan) {
    if (actor.queue.length) return; // 대기열이 빌 때까지 기다린다
    if (mem.rounds >= 3) {
      mem.mode = 'gather';
      mem.rounds = 0;
      return;
    }
    mem.rounds++;
    mem.plan = makePlan(ctx, actor, prof);
    mem.queued = 0;
  }
  while (mem.plan.length) {
    const step = mem.plan[0];
    const r = data.recipes[step.recipe];
    if (step.skipIfTool && bestTool(ctx, actor, step.skipIfTool)) {
      mem.plan.shift();
      continue;
    }
    if (step.skipIfFood && foods(ctx, actor) >= prof.foodTarget) {
      mem.plan.shift();
      continue;
    }
    if (r.station !== 'hand') {
      const st = nearestStation(ctx, actor, r.station);
      if (!st) {
        mem.plan.shift();
        continue;
      }
      if (dist(actor, st) > cfg.craft.rangeM - 0.5) {
        if (step.walked) {
          mem.plan.shift();
          continue;
        }
        step.walked = true;
        moveNear(ctx, actor, st, (data.stations[st.type].r || 0.8) + 1.2);
        return;
      }
    }
    let done = 0;
    while (done < step.n && actor.queue.length < cfg.craft.queueMax) {
      if (step.keepItem && countItem([actor.bag, actor.storage], step.keepItem) - step.keepNeed < step.keepQty) break;
      const cmd = { type: 'CRAFT', actor: actor.id, recipe: step.recipe, auto: step.auto || 'best' };
      if (step.catalyst) cmd.catalyst = 'auto';
      if (step.focus && prof.useFocus && actor.focus >= prof.focusReserve + cfg.focus.cost.refine) cmd.focus = true;
      if (step.tune && prof.tune && actor.focus >= prof.focusReserve + cfg.focus.cost.tune) cmd.tune = step.tune;
      if (!ctx.check(cmd).ok) break;
      ctx.command(cmd);
      done++;
      mem.queued++;
    }
    mem.plan.shift();
  }
  mem.plan = null;
  if (!mem.queued && !actor.queue.length) {
    mem.mode = 'gather';
    mem.rounds = 0;
  }
}
