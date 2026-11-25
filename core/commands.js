// 명령: 검증 → 실행 → 이벤트.
// 검증 단계는 상태를 바꾸지 않는다. 실행 단계는 실패하지 않는다.
// 싱글에서는 로컬 코어가, 멀티에서는 서버가 같은 함수를 돌린다.

import { toggleError, toggle } from './systems/pvp.js';
import { declareError, declareWar, supplyError, supply, plantError, plant, W as WAR, tagOf } from './systems/territory.js';
import { guildOf, newGuild, trimAgents, aiRoom, hireable, rollJobs, jobProgress, storeCap } from './systems/guilds.js';
import { plotDef, tierDef, nextTier, homeOf, nearPlot, comfortOf, restValue, plantDef } from './systems/housing.js';
import { feeMult, recipeAllowed, factionDef, factionOf, tasksOf, taskDone, gainInfluence } from './systems/factions.js';
import { keyOf, findEntry, takeQty, addEntry, slotsNeeded, effectiveProps, avgProps, bonusKey, qtyOf, countItem } from './inventory.js';
import { regionAt } from './terrain.js';
import { crossTo } from './systems/travel.js';
import {
  toolSpeed, gatherSeconds, refineStep, weightedProps, round2, round3,
  craftScores, convertStats, starOf, masterworkChance, avg,
} from './formulas.js';
import { dist, settlementAt, stationFor, bestTool, localStore, storeOf, reachable } from './world.js';
import { placeAsk, placeBid, cancelOrder, npcSell, tradable, repairCost, findOrder, ordersOf, listingFee, entryStar } from './market.js';
import { contribute, projectOpen, needLeft, silverLeft, shipFee } from './settlements.js';
import { deliver, countDeliverable } from './orders.js';
import { addXp } from './systems/progress.js';
import { startAttack, startDodge, interrupt, equipped, equipLoad, heavyCostOf, dodgeCostOf, weaponOf, startAbility, addAura } from './systems/combat.js';
import { learnError, learn, loadoutOf, abilityOf, mOf, resetCost } from './systems/mastery.js';
import { corpseOpen, skinLoot, skinSeconds } from './systems/mobs.js';
import { talkDue, talk, useDue, useObj, available, startQuest, nearNpc, questNote, TALK_RANGE, USE_RANGE, BOARD_RANGE, talkReady, npcShown } from './systems/quests.js';
import { isUnlocked, allowedProject } from './systems/unlocks.js';
import { objPos } from './world.js';
import { bondable, greetDue, greet, giftDue, giftable, gift, perkOf, inviteDue } from './systems/bonds.js';
import { spawnAlly, dismissAlly, allyOf } from './systems/allies.js';
import { spendError, spend, resetCost as attrResetCost, resetAttrs, spentOf } from './systems/level.js';
import { startError, startRun, leaveRun, runOf } from './systems/expeditions.js';

// ── 도우미 ─────────────────────────────────────────────
function matchSlot(data, e, slot) {
  const def = data.items[e.item];
  if (def.kind !== 'material') return false;
  if (slot.item) return e.item === slot.item;
  if (slot.family && def.family !== slot.family) return false;
  if (slot.stage && def.stage !== slot.stage) return false;
  if (slot.minTier != null && def.tier < slot.minTier) return false;
  return true;
}

// 그 슬롯의 어떤 속성이 결과에 얼마나 들어가는지
function relevance(recipe, slotKey) {
  const rel = {};
  for (const weights of Object.values(recipe.stats || {})) {
    for (const [ref, w] of Object.entries(weights)) {
      const [slot, prop] = ref.split('.');
      if (slot === slotKey) rel[prop] = (rel[prop] || 0) + w;
    }
  }
  return rel;
}

function relevantAvg(props, rel) {
  const keys = Object.keys(rel);
  if (!keys.length) return avgProps(props);
  let s = 0;
  let w = 0;
  for (const k of keys) {
    s += (props[k] ?? 0) * rel[k];
    w += rel[k];
  }
  return s / w;
}

const sameProps = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

function mixLot(ctx, recipe, props) {
  const { state, data } = ctx;
  const origin = recipe.slots[0].item || recipe.output.item;
  for (const lot of Object.values(state.lots)) {
    if (lot.mix && lot.item === origin && sameProps(lot.props, props)) return lot.id;
  }
  const id = ctx.newId('L');
  state.lots[id] = { id, item: origin, name: `섞은 ${data.items[origin].name}`, props: { ...props }, vein: null, mix: true };
  return id;
}

function weakestProp(props, names) {
  let best = names[0];
  for (const p of names) if ((props[p] ?? 0) < (props[best] ?? 0)) best = p;
  return best;
}

function cancelGather(ctx, a, reason) {
  interrupt(ctx, a, reason);
}

// ── 명령 ───────────────────────────────────────────────
const MOVE = {
  validate(ctx, a, c) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return 'bad_args';
    const [x0, z0, x1, z1] = regionAt(ctx.data.lists.regions, a.x).bounds;
    if (c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) return 'out_of_bounds';
    return {};
  },
  execute(ctx, a, c) {
    cancelGather(ctx, a, 'moved');
    a.move = null;
    a.stuck = 0;
    a.nav = null;
    a.dest = [round2(c.x), round2(c.z)];
  },
};

// 조작 입력: 월드 기준 방향 벡터(길이 1 이하). 0이면 멈춘다.
const MOVE_INPUT = {
  validate(ctx, a, c) {
    if (!Number.isFinite(c.dx) || !Number.isFinite(c.dz)) return 'bad_args';
    return {};
  },
  execute(ctx, a, c) {
    let dx = c.dx;
    let dz = c.dz;
    const m = Math.hypot(dx, dz);
    if (m < 0.05) {
      a.move = null;
      return;
    }
    if (m > 1) {
      dx /= m;
      dz /= m;
    }
    cancelGather(ctx, a, 'moved');
    a.dest = null;
    a.nav = null;
    a.move = [round3(dx), round3(dz)];
  },
};

const GATHER = {
  validate(ctx, a, c) {
    const { state, data, cfg } = ctx;
    if (a.action) return 'busy';
    if (a.dest || a.move) return 'moving';
    const node = state.nodes[c.node];
    if (!node) return 'no_node';
    if (node.charges <= 0) return 'node_empty';
    if (dist(a, node) > cfg.gather.rangeM) return 'too_far';
    const type = data.nodes[node.type];
    if (a.skills[type.skill].level < type.level) return 'level_low';
    if (type.night && !ctx.clock.isNight(state.t)) return 'night_only'; // 달맞이풀(v2.4)
    let tool = null;
    if (c.tool) {
      tool = a.bag.find((e) => e.uid === c.tool);
      if (!tool) return 'no_tool';
      const def = data.items[tool.item];
      if (!def.tool || def.tool.skill !== type.skill) return 'wrong_tool';
      if (tool.broken) return 'tool_broken';
    } else {
      tool = bestTool(ctx, a, type.skill);
    }
    const speed = toolSpeed(type, tool ? { tier: data.items[tool.item].tool.tier, stats: tool.stats } : null, cfg) * equipLoad(ctx, a).tier.gather;
    if (speed <= 0) return 'need_tool';
    if (c.focus && a.focus < cfg.focus.cost.gather) return 'no_focus';
    const probe = { item: type.item, lot: state.veins[node.vein].lot, bonus: null, qty: 1 };
    if (a.bag.length + slotsNeeded(a.bag, [probe]) > cfg.bag.slots) return 'bag_full';
    return { node, tool, secs: gatherSeconds(type, speed) };
  },
  execute(ctx, a, c, p) {
    if (c.focus) a.focus -= ctx.cfg.focus.cost.gather;
    a.action = {
      type: 'gather', node: p.node.id, tool: p.tool ? p.tool.uid : null,
      startedAt: ctx.state.t, endsAt: round2(ctx.state.t + p.secs), focus: !!c.focus,
    };
  },
};

