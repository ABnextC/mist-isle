// 노드 그리기: 종류·변형·조각마다 InstancedMesh 하나. 산지가 바뀌면 배치를 다시 짠다.
// 다 캔 노드는 잎·열매가 사라지거나(나무는 그루터기) 작아지고 어두워진다.

import * as THREE from 'three';
import { buildNodeModels } from './models/nodes.js';
import { rand01 } from './geo.js';

const CAP = 96;

export function createNodesView(scene, game, hf, { mats, ctex }) {
  const models = buildNodeModels();
  const groups = {}; // type → [variant → [{ part, mesh }]]
  for (const [type, variants] of Object.entries(models)) {
    groups[type] = variants.map((parts) => parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geo, mats[part.mat], CAP);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // 색 버퍼를 처음부터 만든다. 나중에 setColorAt이 처음 불릴 때 생기면 셰이더 변형이 달라져 게임 중에 컴파일된다
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      if (part.leaves) {
        mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: ctex[part.leaves], alphaTest: 0.45 });
      }
      scene.add(mesh);
      return { part, mesh };
    }));
  }
  const index = new Map(); // nodeId → { type, v, i, ry, s, y }
  let dirty = true;
  game.on('vein.opened', () => { dirty = true; });
  game.on('vein.closed', () => { dirty = true; });

  const dummy = new THREE.Object3D();
  const white = new THREE.Color(1, 1, 1);
  const dim = new THREE.Color(0.62, 0.6, 0.56);

  function rebuild() {
    index.clear();
    const counts = {};
    for (const n of Object.values(game.state.nodes)) {
      const variants = groups[n.type];
      if (!variants) continue;
      const v = Math.floor(rand01(n.id, 3) * variants.length);
      const key = n.type + v;
      const i = counts[key] || 0;
      if (i >= CAP) continue;
      counts[key] = i + 1;
      index.set(n.id, {
        type: n.type, v, i,
        ry: rand01(n.id, 1) * Math.PI * 2,
        s: 0.88 + rand01(n.id, 2) * 0.3,
        y: hf.height(n.x, n.z),
        tilt: (rand01(n.id, 4) - 0.5) * 0.06,
      });
    }
    for (const [type, variants] of Object.entries(groups)) {
      variants.forEach((parts, v) => {
        for (const { mesh } of parts) mesh.count = counts[type + v] || 0;
      });
    }
    dirty = false;
  }

  function update() {
    if (dirty) rebuild();
    for (const [id, e] of index) {
      const n = game.state.nodes[id];
      if (!n) continue;
      const empty = n.charges <= 0;
      for (const { part, mesh } of groups[e.type][e.v]) {
        const show = part.when === 'both' || (part.when === 'live') !== empty;
        const s = show ? e.s * (empty ? part.shrink ?? 1 : 1) : 0;
        dummy.position.set(n.x, e.y - 0.03, n.z);
        dummy.rotation.set(e.tilt, e.ry, e.tilt * 0.7);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        mesh.setMatrixAt(e.i, dummy.matrix);
        mesh.setColorAt(e.i, empty && part.when === 'both' ? dim : white);
      }
    }
    for (const variants of Object.values(groups)) {
      for (const parts of variants) {
        for (const { mesh } of parts) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  return { update };
}
