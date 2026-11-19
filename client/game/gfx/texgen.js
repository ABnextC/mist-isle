// 절차 생성 재질 텍스처(v0.4.2). 사진 없이 셰이더로 흙·풀·낙엽·모래·바위·자갈과 나무껍질·목재·돌담·지붕을 굽는다.
// 굽는 순서: ① 재질 식을 한 번 돌려 색+높이(half float)와 거칠기를 받는다
//            ② 높이에서 노멀(소벨)과 그늘(AO, 세 반지름)을 계산해 최종 두 장으로 묶는다
//   A: rgb = 바탕색(sRGB), a = 높이        N: rg = 노멀 xy, b = 거칠기, a = 그늘
// 지형 재질 여섯은 텍스처 배열 하나에 담는다(셰이더 텍스처 칸을 아낀다). 모든 무늬는 이음매 없이 반복된다.

import * as THREE from 'three';
import { NOISE, BAKE } from './glsl.js';

// 지형 배열 순서. terrain.js가 이 번호로 층을 고른다.
export const TERRAIN_LAYERS = ['grass', 'litter', 'dirt', 'sand', 'rock', 'gravel'];

// 무늬 조각 함수: 풀잎·잎·잔가지·솔잎·조약돌. aa는 픽셀 한 칸의 크기(칸 단위)라 가장자리가 계단지지 않는다.
const HELP = /* glsl */ `
uniform float uPx;
vec3 stoneColor(float t, vec2 p) {
  vec3 c = t < 0.25 ? vec3(0.42, 0.41, 0.39) : t < 0.45 ? vec3(0.58, 0.56, 0.52) : t < 0.6 ? vec3(0.27, 0.26, 0.25)
    : t < 0.8 ? vec3(0.52, 0.46, 0.36) : vec3(0.47, 0.37, 0.31);
  c = mix(c, vec3(dot(c, vec3(0.333))), 0.35);
  return c * (0.86 + 0.26 * vnoise(p * 3.0));
}
void put(vec3 c, float bh, float rr, float cov, inout vec3 col, inout float h, inout float r) {
  col = mix(col, c, cov);
  h = mix(h, bh, cov);
  r = mix(r, rr, cov);
}
// 풀잎 한 겹: 칸마다 포기 하나, 포기마다 잎 넷. 아래 겹일수록 그늘져 어둡다
void grassBlades(vec2 uv, float per, float seed, float base, float lush, float dens, inout vec3 col, inout float h, inout float r) {
  vec2 x = uv * per;
  vec2 n = floor(x);
  vec2 f = fract(x);
  float aa = per * uPx;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 c = mod(n + g, per);
      vec3 rr = hash32(c + seed * 17.0);
      if (rr.z > dens) continue;
      vec2 root = g + 0.1 + rr.xy * 0.8;
      float a0 = hash12(c * 1.71 + seed) * TAU;
      for (int k = 0; k < 4; k++) {
        vec3 q = hash32(c * 1.37 + seed * 5.0 + float(k) * 11.0);
        float a = a0 + (q.x - 0.5) * 2.6;
        float L = 0.45 + 0.5 * q.y;
        vec2 s = seg(f, root, root + vec2(cos(a), sin(a)) * L);
        float w = (0.09 - 0.072 * s.y) * (0.75 + 0.5 * q.z);
        float cov = 1.0 - smoothstep(w - aa, w + aa * 0.5, s.x);
        if (cov <= 0.0) continue;
        float ac = min(s.x / w, 1.0);
        float bh = base + 0.2 * s.y + 0.05 * (1.0 - ac * ac);
        if (bh <= h) continue;
        vec3 fresh = mix(vec3(0.27, 0.40, 0.10), vec3(0.40, 0.53, 0.15), q.z);
        vec3 dry = mix(vec3(0.52, 0.48, 0.27), vec3(0.65, 0.60, 0.36), q.x);
        float d = smoothstep(0.5, 0.95, (1.0 - lush) + (q.y - 0.5) * 0.5);
        vec3 tipc = mix(fresh, dry, d);
        if (q.x > 0.97) tipc = dry * 0.9;
        vec3 rootc = tipc * vec3(0.35, 0.42, 0.3);
        vec3 bc = mix(rootc, tipc, smoothstep(0.0, 0.8, s.y)) * (0.74 + 0.4 * base) * (0.9 + 0.2 * (1.0 - ac));
        put(bc, bh, 0.8, cov, col, h, r);
      }
    }
  }
}
// 토끼풀 같은 잔잎(세 장)
void cloverLeaves(vec2 uv, float per, float seed, float base, float dens, inout vec3 col, inout float h, inout float r) {
  vec2 x = uv * per;
  vec2 n = floor(x);
  vec2 f = fract(x);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 c = mod(n + g, per);
      vec3 rr = hash32(c * 1.3 + seed * 9.0);
      if (rr.z > dens) continue;
      vec2 ctr = g + 0.25 + rr.xy * 0.5;
      float a1 = hash12(c + seed) * TAU;
      for (int k = 0; k < 3; k++) {
        float a = a1 + float(k) * 2.094;
        vec2 p = rot2(-a) * (f - ctr - vec2(cos(a), sin(a)) * 0.15) / 0.16;
        float vn;
        float cov = leafMask(p, 0.0, 0.8, per * uPx / 0.16, vn);
        if (cov <= 0.0) continue;
        float bh = base + 0.06 + 0.05 * (1.0 - vn * vn);
        if (bh <= h) continue;
        vec3 lc = mix(vec3(0.13, 0.25, 0.06), vec3(0.21, 0.35, 0.09), rr.x) * (0.85 + 0.2 * (1.0 - vn));
        lc = mix(lc, lc * 1.4, (1.0 - smoothstep(0.03, 0.08, abs(length(p - vec2(0.15, 0.0)) - 0.42))) * 0.35);
        put(lc, bh, 0.65, cov, col, h, r);
      }
    }
  }
}
// 떨어진 잎 한 겹(참나무 잎은 갈래가 있다)
void leaves(vec2 uv, float per, float seed, float base, float dens, inout vec3 col, inout float h, inout float r) {
  vec2 x = uv * per;
  vec2 n = floor(x);
  vec2 f = fract(x);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 c = mod(n + g, per);
      vec3 rr = hash32(c * 1.13 + seed * 7.7);
      if (rr.z > dens) continue;
      vec3 qq = hash32(c * 2.71 + seed * 3.3);
      vec2 ctr = g + 0.25 + rr.xy * 0.5;
      float ang = hash12(c * 0.77 + seed * 1.9) * TAU;
      float size = 0.4 + 0.17 * qq.x;
      vec2 p = rot2(-ang) * (f - ctr) / size;
      float oak = step(qq.y, 0.45);
      float vn;
      float cov = leafMask(p, oak, mix(0.42, 0.5, oak), per * uPx / size, vn);
      vec2 st = seg(p, vec2(-1.0, 0.0), vec2(-1.28, 0.04));
      float stem = 1.0 - smoothstep(0.03, 0.03 + per * uPx / size, st.x);
      cov = max(cov, stem);
      if (cov <= 0.0) continue;
      float curl = 0.09 * vn * vn + 0.05 * (1.0 - p.x * p.x);
      float vein = (1.0 - smoothstep(0.012, 0.045, abs(p.y))) * step(abs(p.x), 0.93);
      float bh = base + qq.z * 0.06 + curl - vein * 0.012;
      if (bh <= h) continue;
      float t = qq.z;
      vec3 lc = t < 0.3 ? vec3(0.36, 0.22, 0.12) : t < 0.55 ? vec3(0.47, 0.37, 0.20) : t < 0.85 ? vec3(0.28, 0.21, 0.14) : vec3(0.15, 0.11, 0.07);
      lc *= 0.82 + 0.34 * vnoise(p * 3.0 + rr.xy * 40.0);
      lc = mix(lc, lc * 0.62, vein * 0.6);
      lc *= 1.0 - 0.3 * smoothstep(0.6, 1.0, vn);
      put(lc, bh, 0.7 + 0.2 * t, cov, col, h, r);
    }
  }
}
// 잔가지(곁가지 하나)
void twigs(vec2 uv, float per, float seed, float base, float dens, inout vec3 col, inout float h, inout float r) {
  vec2 x = uv * per;
  vec2 n = floor(x);
  vec2 f = fract(x);
  float aa = per * uPx;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 c = mod(n + g, per);
      vec3 rr = hash32(c * 1.9 + seed * 4.1);
      if (rr.z > dens) continue;
      float a = hash12(c + seed * 2.0) * TAU;
      vec2 a0 = g + 0.5 + (rr.xy - 0.5) * 0.4;
      vec2 d = vec2(cos(a), sin(a)) * 0.45;
      vec2 s = seg(f, a0 - d, a0 + d);
      float w = 0.026 + 0.014 * rr.x;
      vec2 s2 = seg(f, a0 + d * 0.15, a0 + d * 0.15 + rot2(0.65) * d * 0.55);
      float w2 = w * 0.6;
      float c1 = 1.0 - smoothstep(w - aa, w + aa * 0.5, s.x);
      float c2 = 1.0 - smoothstep(w2 - aa, w2 + aa * 0.5, s2.x);
      float cov = max(c1, c2);
      if (cov <= 0.0) continue;
      float ac = c1 >= c2 ? min(s.x / w, 1.0) : min(s2.x / w2, 1.0);
      float bh = base + 0.1 + 0.07 * sqrt(max(0.0, 1.0 - ac * ac));
      if (bh <= h) continue;
      vec3 tc = mix(vec3(0.21, 0.16, 0.11), vec3(0.37, 0.31, 0.24), rr.y) * (0.72 + 0.38 * (1.0 - ac));
      put(tc, bh, 0.85, cov, col, h, r);
    }
  }
}
// 솔잎(가늘고 짧은 갈색 선)
void needles(vec2 uv, float per, float seed, float base, float dens, inout vec3 col, inout float h, inout float r) {
  vec2 x = uv * per;
  vec2 n = floor(x);
  vec2 f = fract(x);
  float aa = per * uPx;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 c = mod(n + g, per);
      for (int k = 0; k < 3; k++) {
        vec3 q = hash32(c * 1.7 + seed + float(k) * 7.1);
        if (q.z > dens) continue;
        vec2 p0 = g + q.xy;
        float a = hash12(c * 3.1 + float(k) + seed) * TAU;
        vec2 d = vec2(cos(a), sin(a)) * 0.42;
        vec2 s = seg(f, p0 - d, p0 + d);
        float w = 0.032;
        float cov = 1.0 - smoothstep(w - aa, w + aa * 0.5, s.x);
        if (cov <= 0.0) continue;
        float bh = base + q.z * 0.08 + 0.03;
        if (bh <= h) continue;
        vec3 nc = mix(vec3(0.33, 0.19, 0.09), vec3(0.50, 0.33, 0.17), fract(q.x * 7.3)) * (0.8 + 0.3 * (1.0 - s.x / w));
        put(nc, bh, 0.78, cov, col, h, r);
      }
    }
  }
}
// 흙에 박힌 둥근 돌(드문드문)
void pebbles(vec2 uv, float per, float size, float dens, float base, float hgt, inout vec3 col, inout float h, inout float r) {
  vec2 rel;
  vec2 cid;
  voro(uv, vec2(per), 0.8, rel, cid);
  vec3 q = hash32(cid * 1.9 + per);
  if (q.x > dens) return;
  vec2 p = rot2(q.y * TAU) * rel;
  p.x *= 0.75 + 0.5 * q.z;
  float rad = size * (0.6 + 0.5 * fract(q.y * 7.3));
  float d = length(p) / rad;
  float cov = 1.0 - smoothstep(1.0 - per * uPx / rad, 1.0, d);
  if (cov <= 0.0) return;
  float dome = sqrt(max(0.0, 1.0 - d * d));
  float ph = base + hgt * dome;
  if (ph <= h) return;
  put(stoneColor(fract(q.z * 13.1), rel * 9.0) * (0.72 + 0.34 * dome), ph, 0.55 + 0.3 * fract(q.x * 5.3), cov, col, h, r);
}
// 빽빽한 자갈(보로노이 칸마다 돌 하나)
void stones(vec2 uv, float per, float gap, float base, float hgt, float dens, inout vec3 col, inout float h, inout float r) {
  vec2 rel;
  vec2 cid;
  vec3 v = voro(uv, vec2(per), 0.95, rel, cid);
  vec3 q = hash32(cid * 2.3 + per * 0.1);
  if (q.x > dens) return;
  float e = v.y - gap;
  float cov = smoothstep(0.0, per * uPx, e);
  if (cov <= 0.0) return;
  float dome = sqrt(clamp(e / 0.3, 0.0, 1.0));
  float ph = base + hgt * (0.7 + 0.3 * q.y) * dome;
  if (ph <= h) return;
  put(stoneColor(q.z, rel * 7.0) * (0.7 + 0.34 * dome), ph, 0.5 + 0.35 * q.y, cov, col, h, r);
}
`;

