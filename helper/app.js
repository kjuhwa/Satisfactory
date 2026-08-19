'use strict';
/* 효율 헬퍼 — 매장지(순도·채굴기·클럭)에서 출발해 목표 아이템까지
 * 유휴 없는 세팅(벨트 티어, 기계 대수, 언더클럭)을 계산한다. 실제 게임 1.0 수치.
 */

const D = window.GAME_DATA;
const $ = id => document.getElementById(id);

const BELTS = [[1, 60], [2, 120], [3, 270], [4, 480], [5, 780], [6, 1200]];
const MINER_BASE = { 1: 60, 2: 120, 3: 240 };   // 보통 순도, 100% 기준 /분
const MINER_PWR = { 1: 5, 2: 15, 3: 45 };       // MW
const PURITY = [['impure', '임순', 0.5], ['normal', '보통', 1], ['pure', '순수', 2]];
const EXP = 1.321929;                            // 오버클럭 전력 지수
const SOLID = ['Desc_OreIron_C', 'Desc_OreCopper_C', 'Desc_Stone_C', 'Desc_Coal_C',
  'Desc_OreGold_C', 'Desc_RawQuartz_C', 'Desc_Sulfur_C', 'Desc_OreBauxite_C',
  'Desc_OreUranium_C', 'Desc_SAM_C'];

const koOf = id => (D.items[id] && (D.items[id].ko || D.items[id].n)) || id;
const fmt = x => (Math.round(x * 100) / 100).toLocaleString('ko-KR');
const isRaw = id => D.raw.includes(id);

/* 아이템 → 그 아이템을 만드는 레시피들 */
const byOut = {};
for (const r of D.recipes) for (const [o] of r.out) (byOut[o] = byOut[o] || []).push(r);

/* ---------- 상태 ---------- */
let state = {
  res: 'Desc_OreIron_C',
  deps: [{ purity: 'normal', mk: 1, clock: 100 }],
  target: null,          // item id
  recipeSel: {},         // item id -> recipe id
};
try {
  const saved = JSON.parse(localStorage.getItem('sfy-helper') || 'null');
  if (saved && saved.res) state = Object.assign(state, saved);
} catch (e) { }
const save = () => localStorage.setItem('sfy-helper', JSON.stringify(state));

/* ---------- 벨트 ---------- */
function beltFor(rate) {
  for (const [mk, cap] of BELTS) if (rate <= cap + 1e-9) return { mk, cap, lines: 1 };
  const lines = Math.ceil(rate / 1200 - 1e-9);
  return { mk: 6, cap: 1200, lines };
}
function beltBadge(rate) {
  const b = beltFor(rate);
  const label = b.lines > 1 ? `벨트 Mk.6 × ${b.lines}줄` : `벨트 Mk.${b.mk}`;
  const util = rate / (b.cap * b.lines) * 100;
  const exact = Math.abs(util - 100) < 0.05;
  return `<span class="badge belt">${label}</span> <span class="badge ${exact ? 'good' : ''}">${exact ? '딱 맞음 ✨' : '사용률 ' + fmt(util) + '%'}</span>`;
}

/* ---------- 채굴 ---------- */
function depRate(d) {
  const pm = PURITY.find(p => p[0] === d.purity)[2];
  return MINER_BASE[d.mk] * pm * d.clock / 100;
}
function depPower(d) { return MINER_PWR[d.mk] * Math.pow(d.clock / 100, EXP); }
const totalMine = () => state.deps.reduce((s, d) => s + depRate(d), 0);

function shardsFor(clock) { return clock > 100 ? Math.ceil((clock - 100) / 50 - 1e-9) : 0; }

/* 채굴기 한 대의 벨트 팁: 지금 벨트에 여유가 있으면 꽉 채우는 클럭 제안 */
function depTip(d) {
  const rate = depRate(d);
  const b = beltFor(rate);
  if (b.lines > 1) return '';
  const pm = PURITY.find(p => p[0] === d.purity)[2];
  const base = MINER_BASE[d.mk] * pm;
  if (rate >= b.cap - 1e-9) return '';
  const fit = b.cap / base * 100;
  if (fit > 250 + 1e-9) return '';
  const sh = shardsFor(fit);
  return `<div class="tip">💡 클럭 <b>${fmt(fit)}%</b>로 올리면 Mk.${b.mk} 벨트를 꽉 채웁니다${sh ? ` (동력 조각 ${sh}개)` : ''}</div>`;
}

