// 다른 세력의 개척자(v2.6): 분쟁 구역마다 한 무리씩 돈다. 싱글에서 필드 PvP의 상대다.
// 깃발을 켠(또는 분쟁 구역에 들어온) 다른 세력 사람을 보면 덤빈다. 같은 세력이면 지나친다.
// 쓰러뜨리면 지닌 은화와 빼앗아 간 재료를 떨군다. 잠시 뒤 구역 안 다른 곳에서 새 사람이 온다.
// 명령은 플레이어와 같은 것(MOVE·ATTACK·BLOCK·DODGE·EAT)만 쓴다.

import { newActor } from '../state.js';
import { convertStats, starOf } from '../formulas.js';
import { hostile, emptyPvp } from './pvp.js';
import { weaponOf, yawTo } from './combat.js';
import { gainLevelXp } from './level.js';
import { gainInfluence } from './factions.js';
import { keyOf } from '../inventory.js';
import { masteryOf } from './mastery.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const RV = (ctx) => ctx.data.rivals;

export const emptyRivals = () => ({ bands: {} });

function zoneSpan(ctx, band) {
  const region = ctx.data.regions[band.region];
  const zones = region.zones || [];
  const i = zones.findIndex((z) => z.id === band.zone);
  const zn = zones[i];
  const [x0, , x1, z1] = region.bounds;
  const zEnd = zones[i + 1] ? zones[i + 1].z0 : z1;
  return { x0: x0 + 24, x1: x1 - 24, z0: zn.z0 + 10, z1: zEnd - 14 };
}

// 구역 안의 걸을 수 있는 자리(마을·야영지에서 떨어진 곳)
function spotIn(ctx, band) {
  const S = zoneSpan(ctx, band);
  const region = ctx.data.regions[band.region];
  for (let k = 0; k < 40; k++) {
    const x = S.x0 + ctx.rng.next() * (S.x1 - S.x0);
    const z = S.z0 + ctx.rng.next() * (S.z1 - S.z0);
    if (!ctx.terrain.walkable(x, z) || ctx.terrain.height(x, z) < 0.3) continue;
    if (region.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.radius + 20)) continue;
    return [r3(x), r3(z)];
  }
  return null;
}

function gear(ctx, id, score) {
  const def = ctx.data.items[id];
  const scores = Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, score]));
  const stats = convertStats(def.statConvert, scores);
  return { uid: ctx.newId('it'), item: id, stats, scores, star: starOf(score, ctx.cfg.stars), masterwork: false, crafter: null, dur: stats.durability ?? null, maxDur: stats.durability ?? null, broken: false };
}

// 무리 하나에 사람 하나를 세운다
// 공성(v2.7) 싸움꾼은 band.at 둘레(spread m)에 선다
function spotNear(ctx, band) {
  for (let k = 0; k < 30; k++) {
    const ang = ctx.rng.next() * Math.PI * 2;
    const d = band.spread * (0.4 + ctx.rng.next() * 0.6);
    const x = band.at[0] + Math.sin(ang) * d;
    const z = band.at[1] + Math.cos(ang) * d;
    if (ctx.terrain.walkable(x, z) && ctx.terrain.height(x, z) >= 0.2) return [r3(x), r3(z)];
  }
  return [r3(band.at[0]), r3(band.at[1])];
}

export function spawnRival(ctx, band, slot) {
  const at = band.at ? spotNear(ctx, band) : spotIn(ctx, band);
  if (!at) return null;
  const R = RV(ctx);
  const id = `rv_${band.id}_${slot}`;
  const used = new Set(Object.values(ctx.state.actors).filter((x) => x.kind === 'rival').map((x) => x.name));
  const free = R.names.filter((n) => !used.has(n));
  const name = ctx.rng.pick(free.length ? free : R.names);
  const a = newActor(ctx.data, { id, name, kind: 'rival', at });
  const f = ctx.data.factions.list.find((x) => x.id === band.faction);
  a.look = { body: ctx.rng.chance(0.3) ? 'f' : 'm', seed: 300 + ctx.rng.int(0, 400), tint: { ...band.tint } };
  a.faction = null;
  a.rival = { band: band.id, faction: band.faction, color: band.color || f?.color || '#c04040', home: band.at ? [...band.at] : at, target: null, moveAt: 0, purse: ctx.rng.int(band.silver[0], band.silver[1]), plan: null, seen: -1 };
  a.rival.read = band.read ?? 0.4;
  if (band.war) Object.assign(a.rival, { war: band.war, team: band.team, title: band.name });
  a.ai = { on: true, profile: 'rival', manual: true, mem: {} };
  a.pvp = emptyPvp();
  a.silver = 0;
  // 레벨: 무리 레벨 ±2, 점수는 무기 주 능력치에
  const lvl = band.level + ctx.rng.int(-2, 2);
  const wid = ctx.rng.pick(band.weapons);
  const w = gear(ctx, wid, band.score);
  a.bag.push(w);
  a.equip.weapon = w.uid;
  const mastery = masteryOf(ctx, ctx.data.items[wid].weapon.type);
  const sc = ctx.cfg.level.scaling[mastery] || ctx.cfg.level.scaling.fist;
  a.clevel = { lvl, xp: 0, attrs: { str: 0, dex: 0, int: 0, con: 0, foc: 0 } };
  a.clevel.attrs[sc[0]] = Math.floor((lvl - 1) * 0.55);
  a.clevel.attrs.con = Math.floor((lvl - 1) * 0.3);
  if (sc[1]) a.clevel.attrs[sc[1]] = (lvl - 1) - a.clevel.attrs[sc[0]] - a.clevel.attrs.con;
  for (const [slot2, item] of Object.entries(band.armor)) {
    const e = gear(ctx, item, band.score);
    a.bag.push(e);
    a.equip[slot2] = e.uid;
  }
  if (band.potions) a.bag.push({ item: 'potion_heal', lot: null, bonus: null, qty: band.potions, stats: convertStats(ctx.data.items.potion_heal.statConvert, { power: band.score, sec: band.score }) });
  a.cb.hp = a.cb.maxHp = ctx.cfg.combat.hp;
  ctx.state.actors[id] = a;
  ctx.emit('rival.spawn', { actor: id, band: band.id, faction: band.faction, x: a.x, z: a.z });
  return a;
}

