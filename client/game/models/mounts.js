// 탈것 모형(v3.2): 조랑말·갈기 말·서리 산양·안개 사슴. 짐승 모형(creatures.js)의 네발 몸을 그대로 쓰고
// 안장(가죽·수놓은)·고삐·편자를 얹는다. saddleY: 뿌리(발밑)에서 안장 윗면까지 높이(탄 사람 엉덩이 자리)
import * as THREE from 'three';
import { merge, rng } from './build.js';
import { quadruped, mesh, ell, cyl, cone } from './creatures.js';

const C = (h) => new THREE.Color(h);

function horseLike(seed, { L, H, R, lr, legLen, headLen, coat, mane, dark, belly, pony }) {
  const q = quadruped({ L, H, R, lr, body: coat, belly, dark, legLen, headLen, neckUp: 1.0, seed });
  // 목: 굵고 길게, 갈기
  const nl = headLen * 1.45;
  q.neck.add(mesh(merge([
    cyl(R * 0.55, R * 0.38, nl, coat, { rx: Math.PI / 2, z: nl * 0.42 }),
    ...[0, 1, 2, 3, 4, 5].map((i) => ell(0.05, 0.1, nl * 0.13, mane, { y: R * 0.42 - i * 0.012, z: 0.05 + i * nl * 0.15 })),
  ]), q.m));
  q.head.position.z = nl * 0.85;
  q.head.add(mesh(merge([
    ell(R * 0.42, R * 0.46, headLen * 0.55, coat, { rx: 0.2 }),
    cyl(R * 0.3, R * 0.24, headLen * 0.75, coat, { rx: Math.PI / 2 + 0.25, z: headLen * 0.5, y: -0.05 }),
    ell(R * 0.27, R * 0.22, R * 0.2, dark, { z: headLen * 0.9, y: -0.12 }),
    cone(0.04, 0.14, coat, { x: -R * 0.24, y: R * 0.5, z: -0.05, rz: 0.3 }),
    cone(0.04, 0.14, coat, { x: R * 0.24, y: R * 0.5, z: -0.05, rz: -0.3 }),
    ell(0.025, 0.025, 0.02, C(0x0d0b0a), { x: -R * 0.36, y: 0.06, z: headLen * 0.2 }),
    ell(0.025, 0.025, 0.02, C(0x0d0b0a), { x: R * 0.36, y: 0.06, z: headLen * 0.2 }),
    ell(0.06, 0.08, 0.12, mane, { y: R * 0.48, z: -0.02 }), // 앞머리
  ]), q.m));
  // 고삐(가죽 끈)
  q.head.add(mesh(merge([
    cyl(0.012, 0.012, R * 0.9, C(0x4a2c18), { rz: Math.PI / 2, z: headLen * 0.55, y: -0.02 }),
    cyl(0.01, 0.01, R * 0.95, C(0x4a2c18), { rx: 0.4, z: headLen * 0.25, y: 0.04 }),
  ]), q.m));
  // 꼬리
  q.tail.add(mesh(merge([ell(0.05, 0.05, 0.12, mane, { z: -0.06, rx: 0.4 }), ell(0.055, 0.045, pony ? 0.2 : 0.26, mane, { z: -0.12, y: -0.2, rx: 1.25 })]), q.m));
  q.coat = coat;
  q.rad = R;
  return q;
}

function saddle(q, fine) {
  const S = new THREE.Group();
  const top = q.rad * 0.9;
  const col = fine ? C(0x6e2a22) : C(0x5a3820);
  S.add(mesh(merge([
    ell(q.rad * 0.9, 0.06, q.L * 0.2, fine ? C(0x23406a) : C(0x8a7a5a), { y: top - 0.02 }), // 안장 깔개
    ell(q.rad * 0.72, 0.07, q.L * 0.16, col, { y: top + 0.04 }),
    ell(q.rad * 0.3, 0.08, 0.06, col, { y: top + 0.09, z: q.L * 0.13 }), // 앞가지
    ell(q.rad * 0.5, 0.06, 0.05, col, { y: top + 0.08, z: -q.L * 0.14 }), // 뒷가지
    cyl(0.012, 0.012, q.H * 0.55, C(0x3a2416), { x: -q.rad * 0.95, y: top - q.H * 0.28, z: 0.02 }),
    cyl(0.012, 0.012, q.H * 0.55, C(0x3a2416), { x: q.rad * 0.95, y: top - q.H * 0.28, z: 0.02 }),
    ...(fine ? [ell(0.04, 0.04, 0.03, C(0xd8b04a), { y: top + 0.1, z: q.L * 0.15 })] : []),
  ]), q.m));
  // 등자(쇠 고리)
  const st = (sx) => new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 10), new THREE.MeshStandardMaterial({ color: 0x6a6a6a, metalness: 0.6, roughness: 0.5 }));
  for (const sx of [-1, 1]) {
    const r = st(sx);
    r.position.set(sx * q.rad * 0.98, top - q.H * 0.56, 0.02);
    S.add(r);
  }
  q.torso.add(S);
  q.saddle = S;
  return top + 0.1; // 몸통 기준 안장 윗면
}

