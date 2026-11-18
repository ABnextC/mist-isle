// 손맛 연출: 노리는 대상 고리, 채집할 때 튀는 조각.

import * as THREE from 'three';

export function createFx(scene) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.25, 28),
    new THREE.MeshBasicMaterial({ color: 0x9ff0d8, transparent: true, opacity: 0.75, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  const N = 80;
  const chips = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.12),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 }),
    N,
  );
  chips.frustumCulled = false;
  chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(chips);
  const parts = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0 }));
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let next = 0;
  for (let i = 0; i < N; i++) chips.setColorAt(i, col.set(0xffffff));

  function burst(x, y, z, color, count = 9) {
    for (let k = 0; k < count; k++) {
      const p = parts[next];
      p.life = 0.7 + Math.random() * 0.3;
      p.p.set(x + (Math.random() - 0.5) * 0.6, y + 0.8 + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.6);
      p.v.set((Math.random() - 0.5) * 4, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4);
      p.r = Math.random() * 6;
      chips.setColorAt(next, col.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
      next = (next + 1) % N;
    }
    chips.instanceColor.needsUpdate = true;
  }

  function setTarget(x, y, z, ok, radius) {
    if (x == null) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.position.set(x, y + 0.08, z);
    ring.scale.setScalar(radius || 1);
    ring.material.color.setHex(ok ? 0x9ff0d8 : 0xf0a090);
  }

  function update(dt, t) {
    ring.material.opacity = 0.55 + 0.25 * Math.sin(t * 5);
    for (let i = 0; i < N; i++) {
      const p = parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.v.y -= 12 * dt;
        p.p.addScaledVector(p.v, dt);
        p.r += dt * 8;
        dummy.position.copy(p.p);
        dummy.rotation.set(p.r, p.r * 0.7, 0);
        dummy.scale.setScalar(Math.max(0, Math.min(1, p.life * 2)));
      } else {
        dummy.scale.setScalar(0);
      }
      dummy.updateMatrix();
      chips.setMatrixAt(i, dummy.matrix);
    }
    chips.instanceMatrix.needsUpdate = true;
  }

  return { burst, setTarget, update };
}
