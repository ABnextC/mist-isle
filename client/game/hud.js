// 화면 위 정보(HUD)와 패널. 아이콘·색을 먼저 보이고, 수치는 패널에서 연다.
// 버튼은 data-act로 main.js에 넘긴다. HUD는 상태를 직접 고치지 않는다.

import { ERR, fmtProps, fmtStats, stars, itemName, entryStar, describeEvent } from '../../core/text.js';
import { xpProgress, starOf } from '../../core/formulas.js';
import { keyOf, effectiveProps, avgProps, countItem, qtyOf } from '../../core/inventory.js';
import { settlementAt } from '../../core/world.js';
import { ENGINE_VERSION } from '../../core/state.js';

const PID = 'p1';
const FAMILY = { wood: '나무', metal: '금속', stone: '돌', fiber: '섬유', food: '식재료', herb: '약초' };
const STAGE = { raw: '원자재', refined: '정제품', component: '부품' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function direction(dx, dz) {
  const ang = Math.atan2(dx, dz); // 북(+z) = 0
  return DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}

function matchSlot(data, e, slot) {
  const def = data.items[e.item];
  if (def.kind !== 'material') return false;
  if (slot.item) return e.item === slot.item;
  if (slot.family && def.family !== slot.family) return false;
  if (slot.stage && def.stage !== slot.stage) return false;
  return true;
}

export function createHud(root, game, { touch, onAct }) {
  const { data } = game;
  root.innerHTML = `
    <div class="tl">
      <div class="clock" data-k="clock"></div>
      <div class="focus"><span data-k="focusbar"></span><em data-k="focus"></em></div>
      <div class="buffs" data-k="buffs"></div>
      <div class="quest" data-k="quest"></div>
    </div>
    <div class="tr"><canvas class="minimap"></canvas><div class="where" data-k="where"></div></div>
    <div class="feed" data-k="feed"></div>
    <div class="banner" data-k="banner"></div>
    <div class="bottom">
      <div class="progress" data-k="progress"><span></span></div>
      <div class="prompt" data-k="prompt"></div>
      <div class="dock">
        <button data-act="recall" data-k="recall" title="등대로 귀환 (H)">🏠<small>귀환</small></button>
        <button data-act="bag" title="가방 (I)">🎒<small>가방</small></button>
        <button data-act="craft" title="제작 (C)">🔨<small>제작</small></button>
        <button data-act="skills" title="스킬 (K)">📈<small>스킬</small></button>
        <button data-act="log" title="기록 (L)">📜<small>기록</small></button>
        <button data-act="menu" title="설정">⚙️<small>설정</small></button>
      </div>
      ${touch ? '' : '<div class="keys">WASD 이동 · 드래그 시점 · 휠 거리 · E 상호작용 · H 귀환 · I 가방 · C 제작 · K 스킬 · Esc 닫기</div>'}
    </div>
    ${touch ? '<button class="act-btn" data-act="interact" data-k="actbtn">✋</button>' : ''}
    <div class="joy"><div class="knob"></div></div>
    <aside class="panel" hidden><header><h2 data-k="ptitle"></h2><button data-act="close" aria-label="닫기">✕</button></header><div class="pbody" data-k="pbody"></div></aside>
    <div class="toast" data-k="toast"></div>`;

  const $ = (k) => root.querySelector(`[data-k="${k}"]`);
  const el = {
    clock: $('clock'), focus: $('focus'), focusbar: $('focusbar'), buffs: $('buffs'), quest: $('quest'),
    where: $('where'), feed: $('feed'), banner: $('banner'), progress: $('progress'), prompt: $('prompt'),
    actbtn: $('actbtn'), ptitle: $('ptitle'), pbody: $('pbody'), toast: $('toast'), recall: $('recall'),
  };
  const panelEl = root.querySelector('.panel');
  const set = (node, text) => {
    if (node && node._t !== text) {
      node.textContent = text;
      node._t = text;
    }
  };
  const setHtml = (node, html) => {
    if (node && node._h !== html) {
      node.innerHTML = html;
      node._h = html;
    }
  };

  let panel = null; // { kind, station }
  let holding = false;
  let lastPanel = 0;
  const feed = [];
  let toastUntil = 0;
  let bannerUntil = 0;
  const settings = { focus: false, speed: 1, resetArmed: 0 };
  let fps = 0;

  root.addEventListener('pointerdown', () => { holding = true; });
  window.addEventListener('pointerup', () => setTimeout(() => { holding = false; }, 90));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    onAct(b.dataset.act, b.dataset.v, b.dataset.n);
    renderPanel(true);
  });

  // ── 알림 ───────────────────────────────────────────
  function toast(msg, kind = 'warn') {
    set(el.toast, msg);
    el.toast.className = `toast on ${kind}`;
    toastUntil = performance.now() + 2600;
  }
  function banner(msg) {
    set(el.banner, msg);
    el.banner.classList.add('on');
    bannerUntil = performance.now() + 2200;
  }
  function pushFeed(text) {
    feed.unshift({ text, at: performance.now() });
    if (feed.length > 5) feed.pop();
  }

  game.on('*', (ev) => {
    if (ev.actor && ev.actor !== PID) return;
    if (ev.type === 'gather.done') {
      const lot = game.state.lots[ev.lot];
      let s = `+${ev.qty} ${itemName(data, ev.item)}`;
      if (lot && !game.state.veins[lot.vein]?.common) s += ` · ${lot.name}`;
      for (const b of ev.byproducts) s += ` · 덤 ${itemName(data, b.item)}`;
      pushFeed(s);
    } else if (ev.type === 'craft.done') {
      const r = data.recipes[ev.recipe];
      pushFeed(r.type === 'craft'
        ? `${itemName(data, ev.item)} ${stars(ev.star)}${ev.masterwork ? ' ✨걸작' : ''}`
        : `${itemName(data, ev.item)} ×${ev.qty}${ev.to === 'storage' ? ' → 창고' : ''}`);
    } else if (ev.type === 'skill.up') {
      banner(`${data.skills[ev.skill].icon} ${data.skills[ev.skill].name} ${ev.level}레벨`);
    } else if (ev.type === 'vein.opened' && !ev.common && game.state.t > 1) {
      toast(`🗺️ 새 산지 소문: 「${ev.name}」 — 마을 게시판에서 볼 수 있다`, 'info');
    } else if (ev.type === 'tool.broken') {
      toast(`💥 ${itemName(data, ev.item)}가 부서졌다`);
    } else if (ev.type === 'cmd.rejected') {
      if (ev.cmd !== 'MOVE_INPUT') toast(ERR[ev.reason] || ev.reason);
    } else if (ev.type === 'eat') {
      pushFeed(`🍽️ 채집량 +${Math.round(ev.value * 100)}% · ${ev.minutes}분`);
    } else if (ev.type === 'store' && ev.moved) {
      pushFeed(`📦 창고에 ${ev.moved}개`);
    } else if (ev.type === 'recall.done') {
      toast('🏠 등대 마을 창고 앞으로 돌아왔다', 'good');
    }
  });

  // ── 개척 일지(첫 목표) ───────────────────────────────
  function quest(a) {
    const lists = [a.bag, a.storage];
    const c = (id) => countItem(lists, id);
    const m = a.milestones;
    const steps = [
      { done: m.tool_t0 != null || (c('log_drift') >= 2 && c('stone') >= 3), text: `바닷가에서 표류목 ${Math.min(2, c('log_drift'))}/2, 돌 ${Math.min(3, c('stone'))}/3 줍기` },
      { done: m.tool_t0 != null, text: '돌 도구 만들기 — 제작(C) → 맨손 제작' },
      { done: (a.stats.craft.rc_ingot_copper || 0) > 0, text: '구리광석을 캐서 등대 마을 제련로에서 주괴로' },
      { done: m.tool_t1 != null, text: '대장간에서 구리 도구 만들기 (대장 4)' },
      { done: a.stats.eat > 0, text: '조리대에서 음식을 만들어 먹기' },
      { done: Object.values(game.state.veins).some((v) => !v.common && a.storage.concat(a.bag).some((e) => e.lot === v.lot)), text: '게시판의 산지 소문을 따라가 좋은 재료 캐기' },
    ];
    const next = steps.find((s) => !s.done);
    return next ? `📜 ${next.text}` : '';
  }

  // ── 매 프레임 ───────────────────────────────────────
  function update(dt, { target, gathering }) {
    const now = performance.now();
    fps = fps ? fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
    const a = game.state.actors[PID];
    const c = game.clock.describe(game.state.t);
    set(el.clock, `${c.night ? '🌙' : '☀️'} ${c.day}일차 · ${c.night ? '밤' : '낮'} ${c.minutesLeft}분${settings.speed > 1 ? ` · ×${settings.speed}` : ''}`);
    const max = data.config.focus.max;
    el.focusbar.style.width = `${(a.focus / max) * 100}%`;
    set(el.focus, `집중력 ${Math.floor(a.focus)}${settings.focus ? ' · 쓰는 중' : ''}`);
    set(el.buffs, a.buffs.map((b) => `🍽️ +${Math.round(b.value * 100)}% ${Math.ceil((b.endsAt - game.state.t) / 60)}분`).join('  '));
    set(el.quest, quest(a));
    const town = settlementAt({ state: game.state }, a);
    set(el.where, town ? `🏘️ ${town.name}` : '🌫️ 난파 해안');

    // 채집 진행 막대
    if (a.action) {
      const span = Math.max(0.01, a.action.endsAt - a.action.startedAt);
      el.progress.classList.add('on');
      el.progress.firstElementChild.style.width = `${Math.min(100, ((game.state.t - a.action.startedAt) / span) * 100)}%`;
    } else {
      el.progress.classList.remove('on');
    }

    // 귀환 단추
    const cd = Math.max(0, (a.recallReadyAt || 0) - game.state.t);
    el.recall.disabled = cd > 0 || a.action?.type === 'recall';
    setHtml(el.recall, `🏠<small>${cd > 0 ? `${Math.ceil(cd / 60)}분` : '귀환'}</small>`);

    // 상호작용 안내
    let prompt = '';
    let ok = false;
    if (a.ai?.on) prompt = '🤖 봇이 대신 움직이는 중 — 움직이면 돌아온다';
    else if (a.action?.type === 'recall') prompt = '🏠 등대로 귀환하는 중… 움직이면 취소된다';
    else if (target) {
      ok = !target.why && !target.idle;
      const key = touch ? '' : '[E] ';
      prompt = target.idle ? target.label : `${key}${target.verb} · ${target.label}${target.why ? ` — ${target.why}` : ''}`;
      if (gathering && target.kind === 'node') prompt = `${target.label} · 캐는 중 (움직이면 멈춤)`;
    }
    setHtml(el.prompt, prompt ? `<span class="${ok ? 'ok' : 'no'}">${esc(prompt)}</span>` : '');
    if (el.actbtn) {
      el.actbtn.disabled = !target || !ok;
      set(el.actbtn, target ? (target.kind === 'node' ? '⛏️' : '✋') : '✋');
    }

    // 획득 기록
    const fh = feed.filter((f) => now - f.at < 4500).map((f) => `<div style="opacity:${Math.min(1, (4500 - (now - f.at)) / 800)}">${esc(f.text)}</div>`).join('');
    setHtml(el.feed, fh);
    if (now > toastUntil) el.toast.classList.remove('on');
    if (now > bannerUntil) el.banner.classList.remove('on');
    if (panel && now - lastPanel > 400) renderPanel(false);
  }

  // ── 패널 ───────────────────────────────────────────
  function open(kind, opts = {}) {
    panel = { kind, ...opts };
    panelEl.hidden = false;
    renderPanel(true);
  }
  function close() {
    panel = null;
    panelEl.hidden = true;
  }
  function toggle(kind, opts) {
    if (panel && panel.kind === kind && panel.station === opts?.station) close();
    else open(kind, opts);
  }

  function entryRow(e, act) {
    const def = data.items[e.item];
    const st = entryStar(e, game.state, data.config);
    const starHtml = st ? ` <span class="stars">${stars(st)}</span>` : '';
    if (e.uid) {
      const dur = e.maxDur ? ` · 내구 ${e.dur}/${e.maxDur}` : '';
      return `<li><div><b>${def.icon || ''} ${def.name}</b>${starHtml}${e.masterwork ? ' ✨' : ''}${e.broken ? ' <em class="no">부서짐</em>' : ''}<small>${fmtStats(e.stats)}${dur}</small></div>${act || ''}</li>`;
    }
    if (def.kind === 'consumable') {
      return `<li><div><b>${def.icon || ''} ${def.name}</b> ×${e.qty}${starHtml}<small>${fmtStats(e.stats)}</small></div>${act || ''}</li>`;
    }
    const lot = e.lot ? game.state.lots[e.lot] : null;
    const bonus = e.bonus ? ' · ' + Object.entries(e.bonus).map(([k, v]) => `${data.config.propNames[k]} +${v}`).join(', ') : '';
    const detail = lot ? `${esc(lot.name)} · ${fmtProps(effectiveProps(e, game.state.lots), data)}${bonus}` : esc(def.note || '');
    return `<li><div><b>${def.icon || ''} ${def.name}</b> ×${e.qty}${starHtml}<small>${detail}</small></div>${act || ''}</li>`;
  }

  function sortEntries(list) {
    const order = (e) => {
      const def = data.items[e.item];
      return def.tool ? 0 : def.kind === 'consumable' ? 1 : def.kind === 'equipment' ? 2 : def.stage === 'raw' ? 3 : def.stage === 'misc' ? 5 : 4;
    };
    return [...list].sort((x, y) => order(x) - order(y));
  }

  function bagHtml(a) {
    const town = settlementAt({ state: game.state }, a);
    const rows = sortEntries(a.bag).map((e) => {
      const def = data.items[e.item];
      const act = def.kind === 'consumable' ? `<button data-act="eat" data-v="${esc(keyOf(e))}">먹기</button>` : '';
      return entryRow(e, act);
    }).join('') || '<li><small>비어 있다</small></li>';
    let html = `<h3>가방 ${a.bag.length}/${data.config.bag.slots}칸</h3><ul class="list">${rows}</ul>`;
    if (town) {
      const srows = sortEntries(a.storage).map((e) => entryRow(e, `<button data-act="take" data-v="${esc(keyOf(e))}">꺼내기</button>`)).join('') || '<li><small>비어 있다</small></li>';
      html += `<h3>${town.name} 창고 <button class="mini" data-act="store-all">재료 전부 넣기</button></h3><ul class="list">${srows}</ul>
        <p class="muted">마을 작업대에서 만들 때는 창고 재료도 함께 쓴다.</p>`;
    } else {
      html += '<p class="muted">창고는 등대 마을 안에서 열린다.</p>';
    }
    return html;
  }

  function slotLabel(s) {
    return s.item ? itemName(data, s.item) : `${FAMILY[s.family] || s.family}(${STAGE[s.stage] || s.stage})`;
  }

  function craftHtml(a, station) {
    const town = settlementAt({ state: game.state }, a);
    const pools = town ? [a.bag, a.storage] : [a.bag];
    const recipes = data.lists.recipes.filter((r) => r.station === station);
    const queue = a.queue.map((j, i) => {
      const r = data.recipes[j.recipe];
      const span = Math.max(0.01, j.endsAt - j.startsAt);
      const done = Math.max(0, Math.min(1, (game.state.t - j.startsAt) / span));
      return `<li class="q"><span>${i === 0 ? '⏳' : '·'} ${r.name}</span><div class="bar"><span style="width:${done * 100}%"></span></div></li>`;
    }).join('');
    const rows = recipes.map((r) => {
      const sk = data.skills[r.skill];
      const cmd = { type: 'CRAFT', actor: PID, recipe: r.id, auto: 'best', catalyst: 'auto' };
      const pv = game.preview(cmd);
      const mats = r.slots.map((s) => {
        let have = 0;
        for (const list of pools) for (const e of list) if (!e.uid && matchSlot(data, e, s)) have += e.qty;
        return `<span class="${have >= s.qty ? 'ok' : 'no'}">${slotLabel(s)} ${Math.min(have, 999)}/${s.qty}</span>`;
      }).join(' · ');
      let result = '';
      if (pv.ok && pv.stats) result = `예상 <span class="stars">${stars(pv.star)}</span> ${fmtStats(pv.stats)} · 걸작 ${(pv.masterwork * 100).toFixed(1)}%`;
      else if (pv.ok && pv.props) result = `예상 ${fmtProps(pv.props, data)}${pv.step ? ` · 약한 속성 +${pv.step}` : ''}`;
      const why = pv.ok ? '' : `<small class="no">${ERR[pv.error] || pv.error}</small>`;
      return `<li class="rc"><div><b>${sk.icon} ${r.name}</b> <small>${sk.name} ${r.level} · ${r.seconds}초</small>
        <small>${mats}${r.catalyst ? ` · 촉매 ${itemName(data, r.catalyst)}(있으면 사용)` : ''}</small>
        ${result ? `<small class="pv">${result}</small>` : ''}${why}</div>
        <div class="btns"><button data-act="craft-do" data-v="${r.id}" data-n="1" ${pv.ok ? '' : 'disabled'}>만들기</button>
        <button data-act="craft-do" data-v="${r.id}" data-n="5" ${pv.ok ? '' : 'disabled'}>×5</button></div></li>`;
    }).join('');
    const note = station === 'hand'
      ? '<p class="muted">작업대가 필요한 제작은 등대 마을의 각 작업대 앞에서 E로 연다.</p>'
      : '<p class="muted">재료는 ‘최고 품질’부터 자동으로 고른다. 대기열을 걸어 두고 채집하러 가도 된다.</p>';
    return `${queue ? `<h3>대기열 ${a.queue.length}/${data.config.craft.queueMax}</h3><ul class="list">${queue}</ul>` : ''}<ul class="list">${rows}</ul>${note}`;
  }

  function skillsHtml(a) {
    const cap = data.config.skillCap;
    const rows = data.lists.skills.filter((s) => !('opens' in s)).map((s) => {
      const p = xpProgress(a.skills[s.id].xp, data.curve, cap);
      const pct = p.need ? (p.into / p.need) * 100 : 100;
      return `<li class="sk"><span>${s.icon} ${s.name}</span><b>${p.level}</b><div class="bar"><span style="width:${pct}%"></span></div></li>`;
    }).join('');
    const later = data.lists.skills.filter((s) => 'opens' in s).map((s) => `${s.icon}${s.name}${s.opens ? `(${s.opens})` : ''}`).join(' · ');
    return `<ul class="list skills">${rows}</ul><p class="muted">지금 상한 ${cap}. 나중에 열림: ${later}</p>`;
  }

  function logHtml() {
    const fmt = (t) => `${Math.floor(t / 3600) + 1}일 ${Math.floor((t % 3600) / 60)}분`;
    const rows = game.tele.log.slice(-60).reverse()
      .map((ev) => [ev, describeEvent(ev, game)])
      .filter(([, line]) => line)
      .slice(0, 40)
      .map(([ev, line]) => `<li><small>${fmt(ev.t)}</small> ${esc(line)}</li>`).join('');
    return `<ul class="list log">${rows || '<li><small>아직 없다</small></li>'}</ul>`;
  }

  function boardHtml(a) {
    const list = Object.values(game.state.veins).filter((v) => !v.common && v.center)
      .sort((x, y) => avgProps(game.state.lots[y.lot].props) - avgProps(game.state.lots[x.lot].props));
    const rows = list.map((v) => {
      const lot = game.state.lots[v.lot];
      const dx = v.center[0] - a.x;
      const dz = v.center[1] - a.z;
      const d = Math.round(Math.hypot(dx, dz) / 10) * 10;
      return `<li><div><b>${esc(v.name)}</b> <span class="stars">${stars(starOf(avgProps(lot.props), data.config.stars))}</span>
        <small>${fmtProps(lot.props, data)} · ${direction(dx, dz)}쪽 약 ${d}m · ${v.closesOnDay + 1}일차 아침에 사라짐</small></div></li>`;
    }).join('');
    return `<p class="muted">영맥이 옮겨 가면 산지도 바뀐다. 미니맵의 점선 고리가 소문난 자리다.</p><ul class="list">${rows}</ul>`;
  }

  function menuHtml(a) {
    const armed = settings.resetArmed > performance.now();
    const sp = [1, 10, 30].map((s) => `<button data-act="speed" data-v="${s}" class="${settings.speed === s ? 'on' : ''}">×${s}</button>`).join('');
    return `<h3>시험용 시간 배속</h3><div class="row">${sp}</div>
      <h3>도움</h3><div class="row">
        <button data-act="auto" class="${a.ai?.on ? 'on' : ''}">🤖 봇에게 맡기기</button>
        <button data-act="focus-toggle" class="${settings.focus ? 'on' : ''}">채집에 집중력 쓰기</button></div>
      <h3>저장</h3><div class="row"><button data-act="save">💾 지금 저장</button>
        <button data-act="reset" class="${armed ? 'warn' : ''}">${armed ? '한 번 더 누르면 새 섬' : '↺ 새 섬에서 시작'}</button></div>
      <p class="muted">30초마다, 그리고 창을 닫을 때 자동 저장한다. 화면 약 ${Math.round(fps)}fps.</p>
      <h3>조작</h3><p class="muted">${touch ? '왼쪽 엄지로 이동, 오른쪽을 끌어 시점, 두 손가락으로 거리. 손 단추로 상호작용.' : 'WASD 이동 · 마우스 끌기 시점 · 휠 거리 · E 상호작용 · H 귀환 · I 가방 · C 제작 · K 스킬 · L 기록 · Esc 닫기'}</p>
      <div class="row"><a href="patchnotes.html">패치노트</a><a href="debug.html">엔진 점검판</a><span class="muted">v${ENGINE_VERSION}</span></div>`;
  }

  const TITLES = { bag: '🎒 가방', skills: '📈 생활 스킬', log: '📜 기록', board: '📋 산지 소문 게시판', menu: '⚙️ 설정' };

  function renderPanel(force) {
    if (!panel) return;
    if (holding && !force) return;
    lastPanel = performance.now();
    const a = game.state.actors[PID];
    let title = TITLES[panel.kind] || '';
    let html = '';
    if (panel.kind === 'bag') html = bagHtml(a);
    else if (panel.kind === 'craft') {
      const st = data.stations[panel.station];
      title = `${st.icon} ${panel.station === 'hand' ? '맨손 제작' : st.name}`;
      html = craftHtml(a, panel.station);
    } else if (panel.kind === 'skills') html = skillsHtml(a);
    else if (panel.kind === 'log') html = logHtml();
    else if (panel.kind === 'board') html = boardHtml(a);
    else if (panel.kind === 'menu') html = menuHtml(a);
    set(el.ptitle, title);
    setHtml(el.pbody, html);
  }

  return {
    update,
    open,
    close,
    toggle,
    toast,
    settings,
    get panel() { return panel; },
    minimapCanvas: root.querySelector('.minimap'),
    joyEl: root.querySelector('.joy'),
    knobEl: root.querySelector('.joy .knob'),
    qtyOf,
  };
}
