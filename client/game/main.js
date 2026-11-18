// 안개섬 개척기 — 3D 클라이언트 (v0.1부터).
// 코어(core/)를 브라우저에서 돌리고, 조작은 모두 명령(game.dispatch)으로 보낸다.

import * as THREE from 'three';
import { DATA_FILES, buildData } from '../../core/data.js';
import { createGame, loadGame } from '../../core/game.js';
import { dist, settlementAt } from '../../core/world.js';
import { avgProps, keyOf } from '../../core/inventory.js';
import { starOf } from '../../core/formulas.js';
import { stars } from '../../core/text.js';
import { createScene } from './scene.js';
import { startTier, createAutoTuner, chosenTier, setChosenTier, TIERS } from './gfx/quality.js';
import { bakeMaterials, makeCanvasTextures } from './gfx/texgen.js';
import { createTerrain } from './gfx/terrain.js';
import { createWater } from './gfx/water.js';
import { createGrass } from './gfx/grass.js';
import { createFlora } from './gfx/flora.js';
import { makeMaterials, G } from './gfx/materials.js';
import { createNodesView } from './nodes-view.js';
import { createTownView } from './town-view.js';
import { createActorsView } from './actors-view.js';
import { createFx } from './fx.js';
import { NODE_CHIP } from './models/nodes.js';
import { createCamera } from './camera.js';
import { createInput } from './input.js';
import { createHud, BULK_KEEP } from './hud.js';
import { refPrice, npcPrice, bestBid, entryStar as marketStar } from '../../core/market.js';
import { createMinimap } from './minimap.js';

const SAVE_KEY = 'mist-isle:v1';
const OLD_KEY = 'mist-isle:v0';
const PID = 'p1';
const touch = window.matchMedia('(pointer: coarse)').matches;
const bootEl = document.getElementById('boot');

async function loadData() {
  const raw = {};
  await Promise.all(DATA_FILES.map(async (f) => {
    const res = await fetch(`./data/${f}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${f}.json을 읽지 못함 (${res.status})`);
    raw[f] = await res.json();
  }));
  return buildData(raw);
}

function readStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function restore(data) {
  for (const key of [SAVE_KEY, OLD_KEY]) {
    const s = readStore(key);
    if (!s) continue;
    try { return loadGame({ data, save: s }); } catch (e) { console.warn('세이브를 읽지 못함', key, e); }
  }
  return null;
}

