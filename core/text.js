// 한국어 표시 문구. 화면과 헤드리스 리포트가 같이 쓴다.

import { avgProps, effectiveProps } from './inventory.js';
import { starOf } from './formulas.js';

export const ERR = {
  unknown_command: '알 수 없는 명령',
  no_actor: '없는 캐릭터',
  bad_args: '잘못된 값',
  out_of_bounds: '지도 밖',
  busy: '다른 일을 하는 중',
  no_mana: '마나가 모자람',
  no_points: '숙련 점수가 없음(무기를 더 써서 레벨을 올리자)',
  no_skill: '이 칸에 건 스킬이 없음(N 무기 숙련에서 배우고 걸자)',
  cooldown: '아직 다시 쓸 수 없음',
  no_weapon: '무기를 들고 있지 않음',
  nothing: '되돌릴 것이 없음',
  already: '이미 배움',
  moving: '이동 중',
  no_node: '노드가 없음',
  node_empty: '다 캔 노드',
  node_gone: '산지가 닫힘',
  too_far: '너무 멂',
  level_low: '레벨이 모자람',
  no_tool: '도구가 없음',
  wrong_tool: '맞지 않는 도구',
  tool_broken: '부서진 도구',
  need_tool: '맨손으로는 못 캠',
  no_focus: '집중력이 모자람',
  bag_full: '가방이 가득 참',
  no_recipe: '없는 레시피',
  no_station: '작업대 앞이 아님',
  queue_full: '대기열이 가득 참',
  missing_materials: '재료가 모자람',
  missing_catalyst: '촉매가 없음',
  bad_input: '고른 재료가 맞지 않음',
  bad_tune: '조율할 수 없는 스탯',
  no_item: '물건이 없음',
  not_food: '먹을 수 없음',
  not_in_town: '정착지 밖',
  moved: '움직여서 멈춤',
  recall_cooldown: '귀환은 아직 쓸 수 없음',
  not_tradable: '사고팔 수 없는 물건',
  bad_price: '값이 맞지 않음',
  bad_qty: '수량이 맞지 않음',
  no_silver: '은화가 모자람',
  too_many_orders: '걸어 둘 수 있는 주문이 꽉 참',
  no_order: '없는 주문',
  nothing_to_deliver: '넘길 물건이 없음(별·내구도 확인)',
  not_repairable: '고칠 수 없는 물건',
  not_damaged: '고칠 데가 없음',
  down: '쓰러져 있음',
  stunned: '비틀거리는 중',
  no_stamina: '기력이 모자람',
  overloaded: '장비가 너무 무거워 구를 수 없음(과적)',
  no_mob: '없는 짐승',
  no_corpse: '손질할 사체가 없음',
  not_equipment: '낄 수 없는 물건',
  station_tier: '2단계 작업대가 있어야 함',
  other_town: '다른 마을 게시판의 주문',
  already_home: '이미 귀환 지점',
  same_town: '같은 마을',
  no_project: '이 마을 사업이 아님',
  project_closed: '아직 열리지 않았거나 끝난 사업',
  not_needed: '그 사업에 더 필요 없음',
  locked: '아직 열리지 않은 기능(이야기를 더 진행하면 열린다)',
  other_island: '다른 섬으로는 보낼 수 없다',
  faction_recipe: '세력 전용 레시피(그 세력에서 등급을 올려야 한다)',
  same_faction: '이미 이 세력이다',
  faction_cooldown: '세력을 옮긴 지 얼마 안 됐다(며칠 뒤에 다시)',
  no_faction: '아직 든 세력이 없다',
  task_done: '오늘은 이미 건넨 의뢰다',
  plot_taken: '이미 주인이 있는 집터다',
  has_house: '집은 하나만 가질 수 있다',
  no_house: '아직 집이 없다',
  max_tier: '더 올릴 수 없다(큰 집)',
  not_furniture: '가구가 아니다',
  house_full: '가구 놓을 자리가 없다(집을 올리면 늘어난다)',
  rest_wait: '방금 쉬었다(조금 뒤에 다시)',
  slot_busy: '이미 심은 자리다',
  not_ripe: '아직 덜 자랐다',
  has_guild: '이미 조합에 들어 있다',
  bad_name: '조합 이름은 두 글자 이상',
  name_taken: '같은 이름의 조합이 있다',
  guild_full: '조합 자리가 다 찼다',
  no_guild: '든 조합이 없다',
  ai_full: 'AI 조합원 자리가 없다(사람이 넷보다 적을 때만 채운다)',
  guild_store_full: '조합 창고가 꽉 찼다(명성이 오르면 넓어진다)',
  need_items: '건넬 물건이 모자라다(추적 줄에 센 것을 보자)',
  // 퀘스트(v0.5)
  no_npc: '그런 사람은 없음',
  no_quest: '없는 퀘스트',
  not_available: '지금은 받을 수 없음',
  no_obj: '없는 물체',
  not_quest_obj: '지금은 손댈 일이 없음',
};

