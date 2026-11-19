// 저장·불러오기와 패치 호환(마이그레이션).
// 자동 패치가 잦으니 데이터 구조가 바뀌면 여기에 옮기는 함수를 하나씩 더한다.

import { makeRng, seedState } from './rng.js';
import { makeTerrain, fitsHabitat, hashStr } from './terrain.js';
import { stationLayout } from './world.js';
import { pickCenter, pickNodeSpot, openVein } from './systems/veins.js';
import { initCombat, emptyEquip } from './systems/combat.js';
import { initMobs } from './systems/mobs.js';
import { makeClock } from './clock.js';

// 마이그레이션에서 산지·짐승을 새로 놓을 때 쓰는 작은 실행 문맥
function migrationCtx(st, data, salt) {
  const region = data.lists.regions[0];
  return {
    state: st, data, cfg: data.config, clock: makeClock(data.config),
    rng: makeRng(seedState((st.meta.worldSeed ^ salt) >>> 0)),
    terrain: makeTerrain(region, st.meta.worldSeed),
    newId: (p) => `${p}_${st.nextId++}`,
    emit: () => {}, obstaclesDirty: true,
  };
}
import { spawnPoint } from './state.js';
import { emptyMarket } from './market.js';
import { initEcon } from './systems/economy.js';

export const SAVE_FORMAT = 'mist-isle-save';

const MIGRATIONS = [
  {
    // v0.0 → v0.1: 30Hz 틱, 지형, 작업대 자리, 노드를 서식지로 옮기기
    from: 1,
    to: 2,
    run(st, data) {
      const hz = data.config.time.hz;
      st.tick = Math.round(st.t * hz);
      st.t = st.tick / hz;
      st.meta.worldSeed = st.meta.worldSeed ?? st.meta.seed;
      st.meta.engine = '0.1.0';
      const region = data.lists.regions[0];
      const terrain = makeTerrain(region, st.meta.worldSeed);
      for (const s of Object.values(st.settlements)) s.stations = stationLayout(region);
      // 노드 자리만 새로 고른다. 산지 이름·속성·남은 횟수는 그대로 둔다.
      for (const v of Object.values(st.veins)) {
        const type = data.nodes[v.node];
        const rng = makeRng(seedState((st.meta.worldSeed ^ hashStr(v.id)) >>> 0));
        if (!v.common) v.center = pickCenter(rng, terrain, region, type, v.radius) || v.center;
        for (const id of v.nodes) {
          const n = st.nodes[id];
          if (!n || fitsHabitat(terrain, region, type, n.x, n.z)) continue;
          const spot = pickNodeSpot(rng, terrain, region, type, v.common ? null : v.center, v.radius);
          if (spot) {
            n.x = spot[0];
            n.z = spot[1];
          }
        }
      }
      const home = spawnPoint(region, terrain);
      for (const a of Object.values(st.actors)) {
        a.yaw = 0;
        a.move = null;
        a.stuck = 0;
        a.dest = null;
        a.nav = null;
        a.recallReadyAt = 0;
        if (!terrain.walkable(a.x, a.z)) {
          a.x = home[0];
          a.z = home[1];
        }
        if (a.ai) a.ai.mem = {};
      }
    },
  },
  {
    // v0.1.1 → v0.1.2: 섬 가장자리 20m가 숲이 됐다. 그 안에 있던 노드와 캐릭터를 안쪽으로 옮긴다.
    from: 2,
    to: 3,
    run(st, data) {
      st.meta.engine = '0.1.2';
      const region = data.lists.regions[0];
      const terrain = makeTerrain(region, st.meta.worldSeed);
      for (const v of Object.values(st.veins)) {
        const type = data.nodes[v.node];
        const rng = makeRng(seedState((st.meta.worldSeed ^ hashStr(v.id + ':edge')) >>> 0));
        for (const id of v.nodes) {
          const n = st.nodes[id];
          if (!n || fitsHabitat(terrain, region, type, n.x, n.z)) continue;
          const spot = pickNodeSpot(rng, terrain, region, type, v.common ? null : v.center, v.radius);
          if (spot) {
            n.x = spot[0];
            n.z = spot[1];
          }
        }
      }
      const home = spawnPoint(region, terrain);
      for (const a of Object.values(st.actors)) {
        if (terrain.walkable(a.x, a.z)) continue;
        a.x = home[0];
        a.z = home[1];
        a.dest = null;
        a.nav = null;
      }
    },
  },
  {
    // v0.1.2 → v0.2: 은화·거래소·주문 게시판·AI 개척민 경제
    from: 3,
    to: 4,
    run(st, data) {
      st.meta.engine = '0.2.0';
      for (const a of Object.values(st.actors)) a.silver = a.silver ?? data.config.market.startSilver;
      st.market = st.market || emptyMarket();
      st.orders = st.orders || [];
      const rng = makeRng(seedState((st.meta.worldSeed ^ 0x2e5bf271) >>> 0));
      st.econ = st.econ || initEcon({ cfg: data.config, rng });
    },
  },
  {
    // v0.2.1 → v0.3: 체력·장비, 짐승, 북쪽 참나무 숲(T2). 숲에 있던 T1 노드는 숲 밖으로 옮긴다.
    from: 4,
    to: 5,
    run(st, data) {
      st.meta.engine = '0.3.0';
      const cfg = data.config;
      for (const a of Object.values(st.actors)) {
        a.cb = a.cb || initCombat(cfg);
        a.equip = a.equip || emptyEquip();
        a.stats = { kills: {}, skin: {}, downs: 0, dmgDealt: 0, dmgTaken: 0, ...a.stats };
      }
      const region = data.lists.regions[0];
      const ctx = migrationCtx(st, data, 0x3c6ef372);
      const { rng, terrain } = ctx;
      for (const v of Object.values(st.veins)) {
        const type = data.nodes[v.node];
        if (!v.common && v.center && !fitsHabitat(terrain, region, type, v.center[0], v.center[1])) {
          v.center = pickCenter(rng, terrain, region, type, v.radius) || v.center;
        }
        for (const id of v.nodes) {
          const n = st.nodes[id];
          if (!n || fitsHabitat(terrain, region, type, n.x, n.z)) continue;
          const spot = pickNodeSpot(rng, terrain, region, type, v.common ? null : v.center, v.radius);
          if (spot) {
            n.x = spot[0];
            n.z = spot[1];
          }
        }
      }
      for (const vc of region.veins) {
        if (Object.values(st.veins).some((v) => v.node === vc.node)) continue;
        if (vc.common) openVein(ctx, region, vc, { common: true });
        for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
      }
      st.mobs = st.mobs || {};
      st.mobGroups = st.mobGroups || {};
      if (!Object.keys(st.mobGroups).length) initMobs(ctx);
    },
  },
];

export function serialize(state) {
  return JSON.stringify({ format: SAVE_FORMAT, dataVersion: state.meta.dataVersion, state });
}

export function deserialize(text, data) {
  const obj = JSON.parse(text);
  if (obj.format !== SAVE_FORMAT) throw new Error('세이브 형식이 아님');
  const st = obj.state;
  let v = obj.dataVersion;
  for (const m of MIGRATIONS) {
    if (m.from === v) {
      m.run(st, data);
      v = m.to;
    }
  }
  if (v !== data.config.dataVersion) throw new Error(`옮길 수 없는 세이브 버전: ${v}`);
  st.meta.dataVersion = v;
  return st;
}

// 키 순서와 무관한 문자열 → 해시. 재현성 테스트에 쓴다.
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function hashState(state) {
  const s = stableStringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
