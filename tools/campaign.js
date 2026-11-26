// 진행 페르소나(v3.1): 페르소나가 1장부터 6장까지 이야기와 서브퀘스트를 따라간다.
//   node tools/campaign.js [--seed 2026] [--only 렌] [--json]
//
// 무엇을 진짜로 돌리고 무엇을 셈만 하나
//   진짜: 싸움(잡기·막기·두목·습격 물결)은 페르소나의 읽기·막기 실력으로 코어 싸움 그대로 치른다.
//         경험치·레벨·쓰러짐·회복·물약도 코어 그대로다.
//   셈만: 걷기·채집·제작·대화 같은 생활과 이동은 시간만 어림해 더한다(모은 셈 치고 넣어 준다).
//   장비: 장마다 그 페르소나가 만들어 썼을 법한 장비(손재주 = quality)를 쥐여 준다.
// 레벨이 모자라 막히면 페르소나는 그 지역의 알맞은 짐승을 사냥해 레벨을 올리고 다시 간다(그 시간도 잰다).

import { loadData } from './load-data.js';
import { createGame } from '../core/game.js';
import { npcPos, sitePos, objPos } from '../core/world.js';
import { stepNpc, available, questXp } from '../core/systems/quests.js';
import { startFight, stopFight } from '../core/ai/fighter.js';
import { convertStats, starOf } from '../core/formulas.js';
import { keyOf } from '../core/inventory.js';
import { regionAt } from '../core/terrain.js';
import { isAlive } from '../core/systems/mobs.js';
import { masteryOf } from '../core/systems/mastery.js';
import { mountsOf, mountSpeed, gainMount } from '../core/systems/mounts.js';
import { travelCost, wayStatic } from '../core/systems/waystones.js';
import { isUnlocked } from '../core/systems/unlocks.js';

const args = (() => {
  const o = { seed: 2026, json: false, only: null };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '--json') o.json = true;
    else if (v[i] === '--only') o.only = v[++i];
    else if (v[i].startsWith('--')) o[v[i].slice(2)] = Number(v[++i]);
  }
  return o;
})();

// 페르소나마다 이야기 밖에서 하는 일: 서브퀘스트를 얼마나 하나(side), 장마다 사냥에 쓰는 분(grind)
const PLAY = {
  persona_sol: { side: 0.5, grind: 4 },
  persona_moru: { side: 0.6, grind: 3 },
  persona_harang: { side: 0.3, grind: 2 },
  persona_saebyeok: { side: 1.0, grind: 6 },
  persona_mujin: { side: 0.7, grind: 15 },
  persona_ren: { side: 0.9, grind: 8 },
  persona_kongi: { side: 0.4, grind: 3 },
};
const WEAPON = { sword: 'sword', spear: 'spear', axe: 'battleaxe' };
// 장마다 쥐는 무기 금속·갑옷(장을 시작할 때 갖춘다)
const GEAR = {
  ch1: { metal: 'copper', armor: 'leather' },
  ch2: { metal: 'iron', armor: 'leather' }, // 2장 숲머리 대장간(c2_forge) 뒤 철
  ch3: { metal: 'iron', armor: 'leather' },
  ch4: { metal: 'iron', armor: 'iron' },
  ch5: { metal: 'iron', armor: 'iron' },
  ch6: { metal: 'mist', armor: 'mist' },
};
const ARMOR = {
  leather: { head: 'arm_leather_hood', chest: 'arm_leather_vest', legs: 'arm_leather_pants' },
  iron: { head: 'arm_iron_helm', chest: 'arm_iron_cuirass', legs: 'arm_iron_greaves' },
  mist: { head: 'arm_mist_helm', chest: 'arm_mist_cuirass', legs: 'arm_mist_greaves' },
};
const SPEED = 4.5; // 걷기 m/s(길 돌아가기 포함 어림)
// v3.2: 길잡이 돌·탈것을 쓰는가(CAMP_TRAVEL=old면 v3.1처럼 걷기만)
const V32 = process.env.CAMP_TRAVEL !== 'old';
// 길잡이 돌을 쓰려면 아끼는 시간이 이만큼(초) 넘어야 한다(걷기를 즐기는 사람은 크게)
const FT_MIN = { persona_sol: 90, persona_moru: 20, persona_harang: 20, persona_saebyeok: 150, persona_mujin: 30, persona_ren: 20, persona_kongi: 40 };
// 탈것을 사는 여윳돈(값의 몇 배가 있어야 사나)
const MOUNT_SPARE = { persona_sol: 1.6, persona_moru: 1.2, persona_harang: 1.1, persona_saebyeok: 1.5, persona_mujin: 1.2, persona_ren: 1.1, persona_kongi: 2.0 };

