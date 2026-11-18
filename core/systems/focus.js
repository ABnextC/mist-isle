// 집중력 회복과 버프 만료.

export function focusTick(ctx) {
  const { state, cfg } = ctx;
  const per = cfg.focus.regenPerHour / 3600; // 실시간 1시간 기준
  for (const a of Object.values(state.actors)) {
    if (a.focus < cfg.focus.max) a.focus = Math.min(cfg.focus.max, a.focus + per);
    if (a.buffs.length && a.buffs.some((b) => b.endsAt <= state.t)) {
      a.buffs = a.buffs.filter((b) => b.endsAt > state.t);
    }
  }
}
