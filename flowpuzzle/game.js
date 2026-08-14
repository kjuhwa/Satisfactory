'use strict';
/* 플로우 — 흐름 퍼즐 (레벨제, 연결만으로 푼다)
 * 소스(출력만)의 색 흐름을 혼합기·분배기·증폭기로 가공해 목표(입력만)를 채운다.
 * 전선 수가 적을수록 별 ↑, 일부 레벨은 전력 한도가 있다.
 */

const $ = id => document.getElementById(id);
const svg = $('world');
const NS = 'http://www.w3.org/2000/svg';

/* ---------- 색 ---------- */
const COLORS = {
  R: { hex: '#ff5a51', ko: '빨강' },
  Y: { hex: '#ffc94d', ko: '노랑' },
  B: { hex: '#58a6ff', ko: '파랑' },
  O: { hex: '#ff9440', ko: '주황' },
  G: { hex: '#63d68a', ko: '초록' },
  P: { hex: '#b07ce0', ko: '보라' },
};
function mixColor(a, b) {
  if (a === b) return a; // 같은 색 = 합류
  const k = [a, b].sort().join('');
  return { BR: 'P', RY: 'O', BY: 'G' }[k] || null;
}

/* ---------- 기계 정의 ---------- */
const KIND = {
  src:      { ko: '소스',   ins: 0, outs: 1, multiOut: false, power: 0 },
  goal:     { ko: '목표',   ins: 1, outs: 0, multiIn: true,   power: 0 },
  mixer:    { ko: '혼합기', ins: 2, outs: 1, power: 5 },
  splitter: { ko: '분배기', ins: 1, outs: 1, multiOut: true,  power: 2 },
  amp:      { ko: '증폭기', ins: 1, outs: 1, power: 10 },
};

/* ---------- 레벨 ---------- */
const LEVELS = [
  { name: '1. 첫 연결', par: 1, nodes: [
    { t: 'src', c: 'R', rate: 20, fx: .3, fy: .35 },
    { t: 'goal', c: 'R', need: 20, fx: .7, fy: .65 },
  ]},
  { name: '2. 나누기', par: 3, nodes: [
    { t: 'src', c: 'B', rate: 20, fx: .5, fy: .22 },
    { t: 'splitter', fx: .5, fy: .48 },
    { t: 'goal', c: 'B', need: 10, fx: .28, fy: .75 },
    { t: 'goal', c: 'B', need: 10, fx: .72, fy: .75 },
  ]},
  { name: '3. 섞기', par: 3, nodes: [
    { t: 'src', c: 'R', rate: 10, fx: .28, fy: .25 },
    { t: 'src', c: 'Y', rate: 10, fx: .72, fy: .25 },
    { t: 'mixer', fx: .5, fy: .5 },
    { t: 'goal', c: 'O', need: 20, fx: .5, fy: .78 },
  ]},
  { name: '4. 남는 물감', par: 3, nodes: [
    { t: 'src', c: 'B', rate: 25, fx: .28, fy: .25 },
    { t: 'src', c: 'R', rate: 10, fx: .72, fy: .25 },
    { t: 'mixer', fx: .5, fy: .5 },
    { t: 'goal', c: 'P', need: 20, fx: .5, fy: .78 },
  ]},
  { name: '5. 증폭', par: 2, nodes: [
    { t: 'src', c: 'Y', rate: 10, fx: .3, fy: .3 },
    { t: 'amp', fx: .5, fy: .5 },
    { t: 'goal', c: 'Y', need: 20, fx: .7, fy: .72 },
  ]},
  { name: '6. 두 갈래 혼합', par: 7, nodes: [
    { t: 'src', c: 'R', rate: 10, fx: .2, fy: .2 },
    { t: 'src', c: 'B', rate: 20, fx: .5, fy: .16 },
    { t: 'src', c: 'Y', rate: 10, fx: .8, fy: .2 },
    { t: 'splitter', fx: .5, fy: .4 },
    { t: 'mixer', fx: .3, fy: .58 },
    { t: 'mixer', fx: .7, fy: .58 },
    { t: 'goal', c: 'P', need: 20, fx: .3, fy: .82 },
    { t: 'goal', c: 'G', need: 20, fx: .7, fy: .82 },
  ]},
  { name: '7. 증폭해 섞기', par: 4, nodes: [
    { t: 'src', c: 'R', rate: 20, fx: .25, fy: .2 },
    { t: 'src', c: 'B', rate: 10, fx: .75, fy: .2 },
    { t: 'amp', fx: .75, fy: .45 },
    { t: 'mixer', fx: .5, fy: .62 },
    { t: 'goal', c: 'P', need: 40, fx: .5, fy: .84 },
  ]},
  { name: '8. 삼등분', par: 4, nodes: [
    { t: 'src', c: 'G', rate: 30, fx: .5, fy: .18 },
    { t: 'splitter', fx: .5, fy: .42 },
    { t: 'goal', c: 'G', need: 10, fx: .22, fy: .72 },
    { t: 'goal', c: 'G', need: 10, fx: .5, fy: .78 },
    { t: 'goal', c: 'G', need: 10, fx: .78, fy: .72 },
  ]},
  { name: '9. 전력 부족', par: 4, powerCap: 15, nodes: [
    { t: 'src', c: 'R', rate: 10, fx: .2, fy: .22 },
    { t: 'src', c: 'R', rate: 10, fx: .5, fy: .16 },
    { t: 'src', c: 'Y', rate: 20, fx: .8, fy: .22 },
    { t: 'amp', fx: .2, fy: .5 },
    { t: 'amp', fx: .5, fy: .45 },
    { t: 'mixer', fx: .65, fy: .6 },
    { t: 'goal', c: 'O', need: 40, fx: .5, fy: .84 },
  ]},
  { name: '10. 종합', par: 9, powerCap: 32, nodes: [
    { t: 'src', c: 'R', rate: 10, fx: .15, fy: .18 },
    { t: 'src', c: 'Y', rate: 30, fx: .5, fy: .14 },
    { t: 'src', c: 'B', rate: 10, fx: .85, fy: .18 },
    { t: 'amp', fx: .15, fy: .42 },
    { t: 'amp', fx: .85, fy: .42 },
    { t: 'splitter', fx: .5, fy: .38 },
    { t: 'mixer', fx: .3, fy: .62 },
    { t: 'mixer', fx: .7, fy: .62 },
    { t: 'goal', c: 'O', need: 30, fx: .3, fy: .85 },
    { t: 'goal', c: 'G', need: 30, fx: .7, fy: .85 },
  ]},
];

