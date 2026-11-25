# 물건 아이콘 그리기(v2.2): 64×64 SVG 심볼을 한 파일(client/assets/icons/items.svg)로 만든다.
# 화풍: 짙은 밤색 외곽선, 왼쪽 위에서 오는 빛(밝은 면→어두운 면 그라데이션), 바닥 그림자, 가는 흰 윤기.
# 재질(나무 셋·금속 셋·가죽·천·돌)을 팔레트로 두고, 모양 틀(통나무·주괴·도끼…)에 입혀 같은 물건 무리는 같은 꼴로 보이게 한다.
# 실행: python3 tools/icons/items.py
import json, os, math, colorsys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'client', 'assets', 'icons', 'items.svg')
INK = '#1d130b'
SW = 2.2

# ── 색 ──
def _rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def _hex(c):
    return '#' + ''.join(f'{max(0, min(255, round(v * 255))):02x}' for v in c)
def shade(h, k):
    """k>0 밝게(흰색 쪽), k<0 어둡게. 색조는 살짝 따뜻/차갑게 옮긴다."""
    r, g, b = _rgb(h)
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    if k > 0:
        ll = ll + (1 - ll) * k
        hh = (hh - 0.01 * k) % 1
    else:
        ll = ll * (1 + k)
        ss = min(1, ss * (1 - k * 0.25))
        hh = (hh + 0.015 * -k) % 1
    return _hex(colorsys.hls_to_rgb(hh, ll, ss))

WOOD = {  # 껍질, 속, 결
    'drift': ('#8f8373', '#cbbb9f', '#6b6052'),
    'birch': ('#e9e2d0', '#f1dcb2', '#3a332c'),
    'oak': ('#6e4526', '#c68a52', '#4a2c15'),
    'plain': ('#8a5a33', '#c99560', '#5a3a1f'),
}
METAL = {
    'stone': ('#8f908a', '#b9b9b0'),
    'copper': ('#cf7438', '#f2b27a'),
    'iron': ('#7f93a3', '#d6e2ea'),
    'bronze': ('#b0813a', '#ecc98a'),
}
LEATHER = '#8a5a33'
CLOTH = '#c9b98d'
REED = '#c7b46a'
GEM = '#4fd1c5'

# ── 도우미 ──
class Sym:
    def __init__(self, sid):
        self.sid = sid
        self.defs = []
        self.body = []
        self.n = 0

    def gid(self):
        self.n += 1
        return f'{self.sid}-g{self.n}'

    def lin(self, color, k1=0.32, k2=-0.32, x1=0.15, y1=0.0, x2=0.85, y2=1.0):
        i = self.gid()
        self.defs.append(f'<linearGradient id="{i}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{shade(color, k1)}"/><stop offset=".55" stop-color="{color}"/><stop offset="1" stop-color="{shade(color, k2)}"/></linearGradient>')
        return f'url(#{i})'

    def rad(self, color, k1=0.45, k2=-0.35, cx=0.38, cy=0.32, r=0.75):
        i = self.gid()
        self.defs.append(f'<radialGradient id="{i}" cx="{cx}" cy="{cy}" r="{r}"><stop offset="0" stop-color="{shade(color, k1)}"/><stop offset=".6" stop-color="{color}"/><stop offset="1" stop-color="{shade(color, k2)}"/></radialGradient>')
        return f'url(#{i})'

    def glow(self, color, op=0.85):
        i = self.gid()
        self.defs.append(f'<radialGradient id="{i}"><stop offset="0" stop-color="{color}" stop-opacity="{op}"/><stop offset="1" stop-color="{color}" stop-opacity="0"/></radialGradient>')
        return f'url(#{i})'

    def add(self, s):
        self.body.append(s)
        return self

    def shadow(self, cx=32, cy=56, rx=18, ry=3.6, op=0.28):
        return self.add(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#000" opacity="{op}"/>')

    def svg(self):
        d = f'<defs>{"".join(self.defs)}</defs>' if self.defs else ''
        return f'<symbol id="it-{self.sid}" viewBox="0 0 64 64">{d}{"".join(self.body)}</symbol>'

def P(d, fill, sw=SW, stroke=INK, extra=''):
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round"{extra}/>'
def L(d, stroke, sw=1.4, op=1, extra=''):
    return f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" opacity="{op}"{extra}/>'
def C(cx, cy, r, fill, sw=SW, stroke=INK, extra=''):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{extra}/>'
def E(cx, cy, rx, ry, fill, sw=SW, stroke=INK, extra=''):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{extra}/>'
def R(x, y, w, h, fill, rx=0, sw=SW, stroke=INK, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"{extra}/>'
def HL(d, op=0.55, sw=1.6):
    """윤기(흰 가는 줄)"""
    return L(d, '#fff', sw, op)
def G(inner, t):
    return f'<g transform="{t}">{inner}</g>'
def poly(pts):
    return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + ' Z'

# ════════════════ 재료 ════════════════
def log(s, kind):
    bark, core, grain = WOOD[kind]
    s.shadow(32, 52, 22, 4)
    inner = P('M14,26 L44,20 A7,10 0 0 1 48,40 L18,46 A7,10 0 0 1 14,26 Z', s.lin(bark, 0.25, -0.35, 0, 0, 0, 1))
    if kind == 'birch':
        inner += L('M20,30 l6,-1.2 M30,35 l5,-1 M22,41 l4,-0.8 M36,27 l4,-0.8 M34,40 l6,-1.2', grain, 2.2, 0.85)
    else:
        inner += L('M18,31 Q30,27 44,25 M19,38 Q31,35 45,33 M24,43 Q34,41 44,39', grain, 1.3, 0.6)
    inner += HL('M17,25.5 L43,20.5', 0.35, 1.4)
    inner += E(46, 30, 6.2, 10, s.rad(core, 0.3, -0.25, 0.45, 0.4, 0.7))
    inner += L('M46,24.5 a3.6,5.6 0 1 1 -0.1,0 M46,27.5 a1.6,2.6 0 1 1 -0.1,0', shade(core, -0.35), 1.1, 0.8)
    s.add(inner)
    s.add(L('M40,14 l3,-4 M44,15 l4,-2', '#6a8f3a', 2.2, 0.9) if kind == 'oak' else '')

def lumber(s, kind):
    bark, core, grain = WOOD[kind]
    face = core if kind != 'birch' else '#ecd7ac'
    s.shadow(32, 53, 23, 3.8)
    def board(x, y, w, h, d, tone):
        top = poly([(x, y), (x + d, y - d * 0.55), (x + w + d, y - d * 0.55), (x + w, y)])
        front = poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])
        end = poly([(x + w, y), (x + w + d, y - d * 0.55), (x + w + d, y + h - d * 0.55), (x + w, y + h)])
        out = P(top, shade(face, 0.28 + tone)) + P(front, s.lin(shade(face, tone), 0.15, -0.2, 0, 0, 1, 0)) + P(end, shade(face, -0.25 + tone))
        out += L(f'M{x + 3},{y + h * 0.35} Q{x + w * 0.5},{y + h * 0.2} {x + w - 3},{y + h * 0.4} M{x + 4},{y + h * 0.7} Q{x + w * 0.55},{y + h * 0.85} {x + w - 6},{y + h * 0.65}', shade(face, -0.45), 1, 0.55)
        out += L(f'M{x + w + d * 0.5},{y + h * 0.3 - d * 0.27} l0,{h * 0.4}', shade(face, -0.5), 0.9, 0.6)
        return out
    s.add(board(10, 38, 36, 9, 9, -0.06))
    s.add(board(14, 27, 36, 9, 9, 0.0))
    s.add(board(8, 17, 34, 9, 9, 0.06) if kind != 'drift' else board(12, 17, 30, 9, 8, 0.04))

ROCK = [(13, 44), (11, 33), (18, 22), (32, 16), (46, 20), (54, 33), (48, 46), (28, 50)]
def rock(s, base, nug=None, glint=None):
    s.shadow(32, 52, 22, 4)
    s.add(P(poly(ROCK), s.lin(base, 0.3, -0.38, 0.1, 0, 0.9, 1)))
    s.add(L('M18,22 L26,32 L32,16 M26,32 L40,34 L46,20 M40,34 L48,46 M26,32 L20,44', shade(base, -0.35), 1.2, 0.7))
    s.add(P('M18,22 L26,32 L32,16 Z', shade(base, 0.35), 0, extra=' opacity=".55"'))
    s.add(HL('M15,32 L19,23 L31,17.5', 0.45, 1.4))
    if nug:
        for (x, y, r) in [(22, 38, 4.2), (36, 26, 3.6), (42, 40, 3.2), (30, 43, 2.4)]:
            pts = [(x + r * math.cos(a), y + r * 0.9 * math.sin(a)) for a in [i * math.pi / 3 + 0.3 for i in range(6)]]
            s.add(P(poly(pts), s.lin(nug, 0.45, -0.3), 1.4))
            s.add(C(x - r * 0.3, y - r * 0.35, r * 0.28, '#fff', 0, extra=' opacity=".7"'))