async function boot() {
  const data = await loadData();
  // 시험용: ?seed=숫자&fresh 로 정해진 섬을 새로 연다
  const params = new URLSearchParams(window.location.search);
  const fixedSeed = Number(params.get('seed')) || null;
  const game = (!params.has('fresh') && restore(data)) || createGame({ data, seed: fixedSeed ?? Date.now() % 1_000_000_007 });
  window.__mist = { game };

  const canvas = document.getElementById('view');
  const tier = startTier(touch);
  const say = async (msg) => {
    bootEl.textContent = msg;
    await new Promise((r) => setTimeout(r, 30));
  };
  const ctex = makeCanvasTextures();
  const view = createScene(canvas, { tier, textures: ctex });
  const region = data.lists.regions[0];
  await say('🌫️ 땅과 돌의 결을 굽는 중…');
  const tex = bakeMaterials(view.renderer, { terrainSize: tier.texTerrain, objectSize: tier.texObject });
  const mats = makeMaterials(tex, ctex);
  await say('🌫️ 섬의 지형을 그리는 중…');
  const ground = createTerrain(view.scene, { terrain: game.terrain, region, tier, tex });
  const water = createWater(view.scene, { hf: ground.hf, tex, tier });
  const grass = createGrass(view.scene, { hf: ground.hf, paths: ground.paths, tier });
  const flora = createFlora(view.scene, { hf: ground.hf, paths: ground.paths, region, tier, mats, ctex, game });
  window.__mist.gfx = { view, tier, tex, mats, ground, flora };
  const lantern = new THREE.PointLight(0xffd59a, 0, 11, 1.4); // 밤에 들고 다니는 등불
  view.scene.add(lantern);
  await say('🌫️ 마을과 숲을 세우는 중…');
  const nodesView = createNodesView(view.scene, game, ground.hf, { mats, ctex });
  const townView = createTownView(view.scene, game, ground.hf, { mats, terrain: game.terrain, region });
  const actorsView = createActorsView(view.scene, game, ground.hf);
  const fx = createFx(view.scene, { textures: ctex, hf: ground.hf, town: townView, terrain: game.terrain, region });
  const cam = createCamera(view.camera, ground.hf);
  window.__mist.cam = cam;
  {
    // 새 게임은 첫 목표(표류목·돌) 무리 쪽을 바라보고 시작한다. 이어 하기는 캐릭터가 보던 쪽.
    const a = game.state.actors[PID];
    let yaw = a.yaw || 0;
    if (game.state.t < 2) {
      const d = (n) => Math.hypot(n.x - a.x, n.z - a.z);
      const near = Object.values(game.state.nodes)
        .filter((n) => (n.type === 'node_driftwood' || n.type === 'node_stone') && d(n) < 45)
        .sort((p, q) => d(p) - d(q))
        .slice(0, 5);
      const town = region.settlement;
      const tx = near.length ? near.reduce((s, n) => s + n.x, 0) / near.length : town.x;
      const tz = near.length ? near.reduce((s, n) => s + n.z, 0) / near.length : town.z;
      yaw = Math.atan2(tx - a.x, tz - a.z);
    }
    cam.st.yaw = yaw;
  }

  const ui = { gather: null, last: { x: 0, z: 0, moving: false }, target: null };

  function save(say) {
    try {
      localStorage.setItem(SAVE_KEY, game.save());
      if (say) hud.toast('저장했다', 'good');
    } catch {
      if (say) hud.toast('이 브라우저에서는 저장할 수 없다');
    }
  }

  const me = () => game.state.actors[PID];

  function stopBot() {
    if (me().ai?.on) game.dispatch({ type: 'SET_AUTOPILOT', actor: PID, on: false });
  }

  function nearestStationType(a) {
    let best = null;
    let bd = Infinity;
    for (const s of Object.values(game.state.settlements)) {
      for (const st of s.stations) {
        const d = dist(a, st);
        if (st.type !== 'storage' && d < bd) {
          bd = d;
          best = st;
        }
      }
    }
    return best && bd <= data.config.craft.rangeM ? best.type : 'hand';
  }

  function interact() {
    const t = ui.target;
    if (!t || t.why || t.idle) return;
    stopBot();
    if (t.kind === 'node') ui.gather = t.id;
    else if (t.kind === 'station') {
      if (t.id === 'storage') hud.open('bag');
      else hud.open('craft', { station: t.id });
    } else if (t.kind === 'board') hud.open('board');
    else if (t.kind === 'market') hud.open('market');
  }

  // 거래소 명령: 가방에 같은 묶음이 있으면 창고로 먼저 옮겨 하나로 판다
  function stash(key) {
    if (me().bag.some((e) => keyOf(e) === key)) game.dispatch({ type: 'STORE', actor: PID, key });
  }
  // 원자재 한꺼번에 팔기(v0.2.1): 시세 85% 이상 사자 주문엔 바로 넘기고, 나머지는 시세 95%로 건다
  function bulkSell() {
    const ctx = { state: game.state, data, cfg: data.config };
    const keys = new Set([...me().bag, ...me().storage].filter((e) => !e.uid && data.items[e.item].stage === 'raw').map((e) => keyOf(e)));
    for (const key of keys) {
      stash(key);
      const e = me().storage.find((x) => keyOf(x) === key);
      if (!e || e.qty <= BULK_KEEP) continue;
      const star = marketStar(ctx, e);
      const ref = refPrice(ctx, e.item, star);
      const bid = bestBid(ctx, e.item, star);
      let q = e.qty - BULK_KEEP;
      if (bid && bid.price >= ref * 0.85) {
        const sell = Math.min(q, bid.qty);
        game.dispatch({ type: 'MARKET_SELL', actor: PID, key, qty: sell, price: bid.price, ioc: true });
        q -= sell;
      }
      if (q > 0) game.dispatch({ type: 'MARKET_SELL', actor: PID, key, qty: q, price: Math.max(npcPrice(ctx, e.item, star) + 1, Math.round(ref * 0.95)) });
    }
  }

  function buyUpTo(item, star, qty) {
    // 싼 팔자부터 qty개를 채우는 데 필요한 최고 단가까지 사자(체결은 팔자 값으로, 차액은 돌려받는다)
    const asks = game.state.market.asks.filter((o) => o.item === item && o.star === star && !(o.kind === 'actor' && o.owner === PID)).sort((x, y) => x.price - y.price);
    let left = qty;
    let cap = 0;
    for (const o of asks) {
      if (left <= 0) break;
      cap = o.price;
      left -= o.qty;
    }
    if (!cap) return;
    game.dispatch({ type: 'MARKET_BUY', actor: PID, item, minStar: star, qty, price: cap, ioc: true });
  }

  function onAct(act, v, n) {
    const a = me();
    switch (act) {
      case 'interact': interact(); break;
      case 'recall':
        stopBot();
        ui.gather = null;
        game.dispatch({ type: 'RECALL', actor: PID });
        break;
      case 'bag': hud.toggle('bag'); break;
      case 'craft': hud.toggle('craft', { station: nearestStationType(a) }); break;
      case 'skills': hud.toggle('skills'); break;
      case 'log': hud.toggle('log'); break;
      case 'menu': hud.toggle('menu'); break;
      case 'close': hud.close(); break;
      case 'craft-do':
        for (let i = 0; i < Number(n || 1); i++) {
          if (!game.dispatch({ type: 'CRAFT', actor: PID, recipe: v, auto: 'best', catalyst: 'auto' }).ok) break;
        }
        break;
      case 'eat': game.dispatch({ type: 'EAT', actor: PID, key: v }); break;
      case 'mk-sell': stash(v); game.dispatch({ type: 'MARKET_SELL', actor: PID, key: v, price: Number(n), ioc: true }); break;
      case 'mk-list': stash(v); game.dispatch({ type: 'MARKET_SELL', actor: PID, key: v, price: Number(n) }); break;
      case 'mk-dump': stash(v); game.dispatch({ type: 'MARKET_DUMP', actor: PID, key: v }); break;
      case 'mk-buy': {
        const [item, star] = v.split('|');
        buyUpTo(item, Number(star), Number(n));
        break;
      }
      case 'mk-bid': {
        const [item, star] = v.split('|');
        const minStar = Number(star);
        game.dispatch({ type: 'MARKET_BUY', actor: PID, item, minStar, qty: minStar >= 3 ? 5 : 10, price: Number(n) });
        break;
      }
      case 'mk-cancel': game.dispatch({ type: 'MARKET_CANCEL', actor: PID, id: Number(v) }); break;
      case 'mk-bulk': bulkSell(); break;
      case 'repair': game.dispatch({ type: 'REPAIR', actor: PID, uid: v }); break;
      case 'ord-deliver': game.dispatch({ type: 'ORDER_DELIVER', actor: PID, order: v }); break;
      case 'store-all': game.dispatch({ type: 'STORE', actor: PID, all: true }); break;
      case 'take': game.dispatch({ type: 'TAKE', actor: PID, key: v }); break;
      case 'speed': hud.settings.speed = Number(v); break;
      case 'focus-toggle': hud.settings.focus = !hud.settings.focus; break;
      case 'gfx': {
        setChosenTier(v);
        applyTier(v === 'auto' ? startTier(touch) : TIERS[v]);
        hud.settings.gfx = v;
        break;
      }
      case 'auto':
        ui.gather = null;
        game.dispatch({ type: 'SET_AUTOPILOT', actor: PID, on: !a.ai?.on });
        break;
      case 'save': save(true); break;
      case 'reset':
        if (hud.settings.resetArmed > performance.now()) {
          const fresh = createGame({ data, seed: Date.now() % 1_000_000_007 });
          try { localStorage.setItem(SAVE_KEY, fresh.save()); } catch { /* 저장 불가 */ }
          window.location.reload();
        } else {
          hud.settings.resetArmed = performance.now() + 3000;
        }
        break;
      default: break;
    }
  }

  const hud = createHud(document.getElementById('hud'), game, { touch, onAct });
  let liveTier = tier;
  function applyTier(t) {
    liveTier = t;
    view.applyTier(t);
    grass.applyTier(t);
    hud.settings.gfxNow = `${t.label} 화질`;
  }
  hud.settings.gfx = chosenTier();
  hud.settings.gfxNow = `${tier.label} 화질`;
  const tuner = createAutoTuner((next, fps) => {
    applyTier(next);
    hud.toast(`화면이 버거워 보여(${Math.round(fps)}fps) 화질을 '${next.label}'으로 낮췄다. 설정에서 바꿀 수 있다.`, 'info');
  });
  const input = createInput(canvas, { joyEl: hud.joyEl, knobEl: hud.knobEl });
  const minimap = createMinimap(hud.minimapCanvas, game, game.terrain);

  game.on('gather.done', (ev) => {
    const node = game.state.nodes[ev.node];
    if (node) fx.burst(node.x, ground.hf.height(node.x, node.z), node.z, NODE_CHIP[ev.nodeType]);
  });

  // 가까운 상호작용 대상: 앞쪽에 있는 것을 조금 더 쳐준다
  function findTarget(a) {
    const { state } = game;
    const fx0 = Math.sin(a.yaw || 0);
    const fz0 = Math.cos(a.yaw || 0);
    let best = null;
    let bestS = Infinity;
    const consider = (d, dx, dz, make) => {
      const front = d > 0.01 ? (dx * fx0 + dz * fz0) / d : 1;
      const s = d - front * 0.9;
      if (s < bestS) {
        bestS = s;
        best = make;
      }
    };
    const range = data.config.gather.rangeM;
    for (const n of Object.values(state.nodes)) {
      const dx = n.x - a.x;
      const dz = n.z - a.z;
      if (Math.abs(dx) > range || Math.abs(dz) > range) continue;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      consider(d, dx, dz, { kind: 'node', id: n.id, x: n.x, z: n.z, n });
    }
    for (const s of Object.values(state.settlements)) {
      for (const st of s.stations) {
        const dx = st.x - a.x;
        const dz = st.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d <= data.config.craft.rangeM - 0.3) consider(d, dx, dz, { kind: 'station', id: st.type, x: st.x, z: st.z });
      }
    }
    for (const o of game.statics) {
      if (o.kind !== 'board' && o.kind !== 'market') continue;
      const dx = o.x - a.x;
      const dz = o.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d <= (o.kind === 'market' ? 3.8 : 3.2)) consider(d, dx, dz, { kind: o.kind, id: o.kind, x: o.x, z: o.z });
    }
    if (!best) return null;
    if (best.kind === 'node') {
      const n = best.n;
      const type = data.nodes[n.type];
      const lot = state.lots[state.veins[n.vein].lot];
      best.label = `${type.name} ${stars(starOf(avgProps(lot.props), data.config.stars))}`;
      best.verb = '캐기';
      best.radius = (type.solid || 0.5) + 0.6;
      if (n.charges <= 0) {
        best.idle = true;
        best.label = `${type.name} — ${Math.max(1, Math.ceil((n.respawnAt - state.t) / 60))}분 뒤 다시 자람`;
      } else if (a.skills[type.skill].level < type.level) {
        best.why = `${data.skills[type.skill].name} ${type.level} 필요`;
      } else if (type.tier > 0 && !a.bag.some((e) => e.uid && !e.broken && data.items[e.item].tool?.skill === type.skill)) {
        best.why = '도구가 필요하다(맨손 불가)';
      }
    } else if (best.kind === 'station') {
      const st = data.stations[best.id];
      best.label = st.name;
      best.verb = best.id === 'storage' ? '창고 열기' : '작업대 열기';
      best.radius = (st.r || 0.8) + 0.7;
    } else if (best.kind === 'market') {
      best.label = '거래소';
      best.verb = '사고팔기';
      best.radius = 2.0;
    } else {
      best.label = '마을 게시판 — 주문·산지 소문';
      best.verb = '보기';
      best.radius = 1.2;
    }
    return best;
  }

  let last = performance.now();
  let lastSave = performance.now();
  let lastMap = 0;
  let firstFrame = true;
  const focusVec = new THREE.Vector3();

  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const a = me();

    // 1) 입력 → 명령
    const inp = input.poll();
    cam.rotate(inp.camDX, inp.camDY);
    if (inp.zoom) cam.zoom(inp.zoom);
    const [wx, wz] = cam.toWorld(inp.right, inp.fwd);
    const moving = Math.hypot(wx, wz) > 0.05;
    if (moving) {
      stopBot();
      ui.gather = null;
    }
    const L = ui.last;
    if (moving !== L.moving || (moving && (Math.abs(wx - L.x) > 0.02 || Math.abs(wz - L.z) > 0.02))) {
      game.dispatch({ type: 'MOVE_INPUT', actor: PID, dx: moving ? wx : 0, dz: moving ? wz : 0 });
      Object.assign(L, { x: wx, z: wz, moving });
    }
    for (const act of inp.acts) onAct(act);

    // 2) 이어서 캐기
    if (ui.gather) {
      const n = game.state.nodes[ui.gather];
      if (!n || n.charges <= 0) ui.gather = null;
      else if (!a.action && !a.move && !a.dest) {
        if (dist(a, n) > data.config.gather.rangeM) ui.gather = null;
        else {
          const useFocus = hud.settings.focus && a.focus >= data.config.focus.cost.gather;
          if (!game.dispatch({ type: 'GATHER', actor: PID, node: n.id, focus: useFocus }).ok) ui.gather = null;
        }
      }
    }

    // 3) 시뮬레이션
    game.advance(dt * hud.settings.speed);
    tuner.tick(dt, liveTier);

    // 4) 화면
    actorsView.update(dt, now / 1000);
    const p = actorsView.positionOf(PID);
    cam.update(dt, p.x, p.y, p.z);
    focusVec.set(p.x, p.y, p.z);
    const t = game.state.t;
    const sec = now / 1000;
    G.uTime.value = sec;
    G.uWind.value = 0.75 + 0.35 * Math.sin(sec * 0.13) * Math.sin(sec * 0.051 + 1.3);
    const sky = view.setTime(game.clock.phase(t), game.clock.dayFrac, focusVec, sec, now);
    const nightK = sky.night;
    G.uDay.value = sky.day;
    water.update(sec, view.camera);
    grass.update(sec, focusVec, G.uWind.value, firstFrame ? 999 : 3);
    lantern.position.set(p.x, p.y + 1.9, p.z);
    lantern.intensity = 7 * nightK;
    nodesView.update();
    townView.update(sec, nightK, dt);
    ui.target = a.ai?.on ? null : findTarget(a);
    const tg = ui.target;
    fx.setTarget(tg ? tg.x : null, tg ? ground.hf.height(tg.x, tg.z) : 0, tg?.z, tg && !tg.why && !tg.idle, tg?.radius);
    fx.update(dt, sec, { night: nightK, day: sky.day, player: focusVec });
    hud.update(dt, { target: ui.target, gathering: !!ui.gather });
    if (now - lastMap > 200) {
      minimap.draw(PID, cam.st.yaw);
      lastMap = now;
    }
    view.render();

    if (now - lastSave > 30000) {
      save(false);
      lastSave = now;
    }
    if (firstFrame) {
      firstFrame = false;
      bootEl.remove();
      if (game.state.t < 2) hud.toast('🌫️ 난파선에서 겨우 뭍에 올랐다. 바닷가의 표류목과 돌부터 주워 보자.', 'info');
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) save(false); });
  window.addEventListener('pagehide', () => save(false));
  window.__mist.save = save;
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  bootEl.textContent = `시작하지 못했다: ${e.message}`;
  bootEl.classList.add('error');
});