// 지형 재질: 한 장이 덮는 크기(m)는 terrain.js가 정한다(풀 4, 낙엽 3.5, 흙 4, 모래 5, 바위 7, 자갈 3).
// bump = 높이 1이 몇 m인지 / 한 장 크기, ao = 그늘 세기, cav = 바탕색에 굽는 틈새 그늘
const LAYERS = {
  grass: { bump: 0.014, ao: 2.0, cav: 0.25, code: `
    float b1 = gfbm(uv, 3.0, 5);
    float b2 = gfbm(uv + 0.5, 9.0, 4);
    float b3 = gfbm(uv + 0.21, 30.0, 3);
    vec3 under = mix(vec3(0.12, 0.15, 0.06), vec3(0.19, 0.20, 0.09), b3);
    vec3 soil = mix(vec3(0.17, 0.13, 0.08), vec3(0.25, 0.19, 0.12), b3);
    col = mix(under, soil, smoothstep(0.62, 0.75, b2) * 0.7);
    h = 0.04 * b3;
    r = 0.95;
    float lush = smoothstep(0.15, 0.6, b1);
    grassBlades(uv, 22.0, 1.0, 0.06, lush, 0.95, col, h, r);
    grassBlades(uv, 28.0, 2.0, 0.2, lush, 0.95, col, h, r);
    grassBlades(uv, 35.0, 3.0, 0.34, lush, 0.95, col, h, r);
    cloverLeaves(uv, 30.0, 5.0, 0.4, 0.25 * smoothstep(0.4, 0.62, b2), col, h, r);
    grassBlades(uv, 44.0, 4.0, 0.48, lush, 0.9, col, h, r);
    grassBlades(uv, 56.0, 6.0, 0.62, lush, 0.85, col, h, r);` },
  litter: { bump: 0.011, ao: 2.4, cav: 0.4, code: `
    float b1 = gfbm(uv, 4.0, 5);
    float b2 = gfbm(uv + 0.3, 14.0, 4);
    col = mix(vec3(0.10, 0.07, 0.045), vec3(0.20, 0.15, 0.10), b2);
    h = 0.05 * b2;
    r = 0.92;
    needles(uv, 76.0, 7.0, 0.04, 0.9, col, h, r);
    leaves(uv, 24.0, 1.0, 0.12, 0.9, col, h, r);
    leaves(uv, 29.0, 2.0, 0.26, 0.85, col, h, r);
    twigs(uv, 13.0, 3.0, 0.3, 0.32, col, h, r);
    leaves(uv, 35.0, 3.0, 0.4, 0.75 * smoothstep(0.2, 0.6, b1), col, h, r);
    needles(uv, 61.0, 9.0, 0.48, 0.35, col, h, r);
    leaves(uv, 42.0, 4.0, 0.54, 0.5 * smoothstep(0.35, 0.7, b1), col, h, r);
    float mz = smoothstep(0.6, 0.7, gfbm(uv + 0.61, 5.0, 4) + 0.12 * (gnoise(uv * 60.0, vec2(60.0)) - 0.5));
    if (mz > 0.0) {
      float mf = gnoise(uv * 220.0, vec2(220.0));
      float mf2 = gnoise(uv * 300.0 + 3.0, vec2(300.0));
      float mh = mz * (0.6 + 0.14 * mf + 0.08 * mf2);
      if (mh > h) {
        h = mh;
        col = mix(vec3(0.10, 0.15, 0.05), vec3(0.21, 0.27, 0.09), mf) * (0.8 + 0.3 * mf2);
        r = 0.95;
      }
    }` },
  dirt: { bump: 0.007, ao: 1.8, cav: 0.3, code: `
    vec2 wuv = uv + 0.03 * (vec2(gfbm(uv, 5.0, 3), gfbm(uv + 0.4, 5.0, 3)) - 0.5);
    float b1 = gfbm(wuv, 3.0, 5);
    float b2 = gfbm(wuv + 0.2, 10.0, 4);
    float fine = gfbm(uv, 64.0, 3);
    col = mix(vec3(0.30, 0.23, 0.15), vec3(0.41, 0.34, 0.24), smoothstep(0.35, 0.7, b1));
    col = mix(col, vec3(0.21, 0.16, 0.10), smoothstep(0.55, 0.75, b2) * 0.6);
    col *= 0.88 + 0.24 * fine;
    h = 0.22 * b1 + 0.14 * b2 + 0.06 * fine;
    r = 0.93;
    vec3 vc = voro(wuv, 8.0, 0.9);
    float crack = (1.0 - smoothstep(0.0, 0.018, vc.y)) * smoothstep(0.6, 0.75, b1) * smoothstep(0.4, 0.6, gnoise(uv * 6.0 + 2.7, vec2(6.0)));
    col *= 1.0 - 0.3 * crack;
    h -= 0.08 * crack;
    float dip = smoothstep(0.62, 0.82, gfbm(uv + 0.9, 4.0, 3));
    h -= dip * 0.12;
    col *= 1.0 - dip * 0.22;
    r = mix(r, 0.62, dip * 0.7);
    vec3 soilCol = col;
    pebbles(uv, 38.0, 0.38, 0.14, 0.18, 0.3, col, h, r);
    pebbles(uv, 90.0, 0.4, 0.14, 0.12, 0.2, col, h, r);
    col = mix(col, soilCol, 0.45);` },
  sand: { bump: 0.005, ao: 0.9, cav: 0.15, code: `
    float b1 = gfbm(uv, 3.0, 4);
    vec2 wq = vec2(gfbm(uv, 4.0, 3), gfbm(uv + 0.5, 4.0, 3)) - 0.5;
    float ph = (uv.y + wq.x * 0.09 + wq.y * 0.04) * 42.0 + uv.x * 2.0;
    float rip = fract(ph);
    float ripple = smoothstep(0.0, 0.72, rip) * smoothstep(1.0, 0.78, rip);
    float rk = smoothstep(0.25, 0.65, gfbm(uv + 0.17, 2.0, 3));
    float grain = gnoise(uv * 320.0, vec2(320.0));
    float grain2 = gnoise(uv * 140.0 + 7.0, vec2(140.0));
    col = mix(vec3(0.64, 0.56, 0.42), vec3(0.78, 0.70, 0.55), b1);
    col *= 0.92 + 0.12 * grain2;
    col *= 0.96 + 0.06 * ripple * rk;
    vec3 sp = voro(uv, 170.0, 1.0);
    float spk = (1.0 - smoothstep(0.1, 0.2, sp.x)) * step(0.8, sp.z);
    col = mix(col, vec3(0.24, 0.22, 0.20), spk * 0.55);
    h = 0.4 * ripple * rk + 0.08 * grain + 0.18 * b1;
    r = 0.97;
    pebbles(uv, 24.0, 0.3, 0.05, 0.35, 0.25, col, h, r);
    vec2 srel;
    vec2 scid;
    vec3 sv = voro(uv, vec2(30.0), 0.9, srel, scid);
    vec3 sq = hash32(scid * 4.7);
    if (sq.x < 0.06) {
      vec2 p = rot2(sq.y * TAU) * srel / 0.22;
      float d = length(p * vec2(1.0, 1.4));
      float cov = 1.0 - smoothstep(1.0 - 30.0 * uPx / 0.22, 1.0, d);
      float ribs = 0.5 + 0.5 * cos(atan(p.y, p.x) * 9.0);
      vec3 shc = mix(vec3(0.86, 0.82, 0.74), vec3(0.75, 0.62, 0.52), sq.z) * (0.85 + 0.15 * ribs);
      if (0.45 > h) put(shc, 0.45 + 0.05 * ribs * (1.0 - d), 0.6, cov, col, h, r);
    }` },
  rock: { bump: 0.06, ao: 2.0, cav: 0.4, code: `
    vec2 w = vec2(gfbm(uv, 3.0, 4), gfbm(uv + 0.5, 3.0, 4)) - 0.5;
    vec2 w2 = vec2(gfbm(uv + 0.2, 7.0, 3), gfbm(uv + 0.8, 7.0, 3)) - 0.5;
    // 휘어진 지층. 띠 경계는 부드러운 턱이고, 금은 드문드문 끊긴다
    float t = uv.y * 7.0 + w.x * 1.2 + w2.x * 0.35;
    float band = mod(floor(t), 7.0);
    float fb = fract(t);
    vec3 bq = hash32(vec2(band, 5.0));
    float ledge = smoothstep(0.0, 0.18, fb) * (1.0 - 0.35 * smoothstep(0.75, 1.0, fb));
    float rough = ridged(uv + w * 0.06, vec2(12.0), 4);
    float fac = facets(uv + w * 0.05, vec2(8.0, 10.0), 9.0, 3.0);
    float fac2 = facets(uv + w2 * 0.03, vec2(18.0, 22.0), 12.0, 9.0);
    float vj = fracture(uv + w * 0.08 + w2 * 0.03, vec2(4.0, 2.0), 0.022, 2.0) * smoothstep(0.42, 0.58, gnoise(uv * vec2(3.0, 4.0) + 0.7, vec2(3.0, 4.0)));
    float bedLine = (1.0 - smoothstep(0.0, 0.09, fb)) * smoothstep(0.35, 0.6, gnoise(uv * vec2(5.0, 7.0) + 2.1, vec2(5.0, 7.0)));
    h = 0.25 + bq.z * 0.2 + ledge * 0.25 + fac * 0.2 + fac2 * 0.1 + rough * 0.15;
    h -= vj * 0.2 + bedLine * 0.15;
    vec3 base = mix(vec3(0.31, 0.29, 0.27), vec3(0.45, 0.42, 0.38), bq.z);
    base = mix(base, vec3(0.42, 0.36, 0.29), step(0.72, bq.y) * 0.45);
    base *= 0.86 + 0.2 * rough + 0.14 * (fac - 0.4);
    base *= mix(0.78, 1.0, ledge);
    float streak = smoothstep(0.55, 0.8, gnoise(vec2(uv.x * 40.0, uv.y * 3.0), vec2(40.0, 3.0))) * (0.3 + 0.7 * fb);
    base *= 1.0 - 0.2 * streak;
    float c = max(vj, bedLine * 0.8);
    col = base * (1.0 - 0.32 * c);
    float lic = smoothstep(0.66, 0.72, gfbm(uv + 0.7, 9.0, 4)) * (1.0 - c);
    float lt = gnoise(uv * 5.0, vec2(5.0));
    vec3 licC = lt < 0.45 ? vec3(0.63, 0.57, 0.34) : lt < 0.68 ? vec3(0.67, 0.67, 0.59) : vec3(0.60, 0.42, 0.17);
    col = mix(col, licC, lic * 0.65);
    h += lic * 0.03;
    r = mix(0.82, 0.95, lic) - c * 0.05;` },
  gravel: { bump: 0.012, ao: 2.6, cav: 0.45, code: `
    float b1 = gfbm(uv, 4.0, 4);
    col = mix(vec3(0.42, 0.37, 0.29), vec3(0.55, 0.49, 0.38), b1) * (0.9 + 0.2 * gnoise(uv * 200.0, vec2(200.0)));
    h = 0.1 * b1;
    r = 0.95;
    stones(uv, 24.0, 0.08, 0.25, 0.42, 0.7, col, h, r);
    stones(uv, 45.0, 0.09, 0.15, 0.3, 0.75, col, h, r);
    pebbles(uv, 96.0, 0.4, 0.5, 0.1, 0.16, col, h, r);` },

  // ── 물건 재질 ──
  boulder: { bump: 0.05, ao: 1.8, cav: 0.35, code: `
    vec2 w = vec2(gfbm(uv, 3.0, 3), gfbm(uv + 0.5, 3.0, 3)) - 0.5;
    vec2 p = uv + w * 0.06;
    float fac = facets(p, vec2(5.0), 9.0, 1.0);
    float fac2 = facets(p, vec2(12.0), 12.0, 7.0);
    float big = gfbm(p, 3.0, 5);
    float rough = ridged(p, vec2(9.0), 4);
    // 광물 알갱이: 작은 칸마다 검은 운모·흰 장석·회색 석영
    vec2 grel;
    vec2 gcid;
    voro(uv, vec2(90.0), 1.0, grel, gcid);
    vec3 gq = hash32(gcid * 3.7);
    vec3 base = mix(vec3(0.30, 0.29, 0.27), vec3(0.47, 0.45, 0.42), big);
    base *= 0.84 + 0.3 * clamp(fac, 0.0, 1.0);
    base = gq.x < 0.12 ? mix(base, vec3(0.13), 0.4) : gq.x < 0.22 ? mix(base, vec3(0.78, 0.75, 0.70), 0.35) : base * (0.95 + 0.1 * gq.y);
    float cr = fracture(p, vec2(2.0), 0.008, 0.0) * smoothstep(0.5, 0.65, gnoise(uv * 3.0 + 3.3, vec2(3.0)));
    col = base * (1.0 - 0.4 * cr) * (0.9 + 0.15 * rough);
    float lic = smoothstep(0.64, 0.7, gfbm(uv + 0.7, 8.0, 4)) * (1.0 - cr);
    float lt = gnoise(uv * 4.0, vec2(4.0));
    col = mix(col, lt < 0.5 ? vec3(0.66, 0.66, 0.56) : vec3(0.62, 0.52, 0.28), lic * 0.65);
    h = fac * 0.45 + fac2 * 0.15 + big * 0.2 + rough * 0.15 - cr * 0.2 + lic * 0.03;
    r = mix(0.8, 0.94, lic);` },
  water: { bump: 0.02, ao: 0.0, cav: 0.0, code: `
    float a = gfbm(uv, 4.0, 5);
    float b = gfbm(uv + vec2(0.37, 0.11), 7.0, 4);
    h = a * 0.6 + b * 0.4;
    col = vec3(0.5);
    r = 0.05;` },
  birch: { bump: 0.012, ao: 1.6, cav: 0.25, code: `
    float b = gfbm(uv, vec2(3.0, 6.0), 4, 0.5);
    float fine = gnoise(uv * vec2(90.0, 180.0), vec2(90.0, 180.0));
    col = mix(vec3(0.79, 0.78, 0.73), vec3(0.92, 0.91, 0.87), b) * (0.94 + 0.08 * fine);
    vec2 cell = vec2(6.0, 40.0);
    vec2 x = uv * cell;
    vec2 n = floor(x);
    vec2 f = fract(x);
    float len = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 c = mod(n + g, cell);
        vec3 q = hash32(c * 1.3);
        if (q.z > 0.7) continue;
        vec2 d = f - (g + vec2(q.x, 0.3 + q.y * 0.4));
        float hl = 0.25 + 0.45 * fract(q.x * 7.1);
        float th = 0.07 + 0.08 * fract(q.y * 3.7);
        float k = d.x / hl;
        len = max(len, step(abs(k), 1.0) * (1.0 - smoothstep(th * (1.0 - k * k) * 0.7, th * (1.0 - k * k), abs(d.y))));
      }
    }
    col = mix(col, vec3(0.13, 0.11, 0.10), len * 0.85);
    float scar = smoothstep(0.66, 0.74, gfbm(uv + 0.37, vec2(3.0, 5.0), 4, 0.55));
    col = mix(col, vec3(0.10, 0.09, 0.08), scar * 0.9);
    float peel = smoothstep(0.6, 0.7, gfbm(uv + 0.71, vec2(4.0, 10.0), 3, 0.5)) * (1.0 - scar);
    col = mix(col, vec3(0.78, 0.63, 0.49), peel * 0.45);
    h = 0.6 - len * 0.3 - scar * 0.35 + peel * 0.15 + fine * 0.05 + b * 0.1;
    r = mix(0.6, 0.9, scar);` },
  barkDark: { bump: 0.05, ao: 2.6, cav: 0.45, code: `
    vec2 w = vec2(gfbm(uv, vec2(4.0, 2.0), 3, 0.5), gfbm(uv + 0.5, vec2(4.0, 2.0), 3, 0.5)) - 0.5;
    vec2 p = uv + w * vec2(0.03, 0.1);
    // 세로로 갈라진 골(잡음 등고선)과 가끔 가로로 끊긴 판
    float r1 = ridged(p, vec2(14.0, 2.0), 3);
    float furrow = smoothstep(0.5, 0.95, r1);
    float r2 = ridged(p + 0.37, vec2(5.0, 14.0), 2);
    float cross = smoothstep(0.75, 0.98, r2) * smoothstep(0.45, 0.65, gnoise(p * 8.0 + 1.7, vec2(8.0)));
    float fine = gfbm(uv, vec2(60.0, 30.0), 3, 0.5);
    float tone = gfbm(p, vec2(6.0, 2.0), 3, 0.5);
    h = (1.0 - max(furrow, cross * 0.7)) * (0.75 + 0.25 * (1.0 - r1)) + fine * 0.1;
    float deep = 1.0 - smoothstep(0.1, 0.55, h);
    vec3 top = mix(vec3(0.27, 0.23, 0.19), vec3(0.42, 0.38, 0.33), tone) * (0.82 + 0.3 * fine);
    col = mix(top, vec3(0.06, 0.045, 0.03), deep);
    float moss = smoothstep(0.55, 0.7, gfbm(uv + 0.23, vec2(2.0, 3.0), 3, 0.5)) * deep;
    col = mix(col, vec3(0.17, 0.22, 0.07), moss * 0.6);
    r = 0.93;` },
  driftwood: { bump: 0.02, ao: 1.8, cav: 0.3, code: `
    float wx = gfbm(uv, vec2(2.0, 1.0), 3, 0.5) - 0.5;
    float gx = uv.x + wx * 0.04;
    float grain = gnoise(vec2(gx * 50.0, uv.y * 3.0), vec2(50.0, 3.0));
    float grain2 = gnoise(vec2(gx * 140.0, uv.y * 6.0), vec2(140.0, 6.0));
    float big = gfbm(uv, 3.0, 3);
    col = mix(vec3(0.42, 0.40, 0.36), vec3(0.66, 0.63, 0.57), big);
    col *= 0.8 + 0.25 * grain + 0.1 * grain2;
    float crack = (1.0 - smoothstep(0.0, 0.06, abs(grain - 0.5))) * smoothstep(0.5, 0.8, gnoise(vec2(gx * 8.0, uv.y * 2.0), vec2(8.0, 2.0)));
    col *= 1.0 - crack * 0.6;
    h = grain * 0.5 + grain2 * 0.2 + big * 0.15 - crack * 0.35;
    r = 0.88;` },
  planks: { bump: 0.015, ao: 2.0, cav: 0.35, code: `
    float rows = 5.0;
    float py = uv.y * rows;
    float idx = floor(py);
    float fy = fract(py);
    float rnd = hash12(vec2(idx, 3.0));
    float seams = 2.0;
    float px = uv.x * seams + hash12(vec2(idx, 9.0));
    float pidx = mod(floor(px), seams);
    float fx = fract(px);
    float prnd = hash12(vec2(pidx, idx) + 0.37);
    vec2 kc = vec2(0.2 + 0.6 * fract(prnd * 13.7), 0.3 + 0.4 * fract(prnd * 7.3));
    float kr = length(vec2((fx - kc.x) * 2.5, fy - kc.y));
    float hasKnot = step(fract(prnd * 3.1), 0.45);
    float knot = (1.0 - smoothstep(0.05, 0.08, kr)) * hasKnot;
    float warp = gnoise(vec2(uv.x * 3.0 + prnd * 7.0, py), vec2(3.0, rows));
    float gl = fy * 7.0 + warp * 1.2 + prnd * 5.0 + hasKnot * 0.25 / (kr * 8.0 + 0.4);
    float ringL = smoothstep(0.0, 0.2, fract(gl)) * smoothstep(1.0, 0.7, fract(gl));
    float fine = gnoise(vec2(uv.x * 30.0, py * 40.0), vec2(30.0, rows * 40.0));
    float gap = smoothstep(0.0, 0.04, fy) * smoothstep(1.0, 0.96, fy);
    float endGap = smoothstep(0.0, 0.01, fx) * smoothstep(1.0, 0.99, fx);
    vec3 wood = mix(vec3(0.33, 0.22, 0.13), vec3(0.52, 0.38, 0.24), rnd * 0.6 + prnd * 0.4);
    wood *= 0.84 + 0.12 * ringL + 0.12 * fine;
    wood = mix(wood, wood * 0.45, knot);
    float weather = smoothstep(0.45, 0.75, gfbm(uv + 0.3, 4.0, 3));
    wood = mix(wood, vec3(0.45, 0.43, 0.40) * (0.85 + 0.2 * fine), weather * 0.45);
    float nail = 1.0 - smoothstep(0.03, 0.04, min(length(vec2((fx - 0.04) * 2.5, fy - 0.5)), length(vec2((fx - 0.96) * 2.5, fy - 0.5))));
    float g = gap * endGap;
    col = mix(vec3(0.06, 0.045, 0.03), wood, g);
    col = mix(col, vec3(0.16, 0.15, 0.15), nail);
    h = g * (0.7 + 0.06 * ringL + 0.1 * fine) - knot * 0.05 + nail * 0.08;
    r = mix(0.78, 0.5, nail);` },
  plaster: { bump: 0.006, ao: 1.2, cav: 0.2, code: `
    float big = gfbm(uv, 2.0, 5);
    float fine = gfbm(uv, 40.0, 3);
    float tr1 = gfbm(uv, vec2(5.0, 16.0), 3, 0.5);
    float stain = smoothstep(0.55, 0.78, gfbm(uv + vec2(0.3, 0.1), vec2(6.0, 2.0), 4, 0.55));
    vec3 vc = voro(uv, 4.0, 1.0);
    float crack = (1.0 - smoothstep(0.0, 0.012, vc.y)) * smoothstep(0.6, 0.7, gfbm(uv + 0.9, 3.0, 3));
    col = mix(vec3(0.70, 0.66, 0.58), vec3(0.86, 0.83, 0.76), big);
    col *= 0.93 + 0.1 * fine;
    col *= 0.96 + 0.06 * tr1;
    col = mix(col, vec3(0.52, 0.47, 0.39), stain * 0.35);
    col *= 1.0 - crack * 0.4;
    float chip = smoothstep(0.7, 0.74, gfbm(uv + 0.55, 4.0, 4));
    col = mix(col, vec3(0.45, 0.40, 0.34) * (0.8 + 0.3 * fine), chip);
    h = fine * 0.3 + big * 0.2 + tr1 * 0.15 - crack * 0.2 - chip * 0.25;
    r = mix(0.95, 0.9, chip);` },
  stone: { bump: 0.03, ao: 2.2, cav: 0.4, code: `
    vec2 rel;
    vec2 cid;
    vec3 v = voro(uv, vec2(4.0, 7.0), 0.75, rel, cid);
    vec3 q = hash32(cid * 1.7);
    float mortar = smoothstep(0.03, 0.07, v.y);
    float bulge = sqrt(clamp(v.y / 0.25, 0.0, 1.0));
    float n = gfbm(uv, 10.0, 4);
    float fine = gnoise(uv * 160.0, vec2(160.0));
    vec3 st = mix(vec3(0.38, 0.36, 0.33), vec3(0.60, 0.57, 0.52), q.x);
    st = mix(st, vec3(0.50, 0.43, 0.35), step(0.75, q.y) * 0.6);
    st *= 0.82 + 0.25 * n + 0.08 * fine;
    col = mix(vec3(0.30, 0.28, 0.25) * (0.85 + 0.3 * fine), st * (0.8 + 0.25 * bulge), mortar);
    float moss = smoothstep(0.55, 0.7, gfbm(uv + 0.41, 5.0, 3)) * (1.0 - mortar * 0.8);
    col = mix(col, vec3(0.16, 0.21, 0.07), moss * 0.6);
    h = mortar * (0.45 + 0.4 * bulge) + n * 0.1 + fine * 0.04;
    r = mix(0.96, 0.82, mortar);` },
  shingle: { bump: 0.02, ao: 2.4, cav: 0.4, code: `
    float rows = 8.0;
    float py = uv.y * rows;
    float row = mod(floor(py), rows);
    float fy = fract(py);
    float cols = 6.0;
    float px = uv.x * cols + hash12(vec2(row, 4.0));
    float ci = mod(floor(px), cols);
    float fx = fract(px);
    float id = hash12(vec2(ci, row));
    float side = smoothstep(0.0, 0.035, fx) * smoothstep(1.0, 0.965, fx);
    float bottom = smoothstep(0.0, 0.06, fy - 0.04 * vnoise(vec2(fx * 6.0 + id * 30.0, row)));
    float grain = vnoise(vec2(fx * 26.0 + id * 50.0, fy * 2.5 + row * 3.0));
    float grain2 = vnoise(vec2(fx * 70.0 + id * 20.0, fy * 5.0));
    float split = (1.0 - smoothstep(0.0, 0.015, abs(fx - 0.3 - 0.4 * fract(id * 7.7)))) * step(0.6, fract(id * 5.3)) * smoothstep(0.2, 0.6, fy);
    float moss = smoothstep(0.58, 0.72, gfbm(uv, 4.0, 4));
    vec3 wood = mix(vec3(0.23, 0.18, 0.13), vec3(0.42, 0.34, 0.25), id) * (0.78 + 0.22 * grain + 0.1 * grain2);
    wood = mix(wood, vec3(0.40, 0.38, 0.35) * (0.85 + 0.2 * grain), 0.45 * smoothstep(0.3, 0.8, fract(id * 3.3)));
    col = wood * mix(0.35, 1.0, side) * mix(0.4, 1.0, bottom) * (0.72 + 0.38 * fy) * (1.0 - 0.6 * split);
    col = mix(col, vec3(0.19, 0.25, 0.08) * (0.8 + 0.3 * grain2), moss * 0.55);
    h = side * bottom * (0.35 + 0.65 * fy) + grain * 0.04 - split * 0.1;
    r = 0.88;` },
};