/* ---------- 상태 ---------- */
let cur = 0;             // 현재 레벨 index
let nodes = [], edges = [], seq = 1;
let refs = {}, dragging = null, wireMenu = null;
let progress = JSON.parse(localStorage.getItem('flowpuzzle-stars') || '{}');

const W = () => svg.clientWidth;
const H = () => svg.clientHeight;
const px = n => ({ x: n.fx * W(), y: n.fy * H() });

/* ---------- 흐름 계산 (고정점 반복) ---------- */
function solve() {
  // 초기화
  for (const n of nodes) { n.out = null; n.inFlows = KIND[n.t].ins ? Array(KIND[n.t].ins).fill(null) : []; n.err = null; }
  for (const e of edges) e.flow = null;

  for (let it = 0; it < 40; it++) {
    // 노드 출력 계산
    for (const n of nodes) {
      if (n.t === 'src') n.out = { c: n.c, rate: n.rate };
      else if (n.t === 'mixer') {
        const a = n.inFlows[0], b = n.inFlows[1];
        if (a && b) {
          const m = mixColor(a.c, b.c);
          if (!m) { n.out = null; n.err = '혼합 불가'; }
          else if (a.c === b.c) { n.out = { c: m, rate: a.rate + b.rate }; n.err = null; } // 같은 색 = 합류
          else { n.out = { c: m, rate: 2 * Math.min(a.rate, b.rate) }; n.err = null; }
        } else n.out = null;
      } else if (n.t === 'amp') {
        const a = n.inFlows[0];
        n.out = a ? { c: a.c, rate: a.rate * 2 } : null;
      } else if (n.t === 'splitter') {
        const a = n.inFlows[0];
        n.out = a ? { c: a.c, rate: a.rate } : null;
      }
    }
    // 전선 흐름 (분배기는 균등 분할)
    for (const n of nodes) {
      const outEdges = edges.filter(e => e.a === n.id);
      for (const e of outEdges) {
        if (!n.out) { e.flow = null; continue; }
        const share = n.t === 'splitter' ? n.out.rate / outEdges.length : n.out.rate;
        e.flow = { c: n.out.c, rate: share };
      }
    }
    // 노드 입력 수집
    for (const n of nodes) {
      for (let p = 0; p < n.inFlows.length; p++) {
        const ins = edges.filter(e => e.b === n.id && e.bp === p && e.flow);
        if (!ins.length) { n.inFlows[p] = null; continue; }
        // 같은 색만 합산, 색이 섞이면 첫 색 기준 + 오류 표시
        const c0 = ins[0].flow.c;
        const mixed = ins.some(e => e.flow.c !== c0);
        n.inFlows[p] = { c: c0, rate: ins.filter(e => e.flow.c === c0).reduce((s, e) => s + e.flow.rate, 0) };
        if (mixed && n.t !== 'goal') n.err = '색이 섞임';
      }
    }
  }
  // 전력
  let power = 0;
  for (const n of nodes) {
    n.active = KIND[n.t].power > 0 && !!n.out;
    if (n.active) power += KIND[n.t].power;
  }
  const cap = LEVELS[cur].powerCap;
  const over = cap != null && power > cap;
  // 목표 판정 (색 불일치 흐름은 무효)
  for (const n of nodes) {
    if (n.t !== 'goal') continue;
    const ins = edges.filter(e => e.b === n.id && e.flow);
    const good = ins.filter(e => e.flow.c === n.c).reduce((s, e) => s + e.flow.rate, 0);
    const wrong = ins.some(e => e.flow.c !== n.c);
    n.got = over ? 0 : good;
    n.err = wrong ? '색 불일치' : null;
    n.sat = !over && !wrong && n.got >= n.need - 1e-9;
  }
  return { power, cap, over };
}

