// 해금(v0.5.2): 1~2장(등대섬, 튜토리얼 섬)은 기본 루프만 연다. 경제 기능은 3장에서, 큰 콘텐츠는 4장에서 연다.
// 조건은 장(chapter: 그 장에 들어섰다 = 앞 장을 다 끝냈다)이나 퀘스트(quest: 끝냈다)다.
// 사람(kind 'player')에게만 건다. 헤드리스 봇·AI 개척민은 명령·경제를 그대로 쓴다.
// soon: 아직 만들지 않은 콘텐츠(일지의 '열리는 것' 목록에만 보인다).

// 그 장의 메인 퀘스트를 다 끝냈다(퀘스트가 아직 없는 장은 끝날 수 없다)
export function chapterDone(ctx, a, chId) {
  const ch = ctx.data.chapters.find((c) => c.id === chId);
  const done = a?.quests?.done;
  // 퀘스트가 더 붙을 장(more)은 아직 끝난 게 아니다(v0.6)
  return !!ch && !ch.more && !!done && ch.quests.length > 0 && ch.quests.every((q) => done[q] != null);
}

// 그 장에 들어섰다: 첫 장이거나 앞 장을 다 끝냈다
export function chapterReached(ctx, a, chId) {
  const list = ctx.data.chapters;
  const i = list.findIndex((c) => c.id === chId);
  if (i < 0) return false;
  return i === 0 || chapterDone(ctx, a, list[i - 1].id);
}

function met(ctx, a, w = {}) {
  if (w.chapter && !chapterReached(ctx, a, w.chapter)) return false;
  if (w.quest && a?.quests?.done?.[w.quest] == null) return false;
  return true;
}

export const gated = (a) => !!a && a.kind === 'player' && !a.unlockAll;

export function isUnlocked(ctx, a, id) {
  const u = ctx.data.unlocks[id];
  if (!u || !gated(a)) return true;
  if (u.soon) return false; // 아직 만들지 않은 기능은 때가 와도 닫혀 있다
  return met(ctx, a, u.when);
}

// 잠긴 기능 안에서도 이야기로 허락한 것(2장 「숲머리 대장간」 동안의 대장간 사업)
export function allowedProject(ctx, a, pid) {
  if (isUnlocked(ctx, a, 'projects')) return true;
  const Q = a?.quests;
  return (ctx.data.unlocks.projects?.allow || []).some((x) => x.project === pid && (!x.quest || Q?.active[x.quest] || Q?.done[x.quest] != null));
}

export function unlockedSet(ctx, a) {
  return new Set(ctx.data.lists.unlocks.filter((u) => !u.soon && isUnlocked(ctx, a, u.id)).map((u) => u.id));
}

export const lockHint = (ctx, id) => {
  const u = ctx.data.unlocks[id];
  return u ? `🔒 ${u.name} — ${u.hint}` : '';
};
