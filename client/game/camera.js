// 3인칭 자유시점 카메라. 드래그로 돌리고, 휠·핀치로 당긴다. 땅 밑으로 들어가지 않는다.

import * as THREE from 'three';

export function createCamera(camera, terrain) {
  const st = { yaw: 0, pitch: 0.38, dist: 9 };
  const target = new THREE.Vector3();
  let first = true;

  return {
    st,
    rotate(dx, dy) {
      st.yaw -= dx * 0.0055;
      st.pitch = Math.min(1.25, Math.max(-0.12, st.pitch + dy * 0.004));
    },
    zoom(d) {
      st.dist = Math.min(18, Math.max(3.5, st.dist * (1 + d)));
    },
    // 화면 기준 앞·오른쪽 → 월드 방향
    toWorld(right, forward) {
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      return [fx * forward - fz * right, fz * forward + fx * right];
    },
    update(dt, px, py, pz) {
      const want = new THREE.Vector3(px, py + 1.5, pz);
      if (first) {
        target.copy(want);
        first = false;
      } else {
        target.lerp(want, 1 - Math.exp(-dt * 10));
      }
      const cp = Math.cos(st.pitch);
      let x = target.x - Math.sin(st.yaw) * cp * st.dist;
      let z = target.z - Math.cos(st.yaw) * cp * st.dist;
      let y = target.y + Math.sin(st.pitch) * st.dist;
      const ground = Math.max(terrain.height(x, z), 0) + 0.7;
      if (y < ground) y = ground;
      camera.position.set(x, y, z);
      camera.lookAt(target);
    },
  };
}
