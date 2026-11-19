// 개척자 모양(v0.4.3): 거리장으로 몸·머리·배낭을 깎고, 겹(옷)과 뼈 가중치를 정한다.
// three를 쓰지 않는 순수 코드라 웹 워커에서 돌릴 수 있다(로딩 중 다른 일과 나란히 만든다).

import { sdSphere, sdEllipsoid, sdRoundCone, sdBox, sdTorus, smin, smax, slabY, noise3, surfaceNets } from './sdf.js';

export const SKIN = [0xd9a47f, 0xc4875f, 0xe6b893, 0xa8704a];
export const HAIR = [0x2e1f14, 0x5a3a1e, 0x1a1512, 0x8a6236];
export const SCARF = [0xa8432e, 0xc08a2a, 0x3e6a8a, 0x6a3a6a];
export const IRIS = ['#5b3b22', '#3d6f8f', '#4d6b3a', '#6b4a2a'];

// 겹 번호
export const L = { skin: 0, shirt: 1, vest: 2, trousers: 3, boots: 4, sole: 5, belt: 6, metal: 7, bracer: 8, glove: 9, scarf: 10, hair: 11, lips: 12, canvas: 13, wool: 14 };
// 겹마다 거칠기·금속성
export const SURF = {
  [L.skin]: [0.5, 0], [L.shirt]: [0.92, 0], [L.vest]: [0.8, 0], [L.trousers]: [0.9, 0], [L.boots]: [0.55, 0], [L.sole]: [0.85, 0],
  [L.belt]: [0.5, 0], [L.metal]: [0.32, 1], [L.bracer]: [0.6, 0], [L.glove]: [0.6, 0], [L.scarf]: [0.95, 0], [L.hair]: [0.62, 0],
  [L.lips]: [0.4, 0], [L.canvas]: [0.95, 0], [L.wool]: [0.98, 0],
};

// 뼈(쉬는 자세의 세계 좌표). 부모 기준 위치는 아래 makeBones에서 뺀다
export const BONE = {
  hips: [0, 0.96, 0], spine: [0, 1.04, 0], neck: [0, 1.54, 0], head: [0, 1.62, 0],
  shL: [-0.19, 1.46, 0], elL: [-0.22, 1.19, 0], handL: [-0.232, 0.95, 0.01],
  shR: [0.19, 1.46, 0], elR: [0.22, 1.19, 0], handR: [0.232, 0.95, 0.01],
  thL: [-0.095, 0.93, 0], knL: [-0.095, 0.5, 0.005], ftL: [-0.095, 0.085, -0.005],
  thR: [0.095, 0.93, 0], knR: [0.095, 0.5, 0.005], ftR: [0.095, 0.085, -0.005],
};
export const BONE_ORDER = ['hips', 'spine', 'neck', 'head', 'shL', 'elL', 'handL', 'shR', 'elR', 'handR', 'thL', 'knL', 'ftL', 'thR', 'knR', 'ftR'];
const BI = Object.fromEntries(BONE_ORDER.map((k, i) => [k, i]));
export const PARENT = { spine: 'hips', neck: 'spine', head: 'neck', shL: 'spine', elL: 'shL', handL: 'elL', shR: 'spine', elR: 'shR', handR: 'elR', thL: 'hips', knL: 'thL', ftL: 'knL', thR: 'hips', knR: 'thR', ftR: 'knR' };