const MAKERS = {
  pony: (seed) => {
    const R = rng(seed);
    const coats = [0x8a5a34, 0x6a4a36, 0xb08a5a, 0x4a3a32];
    const coat = C(coats[Math.floor(R() * coats.length)]);
    return horseLike(seed, { L: 1.3, H: 0.95, R: 0.3, lr: 0.07, legLen: 0.82, headLen: 0.42, coat, mane: C(0x2a1e16), dark: C(0x2a1e16), belly: coat.clone().lerp(C(0xd8c4a4), 0.3), pony: true });
  },
  horse: (seed) => {
    const R = rng(seed);
    const coats = [0x5a3420, 0x2a2420, 0x9a7a5a, 0xc8bcae];
    const coat = C(coats[Math.floor(R() * coats.length)]);
    return horseLike(seed, { L: 1.65, H: 1.25, R: 0.35, lr: 0.075, legLen: 1.08, headLen: 0.52, coat, mane: C(0x1a1410), dark: C(0x1a1410), belly: coat.clone().lerp(C(0xe0d4c4), 0.2) });
  },
  goat: (seed) => {
    const coat = C(0xd8d0c4);
    const q = quadruped({ L: 1.25, H: 0.95, R: 0.33, lr: 0.075, body: coat, belly: C(0xbab0a2), dark: C(0x3a3430), legLen: 0.8, headLen: 0.36, neckUp: 0.7, seed });
    q.neck.add(mesh(merge([cyl(0.17, 0.13, 0.42, coat, { rx: Math.PI / 2 - 0.2, z: 0.16 })]), q.m));
    q.head.position.z = 0.3;
    const horn = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const a = i * 0.55;
        horn.push(ell(0.06 - i * 0.006, 0.06 - i * 0.006, 0.06, C(0x8a7c62), { x: sx * (0.1 + Math.sin(a) * 0.1 + i * 0.02), y: 0.14 + Math.cos(a) * 0.1, z: -0.06 - Math.sin(a) * 0.06 }));
      }
    }
    q.head.add(mesh(merge([
      ell(0.14, 0.15, 0.2, coat),
      cyl(0.08, 0.06, 0.22, coat, { rx: Math.PI / 2 + 0.3, z: 0.18, y: -0.05 }),
      cone(0.05, 0.16, C(0xbab0a2), { y: -0.2, z: 0.18, rx: Math.PI }), // 수염
      ell(0.022, 0.022, 0.015, C(0x2a1e10), { x: -0.11, y: 0.05, z: 0.08 }),
      ell(0.022, 0.022, 0.015, C(0x2a1e10), { x: 0.11, y: 0.05, z: 0.08 }),
      ...horn,
    ]), q.m));
    // 굵은 털(어깨·옆구리)
    q.torso.add(mesh(merge([0, 1, 2, 3, 4].map((i) => ell(0.36, 0.2, 0.18, C(0xe4ded2), { y: -0.12, z: 0.4 - i * 0.2 }))), q.m));
    q.tail.add(mesh(merge([ell(0.05, 0.08, 0.06, coat, { y: 0.02 })]), q.m));
    q.rad = 0.33;
    return q;
  },
  mist_deer: (seed) => {
    const coat = C(0x7a8a96);
    const q = quadruped({ L: 1.45, H: 1.15, R: 0.3, lr: 0.06, body: coat, belly: C(0xdce4ea), dark: C(0x2a3440), legLen: 1.05, headLen: 0.44, neckUp: 0.95, seed });
    q.neck.add(mesh(merge([cyl(0.15, 0.11, 0.66, coat, { rx: Math.PI / 2, z: 0.28 })]), q.m));
    q.head.position.z = 0.55;
    q.head.add(mesh(merge([
      ell(0.13, 0.14, 0.26, coat, { rx: 0.35 }),
      ell(0.075, 0.075, 0.12, C(0x2a3440), { z: 0.22, y: -0.06 }),
      cone(0.05, 0.17, coat, { x: -0.12, y: 0.14, z: -0.08, rz: 0.9 }),
      cone(0.05, 0.17, coat, { x: 0.12, y: 0.14, z: -0.08, rz: -0.9 }),
    ]), q.m));
    // 빛나는 뿔(따로 재질: 늘 옅게 빛난다)
    const glow = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, emissive: 0x6ab4ff, emissiveIntensity: 1.2, roughness: 0.4 });
    const parts = [];
    for (const sx of [-1, 1]) {
      parts.push(cyl(0.02, 0.013, 0.46, C(0xffffff), { x: sx * 0.08, y: 0.34, z: -0.02, rz: -sx * 0.35 }));
      parts.push(cyl(0.013, 0.008, 0.24, C(0xffffff), { x: sx * 0.19, y: 0.48, z: 0.06, rz: -sx * 0.9, rx: 0.5 }));
      parts.push(cyl(0.013, 0.008, 0.24, C(0xffffff), { x: sx * 0.14, y: 0.55, z: -0.07, rz: -sx * 0.4, rx: -0.6 }));
      parts.push(cyl(0.01, 0.006, 0.18, C(0xffffff), { x: sx * 0.22, y: 0.62, z: -0.02, rz: -sx * 0.2 }));
    }
    const ant = new THREE.Mesh(merge(parts), glow);
    q.head.add(ant);
    q.tail.add(mesh(merge([ell(0.06, 0.09, 0.05, C(0xf0f4f8), { y: -0.04, z: -0.02 })]), q.m));
    q.glow = glow;
    q.rad = 0.3;
    return q;
  },
};

// look: 탈것 모양, gear: { saddle, shoes } 아이템 id(안장 모양만 다르다)
export function makeMount(look, seed = 1, gear = null) {
  const q = (MAKERS[look] || MAKERS.pony)(seed);
  q.look = look;
  q.saddleTop = saddle(q, gear?.saddle === 'mg_saddle_fine') + q.H; // 뿌리 기준
  q.root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return q;
}