def ingot(s, metal):
    base, hi = METAL[metal]
    s.shadow(32, 50, 23, 4)
    def bar(dx, dy, k):
        top = poly([(20 + dx, 24 + dy), (44 + dx, 24 + dy), (49 + dx, 32 + dy), (15 + dx, 32 + dy)])
        front = poly([(15 + dx, 32 + dy), (49 + dx, 32 + dy), (52 + dx, 41 + dy), (12 + dx, 41 + dy)])
        out = P(front, s.lin(shade(base, k), 0.1, -0.35, 0, 0, 0, 1)) + P(top, s.lin(shade(hi, k), 0.25, -0.15, 0, 0, 1, 1))
        out += HL(f'M{21 + dx},{25.5 + dy} L{43 + dx},{25.5 + dy}', 0.7, 1.3)
        out += L(f'M{17 + dx},{36 + dy} L{47 + dx},{36 + dy}', shade(base, 0.35), 1, 0.5)
        return out
    s.add(bar(-4, 8, -0.08))
    s.add(bar(6, -2, 0.0))
    s.add(C(48, 18, 1.6, '#fff', 0, extra=' opacity=".9"') + L('M48,13.5 v9 M43.5,18 h9', '#fff', 1, 0.8))

def fiber(s):
    s.shadow(32, 55, 15, 3)
    stalks = ''
    for i, (x0, x1, c) in enumerate([(24, 14, -0.1), (28, 22, 0.05), (32, 31, 0.12), (36, 41, 0.0), (40, 50, -0.08)]):
        col = shade(REED, c)
        stalks += L(f'M{x0 + 2},54 Q{(x0 + x1) / 2},34 {x1},12', shade(col, -0.45), 3.6, 1)
        stalks += L(f'M{x0 + 2},54 Q{(x0 + x1) / 2},34 {x1},12', col, 2, 1)
        stalks += E(x1, 12, 2.2, 5, s.lin(shade(col, 0.1)), 1.2, extra=f' transform="rotate({(x1 - 32) * 1.4} {x1} 12)"')
    s.add(stalks)
    s.add(R(22, 38, 22, 6, s.lin('#8b5a2b'), 2, 1.8))
    s.add(L('M27,38 l-1.5,6 M33,38 l-1.5,6 M39,38 l-1.5,6', '#5a3a1f', 1, 0.8))

def berries(s, dried=False):
    s.shadow(32, 54, 18, 3.6)
    red = '#c0283a' if not dried else '#8a2a36'
    if dried:
        s.add(P('M10,44 Q32,58 54,44 L50,40 Q32,48 14,40 Z', s.lin('#b88a55'), 2))
    for (x, y, r) in [(24, 36, 9), (38, 34, 9.5), (31, 25, 8.5)]:
        if dried:
            s.add(P(f'M{x - r},{y} Q{x - r * 0.6},{y - r * 1.05} {x + r * 0.2},{y - r * 0.8} Q{x + r * 1.1},{y - r * 0.3} {x + r * 0.8},{y + r * 0.4} Q{x},{y + r * 1.1} {x - r},{y} Z', s.rad(red, 0.3, -0.3), 1.8))
            s.add(L(f'M{x - r * 0.4},{y - r * 0.2} q{r * 0.3},{r * 0.3} {r * 0.7},0', shade(red, -0.4), 1, 0.7))
        else:
            s.add(C(x, y, r, s.rad(red, 0.42, -0.4)))
            for (dx, dy) in [(-3, 2), (2, -2), (3, 3), (-1, -4)]:
                s.add(E(x + dx, y + dy, 0.7, 1, '#f7d45a', 0, extra=' opacity=".9"'))
            s.add(E(x - r * 0.4, y - r * 0.45, r * 0.25, r * 0.18, '#fff', 0, extra=' opacity=".75"'))
    s.add(P('M30,17 Q22,8 14,12 Q20,20 30,17 Z', s.lin('#4f8a3a'), 1.8))
    s.add(P('M32,17 Q40,6 49,10 Q43,19 32,17 Z', s.lin('#5b9a40'), 1.8))
    s.add(L('M31,18 l0,-6', '#3a5a22', 2))

def seaweed(s):
    s.shadow(32, 55, 16, 3)
    for (x, sway, col) in [(22, -8, '#3f8a4e'), (34, 6, '#4f9c55'), (44, -4, '#2f7a46')]:
        d = f'M{x - 3},54 C{x - 6 + sway},40 {x + 6 + sway},34 {x + sway * 0.5},12 C{x + 8 + sway},26 {x + 4},42 {x + 4},54 Z'
        s.add(P(d, s.lin(col, 0.3, -0.35), 1.8))
        s.add(L(f'M{x},53 C{x - 2 + sway},40 {x + 3 + sway},32 {x + sway * 0.5 + 1},16', shade(col, -0.4), 1, 0.7))
    for (x, y) in [(27, 30), (40, 24), (46, 38)]:
        s.add(C(x, y, 2.2, s.rad('#9fd36a', 0.4, -0.2), 1.2))

def mushroom(s):
    s.shadow(32, 55, 17, 3.4)
    s.add(P('M26,34 Q24,48 22,52 Q32,56 42,52 Q40,46 38,34 Z', s.lin('#efe3c8', 0.2, -0.25, 0, 0, 1, 0)))
    s.add(L('M27,44 Q32,46 37,44', '#bfa98a', 1, 0.7))
    s.add(P('M8,34 Q10,12 32,10 Q54,12 56,34 Q44,40 32,38 Q20,40 8,34 Z', s.lin('#b8432a', 0.3, -0.35)))
    for (x, y, r) in [(20, 22, 3.2), (34, 17, 2.6), (44, 26, 3), (28, 30, 2), (47, 33, 1.6), (15, 31, 1.8)]:
        s.add(E(x, y, r, r * 0.8, '#f6ecd8', 1, extra=' opacity=".95"'))
    s.add(HL('M14,24 Q20,14 32,13', 0.5, 1.6))

def hide(s):
    s.shadow(32, 55, 20, 3.4)
    d = 'M14,14 Q22,18 32,12 Q42,18 50,14 Q48,24 54,30 Q48,36 52,48 Q42,46 32,54 Q22,46 12,48 Q16,36 10,30 Q16,24 14,14 Z'
    s.add(P(d, s.lin('#8b5a35', 0.25, -0.3)))
    s.add(P('M22,22 Q32,18 42,22 Q46,32 42,42 Q32,46 22,42 Q18,32 22,22 Z', shade('#b07a4a', 0.05), 0, extra=' opacity=".8"'))
    s.add(L('M24,28 q4,2 8,0 M30,36 q4,2 8,0 M26,40 q3,1 5,0', '#6b4226', 1, 0.6))

def leather(s):
    s.shadow(32, 54, 22, 3.6)
    # 무두질한 가죽 두루마리: 몸통 + 말린 끝 + 펼쳐진 자락 + 끈 두 줄
    s.add(P('M8,42 L40,46 L52,38 L22,34 Z', s.lin('#9a6a3e', 0.25, -0.3)))
    s.add(P('M12,24 L42,20 Q50,20 50,30 Q50,40 42,40 L12,44 Q4,44 4,34 Q4,24 12,24 Z', s.lin(LEATHER, 0.3, -0.32, 0, 0, 0, 1)))
    s.add(E(43, 30, 7, 10, s.rad('#a8743f', 0.3, -0.35)))
    s.add(L('M43,23 a4,6 0 1 1 -0.1,0 M43,26.5 a1.8,2.8 0 1 1 -0.1,0', '#5c3a1f', 1, 0.8))
    for x in (17, 30):
        s.add(L(f'M{x},23 L{x + 1},44', INK, 4.6, 1) + L(f'M{x},23 L{x + 1},44', '#e3cf9c', 2.6, 1))
    s.add(L('M10,30 L38,26 M10,37 L38,33', shade(LEATHER, -0.35), 1, 0.5))
    s.add(HL('M10,26 L40,22', 0.4, 1.3))

def meat(s, cooked=False):
    s.shadow(32, 54, 20, 3.6)
    if cooked:
        s.add(P('M10,40 Q8,22 26,18 Q40,15 44,26 Q46,34 38,40 Q26,48 10,40 Z', s.rad('#9a4a22', 0.35, -0.35)))
        s.add(L('M18,26 l8,6 M24,22 l8,6 M30,20 l6,5', '#5a2810', 1.4, 0.6))
        s.add(P('M38,38 L50,48', '#f1e6d0', 6, '#f1e6d0'))
        s.add(L('M38,38 L50,48', INK, 9, 1) + L('M38,38 L50,48', '#efe4cc', 5.4, 1))
        s.add(C(51, 46, 3.4, '#efe4cc', 1.8) + C(48, 51, 3.4, '#efe4cc', 1.8))
        s.add(HL('M14,30 Q16,22 26,20', 0.45, 1.6))
    else:
        s.add(P('M8,32 Q10,16 30,16 Q52,16 56,30 Q56,46 36,48 Q14,50 8,32 Z', s.lin('#c64a4f', 0.3, -0.3)))
        s.add(L('M16,26 Q26,30 34,24 M20,38 Q30,34 42,40 M38,22 Q44,28 50,26', '#f3d0c8', 2, 0.85))
        s.add(C(40, 33, 5, '#f1e6d0', 1.8) + C(40, 33, 2, '#d8c8a8', 0))
        s.add(HL('M14,24 Q20,18 30,18', 0.45, 1.6))

