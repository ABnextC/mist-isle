// 거래소: 정착지의 호가창. 같은 아이템도 별 등급(★)이 다르면 따로 거래된다.
//  - 팔자(ask): 물건을 맡기고 단가를 건다. 사자(bid): 은화를 맡기고 '★n 이상'을 단가와 함께 건다.
//  - 새 주문이 들어오면 걸려 있던 주문과 바로 맞춰 보고, 체결은 걸려 있던 주문의 값으로 한다.
//  - 수수료: 내놓을 때 1%, 팔릴 때 판매세 4%. 산 물건은 정착지 창고로 간다(설계 8.2).
//  - 상인 매입: 기본값의 15%로 언제든 넘길 수 있다(가격 하한선).
// 행위자(플레이어·봇)와 AI 개척민(econ 에이전트)이 같은 함수를 쓴다.

import { effectiveProps, avgProps, addEntry } from './inventory.js';
import { starOf } from './formulas.js';
import { agentMakerSold } from './systems/economy.js';

export const mkey = (item, star) => item + '|' + star;

export function entryStar(ctx, e) {
  if (e.uid) return e.star ?? 0;
  if (e.lot) return starOf(avgProps(effectiveProps(e, ctx.state.lots)), ctx.cfg.stars);
  return e.star ?? 0;
}

export function tradable(ctx, e) {
  if (e.uid || e.broken) return false;
  const kind = ctx.data.items[e.item].kind;
  return kind === 'material' || kind === 'consumable';
}

export function baseValue(ctx, item, star) {
  const v = ctx.data.items[item].value ?? 1;
  const m = ctx.cfg.market.starMult[star] ?? 1;
  return Math.max(1, Math.round(v * m));
}

// 기준가: 최근 체결가의 지수 평균. 거래가 없으면 아이템 값 × 별 배율.
export function refPrice(ctx, item, star) {
  return ctx.state.market.ref[mkey(item, star)] ?? baseValue(ctx, item, star);
}

// 수리비: 닳은 만큼 × 물건 값 × 수리 비율. 부서진 도구는 전부 닳은 것으로 친다(설계 7.5·8.1)
export function repairCost(ctx, e) {
  const max = e.maxDur ?? e.stats?.durability ?? 1;
  const worn = e.broken ? 1 : Math.max(0, 1 - (e.dur ?? 0) / max);
  return Math.max(1, Math.ceil(baseValue(ctx, e.item, e.star ?? 0) * ctx.cfg.repair.rate * worn));
}

export function npcPrice(ctx, item, star) {
  return Math.max(1, Math.floor(baseValue(ctx, item, star) * ctx.cfg.market.npcBuy));
}

export function emptyMarket() {
  return { nextOid: 1, asks: [], bids: [], ref: {}, trades: [], stats: {}, town: { silver: 0, paid: 0, used: {} } };
}

// ── 지갑과 받는 곳 ────────────────────────────────────
function party(ctx, kind, id) {
  if (kind === 'town') {
    // 마을(정착지 수요): 지갑은 마르지 않고, 산 물건은 쓰여 사라진다
    const town = ctx.state.market.town;
    return { obj: town, put: (e) => { town.used[e.item] = (town.used[e.item] || 0) + e.qty; } };
  }
  if (kind === 'agent') {
    const a = ctx.state.econ.agents.find((x) => x.id === id);
    return { obj: a, put: (e) => addEntry(a.stock, e) };
  }
  const a = ctx.state.actors[id];
  return { obj: a, put: (e) => addEntry(a.storage, e) };
}

function dayStats(ctx) {
  const day = ctx.clock.day(ctx.state.t);
  const s = ctx.state.market.stats;
  if (!s[day]) {
    s[day] = { trades: 0, volume: 0, units: 0, fees: 0, tax: 0, npc: 0, npcUnits: 0 };
    for (const k of Object.keys(s)) if (Number(k) < day - 14) delete s[k];
  }
  return s[day];
}

function record(ctx, { item, star, qty, price, buyer, seller }) {
  const m = ctx.state.market;
  const k = mkey(item, star);
  const prev = m.ref[k] ?? baseValue(ctx, item, star);
  const ema = ctx.cfg.market.refEma;
  m.ref[k] = Math.max(1, Math.round((prev * (1 - ema) + price * ema) * 100) / 100);
  m.trades.push({ t: ctx.state.t, item, star, qty, price, buyer, seller });
  if (m.trades.length > 240) m.trades.splice(0, m.trades.length - 240);
  const d = dayStats(ctx);
  d.trades++;
  d.units += qty;
  d.volume += qty * price;
  ctx.emit('market.trade', { item, star, qty, price, buyer, seller });
}