// 지형 층이 아닌 것들은 2D 텍스처로 굽는다. 바위(물건)는 boulder를 rock 이름으로 내보낸다.
const OBJECTS = { rock: 'boulder', water: 'water', birch: 'birch', barkDark: 'barkDark', driftwood: 'driftwood', planks: 'planks', plaster: 'plaster', stone: 'stone', shingle: 'shingle' };

const VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

function layerFrag(code) {
  return `
varying vec2 vUv;
uniform int uPass;
${NOISE}
${BAKE}
${HELP}
void layer(vec2 uv, out vec3 col, out float h, out float r) {
${code}
}
void main() {
  vec3 col;
  float h;
  float r;
  layer(vUv, col, h, r);
  // 색은 sRGB 감각으로 골랐으니 선형으로 바꿔 둔다(최종 텍스처가 sRGB로 다시 저장한다)
  if (uPass == 0) gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), h);
  else gl_FragColor = vec4(clamp(r, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;
}

// 높이 → 노멀·그늘. 반지름은 uv 단위라 해상도가 달라도 같은 그림이 나온다.
const FINAL_FRAG = `
varying vec2 vUv;
uniform sampler2D tRaw;
uniform sampler2D tAux;
uniform float uTexel;
uniform float uBump;
uniform float uAo;
uniform float uCav;
uniform int uMode;
float H(vec2 o) { return texture2D(tRaw, vUv + o).a; }
float occlusion(float h0) {
  float occ = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982 + 0.39;
    vec2 d = vec2(cos(a), sin(a));
    occ += max(0.0, H(d * 0.0025) - h0);
    occ += max(0.0, H(d * 0.007 + d.yx * 0.001) - h0) * 0.7;
    occ += max(0.0, H(d * 0.018 - d.yx * 0.002) - h0) * 0.45;
  }
  return clamp(1.0 - occ * 0.125 * uAo, 0.3, 1.0);
}
void main() {
  vec4 raw = texture2D(tRaw, vUv);
  float ao = occlusion(raw.a);
  if (uMode == 0) {
    gl_FragColor = vec4(raw.rgb * mix(1.0, ao, uCav), clamp(raw.a, 0.0, 1.0));
    return;
  }
  float e = uTexel;
  float tl = H(vec2(-e, e));
  float tc = H(vec2(0.0, e));
  float tr = H(vec2(e, e));
  float ml = H(vec2(-e, 0.0));
  float mr = H(vec2(e, 0.0));
  float bl = H(vec2(-e, -e));
  float bc = H(vec2(0.0, -e));
  float br = H(vec2(e, -e));
  float gx = ((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)) / (8.0 * e);
  float gy = ((tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br)) / (8.0 * e);
  vec3 n = normalize(vec3(-gx * uBump, -gy * uBump, 1.0));
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, texture2D(tAux, vUv).r, ao);
}`;

// renderer에 그려 굽는다. 프로그램은 먼저 한꺼번에(병렬) 컴파일해 둔다.
export async function bakeMaterials(renderer, { terrainSize, objectSize }) {
  const t0 = performance.now();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const cam = new THREE.OrthographicCamera();
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(geo);
  quad.frustumCulled = false;
  scene.add(quad);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const prevTarget = renderer.getRenderTarget();
  const floatOk = renderer.extensions.has('EXT_color_buffer_float');

  const rawTargets = new Map();
  const rawFor = (size) => {
    if (!rawTargets.has(size)) {
      const opt = { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
      rawTargets.set(size, {
        raw: new THREE.WebGLRenderTarget(size, size, { ...opt, type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType }),
        aux: new THREE.WebGLRenderTarget(size, size, opt),
      });
    }
    return rawTargets.get(size);
  };
  const finalOpt = (srgb) => ({
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: true, anisotropy: aniso, depthBuffer: false,
    colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
  });

  const layerMats = {};
  const compile = new THREE.Scene();
  for (const [name, L] of Object.entries(LAYERS)) {
    layerMats[name] = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: layerFrag(L.code),
      uniforms: { uPass: { value: 0 }, uPx: { value: 1 / 1024 } },
      depthTest: false, depthWrite: false,
    });
  }
  const fin = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FINAL_FRAG,
    uniforms: {
      tRaw: { value: null }, tAux: { value: null }, uTexel: { value: 1 / 1024 },
      uBump: { value: 1 }, uAo: { value: 1 }, uCav: { value: 0 }, uMode: { value: 0 },
    },
    depthTest: false, depthWrite: false,
  });
  for (const m of [...Object.values(layerMats), fin]) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    compile.add(mesh);
  }
  // 그릴 때와 같은 조건(렌더 타깃에 선형 출력)으로 컴파일해야 다시 컴파일하지 않는다
  renderer.setRenderTarget(rawFor(objectSize).raw);
  if (renderer.compileAsync) {
    try { await renderer.compileAsync(compile, cam); } catch { /* 그냥 그리면서 컴파일 */ }
  }
  const tCompile = performance.now();

  function bakeOne(name, size, dst) {
    const L = LAYERS[name];
    const mat = layerMats[name];
    const { raw, aux } = rawFor(size);
    quad.material = mat;
    mat.uniforms.uPx.value = 1 / size;
    mat.uniforms.uPass.value = 0;
    renderer.setRenderTarget(raw);
    renderer.render(scene, cam);
    mat.uniforms.uPass.value = 1;
    renderer.setRenderTarget(aux);
    renderer.render(scene, cam);
    quad.material = fin;
    const U = fin.uniforms;
    U.tRaw.value = raw.texture;
    U.tAux.value = aux.texture;
    U.uTexel.value = 1 / size;
    U.uBump.value = L.bump;
    U.uAo.value = L.ao;
    U.uCav.value = L.cav;
    U.uMode.value = 0;
    renderer.setRenderTarget(dst.A, dst.layer ?? 0);
    renderer.render(scene, cam);
    U.uMode.value = 1;
    renderer.setRenderTarget(dst.N, dst.layer ?? 0);
    renderer.render(scene, cam);
  }

  // 지형: 배열 두 장. 밉맵은 마지막 층을 그린 뒤 한 번만 만든다.
  const n = TERRAIN_LAYERS.length;
  const arrA = new THREE.WebGLArrayRenderTarget(terrainSize, terrainSize, n, finalOpt(true));
  const arrN = new THREE.WebGLArrayRenderTarget(terrainSize, terrainSize, n, finalOpt(false));
  TERRAIN_LAYERS.forEach((name, i) => {
    const last = i === n - 1;
    arrA.texture.mipmapsAutoUpdate = last;
    arrN.texture.mipmapsAutoUpdate = last;
    bakeOne(name, terrainSize, { A: arrA, N: arrN, layer: i });
  });
  const out = { terrain: { A: arrA.texture, N: arrN.texture, rt: [arrA, arrN], layers: n } };

  for (const [key, name] of Object.entries(OBJECTS)) {
    const size = key === 'water' ? Math.min(objectSize, 512) : objectSize;
    const A = new THREE.WebGLRenderTarget(size, size, finalOpt(true));
    const N = new THREE.WebGLRenderTarget(size, size, finalOpt(false));
    bakeOne(name, size, { A, N });
    out[key] = { A: A.texture, N: N.texture, rt: [A, N] };
  }

  renderer.setRenderTarget(prevTarget);
  for (const { raw, aux } of rawTargets.values()) {
    raw.dispose();
    aux.dispose();
  }
  for (const m of Object.values(layerMats)) m.dispose();
  fin.dispose();
  geo.dispose();
  out.stats = { compileMs: Math.round(tCompile - t0), bakeMs: Math.round(performance.now() - tCompile), float: floatOk };
  return out;
}

// ── 캔버스로 그리는 알파 텍스처(잎·연기·불꽃·달·고사리) ─────────────────
function canvasTex(size, draw, { srgb = true, mips = true, h = size } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, size, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}

// 결정적 난수(그림이 매번 같게)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 잎 덩어리 카드: 가지 몇 개에 잎이 달린 모양
function leafCluster(g, size, { seed, leaves, hue, sat, light, w, h, twig, broad }) {
  const R = rng(seed);
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const branches = 6;
  for (let b = 0; b < branches; b++) {
    const ang = -Math.PI / 2 + (R() - 0.5) * 2.4;
    const len = size * (0.28 + R() * 0.2);
    const sx = cx + (R() - 0.5) * size * 0.1;
    const sy = size * 0.92;
    const ex = sx + Math.cos(ang) * len;
    const ey = sy + Math.sin(ang) * len * 1.6;
    g.strokeStyle = twig;
    g.lineWidth = size / 220;
    g.beginPath();
    g.moveTo(sx, sy);
    g.quadraticCurveTo((sx + ex) / 2 + (R() - 0.5) * 30, (sy + ey) / 2, ex, ey);
    g.stroke();
    const per = Math.floor(leaves / branches);
    for (let i = 0; i < per; i++) {
      const t = 0.25 + R() * 0.75;
      const px = sx + (ex - sx) * t + (R() - 0.5) * size * 0.12;
      const py = sy + (ey - sy) * t + (R() - 0.5) * size * 0.12;
      const a = ang + (R() - 0.5) * 2.2;
      const s = (0.7 + R() * 0.6) * size / 512;
      const L = light + (R() - 0.5) * 16;
      g.save();
      g.translate(px, py);
      g.rotate(a);
      g.fillStyle = `hsl(${hue + (R() - 0.5) * 18}, ${sat + (R() - 0.5) * 12}%, ${L}%)`;
      g.beginPath();
      if (broad) {
        g.ellipse(0, 0, w * s, h * s, 0, 0, Math.PI * 2);
      } else {
        g.moveTo(-w * s, 0);
        g.quadraticCurveTo(0, -h * s, w * s * 1.15, 0);
        g.quadraticCurveTo(0, h * s, -w * s, 0);
      }
      g.fill();
      g.strokeStyle = `hsla(${hue}, ${sat}%, ${L - 12}%, 0.6)`;
      g.lineWidth = s;
      g.beginPath();
      g.moveTo(-w * s, 0);
      g.lineTo(w * s, 0);
      g.stroke();
      g.restore();
    }
  }
}

// 고사리 잎 한 장: 휘어진 잎줄기 양쪽으로 작은 잎(우편)이 어긋나게 달리고 끝으로 갈수록 작아진다
function fernFrond(g, W, H) {
  const R = rng(91);
  g.clearRect(0, 0, W, H);
  const pts = [];
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([W * 0.5 + Math.sin(t * 2.2) * W * 0.06 * t, H * (0.98 - t * 0.95)]);
  }
  g.strokeStyle = '#3c5a1e';
  g.lineWidth = W * 0.012;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  for (let i = 4; i < N; i++) {
    const t = i / N;
    const [x, y] = pts[i];
    const [x2, y2] = pts[Math.min(N, i + 1)];
    const ang = Math.atan2(y2 - y, x2 - x);
    const len = W * 0.42 * Math.sin(Math.min(1, t * 1.25) * Math.PI) * (1 - t * 0.35);
    if (len < 3) continue;
    for (const side of [-1, 1]) {
      if ((i + (side > 0 ? 0 : 1)) % 2) continue;
      const a = ang + side * (Math.PI / 2 - 0.35 - t * 0.2);
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      g.strokeStyle = '#46682a';
      g.lineWidth = Math.max(1, W * 0.004);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(ex, ey);
      g.stroke();
      // 작은 잎(우편 조각) 여러 개
      const lobes = Math.max(3, Math.round(len / (W * 0.035)));
      for (let k = 0; k < lobes; k++) {
        const u = (k + 0.5) / lobes;
        const lx = x + (ex - x) * u;
        const ly = y + (ey - y) * u;
        const lw = W * 0.028 * (1 - u * 0.6) * (0.9 + R() * 0.2);
        const L = 26 + R() * 12 - t * 4;
        g.fillStyle = `hsl(${95 + (R() - 0.5) * 14}, ${42 + R() * 10}%, ${L}%)`;
        for (const s2 of [-1, 1]) {
          g.save();
          g.translate(lx, ly);
          g.rotate(a + s2 * 1.1);
          g.beginPath();
          g.ellipse(lw * 0.9, 0, lw, lw * 0.45, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
    }
  }
}

export function makeCanvasTextures() {
  const birchLeaves = canvasTex(512, (g, s) => leafCluster(g, s, {
    seed: 11, leaves: 170, hue: 84, sat: 48, light: 34, w: 15, h: 10, twig: '#4a3a2a',
  }));
  const bushLeaves = canvasTex(512, (g, s) => leafCluster(g, s, {
    seed: 23, leaves: 150, hue: 105, sat: 40, light: 26, w: 18, h: 9, twig: '#3a2e22', broad: true,
  }));
  // 전나무 가지 한 장(v0.4.2): 가운데 가지에서 곁가지가 앞으로 뻗고, 바늘잎이 빽빽하다. 왼쪽이 줄기 쪽
  const pineNeedles = canvasTex(512, (g, W, H) => {
    const R = rng(37);
    g.clearRect(0, 0, W, H);
    const cy = H * 0.5;
    const along = (t) => [W * (0.02 + t * 0.95), cy + Math.sin(t * 2.4) * H * 0.04 * t];
    // 밑칠: 멀리서도 덩어리로 보이게 끝으로 갈수록 좁아지는 짙은 그림자
    g.fillStyle = 'hsla(135, 32%, 11%, 0.9)';
    g.beginPath();
    g.moveTo(W * 0.04, cy - H * 0.1);
    g.quadraticCurveTo(W * 0.5, cy - H * 0.42, W * 0.97, cy - H * 0.02);
    g.quadraticCurveTo(W * 0.5, cy + H * 0.42, W * 0.04, cy + H * 0.1);
    g.fill();
    const needleRun = (x0, y0, x1, y1, len, n, light) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L;
      const uy = dy / L;
      for (let i = 0; i < n; i++) {
        const t = R();
        const px = x0 + dx * t;
        const py = y0 + dy * t;
        const side = R() < 0.5 ? -1 : 1;
        const a = Math.atan2(uy, ux) + side * (0.7 + R() * 0.5);
        const l = len * (0.7 + R() * 0.5) * (1 - t * 0.3);
        const tip = t > 0.75 && R() < 0.5;
        g.strokeStyle = tip
          ? `hsl(${100 + R() * 14}, ${40 + R() * 12}%, ${30 + R() * 10}%)`
          : `hsl(${128 + (R() - 0.5) * 20}, ${30 + R() * 14}%, ${light + R() * 12}%)`;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
        g.stroke();
      }
    };
    // 곁가지
    for (let k = 0; k < 9; k++) {
      const t = 0.08 + k * 0.1 + R() * 0.03;
      const [bx, by] = along(t);
      const side = k % 2 ? 1 : -1;
      const len = W * 0.26 * (1 - t * 0.7);
      const a = side * (0.55 + R() * 0.25);
      const ex = bx + Math.cos(a) * len;
      const ey = by + Math.sin(a) * len * 0.9;
      g.strokeStyle = '#3a2c1e';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(ex, ey);
      g.stroke();
      needleRun(bx, by, ex, ey, H * 0.075, 110, 12);
    }
    // 가운데 가지
    g.strokeStyle = '#3d2e20';
    g.lineWidth = 5;
    g.beginPath();
    for (let i = 0; i <= 20; i++) {
      const [x, y] = along(i / 20);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    for (let i = 0; i < 20; i++) {
      const [x0, y0] = along(i / 20);
      const [x1, y1] = along((i + 1) / 20);
      needleRun(x0, y0, x1, y1, H * 0.11, 40, 14);
    }
  }, { h: 256 });
  const fern = canvasTex(256, (g, w, h) => fernFrond(g, w, h), { h: 512 });
  const smoke = canvasTex(128, (g, s) => {
    const R = rng(5);
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      const x = s / 2 + (R() - 0.5) * s * 0.35;
      const y = s / 2 + (R() - 0.5) * s * 0.35;
      const r = s * (0.18 + R() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.32)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    }
  }, { mips: false });
  const flame = canvasTex(128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s * 0.72, 0, s / 2, s * 0.6, s * 0.45);
    gr.addColorStop(0, 'rgba(255,240,200,1)');
    gr.addColorStop(0.35, 'rgba(255,170,60,0.85)');
    gr.addColorStop(0.7, 'rgba(220,70,10,0.35)');
    gr.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(s * 0.18, s * 0.95);
    g.quadraticCurveTo(s * 0.2, s * 0.35, s * 0.5, s * 0.02);
    g.quadraticCurveTo(s * 0.8, s * 0.35, s * 0.82, s * 0.95);
    g.closePath();
    g.fill();
  }, { mips: false });
  const glow = canvasTex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }, { mips: false });
  const moon = canvasTex(128, (g, s) => {
    const R = rng(9);
    g.clearRect(0, 0, s, s);
    const gr = g.createRadialGradient(s * 0.45, s * 0.45, s * 0.05, s / 2, s / 2, s * 0.48);
    gr.addColorStop(0, '#f4f1e6');
    gr.addColorStop(0.9, '#d9d4c3');
    gr.addColorStop(1, 'rgba(217,212,195,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 16; i++) {
      const a = R() * Math.PI * 2;
      const d = R() * s * 0.32;
      g.fillStyle = `rgba(150,145,130,${0.15 + R() * 0.25})`;
      g.beginPath();
      g.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.02 + R() * 0.07), 0, Math.PI * 2);
      g.fill();
    }
  }, { mips: false });
  // 들꽃 한 포기: 줄기와 꽃송이(흰·노랑·보라)
  const flowers = canvasTex(256, (g, s) => {
    const R = rng(77);
    g.clearRect(0, 0, s, s);
    const kinds = [['#f4f1e4', '#e8c43a'], ['#f2cf3a', '#c98a1a'], ['#a77fd4', '#f2e2a0'], ['#e8e2f2', '#d8b23a']];
    for (let i = 0; i < 9; i++) {
      const [petal, eye] = kinds[Math.floor(R() * kinds.length)];
      const x = s * (0.15 + R() * 0.7);
      const top = s * (0.12 + R() * 0.4);
      g.strokeStyle = '#3d6a24';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(x + (R() - 0.5) * 20, s);
      g.quadraticCurveTo(x + (R() - 0.5) * 30, (s + top) / 2, x, top);
      g.stroke();
      g.fillStyle = '#3f7a28';
      g.beginPath();
      g.ellipse(x + 8, (s + top) / 2 + 10, 9, 3.5, -0.6, 0, Math.PI * 2);
      g.fill();
      const r = 7 + R() * 6;
      g.fillStyle = petal;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        g.beginPath();
        g.ellipse(x + Math.cos(a) * r * 0.6, top + Math.sin(a) * r * 0.6, r * 0.55, r * 0.28, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = eye;
      g.beginPath();
      g.arc(x, top, r * 0.32, 0, Math.PI * 2);
      g.fill();
    }
  });
  return { birchLeaves, bushLeaves, pineNeedles, fern, smoke, flame, glow, moon, flowers };
}
