// 시드 난수 (sfc32).
// 상태 네 칸을 state.rng 배열에 둔다. 저장·불러오기 뒤에도 같은 흐름이 이어진다.
// 코어 안에서는 Math.random을 쓰지 않는다.

export function seedState(seed) {
  let s = seed >>> 0;
  const out = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    out.push(z);
  }
  if (out.every((v) => v === 0)) out[0] = 1;
  return out;
}

// st: [a, b, c, d] — 제자리에서 바뀐다.
export function makeRng(st) {
  function next() {
    const a = st[0], b = st[1], c = st[2], d = st[3];
    const t = (((a + b) >>> 0) + d) >>> 0;
    st[3] = (d + 1) >>> 0;
    st[0] = (b ^ (b >>> 9)) >>> 0;
    st[1] = (c + (c << 3)) >>> 0;
    const rot = ((c << 21) | (c >>> 11)) >>> 0;
    st[2] = (rot + t) >>> 0;
    return t / 4294967296;
  }
  return {
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    range(min, max) { return min + next() * (max - min); },
    chance(p) { return next() < p; },
    pick(arr) { return arr[Math.floor(next() * arr.length)]; },
    // 균등 난수 셋의 합으로 만든 종 모양 값 (평균 0, 표준편차 약 1, 범위 ±3)
    bell() { return (next() + next() + next() - 1.5) / 0.5; },
  };
}