const CRAFT = {
  validate(ctx, a, c) {
    const { state, data, cfg } = ctx;
    const r = data.recipes[c.recipe];
    if (!r) return 'no_recipe';
    if (!recipeAllowed(ctx, a, r)) return 'faction_recipe';
    if (r.blueprint && !a.known?.[r.id]) return 'no_blueprint'; // 설계도(v2.3)
    if (a.skills[r.skill].level < r.level) return 'level_low';
    const station = stationFor(ctx, a, r.station);
    if (!station) return 'no_station';
    // v0.4: 2티어 재료는 2단계 작업대에서만 다룬다
    if ((r.stationTier || 1) > station.tier) return 'station_tier';
    if (a.queue.length >= cfg.craft.queueMax) return 'queue_full';

    const pools = [{ name: 'bag', list: a.bag }];
    const here = settlementAt(ctx, a);
    if (here) pools.push({ name: 'storage', list: storeOf(a, here.id) });
    const reserved = new Map();
    const rk = (pool, e) => pool.name + '#' + keyOf(e);
    const avail = (pool, e) => e.qty - (reserved.get(rk(pool, e)) || 0);
    const reserve = (pool, e, q) => reserved.set(rk(pool, e), (reserved.get(rk(pool, e)) || 0) + q);

    const picks = {};
    const slotProps = {};
    for (const slot of r.slots) {
      const matches = [];
      for (const pool of pools) {
        for (const e of pool.list) if (!e.uid && matchSlot(data, e, slot) && avail(pool, e) > 0) matches.push({ pool, entry: e });
      }
      const chosen = [];
      let need = slot.qty;
      if (c.inputs && c.inputs[slot.key]) {
        for (const want of c.inputs[slot.key]) {
          const m = matches.find((x) => keyOf(x.entry) === want.key && (!want.from || x.pool.name === want.from));
          if (!m) return 'bad_input';
          const q = Math.min(want.qty, avail(m.pool, m.entry), need);
          if (q <= 0) return 'bad_input';
          chosen.push({ pool: m.pool, entry: m.entry, qty: q });
          reserve(m.pool, m.entry, q);
          need -= q;
        }
      } else {
        const rel = relevance(r, slot.key);
        const sc = new Map(matches.map((m) => [m, relevantAvg(effectiveProps(m.entry, state.lots), rel)]));
        const dir = c.auto === 'cheap' ? 1 : -1;
        matches.sort((x, y) => {
          const d = dir * (sc.get(x) - sc.get(y));
          if (d) return d;
          const kx = rk(x.pool, x.entry);
          const ky = rk(y.pool, y.entry);
          return kx < ky ? -1 : kx > ky ? 1 : 0;
        });
        for (const m of matches) {
          if (need <= 0) break;
          const q = Math.min(avail(m.pool, m.entry), need);
          if (q <= 0) continue;
          chosen.push({ pool: m.pool, entry: m.entry, qty: q });
          reserve(m.pool, m.entry, q);
          need -= q;
        }
      }
      if (need > 0) return 'missing_materials';
      picks[slot.key] = chosen;
      slotProps[slot.key] = weightedProps(chosen.map((x) => ({ props: effectiveProps(x.entry, state.lots), qty: x.qty })));
    }

    let catalyst = null;
    if (c.catalyst && r.catalyst) {
      outer: for (const pool of pools) {
        for (const e of pool.list) {
          if (!e.uid && e.item === r.catalyst && avail(pool, e) > 0) {
            catalyst = { pool, entry: e };
            reserve(pool, e, 1);
            break outer;
          }
        }
      }
      if (!catalyst && c.catalyst !== 'auto') return 'missing_catalyst';
    }

    let focusCost = 0;
    if (c.focus && r.type === 'refine') focusCost += cfg.focus.cost.refine;
    if (c.tune) {
      if (r.type !== 'craft' || !r.stats[c.tune]) return 'bad_tune';
      focusCost += cfg.focus.cost.tune;
    }
    if (a.focus < focusCost) return 'no_focus';
    return { r, station, picks, slotProps, catalyst, focusCost, at: here ? here.id : null };
  },

  execute(ctx, a, c, p) {
    const { state, data, cfg } = ctx;
    const r = p.r;
    const mainKey = r.slots[0].key;
    const mainParts = p.picks[mainKey].map((x) => ({ item: x.entry.item, lot: x.entry.lot, bonus: x.entry.bonus }));

    for (const list of Object.values(p.picks)) for (const x of list) takeQty(x.pool.list, keyOf(x.entry), x.qty);
    if (p.catalyst) takeQty(p.catalyst.pool.list, keyOf(p.catalyst.entry), 1);
    a.focus -= p.focusCost;
    a.stats.focusUsed += p.focusCost;

    const level = a.skills[r.skill].level;
    const job = {
      id: ctx.newId('job'), recipe: r.id, level, stationTier: p.station.tier, slotProps: p.slotProps, at: p.at,
      tune: c.tune || null, focusReturn: !!(c.focus && r.type === 'refine'),
      catalyst: !!p.catalyst, out: null, returnTo: null, mainQty: r.slots[0].qty, startsAt: 0, endsAt: 0,
    };

    if (r.type === 'refine') {
      const first = mainParts[0];
      const same = mainParts.every((m) => m.lot === first.lot && bonusKey(m.bonus) === bonusKey(first.bonus));
      let lot;
      let bonus;
      if (same) {
        lot = first.lot;
        bonus = first.bonus ? { ...first.bonus } : null;
      } else {
        lot = mixLot(ctx, r, p.slotProps[mainKey]);
        bonus = null;
      }
      if (r.refineStep !== false) {
        const step = refineStep(level, !!p.catalyst, cfg);
        if (step > 0) {
          const names = data.items[r.output.item].props;
          const prop = c.refineProp && names.includes(c.refineProp) ? c.refineProp : weakestProp(p.slotProps[mainKey], names);
          bonus = bonus || {};
          bonus[prop] = Math.min(cfg.refine.maxStep, (bonus[prop] || 0) + step);
        }
      }
      job.out = { lot, bonus };
      job.returnTo = { item: first.item, lot: first.lot, bonus: first.bonus };
    }

    const last = a.queue.length ? a.queue[a.queue.length - 1].endsAt : state.t;
    job.startsAt = Math.max(state.t, last);
    job.endsAt = job.startsAt + r.seconds;
    a.queue.push(job);
    ctx.emit('craft.queued', { actor: a.id, recipe: r.id, endsAt: job.endsAt });
  },
};

const EAT = {
  validate(ctx, a, c) {
    const e = findEntry(a.bag, c.key);
    if (!e) return 'no_item';
    const def = ctx.data.items[e.item];
    if (def.kind !== 'consumable' || (!def.buff && def.effect !== 'heal' && !def.potion)) return 'not_food';
    if ((def.effect === 'heal' || def.potion) && a.cb && a.cb.downUntil > 0) return 'down';
    // 물약(v2.4): 마신 뒤 잠깐은 또 못 마신다
    if (def.potion && (a.cb?.potionAt || 0) > ctx.state.t) return 'potion_cd';
    return { e, def };
  },
  execute(ctx, a, c, p) {
    const stats = p.e.stats;
    takeQty(a.bag, c.key, 1);
    if (p.def.potion) {
      drinkPotion(ctx, a, p.def, stats);
      return;
    }
    if (p.def.effect === 'heal') {
      const before = a.cb.hp;
      a.cb.hp = Math.min(a.cb.maxHp, Math.round((a.cb.hp + (stats.heal ?? 20)) * 100) / 100);
      a.stats.eat++;
      ctx.emit('eat', { actor: a.id, item: p.e.item, heal: Math.round(a.cb.hp - before) });
      questNote(ctx, a, 'eat');
      return;
    }
    a.buffs = a.buffs.filter((b) => b.type !== p.def.buff);
    const buff = { type: p.def.buff, value: stats.buff, endsAt: ctx.state.t + Math.round(stats.minutes * 60 * feeMult(ctx, a, 'food')) };
    a.buffs.push(buff);
    a.stats.eat++;
    ctx.emit('eat', { actor: a.id, item: p.e.item, value: buff.value, minutes: stats.minutes });
    questNote(ctx, a, 'eat');
  },
};

// 물약(v2.4): 회복은 바로, 기력·강건은 잠깐 기운(aura), 마나는 바로 채운다
function drinkPotion(ctx, a, def, stats) {
  const cb = a.cb;
  const t = ctx.state.t;
  cb.potionAt = Math.round((t + (ctx.cfg.combat.potionCd ?? 15)) * 100) / 100;
  const k = stats.power || 0;
  let v = 0;
  if (def.potion === 'heal') {
    const before = cb.hp;
    cb.hp = Math.round(Math.min(cb.maxHp, cb.hp + cb.maxHp * k) * 100) / 100;
    v = Math.round(cb.hp - before);
  } else if (def.potion === 'mana') {
    const before = cb.mp ?? 0;
    cb.mp = Math.round(Math.min(cb.maxMp ?? 100, before + (cb.maxMp ?? 100) * k) * 100) / 100;
    v = Math.round(cb.mp - before);
  } else if (def.potion === 'stamina') addAura(ctx, a, 'potion_stamina', { sec: stats.sec || 60, stRegen: k });
  else if (def.potion === 'guard') addAura(ctx, a, 'potion_guard', { sec: stats.sec || 90, dr: k });
  a.stats.potions = (a.stats.potions || 0) + 1;
  ctx.emit('potion', { actor: a.id, item: def.id, kind: def.potion, value: v, power: k, sec: stats.sec || 0 });
}

