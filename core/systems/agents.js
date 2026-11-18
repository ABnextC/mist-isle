// AI 개척민 실행. 정책은 core/ai/에 있다.
// AI도 플레이어와 같은 명령으로만 상태를 바꾼다.

import { thinkSettler } from '../ai/settler.js';

const POLICIES = { settler: thinkSettler };

export function agentsTick(ctx) {
  for (const a of Object.values(ctx.state.actors)) {
    if (!a.ai || !a.ai.on) continue;
    const prof = ctx.data.agents[a.ai.profile];
    const policy = POLICIES[prof?.policy || 'settler'];
    if (policy) policy(ctx, a);
  }
}
