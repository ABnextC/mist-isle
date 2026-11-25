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
    g.scale.setScalar(1.35); // 날아오는 걸 알아보고 피할 수 있게 조금 크게
    for (const [geo, m] of [[handle, wood], [head, metal], [blade, metal]]) {
      const o = new THREE.Mesh(geo, m);
      o.castShadow = true;
      spin.add(o);
    }
    scene.add(g);
    return { g, spin };
  }
  // 내 화살·마력탄(v1.2): 종류마다 모양·빛
  const arrows = new Map();
  const glowM = (c, k = 1.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.4 });
  const PJ = {
    arrow: () => {
      const g = new THREE.Group();
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 4), wood);
      s.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 4), metal);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.43;
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.1), glowM(0xe8e0d0, 0.2));
      fl.position.z = -0.35;
      g.add(s, tip, fl);
      return g;
    },
    bolt: () => new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), glowM(0x9ad8ff, 2.2)),
    fire: () => new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), glowM(0xff7a2a, 3)),
    ice: () => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 6), glowM(0xbfe8ff, 1.6));
      m.rotation.x = Math.PI / 2;
      return m;
    },
    net: () => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.02, 4, 12), glowM(0xd8d0b0, 0.3));
      return m;
    },
  };
  function makeArrow(kind) {
    const base = kind.replace('_heavy', '');
    const g = new THREE.Group();
    const o = (PJ[base] || PJ.arrow)();
    g.add(o);
    if (kind.endsWith('_heavy')) g.scale.setScalar(1.5);
    scene.add(g);
    return { g, o, spin: base === 'net' || base === 'bolt' };
  }
  function updateArrows(lag) {
    const seen = new Set();
    for (const s of game.state.arrows || []) {
      seen.add(s.id);
      let v = arrows.get(s.id);
      if (!v) {
        v = makeArrow(s.proj || 'arrow');
        arrows.set(s.id, v);
      }
      const x = s.x + s.vx * lag;
      const z = s.z + s.vz * lag;
      v.g.position.set(x, hf.height(x, z) + 1.3, z);
      v.g.rotation.y = Math.atan2(s.vx, s.vz);
      if (v.spin) v.o.rotation.z += 0.3;
    }
    for (const [id, v] of arrows) {
      if (seen.has(id)) continue;
      scene.remove(v.g);
      arrows.delete(id);
    }
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
    updateArrows(lag);
  }
  return { update };
}
