'use strict';
const D = window.GAME_DATA;

/* ---------- 데이터 헬퍼 ---------- */
const iname = cn => D.items[cn] ? (D.items[cn].ko || D.items[cn].n) : cn;
const mname = cn => D.machines[cn] ? (D.machines[cn].ko || D.machines[cn].n) : (D.xnames[cn] || cn);
const recipeById = {};
for (const r of D.recipes) recipeById[r.id] = r;
const perMin = (r, amt) => amt * 60 / r.time;
const linePower = r => r.power ?? D.machines[r.machine].power;

const FLUIDS = ['Desc_Water_C', 'Desc_LiquidOil_C', 'Desc_NitrogenGas_C'];
const EXT = {
  'Desc_Water_C':      { build: 'Desc_WaterPump_C', rate: 120, power: 20 },
  'Desc_LiquidOil_C':  { build: 'Desc_OilPump_C',   rate: 120, power: 40 },
  'Desc_NitrogenGas_C':{ build: 'Desc_OilPump_C',   rate: 60,  power: 40, label: '질소 추출기 (간이)' },
};
const MINER = { build: 'Desc_MinerMk1_C', rate: 60, power: 5 };
const GENS = {
  coal: { build: 'Desc_GeneratorCoal_C', power: 75,  burns: [['Desc_Coal_C', 15], ['Desc_Water_C', 45]] },
  fuel: { build: 'Desc_GeneratorFuel_C', power: 250, burns: [['Desc_LiquidFuel_C', 20]] },
};
const BASE_POWER = 20;
const BUF_CAP = 100; // 포트 버퍼 용량 (기계 1대당)

/* ---------- 마일스톤 ---------- */
const MS = [
  { name: '자동 채굴', desc: '채굴기 Mk.1 해금 — 공장 배치에서 채굴기 노드를 놓고 출하 노드로 연결하세요',
    cost: { Desc_IronPlate_C: 10, Desc_IronRod_C: 10 },
    apply: s => { s.miners = true; } },
  { name: '부품 조립', desc: '조립기 해금 (보강 철판, 회전자 등)',
    cost: { Desc_IronPlate_C: 30, Desc_IronRod_C: 30, Desc_Wire_C: 100 },
    apply: s => { s.machines.push('Desc_AssemblerMk1_C'); } },
  { name: '석탄 발전', desc: '석탄 발전기 · 물 추출기 · 석탄 채굴 해금',
    cost: { Desc_IronPlateReinforced_C: 20, Desc_Rotor_C: 10, Desc_Cable_C: 50 },
    apply: s => { s.gensUnlocked.push('coal'); s.raws.push('Desc_Coal_C', 'Desc_Water_C'); } },
  { name: '기초 강철', desc: '주조소 해금 (강철 주괴, 강철 빔, 강철 파이프)',
    cost: { Desc_Cement_C: 100, Desc_Rotor_C: 20, Desc_ModularFrame_C: 10 },
    apply: s => { s.machines.push('Desc_FoundryMk1_C'); } },
  { name: '석유 정제', desc: '정제소 · 패키저 · 원유 추출기 · 연료 발전기 해금',
    cost: { Desc_SteelPlate_C: 50, Desc_SteelPipe_C: 100, Desc_SteelPlateReinforced_C: 20 },
    apply: s => { s.machines.push('Desc_OilRefinery_C', 'Desc_Packager_C'); s.gensUnlocked.push('fuel'); s.raws.push('Desc_LiquidOil_C'); } },
  { name: '고급 제조', desc: '제조기 해금 + 카테리움 · 원시 수정 · 유황 채굴',
    cost: { Desc_Motor_C: 20, Desc_Plastic_C: 100, Desc_Rubber_C: 100, Desc_SteelPlate_C: 100 },
    apply: s => { s.machines.push('Desc_ManufacturerMk1_C'); s.raws.push('Desc_OreGold_C', 'Desc_RawQuartz_C', 'Desc_Sulfur_C'); } },
  { name: '첨단 소재', desc: '블렌더 · 입자 가속기 · 변환기 · 양자 인코더 + 보크사이트 · 우라늄 · SAM · 질소 해금',
    cost: { Desc_Computer_C: 20, Desc_ModularFrameHeavy_C: 10, Desc_Motor_C: 50 },
    apply: s => {
      s.machines.push('Desc_Blender_C', 'Desc_HadronCollider_C', 'Desc_Converter_C', 'Desc_QuantumEncoder_C');
      s.raws.push('Desc_OreBauxite_C', 'Desc_OreUranium_C', 'Desc_SAM_C', 'Desc_NitrogenGas_C');
    } },
  { name: '프로젝트 조립: 1단계', desc: '궤도 엘리베이터로 부품을 발사합니다 — 최종 목표!',
    cost: { Desc_SpaceElevatorPart_1_C: 50, Desc_SpaceElevatorPart_2_C: 50, Desc_SpaceElevatorPart_3_C: 50 },
    apply: s => { s.won = true; } },
];

