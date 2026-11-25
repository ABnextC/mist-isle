// NPC 이름표와 머리 위 표시(v0.5): ! 이야기 시작, ? 이야기 이어 가기. 가까울 때만 이름표를 띄운다.
// 위치는 actors-view가 그린 모형 자리(positionOf)를 따른다.

import * as THREE from 'three';
import { npcMark } from '../../core/systems/quests.js';
import { npcRoutine } from '../../core/world.js';
import { questCtx } from './quest.js';

export function createNpcLabels(overlay, game, positionOf) {
  const els = new Map();
  const tmp = new THREE.Vector3();
  function el(id) {
    let e = els.get(id);
    if (!e) {
      e = document.createElement('div');
      e.className = 'npctag';
      e.innerHTML = '<b></b><span></span><small></small>';
      overlay.appendChild(e);
      els.set(id, e);
    }
    return e;
  }
  function update(camera, me) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const ctx = questCtx(game);
    for (const n of game.data.lists.npcs || []) {
      const p = positionOf(`npc:${n.id}`);
      const e = el(n.id);
      if (!p) {
        e.classList.remove('on');
        continue;
      }
      const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
      const mark = me ? npcMark(ctx, me, n.id) : null;
      if (d > (mark === 'side' ? 40 : mark ? 70 : 24)) {
        e.classList.remove('on');
        continue;
      }
      tmp.set(p.x, p.y + 2.25, p.z).project(camera);
      if (tmp.z > 1) {
        e.classList.remove('on');
        continue;
      }
      e.classList.add('on');
      e.classList.toggle('far', d > 24);
      e.style.transform = `translate(${((tmp.x + 1) / 2) * W}px, ${((1 - tmp.y) / 2) * H}px)`;
      const [b, span, small] = e.children;
      if (b._t !== (mark || '')) {
        b.textContent = mark === 'side' ? '!' : mark || '';
        b._t = mark || '';
        b.className = mark === '!' ? 'new' : mark === '?' ? 'due' : mark === 'side' ? 'side' : '';
      }
      if (span._t !== n.name) span.textContent = span._t = n.name;
      // 하루 동선(v1.5): 일터가 아닌 곳에 있으면 무엇을 하는지 덧붙인다
      const rp = n.routine ? npcRoutine(ctx, n) : null;
      const sub = rp?.what && rp.what !== '일하는 중' ? `${n.title} · ${rp.what}` : n.title;
      if (small._t !== sub) small.textContent = small._t = sub;
    }
  }
  return { update };
}
