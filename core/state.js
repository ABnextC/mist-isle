// 새 월드 상태 만들기. 상태는 그대로 JSON이 되는 순수 데이터다.

import { seedState } from './rng.js';
import { openVein } from './systems/veins.js';
import { emptyMarket } from './market.js';
import { initEcon } from './systems/economy.js';
import { dailyOrders } from './orders.js';
import { initCombat, emptyEquip } from './systems/combat.js';
import { initMobs } from './systems/mobs.js';
import { newSettlement, initProjects, settlementsDaily } from './settlements.js';

export const ENGINE_VERSION = '0.4.2';

export function spawnPoint(region, terrain) {
  const [x, inland] = region.spawn;
  return terrain.beachPoint(x, inland);
}

export function newActor(data, spec, at) {
  const skills = {};
  for (const s of data.lists.skills) skills[s.id] = { xp: 0, level: 1 };
  const [x, z] = spec.at || at;
  const home = data.lists.regions[0].settlements[0].id;
  return {
    id: spec.id,
    name: spec.name || spec.id,
    kind: spec.kind || 'player',
    x, z, yaw: 0, move: null, dest: null, nav: null, stuck: 0, action: null, recallReadyAt: 0,
    skills,
    focus: data.config.focus.max,
    silver: data.config.market.startSilver,
    buffs: [],
    cb: initCombat(data.config), equip: emptyEquip(),
    bag: [], storages: {}, queue: [], home, standing: {},
    ai: spec.ai ? { on: true, profile: spec.ai, mem: {} } : null,
    stats: { gather: {}, craft: {}, eat: 0, focusUsed: 0, masterwork: 0, kills: {}, skin: {}, downs: 0, dmgDealt: 0, dmgTaken: 0 },
    milestones: {},
  };
}

export function createState(data, seed) {
  const cfg = data.config;
  return {
    meta: { engine: ENGINE_VERSION, dataVersion: cfg.dataVersion, seed, worldSeed: seed },
    tick: 0,
    t: 0,
    clock: { hour: 0, day: 0 },
    rng: seedState(seed),
    nextId: 1,
    regions: {}, lots: {}, veins: {}, nodes: {}, settlements: {}, projects: {}, actors: {}, mobs: {}, mobGroups: {},
    market: emptyMarket(), orders: [], econ: null,
  };
}

// ctx: makeCtx로 만든 실행 문맥(지형 포함)
export function populate(ctx, actorSpecs) {
  const { state, data } = ctx;
  const cfg = data.config;
  for (const region of data.lists.regions) {
    const density = {};
    for (const fam of Object.keys(cfg.families)) density[fam] = 1;
    state.regions[region.id] = { id: region.id, density };
    for (const sdef of region.settlements) state.settlements[sdef.id] = newSettlement(region, sdef, cfg);
    for (const vc of region.veins) {
      if (vc.common) openVein(ctx, region, vc, { common: true });
      for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
    }
  }
  const home = data.lists.regions[0];
  const at = spawnPoint(home, ctx.terrain);
  for (const spec of actorSpecs) state.actors[spec.id] = newActor(data, spec, at);
  state.projects = initProjects(data);
  initMobs(ctx);
  state.econ = initEcon(ctx);
  settlementsDaily(ctx);
  dailyOrders(ctx);
}
