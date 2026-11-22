// 정착지(v0.4): 인구·번영도·수요, 마을 사업, 작업대 유지비, 기여 명성, 창고 운송비.
// 수요는 마을(town)이 그 마을 거래소에 거는 사자 주문이다. 마을 지갑은 마르지 않고, 산 물건은 쓰여 사라진다.
// 사업에 낸 물자와 은화도 사라진다(은화의 큰 유출, 설계 8.1·9.1).

import { stationLayout, stationAt, settlementAt, standingTier } from './world.js';
import { placeBid, cancelOrder, baseValue, bookOf } from './market.js';

const round3 = (v) => Math.round(v * 1000) / 1000;

export function newSettlement(region, sdef, cfg) {
  return {
    id: sdef.id, name: sdef.name, region: region.id, x: sdef.x, z: sdef.z, radius: sdef.radius,
    stations: stationLayout(sdef),
    pop: sdef.pop ?? 10, pop0: sdef.pop ?? 10, cap: sdef.cap ?? 20,
    prosperity: cfg.settle.prosper.start,
    demand: { silver: 0, paid: 0, used: {}, want: {}, mult: {}, fill: null },
    upkeepLate: {},
  };
}

export function sdefOf(ctx, sid) {
  for (const r of ctx.data.lists.regions) for (const s of r.settlements) if (s.id === sid) return s;
  return null;
}

// ── 마을 사업 ─────────────────────────────────────
export function initProjects(data) {
  const out = {};
  for (const p of data.lists.projects) out[p.id] = { id: p.id, at: p.at, got: {}, silver: 0, done: false, doneDay: null, by: {} };
  return out;
}

export function projectOpen(ctx, pid) {
  const def = ctx.data.projects[pid];
  const p = ctx.state.projects[pid];
  if (!def || !p || p.done) return false;
  return (def.after || []).every((id) => ctx.state.projects[id]?.done);
}

export function openProjects(ctx, sid) {
  return ctx.data.lists.projects.filter((d) => d.at === sid && projectOpen(ctx, d.id)).map((d) => ctx.state.projects[d.id]);
}

// 그 사업이 더 받을 수 있는 양
export function needLeft(ctx, pid, item) {
  const def = ctx.data.projects[pid];
  const p = ctx.state.projects[pid];
  return Math.max(0, (def.needs[item] || 0) - (p.got[item] || 0));
}

export function silverLeft(ctx, pid) {
  return Math.max(0, ctx.data.projects[pid].silver - ctx.state.projects[pid].silver);
}

export function projectProgress(ctx, pid) {
  const def = ctx.data.projects[pid];
  const p = ctx.state.projects[pid];
  let need = def.silver;
  let got = Math.min(def.silver, p.silver);
  for (const [item, q] of Object.entries(def.needs)) {
    const v = baseValue(ctx, item, 2);
    need += q * v;
    got += Math.min(q, p.got[item] || 0) * v;
  }
  return need ? got / need : 1;
}

// 물자 기여의 명성 값: ★2 기본값
export const itemPoints = (ctx, item, qty) => baseValue(ctx, item, 2) * qty;

// 기여 기록과 완성. who: { kind, id }. 물자·은화는 부르는 쪽이 이미 덜어 냈다.
export function contribute(ctx, pid, who, { item = null, qty = 0, silver = 0 }) {
  const p = ctx.state.projects[pid];
  let points = 0;
  if (item && qty > 0) {
    p.got[item] = (p.got[item] || 0) + qty;
    points += itemPoints(ctx, item, qty);
  }
  if (silver > 0) {
    p.silver += silver;
    points += silver;
  }
  const k = who.kind + ':' + who.id;
  p.by[k] = (p.by[k] || 0) + points;
  if (who.kind === 'actor') {
    const a = ctx.state.actors[who.id];
    a.standing = a.standing || {};
    a.standing[p.at] = (a.standing[p.at] || 0) + points;
    a.stats.contrib = (a.stats.contrib || 0) + points;
  }
  ctx.emit('project.contrib', { project: pid, at: p.at, owner: who.id, kind: who.kind, item, qty, silver, points });
  const def = ctx.data.projects[pid];
  const full = silverLeft(ctx, pid) <= 0 && Object.keys(def.needs).every((it) => needLeft(ctx, pid, it) <= 0);
  if (full) finishProject(ctx, pid);
  return points;
}