def jar(s, liquid, glass='#cfe8ee', cork='#a8784a', label=None, drip=False):
    s.shadow(32, 56, 15, 3)
    s.add(P('M22,20 L42,20 L44,26 Q48,30 48,38 L48,48 Q48,54 42,54 L22,54 Q16,54 16,48 L16,38 Q16,30 20,26 Z', s.lin(glass, 0.2, -0.25), 2, extra=' fill-opacity=".55"'))
    s.add(P('M18,36 L46,36 L46,48 Q46,52 42,52 L22,52 Q18,52 18,48 Z', s.lin(liquid, 0.25, -0.35), 0))
    s.add(L('M18,36 L46,36', shade(liquid, 0.35), 1.4, 0.9))
    s.add(R(24, 13, 16, 8, s.lin(cork, 0.25, -0.3), 2, 2))
    if label:
        s.add(R(22, 38, 20, 9, '#efe2c0', 1.5, 1.4) + L('M25,42.5 h14', '#a0703a', 1.2, 0.7))
    if drip:
        s.add(P('M42,20 Q46,22 46,28 Q44,31 42,28 Z', s.lin(liquid), 1.4))
    s.add(HL('M21,30 Q19,38 20,48', 0.6, 2))
    s.add(P('M16,38 L16,48 Q16,54 22,54 L42,54 Q48,54 48,48 L48,38', 'none', 2))

def sand(s):
    s.shadow(32, 55, 21, 3.4)
    s.add(P('M8,52 Q20,40 34,46 Q46,40 58,52 Z', s.lin('#e3cd94', 0.25, -0.25)))
    s.add(P('M18,46 Q14,30 22,22 L20,16 L36,16 L34,22 Q44,30 40,46 Q30,50 18,46 Z', s.lin('#bfa77a', 0.25, -0.3)))
    s.add(L('M20,23 Q28,26 36,23', '#7a5a35', 2.4, 1))
    s.add(P('M22,16 Q28,10 34,16', 'none', 1.8))
    for (x, y) in [(24, 50), (30, 47), (38, 49), (44, 51), (16, 51)]:
        s.add(C(x, y, 0.9, '#a88a55', 0))
    s.add(HL('M22,30 Q20,38 22,44', 0.4, 1.4))

def crystal(s, col, glow=False, cluster=True):
    s.shadow(32, 55, 17, 3.4)
    if glow:
        s.add(C(32, 32, 24, s.glow(shade(col, 0.4), 0.55), 0))
    def prism(x, y, w, h, tilt, k):
        t = f'rotate({tilt} {x} {y + h})'
        pts = [(x - w, y + h), (x - w, y + w * 0.6), (x, y), (x + w, y + w * 0.6), (x + w, y + h)]
        out = P(poly(pts), s.lin(shade(col, k), 0.35, -0.35, 0, 0, 1, 0.3))
        out += P(poly([(x - w, y + w * 0.6), (x, y), (x, y + h)]), shade(col, 0.45 + k), 0, extra=' opacity=".5"')
        out += L(f'M{x},{y} L{x},{y + h}', shade(col, -0.4), 1, 0.6)
        return G(out, t)
    if cluster:
        s.add(prism(22, 24, 6, 26, -18, -0.1) + prism(42, 22, 6.5, 28, 16, -0.05) + prism(32, 10, 8, 42, 0, 0.05))
    else:
        s.add(prism(32, 10, 10, 40, 8, 0))
    s.add(L('M28,18 l2,-4 M36,30 l1,-6', '#fff', 1.6, 0.85))

def sprout(s, glow=False):
    s.shadow(32, 55, 15, 3)
    if glow:
        s.add(C(32, 38, 20, s.glow('#ffe39a', 0.7), 0))
    s.add(E(32, 44, 11, 8.5, s.rad('#8a5a2c' if not glow else '#c9963c', 0.4, -0.35), extra=' transform="rotate(-12 32 44)"'))
    s.add(L('M27,40 Q32,38 37,41', shade('#8a5a2c', -0.4), 1, 0.7))
    s.add(L('M32,37 Q31,28 33,20', '#3f7a2a', 2.6))
    s.add(P('M33,24 Q42,14 50,18 Q44,28 33,24 Z', s.lin('#6fb04a'), 1.8))
    s.add(P('M32,28 Q22,20 15,24 Q22,32 32,28 Z', s.lin('#5ea040'), 1.8))
    if glow:
        for (x, y) in [(18, 14), (48, 32), (14, 40), (50, 10)]:
            s.add(L(f'M{x},{y - 3} v6 M{x - 3},{y} h6', '#fff3c0', 1.2, 0.9))

def cloth(s, col=CLOTH, stripe='#7a8a5a'):
    s.shadow(32, 54, 22, 3.6)
    def fold(y, k):
        top = poly([(12, y), (40, y - 6), (54, y + 0), (26, y + 6)])
        front = poly([(12, y), (26, y + 6), (26, y + 13), (12, y + 7)])
        side = poly([(26, y + 6), (54, y), (54, y + 7), (26, y + 13)])
        return P(top, s.lin(shade(col, 0.15 + k), 0.2, -0.1)) + P(front, shade(col, -0.18 + k)) + P(side, s.lin(shade(col, -0.05 + k), 0.1, -0.25, 0, 0, 1, 0)) + L(f'M30,{y + 9.5} L52,{y + 3.5}', stripe, 1.6, 0.7)
    s.add(fold(36, -0.05) + fold(27, 0) + fold(18, 0.05))
    s.add(HL('M15,18 L39,12.5', 0.4, 1.2))

def nails(s):
    s.shadow(32, 54, 18, 3.2)
    col = METAL['copper'][0]
    for (x, y, ang) in [(20, 30, 30), (32, 26, -20), (42, 32, 15)]:
        t = f'rotate({ang} {x} {y})'
        nail = P(f'M{x - 1.8},{y - 10} L{x + 1.8},{y - 10} L{x + 1.2},{y + 14} L{x},{y + 19} L{x - 1.2},{y + 14} Z', s.lin(col, 0.35, -0.3, 0, 0, 1, 0), 1.6)
        nail += E(x, y - 11, 5.2, 2.2, s.lin(METAL['copper'][1], 0.2, -0.35), 1.6)
        s.add(G(nail, t))

def stakes(s):
    s.shadow(32, 56, 18, 3.2)
    for (x, tilt, k) in [(22, -8, -0.08), (32, 0, 0.05), (42, 8, -0.02)]:
        st = P(f'M{x - 4},44 L{x - 4},14 L{x + 4},14 L{x + 4},44 L{x},54 Z', s.lin(shade('#a77446', k), 0.25, -0.3, 0, 0, 1, 0), 1.8)
        st += P(f'M{x - 4},44 L{x},54 L{x + 4},44 Z', shade('#d4a36a', k), 1.4)
        st += L(f'M{x - 1.5},18 L{x - 1.5},40', '#6b4428', 0.9, 0.6)
        s.add(G(st, f'rotate({tilt} {x} 44)'))
    s.add(P('M16,28 Q32,34 48,28 L48,33 Q32,39 16,33 Z', s.lin('#c2a368'), 1.6))

# ════════════════ 도구·무기 ════════════════
def handle(s, x1, y1, x2, y2, w=5, wood='plain', wrap=None):
    bark, core, grain = WOOD[wood]
    col = bark if wood != 'birch' else '#e2d7bd'
    out = L(f'M{x1},{y1} L{x2},{y2}', INK, w + 2.4, 1)
    out += L(f'M{x1},{y1} L{x2},{y2}', col, w, 1)
    out += L(f'M{x1},{y1} L{x2},{y2}', shade(col, 0.35), w * 0.32, 0.8, extra=f' transform="translate({-w * 0.22},{-w * 0.22})"')
    if wrap:
        mx, my = x1 + (x2 - x1) * 0.18, y1 + (y2 - y1) * 0.18
        nx, ny = x1 + (x2 - x1) * 0.3, y1 + (y2 - y1) * 0.3
        out += L(f'M{mx},{my} L{nx},{ny}', INK, w + 3.4, 1) + L(f'M{mx},{my} L{nx},{ny}', wrap, w + 1.2, 1)
        for t in (0.2, 0.24, 0.28):
            px, py = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
            out += L(f'M{px - 2.6},{py - 1.6} l5,3', shade(wrap, -0.45), 1, 0.7)
    s.add(out)

def metal_fill(s, metal):
    base, hi = METAL[metal]
    return s.lin(base, 0.35, -0.35), hi

