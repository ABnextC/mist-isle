// AI 개척민: 화면 밖에서 요약 계산하는 섬의 경제(설계 8.4).
// 게임 1시간마다: 일하는 시간이면 캐거나 만들고 → 사는 마을 거래소에 내놓거나 산다 → 하루 지난 그 마을 의뢰를 일부 채운다.
// 하루에 한 번: 음식을 먹고, 생활비를 낸다. 생활비와 남는 물자 일부는 마을 사업으로 간다(v0.4).
// 플레이어·봇과 같은 거래소 함수(market.js)를 쓴다.
//
// 값 정하기: 품목마다 내 배율(pf)을 들고 다닌다. 팔자가 오래 안 팔리면 내리고, 팔리면 올린다.
// 생산도 배율을 따른다. 값이 떨어진 물건은 덜 캐고 덜 만든다(공급이 수요를 따라간다).
//
// v0.4: 개척민마다 사는 마을(home)이 있다. 장인은 그 마을에 맞는 작업대가 있어야 일한다.
// 상인은 다른 마을에서 싸게 사서 운송비를 내고 자기 마을로 가져온다(두 마을 값이 운송비 근처로 묶인다).

import { regionAt } from '../terrain.js';
import { placeAsk, placeBid, npcSell, baseValue, entryStar, bestBid, tradable, bookOf, ordersOf, cancelOrder, mkey } from '../market.js';
import { deliver, countDeliverable, deliverable } from '../orders.js';
import { addEntry, keyOf, takeQty, qtyOf, effectiveProps, avgProps } from '../inventory.js';
import { convertStats, starOf } from '../formulas.js';
import { hasStation } from '../world.js';
import { openProjects, needLeft, silverLeft, contribute } from '../settlements.js';

const FAMILY_INPUT = { wood: 'lumber_drift', metal: 'ingot_copper', fiber: 'cloth_reed', stone: 'stone' };

function newAgent(ctx, a) {
  const { cfg, rng } = ctx;
  const first = Object.keys(ctx.state.settlements)[0];
  return {
    id: a.id, name: a.name, role: a.role, item: a.item || null, recipe: a.recipe || null, home: a.home || first,
    silver: a.role === 'trader' ? rng.int(cfg.econ.trader.startSilver[0], cfg.econ.trader.startSilver[1]) : rng.int(cfg.econ.startSilver[0], cfg.econ.startSilver[1]),
    stock: [], skill: rng.int(8, 24),
    made: 0, sold: 0, bought: 0, delivered: 0, shipped: 0, donated: 0, pf: {}, cost: {},
  };
}

export function initEcon(ctx) {
  return { agents: ctx.cfg.econ.agents.map((a) => newAgent(ctx, a)) };
}

// 저장 이관용: 데이터에 새로 생긴 개척민을 더한다
export function addMissingAgents(ctx) {
  const have = new Set(ctx.state.econ.agents.map((a) => a.id));
  for (const a of ctx.cfg.econ.agents) {
    if (have.has(a.id)) continue;
    ctx.state.econ.agents.push(newAgent(ctx, a));
  }
}

function inputsOf(ctx, recipe) {
  return recipe.slots.map((s) => ({ item: s.item || FAMILY_INPUT[s.family], qty: s.qty }));
}

function stockQty(agent, item) {
  return agent.stock.reduce((s, e) => s + (e.item === item ? qtyOf(e) : 0), 0);
}

const myOrders = (ctx, agent) => ordersOf(ctx, agent.id, 'agent');

const clampPf = (ctx, v) => Math.min(ctx.cfg.econ.pf.max, Math.max(ctx.cfg.econ.pf.min, v));

// 품목 전체의 값 신호: 별 등급별 배율의 평균
function signal(agent, item) {
  let s = 0;
  let n = 0;
  for (const [k, v] of Object.entries(agent.pf)) {
    if (k.startsWith(item + '|')) {
      s += v;
      n++;
    }
  }
  return n ? s / n : 1;
}

function supplyMult(ctx, agent, item) {
  return Math.min(1.4, Math.max(0.15, signal(agent, item) ** ctx.cfg.econ.elastic));
}

// 거래소에서 내 팔자가 팔렸을 때(market.js가 부른다): 값이 맞았으니 조금 올린다
export function agentMakerSold(ctx, agent, item, star, qty) {
  const k = item + '|' + star;
  agent.pf[k] = clampPf(ctx, (agent.pf[k] ?? 1) * ctx.cfg.econ.pf.fill);
  agent.sold += qty;
}

