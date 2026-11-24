// 엔진 테스트. 외부 라이브러리 없이 돈다.
//   node tools/test.js

import { loadData } from './load-data.js';
import { startFight } from '../core/ai/fighter.js';
import { equipLoad } from '../core/systems/combat.js';
import { createGame, loadGame } from '../core/game.js';
import {
  craftScores, convertStats, starOf, masterworkChance, avg, refineStep, xpToNext, levelFromXp,
} from '../core/formulas.js';
import { keyOf, effectiveProps, countItem } from '../core/inventory.js';
import { fitsHabitat, regionAt } from '../core/terrain.js';
import { allOrders, bookOf } from '../core/market.js';
import { storeOf, nearestSettlement, npcPos, sitePos, objPos } from '../core/world.js';
import { yawTo } from '../core/systems/combat.js';
import { settlementDaily } from '../core/settlements.js';
import { isUnlocked, allowedProject, chapterReached } from '../core/systems/unlocks.js';
import { stepText } from '../core/systems/quests.js';
import { readFileSync } from 'node:fs';

const LH = 's_lighthouse';
const FR = 's_forest';
// 등대 마을 창고(v0.4: 창고가 마을마다 따로다)
const home = (a) => storeOf(a, LH);

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} 기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`);
}
function near(a, b, eps = 1e-9, msg = '') {
  if (Math.abs(a - b) > eps) throw new Error(`${msg} 기대 ${b}, 실제 ${a}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || '참이어야 함');
}

const data = loadData();
const cfg = data.config;

console.log('공식');
test('설계 문서 7.2 철 곡괭이 예시: 73.9 / 52.2 → 77.9 / 56.2 → ×1.39, 537회, ★3, 걸작 4%', () => {
  const recipe = {
    level: 15,
    stats: {
      gatherSpeed: { 'head.hardness': 0.7, 'handle.strength': 0.3 },
      durability: { 'head.toughness': 0.6, 'handle.flex': 0.4 },
    },
  };
  const slotProps = { head: { hardness: 82, toughness: 47 }, handle: { strength: 55, flex: 60 } };
  const base = craftScores(recipe, slotProps, { skillLevel: 15, stationTier: 1 }, cfg);
  eq(base.gatherSpeed, 73.9, '기본 속도 점수');
  eq(base.durability, 52.2, '기본 내구 점수');
  const s = craftScores(recipe, slotProps, { skillLevel: 35, stationTier: 1 }, cfg);
  eq(s.gatherSpeed, 77.9, '숙련 보정 후 속도');
  eq(s.durability, 56.2, '숙련 보정 후 내구');
  const stats = convertStats({
    gatherSpeed: { base: 1, per: 1 / 200, round: 2 },
    durability: { base: 200, per: 6, round: 0 },
  }, s);
  eq(stats.gatherSpeed, 1.39, '속도 배율');
  eq(stats.durability, 537, '내구도');
  eq(starOf(avg(Object.values(s)), cfg.stars), 3, '별 등급');
  near(masterworkChance(20, false, cfg), 0.04, 1e-12, '걸작 확률');
});

test('정제 단계: 숙련 30 + 촉매 = +10, 상한 15', () => {
  eq(refineStep(1, false, cfg), 0);
  eq(refineStep(30, false, cfg), 5);
  eq(refineStep(30, true, cfg), 10);
  eq(refineStep(99, true, cfg), 15);
});

test('경험치 곡선: 레벨 1→2는 42, 상한에서 멈춤', () => {
  eq(xpToNext(1, data.curve), 42);
  eq(levelFromXp(41, data.curve, 30), 1);
  eq(levelFromXp(42, data.curve, 30), 2);
  eq(levelFromXp(10_000_000, data.curve, 30), 30);
});

console.log('명령');
test('맨손으로는 티어 1 노드를 못 캔다', () => {
  const g = createGame({ data, seed: 3 });
  const a = g.state.actors.p1;
  const node = Object.values(g.state.nodes).find((n) => data.nodes[n.type].tier === 1 && data.nodes[n.type].level <= 1)
    || Object.values(g.state.nodes).find((n) => data.nodes[n.type].tier === 1);
  a.skills[data.nodes[node.type].skill].level = 30; // 레벨 조건은 통과시키고
  a.x = node.x;
  a.z = node.z;
  const r = g.dispatch({ type: 'GATHER', actor: 'p1', node: node.id });
  eq(r.ok, false);
  eq(r.error, 'need_tool');
});

test('재료가 모자라면 거절되고 가방은 그대로 (원자적 처리)', () => {
  const g = createGame({ data, seed: 3 });
  const a = g.state.actors.p1;
  a.bag.push({ item: 'stone', lot: Object.keys(g.state.lots)[0], bonus: null, qty: 2 });
  const before = JSON.stringify(a.bag);
  const r = g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_axe_stone' });
  eq(r.ok, false);
  eq(r.error, 'missing_materials');
  eq(JSON.stringify(a.bag), before, '가방이 바뀜');
});

test('맨손 채집 → 돌 도끼 제작 → 도구 장착 채집', () => {
  const g = createGame({ data, seed: 5 });
  const a = g.state.actors.p1;
  const gatherNear = (nodeType, times) => {
    for (let i = 0; i < times; i++) {
      const node = Object.values(g.state.nodes)
        .filter((n) => n.type === nodeType && n.charges > 0)
        .sort((x, y) => Math.hypot(x.x - a.x, x.z - a.z) - Math.hypot(y.x - a.x, y.z - a.z))[0];
      a.x = node.x;
      a.z = node.z;
      const r = g.dispatch({ type: 'GATHER', actor: 'p1', node: node.id });
      ok(r.ok, '채집 명령 실패: ' + r.error);
      g.advance(8);
    }
  };
  gatherNear('node_stone', 4);
  gatherNear('node_driftwood', 3);
  const r = g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_axe_stone' });
  ok(r.ok, '제작 실패: ' + r.error);
  g.advance(10);
  const axe = a.bag.find((e) => e.item === 'tool_axe_stone');
  ok(axe, '돌 도끼가 없음');
  ok(axe.stats.gatherSpeed > 0.8 && axe.dur > 60, '도끼 수치 이상');
  gatherNear('node_driftwood', 1);
  eq(axe.dur, axe.maxDur - 1, '도구 내구 1 감소');
});

test('정제: 한 산지면 같은 묶음 + 단계 보너스, 섞으면 가중 평균 묶음', () => {
  const g = createGame({ data, seed: 9 });
  const a = g.state.actors.p1;
  const town = Object.values(g.state.settlements)[0];
  const smelter = town.stations.find((s) => s.type === 'smelter');
  a.x = smelter.x + 2;
  a.z = smelter.z;
  a.skills.smelting.level = 30;
  const lots = Object.values(g.state.lots).filter((l) => l.item === 'ore_copper');
  ok(lots.length >= 2, '구리 산지가 둘 이상 필요');
  const [L1, L2] = lots;
  a.bag.push({ item: 'ore_copper', lot: L1.id, bonus: null, qty: 3 });
  let r = g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_ingot_copper', refineProp: 'toughness' });
  ok(r.ok, r.error);
  g.advance(6);
  const ingot = home(a).find((e) => e.item === 'ingot_copper');
  ok(ingot, '주괴가 창고에 없음');
  eq(ingot.lot, L1.id, '같은 산지 묶음');
  eq(ingot.bonus.toughness, 5, '숙련 30 단계 +5');
  const eff = effectiveProps(ingot, g.state.lots);
  eq(eff.toughness, Math.min(100, L1.props.toughness + 5));

  a.bag.push({ item: 'ore_copper', lot: L1.id, bonus: null, qty: 1 });
  a.bag.push({ item: 'ore_copper', lot: L2.id, bonus: null, qty: 2 });
  r = g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_ingot_copper', refineProp: 'hardness' });
  ok(r.ok, r.error);
  g.advance(6);
  const mixed = home(a).find((e) => e.item === 'ingot_copper' && g.state.lots[e.lot].mix);
  ok(mixed, '섞은 묶음이 없음');
  const want = Math.round(((L1.props.hardness * 1 + L2.props.hardness * 2) / 3) * 10) / 10;
  eq(g.state.lots[mixed.lot].props.hardness, want, '가중 평균 경도');
});

test('작업대 앞이 아니면 제작이 거절된다', () => {
  const g = createGame({ data, seed: 9 });
  const a = g.state.actors.p1;
  const town = Object.values(g.state.settlements)[0];
  a.x = town.x;
  a.z = town.z - 25;
  a.bag.push({ item: 'ore_copper', lot: Object.values(g.state.lots).find((l) => l.item === 'ore_copper').id, bonus: null, qty: 3 });
  eq(g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_ingot_copper' }).error, 'no_station');
  const smelter = town.stations.find((s) => s.type === 'smelter');
  a.x = smelter.x + 2.5;
  a.z = smelter.z;
  ok(g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_ingot_copper' }).ok, '작업대 앞인데 거절됨');
});

test('미리보기는 걸작이 아니면 실제 결과와 같다', () => {
  const g = createGame({ data, seed: 12 });
  const a = g.state.actors.p1;
  const lot = (item) => Object.values(g.state.lots).find((l) => l.item === item).id;
  a.bag.push({ item: 'stone', lot: lot('stone'), bonus: null, qty: 3 });
  a.bag.push({ item: 'log_drift', lot: lot('log_drift'), bonus: null, qty: 2 });
  const cmd = { type: 'CRAFT', actor: 'p1', recipe: 'rc_axe_stone' };
  const pv = g.preview(cmd);
  ok(pv.ok && pv.stats.gatherSpeed > 0, '미리보기 실패');
  g.dispatch(cmd);
  g.advance(10);
  const axe = a.bag.find((e) => e.item === 'tool_axe_stone');
  if (!axe.masterwork) eq(JSON.stringify(axe.stats), JSON.stringify(pv.stats), '미리보기와 결과');
});

console.log('이동');
test('입력 방향으로 걷고, 나무에 막힌다', () => {
  const g = createGame({ data, seed: 4 });
  const a = g.state.actors.p1;
  const tree = Object.values(g.state.nodes).find((n) => n.type === 'node_birch');
  const R = data.config.move.radius + data.nodes.node_birch.solid;
  a.x = tree.x;
  a.z = tree.z - 4;
  g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 0, dz: 1 });
  g.advance(2);
  ok(a.z < tree.z, '나무를 뚫고 지나감');
  ok(Math.hypot(a.x - tree.x, a.z - tree.z) >= R - 1e-3, `나무 안으로 들어감 (${Math.hypot(a.x - tree.x, a.z - tree.z).toFixed(3)})`);
  g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 0, dz: 0 });
  const z = a.z;
  g.advance(1);
  eq(a.z, z, '멈춘 뒤에도 움직임');
});

test('목적지로 갈 때 작업대를 돌아서 가고, 막혔다고 멈추지 않는다', () => {
  const g = createGame({ data, seed: 4 });
  const a = g.state.actors.p1;
  let blocked = 0;
  g.on('move.blocked', () => blocked++);
  const st = Object.values(g.state.settlements)[0].stations.find((x) => x.type === 'kitchen');
  // 곧장 가는 길이 작업대 한가운데를 지난다
  a.x = st.x;
  a.z = st.z - 5;
  g.dispatch({ type: 'MOVE', actor: 'p1', x: st.x, z: st.z + 5 });
  g.advance(5);
  ok(!a.dest, `도착하지 못함 (${a.x}, ${a.z})`);
  ok(Math.hypot(a.x - st.x, a.z - st.z - 5) < 0.2, '목적지가 아닌 곳에서 멈춤');
  eq(blocked, 0, '막힘 이벤트');
});

