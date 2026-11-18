// 화면 없이 게임을 빨리 돌리고 리포트를 낸다.
//   node tools/headless.js --days 3 --seed 42 --bots 1 [--json]
// 3단계 페르소나 자동 플레이도 이 실행기를 바탕으로 한다.

import { performance } from 'node:perf_hooks';
import { loadData } from './load-data.js';
import { createGame } from '../core/game.js';
import { fmtPlay } from '../core/clock.js';
import { fmtProps, fmtStats, stars, itemName } from '../core/text.js';
import { avgProps } from '../core/inventory.js';
import { bestTool } from '../core/world.js';
import { ENGINE_VERSION } from '../core/state.js';

function parseArgs(argv) {
  const out = { days: 3, seed: 42, bots: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a.startsWith('--')) out[a.slice(2)] = Number(argv[++i]);
  }
  return out;
}

export function runSim({ days = 3, seed = 42, bots = 1 } = {}) {
  const data = loadData();
  const actors = Array.from({ length: bots }, (_, i) => ({ id: `b${i + 1}`, name: `개척민 ${i + 1}`, kind: 'bot', ai: 'settler' }));
  const game = createGame({ data, seed, actors });

  const veins = { opened: [], closed: 0 };
  game.on('vein.opened', (ev) => { if (!ev.common) veins.opened.push(ev); });
  game.on('vein.closed', () => { veins.closed++; });
  let rejected = 0;
  game.on('cmd.rejected', () => { rejected++; });
  const failed = {};
  game.on('gather.failed', (ev) => { failed[ev.reason] = (failed[ev.reason] || 0) + 1; });

  const seconds = days * data.config.time.secondsPerGameDay;
  const t0 = performance.now();
  game.advance(seconds);
  const ms = performance.now() - t0;
  const ticks = game.state.tick;

  const { state } = game;
  const ctx = { state, data };
  const actorsOut = Object.values(state.actors).map((a) => {
    const tools = {};
    for (const skill of ['logging', 'mining', 'harvesting']) {
      const t = bestTool(ctx, a, skill);
      tools[skill] = t ? { name: itemName(data, t.item), star: t.star, stats: t.stats, dur: t.dur, masterwork: t.masterwork } : null;
    }
    return {
      id: a.id, name: a.name,
      gathers: a.stats.gather, crafts: a.stats.craft, eat: a.stats.eat,
      focusUsed: Math.round(a.stats.focusUsed), masterwork: a.stats.masterwork,
      levels: Object.fromEntries(Object.entries(a.skills).filter(([, s]) => s.xp > 0).map(([k, s]) => [k, s.level])),
      milestones: a.milestones, tools,
      bag: a.bag.length, storage: a.storage.length,
    };
  });

  const allProps = Object.values(state.lots).filter((l) => !l.mix);
  const bestLot = allProps.reduce((b, l) => (!b || avgProps(l.props) > avgProps(b.props) ? l : b), null);
  const density = Object.values(state.regions)[0].density;

  return {
    meta: { days, seed, bots, ticks, ms: Math.round(ms), ticksPerSec: Math.round(ticks / (ms / 1000)) },
    actors: actorsOut,
    world: {
      veinsOpened: veins.opened.length, veinsClosed: veins.closed,
      lucky: veins.opened.filter((v) => Object.values(v.props).some((p) => p >= 80)).length,
      bestLot: bestLot ? { name: bestLot.name, props: bestLot.props } : null,
      density, nodes: Object.keys(state.nodes).length, lots: Object.keys(state.lots).length,
    },
    rejected, gatherFailed: failed,
    hash: game.hash(),
    data,
  };
}

