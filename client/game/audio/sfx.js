// 효과음 요리법(v2.5). 이름 → (ac, out, o) 함수. out은 voiceOut이 만든 출구, o는 세기·크기 같은 맛.
// 각 요리법의 life(초)는 소리가 다 사그라드는 시간이다(노드 끊는 데 쓴다).

import { tone, burst, fmBell, clang } from './synth.js';

const T = (ac) => ac.currentTime + 0.005;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const SFX = {
  // ── 화면·알림 ──
  ui: { life: 0.1, play(ac, out) { const t = T(ac); tone(ac, out, { type: 'triangle', freq: 1800, to: 1200, glide: 0.03, at: t, a: 0.001, d: 0.04, peak: 0.25 }); } },
  pop: { life: 0.4, play(ac, out) { const t = T(ac); tone(ac, out, { type: 'sine', freq: 660, to: 990, glide: 0.06, at: t, a: 0.002, d: 0.16, peak: 0.35 }); tone(ac, out, { type: 'sine', freq: 1320, at: t + 0.05, d: 0.2, peak: 0.12 }); } },
  coin: {
    life: 0.6,
    play(ac, out) {
      const t = T(ac);
      for (const [dt, f] of [[0, 2093], [0.07, 2637]]) clang(ac, out, { freq: f, at: t + dt, d: 0.35, peak: 0.16, parts: [1, 2.4, 3.9] });
    },
  },
  levelup: {
    life: 2.2,
    play(ac, out) {
      const t = T(ac);
      [60, 64, 67, 72, 76].forEach((m, i) => fmBell(ac, out, { freq: midi(m + 12), ratio: 2, index: 1.2, at: t + i * 0.09, d: 1.4, peak: 0.18 }));
      for (const m of [60, 64, 67]) tone(ac, out, { type: 'triangle', freq: midi(m), at: t + 0.45, a: 0.08, d: 1.5, peak: 0.08 });
    },
  },
  skillup: {
    life: 1.4,
    play(ac, out) {
      const t = T(ac);
      [67, 71, 74].forEach((m, i) => fmBell(ac, out, { freq: midi(m + 12), ratio: 2, index: 1, at: t + i * 0.08, d: 0.9, peak: 0.15 }));
    },
  },
  quest: {
    life: 2.6,
    play(ac, out) {
      const t = T(ac);
      for (const [dt, ms] of [[0, [62, 66, 69]], [0.32, [67, 71, 74, 79]]]) for (const m of ms) tone(ac, out, { type: 'triangle', freq: midi(m), at: t + dt, a: 0.02, d: dt ? 1.9 : 0.5, peak: 0.09 });
      fmBell(ac, out, { freq: midi(91), ratio: 3, index: 1.2, at: t + 0.32, d: 1.8, peak: 0.1 });
    },
  },
  queststart: {
    life: 1.2,
    play(ac, out) {
      const t = T(ac);
      fmBell(ac, out, { freq: midi(79), ratio: 2, index: 1, at: t, d: 0.8, peak: 0.13 });
      fmBell(ac, out, { freq: midi(86), ratio: 2, index: 1, at: t + 0.12, d: 1, peak: 0.12 });
    },
  },
  fail: {
    life: 1.8,
    play(ac, out) {
      const t = T(ac);
      [64, 63, 59].forEach((m, i) => tone(ac, out, { type: 'triangle', freq: midi(m - 12), at: t + i * 0.22, a: 0.02, d: i === 2 ? 1.3 : 0.3, peak: 0.14 }));
    },
  },
  down: {
    life: 2.4,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'sine', freq: 110, to: 55, glide: 1.2, at: t, a: 0.01, d: 1.8, peak: 0.45 });
      for (const m of [52, 55, 58]) tone(ac, out, { type: 'triangle', freq: midi(m), at: t + 0.1, a: 0.3, d: 1.8, peak: 0.06 });
    },
  },
  recall: {
    life: 1.6,
    play(ac, out) {
      const t = T(ac);
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 400, to: 4000, glide: 0.9, q: 4, at: t, a: 0.3, d: 0.9, peak: 0.25 });
      for (let i = 0; i < 6; i++) fmBell(ac, out, { freq: midi(84 + [0, 4, 7, 11, 14, 19][i]), ratio: 3, index: 0.8, at: t + 0.1 + i * 0.07, d: 0.7, peak: 0.05 });
    },
  },
  bell: {
    life: 3,
    play(ac, out) {
      const t = T(ac);
      clang(ac, out, { freq: 392, at: t, d: 2.8, peak: 0.12, parts: [1, 2, 2.76, 5.4] });
    },
  },

  // ── 생활 ──
  chop: {
    life: 0.35,
    play(ac, out, o = {}) {
      const t = T(ac);
      const k = 0.85 + (o.vary ?? Math.random()) * 0.3;
      tone(ac, out, { type: 'sine', freq: 180 * k, to: 90 * k, glide: 0.08, at: t, a: 0.001, d: 0.12, peak: 0.55 });
      burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 1400 * k, q: 2.5, at: t, d: 0.07, peak: 0.45 });
      burst(ac, out, { kind: 'pink', filter: 'lowpass', freq: 700, at: t + 0.01, d: 0.2, peak: 0.2 });
    },
  },
  mine: {
    life: 0.6,
    play(ac, out, o = {}) {
      const t = T(ac);
      const k = 0.9 + (o.vary ?? Math.random()) * 0.25;
      clang(ac, out, { freq: 1250 * k, at: t, d: 0.35, peak: 0.16, parts: [1, 2.3, 3.7, 5.9] });
      burst(ac, out, { kind: 'white', filter: 'highpass', freq: 2500, at: t, d: 0.05, peak: 0.4 });
      burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 500, at: t + 0.01, d: 0.18, peak: 0.35 });
    },
  },
  rustle: {
    life: 0.5,
    play(ac, out, o = {}) {
      const t = T(ac);
      const k = 0.8 + (o.vary ?? Math.random()) * 0.4;
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 3200 * k, to: 1800 * k, glide: 0.25, q: 1.2, at: t, a: 0.03, d: 0.28, peak: 0.6 });
      burst(ac, out, { kind: 'white', filter: 'highpass', freq: 5000, at: t + 0.05, a: 0.02, d: 0.12, peak: 0.08 });
    },
  },
  splash: {
    life: 0.9,
    play(ac, out, o = {}) {
      const t = T(ac);
      const k = 0.85 + (o.vary ?? Math.random()) * 0.3;
      burst(ac, out, { kind: 'white', filter: 'lowpass', freq: 5000 * k, to: 700, glide: 0.4, q: 0.7, at: t, a: 0.005, d: 0.45, peak: 0.35 });
      for (let i = 0; i < 3; i++) tone(ac, out, { type: 'sine', freq: (700 + i * 260) * k, to: (1300 + i * 300) * k, glide: 0.06, at: t + 0.05 + i * 0.07, a: 0.002, d: 0.06, peak: 0.08 });
    },
  },
  skin: {
    life: 0.4,
    play(ac, out) {
      const t = T(ac);
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 900, to: 400, glide: 0.2, q: 2, at: t, a: 0.01, d: 0.22, peak: 1.2 });
      tone(ac, out, { type: 'sine', freq: 130, to: 80, glide: 0.1, at: t, d: 0.12, peak: 0.2 });
    },
  },
  craft: {
    life: 1.4,
    play(ac, out) {
      const t = T(ac);
      for (let i = 0; i < 2; i++) clang(ac, out, { freq: 880 - i * 80, at: t + i * 0.16, d: 0.4, peak: 0.12, parts: [1, 2.6, 4.2] });
      fmBell(ac, out, { freq: midi(84), ratio: 2, index: 1, at: t + 0.38, d: 1, peak: 0.12 });
    },
  },
  eat: {
    life: 0.6,
    play(ac, out) {
      const t = T(ac);
      for (let i = 0; i < 3; i++) burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 2200 + Math.random() * 1500, q: 1.5, at: t + i * 0.14, a: 0.002, d: 0.06, peak: 0.45 });
    },
  },
  drink: {
    life: 0.9,
    play(ac, out) {
      const t = T(ac);
      for (let i = 0; i < 4; i++) tone(ac, out, { type: 'sine', freq: 260 + i * 40, to: 520 + i * 60, glide: 0.07, at: t + i * 0.13, a: 0.005, d: 0.09, peak: 0.25 });
      fmBell(ac, out, { freq: midi(88), ratio: 3, index: 0.6, at: t + 0.55, d: 0.5, peak: 0.06 });
    },
  },
  equip: {
    life: 0.5,
    play(ac, out) {
      const t = T(ac);
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 1800, q: 1, at: t, a: 0.02, d: 0.15, peak: 0.4 });
      clang(ac, out, { freq: 1500, at: t + 0.08, d: 0.25, peak: 0.06 });
    },
  },

  // ── 싸움 ──
  swing: {
    life: 0.45,
    play(ac, out, o = {}) {
      const t = T(ac);
      const heavy = !!o.heavy;
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: heavy ? 500 : 900, to: heavy ? 1600 : 2600, glide: heavy ? 0.28 : 0.16, q: 2.2, at: t, a: heavy ? 0.12 : 0.06, d: heavy ? 0.22 : 0.14, peak: heavy ? 0.9 : 0.7 });
    },
  },
  hit: {
    life: 0.5,
    play(ac, out, o = {}) {
      const t = T(ac);
      const k = o.heavy ? 0.75 : 1;
      tone(ac, out, { type: 'sine', freq: 140 * k, to: 55, glide: 0.12, at: t, a: 0.001, d: 0.18, peak: 0.7 });
      burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 1800 / k, q: 1.2, at: t, d: 0.06, peak: 0.5 });
      burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 600, at: t, d: 0.15, peak: 0.4 });
      if (o.crit) clang(ac, out, { freq: 1900, at: t + 0.01, d: 0.3, peak: 0.12 });
    },
  },
  block: { life: 1, play(ac, out) { const t = T(ac); clang(ac, out, { freq: 620, at: t, d: 0.8, peak: 0.28 }); burst(ac, out, { kind: 'white', filter: 'highpass', freq: 3000, at: t, d: 0.05, peak: 0.35 }); } },
  guardbreak: {
    life: 1.3,
    play(ac, out) {
      const t = T(ac);
      clang(ac, out, { freq: 380, at: t, d: 1.1, peak: 0.35 });
      tone(ac, out, { type: 'sine', freq: 120, to: 50, glide: 0.2, at: t, d: 0.3, peak: 0.45 });
    },
  },
  hurt: {
    life: 0.5,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'sine', freq: 95, to: 45, glide: 0.15, at: t, d: 0.22, peak: 0.8 });
      burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 400, at: t, d: 0.2, peak: 0.5 });
    },
  },
  dodge: { life: 0.5, play(ac, out) { const t = T(ac); burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 700, to: 1500, glide: 0.22, q: 1.5, at: t, a: 0.05, d: 0.25, peak: 0.7 }); } },
  bow: {
    life: 0.6,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'triangle', freq: 210, to: 150, glide: 0.25, at: t, a: 0.001, d: 0.35, peak: 0.35 });
      tone(ac, out, { type: 'sine', freq: 420, to: 300, glide: 0.2, at: t, a: 0.001, d: 0.2, peak: 0.12 });
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 2200, to: 900, glide: 0.25, q: 2, at: t + 0.02, a: 0.01, d: 0.25, peak: 0.18 });
    },
  },
  cast: {
    life: 0.9,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'sine', freq: 300, to: 1200, glide: 0.25, at: t, a: 0.02, d: 0.4, peak: 0.18 });
      tone(ac, out, { type: 'triangle', freq: 450, to: 1800, glide: 0.25, at: t, a: 0.02, d: 0.35, peak: 0.08, detune: 12 });
      burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 3000, to: 6000, glide: 0.3, q: 5, at: t, a: 0.05, d: 0.4, peak: 0.12 });
    },
  },
  arrow_hit: {
    life: 0.3,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'sine', freq: 260, to: 120, glide: 0.05, at: t, a: 0.001, d: 0.08, peak: 0.45 });
      burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 2500, q: 2, at: t, d: 0.04, peak: 0.35 });
    },
  },
  boom: {
    life: 1.6,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'sine', freq: 90, to: 30, glide: 0.6, at: t, a: 0.003, d: 0.9, peak: 0.6 });
      burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 1400, to: 200, glide: 0.8, at: t, a: 0.003, d: 1.1, peak: 0.55 });
      burst(ac, out, { kind: 'white', filter: 'highpass', freq: 2000, at: t, d: 0.15, peak: 0.3 });
    },
  },
  ability: {
    life: 0.8,
    play(ac, out) {
      const t = T(ac);
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 300, to: 2400, glide: 0.35, q: 3, at: t, a: 0.15, d: 0.3, peak: 0.6 });
      tone(ac, out, { type: 'triangle', freq: 220, to: 440, glide: 0.3, at: t, a: 0.1, d: 0.4, peak: 0.1 });
    },
  },
  growl: {
    life: 1,
    play(ac, out, o = {}) {
      const t = T(ac);
      const s = o.size ?? 1; // 클수록 낮다
      const f = 140 / s;
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f * 1.25, t + 0.25);
      osc.frequency.linearRampToValueAtTime(f * 0.8, t + 0.7);
      const lfo = ac.createOscillator();
      const lg = ac.createGain();
      lfo.frequency.value = 28;
      lg.gain.value = f * 0.12;
      lfo.connect(lg).connect(osc.frequency);
      const fl = ac.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = 900 / Math.sqrt(s);
      fl.Q.value = 4;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      osc.connect(fl).connect(g).connect(out);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.85);
      lfo.stop(t + 0.85);
      burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 500, at: t, a: 0.1, d: 0.6, peak: 0.3 });
    },
  },
  die: {
    life: 0.9,
    play(ac, out, o = {}) {
      const t = T(ac);
      const s = o.size ?? 1;
      tone(ac, out, { type: 'sine', freq: 90 / Math.sqrt(s), to: 40, glide: 0.25, at: t + 0.1, d: 0.35, peak: 0.6 });
      burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 500, at: t + 0.1, d: 0.4, peak: 0.5 });
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 700, to: 300, glide: 0.3, q: 2, at: t, a: 0.05, d: 0.25, peak: 0.15 });
    },
  },
  // 탈것(v3.2): 말굽(땅이 단단할수록 또각), 휘파람, 길잡이 돌이 열리는 소리
  hoof: {
    life: 0.3,
    play(ac, out, o = {}) {
      const t = T(ac);
      const v = 0.85 + Math.random() * 0.3;
      const hard = o.surface === 'stone' ? 1 : o.surface === 'sand' || o.surface === 'snow' ? 0.2 : 0.55;
      tone(ac, out, { type: 'sine', freq: 140 * v, to: 70, glide: 0.06, at: t, a: 0.002, d: 0.08, peak: 0.3 });
      burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 1900 * v, q: 3, at: t, d: 0.03, peak: 0.16 * hard });
      if (o.surface === 'water') burst(ac, out, { kind: 'white', filter: 'lowpass', freq: 2400, to: 500, glide: 0.2, at: t, d: 0.22, peak: 0.25 });
    },
  },
  whistle: {
    life: 1.2,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'sine', freq: 1500, to: 2300, glide: 0.18, at: t, a: 0.02, d: 0.25, peak: 0.12 });
      tone(ac, out, { type: 'sine', freq: 1700, to: 1250, glide: 0.25, at: t + 0.32, a: 0.02, d: 0.35, peak: 0.12 });
    },
  },
  neigh: {
    life: 1.4,
    play(ac, out) {
      const t = T(ac);
      for (let i = 0; i < 7; i++) tone(ac, out, { type: 'sawtooth', freq: 520 - i * 38 + (i % 2) * 60, at: t + i * 0.09, a: 0.01, d: 0.11, peak: 0.05 });
      burst(ac, out, { kind: 'pink', filter: 'lowpass', freq: 900, at: t + 0.7, a: 0.05, d: 0.4, peak: 0.12 });
    },
  },
  waystone: {
    life: 2.4,
    play(ac, out) {
      const t = T(ac);
      tone(ac, out, { type: 'sine', freq: 82, to: 165, glide: 1.6, at: t, a: 0.4, d: 1.8, peak: 0.3 });
      for (let i = 0; i < 5; i++) fmBell(ac, out, { freq: midi(76 + [0, 7, 12, 16, 19][i]), ratio: 2, index: 0.6, at: t + 0.4 + i * 0.22, d: 1.0, peak: 0.05 });
      burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 600, to: 5000, glide: 1.8, q: 3, at: t + 0.2, a: 0.8, d: 1.2, peak: 0.18 });
    },
  },
  step: {
    life: 0.3,
    play(ac, out, o = {}) {
      const t = T(ac);
      const v = 0.8 + Math.random() * 0.4;
      if (o.surface === 'water') {
        burst(ac, out, { kind: 'white', filter: 'lowpass', freq: 2600 * v, to: 600, glide: 0.18, at: t, a: 0.005, d: 0.2, peak: 0.22 });
      } else if (o.surface === 'sand') {
        burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 3500 * v, q: 0.8, at: t, a: 0.01, d: 0.09, peak: 0.12 });
      } else if (o.surface === 'snow') {
        burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 1800 * v, q: 1.5, at: t, a: 0.02, d: 0.12, peak: 0.16 });
        burst(ac, out, { kind: 'white', filter: 'highpass', freq: 4500, at: t + 0.03, d: 0.05, peak: 0.06 });
      } else if (o.surface === 'stone') {
        tone(ac, out, { type: 'sine', freq: 160 * v, to: 90, glide: 0.04, at: t, a: 0.001, d: 0.05, peak: 0.2 });
        burst(ac, out, { kind: 'white', filter: 'bandpass', freq: 2600 * v, q: 2, at: t, d: 0.03, peak: 0.1 });
      } else {
        tone(ac, out, { type: 'sine', freq: 110 * v, to: 70, glide: 0.05, at: t, a: 0.002, d: 0.06, peak: 0.18 });
        burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: 1500 * v, q: 1, at: t, a: 0.005, d: 0.07, peak: 0.1 });
      }
    },
  },
};
