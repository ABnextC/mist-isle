// 캐릭터 그리기와 동작: 걷기(무릎·팔꿈치까지), 숨쉬기, 도끼·곡괭이 내려찍기, 낫질, 귀환 시전.
// v0.3: 무기 들기, 약공·강공 휘두르기, 창 찌르기, 구르기, 막기, 쓰러짐, 맞을 때 움찔.
// v0.5: 실제 사람 몸 모형. 동작 값은 예전 그대로 쓰고 pose()에서 해부학 좌우(오른손 = -x)로 거울 변환한다.
//       눈 깜빡임·눈동자 움직임, 팔을 높이 들면 쇄골이 따라 올라감, 허리·가슴에 나눠 굽힘.

import * as THREE from 'three';
import { tickLerp } from './interp.js';
import { makeActorModel } from './models/actor.js';
import { loadClips, clips as animClips, sample as animSample, blend as animBlend, smoothstep, NB } from './anim.js';

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
  let detailNear = 22; // 이 거리 안에서만 속눈썹·눈알·머리카락 끝을 그린다(화질 단계)
  let botIdx = 0;

  const botOf = new Map();
  // 낀 갑옷의 종류(로브·경갑·중갑)를 칸마다. 부서진 갑옷도 입은 모습은 그대로 둔다
  function outfitOf(a) {
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
    let idx = 0;
    if (!player) {
      if (!botOf.has(a.id)) botOf.set(a.id, botIdx++);
      idx = botOf.get(a.id);
    }
    const model = makeActorModel({
      tunic: player ? 0x2a6e68 : TUNICS[idx % TUNICS.length],
      trousers: player ? 0x3b3f4a : TROUSERS[idx % TROUSERS.length],
      seed: player ? 2 : 3 + idx,
      body: player ? playerBody() : BODY_PATTERN[idx % BODY_PATTERN.length],
    });
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
  function combatPose(v, a, p, wDef, dt) {
    const cb = a.cb;
    const st = game.state.t;
    const C = game.data.config.combat;
    v.hurt = Math.max(0, v.hurt - dt * 5);
    v.m.root.rotation.x = 0;
    if (!cb) return;
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
    if (ev.type === 'combat.hurt') {
      const v = views.get(ev.actor);
      if (v) v.hurt = 1;
    }
  }

  function update(dt, t) {
    const { state, data } = game;
    for (const a of Object.values(state.actors)) {
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
      const casting = a.action?.type === 'recall';
      if (node) yaw = Math.atan2(node.x - a.x, node.z - a.z);
      v.yaw = lerpAngle(v.yaw, yaw, 1 - Math.exp(-dt * 12));
      v.m.root.position.copy(v.pos);
      v.m.root.rotation.y = v.yaw;

      const skill = node ? data.nodes[node.type].skill : null;
      for (const [kname, tool] of Object.entries(v.m.tools)) tool.visible = kname === skill;
      const wE = a.equip?.weapon ? a.bag.find((e) => e.uid === a.equip.weapon) : null;
      const wDef = wE ? data.items[wE.item].weapon : null;
      const wKey = wDef ? `${wDef.type}_${wDef.tier}` : null;
      for (const [kname, g] of Object.entries(v.m.weapons)) g.visible = !skill && kname === wKey;

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
      const cm = combatPose(v, a, p, wDef, dt);
      if (cm && (!mode || cm === 'full')) mode = cm;
      if (A) {
        locomotion(v, dt, A);
        overlay(v, p, mode, dt);
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
    setDetail(d) { detailNear = d; },
    positionOf: (id) => views.get(id)?.pos,
  };
}
