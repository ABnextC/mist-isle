// 캐릭터: 로우폴리 개척자. 걷기와 채집(휘두르기) 동작.

import * as THREE from 'three';
import { part, merge, flatMat } from './geo.js';

const C = THREE;

function toolMesh(kind, mat) {
  const parts = [part(new C.CylinderGeometry(0.03, 0.035, 0.75, 5), 0x7a5a3a, { y: -0.3 })];
  if (kind === 'logging') parts.push(part(new C.BoxGeometry(0.06, 0.2, 0.26), 0xb8bec4, { y: -0.62, z: 0.1 }));
  if (kind === 'mining') parts.push(part(new C.BoxGeometry(0.05, 0.06, 0.6), 0x9a9fa5, { y: -0.64, rx: 0.15 }));
  if (kind === 'harvesting') parts.push(part(new C.TorusGeometry(0.17, 0.025, 3, 8, Math.PI * 1.2), 0xc8ccd0, { y: -0.6, z: 0.14, ry: Math.PI / 2 }));
  const m = new THREE.Mesh(merge(parts), mat);
  m.visible = false;
  return m;
}

function limb(mat, color, r, len) {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(merge([part(new C.CapsuleGeometry(r, len, 2, 6), color, { y: -len / 2 - r })]), mat);
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

function makeActor(a, mat) {
  const tunic = a.kind === 'player' ? 0x2f8f83 : 0x8a5a9e;
  const g = new THREE.Group();
  const body = new THREE.Mesh(merge([
    part(new C.CapsuleGeometry(0.26, 0.5, 2, 8), tunic, { y: 1.08 }),
    part(new C.CylinderGeometry(0.28, 0.28, 0.1, 8), 0x5a4330, { y: 0.86 }),
    part(new C.IcosahedronGeometry(0.23, 1), 0xe8c4a0, { y: 1.68 }),
    part(new C.SphereGeometry(0.25, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x4a3426, { y: 1.74 }),
    part(new C.BoxGeometry(0.42, 0.5, 0.22), 0x8b6a45, { y: 1.12, z: -0.26 }),
    part(new C.CylinderGeometry(0.1, 0.1, 0.42, 6), 0xd8c89a, { y: 1.42, z: -0.26, rz: Math.PI / 2 }),
  ]), mat);
  body.castShadow = true;
  g.add(body);
  const legL = limb(mat, 0x3d4650, 0.09, 0.38);
  const legR = limb(mat, 0x3d4650, 0.09, 0.38);
  legL.position.set(-0.12, 0.72, 0);
  legR.position.set(0.12, 0.72, 0);
  const armL = limb(mat, tunic, 0.075, 0.42);
  const armR = limb(mat, tunic, 0.075, 0.42);
  armL.position.set(-0.34, 1.36, 0);
  armR.position.set(0.34, 1.36, 0);
  const tools = {};
  for (const k of ['logging', 'mining', 'harvesting']) {
    tools[k] = toolMesh(k, mat);
    tools[k].position.set(0, -0.55, 0.08);
    tools[k].rotation.x = Math.PI / 2;
    armR.add(tools[k]);
  }
  g.add(legL, legR, armL, armR);
  return { g, legL, legR, armL, armR, tools, pos: new THREE.Vector3(a.x, 0, a.z), yaw: a.yaw || 0, phase: 0, swing: 0 };
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function createActorsView(scene, game, terrain) {
  const mat = flatMat();
  const views = new Map();

  function update(dt) {
    const { state, data } = game;
    for (const a of Object.values(state.actors)) {
      let v = views.get(a.id);
      if (!v) {
        v = makeActor(a, mat);
        v.pos.set(a.x, terrain.height(a.x, a.z), a.z);
        views.set(a.id, v);
        scene.add(v.g);
      }
      const px = v.pos.x;
      const pz = v.pos.z;
      const k = 1 - Math.exp(-dt * 16);
      v.pos.x += (a.x - v.pos.x) * k;
      v.pos.z += (a.z - v.pos.z) * k;
      v.pos.y = terrain.height(v.pos.x, v.pos.z);
      const speed = Math.hypot(v.pos.x - px, v.pos.z - pz) / Math.max(dt, 1e-3);
      let yaw = a.yaw || 0;
      const node = a.action?.type === 'gather' ? state.nodes[a.action.node] : null;
      if (node) yaw = Math.atan2(node.x - a.x, node.z - a.z);
      v.yaw = lerpAngle(v.yaw, yaw, 1 - Math.exp(-dt * 12));
      v.g.position.copy(v.pos);
      v.g.rotation.y = v.yaw;

      if (speed > 0.4 && !node) {
        v.phase += dt * Math.min(speed, 7) * 2.4;
        const s = Math.sin(v.phase);
        v.legL.rotation.x = s * 0.7;
        v.legR.rotation.x = -s * 0.7;
        v.armL.rotation.x = -s * 0.5;
        v.armR.rotation.x = s * 0.5;
        v.g.position.y += Math.abs(Math.cos(v.phase)) * 0.06;
      } else {
        for (const l of [v.legL, v.legR, v.armL]) l.rotation.x *= 0.85;
        if (!node) v.armR.rotation.x *= 0.85;
      }
      const skill = node ? data.nodes[node.type].skill : null;
      for (const [kname, m] of Object.entries(v.tools)) m.visible = kname === skill;
      if (node) {
        v.swing += dt * (skill === 'harvesting' ? 9 : 6.5);
        v.armR.rotation.x = -1.7 + Math.sin(v.swing) * 0.85;
        v.armL.rotation.x = -0.4 + Math.sin(v.swing) * 0.2;
      }
    }
  }

  return {
    update,
    positionOf: (id) => views.get(id)?.pos,
  };
}