/* ---------- 렌더링 ---------- */
function elNS(tag, cls) {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute('class', cls);
  return e;
}
const NR = 26;

function portPos(n, dir, idx) {
  const p = px(n);
  const k = KIND[n.t];
  if (dir === 'out') return { x: p.x + NR + 6, y: p.y };
  const cnt = k.ins;
  const off = cnt === 1 ? 0 : (idx === 0 ? -12 : 12);
  return { x: p.x - NR - 6, y: p.y + off };
}

function buildWorld() {
  svg.textContent = '';
  refs = {};
  refs.wireLayer = elNS('g');
  refs.nodeLayer = elNS('g');
  refs.preview = elNS('path', 'wire-preview');
  svg.append(refs.wireLayer, refs.nodeLayer, refs.preview);
  for (const e of edges) buildEdge(e);
  for (const n of nodes) buildNode(n);
  refresh();
}

function buildEdge(e) {
  const line = elNS('path', 'wire');
  const hit = elNS('path', 'wire-hit');
  hit.addEventListener('pointerdown', ev => { ev.stopPropagation(); openWireMenu(ev, e.id); });
  refs.wireLayer.append(line, hit);
  refs['e' + e.id] = { line, hit };
}

function buildNode(n) {
  const k = KIND[n.t];
  const g = elNS('g');
  let shape;
  if (n.t === 'src') {
    shape = elNS('circle', 'node-shape');
    shape.setAttribute('fill', COLORS[n.c].hex);
    shape.setAttribute('stroke', '#0d0b11');
  } else if (n.t === 'goal') {
    shape = elNS('circle', 'node-shape');
    shape.setAttribute('fill', '#221d2e');
    shape.setAttribute('stroke', COLORS[n.c].hex);
    shape.setAttribute('stroke-dasharray', '6 4');
  } else {
    shape = elNS('rect', 'node-shape');
    shape.setAttribute('fill', '#2a2438');
    shape.setAttribute('stroke', '#5d5476');
    shape.setAttribute('rx', 9);
  }
  const icon = elNS('text', 'n-label');
  const sub = elNS('text', 'n-sub');
  const err = elNS('text', 'n-err');
  g.append(shape, icon, sub, err);
  // 포트
  for (let i = 0; i < k.ins; i++) {
    const dot = elNS('circle', 'port in');
    dot.setAttribute('r', 7);
    dot.dataset.node = n.id; dot.dataset.dir = 'in'; dot.dataset.port = i;
    g.append(dot);
    refs['p' + n.id + '_in' + i] = dot;
  }
  if (k.outs) {
    const dot = elNS('circle', 'port out');
    dot.setAttribute('r', 7);
    dot.dataset.node = n.id; dot.dataset.dir = 'out';
    dot.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      dragging = { from: n.id };
      svg.setPointerCapture?.(ev.pointerId);
    });
    g.append(dot);
    refs['p' + n.id + '_out'] = dot;
  }
  refs.nodeLayer.append(g);
  refs['n' + n.id] = { g, shape, icon, sub, err };
}

