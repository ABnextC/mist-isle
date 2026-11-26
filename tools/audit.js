// 퀘스트·NPC 점검 도구(v3.3.2).
//   node tools/audit.js [--json] [--only 퀘스트id]
// 1) NPC마다 하루 24시각에서: 서 있는 자리가 걸을 수 있는 땅인가, 마을 한가운데서 걸어가 말을 걸 수 있는가.
// 2) 퀘스트마다(메인·부가·현상금·오늘의 부탁·마음의 부탁·생일·세력): 받을 수 있게 된 순간의 상태를 만들고,
//    사람이 하듯 명령(QUEST_ACCEPT·TALK·QUEST_USE·EAT·STORE…)으로 끝까지 가 본다. 싸움은 대상이 섬에 있는지만 보고
//    쓰러뜨린 셈 친다(싸움 난이도는 campaign.js가 본다).
// 3) 등대섬에서 받는 부가 퀘스트가 안개 벽을 건넌 뒤에도 끝낼 수 있는가.

import { loadData } from './load-data.js';
import { createGame } from '../core/game.js';
import { npcPos, objPos, sitePos } from '../core/world.js';
import { stepNpc, npcShown, questKill, talkDue, giverNow, strandedQuests, startQuest } from '../core/systems/quests.js';
import { regionAt } from '../core/terrain.js';
import { keyOf } from '../core/inventory.js';

const args = (() => {
  const o = { json: false, only: null };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '--json') o.json = true;
    else if (v[i] === '--only') o.only = v[++i];
  }
  return o;
})();

const data = loadData();
const T = data.config.time;
const HOUR = T.secondsPerGameDay / 24;
const islandOf = (x) => regionAt(data.lists.regions, x).island;
const problems = [];
const bad = (kind, id, why, more = {}) => problems.push({ kind, id, why, ...more });

// ── 1) NPC 자리 ─────────────────────────────────────
function auditNpcs() {
  const g = createGame({ data, seed: 1, actors: [{ id: 'p1', kind: 'player' }] });
  const C = g._ctx;
  const a = g.state.actors.p1;
  // 점검이라 쓰러지지 않는다
  const adv0 = g.advance.bind(g);
  g.advance = (sec) => { for (let k = 0; k < sec; k++) { if (a.cb) Object.assign(a.cb, { hp: a.cb.maxHp, downUntil: 0, stunUntil: 0 }); adv0(1); } };
  a.quests.done = Object.fromEntries(data.lists.quests.map((q) => [q.id, 0])); // 다 보이게
  const out = [];
  for (const n of Object.values(data.npcs)) {
    let worst = null;
    for (let h = 0; h < 24; h++) {
      g.state.t = h * HOUR - (T.startPhase || 0) * T.secondsPerGameDay + T.secondsPerGameDay * 3;
      g.state.tick = Math.round(g.state.t * 30);
      const p = npcPos(C, n.id);
      if (!p) { worst = { h, why: 'no_pos' }; break; }
      if (!C.terrain.walkable(p.x, p.z)) { worst = { h, why: 'not_walkable', x: p.x, z: p.z }; break; }
      // 걸어가 보기: NPC에서 18m 떨어진 걸을 수 있는 곳에서 MOVE
      const starts = [];
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(ang) * 18;
        const z = p.z + Math.sin(ang) * 18;
        if (C.terrain.walkable(x, z) && islandOf(x) === islandOf(p.x)) starts.push([x, z]);
      }
      if (!starts.length) continue;
      const t0 = g.state.t;
      let ok = false;
      // 네 방향에서 다가가 본다(하나라도 닿으면 된다)
      for (let si = 0; si < starts.length && !ok; si += Math.max(1, Math.floor(starts.length / 4))) {
      g.state.t = t0;
      g.state.tick = Math.round(t0 * 30);
      Object.assign(a, { x: starts[si][0], z: starts[si][1], move: null, dest: null, nav: null });
      for (let s = 0; s < 40 && !ok; s++) {
        const q = npcPos(C, n.id);
        const dx = a.x - q.x;
        const dz = a.z - q.z;
        const l = Math.hypot(dx, dz) || 1;
        if (l <= 3.0) { ok = true; break; }
        g.dispatch({ type: 'MOVE', actor: 'p1', x: q.x + (dx / l) * 1.6, z: q.z + (dz / l) * 1.6 });
        g.advance(1);
      }
      }
      if (!ok) { worst = { h, why: 'cant_reach', x: Math.round(p.x), z: Math.round(p.z), me: [Math.round(a.x), Math.round(a.z)] }; break; }
      // 말을 걸면 멈춰 서서, 40초 읽는 동안에도 말이 닿는다
      Object.assign(a, { move: null, dest: null, nav: null });
      g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 0, dz: 0 });
      const o = g.dispatch({ type: 'TALK_OPEN', actor: 'p1', npc: n.id });
      if (!o.ok) { worst = { h, why: `open:${o.error}` }; break; }
      g.advance(40);
      const q2 = npcPos(C, n.id);
      if (Math.hypot(a.x - q2.x, a.z - q2.z) > 4.4) { worst = { h, why: 'walked_off' }; break; }
      g.dispatch({ type: 'TALK_CLOSE', actor: 'p1', npc: n.id });
      g.state.t = t0;
      g.state.tick = Math.round(t0 * 30);
    }
    if (worst) bad('npc', n.id, worst.why, { name: n.name, ...worst });
    out.push(n.id);
  }
  return out.length;
}

