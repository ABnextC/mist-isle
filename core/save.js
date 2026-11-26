// 저장·불러오기와 패치 호환(마이그레이션).
// 자동 패치가 잦으니 데이터 구조가 바뀌면 여기에 옮기는 함수를 하나씩 더한다.

import { makeRng, seedState } from './rng.js';
import { makeTerrain, makeWorld, fitsHabitat, hashStr } from './terrain.js';
import { stationLayout, stationAt } from './world.js';
import { pickCenter, pickNodeSpot, openVein } from './systems/veins.js';
import { initCombat, emptyEquip } from './systems/combat.js';
import { emptyPvp } from './systems/pvp.js';
import { emptyRivals, initRivals } from './systems/rivals.js';
import { emptyTerritory, initTerritory } from './systems/territory.js';
import { initMobs, groupSpot } from './systems/mobs.js';
import { emptyQuests, startQuest, firstQuest } from './systems/quests.js';
import { makeClock } from './clock.js';
import { newSettlement, initProjects, settlementDaily, finishIfFull } from './settlements.js';

// 마이그레이션에서 산지·짐승을 새로 놓을 때 쓰는 작은 실행 문맥
function migrationCtx(st, data, salt) {
  return {
    state: st, data, cfg: data.config, clock: makeClock(data.config),
    rng: makeRng(seedState((st.meta.worldSeed ^ salt) >>> 0)),
    terrain: makeWorld(data.lists.regions, st.meta.worldSeed),
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
  {
    // v0.4.x → v0.5: 검은 돛 약탈단(망루·야영지·정박지), 밤의 안개 늑대, 메인 퀘스트·현상금, 날아가는 손도끼
    from: 6,
    to: 7,
    run(st, data) {
      st.meta.engine = '0.5.0';
      const region = data.lists.regions[0];
      const ctx = migrationCtx(st, data, 0x5b1ac7e3);
      st.shots = st.shots || [];
      // 야영지 자리에 있던 노드·짐승 무리를 옮긴다
      relocateNodes(st, data, ctx);
      relocateGroups(st, data, ctx, region);
      // 새 무리(안개 늑대)와 자리 무리(약탈단)를 더한다. 있던 짐승 무리는 그대로
      initMobs(ctx);
      // 퀘스트: 사람 개척자는 1장 첫 퀘스트부터
      const q0 = firstQuest(data);
      for (const a of Object.values(st.actors)) {
        a.quests = a.quests || emptyQuests();
        if (a.kind === 'player' && q0 && !Object.keys(a.quests.active).length && !Object.keys(a.quests.done).length) startQuest(ctx, a, q0);
      }
    },
  },
  {
    // v0.5 → v0.5.1: 2장 「꺼져 가는 등불」 — 본토 배 난파 자리·옛 등불터(망령·돌 해태), 밤 망령.
    // 1장을 끝낸 사람의 2장 시작은 퀘스트 틱이 잇는다(catchUp)
    from: 7,
    to: 8,
    run(st, data) {
      st.meta.engine = '0.5.1';
      const region = data.lists.regions[0];
      const ctx = migrationCtx(st, data, 0x2c4a9e71);
      relocateNodes(st, data, ctx);
      relocateGroups(st, data, ctx, region);
      initMobs(ctx);
    },
  },
  {
    // v0.5.1 → v0.5.2: 등대섬(튜토리얼 섬). 1~2장에 생활 단계를 끼우고 2장에 「숲머리 대장간」을 넣었다.
    // 주문·마을 사업·운송·산지 소문은 3장에서 연다(해금은 상태 없이 퀘스트로 정한다)
    from: 8,
    to: 9,
    run(st, data) {
      st.meta.engine = '0.5.2';
      for (const a of Object.values(st.actors)) {
        const Q = a.quests;
        if (!Q) continue;
        for (const [id, map] of Object.entries(STEP_MAP_9)) {
          const p = Q.active[id];
          if (p && map[p.step] != null) p.step = map[p.step];
        }
        // 이미 옛터 쪽으로 넘어간 개척자는 대장간 퀘스트를 지난 것으로 친다
        if (Q.done.c2_forge == null && AFTER_FORGE.some((id) => Q.active[id] || Q.done[id] != null)) {
          delete Q.active.c2_forge;
          Q.done.c2_forge = st.t;
        }
      }
      // 숲머리 대장간 사업은 앞 사업 없이 등대섬 규모로 줄었다. 이미 모인 것으로 다 찼으면 바로 선다
      if (st.projects?.pj_f_forge) finishIfFull(migrationCtx(st, data, 0x51f0a2d3), 'pj_f_forge');
    },
  },
  {
    // v0.5.2 → v0.6: 안개 벽 너머 본섬(늪 기슭)이 생겼다. 새 마을 둘·산지·짐승 무리·사업을 만든다.
    // AI 개척민(경제)은 본섬 두 마을로 옮기고, 등대섬엔 작은 장터 몫의 개척민 몇만 새로 둔다.
    from: 9,
    to: 10,
    run(st, data) {
      st.meta.engine = '0.6.0';
      const ctx = migrationCtx(st, data, 0x60a11e55);
      const cfg = data.config;
      for (const region of data.lists.regions) {
        if (st.regions[region.id]) continue;
        const density = {};
        for (const fam of Object.keys(cfg.families)) density[fam] = 1;
        st.regions[region.id] = { id: region.id, density };
        for (const sdef of region.settlements) if (!st.settlements[sdef.id]) st.settlements[sdef.id] = newSettlement(region, sdef, cfg);
        for (const vc of region.veins) {
          if (vc.common) openVein(ctx, region, vc, { common: true });
          for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
        }
      }
      for (const p of data.lists.projects) {
        if (!st.projects[p.id]) st.projects[p.id] = { id: p.id, at: p.at, got: {}, silver: 0, done: false, doneDay: null, by: {} };
      }
      initMobs(ctx);
      const homes = Object.fromEntries(cfg.econ.agents.map((x) => [x.id, x.home]));
      for (const ag of st.econ?.agents || []) if (homes[ag.id]) ag.home = homes[ag.id];
      if (st.econ) addMissingAgents(ctx);
    },
  },
  {
    // v0.6 → v0.6.1: 3장 뒷부분의 자리(이무기 소·측량 천막·가라앉은 탑)에 무리를 세운다
    from: 10,
    to: 11,
    run(st, data) {
      st.meta.engine = '0.6.1';
      initMobs(migrationCtx(st, data, 0x61e7b3c9));
    },
  },
  {
    // v0.6.1 → v0.7: 세력(4장). 모든 행위자는 아직 세력이 없다
    from: 11,
    to: 12,
    run(st) {
      st.meta.engine = '0.7.0';
      for (const a of Object.values(st.actors)) a.faction ??= null;
    },
  },
  {
    // v0.7 → v0.7.1: 4장 뒷부분의 자리(펌프실·잿빛 요새)에 무리를 세운다
    from: 12,
    to: 13,
    run(st, data) {
      st.meta.engine = '0.7.1';
      initMobs(migrationCtx(st, data, 0x71a5c0de));
    },
  },
  {
    // v0.7.1 → v0.8: 내 집
    from: 13,
    to: 14,
    run(st) {
      st.meta.engine = '0.8.0';
      st.houses ??= {};
      for (const a of Object.values(st.actors)) a.house ??= null;
    },
  },
  {
    // v0.8 → v0.8.1: 조합
    from: 14,
    to: 15,
    run(st) {
      st.meta.engine = '0.8.1';
      st.guilds ??= {};
      for (const a of Object.values(st.actors)) a.guild ??= null;
    },
  },
  {
    // v0.8.1 → v0.9: 불과 서리 능선(5장). 새 지역의 마을·산지·짐승·자리 무리를 만든다
    from: 15,
    to: 16,
    run(st, data) {
      st.meta.engine = '0.9.0';
      const ctx = migrationCtx(st, data, 0x90e3b7a1);
      const cfg = data.config;
      for (const region of data.lists.regions) {
        if (st.regions[region.id]) continue;
        const density = {};
        for (const fam of Object.keys(cfg.families)) density[fam] = 1;
        st.regions[region.id] = { id: region.id, density };
        for (const sdef of region.settlements) if (!st.settlements[sdef.id]) st.settlements[sdef.id] = newSettlement(region, sdef, cfg);
        for (const vc of region.veins) {
          if (vc.common) openVein(ctx, region, vc, { common: true });
          for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
        }
      }
      initMobs(ctx);
    },
  },
  {
    // v1.0 → v1.1: 무기 숙련. 숙련·스킬 줄·둘째 무기 자리·스킬 대기·몸 기운
    from: 16,
    to: 17,
    run(st) {
      st.meta.engine = '1.1.0';
      for (const a of Object.values(st.actors)) {
        a.mastery ??= {};
        a.loadout ??= {};
        if (a.equip) a.equip.weapon2 ??= null;
        if (a.cb) Object.assign(a.cb, { cds: a.cb.cds || {}, aura: a.cb.aura || [], lunge: null, counterUntil: a.cb.counterUntil || 0 });
      }
    },
  },
  {
    // v1.1 → v1.2: 활·지팡이. 마나, 날아가는 화살·마력탄, 땅을 겨눈 범위
    from: 17,
    to: 18,
    run(st, data) {
      st.meta.engine = '1.2.0';
      st.arrows ??= [];
      st.zones ??= [];
      const mana = data.config.combat.mana ?? 100;
      for (const a of Object.values(st.actors)) if (a.cb) Object.assign(a.cb, { mp: a.cb.mp ?? mana, maxMp: a.cb.maxMp ?? mana });
    },
  },
  {
    // v1.2 → v1.3: 안개의 심장(6장). 새 지역의 야영지·산지·짐승·자리 무리를 만든다
    from: 18,
    to: 19,
    run(st, data) {
      st.meta.engine = '1.3.0';
      const ctx = migrationCtx(st, data, 0x1e3a7c55);
      const cfg = data.config;
      for (const region of data.lists.regions) {
        if (st.regions[region.id]) continue;
        const density = {};
        for (const fam of Object.keys(cfg.families)) density[fam] = 1;
        st.regions[region.id] = { id: region.id, density };
        for (const sdef of region.settlements) if (!st.settlements[sdef.id]) st.settlements[sdef.id] = newSettlement(region, sdef, cfg);
        for (const vc of region.veins) {
          if (vc.common) openVein(ctx, region, vc, { common: true });
          for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
        }
      }
      initMobs(ctx);
    },
  },
  {
    // v1.3 → v1.4: 사람들의 섬. 있던 지역에 새로 생긴 마을(갈매기 포구·버들 여울·숯가마 마을)을 세운다
    from: 19,
    to: 20,
    run(st, data) {
      st.meta.engine = '1.4.0';
      for (const region of data.lists.regions) {
        if (!st.regions[region.id]) continue;
        for (const sdef of region.settlements) if (!st.settlements[sdef.id]) st.settlements[sdef.id] = newSettlement(region, sdef, data.config);
      }
    },
  },
  {
    // v1.4 → v1.5: 하루를 사는 사람들. 저장 모양은 그대로(동선·연작·세력 의뢰는 데이터에서 온다)
    from: 20,
    to: 21,
    run(st) {
      st.meta.engine = '1.5.0';
    },
  },
  {
    // v1.5 → v1.6: 호감도. 개척자마다 bonds를 붙인다(정은 0부터)
    from: 21,
    to: 22,
    run(st) {
      for (const a of Object.values(st.actors)) a.bonds = a.bonds || {};
      st.meta.engine = '1.6.0';
    },
  },
  {
    // v1.6 → v1.7: 단짝과 생일. 저장 모양은 그대로(동행은 행위자로 들어온다)
    from: 22,
    to: 23,
    run(st) {
      st.meta.engine = '1.7.0';
    },
  },
  {
    // v1.7 → v1.8: 계절·장날·생일 잔치. 저장 모양은 그대로(달력은 시각에서 계산한다)
    from: 23,
    to: 24,
    run(st) {
      st.meta.engine = '1.8.0';
    },
  },
  {
    // v1.8 → v2.0: 화면 고급화. 저장 모양은 그대로
    from: 24,
    to: 25,
    run(st) {
      st.meta.engine = '2.0.0';
    },
  },
  {
    // v2.0 → v2.1: 아이콘·안개빛·가을빛 손질. 저장 모양은 그대로
    from: 25,
    to: 26,
    run(st) {
      st.meta.engine = '2.1.0';
    },
  },
  {
    // v2.1 → v2.2: 물건 아이콘 그림. 저장 모양은 그대로
    from: 26,
    to: 27,
    run(st) {
      st.meta.engine = '2.2.0';
    },
  },
  {
    // v2.2 → v2.3: 전투 레벨·원정·설계도. 개척자마다 레벨 1부터, 원정 기록·아는 설계도는 빈 채로
    from: 27,
    to: 28,
    run(st) {
      for (const a of Object.values(st.actors)) {
        a.clevel = a.clevel || { lvl: 1, xp: 0, attrs: { str: 0, dex: 0, int: 0, con: 0, foc: 0 } };
        a.exp = a.exp || { run: null, last: {} };
        a.known = a.known || {};
      }
      st.runs = st.runs || {};
      st.meta.engine = '2.3.0';
    },
  },
  {
    // v2.3 → v2.4: 생활 스킬 완성. 마을에 약제대·석공대·공예대를 놓고, 물고기 떼·달맞이풀 산지를 연다
    from: 28,
    to: 29,
    run(st, data) {
      const ctx = migrationCtx(st, data, 0x24f15a11);
      for (const region of data.lists.regions) {
        for (const sdef of region.settlements) {
          const s = st.settlements[sdef.id];
          if (!s) continue;
          for (const sd of sdef.stations) {
            if (sd.build || s.stations.some((x) => x.type === sd.type)) continue;
            s.stations.push(stationAt(sdef, sd));
          }
        }
        if (!st.regions[region.id]) continue;
        for (const vc of region.veins) {
          if (Object.values(st.veins).some((v) => v.node === vc.node && v.region === region.id)) continue;
          if (vc.common) openVein(ctx, region, vc, { common: true });
          for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
        }
      }
      for (const a of Object.values(st.actors)) {
        if (!a.equip) continue;
        if (!('ring' in a.equip)) a.equip.ring = null;
        if (!('neck' in a.equip)) a.equip.neck = null;
      }
      st.meta.engine = '2.4.0';
    },
  },
  {
    // v2.4 → v2.5: 소리. 저장 모양은 그대로(볼륨은 브라우저 localStorage에 따로)
    from: 29,
    to: 30,
    run(st) {
      st.meta.engine = '2.5.0';
    },
  },
  {
    // v2.5 → v2.6: 필드 PvP. 개척자마다 깃발(꺼짐), 분쟁 구역에 다른 세력 개척자 무리를 세운다
    from: 30,
    to: 31,
    run(st, data) {
      for (const a of Object.values(st.actors)) if (!a.pvp) a.pvp = emptyPvp();
      st.rivals = st.rivals || emptyRivals();
      initRivals(migrationCtx(st, data, 0x26a1f00d));
      st.meta.engine = '2.6.0';
    },
  },
  {
    // v2.6 → v2.7: 영지전. 본섬 마을 다섯을 AI 조합 셋이 나눠 쥔 채로 시작한다
    from: 31,
    to: 32,
    run(st, data) {
      st.territory = st.territory || emptyTerritory();
      initTerritory(migrationCtx(st, data, 0x27b0a5e1));
      st.meta.engine = '2.7.0';
    },
  },
  {
    // v2.7 → v3.0: 멀티 시험. 저장 모양은 그대로(나간 사람 표시 offline은 서버가 붙인다)
    from: 32,
    to: 33,
    run(st) {
      st.meta.engine = '3.0.0';
    },
  },
  {
    // v3.0 → v3.1: 서브퀘스트·레벨 난이도. 저장 모양은 그대로(퀘스트 권장 레벨은 데이터에)
    from: 33,
    to: 34,
    run(st) {
      st.meta.engine = '3.1.0';
    },
  },
  {
    // v3.1 → v3.2: 길잡이 돌·탈것. 지금 섬의 마을 돌은 이미 다녀 본 길로 친다
    from: 34,
    to: 35,
    run(st, data) {
      for (const a of Object.values(st.actors)) {
        a.mounts = a.mounts || { own: [], pick: null, gear: { saddle: null, shoes: null } };
        a.riding = null;
        a.ways = a.ways || {};
        if (a.kind !== 'player') continue;
        const here = data.lists.regions.find((r) => a.x >= r.bounds[0] && a.x <= r.bounds[2]);
        for (const w of data.lists.waystones || []) if (w.at && (w.at === a.home || w.region === here?.id)) a.ways[w.id] = 0;
      }
      st.meta.engine = '3.2.0';
    },
  },
  {
    // v3.2 → v3.3: 귀걸이 자리. 길잡이 돌 0초에 익힌 것도 익힌 것으로(v3.2 이주가 0을 넣었다)
    from: 35,
    to: 36,
    run(st) {
      for (const a of Object.values(st.actors)) {
        if (a.equip && !('ear' in a.equip)) a.equip.ear = null;
      }
      st.meta.engine = '3.3.0';
    },
  },
  {
    // v3.3.1 숙련 계수: 저장 모양은 그대로, 엔진 표시만
    from: 36,
    to: 37,
    run(st) {
      st.meta.engine = '3.3.1';
    },
  },
  {
    // v3.3.2 퀘스트·NPC 재점검: 이야기 중 멈춰 선 NPC(state.npcHold)는 없을 때 빈 것으로
    from: 37,
    to: 38,
    run(st) {
      st.npcHold ??= {};
      st.meta.engine = '3.3.2';
    },
  },
];

// v0.5.2: 1~2장 퀘스트에 생활 단계가 끼었다. 하던 단계 번호를 새 번호로(앞에 낀 단계는 건너뛴다)
const STEP_MAP_9 = { q1_ashore: [2], q3_lookout: [0, 3, 4, 5, 6], q4_forest: [3], q5_supplies: [0, 2, 3, 4], q7_raid: [0, 2, 3] };
const AFTER_FORGE = ['c2_ruins', 'c2_haetae', 'c2_rekindle', 'c2_anchor'];

// 자리(야영지·옛터·난파 자리)에 걸린 짐승 무리를 옆으로 옮긴다
function relocateGroups(st, data, ctx, region) {
  const taken = Object.values(st.mobGroups || {});
  const sites = (region.sites || []).filter((s) => s.members || s.structures?.length).map((s) => {
    const [x, z] = s.beach ? ctx.terrain.beachPoint(s.beach[0], s.beach[1]) : [s.x, s.z];
    return { x, z, r: s.r };
  });
  for (const g of taken) {
    if (g.site || g.temp) continue;
    const type = data.creatures[g.type];
    if (!sites.some((s) => Math.hypot(g.x - s.x, g.z - s.z) < s.r + 20 + type.radius)) continue;
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
      mob.mode = mob.mode === 'away' ? 'away' : 'idle';
      mob.target = null;
      mob.dest = null;
    }
  }
}

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