// 체결 한 번: 물건은 산 쪽 창고로, 값(세금 뺀)은 판 쪽 지갑으로
function settle(ctx, ask, bid, qty, price) {
  const tax = Math.floor(qty * price * ctx.cfg.market.salesTax);
  const seller = party(ctx, ask.kind, ask.owner);
  const buyer = party(ctx, bid.kind, bid.owner);
  seller.obj.silver += qty * price - tax;
  dayStats(ctx).tax += tax;
  buyer.put({ ...ask.entry, qty });
  ask.entry.qty -= qty;
  ask.qty -= qty;
  bid.qty -= qty;
  bid.escrow -= qty * price;
  // 사자 쪽이 더 높게 불렀으면 차액은 돌려준다
  if (bid.price > price) {
    const back = qty * (bid.price - price);
    bid.escrow -= back;
    buyer.obj.silver += back;
  }
  record(ctx, { item: ask.item, star: ask.star, qty, price, buyer: bid.owner, seller: ask.owner });
}

const byAsk = (a, b) => a.price - b.price || b.star - a.star || a.id - b.id;
const byBid = (a, b) => b.price - a.price || a.id - b.id;

function closeFilled(m) {
  m.asks = m.asks.filter((o) => o.qty > 0);
  m.bids = m.bids.filter((o) => o.qty > 0);
}

// 팔자: entry는 이미 주인 인벤토리에서 덜어 낸 사본이다
export function placeAsk(ctx, kind, owner, entry, price, { ioc = false } = {}) {
  const m = ctx.state.market;
  const p = party(ctx, kind, owner);
  const star = entryStar(ctx, entry);
  const fee = ioc ? 0 : Math.round(entry.qty * price * ctx.cfg.market.listingFee);
  p.obj.silver -= fee;
  dayStats(ctx).fees += fee;
  const ask = {
    id: m.nextOid++, kind, owner, item: entry.item, star, qty: entry.qty, price,
    entry: { ...entry }, t: ctx.state.t, expiresDay: ctx.clock.day(ctx.state.t) + ctx.cfg.market.orderDays,
  };
  let sold = 0;
  for (const bid of m.bids.filter((b) => b.item === ask.item && b.minStar <= star && b.price >= price && !(b.kind === kind && b.owner === owner)).sort(byBid)) {
    if (ask.qty <= 0) break;
    const q = Math.min(ask.qty, bid.qty);
    settle(ctx, ask, bid, q, bid.price);
    sold += q;
  }
  closeFilled(m);
  if (ask.qty > 0) {
    if (ioc) {
      p.put({ ...ask.entry, qty: ask.qty });
    } else {
      m.asks.push(ask);
      ctx.emit('market.listed', { owner, kind, side: 'ask', item: ask.item, star, qty: ask.qty, price });
    }
  }
  return { sold, rest: ioc ? 0 : ask.qty, id: ask.qty > 0 && !ioc ? ask.id : null };
}

// 사자: 은화를 맡긴다
export function placeBid(ctx, kind, owner, item, minStar, qty, price, { ioc = false } = {}) {
  const m = ctx.state.market;
  const p = party(ctx, kind, owner);
  p.obj.silver -= qty * price;
  const bid = {
    id: m.nextOid++, kind, owner, item, minStar, qty, price, escrow: qty * price,
    t: ctx.state.t, expiresDay: ctx.clock.day(ctx.state.t) + ctx.cfg.market.orderDays,
  };
  let bought = 0;
  for (const ask of m.asks.filter((a) => a.item === item && a.star >= minStar && a.price <= price && !(a.kind === kind && a.owner === owner)).sort(byAsk)) {
    if (bid.qty <= 0) break;
    const q = Math.min(bid.qty, ask.qty);
    settle(ctx, ask, bid, q, ask.price);
    bought += q;
    // 걸어 둔 팔자가 팔린 AI 개척민은 값을 조금 올린다
    if (ask.kind === 'agent') {
      const a = ctx.state.econ?.agents.find((x) => x.id === ask.owner);
      if (a) agentMakerSold(ctx, a, ask.item, ask.star, q);
    }
  }
  closeFilled(m);
  if (bid.qty > 0) {
    if (ioc) {
      p.obj.silver += bid.escrow;
    } else {
      m.bids.push(bid);
      ctx.emit('market.listed', { owner, kind, side: 'bid', item, star: minStar, qty: bid.qty, price });
    }
  } else if (bid.escrow > 0) {
    p.obj.silver += bid.escrow;
  }
  return { bought, rest: ioc ? 0 : bid.qty, id: bid.qty > 0 && !ioc ? bid.id : null };
}

