// 배경 음악 악보(v2.5): 브라우저 없이도 도는 순수 함수만 둔다(테스트가 직접 부른다).
// 분위기(지역·밤·싸움)마다 음계·화음 진행·빠르기·악기를 정하고, 마디마다 음을 지어 낸다.
// 같은 씨앗이면 같은 곡이 나온다.

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

// 분위기: root(MIDI), 음계, 진행(음계 도수, 0부터), 빠르기, 가락 악기, 가락 밀도(마디당 음 수 대략)
export const MOODS = {
  coast: { name: '난파 해안', root: 62, scale: 'mixolydian', prog: [0, 4, 5, 3], bpm: 76, lead: 'flute', density: 3, pad: 0.9 },
  coast_night: { name: '해안의 밤', root: 62, scale: 'dorian', prog: [0, 5, 3, 4], bpm: 60, lead: 'bell', density: 1.4, pad: 0.7 },
  swamp: { name: '안개 늪', root: 57, scale: 'aeolian', prog: [0, 5, 6, 4], bpm: 64, lead: 'pluck', density: 2.2, pad: 1 },
  swamp_night: { name: '늪의 밤', root: 57, scale: 'aeolian', prog: [0, 3, 5, 4], bpm: 56, lead: 'bell', density: 1.1, pad: 0.8 },
  ember: { name: '불과 서리 능선', root: 52, scale: 'phrygian', prog: [0, 1, 0, 6], bpm: 70, lead: 'horn', density: 2, pad: 1 },
  ember_night: { name: '능선의 밤', root: 52, scale: 'aeolian', prog: [0, 6, 5, 6], bpm: 58, lead: 'bell', density: 1.2, pad: 0.8 },
  heart: { name: '안개의 심장', root: 60, scale: 'lydian', prog: [0, 1, 4, 0], bpm: 60, lead: 'bell', density: 1.6, pad: 1.1 },
  heart_night: { name: '심장의 밤', root: 60, scale: 'lydian', prog: [0, 1, 5, 1], bpm: 52, lead: 'bell', density: 1, pad: 1 },
  town: { name: '마을', root: 67, scale: 'ionian', prog: [0, 3, 4, 0], bpm: 84, lead: 'pluck', density: 3.2, pad: 0.7 },
  combat: { name: '싸움', root: 57, scale: 'aeolian', prog: [0, 0, 5, 6], bpm: 112, lead: 'pluck', density: 4, pad: 0.6, drums: true },
  boss: { name: '두목', root: 52, scale: 'phrygian', prog: [0, 1, 0, 6], bpm: 120, lead: 'horn', density: 4, pad: 0.8, drums: true },
};

const REGION_MOOD = { wreck_coast: 'coast', swamp_shore: 'swamp', ember_ridge: 'ember', mist_heart: 'heart' };

// 지금 들려줄 분위기 이름
export function moodFor({ region, night = false, combat = false, boss = false, town = false }) {
  if (boss) return 'boss';
  if (combat) return 'combat';
  if (town && !night) return 'town';
  const base = REGION_MOOD[region] || 'coast';
  return night ? `${base}_night` : base;
}

// 음계 도수 → MIDI(도수가 음계 길이를 넘으면 옥타브를 올린다)
export function degree(mood, d, oct = 0) {
  const sc = SCALES[mood.scale];
  const n = sc.length;
  const o = Math.floor(d / n);
  const i = ((d % n) + n) % n;
  return mood.root + sc[i] + 12 * (o + oct);
}

// 도수 d에서 쌓은 3화음(+7음 가끔)
export function chordOf(mood, d, seventh = false) {
  const out = [degree(mood, d), degree(mood, d + 2), degree(mood, d + 4)];
  if (seventh) out.push(degree(mood, d + 6));
  return out;
}

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 마디 하나를 짓는다. 돌려주는 음: { at(박), dur(박), inst, midi, vel }
// state는 마디를 넘어 이어지는 가락 위치(prev)를 담는다.
export function composeBar(moodId, bar, rng, state = {}) {
  const mood = MOODS[moodId];
  const notes = [];
  const d = mood.prog[bar % mood.prog.length];
  const phraseEnd = bar % 8 === 7;
  // 바탕 화음: 마디 내내, 낮게
  const chord = chordOf(mood, d, rng() < 0.3);
  for (const m of chord) notes.push({ at: 0, dur: 4, inst: 'pad', midi: m - 12, vel: 0.5 * mood.pad });
  // 베이스: 1박(싸움은 8분음 밀기)
  const root = degree(mood, d, -2);
  if (mood.drums) {
    for (let i = 0; i < 8; i++) if (i !== 3 && i !== 7) notes.push({ at: i * 0.5, dur: 0.45, inst: 'bass', midi: root + (i === 6 ? 7 : 0), vel: i % 4 === 0 ? 0.9 : 0.6 });
  } else {
    notes.push({ at: 0, dur: 3.6, inst: 'bass', midi: root, vel: 0.7 });
    if (rng() < 0.4) notes.push({ at: 2.5, dur: 1.4, inst: 'bass', midi: root + 7, vel: 0.45 });
  }
  // 가락: 화음음 쪽으로 기우는 걸음
  const count = Math.max(0, Math.round(mood.density * (0.6 + rng() * 0.8) * (phraseEnd ? 0.5 : 1)));
  const slots = [];
  const grid = mood.drums ? 0.5 : 0.5;
  for (let i = 0; i < count; i++) {
    const at = Math.floor(rng() * (4 / grid)) * grid;
    if (!slots.includes(at)) slots.push(at);
  }
  slots.sort((a, b) => a - b);
  let prev = state.prev ?? d + 7;
  for (let i = 0; i < slots.length; i++) {
    const tones = [d, d + 2, d + 4].map((x) => x + 7);
    let step = Math.round((rng() - 0.5) * 4);
    if (rng() < 0.45) {
      // 가장 가까운 화음음으로
      let best = tones[0];
      for (const tt of tones) if (Math.abs(tt - prev) < Math.abs(best - prev)) best = tt;
      step = best - prev;
    }
    prev = Math.max(d + 3, Math.min(d + 13, prev + step));
    const next = slots[i + 1] ?? 4;
    const dur = Math.min(next - slots[i], mood.lead === 'bell' ? 2.5 : 1.6);
    notes.push({ at: slots[i], dur: Math.max(0.35, dur), inst: mood.lead, midi: degree(mood, prev), vel: 0.55 + rng() * 0.3 });
  }
  state.prev = prev;
  // 북(싸움)
  if (mood.drums) {
    for (let i = 0; i < 4; i++) notes.push({ at: i, dur: 0.3, inst: i % 2 === 0 ? 'kick' : 'tom', midi: 0, vel: i === 0 ? 1 : 0.7 });
    for (let i = 0; i < 8; i++) notes.push({ at: i * 0.5 + 0.25, dur: 0.1, inst: 'shaker', midi: 0, vel: 0.4 + (i % 2) * 0.2 });
    if (phraseEnd) notes.push({ at: 3.5, dur: 0.4, inst: 'tom', midi: 0, vel: 0.9 });
  }
  return notes;
}

// 한 곡(마디 n개)을 미리 지어 본다(시험·점검용)
export function composePiece(moodId, bars, seed = 1) {
  const rng = makeRng(seed);
  const state = {};
  const out = [];
  for (let b = 0; b < bars; b++) for (const n of composeBar(moodId, b, rng, state)) out.push({ ...n, at: n.at + b * 4 });
  return out;
}