// 캘 곳: 노드 산지, 또는 그 물건을 떨구는 짐승 무리(사냥꾼)
function sourceLot(ctx, agent) {
  const { state, data, cfg, rng } = ctx;
  const type = Object.values(data.nodes).find((n) => n.item === agent.item);
  if (type) {
    const rid = state.settlements[agent.home]?.region;
    const veins = Object.values(state.veins).filter((v) => v.node === type.id && (!rid || v.region === rid));
    if (!veins.length) return null;
    let vein = veins.find((v) => v.common) || veins[0];
    const rot = veins.filter((v) => !v.common);
    if (rot.length && rng.chance(cfg.econ.rotatingShare)) {
      vein = rot.reduce((b, v) => (avgProps(state.lots[v.lot].props) > avgProps(state.lots[b.lot].props) ? v : b), rot[0]);
    }
    return vein.lot;
  }
  const hr = state.settlements[agent.home]?.region;
  const groups = Object.values(state.mobGroups)
    .filter((g) => g.lots?.[agent.item] && (!hr || regionAt(data.lists.regions, g.x).id === hr))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  if (!groups.length) return null;
  return groups[rng.int(0, groups.length - 1)].lots[agent.item];
}

function produce(ctx, agent) {
  const { cfg, rng } = ctx;
  // 팔리지 않고 쌓이면 쉬어 간다(재고 상한)
  if (stockQty(agent, agent.item) >= cfg.econ.stockCap) return;
  const lot = sourceLot(ctx, agent);
  if (!lot) return;
  const base = cfg.econ.rate[agent.item] ?? 5;
  const qty = Math.round(base * (0.75 + agent.skill / 60) * (0.85 + rng.next() * 0.3) * supplyMult(ctx, agent, agent.item));
  if (qty <= 0) return;
  addEntry(agent.stock, { item: agent.item, lot, bonus: null, qty });
  agent.made += qty;
}

// 장인은 사는 마을에 그 작업대(필요한 단계)가 있어야 일한다
export function stationReady(ctx, agent, r) {
  if (!r || r.station === 'hand') return true;
  const s = ctx.state.settlements[agent.home];
  return !!s && hasStation(s, r.station, r.stationTier || 1);
}

// 재료 한 단위에 낼 수 있는 최고가: 결과물을 팔아 남는 값으로 거꾸로 셈한다
function inputCap(ctx, agent, r, ins, item) {
  const out = r.output.item;
  const outValue = baseValue(ctx, out, 2) * signal(agent, out) * r.output.qty * (1 - ctx.cfg.market.salesTax) * ctx.cfg.econ.craftMargin;
  const inBase = ins.reduce((s, i) => s + baseValue(ctx, i.item, 2) * i.qty, 0);
  return Math.max(1, Math.floor(baseValue(ctx, item, 2) * outValue / inBase));
}

