// 지형 높이 함수. 코어(이동·노드 배치)와 3D 화면(지형 메시)이 같은 함수를 쓴다.
// 결정적이다: 같은 지역·같은 월드 시드면 같은 섬이 나온다. Math.random을 쓰지 않는다.

function hash2(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

const fade = (t) => t * t * (3 - 2 * t);

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function fbm(x, z, seed, octaves = 4) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += valueNoise(x * f, z * f, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm; // 0..1
}

// region.terrain 값으로 섬 하나를 만든다. 남쪽(z가 작은 쪽)이 바다다.
export function makeTerrain(region, worldSeed) {
  const T = region.terrain;
  const s = (worldSeed ^ hashStr(region.id)) | 0;
  const [x0, z0, x1, z1] = region.bounds;
  const town = region.settlement;

  function shoreZ(x) {
    return T.shore
      + T.shoreWobble * (valueNoise(x / 70, 0.5, s + 7) * 2 - 1)
      + 0.4 * T.shoreWobble * (valueNoise(x / 21, 3.5, s + 9) * 2 - 1);
  }

  function height(x, z) {
    const d = z - shoreZ(x); // 해안선에서 뭍 쪽으로 잰 거리
    let h = d < 0
      ? Math.max(T.seaFloor, d * 0.16)
      : T.beach * smoothstep(0, 18, d) + T.inland * smoothstep(12, 320, d);
    h += (fbm(x / 85, z / 85, s + 31, 4) - 0.45) * T.hills * smoothstep(8, 120, d);
    h += (fbm(x / 9, z / 9, s + 57, 2) - 0.5) * 0.5 * smoothstep(-3, 8, d);
    const edge = Math.max(smoothstep(x0 + 32, x0, x), smoothstep(x1 - 32, x1, x), smoothstep(z1 - 32, z1, z));
    if (edge > 0) h += edge * T.ridge * (0.75 + 0.5 * fbm(x / 18, z / 18, s + 77, 2));
    const dt = Math.hypot(x - town.x, z - town.z);
    if (dt < town.radius + 16) {
      const k = smoothstep(town.radius + 16, town.radius - 6, dt);
      h = h * (1 - k) + T.townHeight * k;
    }
    return h;
  }

  const walkable = (x, z) => x >= x0 + 1 && x <= x1 - 1 && z >= z0 + 1 && z <= z1 - 1 && height(x, z) > T.wadeDepth;

  return {
    height,
    shoreZ,
    walkable,
    seed: s,
    // 해안선에서 뭍 쪽으로 inland m 들어간 점
    beachPoint: (x, inland) => [x, shoreZ(x) + inland],
  };
}

// 노드 서식지 검사: 높이 범위, 정착지·가장자리 피하기
export function fitsHabitat(terrain, region, nodeType, x, z) {
  const hab = nodeType.habitat;
  const [x0, z0, x1, z1] = region.bounds;
  const m = 14;
  if (x < x0 + m || x > x1 - m || z < z0 + 2 || z > z1 - m) return false;
  const t = region.settlement;
  if (Math.hypot(x - t.x, z - t.z) < t.radius + 6) return false;
  const h = terrain.height(x, z);
  return h >= hab[0] && h <= hab[1];
}
