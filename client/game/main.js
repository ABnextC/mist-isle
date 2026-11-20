// 안개섬 개척기 — 3D 클라이언트 (v0.1부터).
// 코어(core/)를 브라우저에서 돌리고, 조작은 모두 명령(game.dispatch)으로 보낸다.

import * as THREE from 'three';
import { DATA_FILES, buildData } from '../../core/data.js';
import { createGame, loadGame } from '../../core/game.js';
import { dist, settlementAt, storeOf } from '../../core/world.js';
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
import { createActorsView, playerBody, BODY_KEY } from './actors-view.js';
import { prepareActorBase } from './models/actor.js';
import { createMobsView } from './mobs-view.js';
import { zoneAt } from '../../core/terrain.js';
import { createFx } from './fx.js';
import { NODE_CHIP } from './models/nodes.js';
import { createCamera } from './camera.js';
import { createInput } from './input.js';
import { createHud, BULK_KEEP } from './hud.js';
import { refPrice, npcPrice, bestBid, bookOf, entryStar as marketStar } from '../../core/market.js';
import { createMinimap } from './minimap.js';
import { createGuide } from './guide.js';
import { currentQuest } from './quest.js';

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

  // 캐릭터 모양은 워커가 따로 깎는다(질감 굽기·지형 만들기와 나란히)
  const actorBase = prepareActorBase();
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
  const tex = await bakeMaterials(view.renderer, { terrainSize: tier.texTerrain, objectSize: tier.texObject });
  const mats = makeMaterials(tex, ctex);
  await say('🌫️ 섬의 지형을 그리는 중…');
  const ground = createTerrain(view.scene, { terrain: game.terrain, region, tier, tex });
  const water = createWater(view.scene, { hf: ground.hf, tex, tier });
  const flora = createFlora(view.scene, { hf: ground.hf, paths: ground.paths, ground, region, tier, mats, ctex, game });
  const grass = createGrass(view.scene, { hf: ground.hf, ground, tier });
  window.__mist.gfx = { view, tier, tex, mats, ground, flora, grass };
  const lantern = new THREE.PointLight(0xffd59a, 0, 11, 1.4); // 밤에 들고 다니는 등불
  view.scene.add(lantern);
  await say('🌫️ 마을과 숲을 세우는 중…');
  const nodesView = createNodesView(view.scene, game, ground.hf, { mats, ctex });
  const townView = createTownView(view.scene, game, ground.hf, { mats, terrain: game.terrain, region });
  await say('🌫️ 개척자를 준비하는 중…');
  await actorBase;
  const actorsView = createActorsView(view.scene, game, ground.hf, view.camera);
  const floaters = document.createElement('div');
  floaters.id = 'floaters';
  document.body.appendChild(floaters);
  const mobsView = createMobsView(view.scene, game, ground.hf, floaters);
  // 떠오르는 숫자(준 피해·받은 피해·회피)
  const floats = [];
  const fv = new THREE.Vector3();
  function floatText(x, y, z, text, cls) {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    floaters.appendChild(el);
    floats.push({ el, x, y, z, t: 0, dx: (Math.random() - 0.5) * 30 });
  }
  function updateFloats(dt) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.t += dt;
      if (f.t > 0.95) {
        f.el.remove();
        floats.splice(i, 1);
        continue;
      }
      fv.set(f.x, f.y + f.t * 1.2, f.z).project(view.camera);
      if (fv.z > 1) {
        f.el.style.opacity = 0;
        continue;
      }
      f.el.style.opacity = String(1 - Math.max(0, f.t - 0.6) / 0.35);
      f.el.style.transform = `translate(${((fv.x + 1) / 2) * window.innerWidth + f.dx * f.t}px, ${((1 - fv.y) / 2) * window.innerHeight}px)`;
    }
  }
  game.on('combat.hit', (ev) => {
    mobsView.onEvent(ev);
    const m = game.state.mobs[ev.mob];
    if (m && ev.actor === PID) floatText(m.x, ground.hf.height(m.x, m.z) + 1.4, m.z, String(Math.round(ev.dmg)), ev.heavy ? 'big' : '');
  });
  game.on('combat.hurt', (ev) => {
    actorsView.onEvent(ev);
    const a = game.state.actors[ev.actor];
    if (ev.actor === PID && a) {
      floatText(a.x, ground.hf.height(a.x, a.z) + 2.0, a.z, `-${Math.round(ev.dmg)}${ev.blocked ? ' 막음' : ''}`, 'hurt');
      hud.hurt();
    }
  });
  game.on('combat.evade', (ev) => {
    const a = game.state.actors[ev.actor];
    if (ev.actor === PID && a) floatText(a.x, ground.hf.height(a.x, a.z) + 2.0, a.z, '회피', 'evade');
  });
  game.on('combat.guardbreak', (ev) => {
    if (ev.actor === PID) hud.toast('🛡️ 기력이 바닥나 막기가 풀렸다', 'warn');
  });
  const fx = createFx(view.scene, { textures: ctex, hf: ground.hf, town: townView, terrain: game.terrain, region });
  const guide = createGuide(view.scene, ground.hf);
  let questNow = null;
  let lastQuest = -1e9;
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
      const town = region.settlements[0];
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

  // 공격 방향: 카메라가 보는 쪽 ±60° 안에서 가장 가까운 짐승 쪽으로(조준 보조)
  function aimYaw() {
    const a = me();
    const [fx, fz] = cam.toWorld(0, 1);
    const fy = Math.atan2(fx, fz);
    const we = a.equip?.weapon ? a.bag.find((e) => e.uid === a.equip.weapon) : null;
    const reach = data.config.combat.weapons[we ? data.items[we.item].weapon.type : 'fists'].range;
    let best = null;
    let bs = Infinity;
    for (const m of Object.values(game.state.mobs)) {
      if (m.mode === 'dead') continue;
      const d = Math.hypot(m.x - a.x, m.z - a.z);
      if (d > reach + 2.5) continue;
      const yy = Math.atan2(m.x - a.x, m.z - a.z);
      let diff = Math.abs(yy - fy);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff > 1.05) continue;
      const s = d + diff * 3;
      if (s < bs) {
        bs = s;
        best = yy;
      }
    }
    return best ?? fy;
  }

  function interact() {
    const t = ui.target;
    if (!t || t.why || t.idle) return;
    stopBot();
    if (t.kind === 'corpse') {
      game.dispatch({ type: 'SKIN', actor: PID, mob: t.id });
      return;
    }
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
  // 지금 서 있는 마을(없으면 null)과 그 마을 창고
  const hereTown = () => settlementAt({ state: game.state }, me());
  const hereStore = () => {
    const t = hereTown();
    return t ? storeOf(me(), t.id) : [];
  };
  // 원자재 한꺼번에 팔기(v0.2.1): 시세 85% 이상 사자 주문엔 바로 넘기고, 나머지는 시세 95%로 건다(이 마을 거래소)
  function bulkSell() {
    const ctx = { state: game.state, data, cfg: data.config };
    const town = hereTown();
    if (!town) return;
    const keys = new Set([...me().bag, ...hereStore()].filter((e) => !e.uid && data.items[e.item].stage === 'raw').map((e) => keyOf(e)));
    for (const key of keys) {
      stash(key);
      const e = hereStore().find((x) => keyOf(x) === key);
      if (!e || e.qty <= BULK_KEEP) continue;
      const star = marketStar(ctx, e);
      const ref = refPrice(ctx, town.id, e.item, star);
      const bid = bestBid(ctx, town.id, e.item, star);
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
    const town = hereTown();
    if (!town) return;
    const asks = bookOf({ state: game.state }, town.id).asks.filter((o) => o.item === item && o.star === star && !(o.kind === 'actor' && o.owner === PID)).sort((x, y) => x.price - y.price);
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
      case 'attack':
      case 'heavy':
        stopBot();
        ui.gather = null;
        game.dispatch({ type: 'ATTACK', actor: PID, kind: act === 'heavy' ? 'heavy' : 'light', yaw: aimYaw() });
        break;
      case 'dodge': {
        stopBot();
        ui.gather = null;
        const L = ui.last;
        const [fx, fz] = cam.toWorld(0, 1);
        game.dispatch({ type: 'DODGE', actor: PID, yaw: L.moving ? Math.atan2(L.x, L.z) : Math.atan2(-fx, -fz) });
        break;
      }
      case 'block-on':
        stopBot();
        ui.gather = null;
        me().yaw = aimYaw();
        game.dispatch({ type: 'BLOCK', actor: PID, on: true });
        break;
      case 'block-off': game.dispatch({ type: 'BLOCK', actor: PID, on: false }); break;
      case 'equip': game.dispatch({ type: 'EQUIP', actor: PID, uid: v }); break;
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
      // 정착지(v0.4): 창고 운송·마을 사업·귀환 지점
      case 'ship': {
        const [to, key] = v.split('>');
        game.dispatch({ type: 'SHIP', actor: PID, to, key, qty: n ? Number(n) : undefined });
        break;
      }
      case 'ship-all': {
        // 창고의 재료를 모두 보낸다(도구·장비는 남긴다)
        const keys = hereStore().filter((e) => !e.uid && data.items[e.item].kind === 'material').map((e) => keyOf(e));
        if (keys.length) game.dispatch({ type: 'SHIP', actor: PID, to: v, keys });
        break;
      }
      case 'contrib': {
        const [project, key] = v.split('>');
        stash(key);
        game.dispatch({ type: 'CONTRIBUTE', actor: PID, project, key });
        break;
      }
      case 'contrib-silver': game.dispatch({ type: 'CONTRIBUTE', actor: PID, project: v, silver: Number(n) }); break;
      case 'set-home': game.dispatch({ type: 'SET_HOME', actor: PID }); break;
      case 'speed': hud.settings.speed = Number(v); break;
      case 'body':
        hud.settings.body = v === 'f' ? 'f' : 'm';
        try {
          localStorage.setItem(BODY_KEY, hud.settings.body);
        } catch { /* 저장 못 해도 이번 판은 바꾼다 */ }
        actorsView.rebuild(PID);
        break;
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
    ground.applyTier(t);
    hud.settings.gfxNow = `${t.label} 화질`;
  }
  hud.settings.gfx = chosenTier();
  hud.settings.body = playerBody();
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
    for (const m of Object.values(state.mobs)) {
      if (m.mode !== 'dead' || m.skinned || state.t > m.deadAt + data.config.combat.corpseSec) continue;
      const dx = m.x - a.x;
      const dz = m.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d <= 2.6) consider(d - 0.5, dx, dz, { kind: 'corpse', id: m.id, x: m.x, z: m.z, m });
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
      const town = settlementAt({ state }, a);
      const live = town?.stations.find((x) => x.type === best.id);
      best.label = `${town ? town.name + ' ' : ''}${st.name}${live && live.tier >= 2 ? ' · 2단계' : live && (live.base ?? live.tier) > live.tier ? ' · 정비 불량(1단계로 일함)' : ''}`;
      best.verb = best.id === 'storage' ? '창고 열기' : '작업대 열기';
      best.radius = (st.r || 0.8) + 0.7;
    } else if (best.kind === 'corpse') {
      const type = data.creatures[best.m.type];
      best.label = `${type.name} 사체`;
      best.verb = '손질';
      best.radius = type.r + 0.4;
      if (a.skills.hunting.level < type.hunt.level) best.why = `수렵 ${type.hunt.level} 필요`;
    } else if (best.kind === 'market') {
      const town = settlementAt({ state }, a);
      best.label = `${town ? town.name + ' ' : ''}거래소`;
      best.verb = '사고팔기';
      best.radius = 2.0;
    } else {
      const town = settlementAt({ state }, a);
      best.label = `${town ? town.name + ' ' : '마을 '}게시판 — 주문·마을 사업·산지 소문`;
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
    mobsView.update(dt, view.camera);
    updateFloats(dt);
    {
      const z = zoneAt(region, a.x, a.z);
      if ((z?.id || null) !== ui.zone) {
        if (z && ui.zone !== undefined) hud.toast(`🌲 ${z.name} (T${z.tier}) — 늑대·멧돼지가 산다. 장비를 갖추자`, 'warn');
        ui.zone = z?.id || null;
      }
    }
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
    grass.update(sec, focusVec, G.uWind.value, firstFrame ? 999 : touch ? 1 : 2, firstFrame ? 1e9 : touch ? 1.5 : 2.5);
    flora.update(p.x, p.z);
    lantern.position.set(p.x, p.y + 1.9, p.z);
    lantern.intensity = 7 * nightK;
    nodesView.update();
    townView.update(sec, nightK, dt, focusVec);
    ui.target = a.ai?.on ? null : findTarget(a);
    const tg = ui.target;
    fx.setTarget(tg ? tg.x : null, tg ? ground.hf.height(tg.x, tg.z) : 0, tg?.z, tg && !tg.why && !tg.idle, tg?.radius);
    fx.update(dt, sec, { night: nightK, day: sky.day, player: focusVec });
    // 개척 일지 목표와 길잡이(0.3초마다 가장 가까운 목표를 다시 고른다)
    if (now - lastQuest > 300) {
      questNow = currentQuest(game, a);
      lastQuest = now;
    }
    const goal = questNow?.goal || null;
    guide.update(now / 1000, p, goal);
    hud.update(dt, { target: ui.target, gathering: !!ui.gather, quest: questNow, questDist: goal ? Math.hypot(goal.x - p.x, goal.z - p.z) : null });
    if (now - lastMap > 200) {
      minimap.draw(PID, cam.st.yaw, goal, now / 1000);
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

  await say('🌫️ 셰이더를 미리 준비하는 중…');
  mobsView.update(0, view.camera);
  await view.warm();

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
