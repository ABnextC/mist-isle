// 캐릭터 모양을 메인 스레드 밖에서 만든다(v0.4.3). 결과 배열은 복사 없이 넘긴다.
import { buildBase } from './actor-shape.js';

const b = buildBase();
const bufs = [];
for (const m of [b.body, b.head, b.hair, b.pack]) bufs.push(m.positions.buffer, m.normals.buffer, m.indices.buffer);
bufs.push(b.face.positions.buffer, b.face.uvs.buffer, b.face.indices.buffer);
bufs.push(b.bl.buffer, b.bl2.buffer, b.blend.buffer, b.skinIdx.buffer, b.skinW.buffer, b.hl.buffer, b.hrl.buffer, b.pl.buffer);
self.postMessage(b, bufs);
