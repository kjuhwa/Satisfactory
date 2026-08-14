'use strict';
/* 블랙아웃 — 전력망 잇기 (미니 세션 게임, 폰 우선)
 * 규칙: 발전소(출력만)와 도시(입력만)를 전선으로 잇는다. 도시는 계속 자라고
 * 새 도시가 계속 생긴다. 전기가 모자란 도시는 정전 게이지가 차오르고,
 * 하나라도 가득 차면 블랙아웃(게임 오버). 전선은 한정 자원.
 */

const TICK = 0.25;          // 초
const DAY_SEC = 20;         // 1일 = 20초
const BLACK_SEC = 12;       // 정전 유예
const EDGE_CAP = 10;        // 전선 용량 (MW)
const REWARD_DAYS = 4;      // 보급 주기
const PROD_SEC = 8;         // 공장: 전력 100%일 때 아이템 1개 생산 시간
const FAC_INTERVAL = 24;    // 공장 출현 주기 (초)
const FAC_ITEMS_MAX = 3;    // 공장당 생산 개수 (다 만들면 철수)

/* 공장이 만드는 아이템 — 완성 즉시 어드밴티지로 자동 변환 */
const FAC_ITEMS = {
  part: {
    icon: '⚙', name: '부품', short: '전선+1',
    apply() { S.wires += 1; return '🔌 전선 +1'; },
  },
  batt: {
    icon: '🔋', name: '전지', short: '도시 진정',
    apply() {
      for (const c of S.nodes) if (c.type === 'city') c.black = Math.max(0, c.black - 0.4);
      return '🔋 정전 게이지 -40%';
    },
  },
  motor: {
    icon: '🧲', name: '모터', short: '발전+3MW',
    apply() {
      const ps = S.nodes.filter(n => n.type === 'plant');
      const p = ps[Math.floor(Math.random() * ps.length)];
      p.out += 3;
      refreshNode(p);
      return '⚡ 발전소 +3MW';
    },
  },
};

const $ = id => document.getElementById(id);
const svg = $('world');
const NS = 'http://www.w3.org/2000/svg';

let S = null;       // 게임 상태
let refs = {};      // id -> svg 요소 참조
let dragging = null;
let wireMenu = null;
let best = +localStorage.getItem('blackout-best') || 0;

function freshGame() {
  return {
    nodes: [],    // {id,type:'plant'|'city'|'sub', fx,fy, out?, demand?, growT, sat, black}
    edges: [],    // {id,a,b,cap, flow}
    wires: 6,
    seq: 1,
    time: 0,
    day: 1,
    spawnT: 0,
    facT: FAC_INTERVAL * 0.6,
    nextReward: REWARD_DAYS,
    delivered: 0, // 누적 MWh(대략)
    over: false,
    paused: true,
  };
}

/* ---------- 배치 ---------- */
const W = () => svg.clientWidth;
const H = () => svg.clientHeight;
const px = n => ({ x: n.fx * W(), y: n.fy * H() });

function freeSpot(minDist) {
  for (let t = 0; t < 200; t++) {
    const fx = 0.09 + Math.random() * 0.82;
    const fy = 0.12 + Math.random() * 0.76;
    const x = fx * W(), y = fy * H();
    if (S.nodes.every(n => {
      const p = px(n);
      return Math.hypot(p.x - x, p.y - y) > minDist;
    })) return { fx, fy };
  }
  return { fx: Math.random(), fy: Math.random() };
}

function addNode(type, extra) {
  const spot = freeSpot(86);
  const n = { id: S.seq++, type, ...spot, sat: 1, black: 0, growT: 0, ...extra };
  S.nodes.push(n);
  return n;
}

function startGame() {
  S = freshGame();
  addNode('plant', { out: 20 });
  addNode('city', { demand: 3 });
  addNode('city', { demand: 3 });
  S.paused = false;
  buildWorld();
  refreshHud();
}

/* ---------- 시뮬레이션 ---------- */
function citySpawnInterval() { return Math.max(11, 26 - S.day * 0.8); }
function demandInterval() { return Math.max(7, 14 - S.day * 0.35); }