/* ---------- 상태 ---------- */
const SAVE_KEY = 'sfy-idle-v2';
const OLD_KEY = 'sfy-idle-v1';
let state = null;

function freshState() {
  return {
    stock: {},
    nodes: [
      { id: 1, type: 'sink', x: 620, y: 120, count: 1, buf: { in: {}, out: {} } },
    ],
    edges: [],
    seq: 2,
    gens: { coal: 0, fuel: 0 },
    gensUnlocked: [],
    machines: ['Desc_SmelterMk1_C', 'Desc_ConstructorMk1_C'],
    raws: ['Desc_OreIron_C', 'Desc_OreCopper_C', 'Desc_Stone_C'],
    miners: false,
    ms: 0,
    won: false,
    savedAt: Date.now(),
  };
}

const stockOf = cn => state.stock[cn] || 0;
const addStock = (cn, n) => { state.stock[cn] = Math.max(0, stockOf(cn) + n); };
const canAfford = cost => Object.entries(cost).every(([cn, n]) => stockOf(cn) >= n);
const pay = cost => { for (const [cn, n] of Object.entries(cost)) addStock(cn, -n); };
const refund = cost => { for (const [cn, n] of Object.entries(cost)) addStock(cn, n); };
const buildCost = cn => Object.fromEntries(D.build[cn]);

function save() {
  state.savedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.nodes)) return s;
    }
    // v1 (콤보박스 라인) 저장 → 기계·채굴기 비용을 전액 환불하고 그래프 방식으로 이전
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const s1 = JSON.parse(old);
      const s2 = { ...freshState(), stock: s1.stock || {}, gens: s1.gens || { coal: 0, fuel: 0 },
        gensUnlocked: s1.gensUnlocked || [], machines: s1.machines, raws: s1.raws,
        miners: s1.miners, ms: s1.ms, won: s1.won };
      for (const line of s1.lines || []) {
        const r = recipeById[line.recipeId];
        if (r) for (const [cn, n] of Object.entries(buildCost(r.machine))) addToStock(s2.stock, cn, n * line.count);
      }
      for (const [rawCn, count] of Object.entries(s1.ext || {})) {
        const def = EXT[rawCn] || MINER;
        for (const [cn, n] of Object.entries(buildCost(def.build))) addToStock(s2.stock, cn, n * count);
      }
      localStorage.removeItem(OLD_KEY);
      s2._migrated = true;
      return s2;
    }
  } catch (e) { /* 손상된 저장은 무시 */ }
  return null;
}
function addToStock(stock, cn, n) { stock[cn] = (stock[cn] || 0) + n; }

/* ---------- 노드 정의 ---------- */
const nodeById = id => state.nodes.find(n => n.id === id);

function nodeDef(n) {
  if (n.type === 'miner') {
    const def = EXT[n.resource] || MINER;
    return {
      label: (def.label || D.xnames[def.build]),
      iconCn: n.resource,
      ins: [],
      outs: [{ item: n.resource, rate: def.rate }],
      power: def.power,
      cost: buildCost(def.build),
    };
  }
  if (n.type === 'machine') {
    const r = recipeById[n.recipeId];
    return {
      label: (r.alt ? '★ ' : '') + r.ko,
      iconCn: r.out[0][0],
      ins: r.in.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) })),
      outs: r.out.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) })),
      power: linePower(r),
      cost: buildCost(r.machine),
      machine: r.machine,
    };
  }
  return { label: '출하 (재고로)', iconCn: null, ins: [], outs: [], power: 0, cost: {} }; // sink
}

/* ---------- 시뮬레이션 ---------- */
let lastRates = {};
let lastPower = { supply: BASE_POWER, demand: 0, eff: 1 };

