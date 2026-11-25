// 3인칭 자유시점 카메라. 드래그로 돌리고, 휠·핀치로 당긴다. 땅 밑으로 들어가지 않는다.

import * as THREE from 'three';

export function createCamera(camera, terrain) {
  const st = { yaw: 0, pitch: 0.38, dist: 9 };
  const target = new THREE.Vector3();
  let first = true;
  // 대화 장면(v2.0): ov = { x, y, z, yaw, dist, pitch }가 있으면 그쪽으로 천천히 옮겨 간다
  let mixK = 0;
  const ovT = new THREE.Vector3();
  const tgV = new THREE.Vector3();
  let ovLast = null;
  const lerpAng = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

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
    update(dt, px, py, pz, ov = null) {
      const want = new THREE.Vector3(px, py + 1.5, pz);
      if (first) {
        target.copy(want);
        first = false;
      } else {
        target.lerp(want, 1 - Math.exp(-dt * 10));
      }
      if (ov) ovLast = ov;
      mixK += ((ov ? 1 : 0) - mixK) * (1 - Math.exp(-dt * 3.2));
      if (mixK < 0.001) ovLast = null;
      let yaw = st.yaw;
      let pitch = st.pitch;
      let dist = st.dist;
      const tg = tgV.copy(target);
      if (ovLast) {
        const k = mixK * mixK * (3 - 2 * mixK);
        yaw = lerpAng(st.yaw, ovLast.yaw, k);
        pitch = st.pitch + (ovLast.pitch - st.pitch) * k;
        dist = st.dist + (ovLast.dist - st.dist) * k;
        ovT.set(ovLast.x, ovLast.y, ovLast.z);
        tg.lerp(ovT, k);
      }
      const cp = Math.cos(pitch);
      let x = tg.x - Math.sin(yaw) * cp * dist;
      let z = tg.z - Math.cos(yaw) * cp * dist;
      let y = tg.y + Math.sin(pitch) * dist;
      const ground = Math.max(terrain.height(x, z), 0) + 0.7;
      if (y < ground) y = ground;
      camera.position.set(x, y, z);
      camera.lookAt(tg);
    },
  };
}
