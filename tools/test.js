// 엔진 테스트. 외부 라이브러리 없이 돈다.
//   node tools/test.js

import { loadData } from './load-data.js';
import { startFight } from '../core/ai/fighter.js';
import { createGame, loadGame } from '../core/game.js';
import {
  craftScores, convertStats, starOf, masterworkChance, avg, refineStep, xpToNext, levelFromXp,
} from '../core/formulas.js';
import { keyOf, effectiveProps } from '../core/inventory.js';
import { fitsHabitat } from '../core/terrain.js';
import { allOrders, bookOf } from '../core/market.js';
import { storeOf, nearestSettlement } from '../core/world.js';
import { settlementDaily } from '../core/settlements.js';
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
      const n = Object.values(g.state.veins).filter((v) => v.node === vc.node && !v.common).length;
      eq(n, vc.rotating, `${vc.node} 순환 산지 수`);
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
  for (const n of Object.values(g.state.nodes)) if (!fitsHabitat(g.terrain, region, data.nodes[n.type], n.x, n.z)) bad++;
  ok(bad <= 2, `서식지 밖 노드 ${bad}개`);
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
  const ref = bookOf({ state: g.state }, LH).ref;
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
  const nodes = Object.values(g.state.nodes);
  ok(nodes.some((n) => n.type === 'node_oak') && nodes.some((n) => n.type === 'node_iron'), 'T2 노드가 없다');
  for (const n of nodes) {
    const zone = data.nodes[n.type].zone;
    ok(zone ? n.z >= z0 : n.z < z0, `${n.type} ${n.z.toFixed(0)}`);
  }
  const wolves = Object.values(g.state.mobGroups).filter((x) => x.type === 'wolf');
  ok(wolves.length > 0 && wolves.every((x) => x.z >= z0 + data.creatures.wolf.deep), '늑대는 숲 깊은 곳');
  ok(Object.values(g.state.mobGroups).filter((x) => x.type === 'crab').every((x) => x.z < z0), '게는 해안');
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
  eq(a.cb.st, data.config.combat.stamina - data.config.combat.dodgeCost, '기력');
  g.advance(0.2);
  eq(a.cb.hp, data.config.combat.hp, '피해를 받았다');
  ok(a.stats.evaded >= 1, '피함 기록');
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

console.log(`\n${pass}개 통과, ${fail}개 실패`);
if (fail) process.exit(1);