function refresh() {
  const { power, cap, over } = solve();
  // 노드
  for (const n of nodes) {
    const r = refs['n' + n.id];
    const p = px(n);
    const k = KIND[n.t];
    if (n.t === 'src' || n.t === 'goal') {
      r.shape.setAttribute('cx', p.x); r.shape.setAttribute('cy', p.y);
      r.shape.setAttribute('r', NR);
    } else {
      r.shape.setAttribute('x', p.x - NR); r.shape.setAttribute('y', p.y - NR + 6);
      r.shape.setAttribute('width', NR * 2); r.shape.setAttribute('height', NR * 2 - 12);
    }
    r.icon.setAttribute('x', p.x); r.icon.setAttribute('y', p.y + 1);
    r.sub.setAttribute('x', p.x); r.sub.setAttribute('y', p.y + NR + 16);
    r.err.setAttribute('x', p.x); r.err.setAttribute('y', p.y - NR - 8);
    if (n.t === 'src') {
      r.icon.textContent = n.rate;
      r.sub.textContent = COLORS[n.c].ko + ' 소스';
    } else if (n.t === 'goal') {
      r.icon.textContent = `${Math.round(n.got || 0)}/${n.need}`;
      r.sub.textContent = COLORS[n.c].ko + ' 목표' + (n.sat ? ' ✓' : '');
      r.shape.setAttribute('stroke-dasharray', n.sat ? 'none' : '6 4');
      r.shape.setAttribute('fill', n.sat ? COLORS[n.c].hex + '33' : '#221d2e');
    } else {
      r.icon.textContent = { mixer: '＋', splitter: '÷', amp: '×2' }[n.t];
      r.sub.textContent = k.ko + (k.power ? ` ⚡${k.power}` : '');
    }
    r.err.textContent = n.err || '';
    // 포트 위치
    for (let i = 0; i < k.ins; i++) {
      const d = refs['p' + n.id + '_in' + i];
      const pp = portPos(n, 'in', i);
      d.setAttribute('cx', pp.x); d.setAttribute('cy', pp.y);
    }
    if (k.outs) {
      const d = refs['p' + n.id + '_out'];
      const pp = portPos(n, 'out');
      d.setAttribute('cx', pp.x); d.setAttribute('cy', pp.y);
      if (n.out) d.setAttribute('fill', COLORS[n.out.c].hex);
      else d.setAttribute('fill', '#8f86a8');
    }
  }
  // 전선
  for (const e of edges) {
    const r = refs['e' + e.id];
    const a = nodes.find(n => n.id === e.a);
    const b = nodes.find(n => n.id === e.b);
    const pa = portPos(a, 'out');
    const pb = portPos(b, 'in', e.bp);
    const dx = Math.max(30, Math.abs(pb.x - pa.x) / 2);
    const d = `M ${pa.x} ${pa.y} C ${pa.x + dx} ${pa.y}, ${pb.x - dx} ${pb.y}, ${pb.x} ${pb.y}`;
    r.line.setAttribute('d', d);
    r.hit.setAttribute('d', d);
    r.line.setAttribute('stroke', e.flow ? COLORS[e.flow.c].hex : '#4a445c');
    r.line.classList.toggle('flow', !!e.flow && !over);
  }
  // HUD·목표바
  $('hud-name').textContent = LEVELS[cur].name;
  $('hud-wires').textContent = `${edges.length}${LEVELS[cur].par ? ' (별 기준 ' + LEVELS[cur].par + ')' : ''}`;
  const pw = $('hud-power-wrap');
  pw.hidden = cap == null;
  if (cap != null) {
    $('hud-power').textContent = `${power}/${cap}`;
    pw.style.color = over ? 'var(--bad)' : '';
  }
  const gb = $('goalbar');
  gb.textContent = '';
  for (const n of nodes.filter(n => n.t === 'goal')) {
    const chip = document.createElement('div');
    chip.className = 'goal-chip' + (n.sat ? ' ok' : '');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = COLORS[n.c].hex;
    chip.append(sw, `${Math.round(n.got || 0)}/${n.need}`);
    gb.append(chip);
  }
  // 클리어
  if (nodes.some(n => n.t === 'goal') && nodes.filter(n => n.t === 'goal').every(n => n.sat)) {
    setTimeout(showClear, 350);
  }
}

/* ---------- 클리어 ---------- */
let cleared = false;
function starsFor(wires) {
  const par = LEVELS[cur].par;
  return wires <= par ? 3 : wires <= par + 2 ? 2 : 1;
}
function showClear() {
  if (cleared) return;
  // 재검증 (연출 지연 중 변경 가능)
  solve();
  if (!nodes.filter(n => n.t === 'goal').every(n => n.sat)) return;
  cleared = true;
  const s = starsFor(edges.length);
  const bestS = Math.max(progress[cur] || 0, s);
  progress[cur] = bestS;
  localStorage.setItem('flowpuzzle-stars', JSON.stringify(progress));
  $('clear-stars').textContent = '★'.repeat(s) + '☆'.repeat(3 - s);
  $('clear-text').innerHTML = `${LEVELS[cur].name} 완료!<br>` +
    `<span class="hint">전선 ${edges.length}개 사용 (3성 기준 ${LEVELS[cur].par}개)</span>`;
  $('btn-next').hidden = cur >= LEVELS.length - 1;
  $('clear').hidden = false;
}

