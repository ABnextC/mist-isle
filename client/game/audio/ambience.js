// 환경음(v2.5): 파도·바람·새·풀벌레·개구리·불 타는 소리·심장의 웅웅거림.
// 늘 도는 층(파도·바람·풀벌레·웅웅)은 세기만 바꾸고, 새·개구리·불티는 그때그때 짧게 낸다.

import { noiseBuffers, tone, burst } from './synth.js';

function loop(ac, kind, rate = 1) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffers(ac)[kind];
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(ac.currentTime, Math.random() * 1.5);
  return s;
}

export function createAmbience(ac, out) {
  const layer = (src, filterType, freq, q = 0.7) => {
    const f = ac.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(out);
    return { f, g };
  };
  // 파도: 갈색 잡음 둘(먼 파도·부서지는 물보라)
  const seaLow = layer(loop(ac, 'brown', 0.9), 'lowpass', 420);
  const seaHi = layer(loop(ac, 'pink', 1), 'bandpass', 1400, 0.5);
  // 바람
  const wind = layer(loop(ac, 'pink', 0.6), 'bandpass', 600, 1.4);
  // 풀벌레: 높은 사인을 빠르게 끊어 울린다
  const cr = ac.createOscillator();
  cr.frequency.value = 4300;
  const crAm = ac.createGain();
  crAm.gain.value = 0;
  const pulse = ac.createOscillator();
  pulse.type = 'square';
  pulse.frequency.value = 21;
  const pulseG = ac.createGain();
  pulseG.gain.value = 0.5;
  pulse.connect(pulseG).connect(crAm.gain);
  const crG = ac.createGain();
  crG.gain.value = 0;
  cr.connect(crAm).connect(crG).connect(out);
  cr.start();
  pulse.start();
  // 안개의 심장: 낮은 두 음이 맥놀이하며 웅웅거린다
  const hum = ac.createGain();
  hum.gain.value = 0;
  hum.connect(out);
  for (const f of [55, 55.7, 82.4]) {
    const o = ac.createOscillator();
    o.frequency.value = f;
    o.connect(hum);
    o.start();
  }

  let nextBird = 0;
  let nextFrog = 0;
  let nextCrackle = 0;
  let nextChirpGate = 0;
  const set = (p, v, tc = 0.8) => p.setTargetAtTime(v, ac.currentTime, tc);

  function bird(t, pan) {
    const g = ac.createGain();
    g.gain.value = 0.5;
    let head = g;
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      head = p;
    }
    head.connect(out);
    const base = 2600 + Math.random() * 2200;
    const n = 2 + Math.floor(Math.random() * 4);
    const kind = Math.random();
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.09 + Math.random() * 0.06);
      if (kind < 0.5) tone(ac, g, { type: 'sine', freq: base * (1 + i * 0.04), to: base * 1.35, glide: 0.05, at, a: 0.005, d: 0.06, peak: 0.05 });
      else tone(ac, g, { type: 'sine', freq: base * 1.2, to: base * 0.8, glide: 0.08, at, a: 0.01, d: 0.09, peak: 0.045 });
    }
    setTimeout(() => { try { head.disconnect(); g.disconnect(); } catch { /* 끊김 */ } }, 2500);
  }
  function frog(t, pan) {
    const g = ac.createGain();
    g.gain.value = 0.6;
    let head = g;
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      head = p;
    }
    head.connect(out);
    const f = 180 + Math.random() * 120;
    for (let i = 0; i < 2; i++) {
      const at = t + i * 0.11;
      const o = ac.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, at);
      o.frequency.linearRampToValueAtTime(f * 1.3, at + 0.07);
      const fl = ac.createBiquadFilter();
      fl.type = 'bandpass';
      fl.frequency.value = 700;
      fl.Q.value = 3;
      const e = ac.createGain();
      e.gain.setValueAtTime(0.0001, at);
      e.gain.linearRampToValueAtTime(0.06, at + 0.01);
      e.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      o.connect(fl).connect(e).connect(g);
      o.start(at);
      o.stop(at + 0.1);
    }
    setTimeout(() => { try { head.disconnect(); g.disconnect(); } catch { /* 끊김 */ } }, 1500);
  }

  // i: { sea 0..1, night 0..1, region, zone, height, fire 0..1, inTown, land 0..1 }
  function update(i) {
    const t = ac.currentTime;
    const now = performance.now() / 1000;
    // 파도: 7~9초마다 밀려왔다 빠진다
    const swell = 0.55 + 0.45 * Math.pow(Math.sin(now * 0.75), 2) * (0.7 + 0.3 * Math.sin(now * 0.19));
    set(seaLow.g.gain, 0.5 * i.sea * swell, 0.4);
    set(seaHi.g.gain, 0.12 * i.sea * Math.pow(swell, 3), 0.3);
    seaLow.f.frequency.setTargetAtTime(300 + 400 * swell, t, 0.5);
    // 바람: 높은 곳·능선·폭풍 지대에서 세다
    const high = Math.max(0, Math.min(1, (i.height - 6) / 20));
    const windy = i.zone === 'snow' ? 0.85 : i.zone === 'storm' ? 0.95 : i.region === 'ember_ridge' ? 0.5 : 0.18;
    const gust = 0.7 + 0.3 * Math.sin(now * 0.31) * Math.sin(now * 0.13 + 2);
    set(wind.g.gain, Math.min(0.55, (windy + high * 0.4) * 0.32 * gust), 1);
    wind.f.frequency.setTargetAtTime(450 + 500 * gust + (i.zone === 'storm' ? 400 : 0), t, 1.2);
    // 풀벌레: 밤의 뭍, 능선 눈밭·심장에선 없다
    const bugs = i.night * i.land * (i.zone === 'snow' || i.region === 'mist_heart' ? 0 : 1);
    if (now > nextChirpGate) {
      // 울다 쉬다
      nextChirpGate = now + 0.6 + Math.random() * 1.6;
      set(crG.gain, bugs * (Math.random() < 0.7 ? 0.018 : 0.004), 0.08);
      cr.frequency.setTargetAtTime(4100 + Math.random() * 500, t, 0.05);
    }
    // 심장의 웅웅거림
    set(hum.gain, i.region === 'mist_heart' ? (i.zone === 'core' ? 0.07 : 0.035) : 0, 2);
    // 새: 낮의 뭍(눈밭·폭풍 빼고), 숲이면 더 자주
    const birds = (1 - i.night) * i.land * (i.zone === 'snow' || i.zone === 'storm' || i.zone === 'ash' ? 0.15 : 1);
    if (birds > 0.05 && now > nextBird) {
      nextBird = now + (i.zone === 'oakwood' ? 1.5 : 3.5) + Math.random() * 5 / birds;
      bird(t + 0.05, (Math.random() - 0.5) * 1.6);
    }
    // 개구리: 늪의 밤
    const frogs = i.night * (i.region === 'swamp_shore' ? 1 : 0) * (i.zone === 'swamp' ? 1 : 0.4);
    if (frogs > 0.05 && now > nextFrog) {
      nextFrog = now + (0.6 + Math.random() * 2.4) / frogs;
      frog(t + 0.05, (Math.random() - 0.5) * 1.6);
    }
    // 불티: 모닥불·화덕 곁
    if (i.fire > 0.05 && now > nextCrackle) {
      nextCrackle = now + 0.05 + Math.random() * 0.35;
      burst(ac, out, { kind: 'white', filter: 'highpass', freq: 1800 + Math.random() * 3000, at: t + 0.02, a: 0.001, d: 0.01 + Math.random() * 0.03, peak: 0.12 * i.fire });
      if (Math.random() < 0.2) burst(ac, out, { kind: 'brown', filter: 'lowpass', freq: 300, at: t + 0.02, a: 0.05, d: 0.3, peak: 0.12 * i.fire });
    }
  }
  return { update };
}
