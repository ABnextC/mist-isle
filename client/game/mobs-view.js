// 짐승 그리기: 걸음(다리·머리·꼬리), 준비 동작(웅크림·붉은 번쩍임), 맞을 때 흰 번쩍임, 쓰러짐, 체력 막대.
// 판정은 코어가 한다. 여기서는 state.mobs를 보고 보이기만 한다.

import { levelTone } from './level-color.js';
import * as THREE from 'three';
import { tickLerp } from './interp.js';
import { makeCreature } from './models/creatures.js';

const ZERO3 = [0, 0, 0];
const lerpAngle = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

// ── 네발 걸음새(v0.4.8): 속도에 따라 걷기(네 박자)·속보(대각선 짝)·질주(앞뒤 짝)를 고른다 ──
// 다리마다 위상 오프셋 [왼앞, 오른앞, 왼뒤, 오른뒤] 순서는 creatures.js의 legs 순서(-x=오른쪽)와 맞춘다.
// duty: 한 주기에서 발이 땅에 닿아 있는 비율. stride: 몸길이 대비 한 주기 보폭. lift: 다리 길이 대비 발 드는 높이
const GAITS = {
  walk: { off: [0.75, 0.25, 0.5, 0.0], duty: 0.64, stride: 0.95, lift: 0.1, bob: 0.012, pitch: 0.0 },
  trot: { off: [0.0, 0.5, 0.5, 0.0], duty: 0.46, stride: 1.55, lift: 0.16, bob: 0.025, pitch: 0.02 },
  gallop: { off: [0.55, 0.45, 0.1, 0.0], duty: 0.32, stride: 2.5, lift: 0.22, bob: 0.05, pitch: 0.09 },
};
const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
function gaitOf(type, sp) {
  if (sp < Math.max(0.6, type.walk * 1.35)) return 'walk';
  if (sp < type.speed * 0.72) return 'trot';
  return 'gallop';
}
// 다리 두 마디 IK(옆에서 본 평면): 엉덩이 기준 발 목표 (z 앞, y 위) → [엉덩이 각, 무릎 각]
function legIK(l1, l2, z, y, front) {
  const d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, Math.hypot(z, y)));
  const th = Math.atan2(-z, -y);
  const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const b = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  // 앞다리: 관절이 앞으로 나와 발이 뒤로 접힌다. 뒷다리: 관절이 뒤로 나와 발이 앞으로 접힌다
  return front ? [th - a, Math.PI - b] : [th + a, -(Math.PI - b)];
}

// 석상 앉은 자세(v0.5.1, 돌 해태): 몸 앞을 들고 엉덩이를 땅에 붙인다. 앞다리는 곧게, 뒷다리는 접는다
const SIT_PITCH = 0.55;
const lerp = (a, b, k) => a + (b - a) * k;

