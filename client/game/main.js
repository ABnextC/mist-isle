// 안개섬 개척기 — 3D 클라이언트 (v0.1부터).
// 코어(core/)를 브라우저에서 돌리고, 조작은 모두 명령(game.dispatch)으로 보낸다.

import * as THREE from 'three';
import { DATA_FILES, buildData } from '../../core/data.js';
import { createGame, loadGame } from '../../core/game.js';
import { dist, settlementAt, storeOf, workSpots } from '../../core/world.js';
import { avgProps, keyOf } from '../../core/inventory.js';
import { starOf } from '../../core/formulas.js';
import { stars, ERR, josa } from '../../core/text.js';
import { bondTier, isBirthday } from '../../core/systems/bonds.js';
import { seasonOf } from '../../core/systems/calendar.js';
import { createParticles } from './gfx/particles.js';
import { loadItemIcons } from './icons.js';
const nightK0 = (sky) => sky.night;
import { createScene } from './scene.js';
import { startTier, createAutoTuner, chosenTier, setChosenTier, TIERS } from './gfx/quality.js';
import { bakeMaterials, makeCanvasTextures } from './gfx/texgen.js';
import { createTerrain, setArea } from './gfx/terrain.js';
import { createWater } from './gfx/water.js';
import { createGrass } from './gfx/grass.js';
import { createFlora } from './gfx/flora.js';
import { makeMaterials, G } from './gfx/materials.js';
import { createNodesView } from './nodes-view.js';
import { createTownView } from './town-view.js';
import { createActorsView, playerBody, BODY_KEY } from './actors-view.js';
import { prepareActorBase, loadClassPack, ARMOR_CLASSES } from './models/actor.js';
import { createMobsView } from './mobs-view.js';
import { zoneAt, regionAt } from '../../core/terrain.js';
import { createFx } from './fx.js';
import { NODE_CHIP } from './models/nodes.js';
import { createCamera } from './camera.js';
import { createInput } from './input.js';
import { createHud, BULK_KEEP } from './hud.js';
import { refPrice, npcPrice, bestBid, bookOf, entryStar as marketStar } from '../../core/market.js';
import { createMinimap } from './minimap.js';
import { createGuide } from './guide.js';
import { createPerf } from './perf.js';
import { currentQuest, questCtx } from './quest.js';
import { talkDue, useDue, boardOffers, npcShown } from '../../core/systems/quests.js';
import { npcPos, objPos } from '../../core/world.js';
import { createShotsView } from './shots-view.js';
import { canWake } from '../../core/systems/mobs.js';
import { isUnlocked } from '../../core/systems/unlocks.js';
import { createNpcLabels } from './npc-labels.js';
import { createAudio, LEVELS } from './audio/index.js';
import { createRivalLabels } from './rival-labels.js';
import { createSiegeView } from './siege-view.js';
import { connectNet, netGame, wsUrl } from './net.js';
import { ownerInfo, tagOf, liveWarOf } from '../../core/systems/territory.js';

