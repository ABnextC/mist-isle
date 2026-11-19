// 저장·불러오기와 패치 호환(마이그레이션).
// 자동 패치가 잦으니 데이터 구조가 바뀌면 여기에 옮기는 함수를 하나씩 더한다.

import { makeRng, seedState } from './rng.js';
import { makeTerrain, fitsHabitat, hashStr } from './terrain.js';
import { stationLayout } from './world.js';
import { pickCenter, pickNodeSpot, openVein } from './systems/veins.js';
import { initCombat, emptyEquip } from './systems/combat.js';
import { initMobs, groupSpot } from './systems/mobs.js';
import { makeClock } from './clock.js';
import { newSettlement, initProjects, settlementDaily } from './settlements.js';

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
import { initEcon, addMissingAgents } from './systems/economy.js';

// 노드·산지 중심이 서식지(정착지 둘레 포함)를 벗어났으면 옮긴다
function relocateNodes(st, data, ctx) {
  const region = data.lists.regions[0];
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
}

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
      for (const s of Object.values(st.settlements)) s.stations = stationLayout(data.settlements[s.id] || region.settlements[0]);
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
      st.econ = st.econ || initEcon({ cfg: data.config, rng, state: st });
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
  {
    // v0.3.1 → v0.4: 정착지가 둘(숲머리). 창고·거래소·수요·의뢰가 마을마다 따로, 마을 사업, AI 개척민 9명 추가.
    from: 5,
    to: 6,
    run(st, data) {
      st.meta.engine = '0.4.0';
      const cfg = data.config;
      const region = data.lists.regions[0];
      const first = region.settlements[0].id;
      const ctx = migrationCtx(st, data, 0x4d2c9a15);
      // 정착지: 있던 마을은 작업대 자리를 지키고 인구·번영도를 붙인다. 숲머리는 새로 연다.
      for (const sdef of region.settlements) {
        const old = st.settlements[sdef.id];
        const fresh = newSettlement(region, sdef, cfg);
        if (old) fresh.stations = old.stations.map((x) => ({ ...x, base: x.base ?? x.tier }));
        st.settlements[sdef.id] = fresh;
      }
      // 거래소: 하나였던 호가창·기준가·마을 수요는 등대 마을 것이 된다
      const m = st.market || emptyMarket();
      if (!m.books) {
        const tag = (o) => ({ ...o, at: first, owner: o.kind === 'town' ? first : o.owner });
        const book = { asks: (m.asks || []).map(tag), bids: (m.bids || []).map(tag), ref: m.ref || {}, trades: m.trades || [] };
        const town = m.town || {};
        st.market = { nextOid: m.nextOid || 1, books: { [first]: book }, stats: m.stats || {} };
        const d = st.settlements[first].demand;
        Object.assign(d, { silver: town.silver ?? 0, paid: town.paid ?? 0, used: town.used || {}, want: town.want || {}, mult: town.mult || {} });
        for (const k of Object.keys(d.mult)) d.mult[k] = Math.min(cfg.town.grow.max, d.mult[k]);
      }
      for (const o of st.orders || []) o.at = o.at || first;
      // 창고는 등대 마을 창고로, 귀환 지점은 등대 마을로
      for (const a of Object.values(st.actors)) {
        a.storages = a.storages || { [first]: a.storage || [] };
        delete a.storage;
        a.home = a.home || first;
        a.standing = a.standing || {};
        for (const j of a.queue || []) j.at = j.at || first;
        if (a.ai) a.ai.mem = {};
      }
      st.projects = st.projects || initProjects(data);
      // 숲머리 자리에 있던 노드·산지·짐승 무리를 옮긴다
      relocateNodes(st, data, ctx);
      const taken = Object.values(st.mobGroups || {});
      for (const g of taken) {
        const type = data.creatures[g.type];
        if (!region.settlements.some((t) => Math.hypot(g.x - t.x, g.z - t.z) < t.radius + 18 + type.radius)) continue;
        const spot = groupSpot(ctx, region, type, taken.filter((x) => x !== g));
        if (!spot) continue;
        const [dx, dz] = [spot[0] - g.x, spot[1] - g.z];
        g.x = spot[0];
        g.z = spot[1];
        for (const id of g.mobs) {
          const mob = st.mobs[id];
          if (!mob) continue;
          mob.x = Math.round((mob.x + dx) * 1000) / 1000;
          mob.z = Math.round((mob.z + dz) * 1000) / 1000;
          mob.mode = 'idle';
          mob.target = null;
          mob.dest = null;
        }
      }
      // AI 개척민: 사는 마을을 정하고, 숲머리 개척민을 더한다
      if (st.econ) {
        for (const a of st.econ.agents) {
          a.home = a.home || first;
          a.shipped = a.shipped || 0;
          a.donated = a.donated || 0;
        }
        addMissingAgents(ctx);
      }
      // 새 마을의 첫 수요와 의뢰
      for (const s of Object.values(st.settlements)) {
        if (!Object.keys(s.demand.want).length) settlementDaily(ctx, s);
      }
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
