// 캐릭터 그리기와 동작: 걷기(무릎·팔꿈치까지), 숨쉬기, 도끼·곡괭이 내려찍기, 낫질, 귀환 시전.

import * as THREE from 'three';
import { makeActorModel } from './models/actor.js';

const TUNICS = [0x8a4f6e, 0x6e5a2e, 0x2e5a8a, 0x7a3a2a];

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

const damp = (cur, want, k) => cur + (want - cur) * k;

export function createActorsView(scene, game, hf) {
  const views = new Map();
  let botIdx = 0;

  function make(a) {
    const player = a.kind === 'player';
    const model = makeActorModel({
      tunic: player ? 0x2a6e68 : TUNICS[botIdx++ % TUNICS.length],
      trousers: player ? 0x3b3f4a : 0x4a4238,
      seed: player ? 2 : 3 + botIdx,
    });
    scene.add(model.root);
    return { m: model, pos: new THREE.Vector3(a.x, hf.height(a.x, a.z), a.z), yaw: a.yaw || 0, phase: 0, swing: 0, speed: 0, breathe: Math.random() * 6 };
  }

  function pose(v, p) {
    const m = v.m;
    m.legL.th.rotation.x = p.thL;
    m.legR.th.rotation.x = p.thR;
    m.legL.kn.rotation.x = p.knL;
    m.legR.kn.rotation.x = p.knR;
    m.legL.ft.rotation.x = p.ftL;
    m.legR.ft.rotation.x = p.ftR;
    m.armL.sh.rotation.set(p.shLx, 0, p.shLz);
    m.armR.sh.rotation.set(p.shRx, p.shRy || 0, p.shRz);
    m.armL.el.rotation.x = p.elL;
    m.armR.el.rotation.x = p.elR;
    m.spine.rotation.set(p.spX, p.spY, 0);
    m.hips.position.y = 0.96 + p.bob;
    m.neck.rotation.x = p.nk;
  }

  function update(dt, t) {
    const { state, data } = game;
    for (const a of Object.values(state.actors)) {
      let v = views.get(a.id);
      if (!v) {
        v = make(a);
        views.set(a.id, v);
      }
      const px = v.pos.x;
      const pz = v.pos.z;
      const k = 1 - Math.exp(-dt * 16);
      v.pos.x += (a.x - v.pos.x) * k;
      v.pos.z += (a.z - v.pos.z) * k;
      v.pos.y = hf.height(v.pos.x, v.pos.z);
      const sp = Math.hypot(v.pos.x - px, v.pos.z - pz) / Math.max(dt, 1e-3);
      v.speed = damp(v.speed, Math.min(sp, 7), 1 - Math.exp(-dt * 10));
      let yaw = a.yaw || 0;
      const node = a.action?.type === 'gather' ? state.nodes[a.action.node] : null;
      const casting = a.action?.type === 'recall';
      if (node) yaw = Math.atan2(node.x - a.x, node.z - a.z);
      v.yaw = lerpAngle(v.yaw, yaw, 1 - Math.exp(-dt * 12));
      v.m.root.position.copy(v.pos);
      v.m.root.rotation.y = v.yaw;

      const skill = node ? data.nodes[node.type].skill : null;
      for (const [kname, tool] of Object.entries(v.m.tools)) tool.visible = kname === skill;

      const walk = Math.min(1, v.speed / 1.2);
      v.phase += dt * v.speed * (Math.PI * 2 / 1.45);
      v.breathe += dt * 1.7;
      const s = Math.sin(v.phase);
      const c = Math.cos(v.phase);
      const br = Math.sin(v.breathe);
      const p = {
        thL: s * 0.55 * walk, thR: -s * 0.55 * walk,
        knL: Math.max(0, -c) * 0.95 * walk + 0.04, knR: Math.max(0, c) * 0.95 * walk + 0.04,
        ftL: -Math.max(0, s) * 0.3 * walk, ftR: -Math.max(0, -s) * 0.3 * walk,
        shLx: -s * 0.45 * walk, shRx: s * 0.45 * walk, shLz: -0.08, shRz: 0.08,
        elL: -(0.25 + 0.25 * Math.max(0, s)) * walk - 0.12, elR: -(0.25 + 0.25 * Math.max(0, -s)) * walk - 0.12,
        spX: 0.06 * walk + br * 0.012, spY: s * 0.08 * walk, bob: -Math.abs(c) * 0.035 * walk + br * 0.004, nk: -0.04 * walk,
      };
      if (node) {
        // 채집: 도끼·곡괭이는 위에서 내려찍고, 낫은 옆으로 벤다
        v.swing += dt * (skill === 'harvesting' ? 5.5 : 4.2);
        const w = v.swing % (Math.PI * 2);
        const strike = w < 4.4 ? Math.sin((w / 4.4) * Math.PI * 0.5) : 1 - (w - 4.4) / (Math.PI * 2 - 4.4);
        if (skill === 'harvesting') {
          const sw = Math.sin(v.swing);
          Object.assign(p, {
            thL: -0.35, thR: 0.2, knL: 0.75, knR: 0.55, ftL: 0, ftR: 0,
            spX: 0.42, spY: sw * 0.35, bob: -0.14, nk: 0.15,
            shRx: -0.9, shRy: sw * 0.9, shRz: 0.25, elR: -0.5,
            shLx: -0.6, shLz: -0.15, elL: -0.9,
          });
        } else {
          const up = 1 - strike;
          Object.assign(p, {
            thL: -0.25, thR: 0.18, knL: 0.3, knR: 0.25, ftL: 0, ftR: 0,
            spX: 0.1 + strike * 0.38, spY: -0.15, bob: -0.04 - strike * 0.05, nk: 0.1,
            shRx: -2.6 * up - 0.5 * strike, shRz: 0.1, elR: -0.9 * up - 0.15,
            shLx: -2.3 * up - 0.6 * strike, shLz: 0.25, elL: -0.8 * up - 0.2,
          });
        }
      } else if (casting) {
        const f = Math.sin(t * 3) * 0.05;
        Object.assign(p, { shLx: -1.3 + f, shRx: -1.3 - f, shLz: 0.35, shRz: -0.35, elL: -0.6, elR: -0.6, nk: 0.25, spX: 0.05 });
      }
      pose(v, p);
    }
  }

  return {
    update,
    positionOf: (id) => views.get(id)?.pos,
  };
}
