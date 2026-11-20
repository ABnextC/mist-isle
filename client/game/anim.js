// 모션 캡처 동작 재생(v0.4.6): 서기·걷기·달리기 묶음(clips.json)을 위상으로 뽑아 섞는다.
// 원본은 CMU 모션 캡처 데이터베이스(mocap.cs.cmu.edu)를 tools/animforge가 게임 뼈대로 옮긴 것이다.
import * as THREE from 'three';

let DATA = null;
let loading = null;

export function loadClips(url) {
  if (loading) return loading;
  loading = fetch(url)
    .then((r) => r.json())
    .then((d) => {
      for (const c of Object.values(d.clips)) {
        c.q = new Float32Array(c.q);
        c.h = new Float32Array(c.h);
      }
      DATA = d;
      return d;
    })
    .catch((e) => {
      console.warn('동작 묶음을 못 읽음(손으로 짠 동작을 쓴다)', e);
      return null;
    });
  return loading;
}

export const clips = () => DATA;
export const NB = 19;

// 위상(0~1, 고리)으로 한 장을 뽑아 out(뼈×4)·outH(3)에 쓴다
export function sample(name, phase, out, outH) {
  const c = DATA.clips[name];
  const n = c.n;
  const f = (((phase % 1) + 1) % 1) * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  const o0 = i0 * NB * 4;
  const o1 = i1 * NB * 4;
  for (let b = 0; b < NB; b++) THREE.Quaternion.slerpFlat(out, b * 4, c.q, o0 + b * 4, c.q, o1 + b * 4, t);
  for (let k = 0; k < 3; k++) outH[k] = c.h[i0 * 3 + k] * (1 - t) + c.h[i1 * 3 + k] * t;
}

// 한 번 재생하는 동작: t(0~1)를 끝 장까지(고리로 돌지 않는다)
export function sampleOnce(name, t, out, outH) {
  const c = DATA.clips[name];
  const n = c.n;
  const f = Math.min(1, Math.max(0, t)) * (n - 1);
  const i0 = Math.min(n - 2, Math.floor(f));
  const i1 = i0 + 1;
  const u = f - i0;
  const o0 = i0 * NB * 4;
  const o1 = i1 * NB * 4;
  for (let b = 0; b < NB; b++) THREE.Quaternion.slerpFlat(out, b * 4, c.q, o0 + b * 4, c.q, o1 + b * 4, u);
  for (let k = 0; k < 3; k++) outH[k] = c.h[i0 * 3 + k] * (1 - u) + c.h[i1 * 3 + k] * u;
}

export const hasClip = (name) => !!DATA?.clips[name];

// a ← a·(1−t) + b·t (뼈마다 구면 보간)
export function blend(a, aH, b, bH, t) {
  if (t <= 0) return;
  for (let i = 0; i < NB; i++) THREE.Quaternion.slerpFlat(a, i * 4, a, i * 4, b, i * 4, t);
  for (let k = 0; k < 3; k++) aH[k] += (bH[k] - aH[k]) * t;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