function tick() {
  if (!S || S.paused || S.over) return;
  S.time += TICK;

  // 수요 성장
  for (const n of S.nodes) {
    if (n.type !== 'city') continue;
    n.growT += TICK;
    if (n.growT >= demandInterval()) {
      n.growT = 0;
      n.demand += 1;
      refreshNode(n);
    }
  }
  // 도시 스폰
  S.spawnT += TICK;
  if (S.spawnT >= citySpawnInterval()) {
    S.spawnT = 0;
    const n = addNode('city', { demand: 2 });
    buildNode(n);
  }

  // 공장 출현 (2일차부터, 동시 최대 2곳)
  if (S.day >= 2 && S.nodes.filter(n => n.type === 'fac').length < 2) {
    S.facT += TICK;
    if (S.facT >= FAC_INTERVAL) {
      S.facT = 0;
      const keys = Object.keys(FAC_ITEMS);
      const n = addNode('fac', {
        item: keys[Math.floor(Math.random() * keys.length)],
        need: 5 + Math.floor(S.day / 3),
        prog: 0, left: FAC_ITEMS_MAX,
      });
      buildNode(n);
      toast(n, '🏭 새 공장!');
    }
  }

  // 흐름 계산 (최대 유량)
  solveFlow();

  // 공장 생산 — 받은 전력 비율만큼 진행, 완성 즉시 어드밴티지 적용
  for (const n of [...S.nodes]) {
    if (n.type !== 'fac') continue;
    if (n.sat > 0.01) {
      n.prog += n.sat * TICK / PROD_SEC;
      if (n.prog >= 1) {
        n.prog = 0;
        n.left--;
        const msg = FAC_ITEMS[n.item].apply();
        refreshHud();
        if (n.left <= 0) { retireFactory(n); toast(n, msg + ' · 🏭 철수'); }
        else toast(n, msg);
      }
    }
  }

  // 정전 게이지 · 점수
  for (const n of S.nodes) {
    if (n.type !== 'city') continue;
    if (n.sat < 0.999) n.black = Math.min(1, n.black + TICK / BLACK_SEC);
    else n.black = Math.max(0, n.black - TICK / (BLACK_SEC / 2));
    if (n.black >= 1) { gameOver(); return; }
    S.delivered += n.demand * n.sat * TICK / 60;
  }

  // 날짜 · 보급
  const day = 1 + Math.floor(S.time / DAY_SEC);
  if (day !== S.day) {
    S.day = day;
    if (day >= S.nextReward) {
      S.nextReward = day + REWARD_DAYS;
      offerReward();
    }
  }
  refreshWorld();
  refreshHud();
}

/** Edmonds-Karp 최대 유량: 슈퍼소스→발전소, 도시→슈퍼싱크, 전선은 양방향 */
function solveFlow() {
  const idx = new Map();
  S.nodes.forEach((n, i) => idx.set(n.id, i + 1));
  const N = S.nodes.length + 2;
  const SRC = 0, SNK = N - 1;
  const cap = {};
  const adj = Array.from({ length: N }, () => new Set());
  const arc = (u, v, c) => {
    cap[u + '_' + v] = (cap[u + '_' + v] || 0) + c;
    cap[v + '_' + u] = cap[v + '_' + u] || 0;
    adj[u].add(v); adj[v].add(u);
  };
  for (const n of S.nodes) {
    if (n.type === 'plant') arc(SRC, idx.get(n.id), n.out);
    if (n.type === 'city') arc(idx.get(n.id), SNK, n.demand);
  }
  for (const e of S.edges) {
    const u = idx.get(e.a), v = idx.get(e.b);
    arc(u, v, e.cap);
    arc(v, u, e.cap);
  }
  const flow = {};
  const residual = (u, v) => (cap[u + '_' + v] || 0) - (flow[u + '_' + v] || 0);
  const augment = () => {
    for (let guard = 0; guard < 300; guard++) {
      // BFS 증가 경로
      const prev = new Array(N).fill(-1);
      prev[SRC] = SRC;
      const q = [SRC];
      while (q.length) {
        const u = q.shift();
        for (const v of adj[u]) {
          if (prev[v] === -1 && residual(u, v) > 1e-9) { prev[v] = u; q.push(v); }
        }
      }
      if (prev[SNK] === -1) break;
      let aug = Infinity;
      for (let v = SNK; v !== SRC; v = prev[v]) aug = Math.min(aug, residual(prev[v], v));
      for (let v = SNK; v !== SRC; v = prev[v]) {
        const u = prev[v];
        flow[u + '_' + v] = (flow[u + '_' + v] || 0) + aug;
        flow[v + '_' + u] = (flow[v + '_' + u] || 0) - aug;
      }
    }
  };
  augment();
  // 2차: 공장 싱크를 잔여망에 추가하고 이어서 증강 — 도시로 가던 유량은 줄지 않으므로
  // 공장은 언제나 도시가 쓰고 남는 전력만 가져간다
  let hasFac = false;
  for (const n of S.nodes) {
    if (n.type === 'fac') { arc(idx.get(n.id), SNK, n.need); hasFac = true; }
  }
  if (hasFac) augment();
  for (const n of S.nodes) {
    if (n.type === 'city') {
      const got = flow[idx.get(n.id) + '_' + SNK] || 0;
      n.sat = n.demand > 0 ? Math.min(1, got / n.demand) : 1;
    } else if (n.type === 'fac') {
      const got = flow[idx.get(n.id) + '_' + SNK] || 0;
      n.sat = Math.min(1, got / n.need);
    }
  }
  for (const e of S.edges) {
    const u = idx.get(e.a), v = idx.get(e.b);
    e.flow = Math.max(flow[u + '_' + v] || 0, flow[v + '_' + u] || 0);
  }
}

