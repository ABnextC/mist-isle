// 전투: 체력·기력·공격·회피·막기·쓰러짐 (설계 11장, 이번 범위는 docs/v0.3-combat.md).
// 모든 판정은 코어가 30Hz로 한다. 화면은 이벤트(combat.*)를 보고 연출만 한다.

import { hurtMob } from './mobs.js';

const DEG = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100;
export const SLOTS = ['head', 'chest', 'legs'];

export function initCombat(cfg) {
  return {
    hp: cfg.combat.hp, maxHp: cfg.combat.hp, st: cfg.combat.stamina,
    lastHitAt: -99, staminaAt: -99, act: null, dodge: null, block: false, stunUntil: 0, downUntil: 0,
  };
}

export const emptyEquip = () => ({ weapon: null, head: null, chest: null, legs: null });

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}
export const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

// 낀 장비. 가방에서 빠졌으면(창고·판매) 풀린 것으로 본다.
export function equipped(ctx, a, slot) {
  const uid = a.equip?.[slot];
  if (!uid) return null;
  const e = a.bag.find((x) => x.uid === uid);
  if (!e) {
    a.equip[slot] = null;
    return null;
  }
  return e;
}

export function weaponOf(ctx, a) {
  const C = ctx.cfg.combat;
  const e = equipped(ctx, a, 'weapon');
  if (!e) return { entry: null, type: 'fists', spec: C.weapons.fists, attack: C.fists.attack };
  const def = ctx.data.items[e.item];
  return { entry: e, type: def.weapon.type, spec: C.weapons[def.weapon.type], attack: (e.stats?.attack ?? 1) * (e.broken ? C.brokenMult : 1) };
}

export function armorOf(ctx, a) {
  let sum = 0;
  for (const s of SLOTS) {
    const e = equipped(ctx, a, s);
    if (e && !e.broken) sum += e.stats?.armor ?? 0;
  }
  return sum;
}

function weightOf(ctx, a) {
  let w = 'light';
  for (const s of SLOTS) {
    const e = equipped(ctx, a, s);
    const k = e ? ctx.data.items[e.item].armor.weight : null;
    if (k === 'heavy') return 'heavy';
    if (k === 'medium') w = 'medium';
  }
  return w;
}

export const mitigate = (ctx, dmg, armor) => dmg * (1 - armor / (armor + ctx.cfg.combat.armorK));

export const isDown = (a) => !!a.cb && a.cb.downUntil > 0;

export function wear(ctx, a, e, n) {
  if (!e || e.broken || e.dur == null) return;
  e.dur = Math.max(0, e.dur - n);
  if (e.dur <= 0) {
    e.broken = true;
    ctx.emit('tool.broken', { actor: a.id, item: e.item, uid: e.uid });
  }
}

// 맞거나 공격하면 하던 채집·손질·귀환이 끊긴다
export function interrupt(ctx, a, reason) {
  const act = a.action;
  if (!act) return;
  a.action = null;
  if (act.type === 'recall') ctx.emit('recall.cancelled', { actor: a.id });
  else if (act.type === 'skin') {
    const m = ctx.state.mobs[act.mob];
    if (m && m.skinning === a.id) m.skinning = null;
    ctx.emit('skin.failed', { actor: a.id, mob: act.mob, reason });
  } else {
    if (act.focus) a.focus += ctx.cfg.focus.cost.gather;
    ctx.emit('gather.failed', { actor: a.id, node: act.node, reason });
  }
}

// 이동 규칙: 쓰러졌거나 비틀거리면 못 움직인다. 구르는 중이면 정해진 방향으로 밀린다.
export function combatMove(ctx, a) {
  const cb = a.cb;
  if (!cb) return { lock: false, dodge: null, mult: 1 };
  const t = ctx.state.t;
  if (cb.downUntil > 0 || cb.stunUntil > t) return { lock: true, dodge: null, mult: 0 };
  if (cb.dodge) return { lock: false, dodge: [cb.dodge.vx, cb.dodge.vz], mult: 1 };
  const C = ctx.cfg.combat;
  let mult = 1;
  if (cb.block) mult = C.blockMove;
  if (cb.act) mult = Math.min(mult, C.attackMove);
  return { lock: false, dodge: null, mult };
}