function printReport(rep) {
  const { data } = rep;
  const sk = (id) => data.skills[id].name;
  const line = (s = '') => console.log(s);
  line(`안개섬 개척기 엔진 ${ENGINE_VERSION} 헤드리스 실행 — 시드 ${rep.meta.seed}, 게임 ${rep.meta.days}일(플레이 ${rep.meta.days}시간 분량), 봇 ${rep.meta.bots}`);
  line(`처리: ${rep.meta.ticks.toLocaleString()}틱(${data.config.time.hz}Hz), ${rep.meta.ms}ms (초당 ${rep.meta.ticksPerSec.toLocaleString()}틱) · 상태 해시 ${rep.hash}`);
  for (const a of rep.actors) {
    line();
    line(`[${a.name}]`);
    const g = a.gathers;
    const gTotal = Object.values(g).reduce((x, y) => x + y, 0);
    line(`  채집 ${gTotal}회 (${Object.entries(g).map(([k, v]) => `${sk(k)} ${v}`).join(' · ')})`);
    const refine = Object.entries(a.crafts).filter(([id]) => data.recipes[id].type === 'refine');
    const craft = Object.entries(a.crafts).filter(([id]) => data.recipes[id].type === 'craft');
    line(`  정제·부품 ${refine.reduce((s, [, v]) => s + v, 0)}회 (${refine.map(([id, v]) => `${data.recipes[id].name} ${v}`).join(' · ')})`);
    line(`  제작 ${craft.reduce((s, [, v]) => s + v, 0)}회 (${craft.map(([id, v]) => `${data.recipes[id].name} ${v}`).join(' · ')})`);
    line(`  음식 ${a.eat}번 · 집중력 ${a.focusUsed} 사용 · 걸작 ${a.masterwork}개 · 가방 ${a.bag}칸 · 창고 ${a.storage}묶음`);
    line(`  레벨: ${Object.entries(a.levels).map(([k, v]) => `${sk(k)} ${v}`).join(' · ')}`);
    const m = a.milestones;
    const ms = [];
    if (m.tool_t0 != null) ms.push(`첫 돌 도구 ${fmtPlay(m.tool_t0)}`);
    if (m.tool_t1 != null) ms.push(`첫 구리 도구 ${fmtPlay(m.tool_t1)}`);
    if (m.first_food != null) ms.push(`첫 음식 ${fmtPlay(m.first_food)}`);
    if (m.first_masterwork != null) ms.push(`첫 걸작 ${fmtPlay(m.first_masterwork)}`);
    line(`  이정표: ${ms.join(' · ') || '없음'}`);
    const lv = [];
    for (const s of ['logging', 'mining', 'harvesting']) {
      const parts = [10, 20, 30].filter((L) => m[`${s}_${L}`] != null).map((L) => `${L}=${fmtPlay(m[`${s}_${L}`])}`);
      if (parts.length) lv.push(`${sk(s)} ${parts.join(', ')}`);
    }
    if (lv.length) line(`  레벨 도달: ${lv.join(' / ')}`);
    for (const [s, t] of Object.entries(a.tools)) {
      if (t) line(`  ${sk(s)} 도구: ${t.name} ${stars(t.star)}${t.masterwork ? ' ✨' : ''} — ${fmtStats(t.stats)} (남은 내구 ${t.dur})`);
    }
  }
  line();
  const w = rep.world;
  line(`[섬] 순환 산지 열림 ${w.veinsOpened} · 닫힘 ${w.veinsClosed} · 속성 80 넘는 산지 ${w.lucky}`);
  if (w.bestLot) line(`  가장 좋은 산지: 「${w.bestLot.name}」 ${fmtProps(w.bestLot.props, data)}`);
  line(`  자원 밀도: ${Object.entries(w.density).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ')}`);
  line(`  노드 ${w.nodes}개 · 묶음(lot) ${w.lots}개 · 거절된 명령 ${rep.rejected} · 채집 실패 ${JSON.stringify(rep.gatherFailed)}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const rep = runSim(args);
  if (args.json) {
    const { data, ...rest } = rep;
    console.log(JSON.stringify(rest, null, 2));
  } else {
    printReport(rep);
  }
}