// all: 재료와 가구를 모두 창고로. 도구와 음식은 가방에 남긴다.
const STORE = {
  validate(ctx, a, c) {
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    if (c.key && !findEntry(a.bag, c.key)) return 'no_item';
    if (!c.key && !c.all) return 'bad_args';
    return { store: storeOf(a, s.id), at: s.id };
  },
  execute(ctx, a, c, p) {
    const { data } = ctx;
    const list = c.key
      ? [findEntry(a.bag, c.key)]
      : a.bag.filter((e) => {
        const def = data.items[e.item];
        // 도구·무기·갑옷은 가방에 남긴다(낀 장비가 빠지지 않게)
        return def.kind === 'material' || (def.kind === 'equipment' && !def.tool && !def.weapon && !def.armor);
      });
    let moved = 0;
    for (const e of list) {
      const q = c.key && c.qty ? Math.min(c.qty, qtyOf(e)) : qtyOf(e);
      addEntry(p.store, takeQty(a.bag, keyOf(e), q));
      moved += q;
    }
    ctx.emit('store', { actor: a.id, moved, at: p.at });
    if (moved > 0) questNote(ctx, a, 'store', { at: p.at });
  },
};

const TAKE = {
  validate(ctx, a, c) {
    const store = localStore(ctx, a);
    if (!store) return 'not_in_town';
    const e = findEntry(store, c.key);
    if (!e) return 'no_item';
    const q = Math.min(c.qty || qtyOf(e), qtyOf(e));
    const probe = e.uid ? e : { ...e, qty: q };
    if (a.bag.length + slotsNeeded(a.bag, [probe]) > ctx.cfg.bag.slots) return 'bag_full';
    return { q, store };
  },
  execute(ctx, a, c, p) {
    addEntry(a.bag, takeQty(p.store, c.key, p.q));
    ctx.emit('take', { actor: a.id, key: c.key, qty: p.q });
  },
};

const SET_AUTOPILOT = {
  validate(ctx, a, c) {
    const profile = c.profile || a.ai?.profile || 'settler';
    if (!ctx.data.agents[profile]) return 'bad_args';
    return { profile };
  },
  execute(ctx, a, c, p) {
    if (!a.ai) a.ai = { on: false, profile: p.profile, mem: {} };
    a.ai.on = !!c.on;
    a.ai.profile = p.profile;
    a.ai.mem = {};
    a.move = null;
    ctx.emit('autopilot', { actor: a.id, on: a.ai.on });
  },
};

// 귀환 지점으로 귀환(뉴월드의 여관 귀환과 같은 역할). 시전 중에 움직이면 취소된다.
const RECALL = {
  validate(ctx, a) {
    if (a.action) return 'busy';
    if ((a.recallReadyAt || 0) > ctx.state.t) return 'recall_cooldown';
    const s = ctx.state.settlements[a.home] || Object.values(ctx.state.settlements)[0];
    if (!s) return 'bad_args';
    if (s.region !== regionAt(ctx.data.lists.regions, a.x).id) return 'other_island';
    return { s };
  },
  execute(ctx, a, c, p) {
    a.dest = null;
    a.nav = null;
    a.move = null;
    a.action = { type: 'recall', settlement: p.s.id, startedAt: ctx.state.t, endsAt: round2(ctx.state.t + ctx.cfg.recall.castSec) };
    ctx.emit('recall.started', { actor: a.id });
  },
};

// ── 거래소·주문 ───────────────────────────────────────
// 가방이나 그 마을 창고에서 묶음을 찾는다(마을 안에서만 거래한다)
function findOwned(ctx, a, key) {
  const e = findEntry(a.bag, key);
  if (e) return { list: a.bag, e };
  const store = localStore(ctx, a);
  const s = store ? findEntry(store, key) : null;
  return s ? { list: store, e: s } : null;
}

const myOrderCount = (ctx, a) => ordersOf(ctx, a.id, 'actor').length;

const okPrice = (p) => Number.isInteger(p) && p >= 1 && p <= 1e6;
const okQty = (q) => Number.isInteger(q) && q >= 1 && q <= 1e5;

const MARKET_SELL = {
  validate(ctx, a, c) {
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    const f = findOwned(ctx, a, c.key);
    if (!f) return 'no_item';
    if (!tradable(ctx, f.e)) return 'not_tradable';
    if (!okPrice(c.price)) return 'bad_price';
    const q = c.qty == null ? qtyOf(f.e) : c.qty;
    if (!okQty(q) || q > qtyOf(f.e)) return 'bad_qty';
    const fee = c.ioc ? 0 : listingFee(ctx, 'actor', a.id, s.id, q, c.price);
    if (a.silver < fee) return 'no_silver';
    if (!c.ioc && myOrderCount(ctx, a) >= ctx.cfg.market.maxOrdersPerOwner) return 'too_many_orders';
    return { f, q, at: s.id };
  },
  execute(ctx, a, c, p) {
    const res = placeAsk(ctx, p.at, 'actor', a.id, takeQty(p.f.list, keyOf(p.f.e), p.q), c.price, { ioc: !!c.ioc });
    ctx.emit('market.sell', { actor: a.id, at: p.at, sold: res.sold, rest: res.rest });
    questNote(ctx, a, 'sell', { at: p.at });
  },
};

const MARKET_BUY = {
  validate(ctx, a, c) {
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    const def = ctx.data.items[c.item];
    if (!def || (def.kind !== 'material' && def.kind !== 'consumable')) return 'not_tradable';
    if (!okPrice(c.price) || !okQty(c.qty)) return 'bad_args';
    const minStar = c.minStar ?? 0;
    if (!Number.isInteger(minStar) || minStar < 0 || minStar > 5) return 'bad_args';
    if (a.silver < c.qty * c.price) return 'no_silver';
    if (!c.ioc && myOrderCount(ctx, a) >= ctx.cfg.market.maxOrdersPerOwner) return 'too_many_orders';
    return { minStar, at: s.id };
  },
  execute(ctx, a, c, p) {
    const res = placeBid(ctx, p.at, 'actor', a.id, c.item, p.minStar, c.qty, c.price, { ioc: !!c.ioc });
    ctx.emit('market.buy', { actor: a.id, at: p.at, bought: res.bought, rest: res.rest, item: c.item });
  },
};

// 거두기는 어느 마을에서든 된다(물건은 그 주문을 건 마을 창고로 돌아간다)
const MARKET_CANCEL = {
  validate(ctx, a, c) {
    const o = findOrder(ctx, c.id);
    if (!o || o.kind !== 'actor' || o.owner !== a.id) return 'no_order';
    return {};
  },
  execute(ctx, a, c) {
    cancelOrder(ctx, c.id);
    ctx.emit('market.cancel', { actor: a.id, id: c.id });
  },
};

// 상인에게 하한가로 넘기기
const MARKET_DUMP = {
  validate(ctx, a, c) {
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    const f = findOwned(ctx, a, c.key);
    if (!f) return 'no_item';
    if (!tradable(ctx, f.e)) return 'not_tradable';
    const q = c.qty == null ? qtyOf(f.e) : c.qty;
    if (!okQty(q) || q > qtyOf(f.e)) return 'bad_qty';
    return { f, q, at: s.id };
  },
  execute(ctx, a, c, p) {
    npcSell(ctx, 'actor', a.id, takeQty(p.f.list, keyOf(p.f.e), p.q));
    questNote(ctx, a, 'sell', { at: p.at });
  },
};

const ORDER_DELIVER = {
  validate(ctx, a, c) {
    // 주문 게시판은 3장부터(v0.5.2 해금)
    if (!isUnlocked(ctx, a, 'orders')) return 'locked';
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    const o = ctx.state.orders.find((x) => x.id === c.order);
    if (!o || o.left <= 0) return 'no_order';
    if (o.at && o.at !== s.id) return 'other_town';
    const lists = [a.bag, storeOf(a, s.id)];
    const have = countDeliverable(ctx, lists, o);
    if (!have) return 'nothing_to_deliver';
    return { o, lists };
  },
  execute(ctx, a, c, p) {
    deliver(ctx, 'actor', a.id, a, p.lists, p.o, c.qty ?? p.o.left);
  },
};

// 수리: 대장간 앞에서 은화를 내고 고친다. 고칠 때마다 최대 내구가 2% 준다(설계 7.5).
const REPAIR = {
  validate(ctx, a, c) {
    const e = a.bag.find((x) => x.uid === c.uid) || (localStore(ctx, a)?.find((x) => x.uid === c.uid) ?? null);
    if (!e) return 'no_item';
    const def = ctx.data.items[e.item];
    const kind = def.armor ? 'armor' : def.weapon ? 'weapon' : def.tool ? 'tool' : null;
    if (!kind || e.maxDur == null) return 'not_repairable';
    if (!stationFor(ctx, a, ctx.cfg.repair.stations?.[kind] || 'forge')) return 'no_station';
    if (!e.broken && e.dur >= e.maxDur) return 'not_damaged';
    const cost = repairCost(ctx, e, a);
    if (a.silver < cost) return 'no_silver';
    return { e, cost };
  },
  execute(ctx, a, c, p) {
    const { e, cost } = p;
    const worn = e.broken ? 1 : 1 - e.dur / e.maxDur;
    a.silver -= cost;
    a.stats.repairSpent = (a.stats.repairSpent || 0) + cost;
    e.maxDur = Math.max(1, Math.round(e.maxDur * (1 - ctx.cfg.repair.maxLoss)));
    e.dur = e.maxDur;
    e.broken = false;
    e.repairs = (e.repairs || 0) + 1;
    const r = Object.values(ctx.data.recipes).find((x) => x.output.item === e.item);
    if (r) addXp(ctx, a, r.skill, Math.max(1, Math.round(r.xp * ctx.cfg.repair.xp * worn)));
    ctx.emit('repair', { actor: a.id, uid: e.uid, item: e.item, cost, maxDur: e.maxDur, repairs: e.repairs });
    questNote(ctx, a, 'repair');
  },
};