// 사업 요구가 줄어(v0.5.2 숲머리 대장간) 이미 모인 것으로 다 찼으면 바로 끝낸다
export function finishIfFull(ctx, pid) {
  const def = ctx.data.projects[pid];
  const p = ctx.state.projects[pid];
  if (!def || !p || p.done) return false;
  const full = silverLeft(ctx, pid) <= 0 && Object.keys(def.needs).every((it) => needLeft(ctx, pid, it) <= 0);
  if (full) finishProject(ctx, pid);
  return full;
}

function finishProject(ctx, pid) {
  const { state, data } = ctx;
  const def = data.projects[pid];
  const p = state.projects[pid];
  const s = state.settlements[def.at];
  p.done = true;
  p.doneDay = ctx.clock.day(state.t);
  const e = def.effect;
  if (e.build) {
    const sdef = sdefOf(ctx, def.at);
    const st = sdef.stations.find((x) => x.build === pid);
    s.stations = s.stations.filter((x) => x.type !== e.build);
    s.stations.push(stationAt(sdef, st, e.tier ?? 1));
  }
  if (e.upgrade) {
    const st = s.stations.find((x) => x.type === e.upgrade);
    if (st) {
      st.base = Math.max(st.base ?? st.tier, e.tier);
      st.tier = st.base;
    }
  }
  if (e.cap) s.cap += e.cap;
  ctx.obstaclesDirty = true;
  if (ctx.refreshStatics) ctx.refreshStatics();
  const top = Object.entries(p.by).sort((x, y) => y[1] - x[1])[0];
  ctx.emit('project.done', { project: pid, at: def.at, top: top ? top[0] : null });
}

// ── 창고 운송비 ─────────────────────────────────────
export function shipFee(ctx, actor, from, entries) {
  const S = ctx.cfg.settle.ship;
  const rate = actor ? standingTier(ctx, actor, from).ship : S.rate;
  let v = 0;
  for (const e of entries) v += baseValue(ctx, e.item, e.star ?? 2) * (e.uid ? 1 : e.qty) * rate;
  return Math.max(S.min, Math.ceil(v));
}

// 2단계 작업대 하루 유지비(마을마다 다르다: 숲머리는 참나무 땔감, 등대 마을은 돌·자작나무)
export function upkeepOf(ctx, sid, type) {
  return ctx.cfg.settle.upkeep[sid]?.[type] || {};
}

// ── 하루 결산: 수요 채움 → 번영도 → 인구 → 유지비 → 오늘 수요 ──────────
// 섬 어딘가에서 만들 수 있는 물건인가: 2단계 작업대가 있어야 만드는 물건은 그런 작업대가 생긴 뒤에만 찾는다
export function producible(ctx, item) {
  const rs = ctx.data.lists.recipes.filter((r) => r.output.item === item);
  if (!rs.length) return true;
  return rs.some((r) => !(r.stationTier > 1) || Object.values(ctx.state.settlements).some((s) => s.stations.some((st) => st.type === r.station && st.tier >= r.stationTier)));
}

function demandTable(ctx, s) {
  const base = ctx.cfg.town.demand[s.id] || {};
  const want = {};
  const k = s.pop / s.pop0;
  for (const [item, q] of Object.entries(base)) if (producible(ctx, item)) want[item] = q * k;
  for (const st of s.stations) {
    if ((st.base ?? st.tier) < 2) continue;
    for (const [item, q] of Object.entries(upkeepOf(ctx, s.id, st.type))) want[item] = (want[item] || 0) + q;
  }
  return want;
}

export function settlementsDaily(ctx) {
  for (const s of Object.values(ctx.state.settlements)) settlementDaily(ctx, s);
}