def axe(s, metal, big=False):
    s.shadow(30, 56, 18, 3.2)
    handle(s, 14, 54, 44, 12 if not big else 8, 5 if not big else 5.6, 'plain', '#7a4a28' if big else None)
    fill, hi = metal_fill(s, metal)
    if metal == 'stone':
        head = 'M36,10 L48,6 L56,16 L54,28 L44,30 L38,22 Z'
        s.add(P(head, fill) + L('M48,8 L52,18 M44,24 L52,22', shade(METAL['stone'][0], -0.35), 1, 0.7))
        s.add(L('M38,16 L46,18 M38,22 L44,24', '#7a5a3a', 2.4, 1))
    elif big:
        head = 'M38,6 Q50,-1 60,10 Q58,22 52,26 L44,16 L40,20 Q34,10 38,6 Z'
        head2 = 'M40,14 L30,8 Q22,12 22,22 Q30,22 36,20 Z'
        s.add(P(head2, fill) + P(head, fill))
        s.add(HL('M42,6.5 Q50,2 58,10', 0.85, 1.6) + HL('M31,10 Q25,13 24,20', 0.6, 1.3))
    else:
        head = 'M38,10 L46,8 Q56,8 58,18 Q58,28 50,30 L44,22 L40,24 Z'
        s.add(P(head, fill))
        s.add(HL('M50,10 Q57,12 57,20', 0.85, 1.6))
        s.add(L('M44,22 L40,14', shade(METAL[metal][0], -0.4), 1, 0.6))

def pick(s, metal):
    s.shadow(30, 56, 18, 3.2)
    handle(s, 16, 56, 40, 14, 5)
    fill, hi = metal_fill(s, metal)
    head = 'M12,22 Q24,8 40,10 Q54,12 60,26 Q50,18 40,18 Q26,18 12,22 Z'
    if metal == 'stone':
        head = 'M14,24 Q22,12 34,11 L44,12 Q54,14 58,26 Q50,20 42,19 L34,19 Q24,19 14,24 Z'
    s.add(P(head, fill))
    s.add(R(36, 9, 8, 12, s.lin('#7a5a3a'), 2, 1.8, extra=' transform="rotate(16 40 15)"'))
    s.add(HL('M16,20 Q24,12 34,12', 0.7, 1.4))

def sickle(s, metal):
    s.shadow(28, 56, 16, 3)
    handle(s, 14, 56, 26, 34, 5.4, 'plain', '#6b4428')
    fill, hi = metal_fill(s, metal)
    blade = 'M24,34 Q18,14 34,8 Q52,4 56,20 Q48,12 38,14 Q28,18 30,34 Z'
    s.add(P(blade, fill))
    s.add(HL('M34,9.5 Q48,6 54,16', 0.85, 1.4))
    s.add(C(27, 34, 2.4, s.lin('#9a9a90'), 1.4))

def club(s):
    s.shadow(30, 56, 18, 3.2)
    s.add(P('M12,54 L16,58 L34,32 Q46,22 52,10 Q46,4 38,10 Q28,22 28,28 Z', s.lin('#8a5a30', 0.3, -0.35)))
    for (x, y, r) in [(42, 14, 4), (46, 22, 3.4), (36, 22, 3)]:
        s.add(P(poly([(x + r * math.cos(a), y + r * math.sin(a)) for a in [i * 2.1 + 0.4 for i in range(3)]]), s.lin('#9a9a92'), 1.4))
    s.add(L('M18,50 l4,-5 M21,47 l4,3', '#5a3a1f', 1.6, 0.8))
    s.add(HL('M40,10 Q48,6 50,10', 0.5, 1.4))

def sword_shield(s, metal):
    s.shadow(32, 57, 22, 3.6)
    rim = METAL[metal][0]
    s.add(C(24, 32, 17, s.rad('#8a5a32', 0.3, -0.35)))
    s.add(C(24, 32, 17, 'none', 3.4, rim) + C(24, 32, 17, 'none', 1.4, INK) + C(24, 32, 19, 'none', 1.4, INK))
    s.add(L('M13,24 L35,40 M13,40 L35,24', shade('#8a5a32', -0.4), 1.2, 0.5))
    s.add(C(24, 32, 4.4, s.rad(METAL[metal][1], 0.4, -0.3), 1.6))
    fill, hi = metal_fill(s, metal)
    blade = 'M33,46 L53,10 L56,8 L55,12 L36,48 Z'
    s.add(P(blade, fill, 1.8))
    s.add(L('M35,46 L54,10', '#fff', 1, 0.7))
    s.add(L('M28,42 L40,50', INK, 6, 1) + L('M28,42 L40,50', METAL[metal][1], 3.6, 1))
    s.add(L('M33,49 L28,58', INK, 6, 1) + L('M33,49 L28,58', '#6b4428', 3.6, 1))
    s.add(C(27.5, 58.5, 2.2, s.lin(METAL[metal][1]), 1.4))

def spear(s, metal):
    s.shadow(30, 57, 16, 3)
    handle(s, 10, 58, 44, 18, 4, 'plain')
    fill, hi = metal_fill(s, metal)
    s.add(P('M42,20 Q44,10 56,4 Q52,16 46,22 Z', fill, 1.8))
    s.add(L('M44,19 L54,7', '#fff', 1, 0.75))
    s.add(L('M40,22 L46,26', INK, 5, 1) + L('M40,22 L46,26', '#b02a2a', 3, 1))
    s.add(P('M41,24 Q36,32 38,38 Q42,32 44,26 Z', s.lin('#c33a2e'), 1.4))

def hammer(s, metal):
    s.shadow(30, 56, 18, 3.2)
    handle(s, 14, 56, 38, 18, 5, 'plain', '#6b4428')
    fill, hi = metal_fill(s, metal)
    head = poly([(26, 10), (48, 22), (42, 34), (20, 22)])
    s.add(P(head, fill))
    s.add(P(poly([(26, 10), (48, 22), (52, 16), (30, 4)]), s.lin(METAL[metal][1], 0.2, -0.2), 1.8))
    s.add(P(poly([(48, 22), (52, 16), (46, 28), (42, 34)]), shade(METAL[metal][0], -0.3), 1.8))
    s.add(L('M24,18 L44,28', shade(METAL[metal][0], 0.35), 1.2, 0.7))

def bow(s, wood):
    s.shadow(32, 57, 18, 3)
    col = WOOD[wood][0] if wood != 'birch' else '#d8ccb0'
    limb = 'M18,6 Q50,14 50,32 Q50,50 18,58'
    s.add(L('M18,6 L18,58', '#efe8d6', 1.2, 1))
    s.add(L(limb, INK, 7, 1) + L(limb, col, 4.6, 1) + L('M20,7.5 Q47,15 47.5,30', shade(col, 0.4), 1.4, 0.8))
    s.add(L('M47,27 L51,37', INK, 7.4, 1) + L('M47,27 L51,37', '#6b4428', 5, 1))
    if wood == 'oak':
        s.add(P('M18,6 Q12,4 10,8 Q14,8 18,9 Z', '#efe4c8', 1.4) + P('M18,58 Q12,60 10,56 Q14,56 18,55 Z', '#efe4c8', 1.4))
    s.add(L('M18,32 L40,32', '#8a6a4a', 1.6, 1) + P('M40,32 L35,29 L35,35 Z', '#9aa0a6', 1) + P('M18,32 L14,29 L16,32 L14,35 Z', '#c44', 1))

def staff(s, wood):
    s.shadow(30, 57, 14, 3)
    handle(s, 14, 58, 40, 14, 4.4, wood)
    if wood == 'oak':
        s.add(C(44, 10, 13, s.glow('#7ff0e0', 0.55), 0))
        s.add(L('M38,18 Q34,8 42,4 M40,16 Q50,14 50,6', INK, 4, 1) + L('M38,18 Q34,8 42,4 M40,16 Q50,14 50,6', WOOD['oak'][0], 2.4, 1))
        s.add(P(poly([(44, 2), (49, 8), (44, 16), (39, 8)]), s.lin(GEM, 0.45, -0.3), 1.6))
    else:
        s.add(C(42, 12, 10, s.glow('#b6ff9a', 0.5), 0))
        s.add(P('M38,16 Q36,8 42,6 Q48,8 46,16 Z', s.lin('#6fd36a', 0.45, -0.3), 1.6))
    s.add(L('M20,50 l6,-6', '#7a4a28', 5, 1))

# ════════════════ 갑옷 ════════════════
def hood(s, col, trim):
    s.shadow(32, 56, 18, 3)
    s.add(P('M12,52 Q10,26 22,14 Q32,6 42,14 Q54,26 52,52 Q46,46 42,48 Q44,30 32,24 Q20,30 22,48 Q18,46 12,52 Z', s.lin(col, 0.3, -0.35)))
    s.add(P('M22,48 Q20,30 32,24 Q44,30 42,48 Q32,52 22,48 Z', shade(col, -0.55)))
    s.add(L('M14,50 Q32,58 50,50', trim, 2.6, 1))
    s.add(HL('M18,26 Q24,14 34,11', 0.45, 1.6))

def vest(s, col):
    s.shadow(32, 57, 18, 3)
    s.add(P('M18,10 L26,12 Q32,22 38,12 L46,10 L52,18 L50,52 Q32,56 14,52 L12,18 Z', s.lin(col, 0.28, -0.35)))
    s.add(L('M32,22 L32,52', INK, 1.6, 1))
    for y in (28, 34, 40, 46):
        s.add(L(f'M29,{y} L35,{y + 3} M35,{y} L29,{y + 3}', '#e8d6a8', 1.3, 0.95))
    s.add(L('M14,30 Q22,32 26,28 M50,30 Q42,32 38,28', shade(col, -0.4), 1.2, 0.8))
    s.add(HL('M16,18 L24,14', 0.5, 1.4))

