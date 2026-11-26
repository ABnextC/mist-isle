// 거래소: 정착지마다 따로 있는 호가창(v0.4). 같은 아이템도 별 등급(★)이 다르면 따로 거래된다.
//  - 팔자(ask): 물건을 맡기고 단가를 건다. 사자(bid): 은화를 맡기고 '★n 이상'을 단가와 함께 건다.
//  - 새 주문이 들어오면 같은 마을에 걸려 있던 주문과 바로 맞춰 보고, 체결은 걸려 있던 주문의 값으로 한다.
//  - 수수료: 내놓을 때 1%, 팔릴 때 판매세 4%. 그 마을 기여 명성이 높으면 깎아 준다. 산 물건은 그 마을 창고로 간다(설계 8.2).
//  - 상인 매입: 기본값의 15%로 언제든 넘길 수 있다(가격 하한선).
// 행위자(플레이어·봇)와 AI 개척민(econ 에이전트), 마을(수요)이 같은 함수를 쓴다.

import { feeMult } from './systems/factions.js';
import { isMarketDay } from './systems/calendar.js';
import { effectiveProps, avgProps, addEntry } from './inventory.js';
import { starOf } from './formulas.js';
import { agentMakerSold } from './systems/economy.js';
import { storeOf, standingTier } from './world.js';

export const mkey = (item, star) => item + '|' + star;

export function entryStar(ctx, e) {
  if (e.uid) return e.star ?? 0;
  if (e.lot) return starOf(avgProps(effectiveProps(e, ctx.state.lots)), ctx.cfg.stars);
  return e.star ?? 0;
}

export function tradable(ctx, e) {
  if (e.uid || e.broken) return false;
  if (ctx.data.items[e.item].bind) return false; // 귀속(v3.3): 종결 재료는 사고팔지 않는다
  const kind = ctx.data.items[e.item].kind;
  return kind === 'material' || kind === 'consumable';
}

export function baseValue(ctx, item, star) {
  const v = ctx.data.items[item].value ?? 1;
  const m = ctx.cfg.market.starMult[star] ?? 1;
  return Math.max(1, Math.round(v * m));
}

// 기준가: 그 마을 최근 체결가의 지수 평균. 거래가 없으면 아이템 값 × 별 배율.
export function refPrice(ctx, at, item, star) {
  return bookOf(ctx, at).ref[mkey(item, star)] ?? baseValue(ctx, item, star);
}

// 수리비: 닳은 만큼 × 물건 값 × 수리 비율. 부서진 도구는 전부 닳은 것으로 친다(설계 7.5·8.1)
export function repairCost(ctx, e, a = null) {
  const max = e.maxDur ?? e.stats?.durability ?? 1;
  const worn = e.broken ? 1 : Math.max(0, 1 - (e.dur ?? 0) / max);
  return Math.max(1, Math.ceil(baseValue(ctx, e.item, e.star ?? 0) * ctx.cfg.repair.rate * worn * (a ? feeMult(ctx, a, 'repair') : 1)));
}

export function npcPrice(ctx, item, star) {
  return Math.max(1, Math.floor(baseValue(ctx, item, star) * ctx.cfg.market.npcBuy));
}

export function emptyMarket() {
  return { nextOid: 1, books: {}, stats: {} };
}

export const emptyBook = () => ({ asks: [], bids: [], ref: {}, trades: [] });

// 그 마을 호가창(없으면 만든다)
export function bookOf(ctx, at) {
  const m = ctx.state.market;
  return m.books[at] || (m.books[at] = emptyBook());
}

// 모든 마을의 주문(조회용)
export function allOrders(ctx) {
  const out = [];
  for (const b of Object.values(ctx.state.market.books)) out.push(...b.asks, ...b.bids);
  return out;
}

// ── 지갑과 받는 곳 ────────────────────────────────────
function party(ctx, kind, id, at) {
  if (kind === 'town') {
    // 마을(정착지 수요): 지갑은 마르지 않고, 산 물건은 쓰여 사라진다
    const d = ctx.state.settlements[id].demand;
    return { obj: d, put: (e) => { d.used[e.item] = (d.used[e.item] || 0) + e.qty; } };
  }
  if (kind === 'agent') {
    const a = ctx.state.econ.agents.find((x) => x.id === id);
    return { obj: a, put: (e) => addEntry(a.stock, e) };
  }
  const a = ctx.state.actors[id];
  return { obj: a, put: (e) => addEntry(storeOf(a, at), e) };
}

