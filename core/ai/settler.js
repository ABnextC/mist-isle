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

import { keyOf, avgProps, countItem, qtyOf } from '../inventory.js';
import { dist, settlementAt, nearestSettlement, nearestStation, bestTool, toolTier } from '../world.js';
import { entryStar, tradable, baseValue, bestBid, bestAsk, npcPrice, repairCost, refPrice } from '../market.js';
import { countDeliverable } from '../orders.js';
import { startFight } from './fighter.js';
import { corpseOpen } from '../systems/mobs.js';

const REFINES = ['rc_ingot_copper', 'rc_lumber_birch', 'rc_lumber_drift', 'rc_cloth_reed', 'rc_leather', 'rc_ingot_iron', 'rc_lumber_oak'];
const WEAPON_RC = { sword: ['rc_sword_copper', 'rc_sword_iron'], axe: ['rc_battleaxe_copper', 'rc_battleaxe_iron'], spear: ['rc_spear_copper', 'rc_spear_iron'] };
const ARMOR_RC = { head: 'rc_leather_hood', legs: 'rc_leather_pants', chest: 'rc_leather_vest' };
const IRON_TOOL = { logging: 'rc_axe_iron', mining: 'rc_pick_iron', harvesting: 'rc_sickle_iron' };

const fightOpts = (prof) => ({ read: prof.read ?? 0.45, block: prof.block ?? 0.3, heal: 0.45 });

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
  // v0.3: 쓰러지면 마을에서 일어나니 돌아온 셈 친다
  if (actor.cb?.downUntil > 0) {
    mem.mode = 'return';
    mem.target = null;
    mem.hunt = null;
    return;
  }
  // 덤비는 짐승이 있으면 맞서 싸운다(싸우는 동안은 ai/fighter.js가 몸을 쓴다)
  for (const m of Object.values(ctx.state.mobs)) {
    if (m.target === actor.id && m.mode !== 'dead' && m.mode !== 'return') {
      startFight(actor, m.id, fightOpts(prof));
      return;
    }
  }
  if (actor.action || actor.dest || actor.move) return;
  if (t < mem.next) return;
  mem.next = t + (prof.thinkEvery ?? 0.4);
  // 싸우다 쓰러뜨린 짐승이 가까이 있으면 손질부터 한다
  if (mem.mode !== 'craft' && mem.mode !== 'hunt' && skinNearby(ctx, actor, 8)) return;
  pruneAvoid(mem, t);
  if (mem.mode === 'gather') return gatherStep(ctx, actor, prof, mem);
  if (mem.mode === 'return') return returnStep(ctx, actor, mem);
  if (mem.mode === 'craft') return craftStep(ctx, actor, prof, mem);
  if (mem.mode === 'hunt') return huntStep(ctx, actor, prof, mem);
}

// ── 사냥(v0.3) ─────────────────────────────────────
function gearTier(ctx, e, kind) {
  if (!e) return -1;
  const def = ctx.data.items[e.item];
  return kind === 'weapon' ? def.weapon.tier : 1;
}

// 가방·창고에서 가장 좋은 무기(공격력)나 그 부위 갑옷(방어)
function bestGear(ctx, actor, slot) {
  let best = null;
  for (const e of [...actor.bag, ...actor.storage]) {
    if (!e.uid || e.broken) continue;
    const def = ctx.data.items[e.item];
    const ok = slot === 'weapon' ? !!def.weapon : def.armor?.slot === slot;
    if (!ok) continue;
    const v = slot === 'weapon' ? e.stats.attack : e.stats.armor;
    if (!best || v > best.v) best = { e, v };
  }
  return best ? best.e : null;
}

function equipBest(ctx, actor) {
  const inTown = !!settlementAt(ctx, actor);
  for (const slot of ['weapon', 'head', 'chest', 'legs']) {
    const e = bestGear(ctx, actor, slot);
    if (!e || actor.equip?.[slot] === e.uid) continue;
    if (!actor.bag.includes(e)) {
      if (!inTown) continue;
      ctx.command({ type: 'TAKE', actor: actor.id, key: e.uid });
    }
    ctx.command({ type: 'EQUIP', actor: actor.id, uid: e.uid, keep: true });
  }
}