// ── 전투(v0.3) ─────────────────────────────────────
const alive = (ctx, a) => {
  if (!a.cb || a.cb.downUntil > 0) return 'down';
  if (a.cb.stunUntil > ctx.state.t) return 'stunned';
  return null;
};

// 무기·갑옷 끼기. 이미 낀 것을 다시 고르면 벗는다.
const EQUIP = {
  validate(ctx, a, c) {
    const e = a.bag.find((x) => x.uid === c.uid);
    if (!e) return 'no_item';
    const def = ctx.data.items[e.item];
    // c.alt(v1.1): 무기를 둘째 자리(등)에 낀다. 장신구(v2.4)는 반지·목걸이 자리
    const slot = def.weapon ? (c.alt ? 'weapon2' : 'weapon') : def.armor?.slot || def.jewel?.slot;
    if (!slot) return 'not_equipment';
    if (def.weapon && a.cb?.act) return 'busy';
    return { e, slot };
  },
  execute(ctx, a, c, p) {
    a.equip = a.equip || { weapon: null, weapon2: null, head: null, chest: null, legs: null };
    // 같은 무기를 두 자리에 끼지 않는다
    const other = p.slot === 'weapon' ? 'weapon2' : p.slot === 'weapon2' ? 'weapon' : null;
    if (other && a.equip[other] === p.e.uid) a.equip[other] = null;
    a.equip[p.slot] = a.equip[p.slot] === p.e.uid && !c.keep ? null : p.e.uid;
    ctx.emit('equip', { actor: a.id, slot: p.slot, uid: a.equip[p.slot], item: p.e.item });
  },
};

const UNEQUIP = {
  validate(ctx, a, c) {
    if (!['weapon', 'weapon2', 'head', 'chest', 'legs', 'ring', 'neck'].includes(c.slot)) return 'bad_args';
    return {};
  },
  execute(ctx, a, c) {
    if (a.equip) a.equip[c.slot] = null;
    ctx.emit('equip', { actor: a.id, slot: c.slot, uid: null, item: null });
  },
};

// 공격: kind light|heavy, yaw는 바라볼 방향(없으면 지금 방향)
const ATTACK = {
  validate(ctx, a, c) {
    const bad = alive(ctx, a);
    if (bad) return bad;
    const t = ctx.state.t;
    if (a.cb.dodge) return 'busy';
    if (a.cb.act && t < a.cb.act.endAt) return 'busy';
    const kind = c.kind === 'heavy' ? 'heavy' : 'light';
    if (kind === 'heavy' && a.cb.st < heavyCostOf(ctx, a)) return 'no_stamina';
    if (c.yaw != null && !Number.isFinite(c.yaw)) return 'bad_args';
    return { kind };
  },
  execute(ctx, a, c, p) {
    cancelGather(ctx, a, 'attack');
    a.dest = null;
    a.nav = null;
    startAttack(ctx, a, p.kind, c.yaw ?? a.yaw);
  },
};

const DODGE = {
  validate(ctx, a, c) {
    const bad = alive(ctx, a);
    if (bad) return bad;
    if (a.cb.dodge) return 'busy';
    const ld = equipLoad(ctx, a).tier;
    if (!(ld.dodgeDist > 0)) return 'overloaded';
    if (a.cb.st < dodgeCostOf(ctx, a)) return 'no_stamina';
    if (c.yaw != null && !Number.isFinite(c.yaw)) return 'bad_args';
    return {};
  },
  execute(ctx, a, c) {
    cancelGather(ctx, a, 'dodge');
    a.dest = null;
    a.nav = null;
    const yaw = c.yaw ?? (a.move ? Math.atan2(a.move[0], a.move[1]) : a.yaw);
    startDodge(ctx, a, yaw);
  },
};

const BLOCK = {
  validate(ctx, a, c) {
    if (c.on) {
      const bad = alive(ctx, a);
      if (bad) return bad;
      if (a.cb.dodge) return 'busy';
    }
    return {};
  },
  execute(ctx, a, c) {
    const on = !!c.on;
    // 막을 방향(v3.0): 화면이 직접 고치던 것을 명령으로
    if (on && Number.isFinite(c.yaw)) a.yaw = Math.round(c.yaw * 1000) / 1000;
    if (!a.cb || a.cb.block === on) return;
    if (on) cancelGather(ctx, a, 'block');
    a.cb.block = on;
    ctx.emit('combat.block', { actor: a.id, on });
  },
};

// ── 무기 숙련(v1.1) ────────────────────────────────
// 스킬 쓰기: slot 0~2 (1·2·3키). 지금 든 무기의 줄에 건 스킬을 쓴다
const ABILITY = {
  validate(ctx, a, c) {
    const bad = alive(ctx, a);
    if (bad) return bad;
    if (![0, 1, 2].includes(c.slot)) return 'bad_args';
    if (c.yaw != null && !Number.isFinite(c.yaw)) return 'bad_args';
    const t = ctx.state.t;
    if (a.cb.dodge) return 'busy';
    if (a.cb.act && t < a.cb.act.endAt) return 'busy';
    const w = weaponOf(ctx, a).mastery;
    if (!w) return 'no_weapon';
    const node = loadoutOf(a, w)[c.slot];
    if (!node || !mOf(a, w).nodes.includes(node)) return 'no_skill';
    if ((a.cb.cds?.[node] || 0) > t) return 'cooldown';
    const ab = abilityOf(ctx, a, node);
    if (a.cb.st < (ab.cost || 0)) return 'no_stamina';
    if ((a.cb.mp ?? 0) < (ab.mana || 0)) return 'no_mana';
    return { node, ab };
  },
  execute(ctx, a, c, p) {
    cancelGather(ctx, a, 'attack');
    a.dest = null;
    a.nav = null;
    a.cb.cds ??= {};
    startAbility(ctx, a, p.node, p.ab, c.yaw ?? a.yaw);
  },
};

// 무기 바꾸기: 손에 든 것과 등에 멘 것을 맞바꾼다
const SWAP_WEAPON = {
  validate(ctx, a) {
    const bad = alive(ctx, a);
    if (bad) return bad;
    if (a.cb.dodge || a.cb.act) return 'busy';
    if (!a.equip?.weapon2 && !a.equip?.weapon) return 'no_weapon';
    return {};
  },
  execute(ctx, a) {
    const e = a.equip;
    [e.weapon, e.weapon2] = [e.weapon2 ?? null, e.weapon ?? null];
    a.cb.block = false;
    const w = equipped(ctx, a, 'weapon');
    ctx.emit('combat.swap', { actor: a.id, item: w?.item ?? null });
  },
};

const MASTERY_LEARN = {
  validate(ctx, a, c) {
    return learnError(ctx, a, c.node) || {};
  },
  execute(ctx, a, c) {
    learn(ctx, a, c.node);
  },
};

// 스킬 줄 바꾸기: weapon의 slot 칸에 node(배운 액티브)를 건다. 다른 칸에 있으면 자리를 바꾼다
const LOADOUT_SET = {
  validate(ctx, a, c) {
    const W = ctx.data.weapons;
    if (!W.types[c.weapon] || ![0, 1, 2].includes(c.slot)) return 'bad_args';
    if (c.node != null) {
      const n = ctx.data.weaponNodes[c.node];
      if (!n || n.kind !== 'active' || n.weapon !== c.weapon) return 'bad_args';
      if (!mOf(a, c.weapon).nodes.includes(c.node)) return 'locked';
    }
    return {};
  },
  execute(ctx, a, c) {
    const lo = loadoutOf(a, c.weapon);
    const was = lo.indexOf(c.node ?? '__none');
    if (was >= 0) lo[was] = lo[c.slot];
    lo[c.slot] = c.node ?? null;
    a.loadout[c.weapon] = lo;
    ctx.emit('mastery.loadout', { actor: a.id, weapon: c.weapon, loadout: lo });
  },
};

// 다시 찍기: 찍은 점수당 은화를 내고 그 무기 트리를 비운다
const MASTERY_RESET = {
  validate(ctx, a, c) {
    if (!ctx.data.weapons.types[c.weapon]) return 'bad_args';
    if (!mOf(a, c.weapon).nodes.length) return 'nothing';
    const cost = resetCost(ctx, a, c.weapon);
    if (a.silver < cost) return 'no_silver';
    return { cost };
  },
  execute(ctx, a, c, p) {
    a.silver -= p.cost;
    a.mastery[c.weapon].nodes = [];
    a.loadout ??= {};
    a.loadout[c.weapon] = [null, null, null];
    ctx.emit('mastery.reset', { actor: a.id, weapon: c.weapon, cost: p.cost });
  },
};

