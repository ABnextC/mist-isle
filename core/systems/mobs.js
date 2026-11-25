// 짐승과 적: 둥지(무리)마다 몇 마리가 살며, 코어가 30Hz로 움직인다(시드 난수만 쓴다).
// 성질: territorial(가까이 오면 문다) · aggressive(멀리서도 덤빈다, 무리째) · defensive(맞거나 아주 가까우면 돌진) · skittish(달아난다)
// 둥지마다 사냥터 속성(가죽·고기 묶음)이 있어 산지처럼 품질이 다르다.
// v0.5: 검은 돛 약탈단(사람 모양) — 공격 여러 개·막기·단계(부하 부르기)·던지기, 자리(야영지)에 서 있는 보초,
//       밤에만 나오는 안개 늑대(away 상태), 임시 짐승(습격 물결·부하, 죽으면 사라진다), 쓰러뜨리면 바로 들어오는 전리품.

import { creditOf } from './allies.js';
import { gainLevelXp, mobXp } from './level.js';
import { rollProps, rollQty, round3 } from '../formulas.js';
import { fitsHabitat, regionAt } from '../terrain.js';
import { addEntry, slotsNeeded } from '../inventory.js';
import { addXp } from './progress.js';
import { hurtActor, yawTo, isDown, angDiff, onKill } from './combat.js';
import { resolve } from './actions.js';
import { siteXZ } from '../world.js';
import { questKill } from './quests.js';

const r2 = (v) => Math.round(v * 100) / 100;
const DEG = Math.PI / 180;

// 살아서 세상에 나와 있는가(쓰러짐·밤 짐승의 낮 숨음 제외)
export const isAlive = (m) => !!m && m.mode !== 'dead' && m.mode !== 'away';

// ── 상태 이상(v1.1 무기 스킬): 기절·느려짐·출혈·약화(주는 피해↓)·노출(받는 피해↑) ──
export const fxOn = (m, k, t) => !!m.fx?.[k] && m.fx[k].until > t;
const slowK = (ctx, m) => (fxOn(m, 'slow', ctx.state.t) ? 1 - m.fx.slow.k : 1);
export const weakK = (ctx, m) => (fxOn(m, 'weak', ctx.state.t) ? 1 - m.fx.weak.k : 1);
// 큰 놈(두목·파수꾼)은 기절이 반만 먹는다
const tenacity = (type) => (type.phases || type.hp >= 600 ? 0.5 : 1);

export function applyMobFx(ctx, m, a, fx, attack) {
  const t = ctx.state.t;
  const type = ctx.data.creatures[m.type];
  m.fx ??= {};
  if (fx.stun) {
    const sec = r2(fx.stun * tenacity(type));
    m.fx.stun = { until: r2(Math.max(m.fx.stun?.until || 0, t + sec)) };
    if (m.mode === 'windup' || m.mode === 'charge') setMode(ctx, m, 'recover', m.fx.stun.until);
    m.cd = r2(Math.max(m.cd || 0, m.fx.stun.until + 0.3));
  }
  if (fx.slow) m.fx.slow = { k: fx.slow.k, until: r2(t + fx.slow.sec) };
  if (fx.weak) m.fx.weak = { k: fx.weak.k, until: r2(t + fx.weak.sec) };
  if (fx.expose) m.fx.expose = { k: fx.expose.k, until: r2(t + fx.expose.sec) };
  if (fx.bleed) m.fx.bleed = { dps: r2(attack * fx.bleed.mult), until: r2(t + fx.bleed.sec), by: a.id, next: r2(t + 1) };
  if (fx.knock && !type.statue) {
    const d = Math.hypot(m.x - a.x, m.z - a.z) || 1;
    const push = fx.knock < 0 ? -Math.min(-fx.knock, Math.max(0, d - 1.3)) : fx.knock * (type.hp >= 600 ? 0.3 : 1);
    const [nx, nz] = resolve(ctx, m, m.x + ((m.x - a.x) / d) * push, m.z + ((m.z - a.z) / d) * push);
    m.x = round3(nx);
    m.z = round3(nz);
  }
  if (fx.taunt && isAlive(m)) {
    m.target = a.id;
    if (m.mode === 'idle' || m.mode === 'wander' || m.mode === 'return') aggro(ctx, m, a);
  }
  ctx.emit('mob.fx', { mob: m.id, actor: a.id, fx: Object.keys(fx) });
}

// 출혈은 1초마다 갑옷을 무시하고 깎는다. 끝난 상태는 지운다
function fxTick(ctx, m) {
  const t = ctx.state.t;
  const b = m.fx.bleed;
  if (b && t >= b.next && b.until >= t - 1e-6) {
    b.next = r2(b.next + 1);
    const a = ctx.state.actors[b.by];
    if (a) hurtMob(ctx, m, a, Math.max(0.5, b.dps), false, { dot: true });
  }
  if (!isAlive(m)) return;
  for (const k of Object.keys(m.fx)) if (m.fx[k].until < t) delete m.fx[k];
  if (!Object.keys(m.fx).length) m.fx = null;
}