function craft(ctx, agent) {
  const { data, cfg, rng, state } = ctx;
  const r = data.recipes[agent.recipe];
  if (!r || !stationReady(ctx, agent, r)) return;
  const out = r.output.item;
  // 결과물이 쌓였거나 값이 떨어졌으면 쉬어 간다
  if (stockQty(agent, out) >= cfg.econ.stockCap) return;
  if (rng.next() > supplyMult(ctx, agent, out)) return;
  const ins = inputsOf(ctx, r);
  let batches = cfg.econ.craftBatches;
  for (const i of ins) batches = Math.min(batches, Math.floor(stockQty(agent, i.item) / i.qty));
  if (batches <= 0) {
    // 모자란 재료를 사자 주문으로 건다. 오래 안 채워진 주문은 거두고 다음엔 값을 올린다.
    const staleT = cfg.econ.staleHours * ctx.clock.hourLen;
    for (const o of myOrders(ctx, agent)) {
      if (o.minStar == null || state.t - o.t < staleT) continue;
      agent.pf['buy|' + o.item] = clampPf(ctx, (agent.pf['buy|' + o.item] ?? 1) * cfg.econ.pf.buyStale);
      cancelOrder(ctx, o.id);
    }
    for (const i of ins) {
      const need = i.qty * cfg.econ.craftBatches * 2 - stockQty(agent, i.item);
      if (need <= 0) continue;
      if (myOrders(ctx, agent).some((o) => o.item === i.item && o.minStar != null)) continue;
      const want = baseValue(ctx, i.item, 2) * (agent.pf['buy|' + i.item] ?? 1) * (0.92 + rng.next() * 0.1);
      const price = Math.max(1, Math.min(Math.round(want), inputCap(ctx, agent, r, ins, i.item)));
      const q = Math.min(need, Math.floor(agent.silver * 0.5 / price));
      if (q > 0) placeBid(ctx, agent.home, 'agent', agent.id, i.item, 0, q, price);
    }
    return;
  }
  // 재료를 덜어 내며 속성 평균을 잰다
  let propSum = 0;
  let propN = 0;
  let firstLot = null;
  for (const i of ins) {
    let need = i.qty * batches;
    for (const e of [...agent.stock]) {
      if (need <= 0) break;
      if (e.item !== i.item) continue;
      const q = Math.min(need, qtyOf(e));
      const props = effectiveProps(e, state.lots);
      if (Object.keys(props).length) {
        propSum += avgProps(props) * q;
        propN += q;
      }
      if (!firstLot && e.lot && data.items[e.item].family === data.items[out].family) firstLot = e.lot;
      takeQty(agent.stock, keyOf(e), q);
      need -= q;
    }
  }
  const score = propN ? propSum / propN : 40;
  // 재료를 구했으니 다음엔 조금 낮게 불러 본다
  for (const i of ins) agent.pf['buy|' + i.item] = clampPf(ctx, (agent.pf['buy|' + i.item] ?? 1) * cfg.econ.pf.buyDone);
  const def = data.items[out];
  const qty = r.output.qty * batches;
  if (def.kind === 'consumable') {
    const stats = convertStats(def.statConvert, Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, Math.round(score)])));
    addEntry(agent.stock, { item: out, lot: null, bonus: null, stats, star: starOf(score, cfg.stars), qty });
  } else if (def.kind === 'material') {
    addEntry(agent.stock, { item: out, lot: firstLot, bonus: null, qty });
  } else {
    return;
  }
  agent.made += qty;
}

// 남는 물건 팔기(사는 마을 거래소): 쓸 만한 사자 주문이 있으면 바로 넘기고, 없으면 내놓는다.
// 오래 안 팔린 팔자는 거둬서 값을 내려 다시 건다. 상인은 산 값 아래로는 팔지 않는다.
function sell(ctx, agent, keep) {
  const { rng, cfg, state } = ctx;
  const at = agent.home;
  const staleT = cfg.econ.staleHours * ctx.clock.hourLen;
  for (const o of myOrders(ctx, agent)) {
    if (!o.entry || state.t - o.t < staleT) continue;
    const k = o.item + '|' + o.star;
    agent.pf[k] = clampPf(ctx, (agent.pf[k] ?? 1) * cfg.econ.pf.stale);
    // 상인은 안 팔리는 물건의 '산 값'도 조금씩 내려 잡는다(돈이 영영 묶이지 않게)
    if (agent.cost[k]) agent.cost[k] = Math.round(agent.cost[k] * 0.97 * 100) / 100;
    cancelOrder(ctx, o.id);
  }
  let total = 0;
  for (const e of agent.stock) total += qtyOf(e);
  for (const e of [...agent.stock]) {
    if (!tradable(ctx, e) || keep.has(e.item)) continue;
    const star = entryStar(ctx, e);
    const k = e.item + '|' + star;
    // 값은 기본값에 내 배율을 곱해 정한다(체결가 평균을 따라가면 값이 끝없이 무너진다)
    let want = baseValue(ctx, e.item, star) * (agent.pf[k] ?? 1);
    if (agent.cost[k]) want = Math.max(want, agent.cost[k] * (1 + cfg.econ.trader.margin), agent.cost[k] + cfg.econ.trader.minGain);
    const bid = bestBid(ctx, at, e.item, star);
    const q = Math.min(qtyOf(e), 40);
    if (bid && bid.price >= want * 0.92) {
      const res = placeAsk(ctx, at, 'agent', agent.id, takeQty(agent.stock, keyOf(e), Math.min(q, bid.qty)), bid.price, { ioc: true });
      agent.sold += res.sold;
      if (res.sold > 0) agent.pf[k] = clampPf(ctx, (agent.pf[k] ?? 1) * cfg.econ.pf.hit);
      continue;
    }
    if (total > cfg.econ.stockCap * 2 && qtyOf(e) > 60 && !agent.cost[k]) {
      const dump = Math.floor(qtyOf(e) * 0.3);
      npcSell(ctx, 'agent', agent.id, takeQty(agent.stock, keyOf(e), dump));
      total -= dump;
      continue;
    }
    if (myOrders(ctx, agent).some((o) => o.item === e.item && o.star === star && o.entry)) continue;
    const price = Math.max(1, Math.round(want * (1 + rng.next() * cfg.econ.markup)));
    if (agent.silver < Math.round(q * price * cfg.market.listingFee)) continue;
    placeAsk(ctx, at, 'agent', agent.id, takeQty(agent.stock, keyOf(e), q), price);
  }
}