// ── 몸 거리장 ─────────────────────────────────────
// 한 점에서 몸 부분들의 거리를 낸다(팔은 가까운 쪽만, 다리는 사타구니 때문에 양쪽 다)
const S = {};
function parts(x, y, z) {
  const sx = x < 0 ? -1 : 1;
  let t = sdEllipsoid(x, y, z, 0, 0.97, -0.005, 0.155, 0.11, 0.105);
  t = smin(t, sdEllipsoid(x, y, z, 0, 1.12, 0, 0.135, 0.13, 0.095), 0.07);
  t = smin(t, sdEllipsoid(x, y, z, 0, 1.33, 0.012, 0.165, 0.16, 0.105), 0.07);
  t = smin(t, sdEllipsoid(x, y, z, 0, 1.44, -0.005, 0.19, 0.06, 0.09), 0.05);
  t = smin(t, sdSphere(x, y, z, sx * 0.185, 1.45, 0, 0.058), 0.04);
  S.torso = t;
  S.neck = sdRoundCone(x, y, z, 0, 1.47, 0, 0, 1.62, 0.005, 0.054, 0.05);
  S.upper = sdRoundCone(x, y, z, sx * 0.19, 1.45, 0, sx * 0.22, 1.19, 0, 0.05, 0.041);
  S.lower = sdRoundCone(x, y, z, sx * 0.22, 1.19, 0, sx * 0.232, 0.96, 0.012, 0.042, 0.031);
  S.hand = smin(sdBox(x, y, z, sx * 0.236, 0.9, 0.02, 0.024, 0.04, 0.036, 0.017), sdRoundCone(x, y, z, sx * 0.222, 0.925, 0.045, sx * 0.214, 0.89, 0.058, 0.013, 0.011), 0.01);
  S.thighL = sdRoundCone(x, y, z, -0.095, 0.93, 0, -0.095, 0.5, 0.005, 0.088, 0.058);
  S.thighR = sdRoundCone(x, y, z, 0.095, 0.93, 0, 0.095, 0.5, 0.005, 0.088, 0.058);
  S.calf = smin(sdRoundCone(x, y, z, sx * 0.095, 0.5, 0.005, sx * 0.095, 0.09, -0.005, 0.056, 0.04), sdEllipsoid(x, y, z, sx * 0.095, 0.35, -0.012, 0.05, 0.1, 0.052), 0.03);
  S.foot = sdEllipsoid(x, y, z, sx * 0.095, 0.045, 0.04, 0.045, 0.04, 0.11);
  S.sx = sx;
}