export function startAttack(ctx, a, kind, yaw) {
  const C = ctx.cfg.combat;
  const t = ctx.state.t;
  const w = weaponOf(ctx, a);
  const heavy = kind === 'heavy';
  if (heavy) {
    a.cb.st = r2(a.cb.st - C.heavyCost);
    a.cb.staminaAt = t;
  }
  a.yaw = Math.round(yaw * 1000) / 1000;
  a.cb.block = false;
  a.cb.act = {
    kind, t0: t, yaw: a.yaw, done: false,
    hitAt: r2(t + (heavy ? w.spec.heavyWindup : w.spec.windup)),
    endAt: r2(t + (heavy ? w.spec.heavy : w.spec.light)),
  };
  ctx.emit('combat.swing', { actor: a.id, kind, weapon: w.type });
}

export function startDodge(ctx, a, yaw) {
  const C = ctx.cfg.combat;
  const t = ctx.state.t;
  const speed = (C.dodgeDistByWeight[weightOf(ctx, a)] ?? C.dodgeDist) / C.dodgeSec;
  a.cb.st = r2(a.cb.st - C.dodgeCost);
  a.cb.staminaAt = t;
  a.cb.act = null;
  a.cb.block = false;
  a.yaw = Math.round(yaw * 1000) / 1000;
  a.cb.dodge = {
    t0: t, endAt: r2(t + C.dodgeSec), iEnd: r2(t + C.dodgeIframe),
    vx: Math.round(Math.sin(yaw) * speed * 1000) / 1000, vz: Math.round(Math.cos(yaw) * speed * 1000) / 1000,
  };
  ctx.emit('combat.dodge', { actor: a.id });
}

// 휘두른 순간의 판정: 사거리·각도 안의 짐승을 가까운 순서로 무기가 허락하는 수만큼 때린다
function swing(ctx, a) {
  const C = ctx.cfg.combat;
  const act = a.cb.act;
  const w = weaponOf(ctx, a);
  const half = (w.spec.arc * DEG) / 2;
  const cands = [];
  for (const m of Object.values(ctx.state.mobs)) {
    if (m.mode === 'dead') continue;
    const type = ctx.data.creatures[m.type];
    const d = Math.hypot(m.x - a.x, m.z - a.z);
    if (d > w.spec.range + type.r) continue;
    if (d > 0.4 && angDiff(yawTo(a, m), act.yaw) > half) continue;
    cands.push({ m, d, type });
  }
  cands.sort((p, q) => p.d - q.d || (p.m.id < q.m.id ? -1 : 1));
  const hits = cands.slice(0, w.spec.targets);
  for (const { m, type } of hits) {
    const raw = w.attack * w.spec.mult * (act.kind === 'heavy' ? C.heavyMult : 1);
    const dmg = Math.max(0.5, Math.round(mitigate(ctx, raw, type.armor || 0) * 10) / 10);
    hurtMob(ctx, m, a, dmg, act.kind === 'heavy');
  }
  if (hits.length) wear(ctx, a, w.entry, 1);
  else ctx.emit('combat.miss', { actor: a.id, kind: act.kind });
}

