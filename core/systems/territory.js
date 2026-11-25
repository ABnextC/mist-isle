// 영지전(v2.7): 본섬 마을 다섯을 조합이 다스린다. 처음엔 AI 조합 셋이 나눠 쥐고 있다.
// 흐름: 선전포고(은화) → 준비(게임 하루, 양쪽이 전쟁 물자를 모은다) → 공성(깃발 차지).
// 공성 때 조합원이 그 마을 가까이 있으면 직접 싸운다(실전). 없으면 물자로 셈해 끝난다(자동 판정).
// 실전: 마을 가운데 깃발 둘레에 공격·수비 양쪽 싸움꾼이 물결로 선다. 깃발 둘레에 공격 쪽만 있으면 차지가 오르고,
// 수비 쪽만 있으면 내려간다. 100이 되면 공격 쪽 승리, 시간이 다 되면 수비 쪽 승리.
// 싸움꾼은 다른 세력 개척자(rivals.js)와 같은 몸·손놀림을 쓰고, 편은 rival.war·rival.team으로 가른다.
// 영지 주인 조합원 혜택: 하루 세금, 거래소 수수료 할인, 영토 씨앗을 심으면 그 땅 채집량 +10%.

import { spawnRival } from './rivals.js';
import { addEntry, takeQty, findEntry } from '../inventory.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
export const W = (ctx) => ctx.cfg.war;
const TD = (ctx) => ctx.data.territory;

export const emptyTerritory = () => ({ holds: {}, wars: {}, nextAi: 0, log: [] });

export function initTerritory(ctx) {
  const st = (ctx.state.territory ??= emptyTerritory());
  for (const h of TD(ctx)?.holds || []) {
    if (st.holds[h.settlement]) continue;
    st.holds[h.settlement] = { owner: h.owner, since: ctx.state.t, blessed: false, cool: 0 };
  }
  if (!st.nextAi) st.nextAi = ctx.clock.day(ctx.state.t) + W(ctx).aiDeclareEvery;
}

// 주인 이름표: 'ai:<id>' 또는 'g:<조합 id>'
export const ownerTag = (g) => `g:${g.id}`;
export function ownerInfo(ctx, tag) {
  if (!tag) return { name: '주인 없음', color: '#888', icon: '·' };
  if (tag.startsWith('ai:')) {
    const a = TD(ctx).aiGuilds.find((x) => x.id === tag.slice(3));
    return { name: a?.name || tag, color: a?.color || '#888', icon: a?.icon || '🏴', ai: a };
  }
  const g = ctx.state.guilds?.[tag.slice(2)];
  return { name: g?.name || '사라진 조합', color: '#2fe0bd', icon: '🛡️', guild: g };
}
export const tagOf = (ctx, a) => (a?.guild && ctx.state.guilds?.[a.guild] ? `g:${a.guild}` : null);

export function warAt(ctx, sid) {
  return Object.values(ctx.state.territory?.wars || {}).find((w) => w.settlement === sid) || null;
}
export function warsOf(ctx, tag) {
  return Object.values(ctx.state.territory?.wars || {}).filter((w) => w.att === tag || w.def === tag);
}
// 실전 공성 중인 전쟁에서 이 사람의 편(att|def|null)
export function teamIn(ctx, a, war) {
  if (!war || war.phase !== 'siege' || !war.live) return null;
  if (a.rival?.war === war.id) return a.rival.team;
  const root = a.kind === 'ally' ? ctx.state.actors[a.ally?.owner] : a;
  const tag = tagOf(ctx, root);
  if (!tag) return null;
  if (Math.hypot(root.x - war.x, root.z - war.z) > W(ctx).nearR) return null;
  return tag === war.att ? 'att' : tag === war.def ? 'def' : null;
}
// 이 사람이 끼어 있는 실전 공성
export function liveWarOf(ctx, a) {
  if (a?.rival?.war) return ctx.state.territory?.wars[a.rival.war] || null;
  for (const w of Object.values(ctx.state.territory?.wars || {})) if (teamIn(ctx, a, w)) return w;
  return null;
}

// ── 물자 ──
export function supplyPoints(ctx, itemId) {
  const def = ctx.data.items[itemId];
  if (!def) return 0;
  for (const s of TD(ctx).supply) {
    if (s.item && s.item === itemId) return s.points;
    if (s.stage && s.stage === def.stage) return s.points;
  }
  return 0;
}