function armorCount(ctx, actor) {
  return ['head', 'chest', 'legs'].filter((s) => actor.equip?.[s] && actor.bag.some((e) => e.uid === actor.equip[s] && !e.broken)).length;
}

// 사냥감 고르기: 손질할 수 있는(수렵 레벨) 짐승만. 늑대·멧돼지는 쇠붙이 무기와 갑옷을 갖췄을 때만(무진은 무기만 있으면 간다).
function huntable(ctx, actor, prof, type) {
  if (actor.skills.hunting.level < type.hunt.level) return false;
  const wt = gearTier(ctx, bestGear(ctx, actor, 'weapon'), 'weapon');
  if (type.id === 'deer') return wt >= 1;
  if (type.temper === 'aggressive' || type.temper === 'defensive') return wt >= 1 && (armorCount(ctx, actor) >= 2 || prof.brave);
  return true;
}

function chooseHuntGroup(ctx, actor, prof) {
  const { state, data } = ctx;
  let best = null;
  for (const g of Object.values(state.mobGroups)) {
    const type = data.creatures[g.type];
    if (!huntable(ctx, actor, prof, type)) continue;
    const alive = g.mobs.filter((id) => state.mobs[id] && state.mobs[id].mode !== 'dead' && state.mobs[id].mode !== 'return').length;
    if (!alive) continue;
    const lot = state.lots[Object.values(g.lots)[0]];
    const score = dist(actor, g) - type.hunt.level * 4 - (avgProps(lot?.props || {}) - 40) * (prof.quality ?? 1);
    if (!best || score < best.score) best = { g, score };
  }
  return best ? best.g : null;
}

