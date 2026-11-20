// 화질 단계. PC는 높음, 휴대폰은 중간에서 시작하고 fps가 모자라면 스스로 한 단계씩 내린다.
// 고른 단계는 브라우저에 기억한다(설정 창에서 바꿀 수 있다).

const KEY = 'mist-isle:gfx';
const AUTO_KEY = 'mist-isle:gfx-auto';

// rank: 높을수록 무겁다. maxPx: 그리는 픽셀 수 상한(창 크기·배율과 무관하게 GPU 일을 묶는다). ssaa: 이 배율보다는 크게 그린다(최고).
export const TIERS = {
  ultra: {
    id: 'ultra', rank: 3, label: '최고', maxDpr: 2.5, ssaa: 1.5, maxPx: 8.4e6, shadow: 6144, shadowRange: 72, shadowRadius: 2.5,
    post: true, ao: true, aoFull: true, aoSamples: 16, bloom: true, aa: 'smaa',
    grass: 170000, grassR: 70, terrainN: 640, water: 260, flora: 1, nearCrown: 95, envSize: 256, texTerrain: 2048, texObject: 2048, charNear: 45,
  },
  high: {
    id: 'high', rank: 2, label: '높음', maxDpr: 2, maxPx: 3.7e6, shadow: 4096, shadowRange: 60, shadowRadius: 2,
    post: true, ao: true, aoSamples: 12, bloom: true, aa: 'smaa',
    grass: 90000, grassR: 50, terrainN: 560, water: 220, flora: 1, nearCrown: 70, envSize: 256, texTerrain: 2048, texObject: 1024, charNear: 26,
  },
  medium: {
    id: 'medium', rank: 1, label: '중간', maxDpr: 1.5, maxPx: 2.2e6, shadow: 2048, shadowRange: 46, shadowRadius: 2,
    post: true, ao: false, bloom: true, aa: 'fxaa',
    grass: 42000, grassR: 36, terrainN: 400, water: 160, flora: 0.75, nearCrown: 55, envSize: 128, texTerrain: 1024, texObject: 512, charNear: 18,
  },
  low: {
    id: 'low', rank: 0, label: '낮음', maxDpr: 1.2, maxPx: 1.1e6, shadow: 1024, shadowRange: 32, shadowRadius: 2,
    post: false, ao: false, bloom: false, aa: null,
    grass: 14000, grassR: 24, terrainN: 280, water: 110, flora: 0.5, nearCrown: 40, envSize: 64, texTerrain: 512, texObject: 256, charNear: 12,
  },
};
const ORDER = ['ultra', 'high', 'medium', 'low'];

// 창 크기·화면 배율을 보고 실제로 그릴 배율을 정한다
export function pixelRatioFor(t, w = window.innerWidth, h = window.innerHeight) {
  const dpr = window.devicePixelRatio || 1;
  let s = Math.min(dpr, t.maxDpr);
  if (t.ssaa) s = Math.max(s, Math.min(t.ssaa, t.maxDpr));
  s = Math.min(s, Math.sqrt(t.maxPx / Math.max(1, w * h)));
  return Math.max(0.5, Math.round(s * 100) / 100);
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, v) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch { /* 저장 불가 */ }
}

// 'auto' 또는 단계 이름
export function chosenTier() {
  const v = read(KEY);
  return v && (v === 'auto' || TIERS[v]) ? v : 'auto';
}

export function setChosenTier(v) {
  write(KEY, v === 'auto' ? null : v);
  if (v === 'auto') write(AUTO_KEY, null);
}

// 이번 실행에서 쓸 단계
export function startTier(touch) {
  const c = chosenTier();
  if (c !== 'auto') return TIERS[c];
  const remembered = read(AUTO_KEY);
  if (remembered && TIERS[remembered]) return TIERS[remembered];
  return touch ? TIERS.medium : TIERS.high;
}

// fps(와 잴 수 있으면 GPU 시간)를 보고 단계를 바꾼다. 처음 몇 초는 셰이더 준비로 느리니 건너뛴다.
// 내리기: 5초 평균 42fps 아래. 올리기(높음→최고, 한 번만): 100fps 넘게 나오거나, GPU가 한 장에 5.5ms도 안 쓰면서 55fps 이상.
export function createAutoTuner(onChange) {
  let t = 0;
  let frames = 0;
  let acc = 0;
  let drops = 0;
  let ups = 0;
  let gpuAcc = 0;
  let gpuN = 0;
  const WARM = 6;
  const WINDOW = 5;
  return {
    gpu(ms) {
      if (ms > 0) {
        gpuAcc += ms;
        gpuN++;
      }
    },
    tick(dt, tier) {
      if (chosenTier() !== 'auto' || drops >= 2) return;
      if (dt > 0.2) return; // 탭을 잠시 떠났다 온 프레임은 세지 않는다
      t += dt;
      if (t < WARM) return;
      frames++;
      acc += dt;
      if (acc < WINDOW) return;
      const fps = frames / acc;
      const gpu = gpuN >= 8 ? gpuAcc / gpuN : null;
      frames = 0;
      acc = 0;
      gpuAcc = 0;
      gpuN = 0;
      const i = ORDER.indexOf(tier.id);
      if (fps < (tier.id === 'ultra' ? 50 : 42) && i < ORDER.length - 1) {
        drops++;
        const next = TIERS[ORDER[i + 1]];
        write(AUTO_KEY, next.id);
        onChange(next, fps, 'down');
      } else if (tier.id === 'high' && ups === 0 && drops === 0 && (fps >= 100 || (gpu !== null && gpu < 5.5 && fps >= 55))) {
        ups++;
        write(AUTO_KEY, 'ultra');
        onChange(TIERS.ultra, fps, 'up');
      }
    },
  };
}
