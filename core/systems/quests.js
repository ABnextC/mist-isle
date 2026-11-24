// 퀘스트(v0.5): 장(章)마다 이어지는 메인 퀘스트와 게시판 현상금.
// 행위자마다 a.quests = { active: { id: { step, n, used, ev? } }, done: { id: 끝낸 시각 }, items: { 물건: 수 }, track, daily: { id: 날 } }
// 진행은 모두 코어가 한다: 대화(TALK)·물체(QUEST_USE)는 명령으로, 쓰러뜨리기는 짐승이 쓰러질 때, 가기·막기는 1초마다 본다.
// 메인 퀘스트는 끝나면 다음 퀘스트가 바로 이어진다(수락 없음). 현상금은 게시판에서 받고, 다 채우면 바로 끝난다.
// 생활 단계(v0.5.2, 튜토리얼 섬): 가지기(have)·마을 사업(project)은 1초마다 보고, 먹기·맡기기·고치기·팔기는 그 명령이 알린다(questNote).
// 고치기는 고칠 것이 하나도 없으면 그냥 넘어간다. 단계 보상(step.reward)은 그 단계를 넘길 때 준다.

import { closeVein, openVein } from './veins.js';
import { addEntry, slotsNeeded, countItem, takeQty, keyOf } from '../inventory.js';
import { convertStats, starOf } from '../formulas.js';
import { sitePos, npcPos, objPos, storeOf, reachable } from '../world.js';
import { tempGroup, spawnTemp, freeSpot, removeMob, isAlive } from './mobs.js';
import { isDown } from './combat.js';
import { unlockedSet } from './unlocks.js';
import { factionDef, factionOf, gainInfluence } from './factions.js';
import { projectProgress } from '../settlements.js';

export const TALK_RANGE = 3.6;
export const USE_RANGE = 2.6;
export const BOARD_RANGE = 3.6;
const DEFEND_FAIL_M = 90; // 막기 자리에서 이만큼 벗어나면 습격대를 거둔다

export const emptyQuests = () => ({ active: {}, done: {}, items: {}, track: null, daily: {} });

// 첫 장의 첫 퀘스트(새 개척자가 바로 받는다)
export function firstQuest(data) {
  return data.chapters[0]?.quests[0] || null;
}

export function startQuest(ctx, a, id) {
  const q = ctx.data.quests[id];
  if (!q || !a.quests || a.quests.active[id]) return;
  a.quests.active[id] = { step: 0, n: 0, used: [], t: ctx.state.t };
  const cur = a.quests.track && ctx.data.quests[a.quests.track];
  if (q.kind === 'main' || !cur || !a.quests.active[a.quests.track]) a.quests.track = id;
  ctx.emit('quest.start', { actor: a.id, quest: id });
}

export const stepOf = (ctx, a, id) => {
  const p = a.quests?.active[id];
  return p ? ctx.data.quests[id].steps[p.step] || null : null;
};

// 받을 수 있는가(현상금·부가): 앞 퀘스트를 끝냈고, 하고 있지 않고, 아직 안 했거나(하루 한 번이면 오늘 안 했거나)
export function available(ctx, a, q) {
  const Q = a.quests;
  if (!Q || Q.active[q.id] || q.kind === 'main') return false;
  if (q.repeat === 'daily') {
    if (Q.daily[q.id] === ctx.clock.day(ctx.state.t)) return false;
  } else if (Q.done[q.id] != null) return false;
  return (q.requires || []).every((r) => Q.done[r] != null);
}

function advance(ctx, a, id) {
  const q = ctx.data.quests[id];
  const p = a.quests.active[id];
  const st = q.steps[p.step];
  if (st.gives && st.type !== 'use') a.quests.items[st.gives] = (a.quests.items[st.gives] || 0) + 1;
  // 단계 보상(v0.5.2): 강두가 벼려 준 구리 검처럼 퀘스트 중간에 받는 것
  if (st.reward) {
    const reward = giveReward(ctx, a, { ...q, reward: st.reward });
    ctx.emit('quest.stepReward', { actor: a.id, quest: id, step: p.step, reward });
  }
  p.step += 1;
  p.n = 0;
  p.used = [];
  delete p.ev;
  if (p.step >= q.steps.length) {
    complete(ctx, a, id);
    return;
  }
  ctx.emit('quest.step', { actor: a.id, quest: id, step: p.step });
}

