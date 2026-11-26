// 페르소나 자동 플레이 (3단계).
//   node tools/personas.js --days 7 --seed 2026 [--json]
// 페르소나마다 같은 섬(같은 시드)에서 혼자 게임 N일을 산다. 사람 플레이가 아니다.
// 성향·실력 값은 data/agents.json의 persona 항목에 있다. 결과 수치를 근거로 후기를 쓴다.

import { performance } from 'node:perf_hooks';
import { loadData } from './load-data.js';
import { createGame } from '../core/game.js';
import { bestTool, settlementAt } from '../core/world.js';
import { ordersOf } from '../core/market.js';
import { fmtPlay } from '../core/clock.js';
const GN = ['일반', '고급', '희귀', '영웅', '전설']; // 등급(v3.3)
import { avgProps } from '../core/inventory.js';

function parseArgs(argv) {
  const out = { days: 7, seed: 2026, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i].startsWith('--')) out[argv[i].slice(2)] = Number(argv[++i]);
  }
  return out;
}

export function runPersona(data, prof, { days, seed }) {
  const game = createGame({ data, seed, actors: [{ id: 'b1', name: prof.name, kind: 'bot', ai: prof.id }] });
  const a = game.state.actors.b1;
  const time = { gather: 0, move: 0, wait: 0, idle: 0, fight: 0 };
  const fight = { swings: 0, hits: 0, hurt: 0, evaded: 0, blocked: 0, downs: [], skins: 0, gearCraft: {}, repairs: {} };
  game.on('combat.swing', (ev) => { if (ev.actor === 'b1') fight.swings++; });
  game.on('combat.hit', (ev) => { if (ev.actor === 'b1') fight.hits++; });
  game.on('combat.hurt', (ev) => { if (ev.actor === 'b1') fight.hurt++; });
  game.on('actor.down', (ev) => { if (ev.actor === 'b1') fight.downs.push(ev.species); });
  game.on('skin.done', (ev) => { if (ev.actor === 'b1') fight.skins++; });
  game.on('craft.done', (ev) => {
    if (ev.actor !== 'b1') return;
    const def = data.items[ev.item];
    if (def.weapon || def.armor) fight.gearCraft[ev.item] = (fight.gearCraft[ev.item] || 0) + 1;
  });
  game.on('repair', (ev) => {
    if (ev.actor !== 'b1') return;
    const def = data.items[ev.item];
    const k = def.weapon ? 'weapon' : def.armor ? 'armor' : 'tool';
    fight.repairs[k] = (fight.repairs[k] || 0) + 1;
  });
  const fails = {};
  const rejects = {};
  let blocked = 0;
  let recalls = 0;
  let dist = 0;
  const lots = new Set();
  const rotLots = new Set();
  let rotGathers = 0;
  let gathers = 0;
  const toolStars = [];
  game.on('gather.failed', (ev) => { fails[ev.reason] = (fails[ev.reason] || 0) + 1; });
  game.on('cmd.rejected', (ev) => { rejects[ev.reason] = (rejects[ev.reason] || 0) + 1; });
  game.on('move.blocked', () => { blocked++; });
  game.on('recall.done', () => { recalls++; });
  // v0.4 정착지: 어느 마을에 몇 번 들렀나, 운송·사업
  const visits = {};
  let inTown = null;
  const settle = { ship: 0, shipFee: 0, contrib: 0, contribSilver: 0, projects: [] };
  game.on('ship', (ev) => { if (ev.actor === 'b1') { settle.ship++; settle.shipFee += ev.fee; } });
  game.on('project.contrib', (ev) => { if (ev.owner === 'b1') { settle.contrib += ev.points; settle.contribSilver += ev.silver || 0; } });
  game.on('project.done', (ev) => { settle.projects.push({ id: ev.project, day: Math.floor(game.state.t / data.config.time.secondsPerGameDay) + 1 }); });
  const money = { orders: 0, ordersQty: 0, ordersN: 0, sold: 0, soldQty: 0, spent: 0, boughtQty: 0, npc: 0, npcQty: 0, deliveredStars: [] };
  game.on('order.delivered', (ev) => {
    if (ev.owner !== 'b1') return;
    money.orders += ev.pay;
    money.ordersQty += ev.qty;
    money.ordersN++;
  });
  game.on('market.trade', (ev) => {
    if (ev.seller === 'b1') { money.sold += ev.qty * ev.price; money.soldQty += ev.qty; }
    if (ev.buyer === 'b1') { money.spent += ev.qty * ev.price; money.boughtQty += ev.qty; }
  });
  game.on('repair', (ev) => {
    if (ev.actor !== 'b1') return;
    money.repairs = (money.repairs || 0) + 1;
    money.repairSpent = (money.repairSpent || 0) + ev.cost;
  });
  game.on('market.npc', (ev) => {
    if (ev.owner !== 'b1') return;
    money.npc += ev.qty * ev.price;
    money.npcQty += ev.qty;
  });
  game.on('gather.done', (ev) => {
    gathers++;
    lots.add(ev.lot);
    const lot = game.state.lots[ev.lot];
    const vein = lot && game.state.veins[lot.vein];
    if (vein && !vein.common) {
      rotGathers++;
      rotLots.add(ev.lot);
    }
  });
  // 등급(v3.3): 만든 것마다 등급(별 1~5 → 일반~전설)을 센다
  // v3.3.1: 장비와 그 밖(음식 등)을 나눠 센다. 장비는 레시피보다 몇 레벨 위에서 만들었는지(diff)도 남긴다.
  const gradeN = [0, 0, 0, 0, 0];
  const gearN = [0, 0, 0, 0, 0];
  const gearLog = [];
  game.on('craft.done', (ev) => {
    if (data.items[ev.item].tool) toolStars.push({ t: game.state.t, item: ev.item, star: ev.star, mw: ev.masterwork });
    if (ev.actor !== 'b1' || !ev.star) return;
    gradeN[ev.star - 1] += ev.qty || 1;
    if (data.items[ev.item].kind === 'equipment') {
      gearN[ev.star - 1]++;
      const r = data.recipes[ev.recipe];
      gearLog.push({ day: Math.floor(game.state.t / data.config.time.secondsPerGameDay) + 1, item: ev.item, diff: r ? a.skills[r.skill].level - r.level : null, star: ev.star });
    }
  });

  const total = days * data.config.time.secondsPerGameDay;
  let px = a.x;
  let pz = a.z;
  const t0 = performance.now();
  for (let s = 0; s < total; s++) {
    game.advance(1);
    if (a.ai.mem.fight || a.cb.act || a.cb.downUntil > 0) time.fight++;
    else if (a.action) time.gather++;
    else if (a.dest || a.move) time.move++;
    else if (a.queue.length) time.wait++;
    else time.idle++;
    dist += Math.hypot(a.x - px, a.z - pz);
    px = a.x;
    pz = a.z;
    const here = settlementAt({ state: game.state }, a)?.id ?? null;
    if (here && here !== inTown) visits[here] = (visits[here] || 0) + 1;
    inTown = here;
  }
  const ms = performance.now() - t0;

  const tools = {};
  for (const skill of prof.skills) {
    const t = bestTool({ state: game.state, data }, a, skill);
    tools[skill] = t ? { item: t.item, star: t.star, speed: t.stats.gatherSpeed, yield: t.stats.yield ?? 0 } : null;
  }
  const m = a.milestones;
  const pct = (v) => Math.round((v / total) * 1000) / 10;
  return {
    id: prof.id, name: prof.name, role: prof.role, grade: prof.grade,
    ms: Math.round(ms),
    firsts: { stoneTool: m.tool_t0 ?? null, copperTool: m.tool_t1 ?? null, food: m.first_food ?? null, masterwork: m.first_masterwork ?? null },
    reach: Object.fromEntries(['logging', 'mining', 'harvesting'].map((s) => [s, { 10: m[`${s}_10`] ?? null, 20: m[`${s}_20`] ?? null, 30: m[`${s}_30`] ?? null }])),
    skinBy: a.stats.skin,
    fight: { ...fight, kills: a.stats.kills, dmgDealt: Math.round(a.stats.dmgDealt), dmgTaken: Math.round(a.stats.dmgTaken), evaded: a.stats.evaded || 0, blockedHits: a.stats.blocked || 0,
      equip: Object.fromEntries(Object.entries(a.equip).map(([k, uid]) => { const e = a.bag.find((x) => x.uid === uid); return [k, e ? `${e.item}[${GN[(e.star || 1) - 1]}]` : null]; })) },
    levels: Object.fromEntries(Object.entries(a.skills).filter(([, s]) => s.xp > 0).map(([k, s]) => [k, s.level])),
    time: { gather: pct(time.gather), move: pct(time.move), wait: pct(time.wait), idle: pct(time.idle), fight: pct(time.fight) },
    distKm: Math.round(dist / 100) / 10,
    gathers, gathersPerHour: Math.round(gathers / days),
    crafts: a.stats.craft, eat: a.stats.eat, focusUsed: Math.round(a.stats.focusUsed), masterwork: a.stats.masterwork,
    lotsUsed: lots.size, rotatingLots: rotLots.size, rotatingShare: Math.round((rotGathers / Math.max(1, gathers)) * 100),
    tools, toolStars: toolStars.map((x) => x.star), grades: gradeN, gearGrades: gearN, gearLog,
    fails, rejects, blocked, recalls,
    silver: a.silver, money,
    openOrders: ordersOf({ state: game.state }, 'b1').length,
    settle: { ...settle, visits, standing: a.standing, home: a.home,
      towns: Object.fromEntries(Object.values(game.state.settlements).map((t) => [t.id, { pop: t.pop, cap: t.cap, prosperity: t.prosperity, stations: t.stations.filter((st) => st.tier >= 2 || !game.data.settlements[t.id].stations.find((x) => x.type === st.type && !x.build)).map((st) => `${st.type}${st.tier}`) }])) },
    bestLot: [...lots].map((id) => game.state.lots[id]).filter(Boolean).reduce((b, l) => (!b || avgProps(l.props) > avgProps(b.props) ? l : b), null)?.name || null,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const data = loadData();
  const list = Object.values(data.agents).filter((p) => p.persona);
  const results = list.map((p) => runPersona(data, p, args));
  if (args.json) {
    console.log(JSON.stringify(results, null, 1));
  } else {
    const f = (t) => (t == null ? '—' : fmtPlay(t));
    console.log(`페르소나 자동 플레이 — 시드 ${args.seed}, 각자 게임 ${args.days}일`);
    for (const r of results) {
      console.log(`\n[${r.name} · ${r.role} · ${r.grade}] ${r.ms}ms`);
      console.log(`  첫 돌 도구 ${f(r.firsts.stoneTool)} · 첫 구리 도구 ${f(r.firsts.copperTool)} · 첫 음식 ${f(r.firsts.food)} · 첫 걸작 ${f(r.firsts.masterwork)}`);
      console.log(`  시간: 채집 ${r.time.gather}% · 이동 ${r.time.move}% · 제작 대기 ${r.time.wait}% · 그 밖 ${r.time.idle}% · 걸은 거리 ${r.distKm}km`);
      console.log(`  채집 ${r.gathers}회(시간당 ${r.gathersPerHour}) · 산지 ${r.lotsUsed}곳(순환 ${r.rotatingLots}, 채집의 ${r.rotatingShare}%) · 걸작 ${r.masterwork} · 음식 ${r.eat}`);
      console.log(`  레벨: ${Object.entries(r.levels).map(([k, v]) => `${data.skills[k].name} ${v}`).join(' · ')}`);
      const F = r.fight;
      console.log(`  전투: 시간 ${r.time.fight}% · 처치 ${JSON.stringify(F.kills)} · 쓰러짐 ${F.downs.length}${F.downs.length ? `(${F.downs.join(',')})` : ''} · 손질 ${F.skins}(${JSON.stringify(r.skinBy)}) · 준 피해 ${F.dmgDealt} · 받은 피해 ${F.dmgTaken} · 피함 ${F.evaded} · 막음 ${F.blockedHits}`);
      console.log(`  장비: ${JSON.stringify(F.equip)} · 만든 장비 ${JSON.stringify(F.gearCraft)} · 수리 ${JSON.stringify(F.repairs)}`);
      console.log(`  10/20/30 도달: ${Object.entries(r.reach).map(([k, v]) => `${data.skills[k].name} ${f(v[10])}/${f(v[20])}/${f(v[30])}`).join(' · ')}`);
      console.log(`  도구: ${Object.entries(r.tools).map(([k, v]) => (v ? `${data.items[v.item].name}[${GN[(v.star || 1) - 1]}](×${v.speed}, +${Math.round(v.yield * 100)}%)` : `${data.skills[k].name} 없음`)).join(' · ')} · 만든 것 등급 ${GN.map((n, i) => `${n} ${r.grades[i]}`).join(' · ')} · 장비 ${GN.map((n, i) => `${n} ${r.gearGrades[i]}`).join(' · ')}`);
      console.log(`  귀환 ${r.recalls}번 · 실패 ${JSON.stringify(r.fails)} · 거절 ${JSON.stringify(r.rejects)} · 막힘 ${r.blocked} · 가장 좋은 산지 ${r.bestLot}`);
      const mo = r.money;
      console.log(`  은화 ${r.silver} · 주문 ${mo.ordersN}건 ${mo.ordersQty}개 ${mo.orders}은화 · 거래소 판매 ${mo.soldQty}개 ${mo.sold}은화 · 구매 ${mo.boughtQty}개 ${mo.spent}은화 · 상인 ${mo.npcQty}개 ${mo.npc}은화 · 수리 ${mo.repairs || 0}번 ${mo.repairSpent || 0}은화 · 걸린 주문 ${r.openOrders}`);
      const S = r.settle;
      console.log(`  정착지: 들른 횟수 ${JSON.stringify(S.visits)} · 운송 ${S.ship}번 ${S.shipFee}은화 · 사업 기여 ${Math.round(S.contrib)}(은화 ${S.contribSilver}) · 명성 ${JSON.stringify(S.standing)}`);
      console.log(`  끝난 사업: ${S.projects.map((p) => `${data.projects[p.id].name}(${p.day}일차)`).join(' · ') || '없음'} · 마을 ${Object.entries(S.towns).map(([k, t]) => `${data.settlements[k].name} ${t.pop}/${t.cap} 번영 ${Math.round(t.prosperity)} [${t.stations.join(',')}]`).join(' · ')}`);
    }
  }
}
