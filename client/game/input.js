// 조작: 키보드·마우스(PC), 가상 스틱·드래그·핀치(모바일).
// 여기서는 '무엇을 누르는지'만 모은다. 명령으로 바꾸는 일은 main.js가 한다.

const MOVE_KEYS = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
// v1.1: 1·2·3 무기 스킬, X 무기 바꾸기, N 무기 숙련, Esc 창 닫기/메뉴. v2.4: G 물약
const ACT_KEYS = {
  e: 'interact', f: 'interact', h: 'recall', i: 'bag', b: 'bag', tab: 'bag', c: 'craft', k: 'skills', l: 'log', j: 'journal', n: 'mastery', p: 'char', o: 'exped', g: 'potion', t: 'territory',
  escape: 'esc', ' ': 'dodge', r: 'heavy', f3: 'perf', 1: 'skill0', 2: 'skill1', 3: 'skill2', x: 'swap',
};
// 전투(v0.3, PC): 마우스 왼쪽 짧게 = 약공, 길게 눌렀다 떼기 = 강공, 오른쪽 누르는 동안 = 막기, Space = 구르기, Q 누르는 동안 = 막기
const HEAVY_MS = 320;

export function createInput(canvas, { joyEl, knobEl }) {
  const keys = new Set();
  const acts = [];
  let camDX = 0;
  let camDY = 0;
  let zoom = 0;
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const drag = { id: null, lx: 0, ly: 0 };
  const touches = new Map();
  let pinchDist = 0;

  function onKey(e, down) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // 글자 키는 자판 자리(e.code)로 읽는다: 한글 입력 상태에서도 WASD·E·J가 그대로 먹게(v0.5)
    const k = e.code && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.code && /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.key.toLowerCase();
    if (MOVE_KEYS[k]) {
      if (down) keys.add(MOVE_KEYS[k]);
      else keys.delete(MOVE_KEYS[k]);
      e.preventDefault();
      return;
    }
    if (k === 'q') {
      if (!e.repeat) acts.push(down ? 'block-on' : 'block-off');
      return;
    }
    if (down && !e.repeat && ACT_KEYS[k]) {
      acts.push(ACT_KEYS[k]);
      if (k === 'tab' || k === ' ' || k === 'f3') e.preventDefault();
    }
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => keys.clear());

  const showJoy = () => {
    joyEl.style.left = `${joy.ox}px`;
    joyEl.style.top = `${joy.oy}px`;
    joyEl.classList.add('on');
    knobEl.style.transform = 'translate(-50%, -50%)';
  };

  const click = { id: null, x: 0, y: 0, t: 0, moved: false };
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 */ }
    if (e.pointerType === 'mouse' && e.button === 2) {
      acts.push('block-on');
      return;
    }
    if (e.pointerType === 'mouse' && e.button === 0) Object.assign(click, { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      const others = [...touches.keys()].filter((id) => id !== joy.id);
      if (others.length >= 2) {
        const [a, b] = others.map((id) => touches.get(id));
        pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        drag.id = null;
        return;
      }
      if (e.clientX < window.innerWidth * 0.45 && joy.id === null) {
        Object.assign(joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
        showJoy();
        return;
      }
    }
    Object.assign(drag, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (e.pointerId === joy.id) {
      const R = 56;
      let dx = e.clientX - joy.ox;
      let dy = e.clientY - joy.oy;
      const m = Math.hypot(dx, dy);
      if (m > R) {
        dx = (dx / m) * R;
        dy = (dy / m) * R;
      }
      joy.x = dx / R;
      joy.y = dy / R;
      knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const others = [...touches.keys()].filter((id) => id !== joy.id);
    if (others.length >= 2 && others.includes(e.pointerId)) {
      const [a, b] = others.map((id) => touches.get(id));
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist) zoom += (pinchDist - d) * 0.004;
      pinchDist = d;
      return;
    }
    if (e.pointerId === click.id && Math.hypot(e.clientX - click.x, e.clientY - click.y) > 6) click.moved = true;
    if (e.pointerId === drag.id) {
      camDX += e.clientX - drag.lx;
      camDY += e.clientY - drag.ly;
      drag.lx = e.clientX;
      drag.ly = e.clientY;
    }
  });

  const end = (e) => {
    if (e.pointerType === 'mouse' && e.button === 2) acts.push('block-off');
    if (e.pointerId === click.id) {
      if (!click.moved && e.type === 'pointerup') acts.push(performance.now() - click.t >= HEAVY_MS ? 'heavy' : 'attack');
      click.id = null;
    }
    touches.delete(e.pointerId);
    if (touches.size < 2) pinchDist = 0;
    if (e.pointerId === joy.id) {
      Object.assign(joy, { id: null, x: 0, y: 0 });
      joyEl.classList.remove('on');
    }
    if (e.pointerId === drag.id) drag.id = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    zoom += Math.sign(e.deltaY) * 0.1;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    push: (a) => acts.push(a),
    poll() {
      let right = 0;
      let fwd = 0;
      if (keys.has('f')) fwd += 1;
      if (keys.has('b')) fwd -= 1;
      if (keys.has('l')) right -= 1;
      if (keys.has('r')) right += 1;
      if (joy.id !== null && Math.hypot(joy.x, joy.y) > 0.15) {
        right += joy.x;
        fwd -= joy.y;
      }
      const m = Math.hypot(right, fwd);
      if (m > 1) {
        right /= m;
        fwd /= m;
      }
      const out = { right, fwd, camDX, camDY, zoom, acts: acts.splice(0) };
      camDX = 0;
      camDY = 0;
      zoom = 0;
      return out;
    },
  };
}