// ── 선전포고 ──
export function declareError(ctx, a, sid) {
  const st = ctx.state.territory;
  const h = st?.holds[sid];
  if (!h) return 'not_territory';
  const tag = tagOf(ctx, a);
  if (!tag) return 'no_guild';
  if (h.owner === tag) return 'own_territory';
  if (warAt(ctx, sid)) return 'war_on';
  if (warsOf(ctx, tag).length) return 'busy_war';
  if (h.cool > ctx.state.t) return 'war_cool';
  if (a.silver < W(ctx).declareSilver) return 'no_silver';
  return null;
}

export function declareWar(ctx, att, sid, { by = null } = {}) {
  const st = ctx.state.territory;
  const h = st.holds[sid];
  const s = ctx.state.settlements[sid];
  const id = ctx.newId('war');
  const T = ctx.cfg.time.secondsPerGameDay;
  const war = {
    id, settlement: sid, att, def: h.owner, by, phase: 'prep',
    at: r2(ctx.state.t + W(ctx).prepDays * T), until: 0,
    sup: { att: 0, def: 0 }, x: s.x, z: s.z, live: false, cap: 0, spawned: { att: 0, def: 0 }, left: { att: 0, def: 0 }, result: null,
  };
  st.wars[id] = war;
  ctx.emit('war.declare', { war: id, settlement: sid, att, def: h.owner, by, at: war.at });
  return war;
}

// 물자 넣기: 가방의 묶음에서 n개
export function supplyError(ctx, a, warId, key, n) {
  const war = ctx.state.territory?.wars[warId];
  if (!war) return 'no_war';
  if (war.phase !== 'prep') return 'war_started';
  const tag = tagOf(ctx, a);
  if (tag !== war.att && tag !== war.def) return 'not_in_war';
  const e = findEntry(a.bag, key);
  if (!e) return 'no_item';
  if (!(n > 0) || e.qty < n) return 'bad_args';
  if (!supplyPoints(ctx, e.item)) return 'not_supply';
  return null;
}
export function supply(ctx, a, warId, key, n) {
  const war = ctx.state.territory.wars[warId];
  const e = findEntry(a.bag, key);
  const pts = r2(supplyPoints(ctx, e.item) * n);
  const item = e.item;
  takeQty(a.bag, key, n);
  const side = tagOf(ctx, a) === war.att ? 'att' : 'def';
  war.sup[side] = r2(war.sup[side] + pts);
  ctx.emit('war.supply', { war: warId, actor: a.id, side, item, qty: n, points: pts, total: war.sup[side] });
}

// ── 공성 ──
function sideCount(ctx, war, side) {
  const P = W(ctx);
  const sup = war.sup[side];
  if (side === 'def') return Math.min(P.maxDefenders, P.baseDefenders + Math.floor(sup / P.defPerPoints));
  return Math.min(P.maxAttackers, P.baseAttackers + Math.floor(sup / P.attPerPoints));
}
const isAi = (tag) => !!tag?.startsWith('ai:');

// 사람이 지키는(또는 치는) 쪽은 AI 싸움꾼 대신 민병(물자만큼)을 세운다
function fighterCount(ctx, war, side) {
  const tag = war[side];
  if (isAi(tag)) return sideCount(ctx, war, side);
  return Math.min(W(ctx).maxMilitia, Math.floor(war.sup[side] / W(ctx).militiaPerPoints));
}

function bandFor(ctx, war, side) {
  const tag = war[side];
  const ai = isAi(tag) ? TD(ctx).aiGuilds.find((x) => x.id === tag.slice(3)) : null;
  const base = ai || TD(ctx).aiGuilds[0];
  const s = ctx.state.settlements[war.settlement];
  return {
    id: `war_${war.id}_${side}`, war: war.id, team: side, faction: ai ? ai.faction : null, color: ai ? ai.color : '#2fe0bd',
    name: ai ? ai.name : '우리 민병', level: base.level, score: base.score, weapons: base.weapons, armor: base.armor,
    potions: 1, read: 0.4, silver: [10, 30], tint: ai ? base.tint : { shirt: '#d8e8e0', vest: '#2a6e68', trousers: '#2b2f38', lthr: '#3a2a1a' },
    region: s.region, at: [war.x, war.z], spread: side === 'def' ? 6 : 22,
  };
}

