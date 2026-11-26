// 탈것 걸음(v3.2): 짐승 걸음새(mobs-view의 걷기·속보·질주)를 탈것 빠르기에 맞춰 고른다.
// st: 탈것마다 걸음 상태 { cyc, gait, gaitK, prevA, breathe }. 돌려주는 값: 몸통 출렁임(안장이 오르내리는 양, m)
import { GAITS, legIK, smooth, gaitWeight } from './mobs-view.js';

const PICK = (sp) => (sp < 2.2 ? 'walk' : sp < 6.2 ? 'trot' : 'gallop');

export function poseMount(q, st, dt, speed) {
  const want = PICK(speed);
  if (want !== st.gait) {
    st.gait = want;
    st.gaitK = 0;
    for (let i = 0; i < q.legs.length; i++) st.prevA[i] = [q.legs[i].g.rotation.x, q.legs[i].kn.rotation.x];
  }
  st.gaitK = Math.min(1, st.gaitK + dt / 0.25);
  st.breathe += dt * (speed > 4 ? 4 : 1.4);
  const G = GAITS[st.gait];
  const walk = gaitWeight(speed);
  const strideM = G.stride * q.L;
  st.cyc = (st.cyc + (dt * speed) / strideM) % 1;
  const bob = G.bob * walk * 1.4;
  const lower = 0.04 * q.legs[0].l1;
  const wave = Math.cos(st.cyc * Math.PI * (st.gait === 'gallop' ? 2 : 4));
  for (let i = 0; i < q.legs.length; i++) {
    const L = q.legs[i];
    const reach = L.l1 + L.l2;
    const A = Math.min(0.5 * G.duty * strideM, 0.3 * reach) * walk;
    const p = (st.cyc + G.off[i]) % 1;
    let z;
    let y;
    if (p < G.duty) {
      z = A * (1 - (2 * p) / G.duty);
      y = 0;
    } else {
      const u = (p - G.duty) / (1 - G.duty);
      z = -A + 2 * A * smooth(u);
      y = G.lift * reach * Math.sin(Math.PI * u) * walk;
    }
    const hipY = reach - lower - bob * wave;
    let [a0, a1] = legIK(L.l1, L.l2, z, y - hipY, L.front);
    if (st.gaitK < 1 && st.prevA[i]) {
      const k = smooth(st.gaitK);
      a0 = st.prevA[i][0] + (a0 - st.prevA[i][0]) * k;
      a1 = st.prevA[i][1] + (a1 - st.prevA[i][1]) * k;
    }
    L.g.rotation.x = a0;
    L.kn.rotation.x = a1;
  }
  const y0 = (q.torso.userData.y0 ??= q.torso.position.y);
  const dy = -lower - bob * wave + Math.sin(st.breathe) * 0.004;
  q.torso.position.y = y0 + dy;
  q.torso.rotation.x = G.pitch * walk * Math.sin(st.cyc * Math.PI * 2);
  // 머리: 걸으면 끄덕이고, 서 있으면 가끔 고개를 든다
  q.neck.rotation.x = (q.neck.userData.r0 ??= q.neck.rotation.x) + Math.sin(st.cyc * Math.PI * 4) * 0.06 * walk;
  if (q.tail) q.tail.rotation.x = 0.25 + Math.sin(st.breathe * 1.3) * 0.08 + 0.3 * walk;
  return { dy, pitch: q.torso.rotation.x, cyc: st.cyc, gait: st.gait };
}