def pants(s, col, metal=False):
    s.shadow(32, 58, 18, 3)
    s.add(P('M16,8 L48,8 L52,54 L38,54 L33,22 L31,22 L26,54 L12,54 Z', s.lin(col, 0.28, -0.35)))
    s.add(R(16, 8, 32, 6, shade(col, -0.25), 1, 1.8))
    if metal:
        s.add(P('M14,30 L28,30 L27,42 L13,42 Z', s.lin(METAL['iron'][1], 0.2, -0.3), 1.6) + P('M36,30 L50,30 L51,42 L37,42 Z', s.lin(METAL['iron'][1], 0.2, -0.3), 1.6))
    else:
        s.add(L('M20,24 Q22,36 20,50 M44,24 Q42,36 44,50', shade(col, -0.35), 1, 0.7))
    s.add(HL('M18,16 L20,48', 0.35, 1.4))

def robe(s):
    s.shadow(32, 58, 20, 3)
    col = '#3e5a6a'
    # 소매
    s.add(P('M20,14 L8,34 L14,38 L22,26 Z', s.lin(shade(col, -0.08), 0.25, -0.35)) + P('M44,14 L56,34 L50,38 L42,26 Z', s.lin(shade(col, -0.15), 0.2, -0.35)))
    # 몸판(아래로 퍼진다)
    s.add(P('M20,12 Q32,18 44,12 L46,30 L52,56 L12,56 L18,30 Z', s.lin(col, 0.3, -0.35)))
    # 두건(등 뒤로 넘긴)
    s.add(P('M22,13 Q22,4 32,4 Q42,4 42,13 Q32,20 22,13 Z', s.lin(shade(col, 0.1), 0.3, -0.3)))
    s.add(P('M26,13 Q32,22 38,13', 'none', 1.6))
    s.add(R(17, 30, 30, 5, s.lin('#c8a050'), 1, 1.6))
    s.add(L('M30,35 L28,48 M34,35 L37,47', '#c8a050', 1.6, 0.9))
    s.add(L('M32,22 L32,30 M32,35 L32,56', shade(col, -0.45), 1.2, 0.7))
    s.add(L('M13,54 L51,54', '#c8a050', 1.8, 0.85))
    s.add(HL('M21,16 L19,28', 0.45, 1.4))

def helm(s):
    s.shadow(32, 56, 18, 3)
    fill = s.lin(METAL['iron'][0], 0.4, -0.35)
    s.add(P('M12,40 Q10,14 32,10 Q54,14 52,40 L46,40 L46,32 L18,32 L18,40 Z', fill))
    s.add(R(10, 38, 44, 8, s.lin(METAL['iron'][0], 0.2, -0.35), 3))
    s.add(P('M29,32 L35,32 L34,52 L30,52 Z', s.lin(METAL['iron'][1], 0.2, -0.3), 1.6))
    s.add(L('M32,10 L32,30', shade(METAL['iron'][0], -0.35), 2, 0.8))
    for x in (16, 24, 40, 48):
        s.add(C(x, 42, 1.2, '#e8eef2', 0))
    s.add(HL('M18,24 Q22,14 30,12.5', 0.75, 1.8))

def cuirass(s):
    s.shadow(32, 58, 19, 3)
    fill = s.lin(METAL['iron'][0], 0.4, -0.35)
    s.add(P('M12,12 L24,8 Q32,14 40,8 L52,12 L50,28 Q52,42 46,54 Q32,58 18,54 Q12,42 14,28 Z', fill))
    s.add(L('M32,14 L32,54', shade(METAL['iron'][0], -0.4), 1.4, 0.8))
    s.add(L('M16,30 Q32,36 48,30 M18,42 Q32,47 46,42', shade(METAL['iron'][0], -0.35), 1.4, 0.8))
    s.add(P('M12,12 L24,8 L22,18 L10,20 Z', s.lin(METAL['iron'][1], 0.15, -0.3), 1.6) + P('M52,12 L40,8 L42,18 L54,20 Z', s.lin(METAL['iron'][1], 0.15, -0.3), 1.6))
    s.add(HL('M18,22 Q22,16 28,14', 0.75, 1.8))

def greaves(s):
    s.shadow(32, 58, 20, 3)
    for (x, k, flip) in [(21, 0, -1), (43, -0.07, 1)]:
        base = shade(METAL['iron'][0], k)
        fill = s.lin(base, 0.4, -0.35)
        # 정강이판: 위는 좁고 무릎에서 둥글게, 발등으로 꺾인다
        s.add(P(f'M{x - 6},10 Q{x},7 {x + 6},10 L{x + 7},38 Q{x + 7},46 {x + 6 + flip * 6},50 L{x + 6 + flip * 8},55 L{x - 7},55 L{x - 6},40 Z', fill))
        s.add(L(f'M{x - 6},22 Q{x},18 {x + 6},22 M{x - 6},27 Q{x},23 {x + 6},27', shade(base, -0.45), 1.3, 0.85))
        s.add(L(f'M{x - 2},11 L{x - 2},20', '#fff', 1.4, 0.5))
        s.add(L(f'M{x - 6},15 Q{x},13 {x + 6},15 M{x - 6},42 L{x + 7},42', shade(base, -0.45), 1.2, 0.8))
        s.add(L(f'M{x - 9},33 L{x + 9},33', INK, 3.4, 1) + L(f'M{x - 9},33 L{x + 9},33', '#7a4a28', 1.8, 1))
        s.add(HL(f'M{x - 4},30 L{x - 4},40', 0.6, 1.3))

# ════════════════ 가구·정표 ════════════════
def crate(s, label=False):
    s.shadow(32, 55, 22, 3.6)
    w = '#b98a52'
    top = poly([(12, 22), (32, 14), (52, 22), (32, 30)])
    left = poly([(12, 22), (32, 30), (32, 54), (12, 46)])
    right = poly([(32, 30), (52, 22), (52, 46), (32, 54)])
    s.add(P(left, s.lin(shade(w, -0.05), 0.1, -0.2, 0, 0, 1, 0)) + P(right, s.lin(shade(w, -0.22), 0.05, -0.2, 0, 0, 1, 0)) + P(top, shade(w, 0.25)))
    s.add(L('M12,30 L32,38 L52,30 M12,38 L32,46 L52,38', shade(w, -0.5), 1, 0.7))
    s.add(L('M14,24 L30,52 M50,24 L34,52', shade(w, -0.45), 2.2, 0.9))
    if label:
        s.add(P(poly([(36, 34), (48, 29), (48, 38), (36, 43)]), '#efe2c0', 1.4) + L('M39,36 L45,33.5', '#a0703a', 1.2, 0.8))
    s.add(HL('M15,22 L32,15', 0.5, 1.3))

def stool(s):
    s.shadow(32, 57, 18, 3.2)
    w = '#a57444'
    for (x1, x2) in [(18, 14), (46, 50), (32, 32)]:
        s.add(L(f'M{x1},30 L{x2},54', INK, 6.4, 1) + L(f'M{x1},30 L{x2},54', shade(w, -0.1), 4, 1))
    s.add(E(32, 28, 20, 8, s.lin(shade(w, 0.1), 0.3, -0.3)))
    s.add(E(32, 26, 20, 7, s.rad(shade(w, 0.15), 0.35, -0.15), 1.8))
    s.add(L('M18,26 Q32,30 46,26', shade(w, -0.4), 1, 0.6))

def table(s):
    s.shadow(32, 57, 24, 3.4)
    w = '#9a6a3c'
    for (x, y) in [(14, 34), (50, 34), (22, 40), (42, 40)]:
        s.add(L(f'M{x},{y} L{x},{y + 16}', INK, 6, 1) + L(f'M{x},{y} L{x},{y + 16}', shade(w, -0.15), 3.6, 1))
    s.add(P(poly([(8, 30), (30, 20), (58, 28), (36, 40)]), s.lin(shade(w, 0.2), 0.3, -0.25)))
    s.add(P(poly([(8, 30), (36, 40), (36, 44), (8, 34)]), shade(w, -0.25)) + P(poly([(36, 40), (58, 28), (58, 32), (36, 44)]), shade(w, -0.4)))
    s.add(L('M14,30 L36,22 M20,33 L44,24', shade(w, -0.35), 0.9, 0.6))

def bed(s, quilt=None):
    s.shadow(32, 56, 25, 3.4)
    frame = '#8a5a32'
    s.add(P(poly([(6, 36), (34, 24), (58, 34), (30, 48)]), s.lin('#d8c48a' if not quilt else '#efe2c0', 0.25, -0.2)))
    s.add(P(poly([(6, 36), (30, 48), (30, 54), (6, 42)]), shade(frame, -0.05)) + P(poly([(30, 48), (58, 34), (58, 40), (30, 54)]), shade(frame, -0.3)))
    s.add(E(18, 30, 9, 4.6, s.lin('#f2ead8', 0.3, -0.2), 1.8, extra=' transform="rotate(-20 18 30)"'))
    if quilt:
        cols = quilt
        s.add(P(poly([(22, 34), (40, 26), (58, 34), (40, 44)]), s.lin(cols[0], 0.2, -0.25)))
        s.add(P(poly([(31, 30), (40, 26), (49, 30), (40, 35)]), cols[1], 1.2) + P(poly([(40, 35), (49, 30), (58, 34), (49, 39)]), cols[2], 1.2))
        s.add(P(poly([(22, 34), (31, 30), (40, 35), (31, 39)]), cols[2], 1.2))
    else:
        s.add(P(poly([(24, 34), (40, 27), (58, 34), (42, 42)]), s.lin('#7a8f6a', 0.2, -0.25)))
        s.add(L('M8,36 l3,-1 M12,38 l4,-1 M50,38 l3,-1', '#b09a58', 1.2, 0.8))
    s.add(L('M6,36 L6,28 M58,34 L58,26', INK, 4.4, 1) + L('M6,36 L6,28 M58,34 L58,26', frame, 2.4, 1))

