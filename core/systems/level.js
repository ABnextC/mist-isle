// 전투 레벨(v2.3): 무기 숙련(무기마다)과 따로, 사람 하나에 하나 붙는 레벨(1~60).
// 짐승을 잡고·의뢰를 끝내고·원정을 마치면 오른다. 레벨마다 최대 체력이 조금 오르고 능력치 점수 1점을 받는다.
// 능력치 다섯(힘·민첩·지능·체질·집중)은 무기마다 다르게 피해에 붙는다. 수치는 data/config.json의 level에 있다.
// 행위자마다 a.clevel = { lvl, xp, attrs: { str, dex, int, con, foc } }. 상태는 순수 데이터라 멀티에서도 그대로 쓴다.

const r2 = (v) => Math.round(v * 10000) / 10000; // 능력치 보너스는 0.3% 단위라 네 자리로 둔다
export const ATTRS = ['str', 'dex', 'int', 'con', 'foc'];
export const L = (ctx) => ctx.data.config.level;

export const emptyLevel = () => ({ lvl: 1, xp: 0, attrs: { str: 0, dex: 0, int: 0, con: 0, foc: 0 } });
export function levelOf(a) {
  if (!a.clevel) a.clevel = emptyLevel();
  return a.clevel;
}
export const needXp = (ctx, lvl) => Math.round(L(ctx).xpBase * Math.pow(lvl, L(ctx).xpPow));
export const pointsOf = (ctx, a) => (levelOf(a).lvl - 1) * L(ctx).pointsPerLevel;
export const spentOf = (a) => ATTRS.reduce((s, k) => s + (levelOf(a).attrs[k] || 0), 0);
export const freePoints = (ctx, a) => pointsOf(ctx, a) - spentOf(a);

// 짐승 레벨: 데이터에 있으면 그 값, 없으면 체력으로 어림한다
export const mobLevel = (ctx, typeId) => {
  const t = ctx.data.creatures[typeId];
  return t?.level ?? Math.max(1, Math.round(Math.sqrt(t?.hp || 40) * 1.2));
};
// 싸움 레벨(v3.1): 짐승은 종의 레벨, 사람은 전투 레벨, 동행·민병은 주인의 레벨
export function fightLevel(ctx, x) {
  if (!x) return 1;
  if (!x.kind) return mobLevel(ctx, x.type);
  const r = x.kind === 'ally' ? ctx.state.actors[x.ally?.owner] || x : x;
  return r.clevel?.lvl || 1;
}
// 레벨 차이 배율(v3.1): 때리는 쪽이 맞는 쪽보다 낮으면 덜 아프게, 높으면 조금 더 아프게.
// 차이가 grace(2) 안이면 같은 급으로 본다. 피해에 곱한다(짐승↔사람, 사람↔사람 모두)
export function gapMult(ctx, att, def) {
  const G = L(ctx).gap;
  if (!G) return 1;
  let d = fightLevel(ctx, att) - fightLevel(ctx, def);
  const g = G.grace ?? 2;
  d = Math.abs(d) <= g ? 0 : d - Math.sign(d) * g;
  d = Math.max(-G.maxGap, Math.min(G.maxGap, d));
  if (d < 0) return Math.max(G.lowMin, 1 + d * G.lowPer);
  return Math.min(G.highMax, 1 + d * G.highPer);
}

// 잡았을 때 경험치: 레벨이 너무 낮은 짐승은 적게 준다
export function mobXp(ctx, a, typeId) {
  const t = ctx.data.creatures[typeId];
  const ml = mobLevel(ctx, typeId);
  let xp = L(ctx).killBase + ml * L(ctx).killPerLevel;
  if (t?.boss) xp *= L(ctx).bossMult;
  const gap = levelOf(a).lvl - ml;
  if (gap > 6) xp *= Math.max(0.15, 1 - (gap - 6) * 0.12);
  return Math.round(xp);
}

