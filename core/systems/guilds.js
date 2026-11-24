// 조합(v0.8.1): 사람들이 세우고 드는 모임. 멀티플레이가 기본이다.
// 조합원은 사람(actors)과 AI 개척민(econ 에이전트)이다. AI는 보조라서, 사람이 minSize보다 적을 때 빈자리만 채운다.
// 조합은 날마다 큰 일감 둘을 받는다. 조합원이 물건을 넣어 채우고(넣은 만큼 은화), 다 채우면 조합 명성이 오른다.
// AI 조합원은 매시간 일감마다 조금씩 넣는다(사람 몫을 남길 만큼만). 명성 단계마다 조합원 모두에게 생활 혜택이 붙고 창고가 넓어진다.

import { hashStr } from '../terrain.js';
import { seedState, makeRng } from '../rng.js';

export const G = (ctx) => ctx.data.guilds;
export const guildOf = (ctx, a) => (a?.guild ? ctx.state.guilds?.[a.guild] || null : null);

export function guildLevel(ctx, g) {
  if (!g) return 0;
  let r = 0;
  G(ctx).levels.forEach((l, i) => { if (g.fame >= l.at) r = i + 1; });
  return r;
}

export const storeCap = (ctx, g) => G(ctx).levels[Math.max(0, guildLevel(ctx, g) - 1)].store;

export function guildPerks(ctx, a) {
  const g = guildOf(ctx, a);
  if (!g) return [];
  const lv = guildLevel(ctx, g);
  return G(ctx).perks.filter((p) => p.level <= lv);
}

// AI 빈자리: 사람이 minSize보다 적을 때만
export const aiRoom = (ctx, g) => Math.max(0, G(ctx).minSize - g.members.length);

// 아직 어느 조합에도 들지 않은 그 섬 개척민
export function hireable(ctx, g) {
  const taken = new Set(Object.values(ctx.state.guilds || {}).flatMap((x) => x.agents));
  const rid = ctx.state.settlements[g.home]?.region;
  return (ctx.state.econ?.agents || []).filter((x) => !taken.has(x.id) && ctx.state.settlements[x.home]?.region === rid);
}

export function newGuild(ctx, a, name, home) {
  const id = ctx.newId('gd');
  const g = { id, name, founder: a.id, home, members: [a.id], agents: [], fame: 0, store: [], jobs: [], day: -1, made: ctx.state.t };
  (ctx.state.guilds ||= {})[id] = g;
  a.guild = id;
  rollJobs(ctx, g);
  return g;
}

// 사람이 늘면 AI 빈자리가 줄어든다: 넘치는 AI는 뒤에서부터 내보낸다
export function trimAgents(ctx, g) {
  const room = aiRoom(ctx, g);
  while (g.agents.length > room) {
    const id = g.agents.pop();
    ctx.emit('guild.agentLeft', { guild: g.id, agent: id });
  }
}

// 오늘의 일감(날짜·조합으로 정해지는 난수)
export function rollJobs(ctx, g) {
  const day = ctx.clock.day(ctx.state.t);
  if (g.day === day) return;
  const rng = makeRng(seedState(hashStr(`${ctx.state.meta.worldSeed}:${g.id}:${day}`)));
  const pool = [...G(ctx).jobs];
  g.jobs = [];
  for (let i = 0; i < G(ctx).jobsPerDay && pool.length; i++) {
    const t = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    g.jobs.push({ id: `${g.id}:${day}:${i}`, item: t.item, qty: rng.int(t.qty[0], t.qty[1]), got: 0, ai: 0, pay: t.pay, fame: t.fame, done: false });
  }
  g.day = day;
}

export function jobProgress(ctx, g, job, n, who) {
  const left = job.qty - job.got;
  const put = Math.min(left, n);
  if (put <= 0) return 0;
  job.got += put;
  if (who === 'ai') job.ai += put;
  if (job.got >= job.qty && !job.done) {
    job.done = true;
    g.fame += job.fame;
    ctx.emit('guild.jobDone', { guild: g.id, job: job.id, item: job.item, fame: job.fame, total: g.fame });
  }
  return put;
}

// 매시간: 새 날이면 일감을 새로 받고, AI 조합원이 일감마다 조금씩 넣는다
export function guildsHourly(ctx) {
  for (const g of Object.values(ctx.state.guilds || {})) {
    rollJobs(ctx, g);
    trimAgents(ctx, g);
    if (!g.agents.length) continue;
    for (const job of g.jobs) {
      if (job.done) continue;
      const n = Math.max(1, Math.round(job.qty * G(ctx).aiRate * g.agents.length));
      jobProgress(ctx, g, job, n, 'ai');
    }
  }
}