function complete(ctx, a, id) {
  const q = ctx.data.quests[id];
  const Q = a.quests;
  const before = unlockedSet(ctx, a);
  delete Q.active[id];
  Q.done[id] = ctx.state.t;
  if (q.repeat === 'daily') Q.daily[id] = ctx.clock.day(ctx.state.t);
  for (const it of q.takes || []) delete Q.items[it];
  const reward = giveReward(ctx, a, q);
  // 표식(v0.5.1): 등불의 각인처럼 이야기로 얻는 능력
  for (const g of q.grants || []) {
    a.marks = a.marks || {};
    if (a.marks[g] == null) {
      a.marks[g] = ctx.state.t;
      ctx.emit('quest.grant', { actor: a.id, quest: id, mark: g });
    }
  }
  a.stats.quests = (a.stats.quests || 0) + 1;
  ctx.emit('quest.done', { actor: a.id, quest: id, reward, next: q.next || null });
  const nq = q.next ? ctx.data.quests[q.next] : null;
  // 장이 바뀌면 끝·시작을 알린다(다음 장이 아직 없으면 끝만)
  // 세계 사건(v0.9): 영맥이 한꺼번에 움직인다 — 모든 섬의 순환 산지가 새로 열린다
  if (q.onDone === 'veinShift') shiftVeins(ctx);
  // 장에 아직 붙지 않은 퀘스트가 남았으면(more) 끝이 아니라 '이야기 쉼'이다(v0.6)
  const chDef = ctx.data.chapters.find((c) => c.id === q.chapter);
  if (q.kind === 'main' && !nq && chDef?.more) ctx.emit('story.pause', { actor: a.id, chapter: q.chapter });
  else if (q.kind === 'main' && (!nq || nq.chapter !== q.chapter)) ctx.emit('chapter.done', { actor: a.id, chapter: q.chapter, next: nq?.chapter || null });
  if (q.next) startQuest(ctx, a, q.next);
  if (Q.track === id || !Q.active[Q.track]) Q.track = Object.keys(Q.active).sort((x, y) => mainFirst(ctx, x, y))[0] || null;
  // 해금(v0.5.2): 이 퀘스트로 새로 열린 기능
  const gained = [...unlockedSet(ctx, a)].filter((u) => !before.has(u));
  if (gained.length) ctx.emit('unlock', { actor: a.id, ids: gained, quest: id });
}

// 메인 줄기 잇기(v0.5.1): 패치로 다음 퀘스트가 붙으면(1장 끝 → 2장) 이미 끝낸 사람도 이어서 받는다
function catchUp(ctx, a) {
  const Q = a.quests;
  for (const id of Object.keys(Q.done)) {
    const q = ctx.data.quests[id];
    if (!q || q.kind !== 'main' || !q.next) continue;
    if (Q.active[q.next] || Q.done[q.next] != null) continue;
    startQuest(ctx, a, q.next);
  }
}

const mainFirst = (ctx, x, y) => (ctx.data.quests[x].kind === 'main' ? 0 : 1) - (ctx.data.quests[y].kind === 'main' ? 0 : 1) || (x < y ? -1 : 1);

// ── 보상 ───────────────────────────────────────────
// 보상을 준 사람(끝내는 대화 상대). 현상금은 마을 경비대
export function rewardGiver(ctx, q) {
  const last = [...q.steps].reverse().find((s) => s.type === 'talk' && s.npc !== '@leader');
  return last ? ctx.data.npcs[last.npc].name : '마을 경비대';
}

// 세력 지도자 대화(v0.7.1): npc '@leader'는 내가 든 세력의 지도자다(없으면 강두)
export function stepNpc(ctx, a, st) {
  if (st?.npc !== '@leader') return st?.npc;
  return factionDef(ctx, factionOf(a))?.leader || 'gangdu_port';
}
// 세력마다 다른 대사(sayBy)
export const stepSay = (ctx, a, st) => st.sayBy?.[factionOf(a)] || st.say;