export function gainLevelXp(ctx, a, amt, why) {
  if (!amt || a.kind !== 'player') return 0;
  const C = levelOf(a);
  const cap = L(ctx).cap;
  if (C.lvl >= cap) return 0;
  C.xp = Math.round(C.xp + amt);
  const from = C.lvl;
  while (C.lvl < cap && C.xp >= needXp(ctx, C.lvl)) {
    C.xp -= needXp(ctx, C.lvl);
    C.lvl += 1;
  }
  if (C.lvl >= cap) C.xp = 0;
  ctx.emit('level.xp', { actor: a.id, amt: Math.round(amt), why, lvl: C.lvl, xp: C.xp });
  if (C.lvl > from) {
    // 오르면 체력·기력·마나를 채운다
    if (a.cb) a.cb.hp = a.cb.maxHp;
    ctx.emit('level.up', { actor: a.id, lvl: C.lvl, from, points: freePoints(ctx, a) });
  }
  return amt;
}

export function spendError(ctx, a, attr, n) {
  if (!ATTRS.includes(attr)) return 'bad_args';
  if (!(n >= 1 && Number.isInteger(n))) return 'bad_args';
  if (freePoints(ctx, a) < n) return 'no_points';
  return null;
}
export function spend(ctx, a, attr, n) {
  levelOf(a).attrs[attr] += n;
  ctx.emit('level.attr', { actor: a.id, attr, n, value: levelOf(a).attrs[attr] });
}
export const resetCost = (ctx, a) => spentOf(a) * L(ctx).resetPerPoint;
export function resetAttrs(ctx, a) {
  for (const k of ATTRS) levelOf(a).attrs[k] = 0;
  ctx.emit('level.reset', { actor: a.id });
}

// 능력치·레벨이 주는 힘을 무기 숙련 보너스(P)와 같은 키로 돌려준다. combat.passivesNow가 더한다.
// 무기 종류마다 주 능력치(피해 큰 몫)·부 능력치(작은 몫)가 다르다.
// 장신구(v2.4): 반지·목걸이가 능력치를 더한다
export const JEWEL_SLOTS = ['ring', 'neck'];
export function jewelOf(ctx, a, slot) {
  const uid = a?.equip?.[slot];
  const e = uid && a.bag.find((x) => x.uid === uid);
  return e && !e.broken ? e : null;
}
export function withJewels(ctx, a, attrs) {
  let out = attrs;
  for (const s of JEWEL_SLOTS) {
    const e = jewelOf(ctx, a, s);
    const j = e && ctx.data.items[e.item].jewel;
    if (j?.attr && e.stats?.attr) {
      if (out === attrs) out = { ...attrs };
      out[j.attr] = (out[j.attr] || 0) + e.stats.attr;
    }
  }
  return out;
}
export function jewelGather(ctx, a) {
  let v = 0;
  for (const s of JEWEL_SLOTS) {
    const e = jewelOf(ctx, a, s);
    if (e && ctx.data.items[e.item].jewel?.gather) v += e.stats?.gather || 0;
  }
  return v;
}
export function levelPassives(ctx, a, wtype) {
  if (!a?.clevel) return null;
  const C = a.clevel;
  const S = L(ctx);
  const at = withJewels(ctx, a, C.attrs);
  const sc = S.scaling[wtype || 'fist'] || S.scaling.fist;
  const P = {};
  P.dmg = r2((at[sc[0]] || 0) * S.mainDmg + (sc[1] ? (at[sc[1]] || 0) * S.subDmg : 0));
  P.maxHp = r2((C.lvl - 1) * S.hpPerLevel + (at.con || 0) * S.conHp);
  if (at.dex) P.crit = r2(at.dex * S.dexCrit);
  if (at.int) P.maxMp = r2(at.int * S.intMp);
  if (at.foc) {
    P.mpRegen = r2(at.foc * S.focRegen);
    P.stRegen = r2(at.foc * S.focRegen * 0.6);
  }
  return P;
}
// 두 보너스 묶음을 더한다(숫자는 더하고 그 밖은 앞 것을 둔다)
export function mergeP(A, B) {
  if (!B) return A;
  const P = { ...A };
  for (const [k, v] of Object.entries(B)) if (typeof v === 'number') P[k] = r2((P[k] || 0) + v);
  return P;
}
