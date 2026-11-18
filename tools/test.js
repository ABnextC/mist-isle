// 엔진 테스트. 외부 라이브러리 없이 돈다.
//   node tools/test.js

import { loadData } from './load-data.js';
import { createGame, loadGame } from '../core/game.js';
import {
  craftScores, convertStats, starOf, masterworkChance, avg, refineStep, xpToNext, levelFromXp,
} from '../core/formulas.js';
import { keyOf, effectiveProps } from '../core/inventory.js';

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
  a.x = town.x;
  a.z = town.z;
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

test('상태는 그대로 JSON이 된다 (NaN·undefined 없음)', () => {
  const g = createGame({ data, seed: 2, actors: [{ id: 'b1', kind: 'bot', ai: 'settler' }] });
  g.advance(3600);
  const text = g.save();
  ok(!/NaN|Infinity|undefined/.test(text), '직렬화 불가 값이 있음');
  const again = loadGame({ data, save: text });
  eq(again.hash(), g.hash());
  ok(keyOf(again.state.actors.b1.bag[0] || { item: 'x', lot: null, bonus: null }).length > 0);
});

console.log(`\n${pass}개 통과, ${fail}개 실패`);
if (fail) process.exit(1);
