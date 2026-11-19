// 퀘스트 길잡이(v0.4.3): 캐릭터 발치에서 목표 쪽으로 흐르는 금빛 화살표, 목표 위 빛기둥·마름모·고리.
// 화살표는 풀에 묻히지 않게 깊이 검사 없이 맨 위에 그린다. 빛기둥은 안개를 타지 않아 멀리서도 보인다.

import * as THREE from 'three';

const BEAM_V = `
varying float vY;
void main() {
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BEAM_F = `
uniform float uOpacity;
uniform vec3 uColor;
varying float vY;
void main() {
  float a = (1.0 - smoothstep(0.0, 1.0, vY / 16.0)) * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
}`;

function chevronGeo(w, len, th) {
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(0, len);
  s.lineTo(w, 0);
  s.lineTo(w - th, 0);
  s.lineTo(0, len - th * 1.6);
  s.lineTo(-(w - th), 0);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -len / 2);
  return g;
}

export function createGuide(scene, hf) {
  const root = new THREE.Group();
  scene.add(root);
  const gold = new THREE.Color(0xffcf5a);
  const chevGeo = chevronGeo(0.58, 0.6, 0.21);
  const backGeo = chevronGeo(0.7, 0.74, 0.34);
  const chev = [];
  for (let i = 0; i < 3; i++) {
    const back = new THREE.Mesh(backGeo, new THREE.MeshBasicMaterial({
      color: 0x1a1206, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    const front = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({
      color: gold, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    back.renderOrder = 30;
    front.renderOrder = 31;
    root.add(back, front);
    chev.push({ back, front });
  }

  // 목표 표식: 빛기둥(덧셈 혼합), 떠 있는 마름모, 바닥 고리
  const beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 16, 20, 1, true);
  beamGeo.translate(0, 8, 0);
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    vertexShader: BEAM_V, fragmentShader: BEAM_F,
    uniforms: { uOpacity: { value: 0.55 }, uColor: { value: new THREE.Color(0xffd27a) } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  beam.renderOrder = 25;
  const diamondGeo = new THREE.OctahedronGeometry(0.32, 0);
  diamondGeo.scale(1, 1.6, 1);
  const diamond = new THREE.Mesh(diamondGeo, new THREE.MeshBasicMaterial({ color: gold, fog: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 48), new THREE.MeshBasicMaterial({
    color: gold, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 29;
  root.add(beam, diamond, ring);
  root.visible = false;

  function update(t, p, goal) {
    if (!goal) {
      root.visible = false;
      return;
    }
    root.visible = true;
    const dx = goal.x - p.x;
    const dz = goal.z - p.z;
    const d = Math.hypot(dx, dz);
    const ux = d > 1e-3 ? dx / d : 0;
    const uz = d > 1e-3 ? dz / d : 1;
    const yaw = Math.atan2(ux, uz);
    // 가까워지면 화살표는 사라지고 목표 표식만 남는다
    const arrowK = THREE.MathUtils.smoothstep(d, 3, 6);
    for (let i = 0; i < chev.length; i++) {
      const k = 1.35 + i * 0.66;
      const x = p.x + ux * k;
      const z = p.z + uz * k;
      const y = hf.height(x, z) + 0.1;
      const ph = (((t * 1.3 - i * 0.3) % 1) + 1) % 1;
      const glow = 0.3 + 0.7 * (1 - ph) * (1 - ph);
      for (const m of [chev[i].back, chev[i].front]) {
        m.position.set(x, y, z);
        m.rotation.y = yaw;
      }
      chev[i].front.material.opacity = arrowK * glow * 0.95;
      chev[i].back.material.opacity = arrowK * glow * 0.38;
    }
    const gy = hf.height(goal.x, goal.z);
    beam.position.set(goal.x, gy, goal.z);
    // 멀면 빛기둥을 굵게(멀리서 가늘어 안 보이지 않게)
    const thick = THREE.MathUtils.clamp(d / 40, 1, 4);
    beam.scale.set(thick, 1, thick);
    beam.material.uniforms.uOpacity.value = 0.35 + 0.25 * THREE.MathUtils.smoothstep(d, 4, 30);
    diamond.position.set(goal.x, gy + 2.7 + Math.sin(t * 2.2) * 0.15, goal.z);
    diamond.rotation.y = t * 1.4;
    const s = 1 + 0.12 * Math.sin(t * 3);
    ring.position.set(goal.x, gy + 0.08, goal.z);
    ring.scale.setScalar(s);
    ring.material.opacity = 0.35 + 0.35 * (1 - THREE.MathUtils.smoothstep(d, 8, 30));
  }

  return { update };
}