export function cancelOrder(ctx, oid) {
  const m = ctx.state.market;
  const ai = m.asks.findIndex((o) => o.id === oid);
  if (ai >= 0) {
    const o = m.asks[ai];
    party(ctx, o.kind, o.owner).put({ ...o.entry, qty: o.qty });
    m.asks.splice(ai, 1);
    return true;
  }
  const bi = m.bids.findIndex((o) => o.id === oid);
  if (bi >= 0) {
    const o = m.bids[bi];
    party(ctx, o.kind, o.owner).obj.silver += o.escrow;
    m.bids.splice(bi, 1);
    return true;
  }
  return false;
}

// 하루에 한 번: 기한이 지난 주문을 거둬 돌려준다
export function expireOrders(ctx) {
  const day = ctx.clock.day(ctx.state.t);
  const m = ctx.state.market;
  for (const o of [...m.asks, ...m.bids]) if (o.expiresDay <= day) cancelOrder(ctx, o.id);
}

// 상인 매입(하한가): 물건을 은화로 바꾼다. entry는 이미 덜어 낸 사본
export function npcSell(ctx, kind, owner, entry) {
  const star = entryStar(ctx, entry);
  const price = npcPrice(ctx, entry.item, star);
  party(ctx, kind, owner).obj.silver += price * entry.qty;
  const d = dayStats(ctx);
  d.npc += price * entry.qty;
  d.npcUnits += entry.qty;
  ctx.emit('market.npc', { owner, kind, item: entry.item, star, qty: entry.qty, price });
  return price * entry.qty;
}

export function bestAsk(ctx, item, minStar = 0) {
  return ctx.state.market.asks.filter((a) => a.item === item && a.star >= minStar).sort(byAsk)[0] || null;
}

export function bestBid(ctx, item, star) {
  return ctx.state.market.bids.filter((b) => b.item === item && b.minStar <= star).sort(byBid)[0] || null;
}

export function ordersOf(ctx, owner) {
  const m = ctx.state.market;
  return [...m.asks.filter((o) => o.owner === owner).map((o) => ({ ...o, side: 'ask' })), ...m.bids.filter((o) => o.owner === owner).map((o) => ({ ...o, side: 'bid' }))];
}

// 마을의 하루 수요: 어제 남은 사자 주문을 거두고 새로 건다. 마을이 쓴 은화가 섬에 풀리는 주된 수입원이다.
// 어제 수요를 거의 다 채운 물건은 오늘 조금 더 산다(번영, 최대 3배). 반도 못 채우면 조금씩 줄인다(설계 8.3).
export function townDaily(ctx) {
  const m = ctx.state.market;
  const town = m.town;
  const G = ctx.cfg.town.grow;
  town.mult = town.mult || {};
  town.want = town.want || {};
  const left = {};
  for (const b of m.bids.filter((o) => o.kind === 'town')) {
    left[b.item] = (left[b.item] || 0) + b.qty;
    cancelOrder(ctx, b.id);
  }
  for (const [item, want] of Object.entries(town.want)) {
    const filled = 1 - (left[item] || 0) / want;
    const k = town.mult[item] ?? 1;
    if (filled >= G.full) town.mult[item] = Math.round(Math.min(G.max, k * G.up) * 1000) / 1000;
    else if (filled < G.low) town.mult[item] = Math.round(Math.max(1, k * G.down) * 1000) / 1000;
  }
  const before = town.silver;
  town.silver = ctx.cfg.town.purse;
  const day = ctx.clock.day(ctx.state.t);
  for (const [item, base] of Object.entries(ctx.cfg.town.demand)) {
    const qty = Math.max(1, Math.round(base * (town.mult[item] ?? 1)));
    const price = Math.max(1, Math.round(baseValue(ctx, item, 2) * ctx.cfg.town.priceFactor));
    town.want[item] = qty;
    placeBid(ctx, 'town', 'town', item, 0, qty, price);
  }
  for (const b of m.bids) if (b.kind === 'town') b.expiresDay = day + 1;
  town.paid += Math.max(0, ctx.cfg.town.purse - before);
}
