// 호감도(v1.6): 마을 사람과 정을 쌓는다.
// 행위자마다 a.bonds = { npc: { pts, greet: 날, gift: 날, known: { 물건: 'love'|'like'|'plain'|'hate' } } }
// 정은 인사(하루 한 번)·선물(하루 한 번)·그 사람 의뢰로 쌓인다. 단계가 오르면 말이 바뀌고,
// 이웃부터 좋아하는 것을 알려 주며, 단계마다 '마음의 부탁'(q.bond)이 열린다. 오늘의 부탁 보상도 단계만큼 늘어난다.
// 정을 쌓을 수 있는 사람은 gifts가 있는 마을 사람이다. 행위자마다 따로 쌓이므로 멀티플레이에서도 그대로 쓴다.

import { giveReward } from './quests.js';

export const B = (ctx) => ctx.data.config.bond;
export const bondable = (ctx, npc) => !!ctx.data.npcs[npc]?.gifts;
export const bondPts = (a, npc) => a?.bonds?.[npc]?.pts || 0;

export function tierOf(ctx, pts) {
  const T = B(ctx).tiers;
  let i = 0;
  for (let k = 0; k < T.length; k++) if (pts >= T[k].min) i = k;
  return i;
}
export const bondTier = (ctx, a, npc) => tierOf(ctx, bondPts(a, npc));
export const tierName = (ctx, t) => B(ctx).tiers[t]?.name || '';
// 다음 단계까지(끝 단계면 null)
export function nextTier(ctx, a, npc) {
  const t = bondTier(ctx, a, npc);
  const nx = B(ctx).tiers[t + 1];
  return nx ? { tier: t + 1, name: nx.name, min: nx.min, from: B(ctx).tiers[t].min } : null;
}

function rec(a, npc) {
  a.bonds = a.bonds || {};
  return (a.bonds[npc] ||= { pts: 0, greet: null, gift: null, known: {} });
}

export function gainBond(ctx, a, npc, amt, why) {
  if (!amt || !bondable(ctx, npc) || a.kind !== 'player') return 0;
  const r = rec(a, npc);
  const t0 = tierOf(ctx, r.pts);
  const before = r.pts;
  r.pts = Math.max(0, Math.min(B(ctx).max, r.pts + amt));
  const got = r.pts - before;
  const t1 = tierOf(ctx, r.pts);
  ctx.emit('bond.gain', { actor: a.id, npc, amt: got, why, pts: r.pts });
  for (let t = t0 + 1; t <= t1; t++) ctx.emit('bond.tier', { actor: a.id, npc, tier: t, name: tierName(ctx, t) });
  return got;
}

const today = (ctx) => ctx.clock.day(ctx.state.t);
export const greetDue = (ctx, a, npc) => bondable(ctx, npc) && a?.bonds?.[npc]?.greet !== today(ctx);
export const giftDue = (ctx, a, npc) => bondable(ctx, npc) && a?.bonds?.[npc]?.gift !== today(ctx);

export function greet(ctx, a, npc) {
  rec(a, npc).greet = today(ctx);
  const got = gainBond(ctx, a, npc, B(ctx).greet, 'greet');
  // 답례(v1.7): 친한 사이부터 인사하면 그 사람이 좋아하는 것 가운데 하나를 나눠 준다(하루 한 번)
  if (bondTier(ctx, a, npc) >= B(ctx).thanksTier) {
    const pool = (ctx.data.npcs[npc].gifts.like || []).filter((it) => ctx.data.items[it] && ctx.data.items[it].kind !== 'equipment');
    if (pool.length) {
      const item = pool[ctx.rng.int(0, pool.length - 1)];
      const qty = bondTier(ctx, a, npc) >= B(ctx).perkTier ? 3 : 2;
      const reward = giveReward(ctx, a, { id: `thanks:${npc}`, steps: [{ type: 'talk', npc }], reward: { items: [{ item, qty }] } });
      ctx.emit('bond.thanks', { actor: a.id, npc, item, qty, reward });
    }
  }
  return got;
}

// ── 달력·생일(v1.7): 한 달은 monthDays일. 그날이 생일이면 선물 정이 곱절 ──
export const dayOfMonth = (ctx, t = ctx.state.t) => (ctx.clock.day(t) % ctx.data.config.calendar.monthDays) + 1;
export const isBirthday = (ctx, npc, t) => ctx.data.npcs[npc]?.birthday === dayOfMonth(ctx, t);
export function daysToBirthday(ctx, npc) {
  const bd = ctx.data.npcs[npc]?.birthday;
  if (!bd) return null;
  const M = ctx.data.config.calendar.monthDays;
  return (bd - dayOfMonth(ctx) + M) % M;
}