export function initRivals(ctx) {
  const st = (ctx.state.rivals ??= emptyRivals());
  for (const band of RV(ctx).bands) {
    if (st.bands[band.id]) continue;
    st.bands[band.id] = { next: {} };
    for (let i = 0; i < band.count; i++) spawnRival(ctx, band, i);
  }
}

// 쓰러진 다른 세력 사람: 보상을 주고 무리에서 뺀다
function fall(ctx, rv) {
  const P = ctx.cfg.pvp;
  const by = ctx.state.actors[rv.rival.lastBy];
  const winner = by?.kind === 'ally' ? ctx.state.actors[by.ally.owner] : by;
  const loot = [];
  if (winner && winner.kind === 'player') {
    winner.silver += rv.rival.purse;
    for (const e of rv.bag) {
      if (e.uid || ctx.data.items[e.item].kind === 'consumable') continue;
      winner.bag.push({ item: e.item, lot: e.lot ?? null, bonus: e.bonus ?? null, qty: e.qty });
      loot.push({ item: e.item, qty: e.qty });
    }
    gainLevelXp(ctx, winner, Math.round((ctx.cfg.level.killBase + rv.clevel.lvl * ctx.cfg.level.killPerLevel) * P.killXpMult), 'pvp');
    gainInfluence(ctx, winner, P.killInf, 'pvp');
  }
  const band = RV(ctx).bands.find((b) => b.id === rv.rival.band);
  const slot = rv.id.split('_').pop();
  if (band) ctx.state.rivals.bands[band.id].next[slot] = r2(ctx.state.t + RV(ctx).respawnSec);
  delete ctx.state.actors[rv.id];
  ctx.emit('rival.fall', { actor: rv.id, name: rv.name, band: rv.rival.band, war: rv.rival.war || null, team: rv.rival.team || null, by: winner?.id || null, silver: winner ? rv.rival.purse : 0, loot, x: rv.x, z: rv.z });
}

