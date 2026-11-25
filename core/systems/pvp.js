// 필드 PvP(v2.6): 스스로 깃발을 켠 사람끼리, 그리고 분쟁 구역 안에서 싸운다.
// 싱글에서는 분쟁 구역을 도는 다른 세력의 개척자(rivals.js)가 상대다. 멀티에서도 같은 규칙으로 사람끼리 싸운다.
// 깃발을 켜면 채집량·숙련 경험이 오른다(분쟁 구역은 더). 쓰러지면 장비 내구가 깎이고 가방의 재료 일부를 빼앗긴다. 장비는 잃지 않는다.

import { regionAt, zoneAt } from '../terrain.js';
import { isUnlocked } from './unlocks.js';
import { addEntry } from '../inventory.js';
import { liveWarOf, teamIn } from './territory.js';

const r2 = (v) => Math.round(v * 100) / 100;
export const PV = (ctx) => ctx.cfg.pvp;

export const emptyPvp = () => ({ on: false, since: 0, fightAt: -999, kills: 0, downs: 0, honor: 0 });

// 분쟁 구역인가(구역 정의에 disputed가 붙은 곳)
export function zoneOf(ctx, a) {
  const region = regionAt(ctx.data.lists.regions, a.x);
  return zoneAt(region, a.x, a.z);
}
export const inDisputed = (ctx, a) => !!zoneOf(ctx, a)?.disputed;

// 겨룰 수 있는 상태인가: 다른 세력 개척자는 늘, 사람은 깃발을 켰거나 분쟁 구역 안(4장에서 열린 뒤)
export function pvpOn(ctx, a) {
  if (!a) return false;
  if (a.kind === 'rival') return true;
  if (a.kind === 'ally') return pvpOn(ctx, ctx.state.actors[a.ally?.owner]);
  if (!isUnlocked(ctx, a, 'pvp')) return false;
  return !!a.pvp?.on || inDisputed(ctx, a);
}

// 동행은 주인 편이다
export const rootOf = (ctx, a) => (a?.kind === 'ally' ? ctx.state.actors[a.ally?.owner] || a : a);
export const sideOf = (a) => (a?.kind === 'rival' ? a.rival.faction : a?.faction?.id || null);

// a와 b가 서로 칠 수 있는가
export function hostile(ctx, a, b) {
  if (!a || !b || a === b || !a.cb || !b.cb) return false;
  if (a.cb.downUntil > 0 || b.cb.downUntil > 0 || a.offline || b.offline) return false; // 나간 사람(v3.0)은 건드리지 않는다
  const A = rootOf(ctx, a);
  const B = rootOf(ctx, b);
  if (!A || !B || A === B) return false;
  // 공성(v2.7): 같은 전쟁 안에서는 편으로 가른다
  const wa = liveWarOf(ctx, A);
  const wb = liveWarOf(ctx, B);
  if (wa || wb) {
    if (wa && wa === wb) return teamIn(ctx, A, wa) !== teamIn(ctx, B, wa);
    if (A.rival?.war || B.rival?.war) return false;
  }
  if (A.kind === 'rival' && B.kind === 'rival') return false;
  const sa = sideOf(A);
  const sb = sideOf(B);
  if (sa && sa === sb) return false;
  return pvpOn(ctx, A) && pvpOn(ctx, B);
}

// (x,z)에서 r 안의 적 행위자(가까운 순)
export function foesNear(ctx, a, x, z, r) {
  const out = [];
  for (const b of Object.values(ctx.state.actors)) {
    if (!hostile(ctx, a, b)) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d <= r) out.push({ b, d });
  }
  out.sort((p, q) => p.d - q.d || (p.b.id < q.b.id ? -1 : 1));
  return out;
}

// 싸움 기록(깃발을 끄지 못하게 잠깐 잡아 둔다)
export function markFight(ctx, ...actors) {
  for (const x of actors) {
    const r = rootOf(ctx, x);
    if (r?.pvp) r.pvp.fightAt = ctx.state.t;
  }
}

// 깃발로 얻는 생활 보너스(채집량·숙련 경험에 더한다)
export function pvpBonus(ctx, a) {
  if (!a || a.kind !== 'player' || !pvpOn(ctx, a)) return 0;
  const P = PV(ctx);
  return P.flagBonus + (inDisputed(ctx, a) ? P.disputedBonus : 0);
}

// 깃발 켜고 끄기의 검증
export function toggleError(ctx, a, on) {
  if (!isUnlocked(ctx, a, 'pvp')) return 'locked';
  if (!!a.pvp?.on === !!on) return 'same';
  if (!on) {
    const t = ctx.state.t;
    if (inDisputed(ctx, a)) return 'disputed';
    if (t - (a.pvp?.since ?? -1e9) < PV(ctx).minOnSec) return 'pvp_cd';
    if (t - (a.pvp?.fightAt ?? -1e9) < PV(ctx).combatLockSec) return 'in_fight';
  }
  return null;
}
export function toggle(ctx, a, on) {
  a.pvp = a.pvp || emptyPvp();
  a.pvp.on = !!on;
  a.pvp.since = ctx.state.t;
  ctx.emit('pvp.flag', { actor: a.id, on: !!on });
}

// PvP로 쓰러졌을 때(combat.down에서 부른다): 재료 일부를 빼앗기고, 이긴 쪽은 전공·영향력을 얻는다
export function onPvpDown(ctx, a, by) {
  const P = PV(ctx);
  const winner = rootOf(ctx, by);
  const loser = rootOf(ctx, a);
  const taken = [];
  if (a.kind !== 'ally') {
    for (const e of [...a.bag]) {
      if (e.uid) continue;
      const def = ctx.data.items[e.item];
      if (def.kind === 'consumable' || def.blueprint) continue;
      const n = Math.floor(e.qty * P.cargoLoss);
      if (n <= 0) continue;
      e.qty -= n;
      if (e.qty <= 0) a.bag.splice(a.bag.indexOf(e), 1);
      const piece = { item: e.item, lot: e.lot ?? null, bonus: e.bonus ?? null, qty: n };
      if (winner?.bag) addEntry(winner.bag, piece);
      taken.push({ item: e.item, qty: n });
    }
  }
  if (loser?.pvp) loser.pvp.downs += 1;
  if (winner?.pvp) {
    winner.pvp.kills += 1;
    winner.pvp.honor += P.honorPerKill;
  }
  ctx.emit('pvp.down', { actor: a.id, by: winner?.id ?? by.id, taken, x: a.x, z: a.z });
  return taken;
}

export { r2 };
