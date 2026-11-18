// 절차 생성 재질 텍스처. 사진 텍스처가 없으니 잡음으로 흙·풀·모래·바위·나무껍질·목재·회벽·돌담·지붕을 굽는다.
// GPU에서 한 번 굽고 밉맵까지 만든다. 모든 무늬는 이음매 없이 반복된다.
//   A: rgb = 바탕색(sRGB), a = 높이
//   N: rg = 노멀 xy, b = 거칠기, a = 그늘(AO)

import * as THREE from 'three';
import { NOISE } from './glsl.js';

const LAYERS = {
  grass: { bump: 2.2, ao: 2.5, code: `
    float big = pfbm(uv, 3.0, 4);
    float mid = pfbm(uv, 12.0, 3);
    float fine = pnoise(uv * 160.0, 160.0);
    vec2 w = pworley(uv, 40.0);
    float clump = smoothstep(0.55, 0.12, w.x);
    vec3 green = vec3(0.27, 0.40, 0.11);
    vec3 lush = vec3(0.34, 0.47, 0.13);
    vec3 dry = vec3(0.52, 0.48, 0.24);
    vec3 soil = vec3(0.26, 0.21, 0.13);
    col = mix(green, lush, smoothstep(0.35, 0.7, mid));
    col = mix(col, dry, smoothstep(0.6, 0.78, big) * 0.6);
    col = mix(soil, col, 0.5 + 0.5 * clump);
    col *= 0.82 + 0.3 * fine;
    h = clump * 0.6 + fine * 0.25 + mid * 0.15;
    r = 0.93;` },
  dirt: { bump: 3.0, ao: 3.0, code: `
    float big = pfbm(uv, 4.0, 4);
    vec2 w = pworley(uv, 22.0);
    float pc = pcell(uv, 22.0);
    float peb = smoothstep(0.38, 0.18, w.x) * step(0.62, pc);
    vec2 w2 = pworley(uv, 70.0);
    float grit = smoothstep(0.35, 0.1, w2.x);
    vec3 soil = mix(vec3(0.22, 0.16, 0.10), vec3(0.33, 0.25, 0.16), big);
    vec3 pebc = mix(vec3(0.30, 0.27, 0.23), vec3(0.44, 0.40, 0.35), pc);
    col = mix(soil, pebc, peb);
    col *= 0.85 + 0.25 * pnoise(uv * 200.0, 200.0);
    col = mix(col, col * 1.15, grit * 0.3);
    h = big * 0.3 + peb * 0.55 + grit * 0.15;
    r = mix(0.92, 0.72, peb);` },
  sand: { bump: 1.6, ao: 1.5, code: `
    float big = pfbm(uv, 3.0, 3);
    float warp = pfbm(uv, 5.0, 2);
    float rip = sin((uv.y * 18.0 + uv.x + warp * 2.5) * 6.2831853) * 0.5 + 0.5;
    float grain = pnoise(uv * 256.0, 256.0);
    vec2 w = pworley(uv, 30.0);
    float shell = smoothstep(0.12, 0.05, w.x) * step(0.72, pcell(uv, 30.0));
    col = mix(vec3(0.60, 0.51, 0.37), vec3(0.77, 0.68, 0.51), big);
    col *= 0.9 + 0.18 * grain;
    col *= 0.94 + 0.08 * rip;
    col = mix(col, vec3(0.86, 0.83, 0.77), shell * 0.7);
    h = rip * 0.35 + grain * 0.15 + big * 0.2 + shell * 0.3;
    r = 0.96;` },
  rock: { bump: 3.5, ao: 3.0, code: `
    float big = pfbm(uv, 3.0, 5);
    vec2 w = pworley(uv, 5.0);
    float crack = smoothstep(0.06, 0.0, w.y - w.x);
    vec2 w2 = pworley(uv, 13.0);
    float crack2 = smoothstep(0.04, 0.0, w2.y - w2.x) * 0.6;
    float cellc = pcell(uv, 5.0);
    float lich = smoothstep(0.66, 0.74, pfbm(uv, 9.0, 3));
    float fine = pnoise(uv * 128.0, 128.0);
    vec3 base = mix(vec3(0.29, 0.28, 0.26), vec3(0.50, 0.48, 0.44), big);
    base *= 0.85 + 0.3 * cellc;
    col = base * (0.85 + 0.25 * fine);
    col = mix(col, vec3(0.55, 0.55, 0.38), lich * 0.4);
    float c = max(crack, crack2);
    col *= 1.0 - 0.6 * c;
    h = big * 0.55 + (1.0 - c) * 0.35 + fine * 0.1;
    r = mix(0.8, 0.92, lich);` },
  water: { bump: 2.4, ao: 0.0, code: `
    float a = pfbm(uv, 4.0, 5);
    float b = pfbm(uv + vec2(0.37, 0.11), 7.0, 4);
    h = a * 0.6 + b * 0.4;
    col = vec3(0.5);
    r = 0.05;` },
  birch: { bump: 1.6, ao: 2.0, code: `
    float n = pfbm(uv, 4.0, 4);
    float marks = pnoise2(vec2(uv.x * 8.0, uv.y * 70.0), vec2(8.0, 70.0));
    float lent = smoothstep(0.78, 0.86, marks);
    float spot = smoothstep(0.64, 0.72, pfbm(uv, 3.0, 4));
    float fine = pnoise(uv * 128.0, 128.0);
    col = mix(vec3(0.78, 0.77, 0.72), vec3(0.90, 0.89, 0.85), n);
    col *= 0.92 + 0.1 * fine;
    col = mix(col, vec3(0.09, 0.08, 0.07), lent * 0.9);
    col = mix(col, vec3(0.15, 0.13, 0.11), spot * 0.8);
    h = 1.0 - lent * 0.6 - spot * 0.3 + fine * 0.1;
    r = mix(0.72, 0.9, spot);` },
  barkDark: { bump: 4.0, ao: 3.5, code: `
    float fis = pnoise2(vec2(uv.x * 14.0, uv.y * 3.0), vec2(14.0, 3.0));
    float fis2 = pnoise2(vec2(uv.x * 28.0, uv.y * 6.0), vec2(28.0, 6.0));
    float plates = pfbm(uv, 6.0, 4);
    float ridge = 1.0 - abs((fis * 0.7 + fis2 * 0.3) * 2.0 - 1.0);
    float crack = smoothstep(0.3, 0.05, ridge);
    col = mix(vec3(0.15, 0.11, 0.08), vec3(0.32, 0.25, 0.18), plates);
    col *= 1.0 - crack * 0.6;
    h = ridge * 0.7 + plates * 0.3;
    r = 0.92;` },
  driftwood: { bump: 2.5, ao: 2.0, code: `
    float grain = pnoise2(vec2(uv.x * 40.0, uv.y * 4.0), vec2(40.0, 4.0));
    float grain2 = pnoise2(vec2(uv.x * 120.0, uv.y * 8.0), vec2(120.0, 8.0));
    float big = pfbm(uv, 3.0, 3);
    col = mix(vec3(0.40, 0.38, 0.34), vec3(0.66, 0.63, 0.57), big);
    col *= 0.8 + 0.25 * grain + 0.1 * grain2;
    float crack = smoothstep(0.1, 0.02, abs(grain - 0.5)) * 0.5;
    col *= 1.0 - crack * 0.5;
    h = grain * 0.6 + grain2 * 0.25 + big * 0.15 - crack * 0.3;
    r = 0.86;` },
  planks: { bump: 2.0, ao: 2.5, code: `
    float rows = 5.0;
    float py = uv.y * rows;
    float idx = floor(py);
    float fy = fract(py);
    float rnd = hash12(vec2(idx, 3.0));
    float grain = pnoise2(vec2(uv.x * 6.0 + rnd * 9.0, py * 9.0), vec2(6.0, rows * 9.0));
    float fine = pnoise2(vec2(uv.x * 64.0, py * 30.0), vec2(64.0, rows * 30.0));
    float gap = smoothstep(0.0, 0.05, fy) * smoothstep(1.0, 0.95, fy);
    float endx = fract(uv.x * 2.0 + rnd);
    float endGap = smoothstep(0.0, 0.012, endx) * smoothstep(1.0, 0.988, endx);
    col = mix(vec3(0.30, 0.21, 0.13), vec3(0.50, 0.37, 0.23), rnd * 0.7 + grain * 0.3);
    col *= 0.85 + 0.2 * fine;
    col *= mix(0.25, 1.0, gap * endGap);
    h = gap * endGap * (0.7 + 0.3 * grain);
    r = 0.8;` },
  plaster: { bump: 1.2, ao: 1.0, code: `
    float big = pfbm(uv, 2.0, 5);
    float fine = pfbm(uv, 32.0, 3);
    float stain = smoothstep(0.55, 0.75, pfbm(uv + vec2(0.3, 0.1), 3.0, 4));
    col = mix(vec3(0.68, 0.64, 0.56), vec3(0.86, 0.83, 0.76), big);
    col *= 0.92 + 0.12 * fine;
    col = mix(col, vec3(0.50, 0.45, 0.38), stain * 0.35);
    h = fine * 0.6 + big * 0.4;
    r = 0.95;` },
  stone: { bump: 3.0, ao: 3.0, code: `
    float rows = 6.0;
    float py = uv.y * rows;
    float row = floor(py);
    float fy = fract(py);
    float cols = 3.0 + floor(hash12(vec2(row, 2.0)) * 2.0);
    float px = uv.x * cols + hash12(vec2(row, 1.0));
    float ci = floor(px);
    float fx = fract(px);
    float id = hash12(vec2(mod(ci, cols), row));
    float m = min(min(fx, 1.0 - fx) / cols, min(fy, 1.0 - fy) / rows);
    float mortar = smoothstep(0.003, 0.011, m);
    float bulge = smoothstep(0.0, 0.05, m);
    float n = pfbm(uv, 8.0, 4);
    vec3 st = mix(vec3(0.36, 0.34, 0.31), vec3(0.58, 0.55, 0.50), id) * (0.85 + 0.3 * n);
    col = mix(vec3(0.28, 0.26, 0.23), st, mortar);
    h = mortar * (0.6 + 0.4 * bulge) + n * 0.15;
    r = mix(0.96, 0.86, mortar);` },
  shingle: { bump: 2.5, ao: 3.0, code: `
    float rows = 10.0;
    float py = uv.y * rows;
    float row = floor(py);
    float fy = fract(py);
    float cols = 8.0;
    float px = uv.x * cols + mod(row, 2.0) * 0.5;
    float ci = floor(px);
    float fx = fract(px);
    float id = hash12(vec2(mod(ci, cols), mod(row, rows)));
    float side = smoothstep(0.0, 0.06, fx) * smoothstep(1.0, 0.94, fx);
    float bottom = smoothstep(0.0, 0.08, fy);
    float grain = pnoise2(vec2(px * 3.0, py * 12.0), vec2(cols * 3.0, rows * 12.0));
    float moss = smoothstep(0.6, 0.75, pfbm(uv, 4.0, 4));
    col = mix(vec3(0.24, 0.18, 0.13), vec3(0.42, 0.32, 0.23), id);
    col *= (0.8 + 0.25 * grain) * mix(0.45, 1.0, side) * mix(0.5, 1.0, bottom);
    col = mix(col, vec3(0.20, 0.26, 0.10), moss * 0.45);
    h = side * bottom * (0.4 + 0.6 * fy);
    r = 0.86;` },
};