// ── 단짝 혜택(v1.7): npc.perk — companion(동행)·market·ship·repair(값 깎기) ──
export function perkOf(ctx, a, npc) {
  const p = ctx.data.npcs[npc]?.perk;
  return p && bondTier(ctx, a, npc) >= B(ctx).perkTier ? p : null;
}
export function bondPerks(ctx, a) {
  if (!a?.bonds) return [];
  const out = [];
  for (const npc of Object.keys(a.bonds)) {
    const p = perkOf(ctx, a, npc);
    if (p) out.push({ ...p, npc });
  }
  return out;
}
export const inviteDue = (ctx, a, npc) => a?.bonds?.[npc]?.invite !== today(ctx);
export function markInvite(ctx, a, npc) {
  rec(a, npc).invite = today(ctx);
}

// 선물: 장비(낱개)·퀘스트 물건·nogift는 못 준다
export const giftable = (ctx, e) => {
  const d = ctx.data.items[e?.item];
  return !!d && !e.uid && !d.nogift;
};
export function giftReact(ctx, npc, item) {
  const g = ctx.data.npcs[npc].gifts;
  if (g.love?.includes(item)) return 'love';
  if (g.like?.includes(item)) return 'like';
  if (g.hate?.includes(item)) return 'hate';
  return 'plain';
}
export function gift(ctx, a, npc, item) {
  const r = rec(a, npc);
  const react = giftReact(ctx, npc, item);
  r.gift = today(ctx);
  r.known[item] = react;
  const birthday = isBirthday(ctx, npc);
  const amt = B(ctx).gift[react] * (birthday && react !== 'hate' ? B(ctx).birthdayMult : 1);
  const got = gainBond(ctx, a, npc, amt, 'gift');
  ctx.emit('bond.gift', { actor: a.id, npc, item, react, amt: got, birthday });
  return { react, amt: got };
}

// 좋아하는 것: 이웃부터는 그 사람이 직접 말해 준다(그 전엔 선물해 본 것만 안다)
export function knownLikes(ctx, a, npc) {
  const g = ctx.data.npcs[npc]?.gifts;
  if (!g) return { love: [], like: [], hate: [] };
  const k = a?.bonds?.[npc]?.known || {};
  const told = bondTier(ctx, a, npc) >= B(ctx).revealTier;
  const pick = (kind) => (g[kind] || []).filter((it) => told || k[it] === kind);
  return { love: pick('love'), like: pick('like'), hate: pick('hate'), told };
}

// 의뢰를 끝내면: 맡긴 사람과 정이 들고, 이야기 속에서 만난 사람과도 조금 든다
export function questBond(ctx, a, q) {
  const C = B(ctx).quest;
  if (q.giver && q.giver !== 'board') {
    const k = q.bond ? 'bond' : q.repeat === 'daily' ? 'daily' : q.faction ? 'faction' : q.chain ? 'chain' : q.kind === 'side' ? 'side' : null;
    if (k) gainBond(ctx, a, q.giver, C[k], 'quest');
  }
  const met = new Set(q.steps.filter((s) => s.type === 'talk' && s.npc !== '@leader' && s.npc !== q.giver).map((s) => s.npc));
  for (const n of met) gainBond(ctx, a, n, C.talk, 'quest');
}

// 오늘의 부탁 보상: 정의 단계만큼 은화가 는다(단계마다 10%)
export const dailyMult = (ctx, a, q) => (q.repeat === 'daily' && q.giver && bondable(ctx, q.giver) ? 1 + B(ctx).dailyBonus * bondTier(ctx, a, q.giver) : 1);

// 정이 든 뒤의 말: 지금 단계 이하에서 가장 높은 단계의 말
export function bondLines(ctx, a, npc) {
  const cb = ctx.data.npcs[npc]?.chatBond;
  if (!cb) return null;
  const t = bondTier(ctx, a, npc);
  let best = null;
  for (const [k, lines] of Object.entries(cb)) if (+k <= t && (!best || +k > best.k)) best = { k: +k, lines };
  return best?.lines || null;
}
