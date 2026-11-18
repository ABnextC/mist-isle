// 노드 그리기: 종류마다 InstancedMesh 하나. 산지가 바뀌면 배치를 다시 짠다.

import * as THREE from 'three';
import { NODE_GEOS } from './props.js';
import { flatMat, rand01 } from './geo.js';

const CAP = 160;

export function createNodesView(scene, game, terrain) {
  const mat = flatMat();
  const meshes = {};
  for (const [type, make] of Object.entries(NODE_GEOS)) {
    const m = new THREE.InstancedMesh(make(), mat, CAP);
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    meshes[type] = m;
  }
  const index = new Map(); // nodeId → { type, i, ry, s, y }
  let dirty = true;
  game.on('vein.opened', () => { dirty = true; });
  game.on('vein.closed', () => { dirty = true; });

  const dummy = new THREE.Object3D();
  const live = new THREE.Color(1, 1, 1);
  const dim = new THREE.Color(0.55, 0.55, 0.52);

  function rebuild() {
    index.clear();
    const counts = {};
    for (const n of Object.values(game.state.nodes)) {
      const i = counts[n.type] || 0;
      if (i >= CAP) continue;
      counts[n.type] = i + 1;
      index.set(n.id, {
        type: n.type, i,
        ry: rand01(n.id, 1) * Math.PI * 2,
        s: 0.85 + rand01(n.id, 2) * 0.35,
        y: terrain.height(n.x, n.z),
      });
    }
    for (const [type, m] of Object.entries(meshes)) m.count = counts[type] || 0;
    dirty = false;
  }

  function update() {
    if (dirty) rebuild();
    for (const [id, v] of index) {
      const n = game.state.nodes[id];
      if (!n) continue;
      const empty = n.charges <= 0;
      dummy.position.set(n.x, v.y - 0.05, n.z);
      dummy.rotation.set(0, v.ry, 0);
      const s = empty ? v.s * 0.35 : v.s;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      const m = meshes[v.type];
      m.setMatrixAt(v.i, dummy.matrix);
      m.setColorAt(v.i, empty ? dim : live);
    }
    for (const m of Object.values(meshes)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  return { update };
}