// 겹마다 거리. out[겹] = 거리
const LD = new Float32Array(16);
function layers(x, y, z) {
  parts(x, y, z);
  const sx = S.sx;
  const thigh = Math.min(S.thighL, S.thighR);
  let skin = smin(S.torso, S.neck, 0.03);
  skin = smin(skin, S.upper, 0.035);
  skin = smin(skin, S.lower, 0.02);
  skin = smin(skin, S.hand, 0.015);
  skin = smin(skin, S.thighL, 0.05);
  skin = smin(skin, S.thighR, 0.05);
  skin = smin(skin, S.calf, 0.03);
  skin = smin(skin, S.foot, 0.02);
  LD.fill(9);
  LD[L.skin] = skin;
  // 몸에서 10cm 넘게 떨어진 곳은 옷도 없다(목도리·두건이 가장 멀리 나온다). 거리만 대충 돌려준다
  if (skin > 0.1) {
    LD[L.skin] = skin - 0.09;
    return;
  }
  // 셔츠: 몸통(허리띠 아래로 조금 내려옴)과 팔꿈치 아래까지 오는 소매, 짧은 자락
  const fold = Math.abs(S.torso - 0.014) < 0.03 ? (noise3(x * 38, y * 9, z * 38) - 0.5) * 0.004 : 0;
  let shirt = smax(S.torso - 0.014 + fold, slabY(y, 0.965, 1.5), 0.01);
  shirt = Math.min(shirt, smax(S.upper - 0.016 + fold, slabY(y, 1.13, 1.6), 0.008));
  LD[L.shirt] = shirt;
  // 조끼: 앞이 V자로 트였고 진동(팔 구멍)이 있다
  let vest = smax(S.torso - 0.032, slabY(y, 0.975, 1.53), 0.01);
  const w = 0.012 + Math.max(0, y - 1.12) * 0.22;
  vest = smax(vest, -Math.max(Math.abs(x) - w, 0.02 - z, 1.1 - y), 0.012);
  if (y > 1.36) vest = smax(vest, -(S.upper - 0.012), 0.008);
  // 어깨 위는 끈처럼 좁게(어깨는 셔츠가 보인다)
  vest = smax(vest, -Math.max(0.125 - Math.abs(x), 1.425 - y), 0.012);
  LD[L.vest] = vest;
  // 바지
  let tr = smin(thigh - 0.012, S.calf - 0.01, 0.03);
  tr = smin(tr, smax(S.torso - 0.016, slabY(y, 0.84, 1.0), 0.01), 0.03);
  LD[L.trousers] = Math.abs(tr) < 0.02 ? tr + (noise3(x * 30, y * 12, z * 30) - 0.5) * 0.003 : tr;
  // 장화: 종아리·발을 감싸고, 위에 접힌 단, 아래에 밑창
  let boot = sdRoundCone(x, y, z, sx * 0.095, 0.33, 0, sx * 0.095, 0.08, -0.005, 0.062, 0.054);
  boot = smin(boot, sdRoundCone(x, y, z, sx * 0.095, 0.358, 0.0, sx * 0.095, 0.302, 0.0, 0.071, 0.066), 0.008);
  boot = smin(boot, sdEllipsoid(x, y, z, sx * 0.095, 0.06, 0.048, 0.058, 0.058, 0.135), 0.04);
  boot = smax(boot, 0.022 - y, 0.006);
  LD[L.boots] = boot;
  LD[L.sole] = smax(sdEllipsoid(x, y, z, sx * 0.095, 0.06, 0.048, 0.061, 0.07, 0.139), slabY(y, 0, 0.026), 0.003);
  // 허리띠·버클·주머니
  LD[L.belt] = Math.min(smax(S.torso - 0.036, slabY(y, 0.985, 1.03), 0.004), sdBox(x, y, z, 0.12, 0.955, 0.075, 0.042, 0.048, 0.03, 0.012));
  LD[L.metal] = sdBox(x, y, z, 0, 1.007, 0.142, 0.026, 0.022, 0.008, 0.004);
  // 팔토시·장갑
  LD[L.bracer] = smax(S.lower - 0.013, slabY(y, 0.965, 1.065), 0.006);
  LD[L.glove] = S.hand - 0.004;
  // 목도리와 접어 둔 두건(앞에 매듭과 꼬리)
  let sc = sdTorus(x, y, z, 0, 1.51, 0.005, 0.08, 0.04, 0.28);
  sc = smin(sc, sdTorus(x, y, z, 0, 1.55, 0.0, 0.068, 0.028, 0.18), 0.02);
  sc = smin(sc, sdEllipsoid(x, y, z, 0.03, 1.43, 0.108, 0.035, 0.045, 0.022), 0.02);
  sc = smin(sc, sdRoundCone(x, y, z, 0.035, 1.42, 0.112, 0.05, 1.3, 0.117, 0.024, 0.016), 0.01);
  sc = smin(sc, sdEllipsoid(x, y, z, 0, 1.505, -0.08, 0.125, 0.07, 0.075), 0.03);
  LD[L.scarf] = Math.abs(sc) < 0.02 ? sc + (noise3(x * 45, y * 45, z * 45) - 0.5) * 0.004 : sc;
}
function bodyField(x, y, z) {
  layers(x, y, z);
  let d = 9;
  for (let i = 0; i <= 10; i++) if (LD[i] < d) d = LD[i];
  return d;
}

