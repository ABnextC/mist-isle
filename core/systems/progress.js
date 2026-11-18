// 경험치·레벨·이정표.

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
  s.xp += amount;
  const level = levelFromXp(s.xp, ctx.data.curve, ctx.cfg.skillCap);
  while (s.level < level) {
    s.level++;
    ctx.emit('skill.up', { actor: actor.id, skill: skillId, level: s.level });
    if (MARK_LEVELS.includes(s.level)) mark(ctx, actor, `${skillId}_${s.level}`);
  }
}
