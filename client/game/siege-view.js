// 공성 깃발(v2.7): 실전 공성 중인 마을 가운데에 깃대와 깃발, 땅에 차지 고리를 세운다.
// 깃발은 수비 쪽 색에서 시작해 차지가 오를수록 공격 쪽 색으로 바뀐다.

import * as THREE from 'three';
import { ownerInfo } from '../../core/systems/territory.js';

export function createSiegeView(scene, game, hf) {
  const ctx = () => ({ state: game.state, data: game.data, cfg: game.data.config, clock: game.clock });
  const views = new Map();
  const R = game.data.config.war.flagR;
  function make() {
    const root = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 }));
    pole.position.y = 3;
    root.add(pole);
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 8, 4), clothMat);
    cloth.position.set(0.95, 5.3, 0);
    root.add(cloth);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.25, R, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    root.add(ring);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(new THREE.RingGeometry(0.2, R - 0.3, 64, 1, 0, Math.PI * 2), fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.06;
    root.add(fill);
    scene.add(root);
    return { root, cloth, clothMat, ringMat, fill, fillMat, base: cloth.geometry.attributes.position.array.slice() };
  }
  const cA = new THREE.Color();
  const cD = new THREE.Color();
  function update(sec) {
    const seen = new Set();
    for (const w of Object.values(game.state.territory?.wars || {})) {
      if (w.phase !== 'siege' || !w.live) continue;
      seen.add(w.id);
      let v = views.get(w.id);
      if (!v) {
        v = make();
        views.set(w.id, v);
        v.root.position.set(w.x, hf.height(w.x, w.z), w.z);
      }
      const k = Math.min(1, w.cap / 100);
      cA.set(ownerInfo(ctx(), w.att).color);
      cD.set(ownerInfo(ctx(), w.def).color);
      v.clothMat.color.copy(cD).lerp(cA, k);
      v.ringMat.color.copy(v.clothMat.color);
      v.fillMat.color.copy(cA);
      v.fill.geometry.dispose();
      v.fill.geometry = new THREE.RingGeometry(0.2, R - 0.3, 48, 1, 0, Math.max(0.001, Math.PI * 2 * k));
      // 펄럭임
      const pos = v.cloth.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = v.base[i * 3] + 0.9;
        pos.array[i * 3 + 2] = Math.sin(sec * 4 + x * 3) * 0.12 * x;
      }
      pos.needsUpdate = true;
    }
    for (const [id, v] of views) {
      if (seen.has(id)) continue;
      scene.remove(v.root);
      v.root.traverse((o) => o.geometry?.dispose());
      views.delete(id);
    }
  }
  return { update };
}