export function settlementDaily(ctx, s) {
  const { cfg } = ctx;
  const G = cfg.town.grow;
  const P = cfg.settle.prosper;
  const d = s.demand;
  const book = bookOf(ctx, s.id);
  // 어제 남은 마을 사자를 거둔다
  const left = {};
  for (const b of book.bids.filter((o) => o.kind === 'town')) {
    left[b.item] = (left[b.item] || 0) + b.qty;
    cancelOrder(ctx, b.id);
  }
  // 품목별 채움 → 탄력 배율, 값 가중 채움률 → 번영도
  let wv = 0;
  let fv = 0;
  const filledOf = {};
  for (const [item, want] of Object.entries(d.want)) {
    const filled = Math.max(0, 1 - (left[item] || 0) / want);
    filledOf[item] = filled;
    const v = baseValue(ctx, item, 2) * want;
    wv += v;
    fv += v * filled;
    const k = d.mult[item] ?? 1;
    if (filled >= G.full) d.mult[item] = round3(Math.min(G.max, k * G.up));
    else if (filled < G.low) d.mult[item] = round3(Math.max(1, k * G.down));
  }
  if (wv > 0) {
    const fill = fv / wv;
    d.fill = round3(fill);
    s.prosperity = Math.round((s.prosperity + (fill * 100 - s.prosperity) * P.rate) * 10) / 10;
    const before = s.pop;
    if (s.prosperity >= P.grow && s.pop < s.cap) s.pop = Math.min(s.cap, s.pop + Math.max(1, Math.round(s.pop * P.up)));
    else if (s.prosperity < P.shrink) s.pop = Math.max(Math.ceil(s.pop0 * P.floor), s.pop - Math.max(1, Math.round(s.pop * P.down)));
    if (s.pop !== before) ctx.emit('settle.pop', { at: s.id, pop: s.pop, from: before, prosperity: s.prosperity });
  }
  // 2단계 작업대 유지비: 사흘 내리 절반도 못 채우면 1단계로 일한다. 하루라도 채우면 돌아온다.
  for (const st of s.stations) {
    const base = st.base ?? st.tier;
    if (base < 2) continue;
    const up = upkeepOf(ctx, s.id, st.type);
    const items = Object.keys(up);
    if (!items.length || d.fill == null) continue;
    const ok = items.every((it) => (filledOf[it] ?? 1) >= cfg.settle.upkeepLow);
    s.upkeepLate[st.type] = ok ? 0 : (s.upkeepLate[st.type] || 0) + 1;
    const tier = s.upkeepLate[st.type] >= cfg.settle.upkeepGrace ? 1 : base;
    if (tier !== st.tier) {
      st.tier = tier;
      ctx.emit(tier < base ? 'station.down' : 'station.up', { at: s.id, station: st.type, tier });
    }
  }
  // 오늘 수요를 건다
  const before = d.silver;
  d.silver = cfg.town.purse;
  d.paid += Math.max(0, cfg.town.purse - before);
  const day = ctx.clock.day(ctx.state.t);
  d.want = {};
  for (const [item, q] of Object.entries(demandTable(ctx, s))) {
    const qty = Math.max(1, Math.round(q * (d.mult[item] ?? 1)));
    // 외딴 마을은 들여오는 값을 더 쳐준다(숲머리 1.15, 등대 마을 0.9)
    const pf = typeof cfg.town.priceFactor === 'object' ? cfg.town.priceFactor[s.id] ?? 0.9 : cfg.town.priceFactor;
    const price = Math.max(1, Math.round(baseValue(ctx, item, 2) * pf));
    d.want[item] = qty;
    placeBid(ctx, s.id, 'town', s.id, item, 0, qty, price);
  }
  // 다음 결산 때 직접 거두어 채움을 잰다. 그 전에 기한이 지나 사라지지 않게 하루 더 둔다
  // (v0.3까지는 기한 정리가 먼저 돌아 채움이 늘 100%로 잡혔다)
  for (const b of book.bids) if (b.kind === 'town') b.expiresDay = day + 2;
}

// 마을 안에 서 있으면 그 마을, 아니면 null (명령 검증용)
export function hereId(ctx, actor) {
  return settlementAt(ctx, actor)?.id ?? null;
}
