// 등급(v3.3): 별 개수 대신 색으로 보인다. star 1~5 → 일반·고급·희귀·영웅·전설
// 이름난 물건(named)은 데이터의 grade(1~5)가 정해져 있다. 재료 묶음은 속성 평균의 별을 그대로 쓴다.
export const FALLBACK = [
  { id: 'common', name: '일반', color: '#c9c6bc' },
  { id: 'uncommon', name: '고급', color: '#5fd36b' },
  { id: 'rare', name: '희귀', color: '#4aa8ff' },
  { id: 'epic', name: '영웅', color: '#b876ff' },
  { id: 'legendary', name: '전설', color: '#ff9b3d' },
];
export const gradesOf = (data) => data?.config?.grades || FALLBACK;

// star(1~5) → 등급 하나
export function grade(data, star) {
  const G = gradesOf(data);
  const i = Math.max(1, Math.min(G.length, Math.round(star || 1))) - 1;
  return { ...G[i], n: i + 1 };
}

// 가방 칸 하나의 등급: 이름난 물건은 정해진 등급, 아니면 star
export function gradeOfEntry(data, e) {
  const def = data.items[e?.item];
  return grade(data, def?.grade ?? e?.star ?? 1);
}

// "★2 이상" 같은 조건 글
export const gradeAtLeast = (data, star) => `${grade(data, star).name} 이상`;