// 갑옷 종류(v0.4.5)
export const ARMOR_CLASS = { robe: '로브', light: '경갑', heavy: '중갑' };

// 무게 단계 효과를 짧게 적는다. 1에서 벗어난 것만.
export function loadEffects(tier, base) {
  const pct = (v) => `${v > 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}%`;
  const out = [];
  if (tier.move !== 1) out.push(`이동 ${pct(tier.move)}`);
  if (tier.stRegen !== 1) out.push(`기력 회복 ${pct(tier.stRegen)}`);
  if (!(tier.dodgeDist > 0)) out.push('구르기 불가');
  else if (base && tier.dodgeDist !== base) out.push(`구르기 ${tier.dodgeDist}m`);
  if (tier.dodgeCost !== 1 && tier.dodgeDist > 0) out.push(`구르기 기력 ${pct(tier.dodgeCost)}`);
  if (tier.gather !== 1) out.push(`채집 ${pct(tier.gather)}`);
  if (tier.blockCost !== 1) out.push(`막기 기력 ${pct(tier.blockCost)}`);
  if (tier.guardBreak !== 1) out.push(`막기가 깨질 때 비틀거림 ${pct(tier.guardBreak)}`);
  return out.join(' · ') || '효과 없음';
}

// 정착지 이름(없으면 id)
export const townName = (state, sid) => state.settlements[sid]?.name ?? sid;

// 은화 표기: 1,234
export const silver = (n) => `${Math.floor(n).toLocaleString('ko-KR')}은화`;

// 조사(v0.5.1): 마지막 글자에 받침이 있으면 앞의 것, 없으면 뒤의 것 — josa('돌 해태', '이', '가') → '돌 해태가'
export function josa(word, withFinal, without) {
  const c = word.charCodeAt(word.length - 1);
  const final = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false;
  return word + (final ? withFinal : without);
}

export const STAT_NAMES = {
  gatherSpeed: '속도', yield: '산출', durability: '내구', comfort: '쾌적', buff: '효과', minutes: '지속',
  attack: '공격력', armor: '방어', heal: '회복',
};

export const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

export function fmtProps(props, data) {
  return Object.entries(props).map(([k, v]) => `${data.config.propNames[k] || k} ${Math.round(v)}`).join('·');
}

export function fmtStat(stat, v) {
  if (stat === 'gatherSpeed') return `×${v.toFixed(2)}`;
  if (stat === 'yield' || stat === 'buff') return `+${Math.round(v * 100)}%`;
  if (stat === 'minutes') return `${v}분`;
  return String(v);
}

export function fmtStats(stats) {
  return Object.entries(stats).map(([k, v]) => `${STAT_NAMES[k] || k} ${fmtStat(k, v)}`).join(' · ');
}

export function lotStar(lot, cfg) {
  return starOf(avgProps(lot.props), cfg.stars);
}

export function entryStar(entry, state, cfg) {
  if (entry.star) return entry.star;
  if (!entry.lot) return 0;
  return starOf(avgProps(effectiveProps(entry, state.lots)), cfg.stars);
}

export function itemName(data, id) {
  return data.items[id]?.name || id;
}

const SKILL_ICON = (data, id) => data.skills[id]?.icon || '';