/* ---------- 보급 · 종료 ---------- */
function offerReward() {
  S.paused = true;
  const box = $('reward-opts');
  box.textContent = '';
  const opts = [
    { t: `⚡ <b>새 발전소</b> (+${15 + S.day} MW)`, f: () => { const n = addNode('plant', { out: 15 + S.day }); buildNode(n); } },
    { t: `🔌 <b>전선 ×3</b>`, f: () => { S.wires += 3; } },
    { t: `🔷 <b>변전소</b> — 전선을 모아 분배하는 중계 노드`, f: () => { const n = addNode('sub', {}); buildNode(n); } },
  ];
  for (const o of opts) {
    const b = document.createElement('button');
    b.innerHTML = o.t;
    b.addEventListener('click', () => {
      o.f();
      $('reward').hidden = true;
      S.paused = false;
      refreshHud();
    });
    box.append(b);
  }
  $('reward').hidden = false;
}

function gameOver() {
  S.over = true;
  const score = Math.round(S.delivered);
  if (S.day > best) { best = S.day; localStorage.setItem('blackout-best', best); }
  $('go-summary').innerHTML =
    `<b>${S.day}일</b> 버텼습니다 · 총 공급 <b>${score} MWh</b><br>` +
    `<span class="hint">최고 기록: ${best}일</span>`;
  $('gameover').hidden = false;
}

