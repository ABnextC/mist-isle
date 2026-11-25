// 다른 세력 개척자(v2.6) 머리 위: 세력 색 이름과 체력 막대. 나와 싸울 수 있으면 붉다.
// 위치는 actors-view가 그린 모형 자리(positionOf)를 따른다.

import * as THREE from 'three';
import { hostile } from '../../core/systems/pvp.js';

export function createRivalLabels(overlay, game, positionOf, pid) {
  const els = new Map();
  const tmp = new THREE.Vector3();
  const ctx = () => ({ state: game.state, data: game.data, cfg: game.data.config, clock: game.clock });
  function el(id) {
    let e = els.get(id);
    if (!e) {
      e = document.createElement('div');
      e.className = 'mobbar rival';
      e.innerHTML = '<i></i><b></b>';
      overlay.appendChild(e);
      els.set(id, e);
    }
    return e;
  }
  function update(camera) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const me = game.state.actors[pid];
    const seen = new Set();
    for (const a of Object.values(game.state.actors)) {
      const other = a.kind === 'player' && a.id !== pid; // 멀티(v3.0): 다른 개척자
      if (a.kind !== 'rival' && !other) continue;
      seen.add(a.id);
      const e = el(a.id);
      const p = positionOf(a.id);
      const d = p ? Math.hypot(p.x - camera.position.x, p.z - camera.position.z) : 99;
      if (!p || d > 45 || a.cb.downUntil > 0) {
        e.classList.remove('on');
        continue;
      }
      tmp.set(p.x, p.y + 2.2, p.z).project(camera);
      if (tmp.z > 1) {
        e.classList.remove('on');
        continue;
      }
      e.classList.add('on');
      const foe = me && hostile(ctx(), me, a);
      e.classList.toggle('hostile', !!foe);
      e.style.transform = `translate(${((tmp.x + 1) / 2) * W}px, ${((1 - tmp.y) / 2) * H}px)`;
      e.firstChild.style.width = `${Math.max(0, (a.cb.hp / a.cb.maxHp) * 100)}%`;
      const band = other ? null : game.data.rivals.bands.find((x) => x.id === a.rival.band);
      const txt = other ? `Lv ${a.clevel.lvl} ${a.name}${a.offline ? ' · 자리 비움' : ''}` : `Lv ${a.clevel.lvl} ${a.name} · ${band?.name || a.rival.title || ''}`;
      const b = e.lastChild;
      if (b._t !== txt) {
        b.textContent = b._t = txt;
        b.style.color = other ? '#9fe0d0' : a.rival.color;
      }
    }
    for (const [id, e] of els) {
      if (seen.has(id)) continue;
      e.remove();
      els.delete(id);
    }
  }
  return { update };
}