def oil_lamp(s, metal='copper'):
    s.shadow(32, 56, 16, 3)
    s.add(C(32, 18, 14, s.glow('#ffcf6a', 0.7), 0))
    s.add(P('M32,8 Q38,16 34,24 Q32,26 30,24 Q26,16 32,8 Z', s.lin('#ffd36a', 0.5, -0.1), 1.4))
    s.add(P('M32,14 Q34,18 32,22 Q30,18 32,14 Z', '#fff4c8', 0))
    s.add(P('M12,32 Q32,40 52,32 Q50,42 32,44 Q14,42 12,32 Z', s.lin(METAL[metal][0], 0.35, -0.35)))
    s.add(P('M26,43 L38,43 L40,50 L24,50 Z', s.lin(METAL[metal][0], 0.25, -0.35), 1.8))
    s.add(R(20, 50, 24, 4, s.lin(METAL[metal][0], 0.2, -0.3), 1.5, 1.8))
    s.add(L('M50,34 Q58,32 56,26', INK, 4.2, 1) + L('M50,34 Q58,32 56,26', METAL[metal][0], 2.2, 1))
    s.add(HL('M16,33 Q24,37 32,37.5', 0.7, 1.4))

def rug(s):
    s.shadow(32, 54, 25, 3.2)
    s.add(P(poly([(6, 36), (34, 22), (58, 32), (30, 48)]), s.lin('#a8493a', 0.25, -0.3)))
    s.add(P(poly([(14, 36), (34, 26), (50, 32), (30, 43)]), 'none', 1.6, '#e8c78a'))
    s.add(P(poly([(24, 35), (34, 30), (40, 33), (30, 38)]), '#e8c78a', 1.2))
    s.add(L('M6,36 l-2,2 M10,38 l-2,2 M14,40 l-2,2 M18,42 l-2,2 M22,44 l-2,2 M26,46 l-2,2 M58,32 l2,1 M54,30 l2,1 M50,28 l2,1 M46,26 l2,1', '#e8c78a', 1.3, 0.9))

def shelf(s):
    s.shadow(32, 57, 20, 3)
    w = '#8f5f35'
    s.add(R(12, 8, 6, 48, s.lin(w, 0.2, -0.3), 1) + R(46, 8, 6, 48, s.lin(w, 0.2, -0.3), 1))
    for y in (18, 34, 50):
        s.add(R(10, y, 44, 5, s.lin(shade(w, 0.12), 0.2, -0.3), 1))
    s.add(R(20, 9, 7, 9, s.lin('#4a6a8a'), 1, 1.6) + R(28, 11, 6, 7, s.lin('#8a3a3a'), 1, 1.6) + C(42, 14, 4, s.rad('#c9a24a'), 1.6))
    s.add(E(24, 29, 5, 5, s.rad('#b88a52'), 1.6) + R(34, 25, 10, 9, s.lin('#d8c8a0'), 1, 1.6))

def pot(s):
    s.shadow(32, 57, 21, 3.4)
    for (x, y) in [(24, 12), (32, 8), (40, 12)]:
        s.add(L(f'M{x},{y + 8} Q{x - 3},{y + 4} {x},{y} Q{x + 3},{y - 4} {x},{y - 6}', '#fff', 1.8, 0.5))
    iron = '#4a4f55'
    s.add(P('M10,26 Q10,52 32,54 Q54,52 54,26 Z', s.lin(iron, 0.35, -0.3)))
    s.add(E(32, 26, 22, 6, s.lin(iron, 0.2, -0.3)))
    s.add(E(32, 26, 18, 4.2, s.rad('#c8783a', 0.3, -0.2), 1.4))
    s.add(C(26, 25.5, 2, '#3f8a4e', 1) + C(37, 26.5, 2.2, '#b8432a', 1))
    s.add(L('M8,30 Q4,30 6,36 M56,30 Q60,30 58,36', INK, 4, 1) + L('M8,30 Q4,30 6,36 M56,30 Q60,30 58,36', iron, 2, 1))
    s.add(HL('M14,32 Q14,44 22,50', 0.45, 1.6))

def owl(s):
    s.shadow(32, 58, 16, 3)
    w = '#a9763f'
    s.add(P('M16,54 Q12,30 18,16 L22,8 L28,14 Q32,12 36,14 L42,8 L46,16 Q52,30 48,54 Z', s.lin(w, 0.3, -0.35)))
    s.add(C(25, 24, 6.4, s.rad('#e8c890', 0.3, -0.2), 1.6) + C(39, 24, 6.4, s.rad('#e8c890', 0.3, -0.2), 1.6))
    s.add(C(25, 24, 2.6, INK, 0) + C(39, 24, 2.6, INK, 0) + C(24, 23, 0.9, '#fff', 0) + C(38, 23, 0.9, '#fff', 0))
    s.add(P('M30,30 L34,30 L32,35 Z', '#d89a3a', 1.2))
    s.add(L('M24,40 q4,3 8,0 q4,3 8,0 M22,46 q5,3 10,0 q5,3 10,0', shade(w, -0.45), 1.2, 0.8))
    s.add(R(14, 52, 36, 5, s.lin(shade(w, -0.2)), 1.5, 1.8))

def ship(s):
    s.shadow(32, 57, 24, 3.2)
    s.add(L('M30,12 L30,44', INK, 3.6, 1) + L('M30,12 L30,44', '#7a4a28', 1.8, 1))
    s.add(P('M31,12 Q48,20 46,38 L31,38 Z', s.lin('#efe6cf', 0.2, -0.25), 1.8))
    s.add(P('M29,16 Q16,26 18,38 L29,38 Z', s.lin('#e4d8bc', 0.2, -0.25), 1.8))
    s.add(P('M28,8 L36,10 L28,12 Z', '#b02a2a', 1.2))
    s.add(P('M6,40 L58,40 Q54,52 40,54 L22,54 Q10,52 6,40 Z', s.lin('#8a5a30', 0.3, -0.35)))
    s.add(L('M10,45 L54,45', shade('#8a5a30', 0.35), 1.2, 0.7))
    s.add(R(24, 54, 16, 4, s.lin('#5a3a1f'), 1, 1.6))

def anvil(s):
    s.shadow(32, 57, 22, 3.2)
    iron = '#5b636b'
    s.add(P('M8,20 L50,20 Q60,20 58,26 Q50,28 46,30 L44,36 L20,36 L18,30 Q8,28 8,20 Z', s.lin(iron, 0.4, -0.35)))
    s.add(P('M22,36 L42,36 L46,48 L18,48 Z', s.lin(iron, 0.25, -0.35)))
    s.add(R(12, 48, 40, 6, s.lin(shade(iron, -0.1)), 1.5))
    s.add(HL('M10,21.5 L50,21.5', 0.75, 1.6))
    s.add(L('M44,8 L50,16', INK, 5.4, 1) + L('M44,8 L50,16', '#7a4a28', 3, 1) + R(36, 4, 10, 6, s.lin('#8a929a'), 1, 1.6, extra=' transform="rotate(-35 41 7)"'))

def horn(s):
    s.shadow(32, 56, 20, 3)
    s.add(P('M10,40 Q12,20 34,14 Q52,10 56,22 L50,26 Q44,20 34,24 Q20,30 20,42 Z', s.lin('#e2cfa0', 0.3, -0.35)))
    s.add(E(15, 41, 6, 3.4, s.rad('#5a3a1f', 0.1, -0.4), 1.8, extra=' transform="rotate(10 15 41)"'))
    s.add(L('M24,20 L28,28 M34,15 L36,24 M44,14 L44,22', '#8a6a3a', 2.2, 0.85))
    s.add(L('M20,34 Q30,50 50,26', '#7a4a28', 2, 0.9))
    s.add(P('M52,20 L58,20 L58,28 L52,27 Z', s.lin('#b08a3a'), 1.6))

def crystal_lamp(s):
    s.shadow(32, 57, 15, 3)
    s.add(C(32, 22, 18, s.glow('#8ff7e6', 0.6), 0))
    s.add(P(poly([(32, 6), (40, 16), (38, 32), (26, 32), (24, 16)]), s.lin(GEM, 0.5, -0.3), 1.8))
    s.add(L('M32,6 L32,32 M24,16 L40,16', shade(GEM, -0.35), 1, 0.6))
    s.add(P('M22,32 L42,32 L38,40 L26,40 Z', s.lin(METAL['copper'][0], 0.3, -0.35), 1.8))
    s.add(P('M28,40 L36,40 L38,52 L26,52 Z', s.lin(METAL['copper'][0], 0.2, -0.35), 1.8))
    s.add(R(20, 52, 24, 4, s.lin(METAL['copper'][0]), 1.5, 1.8))
    s.add(L('M28,10 l2,-3', '#fff', 1.6, 0.9))