test('단단한 노드끼리는 지나갈 틈을 두고 놓인다 (처음과 게임 10일 뒤)', () => {
  const g = createGame({ data, seed: 11 });
  const need = 2 * data.config.move.radius + 0.4 - 1e-6;
  const minGap = () => {
    const solids = Object.values(g.state.nodes).filter((n) => data.nodes[n.type].solid > 0);
    let min = Infinity;
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const p = solids[i];
        const q = solids[j];
        min = Math.min(min, Math.hypot(p.x - q.x, p.z - q.z) - data.nodes[p.type].solid - data.nodes[q.type].solid);
      }
    }
    return min;
  };
  ok(minGap() >= need, `처음 틈 ${minGap().toFixed(2)}m`);
  g.advance(10 * data.config.time.secondsPerGameDay);
  ok(minGap() >= need, `10일 뒤 틈 ${minGap().toFixed(2)}m`);
});

test('깊은 바다로는 걸어 들어갈 수 없다', () => {
  const g = createGame({ data, seed: 4 });
  const a = g.state.actors.p1;
  g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 0, dz: -1 }); // 남쪽 = 바다
  g.advance(30);
  ok(g.terrain.height(a.x, a.z) > data.lists.regions[0].terrain.wadeDepth, '물속으로 들어감');
});

test('귀환: 6초 뒤 귀환 지점 창고 앞으로, 움직이면 취소, 15분 재사용 대기', () => {
  const g = createGame({ data, seed: 4 });
  const a = g.state.actors.p1;
  a.x = 300;
  a.z = 250;
  ok(g.dispatch({ type: 'RECALL', actor: 'p1' }).ok, '귀환 시작 실패');
  g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 1, dz: 0 });
  eq(a.action, null, '움직였는데 귀환이 안 취소됨');
  g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 0, dz: 0 });
  ok(g.dispatch({ type: 'RECALL', actor: 'p1' }).ok, '다시 시작 실패');
  g.advance(7);
  const town = Object.values(g.state.settlements)[0];
  ok(Math.hypot(a.x - town.x, a.z - town.z) < town.radius, '마을로 안 옮겨짐');
  eq(g.dispatch({ type: 'RECALL', actor: 'p1' }).error, 'recall_cooldown');
});

console.log('재현성');
test('같은 시드 → 같은 결과 (봇 2명, 게임 2일)', () => {
  const run = () => {
    const g = createGame({ data, seed: 77, actors: [
      { id: 'b1', name: '개척민 1', kind: 'bot', ai: 'settler' },
      { id: 'b2', name: '개척민 2', kind: 'bot', ai: 'settler' },
    ] });
    g.advance(7200);
    return g.hash();
  };
  eq(run(), run());
});

test('저장→불러오기 뒤 이어 돌려도 한 번에 돌린 결과와 같다', () => {
  const actors = [{ id: 'b1', name: '개척민 1', kind: 'bot', ai: 'settler' }];
  const straight = createGame({ data, seed: 11, actors });
  straight.advance(7200);
  const half = createGame({ data, seed: 11, actors });
  half.advance(3600);
  const resumed = loadGame({ data, save: half.save() });
  resumed.advance(3600);
  eq(resumed.hash(), straight.hash());
});

test('산지가 돌아간다: 게임 10일 동안 닫히고 열린다', () => {
  const g = createGame({ data, seed: 21 });
  let opened = 0;
  let closed = 0;
  g.on('vein.opened', () => opened++);
  g.on('vein.closed', () => closed++);
  g.advance(36000);
  ok(closed > 0 && opened === closed, `열림 ${opened}, 닫힘 ${closed}`);
  for (const region of data.lists.regions) {
    for (const vc of region.veins) {
      if (!vc.rotating) continue;
      const n = Object.values(g.state.veins).filter((v) => v.region === region.id && v.node === vc.node && !v.common).length;
      eq(n, vc.rotating, `${region.id} ${vc.node} 순환 산지 수`);
    }
  }
});

test('v0.0 세이브를 불러오면 지형에 맞게 옮겨지고 이어서 돈다', () => {
  const old = readFileSync(new URL('./fixtures/save-v0.0.json', import.meta.url), 'utf8');
  const g = loadGame({ data, save: old });
  const region = data.lists.regions[0];
  const before = JSON.parse(old).state;
  eq(g.state.meta.dataVersion, data.config.dataVersion, '데이터 버전');
  eq(g.state.tick, before.t * data.config.time.hz, '틱 환산');
  ok(Object.keys(before.nodes).every((id) => g.state.nodes[id]), '원래 노드가 그대로 있다');
  ok(Object.values(g.state.nodes).some((n) => n.type === 'node_oak'), 'v0.3 참나무 숲 노드가 열린다');
  ok(Object.keys(g.state.mobs).length > 10, 'v0.3 짐승');
  ok(g.state.actors.p1.cb && g.state.actors.p1.cb.hp === data.config.combat.hp, 'v0.3 체력');
  let bad = 0;
  for (const n of Object.values(g.state.nodes)) if (!fitsHabitat(g.terrain, regionAt(data.lists.regions, n.x), data.nodes[n.type], n.x, n.z)) bad++;
  ok(bad <= 2, `서식지 밖 노드 ${bad}개`);
  ok(region.id === 'wreck_coast', '첫 지역');
  eq(JSON.stringify(g.state.actors.p1.skills), JSON.stringify(before.actors.p1.skills), '스킬이 보존되지 않음');
  eq(home(g.state.actors.p1).length, before.actors.p1.storage.length, '창고가 보존되지 않음');
  eq(g.state.actors.p1.silver, data.config.market.startSilver, '은화(v0.2)');
  eq(g.state.econ.agents.length, data.config.econ.agents.length, 'AI 개척민(v0.2)');
  ok(Array.isArray(bookOf({ state: g.state }, LH).asks) && Array.isArray(g.state.orders), '거래소·주문(v0.2)');
  ok(g.state.settlements[FR] && g.state.projects.pj_f_tannery, '숲머리·마을 사업(v0.4)');
  g.advance(600);
  const again = loadGame({ data, save: old });
  again.advance(600);
  eq(again.hash(), g.hash(), '같은 세이브에서 이어 돌린 결과');
});

test('상태는 그대로 JSON이 된다 (NaN·undefined 없음)', () => {
  const g = createGame({ data, seed: 2, actors: [{ id: 'b1', kind: 'bot', ai: 'settler' }] });
  g.advance(3600);
  const text = g.save();
  ok(!/NaN|Infinity|undefined/.test(text), '직렬화 불가 값이 있음');
  const again = loadGame({ data, save: text });
  eq(again.hash(), g.hash());
  ok(keyOf(again.state.actors.b1.bag[0] || { item: 'x', lot: null, bonus: null }).length > 0);
});

console.log('거래소·주문 (v0.2)');
// 시험용 섬: AI 개척민과 마을 수요를 꺼서 손으로 건 주문만 남긴다
function marketGame(seed = 5) {
  const g = createGame({ data, seed, actors: [{ id: 'p1', kind: 'player' }, { id: 'p2', kind: 'player' }] });
  g.state.econ = null;
  g.state.market.books = {};
  for (const id of ['p1', 'p2']) g.state.actors[id].unlockAll = true; // 해금(v0.5.2)과 상관없이 기능을 본다
  const town = Object.values(g.state.settlements)[0];
  for (const id of ['p1', 'p2']) {
    g.state.actors[id].x = town.x + 3;
    g.state.actors[id].z = town.z + 3;
  }
  return g;
}

test('팔자와 사자가 만나면 먼저 걸린 값으로 체결되고, 수수료 1%·판매세 4%가 빠진다', () => {
  const g = marketGame();
  const p1 = g.state.actors.p1;
  const p2 = g.state.actors.p2;
  p2.silver = 1000;
  const start = p1.silver;
  home(p1).push({ item: 'ingot_copper', lot: null, bonus: null, qty: 5 });
  const key = keyOf(home(p1)[home(p1).length - 1]);
  ok(g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key, qty: 5, price: 50 }).ok, '팔자 거절');
  eq(p1.silver, start - 3, '수수료(5×50×1%)');
  ok(g.dispatch({ type: 'MARKET_BUY', actor: 'p2', item: 'ingot_copper', minStar: 0, qty: 3, price: 60 }).ok, '사자 거절');
  eq(p2.silver, 1000 - 150, '산 쪽은 걸린 값(50)으로 내고 차액을 돌려받는다');
  eq(p1.silver, start - 3 + 150 - 6, '판 쪽은 판매세 4%를 뺀 값을 받는다');
  eq(home(p2).filter((e) => e.item === 'ingot_copper').reduce((x, e) => x + e.qty, 0), 3, '산 물건은 창고로');
  eq(bookOf({ state: g.state }, LH).asks[0].qty, 2, '남은 팔자');
  eq(g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key, qty: 1, price: 50 }).error, 'no_item', '없는 물건');
});

test('★ 조건 사자는 그 별 이상만 사고, 기한이 지나면 물건·은화를 돌려받는다', () => {
  const g = marketGame();
  const p1 = g.state.actors.p1;
  const p2 = g.state.actors.p2;
  p2.silver = 500;
  home(p1).push({ item: 'sap_birch', lot: null, bonus: null, qty: 4 });
  const key = keyOf(home(p1)[home(p1).length - 1]);
  g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key, price: 10 });
  g.dispatch({ type: 'MARKET_BUY', actor: 'p2', item: 'sap_birch', minStar: 3, qty: 4, price: 20 });
  eq(allOrders({ state: g.state }).length, 2, '★0 팔자와 ★3 사자는 맞지 않는다');
  eq(p2.silver, 500 - 80, '사자는 은화를 맡긴다');
  g.advance(3600 * (cfg.market.orderDays + 1));
  eq(allOrders({ state: g.state }).filter((o) => o.kind === 'actor').length, 0, '기한 지난 주문');
  eq(p2.silver, 500, '맡긴 은화를 돌려받는다');
  eq(home(p1).filter((e) => e.item === 'sap_birch').reduce((x, e) => x + e.qty, 0), 4, '물건을 돌려받는다');
});

