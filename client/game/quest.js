// 퀘스트 길잡이(v0.5): HUD 추적 줄·3D 화살표·미니맵이 지금 따라가는 퀘스트 단계를 본다.
// 메인 퀘스트(장)가 먼저, 없으면 현상금. 예전 생산 단계(개척 일지, v0.4.3)는 일지의 '생활 안내'로 옮겼다(lifeSteps).
// 목표 자리는 그때그때 가장 가까운 것을 고른다(노드는 남은 것만, 작업대는 그 작업대가 있는 가까운 마을).

import { countItem } from '../../core/inventory.js';
import { stepGoal, stepText } from '../../core/systems/quests.js';

// 코어 도우미에 넘기는 읽기 전용 문맥
export const questCtx = (game) => ({ state: game.state, data: game.data, terrain: game.terrain, statics: game.statics, clock: game.clock, cfg: game.data.config });

export function currentQuest(game, a) {
  const Q = a.quests;
  if (!Q) return null;
  const ids = Object.keys(Q.active);
  if (!ids.length) return null;
  const main = (id) => (game.data.quests[id].kind === 'main' ? 0 : 1);
  const id = Q.track && Q.active[Q.track] ? Q.track : ids.sort((x, y) => main(x) - main(y))[0];
  const ctx = questCtx(game);
  const q = game.data.quests[id];
  return { id, kind: q.kind, title: q.name, text: stepText(ctx, a, id), goal: stepGoal(ctx, a, id) };
}

function nearest(a, list) {
  let best = null;
  let bd = Infinity;
  for (const p of list) {
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function nodeGoal(game, a, types, label) {
  const list = Object.values(game.state.nodes).filter((n) => types.includes(n.type) && n.charges > 0);
  const n = nearest(a, list);
  return n ? { x: n.x, z: n.z, label, kind: 'node' } : null;
}

function stationGoal(game, a, type, label, only = null) {
  const list = [];
  for (const s of Object.values(game.state.settlements)) {
    if (only && s.id !== only) continue;
    const st = s.stations.find((x) => x.type === type);
    if (st) list.push({ x: st.x, z: st.z, label: `${s.name} ${label}`, kind: 'station' });
  }
  return nearest(a, list);
}

function boardGoal(game, a, label) {
  const list = game.statics.filter((o) => o.kind === 'board').map((o) => ({ x: o.x, z: o.z, label: `${game.state.settlements[o.at]?.name ?? ''} ${label}`.trim(), kind: 'board' }));
  return nearest(a, list);
}

// 생활 안내(예전 개척 일지): 단계마다 { text, done }
export function lifeSteps(game, a) {
  const stores = Object.values(a.storages || {});
  const lists = [a.bag, ...stores];
  const c = (id) => countItem(lists, id);
  const inBag = (id) => countItem([a.bag], id);
  const m = a.milestones;
  const firstTown = Object.keys(game.state.settlements)[0];
  const steps = [
    {
      done: m.tool_t0 != null || (c('log_drift') >= 2 && c('stone') >= 3),
      text: `바닷가에서 표류목 ${Math.min(2, c('log_drift'))}/2, 돌 ${Math.min(3, c('stone'))}/3 줍기`,
      goal: () => (c('log_drift') < 2 ? nodeGoal(game, a, ['node_driftwood'], '표류목') : nodeGoal(game, a, ['node_stone'], '돌')),
    },
    { done: m.tool_t0 != null, text: '돌 도구 만들기 — 제작(C) → 맨손 제작', goal: () => null },
    {
      done: (a.stats.craft.rc_ingot_copper || 0) > 0,
      text: '구리광석을 캐서 등대 마을 제련로에서 주괴로',
      goal: () => (inBag('ore_copper') > 0 ? stationGoal(game, a, 'smelter', '제련로') : nodeGoal(game, a, ['node_copper'], '구리광석')),
    },
    { done: m.tool_t1 != null, text: '대장간에서 구리 도구 만들기 (대장 4)', goal: () => stationGoal(game, a, 'forge', '대장간') },
    { done: a.stats.eat > 0, text: '조리대에서 음식을 만들어 먹기 — 먹으면 한동안 채집량이 는다', goal: () => stationGoal(game, a, 'kitchen', '조리대') },
    { done: (a.stats.orders || 0) > 0, text: '마을 게시판의 주문을 하나 채워 은화 받기', goal: () => boardGoal(game, a, '게시판') },
    {
      done: Object.values(game.state.veins).some((v) => !v.common && lists.flat().some((e) => e.lot === v.lot)),
      text: '게시판의 산지 소문을 따라가 좋은 재료 캐기',
      goal: () => {
        const rare = new Set(Object.entries(game.state.veins).filter(([, v]) => !v.common).map(([id]) => id));
        const list = Object.values(game.state.nodes).filter((n) => rare.has(n.vein) && n.charges > 0);
        const n = nearest(a, list);
        return n ? { x: n.x, z: n.z, label: '소문난 산지', kind: 'node' } : null;
      },
    },
    { done: Object.keys(a.standing || {}).length > 0, text: '마을 게시판 ‘마을’ 탭에서 마을 사업에 물자나 은화를 내 보기', goal: () => boardGoal(game, a, '게시판') },
    {
      done: Object.keys(a.storages || {}).some((sid) => sid !== firstTown && a.storages[sid].length),
      text: '숲 가장자리의 숲머리에 가서 창고를 써 보기(북쪽 길 끝)',
      goal: () => stationGoal(game, a, 'storage', '창고', Object.keys(game.state.settlements).find((sid) => sid !== firstTown)),
    },
  ];
  return steps.map((s) => ({ text: s.text, done: !!s.done }));
}