/* ---------- 레시피 선택 ---------- */
function recipeOf(item) {
  const list = byOut[item] || [];
  if (!list.length) return null;
  const sel = state.recipeSel[item];
  return list.find(r => r.id === sel) || list.find(r => !r.alt) || list[0];
}

/* 이 자원을 (어떤 레시피 경로로든) 쓸 수 있는 아이템인가 — 목표 후보 필터 */
const usesOreMemo = {};
function usesOre(item, visiting = new Set()) {
  if (item === state.res) return true;
  if (item in usesOreMemo) return usesOreMemo[item];
  if (isRaw(item) || visiting.has(item)) return false;
  visiting.add(item);
  let ok = false;
  for (const r of byOut[item] || []) {
    if (r.in.some(([ing]) => usesOre(ing, visiting))) { ok = true; break; }
  }
  visiting.delete(item);
  usesOreMemo[item] = ok;
  return ok;
}

/* ---------- 체인 계산 ----------
 * 1패스: 목표 1개당 선택 자원 소요량(orePer) — 0이면 이 자원과 무관
 * 2패스: 실제 채굴량으로 스케일해 아이템별 생산 속도 합산 (같은 아이템은 한 라인으로) */
function orePerUnit(item, visiting = new Set()) {
  if (item === state.res) return { ore: 1, ext: {} };
  if (isRaw(item) || !byOut[item] || visiting.has(item)) return { ore: 0, ext: { [item]: 1 } };
  const r = recipeOf(item);
  const outQty = r.out.find(o => o[0] === item)[1];
  visiting.add(item);
  const acc = { ore: 0, ext: {} };
  for (const [ing, q] of r.in) {
    const sub = orePerUnit(ing, visiting);
    acc.ore += sub.ore * q / outQty;
    for (const k in sub.ext) acc.ext[k] = (acc.ext[k] || 0) + sub.ext[k] * q / outQty;
  }
  visiting.delete(item);
  return acc;
}

function buildChain(targetRate) {
  const totals = {};   // item -> {rate, depth}
  const ext = {};      // 외부 공급 item -> rate
  const bypro = {};    // 부산물 item -> rate
  let oreUsed = 0;
  const walk = (item, rate, depth, visiting) => {
    if (item === state.res) { oreUsed += rate; return; }
    if (isRaw(item) || !byOut[item] || visiting.has(item)) { ext[item] = (ext[item] || 0) + rate; return; }
    const t = totals[item] || (totals[item] = { rate: 0, depth: 0 });
    t.rate += rate;
    t.depth = Math.max(t.depth, depth);
    const r = recipeOf(item);
    const outQty = r.out.find(o => o[0] === item)[1];
    for (const [o, q] of r.out) if (o !== item) bypro[o] = (bypro[o] || 0) + rate / outQty * q;
    visiting.add(item);
    for (const [ing, q] of r.in) walk(ing, rate * q / outQty, depth + 1, visiting);
    visiting.delete(item);
  };
  walk(state.target, targetRate, 0, new Set());
  return { totals, ext, bypro, oreUsed };
}

/* ---------- 렌더링 ---------- */
function iconImg(id, size) {
  return `<img src="../game/icons/${id}.png" width="${size}" height="${size}" onerror="this.remove()" alt="">`;
}

function buildResSelect() {
  const s = $('sel-res');
  s.innerHTML = SOLID.map(id => `<option value="${id}">${koOf(id)}</option>`).join('');
  s.value = state.res;
}

function buildDepRows() {
  const box = $('dep-rows');
  box.innerHTML = '';
  state.deps.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'dep-row';
    row.innerHTML =
      `<label>순도<select data-k="purity">${PURITY.map(p => `<option value="${p[0]}" ${d.purity === p[0] ? 'selected' : ''}>${p[1]} ×${p[2]}</option>`).join('')}</select></label>` +
      `<label>채굴기<select data-k="mk">${[1, 2, 3].map(m => `<option value="${m}" ${d.mk === m ? 'selected' : ''}>Mk.${m} (${MINER_BASE[m]}/분)</option>`).join('')}</select></label>` +
      `<label>클럭 %<input data-k="clock" type="number" min="1" max="250" step="0.1" value="${d.clock}" style="width:76px"></label>` +
      (state.deps.length > 1 ? `<button class="ghost mini" data-del>✕</button>` : '') +
      `<div class="dep-out"><b>${fmt(depRate(d))}/분</b> · ${beltBadge(depRate(d))}${depTip(d)}</div>`;
    row.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.k;
      d[k] = k === 'purity' ? el.value : +el.value;
      if (k === 'clock') d.clock = Math.min(250, Math.max(1, d.clock || 100));
      update();
    }));
    const del = row.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => { state.deps.splice(i, 1); update(); });
    box.append(row);
  });
}