def flute(s):
    s.shadow(32, 56, 22, 3)
    col = '#b8c46a'
    s.add(L('M8,52 L56,14', INK, 9, 1) + L('M8,52 L56,14', col, 6.6, 1))
    s.add(L('M9,50 L55,13', shade(col, 0.4), 1.6, 0.8))
    for t in (0.3, 0.42, 0.54, 0.66, 0.78):
        x, y = 8 + 48 * t, 52 - 38 * t
        s.add(C(x, y, 1.3, INK, 0))
    for t in (0.18, 0.88):
        x, y = 8 + 48 * t, 52 - 38 * t
        s.add(L(f'M{x - 2},{y - 3} L{x + 2},{y + 3}', shade(col, -0.45), 2, 0.9))
    s.add(L('M44,24 Q46,36 40,44', '#b02a2a', 1.8, 0.9) + C(40, 45, 2, '#b02a2a', 1))

def herbs(s):
    s.shadow(32, 57, 15, 3)
    for (x2, y2, col) in [(14, 18, '#5e9a40'), (22, 10, '#4f8a3a'), (32, 6, '#6aaa48'), (42, 10, '#4a8236'), (50, 18, '#5e9a40')]:
        s.add(L(f'M32,46 Q{(32 + x2) / 2},{(46 + y2) / 2 + 6} {x2},{y2}', '#3a5a22', 1.8, 1))
        s.add(P(f'M{x2},{y2} q-6,6 -1,12 q6,-4 1,-12 Z', s.lin(col), 1.4))
        s.add(P(f'M{(32 + x2) / 2},{(46 + y2) / 2 + 4} q-5,3 -3,8 q5,-2 3,-8 Z', s.lin(shade(col, 0.1)), 1.2))
    s.add(C(28, 18, 2.2, '#d8a0e0', 1) + C(38, 16, 2.2, '#f0d060', 1))
    s.add(R(26, 42, 12, 6, s.lin('#c2a368'), 2, 1.8))
    s.add(L('M32,48 L32,56', '#3a5a22', 2.4, 1))

def paper_lantern(s):
    s.shadow(32, 58, 14, 3)
    s.add(C(32, 32, 22, s.glow('#ffb060', 0.55), 0))
    s.add(L('M32,4 L32,12', INK, 2, 1))
    s.add(R(26, 10, 12, 5, s.lin('#3a2a1a'), 1.5, 1.6) + R(26, 49, 12, 5, s.lin('#3a2a1a'), 1.5, 1.6))
    s.add(E(32, 32, 16, 18, s.rad('#e0402e', 0.45, -0.3), 2))
    s.add(L('M17,26 Q32,30 47,26 M16,32 Q32,36 48,32 M17,38 Q32,42 47,38', shade('#e0402e', -0.4), 1, 0.65))
    s.add(L('M32,54 L32,60', '#e0b040', 2, 1) + L('M30,58 L34,58', '#e0b040', 1.4, 1))
    s.add(HL('M22,22 Q24,18 30,16', 0.55, 1.6))

def bowl(s, content='rice'):
    s.shadow(32, 56, 20, 3.2)
    if content == 'rice':
        s.add(P('M12,32 Q14,16 32,16 Q50,16 52,32 Z', s.rad('#f7f2e6', 0.2, -0.15), 1.8))
        for (x, y) in [(24, 24), (30, 21), (38, 23), (34, 28), (26, 29), (42, 28)]:
            s.add(E(x, y, 1.6, 0.9, '#e2d8c2', 0))
    s.add(P('M8,32 L56,32 Q54,50 32,52 Q10,50 8,32 Z', s.lin('#4a6a8a', 0.3, -0.3)))
    s.add(L('M12,38 Q32,44 52,38', '#e8e2d0', 1.4, 0.8))
    s.add(R(24, 51, 16, 4, s.lin('#3e5a78'), 1.5, 1.8))
    s.add(HL('M12,35 Q16,44 24,48', 0.5, 1.4))

# ════════════════ 먹을거리 ════════════════
def soup(s):
    s.shadow(32, 56, 21, 3.2)
    for (x, y) in [(24, 10), (32, 6), (40, 10)]:
        s.add(L(f'M{x},{y + 10} Q{x - 3},{y + 5} {x},{y} Q{x + 3},{y - 4} {x},{y - 6}', '#fff', 1.8, 0.55))
    s.add(P('M6,30 L58,30 Q56,52 32,54 Q8,52 6,30 Z', s.lin('#a8693a', 0.3, -0.35)))
    s.add(E(32, 30, 26, 6.6, s.rad('#c8803a', 0.35, -0.2), 1.8))
    s.add(P('M18,29 q4,-3 8,0 q-4,3 -8,0 Z', '#3f8a4e', 1) + C(36, 31, 2.6, '#b8432a', 1) + C(43, 29, 1.8, '#efe3c8', 1) + C(28, 32, 1.6, '#efe3c8', 1))
    s.add(L('M10,36 Q32,44 54,36', shade('#a8693a', -0.4), 1, 0.6))

def jerky(s):
    s.shadow(32, 56, 22, 3.2)
    for (y, ang, k) in [(40, -18, -0.08), (32, -10, 0), (24, -22, 0.06)]:
        strip = P('M10,4 Q22,0 34,4 Q46,8 56,4 L54,12 Q44,16 34,12 Q22,8 12,12 Z', s.lin(shade('#7a3a22', k), 0.3, -0.3), 1.8)
        strip += L('M14,8 Q24,5 34,8 Q44,11 52,8', '#c86a4a', 1, 0.6)
        s.add(G(strip, f'translate(0 {y - 8}) rotate({ang} 32 8)'))
    s.add(L('M8,48 Q32,40 56,46', '#c2a368', 2.2, 1))

def tea(s):
    s.shadow(32, 56, 20, 3)
    for (x, y) in [(26, 10), (34, 6)]:
        s.add(L(f'M{x},{y + 10} Q{x - 3},{y + 5} {x},{y} Q{x + 3},{y - 4} {x},{y - 6}', '#fff', 1.8, 0.55))
    s.add(P('M12,26 L52,26 Q50,46 32,48 Q14,46 12,26 Z', s.lin('#e8e2d0', 0.25, -0.3)))
    s.add(E(32, 26, 20, 5, s.rad('#8ab24a', 0.3, -0.25), 1.8))
    s.add(P('M26,25 q6,-4 10,0 q-6,3 -10,0 Z', '#4f8a3a', 1))
    s.add(E(32, 50, 22, 5, s.lin('#8a6a4a', 0.2, -0.3), 1.8))
    s.add(L('M18,34 Q32,40 46,34', '#4fd1c5', 1.6, 0.8))
    s.add(HL('M15,30 Q18,40 24,44', 0.5, 1.4))

def bento(s):
    s.shadow(32, 56, 22, 3.2)
    w = '#8a5a32'
    s.add(P(poly([(10, 30), (32, 20), (54, 30), (32, 40)]), s.lin(shade(w, 0.2), 0.3, -0.25)))
    s.add(P(poly([(10, 30), (32, 40), (32, 52), (10, 42)]), shade(w, -0.05)) + P(poly([(32, 40), (54, 30), (54, 42), (32, 52)]), shade(w, -0.3)))
    s.add(L('M10,36 L32,46 L54,36', '#b02a2a', 2.4, 1))
    s.add(C(32, 30, 5, s.rad('#ffcf6a', 0.4, -0.2), 1.4) + P('M32,26 Q34,29 32,32 Q30,29 32,26 Z', '#fff4c8', 0))
    s.add(L('M24,16 Q32,10 40,16', '#c2a368', 2, 1))

# ════════════════ 퀘스트 물건 ════════════════
def book(s, col, wet=False, torn=False):
    s.shadow(32, 56, 21, 3.2)
    s.add(P(poly([(12, 18), (46, 10), (54, 44), (20, 52)]), s.lin(col, 0.3, -0.35)))
    s.add(P(poly([(20, 52), (54, 44), (54, 47), (21, 55)]), '#efe2c0', 1.6))
    s.add(L('M17,17 L25,51', shade(col, -0.45), 3, 1))
    if wet:
        s.add(P('M30,26 q6,-6 14,0 q4,8 -4,12 q-12,2 -10,-12 Z', shade(col, 0.25), 0, extra=' opacity=".5"'))
        s.add(P('M48,34 q3,4 0,7 q-3,-3 0,-7 Z', '#8fd0e8', 1.2))
    if torn:
        s.add(P('M36,46 L40,40 L44,45 L48,38 L54,44', 'none', 1.8))
        s.add(P(poly([(36, 46), (40, 40), (44, 45), (48, 38), (54, 44), (54, 47), (21, 55)]), '#efe2c0', 0, extra=' opacity=".0"'))
    s.add(R(30, 22, 14, 8, '#efe2c0', 1, 1.2, extra=' transform="rotate(-13 37 26)"'))
    s.add(HL('M14,19 L44,12', 0.45, 1.3))

