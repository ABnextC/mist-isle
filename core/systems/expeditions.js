// 원정(v2.3): 이야기에서 한 번 쳤던 곳(가라앉은 탑·잿빛 요새·불의 가마·심장 아래)을 다시 친다.
// 입구에서 EXP_START → 물결 셋 → 두목 → 보상. 동료(원정 동료 최대 둘, 단짝 동행)를 데려갈 수 있다.
// 쓰러지거나 입구에서 너무 멀어지거나 시간이 다 되면 실패한다(잃는 것은 없다).
// 하루 첫 공략은 보상이 온전하고 설계도 확률이 높다. 같은 날 다시 치면 보상이 절반이다.
// 상태: state.runs[runId] = { id, ex, owner, wave, boss, group, until, startedAt, mercs }, 행위자 a.exp = { run, last: { 원정id: 날 } }
// 멀티플레이 대비: 공략은 주인 한 사람 단위다. 나중에 파티 단위로 넓힌다.

import { giveReward } from './quests.js';
import { sitePos } from '../world.js';
import { spawnTemp, removeMob, freeSpot, isAlive, tempGroup } from './mobs.js';
import { isDown } from './combat.js';
import { makeAlly, dismissAlly } from './allies.js';
import { gainLevelXp, levelOf } from './level.js';

const r2 = (v) => Math.round(v * 100) / 100;
export const E = (ctx) => ctx.data.expeditionCfg;
export const expOf = (a) => (a.exp ||= { run: null, last: {} });
export const runOf = (ctx, a) => (a.exp?.run ? ctx.state.runs?.[a.exp.run] || null : null);
const today = (ctx) => ctx.clock.day(ctx.state.t);
export const firstToday = (ctx, a, exId) => expOf(a).last[exId] !== today(ctx);

export function expUnlocked(ctx, a, ex) {
  return !ex.requires || a.quests?.done?.[ex.requires] != null;
}
// 입구: 원정 자리 둘레(반지름 + 10m)
export function nearEntrance(ctx, a, ex) {
  const s = sitePos(ctx, ex.site);
  return Math.hypot(a.x - s.x, a.z - s.z) <= s.r + 10;
}
export function startError(ctx, a, exId, mercs) {
  const ex = ctx.data.expeditions[exId];
  if (!ex) return 'bad_args';
  if (a.kind !== 'player') return 'bad_args';
  if (isDown(a)) return 'down';
  if (!expUnlocked(ctx, a, ex)) return 'locked';
  if (runOf(ctx, a)) return 'in_run';
  if (!nearEntrance(ctx, a, ex)) return 'too_far';
  const list = mercs || [];
  if (list.length > 2 || list.some((m) => !E(ctx).mercs.list.some((x) => x.id === m))) return 'bad_args';
  if (a.silver < list.length * E(ctx).mercs.cost) return 'no_silver';
  return null;
}

function spawnWave(ctx, run, types, center) {
  const ex = ctx.data.expeditions[run.ex];
  const s = sitePos(ctx, ex.site);
  let g = ctx.state.mobGroups[run.group];
  if (!g) {
    g = tempGroup(ctx, s.x, s.z, { event: run.id });
    run.group = g.id;
  }
  const owner = ctx.state.actors[run.owner];
  let i = 0;
  for (const [typeId, n] of Object.entries(types)) {
    for (let k = 0; k < n; k++) {
      // 세 방향에서 몰려온다(두목은 가운데)
      const ang = center ? 0 : (i * 2.1 + run.wave * 0.7) % (Math.PI * 2);
      const R = center ? 0 : s.r * 0.75;
      const [x, z] = freeSpot(ctx, s.x + Math.sin(ang) * R, s.z + Math.cos(ang) * R, center ? 2 : 4);
      const m = spawnTemp(ctx, g, typeId, x, z, { event: run.id, leash: 90 });
      m.target = owner?.id || null;
      m.mode = 'chase';
      m.until = null;
      i++;
    }
  }
}

export function startRun(ctx, a, exId, mercs = []) {
  const ex = ctx.data.expeditions[exId];
  const t = ctx.state.t;
  ctx.state.runs ||= {};
  const id = ctx.newId('run');
  const run = { id, ex: exId, owner: a.id, wave: 0, boss: false, group: null, startedAt: r2(t), until: r2(t + ex.minutes * 60), mercs: [] };
  ctx.state.runs[id] = run;
  expOf(a).run = id;
  a.silver -= mercs.length * E(ctx).mercs.cost;
  mercs.forEach((mid, i) => {
    const M = E(ctx).mercs.list.find((x) => x.id === mid);
    const al = makeAlly(ctx, a, { id: `merc_${a.id}_${i}`, name: M.name, look: M.look, weapon: M.weapon, until: run.until, merc: mid, dx: i ? -1.6 : 1.6, dz: -1.4 });
    run.mercs.push(al.id);
  });
  spawnWave(ctx, run, ex.waves[0], false);
  ctx.emit('exp.start', { actor: a.id, run: id, ex: exId, waves: ex.waves.length, until: run.until, mercs: run.mercs.length });
  ctx.emit('exp.wave', { actor: a.id, run: id, ex: exId, wave: 1, waves: ex.waves.length, boss: false });
  return run;
}