// 행위자는 그 마을 명성만큼 수수료·판매세를 덜 낸다
function rates(ctx, kind, owner, at) {
  if (kind !== 'actor') return { fee: ctx.cfg.market.listingFee, tax: ctx.cfg.market.salesTax };
  const t = standingTier(ctx, ctx.state.actors[owner], at);
  const m = feeMult(ctx, ctx.state.actors[owner], 'market') * (ctx.clock && isMarketDay(ctx) ? ctx.cfg.calendar.marketFee : 1); // 자유 선단 혜택(v0.7)·장날(v1.8)
  return { fee: t.fee * m, tax: t.tax * m };
}

export function listingFee(ctx, kind, owner, at, qty, price) {
  return Math.round(qty * price * rates(ctx, kind, owner, at).fee);
}

export function saleTax(ctx, kind, owner, at, gross) {
  return Math.floor(gross * rates(ctx, kind, owner, at).tax);
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

function record(ctx, at, { item, star, qty, price, buyer, seller, tax }) {
  const b = bookOf(ctx, at);
  const k = mkey(item, star);
  const prev = b.ref[k] ?? baseValue(ctx, item, star);
  const ema = ctx.cfg.market.refEma;
  b.ref[k] = Math.max(1, Math.round((prev * (1 - ema) + price * ema) * 100) / 100);
  b.trades.push({ t: ctx.state.t, item, star, qty, price, buyer, seller });
  if (b.trades.length > 240) b.trades.splice(0, b.trades.length - 240);
  const d = dayStats(ctx);
  d.trades++;
  d.units += qty;
  d.volume += qty * price;
  ctx.emit('market.trade', { at, item, star, qty, price, buyer, seller, tax });
}

// 체결 한 번: 물건은 산 쪽 창고로, 값(세금 뺀)은 판 쪽 지갑으로
function settle(ctx, at, ask, bid, qty, price) {
  const tax = saleTax(ctx, ask.kind, ask.owner, at, qty * price);
  const seller = party(ctx, ask.kind, ask.owner, at);
  const buyer = party(ctx, bid.kind, bid.owner, at);
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
  record(ctx, at, { item: ask.item, star: ask.star, qty, price, buyer: bid.owner, seller: ask.owner, tax });
}

const byAsk = (a, b) => a.price - b.price || b.star - a.star || a.id - b.id;
const byBid = (a, b) => b.price - a.price || a.id - b.id;

function closeFilled(b) {
  b.asks = b.asks.filter((o) => o.qty > 0);
  b.bids = b.bids.filter((o) => o.qty > 0);
}

// 팔자: entry는 이미 주인 인벤토리에서 덜어 낸 사본이다
export function placeAsk(ctx, at, kind, owner, entry, price, { ioc = false } = {}) {
  const m = ctx.state.market;
  const b = bookOf(ctx, at);
  const p = party(ctx, kind, owner, at);
  const star = entryStar(ctx, entry);
  const fee = ioc ? 0 : listingFee(ctx, kind, owner, at, entry.qty, price);
  p.obj.silver -= fee;
  dayStats(ctx).fees += fee;
  const ask = {
    id: m.nextOid++, at, kind, owner, item: entry.item, star, qty: entry.qty, price,
    entry: { ...entry }, t: ctx.state.t, expiresDay: ctx.clock.day(ctx.state.t) + ctx.cfg.market.orderDays,
  };
  let sold = 0;
  for (const bid of b.bids.filter((x) => x.item === ask.item && x.minStar <= star && x.price >= price && !(x.kind === kind && x.owner === owner)).sort(byBid)) {
    if (ask.qty <= 0) break;
    const q = Math.min(ask.qty, bid.qty);
    settle(ctx, at, ask, bid, q, bid.price);
    sold += q;
  }
  closeFilled(b);
  if (ask.qty > 0) {
    if (ioc) {
      p.put({ ...ask.entry, qty: ask.qty });
    } else {
      b.asks.push(ask);
      ctx.emit('market.listed', { at, owner, kind, side: 'ask', item: ask.item, star, qty: ask.qty, price });
    }
  }
  return { sold, rest: ioc ? 0 : ask.qty, id: ask.qty > 0 && !ioc ? ask.id : null };
}

// 사자: 은화를 맡긴다
export function placeBid(ctx, at, kind, owner, item, minStar, qty, price, { ioc = false } = {}) {
  const m = ctx.state.market;
  const b = bookOf(ctx, at);
  const p = party(ctx, kind, owner, at);
  p.obj.silver -= qty * price;
  const bid = {
    id: m.nextOid++, at, kind, owner, item, minStar, qty, price, escrow: qty * price,
    t: ctx.state.t, expiresDay: ctx.clock.day(ctx.state.t) + ctx.cfg.market.orderDays,
  };
  let bought = 0;
  for (const ask of b.asks.filter((x) => x.item === item && x.star >= minStar && x.price <= price && !(x.kind === kind && x.owner === owner)).sort(byAsk)) {
    if (bid.qty <= 0) break;
    const q = Math.min(bid.qty, ask.qty);
    settle(ctx, at, ask, bid, q, ask.price);
    bought += q;
    // 걸어 둔 팔자가 팔린 AI 개척민은 값을 조금 올린다
    if (ask.kind === 'agent') {
      const a = ctx.state.econ?.agents.find((x) => x.id === ask.owner);
      if (a) agentMakerSold(ctx, a, ask.item, ask.star, q);
    }
  }
  closeFilled(b);
  if (bid.qty > 0) {
    if (ioc) {
      p.obj.silver += bid.escrow;
    } else {
      b.bids.push(bid);
      ctx.emit('market.listed', { at, owner, kind, side: 'bid', item, star: minStar, qty: bid.qty, price });
    }
  } else if (bid.escrow > 0) {
    p.obj.silver += bid.escrow;
  }
  return { bought, rest: ioc ? 0 : bid.qty, id: bid.qty > 0 && !ioc ? bid.id : null };
}

// 거두기: 물건은 그 마을 창고(AI는 재고)로, 맡긴 은화는 지갑으로
export function cancelOrder(ctx, oid) {
  for (const [at, b] of Object.entries(ctx.state.market.books)) {
    const ai = b.asks.findIndex((o) => o.id === oid);
    if (ai >= 0) {
      const o = b.asks[ai];
      party(ctx, o.kind, o.owner, at).put({ ...o.entry, qty: o.qty });
      b.asks.splice(ai, 1);
      return true;
    }
    const bi = b.bids.findIndex((o) => o.id === oid);
    if (bi >= 0) {
      const o = b.bids[bi];
      party(ctx, o.kind, o.owner, at).obj.silver += o.escrow;
      b.bids.splice(bi, 1);
      return true;
    }
  }
  return false;
}

export function findOrder(ctx, oid) {
  for (const b of Object.values(ctx.state.market.books)) {
    const o = b.asks.find((x) => x.id === oid) || b.bids.find((x) => x.id === oid);
    if (o) return o;
  }
  return null;
}

// 하루에 한 번: 기한이 지난 주문을 거둬 돌려준다
export function expireOrders(ctx) {
  const day = ctx.clock.day(ctx.state.t);
  for (const o of allOrders(ctx)) if (o.expiresDay <= day) cancelOrder(ctx, o.id);
}

// 상인 매입(하한가): 물건을 은화로 바꾼다. entry는 이미 덜어 낸 사본
export function npcSell(ctx, kind, owner, entry) {
  const star = entryStar(ctx, entry);
  const price = npcPrice(ctx, entry.item, star);
  party(ctx, kind, owner, null).obj.silver += price * entry.qty;
  const d = dayStats(ctx);
  d.npc += price * entry.qty;
  d.npcUnits += entry.qty;
  ctx.emit('market.npc', { owner, kind, item: entry.item, star, qty: entry.qty, price });
  return price * entry.qty;
}

export function bestAsk(ctx, at, item, minStar = 0) {
  return bookOf(ctx, at).asks.filter((a) => a.item === item && a.star >= minStar).sort(byAsk)[0] || null;
}

export function bestBid(ctx, at, item, star) {
  return bookOf(ctx, at).bids.filter((b) => b.item === item && b.minStar <= star).sort(byBid)[0] || null;
}

// 그 주인의 주문(모든 마을). kind를 주면 그 종류만
export function ordersOf(ctx, owner, kind = null) {
  const out = [];
  for (const b of Object.values(ctx.state.market.books)) {
    for (const o of b.asks) if (o.owner === owner && (!kind || o.kind === kind)) out.push(o);
    for (const o of b.bids) if (o.owner === owner && (!kind || o.kind === kind)) out.push(o);
  }
  return out;
}