def scroll(s, seal='#b02a2a', drawing=False):
    s.shadow(32, 56, 22, 3)
    s.add(P('M12,16 L50,16 L50,48 L12,48 Z', s.lin('#efe2c0', 0.2, -0.2)))
    if drawing:
        s.add(L('M18,40 Q24,26 32,32 Q40,38 44,24', '#7a5a35', 1.6, 0.9) + C(22, 24, 3, 'none', 1.2, '#7a5a35') + L('M36,42 l6,0 M18,30 l4,-2', '#7a5a35', 1.2, 0.8))
    else:
        s.add(L('M18,24 h26 M18,30 h24 M18,36 h26 M18,42 h16', '#8a7050', 1.3, 0.8))
    for x in (10, 52):
        s.add(R(x - 3, 12, 6, 40, s.lin('#8a5a30'), 3, 1.8))
    s.add(C(40, 44, 4.4, s.rad(seal, 0.35, -0.3), 1.6))

def chart(s):
    s.shadow(32, 56, 22, 3)
    s.add(P(poly([(8, 18), (22, 14), (36, 18), (52, 14), (56, 46), (42, 50), (28, 46), (12, 50)]), s.lin('#e8d8b0', 0.2, -0.25)))
    s.add(L('M22,14 L28,46 M36,18 L42,50', '#bfa77a', 1.2, 0.8))
    s.add(P('M14,40 Q18,28 26,30 Q30,22 38,26 Q46,24 48,34 Q40,42 30,38 Q22,44 14,40 Z', '#9fc48a', 1.2, extra=' opacity=".9"'))
    s.add(L('M20,34 L30,30 L40,34', '#b02a2a', 1.4, 0.9, extra=' stroke-dasharray="2 2"') + L('M38,30 l4,4 M42,30 l-4,4', '#b02a2a', 1.8, 1))
    s.add(G(P('M0,0 L16,0 L16,11 L0,11 Z', '#f4ecd8', 1.6) + L('M0,0 L8,6 L16,0', INK, 1.2, 0.8), 'translate(40 6) rotate(12)'))

def bell(s):
    s.shadow(32, 57, 18, 3)
    br = '#b5853a'
    s.add(L('M32,4 L32,10', INK, 4, 1) + R(27, 6, 10, 6, s.lin(shade(br, -0.1)), 2))
    s.add(P('M20,22 Q20,10 32,10 Q44,10 44,22 L46,40 Q52,44 54,48 L10,48 Q12,44 18,40 Z', s.lin(br, 0.4, -0.35)))
    s.add(L('M18,40 L46,40', shade(br, -0.35), 1.4, 0.8))
    s.add(P('M26,22 Q28,30 34,30', 'none', 0) + L('M30,26 l6,0 M28,32 l10,0', '#3a8a7a', 1.4, 0.7))
    s.add(C(32, 52, 4, s.rad(shade(br, -0.1)), 1.8))
    s.add(HL('M23,22 Q23,14 30,12.5', 0.65, 1.8))

def shard(s, col):
    crystal(s, col, glow=True, cluster=False)

def spirit_stone(s):
    s.shadow(32, 56, 15, 3)
    s.add(C(32, 32, 22, s.glow('#cfefff', 0.6), 0))
    s.add(P(poly([(32, 10), (48, 22), (44, 44), (20, 44), (16, 22)]), s.lin('#bfe8ff', 0.45, -0.25), 2))
    s.add(L('M32,10 L32,44 M16,22 L48,22 M20,44 L32,22 L44,44', '#7fb8d8', 1, 0.7))
    s.add(L('M24,16 l3,-3', '#fff', 1.8, 0.95))

# ════════════════ 물건 → 그림 ════════════════
ICONS = {
    'log_drift': lambda s: log(s, 'drift'), 'log_birch': lambda s: log(s, 'birch'), 'log_oak': lambda s: log(s, 'oak'),
    'lumber_drift': lambda s: lumber(s, 'drift'), 'lumber_birch': lambda s: lumber(s, 'birch'), 'lumber_oak': lambda s: lumber(s, 'oak'),
    'stone': lambda s: rock(s, '#8f908a'), 'ore_copper': lambda s: rock(s, '#7d776f', '#e0843f'), 'ore_iron': lambda s: rock(s, '#6f6a66', '#c9d4dc'),
    'ingot_copper': lambda s: ingot(s, 'copper'), 'ingot_iron': lambda s: ingot(s, 'iron'),
    'fiber_reed': fiber, 'berry': berries, 'seaweed': seaweed, 'mushroom': mushroom,
    'hide_raw': hide, 'leather': leather, 'meat_raw': meat,
    'sap_birch': lambda s: jar(s, '#e8b44a'), 'sand_fine': sand, 'gem_rough': lambda s: crystal(s, GEM),
    'seed_territory': lambda s: sprout(s, True), 'seed_berry': sprout,
    'cloth_reed': cloth, 'nails_copper': nails, 'stake_wood': stakes,
    'tool_axe_stone': lambda s: axe(s, 'stone'), 'tool_axe_copper': lambda s: axe(s, 'copper'), 'tool_axe_iron': lambda s: axe(s, 'iron'),
    'tool_pick_stone': lambda s: pick(s, 'stone'), 'tool_pick_copper': lambda s: pick(s, 'copper'), 'tool_pick_iron': lambda s: pick(s, 'iron'),
    'tool_sickle_stone': lambda s: sickle(s, 'stone'), 'tool_sickle_copper': lambda s: sickle(s, 'copper'), 'tool_sickle_iron': lambda s: sickle(s, 'iron'),
    'wpn_club': club,
    'wpn_sword_copper': lambda s: sword_shield(s, 'copper'), 'wpn_sword_iron': lambda s: sword_shield(s, 'iron'),
    'wpn_battleaxe_copper': lambda s: axe(s, 'copper', True), 'wpn_battleaxe_iron': lambda s: axe(s, 'iron', True),
    'wpn_spear_copper': lambda s: spear(s, 'copper'), 'wpn_spear_iron': lambda s: spear(s, 'iron'),
    'wpn_hammer_copper': lambda s: hammer(s, 'copper'), 'wpn_hammer_iron': lambda s: hammer(s, 'iron'),
    'wpn_bow_birch': lambda s: bow(s, 'birch'), 'wpn_bow_oak': lambda s: bow(s, 'oak'),
    'wpn_staff_birch': lambda s: staff(s, 'birch'), 'wpn_staff_oak': lambda s: staff(s, 'oak'),
    'arm_leather_hood': lambda s: hood(s, '#8a5a33', '#c9a06a'), 'arm_leather_vest': lambda s: vest(s, '#8a5a33'), 'arm_leather_pants': lambda s: pants(s, '#7a4e2e'),
    'arm_cloth_hood': lambda s: hood(s, '#6f8a7a', '#e2d6b4'), 'arm_robe': robe, 'arm_cloth_pants': lambda s: pants(s, '#8a8a6a'),
    'arm_iron_helm': helm, 'arm_iron_cuirass': cuirass, 'arm_iron_greaves': greaves,
    'crate_wood': crate, 'furn_stool': stool, 'furn_table': table, 'furn_bed': bed, 'furn_lamp': oil_lamp, 'furn_rug': rug, 'furn_shelf': shelf,
    'keep_pot': pot, 'keep_owl': owl, 'keep_ship': ship, 'keep_honey': lambda s: jar(s, '#e8a12a', '#e9d9a0', '#8a5a32', True, True),
    'keep_anvil': anvil, 'keep_horn': horn, 'keep_crystal': crystal_lamp, 'keep_flute': flute, 'keep_herbs': herbs,
    'keep_quilt': lambda s: bed(s, ['#e07a4a', '#f0c060', '#b0405a']), 'keep_lantern': paper_lantern, 'keep_bowl': bowl,
    'food_soup': soup, 'food_berry': lambda s: berries(s, True), 'food_meat': lambda s: meat(s, True), 'food_lantern': bento, 'food_jerky': jerky, 'food_tea': tea,
    # 퀘스트 물건
    'qi_log': lambda s: book(s, '#3e5a6a', wet=True), 'qi_ledger': lambda s: book(s, '#7a4a2a', torn=True), 'qi_crate': lambda s: crate(s, True),
    'qi_orders': scroll, 'qi_chart': chart, 'qi_shard': lambda s: shard(s, '#5aa8ff'), 'qi_stone': spirit_stone,
    'qi_mural': lambda s: scroll(s, '#3a6a8a', True), 'qi_bell': bell,
}

def build():
    items = json.load(open(os.path.join(ROOT, 'data', 'items.json')))
    items = items if isinstance(items, list) else items['items']
    qitems = json.load(open(os.path.join(ROOT, 'data', 'quests.json')))['items']
    want = [x['id'] for x in items] + list(qitems)
    missing = [i for i in want if i not in ICONS]
    syms = []
    for sid in want:
        if sid not in ICONS:
            continue
        s = Sym(sid)
        ICONS[sid](s)
        syms.append(s.svg())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    head = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">\n<!-- 안개섬 개척기 물건 아이콘(tools/icons/items.py로 만든다. 손으로 고치지 말 것) -->\n'
    open(OUT, 'w').write(head + '\n'.join(syms) + '\n</svg>\n')
    print(f'{len(syms)} icons → {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)')
    if missing:
        print('그림 없음:', missing)

if __name__ == '__main__':
    build()