function buildQuickTable() {
  const rows = [1, 2, 3].map(mk => {
    const cells = PURITY.map(([, ko, mult]) => {
      const rate = MINER_BASE[mk] * mult;
      const b = beltFor(rate);
      const exact = Math.abs(rate - b.cap) < 1e-9;
      return `<td><b>${rate}</b>/분<br>${exact ? `<span class="fit">Mk.${b.mk} 딱 ✨</span>` : `Mk.${b.mk} (${fmt(rate / b.cap * 100)}%)`}</td>`;
    }).join('');
    return `<tr><th>채굴기 Mk.${mk}</th>${cells}</tr>`;
  }).join('');
  $('quick-table').innerHTML =
    `<table><tr><th></th>${PURITY.map(p => `<th>${p[1]} ×${p[2]}</th>`).join('')}</tr>${rows}</table>`;
}

function buildDatalist() {
  const names = new Map();  // 표시명 -> id
  for (const item of Object.keys(byOut)) {
    if (!usesOre(item)) continue;
    let name = koOf(item);
    if (names.has(name)) name += ` (${D.items[item] ? D.items[item].n : item})`;
    names.set(name, item);
  }
  $('dl-items').innerHTML = [...names.keys()].sort((a, b) => a.localeCompare(b, 'ko')).map(n => `<option value="${n}">`).join('');
  return names;
}
let nameMap = new Map();

function machineLine(item, rate) {
  const r = recipeOf(item);
  const outQty = r.out.find(o => o[0] === item)[1];
  const per = 60 / r.time * outQty;
  const count = Math.ceil(rate / per - 1e-9);
  const clock = rate / (count * per) * 100;
  const m = D.machines[r.machine] || { ko: r.machine, power: 0 };
  const power = m.power * count * Math.pow(clock / 100, EXP);
  // 조각으로 대수 줄이기 대안
  const minCount = Math.ceil(rate / (per * 2.5) - 1e-9);
  let alt = '';
  if (minCount < count && minCount > 0) {
    const c2 = rate / (minCount * per) * 100;
    const sh = shardsFor(c2);
    alt = `<div class="tip">💡 동력 조각을 쓰면 <b>${minCount}대 × ${fmt(c2)}%</b>로 줄일 수 있음 (조각 ${sh}개 × ${minCount}대 = ${sh * minCount}개, 전력 ↑)</div>`;
  }
  const exact = Math.abs(clock - 100) < 0.05;
  return { r, per, count, clock, power, m, alt, exact };
}

