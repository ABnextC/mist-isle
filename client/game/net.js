// 멀티 손님(v3.0): 서버에 붙어 같은 섬을 나란히 돌린다(결정적 록스텝, core/net.js).
// 브라우저와 Node(시험) 모두 WebSocket 전역을 쓴다.
// 명령은 먼저 내 쪽에서 검사(check)만 하고 서버로 보낸다. 실제 적용은 서버가 정한 틱에 모두가 같이 한다.

import { loadGame } from '../../core/game.js';
import { stepWith, NET_VERSION } from '../../core/net.js';

export function wsUrl(param, loc = globalThis.location) {
  if (!param || param === 'auto' || param === '1') return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
  if (/^wss?:\/\//.test(param)) return param;
  return `ws://${param}/ws`;
}

export function connectNet({ url, name, id = null, data, onChat = () => {}, onStatus = () => {}, onPlayers = () => {} }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const net = {
      pid: null, game: null, ws, ticks: [], hashes: new Map(), lastTickAt: 0, hz: data.config.time.hz,
      desyncs: 0, resyncing: false, rtt: 0, players: new Map(), closed: false,
      send(cmd) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'cmd', cmd }));
      },
      chat(text) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'chat', text }));
      },
      close() {
        net.closed = true;
        ws.close();
      },
      // 쌓인 틱을 적용한다. 돌려준 값은 이번에 나아간 틱 수
      pump(now = performance.now()) {
        const g = net.game;
        if (!g || net.resyncing) return 0;
        let n = 0;
        while (net.ticks.length) {
          const m = net.ticks[0];
          if (m.tick < g.state.tick) {
            net.ticks.shift();
            continue;
          }
          if (m.tick > g.state.tick) {
            resync('gap');
            return n;
          }
          net.ticks.shift();
          stepWith(g, m.ops);
          n++;
          net.lastTickAt = now;
          const want = net.hashes.get(g.state.tick);
          if (want != null) {
            net.hashes.delete(g.state.tick);
            if (g.hash() !== want) {
              net.desyncs++;
              resync('hash');
              return n;
            }
          }
        }
        return n;
      },
      // 다음 틱까지의 몫(화면 보간용)
      alpha(now = performance.now()) {
        return Math.max(0, Math.min(1, (now - net.lastTickAt) / (1000 / net.hz)));
      },
    };
    function resync(why) {
      if (net.resyncing) return;
      net.resyncing = true;
      onStatus({ kind: 'resync', why });
      ws.send(JSON.stringify({ t: 'resync' }));
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: NET_VERSION, name, id }));
      onStatus({ kind: 'open' });
    };
    ws.onerror = () => {
      if (!net.game) reject(new Error('서버에 붙지 못했다'));
    };
    ws.onclose = () => {
      onStatus({ kind: 'closed' });
      if (!net.game) reject(new Error('서버가 연결을 닫았다'));
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (m.t === 'welcome') {
        // 데이터 판이 다르면 같은 섬을 돌릴 수 없다
        if (m.dataVersion !== data.config.dataVersion) {
          ws.close();
          reject(new Error(`서버 데이터 판(${m.dataVersion})과 내 판(${data.config.dataVersion})이 다르다 — 새로 고침하자`));
          return;
        }
        net.pid = m.pid;
        net.game = loadGame({ data, save: m.save });
        net.lastTickAt = performance.now();
        for (const p of m.players || []) net.players.set(p.pid, p.name);
        net.players.set(m.pid, name);
        onPlayers(net.players);
        // 내 개척자는 다음 틱(join)에 선다. 그 틱을 받을 때까지 기다린다
      } else if (m.t === 'tick') {
        net.ticks.push(m);
        if (!net.ready && net.game) {
          net.pump();
          if (net.game.state.actors[net.pid]) {
            net.ready = true;
            resolve(net);
          }
        }
        for (const op of m.ops) {
          if (op.op === 'join') net.players.set(op.id, op.name);
          if (op.op === 'leave') net.players.delete(op.id);
          if (op.op === 'join' || op.op === 'leave') onPlayers(net.players);
        }
      } else if (m.t === 'hash') {
        net.hashes.set(m.tick, m.h);
        if (net.hashes.size > 20) net.hashes.delete(net.hashes.keys().next().value);
      } else if (m.t === 'snapshot') {
        if (net.game) net.game.adopt(m.save);
        net.ticks = net.ticks.filter((x) => x.tick >= m.tick);
        net.hashes.clear();
        net.resyncing = false;
        net.lastTickAt = performance.now();
        onStatus({ kind: 'resynced' });
      } else if (m.t === 'chat') {
        onChat(m);
      } else if (m.t === 'pong') {
        net.rtt = performance.now() - m.at;
      } else if (m.t === 'error') {
        onStatus({ kind: 'error', error: m.error });
        if (!net.game) reject(new Error(m.error));
      }
    };
  });
}

// 화면 코드가 그대로 쓰도록 game을 감싼다: dispatch는 검사 후 서버로, advance는 틱 펌프로
export function netGame(net) {
  const g = net.game;
  const local = g.dispatch;
  g.dispatchLocal = local;
  g.dispatch = (cmd) => {
    const r = g.check(cmd);
    if (r.ok) net.send(cmd);
    else local(cmd); // 거절 이벤트(cmd.rejected)는 내 화면에만 — 상태는 바뀌지 않는다
    return r;
  };
  g.advance = () => net.pump();
  Object.defineProperty(g, 'alpha', { get: () => net.alpha(), configurable: true });
  g.net = net;
  return g;
}
