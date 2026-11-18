// 저장·불러오기와 패치 호환(마이그레이션).
// 자동 패치가 잦으니 데이터 구조가 바뀌면 여기에 옮기는 함수를 하나씩 더한다.

export const SAVE_FORMAT = 'mist-isle-save';

// { from: 1, to: 2, run(state, data) { ... } }
const MIGRATIONS = [];

export function serialize(state) {
  return JSON.stringify({ format: SAVE_FORMAT, dataVersion: state.meta.dataVersion, state });
}

export function deserialize(text, data) {
  const obj = JSON.parse(text);
  if (obj.format !== SAVE_FORMAT) throw new Error('세이브 형식이 아님');
  const st = obj.state;
  let v = obj.dataVersion;
  for (const m of MIGRATIONS) {
    if (m.from === v) {
      m.run(st, data);
      v = m.to;
    }
  }
  if (v !== data.config.dataVersion) throw new Error(`옮길 수 없는 세이브 버전: ${v}`);
  st.meta.dataVersion = v;
  return st;
}

// 키 순서와 무관한 문자열 → 해시. 재현성 테스트에 쓴다.
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function hashState(state) {
  const s = stableStringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
