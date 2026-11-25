// 배경 음악 연주(v2.5): score.js가 지은 마디를 악기로 소리 낸다.
// 앞을 조금 내다보고(LOOK초) 미리 예약하는 방식. 분위기가 바뀌면 마디 끝에서 갈아타고, 길게 연주한 뒤엔 잠깐 쉰다.

import { composeBar, makeRng, midiHz, MOODS } from './score.js';
import { noiseBuffers, tone, fmBell, burst } from './synth.js';

const LOOK = 0.35;

// 악기: (ac, out, n, t, spb) — n.midi·n.vel·n.dur(박), spb는 박당 초
export const INSTRUMENTS = {
  pad(ac, out, n, t, spb) {
    const len = n.dur * spb;
    const f = midiHz(n.midi);
    const g = ac.createGain();
    const peak = 0.05 * n.vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(1.4, len * 0.4));
    g.gain.setValueAtTime(peak, t + len * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 1.2);
    const fl = ac.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(500, t);
    fl.frequency.linearRampToValueAtTime(1100, t + len * 0.5);
    fl.frequency.linearRampToValueAtTime(600, t + len + 1);
    fl.connect(g).connect(out);
    for (const [type, det] of [['sawtooth', -7], ['sawtooth', 7], ['triangle', 0]]) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = type === 'triangle' ? f / 2 : f;
      o.detune.value = det;
      o.connect(fl);
      o.start(t);
      o.stop(t + len + 1.3);
    }
  },
  bass(ac, out, n, t, spb) {
    const len = n.dur * spb;
    tone(ac, out, { type: 'sine', freq: midiHz(n.midi), at: t, a: 0.01, d: len, peak: 0.22 * n.vel });
    tone(ac, out, { type: 'triangle', freq: midiHz(n.midi), at: t, a: 0.01, d: len * 0.4, peak: 0.06 * n.vel });
  },
  pluck(ac, out, n, t) {
    const f = midiHz(n.midi);
    tone(ac, out, { type: 'triangle', freq: f, at: t, a: 0.002, d: 0.9, peak: 0.16 * n.vel });
    tone(ac, out, { type: 'sine', freq: f * 2, at: t, a: 0.002, d: 0.35, peak: 0.06 * n.vel });
    burst(ac, out, { kind: 'white', filter: 'bandpass', freq: f * 4, q: 4, at: t, d: 0.02, peak: 0.04 * n.vel });
  },
  bell(ac, out, n, t) {
    fmBell(ac, out, { freq: midiHz(n.midi), ratio: 3.5, index: 1.6, at: t, d: 2.6, peak: 0.08 * n.vel });
  },
  flute(ac, out, n, t, spb) {
    const len = n.dur * spb;
    const f = midiHz(n.midi);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const vib = ac.createOscillator();
    const vg = ac.createGain();
    vib.frequency.value = 5.2;
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.6, len));
    vib.connect(vg).connect(o.frequency);
    const g = ac.createGain();
    const peak = 0.1 * n.vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.09);
    g.gain.setValueAtTime(peak * 0.85, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.25);
    o.connect(g).connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + len + 0.3);
    vib.stop(t + len + 0.3);
    burst(ac, out, { kind: 'pink', filter: 'bandpass', freq: f * 2, q: 3, at: t, a: 0.03, d: 0.15, peak: 0.03 * n.vel });
  },
  horn(ac, out, n, t, spb) {
    const len = n.dur * spb;
    const f = midiHz(n.midi - 12);
    const fl = ac.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(300, t);
    fl.frequency.linearRampToValueAtTime(1300, t + 0.15);
    fl.frequency.linearRampToValueAtTime(700, t + len);
    const g = ac.createGain();
    const peak = 0.07 * n.vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.12);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.35);
    fl.connect(g).connect(out);
    for (const det of [-5, 5]) {
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(fl);
      o.start(t);
      o.stop(t + len + 0.4);
    }
  },
  kick(ac, out, n, t) {
    tone(ac, out, { type: 'sine', freq: 120, to: 42, glide: 0.18, at: t, a: 0.002, d: 0.35, peak: 0.5 * n.vel });
  },
  tom(ac, out, n, t) {
    tone(ac, out, { type: 'sine', freq: 170, to: 95, glide: 0.2, at: t, a: 0.002, d: 0.3, peak: 0.32 * n.vel });
    burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 700, at: t, d: 0.18, peak: 0.25 * n.vel });
  },
  shaker(ac, out, n, t) {
    burst(ac, out, { kind: 'white', filter: 'highpass', freq: 6000, at: t, a: 0.01, d: 0.06, peak: 0.07 * n.vel });
  },
};

export function createMusic(ac, out, { seed = 7 } = {}) {
  noiseBuffers(ac);
  const rng = makeRng(seed);
  const st = { mood: null, want: null, bar: 0, nextAt: 0, state: {}, playedBars: 0, restUntil: 0, fadeTo: 1 };
  const bus = ac.createGain();
  bus.gain.value = 1;
  bus.connect(out);

  function setMood(id) {
    st.want = id;
  }

  // 길게 들려준 뒤 쉬는 시간(초). 싸움 중엔 쉬지 않는다
  function restLen() {
    return 25 + rng() * 35;
  }

  function update() {
    const now = ac.currentTime;
    if (!st.want) return;
    const fighting = MOODS[st.want]?.drums;
    if (st.restUntil > now && !fighting) return;
    if (st.restUntil > now && fighting) st.restUntil = 0;
    if (!st.mood || st.nextAt < now - 1) {
      st.mood = st.want;
      st.bar = 0;
      st.nextAt = now + 0.1;
      st.playedBars = 0;
      st.state = {};
    }
    while (st.nextAt < now + LOOK) {
      // 마디 경계에서만 분위기를 바꾼다(싸움으로 들어갈 때는 바로)
      if (st.want !== st.mood) {
        const toFight = MOODS[st.want]?.drums && !MOODS[st.mood]?.drums;
        if (toFight || st.bar % 2 === 0) {
          st.mood = st.want;
          st.bar = 0;
          st.state = {};
          st.playedBars = 0;
        }
      }
      const mood = MOODS[st.mood];
      const spb = 60 / mood.bpm;
      const notes = composeBar(st.mood, st.bar, rng, st.state);
      for (const n of notes) {
        const play = INSTRUMENTS[n.inst];
        if (play) play(ac, bus, n, st.nextAt + n.at * spb, spb);
      }
      st.nextAt += 4 * spb;
      st.bar++;
      st.playedBars++;
      // 평소 음악은 16마디(때로 24) 들려주고 쉰다
      if (!mood.drums && st.playedBars >= (st.bar % 3 === 0 ? 24 : 16)) {
        st.restUntil = st.nextAt + restLen();
        st.mood = null;
        return;
      }
    }
  }

  return { update, setMood, get mood() { return st.mood; }, get resting() { return st.restUntil > ac.currentTime; }, bus };
}

