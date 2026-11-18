// 엔진 점검판 v0.0
// 코어를 브라우저에서 돌리고, 명령을 눌러 보는 화면이다. 3D 화면은 v0.1에서 붙는다.
// 화면은 상태를 직접 고치지 않는다. 모든 조작은 game.dispatch(명령)로 간다.

import { DATA_FILES, buildData } from '../../core/data.js';
import { createGame, loadGame } from '../../core/game.js';
import { describeEvent, ERR, fmtProps, fmtStats, stars, itemName, entryStar } from '../../core/text.js';
import { xpProgress, starOf } from '../../core/formulas.js';
import { avgProps, keyOf, effectiveProps } from '../../core/inventory.js';
import { dist, settlementAt, nearestSettlement, bestTool } from '../../core/world.js';

const SAVE_KEY = 'mist-isle:v0';
const PID = 'p1';
const $app = document.getElementById('app');

let data;
let game;
let log = [];
const ui = { speed: 1, intent: null, skill: 'all', focus: false, toast: '', toastUntil: 0, resetArmed: 0, holding: false };

const FAMILY = { wood: '나무', metal: '금속', stone: '돌', fiber: '섬유', food: '식재료', herb: '약초' };
const STAGE = { raw: '원자재', refined: '정제품', component: '부품' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const me = () => game.state.actors[PID];
const ctx = () => ({ state: game.state, data });
const now = () => performance.now();

// ── 불러오기·저장 ─────────────────────────────────────
async function loadData() {
  const raw = {};
  await Promise.all(DATA_FILES.map(async (f) => {
    const res = await fetch(`./data/${f}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${f}.json을 읽지 못함 (${res.status})`);
    raw[f] = await res.json();
  }));
  return buildData(raw);
}

function readSave() {
  try { return localStorage.getItem(SAVE_KEY); } catch { return null; }
}

function saveNow(say) {
  try {
    localStorage.setItem(SAVE_KEY, game.save());
    if (say) toast('저장했다', true);
  } catch {
    if (say) toast('이 브라우저에서는 저장할 수 없음');
  }
}

function attach(g) {
  game = g;
  log = [];
  g.on('*', (ev) => {
    if (ev.type === 'cmd.rejected' && ev.actor === PID) toast(ERR[ev.reason] || ev.reason);
    const line = describeEvent(ev, g);
    if (line) {
      log.unshift({ t: ev.t, line });
      if (log.length > 80) log.pop();
    }
  });
}

function toast(msg, good) {
  ui.toast = (good ? '✅ ' : '⚠️ ') + msg;
  ui.toastUntil = now() + 2200;
}

// ── 패널 ─────────────────────────────────────────────
function pTop() {
  const c = game.clock.describe(game.state.t);
  const armed = ui.resetArmed > now();
  const speeds = [0, 1, 10, 60]
    .map((s) => `<button data-act="speed" data-v="${s}" class="${ui.speed === s ? 'on' : ''}">${s === 0 ? '⏸ 멈춤' : '×' + s}</button>`)
    .join('');
  return `<div class="title">안개섬 개척기<small>엔진 점검판 v0.0</small><a href="patchnotes.html">패치노트</a></div>
    <div class="clock">${c.night ? '🌙' : '☀️'} ${c.day}일차 · ${c.night ? '밤' : '낮'} · ${c.night ? '해 뜰 때까지' : '해 질 때까지'} ${c.minutesLeft}분</div>
    <div class="row">${speeds}
      <button data-act="auto" class="${me().ai?.on ? 'on' : ''}">🤖 봇에게 맡기기</button>
      <button data-act="save">💾 저장</button>
      <button data-act="reset" class="${armed ? 'warn' : ''}">${armed ? '한 번 더 누르면 새로 시작' : '↺ 새로 시작'}</button>
    </div>`;
}

function pStatus() {
  const a = me();
  const town = settlementAt(ctx(), a);
  const home = nearestSettlement(ctx(), a);
  const where = town ? `🏘️ ${town.name} 안` : `🧭 ${home.name}까지 ${Math.round(dist(a, home))}m`;
  let doing = '쉬는 중';
  if (a.action) doing = `⛏️ 채집 중 · ${Math.max(0, Math.ceil(a.action.endsAt - game.state.t))}초`;
  else if (a.dest) doing = `🚶 이동 중 · ${Math.round(Math.hypot(a.dest[0] - a.x, a.dest[1] - a.z))}m`;
  if (a.ai?.on) doing += ' · 🤖 봇이 움직이는 중';
  const max = data.config.focus.max;
  const buffs = a.buffs.map((b) => `🍽️ 채집량 +${Math.round(b.value * 100)}% (${Math.ceil((b.endsAt - game.state.t) / 60)}분 남음)`).join(' ');
  const hasTool = a.bag.some((e) => e.uid && data.items[e.item].tool);
  const hint = hasTool ? '' : '<p class="hint">처음이라면 맨손으로 표류목과 돌을 캐세요. 돌 3개와 나무 2개로 돌 도구를 만들 수 있어요. 제작 칸의 ‘돌 도끼’를 누르면 됩니다.</p>';
  return `<section class="card"><h2>내 상태</h2>
    <div>${where} · ${doing}</div>
    <div class="bar"><span style="width:${(a.focus / max) * 100}%"></span><em>집중력 ${Math.floor(a.focus)} / ${max}</em></div>
    <label class="chk"><input type="checkbox" data-act="focus" ${ui.focus ? 'checked' : ''}> 채집할 때 집중력 쓰기 (희귀 부산물 2배, 1회 ${data.config.focus.cost.gather})</label>
    ${buffs ? `<div style="margin-top:6px">${buffs}</div>` : ''}${hint}
    <div class="row"><button data-act="home">🏘️ 정착지로</button>${town ? '<button data-act="store">📦 재료를 창고에 넣기</button>' : ''}</div>
  </section>`;
}

function pSkills() {
  const a = me();
  const cap = data.config.skillCap;
  const rows = data.lists.skills.filter((s) => !('opens' in s)).map((s) => {
    const p = xpProgress(a.skills[s.id].xp, data.curve, cap);
    const pct = p.need ? (p.into / p.need) * 100 : 100;
    return `<div class="skill"><span>${s.icon} ${s.name}</span><b>${p.level}</b><div class="bar thin"><span style="width:${pct}%"></span></div></div>`;
  }).join('');
  const later = data.lists.skills.filter((s) => 'opens' in s).map((s) => `${s.icon}${s.name}${s.opens ? `(${s.opens})` : ''}`).join(' · ');
  return `<section class="card"><h2>생활 스킬<small>v0.0 상한 ${cap}</small></h2><div class="skills">${rows}</div><p class="muted">나중에 열림: ${later}</p></section>`;
}

function pNodes() {
  const a = me();
  const tabs = ['all', 'logging', 'mining', 'harvesting'].map((t) => `<button data-act="tab" data-v="${t}" class="${ui.skill === t ? 'on' : ''}">${t === 'all' ? '전체' : data.skills[t].icon + ' ' + data.skills[t].name}</button>`).join('');
  const list = Object.values(game.state.nodes)
    .filter((n) => ui.skill === 'all' || data.nodes[n.type].skill === ui.skill)
    .map((n) => ({ n, d: dist(a, n) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 8);
  const rows = list.map(({ n, d }) => {
    const type = data.nodes[n.type];
    const lot = game.state.lots[game.state.veins[n.vein].lot];
    const st = starOf(avgProps(lot.props), data.config.stars);
    let why = '';
    if (a.skills[type.skill].level < type.level) why = `${data.skills[type.skill].name} ${type.level} 필요`;
    else if (type.tier > 0 && !bestTool(ctx(), a, type.skill)) why = '도구 필요';
    const left = n.charges > 0 ? `남은 ${n.charges}번` : `다시 자라는 중 ${Math.ceil((n.respawnAt - game.state.t) / 60)}분`;
    const can = !why && n.charges > 0;
    const going = ui.intent?.node === n.id;
    return `<li class="${going ? 'going' : ''}">
      <div><b>${type.name}</b> <span class="stars">${stars(st)}</span><br><small>${esc(lot.name)} · ${fmtProps(lot.props, data)}</small></div>
      <div class="right"><small>${Math.round(d)}m · ${left}</small>${why ? `<small class="warn">${why}</small>` : ''}
        <button data-act="go" data-v="${n.id}" ${can ? '' : 'disabled'}>${going ? '캐는 중…' : '가서 캐기'}</button></div></li>`;
  }).join('');
  return `<section class="card"><h2>가까운 노드<small>누르면 걸어가서 다 캘 때까지 캔다</small></h2><div class="row tabs">${tabs}</div><ul class="list">${rows}</ul></section>`;
}

function entryRow(e, withEat) {
  const def = data.items[e.item];
  const st = entryStar(e, game.state, data.config);
  const starHtml = st ? ` <span class="stars">${stars(st)}</span>` : '';
  if (e.uid) {
    const dur = e.maxDur ? ` · 내구 ${e.dur}/${e.maxDur}` : '';
    return `<li><span>${def.icon || ''} <b>${def.name}</b>${starHtml}${e.masterwork ? ' ✨걸작' : ''}${e.broken ? ' <em class="warn">부서짐</em>' : ''}</span><small>${fmtStats(e.stats)}${dur}</small></li>`;
  }
  if (def.kind === 'consumable') {
    const btn = withEat ? `<button data-act="eat" data-v="${esc(keyOf(e))}">먹기</button>` : '';
    return `<li><span>${def.icon || ''} <b>${def.name}</b> ×${e.qty}${starHtml}</span>${btn}<small>${fmtStats(e.stats)}</small></li>`;
  }
  const lot = e.lot ? game.state.lots[e.lot] : null;
  const bonus = e.bonus ? ' · ' + Object.entries(e.bonus).map(([k, v]) => `${data.config.propNames[k]} +${v}`).join(', ') : '';
  const detail = lot ? `${esc(lot.name)} · ${fmtProps(effectiveProps(e, game.state.lots), data)}${bonus}` : esc(def.note || '');
  return `<li><span>${def.icon || ''} <b>${def.name}</b> ×${e.qty}${starHtml}</span><small>${detail}</small></li>`;
}

function pBag() {
  const a = me();
  const order = (e) => {
    const def = data.items[e.item];
    return def.tool ? 0 : def.kind === 'consumable' ? 1 : def.kind === 'equipment' ? 2 : def.stage === 'raw' ? 3 : 4;
  };
  const bag = [...a.bag].sort((x, y) => order(x) - order(y));
  const rows = bag.map((e) => entryRow(e, true)).join('') || '<li><small>비어 있음</small></li>';
  const storage = [...a.storage].sort((x, y) => order(x) - order(y)).map((e) => entryRow(e, false)).join('');
  return `<section class="card bag"><h2>가방<small>${a.bag.length} / ${data.config.bag.slots}칸</small></h2><ul class="list">${rows}</ul>
    <details ${a.storage.length ? '' : 'hidden'}><summary>창고 (${a.storage.length}묶음) — 정착지에서 제작할 때 같이 쓴다</summary><ul class="list">${storage}</ul></details></section>`;
}

function slotLabel(s) {
  if (s.item) return itemName(data, s.item);
  return `${FAMILY[s.family] || s.family}(${STAGE[s.stage] || s.stage})`;
}

function pCraft() {
  const a = me();
  const town = settlementAt(ctx(), a);
  const rows = (type) => data.lists.recipes.filter((r) => r.type === type).map((r) => {
    const chk = game.check({ type: 'CRAFT', actor: PID, recipe: r.id, auto: 'best', catalyst: 'auto' });
    const sk = data.skills[r.skill];
    const stn = data.stations[r.station];
    const mats = r.slots.map((s) => `${slotLabel(s)} ${s.qty}`).join(' + ');
    const cat = r.catalyst ? ` <small>(촉매: ${itemName(data, r.catalyst)})</small>` : '';
    const why = chk.ok ? '' : `<small class="warn">${ERR[chk.error] || chk.error}</small>`;
    return `<li><div><b>${sk.icon} ${r.name}</b> <small>${sk.name} ${r.level} · ${stn.icon}${stn.name}</small><br><small>${mats} → ${itemName(data, r.output.item)} ×${r.output.qty}</small>${cat}</div>
      <div class="right">${why}<button data-act="craft" data-v="${r.id}" ${chk.ok ? '' : 'disabled'}>만들기</button></div></li>`;
  }).join('');
  const queue = a.queue.map((j, i) => {
    const r = data.recipes[j.recipe];
    const span = Math.max(1, j.endsAt - j.startsAt);
    const done = Math.max(0, Math.min(1, (game.state.t - j.startsAt) / span));
    return `<li><span>${i === 0 ? '⏳' : '·'} ${r.name}</span><div class="bar thin"><span style="width:${done * 100}%"></span></div></li>`;
  }).join('');
  return `<section class="card"><h2>제작${town ? '' : '<small class="warn">정착지 밖에서는 맨손 제작만</small>'}</h2>
    ${queue ? `<h3>대기열 ${a.queue.length}/${data.config.craft.queueMax}</h3><ul class="list queue">${queue}</ul>` : ''}
    <h3>정제·부품</h3><ul class="list">${rows('refine')}</ul>
    <h3>제작</h3><ul class="list">${rows('craft')}</ul>
    <p class="muted">재료는 ‘자동: 최고 품질’로 고른다. 촉매가 있으면 같이 쓴다.</p></section>`;
}

function pVeins() {
  const a = me();
  const list = Object.values(game.state.veins).filter((v) => !v.common)
    .sort((x, y) => avgProps(game.state.lots[y.lot].props) - avgProps(game.state.lots[x.lot].props));
  const rows = list.map((v) => {
    const lot = game.state.lots[v.lot];
    const d = Math.round(Math.hypot(v.center[0] - a.x, v.center[1] - a.z));
    return `<li><span><b>${esc(v.name)}</b> <span class="stars">${stars(starOf(avgProps(lot.props), data.config.stars))}</span></span>
      <small>${fmtProps(lot.props, data)} · ${d}m · ${v.closesOnDay + 1}일차 아침에 닫힘</small></li>`;
  }).join('');
  return `<section class="card bag"><h2>열린 산지<small>영맥이 옮겨 가면 바뀐다</small></h2><ul class="list">${rows}</ul></section>`;
}

function pLog() {
  const fmt = (t) => `${Math.floor(t / 3600) + 1}일 ${Math.floor((t % 3600) / 60)}분`;
  const rows = log.slice(0, 50).map((l) => `<li><small>${fmt(l.t)}</small>${esc(l.line)}</li>`).join('');
  return `<section class="card"><h2>기록</h2><ul class="log">${rows || '<li><small>아직 없음</small></li>'}</ul></section>`;
}

const PANELS = { top: pTop, status: pStatus, nodes: pNodes, veins: pVeins, skills: pSkills, bag: pBag, craft: pCraft, log: pLog };

function skeleton() {
  $app.innerHTML = `<header class="top" id="p-top"></header>
    <main class="layout">
      <div class="col"><div id="p-status"></div><div id="p-nodes"></div><div id="p-veins"></div></div>
      <div class="col"><div id="p-bag"></div><div id="p-craft"></div><div id="p-skills"></div></div>
      <div class="wide" id="p-log"></div>
    </main><div id="toast"></div>`;
}

function render(force) {
  if (ui.holding && !force) return;
  for (const [id, fn] of Object.entries(PANELS)) {
    const el = document.getElementById('p-' + id);
    const html = fn();
    if (el._html !== html) {
      el.innerHTML = html;
      el._html = html;
    }
  }
  const t = document.getElementById('toast');
  const show = ui.toastUntil > now();
  t.className = show ? 'toast' : '';
  t.textContent = show ? ui.toast : '';
}

// ── 조작 ─────────────────────────────────────────────
function stopBot() {
  if (me().ai?.on) game.dispatch({ type: 'SET_AUTOPILOT', actor: PID, on: false });
}

function onAct(act, v) {
  switch (act) {
    case 'speed': ui.speed = Number(v); break;
    case 'auto':
      ui.intent = null;
      game.dispatch({ type: 'SET_AUTOPILOT', actor: PID, on: !me().ai?.on });
      break;
    case 'save': saveNow(true); break;
    case 'reset':
      if (ui.resetArmed > now()) {
        ui.resetArmed = 0;
        ui.intent = null;
        attach(createGame({ data, seed: Date.now() % 1_000_000_007 }));
        saveNow();
        toast('새 섬에 상륙했다', true);
      } else {
        ui.resetArmed = now() + 3000;
      }
      break;
    case 'home': {
      stopBot();
      ui.intent = null;
      const s = nearestSettlement(ctx(), me());
      game.dispatch({ type: 'MOVE', actor: PID, x: s.x, z: s.z });
      break;
    }
    case 'store': game.dispatch({ type: 'STORE', actor: PID, all: true }); break;
    case 'go': {
      stopBot();
      const n = game.state.nodes[v];
      if (!n) break;
      ui.intent = { node: v };
      if (dist(me(), n) > data.config.gather.rangeM) game.dispatch({ type: 'MOVE', actor: PID, x: n.x, z: n.z });
      break;
    }
    case 'craft': game.dispatch({ type: 'CRAFT', actor: PID, recipe: v, auto: 'best', catalyst: 'auto' }); break;
    case 'eat': game.dispatch({ type: 'EAT', actor: PID, key: v }); break;
    case 'tab': ui.skill = v; break;
    case 'focus': ui.focus = !ui.focus; break;
    default: break;
  }
}

// ‘가서 캐기’: 도착하면 노드가 빌 때까지 계속 캔다
function driveIntent() {
  const a = me();
  if (!ui.intent || a.ai?.on || a.action || a.dest) return;
  const n = game.state.nodes[ui.intent.node];
  if (!n || n.charges <= 0) {
    ui.intent = null;
    return;
  }
  if (dist(a, n) > data.config.gather.rangeM) {
    game.dispatch({ type: 'MOVE', actor: PID, x: n.x, z: n.z });
    return;
  }
  const useFocus = ui.focus && a.focus >= data.config.focus.cost.gather;
  if (!game.dispatch({ type: 'GATHER', actor: PID, node: n.id, focus: useFocus }).ok) ui.intent = null;
}

let last = now();
function frame(t) {
  const dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  if (ui.speed > 0) {
    game.advance(dt * ui.speed);
    driveIntent();
  }
  requestAnimationFrame(frame);
}

// ── 시작 ─────────────────────────────────────────────
async function boot() {
  try {
    data = await loadData();
  } catch (e) {
    $app.innerHTML = `<p class="error">데이터를 불러오지 못했어요.\n${esc(e.message)}</p>`;
    return;
  }
  const saved = readSave();
  let g = null;
  if (saved) {
    try { g = loadGame({ data, save: saved }); } catch { g = null; }
  }
  attach(g || createGame({ data, seed: Date.now() % 1_000_000_007 }));
  skeleton();
  $app.addEventListener('pointerdown', () => { ui.holding = true; });
  window.addEventListener('pointerup', () => setTimeout(() => { ui.holding = false; }, 80));
  window.addEventListener('pointercancel', () => { ui.holding = false; });
  $app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    onAct(b.dataset.act, b.dataset.v);
    render(true);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  setInterval(render, 250);
  setInterval(() => saveNow(), 30_000);
  render(true);
  requestAnimationFrame(frame);
}

boot();