export function runCampaign(data, pid, { seed }) {
  const prof = data.agents[pid];
  const play = PLAY[pid];
  const g = createGame({ data, seed, actors: [{ id: 'p1', kind: 'player', name: prof.name }] });
  g.state.econ = null;
  const C = g._ctx;
  const st = g.state;
  const a = st.actors.p1;
  a.ai = { on: true, profile: 'campaign', manual: true, mem: {} };
  const T = { life: 0, travel: 0, fight: 0, grind: 0, rest: 0, wait: 0 }; // 초
  const chapters = [];
  const fails = [];
  const hard = []; // 쓰러짐이 난 퀘스트
  let lastWhy = null;
  let curQ = '-';
  let cur = null;
  const fightLog = { kills: 0, downs: 0, dealt: 0, taken: 0 };
  g.on('combat.hurt', (ev) => { if (ev.actor === 'p1') fightLog.taken += ev.dmg; });
  g.on('mob.die', (ev) => { if (ev.actor === 'p1') fightLog.kills++; });
  g.on('actor.down', (ev) => { if (ev.actor === 'p1') fightLog.downs++; });

  const TR = { ft: 0, ftSilver: 0, mounts: [], rideM: 0, walkM: 0, upWay: 0, up: 0, upSaved: 0 };
  let downAt = null;
  g.on('actor.down', (e) => { if (e.actor === 'p1') downAt = { x: e.x, z: e.z }; });
  g.on('actor.up', (e) => {
    if (e.actor !== 'p1' || !downAt) return;
    TR.up++;
    // 들판 쉼터 돌에서 일어났으면, 마을 창고까지보다 덜 걷는 거리
    if (e.way && !data.waystones[e.way].at) {
      TR.upWay++;
      const s = st.settlements[e.settlement];
      const sto = s.stations.find((x) => x.type === 'storage') || s;
      TR.upSaved += Math.max(0, Math.hypot(sto.x + 2.2 - downAt.x, sto.z - downAt.z) - Math.hypot(a.x - downAt.x, a.z - downAt.z));
    }
  });
  // 걸어서 지나가는 길목(30m 안)의 길잡이 돌은 길을 익힌다
  function attuneAlong(x0, z0, x1, z1) {
    const L2 = (x1 - x0) ** 2 + (z1 - z0) ** 2 || 1;
    for (const w of data.lists.waystones) {
      if (a.ways[w.id] != null) continue;
      const o = wayStatic(C, w.id);
      if (!o) continue;
      const k = Math.max(0, Math.min(1, ((o.x - x0) * (x1 - x0) + (o.z - z0) * (z1 - z0)) / L2));
      if (Math.hypot(o.x - (x0 + (x1 - x0) * k), o.z - (z0 + (z1 - z0) * k)) <= 30) a.ways[w.id] = Math.round(st.t);
    }
  }
  // 이 거리를 가는 데 드는 시간(탈 수 있으면 25m 넘을 때 탄다: 부르기 1.5초)
  const moveSec = (d) => {
    if (V32 && a.riding === null && mountsOf(a).pick && d > 25) {
      a.riding = mountsOf(a).pick;
      const v = SPEED * mountSpeed(C, a);
      a.riding = null;
      TR.rideM += d;
      return d / v + C.cfg.mount.summonSec;
    }
    TR.walkM += d;
    return d / SPEED;
  };
  const warpTo = (x, z, why = 'travel') => {
    const d = Math.hypot(x - a.x, z - a.z);
    let sec = moveSec(d);
    let ft = null;
    if (V32 && d > 60) {
      // 빠른 이동: 가장 가까운 익힌 돌까지 가서 → 목적지에서 가장 가까운 익힌 돌로
      const same = regionAt(data.lists.regions, a.x).id;
      const known = data.lists.waystones.filter((w) => a.ways[w.id] != null && (same === 'wreck_coast') === (w.region === 'wreck_coast')).map((w) => ({ w, o: wayStatic(C, w.id) }));
      const near = (px, pz) => known.reduce((b, k) => (!b || Math.hypot(k.o.x - px, k.o.z - pz) < Math.hypot(b.o.x - px, b.o.z - pz) ? k : b), null);
      const s0 = near(a.x, a.z);
      const s1 = near(x, z);
      if (s0 && s1 && s0 !== s1) {
        const d0 = Math.hypot(s0.o.x - a.x, s0.o.z - a.z);
        const d1 = Math.hypot(x - s1.o.x, z - s1.o.z);
        const fsec = d0 / SPEED + C.cfg.fastTravel.castSec + d1 / SPEED;
        // 값은 돌 앞에 섰을 때로 잰다
        const ox = a.x;
        const oz = a.z;
        Object.assign(a, { x: s0.o.x, z: s0.o.z });
        const cost = travelCost(C, a, s1.w.id);
        Object.assign(a, { x: ox, z: oz });
        if (sec - fsec >= FT_MIN[pid] && a.silver >= cost + 50) ft = { fsec, cost, s0, s1 };
      }
    }
    if (ft) {
      sec = ft.fsec;
      a.silver -= ft.cost;
      TR.ft++;
      TR.ftSilver += ft.cost;
    } else attuneAlong(a.x, a.z, x, z);
    T[why] += sec;
    Object.assign(a, { x, z, move: null, dest: null, nav: null });
  };
  // 마을에 들를 때: 탈것을 살 만하면 산다(조랑말 → 갈기 말 → 서리 산양)
  function buyMountMaybe() {
    if (!V32 || !isUnlocked(C, a, 'mount')) return;
    for (const id of ['goat', 'horse', 'pony']) {
      const m = data.mounts[id];
      if (mountsOf(a).own.includes(id)) return; // 더 좋은 걸 이미 있다
      if (m.need?.quest && a.quests.done[m.need.quest] == null) continue;
      if (a.silver < m.price * MOUNT_SPARE[pid]) continue;
      a.silver -= m.price;
      gainMount(C, a, id);
      mountsOf(a).pick = id;
      TR.mounts.push({ id, ch: chNow, lv: a.clevel.lvl });
      T.life += 60;
      return;
    }
  }
  const adv = (sec, why) => {
    g.advance(sec);
    if (why) T[why] += sec;
  };
  // 장비: 손재주(quality)가 높을수록 별이 높다
  const score = (ch) => Math.round(38 + prof.quality * 7 + Number(ch.slice(2)) * 3);
  function gearItem(id, sc) {
    const def = data.items[id];
    const scores = Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, sc]));
    const stats = convertStats(def.statConvert, scores);
    return { uid: `${id}_${sc}_${chapters.length}`, item: id, stats, scores, star: starOf(sc, data.config.stars), masterwork: false, crafter: 'p1', dur: stats.durability ?? null, maxDur: stats.durability ?? null, broken: false };
  }
  function equip(ch, over = null) {
    const G = { ...GEAR[ch], ...over };
    const sc = score(ch);
    const wid = `wpn_${WEAPON[prof.weapon] || 'sword'}_${G.metal}`;
    const w = gearItem(wid, sc);
    a.bag.push(w);
    g.dispatch({ type: 'EQUIP', actor: 'p1', uid: w.uid });
    if (G.armor) {
      for (const id of Object.values(ARMOR[G.armor])) {
        const e = gearItem(id, sc);
        a.bag.push(e);
        g.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid });
      }
    }
    // 들고 다니는 회복거리: 장마다 음식 4, 2장부터 회복 물약 3
    const meat = data.items.food_meat;
    a.bag.push({ item: 'food_meat', lot: null, bonus: null, qty: 4, stats: convertStats(meat.statConvert, Object.fromEntries(Object.keys(meat.statConvert).map((k) => [k, sc]))), star: 2 });
    if (ch !== 'ch1') {
      const ph = data.items.potion_heal;
      a.bag.push({ item: 'potion_heal', lot: null, bonus: null, qty: 3, stats: convertStats(ph.statConvert, { power: sc }), star: 2 });
    }
    // 가방이 넘치지 않게: 안 쓰는 장비는 버린다
    const worn = new Set(Object.values(a.equip).filter(Boolean));
    a.bag = a.bag.filter((e) => !e.uid || worn.has(e.uid));
  }
  // 마을에서 회복거리를 채워 온다(음식 4, 2장부터 물약 3까지). 채우는 데 1분
  let chNow = 'ch1';
  function restock() {
    buyMountMaybe();
    const sc = score(chNow);
    const have = (id) => a.bag.filter((e) => e.item === id).reduce((s, e) => s + e.qty, 0);
    const meat = data.items.food_meat;
    const nm = 4 - have('food_meat');
    if (nm > 0) a.bag.push({ item: 'food_meat', lot: null, bonus: null, qty: nm, stats: convertStats(meat.statConvert, Object.fromEntries(Object.keys(meat.statConvert).map((k) => [k, sc]))), star: 2 });
    const np = chNow === 'ch1' ? 0 : 3 - have('potion_heal');
    if (np > 0) {
      const ph = data.items.potion_heal;
      a.bag.push({ item: 'potion_heal', lot: null, bonus: null, qty: np, stats: convertStats(ph.statConvert, { power: sc }), star: 2 });
    }
    if (nm > 0 || np > 0) T.life += 60;
    // 대장간에서 고친다(내구 절반 아래면). 고친 횟수는 후기에 쓴다
    for (const uid of Object.values(a.equip).filter(Boolean)) {
      const e = a.bag.find((x) => x.uid === uid);
      if (e && e.maxDur && (e.broken || e.dur < e.maxDur * 0.5)) {
        if (e.broken) fightLog.broken = (fightLog.broken || 0) + 1;
        e.dur = e.maxDur;
        e.broken = false;
        fightLog.repairs = (fightLog.repairs || 0) + 1;
        T.life += 20;
      }
    }
    // 퀘스트로 받은 잡동사니는 창고에 둔 셈 친다
    a.bag = a.bag.filter((e) => e.uid || ['food_meat', 'potion_heal'].includes(e.item) || data.quests && Object.values(a.quests.active).length === 0 || data.items[e.item].kind === 'consumable');
  }
  // 능력치 점수: 무기 주 능력치 6, 체질 4
  function spend() {
    const free = (a.clevel.lvl - 1) - Object.values(a.clevel.attrs).reduce((s, v) => s + v, 0);
    if (free <= 0) return;
    const w = data.items[st.actors.p1.bag.find((e) => e.uid === a.equip.weapon)?.item];
    const sc = data.config.level.scaling[masteryOf(C, w?.weapon?.type)] || ['str'];
    const main = Math.ceil(free * 0.6);
    if (main) g.dispatch({ type: 'ATTR_SPEND', actor: 'p1', attr: sc[0], n: main });
    if (free - main) g.dispatch({ type: 'ATTR_SPEND', actor: 'p1', attr: 'con', n: free - main });
  }
  // 쉬기: 싸움 밖에서 체력이 찰 때까지
  function rest() {
    for (let k = 0; k < 60 && a.cb.hp < a.cb.maxHp * 0.95; k++) adv(2, 'rest');
  }
  // 한 마리와 싸운다. 돌려주는 값: 'win' | 'down' | 'timeout'
  // 끌어내기: 무리 가운데에서 바깥쪽으로, 실력(read)만큼 멀리 서서 한 마리씩 끈다
  function pullSpot(m) {
    const gr = st.mobGroups[m.group];
    const cx = gr ? gr.x : m.x - 1;
    const cz = gr ? gr.z : m.z;
    let dx = m.x - cx;
    let dz = m.z - cz;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const d = 5 + 7 * (prof.read ?? 0.45);
    for (let k = 0; k < 8; k++) {
      const ang = Math.atan2(dx, dz) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const x = m.x + Math.sin(ang) * d;
      const z = m.z + Math.cos(ang) * d;
      if (C.terrain.walkable(x, z)) return [x, z];
    }
    return [m.x + 4, m.z];
  }
  function fightOne(m, here = false) {
    if (!here) {
      const [x, z] = pullSpot(m);
      warpTo(x, z);
    }
    const hpStart = Math.round(a.cb.hp);
    startFight(a, m.id, { read: prof.read ?? 0.45, block: prof.block ?? 0.3, heal: 0.4 });
    const downs0 = fightLog.downs;
    let crowd = 0;
    for (let k = 0; k < 900; k++) {
      adv(0.1, 'fight');
      if (process.env.CAMP_DEBUG && k % 10 === 0) crowd = Math.max(crowd, Object.values(st.mobs).filter((x) => isAlive(x) && x.target === 'p1').length);
      if (fightLog.downs > downs0) {
        if (process.env.CAMP_DEBUG) console.log(`    쓰러짐[${curQ}]: ${data.creatures[m.type].name} Lv${data.creatures[m.type].level} 남은 ${Math.round(m.hp)} · 덤빈 수 ${crowd} · 시작 체력 ${hpStart} · 내 Lv${a.clevel.lvl} 최대체력 ${a.cb.maxHp} · 가방 ${a.bag.filter((e) => !e.uid).map((e) => e.item + e.qty).join(',')} · 장비 ${Object.values(a.equip).filter(Boolean).length} 무기내구 ${a.bag.find((e) => e.uid === a.equip.weapon)?.dur}`);
        stopFight(a);
        // 쓰러지면 마을에서 일어나 다시 걸어온다
        adv(data.config.combat.downSec + 1, 'rest');
        rest(); // 돌아가는 길은 부르는 쪽(warpTo)이 센다
        return 'down';
      }
      if (!isAlive(m)) {
        // 남은 놈이 덤비면 그놈도
        const f = a.ai.mem.fight;
        if (!f || !Object.values(st.mobs).some((x) => isAlive(x) && x.target === 'p1')) {
          stopFight(a);
          return 'win';
        }
      }
    }
    stopFight(a);
    return 'timeout';
  }
  // 나를 노리는 짐승이 있으면 먼저 정리한다(걸어가다 붙는 놈들)
  function clearThreats(depth = 0) {
    for (let k = 0; k < 12; k++) {
      const m = Object.values(st.mobs).filter((x) => isAlive(x) && x.target === 'p1')
        .sort((u, v) => Math.hypot(u.x - a.x, u.z - a.z) - Math.hypot(v.x - a.x, v.z - a.z))[0];
      if (!m || depth > 0) return;
      const r = fightOne(m, true);
      if (r === 'down') return;
    }
  }
  const islandOf = (x) => regionAt(data.lists.regions, x).island || regionAt(data.lists.regions, x).id;
  const near = (types, at = null, r = 40) => Object.values(st.mobs)
    .filter((x) => isAlive(x) && x.mode !== 'away' && types.includes(x.type) && islandOf(x.x) === islandOf(a.x) && (!at || Math.hypot(x.x - at.x, x.z - at.z) < at.r + r))
    .sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0];
  // 레벨 올리기: 지금 섬에서 내 레벨 −4~+1 짐승을 minutes만큼 사냥
  function grind(minutes, why = 'grind') {
    const region = regionAt(data.lists.regions, a.x).id;
    const until = T[why] + minutes * 60;
    let guard = 0;
    while (T[why] < until && guard++ < 200) {
      const lv = a.clevel.lvl;
      // 사냥감: 야영지·두목 말고, 내 레벨보다 조금 낮은(−6~0) 짐승. 무리가 크면 레벨이 더 낮아야 한다
      const pool = data.lists.creatures.filter((c) => !c.boss && (c.level ?? 1) <= lv && (c.level ?? 1) >= lv - 6).map((c) => c.id);
      const mates = (x) => (st.mobGroups[x.group]?.mobs || []).filter((id) => isAlive(st.mobs[id])).length;
      const m = Object.values(st.mobs).filter((x) => isAlive(x) && pool.includes(x.type) && regionAt(data.lists.regions, x.x).id === region && !st.mobGroups[x.group]?.site && (mates(x) <= 2 || (data.creatures[x.type].level ?? 1) <= lv - 3))
        .sort((p, q) => (data.creatures[q.type].level ?? 1) - (data.creatures[p.type].level ?? 1) || Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0];
      if (!m) {
        adv(20, why);
        continue;
      }
      if (guard % 5 === 1) restock();
      const t0 = T.fight;
      const r = fightOne(m);
      T[why] += T.fight - t0;
      T.fight = t0;
      rest(); // 이기든 지든 숨을 고르고 다음 놈
      spend();
    }
  }

  // 퀘스트 한 단계를 해낸다. 돌려주는 값: true(넘어감) / false(막힘)
  function doStep(id) {
    for (let k = 0; k < 120 && a.cb.downUntil > 0; k++) adv(1, 'rest'); // 쓰러졌으면 일어날 때까지
    clearThreats();
    const r0 = doStep0(id);
    clearThreats();
    return r0;
  }
  function doStep0(id) {
    const q = data.quests[id];
    const p = a.quests.active[id];
    const step = q.steps[p.step];
    const give = (item, n) => a.bag.push({ item, lot: null, bonus: null, qty: n });
    if (step.type === 'talk' || step.type === 'faction') {
      const who = step.type === 'faction' ? 'gangdu_port' : stepNpc(C, a, step);
      const n = npcPos(C, who);
      if (!n) { lastWhy = `no_npc:${who}`; return false; }
      warpTo(n.x + 1.2, n.z);
      if (step.take) for (const [item, k] of Object.entries(step.take)) {
        give(item, k);
        T.life += k * 8;
      }
      const r = step.type === 'faction' ? g.dispatch({ type: 'FACTION_JOIN', actor: 'p1', faction: 'fleet' }) : g.dispatch({ type: 'TALK', actor: 'p1', npc: who });
      T.life += 6;
      if (step.type === 'faction' && r.error === 'same_faction') { adv(1.1); return true; } // 이미 고른 세력
      if (!r.ok) lastWhy = `${step.type}:${r.error}`;
      return r.ok;
    }
    if (step.type === 'go') {
      const s = sitePos(C, step.site);
      warpTo(s.x, s.z);
      adv(1.1);
      clearThreats();
      adv(1.1);
      return true;
    }
    if (step.type === 'use') {
      const o = step.objs.find((x) => !p.used.includes(x));
      const pos = objPos(C, o);
      warpTo(pos.x + 1, pos.z);
      let r = g.dispatch({ type: 'QUEST_USE', actor: 'p1', obj: o });
      for (let k = 0; !r.ok && k < 4; k++) {
        lastWhy = r.error;
        clearThreats();
        adv(2);
        warpTo(pos.x + 1, pos.z);
        r = g.dispatch({ type: 'QUEST_USE', actor: 'p1', obj: o });
      }
      if (data.objects[o].cross && r.ok) g.dispatch({ type: 'RECALL', actor: 'p1' });
      adv(12);
      return r.ok;
    }
    if (step.type === 'have') {
      if (step.need) for (const [item, k] of Object.entries(step.need)) {
        give(item, k);
        T.life += k * 10;
      } else {
        const item = step.any[0];
        if (data.items[item].kind === 'equipment') {
          const e = gearItem(item, 40);
          a.bag.push(e);
          if (step.equip) g.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid });
        } else give(item, step.count || 1);
        T.life += 40;
      }
      adv(1.1);
      return true;
    }
    if (step.type === 'kill') {
      const s = step.site ? sitePos(C, step.site) : null;
      let downs = 0;
      const s0 = p.step;
      const same = () => a.quests.active[id] && a.quests.active[id].step === s0;
      let outs = 0;
      while (same() && downs < 6 && outs < 6) {
        // 야영지·정박지라면 둘레 졸개부터 한 놈씩 끌어내 정리한다
        if (s) {
          const top = Math.max(...step.mobs.map((k) => data.creatures[k].level ?? 1));
          const extra = Object.values(st.mobs).filter((x) => isAlive(x) && !step.mobs.includes(x.type) && !data.creatures[x.type].boss && (data.creatures[x.type].level ?? 1) <= top && Math.hypot(x.x - s.x, x.z - s.z) < s.r + 12)
            .sort((u, v) => Math.hypot(u.x - a.x, u.z - a.z) - Math.hypot(v.x - a.x, v.z - a.z))[0];
          if (extra) {
            const r = fightOne(extra);
            spend();
            if (r === 'down') downs++;
            else rest();
            continue;
          }
        }
        let m = near(step.mobs, s);
        // 밤에만 나오는 무리(안개 늑대)면 밤까지 기다린다
        const night = step.mobs.some((k) => data.creatures[k].night);
        for (let k = 0; !m && k < (night ? 480 : 120); k++) {
          adv(10, 'wait'); // 짐승이 다시 나오기(밤)를 기다린다
          m = near(step.mobs, s) || (k > 30 ? near(step.mobs) : null);
        }
        if (!m) lastWhy = 'no_mob';
        if (!m) return false;
        const r = fightOne(m);
        spend();
        if (r === 'timeout' && ++outs >= 6) lastWhy = 'timeout';
        if (r === 'down') {
          downs++;
          // 두 번 넘게 쓰러지면 레벨을 올리고 온다
          if (downs >= 2) grind(6);
        } else rest();
      }
      if (downs) hard.push({ quest: id, name: q.name, level: q.level || 0, mine: a.clevel.lvl, downs });
      return !same();
    }
    if (step.type === 'defend') {
      const s = sitePos(C, step.site);
      warpTo(s.x, s.z);
      let downs = 0;
      const s0 = p.step;
      const same = () => a.quests.active[id] && a.quests.active[id].step === s0;
      for (let k = 0; k < 3000 && same(); k++) {
        const m = Object.values(st.mobs).filter((x) => isAlive(x) && Math.hypot(x.x - s.x, x.z - s.z) < s.r + 30)
          .sort((u, v) => Math.hypot(u.x - a.x, u.z - a.z) - Math.hypot(v.x - a.x, v.z - a.z))[0];
        if (!m) {
          adv(1, 'fight');
          continue;
        }
        const r = fightOne(m, true);
        if (r === 'down') {
          downs++;
          warpTo(s.x, s.z);
          if (downs >= 4) break;
        }
      }
      if (downs) hard.push({ quest: id, name: q.name, level: q.level || 0, mine: a.clevel.lvl, downs });
      return !same();
    }
    if (step.type === 'eat') {
      const e = a.bag.find((x) => data.items[x.item].kind === 'consumable');
      return !!e && g.dispatch({ type: 'EAT', actor: 'p1', key: keyOf(e) }).ok;
    }
    if (step.type === 'store' || step.type === 'sell' || step.type === 'repair' || step.type === 'project') {
      // 생활 단계: 해낸 셈 치고 넘긴다(그 기능이 되는지는 테스트가 본다)
      T.life += 90;
      p.step++;
      if (p.step >= q.steps.length) {
        p.step--;
        return forceDone(id);
      }
      return true;
    }
    return false;
  }
  function forceDone(id) {
    // 생활 단계로 끝나는 퀘스트: 단계를 다 채운 셈 치고 끝낸다(코어 함수로)
    const q = data.quests[id];
    const p = a.quests.active[id];
    p.step = q.steps.length - 1;
    const last = q.steps[p.step];
    if (last.type === 'talk') return doStep(id);
    delete a.quests.active[id];
    a.quests.done[id] = st.t;
    return true;
  }
  function runQuest(id) {
    restock();
    curQ = data.quests[id].name;
    let guard = 0;
    const lv0 = a.clevel.lvl;
    while (a.quests.active[id] && guard++ < 40) {
      if (!doStep(id)) {
        fails.push({ quest: id, name: data.quests[id].name, step: a.quests.active[id]?.step, level: data.quests[id].level || 0, mine: a.clevel.lvl, why: lastWhy });
        lastWhy = null;
        return false;
      }
    }
    if (cur) cur.quests.push({ id, level: data.quests[id].level || 0, at: lv0 });
    // 등대를 지켜라 보상(철 주괴 3)으로 두목 앞에서 철 무기를 벼린다
    if (id === 'q7_raid' && !a.quests.active[id]) equip('ch1', { metal: 'iron', armor: null });
    return !a.quests.active[id];
  }
  // 받을 수 있는 서브퀘스트를 (성향만큼) 받아 한다
  let sideSeen = new Set();
  function sideQuests() {
    for (const q of data.lists.quests) {
      if (q.kind !== 'side' || q.repeat || q.bond || sideSeen.has(q.id)) continue;
      if (a.quests.done[q.id] || a.quests.active[q.id] || !available(C, a, q)) continue;
      sideSeen.add(q.id);
      if (C.rng.next() > play.side) continue;
      if (q.faction && q.faction !== a.faction?.id) continue;
      const n = q.giver && q.giver !== 'board' ? npcPos(C, q.giver) : null;
      if (!n) continue;
      if (regionAt(data.lists.regions, n.x).island !== regionAt(data.lists.regions, a.x).island) continue;
      warpTo(n.x + 1.2, n.z);
      if (!g.dispatch({ type: 'QUEST_ACCEPT', actor: 'p1', quest: q.id }).ok) continue;
      // 너무 어려우면(권장 +5 이상) 사냥으로 레벨을 조금 올리고 간다
      if ((q.level || 0) - a.clevel.lvl >= 5) grind(5);
      runQuest(q.id);
    }
  }

  const xp0 = () => a.clevel.lvl + a.clevel.xp / Math.max(1, data.config.level.xpBase * Math.pow(a.clevel.lvl, data.config.level.xpPow));
  for (const ch of data.chapters) {
    chNow = ch.id;
    equip(ch.id);
    spend();
    cur = { id: ch.id, name: ch.name, start: Math.round(xp0() * 10) / 10, quests: [], downs: fightLog.downs, time: { ...T } };
    let guard = 0;
    for (const qid of ch.quests) {
      while (!a.quests.active[qid] && !a.quests.done[qid] && guard++ < 50) adv(2);
      if (!a.quests.active[qid]) continue;
      // 메인을 받으면 서브퀘스트를 먼저 둘러본다
      sideQuests();
      const q = data.quests[qid];
      // 권장 레벨 색이 주황(+3) 이상이면 노랑이 될 때까지 사냥한다(최대 30분)
      for (let k = 0; k < 6 && (q.level || 0) - a.clevel.lvl >= 3; k++) grind(5);
      if (!runQuest(qid)) break;
    }
    sideQuests();
    grind(play.grind);
    const tt = (k) => Math.round((T[k] - cur.time[k]) / 60);
    chapters.push({
      id: ch.id, name: ch.name, start: cur.start, end: Math.round(xp0() * 10) / 10,
      mainLevels: ch.quests.map((qid) => data.quests[qid].level || 0),
      quests: cur.quests.length, downs: fightLog.downs - cur.downs,
      minutes: { fight: tt('fight'), grind: tt('grind'), travel: tt('travel'), life: tt('life'), rest: tt('rest'), wait: tt('wait') },
    });
    if (fails.length && fails.at(-1).quest && data.quests[fails.at(-1).quest].kind === 'main') break;
  }
  const doneSide = Object.keys(a.quests.done).filter((id) => data.quests[id]?.kind === 'side').length;
  return {
    id: pid, name: prof.name, role: prof.role, grade: prof.grade, weapon: prof.weapon, read: prof.read, block: prof.block, quality: prof.quality,
    level: a.clevel.lvl, chapters, fails, hard, kills: fightLog.kills, downs: fightLog.downs, taken: Math.round(fightLog.taken),
    side: doneSide, repairs: fightLog.repairs || 0, broken: fightLog.broken || 0, hours: Math.round(Object.values(T).reduce((s, v) => s + v, 0) / 360) / 10,
    time: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Math.round(v / 60)])),
    travel: { ft: TR.ft, ftSilver: TR.ftSilver, mounts: TR.mounts, rideKm: Math.round(TR.rideM / 100) / 10, walkKm: Math.round(TR.walkM / 100) / 10, ways: Object.keys(a.ways).length, silver: Math.round(a.silver), up: TR.up, upWay: TR.upWay, upSavedM: Math.round(TR.upSaved) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = await loadData();
  const ids = Object.keys(data.agents).filter((k) => data.agents[k].persona && PLAY[k] && (!args.only || data.agents[k].name === args.only));
  const out = [];
  for (const pid of ids) {
    const t0 = Date.now();
    const r = runCampaign(data, pid, { seed: args.seed });
    out.push(r);
    if (args.json) continue;
    console.log(`\n[${r.name} · ${r.role} · ${r.grade}] ${Math.round((Date.now() - t0) / 1000)}초 · 레벨 ${r.level} · 어림 ${r.hours}시간 · 처치 ${r.kills} · 쓰러짐 ${r.downs} · 서브 ${r.side} · 수리 ${r.repairs}(부서진 채 ${r.broken})`);
    for (const c of r.chapters) console.log(`  ${c.id} ${c.name}: Lv ${c.start} → ${c.end} (메인 권장 ${c.mainLevels[0]}~${c.mainLevels.at(-1)}) · 퀘스트 ${c.quests} · 쓰러짐 ${c.downs} · 분 ${JSON.stringify(c.minutes)}`);
    const tv = r.travel;
    console.log(`  이동 ${r.time.travel}분(${Math.round((r.time.travel / Object.values(r.time).reduce((s, v) => s + v, 0)) * 100)}%) · 길잡이 돌 ${tv.ft}번 🪙${tv.ftSilver} · 익힌 돌 ${tv.ways} · 탈것 ${tv.mounts.map((m) => `${data.mounts[m.id].name}(${m.ch} Lv${m.lv})`).join('→') || '없음'} · 탄 거리 ${tv.rideKm}km 걸은 거리 ${tv.walkKm}km · 남은 은화 ${tv.silver}`);
    if (r.hard.length) console.log('  쓰러짐 난 곳:', r.hard.map((h) => `${h.name}(권장 ${h.level}/내 ${h.mine}) ×${h.downs}`).join(', '));
    if (r.fails.length) console.log('  막힘:', r.fails.map((f) => `${f.name}(권장 ${f.level}/내 ${f.mine}) ${f.step}단계 ${f.why || ''}`).join(', '));
  }
  if (args.json) console.log(JSON.stringify(out, null, 1));
}
