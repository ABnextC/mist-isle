// 엔진 진입점.
//   const game = createGame({ data, seed, actors })
//   game.dispatch({ type: 'GATHER', actor: 'p1', node: 'n_12' })
//   game.advance(초)  — 30Hz 빠른 틱(이동·행동)과 1초 월드 틱을 돌린다
//   game.save() / loadGame({ data, save })

import { guildsHourly } from './systems/guilds.js';
import { homeStatics } from './systems/housing.js';
import { factionOnEvent } from './systems/factions.js';
import { makeRng } from './rng.js';
import { makeClock } from './clock.js';
import { makeBus } from './events.js';
import { makeWorld } from './terrain.js';
import { createState, populate } from './state.js';
import { makeCommands } from './commands.js';
import { serialize, deserialize, hashState } from './save.js';
import { layoutStatics, buildObstacles, builtSet } from './world.js';
import { movementTick, actionsTick } from './systems/actions.js';
import { craftingTick } from './systems/crafting.js';
import { nodesTick, densityHourly } from './systems/nodes.js';
import { focusTick } from './systems/focus.js';
import { dailyVeins } from './systems/veins.js';
import { econHourly, econDaily } from './systems/economy.js';
import { expireOrders } from './market.js';
import { settlementsDaily } from './settlements.js';
import { dailyOrders } from './orders.js';
import { mobsTick } from './systems/mobs.js';
import { combatTick, arrowsTick } from './systems/combat.js';
import { fightersTick } from './ai/fighter.js';
import { alliesTick } from './systems/allies.js';
import { expeditionsTick } from './systems/expeditions.js';
import { dayOfMonth, seasonOf, isMarketDay } from './systems/calendar.js';
import { agentsTick } from './systems/agents.js';
import { questsTick } from './systems/quests.js';

const DEFAULT_ACTORS = [{ id: 'p1', name: '개척자', kind: 'player' }];

// 지역마다 놓은 것을 이어 붙인다(v0.6). NPC는 그 지역 마을·자리에 있는 것만 놓인다
const allStatics = (data, world, built) => data.lists.regions.flatMap((r) => layoutStatics(r, world.of(r.id), built, data.lists.npcs));

function makeCtx(state, data, bus) {
  const terrain = makeWorld(data.lists.regions, state.meta.worldSeed);
  const ctx = {
    state,
    data,
    cfg: data.config,
    clock: makeClock(data.config),
    rng: makeRng(state.rng),
    terrain,
    statics: allStatics(data, terrain, builtSet(state)).concat(homeStatics({ state, data })),
    obstacles: null,
    obstaclesDirty: true,
    newId: (p) => `${p}_${state.nextId++}`,
    emit: (type, payload) => {
      const ev = { type, t: state.t, ...payload };
      bus.emit(ev);
      factionOnEvent(ctx, ev); // 세력 활동 영향력(v0.7)
    },
  };
  // 마을 사업으로 건물이 서면 정적 배치를 다시 잰다(충돌·화면이 같이 쓴다)
  ctx.refreshStatics = () => {
    ctx.statics = allStatics(data, terrain, builtSet(state)).concat(homeStatics(ctx));
    ctx.obstaclesDirty = true;
  };
  const cmds = makeCommands(ctx);
  ctx.command = cmds.dispatch;
  ctx.check = cmds.check;
  ctx.preview = cmds.preview;
  return ctx;
}

function refreshObstacles(ctx) {
  if (ctx.obstaclesDirty) {
    ctx.obstacles = buildObstacles(ctx);
    ctx.obstaclesDirty = false;
  }
}

function wrap(ctx, bus) {
  const { state, data } = ctx;
  const HZ = data.config.time.hz;
  const thinkEvery = data.config.ai.thinkTicks;
  let acc = 0;
  refreshObstacles(ctx);

  function fastTick() {
    state.tick += 1;
    state.t = state.tick / HZ;
    refreshObstacles(ctx);
    movementTick(ctx, 1 / HZ);
    mobsTick(ctx, 1 / HZ);
    combatTick(ctx, 1 / HZ);
    arrowsTick(ctx, 1 / HZ);
    alliesTick(ctx);
    fightersTick(ctx);
    actionsTick(ctx);
    craftingTick(ctx);
    if (state.tick % HZ === 0) {
      nodesTick(ctx);
      focusTick(ctx);
      questsTick(ctx);
      expeditionsTick(ctx);
      const h = ctx.clock.hour(state.t);
      if (h !== state.clock.hour) {
        state.clock.hour = h;
        densityHourly(ctx);
        econHourly(ctx);
        guildsHourly(ctx); // 조합 일감·AI 조합원(v0.8.1)
      }
      const d = ctx.clock.day(state.t);
      if (d !== state.clock.day) {
        state.clock.day = d;
        dailyVeins(ctx);
        expireOrders(ctx);
        settlementsDaily(ctx);
        dailyOrders(ctx);
        econDaily(ctx);
        ctx.emit('day.start', { day: d + 1 });
        // 계절·장날(v1.8)
        if (dayOfMonth(ctx) === 1) ctx.emit('season.start', { season: seasonOf(ctx).id });
        if (isMarketDay(ctx)) ctx.emit('market.day', { day: d + 1 });
      }
    }
    if (state.tick % thinkEvery === 0) agentsTick(ctx);
  }

  return {
    state,
    data,
    _ctx: ctx, // 시험·도구용(화면은 쓰지 않는다)
    clock: ctx.clock,
    terrain: ctx.terrain,
    get statics() { return ctx.statics; },
    tele: bus.tele,
    on: bus.on,
    dispatch: ctx.command,
    check: ctx.check,
    preview: ctx.preview,
    advance(seconds) {
      acc += seconds * HZ;
      while (acc >= 1) {
        acc -= 1;
        fastTick();
      }
    },
    save: () => serialize(state),
    hash: () => hashState(state),
    // 다음 틱까지 쌓인 몫(0~1). 화면이 틱 사이를 보간할 때 쓴다(상태에는 안 들어간다)
    get alpha() {
      return acc;
    },
  };
}

export function createGame({ data, seed = 1, actors = DEFAULT_ACTORS }) {
  const bus = makeBus();
  const state = createState(data, seed);
  const ctx = makeCtx(state, data, bus);
  populate(ctx, actors);
  ctx.obstaclesDirty = true;
  return wrap(ctx, bus);
}

export function loadGame({ data, save }) {
  const bus = makeBus();
  const state = deserialize(save, data);
  return wrap(makeCtx(state, data, bus), bus);
}