// ── 2) 퀘스트 ───────────────────────────────────────
const mainOrder = data.chapters.flatMap((c) => c.quests);
function closure(ids) {
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id) || !data.quests[id]) return;
    seen.add(id);
    for (const r of data.quests[id].requires || []) walk(r);
    if (data.quests[id].appearOf) walk(data.quests[id].appearOf);
  };
  ids.forEach(walk);
  // 메인은 앞 메인을 다 끝냈다
  let last = -1;
  for (const id of seen) last = Math.max(last, mainOrder.indexOf(id));
  for (let i = 0; i <= last; i++) seen.add(mainOrder[i]);
  return seen;
}

function auditQuest(q) {
  const g = createGame({ data, seed: 2, actors: [{ id: 'p1', kind: 'player' }] });
  const C = g._ctx;
  const S = g.state;
  const a = S.actors.p1;
  const log = [];
  const fail = (why, extra = {}) => ({ ok: false, why, step: a.quests.active[q.id]?.step ?? null, log, ...extra });
  // 받기 직전 상태: 앞 퀘스트를 다 끝냈다
  a.quests.active = {};
  a.quests.track = null;
  const pre = closure(q.requires || []);
  if (q.kind === 'main') for (let i = 0; i < mainOrder.indexOf(q.id); i++) pre.add(mainOrder[i]);
  for (const id of pre) a.quests.done[id] = 0;
  a.silver = 5000;
  a.clevel.lvl = Math.max(a.clevel.lvl, q.level || 1);
  for (const sk of Object.values(a.skills)) sk.level = Math.max(sk.level, 40);
  if (q.bond) a.bonds = { ...(a.bonds || {}), [q.giver]: { pts: 99999 } };
  if (q.faction) a.faction = { id: q.faction, inf: 99999, done: {}, joinedAt: 0, ...(a.faction || {}), id2: undefined };
  if (q.faction) a.faction.id = q.faction;
  if (q.repeat === 'birthday') {
    const bd = data.npcs[q.giver].birthday;
    for (let d = 0; d < 60; d++) {
      S.t = d * T.secondsPerGameDay + 10 * HOUR;
      S.tick = Math.round(S.t * 30);
      if (require_isBirthday(C, q.giver)) break;
    }
    void bd;
  }
  // 이 퀘스트 전 메인 줄기에서 어느 섬에 있나: 앞 메인 마지막 단계의 자리에 둔다(없으면 주는 사람 곁)
  const warp = (x, z) => Object.assign(a, { x, z, move: null, dest: null, nav: null, action: null });
  // 점검이라 쓰러지지 않는다(싸움은 campaign.js가 본다)
  const heal = () => {
    if (!a.cb) return;
    a.cb.hp = a.cb.maxHp;
    a.cb.downUntil = 0;
    a.cb.stunUntil = 0;
  };
  const settle = () => { for (let k = 0; k < 3; k++) { heal(); g.advance(1); } heal(); };
  const disp = g.dispatch.bind(g);
  g.dispatch = (c) => { heal(); return disp(c); };
  // 받기
  if (q.kind === 'main') {
    a.quests.active[q.id] = { step: 0, n: 0, used: [], t: S.t };
  } else {
    let p = null;
    if (q.giver === 'board') {
      const boards = C.statics.filter((o) => o.kind === 'board');
      p = boards[0];
    } else p = npcPos(C, q.giver);
    if (!p) return fail('no_giver_pos');
    if (q.giver !== 'board' && !npcShown(C, a, q.giver)) return fail('giver_hidden', { giver: q.giver, appear: data.npcs[q.giver].appear });
    // 현상금은 아무 게시판이나 — 가장 가까운 것
    warp(p.x + 1.5, p.z);
    settle();
    if (q.giver !== 'board') {
      // 사람처럼: 다가가서(3m) 말을 걸고(TALK_OPEN), 읽는 동안(6초) 기다렸다가 받는다
      const who = giverNow(C, a, q);
      const p2 = npcPos(C, who);
      warp(p2.x + 3.0, p2.z);
      const o = g.dispatch({ type: 'TALK_OPEN', actor: 'p1', npc: who });
      if (!o.ok) return fail(`open:${o.error}:${who}`);
      for (let k = 0; k < 6; k++) { heal(); g.advance(1); }
    }
    const r = g.dispatch({ type: 'QUEST_ACCEPT', actor: 'p1', quest: q.id });
    if (!r.ok) return fail(`accept:${r.error}`);
  }
  // 단계
  const give = (item, n) => {
    const lot = Object.values(S.lots).find((l) => l.item === item)?.id ?? null;
    a.bag.push({ item, lot: data.items[item].family ? lot : null, bonus: null, qty: n });
  };
  for (let guard = 0; guard < 30 && a.quests.active[q.id]; guard++) {
    const P = a.quests.active[q.id];
    const st = q.steps[P.step];
    const s0 = P.step;
    log.push(`${s0}:${st.type}`);
    if (st.type === 'talk') {
      const who = stepNpc(C, a, st);
      const p = npcPos(C, who);
      if (!p) return fail(`talk:no_pos:${who}`);
      if (!npcShown(C, a, who)) return fail(`talk:hidden:${who}`, { appear: data.npcs[who]?.appear });
      if (st.take) for (const [it, k] of Object.entries(st.take)) give(it, k);
      warp(p.x + 3.0, p.z);
      const o = g.dispatch({ type: 'TALK_OPEN', actor: 'p1', npc: who });
      if (!o.ok) return fail(`open:${o.error}:${who}`);
      for (let k = 0; k < 8; k++) { heal(); g.advance(1); }
      const r = g.dispatch({ type: 'TALK', actor: 'p1', npc: who, quest: q.id });
      g.dispatch({ type: 'TALK_CLOSE', actor: 'p1', npc: who });
      if (!r.ok) return fail(`talk:${r.error}:${who}`, { due: talkDue(C, a, who) });
    } else if (st.type === 'have') {
      if (st.need) for (const [it, k] of Object.entries(st.need)) give(it, k);
      else {
        const it = st.any[0];
        if (data.items[it].kind === 'equipment') {
          const e = { uid: `au_${it}`, item: it, stats: {}, scores: {}, star: 2, masterwork: false, crafter: 'p1', dur: 100, maxDur: 100, broken: false };
          a.bag.push(e);
          if (st.equip) g.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid });
        } else give(it, st.count || 1);
      }
      settle();
    } else if (st.type === 'go') {
      const s = sitePos(C, st.site);
      if (!s) return fail(`go:no_site:${st.site}`);
      warp(s.x, s.z);
      settle();
    } else if (st.type === 'use') {
      const o = st.objs.find((x) => !P.used.includes(x));
      const pos = objPos(C, o);
      if (!pos) return fail(`use:no_obj:${o}`);
      warp(pos.x + 1, pos.z);
      const r = g.dispatch({ type: 'QUEST_USE', actor: 'p1', obj: o });
      if (!r.ok) return fail(`use:${r.error}:${o}`);
      settle();
    } else if (st.type === 'kill') {
      const s = st.site ? sitePos(C, st.site) : null;
      // 대상이 섬 어딘가에 있나(밤짐승은 밤까지)
      let ms = [];
      for (let k = 0; k < 200 && ms.length === 0; k++) {
        ms = Object.values(S.mobs).filter((m) => st.mobs.includes(m.type) && m.mode !== 'dead' && (!s || Math.hypot(m.x - s.x, m.z - s.z) <= s.r + 25));
        if (!ms.length) g.advance(30);
      }
      if (!ms.length) return fail(`kill:no_mob:${st.mobs.join('/')}${st.site ? '@' + st.site : ''}`);
      for (let k = 0; k < (st.count || 1) && a.quests.active[q.id]?.step === s0; k++) questKill(C, a, ms[k % ms.length]);
    } else if (st.type === 'eat') {
      const food = data.lists.items.find((x) => x.kind === 'consumable' && !x.potion && (!st.item || x.id === st.item));
      give(st.item || food.id, 1);
      const e = a.bag.find((x) => x.item === (st.item || food.id));
      const r = g.dispatch({ type: 'EAT', actor: 'p1', key: keyOf(e) });
      if (!r.ok) return fail(`eat:${r.error}`);
      settle();
    } else if (st.type === 'defend' || st.type === 'store' || st.type === 'sell' || st.type === 'repair' || st.type === 'project' || st.type === 'faction') {
      // 이 단계들은 기능 테스트가 본다: 넘긴 셈 친다(사람이 막히는지는 1)·3)이 본다)
      if (st.type === 'faction' && !a.faction?.id) a.faction = { id: data.factions.list[0].id, inf: 0, done: {} };
      P.step += 1;
      P.n = 0;
      P.used = [];
      if (P.step >= q.steps.length) {
        P.step -= 1;
        // 마지막 단계가 생활 단계면 끝난 셈
        delete a.quests.active[q.id];
        a.quests.done[q.id] = S.t;
      }
    } else return fail(`unknown_step:${st.type}`);
    if (st.type === 'use' && a.quests.active[q.id]?.step === s0 && a.quests.active[q.id].used.length > 0) continue;
    if (a.quests.active[q.id] && a.quests.active[q.id].step === s0 && st.type !== 'kill') {
      settle();
      if (a.quests.active[q.id] && a.quests.active[q.id].step === s0) return fail(`stuck:${st.type}`);
    }
    if (a.quests.active[q.id] && a.quests.active[q.id].step === s0 && st.type === 'kill') return fail('stuck:kill');
  }
  if (a.quests.active[q.id]) return fail('guard');
  if (q.reward?.mount && !a.mounts?.own?.includes(q.reward.mount)) return fail('no_mount_reward');
  return { ok: true, log };
}
import { isBirthday } from '../core/systems/bonds.js';
function require_isBirthday(C, npc) { return isBirthday(C, npc, C.state.t); }

