// 내 집(v0.8): 본섬 마을 둘레 집터를 사서 오두막 → 집 → 큰 집으로 올린다.
// 가구를 놓으면 아늑함이 오르고, 집에서 쉬면 '푹 쉼'(숙련 경험 버프)을 받는다. 텃밭에서 씨앗을 기른다.
// 집터는 행위자 하나만 가질 수 있다(state.houses[터] = 집). 멀티플레이에서도 그대로 쓴다.

export const H = (ctx) => ctx.data.housing;
export const plotDef = (ctx, id) => H(ctx).plots.find((p) => p.id === id) || null;
export const tierDef = (ctx, id) => H(ctx).tiers.find((t) => t.id === id) || null;
export const nextTier = (ctx, id) => H(ctx).tiers[H(ctx).tiers.findIndex((t) => t.id === id) + 1] || null;

export function plotPos(ctx, p) {
  const s = ctx.data.settlements[p.at];
  return { x: s.x + p.dx, z: s.z + p.dz, rot: p.rot };
}

export const homeOf = (ctx, a) => (a?.house ? ctx.state.houses?.[a.house] || null : null);

export function comfortOf(h) {
  return (h?.furniture || []).reduce((n, e) => n + (e.stats?.comfort || 0), 0);
}

export function restValue(ctx, h) {
  const R = H(ctx).rest;
  return Math.min(R.cap, Math.round((R.base + comfortOf(h) * R.perComfort) * 1000) / 1000);
}

export function nearPlot(ctx, a, plotId) {
  const p = plotDef(ctx, plotId);
  if (!p) return false;
  const q = plotPos(ctx, p);
  return Math.hypot(a.x - q.x, a.z - q.z) <= H(ctx).range;
}

// 놓인 집을 장애물·그림 자리로 내놓는다(산 집은 집 모양, 빈 터는 팻말)
export function homeStatics(ctx) {
  const out = [];
  for (const p of H(ctx).plots) {
    const q = plotPos(ctx, p);
    const h = ctx.state.houses?.[p.id];
    if (h) out.push({ kind: `home_${h.tier}`, x: q.x, z: q.z, r: h.tier === 'manor' ? 3.6 : h.tier === 'house' ? 3 : 2.4, rot: q.rot, plot: p.id });
    else out.push({ kind: 'plot_sign', x: q.x, z: q.z, r: 0.3, rot: q.rot, plot: p.id });
  }
  return out;
}

// 집 안 작업대: 그 단계가 갖춘 작업대는 집 곁에서 쓴다
export function homeStation(ctx, a, type) {
  const h = homeOf(ctx, a);
  if (!h || !tierDef(ctx, h.tier)?.stations.includes(type) || !nearPlot(ctx, a, a.house)) return null;
  const q = plotPos(ctx, plotDef(ctx, a.house));
  return { type, tier: 1, x: q.x, z: q.z, home: true };
}

export const plantDef = (ctx, item) => H(ctx).plants.find((p) => p.item === item) || null;

// 트로피(v3.3): 집에 놓은 트로피가 그 갈래(짐승·사람·영 피해, 벌목·채광·채취·낚시 몫)를 올린다.
// 같은 갈래는 하나만 치고, 집 단계마다 앞에 놓은 것부터 trophies.max개까지만 듣는다.
export function trophiesOf(ctx, a) {
  const h = homeOf(ctx, a);
  if (!h) return [];
  const max = H(ctx).trophies?.max?.[h.tier] ?? 0;
  const out = [];
  for (const e of h.furniture) {
    const tr = ctx.data.items[e.item]?.trophy;
    if (!tr || out.some((x) => x.kind === tr.kind)) continue;
    if (out.length >= max) break;
    out.push({ kind: tr.kind, value: tr.value, item: e.item });
  }
  return out;
}
export function trophyBonus(ctx, a, kind) {
  if (!a?.house) return 0;
  return trophiesOf(ctx, a).find((x) => x.kind === kind)?.value || 0;
}
export const trophyCount = (ctx, h) => h.furniture.filter((e) => ctx.data.items[e.item]?.trophy).length;
export const trophyMax = (ctx, h) => H(ctx).trophies?.max?.[h.tier] ?? 0;

// 집 길잡이 돌(v3.3): 놓여 있으면 길잡이 돌에서 집 앞으로 건너뛴다
export function hasHearthstone(ctx, a) {
  const h = homeOf(ctx, a);
  return !!h && h.furniture.some((e) => ctx.data.items[e.item]?.hearthstone);
}
export function homeLanding(ctx, a) {
  const p = plotDef(ctx, a.house);
  if (!p) return null;
  const q = plotPos(ctx, p);
  const s = ctx.data.settlements[p.at];
  // 집 앞(마을 쪽) 3.8m
  const dx = s.x - q.x;
  const dz = s.z - q.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: Math.round((q.x + (dx / d) * 4.2) * 1000) / 1000, z: Math.round((q.z + (dz / d) * 4.2) * 1000) / 1000, at: p.at };
}