function spawnWave(ctx, war, side) {
  const want = war.left[side];
  if (want <= 0) return;
  const alive = Object.values(ctx.state.actors).filter((x) => x.rival?.war === war.id && x.rival.team === side && x.cb.downUntil === 0).length;
  const n = Math.min(want, W(ctx).wave - alive);
  const band = bandFor(ctx, war, side);
  for (let i = 0; i < n; i++) {
    const slot = war.spawned[side]++;
    if (spawnRival(ctx, band, `${side}${slot}`)) war.left[side]--;
  }
}

function anyMemberNear(ctx, war) {
  for (const a of Object.values(ctx.state.actors)) {
    if (a.kind !== 'player') continue;
    const tag = tagOf(ctx, a);
    if ((tag === war.att || tag === war.def) && Math.hypot(a.x - war.x, a.z - war.z) <= W(ctx).nearR) return true;
  }
  return false;
}

function startSiege(ctx, war) {
  war.phase = 'siege';
  war.until = r2(ctx.state.t + W(ctx).siegeSec);
  war.live = anyMemberNear(ctx, war);
  if (!war.live) return resolveAuto(ctx, war);
  war.left.att = fighterCount(ctx, war, 'att');
  war.left.def = fighterCount(ctx, war, 'def');
  spawnWave(ctx, war, 'def');
  spawnWave(ctx, war, 'att');
  ctx.emit('war.siege', { war: war.id, settlement: war.settlement, att: war.att, def: war.def, until: war.until, live: true });
}

// 자동 판정: 물자에 운을 얹고 수비 쪽에 이점
function resolveAuto(ctx, war) {
  const P = W(ctx);
  // 자리에 없는 사람 조합은 물자만 반쯤 힘이 된다
  const k = (side) => (isAi(war[side]) ? 1 : 0.6);
  const a = (200 + war.sup.att) * k('att') * (0.8 + ctx.rng.next() * 0.4);
  const d = (200 + war.sup.def) * k('def') * (0.8 + ctx.rng.next() * 0.4) * P.defendBonus;
  endWar(ctx, war, a > d ? 'att' : 'def', 'auto');
}

export function endWar(ctx, war, winner, how) {
  const st = ctx.state.territory;
  const h = st.holds[war.settlement];
  war.phase = 'done';
  war.result = winner;
  for (const x of Object.values(ctx.state.actors)) if (x.rival?.war === war.id) delete ctx.state.actors[x.id];
  const from = h.owner;
  if (winner === 'att') {
    h.owner = war.att;
    h.since = ctx.state.t;
    h.blessed = false;
  }
  h.cool = r2(ctx.state.t + W(ctx).cooldownDays * ctx.cfg.time.secondsPerGameDay);
  delete st.wars[war.id];
  st.log.unshift({ day: ctx.clock.day(ctx.state.t), settlement: war.settlement, att: war.att, def: war.def, winner, how });
  st.log.length = Math.min(st.log.length, 12);
  ctx.emit('war.end', { war: war.id, settlement: war.settlement, att: war.att, def: war.def, winner, how, from, owner: h.owner });
}

// 깃발 둘레: 양쪽 싸움꾼(사람·민병 포함) 수
export function flagCount(ctx, war) {
  const R = W(ctx).flagR;
  const n = { att: 0, def: 0 };
  for (const a of Object.values(ctx.state.actors)) {
    if (!a.cb || a.cb.downUntil > 0) continue;
    if (Math.hypot(a.x - war.x, a.z - war.z) > R) continue;
    const t = teamIn(ctx, a, war);
    if (t) n[t]++;
  }
  return n;
}

function siegeTick(ctx, war) {
  const P = W(ctx);
  const t = ctx.state.t;
  if (!anyMemberNear(ctx, war)) {
    // 다 떠났으면 그때까지의 차지로 셈한다
    return endWar(ctx, war, war.cap >= 50 ? 'att' : 'def', 'left');
  }
  spawnWave(ctx, war, 'def');
  spawnWave(ctx, war, 'att');
  const n = flagCount(ctx, war);
  const rate = 100 / P.captureSec;
  if (n.att > 0 && n.def === 0) war.cap = Math.min(100, r2(war.cap + rate));
  else if (n.def > 0 && n.att === 0) war.cap = Math.max(0, r2(war.cap - rate * 0.5));
  war.near = n;
  if (war.cap >= 100) return endWar(ctx, war, 'att', 'flag');
  if (t >= war.until) return endWar(ctx, war, 'def', 'time');
}

