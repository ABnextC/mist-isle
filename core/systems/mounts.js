// 탈것(v3.2): 마구간에서 사거나 부탁으로 얻은 짐승을 불러(V) 타고 달린다.
// 상태: a.mounts = { own: [id], pick: id|null, gear: { saddle: item|null, shoes: item|null } }, 타는 중이면 a.riding = 탈것 id
// 맞거나, 휘두르거나, 캐거나, 만들면 내린다. 싸움이 끝나고 잠깐(combatLockSec) 지나야 다시 부른다.
import { isUnlocked } from './unlocks.js';
import { runOf } from './expeditions.js';
import { addEntry, takeQty, keyOf } from '../inventory.js';
import { jewelStat } from './level.js';

export const mountsOf = (a) => (a.mounts ||= { own: [], pick: null, gear: { saddle: null, shoes: null } });

// 탈것에서 내리게 하는 명령(내린 뒤 그 명령을 그대로 한다)
export const DISMOUNT_ON = new Set(['ATTACK', 'ABILITY', 'BLOCK', 'DODGE', 'GATHER', 'SKIN', 'CRAFT', 'QUEST_USE', 'REST', 'EXP_START', 'GARDEN_PLANT', 'GARDEN_HARVEST', 'HOUSE_PLACE', 'RECALL', 'FERRY']);

export function gearSpeed(ctx, a) {
  let g = 0;
  for (const it of Object.values(mountsOf(a).gear)) if (it) g += ctx.data.items[it]?.mountGear?.speed || 0;
  return g;
}

// 걷는 빠르기에 곱하는 값(타지 않으면 1). 동행(v1.7)은 주인의 탈것 빠르기를 따른다
export function mountSpeed(ctx, a) {
  if (!a.riding) return 1;
  const who = a.kind === 'ally' ? ctx.state.actors[a.ally?.owner] || a : a;
  const m = ctx.data.mounts[a.riding] || ctx.data.mounts[who.riding];
  if (!m) return 1;
  return m.speed * (1 + (who.mounts ? gearSpeed(ctx, who) : 0) + (who.equip ? jewelStat(ctx, who, 'ride') : 0)); // 말발굽 귀걸이(v3.3)
}

export function inCombat(ctx, a, sec) {
  const cb = a.cb;
  if (!cb) return false;
  if (cb.act || cb.block || cb.dodge) return true;
  if (ctx.state.t - (cb.lastHitAt ?? -1e9) < sec) return true;
  // 나를 쫓는 짐승이 있으면 싸우는 중이다
  for (const m of Object.values(ctx.state.mobs)) if (m.target === a.id && m.mode !== 'dead' && m.hp > 0 && Math.hypot(m.x - a.x, m.z - a.z) < 30) return true;
  return false;
}

export function gainMount(ctx, a, id) {
  const M = mountsOf(a);
  if (!ctx.data.mounts[id] || M.own.includes(id)) return false;
  M.own.push(id);
  if (!M.pick) M.pick = id;
  ctx.emit('mount.gained', { actor: a.id, mount: id });
  return true;
}

export function dismount(ctx, a, why = 'self') {
  if (!a.riding) return false;
  const was = a.riding;
  a.riding = null;
  ctx.emit('mount.off', { actor: a.id, mount: was, why });
  return true;
}

export function summonError(ctx, a) {
  const M = mountsOf(a);
  if (a.riding) return 'riding';
  if (!M.pick || !M.own.includes(M.pick)) return 'no_mount';
  if (a.action) return 'busy';
  if (a.cb?.downUntil > 0) return 'down';
  if (runOf(ctx, a)) return 'in_expedition';
  if (inCombat(ctx, a, ctx.cfg.mount.combatLockSec)) return 'in_combat';
  return null;
}

export function startSummon(ctx, a) {
  a.dest = a.nav = a.move = null;
  const t = ctx.state.t;
  a.action = { type: 'mount', mount: mountsOf(a).pick, startedAt: t, endsAt: Math.round((t + ctx.cfg.mount.summonSec) * 100) / 100 };
  ctx.emit('mount.summon', { actor: a.id, mount: a.action.mount });
}

export function finishSummon(ctx, a) {
  const id = a.action.mount;
  a.action = null;
  if (!mountsOf(a).own.includes(id)) return;
  a.riding = id;
  ctx.emit('mount.on', { actor: a.id, mount: id });
}

// 마구간: 그 마을 마구간 앞(stableRange)
export function stableAt(ctx, a) {
  const R = ctx.cfg.mount.stableRange;
  return ctx.statics.find((o) => o.kind === 'stable' && Math.hypot(o.x - a.x, o.z - a.z) <= R + (o.r || 0)) || null;
}

export function stableMounts(ctx, st) {
  return (ctx.data.stables[st?.at] || []).map((id) => ctx.data.mounts[id]);
}

const questDone = (a, q) => a.quests?.done?.[q] != null;

export function buyError(ctx, a, id) {
  const m = ctx.data.mounts[id];
  if (!m || m.price == null) return 'bad_args';
  if (!isUnlocked(ctx, a, 'mount')) return 'locked';
  const st = stableAt(ctx, a);
  if (!st) return 'too_far';
  if (!stableMounts(ctx, st).includes(m)) return 'not_sold_here';
  if (m.need?.quest && !questDone(a, m.need.quest)) return 'locked';
  if (mountsOf(a).own.includes(id)) return 'owned';
  if (a.silver < m.price) return 'no_silver';
  return null;
}

export function buyMount(ctx, a, id) {
  const m = ctx.data.mounts[id];
  a.silver -= m.price;
  ctx.emit('mount.bought', { actor: a.id, mount: id, price: m.price });
  gainMount(ctx, a, id);
  mountsOf(a).pick = id; // 새로 산 놈을 탄다
}

export function gearError(ctx, a, item) {
  const def = ctx.data.items[item];
  if (!def?.mountGear) return 'bad_args';
  if (!a.bag.some((e) => e.item === item && !e.uid)) return 'no_item';
  return null;
}

export function putGear(ctx, a, item) {
  const slot = ctx.data.items[item].mountGear.slot;
  const G = mountsOf(a).gear;
  takeQty(a.bag, keyOf(a.bag.find((e) => e.item === item && !e.uid)), 1);
  if (G[slot]) addEntry(a.bag, { item: G[slot], lot: null, bonus: null, qty: 1 });
  G[slot] = item;
  ctx.emit('mount.gear', { actor: a.id, slot, item });
}

export function takeGear(ctx, a, slot) {
  const G = mountsOf(a).gear;
  if (!G[slot]) return false;
  addEntry(a.bag, { item: G[slot], lot: null, bonus: null, qty: 1 });
  ctx.emit('mount.gear', { actor: a.id, slot, item: null });
  G[slot] = null;
  return true;
}

