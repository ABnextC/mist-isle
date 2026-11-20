// 캐릭터 묶음(JSON+BIN) 읽기: 파이썬 생성기(tools/charforge)가 만든 메시·뼈·질감 목록을 three 형상으로 바꾼다.
import * as THREE from 'three';

const ARR = { f32: Float32Array, u8: Uint8Array, u8n: Uint8Array, u16: Uint16Array, u32: Uint32Array, i16n: Int16Array, u16n: Uint16Array, i8n: Int8Array };

export async function loadPack(url) {
  const [meta, bin] = await Promise.all([
    fetch(url + '.json').then((r) => r.json()),
    fetch(url + '.bin').then((r) => r.arrayBuffer()),
  ]);
  const view = (a) => new ARR[a.type](bin, a.offset, a.count * a.size);
  const meshes = {};
  for (const m of meta.meshes) {
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(m.attributes)) {
      const norm = a.type.endsWith('n');
      g.setAttribute(k, new THREE.BufferAttribute(view(a), a.size, norm));
    }
    g.setIndex(new THREE.BufferAttribute(view(m.index), 1));
    const names = Object.keys(m.morphs || {});
    if (names.length) {
      g.morphAttributes.position = names.map((k) => new THREE.BufferAttribute(view(m.morphs[k]), 3));
      g.morphTargetsRelative = true;
    }
    g.computeBoundingSphere();
    meshes[m.name] = { geometry: g, material: m.material, bone: m.bone, morphs: names, info: m };
  }
  return { meta, meshes };
}
