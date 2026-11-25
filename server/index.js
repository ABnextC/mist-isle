// 안개섬 개척기 멀티 시험 서버(v3.0): 2~8인이 한 섬에서 논다.
// 실행: node server/index.js [--port 8787] [--seed 7] [--world server/world.json]
// 같은 주소로 게임 화면도 내준다: http://localhost:8787/?server=auto&name=이름
//
// 서버가 권위다. 손님은 명령만 보내고, 서버는 틱(30Hz)마다 그 틱에 받은 것을 묶어 모두에게 보낸다.
// 손님은 처음 들어올 때 상태 통째(세이브)를 받고, 그 뒤로는 틱 묶음을 같은 순서로 적용해 같은 섬을 돌린다.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../tools/load-data.js';
import { createGame, loadGame } from '../core/game.js';
import { stepWith, sanitizeCmd, MAX_PLAYERS, HASH_EVERY, NET_VERSION } from '../core/net.js';
import { upgrade } from './ws.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};

export async function startServer({ port = 8787, seed = 7, world = null, quiet = false, saveEvery = 60 } = {}) {
  const data = await loadData();
  const HZ = data.config.time.hz;
  let game;
  if (world && existsSync(world)) {
    game = loadGame({ data, save: readFileSync(world, 'utf8') });
    if (!quiet) console.log(`섬을 이어서 연다: ${world} (틱 ${game.state.tick})`);
  } else {
    game = createGame({ data, seed, actors: [] });
    if (!quiet) console.log(`새 섬을 연다(씨앗 ${seed})`);
  }
  // 아무도 없을 때 나간 사람들은 멈춰 있다
  for (const a of Object.values(game.state.actors)) if (a.kind === 'player') a.offline = true;

  const clients = new Map(); // conn → { pid, name, ready }
  let queue = [];
  const say = (...m) => { if (!quiet) console.log(...m); };
  const broadcast = (msg) => {
    const s = JSON.stringify(msg);
    for (const [conn, c] of clients) if (c.ready) conn.send(s);
  };

  function freeId(want) {
    const taken = new Set([...clients.values()].map((c) => c.pid));
    if (want && /^p[0-9]{1,3}$/.test(want) && !taken.has(want)) return want;
    for (let i = 1; i < 1000; i++) {
      const id = `p${i}`;
      if (!taken.has(id) && !game.state.actors[id]) return id;
    }
    return null;
  }

  function onHello(conn, c, msg) {
    if (c.pid) return;
    if (msg.v !== NET_VERSION) return conn.send(JSON.stringify({ t: 'error', error: 'version', want: NET_VERSION }));
    if ([...clients.values()].filter((x) => x.pid).length >= MAX_PLAYERS) return conn.send(JSON.stringify({ t: 'error', error: 'full' }));
    const pid = freeId(msg.id);
    if (!pid) return conn.send(JSON.stringify({ t: 'error', error: 'full' }));
    c.pid = pid;
    c.name = String(msg.name || pid).slice(0, 12);
    queue.push({ op: 'join', id: pid, name: c.name });
    // 다음 틱 경계에서 들어온다. 세이브는 지금(틱 사이) 상태 그대로
    conn.send(JSON.stringify({ t: 'welcome', pid, dataVersion: data.config.dataVersion, tick: game.state.tick, save: game.save(), hz: HZ, players: [...clients.values()].filter((x) => x.pid).map((x) => ({ pid: x.pid, name: x.name })) }));
    c.ready = true;
    say(`들어옴 ${pid} ${c.name} (${clients.size}명 연결)`);
  }

  function onMessage(conn, text) {
    const c = clients.get(conn);
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return onHello(conn, c, msg);
    if (!c.pid) return;
    if (msg.t === 'cmd') {
      const cmd = sanitizeCmd(msg.cmd, c.pid);
      if (cmd) queue.push({ op: 'cmd', cmd });
    } else if (msg.t === 'resync') {
      conn.send(JSON.stringify({ t: 'snapshot', tick: game.state.tick, save: game.save() }));
    } else if (msg.t === 'chat') {
      const text2 = String(msg.text || '').slice(0, 140).trim();
      if (text2) broadcast({ t: 'chat', from: c.pid, name: c.name, text: text2 });
    } else if (msg.t === 'ping') {
      conn.send(JSON.stringify({ t: 'pong', at: msg.at }));
    }
  }

  // 정적 파일(게임 화면)
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary' };
  const http = createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT) || file.includes(`${ROOT}/server`) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end('없다');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  });
  http.on('upgrade', (req, socket) => {
    if ((req.url || '').split('?')[0] !== '/ws') return socket.destroy();
    const conn = upgrade(req, socket);
    if (!conn) return;
    const c = { pid: null, name: '', ready: false };
    clients.set(conn, c);
    conn.onMessage = (text) => onMessage(conn, text);
    conn.onClose = () => {
      clients.delete(conn);
      if (c.pid) {
        queue.push({ op: 'leave', id: c.pid });
        say(`나감 ${c.pid} ${c.name}`);
      }
    };
  });

  // 틱: 실시간을 따라가되, 늦으면 한 번에 몇 틱까지 몰아서
  const ms = 1000 / HZ;
  let last = performance.now();
  let acc = 0;
  let saveAt = Date.now() + saveEvery * 1000;
  function save() {
    if (!world) return;
    const tmp = `${world}.tmp`;
    writeFileSync(tmp, game.save());
    renameSync(tmp, world);
  }
  const timer = setInterval(() => {
    const now = performance.now();
    acc += now - last;
    last = now;
    let n = 0;
    while (acc >= ms && n < 8) {
      acc -= ms;
      n++;
      const ops = queue;
      queue = [];
      const tick = game.state.tick;
      stepWith(game, ops);
      broadcast({ t: 'tick', tick, ops });
      if (game.state.tick % HASH_EVERY === 0) broadcast({ t: 'hash', tick: game.state.tick, h: game.hash() });
    }
    if (acc > ms * 8) acc = 0; // 너무 밀리면 버린다
    if (Date.now() > saveAt) {
      saveAt = Date.now() + saveEvery * 1000;
      save();
    }
  }, Math.max(4, ms / 2));

  await new Promise((r) => http.listen(port, r));
  const addr = http.address();
  say(`안개섬 서버 http://localhost:${addr.port}/?server=auto  (최대 ${MAX_PLAYERS}명)`);
  return {
    port: addr.port,
    game,
    clients,
    save,
    async close() {
      clearInterval(timer);
      for (const conn of clients.keys()) conn.close(1001);
      save();
      await new Promise((r) => http.close(r));
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const srv = await startServer({ port: Number(arg('port', 8787)), seed: Number(arg('seed', 7)), world: arg('world', join(ROOT, 'server', 'world.json')) });
  const bye = async () => {
    console.log('\n섬을 저장하고 닫는다');
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
