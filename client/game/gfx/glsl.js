// 셰이더에서 같이 쓰는 잡음 함수. 텍스처 굽기용은 주기(per)를 받아 이음매 없이 반복된다.

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// 주기 per로 반복하는 값 잡음
float pnoise(vec2 x, float per) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// 가로·세로 주기가 다른 값 잡음(나뭇결처럼 한 방향으로 긴 무늬)
float pnoise2(vec2 x, vec2 per) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// uv(0~1)에서 주기 per부터 옥타브마다 두 배
float pfbm(vec2 uv, float per, int oct) {
  float s = 0.0;
  float a = 0.5;
  float n = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= oct) break;
    s += a * pnoise(uv * per + float(k) * 17.13, per);
    n += a;
    a *= 0.5;
    per *= 2.0;
  }
  return s / n;
}
// 주기 셀룰러 잡음: x = F1, y = F2
vec2 pworley(vec2 uv, float per) {
  vec2 x = uv * per;
  vec2 i = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int k = -1; k <= 1; k++) {
      vec2 o = vec2(float(k), float(j));
      vec2 p = o + hash22(mod(i + o, per)) * 0.9 + 0.05;
      float d = length(p - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2);
}
// 셀마다 고정된 난수(조약돌 색 등)
float pcell(vec2 uv, float per) {
  vec2 x = uv * per;
  vec2 i = floor(x);
  vec2 f = fract(x);
  float best = 8.0;
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int k = -1; k <= 1; k++) {
      vec2 o = vec2(float(k), float(j));
      vec2 p = o + hash22(mod(i + o, per)) * 0.9 + 0.05;
      float d = length(p - f);
      if (d < best) { best = d; id = mod(i + o, per); }
    }
  }
  return hash12(id + 7.0);
}
// 반복이 없는 일반 잡음(실시간용)
float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 x) {
  return vnoise(x) * 0.5 + vnoise(x * 2.03 + 7.1) * 0.3 + vnoise(x * 4.11 + 3.7) * 0.2;
}
`;