// 0.2초마다: 덤빌 상대 고르기·돌아다니기·다시 오기. 싸움 손놀림은 매 틱(rivalFight)
export function rivalsTick(ctx) {
  const st = ctx.state.rivals;
  if (!st) return;
  const t = ctx.state.t;
  const R = RV(ctx);
  if (ctx.state.tick % 6 === 0) {
    for (const band of R.bands) {
      const bs = st.bands[band.id];
      if (!bs) continue;
      for (const [slot, at] of Object.entries(bs.next)) {
        if (t < at) continue;
        delete bs.next[slot];
        if (!ctx.state.actors[`rv_${band.id}_${slot}`]) spawnRival(ctx, band, slot);
      }
    }
    for (const rv of Object.values(ctx.state.actors)) {
      if (rv.kind !== 'rival') continue;
      if (rv.cb.downUntil > 0) {
        if (t >= rv.cb.downUntil - ctx.cfg.combat.downSec + R.fallSec) fall(ctx, rv);
        continue;
      }
      if (!rv.ai?.on) continue; // 손을 놓은 사람(시험·연출)
      const R0 = rv.rival;
      const home = R0.home;
      // 상대: 나를 칠 수 있는 가장 가까운 사람(집에서 너무 멀면 놓는다)
      const leash = R0.war ? ctx.cfg.war.nearR : R.leash;
      let tg = ctx.state.actors[R0.target];
      if (tg && (!hostile(ctx, rv, tg) || Math.hypot(tg.x - home[0], tg.z - home[1]) > leash)) tg = null;
      if (!tg) {
        let bd = R0.war ? R.aggro * 1.5 : R.aggro;
        for (const b of Object.values(ctx.state.actors)) {
          if ((b.kind === 'rival' && !R0.war) || !hostile(ctx, rv, b)) continue;
          const d = Math.hypot(b.x - rv.x, b.z - rv.z);
          if (d < bd && Math.hypot(b.x - home[0], b.z - home[1]) <= leash) {
            bd = d;
            tg = b;
          }
        }
        if (tg && R0.target !== tg.id) ctx.emit('rival.aggro', { actor: rv.id, target: tg.id });
      }
      R0.target = tg?.id || null;
      if (tg) continue;
      if (rv.cb.block) ctx.command({ type: 'BLOCK', actor: rv.id, on: false });
      // 공성: 깃발로 간다(수비는 깃발 곁을 지킨다)
      if (R0.war) {
        if (t >= R0.moveAt) {
          R0.moveAt = r2(t + 2 + ctx.rng.next() * 2);
          const ang = ctx.rng.next() * Math.PI * 2;
          const d = ctx.rng.next() * ctx.cfg.war.flagR * 0.7;
          ctx.command({ type: 'MOVE', actor: rv.id, x: r3(home[0] + Math.sin(ang) * d), z: r3(home[1] + Math.cos(ang) * d) });
        }
        continue;
      }
      // 돌아다니기
      if (t >= R0.moveAt) {
        R0.moveAt = r2(t + 8 + ctx.rng.next() * 10);
        const ang = ctx.rng.next() * Math.PI * 2;
        const d = 4 + ctx.rng.next() * 10;
        const x = r3(home[0] + Math.sin(ang) * d);
        const z = r3(home[1] + Math.cos(ang) * d);
        if (ctx.terrain.walkable(x, z)) ctx.command({ type: 'MOVE', actor: rv.id, x, z });
      }
    }
  }
  for (const rv of Object.values(ctx.state.actors)) if (rv.kind === 'rival' && rv.ai?.on && rv.rival.target && rv.cb.downUntil === 0) rivalFight(ctx, rv);
}

// 싸움 손놀림(매 틱): 사거리까지 다가가 때리고, 상대가 휘두르면 실력만큼 막거나 구른다. 체력이 낮으면 물약
function rivalFight(ctx, rv) {
  const t = ctx.state.t;
  const cb = rv.cb;
  const tg = ctx.state.actors[rv.rival.target];
  if (!tg || cb.stunUntil > t) return;
  const w = weaponOf(ctx, rv);
  const d = Math.hypot(tg.x - rv.x, tg.z - rv.z);
  // 1) 상대의 공격 읽기
  const act = tg.cb?.act;
  if (act && !act.done && act.kind !== 'ability' && d < 5) {
    const left = act.hitAt - t;
    if (rv.rival.seen !== act.hitAt) {
      rv.rival.seen = act.hitAt;
      rv.rival.plan = ctx.rng.chance(rv.rival.read ?? 0.4) ? (ctx.rng.chance(0.5) ? 'block' : 'dodge') : 'none';
    }
    if (rv.rival.plan === 'dodge' && left < 0.18 && !cb.dodge) {
      const yaw = yawTo(tg, rv) + (ctx.rng.chance(0.5) ? 1.2 : -1.2);
      if (ctx.command({ type: 'DODGE', actor: rv.id, yaw }).ok) {
        rv.rival.plan = 'none';
        return;
      }
    }
    if (rv.rival.plan === 'block' && left < 0.35) {
      rv.yaw = r3(yawTo(rv, tg));
      if (!cb.block) ctx.command({ type: 'BLOCK', actor: rv.id, on: true });
      return;
    }
  }
  if (cb.block) ctx.command({ type: 'BLOCK', actor: rv.id, on: false });
  if (cb.dodge) return;
  // 2) 물약
  if (cb.hp < cb.maxHp * 0.35 && (cb.potionAt || 0) <= t) {
    const p = rv.bag.find((e) => ctx.data.items[e.item].potion === 'heal');
    if (p && ctx.command({ type: 'EAT', actor: rv.id, key: keyOf(p) }).ok) return;
  }
  // 3) 다가가 때린다(활·지팡이는 떨어져서 쏜다)
  const shot = w.spec.shot;
  const want = shot ? Math.min(shot.range * 0.7, 11) : w.spec.range + 0.25;
  if (d > want) {
    if (t >= (rv.rival.stepAt || 0)) {
      rv.rival.stepAt = r2(t + 0.25);
      const k = (d - want + 0.3) / d;
      ctx.command({ type: 'MOVE', actor: rv.id, x: r3(rv.x + (tg.x - rv.x) * k), z: r3(rv.z + (tg.z - rv.z) * k) });
    }
    return;
  }
  if (rv.dest) rv.dest = null;
  if (cb.act && t < cb.act.endAt) return;
  const heavy = cb.st >= 70 && ctx.rng.chance(0.25);
  ctx.command({ type: 'ATTACK', actor: rv.id, kind: heavy ? 'heavy' : 'light', yaw: r3(yawTo(rv, tg)) });
}
