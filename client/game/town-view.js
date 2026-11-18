// 등대 마을: 작업대·건물·장식, 밤에 켜지는 불빛.

import * as THREE from 'three';
import { stationGeo, glowGeo, structureGeo } from './props.js';
import { flatMat } from './geo.js';

export function createTownView(scene, game, terrain) {
  const mat = flatMat();
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a1a, emissiveIntensity: 1.6, flatShading: true });
  const glows = [];
  const lights = [];
  let beam = null;
  let lantern = null;

  const put = (geo, x, z, rot, dy = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, terrain.height(x, z) + dy, z);
    m.rotation.y = rot || 0;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const glow = (type, base) => {
    const g = glowGeo(type);
    if (!g) return;
    const m = new THREE.Mesh(g, glowMat);
    m.position.copy(base.position);
    m.rotation.copy(base.rotation);
    scene.add(m);
    glows.push(m);
  };

  for (const s of Object.values(game.state.settlements)) {
    for (const st of s.stations) {
      const m = put(stationGeo(st.type), st.x, st.z, st.rot);
      glow(st.type, m);
    }
  }

  for (const o of game.statics) {
    const m = put(structureGeo(o.kind), o.x, o.z, o.rot, o.kind === 'wreck' ? -0.7 : 0);
    if (o.kind === 'campfire') {
      glow('campfire', m);
      const l = new THREE.PointLight(0xffa04a, 0, 18, 1.6);
      l.position.set(o.x, m.position.y + 1.2, o.z);
      scene.add(l);
      lights.push({ l, max: 14, flicker: true });
    }
    if (o.kind === 'lighthouse') {
      const y = m.position.y + 14.35;
      lantern = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 0.95, 1.8, 10),
        new THREE.MeshStandardMaterial({ color: 0xfff1b8, emissive: 0xffd36a, emissiveIntensity: 0.3 }),
      );
      lantern.position.set(o.x, y, o.z);
      scene.add(lantern);
      const l = new THREE.PointLight(0xffd88a, 0, 45, 1.6);
      l.position.set(o.x, y, o.z);
      scene.add(l);
      lights.push({ l, max: 30 });
      const cone = new THREE.ConeGeometry(5, 70, 20, 1, true);
      cone.translate(0, -35, 0);
      cone.rotateX(-Math.PI / 2);
      beam = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({
        color: 0xfff2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      beam.position.set(o.x, y, o.z);
      scene.add(beam);
    }
  }

  function update(t, nightK) {
    for (const g of glows) {
      const f = 0.85 + 0.15 * Math.sin(t * 9 + g.position.x) * Math.sin(t * 5.3 + g.position.z);
      g.scale.setScalar(f);
    }
    glowMat.emissiveIntensity = 1.2 + 0.5 * nightK;
    for (const { l, max, flicker } of lights) {
      l.intensity = max * nightK * (flicker ? 0.85 + 0.15 * Math.sin(t * 11) : 1);
    }
    if (lantern) lantern.material.emissiveIntensity = 0.3 + 2.2 * nightK;
    if (beam) {
      beam.rotation.y = t * 0.6;
      beam.material.opacity = 0.11 * nightK;
      beam.visible = nightK > 0.02;
    }
  }

  return { update };
}
