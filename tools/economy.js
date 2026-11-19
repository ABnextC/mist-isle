// 섬 경제 점검(설계 8.5): AI 개척민만 사는 섬을 오래 돌려 물가·통화량·체결을 본다.
//   node tools/economy.js --days 60 --seed 7 [--bots 0] [--json]

import { performance } from 'node:perf_hooks';
import { loadData } from './load-data.js';
import { createGame } from '../core/game.js';
import { refPrice, baseValue, allOrders } from '../core/market.js';

function parseArgs(argv) {
  const out = { days: 60, seed: 7, bots: 0, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i].startsWith('--')) out[argv[i].slice(2)] = Number(argv[++i]);
  }
  return out;
}

const BASKET = ['log_birch', 'ore_copper', 'fiber_reed', 'lumber_birch', 'ingot_copper', 'cloth_reed', 'nails_copper', 'food_berry'];

export function runEconomy(data, { days, seed, bots = 0 }) {
  const actors = [{ id: 'p1', name: '관찰자', kind: 'player' }];
  for (let i = 0; i < bots; i++) actors.push({ id: `b${i + 1}`, name: `개척민 ${i + 1}`, kind: 'bot', ai: 'settler' });
  const game = createGame({ data, seed, actors });
  const ctx = { state: game.state, data, cfg: data.config };
  const daily = [];
  let posted = 0;
  let deliveredAgent = 0;
  let deliveredActor = 0;
  game.on('order.posted', () => { posted++; });
  game.on('order.delivered', (ev) => { if (ev.kind === 'agent') deliveredAgent += ev.qty; else deliveredActor += ev.qty; });
  const T0 = performance.now();
  for (let d = 0; d < days; d++) {
    game.advance(data.config.time.secondsPerGameDay);
    const s = game.state;
    const agents = s.econ.agents;
    const silver = agents.reduce((x, a) => x + a.silver, 0);
    const orders = allOrders({ state: s });
    const escrow = orders.filter((o) => o.escrow != null && o.kind !== 'town').reduce((x, b) => x + b.escrow, 0);
    const stock = agents.reduce((x, a) => x + a.stock.reduce((y, e) => y + (e.qty || 1), 0), 0);
    const day = game.clock.day(s.t) - 1;
    const st = s.market.stats[day] || {};
    const first = Object.keys(s.settlements)[0];
    const idx = BASKET.reduce((x, item) => x + refPrice(ctx, first, item, 2) / baseValue(ctx, item, 2), 0) / BASKET.length;
    const towns = Object.fromEntries(Object.values(s.settlements).map((t) => [t.id, { pop: t.pop, cap: t.cap, prosperity: t.prosperity, fill: t.demand.fill }]));
    const projects = Object.values(s.projects).filter((p) => p.done).length;
    const donated = agents.reduce((x, a) => x + (a.donated || 0), 0);
    const shipped = agents.reduce((x, a) => x + (a.shipped || 0), 0);
    daily.push({
      day: d + 1, silver, escrow, stock, asks: orders.filter((o) => o.entry).length, bids: orders.filter((o) => o.escrow != null).length,
      trades: st.trades || 0, volume: Math.round(st.volume || 0), npc: st.npc || 0, fees: st.fees || 0, tax: st.tax || 0,
      priceIndex: Math.round(idx * 100) / 100, orders: s.orders.length, towns, projects, donated: Math.round(donated), shipped,
    });
  }
  const ms = performance.now() - T0;
  const s = game.state;
  const prices = {};
  const sids = Object.keys(s.settlements);
  for (const item of [...BASKET, 'leather', 'food_meat', 'lumber_oak', 'ingot_iron']) {
    prices[item] = { base2: baseValue(ctx, item, 2) };
    for (const sid of sids) prices[item][sid] = Math.round(refPrice(ctx, sid, item, 2) * 10) / 10;
  }
  const wealth = s.econ.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, home: a.home, silver: a.silver, made: a.made, sold: a.sold, bought: a.bought, delivered: a.delivered, shipped: a.shipped || 0, donated: Math.round(a.donated || 0) })).sort((a, b) => b.silver - a.silver);
  const done = Object.values(s.projects).filter((p) => p.done).map((p) => ({ id: p.id, day: p.doneDay }));
  return { meta: { days, seed, bots, ms: Math.round(ms) }, daily, prices, wealth, projects: done, orders: { posted, deliveredAgent, deliveredActor } };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const data = loadData();
  const rep = runEconomy(data, args);
  if (args.json) {
    console.log(JSON.stringify(rep, null, 1));
  } else {
    console.log(`섬 경제 점검 — 시드 ${args.seed}, 게임 ${args.days}일, 봇 ${args.bots} · ${rep.meta.ms}ms`);
    const pick = rep.daily.filter((d) => d.day === 1 || d.day % Math.max(1, Math.floor(args.days / 10)) === 0);
    console.log('일  | 개척민 은화 | 맡긴 은화 | 재고 | 팔자/사자 | 체결 | 거래액 | 상인매입 | 물가지수 | 사업 | 기부 | 운송 | 마을(인구/상한·번영·채움)');
    for (const d of pick) {
      const towns = Object.values(d.towns).map((t) => `${t.pop}/${t.cap}·${Math.round(t.prosperity)}·${t.fill ?? '-'}`).join(' ');
      console.log(`${String(d.day).padStart(3)} | ${String(d.silver).padStart(10)} | ${String(d.escrow).padStart(8)} | ${String(d.stock).padStart(5)} | ${String(d.asks).padStart(4)}/${String(d.bids).padEnd(4)} | ${String(d.trades).padStart(4)} | ${String(d.volume).padStart(6)} | ${String(d.npc).padStart(7)} | ${String(d.priceIndex).padEnd(8)} | ${String(d.projects).padStart(4)} | ${String(d.donated).padStart(6)} | ${String(d.shipped).padStart(4)} | ${towns}`);
    }
    console.log('\n기준가(★2) — 마을별 vs 기본값:');
    for (const [k, v] of Object.entries(rep.prices)) console.log(`  ${data.items[k].name}: ${Object.entries(v).filter(([x]) => x !== 'base2').map(([sid, p]) => `${data.settlements[sid].name} ${p}`).join(' · ')} (기본 ${v.base2})`);
    console.log('\n끝난 사업:', rep.projects.map((p) => `${data.projects[p.id].name}(${p.day + 1}일차)`).join(' · ') || '없음');
    console.log(`\n주문: 게시 ${rep.orders.posted} · AI가 채운 수량 ${rep.orders.deliveredAgent} · 행위자가 채운 수량 ${rep.orders.deliveredActor}`);
    console.log('부자 순:', rep.wealth.slice(0, 5).map((w) => `${w.name}(${w.role}) ${w.silver}`).join(' · '));
    console.log('가난한 순:', rep.wealth.slice(-5).map((w) => `${w.name}(${w.role}) ${w.silver}`).join(' · '));
  }
}
