// 짐승: 둥지(무리)마다 몇 마리가 살며, 코어가 30Hz로 움직인다(시드 난수만 쓴다).
// 성질: territorial(가까이 오면 문다) · aggressive(멀리서도 덤빈다, 무리째) · defensive(맞거나 아주 가까우면 돌진) · skittish(달아난다)
// 둥지마다 사냥터 속성(가죽·고기 묶음)이 있어 산지처럼 품질이 다르다.

import { rollProps, rollQty, round3 } from '../formulas.js';
import { fitsHabitat } from '../terrain.js';
import { addEntry, slotsNeeded } from '../inventory.js';
import { addXp } from './progress.js';
import { hurtActor, yawTo, isDown } from './combat.js';
import { resolve } from './actions.js';

const r2 = (v) => Math.round(v * 100) / 100;
const DEG = Math.PI / 180;

function pickGroupSpot(ctx, region, type, taken) {
  const { rng, terrain } = ctx;
  const [x0, z0, x1, z1] = region.bounds;
  for (let i = 0; i < 160; i++) {
    const x = rng.range(x0 + 24, x1 - 24);
    const z = rng.range(z0 + 2, z1 - 24);
    if (!fitsHabitat(terrain, region, type, x, z)) continue;
    if (taken.some((g) => Math.hypot(g.x - x, g.z - z) < (g.type === type.id ? 34 : 18))) continue;
    return [round3(x), round3(z)];
  }
  return null;
}

function spotNear(ctx, region, type, g, r) {
  for (let i = 0; i < 20; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const d = ctx.rng.range(0, r);
    const x = g.x + Math.sin(a) * d;
    const z = g.z + Math.cos(a) * d;
    if (ctx.terrain.walkable(x, z) && fitsHabitat(ctx.terrain, region, type, x, z)) return [round3(x), round3(z)];
  }
  return [g.x, g.z];
}

function newMob(ctx, region, type, g) {
  const [x, z] = spotNear(ctx, region, type, g, type.radius);
  const id = ctx.newId('m');
  ctx.state.mobs[id] = {
    id, type: type.id, group: g.id, x, z, yaw: round3(ctx.rng.range(-Math.PI, Math.PI)),
    hp: type.hp, mode: 'idle', until: r2(ctx.state.t + ctx.rng.range(1, 5)), dest: null, target: null,
    cd: 0, deadAt: null, respawnAt: null, skinned: false, skinning: null, killer: null, hitOnce: false,
  };
  g.mobs.push(id);
}

export function initMobs(ctx) {
  const { state, data, rng } = ctx;
  state.mobs = state.mobs || {};
  state.mobGroups = state.mobGroups || {};
  const region = data.lists.regions[0];
  const taken = Object.values(state.mobGroups).map((g) => ({ x: g.x, z: g.z, type: g.type }));
  for (const type of data.lists.creatures) {
    for (let k = 0; k < type.groups; k++) {
      const spot = pickGroupSpot(ctx, region, type, taken);
      if (!spot) continue;
      taken.push({ x: spot[0], z: spot[1], type: type.id });
      const gid = ctx.newId('g');
      const place = rng.pick(region.places);
      const lots = {};
      for (const lt of type.loot) {
        if (lots[lt.item]) continue;
        const item = data.items[lt.item];
        const lotId = ctx.newId('L');
        state.lots[lotId] = { id: lotId, item: item.id, name: `${place} ${type.name}`, props: rollProps(item.props, region.propDist, rng), vein: null, mix: false };
        lots[lt.item] = lotId;
      }
      const g = { id: gid, type: type.id, x: spot[0], z: spot[1], radius: type.radius, place, lots, mobs: [] };
      state.mobGroups[gid] = g;
      const n = rng.int(type.size[0], type.size[1]);
      for (let i = 0; i < n; i++) newMob(ctx, region, type, g);
    }
  }
}

