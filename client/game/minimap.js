// 미니맵: 위가 북쪽(z가 큰 쪽). 산지 소문은 점선 고리, 가까운 노드는 점으로.

import { valueNoise } from '../../core/terrain.js';

const DOT = { logging: '#f2ead2', mining: '#ff9a4a', harvesting: '#a6ec74', hunting: '#e0a070' };

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
      if (m.mode === 'dead' || Math.abs(m.x - a.x) > 60 || Math.abs(m.z - a.z) > 60) continue;
      const [mx, my] = toPx(m.x, m.z);
      g.fillStyle = m.target ? '#ff5040' : 'rgba(255, 200, 120, 0.8)';
      g.beginPath();
      g.arc(mx, my, 1.8, 0, Math.PI * 2);
      g.fill();
    }
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