test('주문 게시판: 조건(★·내구도)에 맞는 것만 넘기고 넘긴 만큼 은화를 받는다', () => {
  const g = marketGame();
  const p1 = g.state.actors.p1;
  const day = g.clock.day(g.state.t);
  g.state.orders = [
    { id: 'O_a', item: 'nails_copper', minStar: 0, qty: 20, left: 20, reward: 7, postedDay: day, expiresDay: day + 3 },
    { id: 'O_b', item: 'ingot_copper', minStar: 3, qty: 5, left: 5, reward: 90, postedDay: day, expiresDay: day + 3 },
    { id: 'O_c', item: 'tool_axe_copper', minStar: 0, qty: 1, left: 1, reward: 300, postedDay: day, expiresDay: day + 3 },
  ];
  home(p1).push({ item: 'nails_copper', lot: null, bonus: null, qty: 12 });
  home(p1).push({ item: 'ingot_copper', lot: null, bonus: null, qty: 5 });
  home(p1).push({ uid: 'u_t1', item: 'tool_axe_copper', star: 2, dur: 100, stats: { durability: 400 } });
  const s0 = p1.silver;
  ok(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_a' }).ok, '못 납품');
  eq(g.state.orders[0].left, 8, '남은 수량');
  eq(p1.silver, s0 + 12 * 7, '보상');
  eq(p1.stats.orders, 12, '납품 기록');
  eq(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_b' }).error, 'nothing_to_deliver', '★0 주괴는 ★3 주문에 못 낸다');
  eq(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_c' }).error, 'nothing_to_deliver', '닳은 도구는 못 낸다');
  home(p1).find((e) => e.uid === 'u_t1').dur = 400;
  ok(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_c' }).ok, '새 도구는 낸다');
  eq(p1.silver, s0 + 84 + 300);
});

test('수리(v0.2.1): 대장간 앞에서 은화를 내고 고친다. 최대 내구가 2% 줄고, 고친 도구는 주문에 못 낸다', () => {
  const g = marketGame();
  const p1 = g.state.actors.p1;
  const forge = Object.values(g.state.settlements)[0].stations.find((x) => x.type === 'forge');
  p1.silver = 500;
  p1.bag.push({ uid: 'u_r1', item: 'tool_axe_copper', star: 3, dur: 0, maxDur: 400, broken: true, stats: { durability: 400, gatherSpeed: 1.2 } });
  eq(g.dispatch({ type: 'REPAIR', actor: 'p1', uid: 'u_r1' }).error, 'no_station', '대장간에서 멀면');
  p1.x = forge.x - 2.2;
  p1.z = forge.z;
  const xp0 = p1.skills.smithing.xp;
  const cost = Math.ceil(Math.round(210 * cfg.market.starMult[3]) * cfg.repair.rate);
  ok(g.dispatch({ type: 'REPAIR', actor: 'p1', uid: 'u_r1' }).ok, '수리 거절');
  const t = p1.bag.find((e) => e.uid === 'u_r1');
  eq(t.broken, false);
  eq(t.maxDur, 392, '최대 내구 2% 감소');
  eq(t.dur, 392);
  eq(p1.silver, 500 - cost, '수리비');
  ok(p1.skills.smithing.xp > xp0, '대장 경험치');
  eq(g.dispatch({ type: 'REPAIR', actor: 'p1', uid: 'u_r1' }).error, 'not_damaged', '멀쩡한 도구');
  const day = g.clock.day(g.state.t);
  g.state.orders = [{ id: 'O_r', item: 'tool_axe_copper', minStar: 0, qty: 1, left: 1, reward: 300, postedDay: day, expiresDay: day + 3 }];
  p1.x = Object.values(g.state.settlements)[0].x + 3;
  p1.z = Object.values(g.state.settlements)[0].z + 3;
  eq(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_r' }).error, 'nothing_to_deliver', '고친 도구');
});

test('AI 개척민 경제: 게임 30일을 돌려도 은화가 폭주하지 않고 물가가 버틴다', () => {
  const g = createGame({ data, seed: 9, actors: [{ id: 'p1', kind: 'player' }] });
  const total = () => g.state.econ.agents.reduce((x, a) => x + a.silver, 0) + allOrders({ state: g.state }).filter((b) => b.kind === 'agent' && b.escrow != null).reduce((x, b) => x + b.escrow, 0);
  g.advance(3600 * 20);
  const mid = total();
  g.advance(3600 * 10);
  const end = total();
  ok(g.state.econ.agents.every((a) => a.silver >= 0 && Number.isFinite(a.silver)), '음수 은화');
  // v0.4: 마을 사업이 끝나면 2티어 물건 수요가 붙어 섬 경제가 한 단계 커진다. 그래서 30%대까지는 성장으로 본다.
  ok(end < mid * 1.4, `20~30일 은화 ${mid} → ${end}`);
  ok(end / g.state.econ.agents.length < 3000, `개척민 한 명 평균 은화 ${Math.round(end / g.state.econ.agents.length)}`);
  const ctx = { state: g.state, data, cfg };
  const basket = ['log_birch', 'ore_copper', 'lumber_birch', 'ingot_copper', 'cloth_reed', 'food_berry'];
  const ref = bookOf({ state: g.state }, 's_port').ref; // v0.6: 큰 장터는 본섬 갈대 나루
  const idx = basket.reduce((x, it) => x + (ref[it + '|2'] ?? 1) / Math.round(data.items[it].value * cfg.market.starMult[2]), 0) / basket.length;
  ok(idx > 0.6 && idx < 1.3, `물가 지수 ${idx.toFixed(2)}`);
  ok(g.state.orders.length > 0, '주문 게시판이 비었다');
});

console.log('전투·수렵 (v0.3)');
function arena(typeId, seed = 21) {
  const g = createGame({ data, seed, actors: [{ id: 'p1', kind: 'player' }] });
  g.state.econ = null;
  const grp = Object.values(g.state.mobGroups).find((x) => x.type === typeId);
  for (const m of Object.values(g.state.mobs)) if (m.group !== grp.id) delete g.state.mobs[m.id];
  for (const id of Object.keys(g.state.mobGroups)) if (id !== grp.id) delete g.state.mobGroups[id];
  const m = g.state.mobs[grp.mobs[0]];
  for (const id of grp.mobs.slice(1)) delete g.state.mobs[id];
  grp.mobs = [m.id];
  const a = g.state.actors.p1;
  return { g, a, m, grp };
}
function kit(id, score, uid) {
  const def = data.items[id];
  const stats = convertStats(def.statConvert, Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, score])));
  return { uid, item: id, stats, star: 2, dur: stats.durability, maxDur: stats.durability, broken: false };
}
function place(g, a, m, d, yawOff = 0) {
  // 짐승 앞 d m에 세우고 짐승을 바라보게 한다
  a.x = m.x + Math.sin(m.yaw) * d;
  a.z = m.z + Math.cos(m.yaw) * d;
  a.yaw = Math.atan2(m.x - a.x, m.z - a.z) + yawOff;
}

test('참나무 숲: 참나무·철광맥·늑대는 북쪽 숲(z ≥ 250)에만, T1 노드는 숲 밖에만 난다', () => {
  const g = createGame({ data, seed: 31 });
  const z0 = data.lists.regions[0].zones[0].z0;
  const isle = (o) => regionAt(data.lists.regions, o.x).id === 'wreck_coast';
  const nodes = Object.values(g.state.nodes).filter(isle);
  ok(nodes.some((n) => n.type === 'node_oak') && nodes.some((n) => n.type === 'node_iron'), 'T2 노드가 없다');
  for (const n of nodes) {
    const zone = data.nodes[n.type].zone;
    ok(zone ? n.z >= z0 : n.z < z0, `${n.type} ${n.z.toFixed(0)}`);
  }
  const wolves = Object.values(g.state.mobGroups).filter((x) => x.type === 'wolf' && isle(x));
  ok(wolves.length > 0 && wolves.every((x) => x.z >= z0 + data.creatures.wolf.deep), '늑대는 숲 깊은 곳');
  ok(Object.values(g.state.mobGroups).filter((x) => x.type === 'crab' && isle(x)).every((x) => x.z < z0), '게는 해안');
});

test('공격: 사거리·각도 안의 짐승을 무기 공격력만큼 때리고 무기 내구가 준다', () => {
  const { g, a, m } = arena('boar');
  const w = kit('wpn_sword_copper', 50, 'u_w1');
  a.bag.push(w);
  ok(g.dispatch({ type: 'EQUIP', actor: 'p1', uid: 'u_w1' }).ok, '장착');
  m.mode = 'recover';
  m.until = 1e9;
  place(g, a, m, 1.6);
  const hp0 = m.hp;
  ok(g.dispatch({ type: 'ATTACK', actor: 'p1', kind: 'light' }).ok, '공격 거절');
  g.advance(0.6);
  const expect = Math.round(w.stats.attack * (1 - 10 / 70) * 10) / 10;
  eq(Math.round((hp0 - m.hp) * 10) / 10, expect, '피해(방어 10 반영)');
  eq(w.dur, w.maxDur - 1, '무기 내구');
  eq(g.dispatch({ type: 'ATTACK', actor: 'p1', kind: 'heavy', yaw: a.yaw + Math.PI }).ok, true);
  const hp1 = m.hp;
  g.advance(1.2);
  eq(m.hp, hp1, '뒤로 휘두르면 안 맞는다');
});

test('회피: 구르기 앞 0.3초에는 짐승의 공격을 맞지 않는다', () => {
  const { g, a, m } = arena('crab');
  place(g, a, m, 1.0);
  m.target = 'p1';
  m.mode = 'windup';
  m.until = g.state.t + 0.1;
  m.yaw = Math.atan2(a.x - m.x, a.z - m.z);
  ok(g.dispatch({ type: 'DODGE', actor: 'p1', yaw: a.yaw }).ok, '회피 거절'); // 짐승 쪽으로 굴러 사거리 안에 남는다
  const light = data.config.load.tiers.find((t) => t.id === 'light');
  near(a.cb.st, data.config.combat.stamina - data.config.combat.dodgeCost * light.dodgeCost, 1e-6, '기력(맨몸은 가벼움 단계)');
  g.advance(0.2);
  eq(a.cb.hp, data.config.combat.hp, '피해를 받았다');
  ok(a.stats.evaded >= 1, '피함 기록');
});

test('장비 무게: 낀 무기·갑옷 무게 합으로 단계가 정해지고, 무거우면 느리게 걷고 짧게 구른다 (v0.4.5)', () => {
  const run = (ids) => {
    const { g, a } = arena('crab');
    a.bag = ids.map((id, i) => kit(id, 50, 'u' + i));
    for (const e of a.bag) g.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid });
    const ld = equipLoad({ data, cfg, state: g.state }, a);
    const x0 = a.x; // 마을 안 출발점에서 동쪽으로 걷는다
    g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 1, dz: 0 });
    g.advance(1);
    const walked = a.x - x0;
    g.dispatch({ type: 'MOVE_INPUT', actor: 'p1', dx: 0, dz: 0 });
    a.cb.st = 100;
    const x1 = a.x;
    const r = g.dispatch({ type: 'DODGE', actor: 'p1', yaw: Math.PI / 2 });
    g.advance(0.6);
    return { ld, walked, rolled: a.x - x1, ok: r.ok };
  };
  const robe = run(['arm_robe', 'arm_cloth_hood', 'arm_cloth_pants', 'wpn_sword_copper']);
  const iron = run(['arm_iron_cuirass', 'arm_iron_helm', 'arm_iron_greaves', 'wpn_sword_iron']);
  eq(robe.ld.tier.id, 'light', `로브 한 벌 + 검 ${robe.ld.kg}kg`);
  eq(iron.ld.tier.id, 'heavy', `철 한 벌 + 검 ${iron.ld.kg}kg`);
  ok(robe.walked > iron.walked * 1.1, `걸음 ${robe.walked.toFixed(2)} vs ${iron.walked.toFixed(2)}`);
  ok(robe.rolled > iron.rolled * 1.3, `구르기 ${robe.rolled.toFixed(2)} vs ${iron.rolled.toFixed(2)}`);
});

test('과적이면 구를 수 없다', () => {
  const { g, a } = arena('crab');
  a.bag = ['arm_iron_cuirass', 'arm_iron_helm', 'arm_iron_greaves', 'wpn_battleaxe_iron'].map((id, i) => kit(id, 50, 'v' + i));
  for (const e of a.bag) g.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid });
  const saved = cfg.load.tiers.map((t) => t.max);
  cfg.load.tiers[2].max = 20; // 시험용으로 과적 문턱을 낮춘다
  try {
    const ld = equipLoad({ data, cfg, state: g.state }, a);
    eq(ld.tier.id, 'over', `${ld.kg}kg`);
    const r = g.dispatch({ type: 'DODGE', actor: 'p1', yaw: 0 });
    ok(!r.ok && r.error === 'overloaded', `거절 이유 ${r.error}`);
  } finally {
    cfg.load.tiers.forEach((t, i) => { t.max = saved[i]; });
  }
});

test('막기: 앞에서 오는 피해를 75% 줄이고, 기력이 바닥나면 비틀거린다', () => {
  const { g, a, m } = arena('crab');
  place(g, a, m, 1.0);
  g.dispatch({ type: 'BLOCK', actor: 'p1', on: true });
  m.target = 'p1';
  m.mode = 'windup';
  m.until = g.state.t + 0.05;
  m.yaw = Math.atan2(a.x - m.x, a.z - m.z);
  g.advance(0.1);
  eq(a.cb.hp, data.config.combat.hp - Math.round(5 * 0.25 * 10) / 10, '막은 피해');
  eq(a.cb.st, data.config.combat.stamina - 5, '기력이 준다');
  a.cb.st = 2;
  m.mode = 'windup';
  m.until = g.state.t + 0.05;
  g.advance(0.1);
  ok(a.cb.stunUntil > g.state.t && !a.cb.block, '막기가 풀리고 비틀거린다');
});

