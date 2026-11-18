// 가방·창고 다루기.
// 재료 묶음: { item, lot, bonus, qty } — 산지(lot)와 정제 단계(bonus)가 같으면 쌓인다.
// 장비: { uid, item, stats, ... } — 한 개씩 따로 있다.
// 만든 소모품: { item, lot: null, bonus: null, stats, star, qty } — 수치가 같아야 쌓인다.

export function bonusKey(bonus) {
  if (!bonus) return '';
  return Object.keys(bonus).sort().map((p) => p + bonus[p]).join(',');
}

export function keyOf(e) {
  if (e.uid) return e.uid;
  let k = e.item + '|' + (e.lot || '') + '|' + bonusKey(e.bonus);
  if (e.stats) k += '|' + Object.keys(e.stats).sort().map((s) => s + '=' + e.stats[s]).join(',');
  return k;
}

export const qtyOf = (e) => (e.uid ? 1 : e.qty);

export function findEntry(list, key) {
  for (const e of list) if (keyOf(e) === key) return e;
  return null;
}

// 넣을 때 새로 필요한 칸 수
export function slotsNeeded(list, entries) {
  const keys = new Set(list.map(keyOf));
  let n = 0;
  for (const e of entries) {
    const k = keyOf(e);
    if (e.uid || !keys.has(k)) {
      n++;
      keys.add(k);
    }
  }
  return n;
}

// 칸 검사는 부르는 쪽이 먼저 한다.
export function addEntry(list, entry) {
  if (!entry.uid) {
    const ex = findEntry(list, keyOf(entry));
    if (ex) {
      ex.qty += entry.qty;
      return ex;
    }
  }
  list.push(entry);
  return entry;
}

// 수량을 덜어 낸 사본을 돌려준다. 검증이 끝난 뒤에만 부른다.
export function takeQty(list, key, qty) {
  const i = list.findIndex((e) => keyOf(e) === key);
  if (i < 0) throw new Error('없는 묶음: ' + key);
  const e = list[i];
  if (e.uid) {
    list.splice(i, 1);
    return e;
  }
  if (e.qty < qty) throw new Error('수량 부족: ' + key);
  e.qty -= qty;
  if (e.qty === 0) list.splice(i, 1);
  return { ...e, qty };
}

export function effectiveProps(entry, lots) {
  const lot = entry.lot ? lots[entry.lot] : null;
  const out = lot ? { ...lot.props } : {};
  if (entry.bonus) for (const [p, v] of Object.entries(entry.bonus)) out[p] = Math.min(100, (out[p] ?? 0) + v);
  return out;
}

export function avgProps(props) {
  const v = Object.values(props);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export function countItem(lists, itemId) {
  let n = 0;
  for (const list of lists) for (const e of list) if (e.item === itemId) n += qtyOf(e);
  return n;
}
