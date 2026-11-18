// 노드 재생과 지역 자원 밀도(생태).

import { round3 } from '../formulas.js';

export function nodesTick(ctx) {
  const { state, data, rng } = ctx;
  for (const node of Object.values(state.nodes)) {
    if (node.respawnAt !== null && node.respawnAt <= state.t) {
      const type = data.nodes[node.type];
      node.charges = rng.int(type.charges[0], type.charges[1]);
      node.respawnAt = null;
    }
  }
}

// 게임 1시간마다 밀도가 조금씩 돌아온다.
export function densityHourly(ctx) {
  const { state, cfg } = ctx;
  for (const r of Object.values(state.regions)) {
    for (const f of Object.keys(r.density)) {
      r.density[f] = Math.min(1, round3(r.density[f] + cfg.density.regenPerHour));
    }
  }
}
