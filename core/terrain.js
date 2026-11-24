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
  const SW = T.swamp || null;
  function shoreZ(x) {
    return T.shore
      + T.shoreWobble * (valueNoise(x / 70, 0.5, s + 7) * 2 - 1)
      + 0.4 * T.shoreWobble * (valueNoise(x / 21, 3.5, s + 9) * 2 - 1);
  }

  function baseHeight(x, z) {
    const d = z - shoreZ(x); // 해안선에서 뭍 쪽으로 잰 거리
    let h = d < 0
      ? Math.max(T.seaFloor, d * 0.16)
      : T.beach * smoothstep(0, 18, d) + T.inland * smoothstep(12, 320, d);
    h += (fbm(x / 85, z / 85, s + 31, 4) - 0.45) * T.hills * smoothstep(8, 120, d);
    h += (fbm(x / 9, z / 9, s + 57, 2) - 0.5) * 0.5 * smoothstep(-3, 8, d);
    // 늪(v0.6): swamp.z0 북쪽은 물 높이 가까이 내려앉는다. 웅덩이(물)와 진흙 둔덕이 섞인다
    if (SW) {
      const k = smoothstep(SW.z0 - SW.fade, SW.z0 + SW.fade, z + (valueNoise(x / 40, 9.5, s + 13) - 0.5) * 24);
      if (k > 0) h = h * (1 - k) + (SW.level + (fbm(x / 26, z / 26, s + 91, 3) - 0.5) * SW.amp) * k;
    }
    const edge = Math.max(smoothstep(x0 + 32, x0, x), smoothstep(x1 - 32, x1, x), smoothstep(z1 - 32, z1, z));
    if (edge > 0) h += edge * T.ridge * (0.75 + 0.5 * fbm(x / 18, z / 18, s + 77, 2));
    return h;
  }

  // 정착지 둘레는 평평하게 다진다. 해안 마을은 정해진 높이, 내륙 마을(flat: local)은 그 자리 높이로.
  const towns = (region.settlements || []).map((t) => ({
    x: t.x, z: t.z, radius: t.radius, h: t.flat === 'local' ? baseHeight(t.x, t.z) : T.townHeight,
  }));
  // 늪 마을 같은 자리(v0.6)도 flat 높이로 다진다(물 위 마른 땅)
  for (const st of region.sites || []) if (st.flat != null && st.x != null) towns.push({ x: st.x, z: st.z, radius: st.r, h: st.flat === 'local' ? baseHeight(st.x, st.z) : st.flat });

  function height(x, z) {
    let h = baseHeight(x, z);
    for (const t of towns) {
      const dt = Math.hypot(x - t.x, z - t.z);
      if (dt < t.radius + 16) {
        const k = smoothstep(t.radius + 16, t.radius - 6, dt);
        h = h * (1 - k) + t.h * k;
      }
    }
    return h;
  }

  // 섬 가장자리(edge m)는 빽빽한 숲이라 들어갈 수 없다. 남쪽은 바다라 열어 둔다.
  const E = T.edge ?? 1;
  const walkable = (x, z) => x >= x0 + E && x <= x1 - E && z >= z0 + 1 && z <= z1 - E && height(x, z) > T.wadeDepth;

  return {
    height,
    shoreZ,
    walkable,
    seed: s,
    // 해안선에서 뭍 쪽으로 inland m 들어간 점
    beachPoint: (x, inland) => [x, shoreZ(x) + inland],
  };
}

// 여러 지역(v0.6): 한 좌표계에 지역을 x로 겹치지 않게 늘어놓는다(등대섬 0~400, 본섬 1000~).
// 어느 지역인지는 좌표로 안다. 지역 사이는 걸어서 건널 수 없다(가장자리 숲·바다).
export function regionAt(regions, x) {
  let best = regions[0];
  let bd = Infinity;
  for (const r of regions) {
    const d = x < r.bounds[0] ? r.bounds[0] - x : x > r.bounds[2] ? x - r.bounds[2] : 0;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

export function makeWorld(regions, worldSeed) {
  const by = new Map(regions.map((r) => [r.id, makeTerrain(r, worldSeed)]));
  const at = (x) => by.get(regionAt(regions, x).id);
  return {
    height: (x, z) => at(x).height(x, z),
    shoreZ: (x) => at(x).shoreZ(x),
    walkable: (x, z) => at(x).walkable(x, z),
    beachPoint: (x, inland) => at(x).beachPoint(x, inland),
    regionAt: (x) => regionAt(regions, x),
    of: (id) => by.get(id),
    seed: by.get(regions[0].id).seed,
  };
}

// 구역: 지역 안에서 북쪽으로 일정 선(z0)을 넘으면 그 구역이다(v0.3 참나무 숲)
export function zoneAt(region, x, z) {
  let found = null;
  for (const zn of region.zones || []) if (z >= zn.z0) found = zn;
  return found;
}

// 노드 서식지 검사: 높이 범위, 정착지·가장자리 피하기, 구역(zone이 있으면 그 구역 안, 없으면 구역 밖)
export function fitsHabitat(terrain, region, nodeType, x, z) {
  const hab = nodeType.habitat;
  const [x0, z0, x1, z1] = region.bounds;
  const m = Math.max(14, (region.terrain.edge ?? 0) + 2);
  if (x < x0 + m || x > x1 - m || z < z0 + 2 || z > z1 - m) return false;
  for (const t of region.settlements) if (Math.hypot(x - t.x, z - t.z) < t.radius + 6) return false;
  // 야영지·정박지(v0.5) 안에는 나지 않는다
  for (const s of region.sites || []) {
    if (!s.members && !s.structures?.length) continue;
    const [sx, sz] = s.beach ? terrain.beachPoint(s.beach[0], s.beach[1]) : [s.x, s.z];
    if (Math.hypot(x - sx, z - sz) < s.r + 4) return false;
  }
  const zone = zoneAt(region, x, z);
  if (nodeType.zone) {
    if (!zone || zone.id !== nodeType.zone) return false;
    if (nodeType.deep && z < zone.z0 + nodeType.deep) return false;
  } else if (zone) return false;
  const h = terrain.height(x, z);
  return h >= hab[0] && h <= hab[1];
}