// 손질: 쓰러뜨린 짐승의 사체에서 가죽·고기를 얻는다(수렵)
const SKIN = {
  validate(ctx, a, c) {
    if (a.action) return 'busy';
    const bad = alive(ctx, a);
    if (bad) return bad;
    const m = ctx.state.mobs?.[c.mob];
    if (!m) return 'no_mob';
    if (!corpseOpen(ctx, m) || (m.skinning && m.skinning !== a.id)) return 'no_corpse';
    if (dist(a, m) > 2.6) return 'too_far';
    const type = ctx.data.creatures[m.type];
    if (a.skills.hunting.level < type.hunt.level) return 'level_low';
    if (a.bag.length + slotsNeeded(a.bag, skinLoot(ctx, m)) > ctx.cfg.bag.slots) return 'bag_full';
    return { m, secs: skinSeconds(ctx, a, type) };
  },
  execute(ctx, a, c, p) {
    a.move = null;
    a.dest = null;
    a.nav = null;
    p.m.skinning = a.id;
    a.action = { type: 'skin', mob: p.m.id, startedAt: ctx.state.t, endsAt: round2(ctx.state.t + p.secs) };
    ctx.emit('skin.start', { actor: a.id, mob: p.m.id, species: p.m.type, sec: p.secs });
  },
};

// ── 정착지(v0.4) ────────────────────────────────────
// 귀환 지점 정하기: 지금 서 있는 마을로
const SET_HOME = {
  validate(ctx, a) {
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    if (a.home === s.id) return 'already_home';
    return { s };
  },
  execute(ctx, a, c, p) {
    a.home = p.s.id;
    ctx.emit('home.set', { actor: a.id, at: p.s.id });
  },
};

// 창고 운송: 이 마을 창고 → 다른 마을 창고. 운송비(은화)는 사라진다.
//   { key, qty?, to } · { keys: [key, ...], to } · { items: [{ key, qty }], to } (한 번에 묶어 보내면 최소 운송비를 한 번만 낸다)
const SHIP = {
  validate(ctx, a, c) {
    if (!isUnlocked(ctx, a, 'transport')) return 'locked';
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    if (!c.to || !ctx.state.settlements[c.to]) return 'bad_args';
    if (c.to === s.id) return 'same_town';
    if (ctx.state.settlements[c.to].region !== s.region) return 'other_island';
    const from = storeOf(a, s.id);
    const want = c.items || (c.keys ? c.keys.map((key) => ({ key })) : [{ key: c.key, qty: c.qty }]);
    const picks = [];
    for (const w of want) {
      const e = findEntry(from, w.key);
      if (!e) return 'no_item';
      const q = Math.min(w.qty || qtyOf(e), qtyOf(e));
      if (!okQty(q)) return 'bad_qty';
      if (picks.some((x) => x.e === e)) return 'bad_args';
      picks.push({ e, q });
    }
    if (!picks.length) return 'bad_args';
    const fee = shipFee(ctx, a, s.id, picks.map((x) => ({ item: x.e.item, star: entryStar(ctx, x.e), uid: x.e.uid, qty: x.q })));
    if (a.silver < fee) return 'no_silver';
    return { from, to: storeOf(a, c.to), picks, fee, at: s.id };
  },
  execute(ctx, a, c, p) {
    let n = 0;
    for (const { e, q } of p.picks) {
      addEntry(p.to, takeQty(p.from, keyOf(e), q));
      n += q;
    }
    a.silver -= p.fee;
    a.stats.shipSpent = (a.stats.shipSpent || 0) + p.fee;
    ctx.emit('ship', { actor: a.id, from: p.at, to: c.to, qty: n, fee: p.fee });
  },
};

// 마을 사업에 내기: { project, key, qty } (물자) 또는 { project, silver } (은화)
const CONTRIBUTE = {
  validate(ctx, a, c) {
    const s = settlementAt(ctx, a);
    if (!s) return 'not_in_town';
    const def = ctx.data.projects[c.project];
    if (!def || def.at !== s.id) return 'no_project';
    // 마을 사업은 3장부터. 2장 「숲머리 대장간」 동안엔 그 사업만 거들 수 있다
    if (!allowedProject(ctx, a, c.project)) return 'locked';
    if (!projectOpen(ctx, c.project)) return 'project_closed';
    if (c.silver != null) {
      if (!Number.isInteger(c.silver) || c.silver < 1) return 'bad_args';
      const q = Math.min(c.silver, silverLeft(ctx, c.project));
      if (q <= 0) return 'not_needed';
      if (a.silver < q) return 'no_silver';
      return { silver: q };
    }
    const f = findOwned(ctx, a, c.key);
    if (!f) return 'no_item';
    if (f.e.uid) return 'not_tradable';
    const left = needLeft(ctx, c.project, f.e.item);
    if (left <= 0) return 'not_needed';
    const q = Math.min(c.qty ?? qtyOf(f.e), qtyOf(f.e), left);
    if (!okQty(q)) return 'bad_qty';
    return { f, q };
  },
  execute(ctx, a, c, p) {
    if (p.silver) {
      a.silver -= p.silver;
      contribute(ctx, c.project, { kind: 'actor', id: a.id }, { silver: p.silver });
      return;
    }
    const e = takeQty(p.f.list, keyOf(p.f.e), p.q);
    contribute(ctx, c.project, { kind: 'actor', id: a.id }, { item: e.item, qty: e.qty });
  },
};

// ── 퀘스트(v0.5) ────────────────────────────────────
// NPC와 대화: 이 NPC와 이야기해야 넘어가는 퀘스트 단계를 넘긴다(없으면 그냥 인사)
// 오가는 배(v0.9): 길이 열린 뒤(ferry 퀘스트를 받았거나 끝냄)엔 언제든 탄다
const FERRY = {
  validate(ctx, a, c) {
    const o = ctx.data.objects[c.obj];
    if (!o?.ferry || !o.cross) return 'bad_args';
    const Q = a.quests;
    if (!(Q?.active?.[o.ferry] || Q?.done?.[o.ferry] != null)) return 'locked';
    const p = objPos(ctx, c.obj);
    if (!p || Math.hypot(p.x - a.x, p.z - a.z) > USE_RANGE) return 'too_far';
    return { o };
  },
  execute(ctx, a, c, p) {
    crossTo(ctx, a, p.o.cross, { ferry: true });
  },
};

// ── 조합(v0.8.1) ────────────────────────────────
// 조합 일은 게시판 앞에서 한다(창고는 창고 앞에서)
const boardAt = (ctx, a) => ctx.statics.find((o) => o.kind === 'board' && Math.hypot(o.x - a.x, o.z - a.z) <= BOARD_RANGE) || null;
function guildMember(ctx, a) {
  const g = guildOf(ctx, a);
  return g || 'no_guild';
}

const GUILD_CREATE = {
  validate(ctx, a, c) {
    if (!isUnlocked(ctx, a, 'guild')) return 'locked';
    if (a.guild) return 'has_guild';
    const b = boardAt(ctx, a);
    if (!b) return 'too_far';
    const name = String(c.name || '').trim().slice(0, 14);
    if (name.length < 2) return 'bad_name';
    if (Object.values(ctx.state.guilds || {}).some((g) => g.name === name)) return 'name_taken';
    if (a.silver < ctx.data.guilds.create.silver) return 'no_silver';
    return { name, at: b.at };
  },
  execute(ctx, a, c, p) {
    a.silver -= ctx.data.guilds.create.silver;
    const g = newGuild(ctx, a, p.name, p.at);
    ctx.emit('guild.create', { actor: a.id, guild: g.id, name: g.name });
  },
};

const GUILD_JOIN = {
  validate(ctx, a, c) {
    if (!isUnlocked(ctx, a, 'guild')) return 'locked';
    if (a.guild) return 'has_guild';
    if (!boardAt(ctx, a)) return 'too_far';
    const g = ctx.state.guilds?.[c.guild];
    if (!g) return 'bad_args';
    if (g.members.length >= ctx.data.guilds.maxSize) return 'guild_full';
    return { g };
  },
  execute(ctx, a, c, p) {
    p.g.members.push(a.id);
    a.guild = p.g.id;
    trimAgents(ctx, p.g);
    ctx.emit('guild.join', { actor: a.id, guild: p.g.id });
  },
};

const GUILD_LEAVE = {
  validate(ctx, a) {
    const g = guildMember(ctx, a);
    return typeof g === 'string' ? g : { g };
  },
  execute(ctx, a, c, p) {
    const g = p.g;
    g.members = g.members.filter((id) => id !== a.id);
    a.guild = null;
    if (!g.members.length) {
      delete ctx.state.guilds[g.id]; // 사람이 없으면 조합은 흩어진다(AI만 남기지 않는다)
      ctx.emit('guild.disband', { guild: g.id, name: g.name });
    } else if (g.founder === a.id) g.founder = g.members[0];
    ctx.emit('guild.leave', { actor: a.id, guild: g.id });
  },
};

