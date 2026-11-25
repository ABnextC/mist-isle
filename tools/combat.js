// 헤드리스 결투: 장비·실력 조합마다 짐승과 여러 번 싸워 승률·걸린 시간·잃은 체력을 잰다.
// 사용: node tools/combat.js [--trials 30] [--seed 11] [--gap 0]
// v3.1: 레벨이 생겨서, 시험하는 쪽을 짐승 레벨 + gap에 맞춘다(능력치는 무기 주 능력 60%·체질 40%)
// 진짜 코어(명령·30Hz 판정)와 봇 싸움 요령(core/ai/fighter.js)을 그대로 쓴다.

import { loadData } from './load-data.js';
import { createGame } from '../core/game.js';
import { convertStats, starOf } from '../core/formulas.js';
import { startFight } from '../core/ai/fighter.js';
import { mobLevel } from '../core/systems/level.js';
import { maxHpOf } from '../core/systems/combat.js';
import { masteryOf } from '../core/systems/mastery.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1]]] : acc), []));
const TRIALS = Number(args.trials || 30);
const SEED = Number(args.seed || 11);
const GAP = Number(args.gap || 0);
const data = loadData();

function gear(itemId, score, n) {
  const def = data.items[itemId];
  const scores = Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, score]));
  const stats = convertStats(def.statConvert, scores);
  return { uid: `u_test_${itemId}_${n}`, item: itemId, stats, scores, star: starOf(score, data.config.stars), masterwork: false, crafter: '시험', dur: stats.durability ?? null, maxDur: stats.durability ?? null, broken: false };
}

export const KITS = {
  뉴비_몽둥이: { weapon: 'wpn_club', score: 35, armor: null, read: 0.2, block: 0.2, food: 0 },
  뉴비_구리검: { weapon: 'wpn_sword_copper', score: 50, armor: null, read: 0.2, block: 0.5, food: 0 },
  보통_구리검_가죽: { weapon: 'wpn_sword_copper', score: 45, armor: 45, read: 0.45, block: 0.3, food: 2 },
  보통_구리도끼_가죽: { weapon: 'wpn_battleaxe_copper', score: 45, armor: 45, read: 0.45, block: 0.3, food: 2 },
  보통_구리창_가죽: { weapon: 'wpn_spear_copper', score: 45, armor: 45, read: 0.45, block: 0.3, food: 2 },
  숙련_철검_가죽: { weapon: 'wpn_sword_iron', score: 52, armor: 55, read: 0.65, block: 0.3, food: 3 },
  고수_철도끼_가죽: { weapon: 'wpn_battleaxe_iron', score: 62, armor: 62, read: 0.85, block: 0.25, food: 3 },
  // 6장(v3.1): 안개 장비
  보통_안개검_안개: { weapon: 'wpn_sword_mist', score: 45, armor: 45, set: 'mist', read: 0.45, block: 0.3, food: 3 },
  숙련_안개창_안개: { weapon: 'wpn_spear_mist', score: 52, armor: 52, set: 'mist', read: 0.65, block: 0.3, food: 3 },
  고수_안개도끼_안개: { weapon: 'wpn_battleaxe_mist', score: 62, armor: 62, set: 'mist', read: 0.85, block: 0.25, food: 3 },
};
const SETS = { leather: ['arm_leather_hood', 'arm_leather_vest', 'arm_leather_pants'], mist: ['arm_mist_helm', 'arm_mist_cuirass', 'arm_mist_greaves'] };