// 재료 보상은 퀘스트·품목마다 묶음 하나(속성은 모두 55로 고르게)
function rewardLot(ctx, q, def) {
  if (!def.family) return null;
  const st = ctx.state;
  st.rewardLots = st.rewardLots || {};
  const key = `${q.id}:${def.id}`;
  if (st.rewardLots[key] && st.lots[st.rewardLots[key]]) return st.rewardLots[key];
  const id = ctx.newId('L');
  st.lots[id] = { id, item: def.id, name: `${rewardGiver(ctx, q)}의 선물`, props: Object.fromEntries(def.props.map((p) => [p, 55])), vein: null, mix: false };
  st.rewardLots[key] = id;
  return id;
}

function rewardEntry(ctx, q, it) {
  const { data, cfg } = ctx;
  const def = data.items[it.item];
  const score = it.score ?? 40;
  if (def.kind === 'equipment') {
    const scores = Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, score]));
    const stats = convertStats(def.statConvert, scores);
    return {
      uid: ctx.newId('it'), item: def.id, stats, scores, star: starOf(score, cfg.stars), masterwork: false,
      crafter: it.crafter || rewardGiver(ctx, q), dur: stats.durability ?? null, maxDur: stats.durability ?? null, broken: false,
    };
  }
  if (def.kind === 'consumable') {
    const scores = Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, score]));
    return { item: def.id, lot: null, bonus: null, stats: convertStats(def.statConvert, scores), star: starOf(score, cfg.stars), qty: it.qty || 1 };
  }
  return { item: def.id, lot: rewardLot(ctx, q, def), bonus: null, qty: it.qty || 1 };
}

// 가방에 넣고, 자리가 없으면 귀환 지점 마을 창고로 보낸다
function giveReward(ctx, a, q) {
  // 세력마다 다른 보상(v0.7.1): rewardBy[세력]을 덧붙이고, inf는 그 세력 영향력
  const by = q.rewardBy?.[factionOf(a)];
  const r = by ? { silver: (q.reward?.silver || 0) + (by.silver || 0), items: [...(q.reward?.items || []), ...(by.items || [])] } : q.reward || {};
  if (by?.inf) gainInfluence(ctx, a, by.inf, 'story');
  const out = { silver: r.silver || 0, items: [], stored: [] };
  if (r.silver) a.silver += r.silver;
  for (const it of r.items || []) {
    const entry = rewardEntry(ctx, q, it);
    const qty = entry.qty ?? 1;
    if (a.bag.length + slotsNeeded(a.bag, [entry]) <= ctx.cfg.bag.slots) {
      addEntry(a.bag, entry);
      out.items.push({ item: it.item, qty, uid: entry.uid || null });
    } else {
      addEntry(storeOf(a, a.home), entry);
      out.stored.push({ item: it.item, qty });
    }
  }
  return out;
}

// ── 대화·물체 ─────────────────────────────────────
// 이 NPC와 이야기해야 넘어가는 퀘스트들(메인 먼저)
// 이야기 뒤에 나타나는 NPC(v0.7): appear 퀘스트를 받았거나 끝냈을 때만 보이고 말을 건다
export function npcShown(ctx, a, npc) {
  const ap = ctx.data.npcs[npc]?.appear;
  return !ap || !!a?.quests?.active?.[ap] || a?.quests?.done?.[ap] != null;
}

export function talkDue(ctx, a, npc) {
  const out = [];
  for (const id of Object.keys(a.quests?.active || {})) {
    const st = stepOf(ctx, a, id);
    if (st?.type === 'talk' && stepNpc(ctx, a, st) === npc) out.push(id);
  }
  return out.sort((x, y) => mainFirst(ctx, x, y));
}

export function talk(ctx, a, ids) {
  for (const id of ids) {
    const st = stepOf(ctx, a, id);
    if (st?.type !== 'talk') continue;
    if (st.take) takeItems(ctx, a, st);
    advance(ctx, a, id);
  }
}

