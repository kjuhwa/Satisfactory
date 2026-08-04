'use strict';
const D = window.GAME_DATA;

/* ---------- 데이터 헬퍼 ---------- */
const iname = cn => D.items[cn] ? (D.items[cn].ko || D.items[cn].n) : cn;
const mname = cn => D.machines[cn] ? (D.machines[cn].ko || D.machines[cn].n) : (D.xnames[cn] || cn);
const isLiq = cn => D.items[cn] && D.items[cn].liq;
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

/* ---------- 마일스톤 ---------- */
const MS = [
  { name: '자동 채굴', desc: '채굴기 Mk.1 해금 — 이제 클릭하지 않아도 광석이 쌓입니다',
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
const SAVE_KEY = 'sfy-idle-v1';
let state = null;

function freshState() {
  return {
    stock: {},
    lines: [],                 // [{recipeId, count}]
    ext: {},                   // rawCn -> count
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

function save() {
  state.savedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.lines)) return null;
    return s;
  } catch (e) { return null; }
}

/* ---------- 재고 헬퍼 ---------- */
const stockOf = cn => state.stock[cn] || 0;
const addStock = (cn, n) => { state.stock[cn] = Math.max(0, stockOf(cn) + n); };
const canAfford = cost => Object.entries(cost).every(([cn, n]) => stockOf(cn) >= n);
const pay = cost => { for (const [cn, n] of Object.entries(cost)) addStock(cn, -n); };
const refund = cost => { for (const [cn, n] of Object.entries(cost)) addStock(cn, n); };
const buildCost = cn => Object.fromEntries(D.build[cn]);

/* ---------- 시뮬레이션 ---------- */
let lastRates = {}; // itemCn -> per-min net rate (표시용)

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

  // 2) 수요 · 전력 효율 (부족하면 전체 감속)
  let demand = 0;
  for (const [rawCn, count] of Object.entries(state.ext)) {
    demand += (EXT[rawCn] || MINER).power * count;
  }
  for (const line of state.lines) {
    demand += linePower(recipeById[line.recipeId]) * line.count;
  }
  const powerEff = demand > 0 ? Math.min(1, supply / demand) : 1;

  // 3) 추출
  for (const [rawCn, count] of Object.entries(state.ext)) {
    if (count > 0) addStock(rawCn, (EXT[rawCn] || MINER).rate * count * powerEff * dtMin);
  }

  // 4) 생산 라인 (등록 순서대로 재고를 소비)
  for (const line of state.lines) {
    const r = recipeById[line.recipeId];
    const run = line.count * powerEff;
    if (run <= 0) { line.eff = 0; continue; }
    let frac = 1;
    for (const [cn, amt] of r.in) {
      const need = perMin(r, amt) * run * dtMin;
      if (need > 0) frac = Math.min(frac, stockOf(cn) / need);
    }
    frac = Math.min(1, Math.max(0, frac));
    for (const [cn, amt] of r.in) addStock(cn, -perMin(r, amt) * run * dtMin * frac);
    for (const [cn, amt] of r.out) addStock(cn, perMin(r, amt) * run * dtMin * frac);
    line.eff = powerEff * frac;
  }

  // 표시용 순증감률
  const keys = new Set([...Object.keys(prev), ...Object.keys(state.stock)]);
  lastRates = {};
  for (const cn of keys) lastRates[cn] = ((state.stock[cn] || 0) - (prev[cn] || 0)) / dtMin;

  lastPower = { supply, demand, eff: powerEff };
}
let lastPower = { supply: BASE_POWER, demand: 0, eff: 1 };

/* ---------- UI ---------- */
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

/** 아이템/건물 아이콘 (game/icons/<className>.png, 없으면 자동 제거) */
function iconEl(cn, size) {
  const img = el('img', size === 's' ? 'icon icon-s' : 'icon');
  img.src = 'icons/' + cn + '.png';
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => img.remove();
  return img;
}

/** 재료 칩 묶음: 아이템별 보유/필요 + 충족 색상. refresh는 onUpdate에 등록해서 사용 */
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
let handSelected = null; // 선택한 레시피 id (UI 재구성 간 유지)
const HAND_RECIPES = D.recipes.filter(r => r.hand && !r.alt);

