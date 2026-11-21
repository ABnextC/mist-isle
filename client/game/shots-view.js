// 날아가는 손도끼(v0.5): 코어의 state.shots를 틱 사이로 이어 그리고 빙글빙글 돌린다.
// 화면은 행위자처럼 틱 하나 늦게 그린다(손도끼가 사람보다 앞서 보이지 않게).

import * as THREE from 'three';

export function createShotsView(scene, game, hf) {
  const views = new Map();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4c30, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.35, metalness: 0.9 });
  const handle = new THREE.CylinderGeometry(0.018, 0.022, 0.5, 6);
  handle.translate(0, 0.08, 0);
  const head = new THREE.BoxGeometry(0.03, 0.1, 0.15);
  head.translate(0, 0.3, 0.06);
  const blade = new THREE.BoxGeometry(0.012, 0.15, 0.05);
  blade.translate(0, 0.3, 0.15);
  function make() {
    const g = new THREE.Group();
    const spin = new THREE.Group();
    g.add(spin);
    for (const [geo, m] of [[handle, wood], [head, metal], [blade, metal]]) {
      const o = new THREE.Mesh(geo, m);
      o.castShadow = true;
      spin.add(o);
    }
    scene.add(g);
    return { g, spin };
  }
  function update() {
    const HZ = game.data.config.time.hz;
    const lag = ((game.alpha ?? 1) - 1) / HZ;
    const seen = new Set();
    for (const s of game.state.shots || []) {
      seen.add(s.id);
      let v = views.get(s.id);
      if (!v) {
        v = make();
        views.set(s.id, v);
      }
      const x = s.x + s.vx * lag;
      const z = s.z + s.vz * lag;
      const life = Math.max(0, game.state.t + lag - s.t0);
      const span = Math.max(0.1, s.until - s.t0);
      // 손에서 떠나 낮은 포물선을 그린다
      const y = hf.height(x, z) + 1.25 + Math.sin(Math.min(1, life / span) * Math.PI) * 0.35;
      v.g.position.set(x, y, z);
      v.g.rotation.y = Math.atan2(s.vx, s.vz);
      v.spin.rotation.x = life * 17;
    }
    for (const [id, v] of views) {
      if (seen.has(id)) continue;
      scene.remove(v.g);
      views.delete(id);
    }
  }
  return { update };
}
