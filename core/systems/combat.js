// 전투: 체력·기력·공격·회피·막기·쓰러짐 (설계 11장, 이번 범위는 docs/v0.3-combat.md).
// 모든 판정은 코어가 30Hz로 한다. 화면은 이벤트(combat.*)를 보고 연출만 한다.

import { hurtMob, isAlive, applyMobFx, fxOn } from './mobs.js';
import { levelPassives, mergeP } from './level.js';
import { nearestSettlement } from '../world.js';
import { foesNear, markFight, onPvpDown } from './pvp.js';
import { masteryOf, passivesOf, gainXp, abilityOf } from './mastery.js';

const DEG = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100;
export const SLOTS = ['head', 'chest', 'legs'];

export function initCombat(cfg) {
  return {
    hp: cfg.combat.hp, maxHp: cfg.combat.hp, st: cfg.combat.stamina,
    lastHitAt: -99, staminaAt: -99, act: null, dodge: null, block: false, stunUntil: 0, downUntil: 0,
    cds: {}, aura: [], lunge: null, counterUntil: 0,
    mp: cfg.combat.mana ?? 100, maxMp: cfg.combat.mana ?? 100,
  };
}

// weapon2(v1.1): 등에 멘 둘째 무기. 바꾸면 weapon과 자리를 맞바꾼다
export const emptyEquip = () => ({ weapon: null, weapon2: null, head: null, chest: null, legs: null, ring: null, neck: null });

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
  if (!e) return { entry: null, type: 'fists', spec: C.weapons.fists, attack: C.fists.attack, mastery: null };
  const def = ctx.data.items[e.item];
  return {
    entry: e, type: def.weapon.type, spec: C.weapons[def.weapon.type], attack: (e.stats?.attack ?? 1) * (e.broken ? C.brokenMult : 1),
    mastery: masteryOf(ctx, def.weapon.type),
  };
}

// 지금 든 무기의 숙련 패시브
// 전투 레벨·능력치(v2.3)를 무기 숙련 보너스에 더한다
export const passivesNow = (ctx, a) => {
  const w = weaponOf(ctx, a).mastery;
  return mergeP(passivesOf(ctx, a, w), levelPassives(ctx, a, w));
};

// 몸에 걸린 기운(v1.1): 스킬 버프·구른 뒤 버프. 같은 키는 더한다
export function auraSum(a, t, key) {
  let v = 0;
  for (const x of a.cb?.aura || []) if (x.until > t && x[key]) v += x[key];
  return v;
}
export function addAura(ctx, a, src, b) {
  const t = ctx.state.t;
  a.cb.aura = (a.cb.aura || []).filter((x) => x.until > t && x.src !== src);
  a.cb.aura.push({ src, until: r2(t + b.sec), dmg: b.dmg || 0, dr: b.dr || 0, speed: b.speed || 0, stRegen: b.stRegen || 0, lifesteal: b.lifesteal || 0, mpRegen: b.mpRegen || 0 });
  ctx.emit('combat.aura', { actor: a.id, src, sec: b.sec });
}

export const heavyCostOf = (ctx, a) => r2(ctx.cfg.combat.heavyCost * (1 - Math.min(0.6, passivesNow(ctx, a).heavyCost || 0)));
export const dodgeCostOf = (ctx, a) => r2(ctx.cfg.combat.dodgeCost * equipLoad(ctx, a).tier.dodgeCost * (1 - Math.min(0.6, passivesNow(ctx, a).dodgeCost || 0)));
export const maxHpOf = (ctx, a) => ctx.cfg.combat.hp + (passivesNow(ctx, a).maxHp || 0);

export function armorOf(ctx, a) {
  let sum = 0;
  for (const s of SLOTS) {
    const e = equipped(ctx, a, s);
    if (e && !e.broken) sum += e.stats?.armor ?? 0;
  }
  return sum;
}

// 장비 무게(v0.4.5): 낀 무기와 갑옷의 무게 합(kg)으로 단계를 정한다. 부서진 장비도 무게는 그대로다.
export function equipLoad(ctx, a) {
  let kg = 0;
  for (const s of ['weapon', 'weapon2', ...SLOTS]) {
    const e = equipped(ctx, a, s);
    if (e) kg += ctx.data.items[e.item].weight || 0;
  }
  kg = Math.round(kg * 10) / 10;
  const tiers = ctx.cfg.load.tiers;
  const tier = tiers.find((t) => kg <= t.max) || tiers[tiers.length - 1];
  return { kg, tier };
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
  if (cb.lunge && t < cb.lunge.endAt) return { lock: false, dodge: [cb.lunge.vx, cb.lunge.vz], mult: 1 };
  const C = ctx.cfg.combat;
  let mult = 1 + auraSum(a, t, 'speed');
  if (cb.block) mult = C.blockMove;
  if (cb.act) mult = Math.min(mult, C.attackMove);
  return { lock: false, dodge: null, mult };
}