// AI 개척민 들이기: 사람 빈자리만큼(보충)
const GUILD_HIRE = {
  validate(ctx, a, c) {
    const g = guildMember(ctx, a);
    if (typeof g === 'string') return g;
    if (!boardAt(ctx, a)) return 'too_far';
    if (g.agents.length >= aiRoom(ctx, g)) return 'ai_full';
    if (!hireable(ctx, g).some((x) => x.id === c.agent)) return 'bad_args';
    return { g };
  },
  execute(ctx, a, c, p) {
    p.g.agents.push(c.agent);
    ctx.emit('guild.hire', { actor: a.id, guild: p.g.id, agent: c.agent });
  },
};
const GUILD_DISMISS = {
  validate(ctx, a, c) {
    const g = guildMember(ctx, a);
    if (typeof g === 'string') return g;
    if (!g.agents.includes(c.agent)) return 'bad_args';
    return { g };
  },
  execute(ctx, a, c, p) {
    p.g.agents = p.g.agents.filter((x) => x !== c.agent);
    ctx.emit('guild.agentLeft', { guild: p.g.id, agent: c.agent });
  },
};

// 일감 채우기: 가방·그 마을 창고에서 넣고, 넣은 만큼 은화를 받는다
const GUILD_GIVE = {
  validate(ctx, a, c) {
    const g = guildMember(ctx, a);
    if (typeof g === 'string') return g;
    if (!boardAt(ctx, a)) return 'too_far';
    rollJobs(ctx, g);
    const job = g.jobs.find((j) => j.id === c.job);
    if (!job || job.done) return 'bad_args';
    const lists = reachable(ctx, a);
    const have = countItem(lists, job.item);
    const n = Math.min(have, job.qty - job.got, Math.max(1, c.qty | 0 || have));
    if (n <= 0) return 'need_items';
    return { g, job, lists, n };
  },
  execute(ctx, a, c, p) {
    takeNeeds(p.lists, { [p.job.item]: p.n });
    const put = jobProgress(ctx, p.g, p.job, p.n, a.id);
    a.silver += put * p.job.pay;
    ctx.emit('guild.give', { actor: a.id, guild: p.g.id, item: p.job.item, qty: put, silver: put * p.job.pay });
  },
};

// 조합 창고: 어느 마을 창고 앞에서든 같이 쓴다
const GUILD_PUT = {
  validate(ctx, a, c) {
    const g = guildMember(ctx, a);
    if (typeof g === 'string') return g;
    if (!stationFor(ctx, a, 'storage')) return 'not_at_storage';
    const e = a.bag.find((x) => keyOf(x) === c.key);
    if (!e) return 'no_item';
    const qty = e.uid ? 1 : Math.min(e.qty, Math.max(1, c.qty | 0 || e.qty));
    const probe = e.uid ? e : { ...e, qty };
    if (g.store.length + slotsNeeded(g.store, [probe]) > storeCap(ctx, g)) return 'guild_store_full';
    return { g, e, qty };
  },
  execute(ctx, a, c, p) {
    if (p.e.uid) { a.bag.splice(a.bag.indexOf(p.e), 1); addEntry(p.g.store, p.e); }
    else { takeQty(a.bag, keyOf(p.e), p.qty); addEntry(p.g.store, { ...p.e, qty: p.qty }); }
    ctx.emit('guild.put', { actor: a.id, guild: p.g.id, item: p.e.item, qty: p.qty });
  },
};
const GUILD_TAKE = {
  validate(ctx, a, c) {
    const g = guildMember(ctx, a);
    if (typeof g === 'string') return g;
    if (!stationFor(ctx, a, 'storage')) return 'not_at_storage';
    const e = g.store.find((x) => keyOf(x) === c.key);
    if (!e) return 'no_item';
    const qty = e.uid ? 1 : Math.min(e.qty, Math.max(1, c.qty | 0 || e.qty));
    const probe = e.uid ? e : { ...e, qty };
    if (a.bag.length + slotsNeeded(a.bag, [probe]) > ctx.cfg.bag.slots) return 'bag_full';
    return { g, e, qty };
  },
  execute(ctx, a, c, p) {
    if (p.e.uid) { p.g.store.splice(p.g.store.indexOf(p.e), 1); addEntry(a.bag, p.e); }
    else { takeQty(p.g.store, keyOf(p.e), p.qty); addEntry(a.bag, { ...p.e, qty: p.qty }); }
    ctx.emit('guild.take', { actor: a.id, guild: p.g.id, item: p.e.item, qty: p.qty });
  },
};

// ── 내 집(v0.8) ─────────────────────────────────
// 재료는 가방과 그 집터 마을 창고에서 센다
const homeLists = (a, at) => [a.bag, storeOf(a, at)];
function takeNeeds(lists, needs) {
  for (const [item, need] of Object.entries(needs)) {
    let left = need;
    for (const list of lists) {
      for (const e of [...list]) {
        if (left <= 0) break;
        if (e.item !== item || e.uid) continue;
        const q = Math.min(left, e.qty);
        takeQty(list, keyOf(e), q);
        left -= q;
      }
    }
  }
}
const needsMet = (lists, needs) => Object.entries(needs).every(([it, n]) => countItem(lists, it) >= n);

const HOUSE_BUY = {
  validate(ctx, a, c) {
    const p = plotDef(ctx, c.plot);
    if (!p) return 'bad_args';
    if (!isUnlocked(ctx, a, 'housing')) return 'locked';
    if (ctx.state.houses[p.id]) return 'plot_taken';
    if (a.house) return 'has_house';
    if (!nearPlot(ctx, a, p.id)) return 'too_far';
    const t = ctx.data.housing.tiers[0];
    if (a.silver < t.silver) return 'no_silver';
    const lists = homeLists(a, p.at);
    if (!needsMet(lists, t.needs)) return 'need_items';
    return { p, t, lists };
  },
  execute(ctx, a, c, p) {
    takeNeeds(p.lists, p.t.needs);
    a.silver -= p.t.silver;
    ctx.state.houses[p.p.id] = { owner: a.id, tier: p.t.id, furniture: [], garden: [], restAt: -1e9, since: ctx.state.t };
    a.house = p.p.id;
    ctx.refreshStatics();
    ctx.emit('house.buy', { actor: a.id, plot: p.p.id, at: p.p.at, tier: p.t.id });
  },
};

const HOUSE_UPGRADE = {
  validate(ctx, a) {
    const h = homeOf(ctx, a);
    if (!h) return 'no_house';
    if (!nearPlot(ctx, a, a.house)) return 'too_far';
    const t = nextTier(ctx, h.tier);
    if (!t) return 'max_tier';
    if (a.silver < t.silver) return 'no_silver';
    const lists = homeLists(a, plotDef(ctx, a.house).at);
    if (!needsMet(lists, t.needs)) return 'need_items';
    return { h, t, lists };
  },
  execute(ctx, a, c, p) {
    takeNeeds(p.lists, p.t.needs);
    a.silver -= p.t.silver;
    p.h.tier = p.t.id;
    ctx.refreshStatics();
    ctx.emit('house.upgrade', { actor: a.id, plot: a.house, tier: p.t.id });
  },
};

// 가구 놓기·들이기: 가구는 가방에서 집으로, 집에서 가방으로
const HOUSE_PLACE = {
  validate(ctx, a, c) {
    const h = homeOf(ctx, a);
    if (!h) return 'no_house';
    if (!nearPlot(ctx, a, a.house)) return 'too_far';
    const e = a.bag.find((x) => x.uid && x.uid === c.uid);
    if (!e || ctx.data.items[e.item].stage !== 'furniture') return 'not_furniture';
    if (h.furniture.length >= tierDef(ctx, h.tier).furniture) return 'house_full';
    return { h, e };
  },
  execute(ctx, a, c, p) {
    a.bag.splice(a.bag.indexOf(p.e), 1);
    p.h.furniture.push(p.e);
    ctx.emit('house.place', { actor: a.id, item: p.e.item, comfort: comfortOf(p.h) });
  },
};
const HOUSE_TAKE = {
  validate(ctx, a, c) {
    const h = homeOf(ctx, a);
    if (!h) return 'no_house';
    if (!nearPlot(ctx, a, a.house)) return 'too_far';
    const e = h.furniture.find((x) => x.uid === c.uid);
    if (!e) return 'bad_args';
    if (a.bag.length + slotsNeeded(a.bag, [e]) > ctx.cfg.bag.slots) return 'bag_full';
    return { h, e };
  },
  execute(ctx, a, c, p) {
    p.h.furniture.splice(p.h.furniture.indexOf(p.e), 1);
    addEntry(a.bag, p.e);
    ctx.emit('house.take', { actor: a.id, item: p.e.item, comfort: comfortOf(p.h) });
  },
};

