// 조작: 키보드·마우스(PC), 가상 스틱·드래그·핀치(모바일).
// 여기서는 '무엇을 누르는지'만 모은다. 명령으로 바꾸는 일은 main.js가 한다.

const MOVE_KEYS = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
const ACT_KEYS = { e: 'interact', f: 'interact', h: 'recall', i: 'bag', b: 'bag', tab: 'bag', c: 'craft', k: 'skills', l: 'log', escape: 'close' };

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
    const k = e.key.toLowerCase();
    if (MOVE_KEYS[k]) {
      if (down) keys.add(MOVE_KEYS[k]);
      else keys.delete(MOVE_KEYS[k]);
      e.preventDefault();
      return;
    }
    if (down && !e.repeat && ACT_KEYS[k]) {
      acts.push(ACT_KEYS[k]);
      if (k === 'tab') e.preventDefault();
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

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 */ }
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
    if (e.pointerId === drag.id) {
      camDX += e.clientX - drag.lx;
      camDY += e.clientY - drag.ly;
      drag.lx = e.clientX;
      drag.ly = e.clientY;
    }
  });

  const end = (e) => {
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