function endRun(ctx, run, ok, reason) {
  const a = ctx.state.actors[run.owner];
  const g = ctx.state.mobGroups[run.group];
  if (g) for (const mid of [...g.mobs]) if (ctx.state.mobs[mid]) removeMob(ctx, ctx.state.mobs[mid]);
  for (const id of run.mercs) if (ctx.state.actors[id]) dismissAlly(ctx, ctx.state.actors[id], ok ? 'done' : 'fail');
  delete ctx.state.runs[run.id];
  if (a?.exp?.run === run.id) a.exp.run = null;
  if (!ok) {
    ctx.emit('exp.fail', { actor: run.owner, run: run.id, ex: run.ex, reason });
    return null;
  }
  return reward(ctx, a, run);
}

function rollQty(ctx, q) {
  return Array.isArray(q) ? ctx.rng.int(q[0], q[1]) : q;
}
function reward(ctx, a, run) {
  const ex = ctx.data.expeditions[run.ex];
  const first = firstToday(ctx, a, ex.id);
  const K = first ? E(ctx).firstOfDay : E(ctx).again;
  const R = ex.reward;
  const silver = Math.round(rollQty(ctx, R.silver) * K.mult);
  const items = R.items.map((it) => ({ item: it.item, qty: Math.max(1, Math.round(rollQty(ctx, it.qty) * K.mult)) }));
  let bp = null;
  if (ctx.rng.next() < K.bp) {
    bp = R.blueprints[ctx.rng.int(0, R.blueprints.length - 1)];
    items.push({ item: bp, qty: 1 });
  }
  // 이름난 물건·트로피(v3.3): 처음 깨면 이름난 물건 하나(아직 없는 것)와 원정 트로피를 꼭 준다. 그 뒤엔 가끔
  const E2 = expOf(a);
  E2.ever = E2.ever || {};
  const firstEver = !E2.ever[ex.id];
  E2.ever[ex.id] = (E2.ever[ex.id] || 0) + 1;
  let named = null;
  const pool = R.named || [];
  if (pool.length && (firstEver || ctx.rng.next() < (K.named || 0))) {
    E2.got = E2.got || {};
    const fresh = pool.filter((id) => !E2.got[id]);
    const from = firstEver && fresh.length ? fresh : pool;
    named = from[ctx.rng.int(0, from.length - 1)];
    E2.got[named] = (E2.got[named] || 0) + 1;
    items.push({ item: named, qty: 1 });
  }
  if (firstEver && R.firstTrophy) items.push({ item: R.firstTrophy, qty: 1, score: 70 });
  const got = giveReward(ctx, a, { id: `exp:${ex.id}`, steps: [], reward: { silver, items } });
  const xp = Math.round(R.xp * K.mult);
  gainLevelXp(ctx, a, xp, 'expedition');
  expOf(a).last[ex.id] = today(ctx);
  a.stats.expeditions = (a.stats.expeditions || 0) + 1;
  ctx.emit('exp.clear', { actor: a.id, run: run.id, ex: ex.id, first, firstEver, named, silver, items, bp, xp, stored: got.stored, sec: Math.round(ctx.state.t - run.startedAt) });
  return got;
}

export function leaveRun(ctx, a) {
  const run = runOf(ctx, a);
  if (run) endRun(ctx, run, false, 'left');
}

// 1초마다
export function expeditionsTick(ctx) {
  const runs = ctx.state.runs;
  if (!runs) return;
  for (const run of Object.values(runs)) {
    const a = ctx.state.actors[run.owner];
    const ex = ctx.data.expeditions[run.ex];
    if (!a || !ex) {
      endRun(ctx, run, false, 'gone');
      continue;
    }
    const s = sitePos(ctx, ex.site);
    if (isDown(a)) {
      endRun(ctx, run, false, 'down');
      continue;
    }
    if (Math.hypot(a.x - s.x, a.z - s.z) > s.r + E(ctx).failM) {
      endRun(ctx, run, false, 'left');
      continue;
    }
    if (ctx.state.t >= run.until) {
      endRun(ctx, run, false, 'time');
      continue;
    }
    const g = ctx.state.mobGroups[run.group];
    const alive = g ? g.mobs.some((id) => isAlive(ctx.state.mobs[id])) : false;
    if (alive) continue;
    if (run.boss) {
      endRun(ctx, run, true);
      continue;
    }
    run.wave += 1;
    if (run.wave < ex.waves.length) {
      spawnWave(ctx, run, ex.waves[run.wave], false);
      ctx.emit('exp.wave', { actor: a.id, run: run.id, ex: ex.id, wave: run.wave + 1, waves: ex.waves.length, boss: false });
    } else {
      run.boss = true;
      spawnWave(ctx, run, { [ex.boss]: 1 }, true);
      ctx.emit('exp.wave', { actor: a.id, run: run.id, ex: ex.id, wave: ex.waves.length + 1, waves: ex.waves.length, boss: true, name: ctx.data.creatures[ex.boss].name });
    }
  }
}

// 화면용 요약: 권장 레벨과 내 레벨 차이
export function expHint(ctx, a, ex) {
  const gap = levelOf(a).lvl - ex.level;
  return gap >= 0 ? 'ok' : gap >= -5 ? 'hard' : 'deadly';
}
