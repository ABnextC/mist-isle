// 캐릭터 그리기와 동작: 걷기(무릎·팔꿈치까지), 숨쉬기, 도끼·곡괭이 내려찍기, 낫질, 귀환 시전.
// v0.3: 무기 들기, 약공·강공 휘두르기, 창 찌르기, 구르기, 막기, 쓰러짐, 맞을 때 움찔.
// v0.5: 실제 사람 몸 모형. 동작 값은 예전 그대로 쓰고 pose()에서 해부학 좌우(오른손 = -x)로 거울 변환한다.
//       눈 깜빡임·눈동자 움직임, 팔을 높이 들면 쇄골이 따라 올라감, 허리·가슴에 나눠 굽힘.
// v0.5: 검은 돛 약탈단과 NPC도 같은 몸·옷·동작으로 그린다(코어의 짐승 상태 → 가짜 행위자).
// v0.4.6~: 서기·걷기·달리기는 모션 캡처(anim.js). v0.4.8: 채집·전투·구르기·쓰러짐·시전도 모션 캡처 동작(actionOf). v0.4.9: 노드별 채집·손질·먹기·작업대·무기별 막기·중갑 회피.
//       손으로 짠 pose()는 동작 묶음을 못 읽었을 때와 무기 든 오른팔(arm)에만 쓴다.

import * as THREE from 'three';
import { tickLerp } from './interp.js';
import { workSpots, npcPos } from '../../core/world.js';
import { makeActorModel } from './models/actor.js';
import { loadClips, clips as animClips, sample as animSample, sampleOnce as animOnce, sampleTool, hasClip, blend as animBlend, smoothstep, NB } from './anim.js';

loadClips(new URL('../assets/anim/clips.json', import.meta.url).href);
const LOWER = new Set(['hips', 'thL', 'knL', 'ftL', 'thR', 'knR', 'ftR']);
const RARM = new Set(['clavR', 'shR', 'elR', 'handR']);

