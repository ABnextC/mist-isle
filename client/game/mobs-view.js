// 짐승 그리기: 걸음(다리·머리·꼬리), 준비 동작(웅크림·붉은 번쩍임), 맞을 때 흰 번쩍임, 쓰러짐, 체력 막대.
// 판정은 코어가 한다. 여기서는 state.mobs를 보고 보이기만 한다.

import * as THREE from 'three';
import { tickLerp } from './interp.js';
import { makeCreature } from './models/creatures.js';

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

export function createMobsView(scene, game, hf, overlay) {
  const views = new Map();
  const tmp = new THREE.Vector3();
  const bars = new Map();

  function make(m) {
    const q = makeCreature(m.type, [...m.id].reduce((s, ch) => s + ch.charCodeAt(0), 0));
    scene.add(q.root);
    return { q, pos: new THREE.Vector3(m.x, hf.height(m.x, m.z), m.z), yaw: m.yaw, phase: Math.random() * 6, speed: 0, flash: 0, fall: 0, fade: 1,
      cyc: Math.random(), gait: 'walk', gaitK: 1, prevA: [], hurt: 0, lunge: 0, lastMode: m.mode, look: 0, lookTo: 0, lookIn: 1, breathe: Math.random() * 6 };
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
      let v = views.get(m.id);
      if (!v) {
        v = make(m);
        views.set(m.id, v);
      }
      seen.add(m.id);
      const type = data.creatures[m.type];
      const dead = m.mode === 'dead';
      const gone = dead && (m.skinned || t > m.deadAt + data.config.combat.corpseSec);
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
      const left = winding ? Math.max(0, (m.until - t) / type.attack.windup) : 0;
      // 물기: 준비 동작이 끝나 '물고 물러남'으로 바뀌는 순간 앞으로 덤빈다
      if (v.lastMode === 'windup' && m.mode === 'recover') v.lunge = 1;
      v.lastMode = m.mode;
      v.lunge = Math.max(0, v.lunge - dt * 3.2);
      v.hurt = Math.max(0, v.hurt - dt * 4);
      const lungeK = Math.sin(Math.min(1, 1 - v.lunge) * Math.PI) * (v.lunge > 0 ? 1 : 0);
      const hurtK = Math.sin(Math.min(1, v.hurt) * Math.PI * 0.5);
      v.breathe += dt * (m.mode === 'chase' || m.mode === 'flee' ? 5 : 1.6);
      const walk = Math.min(1, v.speed / 0.6);
      if (q.legs[0]?.kn && !dead) {
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
        q.neck.rotation.y = v.look + Math.sin(v.cyc * Math.PI * 2) * 0.05 * walk;
        q.neck.userData.x0 ??= q.neck.rotation.x;
        q.neck.rotation.x = q.neck.userData.x0 + 0.25 * lungeK + (winding ? 0.12 * (1 - left) : 0) + Math.sin(v.cyc * Math.PI * 4) * 0.04 * walk + Math.sin(v.breathe * 0.5) * 0.02
          + v.graze * (m.type === 'deer' ? 2.3 : 0.55);
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
      // 쓰러짐: 옆으로 눕는다
      if (dead) v.fall = Math.min(1, v.fall + dt * 3);
      q.root.rotation.z = (m.type === 'crab' ? Math.PI : Math.PI / 2) * v.fall;
      q.root.position.y = v.pos.y + (m.type === 'crab' ? 0.15 : type.r * 0.6) * v.fall;
      // 번쩍임: 맞으면 흰빛, 준비 동작이면 붉은빛이 깜빡인다
      v.flash = Math.max(0, v.flash - dt * 7);
      const tele = winding ? 0.35 + 0.35 * Math.sin(t * 40) : 0;
      q.m.emissive.setRGB(v.flash * 0.9 + tele * 0.9, v.flash * 0.9 + tele * 0.12, v.flash * 0.9 + tele * 0.08);
      q.m.opacity = v.fade;
      q.m.transparent = v.fade < 0.99;
      // 체력 막대: 다쳤거나 덤비는 짐승만
      const show = !dead && (m.hp < type.hp || m.target) && Math.hypot(m.x - camera.position.x, m.z - camera.position.z) < 40;
      const el = show ? bar(m.id) : bars.get(m.id);
      if (!el) continue;
      if (!show) {
        el.classList.remove('on');
        continue;
      }
      tmp.set(v.pos.x, v.pos.y + type.r * 2 + 0.7, v.pos.z).project(camera);
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
  }

  return { update, onEvent, views, positionOf: (id) => views.get(id)?.pos };
}
