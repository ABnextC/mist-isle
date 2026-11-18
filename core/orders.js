// 주문 게시판: 마을(NPC)이 아침마다 의뢰를 붙인다. "★3 이상 구리주괴 6개, 개당 90은화" 같은 것.
// 누구든 조건에 맞는 물건을 넘기면 은화를 받는다. AI 개척민은 하루가 지난 의뢰만, 남은 양의 절반까지 채운다.

import { keyOf, takeQty, qtyOf } from './inventory.js';
import { entryStar, baseValue } from './market.js';

export function orderReward(ctx, item, minStar, premium, r) {
  const star = Math.max(2, minStar);
  return Math.max(1, Math.round(baseValue(ctx, item, star) * premium * r));
}

// 하루에 한 번: 끝난 의뢰를 치우고 빈자리를 채운다
export function dailyOrders(ctx) {
  const { state, cfg, rng } = ctx;
  const day = ctx.clock.day(state.t);
  state.orders = state.orders.filter((o) => o.left > 0 && o.expiresDay > day);
  const T = cfg.orders.templates;
  let guard = 0;
  let posted = 0;
  while (state.orders.length < cfg.orders.open && posted < (cfg.orders.perDay ?? Infinity) && guard++ < 40) {
    const total = T.reduce((s, t) => s + t.w, 0);
    let x = rng.next() * total;
    let tpl = T[0];
    for (const t of T) {
      x -= t.w;
      if (x <= 0) {
        tpl = t;
        break;
      }
    }
    if (state.orders.some((o) => o.item === tpl.item)) continue;
    const qty = rng.int(tpl.qty[0], tpl.qty[1]);
    const reward = orderReward(ctx, tpl.item, tpl.minStar, tpl.premium, 0.9 + rng.next() * 0.25);
    const o = {
      id: ctx.newId('O'), item: tpl.item, minStar: tpl.minStar, qty, left: qty, reward,
      postedDay: day, expiresDay: day + rng.int(cfg.orders.lifeDays[0], cfg.orders.lifeDays[1]),
    };
    state.orders.push(o);
    posted++;
    ctx.emit('order.posted', { order: o.id, item: o.item, qty, minStar: o.minStar, reward });
  }
}

// 그 의뢰에 넘길 수 있는 묶음(별이 낮은 것부터 써서 좋은 것은 아낀다)
export function deliverable(ctx, lists, order) {
  const out = [];
  const minDur = ctx.cfg.market.toolMinDur;
  for (const list of lists) {
    for (const e of list) {
      if (e.item !== order.item) continue;
      if (e.uid) {
        // 도구는 새것만: 부서졌거나, 닳았거나, 고친 적이 있으면 안 받는다
        const max = e.stats?.durability ?? e.dur;
        if (e.broken || e.repairs || e.dur < max * minDur) continue;
      }
      const star = entryStar(ctx, e);
      if (star < order.minStar) continue;
      out.push({ list, e, star });
    }
  }
  out.sort((a, b) => a.star - b.star);
  return out;
}

export function countDeliverable(ctx, lists, order) {
  return deliverable(ctx, lists, order).reduce((s, x) => s + qtyOf(x.e), 0);
}

// 넘기기. 검증은 부르는 쪽이 했다. 넘긴 개수와 받은 은화를 돌려준다.
export function deliver(ctx, kind, owner, wallet, lists, order, maxQty) {
  let want = Math.min(maxQty, order.left);
  let n = 0;
  for (const { list, e } of deliverable(ctx, lists, order)) {
    if (want <= 0) break;
    const q = Math.min(want, qtyOf(e));
    takeQty(list, keyOf(e), q);
    want -= q;
    n += q;
  }
  order.left -= n;
  const pay = n * order.reward;
  wallet.silver += pay;
  if (kind === 'actor' && wallet.stats) wallet.stats.orders = (wallet.stats.orders || 0) + n;
  ctx.emit('order.delivered', { owner, kind, order: order.id, item: order.item, qty: n, pay, done: order.left <= 0 });
  return { n, pay };
}
