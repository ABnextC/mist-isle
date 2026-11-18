// 엔진 진입점.
//   const game = createGame({ data, seed, actors })
//   game.dispatch({ type: 'GATHER', actor: 'p1', node: 'n_12' })
//   game.advance(초)  — 1초 단위 월드 틱을 돌린다
//   game.save() / loadGame({ data, save })

import { makeRng } from './rng.js';
import { makeClock } from './clock.js';
import { makeBus } from './events.js';
import { createState, populate } from './state.js';
import { makeCommands } from './commands.js';
import { serialize, deserialize, hashState } from './save.js';
import { movementTick, actionsTick } from './systems/actions.js';
import { craftingTick } from './systems/crafting.js';
import { nodesTick, densityHourly } from './systems/nodes.js';
import { focusTick } from './systems/focus.js';
import { dailyVeins } from './systems/veins.js';
import { agentsTick } from './systems/agents.js';

const DEFAULT_ACTORS = [{ id: 'p1', name: '개척자', kind: 'player' }];

function makeCtx(state, data, bus) {
  const ctx = {
    state,
    data,
    cfg: data.config,
    clock: makeClock(data.config),
    rng: makeRng(state.rng),
    newId: (p) => `${p}_${state.nextId++}`,
    emit: (type, payload) => bus.emit({ type, t: state.t, ...payload }),
  };
  const cmds = makeCommands(ctx);
  ctx.command = cmds.dispatch;
  ctx.check = cmds.check;
  return ctx;
}

function wrap(state, data, bus) {
  const ctx = makeCtx(state, data, bus);
  let acc = 0;

  function tick() {
    state.t += 1;
    movementTick(ctx);
    actionsTick(ctx);
    craftingTick(ctx);
    nodesTick(ctx);
    focusTick(ctx);
    const h = ctx.clock.hour(state.t);
    if (h !== state.clock.hour) {
      state.clock.hour = h;
      densityHourly(ctx);
    }
    const d = ctx.clock.day(state.t);
    if (d !== state.clock.day) {
      state.clock.day = d;
      dailyVeins(ctx);
      ctx.emit('day.start', { day: d + 1 });
    }
    agentsTick(ctx);
  }

  return {
    state,
    data,
    clock: ctx.clock,
    tele: bus.tele,
    on: bus.on,
    dispatch: ctx.command,
    check: ctx.check,
    advance(seconds) {
      acc += seconds;
      while (acc >= 1) {
        acc -= 1;
        tick();
      }
    },
    save: () => serialize(state),
    hash: () => hashState(state),
  };
}

export function createGame({ data, seed = 1, actors = DEFAULT_ACTORS }) {
  const bus = makeBus();
  const state = createState({ data }, seed, actors);
  const ctx = makeCtx(state, data, bus);
  populate(ctx, actors);
  return wrap(state, data, bus);
}

export function loadGame({ data, save }) {
  const bus = makeBus();
  return wrap(deserialize(save, data), data, bus);
}