export function startAttack(ctx, a, kind, yaw) {
  const t = ctx.state.t;
  const w = weaponOf(ctx, a);
  const heavy = kind === 'heavy';
  if (heavy) {
    a.cb.st = r2(a.cb.st - heavyCostOf(ctx, a));
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
  const { tier } = equipLoad(ctx, a);
  const speed = (tier.dodgeDist ?? C.dodgeDist) / C.dodgeSec;
  a.cb.st = r2(a.cb.st - dodgeCostOf(ctx, a));
  a.cb.staminaAt = t;
  a.cb.act = null;
  a.cb.lunge = null;
  const db = passivesNow(ctx, a).dodgeBuff;
  if (db) addAura(ctx, a, 'dodge', db);
  a.cb.block = false;
  a.yaw = Math.round(yaw * 1000) / 1000;
  a.cb.dodge = {
    t0: t, endAt: r2(t + C.dodgeSec), iEnd: r2(t + C.dodgeIframe),
    vx: Math.round(Math.sin(yaw) * speed * 1000) / 1000, vz: Math.round(Math.cos(yaw) * speed * 1000) / 1000,
  };
  ctx.emit('combat.dodge', { actor: a.id });
}

// 사거리·각도 안의 짐승을 가까운 순서로 n마리까지
function targetsIn(ctx, a, yaw, range, arcDeg, n) {
  const half = (arcDeg * DEG) / 2;
  const cands = [];
  for (const m of Object.values(ctx.state.mobs)) {
    if (!isAlive(m)) continue;
    const type = ctx.data.creatures[m.type];
    const d = Math.hypot(m.x - a.x, m.z - a.z);
    if (d > range + type.r) continue;
    if (arcDeg < 360 && d > 0.4 && angDiff(yawTo(a, m), yaw) > half) continue;
    cands.push({ m, d, type });
  }
  cands.sort((p, q) => p.d - q.d || (p.m.id < q.m.id ? -1 : 1));
  return cands.slice(0, n);
}

// 한 대 때리기(v1.1): 숙련 패시브·버프·약점·치명타를 얹고, 숙련 경험치를 쌓는다
export function dealHit(ctx, a, m, raw, o) {
  const t = ctx.state.t;
  const type = ctx.data.creatures[m.type];
  const w = o.w;
  const P = o.P;
  const cb = a.cb;
  let k = 1 + (P.dmg || 0) + auraSum(a, t, 'dmg');
  if (o.ability) k += P.ability || 0;
  else k += (o.heavy ? P.heavy : P.light) || 0;
  if (fxOn(m, 'stun', t)) k += P.vsStun || 0;
  if (fxOn(m, 'slow', t)) k += P.vsSlow || 0;
  if (fxOn(m, 'bleed', t)) k += P.vsBleed || 0;
  if (m.hp >= type.hp * 0.8) k += P.fresh || 0;
  if (m.hp < type.hp * 0.3) k += P.lowTarget || 0;
  if (P.far && Math.hypot(m.x - a.x, m.z - a.z) > 12) k += P.far;
  if (cb.hp < cb.maxHp * 0.5) k += P.lowHp || 0;
  if (cb.counterUntil > t) {
    k += P.counter || 0;
    cb.counterUntil = 0;
  }
  if (fxOn(m, 'expose', t)) k += m.fx.expose.k;
  let crit = false;
  if (P.crit > 0 && ctx.rng.next() < P.crit) {
    crit = true;
    k *= 1.5 + (P.critDmg || 0);
  }
  const dmg = Math.max(0.5, Math.round(mitigate(ctx, raw * k, type.armor || 0) * 10) / 10);
  const done = hurtMob(ctx, m, a, dmg, o.heavy || o.guardBreak, { crit, ability: o.ability || null });
  if (!done) return 0;
  const steal = (P.lifesteal || 0) + (o.lifesteal || 0) + auraSum(a, t, 'lifesteal');
  if (steal > 0) cb.hp = r2(Math.min(cb.maxHp, cb.hp + done * steal));
  gainXp(ctx, a, w.mastery, done * ctx.data.weapons.xp.perDmg);
  if (isAlive(m)) {
    const fx = { ...(o.fx || {}) };
    if (o.heavy && P.heavyStun) fx.stun = Math.max(fx.stun || 0, P.heavyStun);
    if (Object.keys(fx).length) applyMobFx(ctx, m, a, fx, w.attack * (1 + (P.bleedDmg || 0)));
  }
  return done;
}

// PvP(v2.6): 사람이 사람을 때린다. 숙련·레벨·버프·치명을 얹고 PvP 배율로 누른 뒤 hurtActor로 넘긴다
const ACTOR_R = 0.45;
function actorTargets(ctx, a, yaw, range, arcDeg, n) {
  if (n <= 0) return [];
  const half = (arcDeg * DEG) / 2;
  return foesNear(ctx, a, a.x, a.z, range + ACTOR_R)
    .filter(({ b, d }) => arcDeg >= 360 || d <= 0.4 || angDiff(yawTo(a, b), yaw) <= half)
    .slice(0, n);
}
export function hitActor(ctx, a, b, raw, o) {
  const t = ctx.state.t;
  const P = o.P;
  let k = 1 + (P.dmg || 0) + auraSum(a, t, 'dmg');
  if (o.ability) k += P.ability || 0;
  else k += (o.heavy ? P.heavy : P.light) || 0;
  if (P.far && Math.hypot(b.x - a.x, b.z - a.z) > 12) k += P.far;
  if (a.cb.hp < a.cb.maxHp * 0.5) k += P.lowHp || 0;
  let crit = false;
  if (P.crit > 0 && ctx.rng.next() < P.crit) {
    crit = true;
    k *= 1.5 + (P.critDmg || 0);
  }
  const dmg = Math.max(0.5, Math.round(raw * k * ctx.cfg.pvp.dmgMult * 10) / 10);
  markFight(ctx, a, b);
  const before = b.cb.hp;
  if (!hurtActor(ctx, b, a, dmg, { unblockable: !!o.guardBreak, pvp: true, crit })) return 0;
  const done = r2(before - b.cb.hp);
  const steal = (P.lifesteal || 0) + (o.lifesteal || 0) + auraSum(a, t, 'lifesteal');
  if (steal > 0 && done > 0) a.cb.hp = r2(Math.min(a.cb.maxHp, a.cb.hp + done * steal));
  if (o.w?.mastery) gainXp(ctx, a, o.w.mastery, done * ctx.data.weapons.xp.perDmg);
  a.stats.dmgDealt = r2((a.stats.dmgDealt || 0) + done);
  return done;
}

// 휘두른 순간의 판정: 사거리·각도 안의 짐승을 가까운 순서로 무기가 허락하는 수만큼 때린다
function swing(ctx, a) {
  const C = ctx.cfg.combat;
  const act = a.cb.act;
  const w = weaponOf(ctx, a);
  const P = passivesOf(ctx, a, w.mastery);
  const heavy = act.kind === 'heavy';
  // 활·지팡이(v1.2): 휘두르지 않고 쏜다. 당겨 쏘면 더 세고 더 빠르다
  if (w.spec.shot) {
    const sh = w.spec.shot;
    fire(ctx, a, w, aimAt(ctx, a, act.yaw, sh.range, sh.aim), {
      speed: sh.speed * (heavy ? 1.3 : 1), range: sh.range * (heavy ? 1.2 : 1), r: sh.r, proj: heavy ? `${sh.proj}_heavy` : sh.proj,
      mult: w.spec.mult * (heavy ? C.heavyMult : 1), heavy,
    });
    wear(ctx, a, w.entry, 1);
    return;
  }
  const reach = w.spec.range + (P.range || 0);
  const cap = w.spec.targets + (P.targets || 0);
  const hits = targetsIn(ctx, a, act.yaw, reach, w.spec.arc, cap);
  for (const { m } of hits) dealHit(ctx, a, m, w.attack * w.spec.mult * (heavy ? C.heavyMult : 1), { w, P, heavy });
  // 사람(v2.6): 짐승을 때리고 남은 수만큼
  const foes = actorTargets(ctx, a, act.yaw, reach, w.spec.arc, cap - hits.length);
  for (const { b } of foes) hitActor(ctx, a, b, w.attack * w.spec.mult * (heavy ? C.heavyMult : 1), { w, P, heavy });
  if (hits.length || foes.length) wear(ctx, a, w.entry, 1);
  else ctx.emit('combat.miss', { actor: a.id, kind: act.kind });
}

// ── 무기 스킬(v1.1) ──
export function startAbility(ctx, a, node, ab, yaw) {
  const t = ctx.state.t;
  const w = weaponOf(ctx, a);
  const P = passivesOf(ctx, a, w.mastery);
  const cb = a.cb;
  cb.st = r2(cb.st - (ab.cost || 0));
  if (ab.cost) cb.staminaAt = t;
  if (ab.mana) cb.mp = r2(cb.mp - ab.mana);
  cb.cds[node] = r2(t + ab.cd * (1 - Math.min(0.5, P.cdr || 0)));
  a.yaw = Math.round(yaw * 1000) / 1000;
  cb.block = false;
  cb.act = { kind: 'ability', node, t0: t, yaw: a.yaw, done: false, hitAt: r2(t + ab.windup), endAt: r2(t + ab.dur) };
  if (ab.kind === 'dash' && ab.dash) {
    const sp = ab.dash / Math.max(0.1, ab.windup);
    cb.lunge = { vx: Math.round(Math.sin(a.yaw) * sp * 1000) / 1000, vz: Math.round(Math.cos(a.yaw) * sp * 1000) / 1000, endAt: cb.act.hitAt };
  }
  ctx.emit('combat.ability', { actor: a.id, node, weapon: w.mastery, kind: ab.kind, cd: r2(cb.cds[node] - t) });
}

function resolveAbility(ctx, a) {
  const act = a.cb.act;
  const ab = abilityOf(ctx, a, act.node);
  const w = weaponOf(ctx, a);
  if (!ab || masteryOf(ctx, w.type) !== ctx.data.weaponNodes[act.node].weapon) return;
  const P = passivesOf(ctx, a, w.mastery);
  const cb = a.cb;
  let hits = [];
  const fxOf = () => {
    const fx = {};
    for (const k of ['stun', 'slow', 'bleed', 'weak', 'expose', 'knock', 'taunt']) if (ab[k]) fx[k] = ab[k];
    return fx;
  };
  if (ab.kind === 'shot') {
    const yaw = aimAt(ctx, a, act.yaw, ab.range, w.spec.shot?.aim ?? 10);
    const n = ab.shots || 1;
    for (let i = 0; i < n; i++) {
      const off = ((i - (n - 1) / 2) * (ab.spread || 0) * DEG);
      fire(ctx, a, w, yaw + off, { speed: ab.speed, range: ab.range, r: ab.r || 0.4, proj: ab.proj || 'arrow', mult: w.spec.mult * ab.mult, ability: act.node, pierce: ab.pierce || 1, fx: fxOf(), explode: ab.explode || null, guardBreak: !!ab.guardBreak });
    }
    wear(ctx, a, w.entry, 1);
  } else if (ab.kind === 'zone') {
    // 땅을 겨눈 범위(화살비·불기둥): 겨눈 적이 사거리 안이면 그 자리, 아니면 정해진 거리
    const yaw = aimAt(ctx, a, act.yaw, ab.at * 1.6, 14);
    let d = ab.at;
    const tg = targetsIn(ctx, a, yaw, ab.at * 1.6, 28, 1)[0];
    if (tg) d = Math.min(ab.at * 1.6, tg.d);
    const z = {
      id: ctx.newId('z'), by: a.id, node: act.node, w: w.mastery, attack: w.attack, mult: w.spec.mult * ab.mult, fx: fxOf(),
      x: Math.round((a.x + Math.sin(yaw) * d) * 1000) / 1000, z: Math.round((a.z + Math.cos(yaw) * d) * 1000) / 1000,
      r: ab.range, targets: ab.targets || 6, left: ab.ticks || 1, every: ab.every || 0.5, next: ctx.state.t, proj: ab.proj || null,
    };
    (ctx.state.zones ??= []).push(z);
    ctx.emit('zone.start', { zone: z.id, actor: a.id, x: z.x, z: z.z, r: z.r, proj: z.proj, sec: r2(z.left * z.every) });
    wear(ctx, a, w.entry, 1);
  } else if (ab.kind !== 'buff') {
    const arc = ab.kind === 'aoe' ? 360 : ab.arc ?? w.spec.arc;
    const range = ab.range + (ab.kind === 'aoe' ? 0 : P.range || 0);
    hits = targetsIn(ctx, a, act.yaw, range, arc, (ab.targets || 1) + (P.targets || 0));
    const fx = fxOf();
    for (const { m, type } of hits) {
      if (!(ab.mult > 0)) {
        applyMobFx(ctx, m, a, fx, w.attack);
        continue;
      }
      let mult = ab.mult;
      if (ab.execute && m.hp < type.hp * ab.execute.below) mult = ab.execute.mult;
      dealHit(ctx, a, m, w.attack * w.spec.mult * mult, { w, P, ability: act.node, guardBreak: !!ab.guardBreak, lifesteal: ab.lifesteal || 0, fx });
    }
    if (ab.mult > 0) {
      const foes = actorTargets(ctx, a, act.yaw, range, arc, (ab.targets || 1) + (P.targets || 0) - hits.length);
      for (const { b } of foes) hitActor(ctx, a, b, w.attack * w.spec.mult * ab.mult, { w, P, ability: act.node, guardBreak: !!ab.guardBreak, lifesteal: ab.lifesteal || 0 });
      hits = hits.concat(foes);
    }
    if (hits.length && ab.mult > 0) wear(ctx, a, w.entry, 1);
  }
  if (ab.heal) cb.hp = r2(Math.min(cb.maxHp, cb.hp + cb.maxHp * ab.heal));
  if (ab.buff) addAura(ctx, a, act.node, ab.buff);
  if (P.abilityBuff) addAura(ctx, a, 'ult', P.abilityBuff);
  if (ab.hop) {
    const sp = ab.hop / 0.25;
    cb.lunge = { vx: Math.round(Math.sin(act.yaw) * sp * 1000) / 1000, vz: Math.round(Math.cos(act.yaw) * sp * 1000) / 1000, endAt: r2(ctx.state.t + 0.25) };
  }
  ctx.emit('combat.abilityHit', { actor: a.id, node: act.node, kind: ab.kind, hits: hits.length, x: a.x, z: a.z, yaw: act.yaw, range: ab.range || 0, proj: ab.proj || null });
}

// ── 날아가는 것(v1.2): 화살·마력탄·불덩이·얼음 창 ──
// 겨눈 방향 가까이(±aim도)에 있는 적이 있으면 그쪽으로 살짝 고쳐 쏜다
export function aimAt(ctx, a, yaw, range, aimDeg) {
  let best = null;
  for (const m of Object.values(ctx.state.mobs)) {
    if (!isAlive(m)) continue;
    const d = Math.hypot(m.x - a.x, m.z - a.z);
    if (d > range || d < 0.3) continue;
    const diff = angDiff(yawTo(a, m), yaw);
    if (diff > aimDeg * DEG) continue;
    const score = diff + d * 0.004;
    if (!best || score < best.s || (score === best.s && m.id < best.m.id)) best = { m, s: score };
  }
  for (const { b, d } of foesNear(ctx, a, a.x, a.z, range)) {
    if (d < 0.3) continue;
    const diff = angDiff(yawTo(a, b), yaw);
    if (diff > aimDeg * DEG) continue;
    const score = diff + d * 0.004;
    if (!best || score < best.s) best = { m: b, s: score };
  }
  return best ? Math.round(yawTo(a, best.m) * 1000) / 1000 : yaw;
}

// 화살(v2.4): 활은 가방의 가장 좋은 화살 묶음을 하나씩 쓴다(없어도 쏜다, 있으면 더 아프다)
function useAmmo(ctx, a) {
  let best = null;
  for (const e of a.bag) {
    const d = ctx.data.items[e.item];
    if (d?.ammo && e.qty > 0 && (!best || d.ammo.dmg > ctx.data.items[best.item].ammo.dmg)) best = e;
  }
  if (!best) return 0;
  best.qty -= 1;
  if (best.qty <= 0) a.bag.splice(a.bag.indexOf(best), 1);
  return ctx.data.items[best.item].ammo.dmg;
}

export function fire(ctx, a, w, yaw, o) {
  const t = ctx.state.t;
  if (w.mastery === 'bow' && a.kind === 'player') o = { ...o, mult: o.mult * (1 + useAmmo(ctx, a)) };
  const sx = Math.sin(yaw);
  const sz = Math.cos(yaw);
  const id = ctx.newId('p');
  (ctx.state.arrows ??= []).push({
    id, by: a.id, w: w.mastery, attack: w.attack, mult: r2(o.mult), heavy: !!o.heavy, ability: o.ability || null,
    x: Math.round((a.x + sx * 0.7) * 1000) / 1000, z: Math.round((a.z + sz * 0.7) * 1000) / 1000,
    vx: Math.round(sx * o.speed * 1000) / 1000, vz: cos3(sz * o.speed), r: o.r, t0: r2(t), until: r2(t + o.range / o.speed),
    pierce: o.pierce || 1, hit: [], fx: o.fx || null, explode: o.explode || null, guardBreak: !!o.guardBreak, proj: o.proj,
  });
  ctx.emit('arrow.fire', { arrow: id, actor: a.id, proj: o.proj });
}
const cos3 = (v) => Math.round(v * 1000) / 1000;

function arrowHit(ctx, a, s, m) {
  const P = mergeP(passivesOf(ctx, a, s.w), levelPassives(ctx, a, s.w));
  const w = { mastery: s.w, attack: s.attack };
  dealHit(ctx, a, m, s.attack * s.mult, { w, P, heavy: s.heavy, ability: s.ability, fx: s.fx, guardBreak: s.guardBreak });
}

function explode(ctx, a, s, x, z) {
  const P = mergeP(passivesOf(ctx, a, s.w), levelPassives(ctx, a, s.w));
  const w = { mastery: s.w, attack: s.attack };
  for (const m of Object.values(ctx.state.mobs)) {
    if (!isAlive(m) || s.hit.includes(m.id)) continue;
    if (Math.hypot(m.x - x, m.z - z) > s.explode.r + ctx.data.creatures[m.type].r) continue;
    dealHit(ctx, a, m, s.attack * s.mult * s.explode.mult, { w, P, ability: s.ability, fx: s.fx });
  }
  for (const { b } of foesNear(ctx, a, x, z, s.explode.r + ACTOR_R)) {
    if (s.hit.includes(b.id)) continue;
    hitActor(ctx, a, b, s.attack * s.mult * s.explode.mult, { w, P, ability: s.ability });
  }
  ctx.emit('arrow.explode', { arrow: s.id, x, z, r: s.explode.r, proj: s.proj });
}

export function arrowsTick(ctx, dt) {
  const { state } = ctx;
  const t = state.t;
  if (state.arrows?.length) {
    const keep = [];
    for (const s of state.arrows) {
      const a = state.actors[s.by];
      s.x = Math.round((s.x + s.vx * dt) * 1000) / 1000;
      s.z = Math.round((s.z + s.vz * dt) * 1000) / 1000;
      let done = !a || t >= s.until;
      if (!done) {
        for (const m of Object.values(state.mobs)) {
          if (!isAlive(m) || s.hit.includes(m.id)) continue;
          if (Math.hypot(m.x - s.x, m.z - s.z) > s.r + ctx.data.creatures[m.type].r) continue;
          s.hit.push(m.id);
          arrowHit(ctx, a, s, m);
          ctx.emit('arrow.hit', { arrow: s.id, mob: m.id, x: s.x, z: s.z, proj: s.proj });
          if (s.hit.length >= s.pierce) {
            done = true;
            break;
          }
        }
      }
      if (!done && a) {
        for (const { b } of foesNear(ctx, a, s.x, s.z, s.r + ACTOR_R)) {
          if (s.hit.includes(b.id)) continue;
          s.hit.push(b.id);
          const P = mergeP(passivesOf(ctx, a, s.w), levelPassives(ctx, a, s.w));
          hitActor(ctx, a, b, s.attack * s.mult, { w: { mastery: s.w }, P, heavy: s.heavy, ability: s.ability, guardBreak: s.guardBreak });
          ctx.emit('arrow.hit', { arrow: s.id, actor: b.id, x: s.x, z: s.z, proj: s.proj });
          if (s.hit.length >= s.pierce) {
            done = true;
            break;
          }
        }
      }
      if (!done && ctx.obstacles) {
        for (const o of ctx.obstacles.near(s.x, s.z)) {
          if (Math.hypot(o.x - s.x, o.z - s.z) < o.r) {
            done = true;
            break;
          }
        }
      }
      if (done) {
        if (a && s.explode) explode(ctx, a, s, s.x, s.z);
        ctx.emit('arrow.end', { arrow: s.id, x: s.x, z: s.z, proj: s.proj });
        continue;
      }
      keep.push(s);
    }
    state.arrows = keep;
  }
  // 땅을 겨눈 범위: 정해진 간격마다 안의 적을 때린다
  if (state.zones?.length) {
    const keep = [];
    for (const z of state.zones) {
      const a = state.actors[z.by];
      if (a && t >= z.next - 1e-6) {
        const P = passivesOf(ctx, a, z.w);
        const w = { mastery: z.w, attack: z.attack };
        const hits = Object.values(state.mobs).filter((m) => isAlive(m) && Math.hypot(m.x - z.x, m.z - z.z) <= z.r + ctx.data.creatures[m.type].r)
          .sort((p, q) => (p.id < q.id ? -1 : 1)).slice(0, z.targets);
        for (const m of hits) dealHit(ctx, a, m, z.attack * z.mult, { w, P, ability: z.node, fx: z.fx });
        for (const { b } of foesNear(ctx, a, z.x, z.z, z.r + ACTOR_R).slice(0, Math.max(0, z.targets - hits.length))) hitActor(ctx, a, b, z.attack * z.mult, { w, P, ability: z.node });
        ctx.emit('zone.tick', { zone: z.id, x: z.x, z: z.z, r: z.r, hits: hits.length, proj: z.proj });
        z.left--;
        z.next = r2(z.next + z.every);
      }
      if (a && z.left > 0) keep.push(z);
      else ctx.emit('zone.end', { zone: z.id });
    }
    state.zones = keep;
  }
}

// 적을 쓰러뜨렸을 때(mobs.kill에서 부른다): 숙련 경험치·처치 패시브
export function onKill(ctx, a, m) {
  if (!a.cb) return;
  const type = ctx.data.creatures[m.type];
  const w = weaponOf(ctx, a);
  if (!w.mastery) return;
  gainXp(ctx, a, w.mastery, type.hp * ctx.data.weapons.xp.perKill);
  const P = passivesOf(ctx, a, w.mastery);
  const cb = a.cb;
  if (P.killHeal) cb.hp = r2(Math.min(cb.maxHp, cb.hp + P.killHeal));
  if (P.killSt) cb.st = r2(Math.min(ctx.cfg.combat.stamina, cb.st + P.killSt));
  if (P.killCd) for (const k of Object.keys(cb.cds)) cb.cds[k] = r2(cb.cds[k] - P.killCd);
}

// 짐승이 사람을 때린다. 구르는 앞부분이면 피하고, 앞을 막고 있으면 줄인다.
// opts.unblockable(v0.5): 두목의 내려찍기처럼 막아도 소용없는 공격
export function hurtActor(ctx, a, mob, raw, opts = null) {
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
  const w = weaponOf(ctx, a);
  const P = passivesOf(ctx, a, w.mastery);
  if (cb.block && !opts?.unblockable && cb.stunUntil <= t && angDiff(yawTo(a, mob), a.yaw) <= (C.blockArc * DEG) / 2) {
    blocked = true;
    const ld = equipLoad(ctx, a).tier;
    cb.st = r2(cb.st - raw * ld.blockCost * (1 - Math.min(0.6, P.blockCost || 0)));
    cb.staminaAt = t;
    dmg = raw * (1 - Math.min(0.95, (w.spec.blockCut ?? C.blockCut) + (P.blockCut || 0)));
    if (P.counter) cb.counterUntil = r2(t + 3);
    a.stats.blocked = (a.stats.blocked || 0) + 1;
    if (cb.st <= 0) {
      cb.st = 0;
      cb.block = false;
      cb.stunUntil = r2(t + C.guardBreakSec * equipLoad(ctx, a).tier.guardBreak);
      ctx.emit('combat.guardbreak', { actor: a.id });
    }
  }
  // 받는 피해 줄이기(v1.1): 스킬 버프 + 궁지의 광기
  const dr = Math.min(0.7, auraSum(a, t, 'dr') + (cb.hp < cb.maxHp * 0.5 ? P.lowHpDr || 0 : 0));
  if (dr > 0) dmg *= 1 - dr;
  if (a.kind === 'ally') dmg *= 1 - ctx.cfg.bond.allyDr; // 동행(v1.7)은 질기다
  dmg = Math.round(mitigate(ctx, dmg, armorOf(ctx, a) + (P.armor || 0)) * 10) / 10;
  cb.hp = r2(Math.max(0, cb.hp - dmg));
  cb.lastHitAt = t;
  if (opts?.pvp) {
    cb.lastBy = mob.id; // PvP(v2.6): 누구에게 맞았나
    if (a.rival) a.rival.lastBy = mob.id;
  }
  const pieces = SLOTS.map((s) => equipped(ctx, a, s)).filter((e) => e && !e.broken);
  if (pieces.length) wear(ctx, a, ctx.rng.pick(pieces), 1);
  a.stats.dmgTaken = r2((a.stats.dmgTaken || 0) + dmg);
  interrupt(ctx, a, 'hit');
  ctx.emit('combat.hurt', { actor: a.id, mob: mob.id, dmg, blocked, hp: cb.hp, pvp: !!opts?.pvp, crit: !!opts?.crit });
  if (cb.hp <= 0) down(ctx, a, mob);
  return true;
}

function down(ctx, a, mob) {
  const C = ctx.cfg.combat;
  const cb = a.cb;
  cb.downUntil = r2(ctx.state.t + C.downSec);
  cb.act = null;
  cb.dodge = null;
  cb.lunge = null;
  cb.aura = [];
  cb.block = false;
  a.move = null;
  a.dest = null;
  a.nav = null;
  a.action = null;
  // 쓰러지면 낀 장비 내구가 10% 준다(설계 11.3). 물건은 잃지 않는다.
  for (const s of ['weapon', 'weapon2', ...SLOTS]) {
    const e = equipped(ctx, a, s);
    if (e && e.maxDur) wear(ctx, a, e, Math.max(1, Math.round(e.maxDur * C.deathWear)));
  }
  a.stats.downs = (a.stats.downs || 0) + 1;
  // PvP(v2.6): 사람에게 쓰러지면 재료 일부를 빼앗긴다
  const by = mob && ctx.state.actors[mob.id];
  const taken = by ? onPvpDown(ctx, a, by) : null;
  ctx.emit('actor.down', { actor: a.id, mob: by ? null : mob?.id ?? null, by: by ? by.id : null, species: mob?.type ?? null, x: a.x, z: a.z, taken });
}

// 가장 가까운 마을 창고 앞에서 일어난다(v0.4)
function getUp(ctx, a) {
  const cb = a.cb;
  const s = nearestSettlement(ctx, a);
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
        if (cb.act.kind === 'ability') resolveAbility(ctx, a);
        else swing(ctx, a);
      }
      if (cb.act && t >= cb.act.endAt) cb.act = null;
    }
    if (cb.dodge && t >= cb.dodge.endAt) cb.dodge = null;
    if (cb.lunge && t >= cb.lunge.endAt) cb.lunge = null;
    if (cb.aura?.length && cb.aura.some((x) => x.until <= t)) cb.aura = cb.aura.filter((x) => x.until > t);
    // 최대 체력은 든 무기의 숙련 패시브를 따른다(바꾸면 넘치는 만큼 깎인다)
    const P = passivesNow(ctx, a);
    const bonus = P.maxHp || 0;
    if ((cb.hpBonus || 0) !== bonus) {
      cb.maxHp = r2(cb.maxHp + bonus - (cb.hpBonus || 0));
      cb.hpBonus = bonus;
      if (cb.hp > cb.maxHp) cb.hp = cb.maxHp;
    }
    // 마나(v1.2): 최대 마나는 숙련 패시브를 따르고, 늘 저절로 찬다
    const mm = (C.mana ?? 100) + (P.maxMp || 0);
    if (cb.maxMp !== mm) {
      cb.maxMp = mm;
      if (cb.mp > mm) cb.mp = mm;
    }
    if (cb.mp < cb.maxMp) cb.mp = r2(Math.min(cb.maxMp, cb.mp + (C.manaRegen ?? 6) * (1 + (P.mpRegen || 0) + auraSum(a, t, 'mpRegen')) * dt));
    if (cb.hp < cb.maxHp && t - cb.lastHitAt >= C.hpRegenDelay) cb.hp = r2(Math.min(cb.maxHp, cb.hp + C.hpRegen * dt));
    if (!cb.block && cb.st < C.stamina && t - cb.staminaAt >= C.staminaDelay) {
      const k = equipLoad(ctx, a).tier.stRegen * (1 + (P.stRegen || 0) + auraSum(a, t, 'stRegen'));
      cb.st = r2(Math.min(C.stamina, cb.st + C.staminaRegen * k * dt));
    }
  }
}
