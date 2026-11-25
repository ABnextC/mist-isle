// 달력(v1.7·v1.8): 한 달은 monthDays일, 한 달이 한 계절(봄→여름→가을→겨울).
// 계절마다 채집 산출이 달라지고, 달마다 7일 간격으로 장날이 선다. 모두 시각에서 계산한다(상태를 두지 않는다).

const C = (ctx) => ctx.data.config.calendar;
export const dayOfMonth = (ctx, t = ctx.state.t) => (ctx.clock.day(t) % C(ctx).monthDays) + 1;
export function seasonOf(ctx, t = ctx.state.t) {
  const S = C(ctx).seasons;
  return S[Math.floor(ctx.clock.day(t) / C(ctx).monthDays) % S.length];
}
export const seasonYield = (ctx, item, t) => seasonOf(ctx, t)?.yield?.[item] ?? 1;
export const isMarketDay = (ctx, t) => dayOfMonth(ctx, t) % C(ctx).marketEvery === 0;
