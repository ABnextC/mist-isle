// 게임 시간.
// 기본 단위는 '진행 초'다. 플레이 중에는 실시간과 같은 속도로 흐른다.
// 게임 1일 = config.time.secondsPerGameDay 초 (기본 3600초 = 실시간 60분).

export function makeClock(cfg) {
  const dayLen = cfg.time.secondsPerGameDay;
  const hourLen = dayLen / 24;
  const dayFrac = cfg.time.dayFraction;
  return {
    dayLen,
    hourLen,
    day: (t) => Math.floor(t / dayLen),
    hour: (t) => Math.floor(t / hourLen),
    isNight: (t) => (t % dayLen) / dayLen >= dayFrac,
    describe(t) {
      const f = (t % dayLen) / dayLen;
      const night = f >= dayFrac;
      const left = night ? (1 - f) * dayLen : (dayFrac - f) * dayLen;
      return { day: Math.floor(t / dayLen) + 1, night, minutesLeft: Math.ceil(left / 60) };
    },
  };
}

// 진행 초 → '1시간 5분' 같은 플레이 시간 표시
export function fmtPlay(t) {
  const m = Math.floor(t / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}시간 ${m % 60}분` : `${m}분`;
}