/* ---------- 렌더링 ---------- */
function elNS(tag, cls) {
  const e = document.createElementNS(NS, tag);
  if (cls) e.setAttribute('class', cls);
  return e;
}
function arcPath(cx, cy, r, frac) {
  if (frac <= 0) return '';
  const a0 = -Math.PI / 2;
  const a1 = a0 + Math.PI * 2 * Math.min(frac, 0.9999);
  const large = frac > 0.5 ? 1 : 0;
  return `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
}
const cityR = n => 15 + Math.min(14, n.demand * 0.8);

function buildWorld() {
  svg.textContent = '';
  refs = {};
  refs.wireLayer = elNS('g');
  refs.nodeLayer = elNS('g');
  refs.preview = elNS('path', 'wire-preview');
  svg.append(refs.wireLayer, refs.nodeLayer, refs.preview);
  for (const e of S.edges) buildEdge(e);
  for (const n of S.nodes) buildNode(n);
}

function buildEdge(e) {
  const g = elNS('g');
  const line = elNS('line', 'wire');
  const hit = elNS('line', 'wire-hit');
  hit.addEventListener('pointerdown', ev => {
    ev.stopPropagation();
    openWireMenu(ev, e.id);
  });
  g.append(line, hit);
  refs.wireLayer.append(g);
  refs['e' + e.id] = { g, line, hit };
  refreshEdge(e);
}

function buildNode(n) {
  const g = elNS('g');
  g.dataset.id = n.id;
  let shape;
  if (n.type === 'plant') {
    shape = elNS('rect', 'n-plant');
  } else if (n.type === 'sub') {
    shape = elNS('rect', 'n-sub');
  } else if (n.type === 'fac') {
    shape = elNS('rect', 'n-fac');
  } else {
    shape = elNS('circle', 'n-city');
  }
  const satArc = elNS('path', 'sat-arc');
  const blackArc = elNS('path', 'black-arc');
  const icon = elNS('text', 'n-icon');
  const label = elNS('text', 'n-label');
  g.append(shape, satArc, blackArc, icon, label);
  g.addEventListener('pointerdown', ev => {
    ev.stopPropagation();
    if (S.over || S.paused) return;
    dragging = { from: n.id };
    svg.setPointerCapture?.(ev.pointerId);
  });
  refs.nodeLayer.append(g);
  refs['n' + n.id] = { g, shape, satArc, blackArc, icon, label };
  refreshNode(n);
}

function refreshEdge(e) {
  const r = refs['e' + e.id];
  if (!r) return;
  const a = S.nodes.find(n => n.id === e.a);
  const b = S.nodes.find(n => n.id === e.b);
  if (!a || !b) return;
  const pa = px(a), pb = px(b);
  for (const l of [r.line, r.hit]) {
    l.setAttribute('x1', pa.x); l.setAttribute('y1', pa.y);
    l.setAttribute('x2', pb.x); l.setAttribute('y2', pb.y);
  }
  r.line.classList.toggle('flow', (e.flow || 0) > 0.01);
  r.line.classList.toggle('full', (e.flow || 0) >= e.cap - 0.01);
}

function refreshNode(n) {
  const r = refs['n' + n.id];
  if (!r) return;
  const p = px(n);
  if (n.type === 'city') {
    const rad = cityR(n);
    r.shape.setAttribute('cx', p.x); r.shape.setAttribute('cy', p.y);
    r.shape.setAttribute('r', rad);
    r.shape.classList.toggle('dark', n.sat < 0.999);
    r.satArc.setAttribute('d', arcPath(p.x, p.y, rad + 5, n.sat));
    r.blackArc.setAttribute('d', arcPath(p.x, p.y, rad + 10, n.black));
    r.icon.textContent = '🏙';
    r.icon.setAttribute('x', p.x); r.icon.setAttribute('y', p.y + 5);
    r.label.textContent = n.demand + 'MW';
    r.label.setAttribute('x', p.x); r.label.setAttribute('y', p.y + rad + 21);
  } else if (n.type === 'plant') {
    const s = 40;
    r.shape.setAttribute('x', p.x - s / 2); r.shape.setAttribute('y', p.y - s / 2);
    r.shape.setAttribute('width', s); r.shape.setAttribute('height', s);
    r.shape.setAttribute('rx', 9);
    r.icon.textContent = '⚡';
    r.icon.setAttribute('x', p.x); r.icon.setAttribute('y', p.y + 6);
    r.label.textContent = n.out + 'MW';
    r.label.setAttribute('x', p.x); r.label.setAttribute('y', p.y + s / 2 + 17);
  } else if (n.type === 'fac') {
    const s = 44;
    const it = FAC_ITEMS[n.item];
    r.shape.setAttribute('x', p.x - s / 2); r.shape.setAttribute('y', p.y - s / 2);
    r.shape.setAttribute('width', s); r.shape.setAttribute('height', s);
    r.shape.setAttribute('rx', 10);
    r.shape.classList.toggle('off', n.sat < 0.01);
    r.satArc.setAttribute('class', 'prod-arc');
    r.satArc.setAttribute('d', arcPath(p.x, p.y, s / 2 + 8, n.prog));
    r.icon.textContent = '🏭';
    r.icon.setAttribute('x', p.x); r.icon.setAttribute('y', p.y + 6);
    r.label.textContent = `${n.need}MW · ${it.icon}→${it.short} ×${n.left}`;
    r.label.setAttribute('x', p.x); r.label.setAttribute('y', p.y + s / 2 + 19);
  } else {
    const s = 22;
    r.shape.setAttribute('x', p.x - s / 2); r.shape.setAttribute('y', p.y - s / 2);
    r.shape.setAttribute('width', s); r.shape.setAttribute('height', s);
    r.shape.setAttribute('rx', 5);
    r.shape.setAttribute('transform', `rotate(45 ${p.x} ${p.y})`);
    r.label.setAttribute('class', 'n-sub-label');
    r.label.textContent = '변전소';
    r.label.setAttribute('x', p.x); r.label.setAttribute('y', p.y + 26);
  }
}

/* 공장 철수: 노드 제거, 이어져 있던 전선은 돌려받는다 */
function retireFactory(n) {
  const linked = S.edges.filter(e => e.a === n.id || e.b === n.id).length;
  S.edges = S.edges.filter(e => e.a !== n.id && e.b !== n.id);
  S.nodes = S.nodes.filter(x => x.id !== n.id);
  S.wires += linked;
  buildWorld();
  refreshHud();
}

/* 노드 위로 떠오르는 알림 텍스트 */
function toast(n, text) {
  const t = elNS('text', 'toast');
  const p = px(n);
  t.setAttribute('x', p.x); t.setAttribute('y', p.y - 34);
  t.textContent = text;
  svg.append(t);
  setTimeout(() => t.remove(), 1600);
}

function refreshWorld() {
  for (const e of S.edges) refreshEdge(e);
  for (const n of S.nodes) refreshNode(n);
}
function refreshHud() {
  $('hud-day').textContent = S.day + '일';
  const supply = S.nodes.filter(n => n.type === 'plant').reduce((s, n) => s + n.out, 0);
  const demand = S.nodes.filter(n => n.type === 'city').reduce((s, n) => s + n.demand, 0);
  $('hud-power').textContent = `${demand} / ${supply}`;
  $('hud-wires').textContent = S.wires;
  $('hud-best').textContent = best > 0 ? `최고 ${best}일` : '';
}

/* ---------- 입력 ---------- */
function nodeAt(x, y) {
  let bestN = null, bestD = 34;
  for (const n of S.nodes) {
    const p = px(n);
    const d = Math.hypot(p.x - x, p.y - y);
    const rad = n.type === 'city' ? cityR(n) + 14 : 32;
    if (d < rad && d < bestD + rad) { bestN = n; bestD = d; }
  }
  return bestN;
}

svg.addEventListener('pointermove', ev => {
  if (!dragging) return;
  const from = S.nodes.find(n => n.id === dragging.from);
  if (!from) return;
  const p = px(from);
  refs.preview.setAttribute('d', `M ${p.x} ${p.y} L ${ev.clientX} ${ev.clientY}`);
});
svg.addEventListener('pointerup', ev => {
  if (!dragging) return;
  refs.preview.setAttribute('d', '');
  const from = dragging.from;
  dragging = null;
  const target = nodeAt(ev.clientX, ev.clientY);
  if (!target || target.id === from) return;
  if (S.wires <= 0) { flashHud(); return; }
  if (S.edges.some(e => (e.a === from && e.b === target.id) || (e.b === from && e.a === target.id))) return;
  const e = { id: S.seq++, a: from, b: target.id, cap: EDGE_CAP, flow: 0 };
  S.edges.push(e);
  S.wires--;
  buildEdge(e);
  refreshHud();
});
svg.addEventListener('pointercancel', () => {
  dragging = null;
  refs.preview?.setAttribute('d', '');
});
function flashHud() {
  $('hud-wires').parentElement.style.color = 'var(--bad)';
  setTimeout(() => { $('hud-wires').parentElement.style.color = ''; }, 600);
}

function openWireMenu(ev, edgeId) {
  closeWireMenu();
  const m = document.createElement('div');
  m.id = 'wire-menu';
  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '전선 회수';
  del.addEventListener('click', () => {
    S.edges = S.edges.filter(e => e.id !== edgeId);
    S.wires++;
    buildWorld();
    refreshHud();
    closeWireMenu();
  });
  const keep = document.createElement('button');
  keep.className = 'keep';
  keep.textContent = '취소';
  keep.addEventListener('click', closeWireMenu);
  m.append(del, keep);
  m.style.left = Math.min(ev.clientX, innerWidth - 170) + 'px';
  m.style.top = Math.min(ev.clientY + 8, innerHeight - 60) + 'px';
  document.body.append(m);
  wireMenu = m;
}
function closeWireMenu() { if (wireMenu) { wireMenu.remove(); wireMenu = null; } }
document.addEventListener('pointerdown', ev => {
  if (wireMenu && !wireMenu.contains(ev.target)) closeWireMenu();
}, true);

/* ---------- 시작 ---------- */
$('btn-start').addEventListener('click', () => {
  $('intro').classList.add('hide');
  $('intro').remove();
  startGame();
});
$('btn-retry').addEventListener('click', () => {
  $('gameover').hidden = true;
  startGame();
});
window.addEventListener('resize', () => { if (S) refreshWorld(); });
setInterval(tick, TICK * 1000);
refreshHudSafe();
function refreshHudSafe() { $('hud-best').textContent = best > 0 ? `최고 ${best}일` : ''; }
