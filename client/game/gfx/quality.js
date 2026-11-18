// 화질 단계. PC는 높음, 휴대폰은 중간에서 시작하고 fps가 모자라면 스스로 한 단계씩 내린다.
// 고른 단계는 브라우저에 기억한다(설정 창에서 바꿀 수 있다).

const KEY = 'mist-isle:gfx';
const AUTO_KEY = 'mist-isle:gfx-auto';

export const TIERS = {
  high: {
    id: 'high', label: '높음', maxDpr: 2, shadow: 4096, shadowRange: 60, post: true, ao: true, bloom: true, aa: 'smaa',
    grass: 90000, grassR: 50, terrainN: 560, water: 220, flora: 1, envSize: 256, texTerrain: 1024, texObject: 512,
  },
  medium: {
    id: 'medium', label: '중간', maxDpr: 1.5, shadow: 2048, shadowRange: 46, post: true, ao: false, bloom: true, aa: 'fxaa',
    grass: 42000, grassR: 36, terrainN: 400, water: 160, flora: 0.75, envSize: 128, texTerrain: 1024, texObject: 512,
  },
  low: {
    id: 'low', label: '낮음', maxDpr: 1.2, shadow: 1024, shadowRange: 32, post: false, ao: false, bloom: false, aa: null,
    grass: 14000, grassR: 24, terrainN: 280, water: 110, flora: 0.5, envSize: 64, texTerrain: 512, texObject: 256,
  },
};
const ORDER = ['high', 'medium', 'low'];

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

// fps를 보고 단계를 내린다. 처음 몇 초는 셰이더 준비로 느리니 건너뛴다.
export function createAutoTuner(onDrop) {
  let t = 0;
  let frames = 0;
  let acc = 0;
  let drops = 0;
  const WARM = 4;
  const WINDOW = 5;
  return {
    tick(dt, tier) {
      if (chosenTier() !== 'auto' || drops >= 2) return;
      if (dt > 0.2) return; // 탭을 잠시 떠났다 온 프레임은 세지 않는다
      t += dt;
      if (t < WARM) return;
      frames++;
      acc += dt;
      if (acc < WINDOW) return;
      const fps = frames / acc;
      frames = 0;
      acc = 0;
      const i = ORDER.indexOf(tier.id);
      if (fps < 42 && i < ORDER.length - 1) {
        drops++;
        const next = TIERS[ORDER[i + 1]];
        write(AUTO_KEY, next.id);
        onDrop(next, fps);
      }
    },
  };
}