// ── 움직임 ─────────────────────────────────────────
function moveToward(ctx, m, tx, tz, speed, dt) {
  const dx = tx - m.x;
  const dz = tz - m.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  const step = Math.min(d, speed * dt);
  let [nx, nz] = resolve(ctx, m, m.x + (dx / d) * step, m.z + (dz / d) * step);
  if (Math.abs(nx - m.x) + Math.abs(nz - m.z) < step * 0.2) {
    // 막혔으면 옆으로 비켜 본다
    const side = (m.id.charCodeAt(m.id.length - 1) & 1) ? 1 : -1;
    [nx, nz] = resolve(ctx, m, m.x + (-dz / d) * side * step, m.z + (dx / d) * side * step);
  }
  m.yaw = round3(Math.atan2(nx - m.x || dx, nz - m.z || dz));
  m.x = round3(nx);
  m.z = round3(nz);
  return d;
}

function nearestActor(ctx, m, r) {
  let best = null;
  let bd = r;
  for (const a of Object.values(ctx.state.actors)) {
    if (isDown(a)) continue;
    const d = Math.hypot(a.x - m.x, a.z - m.z);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

function setMode(ctx, m, mode, until = null) {
  m.mode = mode;
  m.until = until == null ? null : r2(until);
}

function aggro(ctx, m, a) {
  const type = ctx.data.creatures[m.type];
  if (type.temper === 'skittish') {
    m.target = a.id;
    setMode(ctx, m, 'flee', ctx.state.t + (type.flee || 4));
    return;
  }
  const first = m.mode !== 'chase' && m.mode !== 'windup' && m.mode !== 'charge' && m.mode !== 'recover';
  m.target = a.id;
  if (first) {
    setMode(ctx, m, 'chase');
    ctx.emit('mob.aggro', { mob: m.id, type: m.type, actor: a.id });
  }
}

// 무리 짐승은 하나가 덤비면 같이 덤빈다
function packAggro(ctx, m, a) {
  const type = ctx.data.creatures[m.type];
  aggro(ctx, m, a);
  if (type.temper !== 'aggressive' && type.temper !== 'skittish') return;
  for (const id of ctx.state.mobGroups[m.group].mobs) {
    const o = ctx.state.mobs[id];
    if (o && o !== m && o.mode !== 'dead' && o.mode !== 'return') aggro(ctx, o, a);
  }
}

export function hurtMob(ctx, m, a, dmg, heavy) {
  const type = ctx.data.creatures[m.type];
  m.hp = r2(Math.max(0, m.hp - dmg));
  a.stats.dmgDealt = r2((a.stats.dmgDealt || 0) + dmg);
  ctx.emit('combat.hit', { actor: a.id, mob: m.id, type: m.type, dmg, heavy, hp: m.hp });
  if (m.hp <= 0) {
    kill(ctx, m, a);
    return;
  }
  if (heavy && type.stagger && m.mode === 'windup') {
    setMode(ctx, m, 'recover', ctx.state.t + 0.6);
    m.cd = r2(ctx.state.t + 0.8);
    ctx.emit('mob.stagger', { mob: m.id });
  }
  if (m.mode === 'return') return;
  packAggro(ctx, m, a);
}

function kill(ctx, m, a) {
  const type = ctx.data.creatures[m.type];
  setMode(ctx, m, 'dead');
  m.hp = 0;
  m.target = null;
  m.deadAt = ctx.state.t;
  m.respawnAt = r2(ctx.state.t + ctx.rng.int(type.respawn[0], type.respawn[1]));
  m.skinned = false;
  m.skinning = null;
  m.killer = a.id;
  a.stats.kills = a.stats.kills || {};
  a.stats.kills[m.type] = (a.stats.kills[m.type] || 0) + 1;
  ctx.emit('mob.die', { mob: m.id, type: m.type, actor: a.id, x: m.x, z: m.z });
}

function strike(ctx, m, type) {
  const a = ctx.state.actors[m.target];
  if (!a || isDown(a)) return;
  const d = Math.hypot(a.x - m.x, a.z - m.z);
  const half = ((type.attack.arc || 90) * DEG) / 2;
  let diff = Math.abs(yawTo(m, a) - m.yaw);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  if (d <= type.attack.range + 0.35 && (d < 0.6 || diff <= half)) hurtActor(ctx, a, m, type.dmg);
  else ctx.emit('mob.miss', { mob: m.id, actor: a.id });
}

export function mobsTick(ctx, dt) {
  const { state, data } = ctx;
  const t = state.t;
  const region = data.lists.regions[0];
  for (const m of Object.values(state.mobs)) {
    const type = data.creatures[m.type];
    const g = state.mobGroups[m.group];
    if (m.mode === 'dead') {
      if (t >= m.respawnAt) {
        const [x, z] = spotNear(ctx, region, type, g, type.radius);
        Object.assign(m, { x, z, hp: type.hp, deadAt: null, respawnAt: null, skinned: false, skinning: null, killer: null, target: null, cd: 0 });
        setMode(ctx, m, 'idle', t + ctx.rng.range(1, 4));
        ctx.emit('mob.spawn', { mob: m.id, type: m.type });
      }
      continue;
    }
    const home = Math.hypot(m.x - g.x, m.z - g.z);
    const tgt = m.target ? state.actors[m.target] : null;
    // 둥지에서 너무 멀리 끌려가면 돌아간다
    if (m.mode !== 'return' && (home > type.leash || (m.target && (!tgt || isDown(tgt))))) {
      m.target = null;
      setMode(ctx, m, 'return');
    }
    switch (m.mode) {
      case 'idle':
      case 'wander': {
        if (!(m.calmUntil > t)) {
          const a = nearestActor(ctx, m, type.aggro || 0);
          if (a) {
            packAggro(ctx, m, a);
            break;
          }
        }
        if (m.mode === 'idle') {
          if (t >= m.until) {
            m.dest = spotNear(ctx, region, type, g, type.radius + 3);
            setMode(ctx, m, 'wander', t + 7);
          }
        } else if (moveToward(ctx, m, m.dest[0], m.dest[1], type.walk, dt) < 0.3 || t >= m.until) {
          m.dest = null;
          setMode(ctx, m, 'idle', t + ctx.rng.range(3, 8));
        }
        break;
      }
      case 'flee': {
        if (tgt) {
          const d = Math.hypot(m.x - tgt.x, m.z - tgt.z) || 1;
          moveToward(ctx, m, m.x + ((m.x - tgt.x) / d) * 4, m.z + ((m.z - tgt.z) / d) * 4, type.speed, dt);
        }
        if (t >= m.until) {
          // 한참 달아난 뒤엔 숨을 고른다(그동안은 다가가도 다시 달아나지 않는다)
          m.target = null;
          m.calmUntil = r2(t + (type.calm || 0));
          setMode(ctx, m, 'idle', t + ctx.rng.range(2, 5));
        }
        break;
      }
      case 'chase': {
        if (!tgt) break;
        const d = Math.hypot(tgt.x - m.x, tgt.z - m.z);
        const reach = type.attack.range;
        if (d > reach) moveToward(ctx, m, tgt.x, tgt.z, type.speed, dt);
        else m.yaw = round3(yawTo(m, tgt));
        if (d <= reach + 0.2 && t >= m.cd) {
          setMode(ctx, m, 'windup', t + type.attack.windup);
          ctx.emit('mob.windup', { mob: m.id, type: m.type, actor: tgt.id, sec: type.attack.windup });
        }
        break;
      }
      case 'windup': {
        // 준비 동작의 앞 2/3 동안만 고개를 돌린다. 끝무렵에 굴러 피할 틈이 생긴다.
        if (tgt && t < m.until - type.attack.windup / 3) m.yaw = round3(yawTo(m, tgt));
        if (t >= m.until) {
          if (type.attack.charge) {
            m.hitOnce = false;
            setMode(ctx, m, 'charge', t + type.attack.charge.time);
          } else {
            strike(ctx, m, type);
            m.cd = r2(t + type.attack.cooldown);
            setMode(ctx, m, 'recover', t + 0.35);
          }
        }
        break;
      }
      case 'charge': {
        const c = type.attack.charge;
        const [nx, nz] = resolve(ctx, m, m.x + Math.sin(m.yaw) * c.speed * dt, m.z + Math.cos(m.yaw) * c.speed * dt);
        m.x = round3(nx);
        m.z = round3(nz);
        if (tgt && !m.hitOnce && Math.hypot(tgt.x - m.x, tgt.z - m.z) <= c.hitR) {
          m.hitOnce = true;
          hurtActor(ctx, tgt, m, type.dmg);
        }
        if (t >= m.until) {
          m.cd = r2(t + type.attack.cooldown);
          setMode(ctx, m, 'recover', t + 0.6);
        }
        break;
      }
      case 'recover': {
        if (t >= m.until) setMode(ctx, m, tgt ? 'chase' : 'return');
        break;
      }
      case 'return': {
        if (moveToward(ctx, m, g.x, g.z, type.walk * 2.2, dt) < 1.5) {
          m.hp = type.hp;
          m.target = null;
          setMode(ctx, m, 'idle', t + ctx.rng.range(2, 5));
        }
        break;
      }
      default:
        setMode(ctx, m, 'idle', t + 2);
    }
  }
  // 같은 무리끼리 겹치지 않게 살짝 밀어낸다
  for (const g of Object.values(state.mobGroups)) {
    if (g.mobs.length < 2) continue;
    const r = data.creatures[g.type].r * 2;
    for (let i = 0; i < g.mobs.length; i++) {
      for (let j = i + 1; j < g.mobs.length; j++) {
        const p = state.mobs[g.mobs[i]];
        const q = state.mobs[g.mobs[j]];
        if (!p || !q || p.mode === 'dead' || q.mode === 'dead') continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d >= r || d < 1e-6) continue;
        const push = (r - d) / 2;
        q.x = round3(q.x + (dx / d) * push);
        q.z = round3(q.z + (dz / d) * push);
        p.x = round3(p.x - (dx / d) * push);
        p.z = round3(p.z - (dz / d) * push);
      }
    }
  }
}

// ── 손질(수렵) ─────────────────────────────────────
export function corpseOpen(ctx, m) {
  return m && m.mode === 'dead' && !m.skinned && ctx.state.t <= m.deadAt + ctx.cfg.combat.corpseSec;
}

export function skinLoot(ctx, m) {
  const type = ctx.data.creatures[m.type];
  const g = ctx.state.mobGroups[m.group];
  return type.loot.map((lt) => ({ item: lt.item, lot: g.lots[lt.item] ?? null, bonus: null, qty: lt.qty }));
}

export function skinSeconds(ctx, a, type) {
  const bonus = Math.min(Math.max(0, a.skills.hunting.level - type.hunt.level) * ctx.cfg.gather.skillBonusPerLevel, ctx.cfg.gather.skillBonusMax);
  return r2(type.hunt.seconds / (1 + bonus * 2));
}

export function finishSkin(ctx, a) {
  const { cfg, rng } = ctx;
  const act = a.action;
  a.action = null;
  const m = ctx.state.mobs[act.mob];
  if (!corpseOpen(ctx, m)) {
    ctx.emit('skin.failed', { actor: a.id, mob: act.mob, reason: 'no_corpse' });
    return;
  }
  const type = ctx.data.creatures[m.type];
  const bonus = Math.min(Math.max(0, a.skills.hunting.level - type.hunt.level) * cfg.gather.skillBonusPerLevel, cfg.gather.skillBonusMax);
  const got = [];
  for (const e of skinLoot(ctx, m)) {
    const qty = Math.max(1, rollQty(e.qty * (1 + bonus), rng));
    const entry = { ...e, qty };
    if (a.bag.length + slotsNeeded(a.bag, [entry]) > cfg.bag.slots) continue;
    addEntry(a.bag, entry);
    got.push({ item: e.item, lot: e.lot, qty });
  }
  m.skinned = true;
  m.skinning = null;
  a.stats.skin = a.stats.skin || {};
  a.stats.skin[m.type] = (a.stats.skin[m.type] || 0) + 1;
  addXp(ctx, a, 'hunting', type.hunt.xp);
  ctx.emit('skin.done', { actor: a.id, mob: m.id, type: m.type, items: got, xp: type.hunt.xp });
}