function buildHand() {
  const search = $('hand-search');
  const listBox = $('hand-list');

  // 선택한 레시피의 재료(보유/필요)와 산출을 실시간 표시
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

/* --- 채굴 · 발전 --- */
function extRow(iconCn, label, detail, cost, getCount, inc, dec) {
  const row = el('div', 'row');
  const grow = el('div', 'grow');
  const name = el('div', 'name');
  name.append(iconEl(iconCn), ' ' + label);
  grow.append(name);
  grow.append(el('div', 'detail', detail));
  row.append(grow);
  const cnt = el('span', 'cnt', '0');
  const minus = el('button', 'mini ghost', '−');
  const plus = el('button', 'mini', '+');
  minus.addEventListener('click', () => { dec(); update(); save(); });
  plus.addEventListener('click', () => { inc(); update(); save(); });
  row.append(minus, cnt, plus);
  const costLine = el('div', 'cost-line');
  costLine.append(el('span', null, '비용'));
  const { box, refresh } = chipRow(cost);
  costLine.append(box);
  row.append(costLine);
  onUpdate(() => {
    cnt.textContent = getCount();
    plus.disabled = !canAfford(cost);
    minus.disabled = getCount() <= 0;
    refresh();
  });
  return row;
}

function buildExtractors() {
  const box = $('extractor-list');
  box.textContent = '';
  if (!state.miners && state.gensUnlocked.length === 0) {
    box.append(el('div', 'hint', '마일스톤 1을 달성하면 채굴기를 살 수 있습니다.'));
    return;
  }
  for (const cn of state.raws) {
    const def = EXT[cn] || MINER;
    if (!state.miners) continue;
    const label = (def.label || D.xnames[def.build]) + ' — ' + iname(cn);
    const detail = `${def.rate}/분 · ${def.power}MW`;
    box.append(extRow(cn, label, detail, buildCost(def.build),
      () => state.ext[cn] || 0,
      () => { pay(buildCost(def.build)); state.ext[cn] = (state.ext[cn] || 0) + 1; },
      () => { if ((state.ext[cn] || 0) > 0) { state.ext[cn]--; refund(buildCost(def.build)); } }));
  }
  for (const key of state.gensUnlocked) {
    const g = GENS[key];
    const burns = g.burns.map(([cn, rate]) => `${iname(cn)} ${rate}/분`).join(' + ');
    box.append(extRow(g.build, D.xnames[g.build], `+${g.power}MW · 소비 ${burns}`, buildCost(g.build),
      () => state.gens[key],
      () => { pay(buildCost(g.build)); state.gens[key]++; },
      () => { if (state.gens[key] > 0) { state.gens[key]--; refund(buildCost(g.build)); } }));
  }
}

/* --- 생산 라인 --- */
function buildLineAdd() {
  const mSel = $('line-machine');
  const rSel = $('line-recipe');
  // UI 재구성 시 사용자가 고르던 선택을 보존
  const prevM = mSel.value;
  const prevR = rSel.value;
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
  mSel.onchange = fillRecipes;
  fillRecipes();
  if (prevR && [...rSel.options].some(o => o.value === prevR)) rSel.value = prevR;
  $('line-add-btn').onclick = () => {
    if (!rSel.value) return;
    if (state.lines.some(l => l.recipeId === rSel.value)) return;
    state.lines.push({ recipeId: rSel.value, count: 0, eff: 0 });
    rebuild();
    save();
  };
}

function buildLines() {
  const box = $('line-list');
  box.textContent = '';
  if (state.lines.length === 0) {
    box.append(el('div', 'hint', '라인을 추가하고 + 로 기계를 구매하세요. 기계 비용은 실제 건설 비용입니다.'));
  }
  state.lines.forEach((line, idx) => {
    const r = recipeById[line.recipeId];
    const cost = buildCost(r.machine);
    const row = el('div', 'row');
    const grow = el('div', 'grow');
    const name = el('div', 'name');
    name.append(iconEl(r.out[0][0]), ' ' + (r.alt ? '★ ' : '') + r.ko);
    grow.append(name);
    const io = r.in.map(([cn, amt]) => `${iname(cn)} ${perMin(r, amt)}`).join(' + ')
      + ' → ' + r.out.map(([cn, amt]) => `${iname(cn)} ${perMin(r, amt)}`).join(' + ');
    grow.append(el('div', 'detail', `${mname(r.machine)} · ${io} /분·대 · ${linePower(r)}MW`));
    row.append(grow);
    const eff = el('span');
    row.append(eff);
    const cnt = el('span', 'cnt', '0');
    const minus = el('button', 'mini ghost', '−');
    const plus = el('button', 'mini', '+');
    const del = el('button', 'mini ghost danger', '✕');
    minus.addEventListener('click', () => {
      if (line.count > 0) { line.count--; refund(cost); update(); save(); }
    });
    plus.addEventListener('click', () => {
      if (canAfford(cost)) { pay(cost); line.count++; update(); save(); }
    });
    del.addEventListener('click', () => {
      refund(Object.fromEntries(Object.entries(cost).map(([cn, n]) => [cn, n * line.count])));
      state.lines.splice(idx, 1);
      rebuild();
      save();
    });
    row.append(minus, cnt, plus, del);
    const costLine = el('div', 'cost-line');
    costLine.append(el('span', null, '기계 비용'));
    const chips = chipRow(cost);
    costLine.append(chips.box);
    row.append(costLine);
    box.append(row);
    onUpdate(() => {
      cnt.textContent = line.count;
      plus.disabled = !canAfford(cost);
      minus.disabled = line.count <= 0;
      const pct = Math.round((line.eff || 0) * 100);
      eff.textContent = line.count > 0 ? pct + '%' : '';
      eff.className = pct >= 99 ? 'eff-ok' : 'eff-low';
      chips.refresh();
    });
  });
}

/* --- 재고 --- */
let stockKeys = '';
function buildStock() {
  const visible = Object.keys(state.stock).filter(cn => stockOf(cn) >= 0.05);
  for (const cn of state.raws) if (!visible.includes(cn)) visible.push(cn);
  visible.sort((a, b) => {
    const ra = D.raw.includes(a), rb = D.raw.includes(b);
    if (ra !== rb) return ra ? -1 : 1;
    return iname(a).localeCompare(iname(b), 'ko');
  });
  stockKeys = visible.join(',');
  const t = $('stock-table');
  t.textContent = '';
  for (const cn of visible) {
    const tr = el('tr', D.raw.includes(cn) ? 'raw' : null);
    const nameTd = el('td');
    nameTd.append(iconEl(cn, 's'), ' ' + iname(cn));
    tr.append(nameTd);
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

/* --- 전력 표시 --- */
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
  updaters = [];
  buildMilestone();
  buildGather();
  buildHand();
  buildExtractors();
  buildLineAdd();
  buildLines();
  buildStock();
  buildPower();
}

function update() {
  // 재고에 새 아이템이 나타나면 테이블 구조 갱신
  const visible = Object.keys(state.stock).filter(cn => stockOf(cn) >= 0.05);
  for (const cn of state.raws) if (!visible.includes(cn)) visible.push(cn);
  visible.sort((a, b) => {
    const ra = D.raw.includes(a), rb = D.raw.includes(b);
    if (ra !== rb) return ra ? -1 : 1;
    return iname(a).localeCompare(iname(b), 'ko');
  });
  if (visible.join(',') !== stockKeys) { rebuild(); return; }
  for (const fn of updaters) fn();
}

/* ---------- 시작 ---------- */
function init() {
  state = load() || freshState();

  // 오프라인 진행 (최대 4시간, 5초 단위)
  const elapsedSec = Math.min(4 * 3600, (Date.now() - (state.savedAt || Date.now())) / 1000);
  if (elapsedSec > 10) {
    const steps = Math.floor(elapsedSec / 5);
    for (let i = 0; i < steps; i++) tick(5 / 60);
    showBanner(`⏰ 오프라인 ${Math.floor(elapsedSec / 60)}분 동안 공장이 가동됐습니다.`);
    setTimeout(() => { $('banner').hidden = true; }, 6000);
  }
  if (state.won) showBanner('🎉 프로젝트 조립 1단계 완료! FICSIT이 만족했습니다. 계속 확장해도 좋습니다.');

  rebuild();
  // 백그라운드 탭에서 타이머가 스로틀돼도 실제 경과 시간만큼 진행
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