function siteNear(ctx, region, x, z, pad) {
  for (const s of region.sites || []) {
    if (!s.members && !s.structures) continue;
    const [sx, sz] = siteXZ(ctx.terrain, s);
    if (Math.hypot(x - sx, z - sz) < s.r + pad) return true;
  }
  return false;
}

// 지역별 무리(v0.6): type.regions[지역] = { groups, zband }. 없으면 첫 지역에만 type.groups
const regionSpec = (ctx, type, region) => type.regions?.[region.id] || null;
// 지역 무리 설정이 zone·habitat을 바꿀 수 있다(본섬 늪의 망령)
const typeIn = (ctx, type, region) => {
  const sp = regionSpec(ctx, type, region);
  return sp && (sp.zone !== undefined || sp.habitat) ? { ...type, zone: sp.zone ?? type.zone, habitat: sp.habitat || type.habitat } : type;
};
const groupCount = (ctx, type, region) => regionSpec(ctx, type, region)?.groups ?? (region === ctx.data.lists.regions[0] ? type.groups || 0 : 0);

export function groupSpot(ctx, region, type, taken) {
  const { rng, terrain } = ctx;
  const [x0, z0, x1, z1] = region.bounds;
  for (let i = 0; i < 160; i++) {
    const x = rng.range(x0 + 24, x1 - 24);
    const z = rng.range(z0 + 2, z1 - 24);
    const zb = regionSpec(ctx, type, region)?.zband ?? (region === ctx.data.lists.regions[0] ? type.zband : null);
    if (zb && (z < zb[0] || z > zb[1])) continue;
    if (!fitsHabitat(terrain, region, typeIn(ctx, type, region), x, z)) continue;
    // 무리가 마을까지 어슬렁거리지 않게 정착지에서 넉넉히 띄운다(v0.4)
    if (region.settlements.some((t) => Math.hypot(x - t.x, z - t.z) < t.radius + 18 + type.radius)) continue;
    // 야영지·정박지와도 떨어뜨린다(v0.5)
    if (siteNear(ctx, region, x, z, 20 + type.radius)) continue;
    if (taken.some((g) => Math.hypot(g.x - x, g.z - z) < (g.type === type.id ? 34 : 18))) continue;
    return [round3(x), round3(z)];
  }
  return null;
}

// 둥지 둘레 빈자리. 자리(야영지) 무리는 서식지 대신 걸을 수 있는지만 본다
function spotNear(ctx, region, type, g, r, home = g) {
  for (let i = 0; i < 20; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const d = ctx.rng.range(0, r);
    const x = home.x + Math.sin(a) * d;
    const z = home.z + Math.cos(a) * d;
    if (ctx.terrain.walkable(x, z) && (g.site || g.temp || fitsHabitat(ctx.terrain, region, typeIn(ctx, type, region), x, z))) return [round3(x), round3(z)];
  }
  return [home.x, home.z];
}

const homeOf = (m, g) => (m.post ? { x: m.post[0], z: m.post[1] } : g);
// 밤에만 나오는 무리(v0.5.1): 들판 무리만. 자리(옛 등불터)·임시(습격·부름) 망령은 낮에도 있다
const nightOnly = (type, g, m) => !!type.night && !g.site && !g.temp && !m?.temp;

function newMob(ctx, region, type, g, post = null) {
  const [x, z] = post ? [round3(post[0]), round3(post[1])] : spotNear(ctx, region, type, g, type.radius);
  const id = ctx.newId('m');
  const away = nightOnly(type, g) && !ctx.clock.isNight(ctx.state.t);
  const m = {
    id, type: type.id, group: g.id, x, z, yaw: post ? round3(post[2] || 0) : round3(ctx.rng.range(-Math.PI, Math.PI)),
    hp: type.hp, mode: away ? 'away' : 'idle', until: r2(ctx.state.t + ctx.rng.range(1, 5)), dest: null, target: null,
    cd: 0, deadAt: null, respawnAt: null, skinned: false, skinning: null, killer: null, hitOnce: false,
  };
  if (post) m.post = [round3(post[0]), round3(post[1]), round3(post[2] || 0)];
  ctx.state.mobs[id] = m;
  g.mobs.push(id);
  return m;
}

