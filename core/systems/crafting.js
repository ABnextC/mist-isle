// 제작 대기열. 재료는 대기열에 넣을 때 이미 빠졌다(원자적 처리).
// 결과와 걸작 여부는 끝나는 순간에 정한다.

import { extraChance } from './factions.js';
import { addEntry, slotsNeeded } from '../inventory.js';
import { craftScores, convertStats, starOf, masterworkChance, rollQty, avg } from '../formulas.js';
import { settlementAt, storeOf } from '../world.js';
import { addXp, mark } from './progress.js';

export function craftingTick(ctx) {
  for (const a of Object.values(ctx.state.actors)) {
    while (a.queue.length && a.queue[0].endsAt <= ctx.state.t) completeJob(ctx, a, a.queue.shift());
  }
}

// 정착지 안에서 나온 재료는 그 마을 창고로, 나머지는 가방(가득하면 만든 마을 창고)으로
function deliver(ctx, actor, entry, isMaterial, job) {
  const here = settlementAt(ctx, actor);
  if (isMaterial && here) {
    addEntry(storeOf(actor, here.id), entry);
    return 'storage';
  }
  if (actor.bag.length + slotsNeeded(actor.bag, [entry]) <= ctx.cfg.bag.slots) {
    addEntry(actor.bag, entry);
    return 'bag';
  }
  addEntry(storeOf(actor, job.at || here?.id || actor.home), entry);
  return 'storage';
}

function completeJob(ctx, actor, job) {
  const { data, cfg, rng } = ctx;
  const r = data.recipes[job.recipe];
  const outDef = data.items[r.output.item];
  const ev = { actor: actor.id, recipe: r.id, item: outDef.id, qty: r.output.qty };

  if (r.type === 'refine') {
    // 세력 혜택·영맥 차(v0.7): 확률로 하나 더
    const fx = extraChance(ctx, actor, 'refine', r.skill);
    if (fx > 0 && rng.next() < fx) ev.qty += 1;
    const entry = { item: outDef.id, lot: job.out.lot, bonus: job.out.bonus, qty: ev.qty };
    ev.to = deliver(ctx, actor, entry, true, job);
    ev.lot = job.out.lot;
    ev.bonus = job.out.bonus;
    if (job.focusReturn) {
      const back = rollQty(job.mainQty * cfg.craft.refineReturn, rng);
      if (back > 0) {
        deliver(ctx, actor, { ...job.returnTo, qty: back }, true, job);
        ev.returned = back;
      }
    }
  } else {
    const diff = Math.max(0, job.level - r.level);
    const mw = rng.chance(masterworkChance(diff, !!job.tune, cfg));
    const tuneValue = job.tune ? rng.int(cfg.craft.tune.min, cfg.craft.tune.max) : 0;
    const scores = craftScores(r, job.slotProps, {
      skillLevel: job.level, stationTier: job.stationTier,
      tuneStat: job.tune, tuneValue, masterwork: mw,
    }, cfg);
    const stats = convertStats(outDef.statConvert, scores);
    const star = starOf(avg(Object.values(scores)), cfg.stars);
    Object.assign(ev, { star, masterwork: mw, stats, tuned: job.tune ? { stat: job.tune, value: tuneValue } : null });

    if (outDef.kind === 'equipment') {
      for (let i = 0; i < r.output.qty; i++) {
        const entry = {
          uid: ctx.newId('it'), item: outDef.id, stats, scores, star, masterwork: mw,
          crafter: actor.name, dur: stats.durability ?? null, maxDur: stats.durability ?? null, broken: false,
        };
        ev.to = deliver(ctx, actor, entry, false, job);
        ev.uid = entry.uid;
      }
      if (outDef.tool) mark(ctx, actor, `tool_t${outDef.tool.tier}`);
    } else {
      const entry = { item: outDef.id, lot: null, bonus: null, stats, star, qty: r.output.qty };
      ev.to = deliver(ctx, actor, entry, false, job);
      if (outDef.kind === 'consumable') mark(ctx, actor, 'first_food');
    }
    if (mw) {
      actor.stats.masterwork++;
      mark(ctx, actor, 'first_masterwork');
    }
  }

  actor.stats.craft[r.id] = (actor.stats.craft[r.id] || 0) + 1;
  addXp(ctx, actor, r.skill, r.xp);
  ctx.emit('craft.done', ev);
}