/* ---------- 레벨 로드 ---------- */
function loadLevel(i) {
  cur = i;
  cleared = false;
  nodes = LEVELS[i].nodes.map(d => ({ id: seq++, ...d }));
  edges = [];
  $('clear').hidden = true;
  $('levels').hidden = true;
  buildWorld();
}

function buildLevelGrid() {
  const grid = $('level-grid');
  grid.textContent = '';
  const unlocked = i => i === 0 || (progress[i - 1] || 0) > 0;
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    if (!unlocked(i)) b.className = 'locked';
    const num = document.createElement('span');
    num.textContent = i + 1;
    const st = document.createElement('span');
    st.className = 'stars';
    st.textContent = (progress[i] || 0) > 0 ? '★'.repeat(progress[i]) : (unlocked(i) ? '·' : '🔒');
    b.append(num, st);
    b.addEventListener('click', () => { if (unlocked(i)) loadLevel(i); });
    grid.append(b);
  });
}

/* ---------- 입력 ---------- */
svg.addEventListener('pointermove', ev => {
  if (!dragging) return;
  const from = nodes.find(n => n.id === dragging.from);
  const pa = portPos(from, 'out');
  refs.preview.setAttribute('d', `M ${pa.x} ${pa.y} L ${ev.clientX} ${ev.clientY}`);
});
svg.addEventListener('pointerup', ev => {
  if (!dragging) return;
  refs.preview.setAttribute('d', '');
  const fromId = dragging.from;
  dragging = null;
  // 가장 가까운 입력 포트 찾기
  let best = null, bestD = 30;
  for (const n of nodes) {
    for (let i = 0; i < KIND[n.t].ins; i++) {
      const pp = portPos(n, 'in', i);
      const d = Math.hypot(pp.x - ev.clientX, pp.y - ev.clientY);
      if (d < bestD) { best = { n, port: i }; bestD = d; }
    }
  }
  if (!best || best.n.id === fromId) return;
  // 포트 점유 규칙
  const from = nodes.find(n => n.id === fromId);
  const outTaken = edges.filter(e => e.a === fromId).length;
  if (!KIND[from.t].multiOut && outTaken >= 1) return;
  if (KIND[from.t].multiOut && outTaken >= 3) return;
  const inTaken = edges.filter(e => e.b === best.n.id && e.bp === best.port).length;
  if (!KIND[best.n.t].multiIn && inTaken >= 1) return;
  if (edges.some(e => e.a === fromId && e.b === best.n.id && e.bp === best.port)) return;
  const e = { id: seq++, a: fromId, b: best.n.id, bp: best.port };
  edges.push(e);
  buildEdge(e);
  refresh();
});
svg.addEventListener('pointercancel', () => { dragging = null; refs.preview?.setAttribute('d', ''); });

function openWireMenu(ev, edgeId) {
  closeWireMenu();
  const m = document.createElement('div');
  m.id = 'wire-menu';
  m.style.cssText = `position:fixed;z-index:40;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:8px;display:flex;gap:6px;left:${Math.min(ev.clientX, innerWidth - 170)}px;top:${Math.min(ev.clientY + 8, innerHeight - 60)}px`;
  const del = document.createElement('button');
  del.textContent = '전선 제거';
  del.style.background = 'var(--bad)';
  del.style.color = '#fff';
  del.addEventListener('click', () => { edges = edges.filter(e => e.id !== edgeId); buildWorld(); closeWireMenu(); });
  const keep = document.createElement('button');
  keep.className = 'ghost';
  keep.textContent = '취소';
  keep.addEventListener('click', closeWireMenu);
  m.append(del, keep);
  document.body.append(m);
  wireMenu = m;
}
function closeWireMenu() { if (wireMenu) { wireMenu.remove(); wireMenu = null; } }
document.addEventListener('pointerdown', ev => {
  if (wireMenu && !wireMenu.contains(ev.target)) closeWireMenu();
}, true);

/* ---------- 버튼 ---------- */
$('btn-reset').addEventListener('click', () => loadLevel(cur));
$('btn-levels').addEventListener('click', () => { buildLevelGrid(); $('levels').hidden = false; });
$('btn-again').addEventListener('click', () => loadLevel(cur));
$('btn-next').addEventListener('click', () => loadLevel(cur + 1));
window.addEventListener('resize', () => refresh());

buildLevelGrid();
