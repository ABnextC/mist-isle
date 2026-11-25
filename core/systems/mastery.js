// 무기 숙련(v1.1): 무기마다 1~20레벨, 레벨만큼 점수. 두 갈래 트리에서 액티브·강화·패시브·궁극을 찍는다.
// 액티브 셋을 1·2·3에 건다. 무기를 바꾸면 그 무기의 스킬 줄로 바뀐다.

const r2 = (v) => Math.round(v * 100) / 100;

export const masteryOf = (ctx, weaponType) => {
  const W = ctx.data.weapons;
  const m = W.mastery[weaponType] || weaponType;
  return W.types[m] ? m : null;
};

export const needXp = (W, lvl) => Math.round(W.xp.base * Math.pow(lvl, W.xp.exp));

// 읽기 전용(없으면 1레벨 빈 기록)
export function mOf(a, w) {
  return a.mastery?.[w] || { xp: 0, lvl: 1, nodes: [] };
}
function mRef(a, w) {
  a.mastery ??= {};
  return (a.mastery[w] ??= { xp: 0, lvl: 1, nodes: [] });
}

export function gainXp(ctx, a, w, n) {
  if (!w || !(n > 0) || a.kind === 'mob') return;
  const W = ctx.data.weapons;
  const m = mRef(a, w);
  if (m.lvl >= W.cap) return;
  m.xp = r2(m.xp + n);
  while (m.lvl < W.cap && m.xp >= needXp(W, m.lvl)) {
    m.xp = r2(m.xp - needXp(W, m.lvl));
    m.lvl++;
    ctx.emit('mastery.level', { actor: a.id, weapon: w, level: m.lvl });
  }
  if (m.lvl >= W.cap) m.xp = 0;
}

export const pointsOf = (a, w) => mOf(a, w).lvl;
export const spentOf = (a, w) => mOf(a, w).nodes.length;
export function spentIn(ctx, a, w, tree) {
  const N = ctx.data.weaponNodes;
  return mOf(a, w).nodes.filter((id) => N[id]?.tree === tree).length;
}
export const hasNode = (a, w, id) => mOf(a, w).nodes.includes(id);

export function learnError(ctx, a, id) {
  const n = ctx.data.weaponNodes[id];
  if (!n) return 'bad_args';
  const w = n.weapon;
  if (hasNode(a, w, id)) return 'already';
  if (spentOf(a, w) >= pointsOf(a, w)) return 'no_points';
  if (spentIn(ctx, a, w, n.tree) < n.req) return 'locked';
  if (n.needs && !hasNode(a, w, n.needs)) return 'locked';
  return null;
}

export function learn(ctx, a, id) {
  const n = ctx.data.weaponNodes[id];
  const m = mRef(a, n.weapon);
  m.nodes.push(id);
  // 처음 배운 액티브는 빈 칸에 바로 건다
  if (n.kind === 'active') {
    const lo = loadoutOf(a, n.weapon);
    const i = lo.indexOf(null);
    if (i >= 0) {
      lo[i] = id;
      a.loadout[n.weapon] = lo;
    }
  }
  ctx.emit('mastery.learn', { actor: a.id, weapon: n.weapon, node: id });
}

export function loadoutOf(a, w) {
  a.loadout ??= {};
  const lo = a.loadout[w] || [null, null, null];
  return [lo[0] ?? null, lo[1] ?? null, lo[2] ?? null];
}

// 찍은 패시브·궁극을 더한 값. 숫자는 더하고, 묶음({sec, dmg})은 그대로 쓴다
export function passivesOf(ctx, a, w) {
  const P = {};
  if (!w) return P;
  const N = ctx.data.weaponNodes;
  for (const id of mOf(a, w).nodes) {
    const n = N[id];
    if (!n?.p) continue;
    for (const [k, v] of Object.entries(n.p)) {
      if (typeof v === 'number') P[k] = r2((P[k] || 0) + v);
      else P[k] = v;
    }
  }
  return P;
}

function setPath(o, path, v, add) {
  const ks = path.split('.');
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]] = { ...(cur[ks[i]] || {}) };
  const k = ks[ks.length - 1];
  cur[k] = add ? r2((cur[k] || 0) + v) : v;
}

// 액티브 + 찍은 강화를 합친 실제 스킬 값
export function abilityOf(ctx, a, id) {
  const N = ctx.data.weaponNodes;
  const n = N[id];
  if (!n || n.kind !== 'active') return null;
  const ab = JSON.parse(JSON.stringify(n.ab));
  for (const uid of mOf(a, n.weapon).nodes) {
    const u = N[uid];
    if (u?.kind !== 'up' || u.needs !== id) continue;
    for (const [k, v] of Object.entries(u.mod.set || {})) setPath(ab, k, v, false);
    for (const [k, v] of Object.entries(u.mod.add || {})) setPath(ab, k, v, true);
  }
  return ab;
}

export function resetCost(ctx, a, w) {
  return spentOf(a, w) * ctx.data.weapons.reset.perPoint;
}
