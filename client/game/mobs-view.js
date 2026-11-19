// 짐승 그리기: 걸음(다리·머리·꼬리), 준비 동작(웅크림·붉은 번쩍임), 맞을 때 흰 번쩍임, 쓰러짐, 체력 막대.
// 판정은 코어가 한다. 여기서는 state.mobs를 보고 보이기만 한다.

import * as THREE from 'three';
import { makeCreature } from './models/creatures.js';

const lerpAngle = (a, b, k) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export function createMobsView(scene, game, hf, overlay) {
  const views = new Map();
  const tmp = new THREE.Vector3();
  const bars = new Map();

  function make(m) {
    const q = makeCreature(m.type, [...m.id].reduce((s, ch) => s + ch.charCodeAt(0), 0));
    scene.add(q.root);
    return { q, pos: new THREE.Vector3(m.x, hf.height(m.x, m.z), m.z), yaw: m.yaw, phase: Math.random() * 6, speed: 0, flash: 0, fall: 0, fade: 1 };
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
      if (v) v.flash = 1;
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
        v.fall = 0;
        bars.get(m.id)?.classList.remove('on');
        continue;
      }
      const px = v.pos.x;
      const pz = v.pos.z;
      const k = 1 - Math.exp(-dt * 14);
      v.pos.x += (m.x - v.pos.x) * k;
      v.pos.z += (m.z - v.pos.z) * k;
      v.pos.y = hf.height(v.pos.x, v.pos.z);
      const sp = Math.hypot(v.pos.x - px, v.pos.z - pz) / Math.max(dt, 1e-3);
      v.speed += (Math.min(sp, 12) - v.speed) * (1 - Math.exp(-dt * 10));
      v.yaw = lerpAngle(v.yaw, m.yaw, 1 - Math.exp(-dt * 10));
      const q = v.q;
      q.root.position.copy(v.pos);
      q.root.rotation.set(0, v.yaw, 0);
      // 걸음
      const stride = m.type === 'crab' ? 0.5 : m.type === 'deer' ? 1.6 : 1.1;
      v.phase += dt * v.speed * (Math.PI * 2 / stride);
      const walk = Math.min(1, v.speed / 1.0);
      for (const L of q.legs) {
        const s = Math.sin(v.phase + L.ph);
        if (L.side) L.g.rotation.y = s * 0.35 * walk;
        else L.g.rotation.x = s * 0.6 * walk;
      }
      const winding = m.mode === 'windup';
      const charging = m.mode === 'charge';
      const left = winding ? Math.max(0, (m.until - t) / type.attack.windup) : 0;
      q.torso.rotation.x = winding ? -0.12 * (1 - left) : charging ? 0.12 : Math.sin(v.phase * 2) * 0.02 * walk;
      q.torso.position.y = (q.torso.userData.y0 ??= q.torso.position.y) - (winding ? 0.06 * (1 - left) : 0) + Math.abs(Math.sin(v.phase)) * 0.03 * walk;
      if (q.neck) q.neck.rotation.y = Math.sin(v.phase * 0.5) * 0.08 * walk;
      if (q.head && m.type === 'crab') q.head.rotation.x = winding ? -0.5 * (1 - left) : 0;
      if (q.tail) q.tail.rotation.y = Math.sin(t * (m.mode === 'chase' ? 9 : 3)) * 0.35;
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

  return { update, onEvent, positionOf: (id) => views.get(id)?.pos };
}