// ── 3) 건너간 뒤: 등대섬 의뢰를 하는 중에 건너면 — 같은 사람이 본섬에 있으면 이어 가고, 아니면 내려놓는다
const info = { carried: [], dropped: [] };
function auditCrossing() {
  const crossQ = mainOrder.find((id) => data.quests[id].steps.some((s) => s.type === 'use' && s.objs.some((o) => data.objects[o]?.cross && !data.objects[o]?.ferry)));
  const g = createGame({ data, seed: 3, actors: [{ id: 'p1', kind: 'player' }] });
  const C = g._ctx;
  const a = g.state.actors.p1;
  const main = data.lists.regions.find((r) => r.island !== islandOf(0));
  for (const q of data.lists.quests) {
    if (q.kind === 'main') continue;
    const pre = closure(q.requires || []);
    if (pre.has(crossQ)) continue; // 건넌 뒤에 받는 것
    a.quests.active = {};
    startQuest(C, a, q.id);
    const lost = strandedQuests(C, a, main.island);
    (lost.includes(q.id) ? info.dropped : info.carried).push(q.id);
  }
  return crossQ;
}

// ── 0) 데이터 모양: 화면이 .map으로 읽는 줄 목록이 글 한 줄로 적히면 대화창이 멈춘다
function auditShapes() {
  const arr = (v) => v == null || Array.isArray(v);
  for (const q of data.lists.quests) {
    if (!arr(q.intro)) bad('shape', q.id, 'intro_not_array');
    q.steps.forEach((s, i) => {
      if (!s.text) bad('shape', q.id, `step${i}_no_text`);
      if (s.type === 'talk' && !arr(s.say)) bad('shape', q.id, `step${i}_say_not_array`);
      for (const [k, v] of Object.entries(s.sayBy || {})) if (!arr(v)) bad('shape', q.id, `step${i}_sayBy_${k}_not_array`);
    });
  }
  for (const n of Object.values(data.npcs)) {
    for (const k of ['chat', 'chatBond']) if (n[k] != null && !Array.isArray(n[k]) && typeof n[k] !== 'object') bad('shape', n.id, `${k}_bad`);
  }
}
auditShapes();
const t0 = Date.now();
const nN = args.only ? 0 : auditNpcs();
const results = {};
for (const q of data.lists.quests) {
  if (args.only && q.id !== args.only) continue;
  const r = auditQuest(q);
  results[q.id] = r;
  if (!r.ok) bad('quest', q.id, r.why, { name: q.name, kind: q.kind, step: r.step, log: r.log.join(' '), ...(r.giver ? { giver: r.giver } : {}), ...(r.appear ? { appear: r.appear } : {}), ...(r.due ? { due: r.due } : {}) });
}
const crossQ = args.only ? null : auditCrossing();
const summary = { carriedOnCross: info.carried.length, droppedOnCross: info.dropped.length, carried: info.carried.join(','), npcs: nN, quests: Object.keys(results).length, questFails: Object.values(results).filter((r) => !r.ok).length, crossQuest: crossQ, problems: problems.length, sec: Math.round((Date.now() - t0) / 1000) };
if (args.json) console.log(JSON.stringify({ summary, problems }, null, 1));
else {
  console.log(summary);
  for (const p of problems) console.log(`  [${p.kind}] ${p.id}${p.name ? ' ' + p.name : ''}: ${p.why}${p.step != null ? ' (단계 ' + p.step + ')' : ''}${p.h != null ? ' ' + p.h + '시' : ''}${p.log ? ' · ' + p.log : ''}`);
}
