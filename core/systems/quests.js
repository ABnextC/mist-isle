// 퀘스트(v0.5): 장(章)마다 이어지는 메인 퀘스트와 게시판 현상금.
// 행위자마다 a.quests = { active: { id: { step, n, used, ev? } }, done: { id: 끝낸 시각 }, items: { 물건: 수 }, track, daily: { id: 날 } }
// 진행은 모두 코어가 한다: 대화(TALK)·물체(QUEST_USE)는 명령으로, 쓰러뜨리기는 짐승이 쓰러질 때, 가기·막기는 1초마다 본다.
// 메인 퀘스트는 끝나면 다음 퀘스트가 바로 이어진다(수락 없음). 현상금은 게시판에서 받고, 다 채우면 바로 끝난다.

import { addEntry, slotsNeeded } from '../inventory.js';
import { convertStats, starOf } from '../formulas.js';
import { sitePos, npcPos, objPos, storeOf } from '../world.js';
import { tempGroup, spawnTemp, freeSpot, removeMob, isAlive } from './mobs.js';
import { isDown } from './combat.js';

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
  delete Q.active[id];
  Q.done[id] = ctx.state.t;
  if (q.repeat === 'daily') Q.daily[id] = ctx.clock.day(ctx.state.t);
  for (const it of q.takes || []) delete Q.items[it];
  const reward = giveReward(ctx, a, q);
  a.stats.quests = (a.stats.quests || 0) + 1;
  ctx.emit('quest.done', { actor: a.id, quest: id, reward, next: q.next || null });
  if (q.next) startQuest(ctx, a, q.next);
  if (Q.track === id || !Q.active[Q.track]) Q.track = Object.keys(Q.active).sort((x, y) => mainFirst(ctx, x, y))[0] || null;
  if (q.kind === 'main' && !q.next) ctx.emit('chapter.done', { actor: a.id, chapter: q.chapter });
}

const mainFirst = (ctx, x, y) => (ctx.data.quests[x].kind === 'main' ? 0 : 1) - (ctx.data.quests[y].kind === 'main' ? 0 : 1) || (x < y ? -1 : 1);

// ── 보상 ───────────────────────────────────────────
// 보상을 준 사람(끝내는 대화 상대). 현상금은 마을 경비대
export function rewardGiver(ctx, q) {
  const last = [...q.steps].reverse().find((s) => s.type === 'talk');
  return last ? ctx.data.npcs[last.npc].name : '마을 경비대';
}

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
      crafter: rewardGiver(ctx, q), dur: stats.durability ?? null, maxDur: stats.durability ?? null, broken: false,
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
  const r = q.reward || {};
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
export function talkDue(ctx, a, npc) {
  const out = [];
  for (const id of Object.keys(a.quests?.active || {})) {
    const st = stepOf(ctx, a, id);
    if (st?.type === 'talk' && st.npc === npc) out.push(id);
  }
  return out.sort((x, y) => mainFirst(ctx, x, y));
}

export function talk(ctx, a, ids) {
  for (const id of ids) {
    const st = stepOf(ctx, a, id);
    if (st?.type === 'talk') advance(ctx, a, id);
  }
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

// ── 막기(습격) ─────────────────────────────────────
function spawnWave(ctx, a, st, s, p) {
  const site = ctx.data.sites[st.site];
  const [ox, oz] = site.spawn || [16, 0];
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

// 1초마다: 가기·막기
export function questsTick(ctx) {
  for (const a of Object.values(ctx.state.actors)) {
    const Q = a.quests;
    if (!Q) continue;
    for (const id of Object.keys(Q.active)) {
      const p = Q.active[id];
      if (!p) continue;
      const st = ctx.data.quests[id].steps[p.step];
      if (!st) continue;
      if (st.type === 'go') {
        const s = sitePos(ctx, st.site);
        if (Math.hypot(a.x - s.x, a.z - s.z) <= s.r) advance(ctx, a, id);
      } else if (st.type === 'defend') defendTick(ctx, a, id, st, p);
    }
  }
}

// ── 화면·봇이 쓰는 읽기 전용 도우미 ─────────────────
// 지금 단계의 목표 자리(길잡이 화살표·미니맵). 쓰러뜨리기는 자리가 있으면 그 자리, 없으면 가장 가까운 대상
export function stepGoal(ctx, a, id) {
  const st = stepOf(ctx, a, id);
  if (!st) return null;
  if (st.type === 'talk') {
    const p = npcPos(ctx.data, st.npc);
    const n = ctx.data.npcs[st.npc];
    return { x: p.x, z: p.z, label: `${n.title} ${n.name}`, kind: 'npc', npc: st.npc };
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
  return null;
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
  return st.text;
}

// NPC 머리 위 표시: ! 이야기 시작·새 의뢰, ? 이야기 이어 가기(끝내기 포함)
export function npcMark(ctx, a, npc) {
  for (const id of talkDue(ctx, a, npc)) {
    const p = a.quests.active[id];
    return p.step === 0 ? '!' : '?';
  }
  return null;
}

// 게시판에서 받을 수 있는 현상금
export function boardOffers(ctx, a) {
  return ctx.data.lists.quests.filter((q) => q.giver === 'board' && available(ctx, a, q));
}

export const nearNpc = (ctx, a, npc, range = TALK_RANGE) => {
  const p = npcPos(ctx.data, npc);
  return !!p && Math.hypot(a.x - p.x, a.z - p.z) <= range;
};
