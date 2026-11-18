// 한국어 표시 문구. 화면과 헤드리스 리포트가 같이 쓴다.

import { avgProps, effectiveProps } from './inventory.js';
import { starOf } from './formulas.js';

export const ERR = {
  unknown_command: '알 수 없는 명령',
  no_actor: '없는 캐릭터',
  bad_args: '잘못된 값',
  out_of_bounds: '지도 밖',
  busy: '다른 일을 하는 중',
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
};

export const STAT_NAMES = {
  gatherSpeed: '속도', yield: '산출', durability: '내구', comfort: '쾌적', buff: '효과', minutes: '지속',
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
      return `${p}💥 ${itemName(data, ev.item)}가 부서졌다`;
    case 'vein.opened':
      if (ev.common) return null;
      return `🗺️ 새 산지 「${ev.name}」 ${fmtProps(ev.props, data)} · ${ev.closesOnDay + 1}일차 아침에 닫힘`;
    case 'vein.closed':
      return `🌫️ 영맥이 옮겨 가며 「${ev.name}」이 닫혔다`;
    case 'eat':
      return `${p}🍽️ ${itemName(data, ev.item)} — 채집량 +${Math.round(ev.value * 100)}%, ${ev.minutes}분`;
    case 'store':
      return ev.moved ? `${p}📦 창고에 ${ev.moved}개 넣음` : null;
    case 'take':
      return `${p}📦 창고에서 ${ev.qty}개 꺼냄`;
    case 'cmd.rejected':
      return `${p}⚠️ ${ERR[ev.reason] || ev.reason}`;
    case 'day.start':
      return `🌅 ${ev.day}일차 아침`;
    case 'recall.done':
      return `${p}🏠 등대 마을로 돌아왔다`;
    case 'autopilot':
      return ev.on ? '🤖 봇이 대신 움직인다' : '🤖 봇 끔';
    case 'milestone':
      return null;
    default:
      return null;
  }
}
