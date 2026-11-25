// 동행(v1.7): 단짝이 된 사냥꾼·싸움꾼은 하루 한 번 같이 나선다.
// 동행은 행위자(kind 'ally')로 세계에 서고, 봇의 싸움 요령(ai/fighter.js)으로 싸운다. 명령도 플레이어와 같은 것만 쓴다.
// 주인을 노리는 짐승과 싸우고, 아니면 주인 곁을 따른다. 시간이 다 되거나, 쓰러지거나, 주인이 멀리(배·다른 섬) 가면 마을로 돌아간다.
// 동행이 잡은 짐승은 주인 몫이다(퀘스트·전리품). 멀티플레이에서도 주인마다 하나씩이다.

import { newActor } from '../state.js';
import { convertStats, starOf } from '../formulas.js';
import { isDown } from './combat.js';
import { isAlive } from './mobs.js';
import { startFight, stopFight } from '../ai/fighter.js';
import { B, markInvite } from './bonds.js';

const FOLLOW_M = 3.2;
const LEASH_M = 18; // 주인에게서 이만큼 먼 짐승은 쫓지 않는다
const WARP_M = 45;
const LOST_M = 300; // 다른 섬으로 건너갔다

export const allyOf = (ctx, a) => (a?.ally ? ctx.state.actors[a.ally.id] || null : null);
export const accompanying = (state, npc) => Object.values(state.actors).some((x) => x.ally?.npc === npc);
// 잡은 몫은 주인에게
export const creditOf = (ctx, a) => (a?.kind === 'ally' ? ctx.state.actors[a.ally.owner] || a : a);

export function spawnAlly(ctx, a, npc) {
  const n = ctx.data.npcs[npc];
  const t = ctx.state.t;
  const id = `ally_${a.id}`;
  const al = newActor(ctx.data, { id, name: n.name, kind: 'ally', at: [Math.round((a.x + 1.4) * 1000) / 1000, Math.round((a.z - 1.2) * 1000) / 1000] });
  al.look = n.look;
  al.home = a.home;
  al.ally = { owner: a.id, npc, until: Math.round((t + B(ctx).companionSec) * 100) / 100, moveAt: 0 };
  al.ai = { on: true, profile: 'ally', manual: true, mem: {} };
  const def = ctx.data.items[n.perk.weapon];
  const scores = Object.fromEntries(Object.keys(def.statConvert).map((k) => [k, 65]));
  const stats = convertStats(def.statConvert, scores);
  const w = { uid: ctx.newId('it'), item: def.id, stats, scores, star: starOf(65, ctx.cfg.stars), masterwork: false, crafter: n.name, dur: stats.durability ?? null, maxDur: stats.durability ?? null, broken: false };
  al.bag.push(w);
  al.equip.weapon = w.uid;
  ctx.state.actors[id] = al;
  a.ally = { id, npc, until: al.ally.until };
  markInvite(ctx, a, npc);
  ctx.emit('ally.join', { actor: a.id, npc, ally: id, until: al.ally.until });
  return al;
}

export function dismissAlly(ctx, al, reason) {
  const o = ctx.state.actors[al.ally.owner];
  delete ctx.state.actors[al.id];
  if (o?.ally?.id === al.id) o.ally = null;
  ctx.emit('ally.leave', { actor: al.ally.owner, npc: al.ally.npc, ally: al.id, reason });
}

function threat(ctx, o, al) {
  let best = null;
  let bd = LEASH_M;
  for (const m of Object.values(ctx.state.mobs)) {
    if (!isAlive(m) || (m.target !== o.id && m.target !== al.id)) continue;
    const d = Math.hypot(m.x - o.x, m.z - o.z);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

// 0.2초마다
export function alliesTick(ctx) {
  if (ctx.state.tick % 6 !== 0) return;
  const t = ctx.state.t;
  for (const al of Object.values(ctx.state.actors)) {
    if (al.kind !== 'ally') continue;
    const o = ctx.state.actors[al.ally.owner];
    const d = o ? Math.hypot(o.x - al.x, o.z - al.z) : Infinity;
    if (!o || d > LOST_M) dismissAlly(ctx, al, 'far');
    else if (isDown(al)) dismissAlly(ctx, al, 'down');
    else if (t >= al.ally.until) dismissAlly(ctx, al, 'time');
    if (!ctx.state.actors[al.id]) continue;
    if (d > WARP_M) {
      stopFight(al);
      al.x = Math.round((o.x + 1.4) * 1000) / 1000;
      al.z = Math.round((o.z - 1.2) * 1000) / 1000;
      al.move = al.dest = al.nav = null;
      continue;
    }
    const f = al.ai.mem.fight;
    if (f) {
      const m = ctx.state.mobs[f.target];
      if (isAlive(m) && Math.hypot(m.x - o.x, m.z - o.z) <= LEASH_M + 4) continue;
      stopFight(al);
    }
    const m = threat(ctx, o, al);
    if (m) {
      startFight(al, m.id, { read: 0.55, block: 0.25, heal: 0 });
      continue;
    }
    if (d > FOLLOW_M && t >= al.ally.moveAt) {
      al.ally.moveAt = Math.round((t + 0.6) * 100) / 100;
      const k = (d - FOLLOW_M * 0.6) / d;
      ctx.command({ type: 'MOVE', actor: al.id, x: Math.round((al.x + (o.x - al.x) * k) * 1000) / 1000, z: Math.round((al.z + (o.z - al.z) * k) * 1000) / 1000 });
    }
  }
}