// 건네기(v0.6): talk 단계의 take. 가방과 (마을 안이면) 그 마을 창고에서 센다
export function takeProgress(ctx, a, st) {
  const lists = reachable(ctx, a);
  return Object.entries(st.take).map(([item, need]) => ({ item, need, got: Math.min(need, countItem(lists, item)) }));
}
export const takeMet = (ctx, a, st) => !st?.take || takeProgress(ctx, a, st).every((x) => x.got >= x.need);
function takeItems(ctx, a, st) {
  const lists = reachable(ctx, a);
  for (const [item, need] of Object.entries(st.take)) {
    let left = need;
    for (const list of lists) {
      for (const e of [...list]) {
        if (left <= 0) break;
        if (e.item !== item || e.uid) continue;
        const q = Math.min(left, e.qty);
        takeQty(list, keyOf(e), q);
        left -= q;
      }
    }
  }
}

// 지금 말을 걸면 넘어갈 퀘스트(건넬 물건이 모자란 것은 빠진다)
export function talkReady(ctx, a, npc) {
  return talkDue(ctx, a, npc).filter((id) => takeMet(ctx, a, stepOf(ctx, a, id)));
}

// 이 물체를 지금 써야 하는 퀘스트(아직 안 쓴 것)
export function useDue(ctx, a, obj) {
  for (const id of Object.keys(a.quests?.active || {})) {
    const st = stepOf(ctx, a, id);
    const p = a.quests.active[id];
    if (st?.type === 'use' && st.objs.includes(obj) && !p.used.includes(obj)) return id;
  }
  return null;
}

export function useObj(ctx, a, id, obj) {
  const st = stepOf(ctx, a, id);
  const p = a.quests.active[id];
  p.used.push(obj);
  p.n = p.used.length;
  if (st.gives) a.quests.items[st.gives] = (a.quests.items[st.gives] || 0) + 1;
  ctx.emit('quest.use', { actor: a.id, quest: id, obj, gives: st.gives || null, n: p.n, need: st.count });
  if (p.n >= st.count) advance(ctx, a, id);
}

// ── 쓰러뜨리기 ─────────────────────────────────────
export function questKill(ctx, a, m) {
  const Q = a.quests;
  if (!Q) return;
  for (const id of Object.keys(Q.active)) {
    const p = Q.active[id];
    const st = stepOf(ctx, a, id);
    if (!st) continue;
    if (st.type === 'kill' && st.mobs.includes(m.type)) {
      if (st.site) {
        const s = sitePos(ctx, st.site);
        if (Math.hypot(m.x - s.x, m.z - s.z) > s.r + 25) continue;
      }
      p.n += 1;
      ctx.emit('quest.progress', { actor: a.id, quest: id, n: p.n, need: st.count });
      if (p.n >= st.count) advance(ctx, a, id);
    } else if (st.type === 'defend' && p.ev && m.event === p.ev.id) {
      p.n += 1;
      ctx.emit('quest.progress', { actor: a.id, quest: id, n: p.n, need: defendTotal(st) });
    }
  }
}

export const defendTotal = (st) => st.waves.reduce((s, w) => s + Object.values(w).reduce((x, y) => x + y, 0), 0);

// ── 생활 단계(v0.5.2) ───────────────────────────────
// 가방에서 센다(낀 장비도 가방에 있다). equip이면 낀 것만
function haveCount(a, item, equipOnly = false) {
  if (!equipOnly) return countItem([a.bag], item);
  const uids = new Set(Object.values(a.equip || {}).filter(Boolean));
  return a.bag.filter((e) => e.uid && uids.has(e.uid) && e.item === item).length;
}

export function haveProgress(a, st) {
  if (st.need) return Object.entries(st.need).map(([item, need]) => ({ item, need, got: Math.min(need, haveCount(a, item, st.equip)) }));
  const need = st.count || 1;
  const got = st.any.reduce((n, it) => n + haveCount(a, it, st.equip), 0);
  return [{ item: null, need, got: Math.min(need, got) }];
}

