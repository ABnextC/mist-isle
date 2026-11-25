// 레벨 색(v3.1): 내 레벨과 견준 상대(퀘스트·짐승) 레벨의 어려움. 일반적인 MMO 색을 따른다
//   빨강 +5 이상(위험) · 주황 +3~4(어려움) · 노랑 −2~+2(알맞음) · 초록 −3~−7(쉬움) · 회색 −8 이하(시시함)
export function levelTone(mine, theirs) {
  const d = theirs - mine;
  if (d >= 5) return { cls: 'lv-red', word: '위험' };
  if (d >= 3) return { cls: 'lv-orange', word: '어려움' };
  if (d >= -2) return { cls: 'lv-yellow', word: '알맞음' };
  if (d >= -7) return { cls: 'lv-green', word: '쉬움' };
  return { cls: 'lv-gray', word: '시시함' };
}
export function levelBadge(mine, theirs) {
  if (!theirs) return '';
  const t = levelTone(mine, theirs);
  return `<span class="lvb ${t.cls}" title="${t.word}">Lv ${theirs}</span>`;
}
