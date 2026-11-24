// 미니맵: 위가 북쪽(z가 큰 쪽). 산지 소문은 점선 고리, 가까운 노드는 점으로.

import { regionAt } from '../../core/terrain.js';
import { valueNoise } from '../../core/terrain.js';
import { npcPos } from '../../core/world.js';
import { hasMark } from '../../core/systems/quests.js';
import { isUnlocked } from '../../core/systems/unlocks.js';

const DOT = { logging: '#f2ead2', mining: '#ff9a4a', harvesting: '#a6ec74', hunting: '#e0a070' };

export function createMinimap(canvas, game, terrain) {
  // 내가 있는 섬(v0.6)
  const region = regionAt(game.data.lists.regions, game.state.actors.p1?.x ?? 0);
  const [x0, z0, x1, z1] = region.bounds;
  const PX = 200;
  canvas.width = PX;
  canvas.height = PX;
  const bg = document.createElement('canvas');
  bg.width = PX;
  bg.height = PX;
  paintMinimap(bg.getContext('2d'), terrain, region.bounds, PX);
  const g = canvas.getContext('2d');
  const toPx = (x, z) => [((x - x0) / (x1 - x0)) * PX, ((z1 - z) / (z1 - z0)) * PX];
  const scale = PX / (x1 - x0);

  function draw(actorId, camYaw, goal = null, time = 0) {
    const { state, data } = game;
    const a = state.actors[actorId];
    g.drawImage(bg, 0, 0);
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    // 등불의 각인(v0.5.1): 영맥이 느껴진다 — 산지 고리가 푸르고, 더 먼 노드까지 보인다
    const mark = hasMark(a, 'lantern_mark');
    g.strokeStyle = mark ? 'rgba(140, 225, 255, 0.85)' : 'rgba(255, 238, 170, 0.7)';
    // 산지 소문 고리는 3장부터(v0.5.2 해금)
    const rumors = isUnlocked({ state, data }, a, 'rumors');
    for (const v of rumors ? Object.values(state.veins) : []) {
      if (v.common || !v.center || v.region !== region.id) continue;
      const [px, py] = toPx(v.center[0], v.center[1]);
      g.beginPath();
      g.arc(px, py, v.radius * scale + 3, 0, Math.PI * 2);
      g.stroke();
    }
    // 참나무 숲 경계(v0.3)와 가까이서 덤비는 짐승
    for (const zn of region.zones || []) {
      const [, zy] = toPx(x0, zn.z0);
      g.fillStyle = 'rgba(20, 50, 18, 0.28)';
      g.fillRect(0, 0, PX, zy);
      g.strokeStyle = 'rgba(190, 230, 160, 0.75)';
      g.beginPath();
      g.moveTo(0, zy);
      g.lineTo(PX, zy);
      g.stroke();
      g.fillStyle = 'rgba(220, 245, 200, 0.9)';
      g.font = '10px sans-serif';
      g.fillText(`${zn.name} T${zn.tier}`, 6, zy - 4);
    }
    g.setLineDash([]);
    for (const m of Object.values(state.mobs || {})) {
      if (m.mode === 'dead' || m.mode === 'away' || Math.abs(m.x - a.x) > 60 || Math.abs(m.z - a.z) > 60) continue;
      const [mx, my] = toPx(m.x, m.z);
      const T = data.creatures[m.type];
      // 약탈단·밤 짐승은 늘 붉게(v0.5), 두목은 크게
      g.fillStyle = m.target ? '#ff5040' : T.faction || T.night ? 'rgba(235, 90, 70, 0.9)' : 'rgba(255, 200, 120, 0.8)';
      g.beginPath();
      g.arc(mx, my, T.boss || T.elite ? 3 : 1.8, 0, Math.PI * 2);
      g.fill();
    }
    // 약탈단 자리(v0.5): 검은 깃발 표시와 이름. 옛터(v0.5.1)는 푸른 불꽃
    for (const s of region.sites || []) {
      if (!s.members) continue;
      const [sx0, sz0] = s.beach ? terrain.beachPoint(s.beach[0], s.beach[1]) : [s.x, s.z];
      const [px, py] = toPx(sx0, sz0);
      if (!s.members.some((x) => data.creatures[x.type].faction)) {
        g.fillStyle = '#9fe6ff';
        g.strokeStyle = '#173040';
        g.beginPath();
        g.moveTo(px, py - 6);
        g.quadraticCurveTo(px + 4.5, py - 1, px + 2.5, py + 3.5);
        g.lineTo(px - 2.5, py + 3.5);
        g.quadraticCurveTo(px - 4.5, py - 1, px, py - 6);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = 'rgba(200, 238, 255, 0.95)';
        g.font = '10px sans-serif';
        g.fillText(s.name, px + 6, py + 3);
        continue;
      }
      g.fillStyle = '#1d1b1c';
      g.strokeStyle = '#e05a4f';
      g.beginPath();
      g.moveTo(px - 3, py + 5);
      g.lineTo(px - 3, py - 6);
      g.lineTo(px + 5, py - 3);
      g.lineTo(px - 3, py);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(255, 190, 170, 0.9)';
      g.font = '10px sans-serif';
      g.fillText(s.name, px + 6, py + 3);
    }
    // NPC: 할 이야기가 있으면 금빛
    for (const n of data.lists.npcs || []) {
      const np = npcPos(game, n.id);
      if (!np) continue;
      const [px, py] = toPx(np.x, np.z);
      const due = Object.keys(a.quests?.active || {}).some((id) => { const q = data.quests[id]; const st = q.steps[a.quests.active[id].step]; return st?.type === 'talk' && st.npc === n.id; });
      if (!due) continue;
      g.fillStyle = '#ffd24a';
      g.beginPath();
      g.arc(px, py, 3.2, 0, Math.PI * 2);
      g.fill();
    }
    const near = mark ? 130 : 70;
    for (const n of Object.values(state.nodes)) {
      if (n.charges <= 0 || Math.abs(n.x - a.x) > near || Math.abs(n.z - a.z) > near) continue;
      const [px, py] = toPx(n.x, n.z);
      // 각인이 있으면 산지(소문난 영맥) 노드는 푸르게 반짝인다
      if (mark && !state.veins[n.vein]?.common) {
        g.fillStyle = `rgba(140, 225, 255, ${0.65 + 0.35 * Math.sin(time * 3 + n.x)})`;
        g.fillRect(px - 1.6, py - 1.6, 3.2, 3.2);
        continue;
      }
      g.fillStyle = DOT[data.nodes[n.type].skill];
      g.fillRect(px - 1, py - 1, 2.2, 2.2);
    }
    for (const s of Object.values(state.settlements)) {
      if (s.region !== region.id) continue;
      const [px, py] = toPx(s.x, s.z);
      const home = a.home === s.id;
      g.fillStyle = '#ffffff';
      g.strokeStyle = home ? '#f1d58a' : '#2b2b2b';
      g.lineWidth = home ? 2 : 1;
      g.beginPath();
      g.arc(px, py, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.lineWidth = 1;
      // 마을 이름(v0.4: 마을이 둘)
      g.font = '10px sans-serif';
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 2.5;
      g.strokeText(s.name, px + 7, py + 3);
      g.fillText(s.name, px + 7, py + 3);
      g.lineWidth = 1;
    }
    // 개척 일지 목표(v0.4.3): 금빛 마름모와 점선
    if (goal) {
      const [gx, gy] = toPx(goal.x, goal.z);
      const [ax, ay] = toPx(a.x, a.z);
      g.setLineDash([4, 3]);
      g.strokeStyle = 'rgba(255, 207, 90, 0.75)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(gx, gy);
      g.stroke();
      g.setLineDash([]);
      const r = 5 + Math.sin(time * 4) * 1.2;
      g.fillStyle = '#ffcf5a';
      g.strokeStyle = '#3a2a08';
      g.beginPath();
      g.moveTo(gx, gy - r);
      g.lineTo(gx + r * 0.75, gy);
      g.lineTo(gx, gy + r);
      g.lineTo(gx - r * 0.75, gy);
      g.closePath();
      g.fill();
      g.stroke();
      g.lineWidth = 1;
    }
    const [px, py] = toPx(a.x, a.z);
    g.save();
    g.translate(px, py);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 22, camYaw - Math.PI / 2 - 0.5, camYaw - Math.PI / 2 + 0.5);
    g.closePath();
    g.fill();
    g.rotate(a.yaw || 0);
    g.fillStyle = '#2fe0bd';
    g.strokeStyle = '#0b2b26';
    g.beginPath();
    g.moveTo(0, -6.5);
    g.lineTo(4.5, 4.5);
    g.lineTo(0, 2.5);
    g.lineTo(-4.5, 4.5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  return { draw };
}

// 미니맵 바탕 그림(위가 북쪽 = z가 큰 쪽)
export function paintMinimap(ctx2d, terrain, bounds, px) {
  const [x0, z0, x1, z1] = bounds;
  const img = ctx2d.createImageData(px, px);
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const x = x0 + ((i + 0.5) / px) * (x1 - x0);
      const z = z1 - ((j + 0.5) / px) * (z1 - z0);
      const h = terrain.height(x, z);
      let c;
      if (h < -0.3) c = [52, 112, 132];
      else if (h < 1.3) c = [214, 196, 146];
      else if (h > 17) c = [128, 122, 112];
      else {
        const g = 0.85 + 0.15 * valueNoise(x / 12, z / 12, 9);
        c = [106 * g + h * 2, 150 * g - h * 1.5, 84 * g];
      }
      const k = (j * px + i) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  }
  ctx2d.putImageData(img, 0, 0);
}
