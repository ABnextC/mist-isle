# 브라우저 대화창 전수 점검(v3.3.2). 먼저 정적 서버: python3 -m http.server 8765 --bind 127.0.0.1
#   python3 tools/ui_audit.py
# 모든 퀘스트의 받기·이야기 단계마다 대화창을 열어, 창이 멈추지 않고 알맞은 단추가 있는지 본다
import asyncio, sys, json
from playwright.async_api import async_playwright
ARGS = ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
JS = r"""async () => {
  const M = window.__mist; const g = M.game; const hud = M.hud; const data = g.data; const C = g._ctx; const st = g.state; const a = st.actors.p1;
  const Q = await import('/core/systems/quests.js'); const W = await import('/core/world.js'); const B = await import('/core/systems/bonds.js');
  for (const m of Object.values(st.mobs)) m.mode = 'away';
  const mainOrder = data.chapters.flatMap((c) => c.quests);
  const closure = (ids) => { const seen = new Set(); const walk = (id) => { if (seen.has(id) || !data.quests[id]) return; seen.add(id); for (const r of data.quests[id].requires || []) walk(r); }; ids.forEach(walk);
    let last = -1; for (const id of seen) last = Math.max(last, mainOrder.indexOf(id)); for (let i = 0; i <= last; i++) seen.add(mainOrder[i]); return seen; };
  const T = data.config.time; const out = []; const t00 = st.t;
  const html = () => document.querySelector('[class*=pbody]')?.innerHTML || '';
  const setT = (t) => { st.t = t; st.tick = Math.round(t * T.hz); };
  for (const q of data.lists.quests) {
    setT(t00);
    a.quests.active = {}; a.quests.done = {}; a.quests.daily = {}; a.quests.track = null;
    const pre = closure(q.requires || []); if (q.kind === 'main') for (let i = 0; i < mainOrder.indexOf(q.id); i++) pre.add(mainOrder[i]);
    for (const id of pre) a.quests.done[id] = 0;
    a.bonds = {}; if (q.bond) a.bonds[q.giver] = { pts: 99999 };
    if (q.faction) a.faction = { id: q.faction, inf: 99999, done: {} };
    if (q.repeat === 'birthday') for (let d = 0; d < 60; d++) { setT(d * T.secondsPerGameDay + 10 * T.secondsPerGameDay / 24); if (B.isBirthday(C, q.giver, st.t)) break; }
    const warpNpc = (id) => { const p = W.npcPos(C, id); if (!p) return false; Object.assign(a, { x: p.x + 2.4, z: p.z, move: null, dest: null, nav: null }); return true; };
    const check = (stage, npc, want) => {
      try { hud.close(); hud.open('talk', { npc }); } catch (e) { out.push({ q: q.id, stage, npc, err: String(e).slice(0, 160) }); return; }
      const h = html();
      if (!want.some((w) => h.includes(w))) out.push({ q: q.id, stage, npc, err: 'no_button', text: (document.querySelector('[class*=pbody]')?.innerText || '').slice(0, 160) });
    };
    if (q.kind !== 'main' && q.giver !== 'board') {
      const who = Q.giverNow(C, a, q);
      if (!warpNpc(who)) { out.push({ q: q.id, stage: 'offer', err: 'no_pos' }); continue; }
      check('offer', who, [`data-act="quest-accept" data-v="${q.id}"`, `data-act="ui-talk-pick" data-v="${q.id}"`]);
    }
    q.steps.forEach((s, k) => {
      if (s.type !== 'talk') return;
      a.quests.active = { [q.id]: { step: k, n: 0, used: [], t: st.t } };
      for (const [it, n] of Object.entries(s.take || {})) { const L = Object.values(st.lots).find((l) => l.item === it); a.bag.push({ item: it, lot: data.items[it].family ? (L?.id ?? null) : null, bonus: null, qty: n }); }
      const who = Q.stepNpc(C, a, s);
      if (!warpNpc(who)) { out.push({ q: q.id, stage: 'step' + k, err: 'no_pos:' + who }); return; }
      check('step' + k, who, [`data-act="talk-do" data-v="${who}|${q.id}"`, `data-act="ui-talk-pick" data-v="${q.id}"`]);
      a.bag = a.bag.filter((e) => e.uid || !s.take?.[e.item]);
    });
  }
  hud.close(); setT(t00);
  // NPC마다 아무 일 없을 때 창
  a.quests.active = {}; a.quests.done = Object.fromEntries(data.lists.quests.map((q) => [q.id, 0]));
  for (const n of Object.values(data.npcs)) {
    try { hud.close(); hud.open('talk', { npc: n.id }); } catch (e) { out.push({ npc: n.id, stage: 'idle', err: String(e).slice(0, 160) }); }
  }
  hud.close();
  return { n: data.lists.quests.length, problems: out };
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        page = await b.new_page(viewport={"width": 1280, "height": 720})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:300]))
        await page.add_init_script("localStorage.setItem('mist-isle:gfx', 'low');")
        await page.goto("http://127.0.0.1:8765/?seed=7&fresh&nowarm")
        await page.wait_for_function("window.__mist && window.__mist.gfx && !document.getElementById('boot')", timeout=1500000)
        r = await page.evaluate(JS)
        r['pageerrors'] = errs[:10]
        print(json.dumps(r, ensure_ascii=False, indent=1))
        await b.close()
asyncio.run(main())