// ── 머리 거리장(머리 뼈에 붙인다) ───────────────────
// ── 머리(v0.4.3): 매끈한 얼굴(눈·눈썹·입은 그림으로 붙인다) + 따로 깎은 머리카락 껍데기 ──
function headSkin0(x, y, z) {
  const sx = x < 0 ? -1 : 1;
  let h = sdEllipsoid(x, y, z, 0, 1.745, -0.01, 0.087, 0.1, 0.1);
  h = smin(h, sdEllipsoid(x, y, z, 0, 1.697, 0.024, 0.063, 0.062, 0.07), 0.045);
  h = smin(h, sdSphere(x, y, z, 0, 1.645, 0.057, 0.023), 0.035);
  h = smin(h, sdSphere(x, y, z, sx * 0.045, 1.705, 0.056, 0.032), 0.025);
  h = smin(h, sdEllipsoid(x, y, z, 0, 1.752, 0.078, 0.064, 0.022, 0.024), 0.025);
  // 그림 눈이 앉을 자리를 아주 살짝 누른다
  h = smax(h, -sdEllipsoid(x, y, z, sx * 0.032, 1.727, 0.098, 0.02, 0.012, 0.012), 0.01);
  // 작은 코, 낮은 입술
  h = smin(h, sdRoundCone(x, y, z, 0, 1.735, 0.093, 0, 1.704, 0.101, 0.007, 0.0095), 0.012);
  h = smin(h, sdSphere(x, y, z, 0, 1.702, 0.1, 0.0105), 0.008);
  h = smin(h, sdEllipsoid(x, y, z, 0, 1.663, 0.088, 0.02, 0.008, 0.012), 0.008);
  // 귀
  h = smin(h, smax(sdEllipsoid(x, y, z, sx * 0.087, 1.714, -0.006, 0.012, 0.03, 0.02), -sdSphere(x, y, z, sx * 0.094, 1.714, -0.001, 0.011), 0.004), 0.006);
  // 목
  return smin(h, sdRoundCone(x, y, z, 0, 1.58, -0.002, 0, 1.67, -0.012, 0.052, 0.049), 0.025);
}
// 머리카락 껍데기: 두개를 덮고(이마 위·귀 위·목덜미에서 끝남) 앞머리 몇 갈래, 정수리·뒷머리 숱
function hair0(x, y, z) {
  const sx = x < 0 ? -1 : 1;
  let hair = sdEllipsoid(x, y, z, 0, 1.756, -0.016, 0.1, 0.116, 0.114);
  hair = smin(hair, sdEllipsoid(x, y, z, 0.01, 1.8, -0.03, 0.098, 0.075, 0.1), 0.03);
  hair = smin(hair, sdEllipsoid(x, y, z, 0, 1.7, -0.07, 0.085, 0.07, 0.05), 0.03);
  const yLine = 1.645 + 0.115 * Math.min(1, Math.max(0, (z + 0.04) / 0.11));
  hair = smax(hair, yLine - y, 0.015);
  hair = smin(hair, sdEllipsoid(x, y, z, -0.035, 1.787, 0.083, 0.042, 0.022, 0.028), 0.012);
  hair = smin(hair, sdEllipsoid(x, y, z, 0.02, 1.783, 0.088, 0.046, 0.02, 0.026), 0.012);
  hair = smin(hair, sdEllipsoid(x, y, z, 0.06, 1.768, 0.066, 0.03, 0.03, 0.03), 0.012);
  hair = smin(hair, sdEllipsoid(x, y, z, sx * 0.088, 1.735, 0.012, 0.024, 0.045, 0.034), 0.015);
  if (Math.abs(hair) < 0.015) hair -= (noise3(x * 85, y * 26, z * 85) - 0.5) * 0.007;
  return hair;
}

// 머리는 조금 크게(호감형 비율): 머리 뼈 둘레로 HEAD_K배
export const HEAD_K = 1.08;
// 머리를 조금 내려 목을 짧게 보이게(호감형 비율)
export const HEAD_DROP = 0.016;
const HP = 1.62;
const scaled = (f) => (x, y, z) => f(x / HEAD_K, HP + (y - HP) / HEAD_K, z / HEAD_K) * HEAD_K;
const headField = scaled(headSkin0);
const hairField = scaled(hair0);

// 얼굴 그림 판: 얼굴 앞 격자를 피부 표면에 붙인다(앞에서 뒤로 이분 탐색). uv는 그림 좌표
export const FACE = { x0: -0.066, x1: 0.066, y0: 1.637, y1: 1.772 };
function faceDecal(N = 30) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = FACE.x0 + ((FACE.x1 - FACE.x0) * i) / N;
      const y = FACE.y0 + ((FACE.y1 - FACE.y0) * j) / N;
      let lo = -0.02;
      let hi = 0.16;
      for (let k = 0; k < 24; k++) {
        const m = (lo + hi) / 2;
        if (headSkin0(x, y, m) > 0) hi = m;
        else lo = m;
      }
      let z = hi;
      const e = 0.001;
      const gx = headSkin0(x + e, y, z) - headSkin0(x - e, y, z);
      const gy = headSkin0(x, y + e, z) - headSkin0(x, y - e, z);
      const gz = headSkin0(x, y, z + e) - headSkin0(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      const off = 0.0007;
      const px = x + (gx / gl) * off;
      const py = y + (gy / gl) * off;
      z += (gz / gl) * off;
      pos.push(px * HEAD_K, (py - HP) * HEAD_K + HP, z * HEAD_K);
      uv.push(i / N, j / N);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      idx.push(a, a + 1, a + N + 2, a, a + N + 2, a + N + 1);
    }
  }
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx) };
}