// 쉬기: 집에서 푹 쉬면 숙련 경험이 더 붙는다(아늑할수록 크게). 몇 시간마다 한 번
const REST = {
  validate(ctx, a) {
    const h = homeOf(ctx, a);
    if (!h) return 'no_house';
    if (!nearPlot(ctx, a, a.house)) return 'too_far';
    if (ctx.state.t - h.restAt < ctx.data.housing.rest.every) return 'rest_wait';
    return { h };
  },
  execute(ctx, a, c, p) {
    const R = ctx.data.housing.rest;
    p.h.restAt = ctx.state.t;
    const value = restValue(ctx, p.h);
    a.buffs = a.buffs.filter((b) => b.type !== 'rested');
    a.buffs.push({ type: 'rested', value, endsAt: ctx.state.t + R.minutes * 60 });
    if (a.cb) a.cb.hp = a.cb.maxHp;
    ctx.emit('rest', { actor: a.id, value, minutes: R.minutes, comfort: comfortOf(p.h) });
  },
};

// 텃밭: 씨앗(또는 버섯·갈대 섬유)을 심고, 다 자라면 거둔다
const GARDEN_PLANT = {
  validate(ctx, a, c) {
    const h = homeOf(ctx, a);
    if (!h) return 'no_house';
    if (!nearPlot(ctx, a, a.house)) return 'too_far';
    const i = c.slot | 0;
    if (i < 0 || i >= tierDef(ctx, h.tier).garden) return 'bad_args';
    if (h.garden[i]) return 'slot_busy';
    const pl = plantDef(ctx, c.item);
    if (!pl) return 'bad_args';
    const e = a.bag.find((x) => x.item === pl.item && !x.uid);
    if (!e) return 'need_items';
    return { h, i, pl, e };
  },
  execute(ctx, a, c, p) {
    takeQty(a.bag, keyOf(p.e), 1);
    p.h.garden[p.i] = { item: p.pl.item, at: ctx.state.t, ready: ctx.state.t + p.pl.grow };
    ctx.emit('garden.plant', { actor: a.id, item: p.pl.item, ready: p.h.garden[p.i].ready });
  },
};
const GARDEN_HARVEST = {
  validate(ctx, a, c) {
    const h = homeOf(ctx, a);
    if (!h) return 'no_house';
    if (!nearPlot(ctx, a, a.house)) return 'too_far';
    const g = h.garden[c.slot | 0];
    if (!g) return 'bad_args';
    if (ctx.state.t < g.ready) return 'not_ripe';
    return { h, i: c.slot | 0, pl: plantDef(ctx, g.item) };
  },
  execute(ctx, a, c, p) {
    const { rng } = ctx;
    const qty = rng.int(p.pl.qty[0], p.pl.qty[1]);
    const out = [{ item: p.pl.out, lot: null, bonus: null, qty }];
    if (p.pl.seed && rng.next() < p.pl.seed) out.push({ item: p.pl.item, lot: null, bonus: null, qty: 1 });
    const at = plotDef(ctx, a.house).at;
    for (const e of out) {
      if (a.bag.length + slotsNeeded(a.bag, [e]) <= ctx.cfg.bag.slots) addEntry(a.bag, e);
      else addEntry(storeOf(a, at), e);
    }
    p.h.garden[p.i] = null;
    addXp(ctx, a, 'harvesting', 6 + qty);
    ctx.emit('garden.harvest', { actor: a.id, item: p.pl.out, qty, seed: out.length > 1 });
  },
};

// 세력(v0.7): 지도자 곁에서 들거나 옮긴다. 옮기면 쌓은 영향력을 잃고, 며칠은 다시 못 옮긴다
const FACTION_JOIN = {
  validate(ctx, a, c) {
    const f = factionDef(ctx, c.faction);
    if (!f) return 'bad_args';
    if (!isUnlocked(ctx, a, 'faction')) return 'locked';
    if (factionOf(a) === f.id) return 'same_faction';
    if (!nearNpc(ctx, a, f.leader, TALK_RANGE) || !npcShown(ctx, a, f.leader)) return 'too_far';
    const wait = (a.faction?.since ?? -1e9) + ctx.data.factions.switchDays * ctx.clock.dayLen - ctx.state.t;
    if (factionOf(a) && wait > 0) return 'faction_cooldown';
    return { f };
  },
  execute(ctx, a, c, p) {
    const from = factionOf(a);
    const lost = a.faction?.inf || 0;
    a.faction = { id: p.f.id, inf: 0, since: ctx.state.t, done: {}, today: null };
    ctx.emit('faction.join', { actor: a.id, faction: p.f.id, from, lost });
  },
};

// 세력 의뢰: 오늘 지도자가 바라는 물건을 건넨다(가방·그 마을 창고). 하루 한 번씩
const FACTION_TASK = {
  validate(ctx, a, c) {
    const fid = factionOf(a);
    const f = factionDef(ctx, fid);
    if (!f) return 'no_faction';
    const task = tasksOf(ctx, fid).find((t) => t.id === c.task);
    if (!task) return 'bad_args';
    if (taskDone(ctx, a, task)) return 'task_done';
    if (!nearNpc(ctx, a, f.leader, TALK_RANGE)) return 'too_far';
    const lists = reachable(ctx, a);
    if (countItem(lists, task.item) < task.qty) return 'need_items';
    return { task, lists };
  },
  execute(ctx, a, c, p) {
    let left = p.task.qty;
    for (const list of p.lists) {
      for (const e of [...list]) {
        if (left <= 0) break;
        if (e.item !== p.task.item) continue;
        if (e.uid) { list.splice(list.indexOf(e), 1); left -= 1; continue; }
        const q = Math.min(left, e.qty);
        takeQty(list, keyOf(e), q);
        left -= q;
      }
    }
    a.faction.done[p.task.id] = ctx.state.t;
    // 지난날 기록은 버린다
    const today = `:${ctx.clock.day(ctx.state.t)}:`;
    for (const k of Object.keys(a.faction.done)) if (!k.includes(today)) delete a.faction.done[k];
    a.silver += p.task.silver;
    ctx.emit('faction.task', { actor: a.id, faction: a.faction.id, task: p.task.id, item: p.task.item, qty: p.task.qty, silver: p.task.silver });
    gainInfluence(ctx, a, p.task.inf, 'task');
  },
};

const TALK = {
  validate(ctx, a, c) {
    if (!ctx.data.npcs[c.npc]) return 'no_npc';
    const bad = alive(ctx, a);
    if (bad) return bad;
    if (!nearNpc(ctx, a, c.npc, TALK_RANGE) || !npcShown(ctx, a, c.npc)) return 'too_far';
    const due = talkReady(ctx, a, c.npc);
    if (!due.length && talkDue(ctx, a, c.npc).length) return 'need_items';
    return { due };
  },
  execute(ctx, a, c, p) {
    talk(ctx, a, p.due);
    ctx.emit('talk', { actor: a.id, npc: c.npc, quests: p.due });
  },
};

// 현상금·부가 퀘스트 받기: 주는 NPC 곁이나 게시판 앞에서
const QUEST_ACCEPT = {
  validate(ctx, a, c) {
    const q = ctx.data.quests[c.quest];
    if (!q) return 'no_quest';
    if (!a.quests || !available(ctx, a, q)) return 'not_available';
    if (q.giver === 'board') {
      if (!ctx.statics.some((o) => o.kind === 'board' && Math.hypot(o.x - a.x, o.z - a.z) <= BOARD_RANGE)) return 'too_far';
    } else if (q.giver && !nearNpc(ctx, a, q.giver)) return 'too_far';
    return { q };
  },
  execute(ctx, a, c, p) {
    startQuest(ctx, a, p.q.id);
  },
};

// 퀘스트 물체 쓰기(궤짝 열기·상자 되찾기·탁자 뒤지기)
const QUEST_USE = {
  validate(ctx, a, c) {
    if (!ctx.data.objects[c.obj]) return 'no_obj';
    const bad = alive(ctx, a);
    if (bad) return bad;
    const pos = objPos(ctx, c.obj);
    if (Math.hypot(a.x - pos.x, a.z - pos.z) > USE_RANGE) return 'too_far';
    const id = useDue(ctx, a, c.obj);
    if (!id) return 'not_quest_obj';
    return { id };
  },
  execute(ctx, a, c, p) {
    a.move = null;
    a.dest = null;
    a.nav = null;
    useObj(ctx, a, p.id, c.obj);
    // 배에 오르기(v0.6): 안개 벽 너머로 건너간다
    const cross = ctx.data.objects[c.obj].cross;
    if (cross) crossTo(ctx, a, cross, { ferry: !!ctx.data.objects[c.obj].ferry });
  },
};

// 화면에 따라다닐 퀘스트 고르기
const QUEST_TRACK = {
  validate(ctx, a, c) {
    if (!a.quests?.active[c.quest]) return 'no_quest';
    return {};
  },
  execute(ctx, a, c) {
    a.quests.track = c.quest;
  },
};