// 자리 무리(야영지·망루·정박지): 데이터에 적힌 보초 자리에 하나씩 세운다
export function addSiteGroup(ctx, region, s) {
  const [x, z] = siteXZ(ctx.terrain, s);
  const gid = ctx.newId('g');
  const g = { id: gid, type: s.members[0].type, x: round3(x), z: round3(z), radius: s.r, place: s.name, lots: {}, mobs: [], site: s.id };
  ctx.state.mobGroups[gid] = g;
  for (const mem of s.members) newMob(ctx, region, ctx.data.creatures[mem.type], g, [x + mem.dx, z + mem.dz, mem.yaw || 0]);
  return g;
}

export function initMobs(ctx) {
  const { state, data, rng } = ctx;
  state.mobs = state.mobs || {};
  state.mobGroups = state.mobGroups || {};
  state.shots = state.shots || [];
  const regions = data.lists.regions;
  const taken = Object.values(state.mobGroups).map((g) => ({ x: g.x, z: g.z, type: g.type }));
  const have = new Set(Object.values(state.mobGroups).map((g) => `${g.type}@${regionAt(regions, g.x).id}`));
  for (const region of regions) {
  for (const type of data.lists.creatures) {
    const count = groupCount(ctx, type, region);
    if (!count || have.has(`${type.id}@${region.id}`)) continue;
    for (let k = 0; k < count; k++) {
      const spot = groupSpot(ctx, region, type, taken);
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
  const siteDone = new Set(Object.values(state.mobGroups).map((g) => g.site).filter(Boolean));
  for (const s of region.sites || []) if (s.members?.length && !siteDone.has(s.id)) addSiteGroup(ctx, region, s);
  }
}

// 임시 무리·짐승(v0.5): 습격 물결과 두목이 부른 부하. 쓰러지면 다시 나지 않고 사라진다
export function tempGroup(ctx, x, z, extra = {}) {
  const gid = ctx.newId('g');
  const g = { id: gid, type: null, x: round3(x), z: round3(z), radius: 6, place: '', lots: {}, mobs: [], temp: true, ...extra };
  ctx.state.mobGroups[gid] = g;
  return g;
}

export function spawnTemp(ctx, g, typeId, x, z, extra = {}) {
  const type = ctx.data.creatures[typeId];
  const id = ctx.newId('m');
  const m = {
    id, type: typeId, group: g.id, x: round3(x), z: round3(z), yaw: 0, hp: type.hp, mode: 'idle', until: r2(ctx.state.t + 1), dest: null, target: null,
    cd: r2(ctx.state.t + 0.8), deadAt: null, respawnAt: null, skinned: false, skinning: null, killer: null, hitOnce: false, temp: true, ...extra,
  };
  ctx.state.mobs[id] = m;
  g.mobs.push(id);
  if (!g.type) g.type = typeId;
  ctx.emit('mob.spawn', { mob: id, species: typeId, temp: true });
  return m;
}

export function removeMob(ctx, m) {
  const g = ctx.state.mobGroups[m.group];
  delete ctx.state.mobs[m.id];
  if (g) {
    g.mobs = g.mobs.filter((id) => id !== m.id);
    if (g.temp && !g.mobs.length) delete ctx.state.mobGroups[g.id];
  }
  ctx.emit('mob.gone', { mob: m.id, species: m.type });
}

// 걸을 수 있는 빈자리(임시 짐승을 놓을 때)
export function freeSpot(ctx, x, z, r) {
  for (let i = 0; i < 24; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const d = ctx.rng.range(r * 0.3, r);
    const px = x + Math.sin(a) * d;
    const pz = z + Math.cos(a) * d;
    if (!ctx.terrain.walkable(px, pz)) continue;
    if (ctx.obstacles && ctx.obstacles.near(px, pz).some((o) => Math.hypot(o.x - px, o.z - pz) < o.r + 0.6)) continue;
    return [round3(px), round3(pz)];
  }
  return [round3(x), round3(z)];
}

// ── 움직임 ─────────────────────────────────────────
function moveToward(ctx, m, tx, tz, speed0, dt) {
  const speed = speed0 * slowK(ctx, m);
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

// 뒷걸음(창잡이·투척꾼이 거리를 벌린다): 상대를 본 채 물러난다
function backOff(ctx, m, tgt, speed0, dt) {
  const speed = speed0 * slowK(ctx, m);
  const dx = m.x - tgt.x;
  const dz = m.z - tgt.z;
  const d = Math.hypot(dx, dz) || 1;
  const [nx, nz] = resolve(ctx, m, m.x + (dx / d) * speed * dt, m.z + (dz / d) * speed * dt);
  m.x = round3(nx);
  m.z = round3(nz);
  m.yaw = round3(yawTo(m, tgt));
}

// 거리 벌리기는 잠깐만(kite: [물러나는 초, 다시 물러나기까지 초]). 그사이엔 버티고 싸운다
function kiting(m, type, t) {
  const [go, wait] = type.kite || [1e9, 0];
  if (m.kiteUntil != null && t < m.kiteUntil) return true;
  if (m.kiteCd != null && t < m.kiteCd) return false;
  m.kiteUntil = r2(t + go);
  m.kiteCd = r2(t + go + wait);
  return true;
}

// 깨울 수 있는 사람(v0.5.1): 석상은 이야기(wake 퀘스트)를 받은 개척자에게만 깨어난다
export const canWake = (type, a) => !type.wake || !!a?.quests?.active?.[type.wake] || a?.quests?.done?.[type.wake] != null;
// 잠든 석상: 아직 아무도 노리지 않는 석상
export const asleep = (type, m) => !!type.statue && !m.target && (m.mode === 'idle' || m.mode === 'wander');

function nearestActor(ctx, m, r, type = null) {
  let best = null;
  let bd = r;
  for (const a of Object.values(ctx.state.actors)) {
    if (isDown(a) || a.kind === 'rival') continue; // 다른 세력 개척자(v2.6)는 짐승이 건드리지 않는다
    if (type?.wake && !canWake(type, a)) continue;
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
  const first = m.mode !== 'chase' && m.mode !== 'windup' && m.mode !== 'charge' && m.mode !== 'recover' && m.mode !== 'guard';
  m.target = a.id;
  if (first) {
    setMode(ctx, m, 'chase');
    ctx.emit('mob.aggro', { mob: m.id, species: m.type, actor: a.id });
  }
}

// 무리 짐승은 하나가 덤비면 같이 덤빈다(v0.5: assist가 있으면 그 거리 안의 동료만)
// solo(v0.5.1, 돌 해태): 동료를 부르지도, 동료의 부름에 깨어나지도 않는다
function packAggro(ctx, m, a) {
  const type = ctx.data.creatures[m.type];
  aggro(ctx, m, a);
  if (type.solo || (type.temper !== 'aggressive' && type.temper !== 'skittish')) return;
  for (const id of ctx.state.mobGroups[m.group].mobs) {
    const o = ctx.state.mobs[id];
    if (!o || o === m || !isAlive(o) || o.mode === 'return') continue;
    if (ctx.data.creatures[o.type].solo) continue;
    if (type.assist && Math.hypot(o.x - m.x, o.z - m.z) > type.assist) continue;
    aggro(ctx, o, a);
  }
}

// 단계(두목): 지난 단계마다 빨라진다
function hasteOf(m, type) {
  if (!m.phase || !type.phases) return 1;
  let k = 1;
  for (let i = 0; i < m.phase; i++) k *= type.phases[i].haste || 1;
  return k;
}

const attackOf = (m, type) => type.attacks[m.atk?.i ?? 0] || type.attacks[0];

// 준 피해를 돌려준다(석상처럼 안 먹히면 0). opts: crit·ability·dot(출혈) 표시
export function hurtMob(ctx, m, a, dmg0, heavy, opts = null) {
  const type = ctx.data.creatures[m.type];
  const t = ctx.state.t;
  // 잠든 석상은 그냥 돌이다(이야기를 받기 전엔 칼날이 튕겨 나온다)
  if (asleep(type, m) && !canWake(type, a)) {
    ctx.emit('mob.immune', { mob: m.id, species: m.type, actor: a.id });
    return 0;
  }
  let dmg = dmg0;
  let blocked = false;
  // 막기(v0.5): 앞에서 오는 약공은 크게 줄이고, 강공은 막기를 깨뜨려 비틀거리게 한다
  if (m.mode === 'guard' && angDiff(yawTo(m, a), m.yaw) <= 75 * DEG) {
    if (heavy) {
      setMode(ctx, m, 'recover', t + 1.0);
      m.cd = r2(t + 1.1);
      ctx.emit('mob.guardbreak', { mob: m.id, actor: a.id });
    } else {
      dmg = Math.max(0.5, Math.round(dmg * (1 - (type.guardCut ?? 0.75)) * 10) / 10);
      blocked = true;
    }
  }
  m.hp = r2(Math.max(0, m.hp - dmg));
  a.stats.dmgDealt = r2((a.stats.dmgDealt || 0) + dmg);
  ctx.emit('combat.hit', { actor: a.id, mob: m.id, species: m.type, dmg, heavy, hp: m.hp, blocked, crit: !!opts?.crit, ability: opts?.ability || null, dot: !!opts?.dot });
  if (m.hp <= 0) {
    kill(ctx, m, a);
    return dmg;
  }
  // 두목 단계: 체력이 정해진 비율 아래로 내려가면 부하를 부르고 빨라진다
  if (type.phases) {
    while ((m.phase || 0) < type.phases.length && m.hp <= type.hp * type.phases[m.phase || 0].at) {
      const p = type.phases[m.phase || 0];
      m.phase = (m.phase || 0) + 1;
      if (p.summon) summon(ctx, m, p.summon, a);
      ctx.emit('mob.phase', { mob: m.id, species: m.type, phase: m.phase, say: p.say || null, note: p.note || null });
    }
  }
  if (heavy && type.stagger && m.mode === 'windup') {
    setMode(ctx, m, 'recover', t + 0.6);
    m.cd = r2(t + 0.8);
    ctx.emit('mob.stagger', { mob: m.id });
  }
  if (m.mode === 'return' && type.temper !== 'skittish') return dmg;
  packAggro(ctx, m, a);
  return dmg;
}

function summon(ctx, boss, members, a) {
  const g = ctx.state.mobGroups[boss.group];
  for (const [typeId, n] of Object.entries(members)) {
    for (let i = 0; i < n; i++) {
      const [x, z] = freeSpot(ctx, boss.x, boss.z, 7);
      const m = spawnTemp(ctx, g, typeId, x, z, { by: boss.id, leash: 40 });
      m.target = a.id;
      setMode(ctx, m, 'chase');
    }
  }
}

// 사람 모양 적이 떨군 재료의 묶음(종류·품목마다 하나). 처음 떨굴 때 만든다
function dropLot(ctx, type, itemId) {
  const { state, data, rng } = ctx;
  const item = data.items[itemId];
  if (!item.family) return null;
  state.dropLots = state.dropLots || {};
  const key = `${type.faction || type.id}:${itemId}`;
  if (state.dropLots[key] && state.lots[state.dropLots[key]]) return state.dropLots[key];
  const lotId = ctx.newId('L');
  const region = data.lists.regions[0];
  state.lots[lotId] = { id: lotId, item: itemId, name: `${type.faction === 'blacksail' ? '검은 돛 약탈품' : type.name}`, props: rollProps(item.props, region.propDist, rng), vein: null, mix: false };
  state.dropLots[key] = lotId;
  return lotId;
}

// 전리품(v0.5): 은화와 재료가 쓰러뜨린 사람 가방에 바로 들어온다. 가방이 차면 그 재료는 버린다
function autoLoot(ctx, m, a, type) {
  const { rng, cfg } = ctx;
  const d = type.drops;
  const silver = d.silver ? rng.int(d.silver[0], d.silver[1]) : 0;
  if (silver) {
    a.silver += silver;
    a.stats.lootSilver = (a.stats.lootSilver || 0) + silver;
  }
  const items = [];
  let lost = 0;
  for (const it of d.items || []) {
    if (!rng.chance(it.chance ?? 1)) continue;
    const entry = { item: it.item, lot: dropLot(ctx, type, it.item), bonus: null, qty: it.qty || 1 };
    if (a.bag.length + slotsNeeded(a.bag, [entry]) > cfg.bag.slots) {
      lost += entry.qty;
      continue;
    }
    addEntry(a.bag, entry);
    items.push({ item: entry.item, qty: entry.qty });
  }
  if (silver || items.length || lost) ctx.emit('loot', { actor: a.id, mob: m.id, species: m.type, silver, items, lost });
}

function kill(ctx, m, a) {
  const type = ctx.data.creatures[m.type];
  setMode(ctx, m, 'dead');
  m.hp = 0;
  m.target = null;
  delete m.atk;
  m.deadAt = ctx.state.t;
  m.respawnAt = m.temp ? null : r2(ctx.state.t + ctx.rng.int(type.respawn[0], type.respawn[1]));
  m.skinned = !type.hunt; // 손질할 게 없는 적은 처음부터 '손질 끝'
  m.skinning = null;
  m.killer = a.id;
  m.fx = null;
  a.stats.kills = a.stats.kills || {};
  a.stats.kills[m.type] = (a.stats.kills[m.type] || 0) + 1;
  ctx.emit('mob.die', { mob: m.id, species: m.type, actor: a.id, x: m.x, z: m.z, temp: !!m.temp });
  // 동행(v1.7)이 잡은 짐승은 주인 몫
  const own = creditOf(ctx, a);
  gainLevelXp(ctx, own, mobXp(ctx, own, m.type), 'kill'); // 전투 레벨(v2.3)
  if (type.drops) autoLoot(ctx, m, own, type);
  questKill(ctx, own, m);
  onKill(ctx, a, m);
}

function strike(ctx, m, type, at) {
  const a = ctx.state.actors[m.target];
  if (!a || isDown(a)) return;
  const d = Math.hypot(a.x - m.x, a.z - m.z);
  const half = ((at.arc || 90) * DEG) / 2;
  let diff = Math.abs(yawTo(m, a) - m.yaw);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  if (d <= at.range + 0.35 && (d < 0.6 || diff <= half)) hurtActor(ctx, a, m, type.dmg * (at.mult ?? 1) * weakK(ctx, m), at);
  else ctx.emit('mob.miss', { mob: m.id, actor: a.id });
}

// ── 던지기(v0.5): 손도끼가 날아간다. 구르는 앞부분이면 피하고, 앞을 막으면 줄인다 ──
function fireShot(ctx, m, type, at, tgt) {
  if (!tgt) return;
  const t = ctx.state.t;
  const s = at.shot;
  const yaw = yawTo(m, tgt);
  m.yaw = round3(yaw);
  const id = ctx.newId('s');
  const sx = Math.sin(yaw);
  const sz = Math.cos(yaw);
  ctx.state.shots.push({
    id, mob: m.id, kind: type.id, x: round3(m.x + sx * 0.6), z: round3(m.z + sz * 0.6), vx: round3(sx * s.speed), vz: round3(sz * s.speed),
    r: s.r, dmg: r2(type.dmg * (at.mult ?? 1) * weakK(ctx, m)), t0: r2(t), until: r2(t + (at.range + 3) / s.speed),
  });
  ctx.emit('shot.fire', { shot: id, mob: m.id, species: m.type });
}

function shotsTick(ctx, dt) {
  const { state } = ctx;
  if (!state.shots?.length) return;
  const t = state.t;
  const keep = [];
  for (const s of state.shots) {
    s.x = round3(s.x + s.vx * dt);
    s.z = round3(s.z + s.vz * dt);
    let done = t >= s.until;
    let hitActor = null;
    if (!done) {
      for (const a of Object.values(state.actors)) {
        if (isDown(a) || a.kind === 'rival') continue;
        if (Math.hypot(a.x - s.x, a.z - s.z) <= s.r + 0.3) {
          hitActor = a;
          break;
        }
      }
    }
    if (hitActor) {
      const src = state.mobs[s.mob] || { id: s.mob, type: s.kind, x: s.x - s.vx * 0.2, z: s.z - s.vz * 0.2 };
      // 막기 방향은 날아온 쪽으로 본다
      const from = { ...src, x: s.x - s.vx * 0.2, z: s.z - s.vz * 0.2 };
      hurtActor(ctx, hitActor, from, s.dmg, { shot: true });
      ctx.emit('shot.hit', { shot: s.id, actor: hitActor.id, x: s.x, z: s.z });
      continue;
    }
    if (!done && ctx.obstacles) {
      for (const o of ctx.obstacles.near(s.x, s.z)) {
        if (Math.hypot(o.x - s.x, o.z - s.z) < o.r) {
          done = true;
          break;
        }
      }
      if (!done && !ctx.terrain.walkable(s.x, s.z)) done = true;
    }
    if (done) {
      ctx.emit('shot.end', { shot: s.id, x: s.x, z: s.z });
      continue;
    }
    keep.push(s);
  }
  state.shots = keep;
}

// 공격 고르기: 지금 거리에서 닿는 공격 가운데 무게(w)로 하나. 하나뿐이면 난수를 쓰지 않는다
function pickAttack(ctx, type, d) {
  const list = type.attacks;
  if (list.length === 1) {
    const at = list[0];
    return d <= at.range + 0.2 && d >= (at.minRange || 0) ? at : null;
  }
  let sum = 0;
  const ok = [];
  for (const at of list) {
    if (d <= at.range + 0.2 && d >= (at.minRange || 0)) {
      ok.push(at);
      sum += at.w || 1;
    }
  }
  if (!ok.length) return null;
  if (ok.length === 1) return ok[0];
  let x = ctx.rng.range(0, sum);
  for (const at of ok) {
    x -= at.w || 1;
    if (x <= 0) return at;
  }
  return ok[ok.length - 1];
}

function cooldownOf(ctx, type, at) {
  if (at.cooldown != null) return at.cooldown;
  return type.cooldown ? ctx.rng.range(type.cooldown[0], type.cooldown[1]) : 1.5;
}

function beginWindup(ctx, m, type, at, tgt) {
  const t = ctx.state.t;
  const wu = r2(at.windup / hasteOf(m, type));
  setMode(ctx, m, 'windup', t + wu);
  if (type.attacks.length > 1 || type.body) m.atk = { i: type.attacks.indexOf(at), t0: r2(t) };
  ctx.emit('mob.windup', { mob: m.id, species: m.type, actor: tgt.id, sec: wu, atk: at.id || null, heavy: !!at.heavy });
}

// 행위자에게서 멀리 떨어진 짐승은 6틱에 한 번, 6배 시간으로 움직인다(결과는 늘 같다. 계산만 줄인다)
const FAR = 80;
const LOD = 6;

export function mobsTick(ctx, dt0) {
  const { state, data } = ctx;
  const t = state.t;
  const regionOf = (g) => regionAt(data.lists.regions, g.x);
  const actors = Object.values(state.actors).filter((a) => a.kind !== 'rival');
  const night = ctx.clock.isNight(t);
  let slot = 0;
  for (const m of Object.values(state.mobs)) {
    slot++;
    let dt = dt0;
    if (m.mode !== 'dead' && !m.target && !actors.some((a) => Math.abs(a.x - m.x) < FAR && Math.abs(a.z - m.z) < FAR)) {
      if ((state.tick + slot) % LOD !== 0) continue;
      dt = dt0 * LOD;
    }
    const type = data.creatures[m.type];
    const g = state.mobGroups[m.group];
    if (!g) {
      delete state.mobs[m.id];
      continue;
    }
    const home0 = homeOf(m, g);
    if (m.mode === 'dead') {
      if (m.temp) {
        if (t >= m.deadAt + 20) removeMob(ctx, m);
        continue;
      }
      if (t >= m.respawnAt) {
        const [x, z] = m.post ? [m.post[0], m.post[1]] : spotNear(ctx, regionOf(g), type, g, type.radius);
        Object.assign(m, { x, z, hp: type.hp, deadAt: null, respawnAt: null, skinned: false, skinning: null, killer: null, target: null, cd: 0 });
        if (m.post) m.yaw = m.post[2];
        if (m.phase) m.phase = 0;
        // 두목이 다시 나면 남은 부하는 거둔다
        for (const id of g.mobs) {
          const o = state.mobs[id];
          if (o && o.by === m.id) removeMob(ctx, o);
        }
        if (nightOnly(type, g, m) && !night) {
          setMode(ctx, m, 'away');
          continue;
        }
        setMode(ctx, m, 'idle', t + ctx.rng.range(1, 4));
        ctx.emit('mob.spawn', { mob: m.id, species: m.type });
      }
      continue;
    }
    // 밤 짐승(v0.5): 해가 뜨면 싸우지 않던 놈은 안개 속으로 사라지고, 밤이 되면 다시 나온다
    if (nightOnly(type, g, m)) {
      if (m.mode === 'away') {
        if (night) {
          const [x, z] = spotNear(ctx, regionOf(g), type, g, type.radius);
          Object.assign(m, { x, z, hp: type.hp, target: null, cd: 0, dest: null, fx: null });
          setMode(ctx, m, 'idle', t + ctx.rng.range(1, 4));
          ctx.emit('mob.spawn', { mob: m.id, species: m.type });
        }
        continue;
      }
      if (!night && !m.target) {
        setMode(ctx, m, 'away');
        m.dest = null;
        ctx.emit('mob.away', { mob: m.id, species: m.type });
        continue;
      }
    }
    if (m.mode === 'away') continue;
    // 상태 이상(v1.1): 출혈은 깎고, 기절했으면 이번 틱은 아무것도 못 한다
    if (m.fx) {
      fxTick(ctx, m);
      if (!isAlive(m)) continue;
      if (fxOn(m, 'stun', t)) continue;
    }
    const home = Math.hypot(m.x - home0.x, m.z - home0.z);
    const tgt = m.target ? state.actors[m.target] : null;
    // 둥지에서 너무 멀리 끌려가면 돌아간다
    // 달아나는 짐승은 멀리 가도 된다(달아남이 끝나면 천천히 돌아간다)
    if (m.mode !== 'return' && m.mode !== 'flee' && (home > (m.leash ?? type.leash) || (m.target && (!tgt || isDown(tgt))))) {
      m.target = null;
      delete m.atk;
      setMode(ctx, m, 'return');
    }
    switch (m.mode) {
      case 'idle':
      case 'wander': {
        if (!(m.calmUntil > t)) {
          const a = nearestActor(ctx, m, type.aggro || 0, type);
          // 석상은 바로 덤비지 않고 몸을 일으킨다(그동안 물러설 틈이 있다)
          if (a && type.statue && type.rise) {
            m.target = a.id;
            m.yaw = round3(yawTo(m, a));
            setMode(ctx, m, 'rise', t + type.rise);
            ctx.emit('mob.wake', { mob: m.id, species: m.type, actor: a.id, sec: type.rise });
            break;
          }
          if (a) {
            packAggro(ctx, m, a);
            break;
          }
        }
        // 석상(돌 해태): 깨어나기 전엔 자리에서 꼼짝하지 않는다
        if (type.statue) {
          if (m.post) m.yaw = m.post[2];
          if (m.mode === 'wander') setMode(ctx, m, 'idle', t + 5);
          break;
        }
        if (m.mode === 'idle') {
          if (t >= m.until) {
            m.dest = spotNear(ctx, regionOf(g), type, g, m.post ? 2.5 : type.radius + (type.roam || 3), home0);
            setMode(ctx, m, 'wander', t + 7);
          }
        } else if (moveToward(ctx, m, m.dest[0], m.dest[1], type.walk, dt) < 0.3 || t >= m.until) {
          m.dest = null;
          setMode(ctx, m, 'idle', t + ctx.rng.range(3, 8) * (m.post ? 2 : 1));
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
        // 막기(v0.5): 상대가 휘두르기 시작하는 걸 보면 정해진 확률로 막는다(같은 휘두름엔 한 번만)
        const act = tgt.cb?.act;
        if (type.guard && act && act.t0 !== m.sawAct) {
          m.sawAct = act.t0;
          if (d <= 4 && angDiff(yawTo(m, tgt), m.yaw) <= 1.05 && ctx.rng.chance(type.guard)) {
            m.yaw = round3(yawTo(m, tgt));
            setMode(ctx, m, 'guard', t + 0.9);
            ctx.emit('mob.guard', { mob: m.id, actor: tgt.id });
            break;
          }
        }
        const engage = type.engage;
        if (d > engage) moveToward(ctx, m, tgt.x, tgt.z, type.speed * hasteOf(m, type), dt);
        else if (type.keep && d < type.keep && kiting(m, type, t)) backOff(ctx, m, tgt, type.walk * 2.2, dt);
        else m.yaw = round3(yawTo(m, tgt));
        if (t >= m.cd) {
          const at = pickAttack(ctx, type, d);
          if (at) beginWindup(ctx, m, type, at, tgt);
        }
        break;
      }
      case 'guard': {
        if (tgt) m.yaw = round3(yawTo(m, tgt));
        if (t >= m.until) setMode(ctx, m, tgt ? 'chase' : 'return');
        break;
      }
      case 'windup': {
        const at = attackOf(m, type);
        // 준비 동작의 앞 2/3 동안만 고개를 돌린다. 끝무렵에 굴러 피할 틈이 생긴다.
        if (tgt && t < m.until - at.windup / hasteOf(m, type) / 3) m.yaw = round3(yawTo(m, tgt));
        if (t >= m.until) {
          if (at.charge) {
            m.hitOnce = false;
            setMode(ctx, m, 'charge', t + at.charge.time);
          } else {
            if (at.shot) fireShot(ctx, m, type, at, tgt);
            else strike(ctx, m, type, at);
            m.cd = r2(t + cooldownOf(ctx, type, at));
            setMode(ctx, m, 'recover', t + (at.recover ?? 0.35));
          }
        }
        break;
      }
      case 'charge': {
        const at = attackOf(m, type);
        const c = at.charge;
        const cs = c.speed * slowK(ctx, m);
        const [nx, nz] = resolve(ctx, m, m.x + Math.sin(m.yaw) * cs * dt, m.z + Math.cos(m.yaw) * cs * dt);
        m.x = round3(nx);
        m.z = round3(nz);
        if (tgt && !m.hitOnce && Math.hypot(tgt.x - m.x, tgt.z - m.z) <= c.hitR) {
          m.hitOnce = true;
          hurtActor(ctx, tgt, m, type.dmg * (at.mult ?? 1), at);
        }
        if (t >= m.until) {
          m.cd = r2(t + cooldownOf(ctx, type, at));
          setMode(ctx, m, 'recover', t + (at.recover ?? 0.6));
        }
        break;
      }
      case 'recover': {
        if (t >= m.until) {
          delete m.atk;
          setMode(ctx, m, tgt ? 'chase' : 'return');
        }
        break;
      }
      case 'rise': {
        if (tgt) m.yaw = round3(yawTo(m, tgt));
        if (t >= m.until) {
          setMode(ctx, m, 'chase');
          ctx.emit('mob.aggro', { mob: m.id, species: m.type, actor: m.target });
        }
        break;
      }
      case 'return': {
        if (moveToward(ctx, m, home0.x, home0.z, type.walk * (type.temper === 'skittish' ? 1 : 2.2), dt) < (m.post ? 0.4 : 1.5)) {
          if (m.temp) {
            removeMob(ctx, m);
            break;
          }
          if (type.temper !== 'skittish') m.hp = type.hp; // 끌려갔던 사나운 짐승만 체력을 채운다
          m.target = null;
          if (m.post) m.yaw = m.post[2];
          // 두목: 처음 단계로 돌아가고, 남은 부하는 거둔다
          if (m.phase) {
            m.phase = 0;
            for (const id of g.mobs) {
              const o = state.mobs[id];
              if (o && o.by === m.id) removeMob(ctx, o);
            }
          }
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
        if (!isAlive(p) || !isAlive(q)) continue;
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
  shotsTick(ctx, dt0);
}

// ── 손질(수렵) ─────────────────────────────────────
export function corpseOpen(ctx, m) {
  return m && m.mode === 'dead' && !m.skinned && !!ctx.data.creatures[m.type].hunt && ctx.state.t <= m.deadAt + ctx.cfg.combat.corpseSec;
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
  ctx.emit('skin.done', { actor: a.id, mob: m.id, species: m.type, items: got, xp: type.hunt.xp });
}