function noteCost(agent, item, star, price) {
  const k = item + '|' + star;
  agent.cost[k] = agent.cost[k] ? Math.round((agent.cost[k] * 0.7 + price * 0.3) * 100) / 100 : price;
}

const homeOrders = (ctx, agent) => ctx.state.orders.filter((o) => (o.at || agent.home) === agent.home);

// 상인: (1) 자기 마을 주문 게시판에 넘길 물건을 거래소에서 사 온다(시세 차익)
//       (2) 기본값보다 한참 싸게 나온 물건을 사 둔다(값이 무너질 때 받쳐 준다)
//       (3) 다른 마을에서 싸게 사서 운송비를 내고 자기 마을로 가져온다(v0.4)
function trade(ctx, agent) {
  const { state, cfg } = ctx;
  const at = agent.home;
  const m = bookOf(ctx, at);
  const T = cfg.econ.trader;
  let budget = Math.floor(agent.silver * T.budget);
  const day = ctx.clock.day(state.t);
  for (const o of homeOrders(ctx, agent)) {
    if (o.left <= 0 || day - o.postedDay < cfg.orders.agentDelayDays) continue;
    for (const a of m.asks.filter((x) => x.item === o.item && x.star >= o.minStar && x.owner !== agent.id).sort((x, y) => x.price - y.price)) {
      if (a.price > o.reward * T.orderGap || budget < a.price) break;
      const q = Math.min(a.qty, Math.ceil(o.left * cfg.orders.agentShare), Math.floor(budget / a.price));
      if (q <= 0) break;
      const res = placeBid(ctx, at, 'agent', agent.id, a.item, a.star, q, a.price, { ioc: true });
      budget -= res.bought * a.price;
      agent.bought += res.bought;
      if (res.bought > 0) noteCost(agent, a.item, a.star, a.price);
      if (deliverable(ctx, [agent.stock], o).length) {
        const d = deliver(ctx, 'agent', agent.id, agent, [agent.stock], o, Math.ceil(o.left * cfg.orders.agentShare));
        agent.delivered += d.n;
      }
      if (o.left <= 0) break;
    }
  }
  // 싼 물건 사 두기: 값어치가 너무 작은 물건은 반올림에 이문이 다 먹히니 건너뛴다.
  // 최근 체결가가 산 값보다 넉넉히 높을 때만 산다(되팔 곳이 있다는 뜻).
  const cheap = m.asks
    .filter((a) => !(a.kind === 'agent' && a.owner === agent.id)
      && baseValue(ctx, a.item, a.star) >= T.minValue
      && a.price <= baseValue(ctx, a.item, a.star) * T.buyBelow
      && (m.ref[a.item + '|' + a.star] ?? 0) >= a.price * (1 + T.margin) + T.minGain)
    .sort((a, b) => a.price / baseValue(ctx, a.item, a.star) - b.price / baseValue(ctx, b.item, b.star));
  for (const a of cheap) {
    // 한 품목에 묶이는 돈은 지갑의 1/4까지
    const held = stockQty(agent, a.item) * a.price;
    const room = Math.floor((agent.silver * 0.25 - held) / a.price);
    const q = Math.min(a.qty, room, Math.floor(budget / a.price));
    if (q <= 0) continue;
    const res = placeBid(ctx, at, 'agent', agent.id, a.item, a.star, q, a.price, { ioc: true });
    budget -= res.bought * a.price;
    agent.bought += res.bought;
    if (res.bought > 0) noteCost(agent, a.item, a.star, a.price);
  }
  budget = carry(ctx, agent, budget);
}