export function createMobsView(scene, game, hf, overlay, { posOf = null, wakeHint = null } = {}) {
  const views = new Map();
  const tmp = new THREE.Vector3();
  const bars = new Map();

  function make(m) {
    const q = makeCreature(m.type, [...m.id].reduce((s, ch) => s + ch.charCodeAt(0), 0));
    scene.add(q.root);
    return { q, pos: new THREE.Vector3(m.x, hf.height(m.x, m.z), m.z), yaw: m.yaw, phase: Math.random() * 6, speed: 0, flash: 0, fall: 0, fade: 1,
      cyc: Math.random(), gait: 'walk', gaitK: 1, prevA: [], hurt: 0, lunge: 0, lastMode: m.mode, look: 0, lookTo: 0, lookIn: 1, breathe: Math.random() * 6,
      wake: m.target || (m.mode !== 'idle' && m.mode !== 'wander') ? 1 : 0, wu: 1, slash: 0 };
  }

  function bar(id) {
    let el = bars.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'mobbar';
      el.innerHTML = '<i></i><b></b>';
      overlay.appendChild(el);
      bars.set(id, el);
    }
    return el;
  }

  function onEvent(ev) {
    if (ev.type === 'combat.hit') {
      const v = views.get(ev.mob);
      if (v) {
        v.flash = 1;
        v.hurt = 1;
      }
    }
  }

  function update(dt, camera) {
    const { state, data } = game;
    const t = state.t;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const seen = new Set();
    for (const m of Object.values(state.mobs)) {
      const type = data.creatures[m.type];
      // 사람 모양 적(v0.5)은 actors-view가 그린다. 여기서는 체력 막대와 이름만
      if (type.body) {
        seen.add(m.id);
        humanBar(m, type, camera, W, H);
        continue;
      }
      let v = views.get(m.id);
      if (!v) {
        v = make(m);
        views.set(m.id, v);
      }
      seen.add(m.id);
      const dead = m.mode === 'dead';
      const q0 = v.q;
      // 망령은 쓰러지면 곧 흩어진다
      const gone = m.mode === 'away' || (dead && (q0.float ? v.fall >= 1 : m.skinned || t > m.deadAt + data.config.combat.corpseSec));
      v.fade = gone ? Math.max(0, v.fade - dt * 1.5) : dead ? v.fade : Math.min(1, v.fade + dt * 2);
      v.q.root.visible = v.fade > 0.02;
      if (!dead && v.fall > 0 && v.fade < 0.1) v.fall = 0;
      if (!v.q.root.visible) {
        // 다시 날 때 그 자리로 곧장 옮긴다
        v.pos.set(m.x, hf.height(m.x, m.z), m.z);
        v.tk = undefined;
        v.fall = 0;
        bars.get(m.id)?.classList.remove('on');
        continue;
      }
      const px = v.pos.x;
      const pz = v.pos.z;
      [v.pos.x, v.pos.z] = tickLerp(v, m.x, m.z, state.tick, game.alpha ?? 1);
      v.pos.y = hf.height(v.pos.x, v.pos.z);
      const sp = Math.hypot(v.pos.x - px, v.pos.z - pz) / Math.max(dt, 1e-3);
      v.speed += (Math.min(sp, 12) - v.speed) * (1 - Math.exp(-dt * 10));
      v.yaw = lerpAngle(v.yaw, m.yaw, 1 - Math.exp(-dt * 10));
      const q = v.q;
      q.root.position.copy(v.pos);
      q.root.rotation.set(0, v.yaw, 0);
      const winding = m.mode === 'windup';
      const charging = m.mode === 'charge';
      // 준비 동작 길이: 공격마다 다르고(v0.5.1) 두목은 성나면 빨라지므로, 시작할 때 남은 시간을 잰다
      if (winding && v.lastMode !== 'windup') v.wu = Math.max(0.05, m.until - t);
      const left = winding ? Math.max(0, Math.min(1, (m.until - t) / v.wu)) : 0;
      const atk = type.attacks?.[m.atk?.i ?? 0] || type.attack;
      // 물기: 준비 동작이 끝나 '물고 물러남'으로 바뀌는 순간 앞으로 덤빈다
      if (v.lastMode === 'windup' && m.mode === 'recover') {
        v.lunge = 1;
        v.slash = 1;
      }
      v.lastMode = m.mode;
      v.lunge = Math.max(0, v.lunge - dt * 3.2);
      v.hurt = Math.max(0, v.hurt - dt * 4);
      const lungeK = Math.sin(Math.min(1, 1 - v.lunge) * Math.PI) * (v.lunge > 0 ? 1 : 0);
      const hurtK = Math.sin(Math.min(1, v.hurt) * Math.PI * 0.5);
      v.breathe += dt * (m.mode === 'chase' || m.mode === 'flee' ? 5 : 1.6);
      const walk = Math.min(1, v.speed / 0.6);
      if (q.float) floatPose(v, q, m, dt, t, { dead, winding, charging, left, atk, walk, lungeK, hurtK });
      else if (q.serpent) serpentPose(v, q, dt, { dead, winding, charging, left, atk, walk, lungeK, hurtK });
      else if (q.legs[0]?.kn && (!dead || q.statue)) {
        // 네발짐승: 걸음새를 골라 발이 땅을 디디게(딛는 동안 발이 뒤로 곧게, 드는 동안 앞으로 호를 그리며)
        const want = gaitOf(type, v.speed);
        if (want !== v.gait) {
          v.gait = want;
          v.gaitK = 0;
          for (let i = 0; i < q.legs.length; i++) v.prevA[i] = [q.legs[i].g.rotation.x, q.legs[i].kn.rotation.x];
        }
        v.gaitK = Math.min(1, v.gaitK + dt / 0.25);
        const G = GAITS[v.gait];
        const strideM = G.stride * q.L;
        v.cyc = (v.cyc + (dt * v.speed) / strideM) % 1;
        const bob = G.bob * walk;
        const lower = 0.04 * q.legs[0].l1 + (winding ? 0.08 * (1 - left) : 0) + (charging ? 0.05 : 0);
        // 풀 뜯을 땐 몸통 앞을 숙인다(앞다리는 굽히고 뒷다리는 편다) — 지난 장의 graze 값을 쓴다
        const gPitch = (v.graze ?? 0) * (m.type === 'deer' ? 0.14 : m.type === 'boar' ? 0.06 : 0);
        const gTilt = Math.sin(gPitch) * q.L * 0.4;
        for (let i = 0; i < q.legs.length; i++) {
          const L = q.legs[i];
          const reach = L.l1 + L.l2;
          const A = Math.min(0.5 * G.duty * strideM, 0.3 * reach) * walk;
          const p = (v.cyc + G.off[i]) % 1;
          let z;
          let y;
          if (p < G.duty) {
            z = A * (1 - (2 * p) / G.duty);
            y = 0;
          } else {
            const u = (p - G.duty) / (1 - G.duty);
            z = -A + 2 * A * smooth(u);
            y = G.lift * reach * Math.sin(Math.PI * u) * walk;
          }
          // 엉덩이 높이 = 다리 길이 - 몸 낮춤 - 출렁임
          const hipY = reach - lower - bob * Math.cos(v.cyc * Math.PI * (v.gait === 'gallop' ? 2 : 4)) - (L.front ? gTilt : -gTilt);
          let [a0, a1] = legIK(L.l1, L.l2, z, y - hipY, L.front);
          if (v.gaitK < 1 && v.prevA[i]) {
            const k = smooth(v.gaitK);
            a0 = v.prevA[i][0] + (a0 - v.prevA[i][0]) * k;
            a1 = v.prevA[i][1] + (a1 - v.prevA[i][1]) * k;
          }
          L.g.rotation.x = a0;
          L.kn.rotation.x = a1;
        }
        const y0 = (q.torso.userData.y0 ??= q.torso.position.y);
        q.torso.position.y = y0 - lower - bob * Math.cos(v.cyc * Math.PI * (v.gait === 'gallop' ? 2 : 4)) + Math.sin(v.breathe) * 0.004;
        q.torso.position.z = 0.18 * lungeK;
        // 몸통: 질주하면 앞뒤로 흔들리고, 준비 동작에 웅크리고(뒤로 앉듯), 돌진은 머리를 숙이고, 맞으면 움찔
        q.torso.rotation.x = (winding ? -0.12 * (1 - left) : charging ? 0.12 : 0) + G.pitch * walk * Math.sin(v.cyc * Math.PI * 2) + 0.16 * lungeK - 0.12 * hurtK + gPitch;
        q.torso.rotation.z = 0.1 * hurtK * (v.flashSide || 1);
        if (q.statue) sitPose(v, q, m, dt, type, dead);
      } else if (!dead) {
        // 게: 옆으로 종종걸음(세 다리씩 번갈아)
        v.phase += dt * v.speed * (Math.PI * 2 / 0.5);
        for (const L of q.legs) {
          const s = Math.sin(v.phase + L.ph);
          if (L.side) {
            L.g.rotation.y = s * 0.35 * walk;
            L.g.rotation.x = Math.max(0, Math.cos(v.phase + L.ph)) * 0.25 * walk;
          } else L.g.rotation.x = s * 0.6 * walk;
        }
        const y0 = (q.torso.userData.y0 ??= q.torso.position.y);
        q.torso.position.y = y0 - (winding ? 0.06 * (1 - left) : 0) + Math.abs(Math.sin(v.phase)) * 0.015 * walk + Math.sin(v.breathe) * 0.003;
        q.torso.rotation.x = winding ? -0.12 * (1 - left) : 0.1 * lungeK - 0.1 * hurtK;
      } else {
        // 쓰러지면 다리가 힘없이 풀린다
        for (const L of q.legs) {
          L.g.rotation.x *= 1 - Math.min(1, dt * 4);
          if (L.kn) L.kn.rotation.x = L.kn.rotation.x * (1 - Math.min(1, dt * 4)) + (L.front ? 0.5 : -0.5) * Math.min(1, dt * 4) * v.fall;
        }
      }
      // 풀 뜯기(사슴·멧돼지, v0.4.9): 가만히 있을 때 이따금 고개를 땅으로 숙이고 씹는다
      const grazer = m.type === 'deer' || m.type === 'boar';
      if (grazer && m.mode === 'idle' && walk < 0.1 && !dead) {
        v.grazeIn = (v.grazeIn ?? Math.random() * 3) - dt;
        if (v.grazeIn <= 0) {
          v.grazing = !v.grazing;
          v.grazeIn = v.grazing ? 3 + Math.random() * 4 : 2 + Math.random() * 4;
        }
      } else v.grazing = false;
      v.graze = (v.graze ?? 0) + ((v.grazing ? 1 : 0) - (v.graze ?? 0)) * (1 - Math.exp(-dt * 2.5));
      // 고개: 서 있을 땐 이따금 두리번, 달리면 앞을 보고 걸음에 맞춰 끄덕, 물 때 숙인다
      v.lookIn -= dt;
      if (v.lookIn <= 0) {
        v.lookIn = 1.5 + Math.random() * 3;
        v.lookTo = m.mode === 'idle' ? (Math.random() - 0.5) * 1.1 : 0;
      }
      v.look += (v.lookTo * (1 - walk) * (1 - v.graze) - v.look) * (1 - Math.exp(-dt * 3));
      if (q.neck) {
        q.neck.userData.x0 ??= q.neck.rotation.x;
        // 석상: 앉아 있을 땐 고개를 들고 꼼짝하지 않는다. 쓰러지면 고개를 떨군다
        const sit = q.statue ? 1 - smooth(v.wake) : 0;
        q.neck.rotation.y = (v.look + Math.sin(v.cyc * Math.PI * 2) * 0.05 * walk) * (1 - sit);
        q.neck.rotation.x = q.neck.userData.x0 + (0.25 * lungeK + (winding ? 0.12 * (1 - left) : 0) + Math.sin(v.cyc * Math.PI * 4) * 0.04 * walk + Math.sin(v.breathe * 0.5) * 0.02
          + v.graze * (m.type === 'deer' ? 2.3 : 0.55)) * (1 - sit) + sit * 0.45 + (q.statue && dead ? 0.8 * v.fall : 0);
      }
      if (q.head && grazer) {
        q.head.userData.x0 ??= q.head.rotation.x;
        q.head.userData.z0 ??= q.head.position.z;
        // 사슴은 목 끝까지 머리를 내밀어 땅에 닿게 한다(서 있을 땐 머리가 목 가운데쯤에 붙어 있다)
        if (m.type === 'deer') q.head.position.z = q.head.userData.z0 + v.graze * 0.22;
        // 목을 내린 만큼 머리는 땅을 보게(사슴은 목이 길어 머리를 조금 든다), 씹을 땐 끄덕
        q.head.rotation.x = q.head.userData.x0 + v.graze * ((m.type === 'deer' ? -0.4 : 0.3) + 0.05 * Math.sin(t * 13));
      }
      if (q.head && m.type === 'crab') q.head.rotation.x = winding ? -0.5 * (1 - left) : -0.3 * lungeK;
      if (q.claws) {
        // 집게: 노릴 땐 벌렸다가 덮칠 때 확 오므리고, 쉴 땐 이따금 딸깍인다
        v.clackIn = (v.clackIn ?? 1 + Math.random() * 3) - dt;
        if (v.clackIn <= 0) { v.clackIn = 1.5 + Math.random() * 3.5; v.clackT = t; }
        const clack = !dead && v.clackT != null && t - v.clackT < 0.5 ? Math.abs(Math.sin((t - v.clackT) * Math.PI * 4)) : 0;
        const open = dead ? 0.15 : winding ? 0.35 * (1 - left) : m.mode === 'chase' ? 0.18 : 0;
        const pinch = open - 0.3 * lungeK - 0.14 * clack;
        for (const c of q.claws) c.g.rotation.y = c.sx * pinch;
      }
      // 꼬리: 쫓을 땐 빠르게, 쉴 땐 느리게, 달리면 뒤로 뻗는다
      if (q.tail) {
        q.tail.rotation.y = Math.sin(t * (m.mode === 'chase' ? 9 : 2.4)) * (0.35 - 0.2 * walk);
        q.tail.rotation.x = -0.35 * walk * (v.speed > type.walk * 1.5 ? 1 : 0.4);
      }
      // 쓰러짐: 옆으로 눕는다. 망령은 흩어지고(floatPose), 석상은 앉은 채 고개를 떨군다
      if (dead) v.fall = Math.min(1, v.fall + dt * (q.float ? 0.8 : 3));
      if (!q.float && !q.statue) {
        q.root.rotation.z = (m.type === 'crab' ? Math.PI : Math.PI / 2) * v.fall;
        q.root.position.y = v.pos.y + (m.type === 'crab' ? 0.15 : type.r * 0.6) * v.fall;
      }
      // 번쩍임: 맞으면 흰빛, 준비 동작이면 붉은빛이 깜빡인다
      v.flash = Math.max(0, v.flash - dt * 7);
      const tele = winding ? 0.35 + 0.35 * Math.sin(t * 40) : 0;
      const e0 = q.emis || ZERO3;
      q.m.emissive.setRGB(e0[0] + v.flash * 0.9 + tele * 0.9, e0[1] + v.flash * 0.9 + tele * 0.12, e0[2] + v.flash * 0.9 + tele * 0.08);
      const op = (q.alpha ?? 1) * v.fade * (q.float ? 1 - v.fall : 1);
      q.m.opacity = op;
      q.m.transparent = q.alpha != null || op < 0.99;
      if (q.glow) glowOf(v, q, m, t, dead, type);
      // 체력 막대: 다쳤거나 덤비는 짐승만
      const show = !dead && (m.hp < type.hp || m.target) && Math.hypot(m.x - camera.position.x, m.z - camera.position.z) < 40;
      const el = show ? bar(m.id) : bars.get(m.id);
      if (!el) continue;
      if (!show) {
        el.classList.remove('on');
        continue;
      }
      tmp.set(v.pos.x, v.pos.y + (q.float ? 2.35 : type.r * 2 + 0.7), v.pos.z).project(camera);
      if (tmp.z > 1) {
        el.classList.remove('on');
        continue;
      }
      el.classList.add('on');
      el.classList.toggle('hostile', !!m.target);
      el.style.transform = `translate(${((tmp.x + 1) / 2) * W}px, ${((1 - tmp.y) / 2) * H}px)`;
      el.firstChild.style.width = `${Math.max(0, (m.hp / type.hp) * 100)}%`;
      el.lastChild.textContent = type.name;
    }
    for (const [id, v] of views) {
      if (seen.has(id)) continue;
      scene.remove(v.q.root);
      views.delete(id);
      bars.get(id)?.remove();
      bars.delete(id);
    }
    for (const [id, el] of bars) {
      if (seen.has(id)) continue;
      el.remove();
      bars.delete(id);
    }
  }

  // 떠다니는 망령(v0.5.1): 땅 위에 떠서 출렁이고, 쫓을 땐 몸을 앞으로 숙여 두 팔을 뻗는다.
  // 할퀴기는 두 팔을 머리 위로 들었다 내리긋고, 덮치기는 팔을 앞으로 뻗은 채 날아든다. 쓰러지면 위로 흩어진다
  // 뱀(v0.6.1 이무기): 물결치듯 마디가 좌우로 굽이친다. 준비 동작엔 앞몸을 들고, 감기(사방)는 몸을 둥글게 만다
  function serpentPose(v, q, dt, { dead, winding, charging, left, atk, walk, lungeK, hurtK }) {
    v.phase += dt * (dead ? 0 : 1.4 + v.speed * 1.2);
    const n = q.segs.length;
    const coil = winding && atk?.arc === 360 ? 1 - left : 0;
    const rear = winding && atk?.arc !== 360 ? 1 - left : 0;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const amp = (0.18 + 0.5 * walk + (charging ? -0.1 : 0)) * Math.pow(k, 0.7) + 0.05;
      const g = q.segs[i];
      const wave = Math.sin(v.phase - i * 0.65) * amp * (dead ? 0.4 : 1);
      // 감기: 꼬리를 앞으로 휘감아 고리를 만든다
      const ang = coil * k * Math.PI * 1.6;
      const r0 = -q.segZ[i];
      const cx = Math.sin(ang) * r0 * 0.55;
      const cz = -Math.cos(ang) * r0 * (1 - coil * 0.45);
      g.position.x = wave * (1 - coil) + cx * coil;
      g.position.z = q.segZ[i] * (1 - coil) + cz * coil;
      g.position.y = q.segY[i] + (i < 5 ? rear * (1.5 - i * 0.3) : 0) + (dead ? -0.2 * v.fall : 0);
      g.rotation.y = Math.cos(v.phase - i * 0.65) * amp * 0.6 * (1 - coil);
    }
    const s0 = q.segs[0];
    q.head.position.set(s0.position.x, s0.position.y + 0.12, 0.55 + 0.6 * lungeK + (charging ? 0.3 : 0));
    q.head.rotation.x = rear ? -0.35 : 0.25 * lungeK - 0.15 * hurtK;
    q.head.rotation.y = Math.cos(v.phase) * 0.15 * walk;
  }

  function floatPose(v, q, m, dt, t, { dead, winding, charging, left, atk, walk, lungeK, hurtK }) {
    const k = 1 - Math.exp(-dt * 10);
    const hover = 0.32 + Math.sin(v.breathe * 1.3) * 0.07;
    q.root.position.y = v.pos.y + hover + v.fall * 0.8;
    const spread = 1 + v.fall * 0.7;
    q.root.scale.set(spread, 1 - v.fall * 0.35, spread);
    q.root.rotation.z = 0;
    const chase = m.mode === 'chase' ? 1 : 0;
    const lunge = atk?.charge;
    const lean = dead ? -0.3 * v.fall : 0.25 * chase * walk + (winding ? (lunge ? 0.15 : -0.3) * (1 - left) : 0) + (charging ? 0.55 : 0) + 0.3 * lungeK - 0.25 * hurtK;
    q.torso.rotation.x += (lean - q.torso.rotation.x) * k;
    q.torso.rotation.z = Math.sin(v.breathe * 0.7) * 0.05 + 0.15 * hurtK * (v.flashSide || 1);
    v.slash = Math.max(0, v.slash - dt * 3.2);
    const cut = smooth(1 - v.slash);
    for (const A of q.arms) {
      let sh = 0.1 + Math.sin(v.breathe + A.sx) * 0.12;
      let el = -0.35;
      let side = A.sx * 0.12;
      if (chase) {
        sh = -0.85 + Math.sin(t * 6 + A.sx) * 0.15;
        el = -0.45;
      }
      if (winding) {
        const w = 1 - left;
        if (lunge) {
          sh = -1.0 - 0.45 * w;
          el = -0.15;
          side = A.sx * (0.12 - 0.08 * w);
        } else {
          sh = -0.9 - 1.6 * w;
          el = -1.0 * w;
          side = A.sx * (0.15 + 0.35 * w);
        }
      } else if (charging) {
        sh = -1.55;
        el = -0.1;
        side = A.sx * 0.05;
      } else if (m.mode === 'recover' && v.slash > 0 && !lunge) {
        // 내리긋기: 머리 위에서 앞아래로
        sh = -2.5 + 2.1 * cut;
        el = -1.0 + 0.7 * cut;
        side = A.sx * (0.5 - 0.4 * cut);
      }
      if (dead) {
        sh = 0.4 * v.fall;
        el = -0.2;
        side = A.sx * (0.12 + 0.6 * v.fall);
      }
      A.g.rotation.x += (sh - A.g.rotation.x) * (winding || charging || v.slash > 0 ? 1 - Math.exp(-dt * 22) : k);
      A.kn.rotation.x += (el - A.kn.rotation.x) * k;
      A.g.rotation.z += (side - A.g.rotation.z) * k;
    }
    if (q.head) q.head.rotation.x = (winding ? -0.2 * (1 - left) : 0) + 0.15 * lungeK;
  }

  // 석상: 깨어나기 전엔 앉아 있다. 노리는 상대가 생기면(rise) 정해진 시간에 걸쳐 일어선다
  function sitPose(v, q, m, dt, type, dead) {
    const want = !dead && (m.target || (m.mode !== 'idle' && m.mode !== 'wander')) ? 1 : 0;
    const rise = type.rise || 2;
    v.wake = Math.max(0, Math.min(1, v.wake + (want > v.wake ? dt / rise : want < v.wake ? -dt / 2.5 : 0)));
    const s = 1 - smooth(v.wake);
    if (s < 0.001) return;
    const P = SIT_PITCH;
    const L0 = q.legs[0];
    const reach = L0.l1 + L0.l2;
    const rad = q.rad ?? 0.4;
    const yFront = -0.2 * rad * Math.cos(P) + 0.36 * q.L * Math.sin(P);
    q.torso.position.y = lerp(q.torso.position.y, reach - yFront - (dead ? 0.08 * v.fall : 0), s);
    q.torso.position.z = lerp(q.torso.position.z, 0, s);
    q.torso.rotation.x = lerp(q.torso.rotation.x, -P + (dead ? 0.12 * v.fall : 0), s);
    q.torso.rotation.z = lerp(q.torso.rotation.z, 0, s);
    // 뒷다리: 허벅지는 앞아래로 땅에 눕고(무릎이 땅에 닿게), 정강이는 그 밑으로 접는다
    const yT = reach - yFront;
    const hipRear = yT - 0.2 * rad * Math.cos(P) - 0.36 * q.L * Math.sin(P);
    for (const L of q.legs) {
      let a0 = P - 0.02;
      let a1 = 0;
      if (!L.front) {
        const thighW = -(Math.PI / 2 - Math.asin(Math.min(1, Math.max(0, hipRear / L.l1))));
        a0 = thighW + P;
        a1 = 1.52 - thighW;
      }
      L.g.rotation.x = lerp(L.g.rotation.x, a0, s);
      L.kn.rotation.x = lerp(L.kn.rotation.x, a1, s);
    }
  }

  function glowOf(v, q, m, t, dead, type) {
    if (q.float) {
      q.glow.opacity = v.fade * (1 - v.fall);
      // 덤비기 직전엔 눈이 붉게 타오른다(하얀 몸에는 붉은 번쩍임이 잘 안 보인다)
      if (m.mode === 'windup') q.glow.color.setRGB(1, 0.3 + 0.15 * Math.sin(t * 40), 0.22);
      else q.glow.color.setRGB(0.62, 0.91, 1);
      // 두건 속 어둠은 불투명이라, 흩어지거나 사라질 땐 먼저 지운다
      if (q.face) q.face.visible = v.fall < 0.3 && v.fade > 0.6;
      return;
    }
    // 돌 해태: 깨어나면 눈과 가슴 영석이 새파랗게. 이야기를 받은 개척자에겐 잠든 채로도 희미하게 번뜩인다
    const hint = !dead && v.wake < 0.05 && wakeHint?.(type) ? 0.3 + 0.12 * Math.sin(t * 2.2) : 0;
    // 몸을 일으키기 시작하면 바로 눈에 불이 들어온다
    const k = dead ? Math.max(0, 1 - v.fall * 1.5) * 0.15 : Math.max(Math.min(1, v.wake * 6) * (0.85 + 0.15 * Math.sin(t * 5)), hint);
    q.glow.color.setRGB(0.18 + 0.4 * k, 0.2 + 0.72 * k, 0.22 + 0.78 * k);
  }

  // 약탈단 체력 막대: 다쳤거나 덤빌 때. 부두목·두목은 이름에 칭호
  function humanBar(m, type, camera, W, H) {
    const dead = m.mode === 'dead' || m.mode === 'away';
    const show = !dead && (m.hp < type.hp || m.target) && Math.hypot(m.x - camera.position.x, m.z - camera.position.z) < 45;
    const el = show ? bar(m.id) : bars.get(m.id);
    if (!el) return;
    if (!show) {
      el.classList.remove('on');
      return;
    }
    const p = posOf?.(m.id);
    if (p) tmp.set(p.x, p.y + 2.15, p.z);
    else tmp.set(m.x, hf.height(m.x, m.z) + 2.15, m.z);
    tmp.project(camera);
    if (tmp.z > 1) {
      el.classList.remove('on');
      return;
    }
    el.classList.add('on');
    el.classList.toggle('hostile', !!m.target);
    el.classList.toggle('elite', !!(type.elite || type.boss));
    el.classList.toggle('guard', m.mode === 'guard');
    el.style.transform = `translate(${((tmp.x + 1) / 2) * W}px, ${((1 - tmp.y) / 2) * H}px)`;
    el.firstChild.style.width = `${Math.max(0, (m.hp / type.hp) * 100)}%`;
    const lv = type.level || 1;
    const txt = `Lv ${lv} ${type.name}${m.mode === 'guard' ? ' 🛡️' : ''}`;
    if (el.lastChild._t !== txt) el.lastChild.textContent = el.lastChild._t = txt;
    // 레벨 색(v3.1)
    const tone = levelTone(game.state.actors[game.pid || 'p1']?.clevel?.lvl || 1, lv).cls;
    if (el._tone !== tone) {
      if (el._tone) el.classList.remove(el._tone);
      el.classList.add(tone);
      el._tone = tone;
    }
  }

  return { update, onEvent, views, positionOf: (id) => views.get(id)?.pos };
}