const SAVE_KEY = 'mist-isle:v1';
const OLD_KEY = 'mist-isle:v0';
let PID = 'p1'; // 멀티(v3.0)에선 서버가 정해 준다
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
  // 멀티 시험(v3.0): ?server=auto(같은 주소) 또는 ?server=주소:포트 로 서버에 붙는다
  const srvParam = params.get('server');
  const netBuf = { chats: [], status: [] };
  let net = null;
  let game;
  if (srvParam) {
    (bootEl.querySelector('.bootmsg') || bootEl).textContent = '서버에 붙는 중…';
    const name = (params.get('name') || readStore('mist-isle:netname') || '개척자').slice(0, 12);
    try {
      net = await connectNet({
        url: wsUrl(srvParam), name, id: readStore('mist-isle:netid'), data,
        onChat: (m) => (netBuf.onChat ? netBuf.onChat(m) : netBuf.chats.push(m)),
        onStatus: (s) => (netBuf.onStatus ? netBuf.onStatus(s) : netBuf.status.push(s)),
      });
    } catch (e) {
      (bootEl.querySelector('.bootmsg') || bootEl).textContent = `서버에 붙지 못했다: ${e.message}`;
      return;
    }
    try {
      localStorage.setItem('mist-isle:netid', net.pid);
      localStorage.setItem('mist-isle:netname', name);
    } catch { /* 저장 불가 */ }
    game = netGame(net);
    PID = net.pid;
  } else game = (!params.has('fresh') && restore(data)) || createGame({ data, seed: fixedSeed ?? Date.now() % 1_000_000_007 });
  game.pid = PID;
  window.__mist = { game, net };

  // 캐릭터 모양은 워커가 따로 깎는다(질감 굽기·지형 만들기와 나란히)
  const actorBase = prepareActorBase();
  const canvas = document.getElementById('view');
  const tier = startTier(touch);
  const say = async (msg) => {
    (bootEl.querySelector('.bootmsg') || bootEl).textContent = msg;
    await new Promise((r) => setTimeout(r, 30));
  };
  const ctex = makeCanvasTextures();
  const view = createScene(canvas, { tier, textures: ctex });
  const seasonNow = { tint: [1, 1, 1, 0], frost: 0, recolor: 0 };
  // 섬이 여럿(v0.6): 내가 있는 섬만 그린다. 다른 섬으로 건너가면 저장하고 다시 불러온다
  const region = regionAt(data.lists.regions, game.state.actors[PID].x);
  setArea(region.bounds);
  await loadItemIcons(); // 물건 아이콘(v2.2)
  await say('🌫️ 땅과 돌의 결을 굽는 중…');
  const tex = await bakeMaterials(view.renderer, { terrainSize: tier.texTerrain, objectSize: tier.texObject });
  const mats = makeMaterials(tex, ctex);
  await say('🌫️ 섬의 지형을 그리는 중…');
  const ground = createTerrain(view.scene, { terrain: game.terrain, region, tier, tex });
  const water = createWater(view.scene, { hf: ground.hf, tex, tier, still: region.zones?.find((z) => z.id === 'swamp')?.z0 ?? 1e9 });
  const flora = createFlora(view.scene, { hf: ground.hf, paths: ground.paths, ground, region, tier, mats, ctex, game });
  const grass = createGrass(view.scene, { hf: ground.hf, ground, tier });
  // 계절 입자(v2.0)
  const particles = createParticles(view.scene, { count: 900 });
  particles.setDensity(tier.id === 'low' ? 0.45 : tier.id === 'medium' ? 0.75 : 1);
  window.__mist.gfx = { view, tier, tex, mats, ground, flora, grass };
  const lantern = new THREE.PointLight(0xffd59a, 0, 11, 1.4); // 밤에 들고 다니는 등불
  view.scene.add(lantern);
  await say('🌫️ 마을과 숲을 세우는 중…');
  const nodesView = createNodesView(view.scene, game, ground.hf, { mats, ctex });
  const townView = createTownView(view.scene, game, ground.hf, { mats, terrain: game.terrain, region, me: () => game.state.actors[PID] });
  await say('🌫️ 개척자를 준비하는 중…');
  await actorBase;
  const actorsView = createActorsView(view.scene, game, ground.hf, view.camera);
  actorsView.setFar(touch ? 80 : 120);
  actorsView.prewarm();
  const floaters = document.createElement('div');
  floaters.id = 'floaters';
  document.body.appendChild(floaters);
  const mobsView = createMobsView(view.scene, game, ground.hf, floaters, { posOf: actorsView.positionOf, wakeHint: (type) => canWake(type, game.state.actors[PID]) });
  const rivalLabels = createRivalLabels(floaters, game, actorsView.positionOf, PID);
  const siegeView = createSiegeView(view.scene, game, ground.hf);
  window.__mist.mobsView = mobsView;
  const shotsView = createShotsView(view.scene, game, ground.hf);
  const npcLabels = createNpcLabels(floaters, game, actorsView.positionOf);
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
    actorsView.onEvent(ev);
    const m = game.state.mobs[ev.mob];
    const tall = m && data.creatures[m.type].body ? 2.0 : 1.4;
    if (m && ev.actor === PID) floatText(m.x, ground.hf.height(m.x, m.z) + tall, m.z, ev.blocked ? `${Math.round(ev.dmg * 10) / 10} 막음` : `${Math.round(ev.dmg)}${ev.crit ? '!' : ''}`, ev.blocked ? 'evade' : ev.dot ? 'dot' : ev.heavy || ev.crit || ev.ability ? 'big' : '');
  });
  // 무기 스킬(v1.1): 휘두른 자리에 파문, 기절하면 머리 위 표시
  game.on('combat.abilityHit', (ev) => {
    const kind = ev.kind;
    if (kind === 'shot' || kind === 'zone') return;
    const col = PJC[ev.proj] || (kind === 'buff' ? 0x9ff0d8 : kind === 'aoe' ? 0xffb050 : 0xffe0a0);
    const r = kind === 'aoe' ? ev.range : kind === 'buff' ? 1.6 : Math.min(3, ev.range * 0.7);
    const fx0 = kind === 'aoe' || kind === 'buff' ? 0 : r * 0.6;
    const x = ev.x + Math.sin(ev.yaw) * fx0;
    const z = ev.z + Math.cos(ev.yaw) * fx0;
    fx.wave(x, ground.hf.height(x, z), z, r, col, kind === 'aoe' ? 0.55 : 0.4);
    if (ev.hits && kind !== 'buff') fx.burst(x, ground.hf.height(x, z) + 0.2, z, 0x9a8a70, 6, { lift: 0, spread: r * 0.6, speed: 0.5, dust: true });
  });
  // 날아가는 것·땅 범위(v1.2): 터짐·불기둥·화살비·서리
  const PJC = { fire: 0xff7a2a, pillar: 0xff8a30, breath: 0xff9a40, ice: 0xbfe8ff, nova: 0xbfe8ff, frostarmor: 0xbfe8ff, rain: 0xe8dcc0, bolt: 0x9ad8ff, net: 0xd8d0b0 };
  game.on('arrow.hit', (ev) => {
    const c = PJC[(ev.proj || '').replace('_heavy', '')];
    if (c) fx.burst(ev.x, ground.hf.height(ev.x, ev.z) + 1.2, ev.z, c, 6, { lift: 0, spread: 0.3, speed: 0.6, dust: false });
  });
  game.on('arrow.explode', (ev) => {
    fx.wave(ev.x, ground.hf.height(ev.x, ev.z), ev.z, ev.r, PJC[ev.proj] || 0xff9a40, 0.5);
    fx.burst(ev.x, ground.hf.height(ev.x, ev.z) + 0.6, ev.z, PJC[ev.proj] || 0xff9a40, 14, { lift: 0.2, spread: ev.r * 0.6, speed: 0.9, dust: false });
  });
  game.on('zone.tick', (ev) => {
    const y = ground.hf.height(ev.x, ev.z);
    const c = PJC[ev.proj] || 0xffd08a;
    fx.wave(ev.x, y, ev.z, ev.r, c, 0.45);
    fx.burst(ev.x, y + (ev.proj === 'rain' ? 2.5 : 0.3), ev.z, c, ev.proj === 'pillar' ? 18 : 10, { lift: ev.proj === 'pillar' ? 1.2 : 0, spread: ev.r * 0.9, speed: ev.proj === 'pillar' ? 1.4 : 0.5, dust: ev.proj !== 'pillar' });
  });
  game.on('mob.fx', (ev) => {
    if (ev.actor !== PID || !ev.fx.includes('stun')) return;
    const m = game.state.mobs[ev.mob];
    if (m) floatText(m.x, ground.hf.height(m.x, m.z) + 2.4, m.z, '💫 기절', 'big');
  });
  game.on('mob.guardbreak', (ev) => {
    const m = game.state.mobs[ev.mob];
    if (m && ev.actor === PID) floatText(m.x, ground.hf.height(m.x, m.z) + 2.3, m.z, '막기 깨짐!', 'big');
  });
  // 약탈단 말(v0.5): 처음 덤빌 때 한마디, 두목은 단계가 바뀔 때
  const barkAt = new Map();
  function bark(m, line, cls = 'bark') {
    if (!line || !m) return;
    const now = performance.now();
    if (now - (barkAt.get(m.id) || 0) < 8000) return;
    barkAt.set(m.id, now);
    floatText(m.x, ground.hf.height(m.x, m.z) + 2.5, m.z, line, cls);
  }
  game.on('mob.aggro', (ev) => {
    const m = game.state.mobs[ev.mob];
    const T = m && data.creatures[m.type];
    if (!T?.barks || ev.actor !== PID || Math.hypot(m.x - me().x, m.z - me().z) > 30 || Math.random() > 0.6) return;
    bark(m, T.barks[Math.floor(Math.random() * T.barks.length)]);
  });
  // 센 공격 예고(v0.5): 사람 모양 적이 크게 휘두르려 하면 머리 위에 붉은 '!!'. 막을 수 없는 공격은 '⛔'
  game.on('mob.windup', (ev) => {
    if (!ev.heavy || ev.actor !== PID) return;
    const m = game.state.mobs[ev.mob];
    const T = m && data.creatures[m.type];
    // 사람 모양 적과 두목·정예 짐승(v0.5.1 돌 해태의 땅 울리기)
    if (!T?.body && !T?.boss && !T?.elite) return;
    const at = T.attacks.find((x) => x.id === ev.atk);
    floatText(m.x, ground.hf.height(m.x, m.z) + (T.body ? 2.35 : T.r * 2 + 1.0), m.z, at?.unblockable ? '⛔' : '‼', 'tele');
  });
  game.on('mob.phase', (ev) => {
    const m = game.state.mobs[ev.mob];
    if (m && ev.say) {
      barkAt.delete(m.id);
      bark(m, ev.say, 'bark big');
      hud.banner(`☠️ ${data.creatures[m.type].name}: “${ev.say}”`);
    } else if (m && ev.note && Math.hypot(m.x - me().x, m.z - me().z) < 40) hud.banner(`☠️ ${ev.note}`);
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
  window.__mist.actorsView = actorsView;
  {
    // 새 게임은 첫 목표(표류목·돌) 무리 쪽을 바라보고 시작한다. 이어 하기는 캐릭터가 보던 쪽.
    const a = game.state.actors[PID];
    let yaw = a.yaw || 0;
    if (game.state.t < 2) {
      // 새 게임은 첫 퀘스트 목표(등대지기) 쪽을 바라보고 시작한다
      const q = currentQuest(game, a);
      const town = region.settlements[0];
      const tx = q?.goal ? q.goal.x : town.x;
      const tz = q?.goal ? q.goal.z : town.z;
      yaw = Math.atan2(tx - a.x, tz - a.z);
    }
    cam.st.yaw = yaw;
  }

  const ui = { gather: null, skin: null, walked: null, last: { x: 0, z: 0, moving: false }, target: null };
  window.__mist.ui = ui; // 확인 도구용

  function save(say) {
    if (net) {
      if (say) hud.toast('🌐 멀티에서는 서버가 섬을 저장한다', 'info');
      return;
    }
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
      if (m.mode === 'dead' || m.mode === 'away') continue;
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

  // 다가가기: 대상 가운데에서 dist만큼 떨어진, 지금 서 있는 쪽 자리로 걷는다
  function walkTo(x, z) {
    game.dispatch({ type: 'MOVE', actor: PID, x, z });
  }
  function walkNear(x, z, d) {
    const a = game.state.actors[PID];
    const dx = a.x - x;
    const dz = a.z - z;
    const l = Math.hypot(dx, dz) || 1;
    walkTo(x + (dx / l) * d, z + (dz / l) * d);
  }

  function interact() {
    const t = ui.target;
    if (!t || t.why || t.idle) return;
    stopBot();
    if (t.kind === 'corpse') {
      // 사체 옆(칼이 닿는 거리)으로 걸어가서 벗긴다 — 아래 '이어서 캐기'에서
      ui.skin = t.id;
      ui.walked = null;
      return;
    }
    if (t.kind === 'node') {
      ui.gather = t.id;
      ui.walked = null;
    }
    else if (t.kind === 'station') {
      if (t.id === 'storage') hud.open('bag');
      else hud.open('craft', { station: t.id });
    } else if (t.kind === 'npc') {
      game.dispatch({ type: 'MOVE_INPUT', actor: PID, dx: 0, dz: 0 });
      // 호감도(v1.6): 말을 걸면 하루 한 번 인사로 정이 든다(못 하면 그냥 넘어간다)
      game.dispatch({ type: 'GREET', actor: PID, npc: t.id });
      hud.open('talk', { npc: t.id });
      ui.portrait = t.id; // 초상화(v2.0): 다음 그리기 전에 얼굴을 찍는다
    } else if (t.kind === 'obj') {
      // 배에 오르기(v0.6): 돌아올 수 없으니 먼저 묻는다
      if (data.objects[t.id]?.cross) hud.open('cross', { obj: t.id });
      else game.dispatch({ type: 'QUEST_USE', actor: PID, obj: t.id });
    } else if (t.kind === 'board') hud.open('board', { tab: boardOffers(questCtx(game), me()).length ? 'bounty' : undefined });
    else if (t.kind === 'market') hud.open('market');
    else if (t.kind === 'plot') hud.open('house', { plot: t.id });
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
      case 'faction-join': {
        game.dispatch({ type: 'FACTION_JOIN', actor: PID, faction: v });
        break;
      }
      case 'faction-task': {
        game.dispatch({ type: 'FACTION_TASK', actor: PID, task: v });
        break;
      }
      case 'guild-create': game.dispatch({ type: 'GUILD_CREATE', actor: PID, name: document.getElementById('guild-name')?.value || '' }); break;
      case 'guild-join': game.dispatch({ type: 'GUILD_JOIN', actor: PID, guild: v }); break;
      case 'guild-leave': game.dispatch({ type: 'GUILD_LEAVE', actor: PID }); break;
      case 'guild-hire': game.dispatch({ type: 'GUILD_HIRE', actor: PID, agent: v }); break;
      case 'guild-dismiss': game.dispatch({ type: 'GUILD_DISMISS', actor: PID, agent: v }); break;
      case 'guild-give': game.dispatch({ type: 'GUILD_GIVE', actor: PID, job: v }); break;
      case 'guild-put': game.dispatch({ type: 'GUILD_PUT', actor: PID, key: v }); break;
      case 'guild-take': game.dispatch({ type: 'GUILD_TAKE', actor: PID, key: v }); break;
      case 'house-buy': game.dispatch({ type: 'HOUSE_BUY', actor: PID, plot: v }); break;
      case 'house-up': game.dispatch({ type: 'HOUSE_UPGRADE', actor: PID }); break;
      case 'house-place': game.dispatch({ type: 'HOUSE_PLACE', actor: PID, uid: v }); break;
      case 'house-take': game.dispatch({ type: 'HOUSE_TAKE', actor: PID, uid: v }); break;
      case 'rest': game.dispatch({ type: 'REST', actor: PID }); break;
      case 'garden-plant': { const [slot, item] = String(v).split(':'); game.dispatch({ type: 'GARDEN_PLANT', actor: PID, slot: +slot, item }); break; }
      case 'garden-harvest': game.dispatch({ type: 'GARDEN_HARVEST', actor: PID, slot: +v }); break;
      case 'cross-go': {
        // 오가는 배(v0.9): 퀘스트로 타는 게 아니면 그냥 배를 탄다
        const viaQuest = !data.objects[v]?.ferry || useDue(questCtx(game), me(), v);
        game.dispatch({ type: viaQuest ? 'QUEST_USE' : 'FERRY', actor: PID, obj: v });
        hud.close();
        break;
      }
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
        const r = game.dispatch({ type: 'DODGE', actor: PID, yaw: L.moving ? Math.atan2(L.x, L.z) : Math.atan2(-fx, -fz) });
        if (!r.ok && r.error === 'overloaded') hud.toast('🏋️ 장비가 너무 무거워 구를 수 없다(과적). 무게를 줄이자', 'warn');
        break;
      }
      case 'block-on':
        stopBot();
        ui.gather = null;
        game.dispatch({ type: 'BLOCK', actor: PID, on: true, yaw: aimYaw() });
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
      case 'journal': hud.toggle('journal'); break;
      case 'talk-do': {
        // 이야기를 넘긴다: 끝난 퀘스트·이어진 퀘스트를 대화창 뒷장에 보여 준다
        doneBuf.length = 0;
        const due = talkDue(questCtx(game), a, v);
        const steps = due.map((id) => ({ id, step: a.quests.active[id].step }));
        if (game.dispatch({ type: 'TALK', actor: PID, npc: v }).ok) hud.open('talk', { npc: v, after: { done: doneBuf.splice(0), steps } });
        break;
      }
      case 'quest-accept':
        if (game.dispatch({ type: 'QUEST_ACCEPT', actor: PID, quest: v }).ok) hud.toast(`📜 「${data.quests[v].name}」을(를) 받았다`, 'good');
        break;
      case 'invite': {
        const r = game.dispatch({ type: 'INVITE', actor: PID, npc: v });
        if (!r.ok) hud.toast(ERR[r.error] || r.error, 'bad');
        else hud.close();
        break;
      }
      case 'ally-dismiss': game.dispatch({ type: 'DISMISS_ALLY', actor: PID }); break;
      case 'gift-open': hud.open('talk', { npc: hud.panel.npc, gift: true }); break;
      case 'gift-back': hud.open('talk', { npc: hud.panel.npc }); break;
      case 'gift': {
        const npc = hud.panel.npc;
        const r = game.dispatch({ type: 'GIFT', actor: PID, npc, key: v });
        if (!r.ok) hud.toast(ERR[r.error] || r.error, 'bad');
        break;
      }
      case 'quest-track': game.dispatch({ type: 'QUEST_TRACK', actor: PID, quest: v }); break;
      case 'menu': hud.toggle('menu'); break;
      case 'close': hud.close(); break;
      // v1.1: Esc는 창이 열려 있으면 닫고, 없으면 전체 메뉴를 연다
      case 'esc': if (hud.isOpen()) hud.close(); else hud.toggle('hub'); break;
      case 'hub': hud.toggle('hub'); break;
      case 'mastery': hud.toggle('mastery'); break;
      case 'char': hud.toggle('char'); break;
      case 'exped': hud.toggle('exped'); break;
      case 'territory': hud.toggle('territory'); break;
      case 'war-declare': game.dispatch({ type: 'WAR_DECLARE', actor: PID, settlement: v }); break;
      case 'war-seed': game.dispatch({ type: 'SEED_PLANT', actor: PID, settlement: v }); break;
      case 'war-supply': {
        const [war, key, qty] = String(v).split('>');
        game.dispatch({ type: 'WAR_SUPPLY', actor: PID, war, key, qty: Number(qty) });
        break;
      }
      case 'attr': {
        const [attr, n] = v.split(':');
        const r = game.dispatch({ type: 'ATTR_SPEND', actor: PID, attr, n: Number(n) });
        if (!r.ok) hud.toast(ERR[r.error] || r.error, 'bad');
        break;
      }
      case 'attr-reset': {
        const r = game.dispatch({ type: 'ATTR_RESET', actor: PID });
        if (!r.ok) hud.toast(ERR[r.error] || r.error, 'bad');
        break;
      }
      case 'exp-merc': {
        const s = (hud.panel.mercs ||= []);
        const i = s.indexOf(v);
        if (i >= 0) s.splice(i, 1);
        else if (s.length < 2) s.push(v);
        break;
      }
      case 'exp-start': {
        const r = game.dispatch({ type: 'EXP_START', actor: PID, ex: v, mercs: hud.panel.mercs || [] });
        if (!r.ok) hud.toast(ERR[r.error] || r.error, 'bad');
        else hud.close();
        break;
      }
      case 'exp-leave': game.dispatch({ type: 'EXP_LEAVE', actor: PID }); break;
      case 'learn-bp': {
        const r = game.dispatch({ type: 'LEARN_BP', actor: PID, key: v });
        if (!r.ok) hud.toast(ERR[r.error] || r.error, 'bad');
        break;
      }
      case 'skill0':
      case 'skill1':
      case 'skill2': {
        stopBot();
        ui.gather = null;
        game.dispatch({ type: 'ABILITY', actor: PID, slot: +act.slice(5), yaw: aimYaw() });
        break;
      }
      case 'swap': game.dispatch({ type: 'SWAP_WEAPON', actor: PID }); break;
      case 'pvp-flag': game.dispatch({ type: 'PVP_FLAG', actor: PID, on: v === '1' || v === 1 }); break;
      case 'vol': {
        // 소리 크기(v2.5): v = '갈래:단계'
        const [k, i] = String(v).split(':');
        audio.set(k, LEVELS[+i] ?? 0);
        hud.refresh?.();
        break;
      }
      case 'potion': {
        // 물약 바로 마시기(v2.4): 지금 가장 모자란 것부터 — 체력, 마나, 기력, 그다음 강건
        const cb = a?.cb;
        if (!cb) break;
        const has = (kind) => a.bag.find((e) => data.items[e.item].potion === kind);
        const order = [];
        if (cb.hp < cb.maxHp * 0.85) order.push('heal');
        if ((cb.mp ?? 100) < (cb.maxMp ?? 100) * 0.5) order.push('mana');
        if (cb.st < data.config.combat.stamina * 0.5) order.push('stamina');
        order.push('guard', 'heal', 'stamina', 'mana');
        const pick = order.map(has).find(Boolean);
        if (!pick) {
          hud.toast('🧪 가방에 물약이 없다 — 약제대에서 만든다', 'warn');
          break;
        }
        game.dispatch({ type: 'EAT', actor: PID, key: keyOf(pick) });
        break;
      }
      case 'learn': game.dispatch({ type: 'MASTERY_LEARN', actor: PID, node: v }); break;
      case 'lo-set': { const [w, slot, node] = String(v).split(':'); game.dispatch({ type: 'LOADOUT_SET', actor: PID, weapon: w, slot: +slot, node: node || null }); break; }
      case 'm-reset': game.dispatch({ type: 'MASTERY_RESET', actor: PID, weapon: v }); break;
      case 'equip-alt': game.dispatch({ type: 'EQUIP', actor: PID, uid: v, alt: true }); break;
      case 'unequip2': game.dispatch({ type: 'UNEQUIP', actor: PID, slot: 'weapon2' }); break;
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
      case 'fx-talkcam':
      case 'fx-particles': {
        const k = act === 'fx-talkcam' ? 'talkCam' : 'particles';
        hud.settings[k] = !hud.settings[k];
        try { localStorage.setItem('mist-isle:fx', JSON.stringify({ talkCam: hud.settings.talkCam, particles: hud.settings.particles })); } catch { /* 저장 못 해도 이번엔 적용 */ }
        break;
      }
      case 'perf': perf.toggle(); hud.settings.perf = perf.on; break;
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
        if (net) {
          hud.toast('🌐 멀티에서는 새 섬을 열 수 없다', 'warn');
          break;
        }
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
  window.__mist.hud = hud; // 확인 도구용
  window.__mist.onAct = (act, v, n) => onAct(act, v, n);
  // 소리(v2.5)
  const audio = createAudio(game, {
    pid: PID,
    heightAt: (x, z) => ground.hf.height(x, z),
    regionOf: (a) => regionAt(data.lists.regions, a.x),
    zoneOf: (a) => zoneAt(regionAt(data.lists.regions, a.x), a.x, a.z),
    townOf: (a) => settlementAt({ state: game.state }, a),
    camera: view.camera,
    cam,
  });
  hud.settings.audio = audio.settings;
  window.__mist.audio = audio;
  // 불 곁(모닥불·화덕·대장간·조리대)인지: 0.5초마다 잰다
  let fireK = 0;
  let fireAt = 0;
  const FIRE_ST = { forge: 1, smelter: 1, kitchen: 0.8 };
  function fireNear(p) {
    const now = performance.now();
    if (now - fireAt < 500) return fireK;
    fireAt = now;
    let best = 99;
    for (const o of game.statics) if (o.kind === 'campfire') best = Math.min(best, Math.hypot(o.x - p.x, o.z - p.z));
    for (const s of Object.values(game.state.settlements)) {
      if (Math.hypot(s.x - p.x, s.z - p.z) > 40) continue;
      for (const st of s.stations) if (FIRE_ST[st.type]) best = Math.min(best, Math.hypot(st.x - p.x, st.z - p.z) / FIRE_ST[st.type]);
    }
    fireK = Math.max(0, 1 - best / 8);
    return fireK;
  }
  let liveTier = tier;
  function applyTier(t) {
    liveTier = t;
    view.applyTier(t);
    actorsView.setDetail(t.charNear ?? 22);
    grass.applyTier(t);
    ground.applyTier(t);
    hud.settings.gfxNow = `${t.label} 화질`;
  }
  hud.settings.gfx = chosenTier();
  actorsView.setDetail(tier.charNear ?? 22);
  hud.settings.body = playerBody();
  hud.settings.gfxNow = `${tier.label} 화질`;
  const tuner = createAutoTuner((next, fps, dir) => {
    applyTier(next);
    if (dir === 'up') hud.toast(`그래픽카드에 여유가 있어(${Math.round(fps)}fps) 화질을 '${next.label}'으로 올렸다. 풀·지형 세밀도는 다음에 열 때 오른다.`, 'good');
    else hud.toast(`화면이 버거워 보여(${Math.round(fps)}fps) 화질을 '${next.label}'으로 낮췄다. 설정에서 바꿀 수 있다.`, 'info');
  });
  const perf = createPerf(view.renderer, { tierLabel: () => `${liveTier.label} 화질`, onGpu: (ms) => tuner.gpu(ms) });
  window.__mist.perf = perf;
  const input = createInput(canvas, { joyEl: hud.joyEl, knobEl: hud.knobEl });
  const minimap = createMinimap(hud.minimapCanvas, game, game.terrain);

  game.on('eat', (ev) => actorsView.onEvent(ev));
  // 도구가 닿을 때마다 작게 튄다(나무 부스러기·돌 조각·잎·열매), 나무·덤불은 잠깐 떤다(v0.4.9)
  const STRIKE_FX = { chop: 5, chop_tree: 6, mine: 6, harvest: 3, pick_bush: 2, pick_ground: 2, skin: 2 };
  function strikeFx() {
    for (const s of actorsView.takeStrikes()) {
      const n = STRIKE_FX[s.kind];
      if (!n) {
        audio.onStrike(s);
        continue;
      }
      const color = s.nodeType ? NODE_CHIP[s.nodeType] : 0x7a3a2a;
      fx.burst(s.x, s.y, s.z, color, n, { lift: 0, spread: 0.12, speed: 0.45, dust: s.kind === 'mine' || s.kind === 'chop' });
      if (s.node) nodesView.shake(s.node);
      audio.onStrike(s);
    }
  }
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
    // NPC(v0.5)와 지금 퀘스트에 필요한 물체(궤짝·보급 상자·탁자)
    for (const o of game.statics) {
      if (o.kind === 'npc') {
        const dx = o.x - a.x;
        const dz = o.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d <= 3.3 && npcShown(questCtx(game), me(), o.npc)) consider(d - 0.6, dx, dz, { kind: 'npc', id: o.npc, x: o.x, z: o.z });
      } else if (o.obj) {
        const dx = o.x - a.x;
        const dz = o.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d <= 2.5 && useDue(questCtx(game), a, o.obj)) consider(d - 0.8, dx, dz, { kind: 'obj', id: o.obj, x: o.x, z: o.z, okind: o.kind });
      } else if (o.plot && isUnlocked(questCtx(game), a, 'housing')) {
        // 내 집·집터(v0.8)
        const dx = o.x - a.x;
        const dz = o.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d <= o.r + 3) consider(d - o.r, dx, dz, { kind: 'plot', id: o.plot, x: o.x, z: o.z });
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
      best.verb = type.skill === 'fishing' ? '낚기' : '캐기';
      if (type.night && !game.clock.isNight(state.t)) best.label += ' — 밤에만 핀다';
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
    } else if (best.kind === 'npc') {
      const n = data.npcs[best.id];
      const due = talkDue(questCtx(game), a, best.id).length;
      best.label = `${n.title} ${n.name}${due ? ' — 할 이야기가 있다' : ''}`;
      best.verb = '대화';
      best.radius = 0.6;
    } else if (best.kind === 'obj') {
      best.label = data.objects[best.id].name;
      best.verb = data.objects[best.id].verb || { chest: '열기', supply: '되찾기', papers: '뒤지기', brazier: '불 넣기', door: '오르기' }[best.okind] || '살피기';
      best.radius = 0.8;
    } else if (best.kind === 'plot') {
      const h = state.houses[best.id];
      best.label = h ? (h.owner === PID ? '🏠 내 집' : '남의 집') : '🪧 빈 집터';
      best.verb = h ? '들어가기' : '살펴보기';
      best.radius = 2.4;
    } else if (best.kind === 'market') {
      const town = settlementAt({ state }, a);
      best.label = `${town ? town.name + ' ' : ''}거래소`;
      best.verb = '사고팔기';
      best.radius = 2.0;
    } else {
      const town = settlementAt({ state }, a);
      // 잠긴 기능(v0.5.2)은 빼고 보인다
      const qc = questCtx(game);
      const feats = [isUnlocked(qc, a, 'orders') && '주문', '현상금', isUnlocked(qc, a, 'projects') ? '마을 사업' : '마을', isUnlocked(qc, a, 'rumors') && '산지 소문', isUnlocked(qc, a, 'guild') && '조합'].filter(Boolean);
      best.label = `${town ? town.name + ' ' : '마을 '}게시판 — ${feats.join('·')}`;
      best.verb = '보기';
      best.radius = 1.2;
    }
    return best;
  }

  // 화면 위 큰 체력 막대(v0.5): 나와 싸우는 부두목·두목
  function bossNow(a) {
    let best = null;
    for (const m of Object.values(game.state.mobs)) {
      const T = data.creatures[m.type];
      if (!(T.boss || T.elite) || m.mode === 'dead' || m.mode === 'away') continue;
      if (m.target !== PID && m.hp >= T.hp) continue;
      if (Math.hypot(m.x - a.x, m.z - a.z) > 35) continue;
      if (!best || T.boss) best = { name: `Lv ${T.level ?? '?'} ${T.name}`, hp: m.hp, max: T.hp, boss: !!T.boss, phase: m.phase || 0 };
    }
    return best;
  }

  // 퀘스트 알림(v0.5)
  const doneBuf = [];
  game.on('quest.done', (ev) => {
    if (ev.actor !== PID) return;
    doneBuf.push(ev);
    const q = data.quests[ev.quest];
    hud.banner(`✅ 퀘스트 완료 · ${q.name}`);
  });
  // 호감도(v1.6)
  game.on('bond.gift', (ev) => {
    if (ev.actor !== PID || hud.panel?.kind !== 'talk') return;
    hud.open('talk', { npc: ev.npc, gift: true, react: ev });
  });
  // 멀티(v3.0): 들어옴·나감·말하기·연결 상태
  if (net) {
    const chatBox = document.createElement('div');
    chatBox.className = 'netchat';
    chatBox.innerHTML = '<div class="lines"></div><input maxlength="140" placeholder="Enter로 말하기 · Esc 닫기">';
    document.body.appendChild(chatBox);
    const lines = chatBox.firstChild;
    const inputEl = chatBox.lastChild;
    const addLine = (html) => {
      const d = document.createElement('div');
      d.innerHTML = html;
      lines.appendChild(d);
      while (lines.children.length > 6) lines.firstChild.remove();
      setTimeout(() => d.classList.add('old'), 20000);
    };
    const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    netBuf.onChat = (m) => addLine(`<b>${escH(m.name)}</b> ${escH(m.text)}`);
    netBuf.onStatus = (s) => {
      if (s.kind === 'closed') hud.banner('🌐 서버와 끊겼다 — 새로 고침하면 다시 붙는다', 8000);
      else if (s.kind === 'resync') hud.toast('🌐 섬을 다시 맞추는 중…', 'info');
      else if (s.kind === 'error') hud.toast(`🌐 서버: ${s.error}`, 'warn');
    };
    for (const m of netBuf.chats) netBuf.onChat(m);
    for (const s of netBuf.status) netBuf.onStatus(s);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (document.activeElement === inputEl) {
        const text = inputEl.value.trim();
        if (text) net.chat(text);
        inputEl.value = '';
        inputEl.blur();
        chatBox.classList.remove('typing');
      } else if (!document.activeElement || document.activeElement === document.body) {
        chatBox.classList.add('typing');
        inputEl.focus();
        e.preventDefault();
      }
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        inputEl.blur();
        chatBox.classList.remove('typing');
      }
      e.stopPropagation();
    });
    game.on('net.join', (ev) => { if (ev.actor !== PID) addLine(`<i>🌐 ${escH(ev.name)} 들어옴</i>`); });
    game.on('net.leave', (ev) => { if (ev.actor !== PID) addLine(`<i>🌐 ${escH(ev.name)} 나감</i>`); });
    addLine(`<i>🌐 서버에 붙었다 — ${escH(game.state.actors[PID].name)} (${PID}) · 함께 ${[...net.players.keys()].length}명</i>`);
  }
  // 영지전(v2.7)
  const qc = () => questCtx(game);
  const townOf = (sid) => game.state.settlements[sid]?.name || sid;
  const myTag = () => tagOf(qc(), game.state.actors[PID]);
  game.on('war.declare', (ev) => {
    const A = ownerInfo(qc(), ev.att);
    const D = ownerInfo(qc(), ev.def);
    const mine = ev.att === myTag() || ev.def === myTag();
    const left = Math.round((ev.at - game.state.t) / 60);
    if (mine) hud.banner(`${ev.att === myTag() ? '⚔️ 선전포고' : '🛡️ 우리 영지에 선전포고'} — ${townOf(ev.settlement)} · 공성까지 ${left}분 (T)`, 4200);
    else hud.toast(`🏰 ${A.icon} ${A.name}이(가) ${D.icon} ${D.name}의 ${townOf(ev.settlement)}에 선전포고했다`, 'info', 5000);
  });
  game.on('war.siege', (ev) => {
    if (ev.att === myTag() || ev.def === myTag()) hud.banner(`🔥 공성 시작 — ${townOf(ev.settlement)} · 깃발을 ${ev.att === myTag() ? '차지하라' : '지켜라'}`, 3600);
  });
  game.on('war.end', (ev) => {
    const mine = ev.att === myTag() || ev.def === myTag();
    const W0 = ownerInfo(qc(), ev.owner);
    if (mine) {
      const won = (ev.winner === 'att') === (ev.att === myTag());
      hud.banner(won ? `🏆 ${townOf(ev.settlement)} — ${ev.att === myTag() ? '차지했다! 우리 영지다' : '지켜냈다'}` : `🏳️ ${townOf(ev.settlement)} — ${ev.att === myTag() ? '공성 실패' : '빼앗겼다'}${ev.how === 'auto' ? '(물자 셈)' : ''}`, 4200);
    } else hud.toast(`🏰 ${townOf(ev.settlement)}: ${W0.icon} ${W0.name}의 영지${ev.winner === 'att' ? '가 됐다' : '로 남았다'}`, 'info', 4500);
  });
  game.on('war.tax', (ev) => { if (ev.members.includes(PID)) hud.toast(`🪙 ${townOf(ev.settlement)} 세금 +${ev.each}`, 'good'); });
  game.on('war.seed', (ev) => { if (ev.actor === PID) hud.banner(`🌱 ${townOf(ev.settlement)}에 영토 씨앗을 심었다 — 그 땅 채집량 +10%`, 3600); });
  game.on('war.supply', (ev) => { if (ev.actor === PID) hud.toast(`📦 전쟁 물자 +${ev.points}점 (모두 ${Math.round(ev.total)}점)`, 'good'); });
  // 필드 PvP(v2.6)
  game.on('pvp.flag', (ev) => {
    if (ev.actor !== PID) return;
    hud.toast(ev.on ? '⚔️ 깃발을 올렸다 — 다른 세력과 겨룰 수 있다. 채집·숙련 +10%' : '🏳️ 깃발을 내렸다', ev.on ? 'warn' : 'info');
  });
  game.on('rival.aggro', (ev) => {
    if (ev.target !== PID) return;
    const r = game.state.actors[ev.actor];
    const band = r && data.rivals.bands.find((b) => b.id === r.rival.band);
    if (r) hud.toast(`⚔️ ${band?.name || r.rival.title || '다른 세력'} ${josa(r.name, '이', '가')} 덤빈다 (Lv ${r.clevel.lvl})`, 'warn');
  });
  game.on('pvp.down', (ev) => {
    if (ev.actor !== PID) return;
    const lost = ev.taken.map((x) => `${data.items[x.item].name} ×${x.qty}`).join(', ');
    setTimeout(() => hud.toast(`🩸 사람에게 쓰러졌다${lost ? ` — 빼앗긴 것: ${lost}` : ''}. 쓰러뜨리면 되찾는다`, 'warn', 6000), 800);
  });
  game.on('rival.fall', (ev) => {
    if (ev.by !== PID) return;
    const got = [`🪙 ${ev.silver}`, ...ev.loot.map((x) => `${data.items[x.item].name} ×${x.qty}`)].join(' · ');
    hud.toast(`🏆 ${josa(ev.name || '상대', '을', '를')} 쓰러뜨렸다 — ${got}`, 'good', 5000);
  });
  // 물약(v2.4)
  game.on('potion', (ev) => {
    if (ev.actor !== PID) return;
    const def = data.items[ev.item];
    const what = ev.kind === 'heal' ? `체력 +${ev.value}` : ev.kind === 'mana' ? `마나 +${ev.value}` : ev.kind === 'stamina' ? `기력 회복 ↑ ${ev.sec}초` : `받는 피해 −${Math.round(ev.power * 100)}% ${ev.sec}초`;
    hud.toast(`🧪 ${def.name} — ${what}`, 'good');
  });
  // 전투 레벨·원정(v2.3)
  game.on('level.up', (ev) => {
    if (ev.actor !== PID) return;
    hud.banner(`⭐ 전투 레벨 ${ev.lvl} — 능력치 점수 ${ev.points} (P)`, 3200);
    fx.levelUp?.();
  });
  game.on('exp.start', (ev) => {
    if (ev.actor !== PID) return;
    const ex = data.expeditions[ev.ex];
    hud.banner(`${ex.icon} ${ex.name}`, 2600);
  });
  game.on('exp.wave', (ev) => {
    if (ev.actor !== PID) return;
    if (ev.boss) hud.banner(`☠️ ${ev.name}`, 2600);
    else if (ev.wave > 1) hud.toast(`⚔️ 물결 ${ev.wave}/${ev.waves}`, 'info');
  });
  game.on('exp.clear', (ev) => {
    if (ev.actor !== PID) return;
    const ex = data.expeditions[ev.ex];
    hud.banner(`🏆 ${ex.name} 공략 — ${Math.floor(ev.sec / 60)}분 ${ev.sec % 60}초`, 3600);
    const parts = [`🪙 ${ev.silver}`, `⭐ ${ev.xp}`, ...ev.items.map((x) => `${data.items[x.item].name} ×${x.qty}`)];
    setTimeout(() => hud.toast(`${ev.first ? '오늘 첫 공략' : '다시 공략(보상 절반)'} · ${parts.join(' · ')}`, 'good', 8000), 1500);
    if (ev.bp) setTimeout(() => hud.banner(`📘 ${data.items[ev.bp].name}!`, 3400), 4200);
  });
  game.on('exp.fail', (ev) => {
    if (ev.actor !== PID) return;
    const why = { down: '쓰러졌다', left: '원정지를 떠났다', time: '시간이 다 됐다' }[ev.reason] || '그만뒀다';
    hud.toast(`🏳️ 원정 실패 — ${why}. 잃은 것은 없다`, 'warn', 5000);
  });
  game.on('blueprint.learn', (ev) => {
    if (ev.actor !== PID) return;
    hud.toast(`📘 「${data.recipes[ev.recipe].name}」 제작법을 익혔다 — ${data.stations[data.recipes[ev.recipe].station].name}에서 만든다`, 'good', 6000);
  });
  game.on('bond.thanks', (ev) => {
    if (ev.actor !== PID) return;
    hud.toast(`🎁 ${josa(data.npcs[ev.npc].name, '이', '가')} 답례로 ${data.items[ev.item].name} ${ev.qty}개를 줬다`, 'good');
  });
  const LEAVE = { time: '해가 기울어 마을로 돌아갔다', down: '다쳐서 마을로 돌아갔다', far: '멀리 떠나는 길엔 따라오지 못했다', sent: '마을로 돌아갔다' };
  game.on('ally.join', (ev) => {
    if (ev.actor !== PID) return;
    hud.banner(`🏹 ${josa(data.npcs[ev.npc].name, '이', '가')} 같이 나섰다 · ${Math.round(data.config.bond.companionSec / 60)}분`);
  });
  game.on('ally.leave', (ev) => {
    if (ev.actor !== PID) return;
    hud.toast(`🏹 ${josa(data.npcs[ev.npc].name, '은', '는')} ${LEAVE[ev.reason] || LEAVE.sent}`, 'info');
  });
  // 계절·장날(v1.8)
  game.on('season.start', (ev) => {
    const s = data.config.calendar.seasons.find((x) => x.id === ev.season);
    hud.banner(`${s.icon} ${s.name}이 왔다`);
    setTimeout(() => hud.toast(`${s.icon} ${s.say}`, 'info', 7000), 1800);
  });
  game.on('market.day', () => {
    setTimeout(() => hud.toast('🏮 장날이다. 오늘은 거래소 수수료·판매세가 절반이고, 오늘의 부탁 은화가 1.5배다', 'info', 7000), 1200);
  });
  game.on('day.start', () => {
    const a = me();
    if (!a?.bonds) return;
    const qc = questCtx(game);
    const who = Object.keys(a.bonds).filter((id) => bondTier(qc, a, id) >= 1 && isBirthday(qc, id));
    if (who.length) setTimeout(() => hud.toast(`🎂 오늘은 ${who.map((id) => data.npcs[id].name).join('·')}의 생일이다. 선물하면 정이 곱절로 든다`, 'info', 7000), 3000);
  });
  game.on('bond.tier', (ev) => {
    if (ev.actor !== PID) return;
    const n = data.npcs[ev.npc];
    hud.banner(`${'♥'.repeat(ev.tier)} ${josa(n.name, '과', '와')} ${josa(ev.name, '이', '가')} 되었다`);
  });
  game.on('quest.start', (ev) => {
    if (ev.actor !== PID || game.state.t < 2) return;
    const q = data.quests[ev.quest];
    if (q.kind !== 'main') return;
    // 대화창 뒷장에 안내가 뜨지 않는 시작(물체·쓰러뜨리기로 끝난 퀘스트 다음, 불러온 세이브)은 이야기 첫머리를 길게 보여 준다
    const talking = hud.panel?.kind === 'talk';
    const text = !talking && q.intro?.length ? `🌫️ ${q.intro.join(' ')} ▶ ${q.steps[0].text}` : `📜 ${q.name} — ${q.steps[0].text}`;
    setTimeout(() => hud.toast(text, 'info', Math.min(9000, 2600 + text.length * 45)), 2400);
  });
  game.on('quest.step', (ev) => {
    if (ev.actor !== PID) return;
    const q = data.quests[ev.quest];
    hud.toast(`📜 ${q.steps[ev.step].text}`, 'info');
  });
  game.on('quest.use', (ev) => {
    if (ev.actor !== PID) return;
    const it = ev.gives && data.questItems[ev.gives];
    hud.feed(it ? `${it.name}${ev.need > 1 ? ` (${ev.n}/${ev.need})` : ''}` : `✔ ${data.objects[ev.obj].name}`, it ? { id: ev.gives, icon: it.icon } : null);
    actorsView.onEvent(ev);
  });
  game.on('quest.progress', (ev) => {
    if (ev.actor !== PID) return;
    const q = data.quests[ev.quest];
    const st = q.steps[me().quests.active[ev.quest]?.step ?? 0];
    if (st && ev.n < ev.need) hud.feed(`📜 ${st.text} ${ev.n}/${ev.need}`);
  });
  // 막기 단계의 적: 약탈단이면 습격대, 망령이면 망령(v0.5.1)
  const defendStep = (qid) => data.quests[qid]?.steps.find((s) => s.type === 'defend');
  const raidersIn = (st) => st?.waves.some((w) => Object.keys(w).some((k) => data.creatures[k].faction));
  game.on('quest.wave', (ev) => {
    if (ev.actor !== PID) return;
    hud.banner(`${raidersIn(defendStep(ev.quest)) ? '⚔️ 습격대가 온다!' : '👻 망령이 몰려온다!'} (${ev.wave}/${ev.waves}물결)`);
  });
  game.on('quest.fail', (ev) => {
    if (ev.actor !== PID) return;
    const st = defendStep(ev.quest);
    hud.toast(`⚠️ 막지 못했다. ${data.sites[st?.site]?.name ?? '그 자리'}(으)로 다시 가면 처음부터 막는다`, 'warn');
  });
  // 이어질 이야기(v0.6): 장이 끝나지 않았는데 다음 퀘스트가 아직 없다
  game.on('story.pause', (ev) => {
    if (ev.actor !== PID) return;
    setTimeout(() => hud.banner('📜 이야기는 여기까지 — 다음 패치에 이어진다', 4200), 2600);
  });
  // 안개 벽 건너기(v0.6): 새 섬을 그리려면 저장하고 다시 불러온다
  game.on('cross', (ev) => {
    if (ev.actor !== PID) return;
    const fade = document.createElement('div');
    fade.className = 'crossfade';
    fade.textContent = ev.ferry ? '⛵ 배로 건너는 중…' : '🌫️ 안개 벽을 건너는 중…';
    document.body.appendChild(fade);
    if (net) {
      // 멀티: 서버가 내 자리를 쥐고 있다. 다시 붙으면 새 섬이 그려진다
      setTimeout(() => location.reload(), 1800);
      return;
    }
    let saved = false;
    try {
      localStorage.setItem(SAVE_KEY, game.save());
      saved = true;
    } catch (e) { /* 저장이 안 되는 브라우저 */ }
    if (!saved) {
      fade.textContent = '저장할 수 없는 브라우저라 새 섬을 그리지 못한다. 저장이 되는 브라우저에서 이어 가자.';
      return;
    }
    setTimeout(() => {
      const u = new URL(location.href);
      u.searchParams.delete('fresh');
      location.replace(u.toString());
    }, 1800);
  });
  game.on('chapter.done', (ev) => {
    if (ev.actor !== PID) return;
    const ch = data.chapters.find((c) => c.id === ev.chapter);
    setTimeout(() => hud.banner(`🏁 ${ch.name} 끝 — ${ch.after}`, 4600), 2600);
  });
  game.on('loot', (ev) => {
    if (ev.actor !== PID) return;
    const parts = [];
    if (ev.silver) parts.push(`🪙 +${ev.silver}`);
    for (const x of ev.items) parts.push(`${data.items[x.item].name} ×${x.qty}`);
    if (parts.length) hud.feed(parts.join(' · '), ev.items[0] ? data.items[ev.items[0].item] : null);
    if (ev.lost) hud.toast('🎒 가방이 가득 차서 전리품 일부를 버렸다', 'warn');
  });
  game.on('shot.end', (ev) => fx.burst(ev.x, ground.hf.height(ev.x, ev.z) + 0.2, ev.z, 0x7a6a58, 4, { lift: 0, spread: 0.1, speed: 0.4, dust: true }));

  let last = performance.now();
  let lastSave = performance.now();
  let lastMap = 0;
  let firstFrame = true;
  let booted = false;
  const focusVec = new THREE.Vector3();

  function frame(now, silent = false) {
    // rAF 시각은 긴 작업(예열) 직후에 앞서 잰 시각보다 이를 수 있다: 음수 dt를 막는다
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = Math.max(last, now);
    const a = me();
    perf.begin(now);

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

    // 2) 이어서 캐기 — 도구가 닿는 거리(nodes.json work)로 먼저 걸어간다(v0.4.9)
    if (moving) ui.skin = null;
    if (ui.gather) {
      const n = game.state.nodes[ui.gather];
      if (!n || n.charges <= 0) ui.gather = null;
      else if (!a.action && !a.move && !a.dest) {
        const d = dist(a, n);
        const work = data.nodes[n.type].work ?? 1;
        if (d > data.config.gather.rangeM) ui.gather = null;
        else if (Math.abs(d - work) > data.config.gather.workSlackM && ui.walked !== n.id) {
          ui.walked = n.id;
          walkNear(n.x, n.z, work);
        } else {
          const useFocus = hud.settings.focus && a.focus >= data.config.focus.cost.gather;
          if (!game.dispatch({ type: 'GATHER', actor: PID, node: n.id, focus: useFocus }).ok) ui.gather = null;
        }
      }
    }
    if (ui.skin) {
      const m = game.state.mobs[ui.skin];
      if (!m || m.mode !== 'dead' || m.skinned) ui.skin = null;
      else if (!a.action && !a.move && !a.dest) {
        const d = dist(a, m);
        const work = data.config.gather.skinWorkM;
        if (d > 3) ui.skin = null;
        else if (Math.abs(d - work) > data.config.gather.workSlackM && ui.walked !== m.id) {
          ui.walked = m.id;
          // 몸통 옆쪽(등뼈와 직각, 내가 있는 쪽)에 무릎 꿇는다
          const sx = Math.cos(m.yaw);
          const sz = -Math.sin(m.yaw);
          const side = (a.x - m.x) * sx + (a.z - m.z) * sz >= 0 ? 1 : -1;
          walkTo(m.x + sx * side * work, m.z + sz * side * work);
        } else {
          game.dispatch({ type: 'SKIN', actor: PID, mob: m.id });
          ui.skin = null;
        }
      }
    }
    // 제작: 작업대 일감이 돌기 시작했는데 4m 안에서 쉬고 있으면, 그 작업대의 빈 일자리로 한 번 걸어간다(v0.4.9)
    const job = a.queue?.[0];
    if (job && ui.craftWalked !== job.id && !moving && !ui.gather && !ui.skin && !a.action && !a.move && !a.dest && job.startsAt <= game.state.t) {
      ui.craftWalked = job.id;
      const r = data.recipes[job.recipe];
      let best = null;
      let bd = data.config.craft.rangeM;
      if (r && r.station !== 'hand') {
        for (const s of Object.values(game.state.settlements)) {
          for (const st of s.stations) {
            if (st.type !== r.station || dist(a, st) > data.config.craft.rangeM) continue;
            for (const p of workSpots(data, st)) {
              const taken = Object.values(game.state.actors).some((o) => o.id !== PID && Math.hypot(o.x - p.x, o.z - p.z) < 0.6);
              const d = Math.hypot(a.x - p.x, a.z - p.z);
              if (!taken && d < bd) {
                bd = d;
                best = p;
              }
            }
          }
        }
      }
      if (best && bd > 0.3) walkTo(best.x, best.z);
    }

    // 3) 시뮬레이션
    game.advance(dt * hud.settings.speed);
    if (!silent) tuner.tick(dt, liveTier);
    perf.lap('sim');

    // 4) 화면
    actorsView.update(dt, now / 1000);
    strikeFx();
    mobsView.update(dt, view.camera);
    rivalLabels.update(view.camera);
    siegeView.update(now / 1000);
    shotsView.update();
    npcLabels.update(view.camera, a);
    updateFloats(dt);
    // 밤이 오면 한 번 알린다(안개 늑대)
    {
      const night = game.clock.isNight(game.state.t);
      if (night && ui.night === false) hud.toast('🌙 밤이 왔다. 마을 사이 들판에 안개 늑대와 망령이 돈다.', 'warn');
      ui.night = night;
    }
    {
      const z = zoneAt(region, a.x, a.z);
      if ((z?.id || null) !== ui.zone) {
        if (z && ui.zone !== undefined) hud.toast(`${z.icon || '🌲'} ${z.name} (T${z.tier}) — ${z.enter || ''}`, 'warn');
        ui.zone = z?.id || null;
        view.setFog(z?.fog || 1);
      }
    }
    const p = actorsView.positionOf(PID);
    // 대화 장면(v2.0): 말 상대와 나를 어깨 너머로 잡는다
    let ov = null;
    if (hud.panel?.kind === 'talk' && hud.settings.talkCam !== false) {
      const q = actorsView.positionOf(`npc:${hud.panel.npc}`);
      if (q && Math.hypot(q.x - p.x, q.z - p.z) < 8) {
        const th = Math.atan2(q.x - p.x, q.z - p.z);
        const wide = window.innerWidth > 720;
        ov = { x: p.x + (q.x - p.x) * 0.62, y: Math.max(p.y, q.y) + 1.35, z: p.z + (q.z - p.z) * 0.62, yaw: th + (wide ? 0.62 : 0.4), dist: wide ? 4.6 : 5.2, pitch: 0.16 };
      }
    }
    cam.update(dt, p.x, p.y, p.z, ov);
    focusVec.set(p.x, p.y, p.z);
    const t = game.state.t;
    const sec = now / 1000;
    G.uTime.value = sec;
    G.uWind.value = 0.75 + 0.35 * Math.sin(sec * 0.13) * Math.sin(sec * 0.051 + 1.3);
    const sky = view.setTime(game.clock.phase(t), game.clock.dayFrac, focusVec, sec, now);
    // 계절 색(v1.8): 계절이 바뀌면 천천히 옮긴다
    {
      const sn = seasonOf(questCtx(game));
      if (!seasonNow.id) Object.assign(seasonNow, { tint: [...sn.tint], frost: sn.frost, recolor: sn.recolor || 0 });
      seasonNow.recolor += ((sn.recolor || 0) - seasonNow.recolor) * Math.min(1, dt * 0.5);
      G.uRecolor.value = seasonNow.recolor;
      seasonNow.id = sn.id;
      seasonNow.tint = seasonNow.tint.map((v, i) => v + (sn.tint[i] - v) * Math.min(1, dt * 0.5));
      seasonNow.frost += (sn.frost - seasonNow.frost) * Math.min(1, dt * 0.5);
      G.uSeason.value.set(...seasonNow.tint);
      G.uFrost.value = seasonNow.frost;
      const cp = view.camera.position;
      particles.mesh.visible = hud.settings.particles !== false;
      particles.update(sn.id, nightK0(sky), cp, ground.hf.height(cp.x, cp.z), sec, dt, view.renderer.domElement.height);
    }
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
    perf.lap('view');
    const bossInfo = bossNow(a);
    hud.update(dt, { target: ui.target, gathering: !!ui.gather, quest: questNow, questDist: goal ? Math.hypot(goal.x - p.x, goal.z - p.z) : null, boss: bossInfo });
    audio.update(dt, { night: nightK, fire: fireNear(p), boss: !!bossInfo?.boss, siege: !!liveWarOf(questCtx(game), a) });
    if (now - lastMap > 200) {
      minimap.draw(PID, cam.st.yaw, goal, now / 1000);
      lastMap = now;
    }
    perf.lap('hud');
    perf.drawBegin();
    // 초상화(v2.0)
    if (ui.portrait) {
      const id = ui.portrait;
      ui.portrait = null;
      const p = actorsView.positionOf(`npc:${id}`);
      const a = me();
      if (p && a) {
        const head = new THREE.Vector3(p.x, p.y + 1.58, p.z);
        const d = Math.hypot(a.x - p.x, a.z - p.z) || 1;
        const from = new THREE.Vector3(p.x + ((a.x - p.x) / d) * 1.05, p.y + 1.66, p.z + ((a.z - p.z) / d) * 1.05);
        try { hud.setPortrait(id, view.portrait(head, from)); } catch { /* 초상화 없이 간다 */ }
      }
    }
    view.render();
    perf.drawEnd();
    perf.end(now);
    if (silent) {
      firstFrame = false; // 풀은 조용한 첫 장에서 다 채웠다
      return;
    }

    if (now - lastSave > 30000) {
      save(false);
      lastSave = now;
    }
    if (!booted) {
      booted = true;
      firstFrame = false;
      bootEl.classList.add('gone');
      setTimeout(() => bootEl.remove(), 900);
      if (game.state.t < 2) {
        const q0 = data.quests[data.chapters[0].quests[0]];
        hud.toast(`🌫️ ${q0.intro.join(' ')}`, 'info');
      }
    }
    requestAnimationFrame(frame);
  }

  // 미리 데우기: 한 장을 조용히 그려 캐릭터·짐승·풀·하늘 반사광을 다 만든 뒤, 섬 전체를 한 번 그린다(셰이더·그림자·올리기)
  await say('🌫️ 셰이더를 미리 준비하는 중… (컴퓨터에 따라 수십 초 걸릴 수 있다)');
  mobsView.update(0, view.camera);
  frame(performance.now(), true);
  // ?nowarm: 시험용(소프트웨어 렌더러에서 섬 전체 미리 그리기를 건너뛴다)
  const warmInfo = params.has('nowarm') ? { skipped: true } : await view.warm({ extra: actorsView.warmExtras?.() || [], say: () => say('🌫️ 섬 전체를 한 번 그려 보는 중…') });
  window.__mist.warm = warmInfo;
  console.info('[warm]', warmInfo);
  // 갑옷 옷 조각 묶음은 게임을 시작한 뒤 천천히 미리 받아 둔다(갈아입을 때 바로 바뀌게)
  setTimeout(() => { for (const c of ARMOR_CLASSES) loadClassPack(playerBody(), c); }, 6000);
  last = performance.now();

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