// ── 배낭(허리 뼈에 붙인다): 몸통·옆주머니·덮개·침낭·끈 ──────────
const PD = new Float32Array(4); // 0 캔버스, 1 가죽, 2 모직
function packLayers(x, y, z) {
  const sx = x < 0 ? -1 : 1;
  let body = sdBox(x, y, z, 0, 1.25, -0.205, 0.145, 0.16, 0.07, 0.04);
  if (Math.abs(body) < 0.02) body += (noise3(x * 30, y * 30, z * 30) - 0.5) * 0.006;
  body = smin(body, sdBox(x, y, z, sx * 0.152, 1.2, -0.2, 0.026, 0.07, 0.045, 0.016), 0.01);
  let leather = sdBox(x, y, z, 0, 1.372, -0.205, 0.152, 0.045, 0.077, 0.03);
  // 끈: 배낭 위에서 어깨를 넘어 가슴 앞으로, 가슴 끈 하나
  const st = (ax, ay, az, bx, by, bz) => sdRoundCone(x, y, z, ax, ay, az, bx, by, bz, 0.011, 0.011);
  leather = Math.min(leather,
    st(sx * 0.1, 1.4, -0.135, sx * 0.112, 1.528, -0.03),
    st(sx * 0.112, 1.528, -0.03, sx * 0.105, 1.45, 0.112),
    st(sx * 0.105, 1.45, 0.112, sx * 0.1, 1.3, 0.138),
    st(sx * 0.1, 1.3, 0.138, sx * 0.096, 1.12, 0.128),
    sdRoundCone(x, y, z, -0.1, 1.33, 0.142, 0.1, 1.33, 0.142, 0.008, 0.008),
    Math.hypot(Math.hypot(y - 1.455, z + 0.2) - 0.058, x - sx * 0.1) - 0.008);
  let wool = sdRoundCone(x, y, z, -0.17, 1.455, -0.2, 0.17, 1.455, -0.2, 0.055, 0.055);
  if (Math.abs(wool) < 0.02) wool += (noise3(x * 40, y * 40, z * 40) - 0.5) * 0.005;
  PD[0] = body;
  PD[1] = leather;
  PD[2] = wool;
}
function packField(x, y, z) {
  packLayers(x, y, z);
  return Math.min(PD[0], PD[1], PD[2]);
}

// ── 피부 가중치: 부분(무리)을 고르고 관절 근처에서 두 뼈를 섞는다 ──────
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function skinWeights(x, y, z, layer) {
  parts(x, y, z);
  const s = x < 0 ? 'L' : 'R';
  const thighS = x < 0 ? S.thighL : S.thighR;
  const cand = [
    ['torso', S.torso], ['neck', S.neck], ['upper', S.upper], ['lower', S.lower], ['hand', S.hand],
    ['thigh', thighS], ['calf', S.calf], ['foot', S.foot],
  ];
  let g = 'torso';
  let gd = Infinity;
  for (const [k, d] of cand) {
    if (d < gd) {
      gd = d;
      g = k;
    }
  }
  // 목도리·두건은 목과 허리 사이, 셔츠 자락은 엉덩이
  if (layer === L.scarf) return [[BI.neck, 0.45], [BI.spine, 0.55]];
  if (layer === L.shirt && y < 1.0 && g !== 'upper') return [[BI.hips, 1]];
  const w = [];
  if (g === 'torso' || g === 'neck') {
    const hs = ss(1.0, 1.12, y);
    const sn = ss(1.48, 1.58, y);
    if (y < 1.06 && (g !== 'neck')) {
      w.push([BI.hips, 1 - hs], [BI.spine, hs]);
    } else if (sn > 0) {
      w.push([BI.spine, 1 - sn], [BI.neck, sn]);
    } else {
      w.push([BI.spine, 1]);
    }
    // 어깨 근처 몸통은 팔을 조금 따라간다
    const sh = ss(0.12, 0.2, Math.abs(x)) * ss(1.3, 1.42, y) * 0.45;
    if (sh > 0) w.push([BI[`sh${s}`], sh]);
    // 엉덩이 아래쪽 몸통은 허벅지를 조금 따라간다
    const hp = ss(0.95, 0.86, y) * ss(0.03, 0.09, Math.abs(x)) * 0.5;
    if (hp > 0) w.push([BI[`th${s}`], hp]);
  } else if (g === 'upper' || g === 'lower' || g === 'hand') {
    const shoulder = ss(1.38, 1.47, y) * 0.4;
    const el = ss(1.24, 1.14, y);
    const wr = ss(0.99, 0.93, y);
    if (y > 1.24) w.push([BI[`sh${s}`], 1 - shoulder], [BI.spine, shoulder]);
    else if (y > 1.02) w.push([BI[`sh${s}`], 1 - el], [BI[`el${s}`], el]);
    else w.push([BI[`el${s}`], 1 - wr], [BI[`hand${s}`], wr]);
  } else {
    const hip = ss(0.86, 0.96, y) * 0.5;
    const kn = ss(0.55, 0.45, y);
    const an = ss(0.13, 0.06, y);
    if (y > 0.55) w.push([BI[`th${s}`], 1 - hip], [BI.hips, hip]);
    else if (y > 0.13) w.push([BI[`th${s}`], 1 - kn], [BI[`kn${s}`], kn]);
    else w.push([BI[`kn${s}`], 1 - an], [BI[`ft${s}`], an]);
  }
  return w;
}

