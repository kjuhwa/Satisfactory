'use strict';
const D = window.GAME_DATA;

/* ---------- 인덱스 구성 ---------- */
const RAW = new Set(D.raw);
const producers = {}; // itemCn -> [recipe]
for (const r of D.recipes) {
  for (const [item] of r.out) {
    (producers[item] ??= []).push(r);
  }
}
// 아이템별 정렬: 표준(이름 일치) > 표준(주산물) > 표준 > 대체
for (const [item, list] of Object.entries(producers)) {
  const iname = D.items[item].n;
  const score = r =>
    (r.alt ? 4 : 0) + (r.out[0][0] !== item ? 2 : 0) + (r.name !== iname ? 1 : 0);
  list.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
const iname = cn => D.items[cn].ko || D.items[cn].n;
const mname = cn => D.machines[cn].ko || D.machines[cn].n;

// 한글/영문 어느 쪽으로 입력해도 아이템을 찾을 수 있게 둘 다 등록
const nameToItem = {};
for (const [cn, it] of Object.entries(D.items)) {
  if (!producers[cn]) continue;
  nameToItem[it.n] = cn;
  if (it.ko) nameToItem[it.ko] = cn;
}

/* ---------- 상태 ---------- */
const state = {
  targets: [],       // [{item, rate}]
  recipeChoice: {},  // itemCn -> recipeId (전역: 같은 아이템은 트리 전체에서 같은 레시피 사용)
};

function chosenRecipe(item) {
  const list = producers[item];
  if (!list) return null;
  const id = state.recipeChoice[item];
  return list.find(r => r.id === id) ?? list[0];
}

/* ---------- 계산 ---------- */
function buildTree(item, rate, path) {
  if (RAW.has(item)) return { type: 'raw', item, rate };
  if (!producers[item]) return { type: 'leaf', item, rate };
  if (path.has(item)) return { type: 'cycle', item, rate };

  const r = chosenRecipe(item);
  const perMin = a => a * 60 / r.time;
  const outPerMin = perMin(r.out.find(o => o[0] === item)[1]);
  const machines = rate / outPerMin;
  const next = new Set(path); next.add(item);

  const children = r.in.map(([ing, amt]) => buildTree(ing, machines * perMin(amt), next));
  const byproducts = r.out
    .filter(o => o[0] !== item)
    .map(([it, amt]) => ({ item: it, rate: machines * perMin(amt) }));

  return { type: 'node', item, rate, recipe: r, machines, children, byproducts };
}

function aggregate(node, acc) {
  if (node.type === 'raw' || node.type === 'leaf' || node.type === 'cycle') {
    const bucket = node.type === 'cycle' ? acc.cycles : acc.raw;
    bucket[node.item] = (bucket[node.item] ?? 0) + node.rate;
    return;
  }
  const a = (acc.recipes[node.recipe.id] ??= { recipe: node.recipe, machines: 0 });
  a.machines += node.machines;
  for (const b of node.byproducts) {
    acc.byproducts[b.item] = (acc.byproducts[b.item] ?? 0) + b.rate;
  }
  node.children.forEach(c => aggregate(c, acc));
}

/* ---------- 포맷 ---------- */
const fmt = x => {
  const v = Math.round(x * 1000) / 1000;
  return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
};
const ceilCnt = x => Math.ceil(x - 1e-9);
const rateUnit = item => D.items[item]?.liq ? ' m³/분' : ' /분';

/* ---------- 렌더링 ---------- */
const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderTargets() {
  const box = $('target-list');
  box.textContent = '';
  state.targets.forEach((t, i) => {
    const row = el('div', 'target-row');
    const nm = el('span', 't-name', iname(t.item));
    nm.title = D.items[t.item].n;
    row.append(nm);
    const rate = el('input');
    rate.type = 'number'; rate.min = '0.1'; rate.step = 'any'; rate.value = t.rate;
    rate.addEventListener('change', () => {
      t.rate = Math.max(0.1, parseFloat(rate.value) || 0.1);
      recompute();
    });
    row.append(rate, el('span', 'unit', '/분'));
    const rm = el('button', 'remove', '✕');
    rm.title = '제거';
    rm.addEventListener('click', () => { state.targets.splice(i, 1); recompute(); });
    row.append(rm);
    box.append(row);
  });
}

function recipeSelect(item, current) {
  const list = producers[item];
  const sel = el('select', 'recipe-sel');
  for (const r of list) {
    const opt = el('option', null, (r.alt ? '★ ' : '') + (r.ko || r.name) +
      ' [' + mname(r.machine) + ']');
    opt.value = r.id;
    if (r.id === current.id) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => {
    state.recipeChoice[item] = sel.value;
    recompute();
  });
  return sel;
}

function renderNode(node, isTop) {
  const box = el('div', 'node' + (isTop ? ' tree-target' : ''));
  const head = el('div', 'node-head');
  const nm = el('span', 'n-item', iname(node.item));
  nm.title = D.items[node.item].n;
  head.append(nm);
  head.append(el('span', 'n-rate', fmt(node.rate) + rateUnit(node.item)));

  if (node.type === 'raw') {
    head.append(el('span', 'n-raw', '원자재'));
  } else if (node.type === 'leaf') {
    head.append(el('span', 'n-raw', '외부 공급'));
  } else if (node.type === 'cycle') {
    head.append(el('span', 'n-cycle', '⟳ 순환 — 외부 공급 필요'));
  } else {
    const m = el('span', 'n-machine');
    m.append(document.createTextNode(''));
    const bold = el('b', null, mname(node.recipe.machine));
    m.append(bold, document.createTextNode(
      ' × ' + fmt(node.machines) + ' (' + ceilCnt(node.machines) + '대)'));
    head.append(m);
    if (producers[node.item].length > 1) {
      head.append(recipeSelect(node.item, node.recipe));
    }
    for (const b of node.byproducts) {
      head.append(el('span', 'n-by',
        '+ ' + iname(b.item) + ' ' + fmt(b.rate) + rateUnit(b.item)));
    }
  }
  box.append(head);
  if (node.children) node.children.forEach(c => box.append(renderNode(c, false)));
  return box;
}

function renderSummary(acc) {
  let power = 0, machineCnt = 0;
  const mt = $('machine-table');
  mt.textContent = '';
  const rows = Object.values(acc.recipes)
    .sort((a, b) => b.machines - a.machines);
  for (const { recipe, machines } of rows) {
    const p = (recipe.power ?? D.machines[recipe.machine].power) * machines;
    power += p;
    machineCnt += ceilCnt(machines);
    const tr = el('tr');
    tr.append(el('td', null, mname(recipe.machine) + ' — ' + (recipe.ko || recipe.name)));
    tr.append(el('td', 'cnt', ceilCnt(machines) + '대'));
    tr.append(el('td', 'num', fmt(p) + ' MW'));
    mt.append(tr);
  }
  $('total-power').textContent = fmt(power) + ' MW';
  $('total-machines').textContent = machineCnt + '대';

  const rt = $('raw-table');
  rt.textContent = '';
  const rawRows = Object.entries(acc.raw).sort((a, b) => b[1] - a[1]);
  for (const [item, rate] of rawRows) {
    const tr = el('tr');
    tr.append(el('td', null, iname(item)));
    tr.append(el('td', 'num', fmt(rate) + rateUnit(item)));
    rt.append(tr);
  }
  for (const [item, rate] of Object.entries(acc.cycles)) {
    const tr = el('tr');
    tr.append(el('td', null, iname(item) + ' (순환)'));
    tr.append(el('td', 'num', fmt(rate) + rateUnit(item)));
    rt.append(tr);
  }

  const byRows = Object.entries(acc.byproducts).sort((a, b) => b[1] - a[1]);
  $('byproduct-col').hidden = byRows.length === 0;
  const bt = $('byproduct-table');
  bt.textContent = '';
  for (const [item, rate] of byRows) {
    const tr = el('tr');
    tr.append(el('td', null, iname(item)));
    tr.append(el('td', 'num', fmt(rate) + rateUnit(item)));
    bt.append(tr);
  }
}

function recompute() {
  renderTargets();
  const has = state.targets.length > 0;
  $('summary-panel').hidden = !has;
  $('tree-panel').hidden = !has;
  if (!has) return;

  const acc = { recipes: {}, raw: {}, byproducts: {}, cycles: {} };
  const treeBox = $('tree-root');
  treeBox.textContent = '';
  for (const t of state.targets) {
    const tree = buildTree(t.item, t.rate, new Set());
    aggregate(tree, acc);
    treeBox.append(renderNode(tree, true));
  }
  renderSummary(acc);
}

/* ---------- 초기화 ---------- */
function init() {
  const dl = $('item-datalist');
  const producible = Object.keys(D.items).filter(cn => producers[cn])
    .sort((a, b) => iname(a).localeCompare(iname(b), 'ko'));
  for (const cn of producible) {
    const opt = el('option');
    opt.value = iname(cn);       // 한글명으로 입력됨
    opt.label = D.items[cn].n;   // 영문명 병기 표시 + 영문 검색 매칭
    dl.append(opt);
  }
  const addTarget = () => {
    const name = $('item-search').value.trim();
    const item = nameToItem[name];
    if (!item) { $('item-search').focus(); return; }
    const rate = Math.max(0.1, parseFloat($('rate-input').value) || 10);
    const exist = state.targets.find(t => t.item === item);
    if (exist) exist.rate += rate;
    else state.targets.push({ item, rate });
    $('item-search').value = '';
    recompute();
  };
  $('add-target').addEventListener('click', addTarget);
  $('item-search').addEventListener('keydown', e => { if (e.key === 'Enter') addTarget(); });
  $('rate-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTarget(); });
  recompute();
}
init();
