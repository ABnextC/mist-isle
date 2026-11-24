// 세력(v0.7): 등불단·자유 선단·안개 학회. 4장 「세 갈래 길」에서 하나를 고른다.
// 세력 안에서 영향력을 쌓으면 등급이 오르고, 등급마다 생활 혜택(숙련 경험, 하나 더, 수수료, 전용 요리)이 붙는다.
// 영향력은 지도자에게 받는 세력 의뢰(물건 건네기)와 그 세력다운 생활 활동(하루 상한)으로 쌓인다.
// 세력은 바꿀 수 있다. 바꾸면 쌓은 영향력을 모두 잃고, 며칠은 다시 못 바꾼다.

import { hashStr } from '../terrain.js';
import { seedState, makeRng } from '../rng.js';
import { gated } from './unlocks.js';
import { guildPerks } from './guilds.js';

export const factionDef = (ctx, id) => ctx.data.factions.list.find((f) => f.id === id) || null;
export const factionOf = (a) => a?.faction?.id || null;

// 등급: 1(견습)~5(원로). 세력이 없으면 0
export function rankOf(ctx, a) {
  if (!factionOf(a)) return 0;
  const ranks = ctx.data.factions.ranks;
  let r = 0;
  for (let i = 0; i < ranks.length; i++) if (a.faction.inf >= ranks[i].at) r = i + 1;
  return r;
}

export function perksOf(ctx, a) {
  const f = factionDef(ctx, factionOf(a));
  const r = rankOf(ctx, a);
  // 조합 혜택(v0.8.1)도 같은 꼴이라 함께 센다
  return [...(f ? f.perks.filter((p) => p.rank <= r) : []), ...guildPerks(ctx, a)];
}

const hasSkill = (p, skill) => p.skills === '*' || p.skills?.includes(skill);

export function xpMult(ctx, a, skill) {
  let m = 1;
  for (const p of perksOf(ctx, a)) if (p.kind === 'xp' && hasSkill(p, skill)) m *= p.mult;
  const boost = a?.buffs?.find((b) => b.type === 'xpBoost');
  if (boost) m *= 1 + boost.value;
  const rest = a?.buffs?.find((b) => b.type === 'rested'); // 집에서 푹 쉼(v0.8)
  if (rest) m *= 1 + rest.value;
  return m;
}

// '하나 더' 확률: kind는 gather(캐기)·refine(가공)
export function extraChance(ctx, a, kind, skill) {
  let c = 0;
  for (const p of perksOf(ctx, a)) if (p.kind === kind && hasSkill(p, skill)) c += p.chance;
  if (kind === 'refine') c += a?.buffs?.find((b) => b.type === 'refineYield')?.value || 0;
  return Math.min(0.9, c);
}

// 수수료 배수: kind는 ship(운송)·market(거래소)·food(음식 시간, 배수가 커진다)
export function feeMult(ctx, a, kind) {
  let m = 1;
  for (const p of perksOf(ctx, a)) if (p.kind === kind) m *= p.mult;
  return m;
}

// 세력 전용 레시피: 그 세력에서 그 등급에 닿아야 만든다(봇·AI는 묻지 않는다)
export function recipeAllowed(ctx, a, r) {
  if (!r.faction || !gated(a)) return true;
  return perksOf(ctx, a).some((p) => p.kind === 'recipe' && p.recipe === r.id);
}

// 오늘의 세력 의뢰: 날짜와 세계 시드로 정해진다(상태를 두지 않는다)
export function tasksOf(ctx, fid, day = ctx.clock.day(ctx.state.t)) {
  const f = factionDef(ctx, fid);
  if (!f) return [];
  const rng = makeRng(seedState(hashStr(`${ctx.state.meta.worldSeed}:${fid}:${day}`)));
  const pool = [...f.tasks];
  const out = [];
  for (let i = 0; i < ctx.data.factions.tasksPerDay && pool.length; i++) {
    const t = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    const qty = rng.int(t.qty[0], t.qty[1]);
    const k = qty / ((t.qty[0] + t.qty[1]) / 2);
    out.push({ id: `${fid}:${day}:${i}`, faction: fid, item: t.item, qty, inf: Math.round(t.inf * k), silver: Math.round(t.silver * k) });
  }
  return out;
}

export function taskDone(ctx, a, task) {
  return a.faction?.done?.[task.id] != null;
}

export function gainInfluence(ctx, a, n, why) {
  if (!factionOf(a) || n <= 0) return 0;
  const before = rankOf(ctx, a);
  a.faction.inf += n;
  const after = rankOf(ctx, a);
  ctx.emit('faction.gain', { actor: a.id, faction: a.faction.id, n, why, inf: a.faction.inf });
  if (after > before) ctx.emit('faction.rank', { actor: a.id, faction: a.faction.id, rank: after });
  return n;
}

// 활동 영향력: 세력마다 쳐 주는 일이 다르고, 하루에 얻는 양에 상한이 있다
function activity(ctx, a, n, why) {
  if (!n || !factionOf(a)) return;
  const day = ctx.clock.day(ctx.state.t);
  const T = (a.faction.today ||= { day, n: 0 });
  if (T.day !== day) Object.assign(T, { day, n: 0 });
  const room = ctx.data.factions.dailyCap - T.n;
  if (room <= 0) return;
  const g = Math.min(room, n);
  T.n += g;
  gainInfluence(ctx, a, g, why);
}

export function factionOnEvent(ctx, ev) {
  const id = ev.actor ?? (ev.kind === 'actor' ? ev.owner : null);
  const a = id ? ctx.state.actors[id] : null;
  const f = a ? factionDef(ctx, factionOf(a)) : null;
  if (!f) return;
  const E = f.earn;
  if (ev.type === 'craft.done') activity(ctx, a, E.craft[ctx.data.recipes[ev.recipe]?.skill] || 0, 'craft');
  else if (ev.type === 'gather.done') activity(ctx, a, E.gather[ev.skill] || 0, 'gather');
  else if (ev.type === 'skin.done') activity(ctx, a, E.skin || 0, 'skin');
  else if (ev.type === 'ship') activity(ctx, a, E.ship || 0, 'ship');
  else if (ev.type === 'market.sell') activity(ctx, a, E.sell || 0, 'sell');
  else if (ev.type === 'project.contrib') activity(ctx, a, (E.contrib || 0) * 3, 'contrib');
}
