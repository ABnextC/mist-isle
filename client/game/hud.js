// 화면 위 정보(HUD)와 패널. 아이콘·색을 먼저 보이고, 수치는 패널에서 연다.
// 버튼은 data-act로 main.js에 넘긴다. HUD는 상태를 직접 고치지 않는다.

import { ERR, fmtProps, fmtStats, stars, itemName, entryStar, describeEvent, ARMOR_CLASS, loadEffects, josa } from '../../core/text.js';
import { equipLoad } from '../../core/systems/combat.js';
import { masteryOf, mOf, loadoutOf, abilityOf, needXp, spentIn, learnError, resetCost } from '../../core/systems/mastery.js';
import { tradable, refPrice, npcPrice, bestBid, repairCost, entryStar as marketStar, bookOf, ordersOf, baseValue } from '../../core/market.js';
import { countDeliverable } from '../../core/orders.js';
import { xpProgress, starOf } from '../../core/formulas.js';
import { keyOf, effectiveProps, avgProps, countItem, qtyOf } from '../../core/inventory.js';
import { settlementAt, storeOf, standingTier, reachable } from '../../core/world.js';
import { openProjects, projectOpen, needLeft, silverLeft, projectProgress, shipFee, upkeepOf } from '../../core/settlements.js';
import { zoneAt, regionAt } from '../../core/terrain.js';
import { ENGINE_VERSION } from '../../core/state.js';
import { stepText, talkDue, boardOffers, available, TALK_RANGE, takeMet, takeProgress, stepSay, npcOffers, npcShown } from '../../core/systems/quests.js';
import { factionOf, rankOf, tasksOf, taskDone } from '../../core/systems/factions.js';
import { comfortOf, restValue } from '../../core/systems/housing.js';
import { guildLevel, aiRoom, hireable } from '../../core/systems/guilds.js';
import { npcPos } from '../../core/world.js';
import { bondable, bondPts, bondTier, tierName, nextTier, giftDue, giftable, knownLikes, bondLines, B as bondCfg, isBirthday, daysToBirthday, perkOf, inviteDue } from '../../core/systems/bonds.js';
import { allyOf } from '../../core/systems/allies.js';
import { seasonOf, dayOfMonth, isMarketDay } from '../../core/systems/calendar.js';
import { questCtx, lifeSteps } from './quest.js';
import { isUnlocked, allowedProject, chapterReached } from '../../core/systems/unlocks.js';

