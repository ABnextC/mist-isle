// 작은 WebSocket(RFC 6455) 구현(v3.0): 바깥 패키지 없이 Node 기본 모듈만 쓴다.
// 글자 프레임·닫기·핑퐁만 다룬다(조각난 메시지는 이어 붙인다). 서버 → 손님 프레임은 가리지 않는다.

import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

// 프레임 하나를 만든다(opcode 1 글자, 8 닫기, 9 핑, 10 퐁)
export function frame(payload, opcode = 1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const n = body.length;
  let head;
  if (n < 126) {
    head = Buffer.alloc(2);
    head[1] = n;
  } else if (n < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, body]);
}

// 받은 바이트에서 온전한 프레임들을 꺼낸다. 남은 바이트는 rest로 돌려준다
export function parseFrames(buf) {
  const out = [];
  let i = 0;
  while (buf.length - i >= 2) {
    const b0 = buf[i];
    const b1 = buf[i + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = i + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length - p < maskLen + len) break;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    p += maskLen;
    const data = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let k = 0; k < data.length; k++) data[k] ^= mask[k & 3];
    out.push({ fin, opcode, data });
    i = p + len;
  }
  return { frames: out, rest: buf.subarray(i) };
}

// http 서버의 upgrade를 받아 연결 하나를 만든다: { send(text), close(), onMessage, onClose }
export function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(key)}`, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  const conn = {
    open: true,
    onMessage: () => {},
    onClose: () => {},
    send(text) {
      if (conn.open) socket.write(frame(text, 1));
    },
    close(code = 1000) {
      if (!conn.open) return;
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code, 0);
      socket.write(frame(b, 8));
      socket.end();
      finish();
    },
  };
  let rest = Buffer.alloc(0);
  let parts = [];
  const finish = () => {
    if (!conn.open) return;
    conn.open = false;
    conn.onClose();
  };
  socket.on('data', (chunk) => {
    const r = parseFrames(Buffer.concat([rest, chunk]));
    rest = Buffer.from(r.rest);
    for (const f of r.frames) {
      if (f.opcode === 8) {
        conn.close();
        return;
      }
      if (f.opcode === 9) {
        socket.write(frame(f.data, 10));
        continue;
      }
      if (f.opcode === 10) continue;
      if (f.opcode === 1 || f.opcode === 0) {
        parts.push(f.data);
        if (f.fin) {
          const text = Buffer.concat(parts).toString('utf8');
          parts = [];
          try { conn.onMessage(text); } catch (e) { console.error('메시지 처리 오류', e); }
        }
      }
    }
  });
  socket.on('close', finish);
  socket.on('error', finish);
  return conn;
}