test('쓰러짐: 체력이 0이면 5초 뒤 마을에서 일어나고 낀 장비 내구가 10% 준다', () => {
  const { g, a, m } = arena('wolf');
  const w = kit('wpn_spear_copper', 40, 'u_w2');
  a.bag.push(w);
  g.dispatch({ type: 'EQUIP', actor: 'p1', uid: 'u_w2' });
  place(g, a, m, 1.2);
  a.cb.hp = 3;
  m.target = 'p1';
  m.mode = 'windup';
  m.until = g.state.t + 0.05;
  m.yaw = Math.atan2(a.x - m.x, a.z - m.z);
  g.advance(0.2);
  ok(a.cb.downUntil > 0, '쓰러지지 않았다');
  eq(w.dur, w.maxDur - Math.round(w.maxDur * 0.1), '장비 내구 10%');
  eq(g.dispatch({ type: 'ATTACK', actor: 'p1' }).error, 'down');
  g.advance(5.2);
  eq(a.cb.downUntil, 0);
  eq(a.cb.hp, data.config.combat.hp, '체력이 찬다');
  const town = nearestSettlement({ state: g.state }, a);
  ok(Math.hypot(a.x - town.x, a.z - town.z) < town.radius, '가장 가까운 마을에서 일어난다');
});

test('수렵: 쓰러뜨린 짐승을 손질하면 사냥터 묶음의 가죽·고기와 수렵 경험치를 얻는다', () => {
  const { g, a, m, grp } = arena('deer');
  a.skills.hunting.level = data.creatures.deer.hunt.level;
  place(g, a, m, 1.5);
  m.mode = 'dead';
  m.hp = 0;
  m.deadAt = g.state.t;
  m.respawnAt = g.state.t + 300;
  ok(g.dispatch({ type: 'SKIN', actor: 'p1', mob: m.id }).ok, '손질 거절');
  g.advance(data.creatures.deer.hunt.seconds + 0.2);
  const hide = a.bag.find((e) => e.item === 'hide_raw');
  ok(hide && hide.lot === grp.lots.hide_raw && hide.qty >= 2, '생가죽');
  ok(a.bag.some((e) => e.item === 'meat_raw'), '생고기');
  ok(a.skills.hunting.xp > 0, '수렵 경험치');
  eq(g.dispatch({ type: 'SKIN', actor: 'p1', mob: m.id }).error, 'no_corpse', '두 번 손질');
  a.skills.hunting.level = 1;
});

test('갑옷 수리는 갑주 작업대, 무기 수리는 대장간에서 한다', () => {
  const { g, a } = arena('crab');
  const town = Object.values(g.state.settlements)[0];
  const forge = town.stations.find((x) => x.type === 'forge');
  const bench = town.stations.find((x) => x.type === 'armorbench');
  a.silver = 999;
  const v = kit('arm_leather_vest', 50, 'u_a1');
  v.dur = 10;
  const w = kit('wpn_sword_copper', 50, 'u_w3');
  w.dur = 5;
  a.bag.push(v, w);
  a.x = forge.x - 2;
  a.z = forge.z;
  eq(g.dispatch({ type: 'REPAIR', actor: 'p1', uid: 'u_a1' }).error, 'no_station', '갑옷은 대장간에서 못 고친다');
  ok(g.dispatch({ type: 'REPAIR', actor: 'p1', uid: 'u_w3' }).ok, '무기 수리');
  a.x = bench.x - 2;
  a.z = bench.z;
  ok(g.dispatch({ type: 'REPAIR', actor: 'p1', uid: 'u_a1' }).ok, '갑옷 수리');
  eq(v.dur, v.maxDur);
});

test('결투를 같은 시드로 두 번 돌리면 결과가 똑같다', () => {
  const run = () => {
    const { g, a, m } = arena('wolf', 44);
    const w = kit('wpn_battleaxe_copper', 45, 'u_w4');
    a.bag.push(w);
    g.dispatch({ type: 'EQUIP', actor: 'p1', uid: 'u_w4' });
    place(g, a, m, 6);
    startFight(a, m.id, { read: 0.5 });
    a.ai.manual = true;
    g.advance(20);
    return g.hash();
  };
  eq(run(), run());
});

console.log('정착지 (v0.4)');
// 두 마을 시험용 섬: AI 개척민을 끄고 거래소를 비운다
function townsGame(seed = 41) {
  const g = createGame({ data, seed, actors: [{ id: 'p1', kind: 'player' }, { id: 'p2', kind: 'player' }] });
  g.state.econ = null;
  g.state.market.books = {};
  for (const id of ['p1', 'p2']) g.state.actors[id].unlockAll = true;
  return g;
}
const at = (a, sid, g, dx = 3, dz = 3) => {
  const s = g.state.settlements[sid];
  a.x = s.x + dx;
  a.z = s.z + dz;
};

test('창고는 마을마다 따로다. 운송하면 운송비(기본값 5%)를 내고 다른 마을 창고로 간다', () => {
  const g = townsGame();
  const a = g.state.actors.p1;
  a.silver = 500;
  at(a, FR, g);
  a.bag.push({ item: 'ingot_copper', lot: null, bonus: null, qty: 10 });
  ok(g.dispatch({ type: 'STORE', actor: 'p1', all: true }).ok, '넣기');
  eq(storeOf(a, FR).length, 1, '숲머리 창고에 들어간다');
  eq(home(a).length, 0, '등대 마을 창고는 그대로');
  const key = keyOf(storeOf(a, FR)[0]);
  at(a, LH, g);
  eq(g.dispatch({ type: 'TAKE', actor: 'p1', key }).error, 'no_item', '다른 마을 창고는 못 꺼낸다');
  at(a, FR, g);
  eq(g.dispatch({ type: 'SHIP', actor: 'p1', key, to: FR }).error, 'same_town');
  ok(g.dispatch({ type: 'SHIP', actor: 'p1', key, qty: 4, to: LH }).ok, '운송');
  eq(a.silver, 500 - Math.ceil(42 * 4 * 0.05), '운송비(★2 구리주괴 42 × 4개 × 5%)');
  eq(home(a)[0].qty, 4, '등대 마을 창고로 4개');
  eq(storeOf(a, FR)[0].qty, 6, '남은 6개');
});

test('거래소는 마을마다 따로다. 다른 마을 사자와는 맞지 않는다', () => {
  const g = townsGame();
  const [p1, p2] = [g.state.actors.p1, g.state.actors.p2];
  p2.silver = 1000;
  at(p1, FR, g);
  at(p2, LH, g);
  storeOf(p1, FR).push({ item: 'leather', lot: null, bonus: null, qty: 5 });
  ok(g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key: keyOf(storeOf(p1, FR)[0]), qty: 5, price: 20 }).ok);
  ok(g.dispatch({ type: 'MARKET_BUY', actor: 'p2', item: 'leather', qty: 5, price: 30 }).ok);
  eq(bookOf({ state: g.state }, FR).asks.length, 1, '숲머리 팔자는 남아 있다');
  eq(bookOf({ state: g.state }, LH).bids.length, 1, '등대 마을 사자도 남아 있다');
  at(p2, FR, g);
  ok(g.dispatch({ type: 'MARKET_BUY', actor: 'p2', item: 'leather', qty: 5, price: 30, ioc: true }).ok);
  eq(storeOf(p2, FR).reduce((x, e) => x + e.qty, 0), 5, '숲머리에서 산 물건은 숲머리 창고로');
});

test('주문 게시판도 마을마다 따로다', () => {
  const g = townsGame();
  const a = g.state.actors.p1;
  const day = g.clock.day(g.state.t);
  g.state.orders = [{ id: 'O_f', at: FR, item: 'nails_copper', minStar: 0, qty: 10, left: 10, reward: 7, postedDay: day, expiresDay: day + 3 }];
  a.bag.push({ item: 'nails_copper', lot: null, bonus: null, qty: 10 });
  at(a, LH, g);
  eq(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_f' }).error, 'other_town');
  at(a, FR, g);
  ok(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_f' }).ok);
});

test('마을 사업: 물자·은화가 다 모이면 작업대가 서고, 낸 만큼 명성이 쌓여 판매세가 준다', () => {
  const g = townsGame();
  const a = g.state.actors.p1;
  const def = data.projects.pj_f_tannery;
  at(a, LH, g);
  eq(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: 'pj_f_tannery', silver: 10 }).error, 'no_project', '다른 마을 사업');
  at(a, FR, g);
  eq(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: 'pj_f_smelter', silver: 10 }).error, 'project_closed', '앞 사업이 안 끝났다');
  a.silver = def.silver + 100;
  for (const [item, q] of Object.entries(def.needs)) a.bag.push({ item, lot: null, bonus: null, qty: q + 2 });
  eq(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: 'pj_f_tannery', key: keyOf(a.bag.find((e) => e.item === 'log_drift') || { item: 'x', lot: null, bonus: null }) }).error, 'no_item');
  ok(!g.state.settlements[FR].stations.some((st) => st.type === 'tannery'), '처음엔 무두질 틀이 없다');
  for (const item of Object.keys(def.needs)) {
    ok(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: 'pj_f_tannery', key: keyOf(a.bag.find((e) => e.item === item)) }).ok, item);
  }
  eq(a.bag.find((e) => e.item === 'stone').qty, 2, '필요한 만큼만 낸다');
  ok(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: 'pj_f_tannery', silver: def.silver + 50 }).ok);
  eq(a.silver, 100, '남은 은화는 돌려받는다(필요한 만큼만 낸다)');
  ok(g.state.projects.pj_f_tannery.done, '완성');
  const st = g.state.settlements[FR].stations.find((x) => x.type === 'tannery');
  ok(st && st.tier === 1, '무두질 틀이 선다');
  ok(g.state.projects.pj_f_armorbench && g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: 'pj_f_armorbench', silver: 1 }).ok, '다음 사업이 열린다');
  ok(a.standing[FR] >= 600, `명성 ${a.standing[FR]}`);
  // 명성 이웃(500) 이상이면 숲머리 판매세 3.5%
  const p2 = g.state.actors.p2;
  p2.silver = 1000;
  at(p2, FR, g);
  storeOf(a, FR).push({ item: 'ingot_copper', lot: null, bonus: null, qty: 10 });
  const s0 = a.silver;
  ok(g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key: keyOf(storeOf(a, FR)[0]), qty: 10, price: 100, ioc: true }).ok === true);
  ok(g.dispatch({ type: 'MARKET_BUY', actor: 'p2', item: 'ingot_copper', qty: 10, price: 100 }).ok);
  ok(g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key: keyOf(storeOf(a, FR)[0]), qty: 10, price: 100, ioc: true }).ok);
  eq(a.silver, s0 + 1000 - Math.floor(1000 * 0.035), '판매세 3.5%');
});