// 호감도(v1.6): 인사(하루 한 번, 말 걸 때 저절로)와 선물(하루 한 번, 가방에서 하나)
const GREET = {
  validate(ctx, a, c) {
    if (!bondable(ctx, c.npc)) return 'no_bond';
    if (!nearNpc(ctx, a, c.npc, TALK_RANGE) || !npcShown(ctx, a, c.npc)) return 'too_far';
    if (!greetDue(ctx, a, c.npc)) return 'already';
    return {};
  },
  execute(ctx, a, c) {
    greet(ctx, a, c.npc);
  },
};
const GIFT = {
  validate(ctx, a, c) {
    if (!bondable(ctx, c.npc)) return 'no_bond';
    const bad = alive(ctx, a);
    if (bad) return bad;
    if (!nearNpc(ctx, a, c.npc, TALK_RANGE) || !npcShown(ctx, a, c.npc)) return 'too_far';
    if (!giftDue(ctx, a, c.npc)) return 'gifted_today';
    const e = a.bag.find((x) => keyOf(x) === c.key);
    if (!e) return 'no_item';
    if (!giftable(ctx, e)) return 'not_giftable';
    return { e };
  },
  execute(ctx, a, c, p) {
    const item = p.e.item;
    takeQty(a.bag, c.key, 1);
    gift(ctx, a, c.npc, item);
  },
};

// 동행(v1.7): 단짝 사냥꾼·싸움꾼에게 "같이 가자"(하루 한 번). 돌려보내기는 언제든
const INVITE = {
  validate(ctx, a, c) {
    if (a.kind !== 'player') return 'bad_args';
    const p = perkOf(ctx, a, c.npc);
    if (!p || p.kind !== 'companion') return 'not_companion';
    const bad = alive(ctx, a);
    if (bad) return bad;
    if (allyOf(ctx, a)) return 'ally_out';
    if (!nearNpc(ctx, a, c.npc, TALK_RANGE) || !npcShown(ctx, a, c.npc)) return 'too_far';
    if (!inviteDue(ctx, a, c.npc)) return 'invited_today';
    return {};
  },
  execute(ctx, a, c) {
    spawnAlly(ctx, a, c.npc);
  },
};
const DISMISS_ALLY = {
  validate(ctx, a) {
    const al = allyOf(ctx, a);
    return al ? { al } : 'no_ally';
  },
  execute(ctx, a, c, p) {
    dismissAlly(ctx, p.al, 'sent');
  },
};

// 전투 레벨 능력치(v2.3): 점수 쓰기·되돌리기(은화)
const ATTR_SPEND = {
  validate(ctx, a, c) {
    const e = spendError(ctx, a, c.attr, c.n ?? 1);
    return e || {};
  },
  execute(ctx, a, c) {
    spend(ctx, a, c.attr, c.n ?? 1);
  },
};
const ATTR_RESET = {
  validate(ctx, a) {
    if (!spentOf(a)) return 'nothing';
    const cost = attrResetCost(ctx, a);
    if (a.silver < cost) return 'no_silver';
    return { cost };
  },
  execute(ctx, a, c, p) {
    a.silver -= p.cost;
    resetAttrs(ctx, a);
  },
};

// 원정(v2.3): 입구에서 시작, 언제든 그만두기(실패로 끝난다)
const EXP_START = {
  validate(ctx, a, c) {
    return startError(ctx, a, c.ex, c.mercs) || {};
  },
  execute(ctx, a, c) {
    startRun(ctx, a, c.ex, c.mercs || []);
  },
};
const EXP_LEAVE = {
  validate(ctx, a) {
    return runOf(ctx, a) ? {} : 'no_run';
  },
  execute(ctx, a) {
    leaveRun(ctx, a);
  },
};
// 설계도 읽기(v2.3): 가방의 설계도 한 장을 써서 제작법을 익힌다
const LEARN_BP = {
  validate(ctx, a, c) {
    const e = a.bag.find((x) => keyOf(x) === c.key);
    const def = e && ctx.data.items[e.item];
    if (!def?.blueprint) return 'bad_args';
    if (a.known?.[def.recipe]) return 'known';
    return { def };
  },
  execute(ctx, a, c, p) {
    takeQty(a.bag, c.key, 1);
    a.known = a.known || {};
    a.known[p.def.recipe] = 1;
    ctx.emit('blueprint.learn', { actor: a.id, item: p.def.id, recipe: p.def.recipe });
  },
};

// 필드 PvP 깃발(v2.6): on true/false
const PVP_FLAG = {
  validate(ctx, a, c) {
    if (a.kind !== 'player') return 'bad_args';
    return toggleError(ctx, a, !!c.on) || {};
  },
  execute(ctx, a, c) {
    toggle(ctx, a, !!c.on);
  },
};

// 영지전(v2.7): 선전포고·전쟁 물자·영토 씨앗
const WAR_DECLARE = {
  validate(ctx, a, c) {
    if (a.kind !== 'player') return 'bad_args';
    if (!isUnlocked(ctx, a, 'territory')) return 'locked';
    return declareError(ctx, a, c.settlement) || {};
  },
  execute(ctx, a, c) {
    a.silver -= WAR(ctx).declareSilver;
    declareWar(ctx, tagOf(ctx, a), c.settlement, { by: a.id });
  },
};
const WAR_SUPPLY = {
  validate(ctx, a, c) {
    const n = Math.floor(Number(c.qty) || 0);
    return supplyError(ctx, a, c.war, c.key, n) || { n };
  },
  execute(ctx, a, c, p) {
    supply(ctx, a, c.war, c.key, p.n);
  },
};
const SEED_PLANT = {
  validate(ctx, a, c) {
    return plantError(ctx, a, c.settlement) || {};
  },
  execute(ctx, a, c) {
    plant(ctx, a, c.settlement);
  },
};

const HANDLERS = {
  WAR_DECLARE, WAR_SUPPLY, SEED_PLANT, PVP_FLAG, EXP_START, EXP_LEAVE, LEARN_BP, ATTR_SPEND, ATTR_RESET, INVITE, DISMISS_ALLY, GREET, GIFT, TALK, QUEST_ACCEPT, QUEST_USE, QUEST_TRACK, FACTION_JOIN, FACTION_TASK,
  HOUSE_BUY, HOUSE_UPGRADE, HOUSE_PLACE, HOUSE_TAKE, REST, GARDEN_PLANT, GARDEN_HARVEST,
  FERRY, GUILD_CREATE, GUILD_JOIN, GUILD_LEAVE, GUILD_HIRE, GUILD_DISMISS, GUILD_GIVE, GUILD_PUT, GUILD_TAKE,
  MOVE, MOVE_INPUT, GATHER, CRAFT, EAT, STORE, TAKE, SET_AUTOPILOT, RECALL,
  MARKET_SELL, MARKET_BUY, MARKET_CANCEL, MARKET_DUMP, ORDER_DELIVER, REPAIR,
  EQUIP, UNEQUIP, ATTACK, DODGE, BLOCK, ABILITY, SWAP_WEAPON, MASTERY_LEARN, LOADOUT_SET, MASTERY_RESET, SKIN, SET_HOME, SHIP, CONTRIBUTE,
};

export function makeCommands(ctx) {
  function validate(cmd) {
    const h = HANDLERS[cmd?.type];
    if (!h) return { ok: false, error: 'unknown_command' };
    const actor = ctx.state.actors[cmd.actor];
    if (!actor) return { ok: false, error: 'no_actor' };
    const res = h.validate(ctx, actor, cmd);
    return typeof res === 'string' ? { ok: false, error: res } : { ok: true, plan: res };
  }

  function dispatch(cmd) {
    const v = validate(cmd);
    if (!v.ok) {
      ctx.emit('cmd.rejected', { actor: cmd?.actor ?? null, cmd: cmd?.type ?? null, reason: v.error });
      return { ok: false, error: v.error };
    }
    HANDLERS[cmd.type].execute(ctx, ctx.state.actors[cmd.actor], cmd, v.plan);
    return { ok: true };
  }

  // 화면·AI가 미리 가능 여부만 볼 때 (이벤트 없음)
  function check(cmd) {
    const v = validate(cmd);
    return v.ok ? { ok: true } : { ok: false, error: v.error };
  }

  // 제작 결과 미리보기: 걸작·조율을 뺀 예상 수치. 상태는 바꾸지 않는다.
  function preview(cmd) {
    const v = validate(cmd);
    if (!v.ok) return { ok: false, error: v.error };
    if (cmd.type !== 'CRAFT') return { ok: true };
    const p = v.plan;
    const r = p.r;
    const a = ctx.state.actors[cmd.actor];
    const level = a.skills[r.skill].level;
    if (r.type === 'craft') {
      const scores = craftScores(r, p.slotProps, { skillLevel: level, stationTier: p.station.tier }, ctx.cfg);
      const out = ctx.data.items[r.output.item];
      return {
        ok: true,
        scores,
        stats: convertStats(out.statConvert, scores),
        star: starOf(avg(Object.values(scores)), ctx.cfg.stars),
        masterwork: masterworkChance(Math.max(0, level - r.level), !!cmd.tune, ctx.cfg),
      };
    }
    const step = r.refineStep === false ? 0 : refineStep(level, !!p.catalyst, ctx.cfg);
    return { ok: true, props: p.slotProps[r.slots[0].key], step };
  }

  return { dispatch, check, preview };
}
