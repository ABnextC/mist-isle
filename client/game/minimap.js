// 미니맵: 위가 북쪽(z가 큰 쪽). 산지 소문은 점선 고리, 가까운 노드는 점으로.

import { paintMinimap } from './terrain-mesh.js';

const DOT = { logging: '#f2ead2', mining: '#ff9a4a', harvesting: '#a6ec74' };

export function createMinimap(canvas, game, terrain) {
  const region = game.data.lists.regions[0];
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

  function draw(actorId, camYaw) {
    const { state, data } = game;
    const a = state.actors[actorId];
    g.drawImage(bg, 0, 0);
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.strokeStyle = 'rgba(255, 238, 170, 0.7)';
    for (const v of Object.values(state.veins)) {
      if (v.common || !v.center) continue;
      const [px, py] = toPx(v.center[0], v.center[1]);
      g.beginPath();
      g.arc(px, py, v.radius * scale + 3, 0, Math.PI * 2);
      g.stroke();
    }
    g.setLineDash([]);
    for (const n of Object.values(state.nodes)) {
      if (n.charges <= 0 || Math.abs(n.x - a.x) > 70 || Math.abs(n.z - a.z) > 70) continue;
      const [px, py] = toPx(n.x, n.z);
      g.fillStyle = DOT[data.nodes[n.type].skill];
      g.fillRect(px - 1, py - 1, 2.2, 2.2);
    }
    for (const s of Object.values(state.settlements)) {
      const [px, py] = toPx(s.x, s.z);
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#2b2b2b';
      g.beginPath();
      g.arc(px, py, 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
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
