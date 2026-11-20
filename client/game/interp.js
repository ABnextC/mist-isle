// 틱 사이 보간(v0.4.7): 시뮬레이션은 30Hz로 위치를 계단처럼 바꾼다.
// 화면은 직전 틱 → 지금 틱 위치를 등속으로 잇는다(틱 하나만큼 늦게 보이는 대신 떨림이 없다).
// v에 틱 기록(tk, x0·z0, x1·z1)을 붙여 쓴다. 돌려주는 값: [x, z]
export function tickLerp(v, x, z, tick, alpha) {
  if (v.tk === undefined || tick < v.tk) {
    v.tk = tick;
    v.x0 = v.x1 = x;
    v.z0 = v.z1 = z;
  } else if (tick !== v.tk) {
    const n = tick - v.tk;
    const d = Math.hypot(x - v.x1, z - v.z1);
    if (n > 12 || d > 1.5 * n) {
      // 순간이동(귀환 등)이거나 너무 많이 건너뛰었다 → 바로 그 자리로
      v.x0 = v.x1 = x;
      v.z0 = v.z1 = z;
    } else {
      // 한 장면에 틱이 여럿 지나가면 마지막 틱 직전 위치를 직선으로 어림한다
      const f = (n - 1) / n;
      v.x0 = v.x1 + (x - v.x1) * f;
      v.z0 = v.z1 + (z - v.z1) * f;
      v.x1 = x;
      v.z1 = z;
    }
    v.tk = tick;
  } else if (x !== v.x1 || z !== v.z1) {
    // 틱 밖에서 옮겨졌다 → 곧장
    v.x0 = v.x1 = x;
    v.z0 = v.z1 = z;
  }
  const a = Math.min(1, Math.max(0, alpha));
  return [v.x0 + (v.x1 - v.x0) * a, v.z0 + (v.z1 - v.z0) * a];
}