test('작업대 단계: 철 제련은 2단계 제련로에서만 된다', () => {
  const g = townsGame();
  const a = g.state.actors.p1;
  a.skills.smelting.level = 30;
  const smelter = g.state.settlements[LH].stations.find((x) => x.type === 'smelter');
  a.x = smelter.x - 2;
  a.z = smelter.z;
  home(a).push({ item: 'ore_iron', lot: null, bonus: null, qty: 6 });
  eq(g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_ingot_iron' }).error, 'station_tier');
  smelter.tier = 2;
  smelter.base = 2;
  ok(g.dispatch({ type: 'CRAFT', actor: 'p1', recipe: 'rc_ingot_iron' }).ok, '2단계에서는 된다');
});

test('인구·번영도: 수요를 채우면 번영도가 오르고 인구가 늘며, 못 채우면 준다', () => {
  const g = townsGame();
  const s = g.state.settlements[LH];
  const ctx = { state: g.state, data, cfg, clock: g.clock, emit: () => {}, newId: (p) => p + Math.random() };
  const fillAll = () => {
    for (const b of [...bookOf(ctx, LH).bids]) if (b.kind === 'town') { b.qty = 0; }
  };
  const pop0 = s.pop;
  for (let d = 0; d < 4; d++) {
    fillAll();
    settlementDaily(ctx, s);
  }
  ok(s.prosperity > 70 && s.pop > pop0, `번영 ${s.prosperity} 인구 ${pop0} → ${s.pop}`);
  ok(s.pop <= s.cap, '상한을 넘지 않는다');
  const want = bookOf(ctx, LH).bids.filter((b) => b.kind === 'town').reduce((x, b) => x + b.qty, 0);
  ok(want > Object.values(cfg.town.demand[LH]).reduce((x, q) => x + q, 0) - (cfg.town.demand[LH].lumber_oak + cfg.town.demand[LH].ingot_iron), '인구가 늘면 수요도 는다');
  const grown = s.pop;
  for (let d = 0; d < 6; d++) settlementDaily(ctx, s);
  ok(s.prosperity < 35 && s.pop < grown, `못 채우면 번영 ${s.prosperity} 인구 ${grown} → ${s.pop}`);
  ok(s.pop >= Math.ceil(s.pop0 * cfg.settle.prosper.floor), '바닥 밑으로는 안 준다');
});

test('2단계 작업대는 유지비를 사흘 못 채우면 1단계로 일하고, 채우면 돌아온다', () => {
  const g = townsGame();
  const s = g.state.settlements[LH];
  const ctx = { state: g.state, data, cfg, clock: g.clock, emit: () => {}, newId: (p) => p };
  const st = s.stations.find((x) => x.type === 'smelter');
  st.tier = 2;
  st.base = 2;
  for (let d = 0; d < 4; d++) settlementDaily(ctx, s);
  eq(st.tier, 1, '유지비가 밀리면 1단계');
  for (const b of bookOf(ctx, LH).bids) if (b.kind === 'town') b.qty = 0;
  settlementDaily(ctx, s);
  eq(st.tier, 2, '채우면 돌아온다');
});

test('귀환 지점을 숲머리로 바꾸면 귀환이 숲머리로 간다', () => {
  const g = townsGame();
  const a = g.state.actors.p1;
  at(a, FR, g);
  ok(g.dispatch({ type: 'SET_HOME', actor: 'p1' }).ok);
  eq(g.dispatch({ type: 'SET_HOME', actor: 'p1' }).error, 'already_home');
  at(a, LH, g, 5, 40);
  ok(g.dispatch({ type: 'RECALL', actor: 'p1' }).ok);
  g.advance(cfg.recall.castSec + 0.2);
  const f = g.state.settlements[FR];
  ok(Math.hypot(a.x - f.x, a.z - f.z) < f.radius, '숲머리로 돌아왔다');
});

test('v0.3 세이브를 불러오면 창고·거래소·의뢰가 등대 마을 것이 되고 숲머리가 열린다', () => {
  const old = readFileSync(new URL('./fixtures/save-v0.3.json', import.meta.url), 'utf8');
  const before = JSON.parse(old).state;
  const g = loadGame({ data, save: old });
  const st = g.state;
  eq(st.meta.dataVersion, cfg.dataVersion);
  eq(home(st.actors.p1).length, before.actors.p1.storage.length, '창고 보존');
  eq(st.actors.p1.home, LH);
  ok(!('storage' in st.actors.p1), '옛 창고 필드는 없앤다');
  eq(bookOf({ state: st }, LH).asks.length, before.market.asks.length, '팔자 보존');
  ok(bookOf({ state: st }, LH).bids.filter((b) => b.kind === 'town').every((b) => b.owner === LH), '마을 수요의 주인');
  ok(st.orders.every((o) => o.at === LH), '의뢰는 등대 마을 것');
  ok(st.settlements[FR] && st.settlements[FR].stations.length === 2, '숲머리(창고·조리대)');
  eq(st.econ.agents.length, cfg.econ.agents.length, 'AI 개척민 수');
  const f = st.settlements[FR];
  let inside = 0;
  for (const n of Object.values(st.nodes)) if (Math.hypot(n.x - f.x, n.z - f.z) < f.radius + 6) inside++;
  eq(inside, 0, '숲머리 자리 노드');
  g.advance(3600);
  ok(bookOf({ state: st }, FR).bids.some((b) => b.kind === 'town'), '숲머리 수요가 선다');
  const again = loadGame({ data, save: old });
  again.advance(3600);
  eq(again.hash(), g.hash(), '이관 뒤에도 재현된다');
});

console.log('검은 돛·메인 퀘스트 (v0.5)');
// 한 마리만 남긴 싸움터(자리 무리 안의 어느 종류든)
function lone(typeId, seed = 21) {
  const g = createGame({ data, seed, actors: [{ id: 'p1', kind: 'player' }] });
  g.state.econ = null;
  const m = Object.values(g.state.mobs).find((x) => x.type === typeId);
  const grp = g.state.mobGroups[m.group];
  for (const o of Object.values(g.state.mobs)) if (o !== m) delete g.state.mobs[o.id];
  for (const id of Object.keys(g.state.mobGroups)) if (id !== grp.id) delete g.state.mobGroups[id];
  grp.mobs = [m.id];
  return { g, a: g.state.actors.p1, m, grp };
}
const world = (g) => ({ data, terrain: g.terrain, statics: g.statics });

test('약탈자 막기: 앞에서 오는 약공은 75% 줄고, 강공은 막기를 깨뜨려 비틀거리게 한다', () => {
  const { g, a, m } = lone('raider');
  const w = kit('wpn_sword_copper', 50, 'u_w1');
  a.bag.push(w);
  g.dispatch({ type: 'EQUIP', actor: 'p1', uid: 'u_w1' });
  place(g, a, m, 1.6);
  const T = data.creatures.raider;
  const guard = () => {
    m.target = 'p1';
    m.mode = 'guard';
    m.until = g.state.t + 5;
    m.yaw = yawTo(m, a);
  };
  guard();
  let hp0 = m.hp;
  ok(g.dispatch({ type: 'ATTACK', actor: 'p1', kind: 'light' }).ok, '약공');
  g.advance(0.3);
  const full = w.stats.attack * (1 - T.armor / (T.armor + cfg.combat.armorK));
  near(hp0 - m.hp, Math.max(0.5, Math.round(Math.round(full * 10) / 10 * 0.25 * 10) / 10), 1e-6, '막은 피해');
  g.advance(0.4);
  guard();
  hp0 = m.hp;
  let broke = false;
  g.on('mob.guardbreak', () => { broke = true; });
  ok(g.dispatch({ type: 'ATTACK', actor: 'p1', kind: 'heavy' }).ok, '강공');
  g.advance(0.55);
  ok(broke, '막기가 깨진다');
  eq(m.mode, 'recover', '비틀거림');
  near(hp0 - m.hp, Math.round(full * cfg.combat.heavyMult * 10) / 10, 0.11, '강공은 다 들어간다');
});

test('투척꾼의 손도끼: 날아가 맞히고, 구르는 앞부분이면 피한다', () => {
  const { g, a, m } = lone('raider_thrower');
  place(g, a, m, 9);
  m.target = 'p1';
  m.mode = 'chase';
  m.cd = 0;
  let fired = 0;
  g.on('shot.fire', () => fired++);
  for (let i = 0; i < 90 && a.cb.hp === cfg.combat.hp; i++) g.advance(0.1);
  ok(fired >= 1, '던진다');
  near(cfg.combat.hp - a.cb.hp, data.creatures.raider_thrower.dmg, 1e-6, '손도끼 피해(갑옷 없음)');
  // 다음 손도끼: 1.6m 앞까지 오면 옆으로 구른다
  a.cb.hp = cfg.combat.hp;
  a.cb.lastHitAt = -99;
  let dodged = false;
  for (let i = 0; i < 300 && !dodged; i++) {
    g.advance(1 / 30);
    const s = g.state.shots.find((x) => Math.hypot(x.x - a.x, x.z - a.z) < 1.6);
    if (s) {
      ok(g.dispatch({ type: 'DODGE', actor: 'p1', yaw: Math.atan2(s.vz, -s.vx) }).ok, '구르기');
      dodged = true;
    }
  }
  ok(dodged, '두 번째 손도끼');
  g.advance(0.5);
  eq(a.cb.hp, cfg.combat.hp, '피했다');
  ok(a.stats.evaded >= 1, '피함 기록');
});

test('두목: 체력 절반에 부하 둘을 부르고, 상대가 쓰러지면 둥지로 돌아가 처음 단계로·부하는 사라진다', () => {
  const { g, a, m, grp } = lone('raider_captain');
  const w = kit('wpn_battleaxe_iron', 50, 'u_w1');
  const C = data.creatures.raider_captain;
  w.stats.attack = Math.round((C.hp * 0.7) / (1 - C.armor / (C.armor + cfg.combat.armorK)) / cfg.combat.weapons.axe.mult); // 한 방에 체력 30%만 남게
  a.bag.push(w);
  g.dispatch({ type: 'EQUIP', actor: 'p1', uid: 'u_w1' });
  a.cb.hp = a.cb.maxHp = 1e6;
  place(g, a, m, 1.8);
  let said = null;
  g.on('mob.phase', (ev) => { said = ev.say; });
  ok(g.dispatch({ type: 'ATTACK', actor: 'p1', kind: 'light' }).ok, '공격');
  g.advance(0.3);
  ok(m.hp < data.creatures.raider_captain.hp / 2 && m.phase === 1, `단계 ${m.phase} hp ${m.hp}`);
  ok(said && said.length > 4, '대사');
  const adds = () => grp.mobs.map((id) => g.state.mobs[id]).filter((x) => x && x.by === m.id);
  eq(adds().length, 2, '부하 둘');
  ok(adds().every((x) => x.target === 'p1' && x.temp), '부하가 덤빈다');
  a.cb.hp = 1;
  a.cb.downUntil = g.state.t + 60; // 쓰러진 셈
  g.advance(25);
  eq(m.mode === 'idle' || m.mode === 'wander', true, `두목 상태 ${m.mode}`);
  eq(m.hp, data.creatures.raider_captain.hp, '체력 회복');
  eq(m.phase, 0, '처음 단계');
  eq(adds().length, 0, '부하는 사라진다');
});

test('두목의 내려찍기는 막아도 다 들어오고, 휩쓸기는 막으면 줄어든다', () => {
  const { g, a, m } = lone('raider_captain');
  const C = data.creatures.raider_captain;
  a.cb.hp = a.cb.maxHp = 1000;
  place(g, a, m, 1.6);
  ok(g.dispatch({ type: 'BLOCK', actor: 'p1', on: true }).ok, '막기');
  const hit = (id) => {
    const hp0 = a.cb.hp;
    m.target = 'p1';
    m.yaw = yawTo(m, a);
    m.atk = { i: C.attacks.findIndex((x) => x.id === id), t0: g.state.t };
    m.mode = 'windup';
    m.until = g.state.t + 0.05;
    g.advance(0.1);
    a.cb.st = cfg.combat.stamina;
    return hp0 - a.cb.hp;
  };
  const smash = C.attacks.find((x) => x.id === 'smash');
  const sweep = C.attacks.find((x) => x.id === 'sweep');
  near(hit('smash'), C.dmg * smash.mult, 0.11, '내려찍기(막기 무시)');
  near(hit('sweep'), C.dmg * sweep.mult * (1 - cfg.combat.blockCut), 0.11, '휩쓸기(막음)');
});

test('안개 늑대는 밤에만 나온다: 낮엔 숨고, 밤에 마을 사이 들판에 나왔다가 해가 뜨면 사라진다', () => {
  const g = createGame({ data, seed: 7, actors: [{ id: 'p1', kind: 'player' }] });
  g.state.econ = null;
  const wolves = () => Object.values(g.state.mobs).filter((x) => x.type === 'mist_wolf');
  ok(wolves().length >= 8, `늑대 수 ${wolves().length}`);
  ok(wolves().every((x) => x.mode === 'away'), '낮에는 숨는다');
  const T = data.config.time;
  g.advance((T.dayFraction - T.startPhase) * T.secondsPerGameDay + 5);
  ok(g.clock.isNight(g.state.t), '밤');
  ok(wolves().every((x) => x.mode !== 'away'), '밤에는 나온다');
  const band = (x) => (regionAt(data.lists.regions, x.x).id === 'wreck_coast' ? data.creatures.mist_wolf.zband : data.creatures.mist_wolf.regions.swamp_shore.zband);
  ok(Object.values(g.state.mobGroups).filter((x) => x.type === 'mist_wolf').every((x) => x.z >= band(x)[0] && x.z <= band(x)[1]), '들판 띠');
  g.advance((1 - T.dayFraction) * T.secondsPerGameDay + 5);
  ok(!g.clock.isNight(g.state.t), '아침');
  ok(wolves().every((x) => x.mode === 'away'), '해가 뜨면 사라진다');
});

test('1~3장(등대섬 → 본섬)을 처음부터: 생활 단계·대장간 사업·배 고치기·안개 벽 건너기까지 막히는 데 없이 19개, 건너면 해금·보상·현상금', () => {
  const g = createGame({ data, seed: 7, actors: [{ id: 'p1', kind: 'player' }] });
  g.state.econ = null;
  const st = g.state;
  const a = st.actors.p1;
  const W = world(g);
  const w = kit('wpn_sword_iron', 60, 'u_god');
  w.stats.attack = 5000;
  a.bag.push(w);
  g.dispatch({ type: 'EQUIP', actor: 'p1', uid: 'u_god' });
  a.cb.hp = a.cb.maxHp = 1e6;
  const warp = (x, z) => Object.assign(a, { x, z, move: null, dest: null, nav: null });
  const slay = (m) => {
    warp(m.x + Math.sin(m.yaw) * 1.2, m.z + Math.cos(m.yaw) * 1.2);
    a.yaw = Math.atan2(m.x - a.x, m.z - a.z);
    a.cb.act = null;
    ok(g.dispatch({ type: 'ATTACK', actor: 'p1', kind: 'light', yaw: a.yaw }).ok, '공격 거절');
    g.advance(0.6);
  };
  const events = [];
  for (const k of ['quest.done', 'chapter.done', 'quest.wave', 'quest.fail', 'loot', 'quest.grant', 'quest.stepReward', 'unlock', 'story.pause', 'cross']) g.on(k, (ev) => events.push(ev));
  const town = (sid) => g.state.settlements[sid];
  const toStation = (sid, type) => {
    const t = town(sid).stations.find((x) => x.type === type);
    warp(t.x + 1.6, t.z + 1.6);
  };
  const toMarket = (sid) => {
    const m = g.statics.find((o) => o.kind === 'market' && o.at === sid);
    warp(m.x + 2.5, m.z + 2.5);
  };
  const food = () => {
    let e = a.bag.find((x) => data.items[x.item].kind === 'consumable' && data.items[x.item].buff);
    if (!e) {
      const def = data.items.food_meat;
      e = { item: 'food_meat', lot: null, bonus: null, stats: convertStats(def.statConvert, Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, 45]))), star: 2, qty: 1 };
      a.bag.push(e);
    }
    return e;
  };
  // 잠긴 기능: 1~2장 동안 주문·운송·사업(대장간 퀘스트 밖)은 거절한다
  eq(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'x' }).error, 'locked', '주문 잠김');
  eq(g.dispatch({ type: 'SHIP', actor: 'p1', to: 's_forest', key: 'x' }).error, 'locked', '운송 잠김');
  const main = data.chapters.flatMap((c) => c.quests);
  let guard = 0;
  let midSave = null;
  while (guard++ < 400) {
    const id = main.find((q) => a.quests.active[q]);
    if (!id) break;
    const p = a.quests.active[id];
    const step = data.quests[id].steps[p.step];
    if (step.type === 'talk') {
      const n = npcPos(W, step.npc);
      warp(n.x + 1.2, n.z);
      if (step.take) {
        // 건네기(v0.6): 모자라면 거절, 채우면 넘어가며 가져간다
        eq(g.dispatch({ type: 'TALK', actor: 'p1', npc: step.npc }).error, 'need_items', `${id} 재료 모자람`);
        for (const [item, q] of Object.entries(step.take)) a.bag.push({ item, lot: null, bonus: null, qty: q + 1 });
      }
      const had = Object.fromEntries(Object.keys(step.take || {}).map((it) => [it, countItem([a.bag], it)]));
      ok(g.dispatch({ type: 'TALK', actor: 'p1', npc: step.npc }).ok, `${id} 대화`);
      for (const [item, q] of Object.entries(step.take || {})) eq(countItem([a.bag], item), had[item] - q, `${item} 건넴`);
    } else if (step.type === 'go') {
      const s = sitePos(W, step.site);
      warp(s.x, s.z);
      g.advance(1.1);
    } else if (step.type === 'use') {
      const o = step.objs.find((x) => !p.used.includes(x));
      const pos = objPos(W, o);
      warp(pos.x + 1.0, pos.z);
      if (data.objects[o].cross) {
        // 안개 벽(v0.6): 등대섬 창고 짐을 갈대 나루 창고로, 귀환 지점도 나루로
        storeOf(a, 's_forest').push({ item: 'stone', lot: null, bonus: null, qty: 7 });
        storeOf(a, 's_lighthouse').push({ item: 'stone', lot: null, bonus: null, qty: 5 });
        a.stoneBefore = ['s_forest', 's_lighthouse', 's_port'].reduce((n, sid) => n + countItem([storeOf(a, sid)], 'stone'), 0);
      }
      ok(g.dispatch({ type: 'QUEST_USE', actor: 'p1', obj: o }).ok, `${id} ${o}`);
      if (data.objects[o].cross) {
        eq(regionAt(data.lists.regions, a.x).id, 'swamp_shore', '본섬에 닿았다');
        eq(a.home, 's_port', '귀환 지점은 갈대 나루');
        eq(countItem([storeOf(a, 's_port')], 'stone'), a.stoneBefore, '창고 짐이 나루로');
        delete a.stoneBefore;
        eq(storeOf(a, 's_forest').length + storeOf(a, 's_lighthouse').length, 0, '등대섬 창고는 비었다');
        eq(g.dispatch({ type: 'RECALL', actor: 'p1' }).ok, true, '나루로 귀환');
        g.advance(12);
      }
    } else if (step.type === 'kill') {
      const s = step.site ? sitePos(W, step.site) : null;
      const pick = () => Object.values(st.mobs).filter((x) => x.mode !== 'dead' && x.mode !== 'away' && step.mobs.includes(x.type) && (!s || Math.hypot(x.x - s.x, x.z - s.z) < s.r + 20))
        .sort((x, y) => Math.hypot(x.x - a.x, x.z - a.z) - Math.hypot(y.x - a.x, y.z - a.z))[0];
      let m = pick();
      // 앞 단계에서 휩쓸려 쓰러졌으면 다시 날 때까지 기다린다
      for (let k = 0; !m && k < 120; k++) {
        if (k === 0) process.stdout.write(`    (${id}: ${step.mobs.join('/')} 다시 나기를 기다림)\n`);
        g.advance(10);
        m = pick();
      }
      ok(m, `${id}: 쓰러뜨릴 ${step.mobs.join('/')}가 없다`);
      slay(m);
    } else if (step.type === 'have') {
      // 모았거나 만든 셈 치고 넣어 준다(채집·제작이 되는지는 다른 시험이 본다)
      if (step.need) for (const [item, n] of Object.entries(step.need)) a.bag.push({ item, lot: null, bonus: null, qty: n });
      else {
        const item = step.any[0];
        if (data.items[item].kind === 'equipment') {
          const e = kit(item, 40, `u_${item}`);
          a.bag.push(e);
          if (step.equip) ok(g.dispatch({ type: 'EQUIP', actor: 'p1', uid: e.uid }).ok, `${id} 입기`);
        } else a.bag.push({ item, lot: null, bonus: null, qty: step.count || 1 });
      }
      g.advance(1.1);
    } else if (step.type === 'eat') {
      ok(g.dispatch({ type: 'EAT', actor: 'p1', key: keyOf(food()) }).ok, `${id} 먹기`);
    } else if (step.type === 'store') {
      toStation(step.at, 'storage');
      a.bag.push({ item: 'stone', lot: null, bonus: null, qty: 2 });
      ok(g.dispatch({ type: 'STORE', actor: 'p1', key: keyOf(a.bag.find((e) => e.item === 'stone')) }).ok, `${id} 맡기기`);
    } else if (step.type === 'sell') {
      toMarket(step.at);
      a.bag.push({ item: 'stone', lot: null, bonus: null, qty: 3 });
      ok(g.dispatch({ type: 'MARKET_DUMP', actor: 'p1', key: keyOf(a.bag.find((e) => e.item === 'stone')) }).ok, `${id} 팔기`);
    } else if (step.type === 'repair') {
      // 고칠 게 없으면 저절로 넘어간다. 여기선 무기를 닳게 해서 실제로 고친다
      w.dur = Math.max(1, w.maxDur - 30);
      toStation('s_lighthouse', 'forge');
      a.silver += 200;
      ok(g.dispatch({ type: 'REPAIR', actor: 'p1', uid: w.uid }).ok, `${id} 고치기`);
    } else if (step.type === 'project') {
      const def = data.projects[step.project];
      toStation(def.at, 'storage');
      eq(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: 'pj_f_tannery', silver: 1 }).error, 'locked', '다른 사업은 잠김');
      for (const [item, n] of Object.entries(def.needs)) {
        a.bag.push({ item, lot: null, bonus: null, qty: n });
        for (let k = 0; k < 6 && n - (g.state.projects[step.project].got[item] || 0) > 0; k++) {
          ok(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: step.project, key: keyOf(a.bag.find((e) => e.item === item)) }).ok, `${item} 내기`);
        }
      }
      a.silver += def.silver;
      ok(g.dispatch({ type: 'CONTRIBUTE', actor: 'p1', project: step.project, silver: def.silver - g.state.projects[step.project].silver }).ok, '은화 내기');
      ok(g.state.projects[step.project].done, '대장간이 선다');
      g.advance(1.1);
    } else if (step.type === 'defend') {
      const s = sitePos(W, step.site);
      if (!p.ev) {
        warp(s.x, s.z);
        g.advance(1.1);
        ok(p.ev, '습격대가 온다');
        if (!midSave) {
          midSave = g.save();
          const copy = loadGame({ data, save: midSave });
          const h0 = copy.hash();
          eq(h0, g.hash(), '습격 중 저장 왕복');
        }
        continue;
      }
      const left = Object.values(st.mobs).filter((x) => x.event === p.ev.id && x.mode !== 'dead');
      if (left.length) slay(left[0]);
      else g.advance(1.1);
    }
  }
  for (const q of main) ok(a.quests.done[q] != null, `${q} 못 끝냄`);
  eq(Object.keys(a.quests.items).length, 0, '퀘스트 물건은 돌려줬다');
  ok(events.some((e) => e.type === 'chapter.done' && e.chapter === 'ch1' && e.next === 'ch2'), '1장 끝 → 2장');
  ok(events.some((e) => e.type === 'chapter.done' && e.chapter === 'ch2' && e.next === 'ch3'), '2장 끝 → 3장');
  ok(events.some((e) => e.type === 'story.pause' && e.chapter === 'ch3'), '3장은 이어질 이야기가 남았다');
  ok(!events.some((e) => e.type === 'chapter.done' && e.chapter === 'ch3'), '3장은 아직 끝이 아니다');
  eq(events.filter((e) => e.type === 'quest.wave').length, 4, '습격 두 번 × 두 물결');
  ok(a.marks?.lantern_mark != null && events.some((e) => e.type === 'quest.grant'), '등불의 각인');
  ok(events.some((e) => e.type === 'quest.stepReward' && e.reward.items.some((x) => x.item === 'wpn_sword_copper')), '강두의 구리 검');
  ok(a.bag.some((e) => e.item === 'wpn_sword_iron' && e.crafter === '숲머리 대장장이'), '숲머리 대장장이의 철 검');
  const un = events.find((e) => e.type === 'unlock');
  eq(un?.quest, 'c3_wall', '본섬에 건너가면 열린다');
  eq([...un.ids].sort().join(), 'orders,projects,rumors,transport', '경제 넷이 열린다');
  ok(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'x' }).error !== 'locked', '주문 열림');
  ok(a.bag.some((e) => e.item === 'wpn_club' && e.crafter === '해림'), '해림의 몽둥이');
  ok(a.bag.some((e) => e.item === 'ingot_iron') && a.bag.some((e) => e.item === 'leather'), '재료 보상');
  const silver = data.lists.quests.filter((q) => q.kind === 'main').reduce((s, q) => s + (q.reward?.silver || 0), 0);
  ok(a.silver >= cfg.market.startSilver + silver, `은화 ${a.silver}`);
  ok(events.some((e) => e.type === 'loot' && e.silver > 0), '약탈자 전리품');
  // 현상금: 게시판 앞에서 받고, 다 채우면 바로 끝난다. 하루 한 번
  const board = g.statics.find((o) => o.kind === 'board');
  warp(board.x + 1.5, board.z);
  ok(g.dispatch({ type: 'QUEST_ACCEPT', actor: 'p1', quest: 'b_raider' }).ok, '현상금 받기');
  eq(g.dispatch({ type: 'QUEST_ACCEPT', actor: 'p1', quest: 'b_raider' }).error, 'not_available', '두 번은 못 받는다');
  const s0 = a.silver;
  g.advance(320); // 야영지 약탈자가 다시 난다
  for (let i = 0; i < 5; i++) {
    const m = Object.values(st.mobs).filter((x) => x.mode !== 'dead' && x.mode !== 'away' && data.creatures[x.type].faction === 'blacksail' && x.type !== 'raider_captain')[0];
    ok(m, '약탈자가 남아 있다');
    slay(m);
  }
  ok(a.quests.done.b_raider != null && !a.quests.active.b_raider, '현상금 끝');
  ok(a.silver - s0 >= data.quests.b_raider.reward.silver, '현상금 은화');
  warp(board.x + 1.5, board.z);
  eq(g.dispatch({ type: 'QUEST_ACCEPT', actor: 'p1', quest: 'b_raider' }).error, 'not_available', '오늘은 끝');
});

