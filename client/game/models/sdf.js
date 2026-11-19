// 거리장(SDF) 도구와 표면 그물(surface nets) 메셔(v0.4.3).
// 캐릭터처럼 이음매 없는 매끈한 모양을 만들 때 쓴다. 모든 함수는 숫자만 받아 빠르게 돈다(벡터 객체를 만들지 않는다).

export function sdSphere(px, py, pz, cx, cy, cz, r) {
  return Math.hypot(px - cx, py - cy, pz - cz) - r;
}

// 타원체(근사, 표면 근처에서 정확)
export function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx;
  const y = (py - cy) / ry;
  const z = (pz - cz) / rz;
  const k0 = Math.hypot(x, y, z);
  const k1 = Math.hypot(x / rx, y / ry, z / rz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

// 두 끝 반지름이 다른 캡슐(둥근 원뿔). a 쪽 반지름 r1, b 쪽 r2
export function sdRoundCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const qx = pax * l2 - bax * y;
  const qy = pay * l2 - bay * y;
  const qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// 모서리가 둥근 상자(축 정렬, 중심 c, 반 크기 h, 둥글기 r)
export function sdBox(px, py, pz, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(px - cx) - hx + r;
  const qy = Math.abs(py - cy) - hy + r;
  const qz = Math.abs(pz - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

// 고리(중심 c, xz 평면, 큰 반지름 R, 굵기 r). 앞쪽(z+)을 tilt만큼 내린다
export function sdTorus(px, py, pz, cx, cy, cz, R, r, tilt = 0) {
  let x = px - cx;
  let y = py - cy;
  let z = pz - cz;
  if (tilt) {
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    const ny = y * c + z * s;
    z = -y * s + z * c;
    y = ny;
  }
  const q = Math.hypot(x, z) - R;
  return Math.hypot(q, y) - r;
}

export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}
// y가 [lo, hi] 안이면 음수인 판(slab)
export const slabY = (y, lo, hi) => Math.max(lo - y, y - hi);

// 결정적 3D 값 잡음(0~1)
function h3(ix, iy, iz) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(iz | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(ix, iy, iz), h3(ix + 1, iy, iz), u), l(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), u), v),
    l(l(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), u), l(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), u), v),
    w,
  );
}

// 표면 그물: 격자 칸마다 꼭짓점 하나(부호가 바뀌는 모서리 교점의 평균), 부호가 바뀌는 격자 모서리마다 사각형 하나.
// 꼭짓점은 거리장 기울기로 표면에 한두 번 끌어당기고, 노멀도 기울기로 구한다.
export function surfaceNets(f, min, max, step, { relax = 2 } = {}) {
  const [x0, y0, z0] = min;
  const nx = Math.ceil((max[0] - x0) / step) + 1;
  const ny = Math.ceil((max[1] - y0) / step) + 1;
  const nz = Math.ceil((max[2] - z0) / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const z = z0 + k * step;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * step;
      let o = nx * (j + ny * k);
      for (let i = 0; i < nx; i++) field[o++] = f(x0 + i * step, y, z);
    }
  }
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellV = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  let nv = 0;
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = CORNER[c];
          const v = field[(i + a) + nx * ((j + b) + ny * (k + d))];
          val[c] = v;
          if (v < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [ea, eb] of EDGES) {
          const va = val[ea];
          const vb = val[eb];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const A = CORNER[ea];
          const B = CORNER[eb];
          sx += A[0] + (B[0] - A[0]) * t;
          sy += A[1] + (B[1] - A[1]) * t;
          sz += A[2] + (B[2] - A[2]) * t;
          n++;
        }
        cellV[i + cx * (j + cy * k)] = nv++;
        pos.push(x0 + (i + sx / n) * step, y0 + (j + sy / n) * step, z0 + (k + sz / n) * step);
      }
    }
  }
  const idx = [];
  const cell = (i, j, k) => cellV[i + cx * (j + cy * k)];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v0 = field[i + nx * (j + ny * k)];
        const in0 = v0 < 0;
        if (i < cx && j > 0 && k > 0 && j < cy && k < cz) {
          const v1 = field[(i + 1) + nx * (j + ny * k)];
          if ((v1 < 0) !== in0) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !in0);
        }
        if (j < cy && i > 0 && k > 0 && i < cx && k < cz) {
          const v1 = field[i + nx * ((j + 1) + ny * k)];
          if ((v1 < 0) !== in0) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !in0);
        }
        if (k < cz && i > 0 && j > 0 && i < cx && j < cy) {
          const v1 = field[i + nx * (j + ny * (k + 1))];
          if ((v1 < 0) !== in0) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !in0);
        }
      }
    }
  }
  const P = new Float32Array(pos);
  const N = new Float32Array(pos.length);
  const e = step * 0.5;
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3];
    let y = P[v * 3 + 1];
    let z = P[v * 3 + 2];
    for (let r = 0; r <= relax; r++) {
      const gx = f(x + e, y, z) - f(x - e, y, z);
      const gy = f(x, y + e, z) - f(x, y - e, z);
      const gz = f(x, y, z + e) - f(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      if (r < relax) {
        // 표면으로 당기기(한 칸을 넘지 않게)
        const d = f(x, y, z);
        const m = Math.max(-step * 0.5, Math.min(step * 0.5, d));
        x -= (gx / gl) * m;
        y -= (gy / gl) * m;
        z -= (gz / gl) * m;
      } else {
        N[v * 3] = gx / gl;
        N[v * 3 + 1] = gy / gl;
        N[v * 3 + 2] = gz / gl;
      }
    }
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
  }
  return { positions: P, normals: N, indices: new Uint32Array(idx), count: nv };
}