function tick(dtMin) {
  const prev = { ...state.stock };

  // 1) 발전: 연료 있는 만큼 가동
  let supply = BASE_POWER;
  for (const [key, g] of Object.entries(GENS)) {
    const count = state.gens[key];
    if (count <= 0) continue;
    let frac = 1;
    for (const [fuelCn, rate] of g.burns) {
      const need = rate * count * dtMin;
      if (need > 0) frac = Math.min(frac, stockOf(fuelCn) / need);
    }
    frac = Math.min(1, Math.max(0, frac));
    for (const [fuelCn, rate] of g.burns) addStock(fuelCn, -rate * count * dtMin * frac);
    supply += g.power * count * frac;
  }

  // 2) 수요 · 전력 효율
  let demand = 0;
  for (const n of state.nodes) demand += nodeDef(n).power * n.count;
  const powerEff = demand > 0 ? Math.min(1, supply / demand) : 1;

  // 3) 연결선으로 아이템 이동 (출력 버퍼 → 입력 버퍼 / 출하 노드는 재고로)
  const groups = {}; // "nodeId|item" -> edges[]
  for (const e of state.edges) {
    (groups[e.from.node + '|' + e.from.item] ??= []).push(e);
  }
  for (const [key, edges] of Object.entries(groups)) {
    const [fromId, item] = key.split('|');
    const from = nodeById(+fromId);
    if (!from) continue;
    const avail = from.buf.out[item] || 0;
    if (avail <= 0) continue;
    const share = avail / edges.length;
    for (const e of edges) {
      const dst = nodeById(e.to.node);
      if (!dst) continue;
      let moved;
      if (dst.type === 'sink') {
        moved = share;
        addStock(item, moved);
      } else {
        const cap = BUF_CAP * Math.max(1, dst.count);
        const space = cap - (dst.buf.in[item] || 0);
        moved = Math.min(share, Math.max(0, space));
        dst.buf.in[item] = (dst.buf.in[item] || 0) + moved;
      }
      from.buf.out[item] -= moved;
    }
  }

  // 4) 채굴기 노드: 출력 버퍼 공간만큼 생산 (막히면 정지 = 배압)
  for (const n of state.nodes) {
    if (n.type !== 'miner' || n.count <= 0) { if (n.type === 'miner') n.eff = 0; continue; }
    const def = nodeDef(n);
    const out = def.outs[0];
    const cap = BUF_CAP * n.count;
    const want = out.rate * n.count * powerEff * dtMin;
    const space = Math.max(0, cap - (n.buf.out[out.item] || 0));
    const make = Math.min(want, space);
    n.buf.out[out.item] = (n.buf.out[out.item] || 0) + make;
    n.eff = want > 0 ? powerEff * (make / want) : 0;
  }

  // 5) 기계 노드: 입력 버퍼 재료 + 출력 공간만큼 가동
  for (const n of state.nodes) {
    if (n.type !== 'machine') continue;
    if (n.count <= 0) { n.eff = 0; continue; }
    const def = nodeDef(n);
    const run = n.count * powerEff;
    if (run <= 0) { n.eff = 0; continue; }
    let frac = 1;
    for (const p of def.ins) {
      const need = p.rate * run * dtMin;
      if (need > 0) frac = Math.min(frac, (n.buf.in[p.item] || 0) / need);
    }
    const cap = BUF_CAP * n.count;
    for (const p of def.outs) {
      const make = p.rate * run * dtMin;
      if (make > 0) frac = Math.min(frac, Math.max(0, cap - (n.buf.out[p.item] || 0)) / make);
    }
    frac = Math.min(1, Math.max(0, frac));
    for (const p of def.ins) n.buf.in[p.item] = Math.max(0, (n.buf.in[p.item] || 0) - p.rate * run * dtMin * frac);
    for (const p of def.outs) n.buf.out[p.item] = (n.buf.out[p.item] || 0) + p.rate * run * dtMin * frac;
    n.eff = powerEff * frac;
  }

  const keys = new Set([...Object.keys(prev), ...Object.keys(state.stock)]);
  lastRates = {};
  for (const cn of keys) lastRates[cn] = ((state.stock[cn] || 0) - (prev[cn] || 0)) / dtMin;
  lastPower = { supply, demand, eff: powerEff };
}

/* ---------- UI 공통 ---------- */
const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const fmtN = x => x >= 100 ? Math.floor(x).toLocaleString() : (Math.floor(x * 10) / 10).toLocaleString();
const fmtRate = x => (x > 0 ? '+' : '') + (Math.round(x * 10) / 10).toLocaleString() + '/분';

let updaters = [];
const onUpdate = fn => { updaters.push(fn); fn(); };

function iconEl(cn, size) {
  const img = el('img', size === 's' ? 'icon icon-s' : 'icon');
  img.src = 'icons/' + cn + '.png';
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => img.remove();
  return img;
}

function chipRow(cost) {
  const box = el('span', 'chips');
  const chips = Object.entries(cost).map(([cn, n]) => {
    const chip = el('span', 'chip');
    const val = el('b');
    chip.append(iconEl(cn, 's'), el('span', null, iname(cn)), val);
    box.append(chip);
    return { chip, val, cn, n };
  });
  const refresh = () => {
    for (const c of chips) {
      const have = stockOf(c.cn);
      c.val.textContent = `${fmtN(have)}/${c.n}`;
      c.chip.className = 'chip ' + (have >= c.n ? 'ok' : 'no');
    }
  };
  return { box, refresh };
}