test('1장을 끝낸 개척자에게 2장이 이어지고, 돌 해태는 이야기를 받기 전엔 돌이며(꼼짝·무적), 받은 뒤 다가가면 몸을 일으킨다', () => {
  const g = createGame({ data, seed: 7, actors: [{ id: 'p1', kind: 'player' }] });
  g.state.econ = null;
  const a = g.state.actors.p1;
  // v0.5에서 1장을 끝낸 세이브처럼: 끝낸 퀘스트만 있고 하는 것은 없다
  a.quests.active = {};
  for (const id of data.chapters[0].quests) a.quests.done[id] = 1;
  g.advance(1.1);
  ok(a.quests.active.c2_dim, '2장 첫 퀘스트');
  const st = g.state;
  const hae = Object.values(st.mobs).find((m) => m.type === 'stone_haetae');
  const p0 = [hae.x, hae.z, hae.yaw];
  g.advance(40);
  eq([hae.x, hae.z, hae.yaw].join(), p0.join(), '석상은 그대로');
  // 옛터 망령 하나를 건드려도 해태는 깨지 않는다
  const w = Object.values(st.mobs).find((m) => m.type === 'mist_wraith' && m.group === hae.group);
  a.x = w.x + 2;
  a.z = w.z;
  a.cb.hp = a.cb.maxHp = 1e6;
  g.advance(2);
  ok(w.target === 'p1', '망령이 덤빈다');
  eq(hae.target, null, '해태는 잔다');
  // 이야기를 받기 전: 바로 옆에 서도 깨지 않고, 때려도 칼날이 튕겨 나온다
  const imm = [];
  g.on('mob.immune', (ev) => imm.push(ev));
  Object.assign(a, { x: hae.x + Math.sin(hae.yaw) * 1.6, z: hae.z + Math.cos(hae.yaw) * 1.6, move: null, dest: null, nav: null });
  g.advance(1);
  eq(hae.target, null, '퀘스트 전엔 깨지 않는다');
  a.yaw = Math.atan2(hae.x - a.x, hae.z - a.z);
  a.cb.act = null;
  ok(g.dispatch({ type: 'ATTACK', actor: 'p1', kind: 'light', yaw: a.yaw }).ok, '공격');
  g.advance(0.8);
  eq(hae.hp, data.creatures.stone_haetae.hp, '돌이라 안 다친다');
  ok(imm.length >= 1, '튕겨 나옴');
  eq(hae.target, null, '때려도 깨지 않는다');
  // 「돌 해태」를 받으면 다가갈 때 몸을 일으키고(rise), 다 일어서면 덤빈다
  a.x = hae.x + 12;
  g.advance(0.5);
  a.quests.active.c2_haetae = { step: 0, n: 0, used: [], t: g.state.t };
  a.x = hae.x + 4;
  g.advance(0.5);
  eq(hae.mode, 'rise', '일어서는 중');
  eq(hae.target, 'p1', '노린다');
  g.advance(data.creatures.stone_haetae.rise + 0.2);
  ok(['chase', 'windup', 'recover', 'charge'].includes(hae.mode), `덤빈다 (${hae.mode})`);
});