// 짐승이 사람을 때린다. 구르는 앞부분이면 피하고, 앞을 막고 있으면 줄인다.
export function hurtActor(ctx, a, mob, raw) {
  const C = ctx.cfg.combat;
  const t = ctx.state.t;
  const cb = a.cb;
  if (!cb || cb.downUntil > 0) return false;
  if (cb.dodge && t < cb.dodge.iEnd) {
    a.stats.evaded = (a.stats.evaded || 0) + 1;
    ctx.emit('combat.evade', { actor: a.id, mob: mob.id });
    return false;
  }
  let dmg = raw;
  let blocked = false;
  if (cb.block && cb.stunUntil <= t && angDiff(yawTo(a, mob), a.yaw) <= (C.blockArc * DEG) / 2) {
    blocked = true;
    cb.st = r2(cb.st - raw);
    cb.staminaAt = t;
    dmg = raw * (1 - C.blockCut);
    a.stats.blocked = (a.stats.blocked || 0) + 1;
    if (cb.st <= 0) {
      cb.st = 0;
      cb.block = false;
      cb.stunUntil = r2(t + C.guardBreakSec);
      ctx.emit('combat.guardbreak', { actor: a.id });
    }
  }
  dmg = Math.round(mitigate(ctx, dmg, armorOf(ctx, a)) * 10) / 10;
  cb.hp = r2(Math.max(0, cb.hp - dmg));
  cb.lastHitAt = t;
  const pieces = SLOTS.map((s) => equipped(ctx, a, s)).filter((e) => e && !e.broken);
  if (pieces.length) wear(ctx, a, ctx.rng.pick(pieces), 1);
  a.stats.dmgTaken = r2((a.stats.dmgTaken || 0) + dmg);
  interrupt(ctx, a, 'hit');
  ctx.emit('combat.hurt', { actor: a.id, mob: mob.id, dmg, blocked, hp: cb.hp });
  if (cb.hp <= 0) down(ctx, a, mob);
  return true;
}

function down(ctx, a, mob) {
  const C = ctx.cfg.combat;
  const cb = a.cb;
  cb.downUntil = r2(ctx.state.t + C.downSec);
  cb.act = null;
  cb.dodge = null;
  cb.block = false;
  a.move = null;
  a.dest = null;
  a.nav = null;
  a.action = null;
  // 쓰러지면 낀 장비 내구가 10% 준다(설계 11.3). 물건은 잃지 않는다.
  for (const s of ['weapon', ...SLOTS]) {
    const e = equipped(ctx, a, s);
    if (e && e.maxDur) wear(ctx, a, e, Math.max(1, Math.round(e.maxDur * C.deathWear)));
  }
  a.stats.downs = (a.stats.downs || 0) + 1;
  ctx.emit('actor.down', { actor: a.id, mob: mob?.id ?? null, type: mob?.type ?? null, x: a.x, z: a.z });
}

function getUp(ctx, a) {
  const cb = a.cb;
  const s = Object.values(ctx.state.settlements)[0];
  const storage = s.stations.find((st) => st.type === 'storage') || s;
  a.x = Math.round((storage.x + 2.2) * 1000) / 1000;
  a.z = Math.round(storage.z * 1000) / 1000;
  cb.downUntil = 0;
  cb.stunUntil = 0;
  cb.hp = cb.maxHp;
  cb.st = ctx.cfg.combat.stamina;
  ctx.emit('actor.up', { actor: a.id, settlement: s.id });
}

export function combatTick(ctx, dt) {
  const C = ctx.cfg.combat;
  const t = ctx.state.t;
  for (const a of Object.values(ctx.state.actors)) {
    const cb = a.cb;
    if (!cb) continue;
    if (cb.downUntil > 0) {
      if (t >= cb.downUntil) getUp(ctx, a);
      continue;
    }
    if (cb.act) {
      if (!cb.act.done && t >= cb.act.hitAt) {
        cb.act.done = true;
        swing(ctx, a);
      }
      if (cb.act && t >= cb.act.endAt) cb.act = null;
    }
    if (cb.dodge && t >= cb.dodge.endAt) cb.dodge = null;
    if (cb.hp < cb.maxHp && t - cb.lastHitAt >= C.hpRegenDelay) cb.hp = r2(Math.min(cb.maxHp, cb.hp + C.hpRegen * dt));
    if (!cb.block && cb.st < C.stamina && t - cb.staminaAt >= C.staminaDelay) cb.st = r2(Math.min(C.stamina, cb.st + C.staminaRegen * dt));
  }
}