/* --- 마일스톤 --- */
function buildMilestone() {
  const box = $('milestone-body');
  box.textContent = '';
  if (state.ms >= MS.length) {
    box.append(el('div', 'ms-done', '모든 마일스톤 달성! 자유롭게 공장을 확장하세요.'));
    return;
  }
  const m = MS[state.ms];
  box.append(el('div', 'ms-name', `${state.ms + 1}. ${m.name}`));
  box.append(el('div', 'hint', m.desc));
  const rows = [];
  for (const [cn, n] of Object.entries(m.cost)) {
    const row = el('div', 'ms-cost');
    const label = el('span');
    label.append(iconEl(cn, 's'), ' ' + iname(cn));
    row.append(label);
    const val = el('span');
    row.append(val);
    const bar = el('div', 'ms-bar');
    const fill = el('div');
    bar.append(fill);
    rows.push([cn, n, val, bar, fill]);
    box.append(row, bar);
  }
  const btn = el('button', null, '마일스톤 달성');
  btn.addEventListener('click', () => {
    if (!canAfford(m.cost)) return;
    pay(m.cost);
    m.apply(state);
    state.ms++;
    if (state.won) showBanner('🎉 프로젝트 조립 1단계 완료! FICSIT이 만족했습니다. 계속 확장해도 좋습니다.');
    rebuild();
    save();
  });
  box.append(btn);
  onUpdate(() => {
    for (const [cn, n, val, bar, fill] of rows) {
      const have = stockOf(cn);
      val.textContent = `${fmtN(have)} / ${n}`;
      val.className = have >= n ? 'ok' : 'no';
      fill.style.width = Math.min(100, have / n * 100) + '%';
      bar.className = 'ms-bar' + (have >= n ? ' full' : '');
    }
    btn.disabled = !canAfford(m.cost);
  });
}

function showBanner(text) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
}

/* --- 수동 채집 --- */
function buildGather() {
  const box = $('gather-buttons');
  box.textContent = '';
  for (const cn of state.raws) {
    if (FLUIDS.includes(cn)) continue;
    const btn = el('button', 'mini');
    btn.append(iconEl(cn, 's'), ` ${iname(cn)} +1`);
    btn.addEventListener('click', () => { addStock(cn, 1); update(); });
    box.append(btn);
  }
}

/* --- 수동 제작 --- */
let handSelected = null;
const HAND_RECIPES = D.recipes.filter(r => r.hand && !r.alt);

function buildHand() {
  const search = $('hand-search');
  const listBox = $('hand-list');

  let reqRefresh = null;
  const renderReq = () => {
    const box = $('hand-req');
    box.textContent = '';
    const r = recipeById[handSelected];
    if (!r) {
      box.append(el('div', 'hint', '목록에서 레시피를 클릭해 선택하세요.'));
      reqRefresh = null;
      return;
    }
    const need = el('div');
    need.append(el('span', 'hint', '재료  '));
    const chips = chipRow(Object.fromEntries(r.in));
    need.append(chips.box);
    box.append(need);
    const out = el('div', 'hint', '→ 산출: ');
    for (const [cn, amt] of r.out) {
      out.append(iconEl(cn, 's'), ` ${iname(cn)} ×${amt}  `);
    }
    box.append(out);
    reqRefresh = chips.refresh;
    chips.refresh();
  };

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const scroll = listBox.scrollTop;
    listBox.textContent = '';
    const groups = {};
    for (const r of HAND_RECIPES) {
      if (q && !(r.ko.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))) continue;
      (groups[r.machine] ??= []).push(r);
    }
    let any = false;
    for (const [m, rs] of Object.entries(groups)) {
      any = true;
      listBox.append(el('div', 'hand-group', mname(m)));
      rs.sort((a, b) => a.ko.localeCompare(b.ko, 'ko'));
      for (const r of rs) {
        const row = el('div', 'hand-item' + (r.id === handSelected ? ' sel' : ''));
        const left = el('span');
        left.append(iconEl(r.out[0][0]), ' ' + r.ko);
        row.append(left, el('span', 'en', r.name));
        row.addEventListener('click', () => {
          handSelected = r.id;
          $('hand-info').textContent = '';
          renderList();
          renderReq();
        });
        listBox.append(row);
      }
    }
    if (!any) listBox.append(el('div', 'hand-empty', '검색 결과가 없습니다'));
    listBox.scrollTop = scroll;
  };
  search.oninput = renderList;
  renderList();
  renderReq();
  onUpdate(() => { if (reqRefresh) reqRefresh(); });

  const craft = times => {
    const r = recipeById[handSelected];
    if (!r) { $('hand-info').textContent = '레시피를 먼저 선택하세요.'; return; }
    let made = 0;
    for (let i = 0; i < times; i++) {
      if (!r.in.every(([cn, amt]) => stockOf(cn) >= amt)) break;
      for (const [cn, amt] of r.in) addStock(cn, -amt);
      for (const [cn, amt] of r.out) addStock(cn, amt);
      made++;
    }
    const out = r.out.map(([cn, amt]) => `${iname(cn)}×${amt * made}`).join(', ');
    $('hand-info').textContent = made > 0
      ? `${out} 제작 완료`
      : `재료 부족: ${r.in.map(([cn, amt]) => `${iname(cn)}×${amt}`).join(', ')} 필요`;
    update();
  };
  $('hand-craft-1').onclick = () => craft(1);
  $('hand-craft-10').onclick = () => craft(10);
}

