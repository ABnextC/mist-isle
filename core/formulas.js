// 산출·스탯 공식 모음. 숫자는 data/config.json에서 온다.
// 설계 문서 6.2(채집), 7.2(제작) 공식을 그대로 옮겼다.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round1 = (v) => Math.round(v * 10) / 10;
export const round2 = (v) => Math.round(v * 100) / 100;
export const round3 = (v) => Math.round(v * 1000) / 1000;
export const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// ── 성장 ─────────────────────────────────────────────
// 다음 레벨까지 필요한 경험치 = a + b × 레벨^exp
export function xpToNext(level, curve) {
  return Math.round(curve.a + curve.b * Math.pow(level, curve.exp));
}

export function levelFromXp(xp, curve, cap) {
  let level = 1;
  let rem = xp;
  while (level < cap) {
    const need = xpToNext(level, curve);
    if (rem < need) break;
    rem -= need;
    level++;
  }
  return level;
}

// 현재 레벨 안에서 쌓인 경험치와 필요치 (화면 표시용)
export function xpProgress(xp, curve, cap) {
  let level = 1;
  let rem = xp;
  while (level < cap) {
    const need = xpToNext(level, curve);
    if (rem < need) return { level, into: rem, need };
    rem -= need;
    level++;
  }
  return { level, into: 0, need: 0 };
}

// ── 채집 ─────────────────────────────────────────────
// 도구 속도 배율. 0이면 캘 수 없다(맨손으로 티어 1 이상).
export function toolSpeed(nodeType, tool, cfg) {
  if (!tool) return nodeType.tier === 0 ? cfg.gather.handSpeed : 0;
  const gap = Math.max(0, nodeType.tier - tool.tier);
  return tool.stats.gatherSpeed * Math.pow(cfg.gather.tierPenalty, gap);
}

export const gatherSeconds = (nodeType, speed) => nodeType.seconds / speed;

export function skillYieldBonus(level, nodeLevel, cfg) {
  return Math.min(Math.max(0, level - nodeLevel) * cfg.gather.skillBonusPerLevel, cfg.gather.skillBonusMax);
}

// 1.3 → 1개 + 30% 확률로 1개 더
export function rollQty(x, rng) {
  const f = Math.floor(x);
  return f + (rng.next() < x - f ? 1 : 0);
}

// ── 산지 속성 ─────────────────────────────────────────
export function rollProps(propNames, dist, rng) {
  const out = {};
  for (const p of propNames) out[p] = clamp(Math.round(dist.mean + dist.sd * rng.bell()), 1, 99);
  if (propNames.length && rng.chance(dist.luckyChance)) {
    const p = rng.pick(propNames);
    out[p] = clamp(out[p] + rng.int(dist.luckyBonus[0], dist.luckyBonus[1]), 1, 99);
  }
  return out;
}

// ── 정제·제작 ─────────────────────────────────────────
// parts: [{ props, qty }] → 수량 가중 평균
export function weightedProps(parts) {
  let total = 0;
  const sum = {};
  for (const part of parts) {
    total += part.qty;
    for (const [k, v] of Object.entries(part.props)) sum[k] = (sum[k] || 0) + v * part.qty;
  }
  const out = {};
  for (const k of Object.keys(sum)) out[k] = round1(sum[k] / total);
  return out;
}

// 정제 단계: 숙련과 촉매로 +5 / +10 / +15
export function refineStep(level, hasCatalyst, cfg) {
  let s = 0;
  for (const st of cfg.refine.steps) if (level >= st.skill) s += st.add;
  if (hasCatalyst) s += cfg.refine.catalystAdd;
  return Math.min(s, cfg.refine.maxStep);
}

// 결과 점수 = Σ(슬롯 속성 × 가중치) + 숙련 보정 + 작업대 보정 (+ 조율, + 걸작)
// 숙련 계수(v3.3.1): 장비는 레시피를 막 배웠을 때 재료 몫을 덜 살린다.
// 레시피 레벨 그대로면 start배, 한 레벨마다 perLevel씩, max에서 멈춘다.
export function proficiency(diff, cfg) {
  const k = cfg.craft.proficiency;
  if (!k) return 1;
  return Math.min(k.max, k.start + Math.max(0, diff) * k.perLevel);
}

export function craftScores(recipe, slotProps, opt, cfg) {
  const diff = Math.max(0, opt.skillLevel - recipe.level);
  const skillAdd = Math.min(diff * cfg.craft.skillBonusPerLevel, cfg.craft.skillBonusMax);
  const stationAdd = Math.max(0, (opt.stationTier || 1) - 1) * cfg.craft.stationTierBonus;
  const prof = opt.equip ? proficiency(opt.skillLevel - recipe.level, cfg) : 1;
  const scores = {};
  for (const [stat, weights] of Object.entries(recipe.stats)) {
    let s = 0;
    for (const [ref, w] of Object.entries(weights)) {
      const [slot, prop] = ref.split('.');
      s += (slotProps[slot]?.[prop] ?? 0) * w;
    }
    s = s * prof + skillAdd + stationAdd;
    if (opt.tuneStat === stat) s += opt.tuneValue || 0;
    if (opt.masterwork) s += cfg.craft.masterwork.statBonus;
    scores[stat] = round1(clamp(s, 0, 110));
  }
  return scores;
}

// 점수 → 실제 수치. convert: { stat: { base, per, round, max } }
export function convertStats(convert, scores) {
  const out = {};
  for (const [stat, c] of Object.entries(convert)) {
    let v = c.base + c.per * (scores[stat] ?? 0);
    if (c.max != null) v = Math.min(v, c.max);
    const m = Math.pow(10, c.round ?? 0);
    out[stat] = Math.round(v * m) / m;
  }
  return out;
}

// 별 등급: 기준 [30, 50, 70, 85] → ★1~★5
export function starOf(score, thresholds) {
  let s = 1;
  for (const th of thresholds) if (score >= th) s++;
  return s;
}

export function masterworkChance(diff, tuned, cfg) {
  const m = cfg.craft.masterwork;
  return m.base + Math.min(diff * m.perLevel, m.maxFromLevel) + (tuned ? m.tuneBonus : 0);
}
