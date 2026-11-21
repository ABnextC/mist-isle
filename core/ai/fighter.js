// 봇의 싸움 요령(30Hz로 돈다): 사거리까지 다가가 때리고, 짐승의 준비 동작을 실력만큼 읽어 구르거나 막는다.
// 페르소나 봇과 헤드리스 결투(tools/combat.js)가 같은 코드를 쓴다. 명령은 모두 ctx.command로 낸다.

import { weaponOf, yawTo, isDown } from '../systems/combat.js';
import { isAlive } from '../systems/mobs.js';
import { keyOf } from '../inventory.js';

const DODGE_AT = 0.16; // 준비 동작이 이만큼 남았을 때 구른다
const BLOCK_AT = 0.32;

// opts: { read: 준비 동작을 읽을 확률, block: 구르기 대신 막기를 고를 확률, heal: 이 체력 비율 아래면 먹는다 }
export function startFight(a, mobId, opts = {}) {
  a.ai = a.ai || { on: true, profile: 'settler', mem: {} };
  a.ai.mem.fight = { target: mobId, read: opts.read ?? 0.45, block: opts.block ?? 0.3, heal: opts.heal ?? 0.4, seen: {}, plan: {}, moveAt: 0, since: null };
}

export const stopFight = (a) => {
  if (a.ai?.mem) a.ai.mem.fight = null;
};

function threats(ctx, a) {
  const out = [];
  for (const m of Object.values(ctx.state.mobs)) {
    if (!isAlive(m) || m.target !== a.id) continue;
    out.push(m);
  }
  return out;
}

function chooseTarget(ctx, a, f) {
  const cur = ctx.state.mobs[f.target];
  const skittish = cur && ctx.data.creatures[cur.type].temper === 'skittish';
  if (isAlive(cur) && (cur.mode !== 'return' || skittish)) return cur;
  // 덤비는 놈부터 정리한다
  let best = null;
  let bd = Infinity;
  for (const m of threats(ctx, a)) {
    const d = Math.hypot(m.x - a.x, m.z - a.z);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  if (best) f.target = best.id;
  return best;
}

export function fightTick(ctx, a) {
  const f = a.ai?.mem?.fight;
  if (!f || isDown(a)) return;
  const t = ctx.state.t;
  const cb = a.cb;
  // 비틀거리는 동안은 아무것도 못 한다(헛명령을 보내지 않는다, v0.4)
  if (cb.stunUntil > t) return;
  // 1) 준비 동작 읽기: 같은 준비 동작(until 값)마다 한 번 굴린다
  let blockWanted = false;
  for (const m of threats(ctx, a)) {
    if (m.mode !== 'windup') continue;
    if (f.seen[m.id] !== m.until) {
      f.seen[m.id] = m.until;
      f.plan[m.id] = ctx.rng.chance(f.read) ? (ctx.rng.chance(f.block) ? 'block' : 'dodge') : 'none';
    }
    const left = m.until - t;
    const plan = f.plan[m.id];
    const charge = !!ctx.data.creatures[m.type].attack?.charge;
    if (plan === 'dodge' && left <= (charge ? 0.05 : DODGE_AT) && !cb.dodge) {
      // 짐승을 등지고 옆으로 비켜 구른다
      const away = yawTo(m, a);
      const side = (m.id.length + Math.floor(t)) % 2 ? 1.2 : -1.2;
      const dodge = { type: 'DODGE', actor: a.id, yaw: away + side };
      if (ctx.check(dodge).ok && ctx.command(dodge).ok) continue;
      f.plan[m.id] = 'block';
    }
    if (f.plan[m.id] === 'block' && left <= BLOCK_AT && !charge) blockWanted = true;
  }
  if (blockWanted !== cb.block && !cb.dodge) {
    if (blockWanted) a.yaw = Math.round(yawTo(a, threats(ctx, a).find((m) => m.mode === 'windup') || a) * 1000) / 1000;
    ctx.command({ type: 'BLOCK', actor: a.id, on: blockWanted });
  }
  if (blockWanted || cb.dodge) return;
  // 2) 체력이 낮으면 먹는다
  if (cb.hp < cb.maxHp * f.heal) {
    const food = a.bag.find((e) => ctx.data.items[e.item].effect === 'heal');
    if (food && ctx.command({ type: 'EAT', actor: a.id, key: keyOf(food) }).ok) return;
  }
  // 3) 다가가서 때린다
  const m = chooseTarget(ctx, a, f);
  if (!m) {
    // 싸울 상대가 없으면 싸움을 끝낸다(다시 하던 일로)
    if (cb.block) ctx.command({ type: 'BLOCK', actor: a.id, on: false });
    stopFight(a);
    return;
  }
  if (f.since == null) f.since = t;
  const w = weaponOf(ctx, a);
  const type = ctx.data.creatures[m.type];
  const d = Math.hypot(m.x - a.x, m.z - a.z);
  const reach = w.spec.range + type.r - 0.35;
  if (d > reach) {
    if (t >= f.moveAt) {
      f.moveAt = t + 0.25;
      const k = (d - reach + 0.2) / d;
      ctx.command({ type: 'MOVE', actor: a.id, x: a.x + (m.x - a.x) * k, z: a.z + (m.z - a.z) * k });
    }
    return;
  }
  if (a.dest) a.dest = null;
  if (cb.act && t < cb.act.endAt) return;
  const heavy = cb.st >= 70 && (m.mode === 'recover' || type.temper === 'skittish');
  ctx.command({ type: 'ATTACK', actor: a.id, kind: heavy ? 'heavy' : 'light', yaw: yawTo(a, m) });
}

// 게임 틱마다: 싸움 중인 봇만 돌린다
export function fightersTick(ctx) {
  for (const a of Object.values(ctx.state.actors)) if (a.ai?.on && a.ai.mem?.fight) fightTick(ctx, a);
}
