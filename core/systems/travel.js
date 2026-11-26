// 섬 건너기(v0.6): 안개 벽 너머 본섬으로. 안개는 안쪽으로만 열려서 되돌아올 수 없다.
// 떠나는 섬 장터에 걸어 둔 내 주문은 거두고, 그 섬 창고 짐은 새 섬 첫 마을(나루) 창고로 옮긴다.
import { regionAt } from '../terrain.js';
import { storeOf, objPos, siteXZ } from '../world.js';
import { addEntry } from '../inventory.js';
import { cancelOrder } from '../market.js';
import { strandedQuests, dropQuest } from './quests.js';

export function crossTo(ctx, a, rid, { ferry = false } = {}) {
  const { state, data } = ctx;
  const to = data.lists.regions.find((r) => r.id === rid);
  const from = regionAt(data.lists.regions, a.x);
  if (!to || to === from) return false;
  // 오가는 배(v0.9): 짐·주문·귀환 지점은 그대로, 자리만 옮긴다
  if (ferry) {
    // 맞은편 뱃머리(돌아가는 배가 있는 곳)에 내린다
    const back = Object.values(ctx.data.objects).find((o) => o.cross === from.id && o.ferry && regionAt(ctx.data.lists.regions, siteXZ(ctx.terrain, ctx.data.sites[o.site])[0]) === to);
    const [fx, fz] = back ? (({ x, z }) => [x, z + 2.5])(objPos(ctx, back.id)) : ctx.terrain.beachPoint(to.spawn[0], to.spawn[1]);
    Object.assign(a, { x: fx, z: fz, move: null, dest: null, nav: null, action: null, stuck: 0 });
    ctx.emit('cross', { actor: a.id, from: from.id, to: to.id, moved: 0, orders: 0, ferry: true });
    return true;
  }
  const leaving = from.settlements.map((s) => s.id);
  let orders = 0;
  for (const sid of leaving) {
    const b = state.market.books[sid];
    if (!b) continue;
    for (const o of [...b.asks, ...b.bids]) {
      if (o.kind === 'actor' && o.owner === a.id && cancelOrder(ctx, o.id)) orders++;
    }
  }
  const port = to.settlements[0].id;
  const dst = storeOf(a, port);
  let moved = 0;
  for (const sid of leaving) {
    const list = a.storages?.[sid];
    if (!list?.length) continue;
    for (const e of list) {
      addEntry(dst, e);
      moved += e.uid ? 1 : e.qty;
    }
    a.storages[sid] = [];
  }
  a.home = port;
  const [x, z] = ctx.terrain.beachPoint(to.spawn[0], to.spawn[1]);
  Object.assign(a, { x, z, move: null, dest: null, nav: null, action: null, stuck: 0 });
  // 두고 온 섬에서만 끝낼 수 있는 의뢰(v3.3.2)는 내려놓는다(일지에 막힌 채 남지 않게)
  const dropped = strandedQuests(ctx, a, to.island);
  for (const id of dropped) dropQuest(ctx, a, id, 'cross');
  ctx.emit('cross', { actor: a.id, from: from.id, to: to.id, moved, orders, dropped });
  return true;
}
