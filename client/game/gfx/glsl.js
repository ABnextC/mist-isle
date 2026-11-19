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

// 텍스처 굽기 전용(v0.4.2): 주기 기울기 잡음, 보로노이(테두리 거리), 선분 거리, 잎 모양.
// 좌표는 모두 uv(0~1)이고, 주기(per)가 정수면 이음매 없이 반복된다.
export const BAKE = /* glsl */ `
#define TAU 6.2831853
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
vec2 grad2(vec2 i) {
  float a = hash12(i) * TAU;
  return vec2(cos(a), sin(a));
}
// 주기 기울기 잡음(0~1 근처)
float gnoise(vec2 x, vec2 per) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(mod(i, per)), f);
  float b = dot(grad2(mod(i + vec2(1.0, 0.0), per)), f - vec2(1.0, 0.0));
  float c = dot(grad2(mod(i + vec2(0.0, 1.0), per)), f - vec2(0.0, 1.0));
  float d = dot(grad2(mod(i + vec2(1.0, 1.0), per)), f - vec2(1.0, 1.0));
  return clamp(0.5 + 0.75 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}
// uv에서 주기 per(정수)부터 옥타브마다 두 배
float gfbm(vec2 uv, vec2 per, int oct, float gain) {
  float s = 0.0;
  float a = 1.0;
  float n = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= oct) break;
    s += a * gnoise(uv * per + float(k) * vec2(17.13, 31.71), per);
    n += a;
    a *= gain;
    per *= 2.0;
  }
  return s / n;
}
float gfbm(vec2 uv, float per, int oct) { return gfbm(uv, vec2(per), oct, 0.5); }
// 능선 잡음(바위 결): 0~1, 1이 날
float ridged(vec2 uv, vec2 per, int oct) {
  float s = 0.0;
  float a = 1.0;
  float n = 0.0;
  for (int k = 0; k < 8; k++) {
    if (k >= oct) break;
    float v = 1.0 - abs(gnoise(uv * per + float(k) * vec2(5.31, 9.17), per) * 2.0 - 1.0);
    s += a * v * v;
    n += a;
    a *= 0.5;
    per *= 2.0;
  }
  return s / n;
}
// 주기 보로노이: x = F1, y = 테두리까지 거리, z = 칸 난수. rel = 픽셀→칸 중심, cid = 칸 번호
vec3 voro(vec2 uv, vec2 per, float jit, out vec2 rel, out vec2 cid) {
  vec2 x = uv * per;
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + (hash22(mod(n + g, per)) - 0.5) * jit;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  float bd = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = 0.5 + (hash22(mod(n + g, per)) - 0.5) * jit;
      vec2 r = g + o - f;
      vec2 dd = r - mr;
      if (dot(dd, dd) > 1e-5) bd = min(bd, dot(0.5 * (mr + r), normalize(dd)));
    }
  }
  cid = mod(n + mg, per);
  rel = mr;
  return vec3(sqrt(md), bd, hash12(cid + 3.17));
}
vec3 voro(vec2 uv, float per, float jit) {
  vec2 r;
  vec2 c;
  return voro(uv, vec2(per), jit, r, c);
}
// 매끈한 각면(바위 덩어리): 칸마다 기울어진 평면을 가우스 가중으로 섞는다. sharp가 클수록 모서리가 또렷하다
float facets(vec2 uv, vec2 per, float sharp, float seed) {
  vec2 x = uv * per;
  vec2 n = floor(x);
  vec2 f = fract(x);
  float acc = 0.0;
  float ws = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 c = mod(n + g, per);
      vec3 q = hash32(c + seed);
      vec2 r = f - (g + 0.5 + (q.xy - 0.5) * 0.9);
      float w = exp(-sharp * dot(r, r));
      vec2 tilt = (hash22(c * 1.7 + seed) - 0.5) * 1.6;
      acc += w * (q.z * 0.6 + dot(r, tilt));
      ws += w;
    }
  }
  return acc / ws + 0.3;
}
// 구불구불한 금(잡음의 등고선 하나). 반환: 금 위면 1
float fracture(vec2 uv, vec2 per, float width, float seed) {
  float v = gnoise(uv * per + seed, per);
  return 1.0 - smoothstep(0.0, width, abs(v - 0.5));
}
// 선분 거리: x = 거리, y = 선분 위 위치(0~1)
vec2 seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return vec2(length(pa - ba * t), t);
}
mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}
// 잎 한 장(지역 좌표 p, 길이 방향 x∈[-1,1]). 반환: 덮임(0~1). vn = 가장자리까지 비율(0 가운데, 1 가장자리)
// aa = 픽셀 한 칸 크기(p 단위). 가장자리를 그만큼 부드럽게 해 계단을 없앤다.
float leafMask(vec2 p, float lobes, float width, float aa, out float vn) {
  float u = p.x;
  float t = clamp(1.0 - u * u, 0.0, 1.0);
  float w = width * pow(t, 0.65) * (1.0 + lobes * (0.45 * abs(sin(u * 7.5 + 0.6)) - 0.2));
  w *= 1.0 - 0.25 * smoothstep(0.6, 1.0, u);
  vn = abs(p.y) / max(w, 1e-3);
  float e = clamp(aa / max(w, 1e-3), 0.02, 0.5);
  return (1.0 - smoothstep(1.0 - aa, 1.0, abs(u))) * (1.0 - smoothstep(1.0 - e, 1.0, vn));
}
`;