/* --- 발전 --- */
function buildGens() {
  const box = $('extractor-list');
  box.textContent = '';
  if (state.gensUnlocked.length === 0) {
    box.append(el('div', 'hint', `기본 전력 ${BASE_POWER}MW. 마일스톤 3에서 석탄 발전기가 해금됩니다.`));
    return;
  }
  for (const key of state.gensUnlocked) {
    const g = GENS[key];
    const burns = g.burns.map(([cn, rate]) => `${iname(cn)} ${rate}/분`).join(' + ');
    const row = el('div', 'row');
    const grow = el('div', 'grow');
    const name = el('div', 'name');
    name.append(iconEl(g.build), ' ' + D.xnames[g.build]);
    grow.append(name);
    grow.append(el('div', 'detail', `+${g.power}MW · 소비 ${burns} (재고에서 차감)`));
    row.append(grow);
    const cnt = el('span', 'cnt', '0');
    const minus = el('button', 'mini ghost', '−');
    const plus = el('button', 'mini', '+');
    const cost = buildCost(g.build);
    minus.addEventListener('click', () => {
      if (state.gens[key] > 0) { state.gens[key]--; refund(cost); update(); save(); }
    });
    plus.addEventListener('click', () => {
      if (canAfford(cost)) { pay(cost); state.gens[key]++; update(); save(); }
    });
    row.append(minus, cnt, plus);
    const costLine = el('div', 'cost-line');
    costLine.append(el('span', null, '비용'));
    const chips = chipRow(cost);
    costLine.append(chips.box);
    row.append(costLine);
    box.append(row);
    onUpdate(() => {
      cnt.textContent = state.gens[key];
      plus.disabled = !canAfford(cost);
      minus.disabled = state.gens[key] <= 0;
      chips.refresh();
    });
  }
}

/* ---------- 공장 배치 캔버스 ---------- */
const drag = { mode: null, node: null, dx: 0, dy: 0, fromNode: null, fromItem: null, pendingRebuild: false };
let portEls = {}; // "nodeId|item|dir" -> element

