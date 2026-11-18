// 새 월드 상태 만들기. 상태는 그대로 JSON이 되는 순수 데이터다.

import { seedState } from './rng.js';
import { openVein } from './systems/veins.js';

export const ENGINE_VERSION = '0.0.0';

export function newActor(data, spec, region) {
  const skills = {};
  for (const s of data.lists.skills) skills[s.id] = { xp: 0, level: 1 };
  const [x, z] = spec.at || region.spawn;
  return {
    id: spec.id,
    name: spec.name || spec.id,
    kind: spec.kind || 'player',
    x, z, dest: null, action: null,
    skills,
    focus: data.config.focus.max,
    buffs: [],
    bag: [], storage: [], queue: [],
    ai: spec.ai ? { on: true, profile: spec.ai, mem: {} } : null,
    stats: { gather: {}, craft: {}, eat: 0, focusUsed: 0, masterwork: 0 },
    milestones: {},
  };
}

// ctx: { data, cfg, rng, clock, newId, emit } — state는 여기서 만들어 붙인다.
export function createState(ctx, seed, actorSpecs) {
  const { data } = ctx;
  const cfg = data.config;
  const state = {
    meta: { engine: ENGINE_VERSION, dataVersion: cfg.dataVersion, seed },
    t: 0,
    clock: { hour: 0, day: 0 },
    rng: seedState(seed),
    nextId: 1,
    regions: {}, lots: {}, veins: {}, nodes: {}, settlements: {}, actors: {},
  };
  return state;
}

export function populate(ctx, actorSpecs) {
  const { state, data } = ctx;
  const cfg = data.config;
  for (const region of data.lists.regions) {
    const density = {};
    for (const fam of Object.keys(cfg.families)) density[fam] = 1;
    state.regions[region.id] = { id: region.id, density };
    const s = region.settlement;
    state.settlements[s.id] = {
      id: s.id, name: s.name, region: region.id, x: s.x, z: s.z, radius: s.radius,
      stations: s.stations.map((st) => ({ type: st.type, tier: st.tier ?? 1 })),
    };
    for (const vc of region.veins) {
      if (vc.common) openVein(ctx, region, vc, { common: true });
      for (let i = 0; i < (vc.rotating || 0); i++) openVein(ctx, region, vc, { initial: true });
    }
  }
  const home = data.lists.regions[0];
  for (const spec of actorSpecs) state.actors[spec.id] = newActor(data, spec, home);
}
