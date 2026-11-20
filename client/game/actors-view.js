// 캐릭터 그리기와 동작: 걷기(무릎·팔꿈치까지), 숨쉬기, 도끼·곡괭이 내려찍기, 낫질, 귀환 시전.
// v0.3: 무기 들기, 약공·강공 휘두르기, 창 찌르기, 구르기, 막기, 쓰러짐, 맞을 때 움찔.
// v0.5: 실제 사람 몸 모형. 동작 값은 예전 그대로 쓰고 pose()에서 해부학 좌우(오른손 = -x)로 거울 변환한다.
//       눈 깜빡임·눈동자 움직임, 팔을 높이 들면 쇄골이 따라 올라감, 허리·가슴에 나눠 굽힘.

import * as THREE from 'three';
import { makeActorModel } from './models/actor.js';

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
      return;
    }
    if (wDef && !a.action) Object.assign(p, { shRx: Math.min(p.shRx, -0.25), elR: Math.min(p.elR, -0.55) });
    if (cb.dodge) {
      const k = Math.min(1, Math.max(0, (st - cb.dodge.t0) / C.dodgeSec));
      // 엉덩이를 축으로 앞구르기
      Object.assign(p, { roll: k * Math.PI * 2, thL: -1.5, thR: -1.5, knL: 2.0, knR: 2.0, shLx: -1.2, shRx: -1.2, elL: -1.8, elR: -1.8, spX: 0.7, nk: 0.5, bob: -0.5 * Math.sin(k * Math.PI) - 0.1 });
      return;
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
      return;
    }
    if (cb.block) {
      Object.assign(p, { shRx: -1.45, shRy: 0.95, elR: -1.05, shLx: -1.1, shLz: 0.2, elL: -1.4, spX: 0.16, nk: 0.08, thL: -0.2, knL: 0.25, knR: 0.2 });
    }
    if (v.hurt > 0) p.spX -= 0.3 * v.hurt;
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
      const k = 1 - Math.exp(-dt * 16);
      v.pos.x += (a.x - v.pos.x) * k;
      v.pos.z += (a.z - v.pos.z) * k;
      v.pos.y = hf.height(v.pos.x, v.pos.z);
      const sp = Math.hypot(v.pos.x - px, v.pos.z - pz) / Math.max(dt, 1e-3);
      v.speed = damp(v.speed, Math.min(sp, 7), 1 - Math.exp(-dt * 10));
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

      const walk = Math.min(1, v.speed / 1.2);
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
      if (node) {
        // 채집: 도끼·곡괭이는 위에서 내려찍고, 낫은 옆으로 벤다
        v.swing += dt * (skill === 'harvesting' ? 5.5 : 4.2);
        const w = v.swing % (Math.PI * 2);
        const strike = w < 4.4 ? Math.sin((w / 4.4) * Math.PI * 0.5) : 1 - (w - 4.4) / (Math.PI * 2 - 4.4);
        if (skill === 'harvesting') {
          const sw = Math.sin(v.swing);
          Object.assign(p, {
            thL: -0.35, thR: 0.2, knL: 0.75, knR: 0.55, ftL: 0, ftR: 0,
            spX: 0.42, spY: sw * 0.35, bob: -0.14, nk: 0.15,
            shRx: -0.9, shRy: sw * 0.9, shRz: 0.25, elR: -0.5,
            shLx: -0.6, shLz: -0.15, elL: -0.9,
          });
        } else {
          const up = 1 - strike;
          Object.assign(p, {
            thL: -0.25, thR: 0.18, knL: 0.3, knR: 0.25, ftL: 0, ftR: 0,
            spX: 0.1 + strike * 0.38, spY: -0.15, bob: -0.04 - strike * 0.05, nk: 0.1,
            shRx: -2.6 * up - 0.5 * strike, shRz: 0.1, elR: -0.9 * up - 0.15,
            shLx: -2.3 * up - 0.6 * strike, shLz: 0.25, elL: -0.8 * up - 0.2,
          });
        }
      } else if (casting) {
        const f = Math.sin(t * 3) * 0.05;
        Object.assign(p, { shLx: -1.3 + f, shRx: -1.3 - f, shLz: 0.35, shRz: -0.35, elL: -0.6, elR: -0.6, nk: 0.25, spX: 0.05 });
      }
      combatPose(v, a, p, wDef, dt);
      pose(v, p);
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
