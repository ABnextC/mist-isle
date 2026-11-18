// 이벤트 버스 + 텔레메트리.
// 텔레메트리는 상태(state) 밖에 둔다. 저장 데이터와 재현성에 끼어들지 않는다.

export function makeBus(logSize = 400) {
  const subs = new Map();
  const tele = { counts: {}, log: [] };

  function on(type, fn) {
    if (!subs.has(type)) subs.set(type, new Set());
    subs.get(type).add(fn);
    return () => subs.get(type).delete(fn);
  }

  function emit(ev) {
    tele.counts[ev.type] = (tele.counts[ev.type] || 0) + 1;
    tele.log.push(ev);
    if (tele.log.length > logSize) tele.log.shift();
    const a = subs.get(ev.type);
    if (a) for (const fn of a) fn(ev);
    const all = subs.get('*');
    if (all) for (const fn of all) fn(ev);
  }

  return { on, emit, tele };
}