// ── 메시 만들기(한 번만 만들고 모든 캐릭터가 나눠 쓴다) ──────────
// 바깥 겹부터(같은 자리면 이 순서로 색을 정한다)
const PRI = [L.metal, L.belt, L.bracer, L.glove, L.scarf, L.vest, L.shirt, L.sole, L.boots, L.trousers, L.skin];

export function buildBase() {
  const t0 = performance.now();
  const body = surfaceNets(bodyField, [-0.33, -0.01, -0.17], [0.33, 1.66, 0.23], 0.013, { relax: 1 });
  const bl = new Uint8Array(body.count);
  const bl2 = new Uint8Array(body.count);
  const blend = new Uint8Array(body.count);
  const skinIdx = new Uint16Array(body.count * 4);
  const skinW = new Float32Array(body.count * 4);
  for (let v = 0; v < body.count; v++) {
    const x = body.positions[v * 3];
    const y = body.positions[v * 3 + 1];
    const z = body.positions[v * 3 + 2];
    layers(x, y, z);
    // 표면에 거의 닿은 겹 가운데 바깥 겹을 고른다(겹 사이 턱의 벽이 바깥 겹 색이 되어 가장자리가 깔끔하다)
    let min = Infinity;
    for (let i = 0; i <= 10; i++) if (LD[i] < min) min = LD[i];
    let best = L.skin;
    for (const l of PRI) {
      if (LD[l] < min + 0.009) {
        best = l;
        break;
      }
    }
    bl[v] = best;
    bl2[v] = best;
    blend[v] = 0;
    const w = skinWeights(x, y, z, best);
    // 같은 뼈를 합치고 큰 것 넷만 남겨 정규화
    const acc = new Map();
    for (const [b, k] of w) acc.set(b, (acc.get(b) || 0) + k);
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, k]) => s + k, 0) || 1;
    top.forEach(([b, k], i) => {
      skinIdx[v * 4 + i] = b;
      skinW[v * 4 + i] = k / sum;
    });
  }
  const K = HEAD_K;
  const head = surfaceNets(headField, [-0.105 * K, HP + (1.57 - HP) * K, -0.115 * K], [0.105 * K, HP + (1.86 - HP) * K, 0.125 * K], 0.0064, { relax: 2 });
  const hl = new Uint8Array(head.count).fill(L.skin);
  const hair = surfaceNets(hairField, [-0.118 * K, HP + (1.64 - HP) * K, -0.14 * K], [0.118 * K, HP + (1.9 - HP) * K, 0.132 * K], 0.0066, { relax: 2 });
  const hrl = new Uint8Array(hair.count).fill(L.hair);
  const face = faceDecal(30);
  const pack = surfaceNets(packField, [-0.25, 1.04, -0.31], [0.25, 1.57, 0.17], 0.015, { relax: 1 });
  const pl = new Uint8Array(pack.count);
  for (let v = 0; v < pack.count; v++) {
    packLayers(pack.positions[v * 3], pack.positions[v * 3 + 1], pack.positions[v * 3 + 2]);
    pl[v] = PD[1] <= PD[0] && PD[1] <= PD[2] ? L.belt : PD[2] < PD[0] ? L.wool : L.canvas;
  }
  return { body, bl, bl2, blend, skinIdx, skinW, head, hl, hair, hrl, face, pack, pl, ms: Math.round(performance.now() - t0) };
}