function canvasPos(e) {
  const rect = $('canvas-inner').getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function portAnchor(nodeId, item, dir) {
  const elp = portEls[nodeId + '|' + item + '|' + dir] || portEls[nodeId + '|*|' + dir];
  if (!elp) return null;
  const rect = elp.getBoundingClientRect();
  const cRect = $('canvas-inner').getBoundingClientRect();
  return { x: rect.left + rect.width / 2 - cRect.left, y: rect.top + rect.height / 2 - cRect.top };
}

function edgePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function layoutEdges() {
  const svg = $('edge-svg');
  for (const path of svg.querySelectorAll('path.edge, path.edge-hit')) {
    const e = state.edges.find(x => x.id === +path.dataset.id);
    if (!e) { path.remove(); continue; }
    const a = portAnchor(e.from.node, e.from.item, 'out');
    const b = portAnchor(e.to.node, e.to.item, 'in');
    if (a && b) path.setAttribute('d', edgePath(a, b));
  }
}

function addEdge(fromNode, fromItem, toNodeId, toItem) {
  const dst = nodeById(toNodeId);
  if (!dst) return;
  if (dst.type !== 'sink' && toItem !== fromItem) return;              // 같은 아이템 포트만
  const finalToItem = dst.type === 'sink' ? fromItem : toItem;
  if (fromNode === toNodeId) return;
  if (state.edges.some(e => e.from.node === fromNode && e.from.item === fromItem
      && e.to.node === toNodeId && e.to.item === finalToItem)) return; // 중복 방지
  state.edges.push({ id: state.seq++, from: { node: fromNode, item: fromItem }, to: { node: toNodeId, item: finalToItem } });
  save();
  rebuild();
}

function removeEdge(id) {
  state.edges = state.edges.filter(e => e.id !== id);
  save();
  rebuild();
}

function removeNode(id) {
  const n = nodeById(id);
  if (!n) return;
  const def = nodeDef(n);
  refund(Object.fromEntries(Object.entries(def.cost).map(([cn, c]) => [cn, c * n.count])));
  state.nodes = state.nodes.filter(x => x.id !== id);
  state.edges = state.edges.filter(e => e.from.node !== id && e.to.node !== id);
  save();
  rebuild();
}

function spawnXY() {
  const k = state.nodes.length;
  return { x: 60 + (k % 5) * 210, y: 60 + Math.floor(k / 5) * 170 % 900 };
}

function addNode(node) {
  Object.assign(node, spawnXY());
  node.id = state.seq++;
  node.buf = { in: {}, out: {} };
  state.nodes.push(node);
  save();
  rebuild();
}

function buildFactoryBar() {
  const resSel = $('add-res');
  const mSel = $('add-machine');
  const rSel = $('add-recipe');
  const prevRes = resSel.value, prevM = mSel.value, prevR = rSel.value;

  resSel.textContent = '';
  for (const cn of state.raws) {
    const opt = el('option', null, iname(cn));
    opt.value = cn;
    resSel.append(opt);
  }
  if (prevRes && state.raws.includes(prevRes)) resSel.value = prevRes;

  mSel.textContent = '';
  for (const m of state.machines) {
    const opt = el('option', null, mname(m));
    opt.value = m;
    mSel.append(opt);
  }
  if (prevM && state.machines.includes(prevM)) mSel.value = prevM;
  const fillRecipes = () => {
    rSel.textContent = '';
    const list = D.recipes.filter(r => r.machine === mSel.value)
      .sort((a, b) => (a.alt - b.alt) || a.ko.localeCompare(b.ko, 'ko'));
    for (const r of list) {
      const opt = el('option', null, (r.alt ? '★ ' : '') + r.ko);
      opt.value = r.id;
      rSel.append(opt);
    }
  };
  mSel.onchange = () => { fillRecipes(); rebuildBarCosts(); };
  fillRecipes();
  if (prevR && [...rSel.options].some(o => o.value === prevR)) rSel.value = prevR;
  rSel.onchange = () => rebuildBarCosts();

  // 비용 칩 (선택 기준, 노드 자체는 무료 — 기계 구매는 노드 안의 + 버튼)
  let minerChips = null, machineChips = null;
  const rebuildBarCosts = () => {
    const mc = $('miner-cost');
    mc.textContent = '';
    if (state.miners && resSel.value) {
      const def = EXT[resSel.value] || MINER;
      minerChips = chipRow(buildCost(def.build));
      mc.append(minerChips.box);
    } else minerChips = null;
    const xc = $('machine-cost');
    xc.textContent = '';
    if (rSel.value) {
      machineChips = chipRow(buildCost(recipeById[rSel.value].machine));
      xc.append(machineChips.box);
    } else machineChips = null;
  };
  resSel.onchange = () => rebuildBarCosts();
  rebuildBarCosts();

  $('add-miner').onclick = () => {
    if (!state.miners || !resSel.value) return;
    addNode({ type: 'miner', resource: resSel.value, count: 0 });
  };
  $('add-node').onclick = () => {
    if (!rSel.value) return;
    addNode({ type: 'machine', recipeId: rSel.value, count: 0 });
  };
  $('add-sink').onclick = () => addNode({ type: 'sink', count: 1 });

  onUpdate(() => {
    $('add-miner').disabled = !state.miners;
    if (minerChips) minerChips.refresh();
    if (machineChips) machineChips.refresh();
  });
}

function buildFactory() {
  portEls = {};
  const layer = $('node-layer');
  layer.textContent = '';
  const svg = $('edge-svg');
  svg.textContent = '';

  for (const n of state.nodes) {
    const def = nodeDef(n);
    const box = el('div', 'fnode' + (n.type === 'sink' ? ' sink' : ''));
    box.style.left = n.x + 'px';
    box.style.top = n.y + 'px';
    box.dataset.id = n.id;

    // 헤더
    const head = el('div', 'fnode-head');
    if (def.iconCn) head.append(iconEl(def.iconCn, 's'));
    head.append(el('span', null, def.label));
    const eff = el('span', 'eff');
    head.append(eff);
    box.append(head);

    // 포트
    const body = el('div', 'fnode-body');
    const insCol = el('div', 'ports in');
    const outsCol = el('div', 'ports out');
    if (n.type === 'sink') {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.node = n.id; dot.dataset.item = '*'; dot.dataset.dir = 'in';
      portEls[n.id + '|*|in'] = dot;
      p.append(dot, el('span', null, '모든 아이템 → 재고'));
      insCol.append(p);
    }
    for (const pin of def.ins) {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.node = n.id; dot.dataset.item = pin.item; dot.dataset.dir = 'in';
      portEls[n.id + '|' + pin.item + '|in'] = dot;
      const buf = el('span', 'buf', '0');
      p.append(dot, iconEl(pin.item, 's'), el('span', 'rate', `${fmtN(pin.rate)}/분`), buf);
      p.title = iname(pin.item);
      insCol.append(p);
      onUpdate(() => { buf.textContent = fmtN(n.buf.in[pin.item] || 0); });
    }
    for (const pout of def.outs) {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.node = n.id; dot.dataset.item = pout.item; dot.dataset.dir = 'out';
      portEls[n.id + '|' + pout.item + '|out'] = dot;
      const buf = el('span', 'buf', '0');
      p.append(dot, iconEl(pout.item, 's'), el('span', 'rate', `${fmtN(pout.rate)}/분`), buf);
      p.title = iname(pout.item);
      outsCol.append(p);
      onUpdate(() => { buf.textContent = fmtN(n.buf.out[pout.item] || 0); });
    }
    body.append(insCol, outsCol);
    box.append(body);

    // 푸터: 기계 수 구매/판매/삭제
    const foot = el('div', 'fnode-foot');
    if (n.type !== 'sink') {
      const minus = el('button', 'ghost', '−');
      const cnt = el('span', 'cnt', n.count);
      const plus = el('button', null, '+');
      minus.addEventListener('click', () => {
        if (n.count > 0) { n.count--; refund(def.cost); update(); save(); }
      });
      plus.addEventListener('click', () => {
        if (canAfford(def.cost)) { pay(def.cost); n.count++; update(); save(); }
      });
      foot.append(minus, cnt, plus, el('span', 'hint', `${def.power}MW/대`));
      onUpdate(() => {
        cnt.textContent = n.count;
        plus.disabled = !canAfford(def.cost);
        minus.disabled = n.count <= 0;
      });
    }
    const del = el('button', 'ghost danger del', '✕');
    del.title = '노드 삭제 (기계 비용 환불)';
    del.addEventListener('click', () => removeNode(n.id));
    foot.append(del);
    box.append(foot);

    // 기계 1대 건설에 필요한 재료 (충족=초록/부족=빨강, 호버 시 보유량)
    if (n.type !== 'sink') {
      const costRow = el('div', 'fnode-cost');
      costRow.append(el('span', 'hint', '건설'));
      const minis = Object.entries(def.cost).map(([cn, need]) => {
        const chip = el('span', 'chip-mini');
        chip.append(iconEl(cn, 's'), el('b', null, need));
        costRow.append(chip);
        return { chip, cn, need };
      });
      box.append(costRow);
      onUpdate(() => {
        for (const m of minis) {
          const have = stockOf(m.cn);
          m.chip.className = 'chip-mini ' + (have >= m.need ? 'ok' : 'no');
          m.chip.title = `${iname(m.cn)} — 보유 ${fmtN(have)} / 필요 ${m.need}`;
        }
      });
    }

    onUpdate(() => {
      if (n.type === 'sink') { eff.textContent = ''; return; }
      const pct = Math.round((n.eff || 0) * 100);
      eff.textContent = n.count > 0 ? pct + '%' : '휴면';
      eff.style.color = pct >= 99 ? 'var(--good)' : (n.count > 0 ? 'var(--bad)' : 'var(--muted)');
    });

    layer.append(box);
  }

  // 연결선 (표시용 + 클릭용 넓은 투명 히트 영역)
  for (const e of state.edges) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('edge');
    path.dataset.id = e.id;
    svg.append(path);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.classList.add('edge-hit');
    hit.dataset.id = e.id;
    const t = `${iname(e.from.item)}: ${nodeDef(nodeById(e.from.node))?.label} → ${nodeDef(nodeById(e.to.node))?.label} (클릭하면 삭제)`;
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = t;
    hit.append(title);
    hit.addEventListener('click', () => removeEdge(e.id));
    hit.addEventListener('pointerenter', () => path.classList.add('hover'));
    hit.addEventListener('pointerleave', () => path.classList.remove('hover'));
    svg.append(hit);
  }
  layoutEdges();
}