// 운송 차익: 우리 마을에서 실제로 팔리는 값(최근 체결가, 또는 마을 수요가 거는 값)보다
// 다른 마을 팔자 + 운송비가 넉넉히 싸면 사서 가져온다.
function carry(ctx, agent, budget) {
  const { state, cfg } = ctx;
  const T = cfg.econ.trader;
  const home = bookOf(ctx, agent.home);
  const rate = cfg.settle.ship.rate;
  const tax = cfg.market.salesTax;
  const sellAt = (item, star) => {
    const ref = home.ref[mkey(item, star)];
    const town = home.bids.filter((b) => b.kind === 'town' && b.item === item && b.minStar <= star).reduce((p, b) => Math.max(p, b.price), 0);
    return Math.max(ref ?? 0, town);
  };
  for (const [sid, book] of Object.entries(state.market.books)) {
    if (sid === agent.home) continue;
    // 다른 섬 장터로는 나르지 않는다(v0.6)
    if (state.settlements[sid]?.region !== state.settlements[agent.home]?.region) continue;
    const deals = book.asks
      .filter((a) => !(a.kind === 'agent' && a.owner === agent.id) && baseValue(ctx, a.item, a.star) >= T.minValue)
      .map((a) => ({ a, landed: a.price + baseValue(ctx, a.item, a.star) * rate, sell: sellAt(a.item, a.star) }))
      .filter((x) => x.sell * (1 - tax) >= x.landed * (1 + T.margin) + T.minGain)
      .sort((x, y) => x.landed / x.sell - y.landed / y.sell);
    for (const { a, landed } of deals) {
      const held = stockQty(agent, a.item) * a.price;
      const room = Math.floor((agent.silver * 0.25 - held) / landed);
      const q = Math.min(a.qty, room, Math.floor(budget / landed));
      if (q <= 0) continue;
      const res = placeBid(ctx, sid, 'agent', agent.id, a.item, a.star, q, a.price, { ioc: true });
      if (res.bought <= 0) continue;
      const fee = Math.max(cfg.settle.ship.min, Math.ceil(baseValue(ctx, a.item, a.star) * rate * res.bought));
      agent.silver -= fee;
      budget -= res.bought * a.price + fee;
      agent.bought += res.bought;
      agent.shipped += res.bought;
      noteCost(agent, a.item, a.star, a.price + fee / res.bought);
    }
  }
  return budget;
}

function fillOrders(ctx, agent) {
  const { state, cfg } = ctx;
  const day = ctx.clock.day(state.t);
  for (const o of homeOrders(ctx, agent)) {
    if (o.left <= 0 || day - o.postedDay < cfg.orders.agentDelayDays) continue;
    if (!countDeliverable(ctx, [agent.stock], o)) continue;
    const res = deliver(ctx, 'agent', agent.id, agent, [agent.stock], o, Math.ceil(o.left * cfg.orders.agentShare));
    agent.delivered += res.n;
  }
}

function trimOrders(ctx, agent) {
  const mine = myOrders(ctx, agent).sort((a, b) => a.id - b.id);
  const over = mine.length - ctx.cfg.market.maxOrdersPerOwner;
  if (over <= 0) return;
  // 오래된 주문부터 거둔다(물건·은화는 돌려받는다)
  for (const o of mine.slice(0, over)) cancelOrder(ctx, o.id);
}

export function econHourly(ctx) {
  const econ = ctx.state.econ;
  if (!econ) return;
  const [h0, h1] = ctx.cfg.econ.workHours;
  const h = ctx.clock.hour(ctx.state.t) % 24;
  const working = h >= h0 && h < h1;
  for (const agent of econ.agents) {
    agent.pf = agent.pf || {};
    agent.cost = agent.cost || {};
    // 사 온 음식은 되팔지 않는다(그 음식을 만드는 장인은 판다)
    const food = ctx.cfg.econ.food?.[agent.home] || 'food_berry';
    const keep = new Set(ctx.data.recipes[agent.recipe]?.output.item === food ? [] : [food]);
    if (agent.role === 'gatherer') {
      if (working) produce(ctx, agent);
    } else if (agent.role === 'crafter') {
      if (working) craft(ctx, agent);
      for (const i of inputsOf(ctx, ctx.data.recipes[agent.recipe])) keep.add(i.item);
    } else if (agent.role === 'trader') trade(ctx, agent);
    if (agent.role !== 'trader') donateGoods(ctx, agent);
    fillOrders(ctx, agent);
    sell(ctx, agent, keep);
    trimOrders(ctx, agent);
  }
}

