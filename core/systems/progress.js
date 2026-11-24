// 경험치·레벨·이정표.

import { xpMult } from './factions.js';
import { levelFromXp } from '../formulas.js';

const MARK_LEVELS = [5, 10, 20, 30];

export function mark(ctx, actor, key) {
  if (actor.milestones[key] == null) {
    actor.milestones[key] = ctx.state.t;
    ctx.emit('milestone', { actor: actor.id, key });
  }
}

export function addXp(ctx, actor, skillId, amount) {
  const s = actor.skills[skillId];
  // 세력 혜택·보존식 버프(v0.7)
  s.xp += Math.round(amount * xpMult(ctx, actor, skillId) * 100) / 100;
  const level = levelFromXp(s.xp, ctx.data.curve, ctx.cfg.skillCap);
  while (s.level < level) {
    s.level++;
    ctx.emit('skill.up', { actor: actor.id, skill: skillId, level: s.level });
    if (MARK_LEVELS.includes(s.level)) mark(ctx, actor, `${skillId}_${s.level}`);
  }
}