function renderResult() {
  const box = $('result');
  const E = totalMine();
  if (!state.target) { box.innerHTML = ''; return; }
  if (state.target === state.res) { box.innerHTML = '<div class="rsum">목표가 캐는 자원 그 자체입니다 — 위의 벨트 추천을 그대로 쓰면 됩니다.</div>'; return; }

  const unit = orePerUnit(state.target);
  if (unit.ore <= 1e-12) {
    box.innerHTML = `<div class="rsum">⚠ 현재 선택된 레시피 조합으로는 <b>${koOf(state.target)}</b> 생산에 <b>${koOf(state.res)}</b>이(가) 쓰이지 않습니다. 단계별 레시피를 바꿔 보세요.</div>`;
    return;
  }
  const targetRate = E / unit.ore;
  const { totals, ext, bypro, oreUsed } = buildChain(targetRate);

  // 요약
  let html = `<div class="rsum">채굴 <b>${fmt(E)}/분</b> (${koOf(state.res)}) 전부 투입 →
    <b>${koOf(state.target)} ${fmt(targetRate)}/분</b> 생산.
    아래 세팅이면 <b>어느 기계도 놀지 않습니다</b> (재료가 정확히 맞물림).`;
  const extList = Object.entries(ext);
  if (extList.length) {
    html += `<br>따로 끌어와야 하는 재료: ` + extList.map(([k, v]) =>
      `<span class="ext">${koOf(k)} ${fmt(v)}/분${D.items[k] && D.items[k].liq ? ' (파이프)' : ''}</span>`).join(' · ');
  }
  const bpList = Object.entries(bypro).filter(([, v]) => v > 1e-9);
  if (bpList.length) html += `<br>부산물: ` + bpList.map(([k, v]) => `${koOf(k)} ${fmt(v)}/분`).join(' · ');
  html += `</div>`;

  // 광석 → 첫 단계 벨트
  html += `<div class="arrow">${iconImg(state.res, 18)} ${koOf(state.res)} ${fmt(oreUsed)}/분 ⬇ ${beltBadge(oreUsed)}</div>`;

  // 단계: 깊은 것(원자재 쪽)부터
  const stages = Object.entries(totals).sort((a, b) => b[1].depth - a[1].depth);
  let totalPower = state.deps.reduce((s, d) => s + depPower(d), 0);
  for (const [item, t] of stages) {
    const ml = machineLine(item, t.rate);
    totalPower += ml.power;
    const recipes = byOut[item];
    const selHtml = recipes.length > 1
      ? `<select data-item="${item}">${recipes.map(r => `<option value="${r.id}" ${r.id === ml.r.id ? 'selected' : ''}>${r.alt ? '★ ' : ''}${r.ko || r.name}</option>`).join('')}</select>`
      : '';
    const ins = ml.r.in.map(([ing, q]) => {
      const need = t.rate / ml.r.out.find(o => o[0] === item)[1] * q;
      return `${koOf(ing)} ${fmt(need)}/분`;
    }).join(' + ');
    html += `<div class="stage">
      <div class="head">${iconImg(item, 34)}<span class="t">${koOf(item)}</span>${selHtml}
        <span class="rate">${fmt(t.rate)}/분</span></div>
      <div class="mach">${iconImg(ml.r.machine, 26)} ${ml.m.ko}
        <span class="badge ${ml.exact ? 'good' : ''}">${ml.count}대 × ${fmt(ml.clock)}%${ml.exact ? ' 딱 맞음 ✨' : ''}</span>
        ${beltBadge(t.rate)}
        <span class="badge">⚡ ${fmt(ml.power)} MW</span></div>
      <div class="tip">입력: ${ins}</div>
      ${ml.alt}
    </div>`;
  }
  html += `<div class="rsum">총 전력 (채굴기 포함): <b>${fmt(totalPower)} MW</b></div>`;
  box.innerHTML = html;
  box.querySelectorAll('select[data-item]').forEach(s => s.addEventListener('change', () => {
    state.recipeSel[s.dataset.item] = s.value;
    update();
  }));
}

function renderMineSummary() {
  const E = totalMine();
  const pw = state.deps.reduce((s, d) => s + depPower(d), 0);
  $('mine-summary').innerHTML =
    `<div class="rsum">채굴 합계 <b>${fmt(E)}/분</b> · 채굴기 전력 <b>${fmt(pw)} MW</b>
     ${state.deps.length > 1 ? '<br>' + beltBadge(E) + ' <span class="hint">(합쳐서 한 줄로 나를 때)</span>' : ''}</div>`;
}

function update() {
  save();
  buildDepRows();
  renderMineSummary();
  renderResult();
}

/* ---------- 초기화 ---------- */
buildResSelect();
buildQuickTable();
nameMap = buildDatalist();
if (state.target) {
  const found = [...nameMap.entries()].find(([, id]) => id === state.target);
  if (found) $('inp-target').value = found[0];
}
$('sel-res').addEventListener('change', () => {
  state.res = $('sel-res').value;
  for (const k in usesOreMemo) delete usesOreMemo[k];
  nameMap = buildDatalist();
  if (state.target && !usesOre(state.target)) { state.target = null; $('inp-target').value = ''; }
  update();
});
$('btn-add-dep').addEventListener('click', () => {
  state.deps.push({ ...state.deps[state.deps.length - 1] });
  update();
});
$('inp-target').addEventListener('change', () => {
  const id = nameMap.get($('inp-target').value.trim());
  state.target = id || null;
  update();
});
$('btn-clear').addEventListener('click', () => {
  state.target = null; $('inp-target').value = ''; update();
});
update();