function skinNearby(ctx, actor, range) {
  if (ctx.cfg.bag.slots - actor.bag.length <= 2) return false;
  let best = null;
  let bd = range;
  for (const m of Object.values(ctx.state.mobs)) {
    if (m.killer !== actor.id || !corpseOpen(ctx, m)) continue;
    if (actor.skills.hunting.level < ctx.data.creatures[m.type].hunt.level) continue;
    const d = dist(actor, m);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  if (!best) return false;
  if (bd > 2.2) moveNear(ctx, actor, best, 1.2);
  else ctx.command({ type: 'SKIN', actor: actor.id, mob: best.id });
  return true;
}

function nextTrip(ctx, actor, prof, mem) {
  mem.rounds = 0;
  mem.mode = 'gather';
  if (!(prof.hunt > 0) || !ctx.rng.chance(prof.hunt)) return;
  if (!chooseHuntGroup(ctx, actor, prof)) return;
  mem.mode = 'hunt';
  mem.hunt = { group: null, k0: totalKills(actor), since: ctx.state.t };
}

const totalKills = (actor) => Object.values(actor.stats.kills || {}).reduce((s, n) => s + n, 0);

function huntStep(ctx, actor, prof, mem) {
  const { state, data, cfg } = ctx;
  const h = mem.hunt || (mem.hunt = { group: null, k0: totalKills(actor), since: state.t });
  const heal = actor.bag.some((e) => data.items[e.item].effect === 'heal');
  const done = rawCount(ctx, actor) >= prof.trip || cfg.bag.slots - actor.bag.length <= 3
    || totalKills(actor) - h.k0 >= (prof.huntKills ?? 8) || state.t - h.since > 1200
    || (actor.cb.hp < actor.cb.maxHp * 0.4 && !heal);
  // 내가 쓰러뜨린 사체부터 손질한다
  let corpse = null;
  let cd = 30;
  for (const m of Object.values(state.mobs)) {
    if (m.killer !== actor.id || !corpseOpen(ctx, m)) continue;
    if (actor.skills.hunting.level < data.creatures[m.type].hunt.level) continue;
    const d = dist(actor, m);
    if (d < cd) {
      cd = d;
      corpse = m;
    }
  }
  if (corpse && cfg.bag.slots - actor.bag.length > 2) {
    if (cd > 2.2) moveNear(ctx, actor, corpse, 1.2);
    else ctx.command({ type: 'SKIN', actor: actor.id, mob: corpse.id });
    return;
  }
  if (done) {
    mem.hunt = null;
    mem.mode = 'return';
    goHome(ctx, actor);
    return;
  }
  let g = h.group ? state.mobGroups[h.group] : null;
  const aliveOf = (grp) => grp.mobs.map((id) => state.mobs[id]).filter((m) => m && m.mode !== 'dead' && m.mode !== 'return');
  if (!g || !aliveOf(g).length) {
    g = chooseHuntGroup(ctx, actor, prof);
    if (!g) {
      mem.hunt = null;
      mem.mode = 'return';
      goHome(ctx, actor);
      return;
    }
    h.group = g.id;
  }
  const alive = aliveOf(g).sort((p, q) => dist(actor, p) - dist(actor, q));
  const m = alive[0];
  if (dist(actor, m) > 8) {
    moveNear(ctx, actor, m, 5);
    return;
  }
  startFight(actor, m.id, fightOpts(prof));
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
  const prof = ctx.data.agents[actor.ai.profile] || ctx.data.agents.settler;
  equipBest(ctx, actor);
  for (const e of [...actor.bag]) {
    if (!e.uid) continue;
    const def = ctx.data.items[e.item];
    if ((def.weapon || def.armor) && !Object.values(actor.equip || {}).includes(e.uid)) ctx.command({ type: 'STORE', actor: actor.id, key: e.uid });
  }
  deliverOrders(ctx, actor);
  marketRound(ctx, actor, prof, mem);
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
    const cur = bestTool(ctx, actor, skill);
    const tier = toolTier(ctx, cur);
    const [stone, copper] = prof.tools[skill];
    // 수리(v0.2.1): 쓰던 구리 도구가 많이 닳았거나 부서졌으면, 새로 만들기 전에 은화로 고친다.
    // ★3 이상만 고친다(그보다 못하면 새로 만드는 게 낫다). 기다리기 싫은 무진은 다 고친다.
    // 최대 내구가 처음의 80% 아래로 줄면 고치지 않고 새로 만든다.
    const worn = prof.market === 'quality' ? 0.5 : 0.3;
    const minStar = prof.market === 'dump' ? 0 : 3;
    const fix = (e) => e.uid && (e.star ?? 0) >= minStar && data.items[e.item].tool?.skill === skill && data.items[e.item].tool.tier >= 1
      && (e.broken || e.dur <= e.maxDur * worn) && e.maxDur >= (e.stats?.durability ?? e.maxDur) * ctx.cfg.repair.minMaxShare;
    const want = cur && tier >= 1 ? (fix(cur) ? cur : null)
      : [...actor.bag, ...actor.storage].filter(fix).sort((x, y) => (y.star ?? 0) - (x.star ?? 0) || y.maxDur - x.maxDur)[0];
    if (want && actor.silver >= repairCost(ctx, want) + 40) plan.push({ repair: want.uid });
    if (tier < 1) plan.push({ recipe: copper, n: 1, tune: 'gatherSpeed', skipIfTier: [skill, 1] });
    if (tier < 0) plan.push({ recipe: stone, n: 1, skipIfTool: skill });
    // v0.3: 철주괴가 있으면 철 도구(티어 2)로 바꾼다
    if (tier >= 1 && tier < 2 && count('ingot_iron') >= 3 && actor.skills.smithing.level >= data.recipes[IRON_TOOL[skill]].level) {
      plan.push({ recipe: IRON_TOOL[skill], n: 1, tune: 'gatherSpeed', skipIfTier: [skill, 2] });
    }
  }
  if (prof.hunt > 0) {
    const kind = prof.weapon || 'sword';
    const w = bestGear(ctx, actor, 'weapon');
    const wt = gearTier(ctx, w, 'weapon');
    // 무기: 돌 몽둥이 → 구리 → 철. 낀 무기가 많이 닳았으면 고친다(★3 이상)
    if (wt < 0) plan.push({ recipe: 'rc_club', n: 1, skipIfWeapon: 0 });
    if (wt < 1) plan.push({ recipe: WEAPON_RC[kind][0], n: 1, tune: 'attack', skipIfWeapon: 1 });
    if (wt < 2 && count('ingot_iron') >= 4) plan.push({ recipe: WEAPON_RC[kind][1], n: 1, tune: 'attack', skipIfWeapon: 2 });
    for (const slot of ['weapon', 'head', 'chest', 'legs']) {
      const e = slot === 'weapon' ? w : bestGear(ctx, actor, slot);
      if (e && (e.star ?? 0) >= 3 && e.dur <= e.maxDur * 0.3 && actor.silver >= repairCost(ctx, e) + 40) {
        plan.push({ repair: e.uid, station: ctx.cfg.repair.stations[slot === 'weapon' ? 'weapon' : 'armor'] });
      }
    }
    // 갑옷: 가죽과 갈대 천이 모이면 두건 → 바지 → 조끼
    for (const slot of ['head', 'legs', 'chest']) {
      if (bestGear(ctx, actor, slot)) continue;
      plan.push({ recipe: ARMOR_RC[slot], n: 1, tune: 'armor' });
    }
    const heals = actor.bag.concat(actor.storage).filter((e) => data.items[e.item].effect === 'heal').reduce((s2, e) => s2 + e.qty, 0);
    if (heals < 6) plan.push({ recipe: 'rc_meat', n: 2 });
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
  // 주문 게시판: 만들 수 있는 의뢰는 계획에 넣는다(입문자는 게시판만 보고 만들지는 않는다)
  if (prof.market !== 'ordersOnly') {
    for (const o of ctx.state.orders) {
      if (o.left <= 0) continue;
      const r = Object.values(data.recipes).find((x) => x.output.item === o.item);
      if (!r || actor.skills[r.skill].level < r.level) continue;
      const have = countDeliverable(ctx, [actor.bag, actor.storage], o);
      if (have >= o.left) continue;
      const def = data.items[o.item];
      const n = def.tool ? 1 : Math.min(6, Math.ceil((o.left - have) / r.output.qty));
      plan.push({ recipe: r.id, n, tune: def.tool ? 'gatherSpeed' : null, forOrder: o.id, catalyst: r.type === 'refine', focus: r.type === 'refine' });
    }
  }
  return plan;
}

// 주문 게시판에 넘길 수 있는 것은 넘긴다
function deliverOrders(ctx, actor) {
  for (const o of ctx.state.orders) {
    if (o.left <= 0) continue;
    if (countDeliverable(ctx, [actor.bag, actor.storage], o) > 0) ctx.command({ type: 'ORDER_DELIVER', actor: actor.id, order: o.id });
  }
}

// 남는 것 팔기. 성향(prof.market)에 따라 다르다.
//  normal: 좋은 사자 주문엔 바로 넘기고, 아니면 남들 최저가보다 조금 싸게 내놓는다(기본값 55% 아래로는 안 판다)
//  quality: ★3 이상은 아껴 두고 나머지만 판다. 도구 재료는 ★3 이상으로 사 온다
//  trader: 주문 게시판에 넘길 물건을 거래소에서 사 오고, 한참 싸게 나온 물건은 사 뒀다가 산 값보다 비싸게 판다
//  dump: 기다리기 싫어한다. '한꺼번에 팔기'로 좋은 사자엔 넘기고 나머지는 시세 95%로 건다(걸 자리가 없으면 상인에게)
//  orders / ordersOnly: 주문만 하고 거래소는 안 쓴다
const KEEP = { ingot_copper: 12, lumber_birch: 12, lumber_drift: 12, nails_copper: 30, sand_fine: 6, sap_birch: 6, food_soup: 6, food_berry: 6, leather: 14, food_meat: 8, ingot_iron: 12, lumber_oak: 12, cloth_reed: 8 };

function surplusOf(ctx, actor, e) {
  const def = ctx.data.items[e.item];
  const have = countItem([actor.bag, actor.storage], e.item);
  if (def.stage === 'raw') return Math.max(0, Math.min(qtyOf(e), have - (e.item === 'hide_raw' || e.item === 'meat_raw' ? 30 : 60)));
  return Math.max(0, Math.min(qtyOf(e), have - (KEEP[e.item] ?? 0)));
}

function myMarket(ctx, actor) {
  const m = ctx.state.market;
  return [...m.asks, ...m.bids].filter((o) => o.kind === 'actor' && o.owner === actor.id);
}

function noteCost(mem, item, star, price) {
  mem.cost = mem.cost || {};
  const k = item + '|' + star;
  mem.cost[k] = mem.cost[k] ? Math.round((mem.cost[k] * 0.7 + price * 0.3) * 100) / 100 : price;
}

// 사 와서 주문에 넘기기(시세 차익). 주문 보상이 거래소 값보다 넉넉할 때만 산다.
function buyForOrders(ctx, actor, mem) {
  const m = ctx.state.market;
  let budget = Math.floor(actor.silver * 0.6);
  for (const o of ctx.state.orders) {
    if (o.left <= 0) continue;
    let need = o.left - countDeliverable(ctx, [actor.bag, actor.storage], o);
    for (const a of m.asks.filter((x) => x.item === o.item && x.star >= o.minStar && x.owner !== actor.id).sort((x, y) => x.price - y.price)) {
      if (need <= 0 || a.price > o.reward * 0.8 || budget < a.price) break;
      const q = Math.min(a.qty, need, Math.floor(budget / a.price));
      const r = ctx.command({ type: 'MARKET_BUY', actor: actor.id, item: a.item, minStar: a.star, qty: q, price: a.price, ioc: true });
      if (!r.ok) break;
      budget -= q * a.price;
      need -= q;
      noteCost(mem, a.item, a.star, a.price);
    }
  }
  deliverOrders(ctx, actor);
}

function marketRound(ctx, actor, prof, mem) {
  const style = prof.market || 'normal';
  if (style === 'orders' || style === 'ordersOnly') return;
  const m = ctx.state.market;
  const cap = ctx.cfg.market.maxOrdersPerOwner;
  // 반나절 넘게 안 팔린 내 팔자는 거둬서 다시 값을 매긴다
  for (const o of myMarket(ctx, actor)) {
    if (o.entry && ctx.state.t - o.t >= ctx.clock.hourLen * 12) ctx.command({ type: 'MARKET_CANCEL', actor: actor.id, id: o.id });
  }
  if (style === 'trader') buyForOrders(ctx, actor, mem);
  let open = myMarket(ctx, actor).length;
  for (const e of [...actor.storage]) {
    if (!tradable(ctx, e)) continue;
    const q = surplusOf(ctx, actor, e);
    if (q <= 0) continue;
    const star = entryStar(ctx, e);
    if (style === 'quality' && star >= 3) continue;
    const base = baseValue(ctx, e.item, star);
    const bid = bestBid(ctx, e.item, star);
    const key = keyOf(e);
    const cost = mem.cost?.[e.item + '|' + star];
    if (style === 'dump') {
      // v0.2.1부터 '한꺼번에 팔기'를 쓴다: 시세 85% 이상 사자엔 넘기고, 나머지는 시세 95%로 건다.
      // 걸 자리가 없을 때만 상인에게 넘긴다.
      const ref = refPrice(ctx, e.item, star);
      if (bid && bid.price >= ref * 0.85) {
        ctx.command({ type: 'MARKET_SELL', actor: actor.id, key, qty: Math.min(q, bid.qty), price: bid.price, ioc: true });
        continue;
      }
      if (myMarket(ctx, actor).some((o) => o.entry && o.item === e.item && o.star === star)) continue;
      if (open < cap - 2) {
        if (ctx.command({ type: 'MARKET_SELL', actor: actor.id, key, qty: q, price: Math.max(npcPrice(ctx, e.item, star) + 1, Math.round(ref * 0.95)) }).ok) open++;
        continue;
      }
      ctx.command({ type: 'MARKET_DUMP', actor: actor.id, key, qty: q });
      continue;
    }
    const floor = Math.max(npcPrice(ctx, e.item, star) + 1, Math.round(cost ? Math.max(cost * 1.12, cost + 2) : base * 0.55));
    if (bid && bid.price >= Math.max(floor, base * 0.85)) {
      ctx.command({ type: 'MARKET_SELL', actor: actor.id, key, qty: Math.min(q, bid.qty), price: bid.price, ioc: true });
      continue;
    }
    if (open >= cap - 2) continue;
    if (myMarket(ctx, actor).some((o) => o.entry && o.item === e.item && o.star === star)) continue;
    // 남들 최저가보다 1 싸게, 그러나 바닥값 아래로는 안 내린다
    const low = m.asks.filter((x) => x.item === e.item && x.star === star && x.owner !== actor.id).reduce((p, x) => Math.min(p, x.price), Infinity);
    const price = Math.max(floor, Math.min(Math.round(base * 0.95), low - 1));
    if (ctx.command({ type: 'MARKET_SELL', actor: actor.id, key, qty: q, price }).ok) open++;
  }
  if (style === 'trader') {
    // 한참 싸게 나온 물건 사 두기: 최근 체결가가 넉넉히 높을 때만
    let budget = Math.floor(actor.silver * 0.3);
    for (const a of [...m.asks]) {
      if (budget <= 0) break;
      if (a.owner === actor.id || baseValue(ctx, a.item, a.star) < 6) continue;
      if (a.price > baseValue(ctx, a.item, a.star) * 0.75) continue;
      if ((m.ref[a.item + '|' + a.star] ?? 0) < a.price * 1.15 + 2) continue;
      const q = Math.min(a.qty, Math.floor(budget / a.price), Math.max(0, 40 - countItem([actor.storage], a.item)));
      if (q <= 0) continue;
      if (ctx.command({ type: 'MARKET_BUY', actor: actor.id, item: a.item, minStar: a.star, qty: q, price: a.price, ioc: true }).ok) {
        budget -= q * a.price;
        noteCost(mem, a.item, a.star, a.price);
      }
    }
  }
  // 도구 재료가 모자라면 산다(구리주괴). 장인 성향은 ★3 이상만
  const need = 6 - countItem([actor.bag, actor.storage], 'ingot_copper');
  if (need > 0 && actor.skills.smithing.level >= 4) {
    const minStar = style === 'quality' ? 3 : 2;
    const ask = bestAsk(ctx, 'ingot_copper', minStar);
    if (ask && ask.price <= baseValue(ctx, 'ingot_copper', ask.star) * 1.1 && actor.silver >= ask.price * Math.min(need, ask.qty)) {
      ctx.command({ type: 'MARKET_BUY', actor: actor.id, item: 'ingot_copper', minStar, qty: Math.min(need, ask.qty), price: ask.price, ioc: true });
    }
  }
}

function craftStep(ctx, actor, prof, mem) {
  const { data, cfg } = ctx;
  if (!mem.plan) {
    if (actor.queue.length) {
      // 곧 끝나는 대기열만 기다린다. 길면 걸어 두고 채집하러 간다(설계 7.4).
      // 다음 단계 제작과 주문 납품은 다음 귀환 때 한다.
      const left = actor.queue[actor.queue.length - 1].endsAt - ctx.state.t;
      if (left <= 12) return;
      nextTrip(ctx, actor, prof, mem);
      return;
    }
    if (mem.orderCraft) {
      deliverOrders(ctx, actor);
      mem.orderCraft = false;
    }
    if (mem.rounds >= 3) {
      nextTrip(ctx, actor, prof, mem);
      return;
    }
    mem.rounds++;
    mem.plan = makePlan(ctx, actor, prof);
    mem.queued = 0;
  }
  while (mem.plan.length) {
    const step = mem.plan[0];
    if (step.repair) {
      const st = nearestStation(ctx, actor, step.station || 'forge');
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
      if (ctx.command({ type: 'REPAIR', actor: actor.id, uid: step.repair }).ok && actor.storage.some((e) => e.uid === step.repair)) {
        ctx.command({ type: 'TAKE', actor: actor.id, key: step.repair });
      }
      mem.plan.shift();
      continue;
    }
    const r = data.recipes[step.recipe];
    if (step.skipIfWeapon != null && gearTier(ctx, bestGear(ctx, actor, 'weapon'), 'weapon') >= step.skipIfWeapon) {
      mem.plan.shift();
      continue;
    }
    if (step.skipIfTier && toolTier(ctx, bestTool(ctx, actor, step.skipIfTier[0])) >= step.skipIfTier[1]) {
      mem.plan.shift();
      continue;
    }
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
      if (step.tune && (prof.tune || step.forOrder) && actor.focus >= prof.focusReserve + cfg.focus.cost.tune) cmd.tune = step.tune;
      if (!ctx.check(cmd).ok) break;
      ctx.command(cmd);
      done++;
      mem.queued++;
      if (step.forOrder) mem.orderCraft = true;
    }
    mem.plan.shift();
  }
  mem.plan = null;
  if (!mem.queued && !actor.queue.length) {
    nextTrip(ctx, actor, prof, mem);
    mem.rounds = 0;
  }
}
