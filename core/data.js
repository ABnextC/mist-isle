// 데이터 정의(JSON)를 색인하고 서로 맞물리는지 검사한다.
// 브라우저는 fetch로, Node는 fs로 읽은 원본을 넘긴다.

// 퀘스트 단계 종류(v0.5.2에 생활 단계를 더했다)
export const STEP_TYPES = ['talk', 'go', 'kill', 'use', 'defend', 'have', 'eat', 'store', 'repair', 'sell', 'project', 'faction'];
export const DATA_FILES = ['config', 'items', 'recipes', 'nodes', 'skills', 'regions', 'stations', 'agents', 'creatures', 'projects', 'npcs', 'quests', 'unlocks', 'factions', 'housing', 'guilds', 'weapons', 'expeditions', 'rivals', 'territory', 'travel'];

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
  const settlements = {};
  for (const g of raw.regions) {
    for (const v of g.veins) if (!nodes[v.node]) problems.push(`지역 ${g.id}: 노드 ${v.node} 없음`);
    if (!Array.isArray(g.settlements) || !g.settlements.length) problems.push(`지역 ${g.id}: settlements 없음`);
    for (const sd of g.settlements || []) {
      if (settlements[sd.id]) problems.push(`정착지 id 중복: ${sd.id}`);
      settlements[sd.id] = sd;
      for (const st of sd.stations) if (!stations[st.type]) problems.push(`정착지 ${sd.id}: 작업대 ${st.type} 없음`);
    }
  }
  for (const r of raw.recipes) {
    if (r.stationTier != null && !(r.stationTier >= 1 && r.stationTier <= 3)) problems.push(`레시피 ${r.id}: stationTier ${r.stationTier}`);
  }
  // 마을 사업(v0.4)
  const projectList = raw.projects || [];
  const projects = index(projectList, '마을 사업');
  for (const p of projectList) {
    const sd = settlements[p.at];
    if (!sd) problems.push(`사업 ${p.id}: 정착지 ${p.at} 없음`);
    for (const it of Object.keys(p.needs || {})) if (!items[it]) problems.push(`사업 ${p.id}: 물자 ${it} 없음`);
    for (const a of p.after || []) if (!projects[a]) problems.push(`사업 ${p.id}: 앞 사업 ${a} 없음`);
    const e = p.effect || {};
    if (e.build && sd && !sd.stations.some((st) => st.type === e.build && st.build === p.id)) problems.push(`사업 ${p.id}: ${p.at}에 지을 ${e.build} 자리 없음`);
    if (e.upgrade && sd && !sd.stations.some((st) => st.type === e.upgrade && !st.build)) problems.push(`사업 ${p.id}: 고칠 ${e.upgrade} 없음`);
    if (!e.build && !e.upgrade && !e.cap) problems.push(`사업 ${p.id}: 효과 없음`);
  }
  for (const t of config.orders.templates) {
    if (!items[t.item]) problems.push(`의뢰 틀: 아이템 ${t.item} 없음`);
    if (t.at && !settlements[t.at]) problems.push(`의뢰 틀 ${t.item}: 정착지 ${t.at} 없음`);
  }
  for (const a of config.econ.agents) if (a.home && !settlements[a.home]) problems.push(`AI ${a.id}: 사는 마을 ${a.home} 없음`);
  for (const sid of Object.keys(config.town.demand)) if (!settlements[sid]) problems.push(`수요: 정착지 ${sid} 없음`);
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
  const creatures = index(raw.creatures || [], '짐승');
  const zoneIds = new Set(raw.regions.flatMap((r) => (r.zones || []).map((z) => z.id)));
  for (const c of raw.creatures || []) {
    c.loot = c.loot || [];
    // 공격은 여러 개(attacks)로 다룬다. 예전 짐승의 attack 하나는 attacks[0]이 된다(v0.5)
    if (!c.attacks && c.attack) c.attacks = [{ id: 'bite', mult: 1, ...c.attack }];
    if (!c.attack && c.attacks) c.attack = c.attacks[0];
    // 다가가 멈출 거리: 돌진·던지기를 뺀 가장 긴 근접 사거리(없으면 첫 공격 사거리)
    if (c.attacks && c.engage == null) {
      let r = 0;
      for (const at of c.attacks) if (!at.charge && !at.shot) r = Math.max(r, at.range);
      c.engage = r || c.attacks[0].range;
    }
    for (const lt of c.loot) if (!items[lt.item]) problems.push(`짐승 ${c.id}: 전리품 ${lt.item} 없음`);
    for (const d of c.drops?.items || []) if (!items[d.item]) problems.push(`짐승 ${c.id}: 떨굼 ${d.item} 없음`);
    if (c.zone && !zoneIds.has(c.zone)) problems.push(`짐승 ${c.id}: 구역 ${c.zone} 없음`);
    for (const w of [c.look?.weapon].filter(Boolean)) if (!items[w]?.weapon) problems.push(`짐승 ${c.id}: 무기 ${w} 없음`);
    for (const ph of c.phases || []) for (const t of Object.keys(ph.summon || {})) if (!raw.creatures.some((x) => x.id === t)) problems.push(`짐승 ${c.id}: 부를 ${t} 없음`);
  }
  for (const n of raw.nodes) if (n.zone && !zoneIds.has(n.zone)) problems.push(`노드 ${n.id}: 구역 ${n.zone} 없음`);
  // 자리(v0.5): 야영지·퀘스트 물체
  const sites = {};
  const objects = {};
  for (const g of raw.regions) {
    for (const s of g.sites || []) {
      if (sites[s.id]) problems.push(`자리 id 중복: ${s.id}`);
      sites[s.id] = s;
      for (const m of s.members || []) if (!creatures[m.type]) problems.push(`자리 ${s.id}: 짐승 ${m.type} 없음`);
      for (const o of s.objects || []) {
        if (objects[o.id]) problems.push(`물체 id 중복: ${o.id}`);
        objects[o.id] = { ...o, site: s.id };
      }
    }
  }
  // NPC·퀘스트(v0.5)
  const npcList = raw.npcs || [];
  const npcs = index(npcList, 'NPC');
  for (const n of npcList) if (n.at ? !settlements[n.at] : !sites[n.site]) problems.push(`NPC ${n.id}: 자리 ${n.at || n.site} 없음`);
  const Q = raw.quests || { chapters: [], items: {}, quests: [] };
  const quests = index(Q.quests, '퀘스트');
  for (const q of Q.quests) {
    for (const r of q.requires || []) if (!quests[r]) problems.push(`퀘스트 ${q.id}: 앞 퀘스트 ${r} 없음`);
    if (q.next && !quests[q.next]) problems.push(`퀘스트 ${q.id}: 다음 ${q.next} 없음`);
    if (q.giver && q.giver !== 'board' && !npcs[q.giver]) problems.push(`퀘스트 ${q.id}: 주는 이 ${q.giver} 없음`);
    if (!q.steps?.length) problems.push(`퀘스트 ${q.id}: 단계 없음`);
    for (const st of q.steps || []) {
      if (st.type === 'talk' && st.npc !== '@leader' && !npcs[st.npc]) problems.push(`퀘스트 ${q.id}: NPC ${st.npc} 없음`);
      if ((st.type === 'go' || st.type === 'defend' || st.site) && !sites[st.site]) problems.push(`퀘스트 ${q.id}: 자리 ${st.site} 없음`);
      if (st.type === 'kill') for (const m of st.mobs || []) if (!creatures[m]) problems.push(`퀘스트 ${q.id}: 짐승 ${m} 없음`);
      if (st.type === 'use') for (const o of st.objs || []) if (!objects[o]) problems.push(`퀘스트 ${q.id}: 물체 ${o} 없음`);
      if (st.type === 'defend') for (const w of st.waves || []) for (const t of Object.keys(w)) if (!creatures[t]) problems.push(`퀘스트 ${q.id}: 습격 ${t} 없음`);
      if (st.gives && !Q.items[st.gives]) problems.push(`퀘스트 ${q.id}: 퀘스트 물건 ${st.gives} 없음`);
      if (!STEP_TYPES.includes(st.type)) problems.push(`퀘스트 ${q.id}: 모르는 단계 ${st.type}`);
      // 생활 단계(v0.5.2): 가지기·먹기·맡기기·고치기·팔기·마을 사업
      for (const it of [...Object.keys(st.need || {}), ...(st.any || []), ...(st.orAny || [])]) if (!items[it]) problems.push(`퀘스트 ${q.id}: 단계 물건 ${it} 없음`);
      if (st.type === 'have' && !st.need && !st.any?.length) problems.push(`퀘스트 ${q.id}: 가질 물건 없음`);
      if (st.type === 'project' && !projects[st.project]) problems.push(`퀘스트 ${q.id}: 사업 ${st.project} 없음`);
      if (st.at && !settlements[st.at]) problems.push(`퀘스트 ${q.id}: 마을 ${st.at} 없음`);
      for (const n of st.goal?.node || []) if (!raw.nodes.some((x) => x.id === n)) problems.push(`퀘스트 ${q.id}: 길잡이 노드 ${n} 없음`);
      if (st.goal?.station && !stations[st.goal.station]) problems.push(`퀘스트 ${q.id}: 길잡이 작업대 ${st.goal.station} 없음`);
      for (const it of st.reward?.items || []) if (!items[it.item]) problems.push(`퀘스트 ${q.id}: 단계 보상 ${it.item} 없음`);
      // 건네기(v0.6)
      for (const it of Object.keys(st.take || {})) if (!items[it]) problems.push(`퀘스트 ${q.id}: 건넬 물건 ${it} 없음`);
      if (st.take && st.type !== 'talk') problems.push(`퀘스트 ${q.id}: take는 talk 단계에만`);
    }
    for (const it of q.reward?.items || []) if (!items[it.item]) problems.push(`퀘스트 ${q.id}: 보상 ${it.item} 없음`);
    for (const g of q.grants || []) if (!['lantern_mark'].includes(g)) problems.push(`퀘스트 ${q.id}: 모르는 표식 ${g}`);
  }
  for (const ch of Q.chapters) for (const id of ch.quests) if (!quests[id]) problems.push(`장 ${ch.id}: 퀘스트 ${id} 없음`);
  for (const n of raw.npcs) if (n.appear && !quests[n.appear]) problems.push(`NPC ${n.id}: 나타날 퀘스트 ${n.appear} 없음`);
  // 섬 건너기(v0.6): 배가 가는 지역
  for (const o of Object.values(objects)) if (o.cross && !raw.regions.some((r) => r.id === o.cross)) problems.push(`물체 ${o.id}: 건널 지역 ${o.cross} 없음`);
  for (const o of Object.values(objects)) if (o.ferry && !quests[o.ferry]) problems.push(`물체 ${o.id}: 배 길 퀘스트 ${o.ferry} 없음`);
  // 해금(v0.5.2)
  const unlockList = raw.unlocks || [];
  const unlocks = index(unlockList, '해금');
  for (const u of unlockList) {
    if (u.when?.chapter && !Q.chapters.some((c) => c.id === u.when.chapter)) problems.push(`해금 ${u.id}: 장 ${u.when.chapter} 없음`);
    if (u.when?.quest && !quests[u.when.quest]) problems.push(`해금 ${u.id}: 퀘스트 ${u.when.quest} 없음`);
    for (const x of u.allow || []) {
      if (x.project && !projects[x.project]) problems.push(`해금 ${u.id}: 사업 ${x.project} 없음`);
      if (x.quest && !quests[x.quest]) problems.push(`해금 ${u.id}: 퀘스트 ${x.quest} 없음`);
    }
  }

  // 세력(v0.7)
  const factions = raw.factions || { ranks: [{ at: 0, name: '견습' }], list: [], switchDays: 2, dailyCap: 60, tasksPerDay: 3 };
  for (const f of factions.list) {
    if (!npcs[f.leader]) problems.push(`세력 ${f.id}: 지도자 ${f.leader} 없음`);
    for (const p of f.perks) {
      if (p.kind === 'recipe' && recipes[p.recipe]?.faction !== f.id) problems.push(`세력 ${f.id}: 전용 레시피 ${p.recipe}`);
      for (const sk of Array.isArray(p.skills) ? p.skills : []) if (!skills[sk]) problems.push(`세력 ${f.id}: 기술 ${sk} 없음`);
    }
    for (const t of f.tasks) if (!items[t.item]) problems.push(`세력 ${f.id}: 의뢰 물건 ${t.item} 없음`);
  }
  for (const r of Object.values(recipes)) if (r.faction && !factions.list.some((f) => f.id === r.faction)) problems.push(`레시피 ${r.id}: 세력 ${r.faction} 없음`);

  if (problems.length) throw new Error('데이터 오류\n- ' + problems.join('\n- '));

  // 내 집(v0.8)
  const housing = raw.housing || { plots: [], tiers: [], plants: [], rest: { every: 1800, minutes: 45, base: 0.05, perComfort: 0, cap: 0 }, range: 6 };
  for (const p of housing.plots) if (!settlements[p.at]) problems.push(`집터 ${p.id}: 마을 ${p.at} 없음`);
  for (const t of housing.tiers) for (const it of Object.keys(t.needs)) if (!items[it]) problems.push(`집 ${t.id}: 재료 ${it} 없음`);
  for (const p of housing.plants) if (!items[p.item] || !items[p.out]) problems.push(`텃밭 ${p.item}: 물건 없음`);
  if (problems.length) throw new Error('데이터 오류\n- ' + problems.join('\n- '));

  // 조합(v0.8.1)
  const guilds = raw.guilds || { create: { silver: 500 }, minSize: 4, maxSize: 20, aiRate: 0, jobsPerDay: 0, levels: [{ at: 0, name: '조합', store: 30 }], perks: [], jobs: [] };
  for (const j of guilds.jobs) if (!items[j.item]) problems.push(`조합 일감 ${j.item} 없음`);
  if (problems.length) throw new Error('데이터 오류\n- ' + problems.join('\n- '));

  // 원정(v2.3)
  const EXP = raw.expeditions || { list: [], mercs: { list: [] } };
  for (const e of EXP.list) {
    if (!raw.regions.some((r) => r.sites.some((s) => s.id === e.site))) problems.push(`원정 ${e.id}: 자리 ${e.site} 없음`);
    if (!raw.creatures.some((c) => c.id === e.boss)) problems.push(`원정 ${e.id}: 두목 ${e.boss} 없음`);
    for (const w of e.waves) for (const t of Object.keys(w)) if (!raw.creatures.some((c) => c.id === t)) problems.push(`원정 ${e.id}: 짐승 ${t} 없음`);
    for (const it of e.reward.items) if (!items[it.item]) problems.push(`원정 ${e.id}: 보상 ${it.item} 없음`);
    for (const b of e.reward.blueprints) if (!items[b]?.blueprint) problems.push(`원정 ${e.id}: 설계도 ${b} 없음`);
  }
  for (const m of EXP.mercs.list) if (!items[m.weapon]?.weapon) problems.push(`원정 동료 ${m.id}: 무기 ${m.weapon}`);
  for (const it of raw.items) if (it.blueprint && !raw.recipes.some((r) => r.id === it.recipe && r.blueprint === it.id)) problems.push(`설계도 ${it.id}: 제작법 ${it.recipe} 짝 없음`);
  // 하루 동선·말 바뀌기(v1.5)
  for (const n of raw.npcs) {
    // 호감도(v1.6): 선물 물건과 정이 든 뒤의 말
    for (const k of ['love', 'like', 'hate']) for (const it of n.gifts?.[k] || []) if (!items[it]) problems.push(`NPC ${n.id}: 선물 ${it} 없음`);
    if (n.perk?.kind === 'companion' && !items[n.perk.weapon]?.weapon) problems.push(`NPC ${n.id}: 동행 무기 ${n.perk.weapon}`);
    if (n.birthday != null && !(n.birthday >= 1 && n.birthday <= raw.config.calendar.monthDays)) problems.push(`NPC ${n.id}: 생일 ${n.birthday}`);
    for (const t of Object.keys(n.chatBond || {})) if (!(+t >= 1 && +t < raw.config.bond.tiers.length)) problems.push(`NPC ${n.id}: 정 단계 ${t}`);
    for (const sp of n.routine || []) {
      if (sp.at ? !settlements[sp.at] : !raw.regions.some((r) => r.sites.some((s) => s.id === sp.site))) problems.push(`NPC ${n.id}: 동선 자리 ${sp.at || sp.site} 없음`);
      if (!(sp.h >= 0 && sp.h < 24)) problems.push(`NPC ${n.id}: 동선 시각 ${sp.h}`);
    }
    for (const c of n.chatAfter || []) if (!raw.quests.quests.some((q) => q.id === c.quest)) problems.push(`NPC ${n.id}: 말 바뀌기 퀘스트 ${c.quest} 없음`);
  }
  for (const q of raw.quests.quests) if (q.bond && !(raw.npcs.find((n) => n.id === q.giver)?.gifts && q.bond < raw.config.bond.tiers.length)) problems.push(`퀘스트 ${q.id}: 마음의 부탁은 정을 쌓을 수 있는 사람이 준다`);
  for (const q of raw.quests.quests) if (q.faction && !factions.list.some((f) => f.id === q.faction)) problems.push(`퀘스트 ${q.id}: 세력 ${q.faction} 없음`);
  // 무기 숙련(v1.1)
  const weapons = raw.weapons || { cap: 20, xp: { base: 25, exp: 1.5, perDmg: 1, perKill: 0.25 }, reset: { perPoint: 15 }, mastery: {}, types: {}, nodes: [] };
  const weaponNodes = {};
  for (const n of weapons.nodes) {
    if (weaponNodes[n.id]) problems.push(`숙련 칸 ${n.id} 겹침`);
    weaponNodes[n.id] = n;
    if (!weapons.types[n.weapon]) problems.push(`숙련 칸 ${n.id}: 무기 ${n.weapon} 없음`);
    if (n.kind === 'active' && !n.ab) problems.push(`숙련 칸 ${n.id}: 스킬 값 없음`);
  }
  for (const n of weapons.nodes) if (n.needs && weaponNodes[n.needs]?.kind !== 'active') problems.push(`숙련 칸 ${n.id}: 앞 칸 ${n.needs}가 액티브가 아님`);
  for (const [t, m] of Object.entries(weapons.mastery)) if (!weapons.types[m] || !config.combat.weapons[t]) problems.push(`숙련 연결 ${t}→${m} 이상`);
  for (const t of Object.keys(weapons.types)) if (!config.combat.weapons[t]) problems.push(`무기 ${t}: 전투 값 없음`);
  // 다른 세력 개척자(v2.6)
  for (const b of raw.rivals?.bands || []) {
    const g = regions[b.region];
    if (!g) problems.push(`다른 세력 무리 ${b.id}: 지역 ${b.region} 없음`);
    else if (!(g.zones || []).some((z) => z.id === b.zone && z.disputed)) problems.push(`다른 세력 무리 ${b.id}: 분쟁 구역 ${b.zone} 아님`);
    if (!factions.list.some((f) => f.id === b.faction)) problems.push(`다른 세력 무리 ${b.id}: 세력 ${b.faction} 없음`);
    for (const w of b.weapons) if (!items[w]?.weapon) problems.push(`다른 세력 무리 ${b.id}: 무기 ${w} 없음`);
    for (const [s, a] of Object.entries(b.armor || {})) if (items[a]?.armor?.slot !== s) problems.push(`다른 세력 무리 ${b.id}: ${s} 갑옷 ${a} 이상`);
  }
  // 영지(v2.7)
  const T = raw.territory || { holds: [], aiGuilds: [], supply: [] };
  const sids = new Set(raw.regions.flatMap((r) => r.settlements.map((s) => s.id)));
  for (const g of T.aiGuilds) {
    if (!factions.list.some((f) => f.id === g.faction)) problems.push(`AI 조합 ${g.id}: 세력 ${g.faction} 없음`);
    for (const w of g.weapons) if (!items[w]?.weapon) problems.push(`AI 조합 ${g.id}: 무기 ${w} 없음`);
  }
  for (const h of T.holds) {
    if (!sids.has(h.settlement)) problems.push(`영지 ${h.settlement}: 마을 없음`);
    if (h.owner.startsWith('ai:') && !T.aiGuilds.some((g) => `ai:${g.id}` === h.owner)) problems.push(`영지 ${h.settlement}: 주인 ${h.owner} 없음`);
  }
  for (const s of T.supply) if (s.item && !items[s.item]) problems.push(`전쟁 물자 ${s.item} 없음`);
  // 길잡이 돌·탈것(v3.2)
  const TR = raw.travel || { waystones: [], mounts: [], stables: {} };
  for (const w of TR.waystones) {
    if (!regions[w.region]) problems.push(`길잡이 돌 ${w.id}: 지역 ${w.region} 없음`);
    if (w.at && !sids.has(w.at)) problems.push(`길잡이 돌 ${w.id}: 마을 ${w.at} 없음`);
    if (w.site && !sites[w.site]) problems.push(`길잡이 돌 ${w.id}: 자리 ${w.site} 없음`);
  }
  for (const [sid, ms] of Object.entries(TR.stables)) {
    if (!sids.has(sid)) problems.push(`마구간 ${sid}: 마을 없음`);
    for (const m of ms) if (!TR.mounts.some((x) => x.id === m)) problems.push(`마구간 ${sid}: 탈것 ${m} 없음`);
  }
  for (const m of TR.mounts) if (m.quest && !quests[m.quest]) problems.push(`탈것 ${m.id}: 퀘스트 ${m.quest} 없음`);
  for (const q of Object.values(quests)) if (q.reward?.mount && !TR.mounts.some((x) => x.id === q.reward.mount)) problems.push(`퀘스트 ${q.id}: 탈것 ${q.reward.mount} 없음`);
  if (problems.length) throw new Error('데이터 오류\n- ' + problems.join('\n- '));

  return {
    waystones: Object.fromEntries(TR.waystones.map((w) => [w.id, w])),
    mounts: Object.fromEntries(TR.mounts.map((m) => [m.id, m])),
    stables: TR.stables,
    territory: T,
    rivals: raw.rivals || { bands: [], names: ['이름 없음'], respawnSec: 240, aggro: 16, leash: 42, fallSec: 2.5 },
    weapons,
    weaponNodes,
    guilds,
    housing,
    factions,
    config,
    curve: raw.skills.xpCurve,
    items,
    skills,
    stations,
    nodes,
    recipes,
    regions,
    agents,
    creatures,
    projects,
    settlements,
    sites,
    objects,
    npcs,
    quests,
    questItems: Q.items,
    chapters: Q.chapters,
    unlocks,
    expeditions: Object.fromEntries((raw.expeditions?.list || []).map((e) => [e.id, e])),
    expeditionCfg: raw.expeditions || { list: [], mercs: { list: [] } },
    lists: {
      waystones: TR.waystones,
      mounts: TR.mounts,
      projects: projectList,
      unlocks: unlockList,
      creatures: raw.creatures || [],
      items: raw.items,
      skills: raw.skills.list,
      recipes: raw.recipes,
      nodes: raw.nodes,
      regions: raw.regions,
      npcs: npcList,
      quests: Q.quests,
    },
  };
}
