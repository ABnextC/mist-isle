// 소리 짓는 도구(v2.5): 녹음 파일 없이 WebAudio 노드로만 만든다.
// 모든 함수는 BaseAudioContext를 받는다 — 게임의 AudioContext에도, 점검용 OfflineAudioContext에도 그대로 쓴다.

const noiseCache = new WeakMap();

// 잡음 버퍼 셋: white(흰), pink(분홍), brown(갈색, 파도·바람 바탕). 2초짜리를 돌려 쓴다
export function noiseBuffers(ac) {
  let n = noiseCache.get(ac);
  if (n) return n;
  const len = Math.floor(ac.sampleRate * 2);
  const make = (fill) => {
    const b = ac.createBuffer(1, len, ac.sampleRate);
    fill(b.getChannelData(0));
    return b;
  };
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 * 2 - 1;
  };
  n = {
    white: make((d) => { for (let i = 0; i < d.length; i++) d[i] = rnd(); }),
    pink: make((d) => {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = rnd();
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }),
    brown: make((d) => {
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * rnd()) / 1.02;
        d[i] = last * 3.2;
      }
    }),
  };
  noiseCache.set(ac, n);
  return n;
}

// 잔향(방 울림): 잡음이 지수로 사그라드는 충격 응답
export function makeReverb(ac, sec = 2.6, decay = 2.4) {
  const len = Math.floor(ac.sampleRate * sec);
  const b = ac.createBuffer(2, len, ac.sampleRate);
  let seed = 777;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 4294967296 * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  const c = ac.createConvolver();
  c.buffer = b;
  return c;
}

// 소리 하나가 쓰는 출구: 이 노드에 이어 주면 된다. 실시간 컨텍스트에선 끝난 뒤 스스로 끊는다
export function voiceOut(ac, dest, { gain = 1, pan = 0, at = ac.currentTime, life = 2, send = null, sendGain = 0 } = {}) {
  const g = ac.createGain();
  g.gain.value = gain;
  let head = g;
  if (pan && ac.createStereoPanner) {
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    head = p;
  }
  head.connect(dest);
  let s = null;
  if (send && sendGain > 0) {
    s = ac.createGain();
    s.gain.value = sendGain;
    head.connect(s);
    s.connect(send);
  }
  if (!ac.startRendering) {
    setTimeout(() => {
      try {
        head.disconnect();
        if (head !== g) g.disconnect();
        s?.disconnect();
      } catch { /* 이미 끊김 */ }
    }, (at - ac.currentTime + life + 0.5) * 1000);
  }
  return g;
}

// 엔벨로프: 0에서 peak까지 a초, 그다음 지수로 d초 동안 줄어든다
export function env(param, at, peak, a, d, floor = 0.0001) {
  param.setValueAtTime(floor, at);
  param.linearRampToValueAtTime(peak, at + Math.max(0.002, a));
  param.exponentialRampToValueAtTime(floor, at + a + Math.max(0.01, d));
}

// 발진기 한 음
export function tone(ac, out, { type = 'sine', freq = 440, to = null, glide = 0.1, at = ac.currentTime, a = 0.005, d = 0.3, peak = 0.5, detune = 0 }) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + glide);
  o.detune.value = detune;
  const g = ac.createGain();
  env(g.gain, at, peak, a, d);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + a + d + 0.05);
  return o;
}

// 잡음 한 번: 필터(종류·주파수·Q)와 주파수 미끄럼(to)
export function burst(ac, out, { kind = 'white', filter = 'bandpass', freq = 1000, to = null, glide = 0.1, q = 1, at = ac.currentTime, a = 0.002, d = 0.15, peak = 0.5, rate = 1 }) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffers(ac)[kind];
  src.playbackRate.value = rate;
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, at);
  if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + glide);
  f.Q.value = q;
  const g = ac.createGain();
  env(g.gain, at, peak, a, d);
  src.connect(f).connect(g).connect(out);
  const off = Math.random() * 1.5;
  src.start(at, off);
  src.stop(at + a + d + 0.05);
  return src;
}

// FM 종소리: 운반파 + 변조파(비율 ratio, 깊이 index)
export function fmBell(ac, out, { freq = 880, ratio = 3.5, index = 2.5, at = ac.currentTime, d = 1.6, peak = 0.3 }) {
  const c = ac.createOscillator();
  const m = ac.createOscillator();
  const mg = ac.createGain();
  c.frequency.value = freq;
  m.frequency.value = freq * ratio;
  mg.gain.setValueAtTime(freq * index, at);
  mg.gain.exponentialRampToValueAtTime(freq * 0.05, at + d);
  m.connect(mg).connect(c.frequency);
  const g = ac.createGain();
  env(g.gain, at, peak, 0.004, d);
  c.connect(g).connect(out);
  c.start(at);
  m.start(at);
  c.stop(at + d + 0.1);
  m.stop(at + d + 0.1);
}

// 금속 울림: 어긋난 사인 여럿(부분음 비가 정수가 아니어야 쇠처럼 들린다)
export function clang(ac, out, { freq = 520, at = ac.currentTime, d = 0.9, peak = 0.3, parts = [1, 2.76, 5.4, 8.93] }) {
  parts.forEach((r, i) => tone(ac, out, { type: 'sine', freq: freq * r, at, a: 0.001, d: d / (1 + i * 0.6), peak: peak / (1 + i * 0.8) }));
}