// AI 조합의 하루: 물자를 모으고, 며칠마다 사람 조합 영지(없으면 다른 AI 영지)에 선전포고한다
function aiDaily(ctx) {
  const st = ctx.state.territory;
  const P = W(ctx);
  for (const war of Object.values(st.wars)) {
    if (war.phase !== 'prep') continue;
    for (const side of ['att', 'def']) if (isAi(war[side])) war.sup[side] = r2(war.sup[side] + P.aiSupplyPerDay * (0.6 + ctx.rng.next() * 0.8));
  }
  const day = ctx.clock.day(ctx.state.t);
  if (day < st.nextAi) return;
  st.nextAi = day + P.aiDeclareEvery;
  if (!ctx.rng.chance(P.aiWarChance)) return;
  const ais = TD(ctx).aiGuilds.map((x) => `ai:${x.id}`).filter((tag) => !warsOf(ctx, tag).length);
  if (!ais.length) return;
  const targets = Object.entries(st.holds).filter(([sid, h]) => !warAt(ctx, sid) && h.cool <= ctx.state.t);
  const human = targets.filter(([, h]) => !isAi(h.owner));
  const pool = human.length ? human : targets;
  if (!pool.length) return;
  const [sid, h] = ctx.rng.pick(pool);
  const att = ctx.rng.pick(ais.filter((x) => x !== h.owner));
  if (att) declareWar(ctx, att, sid);
}

// 하루 세금: 영지 주인 조합의 사람 조합원에게
function taxDaily(ctx) {
  const st = ctx.state.territory;
  for (const [sid, h] of Object.entries(st.holds)) {
    if (isAi(h.owner)) continue;
    const g = ctx.state.guilds?.[h.owner.slice(2)];
    if (!g) continue;
    const people = g.members.map((id) => ctx.state.actors[id]).filter(Boolean);
    if (!people.length) continue;
    const each = Math.floor(W(ctx).taxPerDay / people.length);
    for (const a of people) a.silver += each;
    ctx.emit('war.tax', { settlement: sid, guild: g.id, each, members: people.map((a) => a.id) });
  }
}

// 1초마다
export function territoryTick(ctx) {
  const st = ctx.state.territory;
  if (!st) return;
  const t = ctx.state.t;
  for (const war of Object.values(st.wars)) {
    if (war.phase === 'prep' && t >= war.at) startSiege(ctx, war);
    else if (war.phase === 'siege' && st.wars[war.id]) siegeTick(ctx, war);
  }
}
export function territoryDaily(ctx) {
  if (!ctx.state.territory) return;
  aiDaily(ctx);
  taxDaily(ctx);
}

// ── 혜택 ──
export function heldBy(ctx, a) {
  const tag = tagOf(ctx, a);
  if (!tag) return [];
  return Object.entries(ctx.state.territory?.holds || {}).filter(([, h]) => h.owner === tag).map(([sid]) => sid);
}
export function territoryFeeMult(ctx, a, kind) {
  if (kind !== 'market') return 1;
  return Math.pow(W(ctx).marketMult, Math.min(3, heldBy(ctx, a).length));
}
// 영토 씨앗을 심은 우리 영지가 있는 지역에서 채집량
export function seedYield(ctx, a) {
  const tag = tagOf(ctx, a);
  if (!tag) return 0;
  for (const [sid, h] of Object.entries(ctx.state.territory?.holds || {})) {
    if (h.owner !== tag || !h.blessed) continue;
    if (ctx.state.settlements[sid]?.region === ctx.state.settlements[a.home]?.region || Math.abs(ctx.state.settlements[sid].x - a.x) < 500) return W(ctx).seedYield;
  }
  return 0;
}
export function plantError(ctx, a, sid) {
  const h = ctx.state.territory?.holds[sid];
  if (!h) return 'not_territory';
  if (h.owner !== tagOf(ctx, a)) return 'not_owner';
  if (h.blessed) return 'blessed';
  if (!a.bag.some((e) => e.item === 'seed_territory')) return 'no_item';
  const s = ctx.state.settlements[sid];
  if (Math.hypot(s.x - a.x, s.z - a.z) > s.radius + 10) return 'too_far';
  return null;
}
export function plant(ctx, a, sid) {
  const e = a.bag.find((x) => x.item === 'seed_territory');
  e.qty -= 1;
  if (e.qty <= 0) a.bag.splice(a.bag.indexOf(e), 1);
  ctx.state.territory.holds[sid].blessed = true;
  ctx.emit('war.seed', { actor: a.id, settlement: sid });
}

export { r3, addEntry };