// orAny: 이미 다음 것을 가졌으면 이 단계는 지난 셈이다(돌 도구를 벌써 만들었다면 표류목·돌 줍기는 끝)
const haveMet = (a, st) => (st.orAny || []).some((it) => haveCount(a, it) > 0) || haveProgress(a, st).every((x) => x.got >= x.need);

// 고칠 수 있는 것(내구가 준 장비·도구)이 하나라도 있나
function anyDamaged(ctx, a) {
  return a.bag.some((e) => {
    const def = ctx.data.items[e.item];
    return (def?.armor || def?.weapon || def?.tool) && e.maxDur != null && (e.broken || e.dur < e.maxDur);
  });
}

// 명령이 알리는 생활 단계: 먹기(eat)·맡기기(store)·고치기(repair)·팔기(sell). info.at: 그 일을 한 마을
export function questNote(ctx, a, kind, info = {}) {
  const Q = a.quests;
  if (!Q) return;
  for (const id of Object.keys(Q.active)) {
    const p = Q.active[id];
    const st = stepOf(ctx, a, id);
    if (!st || st.type !== kind) continue;
    if (st.at && info.at !== st.at) continue;
    p.n += 1;
    const need = st.count || 1;
    ctx.emit('quest.progress', { actor: a.id, quest: id, n: p.n, need });
    if (p.n >= need) advance(ctx, a, id);
  }
}

// ── 막기(습격) ─────────────────────────────────────
function spawnWave(ctx, a, st, s, p) {
  const site = ctx.data.sites[st.site];
  const [ox, oz] = st.from?.[p.ev.wave] || site.spawn || [16, 0];
  let g = ctx.state.mobGroups[p.ev.group];
  if (!g) {
    g = tempGroup(ctx, s.x, s.z, { event: p.ev.id });
    p.ev.group = g.id;
  }
  for (const [typeId, n] of Object.entries(st.waves[p.ev.wave])) {
    for (let i = 0; i < n; i++) {
      const [x, z] = freeSpot(ctx, s.x + ox, s.z + oz, 4);
      const m = spawnTemp(ctx, g, typeId, x, z, { event: p.ev.id, leash: 80 });
      m.target = a.id;
      m.mode = 'chase';
      m.until = null;
    }
  }
}

function defendTick(ctx, a, id, st, p) {
  const s = sitePos(ctx, st.site);
  const d = Math.hypot(a.x - s.x, a.z - s.z);
  if (!p.ev) {
    if (d <= s.r + 6 && !isDown(a)) {
      p.ev = { id: ctx.newId('ev'), wave: 0, group: null };
      p.n = 0;
      spawnWave(ctx, a, st, s, p);
      ctx.emit('quest.wave', { actor: a.id, quest: id, wave: 1, waves: st.waves.length });
    }
    return;
  }
  const g = ctx.state.mobGroups[p.ev.group];
  const alive = g ? g.mobs.map((x) => ctx.state.mobs[x]).filter(isAlive) : [];
  if (isDown(a) || d > DEFEND_FAIL_M) {
    for (const m of alive) removeMob(ctx, m);
    p.n = 0;
    delete p.ev;
    ctx.emit('quest.fail', { actor: a.id, quest: id, reason: isDown(a) ? 'down' : 'left' });
    return;
  }
  if (alive.length) return;
  p.ev.wave += 1;
  if (p.ev.wave >= st.waves.length) {
    advance(ctx, a, id);
    return;
  }
  spawnWave(ctx, a, st, s, p);
  ctx.emit('quest.wave', { actor: a.id, quest: id, wave: p.ev.wave + 1, waves: st.waves.length });
}

