// 성능 표시창(v0.4.5): F3 또는 설정 → 성능 표시. 렉의 원인을 화면에서 바로 짚으려고 만든다.
// fps·1% 저점, 프레임 안 CPU 시간(시뮬·화면 갱신·HUD·그리기 제출), GPU 시간(EXT_disjoint_timer_query_webgl2가 있으면),
// 그리기 호출·삼각형·셰이더 수, 그래픽카드 이름, 최근 끊김(이유 추정: 셰이더 컴파일·올리기·CPU·GPU).
// 창이 꺼져 있어도 GPU 시간은 8프레임에 한 번 재서 화질 자동 조절에 넘긴다.

const SECTIONS = ['sim', 'view', 'hud', 'draw'];
const NAMES = { sim: '시뮬', view: '화면 갱신', hud: 'HUD', draw: '그리기 제출' };

export function createPerf(renderer, { tierLabel = () => '', onGpu = null } = {}) {
  const gl = renderer.getContext();
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '?');
  const parallel = !!gl.getExtension('KHR_parallel_shader_compile');
  renderer.info.autoReset = false; // 한 프레임(그림자·장면·후처리 전부)을 묶어서 센다

  const el = document.createElement('div');
  el.id = 'perf';
  el.hidden = true;
  document.body.appendChild(el);

  let on = false;
  let frame = 0;
  let t0 = 0;
  let mark = 0;
  const cur = { sim: 0, view: 0, hud: 0, draw: 0 };
  const hist = []; // [frameMs, sim, view, hud, draw, gpu]
  const hitches = [];
  let lastProg = renderer.info.programs?.length || 0;
  let lastGeo = renderer.info.memory.geometries;
  let lastTex = renderer.info.memory.textures;
  let gpuMs = null;
  let query = null;
  const pending = [];
  let lastShow = 0;
  let prevStart = 0;

  function begin(now) {
    renderer.info.reset();
    t0 = now; // 프레임 간격은 rAF 시각으로, 구간 시간은 실제 시계로 잰다
    mark = performance.now();
    for (const k of SECTIONS) cur[k] = 0;
  }
  function lap(name) {
    const n = performance.now();
    cur[name] += n - mark;
    mark = n;
  }
  // 그리기 둘레에 GPU 시간 질의를 건다(한 번에 하나만)
  function drawBegin() {
    mark = performance.now();
    if (!tq || query || (!on && frame % 8 !== 0)) return;
    query = gl.createQuery();
    gl.beginQuery(tq.TIME_ELAPSED_EXT, query);
  }
  function drawEnd() {
    if (query) {
      gl.endQuery(tq.TIME_ELAPSED_EXT);
      pending.push(query);
      query = null;
    }
    lap('draw');
  }
  function pollGpu() {
    while (pending.length) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(tq.GPU_DISJOINT_EXT);
      if (!disjoint) {
        gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        onGpu?.(gpuMs);
      }
      gl.deleteQuery(q);
      pending.shift();
    }
  }

  function end(now) {
    frame++;
    if (tq) pollGpu();
    const frameMs = prevStart ? t0 - prevStart : 16.7;
    prevStart = t0;
    const prog = renderer.info.programs?.length || 0;
    const geo = renderer.info.memory.geometries;
    const tex = renderer.info.memory.textures;
    const dProg = prog - lastProg;
    const dUp = Math.max(0, geo - lastGeo) + Math.max(0, tex - lastTex);
    lastProg = prog;
    lastGeo = geo;
    lastTex = tex;
    hist.push([frameMs, cur.sim, cur.view, cur.hud, cur.draw, gpuMs ?? -1]);
    if (hist.length > 240) hist.shift();
    // 끊김: 앞 프레임 간격이 50ms를 넘고 평소의 2.5배 넘게 길었다
    if (frame > 30 && frameMs > 50) {
      const sorted = hist.map((h) => h[0]).sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      if (frameMs > med * 2.5) {
        const cpu = cur.sim + cur.view + cur.hud + cur.draw;
        let why = '알 수 없음(브라우저·GC·다른 프로그램)';
        if (dProg > 0) why = `셰이더 컴파일 +${dProg}`;
        else if (dUp > 0) why = `텍스처·모델 올리기 +${dUp}`;
        else if (cur.sim > 25) why = `시뮬 ${cur.sim.toFixed(0)}ms`;
        else if (cur.view > 25) why = `화면 갱신 ${cur.view.toFixed(0)}ms`;
        else if (cur.draw > 25) why = `그리기 제출 ${cur.draw.toFixed(0)}ms`;
        else if (gpuMs != null && gpuMs > 40) why = `GPU ${gpuMs.toFixed(0)}ms`;
        hitches.unshift({ at: new Date().toLocaleTimeString('ko-KR'), ms: Math.round(frameMs), why, cpu: Math.round(cpu) });
        if (hitches.length > 6) hitches.length = 6;
      }
    }
    if (on && now - lastShow > 250) {
      lastShow = now;
      show();
    }
  }

  function stat(i) {
    const v = hist.map((h) => h[i]).filter((x) => x >= 0);
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }
  function show() {
    const ft = hist.map((h) => h[0]).sort((a, b) => a - b);
    const avg = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
    const p99 = ft[Math.min(ft.length - 1, Math.floor(ft.length * 0.99))] || avg;
    const r = renderer.info.render;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const gpu = stat(5);
    const lines = [
      `<b>${(1000 / avg).toFixed(0)} fps</b> · 1% 저점 ${(1000 / p99).toFixed(0)} fps · ${avg.toFixed(1)}ms`,
      `CPU ${SECTIONS.map((k, i) => `${NAMES[k]} ${(stat(i + 1) || 0).toFixed(1)}`).join(' · ')}ms`,
      `GPU ${gpu != null ? `${gpu.toFixed(1)}ms` : '잴 수 없음'} · ${tierLabel()} · ${w}×${h} (×${renderer.getPixelRatio().toFixed(2)})`,
      `그리기 ${r.calls} · 삼각형 ${(r.triangles / 1e6).toFixed(2)}M · 셰이더 ${renderer.info.programs?.length || 0} · 텍스처 ${renderer.info.memory.textures} · 모델 ${renderer.info.memory.geometries}`,
      `<small>${gpuName.replace(/</g, '&lt;')}${parallel ? ' · 병렬 컴파일' : ''}</small>`,
    ];
    if (hitches.length) lines.push('<u>끊김</u> ' + hitches.map((x) => `${x.at} ${x.ms}ms ${x.why}`).join('<br>'));
    el.innerHTML = lines.join('<br>');
  }

  function toggle(v = !on) {
    on = v;
    el.hidden = !on;
    if (on) show();
  }
  return { begin, lap, drawBegin, drawEnd, end, toggle, get on() { return on; }, gpuName };
}