export function duel(kitName, typeId, seed, packSize = null) {
  const kit = KITS[kitName];
  const game = createGame({ data, seed, actors: [{ id: 'p1', name: '시험', kind: 'player' }] });
  const st = game.state;
  const a = st.actors.p1;
  a.skills.hunting.level = 30;
  // 깨울 이야기가 있는 석상(돌 해태, v0.5.1)은 그 퀘스트를 받은 상태로 잰다
  wakeAll(a);
  // 밤에만 나오는 들판 무리는 낮엔 숨어 있으니, 늘 있는 자리 무리(옛 등불터 망령)로 잰다
  let groups = Object.values(st.mobGroups).filter((g) => g.type === typeId && !g.site && (!packSize || g.mobs.length === packSize) && st.mobs[g.mobs[0]]?.mode !== 'away');
  let only = null;
  if (!groups.length) {
    // 자리 무리(약탈단) 안의 한 종류: 그 한 놈만 남겨 1:1로 잰다(v0.5)
    const m = Object.values(st.mobs).find((x) => x.type === typeId && x.mode !== 'away');
    if (!m) return null;
    groups = [st.mobGroups[m.group]];
    only = m.id;
  }
  const g = groups[seed % groups.length];
  // 다른 짐승은 치운다(결투만 잰다)
  for (const m of Object.values(st.mobs)) if (m.group !== g.id || (only && m.id !== only)) delete st.mobs[m.id];
  for (const id of Object.keys(st.mobGroups)) if (id !== g.id) delete st.mobGroups[id];
  if (only) g.mobs = [only];
  const LIMIT = data.creatures[typeId].boss ? 400 : 160;
  const first = st.mobs[g.mobs[0]];
  const ang = (seed * 1.7) % (Math.PI * 2);
  for (let k = 0; k < 12; k++) {
    const x = g.x + Math.sin(ang + k * 0.5) * 8;
    const z = g.z + Math.cos(ang + k * 0.5) * 8;
    if (game.terrain.walkable(x, z)) { a.x = x; a.z = z; break; }
  }
  if (kit.weapon) {
    const w = gear(kit.weapon, kit.score, 1);
    a.bag.push(w);
    game.dispatch({ type: 'EQUIP', actor: 'p1', uid: w.uid });
  }
  if (kit.armor) {
    for (const id of SETS[kit.set || 'leather']) {
      const e = gear(id, kit.armor, 1);
      a.bag.push(e);
      game.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid });
    }
  }
  // 레벨 맞추기(v3.1)
  const lv = Math.max(1, mobLevel(game._ctx, typeId) + GAP);
  a.clevel.lvl = lv;
  const sc = data.config.level.scaling[masteryOf(game._ctx, data.items[kit.weapon]?.weapon?.type)] || ['str'];
  const main = Math.ceil((lv - 1) * 0.6);
  if (main) game.dispatch({ type: 'ATTR_SPEND', actor: 'p1', attr: sc[0], n: main });
  if (lv - 1 - main) game.dispatch({ type: 'ATTR_SPEND', actor: 'p1', attr: 'con', n: lv - 1 - main });
  a.cb.hp = a.cb.maxHp = maxHpOf(game._ctx, a);
  if (kit.food) a.bag.push({ item: 'food_meat', lot: null, bonus: null, stats: { heal: 40 }, star: 2, qty: kit.food });
  startFight(a, first.id, { read: kit.read, block: kit.block });
  a.ai.manual = true;
  const t0 = st.t;
  let eaten = 0;
  game.on('eat', () => eaten++);
  let dmgTaken = 0;
  game.on('combat.hurt', (ev) => { dmgTaken += ev.dmg; });
  while (st.t - t0 < LIMIT) {
    game.advance(0.2);
    if (a.cb.downUntil > 0) return { win: false, sec: st.t - t0, dmgTaken, eaten, foeHp: st.mobs[g.mobs[0]]?.hp };
    if (g.mobs.every((id) => st.mobs[id].mode === 'dead')) return { win: true, sec: st.t - t0, dmgTaken, eaten, wpnDur: a.bag[0].maxDur ? a.bag[0].maxDur - a.bag[0].dur : 0 };
    if (!a.ai.mem.fight) startFight(a, first.id, { read: kit.read, block: kit.block });
    const f = a.ai.mem.fight;
    if (st.mobs[f.target]?.mode === 'dead') {
      const next = g.mobs.map((id) => st.mobs[id]).find((m) => m.mode !== 'dead');
      if (next) f.target = next.id;
    }
  }
  return { win: false, sec: LIMIT, dmgTaken, eaten, timeout: true };
}

function wakeAll(a) {
  for (const c of data.lists.creatures) if (c.wake) a.quests.active[c.wake] ||= { step: 0, n: 0, used: [], t: 0 };
}

// 자리 하나(망루·야영지·정박지·옛 등불터)를 통째로: 다가가면 보초들이 덤빈다. 모두 쓰러뜨리면 이긴다
export function siteRun(kitName, siteId, seed) {
  const kit = KITS[kitName];
  const game = createGame({ data, seed, actors: [{ id: 'p1', name: '시험', kind: 'player' }] });
  const st = game.state;
  st.econ = null;
  const a = st.actors.p1;
  wakeAll(a);
  const g = Object.values(st.mobGroups).find((x) => x.site === siteId);
  for (const m of Object.values(st.mobs)) if (m.group !== g.id) delete st.mobs[m.id];
  for (const id of Object.keys(st.mobGroups)) if (id !== g.id) delete st.mobGroups[id];
  const ang = (seed * 1.7) % (Math.PI * 2);
  for (let k = 0; k < 12; k++) {
    const x = g.x + Math.sin(ang + k * 0.5) * (g.radius + 8);
    const z = g.z + Math.cos(ang + k * 0.5) * (g.radius + 8);
    if (game.terrain.walkable(x, z)) { a.x = x; a.z = z; break; }
  }
  if (kit.weapon) {
    const w = gear(kit.weapon, kit.score, 1);
    a.bag.push(w);
    game.dispatch({ type: 'EQUIP', actor: 'p1', uid: w.uid });
  }
  if (kit.armor) {
    for (const id of SETS[kit.set || 'leather']) {
      const e = gear(id, kit.armor, 1);
      a.bag.push(e);
      game.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid });
    }
  }
  a.bag.push({ item: 'food_meat', lot: null, bonus: null, stats: { heal: 42 }, star: 2, qty: (kit.food || 0) + 3 });
  let dmgTaken = 0;
  game.on('combat.hurt', (ev) => { dmgTaken += ev.dmg; });
  let eaten = 0;
  game.on('eat', () => eaten++);
  const t0 = st.t;
  const alive = () => g.mobs.map((id) => st.mobs[id]).filter((m) => m && m.mode !== 'dead');
  // 가까운 놈부터 하나씩
  while (st.t - t0 < 400) {
    if (a.cb.downUntil > 0) return { win: false, sec: st.t - t0, dmgTaken, eaten, left: alive().length };
    const left = alive();
    if (!left.length) return { win: true, sec: st.t - t0, dmgTaken, eaten };
    const f = a.ai?.mem?.fight;
    if (!f || !st.mobs[f.target] || st.mobs[f.target].mode === 'dead') {
      const m = left.sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0];
      startFight(a, m.id, { read: kit.read, block: kit.block });
      a.ai.manual = true;
    }
    game.advance(0.2);
  }
  return { win: false, sec: 400, dmgTaken, eaten, timeout: true, left: alive().length };
}