// 1초마다: 가기·막기·메인 줄기 잇기
export function questsTick(ctx) {
  for (const a of Object.values(ctx.state.actors)) {
    const Q = a.quests;
    if (!Q) continue;
    if (a.kind === 'player') catchUp(ctx, a);
    for (const id of Object.keys(Q.active)) {
      // 이미 이룬 단계가 잇달아 있으면(돌 도구를 벌써 가졌다) 한 번에 넘긴다
      for (let k = 0; k < 4; k++) {
        const p = Q.active[id];
        if (!p) break;
        const st = ctx.data.quests[id].steps[p.step];
        if (!st) break;
        const step0 = p.step;
        if (st.type === 'go') {
          const s = sitePos(ctx, st.site);
          if (Math.hypot(a.x - s.x, a.z - s.z) <= s.r) advance(ctx, a, id);
        } else if (st.type === 'defend') defendTick(ctx, a, id, st, p);
        else if (st.type === 'have' && haveMet(a, st)) advance(ctx, a, id);
        else if (st.type === 'project' && ctx.state.projects[st.project]?.done) advance(ctx, a, id);
        else if (st.type === 'faction' && a.faction?.id) advance(ctx, a, id); // 세력을 골랐다(v0.7)
        else if (st.type === 'repair' && !anyDamaged(ctx, a)) advance(ctx, a, id);
        if (!Q.active[id] || Q.active[id].step === step0 || st.type === 'defend') break;
      }
    }
  }
}

// ── 화면·봇이 쓰는 읽기 전용 도우미 ─────────────────
// 지금 단계의 목표 자리(길잡이 화살표·미니맵). 쓰러뜨리기는 자리가 있으면 그 자리, 없으면 가장 가까운 대상
export function stepGoal(ctx, a, id) {
  const st = stepOf(ctx, a, id);
  if (!st) return null;
  if (st.type === 'faction') {
    // 세 갈래 길(v0.7): 가장 가까운 세력 지도자
    const best = ctx.data.factions.list.map((f) => ({ f, p: npcPos(ctx, f.leader) })).filter((x) => x.p)
      .sort((x, y) => Math.hypot(x.p.x - a.x, x.p.z - a.z) - Math.hypot(y.p.x - a.x, y.p.z - a.z))[0];
    if (best) return { x: best.p.x, z: best.p.z, label: `${best.f.icon} ${best.f.name}`, kind: 'npc', npc: best.f.leader };
  }
  if (st.type === 'talk') {
    const id = stepNpc(ctx, a, st);
    const p = npcPos(ctx, id);
    const n = ctx.data.npcs[id];
    return { x: p.x, z: p.z, label: `${n.title} ${n.name}`, kind: 'npc', npc: id };
  }
  if (st.type === 'go' || st.type === 'defend' || (st.type === 'kill' && st.site)) {
    const s = sitePos(ctx, st.site);
    return { x: s.x, z: s.z, label: s.name, kind: 'site', r: s.r };
  }
  if (st.type === 'use') {
    const p = a.quests.active[id];
    let best = null;
    for (const o of st.objs) {
      if (p.used.includes(o)) continue;
      const pos = objPos(ctx, o);
      const d = Math.hypot(pos.x - a.x, pos.z - a.z);
      if (!best || d < best.d) best = { x: pos.x, z: pos.z, d, label: ctx.data.objects[o].name, kind: 'obj', obj: o };
    }
    return best;
  }
  if (st.type === 'kill') {
    let best = null;
    for (const m of Object.values(ctx.state.mobs)) {
      if (!isAlive(m) || !st.mobs.includes(m.type)) continue;
      const d = Math.hypot(m.x - a.x, m.z - a.z);
      if (!best || d < best.d) best = { x: m.x, z: m.z, d, label: ctx.data.creatures[m.type].name, kind: 'mob' };
    }
    return best;
  }
  // 생활 단계: 길잡이 힌트(goal)를 따른다. 사업은 그 마을 게시판
  const gl = st.goal || {};
  if (st.type === 'project') return boardGoalOf(ctx, a, ctx.data.projects[st.project].at);
  if (gl.node) {
    // 가지기 단계는 아직 모자란 물건의 노드부터
    let types = gl.node;
    if (st.type === 'have' && st.need && gl.nodeFor) {
      const short = haveProgress(a, st).filter((x) => x.got < x.need).map((x) => x.item);
      const pick = gl.node.filter((n, i) => short.includes(gl.nodeFor[i]));
      if (pick.length) types = pick;
    }
    let best = null;
    for (const n of Object.values(ctx.state.nodes)) {
      if (!types.includes(n.type) || n.charges <= 0) continue;
      const d = Math.hypot(n.x - a.x, n.z - a.z);
      if (!best || d < best.d) best = { x: n.x, z: n.z, d, label: ctx.data.nodes[n.type].name, kind: 'node' };
    }
    return best;
  }
  if (gl.station) return stationGoalOf(ctx, a, gl.station, gl.at || st.at || null);
  if (gl.board || gl.market) return boardGoalOf(ctx, a, gl.at || st.at || null, gl.market ? 'market' : 'board');
  return null;
}

