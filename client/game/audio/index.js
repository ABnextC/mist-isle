// 소리(v2.5): 효과음·환경음·배경 음악을 묶는다.
// 브라우저는 사람이 한 번 누르기 전엔 소리를 막으니, 첫 입력에서 깨운다. 창이 가려지면 쉰다.
// 볼륨은 전체·효과음·환경음·음악 넷이고 localStorage('mist-isle:audio')에 남는다.

import { voiceOut, makeReverb, noiseBuffers } from './synth.js';
import { SFX } from './sfx.js';
import { createMusic } from './music.js';
import { createAmbience } from './ambience.js';
import { moodFor } from './score.js';

export const LEVELS = [0, 0.35, 0.7, 1];
const KEY = 'mist-isle:audio';
const DEFAULTS = { master: 0.7, sfx: 0.7, amb: 0.7, music: 0.7 };
const HUMANOID = /^(raider|marine|surveyor)/;
const SPIRIT = /(wraith|keeper|warden)/;

export function loadAudioSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function createAudio(game, { pid, heightAt, regionOf, zoneOf, townOf, camera, cam }) {
  const settings = loadAudioSettings();
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return { settings, set() {}, update() {}, onStrike() {}, play() {}, get state() { return 'none'; } };
  const ac = new Ctx({ latencyHint: 'interactive' });
  noiseBuffers(ac);

  // 버스: 효과음·환경음·음악 → 전체 → 압축기 → 스피커. 잔향은 효과음·음악이 조금씩 보낸다
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ac.destination);
  const master = ac.createGain();
  master.connect(comp);
  const bus = {};
  for (const k of ['sfx', 'amb', 'music']) {
    bus[k] = ac.createGain();
    bus[k].connect(master);
  }
  const verb = makeReverb(ac, 2.8, 2.6);
  const verbG = ac.createGain();
  verbG.gain.value = 0.5;
  verb.connect(verbG).connect(master);
  const musicIn = ac.createGain();
  musicIn.gain.value = 0.65; // 음악은 효과음보다 한발 뒤에
  musicIn.connect(bus.music);
  const musicSend = ac.createGain();
  musicIn.connect(musicSend).connect(verb);
  // 효과음 잔향은 따로 받아 효과음 볼륨을 따르게 한다
  const sfxVerb = ac.createGain();
  sfxVerb.connect(verb);
  function applyVolumes() {
    const t = ac.currentTime;
    master.gain.setTargetAtTime(settings.master, t, 0.05);
    for (const k of ['sfx', 'amb', 'music']) bus[k].gain.setTargetAtTime(settings[k], t, 0.05);
    musicSend.gain.setTargetAtTime(0.55 * settings.music, t, 0.05);
    sfxVerb.gain.setTargetAtTime(settings.sfx, t, 0.05);
  }
  applyVolumes();

  const music = createMusic(ac, musicIn, { seed: (Date.now() & 0xffff) + 7 });
  const amb = createAmbience(ac, bus.amb);

  // 깨우기·쉬기
  const wake = () => { if (ac.state === 'suspended' && !document.hidden) ac.resume().catch(() => {}); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ac.suspend().catch(() => {});
    else wake();
  });
  // 단추 누르는 소리
  document.addEventListener('pointerdown', (e) => {
    if (e.target?.closest?.('button, .tile, [data-act]')) play('ui', null, { gain: 0.6 });
  }, true);

  // 듣는 자리: 카메라 위치와 방향
  function spatial(x, z) {
    if (x == null) return { gain: 1, pan: 0 };
    const cx = camera.position.x;
    const cz = camera.position.z;
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d > 40) return null;
    const yaw = cam.st.yaw;
    const rx = -Math.cos(yaw);
    const rz = Math.sin(yaw);
    const pan = d > 0.5 ? ((dx * rx + dz * rz) / d) * 0.75 : 0;
    return { gain: 1 / (1 + Math.pow(Math.max(0, d - 4) / 9, 2)), pan };
  }

  const last = {};
  function play(name, pos, o = {}) {
    const r = SFX[name];
    if (!r || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (last[name] && now - last[name] < 0.04) return;
    last[name] = now;
    const sp = pos ? spatial(pos.x, pos.z) : { gain: 1, pan: 0 };
    if (!sp || sp.gain < 0.03) return;
    const out = voiceOut(ac, bus.sfx, { gain: sp.gain * (o.gain ?? 1), pan: sp.pan, life: r.life, send: sfxVerb, sendGain: o.wet ?? 0.18 });
    r.play(ac, out, o);
  }

  const me = () => game.state.actors[pid];
  const posOf = (id) => {
    const a = game.state.actors[id];
    if (a) return a;
    return game.state.mobs[id] || null;
  };
  const mine = (ev) => ev.actor === pid;
  const near = (p) => p && me() && Math.hypot(p.x - me().x, p.z - me().z) < 40;
  const sizeOf = (sp) => game.data.creatures[sp]?.size ?? 1;
  const growlAt = {};

  const on = (type, fn) => game.on(type, (ev) => { try { fn(ev); } catch { /* 소리 탓에 게임이 멈추면 안 된다 */ } });
  on('combat.swing', (ev) => { const p = posOf(ev.actor); if (near(p)) play('swing', p, { heavy: ev.kind === 'heavy', gain: mine(ev) ? 1 : 0.6 }); });
  on('combat.hit', (ev) => { const p = posOf(ev.mob); if (near(p)) play('hit', p, { heavy: ev.heavy, crit: ev.crit, gain: ev.dot ? 0.35 : 1 }); });
  on('combat.hurt', (ev) => { const p = posOf(ev.actor); if (near(p)) play(ev.blocked ? 'block' : 'hurt', p, { gain: mine(ev) ? 1 : 0.5 }); });
  on('combat.guardbreak', (ev) => { const p = posOf(ev.actor); if (near(p)) play('guardbreak', p); });
  on('combat.dodge', (ev) => { if (mine(ev)) play('dodge', me()); });
  on('combat.ability', (ev) => { const p = posOf(ev.actor); if (near(p)) play('ability', p); });
  on('arrow.fire', (ev) => { const p = posOf(ev.actor); if (near(p)) play(ev.proj === 'arrow' || !ev.proj ? 'bow' : 'cast', p, { gain: mine(ev) ? 1 : 0.6 }); });
  on('arrow.hit', (ev) => play('arrow_hit', ev));
  on('arrow.explode', (ev) => play('boom', ev, { wet: 0.35 }));
  on('mob.aggro', (ev) => {
    const m = game.state.mobs[ev.mob];
    if (!near(m) || HUMANOID.test(ev.species)) return;
    if ((growlAt[ev.mob] || 0) > ac.currentTime - 6) return;
    growlAt[ev.mob] = ac.currentTime;
    if (SPIRIT.test(ev.species)) play('cast', m, { gain: 0.6 });
    else play('growl', m, { size: sizeOf(ev.species) });
  });
  on('mob.windup', (ev) => {
    const m = game.state.mobs[ev.mob];
    if (ev.heavy && near(m) && !HUMANOID.test(ev.species) && !SPIRIT.test(ev.species)) play('growl', m, { size: sizeOf(ev.species) * 1.2, gain: 0.8 });
  });
  on('mob.die', (ev) => play('die', ev, { size: sizeOf(ev.species) }));
  on('gather.done', (ev) => { if (mine(ev)) play('pop', null, { gain: 0.7 }); });
  on('craft.done', (ev) => { if (mine(ev)) play('craft', null); });
  on('quest.done', (ev) => { if (mine(ev)) play('quest', null); });
  on('quest.start', (ev) => { if (mine(ev)) play('queststart', null, { gain: 0.8 }); });
  on('quest.fail', (ev) => { if (mine(ev)) play('fail', null); });
  on('level.up', (ev) => { if (mine(ev)) play('levelup', null); });
  on('skill.up', (ev) => { if (mine(ev)) play('skillup', null); });
  on('mastery.level', (ev) => { if (mine(ev)) play('skillup', null); });
  on('blueprint.learn', (ev) => { if (mine(ev)) play('skillup', null); });
  on('market.trade', (ev) => { if (ev.buyer === pid || ev.seller === pid) play('coin', null, { gain: 0.7 }); });
  on('market.sell', (ev) => { if (mine(ev)) play('coin', null); });
  on('market.buy', (ev) => { if (mine(ev)) play('coin', null); });
  on('eat', (ev) => { if (mine(ev)) play('eat', null); });
  on('potion', (ev) => { if (mine(ev)) play('drink', null); });
  on('equip', (ev) => { if (mine(ev)) play('equip', null, { gain: 0.8 }); });
  on('recall.done', (ev) => { if (mine(ev)) play('recall', null); });
  // 길잡이 돌·탈것(v3.2)
  on('travel.started', (ev) => { if (mine(ev)) play('waystone', null); });
  on('travel.done', (ev) => { if (mine(ev)) play('recall', null); });
  on('way.found', (ev) => { if (mine(ev)) play('bell', null, { gain: 0.6 }); });
  on('mount.summon', (ev) => { if (mine(ev)) play('whistle', null); });
  on('mount.on', (ev) => { if (mine(ev)) play('neigh', null, { gain: 0.8 }); });
  on('tool.broken', (ev) => { if (mine(ev)) play('block', null, { gain: 0.6 }); });
  on('exp.clear', (ev) => { if (mine(ev)) play('quest', null); });
  on('exp.fail', (ev) => { if (mine(ev)) play('fail', null); });
  on('actor.down', (ev) => { if (mine(ev)) play('down', null); });
  on('day.start', () => play('bell', null, { gain: 0.5, wet: 0.5 }));
  on('pvp.flag', (ev) => { if (mine(ev)) play(ev.on ? 'guardbreak' : 'equip', null, { gain: 0.5 }); });
  on('rival.fall', (ev) => { if (ev.by === pid) play('quest', null, { gain: 0.8 }); });
  on('war.siege', () => play('guardbreak', null, { gain: 0.6, wet: 0.5 }));
  on('war.end', () => play('quest', null));

  // 도구가 닿은 순간(actorsView 타격) → 재질 소리
  const STRIKE = { chop: 'chop', chop_tree: 'chop', mine: 'mine', harvest: 'rustle', pick_bush: 'rustle', pick_ground: 'rustle', skin: 'skin' };
  function onStrike(s) {
    let name = STRIKE[s.kind];
    if (s.nodeType && game.data.nodes[s.nodeType]?.skill === 'fishing') name = 'splash';
    if (name) play(name, s, { gain: s.actor === pid ? 1 : 0.55 });
  }

  // 발소리
  let stepAcc = 0;
  let lastX = null;
  let lastZ = 0;
  function steps(a) {
    if (lastX == null) { lastX = a.x; lastZ = a.z; return; }
    const d = Math.hypot(a.x - lastX, a.z - lastZ);
    lastX = a.x;
    lastZ = a.z;
    if (d > 3 || a.cb?.dodge) { stepAcc = 0; return; }
    stepAcc += d;
    const stride = a.riding ? 0.9 : 0.72; // 탈것(v3.2): 말굽은 더 자주, 더 무겁게
    if (stepAcc < stride) return;
    stepAcc -= stride;
    const h = heightAt(a.x, a.z);
    const zone = zoneOf(a)?.id;
    const surface = h < 0.02 ? 'water' : h < 1.4 && seaNear > 0.15 ? 'sand' : zone === 'snow' ? 'snow' : townOf(a) ? 'stone' : 'ground';
    play(a.riding ? 'hoof' : 'step', null, { surface, gain: a.riding ? 0.7 : 0.55 });
  }

  // 바다가 얼마나 가까운가: 둘레 높이를 재어 물 아래 칸의 몫
  let seaNear = 0;
  let seaAt = 0;
  function measureSea(a) {
    let wet = 0;
    let all = 0;
    for (const r of [5, 12, 22]) {
      for (let k = 0; k < 10; k++) {
        const th = (k / 10) * Math.PI * 2;
        const w = 1 / r;
        all += w;
        if (heightAt(a.x + Math.sin(th) * r, a.z + Math.cos(th) * r) < -0.15) wet += w;
      }
    }
    return Math.min(1, (wet / all) * 2.2);
  }

  // info: { night 0..1, fire 0..1, boss bool }
  function update(dt, info = {}) {
    const a = me();
    if (!a || ac.state !== 'running') return;
    const now = performance.now();
    if (now - seaAt > 400) {
      seaAt = now;
      seaNear = seaNear * 0.5 + measureSea(a) * 0.5;
    }
    steps(a);
    const region = regionOf(a)?.id;
    const zone = zoneOf(a)?.id;
    const h = heightAt(a.x, a.z);
    amb.update({ sea: seaNear, night: info.night ?? 0, region, zone, height: h, fire: info.fire ?? 0, land: h > 0.2 ? 1 : 0.3 });
    // 싸움: 나를 노리는 짐승이 가까이 있으면
    let fight = false;
    for (const m of Object.values(game.state.mobs)) {
      if (m.target !== pid || m.hp <= 0 || m.mode === 'away' || m.mode === 'dead') continue;
      if (Math.hypot(m.x - a.x, m.z - a.z) < 30) { fight = true; break; }
    }
    if (!fight) fight = Object.values(game.state.actors).some((r) => r.rival?.target === pid); // 다른 세력 개척자(v2.6)
    music.setMood(moodFor({ region, night: (info.night ?? 0) > 0.5, combat: fight || !!info.siege, boss: !!info.boss || !!info.siege, town: !!townOf(a) }));
    music.update();
  }

  function set(k, v) {
    settings[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 저장 못 해도 소리는 바뀐다 */ }
    applyVolumes();
  }

  return { settings, set, update, onStrike, play, get state() { return ac.state; }, get mood() { return music.mood; }, ac };
}