function main() {
  if (args.site) {
    console.log(`자리 ${args.site}: 장비·실력 | 승률 | 걸린 시간 | 받은 피해 | 먹은 고기 | 남은 적(진 판)`);
    for (const kitName of args.kits ? String(args.kits).split(',') : Object.keys(KITS)) {
      let win = 0; let sec = 0; let dmg = 0; let eaten = 0; let left = 0;
      for (let i = 0; i < TRIALS; i++) {
        const r = siteRun(kitName, args.site, SEED + i * 13);
        if (r.win) { win++; sec += r.sec; } else left += r.left;
        dmg += r.dmgTaken;
        eaten += r.eaten;
      }
      console.log(`${kitName.padEnd(14)} | ${String(Math.round((win / TRIALS) * 100)).padStart(3)}% | ${win ? Math.round(sec / win) : '-'}초 | ${Math.round(dmg / TRIALS)} | ${Math.round((eaten / TRIALS) * 10) / 10} | ${TRIALS - win ? Math.round((left / (TRIALS - win)) * 10) / 10 : '-'}`);
    }
    return;
  }
  const rows = [];
  const all = [['crab', null], ['deer', null], ['boar', null], ['wolf', 2], ['wolf', 3], ['wolf', 4],
    ['raider_scout', null], ['raider', null], ['raider_spear', null], ['raider_axe', null], ['raider_thrower', null], ['raider_lt', null], ['raider_captain', null],
    ['mist_wraith', null], ['stone_haetae', null], ['imugi', null], ['surveyor', null], ['surveyor_spear', null], ['yeogang_wraith', null], ['marine', null], ['marine_captain', null], ['ash_wolf', null], ['frost_wolf', null], ['fire_guardian', null], ['frost_guardian', null],
    ['storm_wraith', null], ['storm_wolf', null], ['gate_warden', null], ['first_keeper', null]];
  const want = args.foes ? new Set(String(args.foes).split(',')) : null;
  const cases = want ? all.filter(([t]) => want.has(t)) : all;
  const kits = args.kits ? String(args.kits).split(',') : Object.keys(KITS);
  for (const kitName of kits) {
    for (const [type, pack] of cases) {
      let win = 0; let n = 0; let sec = 0; let dmg = 0; let eaten = 0; let timeouts = 0;
      for (let i = 0; i < TRIALS; i++) {
        const r = duel(kitName, type, SEED + i * 13, pack);
        if (!r) continue;
        n++;
        if (r.win) { win++; sec += r.sec; }
        if (r.timeout) timeouts++;
        dmg += r.dmgTaken;
        eaten += r.eaten;
      }
      if (!n) continue;
      rows.push({ kit: kitName, foe: type + (pack ? `×${pack}` : ''), win: Math.round((win / n) * 100), sec: win ? Math.round((sec / win) * 10) / 10 : null, dmg: Math.round(dmg / n), eaten: Math.round((eaten / n) * 10) / 10, timeouts, n });
    }
  }
  console.log('장비·실력 | 상대 | 승률 | 걸린 시간 | 받은 피해 | 먹은 고기 | 시간 초과');
  for (const r of rows) console.log(`${r.kit.padEnd(14)} | ${r.foe.padEnd(14)} | ${String(r.win).padStart(3)}% | ${String(r.sec ?? '-').padStart(5)}초 | ${String(r.dmg).padStart(4)} | ${r.eaten} | ${r.timeouts}/${r.n}`);
  if (args.json) console.log(JSON.stringify(rows));
}

if (process.argv[1] && process.argv[1].endsWith('combat.js')) main();