export function describeEvent(ev, game) {
  const { data, state } = game;
  const who = state.actors[ev.actor]?.name;
  const p = who && Object.keys(state.actors).length > 1 ? `[${who}] ` : '';
  switch (ev.type) {
    case 'gather.done': {
      const lot = state.lots[ev.lot];
      let s = `${p}${SKILL_ICON(data, ev.skill)} ${itemName(data, ev.item)} ×${ev.qty}`;
      if (lot) s += ` · ${lot.name}`;
      if (ev.byproducts.length) s += ` · 덤: ${ev.byproducts.map((b) => itemName(data, b.item)).join(', ')}`;
      return s;
    }
    case 'gather.failed':
      return ev.reason === 'moved' ? null : `${p}⚠️ 채집 실패: ${ERR[ev.reason] || ev.reason}`;
    case 'craft.queued':
      return null;
    case 'craft.done': {
      const r = data.recipes[ev.recipe];
      const icon = SKILL_ICON(data, r.skill);
      if (r.type === 'refine') {
        const lot = state.lots[ev.lot];
        const b = ev.bonus ? ' · ' + Object.entries(ev.bonus).map(([k, v]) => `${data.config.propNames[k]} +${v}`).join(', ') : '';
        const back = ev.returned ? ` · 재료 ${ev.returned}개 돌려받음` : '';
        return `${p}${icon} ${itemName(data, ev.item)} ×${ev.qty}${lot ? ' (' + lot.name + ')' : ''}${b}${back}`;
      }
      const mw = ev.masterwork ? ' ✨걸작' : '';
      return `${p}${icon} ${itemName(data, ev.item)} ${stars(ev.star)}${mw} — ${fmtStats(ev.stats)}`;
    }
    case 'skill.up':
      return `${p}⬆️ ${data.skills[ev.skill].name} ${ev.level}레벨`;
    case 'tool.broken':
      return `${p}💥 ${josa(itemName(data, ev.item), '이', '가')} 부서졌다`;
    case 'vein.opened':
      if (ev.common) return null;
      return `🗺️ 새 산지 「${ev.name}」 ${fmtProps(ev.props, data)} · ${ev.closesOnDay + 1}일차 아침에 닫힘`;
    case 'vein.closed':
      return `🌫️ 영맥이 옮겨 가며 「${ev.name}」이 닫혔다`;
    case 'eat':
      if (ev.heal != null) return `${p}🍖 ${itemName(data, ev.item)} — 체력 +${ev.heal}`;
      return `${p}🍽️ ${itemName(data, ev.item)} — 채집량 +${Math.round(ev.value * 100)}%, ${ev.minutes}분`;
    case 'mob.die': {
      const T = data.creatures[ev.species];
      if (!state.actors[ev.actor]) return null;
      return `${p}⚔️ ${T?.name ?? ev.species} 쓰러뜨림${T?.hunt ? ' — 다가가 손질하자' : ''}`;
    }
    case 'loot': {
      const parts = [];
      if (ev.silver) parts.push(`은화 ${ev.silver}`);
      for (const x of ev.items) parts.push(`${itemName(data, x.item)} ${x.qty}`);
      if (ev.lost) parts.push(`가방이 차서 ${ev.lost}개 버림`);
      return `${p}🪙 전리품: ${parts.join(' · ')}`;
    }
    case 'quest.start': {
      const q = data.quests[ev.quest];
      return q ? `${p}📜 ${q.kind === 'main' ? '메인 퀘스트' : '현상금'} 「${q.name}」 시작` : null;
    }
    case 'quest.done': {
      const q = data.quests[ev.quest];
      const r = ev.reward || {};
      const got = [...(r.silver ? [`은화 ${r.silver}`] : []), ...(r.items || []).map((x) => `${itemName(data, x.item)} ${x.qty}`), ...(r.stored || []).map((x) => `${itemName(data, x.item)} ${x.qty}(창고로)`)];
      return q ? `${p}✅ 「${q.name}」 완료${got.length ? ` — ${got.join(' · ')}` : ''}` : null;
    }
    case 'quest.stepReward': {
      const q = data.quests[ev.quest];
      const r = ev.reward || {};
      const got = [...(r.silver ? [`은화 ${r.silver}`] : []), ...(r.items || []).map((x) => `${itemName(data, x.item)} ${x.qty}`), ...(r.stored || []).map((x) => `${itemName(data, x.item)} ${x.qty}(창고로)`)];
      return q && got.length ? `${p}🎁 「${q.name}」 도중에 받음 — ${got.join(' · ')}` : null;
    }
    case 'unlock': {
      const names = (ev.ids || []).map((id) => data.unlocks[id]?.name).filter(Boolean);
      return names.length ? `${p}🔓 새로 열림: ${names.join(' · ')}` : null;
    }
    case 'quest.fail':
      return `${p}⚠️ 「${data.quests[ev.quest]?.name ?? ''}」 ${ev.reason === 'down' ? '쓰러져서' : '자리를 떠나서'} 습격을 막지 못했다. 다시 가면 처음부터`;
    case 'chapter.done': {
      const ch = data.chapters.find((c) => c.id === ev.chapter);
      const nx = ev.next && data.chapters.find((c) => c.id === ev.next);
      return ch ? `${p}🏁 ${ch.name} 끝.${nx ? ` ${nx.name} 시작` : ` ${ch.after || ''}`}` : null;
    }
    case 'mob.wake':
      return `${p}⚠️ ${josa(data.creatures[ev.species]?.name ?? ev.species, '이', '가')} 몸을 일으켰다`;
    case 'quest.grant':
      return ev.mark === 'lantern_mark' ? `${p}🔥 등불의 각인을 얻었다 — 가까운 산지가 미니맵에 보인다` : null;
    case 'skin.done':
      return `${p}🔪 ${data.creatures[ev.species]?.name ?? ev.species} 손질: ${ev.items.map((x) => `${itemName(data, x.item)} ${x.qty}`).join(' · ')}`;
    case 'actor.down':
      return `${p}💀 ${ev.species ? `${data.creatures[ev.species]?.name ?? ev.species}에게 ` : ''}쓰러짐 — 가까운 마을에서 다시 일어난다(낀 장비 내구 −10%)`;
    case 'equip': {
      const SLOT = { weapon: '무기', head: '머리', chest: '몸통', legs: '다리' };
      return ev.uid ? `${p}🛡️ ${SLOT[ev.slot]}: ${itemName(data, ev.item)} 낌` : `${p}${SLOT[ev.slot]} 장비를 벗음`;
    }
    case 'combat.guardbreak':
      return `${p}🛡️ 기력이 바닥나 막기가 풀렸다`;
    case 'store':
      return ev.moved ? `${p}📦 ${ev.at ? townName(state, ev.at) + ' ' : ''}창고에 ${ev.moved}개 넣음` : null;
    case 'take':
      return `${p}📦 창고에서 ${ev.qty}개 꺼냄`;
    case 'cmd.rejected':
      return `${p}⚠️ ${ERR[ev.reason] || ev.reason}`;
    case 'day.start':
      return `🌅 ${ev.day}일차 아침`;
    case 'recall.done':
      return `${p}🏠 ${townName(state, ev.settlement)}(으)로 돌아왔다`;
    case 'home.set':
      return `${p}🏠 귀환 지점: ${townName(state, ev.at)}`;
    case 'ship':
      return `${p}🚚 ${townName(state, ev.from)} → ${townName(state, ev.to)} ${ev.qty}개 운송 · ${ev.fee}은화`;
    case 'project.contrib': {
      if (ev.kind !== 'actor') return null;
      const def = data.projects[ev.project];
      const what = ev.item ? `${itemName(data, ev.item)} ${ev.qty}개` : `${ev.silver}은화`;
      return `${state.actors[ev.owner] && Object.keys(state.actors).length > 1 ? `[${state.actors[ev.owner].name}] ` : ''}🏗️ 「${def.name}」에 ${what} 냄 · 명성 +${Math.round(ev.points)}`;
    }
    case 'project.done': {
      const def = data.projects[ev.project];
      return `🎉 ${townName(state, ev.at)} 사업 「${def.name}」 완성`;
    }
    case 'settle.pop':
      return `${ev.pop > ev.from ? '🏘️' : '🏚️'} ${townName(state, ev.at)} 인구 ${ev.from} → ${ev.pop} (번영 ${Math.round(ev.prosperity)})`;
    case 'station.down':
      return `⚠️ ${townName(state, ev.at)} ${data.stations[ev.station]?.name ?? ev.station}: 유지비가 밀려 1단계로 일한다`;
    case 'station.up':
      return `🔧 ${townName(state, ev.at)} ${data.stations[ev.station]?.name ?? ev.station}: 다시 ${ev.tier}단계`;
    case 'autopilot':
      return ev.on ? '🤖 봇이 대신 움직인다' : '🤖 봇 끔';
    case 'milestone':
      return null;
    case 'market.trade': {
      const nm = (id) => state.actors[id]?.name;
      const st = ev.star ? ` ${stars(ev.star)}` : '';
      if (nm(ev.seller)) return `${Object.keys(state.actors).length > 1 ? `[${nm(ev.seller)}] ` : ''}💰 ${itemName(data, ev.item)}${st} ${ev.qty}개 팔림 · 개당 ${ev.price}은화`;
      if (nm(ev.buyer)) return `${Object.keys(state.actors).length > 1 ? `[${nm(ev.buyer)}] ` : ''}🛒 ${itemName(data, ev.item)}${st} ${ev.qty}개 삼 · 개당 ${ev.price}은화`;
      return null;
    }
    case 'market.npc': {
      const nm = state.actors[ev.owner]?.name;
      return nm ? `🪙 상인에게 ${itemName(data, ev.item)} ${ev.qty}개 · ${ev.qty * ev.price}은화` : null;
    }
    case 'repair':
      return `${p}🔧 ${itemName(data, ev.item)} 수리 · ${ev.cost}은화 · 최대 내구 ${ev.maxDur}`;
    case 'order.posted':
      return `📋 ${ev.at ? townName(state, ev.at) + ' ' : ''}새 주문: ${itemName(data, ev.item)}${ev.minStar ? ` ★${ev.minStar} 이상` : ''} ${ev.qty}개 · 개당 ${ev.reward}은화`;
    case 'order.delivered': {
      const nm = state.actors[ev.owner]?.name;
      return nm ? `📋 주문 납품: ${itemName(data, ev.item)} ${ev.qty}개 · ${ev.pay}은화${ev.done ? ' · 주문 끝' : ''}` : null;
    }
    default:
      return null;
  }
}