const VERT = `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

function frag(code) {
  return `
varying vec2 vUv;
uniform float uTexel;
uniform float uBump;
uniform float uAo;
uniform int uPass;
${NOISE}
void layer(vec2 uv, out vec3 col, out float h, out float r) {
${code}
}
void main() {
  vec3 col;
  float h;
  float r;
  layer(vUv, col, h, r);
  if (uPass == 0) {
    // 색은 sRGB로 골랐으니 선형으로 바꿔 쓴다(대상 텍스처가 sRGB로 다시 저장한다)
    gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(2.2)), clamp(h, 0.0, 1.0));
    return;
  }
  vec3 c2;
  float r2;
  float hx1;
  float hx0;
  float hy1;
  float hy0;
  layer(fract(vUv + vec2(uTexel, 0.0)), c2, hx1, r2);
  layer(fract(vUv - vec2(uTexel, 0.0)), c2, hx0, r2);
  layer(fract(vUv + vec2(0.0, uTexel)), c2, hy1, r2);
  layer(fract(vUv - vec2(0.0, uTexel)), c2, hy0, r2);
  vec3 n = normalize(vec3((hx0 - hx1) * uBump, (hy0 - hy1) * uBump, 1.0));
  float ao = clamp(1.0 - ((hx1 + hx0 + hy1 + hy0) * 0.25 - h) * uAo * 8.0, 0.55, 1.0);
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, r, ao);
}`;
}

export function bakeMaterials(renderer, { terrainSize, objectSize }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const cam = new THREE.OrthographicCamera();
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(geo);
  quad.frustumCulled = false;
  scene.add(quad);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const prevTarget = renderer.getRenderTarget();
  const out = {};

  const target = (size, srgb) => new THREE.WebGLRenderTarget(size, size, {
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: true, anisotropy: aniso, depthBuffer: false,
    colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
  });

  for (const [name, L] of Object.entries(LAYERS)) {
    const size = ['grass', 'dirt', 'sand', 'rock'].includes(name) ? terrainSize : objectSize;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag(L.code),
      uniforms: {
        uTexel: { value: 1 / size }, uBump: { value: L.bump * size / 256 }, uAo: { value: L.ao }, uPass: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    quad.material = mat;
    const A = target(size, true);
    const N = target(size, false);
    renderer.setRenderTarget(A);
    renderer.render(scene, cam);
    mat.uniforms.uPass.value = 1;
    renderer.setRenderTarget(N);
    renderer.render(scene, cam);
    mat.dispose();
    out[name] = { A: A.texture, N: N.texture, rt: [A, N] };
  }
  renderer.setRenderTarget(prevTarget);
  geo.dispose();
  return out;
}

// ── 캔버스로 그리는 알파 텍스처(잎·연기·불꽃·달) ─────────────────
function canvasTex(size, draw, { srgb = true, mips = true } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}

// 결정적 난수(그림이 매번 같게)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 잎 덩어리 카드: 가지 몇 개에 잎이 달린 모양
function leafCluster(g, size, { seed, leaves, hue, sat, light, w, h, twig, broad }) {
  const R = rng(seed);
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const branches = 6;
  for (let b = 0; b < branches; b++) {
    const ang = -Math.PI / 2 + (R() - 0.5) * 2.4;
    const len = size * (0.28 + R() * 0.2);
    const sx = cx + (R() - 0.5) * size * 0.1;
    const sy = size * 0.92;
    const ex = sx + Math.cos(ang) * len;
    const ey = sy + Math.sin(ang) * len * 1.6;
    g.strokeStyle = twig;
    g.lineWidth = size / 220;
    g.beginPath();
    g.moveTo(sx, sy);
    g.quadraticCurveTo((sx + ex) / 2 + (R() - 0.5) * 30, (sy + ey) / 2, ex, ey);
    g.stroke();
    const per = Math.floor(leaves / branches);
    for (let i = 0; i < per; i++) {
      const t = 0.25 + R() * 0.75;
      const px = sx + (ex - sx) * t + (R() - 0.5) * size * 0.12;
      const py = sy + (ey - sy) * t + (R() - 0.5) * size * 0.12;
      const a = ang + (R() - 0.5) * 2.2;
      const s = (0.7 + R() * 0.6) * size / 512;
      const L = light + (R() - 0.5) * 16;
      g.save();
      g.translate(px, py);
      g.rotate(a);
      g.fillStyle = `hsl(${hue + (R() - 0.5) * 18}, ${sat + (R() - 0.5) * 12}%, ${L}%)`;
      g.beginPath();
      if (broad) {
        g.ellipse(0, 0, w * s, h * s, 0, 0, Math.PI * 2);
      } else {
        g.moveTo(-w * s, 0);
        g.quadraticCurveTo(0, -h * s, w * s * 1.15, 0);
        g.quadraticCurveTo(0, h * s, -w * s, 0);
      }
      g.fill();
      g.strokeStyle = `hsla(${hue}, ${sat}%, ${L - 12}%, 0.6)`;
      g.lineWidth = s;
      g.beginPath();
      g.moveTo(-w * s, 0);
      g.lineTo(w * s, 0);
      g.stroke();
      g.restore();
    }
  }
}

export function makeCanvasTextures() {
  const birchLeaves = canvasTex(512, (g, s) => leafCluster(g, s, {
    seed: 11, leaves: 170, hue: 84, sat: 48, light: 34, w: 15, h: 10, twig: '#4a3a2a',
  }));
  const bushLeaves = canvasTex(512, (g, s) => leafCluster(g, s, {
    seed: 23, leaves: 150, hue: 105, sat: 40, light: 26, w: 18, h: 9, twig: '#3a2e22', broad: true,
  }));
  const pineNeedles = canvasTex(512, (g, s) => {
    const R = rng(37);
    g.clearRect(0, 0, s, s);
    const rows = 11;
    for (let b = 0; b < rows; b++) {
      const k = b / (rows - 1);
      const y = s * (0.06 + k * 0.86);
      const half = s * (0.05 + 0.43 * Math.pow(k, 0.85));
      // 가지 덩어리 밑칠(멀리서도 비어 보이지 않게)
      g.fillStyle = `hsla(${132 + (R() - 0.5) * 10}, 34%, ${13 + R() * 5}%, 0.92)`;
      g.beginPath();
      g.moveTo(s / 2 - half, y + 16);
      g.quadraticCurveTo(s / 2 - half * 0.5, y - 10, s / 2, y - 14);
      g.quadraticCurveTo(s / 2 + half * 0.5, y - 10, s / 2 + half, y + 16);
      g.quadraticCurveTo(s / 2, y + 26, s / 2 - half, y + 16);
      g.fill();
      for (let i = 0; i < 300; i++) {
        const t = R();
        const x = s / 2 - half + t * half * 2;
        const yy = y + 12 - Math.sin(t * Math.PI) * 22 + (R() - 0.5) * 12;
        const a = Math.PI / 2 + (R() - 0.5) * 2.2;
        const l = 8 + R() * 10;
        g.strokeStyle = `hsl(${126 + (R() - 0.5) * 22}, ${30 + R() * 16}%, ${12 + R() * 14}%)`;
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + Math.cos(a) * l, yy + Math.sin(a) * l);
        g.stroke();
      }
    }
    g.strokeStyle = '#2e2218';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(s / 2, s * 0.04);
    g.lineTo(s / 2, s);
    g.stroke();
  });
  const smoke = canvasTex(128, (g, s) => {
    const R = rng(5);
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      const x = s / 2 + (R() - 0.5) * s * 0.35;
      const y = s / 2 + (R() - 0.5) * s * 0.35;
      const r = s * (0.18 + R() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.32)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    }
  }, { mips: false });
  const flame = canvasTex(128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s * 0.72, 0, s / 2, s * 0.6, s * 0.45);
    gr.addColorStop(0, 'rgba(255,240,200,1)');
    gr.addColorStop(0.35, 'rgba(255,170,60,0.85)');
    gr.addColorStop(0.7, 'rgba(220,70,10,0.35)');
    gr.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(s * 0.18, s * 0.95);
    g.quadraticCurveTo(s * 0.2, s * 0.35, s * 0.5, s * 0.02);
    g.quadraticCurveTo(s * 0.8, s * 0.35, s * 0.82, s * 0.95);
    g.closePath();
    g.fill();
  }, { mips: false });
  const glow = canvasTex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }, { mips: false });
  const moon = canvasTex(128, (g, s) => {
    const R = rng(9);
    g.clearRect(0, 0, s, s);
    const gr = g.createRadialGradient(s * 0.45, s * 0.45, s * 0.05, s / 2, s / 2, s * 0.48);
    gr.addColorStop(0, '#f4f1e6');
    gr.addColorStop(0.9, '#d9d4c3');
    gr.addColorStop(1, 'rgba(217,212,195,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 16; i++) {
      const a = R() * Math.PI * 2;
      const d = R() * s * 0.32;
      g.fillStyle = `rgba(150,145,130,${0.15 + R() * 0.25})`;
      g.beginPath();
      g.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.02 + R() * 0.07), 0, Math.PI * 2);
      g.fill();
    }
  }, { mips: false });
  // 들꽃 한 포기: 줄기와 꽃송이(흰·노랑·보라)
  const flowers = canvasTex(256, (g, s) => {
    const R = rng(77);
    g.clearRect(0, 0, s, s);
    const kinds = [['#f4f1e4', '#e8c43a'], ['#f2cf3a', '#c98a1a'], ['#a77fd4', '#f2e2a0'], ['#e8e2f2', '#d8b23a']];
    for (let i = 0; i < 9; i++) {
      const [petal, eye] = kinds[Math.floor(R() * kinds.length)];
      const x = s * (0.15 + R() * 0.7);
      const top = s * (0.12 + R() * 0.4);
      g.strokeStyle = '#3d6a24';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(x + (R() - 0.5) * 20, s);
      g.quadraticCurveTo(x + (R() - 0.5) * 30, (s + top) / 2, x, top);
      g.stroke();
      g.fillStyle = '#3f7a28';
      g.beginPath();
      g.ellipse(x + 8, (s + top) / 2 + 10, 9, 3.5, -0.6, 0, Math.PI * 2);
      g.fill();
      const r = 7 + R() * 6;
      g.fillStyle = petal;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        g.beginPath();
        g.ellipse(x + Math.cos(a) * r * 0.6, top + Math.sin(a) * r * 0.6, r * 0.55, r * 0.28, a, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = eye;
      g.beginPath();
      g.arc(x, top, r * 0.32, 0, Math.PI * 2);
      g.fill();
    }
  });
  return { birchLeaves, bushLeaves, pineNeedles, smoke, flame, glow, moon, flowers };
}