const TUNICS = [0x8a4f6e, 0x6e5a2e, 0x2e5a8a, 0x7a3a2a, 0x4a6a3a, 0x5a4a7a, 0x8a6a3a];
const TROUSERS = [0x4a4238, 0x3b3f4a, 0x5a4a38, 0x3a3a34];
// 페르소나 몸: 여·남을 섞는다
const BODY_PATTERN = ['f', 'm', 'm', 'f', 'm', 'f', 'm'];
export const BODY_KEY = 'mist-isle:body';
export function playerBody() {
  try {
    return localStorage.getItem(BODY_KEY) === 'f' ? 'f' : 'm';
  } catch {
    return 'm';
  }
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

const damp = (cur, want, k) => cur + (want - cur) * k;
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const AXZ = new THREE.Vector3(0, 0, 1);

export function createActorsView(scene, game, hf, camera = null) {
  const views = new Map();
  const HZ = game.data.config.time.hz;
  let detailNear = 22; // 이 거리 안에서만 속눈썹·눈알·머리카락 끝을 그린다(화질 단계)
  let botIdx = 0;

  const botOf = new Map();
  // 낀 갑옷의 종류(로브·경갑·중갑)를 칸마다. 부서진 갑옷도 입은 모습은 그대로 둔다
  function outfitOf(a) {
    if (a.outfit) return a.outfit;
    const cls = (slot) => {
      const uid = a.equip?.[slot];
      if (!uid) return null;
      const e = a.bag.find((x) => x.uid === uid);
      return (e && game.data.items[e.item]?.armor?.class) || null;
    };
    return { head: cls('head'), chest: cls('chest'), legs: cls('legs') };
  }
  const outfitKey = (o) => `${o.head}|${o.chest}|${o.legs}`;
  function make(a, keep) {
    const player = a.kind === 'player';
    const look = a.look || null;
    let idx = 0;
    if (!player && !look) {
      if (!botOf.has(a.id)) botOf.set(a.id, botIdx++);
      idx = botOf.get(a.id);
    }
    const model = makeActorModel({
      tunic: look ? 0x2a2624 : player ? 0x2a6e68 : TUNICS[idx % TUNICS.length],
      trousers: look ? 0x2b2724 : player ? 0x3b3f4a : TROUSERS[idx % TROUSERS.length],
      seed: look ? look.seed ?? 5 : player ? 2 : 3 + idx,
      body: look ? look.body || 'm' : player ? playerBody() : BODY_PATTERN[idx % BODY_PATTERN.length],
    });
    if (look?.tint) model.setTints(look.tint);
    scene.add(model.root);
    const v = { m: model, pos: new THREE.Vector3(a.x, hf.height(a.x, a.z), a.z), yaw: a.yaw || 0, phase: 0, swing: 0, speed: 0, breathe: Math.random() * 6, hurt: 0, fall: 0,
      blinkIn: 1 + Math.random() * 3, blink: -1, gaze: new THREE.Vector2(), gazeTo: new THREE.Vector2(), gazeIn: Math.random() * 2 };
    if (keep) Object.assign(v, { pos: keep.pos, yaw: keep.yaw, phase: keep.phase, speed: keep.speed });
    const o = outfitOf(a);
    v.outfit = outfitKey(o);
    model.setOutfit(o);
    // 모션 캡처 섞기 버퍼
    v.qa = new Float32Array(NB * 4);
    v.qb = new Float32Array(NB * 4);
    v.qi = new Float32Array(NB * 4);
    v.ha = new Float32Array(3);
    v.hb = new Float32Array(3);
    v.hi = new Float32Array(3);
    v.cyc = Math.random();
    v.idleT = Math.random();
    v.actW = 0;
    v.turn = 0;
    v.lastYaw = v.yaw;
    v.saveQ = [];
    // 손 동작(v0.4.8): 동작 묶음 표본, 바뀔 때 잇는 직전 자세, 지난 장 자세
    v.aq = new Float32Array(NB * 4);
    v.ah = new Float32Array(3);
    v.fromQ = new Float32Array(NB * 4);
    v.fromH = new Float32Array(3);
    v.lastQ = new Float32Array(NB * 4);
    v.lastH = new Float32Array(3);
    v.hasLast = false;
    v.actKey = 'loco';
    v.fadeLeft = 0;
    v.loopName = null;
    v.loopT = 0;
    v.rollT0 = undefined;
    v.downT0 = undefined;
    v.eatQ = null; // 먹기: { item, t0 }
    v.tov = { dir: [0, 0, 1], up: null, at: 'R' }; // 손에 든 것의 자루 방향(동작 묶음이 정할 때)
    return v;
  }

  // 내 개척자 몸을 바꾼다(설정에서)
  function rebuild(id) {
    const old = views.get(id);
    const a = game.state.actors[id];
    if (!old || !a) return;
    scene.remove(old.m.root);
    views.set(id, make(a, old));
  }

  // 눈 깜빡임과 눈동자: 2~5초마다 깜빡, 1~3초마다 시선이 조금 옮겨 간다
  function face(v, dt) {
    const m = v.m;
    v.blinkIn -= dt;
    if (v.blinkIn <= 0 && v.blink < 0) {
      v.blink = 0;
      v.blinkIn = 1.8 + Math.random() * 3.5;
    }
    let b = 0;
    if (v.blink >= 0) {
      v.blink += dt / 0.17;
      b = Math.sin(Math.min(1, v.blink) * Math.PI);
      if (v.blink >= 1) v.blink = -1;
    }
    m.setMorph('blinkL', b);
    m.setMorph('blinkR', b);
    v.gazeIn -= dt;
    if (v.gazeIn <= 0) {
      v.gazeIn = 0.8 + Math.random() * 2.4;
      v.gazeTo.set((Math.random() - 0.5) * 0.36, (Math.random() - 0.5) * 0.16);
    }
    v.gaze.lerp(v.gazeTo, 1 - Math.exp(-dt * 18));
    for (const e of m.eyes) e.rotation.set(-v.gaze.y, v.gaze.x, 0);
  }

  // 동작 값은 예전 모형(오른팔이 +x) 기준이다. 새 몸은 해부학 그대로(오른팔 -x)라 y·z 회전을 뒤집는다(거울)
  const lift = (x) => Math.min(1, Math.max(0, (-x - 1.0) / 1.6));
  function pose(v, p) {
    const m = v.m;
    m.legL.th.rotation.x = p.thL;
    m.legR.th.rotation.x = p.thR;
    m.legL.kn.rotation.x = p.knL;
    m.legR.kn.rotation.x = p.knR;
    m.legL.ft.rotation.x = p.ftL;
    m.legR.ft.rotation.x = p.ftR;
    m.armL.sh.rotation.set(p.shLx, 0, -p.shLz);
    m.armR.sh.rotation.set(p.shRx, -(p.shRy || 0), -p.shRz);
    m.armL.el.rotation.x = p.elL;
    m.armR.el.rotation.x = p.elR;
    m.spine.rotation.set(p.spX * 0.55, -p.spY * 0.5, 0);
    if (m.chest) m.chest.rotation.set(p.spX * 0.45, -p.spY * 0.5, 0);
    m.hips.position.y = m.hipsY + p.bob;
    m.hips.rotation.x = p.roll || 0;
    m.neck.rotation.x = p.nk;
    // 팔을 머리 위로 들면 쇄골이 따라 올라간다(어깨가 꺼지지 않게)
    if (m.armL.clav) m.armL.clav.rotation.z = 0.3 * lift(p.shLx);
    if (m.armR.clav) m.armR.clav.rotation.z = -0.3 * lift(p.shRx);
  }

  // 전투 자세: 코어의 a.cb(공격·구르기·막기·쓰러짐)를 보고 팔·몸통을 덮어쓴다
  function combatPose(v, a, p, wDef, dt, clipsOn) {
    const cb = a.cb;
    const st = game.state.t;
    const C = game.data.config.combat;
    v.hurt = Math.max(0, v.hurt - dt * 5);
    v.m.root.rotation.x = 0;
    if (!cb) return;
    if (clipsOn) {
      // 동작 묶음이 있으면 쓰러짐·구르기·휘두르기는 actionOf()가 맡는다. 여기선 무기 든 오른팔만
      if (wDef && !a.action && !cb.act && !cb.dodge && !cb.block && !(cb.downUntil > 0)) {
        Object.assign(p, { shRx: Math.min(p.shRx, -0.25), elR: Math.min(p.elR, -0.55) });
        return 'arm';
      }
      return null;
    }
    if (cb.downUntil > 0) {
      v.fall = Math.min(1, v.fall + dt * 3);
    } else v.fall = Math.min(1, Math.max(0, v.fall - dt * 4));
    if (v.fall > 0) {
      v.m.root.rotation.x = -Math.PI / 2 * v.fall;
      v.m.root.position.y += 0.18 * v.fall;
      Object.assign(p, { shLx: -2.6 * v.fall, shRx: -2.6 * v.fall, elL: -0.2, elR: -0.2, thL: 0.1, thR: -0.1, knL: 0.2, knR: 0.1 });
      return 'full';
    }
    let hold = false;
    if (wDef && !a.action) {
      Object.assign(p, { shRx: Math.min(p.shRx, -0.25), elR: Math.min(p.elR, -0.55) });
      hold = true;
    }
    if (cb.dodge) {
      const k = Math.min(1, Math.max(0, (st - cb.dodge.t0) / C.dodgeSec));
      // 엉덩이를 축으로 앞구르기
      Object.assign(p, { roll: k * Math.PI * 2, thL: -1.5, thR: -1.5, knL: 2.0, knR: 2.0, shLx: -1.2, shRx: -1.2, elL: -1.8, elR: -1.8, spX: 0.7, nk: 0.5, bob: -0.5 * Math.sin(k * Math.PI) - 0.1 });
      return 'full';
    }
    const act = cb.act;
    if (act && st < act.endAt) {
      const span = Math.max(0.05, act.endAt - act.t0);
      const k = (st - act.t0) / span;
      const h = (act.hitAt - act.t0) / span;
      const into = k < h ? k / h : 1;
      const out = k < h ? 0 : (k - h) / (1 - h);
      const strike = into * (1 - out * 0.85);
      const type = wDef?.type || 'fists';
      if (type === 'spear') {
        const ext = k < h ? into * into : 1 - out;
        Object.assign(p, { shRx: -1.45, shRy: 0.15, elR: -1.8 + 1.75 * ext, shLx: -1.2, shLz: 0.3, elL: -0.9, spX: 0.1 + 0.25 * ext, spY: -0.3 * ext, thL: -0.35 * ext, knL: 0.3 * ext });
      } else if (act.kind === 'heavy') {
        const up = k < h ? into : 1 - out;
        Object.assign(p, { shRx: -2.9 * up - 0.4 * (1 - up), shRz: 0.1, elR: -0.5 * up, shLx: -2.4 * up - 0.5 * (1 - up), elL: -0.6 * up, spX: 0.05 + 0.4 * (k >= h ? 1 - out : 0), thL: -0.3, knL: 0.35, nk: 0.1 });
      } else {
        const sw = k < h ? into : 1;
        Object.assign(p, { shRx: -1.35 + 0.3 * sw, shRy: 1.1 - 2.0 * sw * (1 - out * 0.5), shRz: 0.2, elR: -0.7 + 0.5 * strike, spY: 0.45 - 0.9 * sw, spX: 0.12, shLx: -0.5, elL: -0.8 });
      }
      return 'upper';
    }
    if (cb.block) {
      Object.assign(p, { shRx: -1.45, shRy: 0.95, elR: -1.05, shLx: -1.1, shLz: 0.2, elL: -1.4, spX: 0.16, nk: 0.08, thL: -0.2, knL: 0.25, knR: 0.2 });
      return 'upper';
    }
    if (v.hurt > 0) {
      p.spX -= 0.3 * v.hurt;
      return 'hurt';
    }
    return hold ? 'arm' : null;
  }

  // 이동 동작: 서기·걷기·달리기를 속도로 섞고, 위상은 걸은 거리로 나아간다(발이 덜 미끄러지게)
  // 보폭은 동작 묶음에 적힌 값(딛는 발이 안 미끄러지는 한 주기 거리) 그대로 쓴다
  const RUN_STRETCH = 1.0;
  function locomotion(v, dt, A) {
    const m = v.m;
    const sp = v.speed;
    const W = A.clips.walk;
    const R = A.clips.run;
    const I = A.clips.idle;
    const wMove = smoothstep(0.12, 0.9, sp);
    const wRun = smoothstep(1.7, 3.5, sp);
    // 다리 길이가 다르면(여자 몸 등) 보폭·엉덩이 출렁임도 그만큼 줄인다 — 동작 묶음은 남자 몸 기준
    if (!v.legK) v.legK = (m.bones.knL.position.length() + m.bones.ftL.position.length()) / 0.853 || 1;
    const lk = v.legK;
    const stride = (W.stride + (R.stride * RUN_STRETCH - W.stride) * wRun) * lk;
    // 위상: 섞임(자세)은 부드러운 속도로, 나아가는 양은 실제 이동 거리로 — 멈춘 뒤 제자리 뜀·출발 때 미끄럼을 없앤다
    const raw = v.rawSpeed ?? sp;
    const wRunRaw = smoothstep(1.7, 3.5, raw);
    const strideRaw = (W.stride + (R.stride * RUN_STRETCH - W.stride) * Math.max(wRun, wRunRaw)) * lk;
    v.cyc = (v.cyc + (dt * raw) / Math.max(0.3, raw > 0.05 ? strideRaw : stride)) % 1;
    v.idleT = (v.idleT + dt / I.dur) % 1;
    animSample('walk', v.cyc, v.qa, v.ha);
    if (wRun > 0) {
      animSample('run', v.cyc, v.qb, v.hb);
      animBlend(v.qa, v.ha, v.qb, v.hb, wRun);
    }
    if (wMove < 1) {
      animSample('idle', v.idleT, v.qi, v.hi);
      animBlend(v.qi, v.hi, v.qa, v.ha, wMove);
    } else {
      v.qi.set(v.qa);
      v.hi.set(v.ha);
    }
    v.wMove = wMove;
    const names = A.bones;
    for (let i = 0; i < NB; i++) {
      const b = m.bones[names[i]];
      if (b) b.quaternion.fromArray(v.qi, i * 4);
    }
    m.hips.position.set(m.hipsRest.x + v.hi[0] * lk, m.hipsRest.y + v.hi[1] * lk, m.hipsRest.z + v.hi[2] * lk);
    // 도는 쪽으로 몸을 기울인다(달릴수록)
    let dy = v.yaw - v.lastYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    v.lastYaw = v.yaw;
    v.turn = damp(v.turn, dy / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 6));
    const bank = Math.max(-0.22, Math.min(0.22, -v.turn * sp * 0.03));
    if (Math.abs(bank) > 1e-3) {
      // 발밑(뿌리 원점)을 축으로 온몸을 기울인다 — 엉덩이를 축으로 돌리면 발이 옆으로 빠진다
      tmpQ.setFromAxisAngle(AXZ, bank);
      m.hips.quaternion.premultiply(tmpQ);
      m.hips.position.applyQuaternion(tmpQ);
    }
  }

  // 옷자락·머리카락 관성(v0.4.6): 달리면 뒤로 끌리고, 멈추면 앞으로 쏠렸다 돌아오고, 돌면 바깥으로 흔들린다
  const tmpQ2 = new THREE.Quaternion();
  const tmpV2 = new THREE.Vector3();
  function clothSway(v, dt, t) {
    const m = v.m;
    v.sw ||= new THREE.Vector3();
    v.swV ||= new THREE.Vector3();
    const fwd = Math.min(v.speed, 6);
    const tz = -fwd * 0.017;
    const tx = Math.max(-0.07, Math.min(0.07, -(v.turn || 0) * fwd * 0.006));
    const ty = Math.abs(tz) * 0.3;
    const K = 70;
    const C = 9;
    let left = Math.min(dt, 0.25);
    while (left > 1e-4) {
      const h = Math.min(left, 1 / 60);
      v.swV.x += ((tx - v.sw.x) * K - v.swV.x * C) * h;
      v.swV.y += ((ty - v.sw.y) * K - v.swV.y * C) * h;
      v.swV.z += ((tz - v.sw.z) * K - v.swV.z * C) * h;
      v.sw.addScaledVector(v.swV, h);
      left -= h;
    }
    const wm = v.wMove || 0;
    const bounce = -0.011 * Math.cos((v.cyc || 0) * Math.PI * 4) * wm;
    const u = m.materials.cloth?.userData.u;
    if (u) {
      u.uSway.value.set(v.sw.x, v.sw.y + bounce, v.sw.z);
      u.uSwayT.value = t;
      u.uFlutter.value = wm;
    }
    if (m.materials.hair?.length) {
      // 액터 공간 → 머리 공간
      tmpV2.set(v.sw.x * 0.45, (v.sw.y + bounce) * 0.6, v.sw.z * 0.45).applyQuaternion(m.root.quaternion);
      m.head.getWorldQuaternion(tmpQ2).invert();
      tmpV2.applyQuaternion(tmpQ2);
      for (const hm of m.materials.hair) hm.userData.u.uSway.value.copy(tmpV2);
    }
  }

  // ── 손 동작(v0.4.8): 채집·전투·시전을 모션 캡처 동작으로 ──
  // 무기 종류·세기에 따라 동작을 고른다
  function attackClip(wDef, kind) {
    const type = wDef?.type || 'fists';
    if (type === 'fists') return kind === 'heavy' ? 'punch_heavy' : 'punch';
    if (type === 'spear') return kind === 'heavy' ? 'spear_heavy' : 'spear';
    return kind === 'heavy' ? 'atk_heavy' : 'atk_light';
  }
  const GATHER_CLIP = { logging: 'chop', mining: 'mine', harvesting: 'harvest' };
  // v0.4.9 적절성 검토: 작업대마다 하는 일, 손에 드는 소품, 먹을 것마다 동작·소품
  const CRAFT_ANIM = { forge: 'hammer', armorbench: 'hammer', workbench: 'hammer', sawbench: 'saw', kitchen: 'stir', smelter: 'stir', loom: 'weave', tannery: 'scrape', hand: 'handwork' };
  const CRAFT_PROP = { hammer: 'hammer', saw: 'saw', stir: 'ladle', scrape: 'knife' };
  const GUARD = { spear: 'guard_spear', sword: 'guard_sword', club: 'guard_sword', axe: 'guard_axe' };
  const FOOD = { food_soup: ['drink', 'bowl'], food_berry: ['eat', 'berry'], food_meat: ['eat', 'meat'] };
  const strikes = []; // 도구가 닿은 순간들(main.js가 가져가 조각을 튀긴다)
  // 장비 무게 단계(가벼움·보통·무거움·과적) — 무거우면 구르지 않고 짧게 뛰어 비킨다
  function loadTier(a) {
    if (a.look) return 'medium';
    const data = game.data;
    let kg = 0;
    // core/systems/combat.js equipLoad와 같은 칸(무기+갑옷)만 센다
    for (const slot of ['weapon', 'head', 'chest', 'legs']) {
      const uid = a.equip?.[slot];
      const e = uid && a.bag.find((x) => x.uid === uid);
      if (e) kg += data.items[e.item].weight || 0;
    }
    kg = Math.round(kg * 10) / 10;
    const tiers = data.config.load.tiers;
    return (tiers.find((t) => kg <= t.max) || tiers[tiers.length - 1]).id;
  }
  // 제작: 쉬고 있고, 지금 돌아가는 일감의 작업대 '일하는 자리'(stations.json work)에 서 있으면
  // 그 작업대 일을 한다. 자리를 벗어나면 허공에 하지 않게 아무 동작도 하지 않는다(v0.4.9).
  function craftAt(a, v) {
    const data = game.data;
    if (a.action || a.move || a.dest || (v.rawSpeed ?? 0) > 0.2) return null;
    const cb = a.cb;
    if (cb && (cb.act || cb.block || cb.dodge || cb.downUntil > 0)) return null;
    const job = a.queue?.[0];
    if (!job || job.startsAt > game.state.t) return null;
    const r = data.recipes[job.recipe];
    if (!r) return null;
    if (r.station === 'hand') return { anim: 'handwork', at: null };
    for (const s of Object.values(game.state.settlements)) {
      for (const st of s.stations) {
        if (st.type !== r.station || Math.abs(st.x - a.x) > 4 || Math.abs(st.z - a.z) > 4) continue;
        for (const p of workSpots(data, st)) {
          if (Math.hypot(p.x - a.x, p.z - a.z) < 0.6) return { anim: CRAFT_ANIM[r.station], at: { x: p.ax, z: p.az } };
        }
      }
    }
    return null;
  }
  const ROLL_SPLIT = 0.78; // 구르기 동작에서 굴러 웅크린 채 일어나기 시작할 때까지(움직이는 동안)
  const ROLL_RISE = 0.25; // 남은 일어나기에 쓰는 시간(초)

  // 지금 해야 할 손 동작: { name, t(0~1), once, mode: full|upper } 또는 null
  function actionOf(v, a, wDef, work, casting, stI, dt) {
    const cb = a.cb;
    const C = game.data.config.combat;
    // 쓰러짐: 넘어지는 동작을 한 번, 끝 장(누운 자세)에서 멈춘다
    if (cb && cb.downUntil > 0) {
      if (v.downT0 === undefined) v.downT0 = stI;
      const c = animClips().clips.down;
      return { name: 'down', t: (stI - v.downT0) / c.dur, once: true, mode: 'full' };
    }
    v.downT0 = undefined;
    // 구르기: 움직이는 동안 굴러 나가고, 끝나면 잠깐 일어난다(바로 움직이면 끊는다)
    if (cb?.dodge && cb.dodge.t0 !== v.rollT0) v.rollT0 = cb.dodge.t0;
    if (v.rollT0 !== undefined) {
      const D = C.dodgeSec;
      const el = stI - v.rollT0;
      const busy = (a.move && el > D) || cb?.act || cb?.block;
      if (el < D + ROLL_RISE && !busy) {
        // 무거운 갑옷이면 구르지 않고 몸을 낮춰 짧게 뛰어 비켜 딛는다
        if (v.rollName === undefined || el < 0.02) v.rollName = hasClip('hop') && /heavy|over/.test(loadTier(a)) ? 'hop' : 'roll';
        const split = v.rollName === 'hop' ? 0.8 : ROLL_SPLIT;
        const t = el < D ? (Math.max(0, el) / D) * split : split + ((el - D) / ROLL_RISE) * (1 - split);
        return { name: v.rollName, t, once: true, mode: 'full' };
      }
      v.rollName = undefined;
      v.rollT0 = undefined;
    }
    // 휘두르기: 동작의 '맞는 순간'이 코어의 hitAt에 오게 시간을 나눠 맞춘다
    const act = cb?.act;
    if (act && stI < act.endAt + 0.05) {
      const name = act.clip || attackClip(wDef, act.kind);
      if (hasClip(name)) {
        const hp = animClips().clips[name].ev?.hit ?? 0.5;
        const t = stI < act.hitAt
          ? (hp * Math.max(0, stI - act.t0)) / Math.max(0.02, act.hitAt - act.t0)
          : hp + ((1 - hp) * (stI - act.hitAt)) / Math.max(0.02, act.endAt - act.hitAt);
        return { name, t, once: true, mode: 'upper' };
      }
    }
    // 먹기·마시기: 한 번, 윗몸만(걸으면서도). 먹는 동안 오른손에 음식
    if (v.eatQ) {
      const [name, prop] = FOOD[v.eatQ.item] || ['eat', null];
      if (hasClip(name)) {
        if (v.eatQ.t0 === null) v.eatQ.t0 = stI;
        const t = (stI - v.eatQ.t0) / animClips().clips[name].dur;
        if (t < 1) return { name, t, once: true, mode: 'upper', prop };
      }
      v.eatQ = null;
    }
    if (v.useQ) {
      const c = animClips().clips.pick_ground;
      if (c && !a.move) {
        if (v.useQ.t0 === null) v.useQ.t0 = stI;
        const t = (stI - v.useQ.t0) / c.dur;
        if (t < 1) return { name: 'pick_ground', t, once: true, mode: 'full' };
      }
      v.useQ = null;
    }
    if (cb?.block) {
      // 무기마다 막는 자세(맨손은 권투 자세)
      const want = GUARD[wDef?.type] || 'guard';
      const g = hasClip(want) ? want : 'guard';
      if (hasClip(g)) return loopAct(v, g, dt, 'upper');
    }
    if (work?.anim && hasClip(work.anim)) {
      const act = loopAct(v, work.anim, dt, 'full');
      act.prop = work.prop || null;
      return act;
    }
    if (casting && hasClip('cast')) return loopAct(v, 'cast', dt, 'full');
    v.loopName = null;
    return null;
  }
  function loopAct(v, name, dt, mode) {
    const c = animClips().clips[name];
    const prev = v.loopT;
    if (v.loopName !== name) {
      v.loopName = name;
      v.loopT = 0;
    } else {
      v.loopT = (v.loopT + dt / c.dur) % 1;
      if (c.ev) {
        for (const e of [c.ev.hit, c.ev.hit2]) {
          if (e === undefined) continue;
          const crossed = prev <= v.loopT ? prev < e && e <= v.loopT : e > prev || e <= v.loopT;
          if (crossed) v.struck = true;
        }
      }
    }
    return { name, t: v.loopT, once: false, mode };
  }

  // 동작을 뼈에 얹는다. upper: 달리는 중이면 다리·엉덩이는 이동 동작 그대로
  function applyAction(v, act) {
    const m = v.m;
    if (act.once) animOnce(act.name, act.t, v.aq, v.ah);
    else animSample(act.name, act.t, v.aq, v.ah);
    const names = animClips().bones;
    const wm = act.mode === 'upper' ? v.wMove || 0 : 0;
    for (let i = 0; i < NB; i++) {
      const nm = names[i];
      const b = m.bones[nm];
      if (!b) continue;
      const k = LOWER.has(nm) ? 1 - wm : 1;
      if (k >= 0.999) b.quaternion.fromArray(v.aq, i * 4);
      else if (k > 0.001) {
        tmpQ.fromArray(v.aq, i * 4);
        b.quaternion.slerp(tmpQ, k);
      }
    }
    const lk = v.legK || 1;
    const k = 1 - wm;
    tmpV.set(m.hipsRest.x + v.ah[0] * lk, m.hipsRest.y + v.ah[1] * lk, m.hipsRest.z + v.ah[2] * lk);
    m.hips.position.lerp(tmpV, k);
  }

  // 동작이 바뀌는 순간(서기→휘두르기, 휘두르기→달리기 …) 직전 자세에서 0.15초 동안 이어 붙인다
  const FADE = 0.15;
  function crossfade(v, key, dt) {
    const m = v.m;
    const names = animClips().bones;
    if (key !== v.actKey) {
      v.actKey = key;
      if (v.hasLast) {
        v.fromQ.set(v.lastQ);
        v.fromH.set(v.lastH);
        v.fadeLeft = FADE;
      }
    }
    if (v.fadeLeft > 0) {
      v.fadeLeft = Math.max(0, v.fadeLeft - dt);
      const x = 1 - v.fadeLeft / FADE;
      const k = x * x * (3 - 2 * x);
      for (let i = 0; i < NB; i++) {
        const b = m.bones[names[i]];
        if (!b) continue;
        tmpQ.copy(b.quaternion);
        b.quaternion.fromArray(v.fromQ, i * 4).slerp(tmpQ, k);
      }
      tmpV.set(v.fromH[0], v.fromH[1], v.fromH[2]);
      m.hips.position.lerpVectors(tmpV, m.hips.position, k);
    }
    for (let i = 0; i < NB; i++) {
      const b = m.bones[names[i]];
      if (b) b.quaternion.toArray(v.lastQ, i * 4);
    }
    m.hips.position.toArray(v.lastH);
    v.hasLast = true;
  }

  // 맞으면 움찔: 0.05초 만에 몸통이 뒤로 젖혀지고 무릎이 꺾였다가 0.4초에 걸쳐 돌아온다(덧셈)
  const AX = new THREE.Vector3(1, 0, 0);
  function flinch(v, dt) {
    if (v.hurtT === undefined || v.hurtT > 0.6) return;
    v.hurtT += dt;
    const x = v.hurtT;
    const k = Math.min(1, x / 0.05) * Math.exp(-Math.max(0, x - 0.05) * 6);
    if (k < 0.01) return;
    const add = (bone, ang) => {
      if (!bone) return;
      tmpQ.setFromAxisAngle(AX, ang);
      bone.quaternion.multiply(tmpQ);
    };
    const by = v.m.bones;
    add(by.spine, -0.26 * k);
    add(by.chest, -0.2 * k);
    add(by.neck, 0.14 * k);
    add(by.head, -0.3 * k);
    add(by.knL, 0.22 * k);
    add(by.knR, 0.18 * k);
    add(by.thL, -0.1 * k);
    add(by.thR, -0.08 * k);
    v.m.hips.position.y -= 0.025 * k;
  }

  // 손 동작(채집·전투·시전)을 모션 캡처 위에 섞는다. 달리면서 휘두르면 다리는 달리기를 따른다
  function overlay(v, p, mode, dt) {
    const m = v.m;
    const want = mode ? 1 : 0;
    const rate = mode === 'full' || mode === 'upper' ? 14 : 8;
    v.actW = damp(v.actW, want, 1 - Math.exp(-dt * rate));
    if (mode) v.lastMode = mode;
    const w = v.actW;
    if (w < 0.002) return;
    const md = mode || v.lastMode || 'upper';
    const names = animClips().bones;
    const bones = m.bones;
    for (let i = 0; i < NB; i++) {
      const b = bones[names[i]];
      (v.saveQ[i] ||= new THREE.Quaternion()).copy(b.quaternion);
      b.quaternion.identity();
    }
    tmpV.copy(m.hips.position);
    pose(v, p);
    const wm = v.wMove || 0;
    for (let i = 0; i < NB; i++) {
      const nm = names[i];
      const b = bones[nm];
      let k;
      if (md === 'full') k = w;
      else if (md === 'arm') k = RARM.has(nm) ? w * 0.75 : 0;
      else if (md === 'hurt') k = nm === 'spine' || nm === 'chest' ? w : 0;
      else k = LOWER.has(nm) ? w * (1 - wm) : w;
      tmpQ.copy(b.quaternion);
      b.quaternion.slerpQuaternions(v.saveQ[i], tmpQ, k);
    }
    const kh = md === 'full' ? w : md === 'upper' ? w * (1 - wm) : 0;
    m.hips.position.lerpVectors(tmpV, m.hips.position, kh);
  }

  function onEvent(ev) {
    if (ev.type === 'eat') {
      const v = views.get(ev.actor);
      if (v) v.eatQ = { item: ev.item, t0: null };
    }
    // 퀘스트 물체를 뒤질 때(v0.5): 쪼그려 앉아 줍는 동작 한 번
    if (ev.type === 'quest.use') {
      const v = views.get(ev.actor);
      // 등대에 오르는 일(문)은 무릎을 꿇지 않는다
      if (v && game.data.objects[ev.obj]?.kind !== 'door') v.useQ = { t0: null };
    }
    if (ev.type === 'combat.hurt') {
      const v = views.get(ev.actor);
      if (v) {
        v.hurt = 1;
        v.hurtT = 0;
      }
    }
    // 약탈자가 맞으면 움찔(막았으면 덜)
    if (ev.type === 'combat.hit') {
      const v = views.get(ev.mob);
      if (v && !ev.blocked) v.hurtT = 0;
    }
  }

  // ── 사람 모양 적·NPC(v0.5) ─────────────────────────
  // 코어의 짐승 상태(m.atk·mode)를 개척자 모양 가짜 행위자로 옮긴다. 같은 동작 묶음을 그대로 쓴다.
  const pseudo = new Map();
  const CORPSE_SEC = 40; // 쓰러진 약탈자는 40초 뒤 땅으로 꺼지며 사라진다
  let FAR_M = 120; // 이보다 멀면 그리지도 움직이지도 않는다(휴대폰은 줄인다)
  function hasteOf(m, type) {
    let k = 1;
    for (let i = 0; i < (m.phase || 0); i++) k *= type.phases?.[i]?.haste || 1;
    return k;
  }
  function baseLook(id, look, extra) {
    const w = look.weapon ? game.data.items[look.weapon]?.weapon || null : null;
    return {
      id, look, weaponDef: w, outfit: { head: look.head || null, chest: look.chest || null, legs: look.legs || null },
      equip: {}, bag: [], queue: [], buffs: [], action: null, move: null, dest: null,
      cb: { act: null, dodge: null, block: false, downUntil: 0 }, ...extra,
    };
  }
  function mobActor(m, type) {
    let p = pseudo.get(m.id);
    if (!p) {
      p = baseLook(m.id, type.look || {}, { kind: 'mob' });
      pseudo.set(m.id, p);
    }
    p.x = m.x;
    p.z = m.z;
    p.yaw = m.yaw;
    p.mob = m;
    const cb = p.cb;
    cb.block = m.mode === 'guard';
    cb.downUntil = m.mode === 'dead' ? 1 : 0;
    cb.act = null;
    p.heldTool = p.look.tool || null;
    if (m.atk && (m.mode === 'windup' || m.mode === 'charge' || m.mode === 'recover')) {
      const at = type.attacks[m.atk.i] || type.attacks[0];
      const hitAt = m.atk.t0 + at.windup / hasteOf(m, type) + (at.charge ? at.charge.time * 0.5 : 0);
      cb.act = { kind: at.heavy ? 'heavy' : 'light', clip: at.clip, t0: m.atk.t0, hitAt, endAt: hitAt + (at.recover ?? 0.4) };
      // 던진 손도끼는 날아가는 동안 손에 없다
      if (at.shot && game.state.t >= hitAt - 0.03 && game.state.t < hitAt + 0.55) p.heldTool = null;
    }
    return p;
  }
  function npcActor(n, me) {
    const id = `npc:${n.id}`;
    let p = pseudo.get(id);
    if (!p) {
      const pos = npcPos(game, n.id);
      p = baseLook(id, n.look || {}, { kind: 'npc', npc: n.id, x: pos.x, z: pos.z, yaw: pos.yaw, home: pos.yaw });
      pseudo.set(id, p);
    }
    // 가까이 오면 개척자 쪽을 본다
    p.yaw = me && Math.hypot(me.x - p.x, me.z - p.z) < 7 ? Math.atan2(me.x - p.x, me.z - p.z) : p.home;
    return p;
  }
  const listBuf = [];
  let sweepT = 0;
  // 이번 장면에 그릴 행위자: 진짜 행위자 + 가까운 약탈자 + NPC
  function cast() {
    const { state, data } = game;
    listBuf.length = 0;
    for (const a of Object.values(state.actors)) listBuf.push(a);
    const me = state.actors.p1 || listBuf[0];
    const cx = camera ? camera.position.x : me?.x ?? 0;
    const cz = camera ? camera.position.z : me?.z ?? 0;
    for (const m of Object.values(state.mobs)) {
      const type = data.creatures[m.type];
      if (!type.body) continue;
      const v = views.get(m.id);
      const far = Math.abs(m.x - cx) > FAR_M || Math.abs(m.z - cz) > FAR_M;
      const gone = m.mode === 'away' || (m.mode === 'dead' && state.t > m.deadAt + CORPSE_SEC + 3);
      if (far || gone) {
        if (v) {
          v.m.root.visible = false;
          v.tk = undefined;
        }
        continue;
      }
      if (v) v.m.root.visible = true;
      listBuf.push(mobActor(m, type));
    }
    for (const n of data.lists.npcs || []) {
      const p = npcActor(n, me);
      const v = views.get(p.id);
      const far = Math.abs(p.x - cx) > FAR_M || Math.abs(p.z - cz) > FAR_M;
      if (v) v.m.root.visible = !far;
      if (!far) listBuf.push(p);
    }
    return listBuf;
  }
  // 약탈단·NPC 모형을 미리 만들어 숨겨 둔다(야영지에 다가갈 때 한꺼번에 만들며 끊기지 않게)
  function prewarm() {
    for (const m of Object.values(game.state.mobs)) {
      const type = game.data.creatures[m.type];
      if (!type.body || views.has(m.id)) continue;
      const v = make(mobActor(m, type));
      v.m.root.visible = false;
      views.set(m.id, v);
    }
  }
  // 사라진 약탈자(습격대·부하)의 모형을 치운다
  function sweep() {
    const { state } = game;
    for (const [id, v] of views) {
      if (state.actors[id] || state.mobs[id] || id.startsWith('npc:')) continue;
      scene.remove(v.m.root);
      views.delete(id);
      pseudo.delete(id);
    }
  }

  function update(dt, t) {
    const { state, data } = game;
    sweepT -= dt;
    if (sweepT <= 0) {
      sweepT = 1;
      sweep();
    }
    for (const a of cast()) {
      let v = views.get(a.id);
      if (!v) {
        v = make(a);
        views.set(a.id, v);
      }
      // 갑옷을 갈아 끼면 옷 조각을 바꾼다(처음 입는 종류는 묶음을 읽은 뒤 바뀐다)
      const of = outfitOf(a);
      const ok = outfitKey(of);
      if (ok !== v.outfit) {
        v.outfit = ok;
        v.m.setOutfit(of);
      }
      const px = v.pos.x;
      const pz = v.pos.z;
      [v.pos.x, v.pos.z] = tickLerp(v, a.x, a.z, state.tick, game.alpha ?? 1);
      v.pos.y = hf.height(v.pos.x, v.pos.z);
      const sp = Math.hypot(v.pos.x - px, v.pos.z - pz) / Math.max(dt, 1e-3);
      v.rawSpeed = dt > 0 ? Math.min(sp, 12) : 0; // 걸음 위상은 실제로 간 거리로(멈추면 다리도 바로 멈춘다)
      // 멈출 때는 빨리 서기 자세로(달리던 자세로 굳어 있는 시간을 줄인다)
      v.speed = damp(v.speed, Math.min(sp, 7), 1 - Math.exp(-dt * (sp < v.speed ? 16 : 10)));
      let yaw = a.yaw || 0;
      const node = a.action?.type === 'gather' ? state.nodes[a.action.node] : null;
      const corpse = a.action?.type === 'skin' ? state.mobs?.[a.action.mob] : null;
      const casting = a.action?.type === 'recall';
      const nodeDef = node ? data.nodes[node.type] : null;
      // 하는 일: 채집(노드마다 동작), 가죽 벗기기, 제작(작업대 곁에서 쉴 때)
      let work = null;
      if (nodeDef) {
        const anim = nodeDef.anim || GATHER_CLIP[nodeDef.skill];
        work = { anim, tool: anim === 'pick_bush' || anim === 'pick_ground' ? null : nodeDef.skill, at: node };
      } else if (corpse) work = { anim: 'skin', prop: 'knife', at: corpse };
      else if (!casting) {
        const cr = craftAt(a, v);
        if (cr) work = { anim: cr.anim, prop: CRAFT_PROP[cr.anim] || null, at: cr.at };
      }
      if (work?.at) yaw = Math.atan2(work.at.x - a.x, work.at.z - a.z);
      v.yaw = lerpAngle(v.yaw, yaw, 1 - Math.exp(-dt * 12));
      v.m.root.position.copy(v.pos);
      v.m.root.rotation.y = v.yaw;
      // 쓰러진 약탈자: 한동안 누워 있다가 땅으로 꺼진다
      if (a.mob && a.mob.mode === 'dead') v.m.root.position.y -= Math.max(0, state.t - a.mob.deadAt - CORPSE_SEC) * 0.45;

      const skill = work?.tool || a.heldTool || null;
      for (const [kname, tool] of Object.entries(v.m.tools)) tool.visible = kname === skill;
      const wE = a.equip?.weapon ? a.bag.find((e) => e.uid === a.equip.weapon) : null;
      const wDef = a.weaponDef !== undefined ? a.weaponDef : wE ? data.items[wE.item].weapon : null;
      const wKey = wDef ? `${wDef.type}_${wDef.tier}` : null;
      // 오른손이 다른 걸 쥐면(채집·가죽·제작·먹기) 무기는 넣어 둔다
      const handBusy = !!work || !!v.eatQ;
      for (const [kname, g] of Object.entries(v.m.weapons)) g.visible = !handBusy && kname === wKey;

      const A = animClips();
      // 손으로 짠 동작(예전 방식): 동작 묶음이 아직 없으면 걷기도 이걸로 한다
      const walk = A ? 0 : Math.min(1, v.speed / 1.2);
      v.phase += dt * v.speed * (Math.PI * 2 / 1.45);
      v.breathe += dt * 1.7;
      const s = Math.sin(v.phase);
      const c = Math.cos(v.phase);
      const br = Math.sin(v.breathe);
      const p = {
        thL: s * 0.55 * walk, thR: -s * 0.55 * walk,
        knL: Math.max(0, -c) * 0.95 * walk + 0.04, knR: Math.max(0, c) * 0.95 * walk + 0.04,
        ftL: -Math.max(0, s) * 0.3 * walk, ftR: -Math.max(0, -s) * 0.3 * walk,
        shLx: -s * 0.45 * walk, shRx: s * 0.45 * walk, shLz: -0.08, shRz: 0.08,
        elL: -(0.25 + 0.25 * Math.max(0, s)) * walk - 0.12, elR: -(0.25 + 0.25 * Math.max(0, -s)) * walk - 0.12,
        spX: 0.06 * walk + br * 0.012, spY: s * 0.08 * walk, bob: -Math.abs(c) * 0.035 * walk + br * 0.004, nk: -0.04 * walk,
      };
      let mode = null; // 손 동작이 덮는 범위: full(온몸) · upper(윗몸, 서 있으면 다리도) · arm(오른팔만)
      const cm = combatPose(v, a, p, wDef, dt, !!A);
      if (cm && (!mode || cm === 'full')) mode = cm;
      if (A) {
        locomotion(v, dt, A);
        // 틱 사이 시각(위치 보간과 같게 틱 하나 늦춘다)
        const stI = state.t + ((game.alpha ?? 1) - 1) / HZ;
        v.struck = false;
        const act = actionOf(v, a, wDef, work, casting, stI, dt);
        if (act) {
          applyAction(v, act);
          v.actW = 0; // 손으로 짠 덮기는 끈다(바뀌는 순간은 crossfade가 잇는다)
        } else overlay(v, p, mode, dt);
        crossfade(v, act ? act.name : 'loco', dt);
        flinch(v, dt);
        v.m.showProp(act?.prop || null);
        if (skill || wDef || act?.prop) {
          const over = act && sampleTool(act.name, act.t, act.once, v.tov) ? v.tov : null;
          v.m.aimHeld(over);
        }
        // 도구가 닿은 순간: 도구 머리(없으면 오른손) 자리를 남긴다
        if (v.struck && work) {
          const tool = skill ? v.m.tools[skill] : act?.prop ? v.m.props[act.prop] : null;
          const at = new THREE.Vector3();
          if (tool) tool.localToWorld(at.set(0, skill === 'harvesting' ? 0.3 : 0.58, 0.06));
          else v.m.armR.hand.getWorldPosition(at);
          strikes.push({ actor: a.id, kind: work.anim, node: node?.id || null, nodeType: node?.type || null, x: at.x, y: at.y, z: at.z });
        }
      } else pose(v, p);
      clothSway(v, dt, t);
      if (camera) v.m.lod(camera.position.distanceTo(v.pos), detailNear);
      face(v, dt);
    }
  }

  return {
    update,
    onEvent,
    rebuild,
    views,
    takeStrikes: () => strikes.splice(0, strikes.length),
    setDetail(d) { detailNear = d; },
    setFar(d) { FAR_M = d; },
    prewarm,
    positionOf: (id) => views.get(id)?.pos,
  };
}