test('v0.4 세이브를 불러오면 1장 첫 퀘스트가 생기고, 약탈단 자리·안개 늑대가 더해지며 있던 무리는 그대로다', () => {
  const old = readFileSync(new URL('./fixtures/save-v0.4.json', import.meta.url), 'utf8');
  const before = JSON.parse(old).state;
  const g = loadGame({ data, save: old });
  const st = g.state;
  eq(st.meta.dataVersion, cfg.dataVersion);
  ok(st.actors.p1.quests.active.q1_ashore, '첫 퀘스트');
  const count = (groups, t) => Object.values(groups).filter((x) => x.type === t && !x.site && x.x < 600).length; // 등대섬만(v0.6 본섬 무리 빼고)
  for (const t of ['crab', 'deer', 'boar', 'wolf']) eq(count(st.mobGroups, t), count(before.mobGroups, t), `${t} 무리 수`);
  eq(count(st.mobGroups, 'mist_wolf'), data.creatures.mist_wolf.groups, '안개 늑대 무리');
  for (const s of ['lookout', 'camp', 'cove']) ok(Object.values(st.mobGroups).some((x) => x.site === s), `${s} 무리`);
  const W = world(g);
  for (const s of ['lookout', 'camp', 'cove']) {
    const c = sitePos(W, s);
    for (const grp of Object.values(st.mobGroups)) if (!grp.site) ok(Math.hypot(grp.x - c.x, grp.z - c.z) > c.r + 10, `${s} 곁 ${grp.type} 무리`);
    for (const n of Object.values(st.nodes)) ok(Math.hypot(n.x - c.x, n.z - c.z) > c.r + 3, `${s} 안 노드 ${n.type}`);
  }
  ok(Array.isArray(st.shots), '손도끼 칸');
  g.advance(900);
  const again = loadGame({ data, save: old });
  again.advance(900);
  eq(again.hash(), g.hash(), '이관 뒤에도 재현된다');
});

test('v0.5 세이브(1장 끝)를 불러오면 2장이 이어지고, 옛 등불터·밤 망령이 더해지며 있던 무리·노드는 그대로다', () => {
  const old = readFileSync(new URL('./fixtures/save-v0.5.json', import.meta.url), 'utf8');
  const before = JSON.parse(old).state;
  const g = loadGame({ data, save: old });
  const st = g.state;
  eq(st.meta.dataVersion, cfg.dataVersion);
  eq(st.meta.engine, '0.6.0');
  const count = (groups, t) => Object.values(groups).filter((x) => x.type === t && !x.site && x.x < 600).length; // 등대섬만(v0.6 본섬 무리 빼고)
  for (const t of ['crab', 'deer', 'boar', 'wolf', 'mist_wolf']) eq(count(st.mobGroups, t), count(before.mobGroups, t), `${t} 무리 수`);
  eq(count(st.mobGroups, 'mist_wraith'), data.creatures.mist_wraith.groups, '밤 망령 무리');
  const ruins = Object.values(st.mobGroups).find((x) => x.site === 'old_lantern');
  ok(ruins, '옛 등불터 무리');
  eq(ruins.mobs.map((id) => st.mobs[id].type).sort().join(), 'mist_wraith,mist_wraith,mist_wraith,mist_wraith,mist_wraith,stone_haetae', '해태 하나와 망령 다섯');
  for (const s of ['lookout', 'camp', 'cove']) eq(Object.values(st.mobGroups).filter((x) => x.site === s).length, 1, `${s} 무리는 하나`);
  // 있던 짐승 무리는 그 자리(새 자리와 겹친 것만 옮긴다)
  const W = world(g);
  const newSites = ['old_lantern', 'mainland_wreck'].map((s) => sitePos(W, s));
  let kept = 0;
  for (const [id, grp] of Object.entries(before.mobGroups)) {
    const now = st.mobGroups[id];
    ok(now, `무리 ${id} 남음`);
    if (now.x === grp.x && now.z === grp.z) kept++;
  }
  ok(kept >= Object.keys(before.mobGroups).length - 3, `제자리 무리 ${kept}`);
  for (const c of newSites) {
    for (const n of Object.values(st.nodes)) ok(Math.hypot(n.x - c.x, n.z - c.z) > c.r + 3, `${c.id} 안 노드 ${n.type}`);
    for (const grp of Object.values(st.mobGroups)) if (!grp.site && !grp.temp) ok(Math.hypot(grp.x - c.x, grp.z - c.z) > c.r + 10, `${c.id} 곁 ${grp.type} 무리`);
  }
  // 1장을 끝낸 개척자: 첫 틱에 2장 첫 퀘스트를 받는다
  const a = st.actors.p1;
  ok(!a.quests.active.c2_dim, '불러온 직후엔 아직');
  g.advance(1.1);
  ok(a.quests.active.c2_dim, '2장 첫 퀘스트');
  eq(a.quests.track, 'c2_dim', '추적');
  g.advance(900);
  const again = loadGame({ data, save: old });
  again.advance(901.1);
  eq(again.hash(), g.hash(), '이관 뒤에도 재현된다');
});

test('등대섬 해금(v0.5.2): 사람은 3장 전까지 주문·운송·사업이 잠기고(대장간 퀘스트만 예외), 봇은 잠기지 않는다', () => {
  const g = createGame({ data, seed: 3, actors: [{ id: 'p1', kind: 'player' }, { id: 'b1', kind: 'bot', ai: 'settler' }] });
  g.state.econ = null;
  const a = g.state.actors.p1;
  const b = g.state.actors.b1;
  const qctx = { state: g.state, data };
  for (const id of ['orders', 'projects', 'transport', 'rumors']) {
    ok(!isUnlocked(qctx, a, id), `${id} 잠김`);
    ok(isUnlocked(qctx, b, id), `봇 ${id} 열림`);
  }
  ok(!allowedProject(qctx, a, 'pj_f_forge'), '대장간 사업도 퀘스트 전엔 잠김');
  a.quests.active = { c2_forge: { step: 1, n: 0, used: [], t: 0 } };
  ok(allowedProject(qctx, a, 'pj_f_forge') && !allowedProject(qctx, a, 'pj_f_tannery'), '대장간 퀘스트 동안 그 사업만');
  // 2장까지 끝내면 3장에 들어선 셈: 경제 넷이 열리고, 4장 것은 그대로 잠겨 있다
  a.quests.active = {};
  for (const ch of data.chapters) for (const id of ch.quests) a.quests.done[id] = 1;
  ok(chapterReached(qctx, a, 'ch3') && !chapterReached(qctx, a, 'ch4'), '3장에 들어섰다');
  for (const id of ['orders', 'projects', 'transport', 'rumors']) ok(isUnlocked(qctx, a, id), `${id} 열림`);
  ok(!isUnlocked(qctx, a, 'faction'), '세력은 4장');
});

