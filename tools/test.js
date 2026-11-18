// 엔진 테스트. 외부 라이브러리 없이 돈다.
//   node tools/test.js

import { loadData } from './load-data.js';
import { createGame, loadGame } from '../core/game.js';
import {
  craftScores, convertStats, starOf, masterworkChance, avg, refineStep, xpToNext, levelFromXp,
} from '../core/formulas.js';
import { keyOf, effectiveProps } from '../core/inventory.js';
import { fitsHabitat } from '../core/terrain.js';
import { readFileSync } from 'node:fs';

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
  const ingot = a.storage.find((e) => e.item === 'ingot_copper');
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
  const mixed = a.storage.find((e) => e.item === 'ingot_copper' && g.state.lots[e.lot].mix);
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

test('등대로 귀환: 6초 뒤 창고 앞으로, 움직이면 취소, 15분 재사용 대기', () => {
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
  eq(Object.keys(g.state.nodes).length, Object.keys(before.nodes).length, '노드 수');
  let bad = 0;
  for (const n of Object.values(g.state.nodes)) if (!fitsHabitat(g.terrain, region, data.nodes[n.type], n.x, n.z)) bad++;
  ok(bad <= 2, `서식지 밖 노드 ${bad}개`);
  eq(JSON.stringify(g.state.actors.p1.skills), JSON.stringify(before.actors.p1.skills), '스킬이 보존되지 않음');
  eq(g.state.actors.p1.storage.length, before.actors.p1.storage.length, '창고가 보존되지 않음');
  eq(g.state.actors.p1.silver, data.config.market.startSilver, '은화(v0.2)');
  eq(g.state.econ.agents.length, data.config.econ.agents.length, 'AI 개척민(v0.2)');
  ok(Array.isArray(g.state.market.asks) && Array.isArray(g.state.orders), '거래소·주문(v0.2)');
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
  g.state.market.asks = [];
  g.state.market.bids = [];
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
  p1.storage.push({ item: 'ingot_copper', lot: null, bonus: null, qty: 5 });
  const key = keyOf(p1.storage[p1.storage.length - 1]);
  ok(g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key, qty: 5, price: 50 }).ok, '팔자 거절');
  eq(p1.silver, start - 3, '수수료(5×50×1%)');
  ok(g.dispatch({ type: 'MARKET_BUY', actor: 'p2', item: 'ingot_copper', minStar: 0, qty: 3, price: 60 }).ok, '사자 거절');
  eq(p2.silver, 1000 - 150, '산 쪽은 걸린 값(50)으로 내고 차액을 돌려받는다');
  eq(p1.silver, start - 3 + 150 - 6, '판 쪽은 판매세 4%를 뺀 값을 받는다');
  eq(p2.storage.filter((e) => e.item === 'ingot_copper').reduce((x, e) => x + e.qty, 0), 3, '산 물건은 창고로');
  eq(g.state.market.asks[0].qty, 2, '남은 팔자');
  eq(g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key, qty: 1, price: 50 }).error, 'no_item', '없는 물건');
});

test('★ 조건 사자는 그 별 이상만 사고, 기한이 지나면 물건·은화를 돌려받는다', () => {
  const g = marketGame();
  const p1 = g.state.actors.p1;
  const p2 = g.state.actors.p2;
  p2.silver = 500;
  p1.storage.push({ item: 'sap_birch', lot: null, bonus: null, qty: 4 });
  const key = keyOf(p1.storage[p1.storage.length - 1]);
  g.dispatch({ type: 'MARKET_SELL', actor: 'p1', key, price: 10 });
  g.dispatch({ type: 'MARKET_BUY', actor: 'p2', item: 'sap_birch', minStar: 3, qty: 4, price: 20 });
  eq(g.state.market.asks.length + g.state.market.bids.length, 2, '★0 팔자와 ★3 사자는 맞지 않는다');
  eq(p2.silver, 500 - 80, '사자는 은화를 맡긴다');
  g.advance(3600 * (cfg.market.orderDays + 1));
  eq(g.state.market.asks.filter((o) => o.kind === 'actor').length + g.state.market.bids.filter((o) => o.kind === 'actor').length, 0, '기한 지난 주문');
  eq(p2.silver, 500, '맡긴 은화를 돌려받는다');
  eq(p1.storage.filter((e) => e.item === 'sap_birch').reduce((x, e) => x + e.qty, 0), 4, '물건을 돌려받는다');
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
  p1.storage.push({ item: 'nails_copper', lot: null, bonus: null, qty: 12 });
  p1.storage.push({ item: 'ingot_copper', lot: null, bonus: null, qty: 5 });
  p1.storage.push({ uid: 'u_t1', item: 'tool_axe_copper', star: 2, dur: 100, stats: { durability: 400 } });
  const s0 = p1.silver;
  ok(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_a' }).ok, '못 납품');
  eq(g.state.orders[0].left, 8, '남은 수량');
  eq(p1.silver, s0 + 12 * 7, '보상');
  eq(p1.stats.orders, 12, '납품 기록');
  eq(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_b' }).error, 'nothing_to_deliver', '★0 주괴는 ★3 주문에 못 낸다');
  eq(g.dispatch({ type: 'ORDER_DELIVER', actor: 'p1', order: 'O_c' }).error, 'nothing_to_deliver', '닳은 도구는 못 낸다');
  p1.storage.find((e) => e.uid === 'u_t1').dur = 400;
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
  const total = () => g.state.econ.agents.reduce((x, a) => x + a.silver, 0) + g.state.market.bids.filter((b) => b.kind === 'agent').reduce((x, b) => x + b.escrow, 0);
  g.advance(3600 * 20);
  const mid = total();
  g.advance(3600 * 10);
  const end = total();
  ok(g.state.econ.agents.every((a) => a.silver >= 0 && Number.isFinite(a.silver)), '음수 은화');
  ok(end < mid * 1.25, `20~30일 은화 ${mid} → ${end}`);
  const ctx = { state: g.state, data, cfg };
  const basket = ['log_birch', 'ore_copper', 'lumber_birch', 'ingot_copper', 'cloth_reed', 'food_berry'];
  const idx = basket.reduce((x, it) => x + (g.state.market.ref[it + '|2'] ?? 1) / Math.round(data.items[it].value * cfg.market.starMult[2]), 0) / basket.length;
  ok(idx > 0.6 && idx < 1.3, `물가 지수 ${idx.toFixed(2)}`);
  ok(g.state.orders.length > 0, '주문 게시판이 비었다');
});

console.log(`\n${pass}개 통과, ${fail}개 실패`);
if (fail) process.exit(1);