function stationGoalOf(ctx, a, type, at) {
  let best = null;
  for (const s of Object.values(ctx.state.settlements)) {
    if (at && s.id !== at) continue;
    const t = s.stations.find((x) => x.type === type);
    if (!t) continue;
    const d = Math.hypot(t.x - a.x, t.z - a.z);
    if (!best || d < best.d) best = { x: t.x, z: t.z, d, label: `${s.name} ${ctx.data.stations[type].name}`, kind: 'station' };
  }
  return best;
}

function boardGoalOf(ctx, a, at, kind = 'board') {
  let best = null;
  for (const o of ctx.statics || []) {
    if (o.kind !== kind || (at && o.at !== at)) continue;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    const town = ctx.state.settlements[o.at]?.name || '';
    if (!best || d < best.d) best = { x: o.x, z: o.z, d, label: `${town} ${kind === 'market' ? '장터' : '게시판'}`.trim(), kind: 'board' };
  }
  return best;
}

// 단계 글: "해안 게 쓰러뜨리기 (2/3)"
export function stepText(ctx, a, id) {
  const st = stepOf(ctx, a, id);
  if (!st) return '';
  const p = a.quests.active[id];
  if (st.type === 'kill' || st.type === 'use') return `${st.text} (${Math.min(p.n, st.count)}/${st.count})`;
  if (st.type === 'defend') {
    const total = defendTotal(st);
    return p.ev ? `${st.text} (${Math.min(p.n, total)}/${total} · ${p.ev.wave + 1}/${st.waves.length}물결)` : st.text;
  }
  if (st.type === 'have') {
    const prog = haveProgress(a, st);
    if (st.need) return `${st.text} (${prog.map((x) => `${ctx.data.items[x.item].name} ${x.got}/${x.need}`).join(' · ')})`;
    return `${st.text} (${prog[0].got}/${prog[0].need})`;
  }
  if (st.type === 'project') return `${st.text} (${Math.round(projectProgress(ctx, st.project) * 100)}%)`;
  if (st.type === 'talk' && st.take) return `${st.text} (${takeProgress(ctx, a, st).map((x) => `${ctx.data.items[x.item].name} ${x.got}/${x.need}`).join(' · ')})`;
  if ((st.count || 1) > 1) return `${st.text} (${Math.min(p.n, st.count)}/${st.count})`;
  return st.text;
}

// NPC 머리 위 표시: ! 이야기 시작·새 의뢰, ? 이야기 이어 가기(끝내기 포함)
export function npcMark(ctx, a, npc) {
  const id = talkDue(ctx, a, npc)[0];
  if (!id) return null;
  return a.quests.active[id].step === 0 ? '!' : '?';
}

export const hasMark = (a, mark) => a?.marks?.[mark] != null;

// 게시판에서 받을 수 있는 현상금
export function boardOffers(ctx, a) {
  return ctx.data.lists.quests.filter((q) => q.giver === 'board' && available(ctx, a, q));
}

export const nearNpc = (ctx, a, npc, range = TALK_RANGE) => {
  const p = npcPos(ctx, npc);
  return !!p && Math.hypot(a.x - p.x, a.z - p.z) <= range;
};

export function shiftVeins(ctx) {
  const old = Object.values(ctx.state.veins).filter((v) => !v.common);
  ctx.emit('world.veinShift', { closed: old.length });
  for (const v of old) closeVein(ctx, v);
  for (const region of ctx.data.lists.regions) {
    if (!ctx.state.regions[region.id]) continue;
    for (const vc of region.veins) for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
  }
}