// 마을 사업 차례: 데이터에 적힌 순서(숲머리 작업대부터). 섬 사람들이 같이 짓는다.
function projectsFor(ctx) {
  return ctx.data.lists.projects.map((d) => ctx.state.projects[d.id]).filter((p) => p && !p.done && openProjects(ctx, p.at).includes(p));
}

function donateSilver(ctx, agent, amount) {
  let left = amount;
  for (const p of projectsFor(ctx)) {
    if (left <= 0) break;
    const q = Math.min(left, silverLeft(ctx, p.id));
    if (q <= 0) continue;
    contribute(ctx, p.id, { kind: 'agent', id: agent.id }, { silver: q });
    agent.donated += q;
    left -= q;
  }
  // 열린 사업이 없으면 예전처럼 생활비로 사라진다
}

// 만든 물건 가운데 사업에 필요한 것의 일부(donate)를 낸다. 시간마다 쌓아 두었다가 한 개씩 낸다.
function donateGoods(ctx, agent) {
  const share = ctx.cfg.econ.donate ?? 0;
  if (share <= 0) return;
  agent.give = agent.give || {};
  const open = projectsFor(ctx);
  if (!open.length) return;
  const wanted = new Set(open.flatMap((p) => Object.keys(ctx.data.projects[p.id].needs).filter((it) => needLeft(ctx, p.id, it) > 0)));
  for (const item of wanted) {
    const have = stockQty(agent, item);
    if (have <= 0) continue;
    agent.give[item] = Math.round(((agent.give[item] || 0) + have * share) * 1000) / 1000;
    let q = Math.min(have, Math.floor(agent.give[item]));
    if (q <= 0) continue;
    for (const p of open) {
      if (q <= 0) break;
      const n = Math.min(q, needLeft(ctx, p.id, item));
      if (n <= 0) continue;
      let left = n;
      for (const e of [...agent.stock]) {
        if (left <= 0) break;
        if (e.item !== item || e.uid) continue;
        const take = Math.min(left, qtyOf(e));
        takeQty(agent.stock, keyOf(e), take);
        left -= take;
      }
      const given = n - left;
      if (given <= 0) continue;
      contribute(ctx, p.id, { kind: 'agent', id: agent.id }, { item, qty: given });
      agent.donated += given * baseValue(ctx, item, 2);
      agent.give[item] -= given;
      q -= given;
    }
  }
}

export function econDaily(ctx) {
  const econ = ctx.state.econ;
  if (!econ) return;
  const { cfg } = ctx;
  for (const agent of econ.agents) {
    // 먹기: 음식이 없으면 사는 마을 거래소에 사자 주문을 건다
    let eat = cfg.econ.eatPerDay;
    for (const e of [...agent.stock]) {
      if (eat <= 0) break;
      if (ctx.data.items[e.item].kind !== 'consumable') continue;
      const q = Math.min(eat, qtyOf(e));
      takeQty(agent.stock, keyOf(e), q);
      eat -= q;
    }
    const food = cfg.econ.food?.[agent.home] || 'food_berry';
    // 밑천이 바닥난 개척민은 사 먹지 않는다(들에서 주워 먹는 셈 친다). 일할 돈을 먹는 데 다 쓰지 않게(v0.4.1)
    if (eat > 0 && agent.silver >= cfg.econ.upkeepFloor && !myOrders(ctx, agent).some((o) => o.item === food && o.minStar != null)) {
      const price = Math.round(baseValue(ctx, food, 2) * 1.05);
      if (agent.silver >= price * 2) placeBid(ctx, agent.home, 'agent', agent.id, food, 0, 2, price);
    }
    // 상인에게 은화는 밑천이라 생활비 기준선이 높다. 생활비는 마을 사업으로 간다(없으면 사라진다).
    const over = agent.silver - (agent.role === 'trader' ? cfg.econ.trader.upkeepFloor : cfg.econ.upkeepFloor);
    if (over > 0) {
      const pay = Math.floor(over * cfg.econ.upkeep);
      agent.silver -= pay;
      donateSilver(ctx, agent, pay);
    }
  }
}