test('생활 단계(v0.5.2): 가진 것은 1초마다 세고, 이미 다음 것(돌 도구)을 가졌으면 줍기 단계는 지난다', () => {
  const g = createGame({ data, seed: 4, actors: [{ id: 'p1', kind: 'player' }] });
  g.state.econ = null;
  const a = g.state.actors.p1;
  const qctx = { state: g.state, data, statics: g.statics };
  eq(a.quests.active.q1_ashore.step, 0);
  a.bag.push({ item: 'log_drift', lot: null, bonus: null, qty: 2 });
  g.advance(1.1);
  eq(a.quests.active.q1_ashore.step, 0, '돌이 모자라다');
  ok(stepText(qctx, a, 'q1_ashore').includes('표류목 2/2 · 돌 0/3'), stepText(qctx, a, 'q1_ashore'));
  a.bag.push(kit('tool_pick_stone', 30, 'u_pick'));
  g.advance(1.1);
  eq(a.quests.active.q1_ashore.step, 2, '돌 도구가 있으면 두 단계를 넘는다');
  // 고치기: 고칠 것이 없으면 그냥 넘어간다
  a.quests.active = { q7_raid: { step: 1, n: 0, used: [], t: 0 } };
  for (const e of a.bag) if (e.maxDur != null) e.dur = e.maxDur;
  g.advance(1.1);
  eq(a.quests.active.q7_raid?.step, 2, '고칠 게 없으면 넘어간다');
});

test('v0.5.1 세이브(데이터 8)를 불러오면 하던 단계가 새 번호로 옮겨지고, 옛터로 넘어간 개척자는 대장간 퀘스트를 지난다', () => {
  const g0 = createGame({ data, seed: 6, actors: [{ id: 'p1', kind: 'player' }, { id: 'p2', kind: 'player' }] });
  g0.advance(5);
  const obj = JSON.parse(g0.save());
  obj.dataVersion = 8;
  obj.state.meta.dataVersion = 8;
  obj.state.meta.engine = '0.5.1';
  const Q1 = obj.state.actors.p1.quests;
  Q1.active = {
    q1_ashore: { step: 0, n: 0, used: [], t: 1 },
    q3_lookout: { step: 2, n: 3, used: [], t: 1 },
    q4_forest: { step: 0, n: 0, used: [], t: 1 },
    q5_supplies: { step: 1, n: 4, used: [], t: 1 },
    q7_raid: { step: 2, n: 0, used: [], t: 1 },
  };
  const Q2 = obj.state.actors.p2.quests;
  Q2.active = { c2_haetae: { step: 0, n: 0, used: [], t: 1 } };
  Q2.done = Object.fromEntries(['q1_ashore', 'q2_chest', 'q3_lookout', 'q4_forest', 'q5_supplies', 'q6_lt', 'q7_raid', 'q8_captain', 'c2_dim', 'c2_wreck', 'c2_core', 'c2_ruins'].map((id) => [id, 1]));
  // 예전 대장간 사업에 이미 모인 것: 새(줄어든) 요구로는 다 찼다
  Object.assign(obj.state.projects.pj_f_forge, { got: { stone: 30, lumber_drift: 8, nails_copper: 30, ingot_iron: 8 }, silver: 400 });
  const g = loadGame({ data, save: JSON.stringify(obj) });
  const A = g.state.actors.p1.quests.active;
  eq(A.q1_ashore.step, 2, 'q1: 해림 찾기');
  eq(A.q3_lookout.step, 4, 'q3: 망루 약탈자');
  eq(A.q3_lookout.n, 3, '쓰러뜨린 수 유지');
  eq(A.q4_forest.step, 3, 'q4: 여울 만나기');
  eq(A.q5_supplies.step, 2, 'q5: 야영지 약탈자');
  eq(A.q7_raid.step, 3, 'q7: 강두에게 돌아가기');
  const P2 = g.state.actors.p2.quests;
  ok(P2.done.c2_forge != null && !P2.active.c2_forge, '대장간 퀘스트는 지난 것으로');
  ok(P2.active.c2_haetae, '해태는 그대로');
  ok(g.state.projects.pj_f_forge.done, '다 찬 대장간 사업은 바로 선다');
  ok(g.state.settlements.s_forest.stations.some((x) => x.type === 'forge' && x.tier === 2), '숲머리 2단계 대장간');
  g.advance(1.1);
  ok(!P2.active.c2_forge, '메인 잇기가 대장간을 다시 주지 않는다');
});


console.log('안개 벽 너머 (v0.6)');

test('두 섬: 지역은 좌표로 나뉘고, 본섬에 마을 둘·산지·짐승 무리가 따로 있으며, 늪은 물 높이로 내려앉는다', () => {
  const g = createGame({ data, seed: 8 });
  const st = g.state;
  const R = (o) => regionAt(data.lists.regions, o.x).id;
  eq(st.settlements.s_port.region, 'swamp_shore', '갈대 나루');
  eq(st.settlements.s_valley.region, 'swamp_shore', '느티골');
  const nodes = Object.values(st.nodes);
  ok(nodes.filter((n) => R(n) === 'swamp_shore').length > 150, '본섬 노드');
  ok(Object.values(st.veins).filter((v) => v.region === 'swamp_shore' && !v.common).length >= 10, '본섬 산지');
  ok(Object.values(st.mobGroups).some((x) => x.type === 'mist_wraith' && R(x) === 'swamp_shore' && x.z >= 330), '늪 망령');
  // 지역의 노드는 그 지역 서식지에 맞게 난다
  for (const n of nodes) ok(fitsHabitat(g.terrain, regionAt(data.lists.regions, n.x), data.nodes[n.type], n.x, n.z), `${n.type} 서식지`);
  const sw = data.lists.regions[1];
  const wet = [];
  for (let x = 1040; x <= 1420; x += 20) for (let z = 360; z <= 430; z += 10) wet.push(g.terrain.height(x, z));
  ok(wet.filter((h) => h < 0).length > wet.length * 0.3 && wet.every((h) => h > sw.terrain.wadeDepth), '늪: 얕은 물웅덩이(걸을 수 있음)');
  ok(g.terrain.walkable(1110, 366) && g.terrain.height(1110, 366) > 0.5, '물안개 마을은 마른 땅');
  ok(!g.terrain.walkable(700, 30), '섬 사이 바다는 못 걷는다');
  eq(g.statics.filter((o) => o.npc === 'ara').length, 1, '아라는 물안개 마을에');
  eq(g.dispatch({ type: 'MOVE', actor: 'p1', x: 1200, z: 60 }).error, 'out_of_bounds', '다른 섬으로 걸어갈 수 없다');
});

test('두 섬 경제는 따로 돈다: 큰 장터는 본섬, 등대섬엔 작은 장터. 나르기·운송·귀환은 섬을 넘지 못한다', () => {
  const g = createGame({ data, seed: 9, actors: [{ id: 'p1', kind: 'player', }] });
  const st = g.state;
  const homes = (sid) => st.econ.agents.filter((x) => x.home === sid).length;
  ok(homes('s_port') >= 15 && homes('s_valley') >= 8, '본섬 개척민');
  ok(homes('s_lighthouse') > 0 && homes('s_lighthouse') <= 5, '등대섬 작은 장터');
  g.advance(3600 * 4);
  const book = (sid) => bookOf({ state: st }, sid);
  ok(book('s_port').asks.length + book('s_port').bids.length > book('s_lighthouse').asks.length, '본섬 장터가 크다');
  // 상인은 같은 섬 장부에서만 사서 나른다: 등대섬 장부에 본섬 상인 주문이 없다
  const port = new Set(st.econ.agents.filter((x) => regionAt(data.lists.regions, st.settlements[x.home].x).id === 'swamp_shore').map((x) => x.id));
  for (const sid of ['s_lighthouse', 's_forest']) {
    const b = book(sid);
    ok(![...b.asks, ...b.bids].some((o) => o.kind === 'agent' && port.has(o.owner) && o.qty > 0 && o.placedDay >= 1), `${sid}에 본섬 상인 주문`);
  }
  ok(st.orders.length > 0 && st.orders.every((o) => o.at === 's_port' || o.at === 's_valley'), '주문 의뢰는 본섬에서');
  const a = st.actors.p1;
  a.unlockAll = true;
  const lh = st.settlements.s_lighthouse;
  Object.assign(a, { x: lh.x, z: lh.z });
  storeOf(a, 's_lighthouse').push({ item: 'stone', lot: null, bonus: null, qty: 3 });
  eq(g.dispatch({ type: 'SHIP', actor: 'p1', to: 's_port', key: keyOf(storeOf(a, 's_lighthouse')[0]) }).error, 'other_island', '섬 너머 운송');
  a.home = 's_port';
  eq(g.dispatch({ type: 'RECALL', actor: 'p1' }).error, 'other_island', '섬 너머 귀환');
});

test('v0.5.2 세이브(데이터 9)를 불러오면 본섬이 생기고 AI 개척민은 본섬으로 옮겨 가며, 등대섬엔 작은 장터 개척민이 새로 선다', () => {
  const g0 = createGame({ data, seed: 6 });
  g0.advance(5);
  const obj = JSON.parse(g0.save());
  const s = obj.state;
  obj.dataVersion = 9;
  s.meta.dataVersion = 9;
  s.meta.engine = '0.5.2';
  // v0.5.2엔 본섬이 없었다
  const onMain = (x) => x >= 600;
  delete s.regions.swamp_shore;
  delete s.settlements.s_port;
  delete s.settlements.s_valley;
  for (const [id, v] of Object.entries(s.veins)) if (v.region === 'swamp_shore') delete s.veins[id];
  for (const [id, n] of Object.entries(s.nodes)) if (onMain(n.x)) delete s.nodes[id];
  for (const [id, gr] of Object.entries(s.mobGroups)) if (onMain(gr.x)) { for (const m of gr.mobs) delete s.mobs[m]; delete s.mobGroups[id]; }
  for (const id of Object.keys(s.projects)) if (id.startsWith('pj_p_') || id.startsWith('pj_v_')) delete s.projects[id];
  delete s.market.books.s_port;
  delete s.market.books.s_valley;
  s.orders = s.orders.filter((o) => o.at !== 's_port' && o.at !== 's_valley');
  s.econ.agents = s.econ.agents.filter((x) => !x.id.startsWith('t'));
  for (const ag of s.econ.agents) ag.home = ag.home === 's_valley' ? 's_forest' : 's_lighthouse';
  const g = loadGame({ data, save: JSON.stringify(obj) });
  const st = g.state;
  eq(st.meta.engine, '0.6.0');
  eq(st.meta.dataVersion, data.config.dataVersion, '데이터 버전');
  ok(st.settlements.s_port && st.settlements.s_valley, '본섬 두 마을');
  ok(Object.values(st.nodes).filter((n) => onMain(n.x)).length > 150, '본섬 노드');
  ok(Object.values(st.mobGroups).some((x) => onMain(x.x) && x.type === 'wolf'), '본섬 늑대');
  ok(st.projects.pj_v_forge && st.projects.pj_p_house1, '본섬 사업');
  eq(st.econ.agents.filter((x) => x.home === 's_port').length, data.config.econ.agents.filter((x) => x.home === 's_port').length, '나루 개척민');
  ok(st.econ.agents.some((x) => x.id === 't1' && x.home === 's_lighthouse'), '등대섬 작은 장터');
  // 이어서 돌아도 막히지 않고, 다시 저장·불러와도 같다
  g.advance(600);
  const again = loadGame({ data, save: g.save() });
  eq(again.hash(), g.hash(), '저장 왕복');
});

console.log(`\n${pass}개 통과, ${fail}개 실패`);
if (fail) process.exit(1);
