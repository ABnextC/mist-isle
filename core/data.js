// 데이터 정의(JSON)를 색인하고 서로 맞물리는지 검사한다.
// 브라우저는 fetch로, Node는 fs로 읽은 원본을 넘긴다.

export const DATA_FILES = ['config', 'items', 'recipes', 'nodes', 'skills', 'regions', 'stations', 'agents'];

export function buildData(raw) {
  const problems = [];
  const index = (list, what) => {
    const m = {};
    for (const x of list) {
      if (m[x.id]) problems.push(`${what} id 중복: ${x.id}`);
      m[x.id] = x;
    }
    return m;
  };

  const config = raw.config;
  for (const it of raw.items) {
    it.kind = it.kind || 'material';
    if (it.family) {
      const props = config.families[it.family];
      if (!props) problems.push(`알 수 없는 재료군 ${it.family} (${it.id})`);
      it.props = props || [];
    } else {
      it.props = it.props || [];
    }
  }

  const items = index(raw.items, '아이템');
  const skills = index(raw.skills.list, '스킬');
  const stations = index(raw.stations, '작업대');
  const nodes = index(raw.nodes, '노드');
  const recipes = index(raw.recipes, '레시피');
  const regions = index(raw.regions, '지역');

  for (const it of raw.items) {
    if (it.tool && !skills[it.tool.skill]) problems.push(`도구 ${it.id}: 스킬 ${it.tool.skill} 없음`);
    if (it.kind !== 'material' && !it.statConvert) problems.push(`${it.id}: statConvert 없음`);
  }
  for (const n of raw.nodes) {
    if (!skills[n.skill]) problems.push(`노드 ${n.id}: 스킬 ${n.skill} 없음`);
    if (!items[n.item]) problems.push(`노드 ${n.id}: 아이템 ${n.item} 없음`);
    for (const b of n.byproducts || []) if (!items[b.item]) problems.push(`노드 ${n.id}: 부산물 ${b.item} 없음`);
  }
  for (const r of raw.recipes) {
    if (!skills[r.skill]) problems.push(`레시피 ${r.id}: 스킬 ${r.skill} 없음`);
    if (!stations[r.station]) problems.push(`레시피 ${r.id}: 작업대 ${r.station} 없음`);
    const out = items[r.output.item];
    if (!out) problems.push(`레시피 ${r.id}: 결과 ${r.output.item} 없음`);
    if (r.catalyst && !items[r.catalyst]) problems.push(`레시피 ${r.id}: 촉매 ${r.catalyst} 없음`);
    for (const s of r.slots) {
      if (s.item && !items[s.item]) problems.push(`레시피 ${r.id}: 재료 ${s.item} 없음`);
      if (s.family && !config.families[s.family]) problems.push(`레시피 ${r.id}: 재료군 ${s.family} 없음`);
    }
    if (r.type === 'craft' && out) {
      for (const stat of Object.keys(r.stats || {})) {
        if (!out.statConvert?.[stat]) problems.push(`레시피 ${r.id}: ${out.id}에 ${stat} 환산식 없음`);
        for (const ref of Object.keys(r.stats[stat])) {
          const [slot] = ref.split('.');
          if (!r.slots.some((s) => s.key === slot)) problems.push(`레시피 ${r.id}: 슬롯 ${slot} 없음`);
        }
      }
    }
    if (r.type === 'refine' && out && r.slots[0]) {
      const first = r.slots[0].item ? items[r.slots[0].item] : null;
      const fam = first ? first.family : r.slots[0].family;
      if (fam !== out.family) problems.push(`레시피 ${r.id}: 정제 전후 재료군이 다름 (${fam} → ${out.family})`);
    }
  }
  for (const g of raw.regions) {
    for (const v of g.veins) if (!nodes[v.node]) problems.push(`지역 ${g.id}: 노드 ${v.node} 없음`);
    for (const st of g.settlement.stations) if (!stations[st.type]) problems.push(`지역 ${g.id}: 작업대 ${st.type} 없음`);
  }
  // AI 성향: "extends"로 기본형을 물려받는다 (페르소나는 기본형 위에 성향 값만 얹는다)
  const agents = {};
  const resolveAgent = (id, seen = new Set()) => {
    if (agents[id]) return agents[id];
    const prof = raw.agents[id];
    if (!prof) {
      problems.push(`AI 성향 ${id} 없음`);
      return {};
    }
    if (seen.has(id)) {
      problems.push(`AI 성향 순환 참조: ${id}`);
      return {};
    }
    seen.add(id);
    const base = prof.extends ? resolveAgent(prof.extends, seen) : {};
    agents[id] = { ...base, ...prof, id };
    return agents[id];
  };
  for (const id of Object.keys(raw.agents)) resolveAgent(id);
  for (const [id, prof] of Object.entries(agents)) {
    for (const s of prof.skills || []) if (!skills[s]) problems.push(`AI ${id}: 스킬 ${s} 없음`);
    for (const [s, pair] of Object.entries(prof.tools || {})) {
      for (const rc of pair) if (!recipes[rc]) problems.push(`AI ${id}: ${s} 도구 레시피 ${rc} 없음`);
    }
  }
  for (const n of raw.nodes) if (!n.habitat) problems.push(`노드 ${n.id}: habitat(높이 범위) 없음`);

  if (problems.length) throw new Error('데이터 오류\n- ' + problems.join('\n- '));

  return {
    config,
    curve: raw.skills.xpCurve,
    items,
    skills,
    stations,
    nodes,
    recipes,
    regions,
    agents,
    lists: {
      items: raw.items,
      skills: raw.skills.list,
      recipes: raw.recipes,
      nodes: raw.nodes,
      regions: raw.regions,
    },
  };
}