const PID = 'p1';
const FAMILY = { wood: '나무', metal: '금속', stone: '돌', fiber: '섬유', food: '식재료', herb: '약초' };
const STAGE = { raw: '원자재', refined: '정제품', component: '부품' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
export const BULK_KEEP = 20; // 한꺼번에 팔 때 종류마다 남길 개수

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
    <div class="vig"></div>
    <div class="tl">
      <div class="card">
        <div class="clock" data-k="clock"></div>
        <div class="focus"><span data-k="focusbar"></span><em data-k="focus"></em></div>
        <div class="silver" data-k="silver"></div>
        <div class="buffs" data-k="buffs"></div>
      </div>
      <div class="quest" data-k="quest" data-act="journal" title="일지 (J)"></div>
    </div>
    <div class="bossbar" data-k="boss"><b data-k="bossname"></b><i><span data-k="bossfill"></span></i></div>
    <div class="tr"><canvas class="minimap"></canvas><div class="where" data-k="where"></div></div>
    <button class="menubtn" data-act="hub" title="메뉴 (Esc)" aria-label="메뉴">☰</button>
    <div class="feed" data-k="feed"></div>
    <div class="banner" data-k="banner"></div>
    <div class="bottom">
      <div class="progress" data-k="progress"><span></span></div>
      <div class="prompt" data-k="prompt"></div>
      <div class="vitals" data-k="vitals"><div class="hp"><span data-k="hpbar"></span><em data-k="hp"></em></div><div class="st"><span data-k="stbar"></span></div><div class="mp" data-k="mp"><span data-k="mpbar"></span></div></div>
      <div class="skillbar" data-k="skillbar"></div>
      ${touch ? '' : '<div class="keys">E 상호작용 · 왼쪽 클릭 공격(길게 강공) · 오른쪽·Q 막기 · Space 구르기 · 1·2·3 스킬 · X 무기 바꾸기 · <b>Esc 메뉴</b></div>'}
    </div>
    ${touch ? '<button class="act-btn" data-act="interact" data-k="actbtn">✋</button><div class="cbtns"><button data-hold="attack" title="공격(길게 강공)">⚔️</button><button data-hold="block" title="막기">🛡️</button><button data-tap="dodge" title="구르기">🌀</button></div>' : ''}
    <div class="downed" data-k="downed"></div>
    <div class="hurtfx" data-k="hurtfx"></div>
    <div class="joy"><div class="knob"></div></div>
    <aside class="panel" hidden><header><h2 data-k="ptitle"></h2><button data-act="close" aria-label="닫기">✕</button></header><div class="pbody" data-k="pbody"></div></aside>
    <div class="toast" data-k="toast"></div>`;

  const $ = (k) => root.querySelector(`[data-k="${k}"]`);
  const el = {
    clock: $('clock'), silver: $('silver'), focus: $('focus'),
    vitals: $('vitals'), hp: $('hp'), hpbar: $('hpbar'), stbar: $('stbar'), mp: $('mp'), mpbar: $('mpbar'), downed: $('downed'), hurtfx: $('hurtfx'), focusbar: $('focusbar'), buffs: $('buffs'), quest: $('quest'),
    where: $('where'), feed: $('feed'), banner: $('banner'), progress: $('progress'), prompt: $('prompt'),
    actbtn: $('actbtn'), ptitle: $('ptitle'), pbody: $('pbody'), toast: $('toast'), skillbar: $('skillbar'),
    boss: $('boss'), bossname: $('bossname'), bossfill: $('bossfill'),
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

  let panel = null; // { kind, station, tab }
  const prices = {}; // 거래소에 내놓을 값(묶음 키별)
  let holding = false;
  let lastPanel = 0;
  const feed = [];
  let toastUntil = 0;
  let quietAt = -1;
  let bannerUntil = 0;
  let chapterEndAt = -1;
  const settings = { focus: false, speed: 1, resetArmed: 0, gfx: 'auto', gfxNow: '', talkCam: true, particles: true };
  // 연출 설정(v2.0): 대화 카메라·계절 입자
  try {
    const fx = JSON.parse(localStorage.getItem('mist-isle:fx') || '{}');
    if (fx.talkCam === false) settings.talkCam = false;
    if (fx.particles === false) settings.particles = false;
  } catch { /* 기본값 */ }
  let fps = 0;

  root.addEventListener('pointerdown', () => { holding = true; });
  window.addEventListener('pointerup', () => setTimeout(() => { holding = false; }, 90));
  // 모바일 전투 단추: ⚔️ 짧게 약공·길게 강공, 🛡️ 누르는 동안 막기, 🌀 구르기
  const holdT = {};
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-hold],[data-tap]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.tap) onAct(b.dataset.tap);
    else if (b.dataset.hold === 'block') onAct('block-on');
    else holdT[b.dataset.hold] = performance.now();
    b.classList.add('on');
  });
  const holdEnd = (e) => {
    const b = e.target.closest('[data-hold],[data-tap]');
    if (!b) return;
    b.classList.remove('on');
    if (b.dataset.hold === 'block') onAct('block-off');
    else if (b.dataset.hold === 'attack' && holdT.attack) {
      onAct(performance.now() - holdT.attack >= 320 ? 'heavy' : 'attack');
      holdT.attack = 0;
    }
  };
  root.addEventListener('pointerup', holdEnd);
  root.addEventListener('pointercancel', holdEnd);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    if (b.dataset.act === 'ui-tab') {
      if (panel) panel.tab = b.dataset.v;
    } else if (b.dataset.act === 'nd-sel') {
      // 숙련 칸 고르기: 스킬 줄 칸을 먼저 골랐으면 배운 액티브를 그 칸에 바로 건다
      const n = data.weaponNodes[b.dataset.v];
      if (panel) {
        if (panel.slotPick != null && n?.kind === 'active' && mOf(game.state.actors[PID], n.weapon).nodes.includes(n.id)) {
          onAct('lo-set', `${n.weapon}:${panel.slotPick}:${n.id}`);
          panel.slotPick = null;
        }
        panel.sel = b.dataset.v;
      }
    } else if (b.dataset.act === 'lo-pick') {
      if (panel) panel.slotPick = panel.slotPick === +b.dataset.v ? null : +b.dataset.v;
    } else if (b.dataset.act === 'ui-talk-next') {
      if (panel) panel.after = null;
    } else if (b.dataset.act === 'ui-price') {
      // 내놓을 값 조정: 한 번에 시세의 약 5%씩
      const key = b.dataset.v;
      const cur = Number(b.dataset.cur);
      const step = Math.max(1, Math.round(cur * 0.05));
      prices[key] = Math.max(1, cur + Number(b.dataset.n) * step);
    } else {
      onAct(b.dataset.act, b.dataset.v, b.dataset.n);
    }
    renderPanel(true);
  });

  // ── 알림 ───────────────────────────────────────────
  function toast(msg, kind = 'warn', ms = 2600) {
    set(el.toast, msg);
    el.toast.className = `toast on ${kind}`;
    toastUntil = performance.now() + ms;
  }
  function banner(msg, ms = 2200) {
    set(el.banner, msg);
    el.banner.classList.add('on');
    bannerUntil = performance.now() + ms;
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
    } else if (ev.type === 'mastery.level') {
      const T = data.weapons.types[ev.weapon];
      banner(`${T.icon} ${T.name} 숙련 ${ev.level}레벨 — 점수 +1 (N)`, 2600);
    } else if (ev.type === 'mastery.reset') {
      toast(`↺ ${data.weapons.types[ev.weapon].name} 트리를 비웠다(−${ev.cost}은화)`, 'info');
    } else if (ev.type === 'combat.swap') {
      pushFeed(`⇄ ${ev.item ? data.items[ev.item].name : '맨손'}(으)로 바꿔 들었다`);
    } else if (ev.type === 'world.veinShift') {
      // 떨리는 섬(v0.9): 산지가 한꺼번에 옮겨 간다. 소문 알림은 하나로 묶는다
      quietAt = game.state.t;
      banner('🌋 섬이 떨린다 — 모든 산지가 옮겨 갔다', 4200);
      toast('🗺️ 새 산지 소문이 한꺼번에 돌았다 — 마을 게시판에서 보자', 'info', 5000);
    } else if (ev.type === 'vein.opened' && !ev.common && game.state.t > 1 && game.state.t !== quietAt && unl(game.state.actors[PID], 'rumors')) {
      toast(`🗺️ 새 산지 소문: 「${ev.name}」 — 마을 게시판에서 볼 수 있다`, 'info');
    } else if (ev.type?.startsWith('guild.')) {
      const g = game.state.guilds?.[ev.guild];
      if (ev.type === 'guild.create' && ev.actor === PID) banner(`🤝 조합 「${ev.name}」을 세웠다`, 3600);
      else if (ev.type === 'guild.jobDone' && game.state.actors[PID]?.guild === ev.guild) pushFeed(`🤝 조합 일감 완료: ${data.items[ev.item].name} · 명성 +${ev.fame}`);
      else if (ev.type === 'guild.give' && ev.actor === PID) pushFeed(`🤝 ${data.items[ev.item].name} ${ev.qty} 넣음 · 🪙${ev.silver}`);
      if (g && panel && (panel.kind === 'board' || panel.kind === 'bag')) renderPanel(true);
      else if (ev.type === 'guild.leave' && panel?.kind === 'board') renderPanel(true);
    } else if (ev.type === 'house.buy' && ev.actor === PID) {
      banner('🏠 내 집이 생겼다', 3600);
      if (panel?.kind === 'house') renderPanel(true);
    } else if ((ev.type === 'house.upgrade' || ev.type === 'house.place' || ev.type === 'house.take' || ev.type === 'garden.plant') && ev.actor === PID) {
      if (ev.type === 'house.upgrade') banner(`🏠 ${data.housing.tiers.find((t) => t.id === ev.tier).name}으로 올렸다`, 3600);
      if (panel?.kind === 'house') renderPanel(true);
    } else if (ev.type === 'rest' && ev.actor === PID) {
      pushFeed(`🛏️ 푹 쉬었다 — 숙련 경험 +${Math.round(ev.value * 100)}% (${ev.minutes}분)`);
      if (panel?.kind === 'house') renderPanel(true);
    } else if (ev.type === 'garden.harvest' && ev.actor === PID) {
      pushFeed(`🌱 텃밭: ${data.items[ev.item].name} ${ev.qty}${ev.seed ? ' · 씨앗 하나' : ''}`);
      if (panel?.kind === 'house') renderPanel(true);
    } else if (ev.type === 'faction.join' && ev.actor === PID) {
      const f = data.factions.list.find((x) => x.id === ev.faction);
      banner(`${f.icon} ${f.name}에 들었다`, 3600);
      if (ev.from) pushFeed(`영향력 ${Math.round(ev.lost)}을 두고 떠났다`);
      if (panel?.kind === 'talk') renderPanel(true);
    } else if (ev.type === 'faction.rank' && ev.actor === PID) {
      const f = data.factions.list.find((x) => x.id === ev.faction);
      const perk = f.perks.find((p) => p.rank === ev.rank);
      banner(`${f.icon} ${f.name} · ${data.factions.ranks[ev.rank - 1].name}${perk ? ` — ${perk.text}` : ''}`, 5200);
    } else if (ev.type === 'faction.task' && ev.actor === PID) {
      pushFeed(`🤝 세력 의뢰: ${data.items[ev.item].name} ${ev.qty} 건넴 · 🪙${ev.silver}`);
      if (panel?.kind === 'talk') renderPanel(true);
    } else if (ev.type === 'faction.gain' && ev.actor === PID && ev.why !== 'task') {
      // 활동 영향력은 조용히 쌓는다(등급이 오를 때만 크게 알린다)
    } else if (ev.type === 'chapter.done') {
      chapterEndAt = game.state.t;
    } else if (ev.type === 'unlock' && ev.actor === PID) {
      // 퀘스트 완료(0초) → 장 끝(2.6초부터 4.6초) 다음에 띄운다
      const names = ev.ids.map((id) => `${data.unlocks[id].icon} ${data.unlocks[id].name}`).join(' · ');
      setTimeout(() => {
        banner(`🔓 새로 열림 — ${names}`, 5200);
        pushFeed('🔓 열린 기능은 일지(J) → 생활 안내에 정리돼 있다');
      }, chapterEndAt === game.state.t ? 7400 : 2600);
    } else if (ev.type === 'quest.stepReward' && ev.actor === PID) {
      for (const x of ev.reward.items) pushFeed(`🎁 ${itemName(data, x.item)}${x.qty > 1 ? ` ×${x.qty}` : ''}`);
    } else if (ev.type === 'tool.broken') {
      toast(`💥 ${josa(itemName(data, ev.item), '이', '가')} 부서졌다`);
    } else if (ev.type === 'cmd.rejected') {
      if (ev.cmd !== 'MOVE_INPUT') toast(ERR[ev.reason] || ev.reason);
    } else if (ev.type === 'eat') {
      pushFeed(`🍽️ 채집량 +${Math.round(ev.value * 100)}% · ${ev.minutes}분`);
    } else if (ev.type === 'store' && ev.moved) {
      pushFeed(`📦 창고에 ${ev.moved}개`);
    } else if (ev.type === 'market.trade' && ev.seller === PID) {
      pushFeed(`💰 ${itemName(data, ev.item)} ${ev.qty}개 팔림 · +${ev.qty * ev.price - Math.floor(ev.qty * ev.price * data.config.market.salesTax)}은화`);
    } else if (ev.type === 'market.trade' && ev.buyer === PID) {
      pushFeed(`🛒 ${itemName(data, ev.item)} ${ev.qty}개 → 창고`);
    } else if (ev.type === 'market.npc' && ev.owner === PID) {
      pushFeed(`🪙 상인에게 ${ev.qty}개 · +${ev.qty * ev.price}은화`);
    } else if (ev.type === 'order.delivered' && ev.owner === PID) {
      toast(`📋 주문 납품 ${itemName(data, ev.item)} ${ev.qty}개 · +${ev.pay}은화${ev.done ? ' · 주문 끝' : ''}`, 'good');
    } else if (ev.type === 'recall.done') {
      toast(`🏠 ${game.state.settlements[ev.settlement]?.name ?? '마을'} 창고 앞으로 돌아왔다`, 'good');
    } else if (ev.type === 'ship') {
      pushFeed(`🚚 ${townName(ev.to)}(으)로 ${ev.qty}개 · 운송비 ${ev.fee}`);
    } else if (ev.type === 'home.set') {
      toast(`🏠 귀환 지점을 ${townName(ev.at)}(으)로 정했다`, 'good');
    } else if (ev.type === 'project.contrib' && ev.owner === PID) {
      pushFeed(`🏗️ ${data.projects[ev.project].name} · 명성 +${Math.round(ev.points)}`);
    } else if (ev.type === 'project.done') {
      banner(`🎉 ${townName(ev.at)} 「${data.projects[ev.project].name}」 완성`);
    } else if (ev.type === 'settle.pop') {
      pushFeed(`${ev.pop > ev.from ? '🏘️' : '🏚️'} ${townName(ev.at)} 인구 ${ev.from} → ${ev.pop}`);
    } else if (ev.type === 'station.down') {
      toast(`⚠️ ${townName(ev.at)} ${data.stations[ev.station].name}: 유지비가 밀려 1단계로 일한다`, 'warn');
    } else if (ev.type === 'mob.immune') {
      toast(`🗿 ${josa(data.creatures[ev.species].name, '은', '는')} 아직 그냥 돌덩이다. 칼날이 튕겨 나온다`, 'info');
    } else if (ev.type === 'mob.wake') {
      banner(`⚠️ ${josa(data.creatures[ev.species].name, '이', '가')} 몸을 일으킨다!`);
    } else if (ev.type === 'quest.grant' && ev.mark === 'lantern_mark') {
      setTimeout(() => banner('🔥 등불의 각인 — 가까운 산지가 미니맵에 보인다'), 2600);
    }
  });

  const townName = (sid) => game.state.settlements[sid]?.name ?? sid;

  // ── 매 프레임 ───────────────────────────────────────
  function update(dt, { target, gathering, quest: q = null, questDist = null, boss = null }) {
    const now = performance.now();
    fps = fps ? fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
    const a = game.state.actors[PID];
    const c = game.clock.describe(game.state.t);
    // 계절·장날(v1.8)
    const qc = questCtx(game);
    const sn = seasonOf(qc);
    set(el.clock, `${sn.icon} ${sn.name} ${dayOfMonth(qc)}일${isMarketDay(qc) ? ' · 🏮장날' : ''} · ${c.night ? '🌙 밤' : '☀️ 낮'} ${c.minutesLeft}분${settings.speed > 1 ? ` · ×${settings.speed}` : ''}`);
    if (el.clock.title !== `${c.day}일차`) el.clock.title = `${c.day}일차`;
    const max = data.config.focus.max;
    el.focusbar.style.width = `${(a.focus / max) * 100}%`;
    set(el.focus, `집중력 ${Math.floor(a.focus)}${settings.focus ? ' · 쓰는 중' : ''}`);
    set(el.silver, `🪙 ${Math.floor(a.silver ?? 0).toLocaleString('ko-KR')}`);
    if (a.cb) {
      const C = data.config.combat;
      el.hpbar.style.width = `${(a.cb.hp / a.cb.maxHp) * 100}%`;
      el.stbar.style.width = `${(a.cb.st / C.stamina) * 100}%`;
      // 마나(v1.2): 지팡이를 들었거나 덜 찼을 때만
      const staffIn = a.equip?.weapon && data.items[a.bag.find((x) => x.uid === a.equip.weapon)?.item]?.weapon?.type === 'staff';
      const mpShow = staffIn || (a.cb.mp ?? 100) < (a.cb.maxMp ?? 100) - 0.5;
      el.mp.style.display = mpShow ? '' : 'none';
      if (mpShow) el.mpbar.style.width = `${((a.cb.mp ?? 0) / (a.cb.maxMp || 100)) * 100}%`;
      set(el.hp, `${Math.ceil(a.cb.hp)}`);
      const busy = a.cb.hp < a.cb.maxHp || a.cb.st < C.stamina || Object.values(game.state.mobs).some((m) => m.target === PID && m.mode !== 'dead');
      el.vitals.classList.toggle('dim', !busy);
      el.vitals.classList.toggle('low', a.cb.hp < a.cb.maxHp * 0.3);
      const down = a.cb.downUntil > 0;
      el.downed.classList.toggle('on', down);
      if (down) set(el.downed, `쓰러졌다 — ${Math.max(0, Math.ceil(a.cb.downUntil - game.state.t))}초 뒤 가까운 마을에서 일어난다`);
    }
    const ld = equipLoad({ data, cfg: data.config, state: game.state }, a);
    const ldTag = ld.tier.id === 'medium' ? [] : [`${ld.tier.id === 'light' ? '🪶' : '🏋️'} ${ld.tier.name} ${ld.kg}kg`];
    set(el.buffs, [...ldTag, ...a.buffs.map((b) => `🍽️ 채집량 +${Math.round(b.value * 100)}% · ${Math.ceil((b.endsAt - game.state.t) / 60)}분`)].join('  '));
    // 목표까지 거리: 멀면 5m 단위로(글자가 덜 바뀌게)
    const qd = questDist == null ? '' : questDist < 30 ? ` · ${Math.round(questDist)}m` : ` · ${Math.round(questDist / 5) * 5}m`;
    setHtml(el.quest, q ? `<b>${q.kind === 'main' ? '📜' : '🎯'} ${esc(q.title)}</b><span>${esc(q.text)}${q.goal ? `${qd} ➜ ${esc(q.goal.label)}` : ''}</span>` : '');
    // 부두목·두목 체력 막대(v0.5)
    el.boss.classList.toggle('on', !!boss);
    if (boss) {
      set(el.bossname, `${boss.boss ? '☠️' : '⚔️'} ${boss.name}${boss.phase ? ' — 성났다!' : ''}`);
      el.bossfill.style.width = `${Math.max(0, (boss.hp / boss.max) * 100)}%`;
      el.boss.classList.toggle('boss', boss.boss);
    }
    // 대화창은 NPC에게서 멀어지면 닫는다
    if (panel?.kind === 'talk') {
      const np = npcPos(game, panel.npc);
      if (!np || Math.hypot(np.x - a.x, np.z - a.z) > TALK_RANGE + 2.5) close();
    }
    const town = settlementAt({ state: game.state }, a);
    const reg = regionAt(data.lists.regions, a.x);
    const zone = zoneAt(reg, a.x, a.z);
    set(el.where, town ? `🏘️ ${town.name}${a.home === town.id ? ' 🏠' : ''}` : zone ? `${zone.icon || '🌲'} ${zone.name}` : `🌫️ ${reg.name}`);

    // 채집 진행 막대
    if (a.action) {
      const span = Math.max(0.01, a.action.endsAt - a.action.startedAt);
      el.progress.classList.add('on');
      el.progress.firstElementChild.style.width = `${Math.min(100, ((game.state.t - a.action.startedAt) / span) * 100)}%`;
    } else {
      el.progress.classList.remove('on');
    }

    // 스킬 바(v1.1): 든 무기 · 등에 멘 무기 · 1·2·3 스킬과 남은 대기
    setHtml(el.skillbar, skillbarHtml(a));

    // 상호작용 안내
    let prompt = '';
    let ok = false;
    if (a.ai?.on) prompt = '🤖 봇이 대신 움직이는 중 — 움직이면 돌아온다';
    else if (a.action?.type === 'recall') prompt = `🏠 ${townName(a.home)}(으)로 귀환하는 중… 움직이면 취소된다`;
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
    root.classList.add('panel-open');
    root.dataset.panel = kind;
    root.querySelector('.menubtn')?.classList.toggle('open', kind === 'hub');
    renderPanel(true);
  }
  function close() {
    panel = null;
    panelEl.hidden = true;
    root.classList.remove('panel-open');
    delete root.dataset.panel;
    root.querySelector('.menubtn')?.classList.remove('open');
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
      const kind = def.armor ? `${ARMOR_CLASS[def.armor.class] || ''} · ` : '';
      const kg = def.weight ? ` · ${def.weight}kg` : '';
      const wear = e.maxDur ? `<u style="width:${Math.round((e.dur / e.maxDur) * 100)}%"></u>` : '';
      return `<li class="it${e.broken ? ' broken' : ''}"><i class="ic">${def.icon || '·'}${wear}</i><div><b>${def.name}</b>${starHtml}${e.masterwork ? ' ✨' : ''}${e.broken ? ' <em class="no">부서짐</em>' : ''}<small>${kind}${fmtStats(e.stats)}${dur}${kg}</small></div>${act || ''}</li>`;
    }
    if (def.kind === 'consumable') {
      return `<li class="it"><i class="ic">${def.icon || '·'}<em>${e.qty}</em></i><div><b>${def.name}</b>${starHtml}<small>${fmtStats(e.stats)}</small></div>${act || ''}</li>`;
    }
    const lot = e.lot ? game.state.lots[e.lot] : null;
    const bonus = e.bonus ? ' · ' + Object.entries(e.bonus).map(([k, v]) => `${data.config.propNames[k]} +${v}`).join(', ') : '';
    const detail = lot ? `${esc(lot.name)} · ${fmtProps(effectiveProps(e, game.state.lots), data)}${bonus}` : esc(def.note || '');
    return `<li class="it"><i class="ic">${def.icon || '·'}<em>${e.qty}</em></i><div><b>${def.name}</b>${starHtml}<small>${detail}</small></div>${act || ''}</li>`;
  }

  function sortEntries(list) {
    const order = (e) => {
      const def = data.items[e.item];
      return def.tool ? 0 : def.kind === 'consumable' ? 1 : def.kind === 'equipment' ? 2 : def.stage === 'raw' ? 3 : def.stage === 'misc' ? 5 : 4;
    };
    return [...list].sort((x, y) => order(x) - order(y));
  }

  function skillbarHtml(a) {
    const t = game.state.t;
    const wE = a.equip?.weapon ? a.bag.find((x) => x.uid === a.equip.weapon) : null;
    const bE = a.equip?.weapon2 ? a.bag.find((x) => x.uid === a.equip.weapon2) : null;
    const wDef = wE ? data.items[wE.item] : null;
    const W = wDef ? masteryOf({ data }, wDef.weapon.type) : null;
    const m = W ? mOf(a, W) : null;
    const kb = (k) => (touch ? '' : `<kbd>${k}</kbd>`);
    const swap = `<button class="wsl" data-act="swap" title="무기 바꾸기 (X)"><b>${wDef?.icon || '✊'}</b><i>${bE ? data.items[bE.item].icon : '·'}</i>${kb('X')}</button>`;
    const lo = W ? loadoutOf({ ...a }, W) : [null, null, null];
    const cells = lo.map((id, i) => {
      const n = id ? data.weaponNodes[id] : null;
      if (!n) return `<button class="sk empty" data-act="mastery" title="N 무기 숙련에서 스킬을 걸자">${kb(i + 1)}<span>＋</span></button>`;
      const ab = abilityOf({ data }, a, id);
      const left = Math.max(0, (a.cb?.cds?.[id] || 0) - t);
      const full = ab.cd || 1;
      const pct = left > 0 ? Math.round((left / full) * 20) * 5 : 0;
      const low = (a.cb?.st ?? 0) < (ab.cost || 0) || (a.cb?.mp ?? 0) < (ab.mana || 0);
      return `<button class="sk${left > 0 ? ' cd' : ''}${low ? ' low' : ''}" data-act="skill${i}" title="${esc(n.name)} — ${esc(n.text)}">${kb(i + 1)}<span>${n.icon}</span>${left > 0 ? `<i style="--p:${pct}%"></i><em>${Math.ceil(left)}</em>` : ''}</button>`;
    }).join('');
    const lv = m ? `<small class="mlv" title="${esc(data.weapons.types[W].name)} 숙련">${data.weapons.types[W].icon} ${m.lvl}</small>` : '';
    return `${swap}${cells}${lv}`;
  }

  // ── 전체 메뉴(v1.1, Esc·☰) ──
  function hubHtml(a) {
    const cd = Math.max(0, (a.recallReadyAt || 0) - game.state.t);
    const pts = Object.keys(data.weapons.types).reduce((s, w) => s + Math.max(0, mOf(a, w).lvl - mOf(a, w).nodes.length), 0);
    const tile = (act, icon, name, key, note = '', dis = false) => `<button class="tile" data-act="${act}" ${dis ? 'disabled' : ''}><span>${icon}</span><b>${name}</b>${note ? `<small>${note}</small>` : ''}${!touch && key ? `<kbd>${key}</kbd>` : ''}</button>`;
    return `<div class="tiles">
      ${tile('bag', '🎒', '가방', 'I')}
      ${tile('craft', '🔨', '제작', 'C')}
      ${tile('mastery', '⚔️', '무기 숙련', 'N', pts ? `점수 ${pts}` : '')}
      ${tile('skills', '📈', '생활 스킬', 'K')}
      ${tile('journal', '📖', '일지', 'J')}
      ${tile('log', '📜', '기록', 'L')}
      ${tile('recall', '🏠', '귀환', 'H', cd > 0 ? `${Math.ceil(cd / 60)}분 뒤` : esc(townName(a.home)), cd > 0 || a.action?.type === 'recall')}
      ${tile('menu', '⚙️', '설정', '')}
    </div>
    ${touch ? '' : `<h3>조작</h3><p class="muted keyhelp">WASD 이동 · 마우스 끌기 시점 · 휠 거리 · E 상호작용 · 왼쪽 클릭 공격(길게 강공) · 오른쪽·Q 막기 · Space 구르기 · 1·2·3 무기 스킬 · X 무기 바꾸기 · Esc 창 닫기/메뉴</p>`}
    <div class="row"><a href="patchnotes.html">패치노트</a><span class="muted">v${ENGINE_VERSION}</span></div>`;
  }

  // ── 무기 숙련 창(v1.1) ──
  function masteryHtml(a) {
    const types = Object.keys(data.weapons.types);
    const wE = a.equip?.weapon ? a.bag.find((x) => x.uid === a.equip.weapon) : null;
    const cur = wE ? masteryOf({ data }, data.items[wE.item].weapon.type) : null;
    const W = panel.tab && types.includes(panel.tab) ? panel.tab : cur || types[0];
    const T = data.weapons.types[W];
    const m = mOf(a, W);
    const need = m.lvl >= data.weapons.cap ? 0 : needXp(data.weapons, m.lvl);
    const left = m.lvl - m.nodes.length;
    const tabs = types.map((w) => {
      const mm = mOf(a, w);
      const p = mm.lvl - mm.nodes.length;
      return `<button data-act="ui-tab" data-v="${w}" class="${w === W ? 'on' : ''}">${data.weapons.types[w].icon} ${data.weapons.types[w].name} ${mm.lvl}${p ? ` <em class="dot">${p}</em>` : ''}</button>`;
    }).join('');
    const ctx = { data };
    const lo = loadoutOf({ ...a }, W);
    const slots = lo.map((id, i) => {
      const n = id ? data.weaponNodes[id] : null;
      return `<div class="lslot ${panel.slotPick === i ? 'pick' : ''}" data-act="lo-pick" data-v="${i}"><small>${touch ? `${i + 1}칸` : `${i + 1}키`}</small><b>${n ? `${n.icon} ${esc(n.name)}` : '비어 있음'}</b></div>`;
    }).join('');
    const trees = T.trees.map((tr, ti) => {
      const spent = spentIn(ctx, a, W, ti);
      const cells = [];
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          const n = data.weapons.nodes.find((x) => x.weapon === W && x.tree === ti && x.row === row && x.col === col);
          if (!n) {
            cells.push('<i class="nd none"></i>');
            continue;
          }
          const has = m.nodes.includes(n.id);
          const err = has ? null : learnError(ctx, a, n.id);
          const cls = has ? 'have' : !err ? 'can' : err === 'no_points' && spent >= n.req && (!n.needs || m.nodes.includes(n.needs)) ? 'wait' : 'lock';
          cells.push(`<button class="nd ${n.kind} ${cls} ${panel.sel === n.id ? 'sel' : ''}" data-act="nd-sel" data-v="${n.id}" title="${esc(n.name)}"><span>${n.icon}</span></button>`);
        }
      }
      return `<div class="tree"><h4>${tr.icon} ${esc(tr.name)} <small>${spent}점</small></h4><p class="muted">${esc(tr.desc)}</p><div class="ngrid">${cells.join('')}</div></div>`;
    }).join('');
    let detail = '<p class="muted">칸을 누르면 설명이 나온다. 줄마다 그 갈래에 0·2·4·6·10점을 찍어야 열린다. ⬆️ 강화는 위쪽 스킬을 배워야 열린다.</p>';
    const sel = panel.sel && data.weaponNodes[panel.sel]?.weapon === W ? data.weaponNodes[panel.sel] : null;
    if (sel) {
      const has = m.nodes.includes(sel.id);
      const err = has ? null : learnError(ctx, a, sel.id);
      const KIND = { active: '액티브 스킬', up: '스킬 강화', passive: '패시브', ult: '궁극 패시브' };
      let extra = '';
      if (sel.kind === 'active') {
        const ab = abilityOf(ctx, a, sel.id);
        extra = `<small class="muted">재사용 ${ab.cd}초 · ${ab.mana ? `마나 ${ab.mana}` : `기력 ${ab.cost || 0}`}</small>`;
        if (has) extra += `<div class="row">${[0, 1, 2].map((i) => `<button class="mini ${lo[i] === sel.id ? 'on' : ''}" data-act="lo-set" data-v="${W}:${i}:${sel.id}">${i + 1}${touch ? '칸' : '키'}에 걸기</button>`).join('')}</div>`;
      }
      const why = { no_points: '점수가 없다', locked: sel.needs && !m.nodes.includes(sel.needs) ? `먼저 「${esc(data.weaponNodes[sel.needs].name)}」` : `이 갈래에 ${sel.req}점 필요` }[err] || '';
      detail = `<div class="ndetail"><b>${sel.icon} ${esc(sel.name)}</b> <small class="muted">${KIND[sel.kind]}</small><p>${esc(sel.text)}</p>${extra}
        ${has ? '<p class="ok">✔ 배움</p>' : `<button class="pri" data-act="learn" data-v="${sel.id}" ${err ? 'disabled' : ''}>배우기 (1점)</button> <small class="muted">${why}</small>`}</div>`;
    }
    const cost = resetCost(ctx, a, W);
    return `<div class="row tabs">${tabs}</div>
      <div class="mhead"><div><b>${T.icon} ${esc(T.name)} ${m.lvl}레벨</b>${W === cur ? ' <small class="ok">손에 든 무기</small>' : ''}<small class="muted">${esc(T.desc)}</small></div>
        <div class="mpts"><b>${left}</b><small>남은 점수</small></div></div>
      <div class="bar xp"><span style="width:${need ? Math.min(100, (m.xp / need) * 100) : 100}%"></span></div>
      <small class="muted">${need ? `다음 레벨까지 ${Math.ceil(need - m.xp)} · 이 무기로 피해를 주고 적을 쓰러뜨리면 오른다` : '최고 레벨'}</small>
      <h3>스킬 줄 <small class="muted">${touch ? '전투 단추 옆 1·2·3' : '1·2·3키'} — 배운 스킬을 누르고 칸을 고른다</small></h3>
      <div class="lrow">${slots}</div>
      <div class="trees">${trees}</div>
      ${detail}
      <div class="row"><button class="mini" data-act="m-reset" data-v="${W}" ${m.nodes.length && a.silver >= cost ? '' : 'disabled'}>↺ 다시 찍기 (${cost}은화)</button></div>`;
  }

  const SLOT_NAME = { weapon: '손에 든 무기', weapon2: '등에 멘 무기', head: '머리', chest: '몸통', legs: '다리' };
  function equipHtml(a) {
    const cells = Object.entries(SLOT_NAME).map(([slot, name]) => {
      const e = a.equip?.[slot] ? a.bag.find((x) => x.uid === a.equip[slot]) : null;
      if (!e) return `<div class="eq"><small>${name}</small><b class="muted">비어 있음</b></div>`;
      const def = data.items[e.item];
      const v = def.weapon ? `공격력 ${e.stats.attack}` : `${ARMOR_CLASS[def.armor?.class] || ''} · 방어 ${e.stats.armor}`;
      return `<div class="eq ${e.broken ? 'broken' : ''}"><small>${name} · ${def.weight || 0}kg</small><b>${def.icon || ''} ${def.name}</b><small>${stars(e.star ?? 0)} · ${v} · 내구 ${e.dur}/${e.maxDur}</small></div>`;
    }).join('');
    const armor = ['head', 'chest', 'legs'].reduce((s, k) => { const e = a.equip?.[k] ? a.bag.find((x) => x.uid === a.equip[k]) : null; return s + (e && !e.broken ? e.stats.armor : 0); }, 0);
    const { kg, tier } = equipLoad({ data, cfg: data.config, state: game.state }, a);
    const tiers = data.config.load.tiers;
    const top = tiers[tiers.length - 2].max * 1.25;
    const marks = tiers.slice(0, -1).map((t) => `<i style="left:${(t.max / top) * 100}%"></i>`).join('');
    const base = data.config.combat.dodgeDist;
    return `<h3>장비 <small class="muted">방어 합 ${armor.toFixed(1)} · 무게 ${kg}kg</small></h3>
      <div class="load ${tier.id}"><div class="lbar"><span style="width:${Math.min(100, (kg / top) * 100)}%"></span>${marks}</div>
      <small><b>${tier.name}</b> — ${loadEffects(tier, base)}</small>
      <small class="muted">${tiers.slice(0, -1).map((t) => `${t.name} ~${t.max}kg`).join(' · ')} · 넘으면 ${tiers[tiers.length - 1].name}</small></div>
      <div class="eqgrid">${cells}</div>`;
  }

  function bagHtml(a) {
    const town = settlementAt({ state: game.state }, a);
    const rows = sortEntries(a.bag).map((e) => {
      const def = data.items[e.item];
      let act = def.kind === 'consumable' ? `<button data-act="eat" data-v="${esc(keyOf(e))}">먹기</button>` : '';
      if (def.armor) {
        const on = Object.values(a.equip || {}).includes(e.uid);
        act = `<button data-act="equip" data-v="${e.uid}" class="${on ? 'on' : ''}">${on ? '벗기' : '끼기'}</button>`;
      } else if (def.weapon) {
        // 무기 둘(v1.1): 손에 들기 / 등에 메기
        const inHand = a.equip?.weapon === e.uid;
        const onBack = a.equip?.weapon2 === e.uid;
        act = `<div class="btns"><button data-act="equip" data-v="${e.uid}" class="${inHand ? 'on' : ''}">${inHand ? '내려놓기' : '손에 들기'}</button>`
          + `<button class="mini ${onBack ? 'on' : ''}" data-act="${onBack ? 'unequip2' : 'equip-alt'}" data-v="${e.uid}">${onBack ? '등에서 풀기' : '등에 메기'}</button></div>`;
      }
      return entryRow(e, act);
    }).join('') || '<li><small>비어 있다</small></li>';
    let html = `${equipHtml(a)}<h3>가방 ${a.bag.length}/${data.config.bag.slots}칸</h3><ul class="list">${rows}</ul>`;
    const ctx = mctx();
    const isle = regionAt(data.lists.regions, a.x).id;
    const others = Object.values(game.state.settlements).filter((s) => s.region === isle && (!town || s.id !== town.id));
    if (town) {
      const store = storeOf(a, town.id);
      const shipOpen = unl(a, 'transport');
      const to = shipOpen ? others[0] : null;
      const srows = sortEntries(store).map((e) => {
        const fee = to ? shipFee(ctx, a, town.id, [{ item: e.item, star: marketStar(ctx, e), uid: e.uid, qty: qtyOf(e) }]) : 0;
        const ship = to ? `<button class="mini" data-act="ship" data-v="${to.id}>${esc(keyOf(e))}" ${a.silver >= fee ? '' : 'disabled'} title="${esc(to.name)} 창고로 보낸다">🚚 ${fee}</button>` : '';
        return entryRow(e, `<button data-act="take" data-v="${esc(keyOf(e))}">꺼내기</button>${ship}`);
      }).join('') || '<li><small>비어 있다</small></li>';
      const mats = store.filter((e) => !e.uid && data.items[e.item].kind === 'material');
      const allFee = to && mats.length ? shipFee(ctx, a, town.id, mats.map((e) => ({ item: e.item, star: marketStar(ctx, e), qty: e.qty }))) : 0;
      html += `<h3>${town.name} 창고 <button class="mini" data-act="store-all">재료 전부 넣기</button>${to && mats.length ? ` <button class="mini" data-act="ship-all" data-v="${to.id}" ${a.silver >= allFee ? '' : 'disabled'}>재료 모두 ${esc(to.name)}로 🚚 ${allFee}</button>` : ''}</h3><ul class="list">${srows}</ul>
        <p class="muted">창고는 마을마다 따로다. 작업대에서 만들 때는 그 마을 창고 재료를 함께 쓴다. ${shipOpen ? `🚚는 다른 마을 창고로 바로 보내기(운송비 ${Math.round(standingTier(ctx, a, town.id).ship * 100 * 10) / 10}%, 은화는 사라진다).` : `다른 마을로는 직접 짊어지고 간다. 🔒 ${esc(data.unlocks.transport.name)} — ${esc(data.unlocks.transport.hint)}.`}</p>
        ${a.home === town.id ? `<p class="muted">🏠 여기가 귀환 지점이다.</p>` : `<div class="row"><button data-act="set-home">🏠 ${town.name}을(를) 귀환 지점으로</button></div>`}`;
      // 조합 창고(v0.8.1): 어느 마을 창고 앞에서든 같이 쓴다
      const gd = game.state.guilds?.[a.guild];
      if (gd) {
        const cap = data.guilds.levels[Math.max(0, guildLevel(ctx, gd) - 1)].store;
        const grows = sortEntries(gd.store).map((e) => entryRow(e, `<button data-act="guild-take" data-v="${esc(keyOf(e))}">꺼내기</button>`)).join('') || '<li><small>비어 있다</small></li>';
        const puts = sortEntries(a.bag).filter((e) => !Object.values(a.equip || {}).includes(e.uid)).map((e) => `<button class="mini" data-act="guild-put" data-v="${esc(keyOf(e))}">${data.items[e.item].icon} ${esc(data.items[e.item].name)}</button>`).join(' ');
        html += `<h3>🤝 ${esc(gd.name)} 조합 창고 ${gd.store.length}/${cap}칸</h3><ul class="list">${grows}</ul><p class="muted">가방에서 넣기: ${puts || '없음'}</p>`;
      }
    } else {
      html += '<p class="muted">창고는 마을 안에서 열린다.</p>';
    }
    const far = others.map((s) => {
      const st = storeOf(a, s.id);
      const n = st.reduce((x, e) => x + qtyOf(e), 0);
      return n ? `${s.name} 창고 ${st.length}묶음 ${n}개` : '';
    }).filter(Boolean);
    if (far.length) html += `<p class="muted">📦 ${far.join(' · ')} — 그 마을에 가야 꺼낼 수 있다.</p>`;
    return html;
  }

  function slotLabel(s) {
    return s.item ? itemName(data, s.item) : `${FAMILY[s.family] || s.family}(${STAGE[s.stage] || s.stage})`;
  }

  function craftHtml(a, station) {
    const town = settlementAt({ state: game.state }, a);
    const pools = town ? [a.bag, storeOf(a, town.id)] : [a.bag];
    // 세력 전용 레시피(v0.7)는 내 세력 것만 보인다
    const recipes = data.lists.recipes.filter((r) => r.station === station && (!r.faction || r.faction === factionOf(a)));
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
      const outIcon = data.items[r.output?.item]?.icon || sk.icon;
      return `<li class="rc it${pv.ok ? ' can' : ''}"><i class="ic">${outIcon}${r.output?.qty > 1 ? `<em>${r.output.qty}</em>` : ''}</i><div><b>${r.name}</b> <small>${sk.icon} ${sk.name} ${r.level} · ${r.seconds}초</small>
        <small>${mats}${r.catalyst ? ` · 촉매 ${itemName(data, r.catalyst)}(있으면 사용)` : ''}</small>
        ${result ? `<small class="pv">${result}</small>` : ''}${why}</div>
        <div class="btns"><button class="pri" data-act="craft-do" data-v="${r.id}" data-n="1" ${pv.ok ? '' : 'disabled'}>만들기</button>
        <button data-act="craft-do" data-v="${r.id}" data-n="5" ${pv.ok ? '' : 'disabled'}>×5</button></div></li>`;
    }).join('');
    // 수리(v0.2.1): 대장간에서만
    let repair = '';
    if (station === 'forge') {
      const tools = pools.flat().filter((e) => e.uid && data.items[e.item].tool && e.maxDur != null && (e.broken || e.dur < e.maxDur));
      const rr = tools.map((e) => {
        const def = data.items[e.item];
        const cost = repairCost({ data, cfg: data.config }, e, a);
        return `<li><div><b>${def.icon || ''} ${def.name}</b> <span class="stars">${stars(e.star ?? 0)}</span>
          <small>${e.broken ? '<em class="no">부서짐</em>' : `내구 ${e.dur}/${e.maxDur}`}${e.repairs ? ` · ${e.repairs}번 고침` : ''} · 고치면 최대 내구 ${Math.max(1, Math.round(e.maxDur * (1 - data.config.repair.maxLoss)))}</small></div>
          <button data-act="repair" data-v="${e.uid}" ${a.silver >= cost ? '' : 'disabled'}>수리 ${cost}은화</button></li>`;
      }).join('');
      if (rr) repair = `<h3>수리</h3><ul class="list">${rr}</ul><p class="muted">고칠 때마다 최대 내구가 ${data.config.repair.maxLoss * 100}%씩 준다. 고친 도구는 주문에 낼 수 없다.</p>`;
    }
    const live = town?.stations.find((x) => x.type === station);
    const tierNote = live ? `<p class="muted">${town.name} ${data.stations[station].name} ${live.tier}단계${(live.base ?? live.tier) > live.tier ? ' — 유지비가 밀려 1단계로 일한다' : ''}. 철·참나무를 다루는 제작은 2단계 작업대가 있어야 한다.</p>` : '';
    const note = station === 'hand'
      ? '<p class="muted">작업대가 필요한 제작은 마을의 각 작업대 앞에서 E로 연다.</p>'
      : `${tierNote}<p class="muted">재료는 ‘최고 품질’부터 자동으로 고른다. 대기열을 걸어 두고 채집하러 가도 된다.</p>`;
    return `${queue ? `<h3>대기열 ${a.queue.length}/${data.config.craft.queueMax}</h3><ul class="list">${queue}</ul>` : ''}${repair}<ul class="list">${rows}</ul>${note}`;
  }

  function skillsHtml(a) {
    const cap = data.config.skillCap;
    const rows = data.lists.skills.filter((s) => !('opens' in s)).map((s) => {
      const p = xpProgress(a.skills[s.id].xp, data.curve, cap);
      const pct = p.need ? (p.into / p.need) * 100 : 100;
      return `<li class="sk"><span><i class="ic sm">${s.icon}</i>${s.name}</span><b>${p.level}<small>${p.need ? `${Math.floor(p.into)}/${p.need}` : '최고'}</small></b><div class="bar"><span style="width:${pct}%"></span></div></li>`;
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

  const mctx = () => ({ state: game.state, data, cfg: data.config, clock: game.clock });
  // 해금(v0.5.2): 잠긴 기능 자리에 띄우는 안내
  const unl = (a, id) => isUnlocked(questCtx(game), a, id);
  const lockCard = (id) => {
    const u = data.unlocks[id];
    return `<div class="lockcard"><b>🔒 ${esc(u.name)}</b><small>${esc(u.desc)}</small><small class="muted">${esc(u.hint)}. 등대섬에서는 기본 생활과 전투부터 익힌다.</small></div>`;
  };

  function tabsHtml(list, cur) {
    return `<div class="row tabs">${list.map(([k, l]) => `<button data-act="ui-tab" data-v="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }

  function ordersHtml(a) {
    if (!unl(a, 'orders')) return lockCard('orders');
    const ctx = mctx();
    const town = settlementAt({ state: game.state }, a);
    const day = game.clock.day(game.state.t);
    const lists = town ? [a.bag, storeOf(a, town.id)] : [a.bag];
    const here = (o) => !town || (o.at || Object.keys(game.state.settlements)[0]) === town.id;
    const elsewhere = game.state.orders.filter((o) => o.left > 0 && !here(o));
    const rows = game.state.orders.filter((o) => o.left > 0 && here(o)).map((o) => {
      const def = data.items[o.item];
      const have = countDeliverable(ctx, lists, o);
      const cond = [o.minStar ? `★${o.minStar} 이상` : '', def.tool ? '내구도 95% 이상' : ''].filter(Boolean).join(' · ');
      const fresh = day - o.postedDay < data.config.orders.agentDelayDays ? ' · 오늘 붙음' : '';
      return `<li><div><b>${def.icon || ''} ${def.name}</b> ×${o.left}<small>개당 <b class="ok">${o.reward}은화</b>${cond ? ` · ${cond}` : ''} · ${o.expiresDay + 1}일차 아침까지${fresh}</small>
        <small class="${have ? 'ok' : ''}">${have ? `넘길 수 있는 것 ${Math.min(have, o.left)}개 → ${Math.min(have, o.left) * o.reward}은화` : '조건에 맞는 물건이 없다'}</small></div>
        <button data-act="ord-deliver" data-v="${o.id}" ${have && town ? '' : 'disabled'}>넘기기</button></li>`;
    }).join('');
    const other = elsewhere.length ? `<p class="muted">다른 마을 게시판: ${[...new Set(elsewhere.map((o) => townName(o.at)))].map((n) => `${n} ${elsewhere.filter((o) => townName(o.at) === n).map((o) => itemName(data, o.item)).join('·')}`).join(' / ')}</p>` : '';
    return `<ul class="list">${rows || '<li><small>지금 붙은 주문이 없다. 아침마다 새로 붙는다.</small></li>'}</ul>${other}
      <p class="muted">이 마을 창고와 가방에서 조건에 맞는 것부터 넘긴다(별이 낮은 것부터). AI 개척민은 하루 지난 주문부터 남은 양의 절반까지 채운다.</p>`;
  }

  function veinsHtml(a) {
    if (!unl(a, 'rumors')) return lockCard('rumors');
    const isle = regionAt(data.lists.regions, a.x).id;
    const list = Object.values(game.state.veins).filter((v) => !v.common && v.center && v.region === isle)
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

  // 마을(v0.4): 인구·번영도·작업대·마을 사업·내 명성
  function townHtml(a) {
    const ctx = mctx();
    const town = settlementAt({ state: game.state }, a) || game.state.settlements[a.home];
    const inTown = !!settlementAt({ state: game.state }, a);
    const sdef = data.settlements[town.id];
    const tier = standingTier(ctx, a, town.id);
    const pts = Math.round(a.standing?.[town.id] || 0);
    const next = data.config.settle.standing.find((t) => t.min > pts);
    const d = town.demand;
    const head = `<div class="town">
      <div><b>${esc(town.name)}</b> · 인구 <b>${town.pop}</b>/${town.cap} · ${d.fill == null ? '수요 집계는 내일 아침부터' : `어제 수요 ${Math.round(d.fill * 100)}% 채움`}</div>
      <div class="bar wide"><span style="width:${Math.round(town.prosperity)}%"></span></div>
      <small class="muted">번영 ${Math.round(town.prosperity)} — ${data.config.settle.prosper.grow} 넘으면 인구가 늘고, ${data.config.settle.prosper.shrink} 밑이면 준다. 수요를 채울수록(거래소에 팔수록) 오른다.</small>
      <div>내 명성 <b>${pts.toLocaleString('ko-KR')}</b> · ${tier.name} (판매세 ${Math.round(tier.tax * 1000) / 10}% · 수수료 ${Math.round(tier.fee * 1000) / 10}% · 운송비 ${Math.round(tier.ship * 1000) / 10}%)${next ? ` · ${next.name}까지 ${(next.min - pts).toLocaleString('ko-KR')}` : ''}</div>
    </div>`;
    const stations = town.stations.filter((st) => st.type !== 'storage').map((st) => {
      const up = upkeepOf(ctx, town.id, st.type);
      const late = (st.base ?? st.tier) > st.tier;
      const upk = (st.base ?? st.tier) >= 2 && Object.keys(up).length ? ` · 하루 유지비 ${Object.entries(up).map(([it, q]) => `${itemName(data, it)} ${q}`).join('·')}` : '';
      return `<span class="chip ${st.tier >= 2 ? 'ok' : ''}${late ? ' no' : ''}">${data.stations[st.type].icon} ${data.stations[st.type].name} ${st.tier}단계${late ? '(정비 불량)' : ''}${upk}</span>`;
    }).join(' ');
    const lists = inTown ? [a.bag, storeOf(a, town.id)] : [a.bag];
    const pjOpen = unl(a, 'projects');
    const projects = data.lists.projects.filter((p) => p.at === town.id && (pjOpen || allowedProject(questCtx(game), a, p.id)));
    const pjLock = pjOpen ? '' : `<p class="muted">🔒 ${esc(data.unlocks.projects.name)} — ${esc(data.unlocks.projects.hint)}. 지금은 이야기에서 맡은 사업만 거들 수 있다.</p>`;
    const rows = projects.map((def) => {
      const p = game.state.projects[def.id];
      if (!p) return '';
      const open = projectOpen(ctx, def.id);
      const pct = Math.round(projectProgress(ctx, def.id) * 100);
      const eff = def.effect.build ? `${data.stations[def.effect.build].name} ${def.effect.tier}단계를 짓는다`
        : def.effect.upgrade ? `${data.stations[def.effect.upgrade].name}을(를) ${def.effect.tier}단계로` : `인구 상한 +${def.effect.cap}`;
      if (p.done) return `<li class="done"><div><b>✅ ${esc(def.name)}</b> <small>${eff} · ${p.doneDay + 1}일차에 끝남</small></div></li>`;
      if (!open) {
        const need = (def.after || []).filter((id) => !game.state.projects[id]?.done).map((id) => data.projects[id].name).join(', ');
        return `<li class="locked"><div><b>🔒 ${esc(def.name)}</b> <small>${eff} · 먼저: ${esc(need)}</small></div></li>`;
      }
      const needs = Object.entries(def.needs).map(([item, q]) => {
        const got = Math.min(q, p.got[item] || 0);
        const left = needLeft(ctx, def.id, item);
        const mine = lists.flat().filter((e) => !e.uid && e.item === item).sort((x, y) => marketStar(ctx, x) - marketStar(ctx, y));
        const have = mine.reduce((x, e) => x + e.qty, 0);
        const btn = left > 0 && have > 0 && inTown ? `<button class="mini" data-act="contrib" data-v="${def.id}>${esc(keyOf(mine[0]))}">내기 ${Math.min(left, mine[0].qty)}</button>` : '';
        return `<div class="need ${left <= 0 ? 'ok' : ''}"><span>${itemName(data, item)} ${got}/${q}${left > 0 && have ? ` <small>(가진 것 ${have})</small>` : ''}</span>${btn}</div>`;
      }).join('');
      const sLeft = silverLeft(ctx, def.id);
      const sBtns = sLeft > 0 && inTown ? [100, 500].filter((v) => v < sLeft).map((v) => `<button class="mini" data-act="contrib-silver" data-v="${def.id}" data-n="${v}" ${a.silver >= v ? '' : 'disabled'}>${v}</button>`).join('')
        + `<button class="mini" data-act="contrib-silver" data-v="${def.id}" data-n="${Math.min(sLeft, Math.floor(a.silver))}" ${a.silver >= 1 ? '' : 'disabled'}>${a.silver >= sLeft ? `남은 ${sLeft} 다` : `가진 ${Math.floor(a.silver)} 다`}</button>` : '';
      return `<li class="pj"><div><b>🏗️ ${esc(def.name)}</b> <small>${eff} · ${esc(def.desc)}</small>
        <div class="bar wide"><span style="width:${pct}%"></span></div>
        ${needs}<div class="need ${sLeft <= 0 ? 'ok' : ''}"><span>🪙 은화 ${Math.min(def.silver, p.silver).toLocaleString('ko-KR')}/${def.silver.toLocaleString('ko-KR')}</span><span class="btns">${sBtns}</span></div></div></li>`;
    }).join('');
    const away = inTown ? '' : `<p class="muted">마을 밖이다. 사업에 내려면 ${esc(town.name)}에 가야 한다.</p>`;
    const home = inTown && a.home !== town.id ? '<div class="row"><button data-act="set-home">🏠 여기를 귀환 지점으로</button></div>' : '';
    return `${head}<div class="chips">${stations}</div>${away}<h3>마을 사업</h3>${pjLock}<ul class="list">${rows}</ul>
      <p class="muted">물자와 은화가 다 모이면 바로 효과가 난다. 낸 것은 돌아오지 않는다. 낸 값(물자는 ★2 기본값)만큼 이 마을 명성이 쌓여 판매세·수수료·운송비가 준다. AI 개척민도 날마다 조금씩 낸다.</p>${home}
      <p class="muted">${esc(sdef?.name || '')}</p>`;
  }

  function boardHtml(a) {
    const tab = panel.tab || (unl(a, 'orders') ? 'orders' : 'bounty');
    const body = tab === 'orders' ? ordersHtml(a) : tab === 'bounty' ? bountyHtml(a) : tab === 'town' ? townHtml(a) : tab === 'guild' ? guildHtml(a) : veinsHtml(a);
    const n = boardOffers(questCtx(game), a).length;
    const lk = (id, label) => (unl(a, id) ? label : `🔒${label}`);
    return tabsHtml([['orders', lk('orders', '주문')], ['bounty', `현상금${n ? ` ${n}` : ''}`], ['town', '마을'], ['veins', lk('rumors', '산지 소문')], ['guild', lk('guild', '조합')]], tab) + body;
  }

  // 조합(v0.8.1)
  function guildHtml(a) {
    if (!unl(a, 'guild')) return lockCard('guild');
    const ctx = questCtx(game);
    const GD = data.guilds;
    const all = Object.values(game.state.guilds || {});
    const g = game.state.guilds?.[a.guild];
    if (!g) {
      const rows = all.map((x) => `<li><span>🤝 ${esc(x.name)} · ${esc(GD.levels[guildLevel(ctx, x) - 1].name)} · 사람 ${x.members.length}${x.agents.length ? ` + AI ${x.agents.length}` : ''}</span><button data-act="guild-join" data-v="${x.id}">들기</button></li>`).join('');
      return `<p>조합은 함께 큰 일감을 채우고 창고를 같이 쓰는 모임이다. 사람이 넷보다 적으면 빈자리를 AI 개척민으로 채울 수 있다.</p>`
        + `<h3>조합 세우기 (🪙${GD.create.silver})</h3><div class="row"><input id="guild-name" maxlength="14" placeholder="조합 이름"> <button data-act="guild-create">세우기</button></div>`
        + `<h3>들 수 있는 조합</h3><ul class="list">${rows || '<li class="muted">아직 조합이 없다</li>'}</ul>`;
    }
    const lv = guildLevel(ctx, g);
    const next = GD.levels[lv];
    const people = g.members.map((id) => esc(game.state.actors[id]?.name || id)).join(', ');
    const agents = g.agents.map((id) => {
      const ag = game.state.econ.agents.find((x) => x.id === id);
      return `<li><span>🤖 ${esc(ag?.name || id)} · ${esc(data.items[ag?.item]?.name || data.recipes[ag?.recipe]?.name || ag?.role || '')}</span><button data-act="guild-dismiss" data-v="${id}">내보내기</button></li>`;
    }).join('');
    const room = aiRoom(ctx, g) - g.agents.length;
    const hire = room > 0 ? hireable(ctx, g).slice(0, 8).map((x) => `<li><span>${esc(x.name)} · ${esc(data.items[x.item]?.name || data.recipes[x.recipe]?.name || x.role)}</span><button data-act="guild-hire" data-v="${x.id}">들이기</button></li>`).join('') : '';
    const lists = [a.bag, ...(settlementAt({ state: game.state }, a) ? [storeOf(a, settlementAt({ state: game.state }, a).id)] : [])];
    const jobs = g.jobs.map((j) => {
      const mine = countItem(lists, j.item);
      return `<li><span>${esc(data.items[j.item].name)} ${j.got}/${j.qty}${j.ai ? ` (AI ${j.ai})` : ''} · 개당 🪙${j.pay} · 명성 ${j.fame}</span>${j.done ? '✅' : `<button data-act="guild-give" data-v="${j.id}"${mine ? '' : ' disabled'}>넣기 ${Math.min(mine, j.qty - j.got)}</button>`}</li>`;
    }).join('');
    const perks = GD.perks.map((p) => `<li>${p.level <= lv ? '✅' : '▫️'} <b>${esc(GD.levels[p.level - 1].name)}</b> ${esc(p.text)}</li>`).join('');
    return `<div class="qtag">🤝 ${esc(g.name)} · ${esc(GD.levels[lv - 1].name)}</div><p>명성 ${g.fame}${next ? ` / ${next.at} (다음: ${esc(next.name)})` : ''} · 창고 ${g.store.length}/${GD.levels[lv - 1].store}칸(마을 창고 앞에서)</p>`
      + `<h3>오늘의 조합 일감</h3><ul class="list">${jobs}</ul><p class="muted">넣은 만큼 은화를 받고, 다 채우면 조합 명성이 오른다. AI 조합원은 매시간 조금씩 보탠다.</p>`
      + `<h3>조합원</h3><p>${people}</p><ul class="list">${agents}</ul>${room > 0 ? `<p class="muted">AI 빈자리 ${room} — 사람이 넷보다 적을 때만 채운다.</p><ul class="list">${hire}</ul>` : ''}`
      + `<h3>명성 혜택(조합원 모두)</h3><ul class="list">${perks}</ul><div class="btns"><button data-act="guild-leave">조합에서 나가기</button></div>`;
  }

  // ── 퀘스트(v0.5): 대화·일지·현상금 ─────────────────
  const itemLabel = (id) => `${data.items[id].icon || ''} ${data.items[id].name}`;
  function rewardText(r = {}) {
    const out = [];
    if (r.silver) out.push(`🪙 ${r.silver}`);
    for (const it of r.items || []) out.push(`${itemLabel(it.item)}${(it.qty || 1) > 1 ? ` ×${it.qty}` : ''}`);
    return out.join(' · ') || '없음';
  }
  function rewardHtml(r = {}) {
    const rows = [];
    if (r.silver) rows.push(`<li>🪙 은화 ${r.silver}</li>`);
    for (const it of r.items || []) rows.push(`<li>${itemLabel(it.item)} ×${it.qty}</li>`);
    for (const it of r.stored || []) rows.push(`<li>${itemLabel(it.item)} ×${it.qty} <small class="muted">가방이 차서 귀환 지점 창고로</small></li>`);
    return rows.length ? `<ul class="reward">${rows.join('')}</ul>` : '';
  }
  function questItemsHtml(a) {
    const list = Object.entries(a.quests?.items || {});
    if (!list.length) return '';
    return `<div class="qitems">${list.map(([k, n]) => `<span>${data.questItems[k]?.icon || '📦'} ${esc(data.questItems[k]?.name || k)}${n > 1 ? ` ×${n}` : ''}</span>`).join('')}</div>`;
  }
  function activeQuestHtml(a, id) {
    const ctx = questCtx(game);
    const q = data.quests[id];
    const p = a.quests.active[id];
    const steps = q.steps.map((st, i) => (i < p.step ? `<li class="done">✔ ${esc(st.text)}</li>` : i === p.step ? `<li class="now">▶ ${esc(stepText(ctx, a, id))}</li>` : '')).join('');
    const track = a.quests.track === id ? ' <small class="tracking">📍 따라가는 중</small>' : ` <button class="mini" data-act="quest-track" data-v="${id}">따라가기</button>`;
    return `<li class="qactive"><b>${esc(q.name)}</b>${track}<p class="muted">${esc(q.summary)}</p><ul class="steps">${steps}</ul><small>보상: ${rewardText(q.reward)}</small></li>`;
  }
  function bountyHtml(a) {
    const ctx = questCtx(game);
    const Q = a.quests || { active: {}, daily: {} };
    const day = game.clock.day(game.state.t);
    const active = Object.keys(Q.active).filter((id) => data.quests[id].kind === 'bounty');
    let html = '<p class="muted">현상금은 게임 하루에 한 번 받을 수 있다. 다 채우면 그 자리에서 은화가 들어온다.</p>';
    if (active.length) html += `<h3>하는 중</h3><ul class="qlist">${active.map((id) => activeQuestHtml(a, id)).join('')}</ul>`;
    const offers = boardOffers(ctx, a);
    html += '<h3>받을 수 있는 현상금</h3>';
    html += offers.length
      ? `<ul class="list">${offers.map((q) => `<li><div><b>🎯 ${esc(q.name)}</b><small>${esc(q.summary)} · ${q.steps.map((st) => `${esc(st.text)} ${st.count || ''}`).join(', ')} · 🪙 ${q.reward?.silver || 0}</small></div><button data-act="quest-accept" data-v="${q.id}">받기</button></li>`).join('')}</ul>`
      : '<p class="muted">지금 받을 수 있는 현상금이 없다. 메인 퀘스트를 따라가면 늘어난다.</p>';
    const today = data.lists.quests.filter((q) => q.kind === 'bounty' && Q.daily?.[q.id] === day);
    if (today.length) html += `<p class="muted">오늘 끝낸 현상금: ${today.map((q) => esc(q.name)).join(', ')}</p>`;
    return html;
  }
  // 말 바뀌기(v1.5): 끝낸 의뢰가 있으면 그 뒤의 말을 한다(가장 나중 것)
  function chatLines(npc, a) {
    let lines = npc.chat;
    for (const c of npc.chatAfter || []) if (a.quests?.done?.[c.quest] != null) lines = c.lines;
    // 정이 든 뒤의 말(v1.6)이 있으면 그 말을 먼저
    const bl = bondLines(questCtx(game), a, npc.id);
    return bl ? [...bl, ...bl, ...lines] : lines;
  }
  // 초상화(v2.0): main이 NPC 얼굴을 찍어 넣어 준다
  const portraits = new Map();
  const npcHead = (npc) => {
    const url = portraits.get(npc.id);
    return `<div class="npchead">${url ? `<img class="portrait" src="${url}" alt="">` : '<span class="portrait"></span>'}<div class="who"><b>${esc(npc.name)}</b><small>${esc(npc.title)}</small></div></div>`;
  };
  // 호감도(v1.6)
  const hearts = (t) => '♥'.repeat(t) + '♡'.repeat(Math.max(0, 4 - t));
  function bondStrip(a, npcId) {
    const ctx = questCtx(game);
    if (!bondable(ctx, npcId)) return '';
    const t = bondTier(ctx, a, npcId);
    const pts = bondPts(a, npcId);
    const nx = nextTier(ctx, a, npcId);
    const pct = nx ? Math.round(((pts - nx.from) / (nx.min - nx.from)) * 100) : 100;
    const bd = isBirthday(ctx, npcId) ? '<span class="bday">🎂 오늘 생일</span>' : '';
    const perk = perkOf(ctx, a, npcId);
    return `<div class="bond"><span class="hearts">${hearts(t)}</span> <b>${esc(tierName(ctx, t))}</b>${bd}<i><em style="width:${pct}%"></em></i><small>${nx ? `${pts}/${nx.min} → ${esc(nx.name)}` : '정이 가득하다'}</small></div>${perk ? `<div class="perk">🤝 단짝 혜택 · ${esc(perk.text)}</div>` : ''}`;
  }
  // 동행(v1.7): 단짝 사냥꾼에게 "같이 가자"
  function inviteBtn(a, npcId) {
    const ctx = questCtx(game);
    const p = perkOf(ctx, a, npcId);
    if (p?.kind !== 'companion') return '';
    if (allyOf(ctx, a)) return '';
    return inviteDue(ctx, a, npcId) ? `<button data-act="invite" data-v="${npcId}">🏹 같이 가자</button>` : '<button disabled>오늘은 다녀왔다</button>';
  }
  const REACT = { love: ['💖', '눈을 반짝인다. 무척 좋아하는 것이다.'], like: ['😊', '반갑게 받는다.'], plain: ['🙂', '고맙다며 받는다.'], hate: ['😣', '난처한 얼굴로 받는다. 좋아하지 않는 것 같다.'] };
  function likesHtml(a, npcId) {
    const ctx = questCtx(game);
    const k = knownLikes(ctx, a, npcId);
    const nm = (ids) => ids.map((it) => `${data.items[it].icon || ''}${esc(data.items[it].name)}`).join(' · ');
    if (!k.love.length && !k.like.length && !k.hate.length) return `<p class="muted">좋아하는 걸 아직 모른다. 선물해 보거나 ${esc(tierName(ctx, bondCfg(ctx).revealTier))}이 되면 알려 준다.</p>`;
    return `<ul class="likes">${k.love.length ? `<li>💖 ${nm(k.love)}</li>` : ''}${k.like.length ? `<li>😊 ${nm(k.like)}</li>` : ''}${k.hate.length ? `<li>😣 ${nm(k.hate)}</li>` : ''}</ul>`;
  }
  function giftHtml(a, npc) {
    const ctx = questCtx(game);
    const head = `${npcHead(npc)}${bondStrip(a, npc.id)}`;
    if (panel.react) {
      const r = panel.react;
      const [ic, line] = REACT[r.react];
      return `${head}<p class="say">${ic} ${esc(npc.name)}에게 ${esc(josa(data.items[r.item].name, '을', '를'))} 건넸다. ${line}</p><p class="muted">정 ${r.amt >= 0 ? '+' : ''}${r.amt}${r.birthday && r.react !== 'hate' ? ' · 🎂 생일 선물이라 곱절' : ''}</p><div class="btns"><button data-act="gift-back">돌아가기</button><button data-act="close">잘 있어요</button></div>`;
    }
    if (!giftDue(ctx, a, npc.id)) return `${head}<p class="muted">오늘은 이미 선물했다. 내일 또 주자.</p><div class="btns"><button data-act="gift-back">돌아가기</button></div>`;
    const known = a.bonds?.[npc.id]?.known || {};
    const told = knownLikes(ctx, a, npc.id);
    const tag = (it) => (told.love.includes(it) ? '💖' : told.like.includes(it) ? '😊' : told.hate.includes(it) ? '😣' : known[it] ? REACT[known[it]][0] : '');
    const seen = new Set();
    const rows = a.bag.filter((e) => giftable(ctx, e)).filter((e) => (seen.has(e.item) ? false : seen.add(e.item))).map((e) => `<li><span>${data.items[e.item].icon || ''} ${esc(data.items[e.item].name)} <small>×${countItem([a.bag], e.item)}</small> ${tag(e.item)}</span><button data-act="gift" data-v="${esc(keyOf(e))}">주기</button></li>`).join('');
    return `${head}${likesHtml(a, npc.id)}<p class="muted">가방에서 하나를 준다. 하루 한 번.</p><ul class="list">${rows || '<li class="muted">줄 만한 게 없다(장비는 못 준다)</li>'}</ul><div class="btns"><button data-act="gift-back">돌아가기</button></div>`;
  }
  function talkHtml(a) {
    const ctx = questCtx(game);
    const npc = data.npcs[panel.npc];
    if (panel.gift) return giftHtml(a, npc);
    const head = `${npcHead(npc)}${bondStrip(a, panel.npc)}`;
    const giftBtn = bondable(ctx, panel.npc) ? `<button data-act="gift-open">🎁 선물${giftDue(ctx, a, panel.npc) ? '' : ' ✓'}</button>` : '';
    const after = panel.after;
    if (after) {
      // 뒷장: 끝낸 퀘스트와 보상, 이어진 퀘스트의 안내
      let html = '';
      for (const ev of after.done) {
        const q = data.quests[ev.quest];
        html += `<div class="qdone">✅ <b>${esc(q.name)}</b> 완료</div>${rewardHtml(ev.reward)}`;
        if (ev.next) {
          const nq = data.quests[ev.next];
          html += `<div class="qnext">📜 다음 이야기 · <b>${esc(nq.name)}</b></div>${(nq.intro || []).map((l) => `<p class="say">${esc(l)}</p>`).join('')}<p class="muted">▶ ${esc(nq.steps[0].text)}</p>`;
        } else if (q.kind === 'main') {
          const ch = data.chapters.find((c) => c.id === q.chapter);
          if (ch?.more) html += `<div class="qnext">📜 이야기는 여기까지</div><p class="muted">${esc(ch.after || '')}</p>`;
          else html += `<div class="qnext">🏁 ${esc(ch?.name || '')} 끝</div><p class="muted">${esc(ch?.after || '')}</p>`;
        }
      }
      for (const s0 of after.steps) {
        if (after.done.some((d) => d.quest === s0.id) || !a.quests.active[s0.id]) continue;
        html += `<div class="qnext">📜 ${esc(data.quests[s0.id].name)}</div><p class="muted">▶ 다음: ${esc(stepText(ctx, a, s0.id))}</p>`;
      }
      const more = talkDue(ctx, a, panel.npc).length;
      return `${head}${html}<div class="btns">${more ? '<button data-act="ui-talk-next">이야기 더 듣기</button>' : ''}<button data-act="close">알겠다</button></div>`;
    }
    const due = talkDue(ctx, a, panel.npc);
    if (due.length) {
      const id = due[0];
      const q = data.quests[id];
      const st = q.steps[a.quests.active[id].step];
      const ch = data.chapters.find((c) => c.id === q.chapter);
      const tag = `${head}<div class="qtag">${esc(ch ? ch.name : '의뢰')} · ${esc(q.name)}</div>`;
      // 건네기(v0.6): 모자라면 첫마디와 필요한 것만 보인다
      if (st.take && !takeMet(ctx, a, st)) {
        const need = takeProgress(ctx, a, st).map((x) => `<li>${esc(data.items[x.item].name)} <b>${x.got}/${x.need}</b></li>`).join('');
        return `${tag}<p class="say">${esc(stepSay(ctx, a, st)[0])}</p><p class="muted">건넬 것(가방·이 마을 창고):</p><ul class="list">${need}</ul><div class="btns"><button data-act="close">모아 오겠습니다</button></div>`;
      }
      return `${tag}${stepSay(ctx, a, st).map((l) => `<p class="say">${esc(l)}</p>`).join('')}<div class="btns"><button data-act="talk-do" data-v="${panel.npc}">${esc(st.reply || '알겠다')}</button></div>`;
    }
    // 부가 퀘스트(v1.4): 이 사람이 줄 수 있는 의뢰
    const offers = npcOffers(ctx, a, panel.npc);
    if (offers.length) {
      const q = offers[0];
      const lines = chatLines(npc, a);
      panel.chat ??= Math.floor(Math.random() * lines.length);
      const tag = q.repeat === 'birthday' ? '🎂 생일 잔치' : q.bond ? `💗 마음의 부탁(${esc(tierName(ctx, q.bond))})` : q.repeat === 'daily' ? '오늘의 부탁' : q.faction ? `${data.factions.list.find((f) => f.id === q.faction).icon} 세력 의뢰` : q.chain ? `연작 · ${esc(q.chain)}` : '부가 의뢰';
      return `${head}<p class="say">${esc(lines[panel.chat % lines.length])}</p><div class="qtag">${tag} · ${esc(q.name)}</div><p class="say">${esc(q.summary)}</p>
        <p class="muted">▶ ${q.steps.map((st) => esc(st.text)).join(' → ')}</p>${rewardHtml(q.reward)}
        <div class="btns"><button class="pri" data-act="quest-accept" data-v="${q.id}">맡겠습니다</button>${inviteBtn(a, panel.npc)}${giftBtn}<button data-act="close">다음에</button></div>`;
    }
    // 세력 지도자(v0.7): 세력이 열렸으면 세력 창을 보인다
    const fdef = data.factions.list.find((f) => f.leader === panel.npc);
    if (fdef && isUnlocked(ctx, a, 'faction')) return `${head}${factionHtml(a, fdef, ctx)}`;
    const lines = chatLines(npc, a);
    panel.chat ??= Math.floor(Math.random() * lines.length);
    const bdSay = isBirthday(ctx, panel.npc) && bondTier(ctx, a, panel.npc) >= 1 ? `<p class="muted">🎂 오늘은 ${esc(npc.name)}의 생일이다. 오늘 선물하면 정이 곱절로 든다.</p>` : '';
    return `${head}<p class="say">${esc(lines[panel.chat % lines.length])}</p>${bdSay}<div class="btns">${inviteBtn(a, panel.npc)}${giftBtn}<button data-act="close">잘 있어요</button></div>`;
  }
  // 내 집(v0.8)
  function houseHtml(a, plotId) {
    const ctx = questCtx(game);
    const H = data.housing;
    const p = H.plots.find((x) => x.id === plotId);
    const town = data.settlements[p.at];
    const h = game.state.houses[plotId];
    const lists = [a.bag, storeOf(a, p.at)];
    const needRows = (t) => Object.entries(t.needs).map(([it, n]) => `<li><span>${esc(data.items[it].name)}</span><b>${Math.min(n, countItem(lists, it))}/${n}</b></li>`).join('') + `<li><span>은화</span><b>${a.silver}/${t.silver}</b></li>`;
    if (!h) {
      const t = H.tiers[0];
      if (!isUnlocked(ctx, a, 'housing')) return lockCard('housing');
      if (a.house) return `<p>${esc(town.name)} 집터다. 집은 하나만 가질 수 있다.</p>`;
      return `<p>${esc(town.name)} 둘레의 빈 집터. <b>${esc(t.name)}</b>을 지으면 가구 ${t.furniture}칸, 텃밭 ${t.garden}칸이 생긴다.</p>`
        + `<p class="muted">재료는 가방과 ${esc(town.name)} 창고에서 센다.</p><ul class="list">${needRows(t)}</ul>`
        + `<div class="btns"><button data-act="house-buy" data-v="${plotId}">🔨 ${esc(t.name)} 짓기</button></div>`;
    }
    if (h.owner !== a.id) return '<p>주인이 있는 집이다.</p>';
    const t = H.tiers.find((x) => x.id === h.tier);
    const comfort = comfortOf(h);
    const wait = Math.max(0, h.restAt + H.rest.every - game.state.t);
    let html = `<div class="qtag">${esc(t.name)} · ${esc(town.name)}</div>`;
    html += `<p>아늑함 <b>${Math.round(comfort)}</b> — 쉬면 숙련 경험 +${Math.round(restValue(ctx, h) * 100)}% (${H.rest.minutes}분)${t.stations.length ? ` · 집 작업대: ${t.stations.map((x) => esc(data.stations[x]?.name || x)).join('·')}` : ''}</p>`;
    html += `<div class="btns"><button data-act="rest"${wait ? ' disabled' : ''}>🛏️ 쉬기${wait ? ` (${Math.ceil(wait / 60)}분 뒤)` : ''}</button></div>`;
    const placed = h.furniture.map((e) => `<li><span>${data.items[e.item].icon} ${esc(data.items[e.item].name)} · 아늑함 ${Math.round(e.stats?.comfort || 0)}</span><button data-act="house-take" data-v="${e.uid}">들이기</button></li>`).join('');
    const inBag = a.bag.filter((e) => e.uid && data.items[e.item].stage === 'furniture').map((e) => `<li><span>${data.items[e.item].icon} ${esc(data.items[e.item].name)} · 아늑함 ${Math.round(e.stats?.comfort || 0)}</span><button data-act="house-place" data-v="${e.uid}"${h.furniture.length >= t.furniture ? ' disabled' : ''}>놓기</button></li>`).join('');
    html += `<h3>가구 ${h.furniture.length}/${t.furniture}</h3><ul class="list">${placed || '<li class="muted">목공대에서 가구를 만들어 놓자(의자·탁자·침상·등잔·깔개·선반)</li>'}${inBag}</ul>`;
    const slots = [];
    for (let i = 0; i < t.garden; i++) {
      const g = h.garden[i];
      if (!g) {
        const opts = H.plants.filter((pl) => countItem([a.bag], pl.item) > 0).map((pl) => `<button data-act="garden-plant" data-v="${i}:${pl.item}">${esc(pl.name)}</button>`).join('');
        slots.push(`<li><span>${i + 1}. 빈 자리</span>${opts || '<small class="muted">심을 것(산딸기 씨앗·들버섯·갈대 섬유) 없음</small>'}</li>`);
      } else {
        const pl = H.plants.find((x) => x.item === g.item);
        const left = g.ready - game.state.t;
        slots.push(`<li><span>${i + 1}. ${esc(pl.name)} ${left > 0 ? `· ${Math.ceil(left / 60)}분 남음` : '· 다 자랐다'}</span>${left > 0 ? '' : `<button data-act="garden-harvest" data-v="${i}">거두기</button>`}</li>`);
      }
    }
    html += `<h3>텃밭</h3><ul class="list">${slots.join('')}</ul>`;
    const nt = H.tiers[H.tiers.indexOf(t) + 1];
    if (nt) html += `<h3>${esc(nt.name)}으로 올리기</h3><p class="muted">가구 ${nt.furniture}칸, 텃밭 ${nt.garden}칸${nt.stations.length ? `, 작업대 ${nt.stations.map((x) => esc(data.stations[x]?.name || x)).join('·')}` : ''}</p><ul class="list">${needRows(nt)}</ul><div class="btns"><button data-act="house-up">🔨 올리기</button></div>`;
    return html;
  }
  function factionHtml(a, f, ctx) {
    const ranks = data.factions.ranks;
    const mine = factionOf(a) === f.id;
    const r = mine ? rankOf(ctx, a) : 0;
    const perks = f.perks.map((p) => `<li>${mine && p.rank <= r ? '✅' : '▫️'} <b>${esc(ranks[p.rank - 1].name)}</b> ${esc(p.text)}</li>`).join('');
    let html = `<div class="qtag" style="color:${f.color}">${f.icon} ${esc(f.name)} · ${esc(f.focus)}</div><p class="say">${esc(f.motto)}</p>`;
    if (!mine) {
      html += `<p class="muted">영향력을 쌓을수록 등급이 오르고, 아래 생활 혜택이 하나씩 붙는다.</p><ul class="list">${perks}</ul>`;
      if (factionOf(a)) {
        const cur = data.factions.list.find((x) => x.id === factionOf(a));
        html += `<p class="muted">⚠️ 지금 ${cur.icon} ${esc(cur.name)}에서 쌓은 영향력 <b>${Math.round(a.faction.inf)}</b>을 모두 잃는다. 옮긴 뒤 ${data.factions.switchDays}일은 다시 못 옮긴다.</p>`;
      }
      return `${html}<div class="btns"><button data-act="faction-join" data-v="${f.id}">${f.icon} ${esc(f.name)}에 든다</button><button data-act="close">나중에</button></div>`;
    }
    const next = ranks[r];
    const inf = Math.round(a.faction.inf);
    const bar = next ? `<div class="bar"><span style="width:${Math.min(100, ((inf - ranks[r - 1].at) / (next.at - ranks[r - 1].at)) * 100)}%"></span></div>` : '';
    const today = a.faction.today?.day === game.clock.day(game.state.t) ? a.faction.today.n : 0;
    html += `<p><b>${esc(ranks[r - 1].name)}</b> · 영향력 ${inf}${next ? ` / ${next.at} (다음: ${esc(next.name)})` : ' (가장 높은 등급)'}</p>${bar}`;
    html += `<p class="muted">오늘 활동 영향력 ${today}/${data.factions.dailyCap} — ${esc(f.focus)} 일을 하면 쌓인다.</p>`;
    const lists = reachable(ctx, a);
    const tasks = tasksOf(ctx, f.id).map((t) => {
      const got = Math.min(t.qty, countItem(lists, t.item));
      const done = taskDone(ctx, a, t);
      const btn = done ? '✅ 건넴' : `<button data-act="faction-task" data-v="${t.id}"${got < t.qty ? ' disabled' : ''}>건네기</button>`;
      return `<li><span>${esc(data.items[t.item].name)} ${got}/${t.qty} · 영향력 ${t.inf} · 🪙${t.silver}</span>${btn}</li>`;
    }).join('');
    html += `<h3>오늘의 세력 의뢰</h3><ul class="list">${tasks}</ul><h3>등급 혜택</h3><ul class="list">${perks}</ul>`;
    return `${html}<div class="btns"><button data-act="close">잘 있어요</button></div>`;
  }
  // 사람들(v1.6): 정을 나눈 사람과 단계, 좋아하는 것, 다음 마음의 부탁
  function peopleHtml(a) {
    const ctx = questCtx(game);
    const met = data.lists.npcs.filter((n) => n.gifts && a.bonds?.[n.id]).sort((x, y) => bondPts(a, y.id) - bondPts(a, x.id));
    const where = (n) => (n.at ? data.settlements?.[n.at]?.name || '' : data.sites?.[n.site]?.name || '');
    if (!met.length) return '<p class="muted">아직 정을 나눈 사람이 없다. 마을 사람에게 말을 걸면 인사(하루 한 번)만으로도 정이 조금 든다. 선물과 의뢰로 더 깊어진다.</p>';
    const rows = met.map((n) => {
      const t = bondTier(ctx, a, n.id);
      const nx = nextTier(ctx, a, n.id);
      const bq = data.lists.quests.find((q) => q.bond && q.giver === n.id && a.quests?.done?.[q.id] == null);
      const hint = bq ? (t >= bq.bond ? `💗 「${esc(bq.name)}」 부탁이 있다` : `💗 ${esc(tierName(ctx, bq.bond))}이 되면 부탁할 게 있다고 한다`) : '';
      const k = knownLikes(ctx, a, n.id);
      const dd = daysToBirthday(ctx, n.id);
      const bday = dd == null ? '' : dd === 0 ? '🎂 오늘 생일!' : `🎂 ${n.birthday}일(${dd}일 뒤)`;
      const perk = n.perk ? (perkOf(ctx, a, n.id) ? `🤝 ${esc(n.perk.text)}` : `🔒 단짝이 되면: ${esc(n.perk.text)}`) : '';
      const al = allyOf(ctx, a);
      const with_ = al?.ally?.npc === n.id ? `<small>🏹 같이 다니는 중 · ${Math.max(1, Math.ceil((al.ally.until - game.state.t) / 60))}분 남음 <button data-act="ally-dismiss">돌려보내기</button></small>` : '';
      const likes = [...k.love.map((it) => `💖${esc(data.items[it].name)}`), ...k.like.map((it) => `😊${esc(data.items[it].name)}`)].join(' ');
      return `<li><div><b>${esc(n.name)}</b> <span class="hearts">${hearts(t)}</span> <small>${esc(tierName(ctx, t))}${nx ? ` · ${bondPts(a, n.id)}/${nx.min}` : ''} · ${esc(n.title)} · ${esc(where(n))}</small>${likes ? `<small>${likes}</small>` : ''}${hint ? `<small>${hint}</small>` : ''}${bday || perk ? `<small>${[bday, perk].filter(Boolean).join(' · ')}</small>` : ''}${with_}</div></li>`;
    }).join('');
    const total = data.lists.npcs.filter((n) => n.gifts).length;
    return `<p class="muted">인사 하루 한 번 +${bondCfg(ctx).greet} · 선물 하루 한 번(💖 +${bondCfg(ctx).gift.love}, 😊 +${bondCfg(ctx).gift.like}) · 그 사람 의뢰. 정이 들수록 오늘의 부탁 은화가 늘고, 말이 바뀌고, 정표 가구를 주는 부탁이 열린다. 친한 사이는 인사하면 답례를 주고, 단짝은 혜택(동행·할인)을 준다. 생일에 주는 선물은 곱절.</p><ul class="list people">${rows}</ul><p class="muted">정을 나눈 사람 ${met.length}/${total}</p>`;
  }
  function journalHtml(a) {
    const tab = panel.tab || 'main';
    const Q = a.quests || { active: {}, done: {}, items: {} };
    let body = '';
    if (tab === 'main') {
      const qctx = questCtx(game);
      for (const ch of data.chapters) {
        const list = ch.quests.filter((id) => Q.done[id] != null || Q.active[id]);
        // 아직 퀘스트가 없는 장(준비 중)은 들어섰을 때만 이름과 예고를 보인다
        if (!list.length) {
          if (ch.soon && chapterReached(qctx, a, ch.id)) body += `<h3>${esc(ch.name)} <small class="muted">${esc(ch.island || '')}</small></h3><p class="muted">${esc(ch.after || '준비 중이다.')}</p>`;
          continue;
        }
        body += `<h3>${esc(ch.name)} <small class="muted">${esc(ch.island || '')}</small></h3><ul class="qlist">`;
        for (const id of list) body += Q.active[id] ? activeQuestHtml(a, id) : `<li class="done">✔ ${esc(data.quests[id].name)}</li>`;
        body += '</ul>';
        if (ch.quests.every((id) => Q.done[id] != null)) body += ch.more ? `<p class="muted">📜 ${esc(ch.after || '')}</p>` : `<p class="muted">🏁 ${esc(ch.name)} 끝. ${esc(ch.after || '')}</p>`;
      }
      if (!body) body = '<p class="muted">아직 기록이 없다.</p>';
      body += questItemsHtml(a);
    } else if (tab === 'side') {
      // 부가 의뢰(v1.4): 하는 중 · 받을 수 있는 곳 · 끝낸 수
      const qctx = questCtx(game);
      const act = Object.keys(Q.active).filter((id) => data.quests[id]?.kind === 'side');
      body = act.length ? `<h3>하는 중</h3><ul class="qlist">${act.map((id) => activeQuestHtml(a, id)).join('')}</ul>` : '<p class="muted">맡은 부가 의뢰가 없다. 머리 위에 초록 ! 가 뜬 사람에게 말을 걸어 보자.</p>';
      const offers = data.lists.quests.filter((q) => q.kind === 'side' && available(qctx, a, q) && npcShown(qctx, a, q.giver));
      if (offers.length) {
        const where = (npc) => { const n = data.npcs[npc]; return n.at ? data.settlements?.[n.at]?.name || game.state.settlements[n.at]?.name || '' : data.sites?.[n.site]?.name || ''; };
        const kindOf = (q) => (q.repeat === 'birthday' ? '🎂 ' : q.bond ? '💗 ' : q.repeat === 'daily' ? '🔁 ' : q.faction ? `${data.factions.list.find((f) => f.id === q.faction).icon} ` : q.chain ? '🔗 ' : '');
        body += `<h3>받을 수 있는 의뢰</h3><ul class="list">${offers.map((q) => `<li><div><b>${kindOf(q)}${esc(q.name)}</b><small>${esc(data.npcs[q.giver].name)} · ${esc(where(q.giver))}${q.chain ? ` · ${esc(q.chain)}` : ''} · 🪙 ${q.reward?.silver || 0}</small></div></li>`).join('')}</ul><p class="muted">🔁 날마다 · 🔗 이어지는 이야기 · 💗 정이 들어야 꺼내는 부탁 · 세력 표시는 그 세력 의뢰. 마을 사람은 하루 동안 일터 → 게시판 둘레 → 모닥불 → 집 앞으로 옮겨 다닌다.</p>`;
      }
      const doneN = data.lists.quests.filter((q) => q.kind === 'side' && !q.repeat && Q.done[q.id] != null).length;
      const all = data.lists.quests.filter((q) => q.kind === 'side' && !q.repeat).length;
      body += `<p class="muted">끝낸 부가 의뢰 ${doneN}/${all}</p>`;
    } else if (tab === 'people') {
      body = peopleHtml(a);
    } else if (tab === 'bounty') {
      body = bountyHtml(a).replace(/<button data-act="quest-accept"[^>]*>받기<\/button>/g, '<small class="muted">게시판에서</small>');
    } else {
      const steps = lifeSteps(game, a);
      const qctx = questCtx(game);
      const unl = data.lists.unlocks.map((u) => {
        const on = !u.soon && isUnlocked(qctx, a, u.id);
        return `<li class="${on ? 'done' : ''}">${on ? '✔' : '🔒'} ${u.icon} <b>${esc(u.name)}</b> <small>${esc(u.desc)}${on ? '' : ` · ${esc(u.hint)}${u.soon ? '(준비 중)' : ''}`}</small></li>`;
      }).join('');
      body = `<p class="muted">채집·정제·제작을 익히는 길잡이다. 순서는 자유롭다.</p><ul class="life">${steps.map((st) => `<li class="${st.done ? 'done' : ''}">${st.done ? '✔' : st.lock ? '🔒' : '○'} ${esc(st.text)}${st.lock ? ` <small class="muted">${esc(st.lock)}</small>` : ''}</li>`).join('')}</ul>
        ${factionOf(a) ? (() => { const f = data.factions.list.find((x) => x.id === factionOf(a)); const r = rankOf(questCtx(game), a); return `<h3>${f.icon} ${esc(f.name)}</h3><p>${esc(data.factions.ranks[r - 1].name)} · 영향력 ${Math.round(a.faction.inf)} — 지도자에게 말을 걸면 의뢰와 혜택을 본다</p>`; })() : ''}
        <h3>열리는 것</h3><p class="muted">등대섬(1~2장)에서는 기본 생활과 전투를 익힌다. 3장에서 본섬으로 건너가면 경제가, 4장에서 세력과 큰 콘텐츠가 열린다.</p><ul class="life">${unl}</ul>`;
    }
    return tabsHtml([['main', '메인'], ['side', '부가'], ['people', '사람들'], ['bounty', '현상금'], ['life', '생활 안내']], tab) + body;
  }

  // ── 거래소 ─────────────────────────────────────────
  const hereId = (a) => settlementAt({ state: game.state }, a)?.id ?? null;
  function lowestAsk(item, star) {
    const at = hereId(game.state.actors[PID]);
    if (!at) return null;
    let low = null;
    for (const o of bookOf(mctx(), at).asks) {
      if (o.item !== item || o.star !== star || (o.kind === 'actor' && o.owner === PID)) continue;
      if (!low || o.price < low.price) low = o;
    }
    return low;
  }

  function sellHtml(a) {
    const ctx = mctx();
    const at = hereId(a);
    const merged = new Map();
    for (const e of [...a.bag, ...storeOf(a, at)]) {
      if (!tradable(ctx, e)) continue;
      const k = keyOf(e);
      if (merged.has(k)) merged.get(k).qty += e.qty;
      else merged.set(k, { ...e });
    }
    const rows = sortEntries([...merged.values()]).map((e) => {
      const def = data.items[e.item];
      const st = marketStar(ctx, e);
      const key = keyOf(e);
      const ref = Math.max(1, Math.round(refPrice(ctx, at, e.item, st)));
      const bid = bestBid(ctx, at, e.item, st);
      const low = lowestAsk(e.item, st);
      // 다른 마을 시세(운송 차익을 가늠하게)
      const elsewhere = Object.keys(game.state.settlements).filter((sid) => sid !== at).map((sid) => `${townName(sid)} ${Math.round(refPrice(ctx, sid, e.item, st))}`).join(' · ');
      const npc = npcPrice(ctx, e.item, st);
      const suggest = low ? Math.max(1, Math.min(ref, low.price - 1)) : ref;
      const price = prices[key] ?? suggest;
      const lot = e.lot ? game.state.lots[e.lot] : null;
      return `<li class="mk"><div><b>${def.icon || ''} ${def.name}</b> ×${e.qty} <span class="stars">${stars(st)}</span>
        <small>${lot ? `${esc(lot.name)} · ` : ''}시세 ${ref} · 사자 ${bid ? `${bid.price}(${bid.qty}개)` : '없음'} · 팔자 최저 ${low ? low.price : '없음'}${elsewhere ? ` · ${elsewhere}` : ''}</small></div>
        <div class="btns">
          ${bid ? `<button data-act="mk-sell" data-v="${esc(key)}" data-n="${bid.price}">바로 팔기 ${bid.price}</button>` : ''}
          <div class="step"><button data-act="ui-price" data-v="${esc(key)}" data-cur="${price}" data-n="-1">−</button><b>${price}</b><button data-act="ui-price" data-v="${esc(key)}" data-cur="${price}" data-n="1">+</button></div>
          <button data-act="mk-list" data-v="${esc(key)}" data-n="${price}">내놓기 (수수료 ${Math.round(e.qty * price * standingTier(ctx, a, at).fee)})</button>
          <button class="mini" data-act="mk-dump" data-v="${esc(key)}">상인에게 ${npc * e.qty}</button>
        </div></li>`;
    }).join('');
    const bulk = [...merged.values()].filter((e) => data.items[e.item].stage === 'raw' && e.qty > BULK_KEEP).length;
    const top = bulk ? `<div class="row"><button data-act="mk-bulk">원자재 한꺼번에 팔기 (${bulk}묶음 · 종류마다 ${BULK_KEEP}개는 남김)</button></div>` : '';
    return `${top}<ul class="list">${rows || '<li><small>팔 물건이 없다. 장비·도구는 아직 사고팔 수 없다.</small></li>'}</ul>
      <p class="muted">바로 팔기는 걸려 있는 사자 주문에 넘긴다. 내놓기는 값을 걸어 두고 기다린다(${data.config.market.orderDays}일). 상인은 언제든 사지만 값이 아주 낮다.</p>`;
  }

  function buyHtml(a) {
    const ctx = mctx();
    const at = hereId(a);
    const groups = new Map();
    for (const o of bookOf(ctx, at).asks) {
      if (o.kind === 'actor' && o.owner === PID) continue;
      const k = o.item + '|' + o.star;
      const g = groups.get(k) || { item: o.item, star: o.star, qty: 0, best: Infinity };
      g.qty += o.qty;
      g.best = Math.min(g.best, o.price);
      groups.set(k, g);
    }
    const order = new Map(data.lists.items.map((it, i) => [it.id, i]));
    const rows = [...groups.values()].sort((x, y) => (order.get(x.item) - order.get(y.item)) || y.star - x.star).map((g) => {
      const def = data.items[g.item];
      const ref = Math.max(1, Math.round(refPrice(ctx, at, g.item, g.star)));
      const btn = (n) => {
        const q = Math.min(n, g.qty);
        return `<button data-act="mk-buy" data-v="${g.item}|${g.star}" data-n="${q}" ${a.silver >= q * g.best ? '' : 'disabled'}>${n >= g.qty ? '다' : `${q}개`}</button>`;
      };
      return `<li class="mk"><div><b>${def.icon || ''} ${def.name}</b> <span class="stars">${stars(g.star)}</span>
        <small>최저 <b>${g.best}</b>은화 · ${g.qty}개 걸림 · 시세 ${ref}</small></div>
        <div class="btns row">${btn(1)}${g.qty > 5 ? btn(10) : ''}${btn(g.qty)}</div></li>`;
    }).join('');
    const wants = data.lists.items.filter((it) => (it.kind === 'material' || it.kind === 'consumable') && it.value).map((it) => {
      const p2 = Math.max(1, Math.round(refPrice(ctx, at, it.id, 2)));
      const p3 = Math.max(1, Math.round(refPrice(ctx, at, it.id, 3)));
      return `<li><div><b>${it.icon || ''} ${it.name}</b><small>시세 ★2 ${p2} · ★3 ${p3}</small></div>
        <div class="btns row"><button class="mini" data-act="mk-bid" data-v="${it.id}|0" data-n="${p2}">10개 사자</button><button class="mini" data-act="mk-bid" data-v="${it.id}|3" data-n="${p3}">★3+ 5개</button></div></li>`;
    }).join('');
    return `<ul class="list">${rows || '<li><small>지금 걸린 팔자 주문이 없다.</small></li>'}</ul>
      <h3>사자 주문 걸기</h3><p class="muted">시세에 사자 주문을 걸어 둔다. 은화는 맡겨 두고, 조건에 맞는 물건이 나오면 바로 산다.</p>
      <ul class="list">${wants}</ul>`;
  }

  function mineHtml(a) {
    const rows = ordersOf(mctx(), PID, 'actor').map((o) => {
      const def = data.items[o.item];
      const side = o.entry ? '팔자' : '사자';
      const st = o.entry ? stars(o.star) : (o.minStar ? `★${o.minStar} 이상` : '');
      return `<li><div><b>${side} · ${def.icon || ''} ${def.name}</b> <span class="stars">${st}</span><small>${townName(o.at)} · ${o.qty}개 · 개당 ${o.price}은화 · ${o.expiresDay + 1}일차 아침에 내려감</small></div>
        <button data-act="mk-cancel" data-v="${o.id}">거두기</button></li>`;
    }).join('');
    const sold = game.tele.log.filter((ev) => ev.type === 'market.trade' && (ev.seller === PID || ev.buyer === PID)).slice(-8).reverse()
      .map((ev) => `<li><small>${ev.seller === PID ? '팔림' : '삼'} · ${itemName(data, ev.item)} ${ev.qty}개 · 개당 ${ev.price}</small></li>`).join('');
    return `<ul class="list">${rows || '<li><small>걸어 둔 주문이 없다.</small></li>'}</ul>
      <p class="muted">주문은 모든 마을을 합쳐 ${data.config.market.maxOrdersPerOwner}개까지 걸 수 있다. 거두면 물건은 주문을 건 마을 창고로, 은화는 지갑으로 돌아온다(수수료는 돌려받지 못한다).</p>
      ${sold ? `<h3>최근 거래</h3><ul class="list log">${sold}</ul>` : ''}`;
  }

  function marketHtml(a) {
    const town = settlementAt({ state: game.state }, a);
    if (!town) return '<p class="muted">거래소는 마을 안에서 열린다.</p>';
    const tab = panel.tab || 'sell';
    const escrow = ordersOf(mctx(), PID, 'actor').filter((o) => o.escrow != null).reduce((x, o) => x + o.escrow, 0);
    const tier = standingTier(mctx(), a, town.id);
    const head = `<p class="muted">🪙 ${Math.floor(a.silver).toLocaleString('ko-KR')}은화${escrow ? ` · 맡긴 은화 ${escrow}` : ''} · ${town.name} 거래소(마을마다 따로) · 수수료 ${Math.round(tier.fee * 1000) / 10}% · 판매세 ${Math.round(tier.tax * 1000) / 10}%(${tier.name}) · 산 물건은 ${town.name} 창고로 간다.</p>`;
    const body = tab === 'buy' ? buyHtml(a) : tab === 'mine' ? mineHtml(a) : sellHtml(a);
    return tabsHtml([['sell', '팔기'], ['buy', '사기'], ['mine', '내 주문']], tab) + head + body;
  }

  function menuHtml(a) {
    const armed = settings.resetArmed > performance.now();
    const sp = [1, 10, 30].map((s) => `<button data-act="speed" data-v="${s}" class="${settings.speed === s ? 'on' : ''}">×${s}</button>`).join('');
    const gf = [['auto', '자동'], ['ultra', '최고'], ['high', '높음'], ['medium', '중간'], ['low', '낮음']]
      .map(([v, l]) => `<button data-act="gfx" data-v="${v}" class="${settings.gfx === v ? 'on' : ''}">${l}</button>`).join('');
    const bd = [['m', '남자'], ['f', '여자']]
      .map(([v, l]) => `<button data-act="body" data-v="${v}" class="${settings.body === v ? 'on' : ''}">${l}</button>`).join('');
    return `<h3>내 개척자</h3><div class="row">${bd}</div>
      <h3>화질</h3><div class="row">${gf}</div>
      <p class="muted">지금 ${esc(settings.gfxNow)} · 그림자·후처리·해상도는 바로 바뀌고, 풀 양·지형·텍스처 해상도는 다시 열 때 바뀐다. 자동은 여유가 있으면 최고까지 올린다.</p>
      <div class="row"><button data-act="perf" class="${settings.perf ? 'on' : ''}">📊 성능 표시 (F3)</button></div>
      <h3>연출</h3><div class="row"><button data-act="fx-talkcam" class="${settings.talkCam ? 'on' : ''}">🎬 대화 카메라</button><button data-act="fx-particles" class="${settings.particles ? 'on' : ''}">🍂 계절 입자</button></div>
      <h3>시험용 시간 배속</h3><div class="row">${sp}</div>
      <h3>도움</h3><div class="row">
        <button data-act="auto" class="${a.ai?.on ? 'on' : ''}">🤖 봇에게 맡기기</button>
        <button data-act="focus-toggle" class="${settings.focus ? 'on' : ''}">채집에 집중력 쓰기</button></div>
      <h3>저장</h3><div class="row"><button data-act="save">💾 지금 저장</button>
        <button data-act="reset" class="${armed ? 'warn' : ''}">${armed ? '한 번 더 누르면 새 섬' : '↺ 새 섬에서 시작'}</button></div>
      <p class="muted">30초마다, 그리고 창을 닫을 때 자동 저장한다. 화면 약 ${Math.round(fps)}fps.</p>
      <h3>조작</h3><p class="muted">${touch ? '왼쪽 엄지로 이동, 오른쪽을 끌어 시점, 두 손가락으로 거리. 손 단추로 상호작용.' : 'WASD 이동 · 마우스 끌기 시점 · 휠 거리 · E 상호작용 · H 귀환 · I 가방 · C 제작 · K 스킬 · L 기록 · Esc 닫기'}</p>
      <div class="row"><a href="patchnotes.html">패치노트</a><a href="debug.html">엔진 점검판</a><span class="muted">v${ENGINE_VERSION}</span></div>`;
  }

  const TITLES = { hub: '☰ 메뉴', mastery: '⚔️ 무기 숙련', bag: '🎒 가방', skills: '📈 생활 스킬', log: '📜 기록', board: '📋 마을 게시판', market: '⚖️ 등대 마을 거래소', menu: '⚙️ 설정', journal: '📖 일지' };

  function renderPanel(force) {
    if (!panel) return;
    if (holding && !force) return;
    lastPanel = performance.now();
    const a = game.state.actors[PID];
    let title = TITLES[panel.kind] || '';
    let html = '';
    if (panel.kind === 'bag') html = bagHtml(a);
    else if (panel.kind === 'hub') html = hubHtml(a);
    else if (panel.kind === 'mastery') html = masteryHtml(a);
    else if (panel.kind === 'craft') {
      const st = data.stations[panel.station];
      title = `${st.icon} ${panel.station === 'hand' ? '맨손 제작' : st.name}`;
      html = craftHtml(a, panel.station);
    } else if (panel.kind === 'skills') html = skillsHtml(a);
    else if (panel.kind === 'log') html = logHtml();
    else if (panel.kind === 'board') {
      const town = settlementAt({ state: game.state }, a);
      title = `📋 ${town ? town.name : '마을'} 게시판`;
      html = boardHtml(a);
    } else if (panel.kind === 'market') {
      const town = settlementAt({ state: game.state }, a);
      title = `⚖️ ${town ? town.name + ' ' : ''}거래소`;
      html = marketHtml(a);
    }
    else if (panel.kind === 'menu') html = menuHtml(a);
    else if (panel.kind === 'journal') html = journalHtml(a);
    else if (panel.kind === 'talk') {
      title = `💬 ${data.npcs[panel.npc]?.name ?? ''}`;
      html = talkHtml(a);
    } else if (panel.kind === 'house') {
      title = '🏠 집';
      html = houseHtml(a, panel.plot);
    } else if (panel.kind === 'cross' && data.objects[panel.obj].ferry) {
      // 오가는 배(v0.9): 짐·귀환 지점은 그대로, 언제든 되돌아온다
      const to = data.lists.regions.find((r) => r.id === data.objects[panel.obj].cross);
      title = '⛵ ' + esc(data.objects[panel.obj].name);
      html = `<p>강두의 배로 <b>${esc(to.settlements[0].name)}</b>에 간다. 이 배는 언제든 오간다.</p>`
        + `<div class="btns"><button data-act="cross-go" data-v="${esc(panel.obj)}">⛵ 배 타기</button><button data-act="close">아직</button></div>`
        + '<p class="muted">📦 창고 짐과 귀환 지점은 그대로다. 가방과 입은 장비만 같이 간다.</p>';
    } else if (panel.kind === 'cross') {
      // 안개 벽 건너기(v0.6): 되돌아올 수 없다는 걸 분명히 묻는다
      const to = data.lists.regions.find((r) => r.id === data.objects[panel.obj].cross);
      const port = to.settlements[0].name;
      title = '⛵ 안개 벽 건너기';
      html = `<p>강두의 배로 안개 벽 너머 <b>${esc(to.island)}</b> ${esc(port)}에 간다. <b>등대섬으로는 돌아올 수 없다.</b></p>`
        + `<div class="btns"><button data-act="cross-go" data-v="${esc(panel.obj)}">⛵ 건너간다</button><button data-act="close">아직</button></div>`
        + `<p class="muted">📦 등대섬 두 마을 창고 짐은 ${esc(port)} 창고로 옮겨 준다. 가방과 입은 장비는 그대로 간다.</p>`
        + '<p class="muted">⚖️ 등대섬 장터에 걸어 둔 내 주문은 거둬서 돌려준다.</p>';
    }
    set(el.ptitle, title);
    setHtml(el.pbody, html);
  }

  // 맞으면 화면 가장자리가 붉게 번쩍인다
  function hurt() {
    el.hurtfx.classList.remove('on');
    void el.hurtfx.offsetWidth;
    el.hurtfx.classList.add('on');
  }

  return {
    update,
    open,
    close,
    toggle,
    isOpen: () => !!panel,
    toast,
    banner,
    feed: pushFeed,
    hurt,
    settings,
    get panel() { return panel; },
    setPortrait(id, url) {
      portraits.set(id, url);
      if (panel?.kind === 'talk' && panel.npc === id) renderPanel(true);
    },
    minimapCanvas: root.querySelector('.minimap'),
    joyEl: root.querySelector('.joy'),
    knobEl: root.querySelector('.joy .knob'),
    qtyOf,
  };
}
