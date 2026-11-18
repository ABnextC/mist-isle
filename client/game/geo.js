// 결정적 의사 난수(모양 흩뿌리기용). 같은 키면 같은 값.
export function rand01(key, i = 0) {
  let h = 2166136261 ^ i;
  for (let k = 0; k < key.length; k++) {
    h ^= key.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
