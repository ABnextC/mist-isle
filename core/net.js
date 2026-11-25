// 멀티(v3.0): 같은 코어를 서버와 손님이 나란히 돌린다(결정적 록스텝).
// 서버가 틱마다 받은 것을 순서대로 묶어(ops) 보내면, 모두가 같은 틱 경계에서 같은 순서로 적용한 뒤 한 틱 나아간다.
// 코어는 씨앗 난수만 쓰고 시간도 틱에서 나오므로 같은 ops면 같은 상태가 된다. 가끔 해시를 맞대 보고 다르면 통째로 다시 받는다.
//
// op 종류
//   { op: 'join', id, name }   사람 개척자가 들어온다(처음이면 새로 세우고 1장 첫 퀘스트를 준다)
//   { op: 'leave', id }        나간다(개척자는 그 자리에 남고 멈춘다)
//   { op: 'cmd', cmd }         명령(cmd.actor는 서버가 보낸 사람으로 박아 둔다)

import { newActor, spawnPoint } from './state.js';
import { startQuest, firstQuest } from './systems/quests.js';

export const NET_VERSION = 1;
export const MAX_PLAYERS = 8;
export const HASH_EVERY = 150; // 5초마다 해시를 맞대 본다

export function joinActor(game, { id, name }) {
  const ctx = game._ctx;
  const { state, data } = ctx;
  let a = state.actors[id];
  if (!a) {
    const home = data.lists.regions[0];
    const [x, z] = spawnPoint(home, ctx.terrain);
    // 같은 자리에 겹쳐 서지 않게 조금씩 비킨다
    const k = Object.values(state.actors).filter((o) => o.kind === 'player').length;
    a = newActor(data, { id, name: String(name || id).slice(0, 12), kind: 'player' }, [Math.round((x + (k % 4) * 1.2) * 1000) / 1000, Math.round((z + Math.floor(k / 4) * 1.2) * 1000) / 1000]);
    state.actors[id] = a;
    const q0 = firstQuest(data);
    if (q0) startQuest(ctx, a, q0);
    ctx.obstaclesDirty = true;
  } else if (name) a.name = String(name).slice(0, 12);
  a.offline = false;
  ctx.emit('net.join', { actor: id, name: a.name });
  return a;
}

export function leaveActor(game, { id }) {
  const a = game.state.actors[id];
  if (!a) return;
  a.offline = true;
  a.move = null;
  a.dest = null;
  a.nav = null;
  if (a.cb) a.cb.block = false;
  game._ctx.emit('net.leave', { actor: id, name: a.name });
}

export function applyOp(game, op) {
  if (op.op === 'join') return joinActor(game, op);
  if (op.op === 'leave') return leaveActor(game, op);
  // 코어의 명령 실행기를 바로 쓴다(손님 화면은 game.dispatch를 서버로 보내는 것으로 감싸 둔다)
  if (op.op === 'cmd' && op.cmd && typeof op.cmd === 'object') return game._ctx.command(op.cmd);
  return null;
}

// 틱 하나: ops를 적용하고 한 틱 나아간다(서버·손님 모두 이것만 쓴다)
export function stepWith(game, ops) {
  for (const op of ops) applyOp(game, op);
  game.step(1);
}

// 손님이 보낸 명령을 서버가 받아들일 꼴로 다듬는다. 다른 사람 명령인 척은 막는다
const ALLOWED = /^[A-Z_]{2,32}$/;
export function sanitizeCmd(cmd, pid) {
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  if (!ALLOWED.test(String(cmd.type || ''))) return null;
  const s = JSON.stringify(cmd);
  if (s.length > 2000) return null;
  const out = JSON.parse(s);
  out.actor = pid;
  return out;
}