function initFactoryEvents() {
  const wrap = $('canvas-wrap');
  const svg = $('edge-svg');

  wrap.addEventListener('pointerdown', e => {
    const head = e.target.closest('.fnode-head');
    const dot = e.target.closest('.port .dot');
    if (dot && dot.dataset.dir === 'out') {
      drag.mode = 'edge';
      drag.fromNode = +dot.dataset.node;
      drag.fromItem = dot.dataset.item;
      const pending = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pending.classList.add('pending');
      pending.id = 'pending-edge';
      svg.append(pending);
      e.preventDefault();
    } else if (head) {
      const box = head.closest('.fnode');
      const n = nodeById(+box.dataset.id);
      const pos = canvasPos(e);
      drag.mode = 'node';
      drag.node = n;
      drag.dx = pos.x - n.x;
      drag.dy = pos.y - n.y;
      e.preventDefault();
    } else if (!e.target.closest('.fnode')) {
      // 빈 캔버스: 잡고 드래그하면 화면 이동 (패닝)
      drag.mode = 'pan';
      drag.px = e.clientX;
      drag.py = e.clientY;
      drag.sx = wrap.scrollLeft;
      drag.sy = wrap.scrollTop;
      wrap.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  wrap.addEventListener('pointermove', e => {
    if (drag.mode === 'node' && drag.node) {
      const pos = canvasPos(e);
      drag.node.x = Math.max(0, Math.min(2200, pos.x - drag.dx));
      drag.node.y = Math.max(0, Math.min(1300, pos.y - drag.dy));
      const box = $('node-layer').querySelector(`.fnode[data-id="${drag.node.id}"]`);
      if (box) { box.style.left = drag.node.x + 'px'; box.style.top = drag.node.y + 'px'; }
      layoutEdges();
    } else if (drag.mode === 'edge') {
      const a = portAnchor(drag.fromNode, drag.fromItem, 'out');
      const b = canvasPos(e);
      const pending = $('pending-edge');
      if (a && pending) pending.setAttribute('d', edgePath(a, b));
    } else if (drag.mode === 'pan') {
      wrap.scrollLeft = drag.sx - (e.clientX - drag.px);
      wrap.scrollTop = drag.sy - (e.clientY - drag.py);
    }
  });

  const endDrag = e => {
    if (drag.mode === 'edge') {
      $('pending-edge')?.remove();
      const dot = e.target.closest ? e.target.closest('.port .dot') : null;
      if (dot && dot.dataset.dir === 'in') {
        addEdge(drag.fromNode, drag.fromItem, +dot.dataset.node, dot.dataset.item);
      }
    }
    if (drag.mode === 'node') save();
    if (drag.mode === 'pan') wrap.style.cursor = '';
    drag.mode = null;
    drag.node = null;
    if (drag.pendingRebuild) { drag.pendingRebuild = false; rebuild(); }
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointerleave', e => { if (drag.mode === 'edge') endDrag(e); });
}

/* 재고 클릭 → 해당 아이템의 수동 제작 레시피 자동 선택 */
function selectHandRecipeFor(cn) {
  const r = HAND_RECIPES.find(x => x.out[0][0] === cn)
    || HAND_RECIPES.find(x => x.out.some(o => o[0] === cn));
  if (!r) return false;
  handSelected = r.id;
  $('hand-search').value = '';
  $('hand-info').textContent = '';
  rebuild();
  const sel = $('hand-list').querySelector('.hand-item.sel');
  if (sel) sel.scrollIntoView({ block: 'center' });
  const panel = $('hand-list').closest('.panel');
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
const handCraftable = cn => HAND_RECIPES.some(x => x.out.some(o => o[0] === cn));

/* --- 재고 --- */
let stockKeys = '';
function visibleStock() {
  const visible = Object.keys(state.stock).filter(cn => stockOf(cn) >= 0.05);
  for (const cn of state.raws) if (!visible.includes(cn)) visible.push(cn);
  visible.sort((a, b) => {
    const ra = D.raw.includes(a), rb = D.raw.includes(b);
    if (ra !== rb) return ra ? -1 : 1;
    return iname(a).localeCompare(iname(b), 'ko');
  });
  return visible;
}
function buildStock() {
  const visible = visibleStock();
  stockKeys = visible.join(',');
  const t = $('stock-table');
  t.textContent = '';
  for (const cn of visible) {
    const tr = el('tr', D.raw.includes(cn) ? 'raw' : null);
    const nameTd = el('td');
    nameTd.append(iconEl(cn, 's'), ' ' + iname(cn));
    tr.append(nameTd);
    if (handCraftable(cn)) {
      tr.classList.add('clickable');
      tr.title = '클릭하면 수동 제작에서 이 아이템의 레시피가 선택됩니다';
      tr.addEventListener('click', () => selectHandRecipeFor(cn));
    }
    const num = el('td', 'num');
    const rate = el('td', 'rate');
    tr.append(num, rate);
    t.append(tr);
    onUpdate(() => {
      num.textContent = fmtN(stockOf(cn));
      const v = lastRates[cn] || 0;
      rate.textContent = fmtRate(v);
      rate.className = 'rate ' + (v > 0.05 ? 'rate-up' : v < -0.05 ? 'rate-down' : 'rate-zero');
    });
  }
}

/* --- 전력 --- */
function buildPower() {
  onUpdate(() => {
    const { supply, demand } = lastPower;
    $('power-text').textContent = `${fmtN(demand)} / ${fmtN(supply)} MW`;
    const pct = supply > 0 ? Math.min(100, demand / supply * 100) : 100;
    const fill = $('power-fill');
    fill.style.width = pct + '%';
    fill.style.background = demand > supply ? 'var(--bad)' : 'var(--good)';
  });
}

/* ---------- 조립 ---------- */
function rebuild() {
  if (drag.mode) { drag.pendingRebuild = true; return; }
  updaters = [];
  buildMilestone();
  buildGather();
  buildHand();
  buildGens();
  buildFactoryBar();
  buildFactory();
  buildStock();
  buildPower();
}

function update() {
  if (!drag.mode && visibleStock().join(',') !== stockKeys) { rebuild(); return; }
  for (const fn of updaters) fn();
}

/* ---------- 시작 ---------- */
function init() {
  state = load() || freshState();
  if (state._migrated) {
    delete state._migrated;
    showBanner('🔧 공장이 그래프 방식으로 개편되어 기존 기계·채굴기 비용이 전액 재고로 환불되었습니다. 아래 공장 배치에서 다시 연결해 보세요!');
  }

  const elapsedSec = Math.min(4 * 3600, (Date.now() - (state.savedAt || Date.now())) / 1000);
  if (elapsedSec > 10) {
    const steps = Math.floor(elapsedSec / 5);
    for (let i = 0; i < steps; i++) tick(5 / 60);
    showBanner(`⏰ 오프라인 ${Math.floor(elapsedSec / 60)}분 동안 공장이 가동됐습니다.`);
    setTimeout(() => { $('banner').hidden = true; }, 6000);
  }
  if (state.won) showBanner('🎉 프로젝트 조립 1단계 완료! FICSIT이 만족했습니다. 계속 확장해도 좋습니다.');

  initFactoryEvents();
  rebuild();
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dtMin = Math.min(10000, now - lastTick) / 60000;
    lastTick = now;
    tick(dtMin);
    update();
  }, 200);
  setInterval(save, 10000);
  $('btn-save').addEventListener('click', () => { save(); });
  $('btn-reset').addEventListener('click', () => {
    if (confirm('정말 처음부터 다시 시작할까요? 저장이 삭제됩니다.')) {
      localStorage.removeItem(SAVE_KEY);
      state = freshState();
      $('banner').hidden = true;
      rebuild();
    }
  });
}
init();
