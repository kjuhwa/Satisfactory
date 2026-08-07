'use strict';
/* 규칙 공장 — UI */

const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const fmtN = x => x >= 1000 ? Math.floor(x).toLocaleString()
  : x >= 100 ? Math.floor(x).toString()
  : (Math.round(x * 10) / 10).toLocaleString();
const fmtRate = x => (x > 0 ? '+' : '') + fmtN(x) + '/분';

function iconEl(cn, size) {
  const img = el('img', size === 's' ? 'icon icon-s' : 'icon');
  img.src = '../game/icons/' + cn + '.png';
  img.alt = '';
  img.loading = 'lazy';
  img.onerror = () => img.remove();
  return img;
}

function select(options, value, onChange, cls) {
  const s = el('select', cls);
  for (const [val, label, disabled] of options) {
    const o = el('option', null, label);
    o.value = val;
    if (disabled) o.disabled = true;
    s.append(o);
  }
  if (value != null) s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function numInput(value, onChange, cls) {
  const i = el('input', cls);
  i.type = 'number';
  i.min = '0';
  i.step = 'any';
  i.value = value ?? 0;
  i.addEventListener('change', () => onChange(parseFloat(i.value) || 0));
  return i;
}

let updaters = [];
const onUpdate = fn => { updaters.push(fn); fn(); };

/* ---------- 선택지 목록 ---------- */
const itemOptions = () => {
  const seen = new Set();
  for (const cn of Object.keys(RES)) seen.add(cn);
  for (const l of state.lines) {
    const r = recipeById[l.recipeId];
    if (r) { for (const [cn] of r.in) seen.add(cn); for (const [cn] of r.out) seen.add(cn); }
  }
  for (const r of unlockedRecipes()) { for (const [cn] of r.out) seen.add(cn); for (const [cn] of r.in) seen.add(cn); }
  for (const cn of Object.keys(state.stock)) seen.add(cn);
  for (const c of CONTRACTS) for (const cn of Object.keys(c.need)) seen.add(cn);
  return [...seen].sort((a, b) => iname(a).localeCompare(iname(b), 'ko')).map(cn => [cn, iname(cn)]);
};
const recipeOptions = () => unlockedRecipes()
  .sort((a, b) => a.ko.localeCompare(b.ko, 'ko'))
  .map(r => [r.id, `${r.ko} [${mname(r.machine)}]`]);
const resOptions = () => Object.keys(RES).map(cn => [cn, iname(cn) + (resUnlocked(cn) ? '' : ' 🔒'), !resUnlocked(cn)]);
const genOptions = () => Object.keys(GENS).map(k => [k, mname(GENS[k].build) + (genUnlocked(k) ? '' : ' 🔒'), !genUnlocked(k)]);
const techOptions = () => TECHS.map(t => [t.id, t.name + (hasTech(t.id) ? ' ✅' : ` (🪙${t.credits})`)]);
const lineOptions = () => state.lines.map(l => [String(l.id), recipeById[l.recipeId] ? recipeById[l.recipeId].ko : '?']);
const ruleOptions = () => state.rules.map((r, i) => [String(r.id), `#${i + 1}`]);
const opOptions = () => Object.keys(OPS).map(o => [o, o]);

/* ---------- 규칙 편집기 ---------- */
const STATUS_LABEL = {
  fired: ['발동', 'ok'], wait: ['조건 대기', 'muted'], cool: ['쿨다운', 'muted'],
  block: ['막힘', 'bad'], bw: ['대역폭 부족', 'bad'], off: ['꺼짐', 'muted'],
};

function buildRules() {
  const box = $('rule-list');
  box.textContent = '';

  state.rules.forEach((rule, idx) => {
    const row = el('div', 'rule');
    const head = el('div', 'rule-head');

    const on = el('input');
    on.type = 'checkbox';
    on.checked = !!rule.on;
    on.title = '규칙 켜기/끄기';
    on.addEventListener('change', () => { rule.on = on.checked; save(); rebuild(); });
    head.append(on, el('span', 'rule-no', `#${idx + 1}`));

    const badge = el('span', 'badge');
    head.append(badge);
    const fires = el('span', 'hint');
    head.append(fires);

    const tools = el('span', 'rule-tools');
    const up = el('button', 'mini ghost', '↑');
    up.title = '우선순위 올리기 (위 규칙이 대역폭을 먼저 쓴다)';
    up.disabled = idx === 0;
    up.addEventListener('click', () => { moveRule(idx, -1); });
    const down = el('button', 'mini ghost', '↓');
    down.title = '우선순위 내리기';
    down.disabled = idx === state.rules.length - 1;
    down.addEventListener('click', () => { moveRule(idx, 1); });
    const del = el('button', 'mini ghost danger', '✕');
    del.title = '규칙 삭제';
    del.addEventListener('click', () => {
      state.rules.splice(idx, 1); save(); rebuild();
    });
    tools.append(up, down, del);
    head.append(tools);
    row.append(head);

    // 조건 → 행동
    const body = el('div', 'rule-body');
    const condBox = el('div', 'clause');
    condBox.append(el('span', 'kw', '만약'));
    condBox.append(select(Object.entries(COND_TYPES).map(([k, v]) => [k, v.label]), rule.cond.type,
      v => { rule.cond = { type: v, op: '>', value: 0, item: rule.cond.item, line: rule.cond.line }; save(); rebuild(); }));
    for (const f of COND_TYPES[rule.cond.type].fields) {
      if (f === 'item') condBox.append(select(itemOptions(), rule.cond.item, v => { rule.cond.item = v; save(); }));
      if (f === 'line') condBox.append(select(lineOptions(), String(rule.cond.line ?? ''), v => { rule.cond.line = +v; save(); }));
      if (f === 'op') condBox.append(select(opOptions(), rule.cond.op, v => { rule.cond.op = v; save(); }, 'op'));
      if (f === 'value') condBox.append(numInput(rule.cond.value, v => { rule.cond.value = v; save(); }, 'val'));
    }
    condBox.append(el('span', 'kw', '이면'));

    const actBox = el('div', 'clause');
    actBox.append(el('span', 'kw arrow', '→'));
    actBox.append(select(Object.entries(ACT_TYPES).map(([k, v]) => [k, v.label]), rule.act.type,
      v => { rule.act = { type: v, amount: 1 }; save(); rebuild(); }));
    for (const f of ACT_TYPES[rule.act.type].fields) {
      if (f === 'item') actBox.append(select(itemOptions(), rule.act.item, v => { rule.act.item = v; save(); }));
      if (f === 'recipe') actBox.append(select(recipeOptions(), rule.act.recipe, v => { rule.act.recipe = v; save(); }));
      if (f === 'res') actBox.append(select(resOptions(), rule.act.res, v => { rule.act.res = v; save(); }));
      if (f === 'gen') actBox.append(select(genOptions(), rule.act.gen, v => { rule.act.gen = v; save(); }));
      if (f === 'tech') actBox.append(select(techOptions(), rule.act.tech, v => { rule.act.tech = v; save(); }));
      if (f === 'rule') actBox.append(select(ruleOptions(), String(rule.act.rule ?? ''), v => { rule.act.rule = +v; save(); }));
      if (f === 'onoff') actBox.append(select([['on', '켜기'], ['off', '끄기']], rule.act.onoff || 'on', v => { rule.act.onoff = v; save(); }));
      if (f === 'amount') actBox.append(numInput(rule.act.amount ?? 1, v => { rule.act.amount = v; save(); }, 'val'));
    }
    const cd = el('span', 'cool');
    cd.append(el('span', 'hint', '쿨다운'));
    cd.append(numInput(rule.cooldown ?? DEFAULT_COOLDOWN, v => { rule.cooldown = v; save(); }, 'val'));
    cd.append(el('span', 'hint', '초'));
    actBox.append(cd);

    body.append(condBox, actBox);
    row.append(body);
    box.append(row);

    onUpdate(() => {
      const [label, cls] = STATUS_LABEL[rule.status] || ['대기', 'muted'];
      badge.textContent = rule.status === 'block' && rule.why ? `막힘: ${rule.why}` : label;
      badge.className = 'badge ' + cls;
      fires.textContent = rule.fires ? `${rule.fires}회 발동` : '';
      row.classList.toggle('is-off', !rule.on);
      row.classList.toggle('is-bw', rule.status === 'bw');
    });
  });

  if (!state.rules.length) {
    box.append(el('div', 'empty', '규칙이 없습니다. 아래 "규칙 추가" 또는 "예시 규칙 넣기"로 시작하세요.'));
  }

  const foot = el('div', 'rule-foot');
  const add = el('button', null, '+ 규칙 추가');
  add.addEventListener('click', () => {
    if (state.rules.length >= state.ruleSlots) { alert('규칙 슬롯이 가득 찼습니다. 연구로 늘리세요.'); return; }
    state.rules.push(newRule());
    save(); rebuild();
  });
  const preset = el('button', 'ghost', '예시 규칙 넣기');
  preset.title = '기본적인 자동 확장 규칙 4개를 채워 넣습니다';
  preset.addEventListener('click', () => { addPresets(); });
  foot.append(add, preset);
  const slots = el('span', 'hint');
  foot.append(slots);
  box.append(foot);
  onUpdate(() => {
    slots.textContent = `규칙 ${state.rules.length} / ${state.ruleSlots} 슬롯 · 대역폭 ${lastBw.used}/${lastBw.max}`;
    add.disabled = state.rules.length >= state.ruleSlots;
  });
}

function newRule() {
  return {
    id: state.seq++, on: true,
    cond: { type: 'stock', item: 'Desc_IronPlate_C', op: '>', value: 50 },
    act: { type: 'buildExt', res: 'Desc_OreIron_C', amount: 1 },
    cooldown: DEFAULT_COOLDOWN, fires: 0,
  };
}

function moveRule(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= state.rules.length) return;
  const [r] = state.rules.splice(idx, 1);
  state.rules.splice(j, 0, r);
  save(); rebuild();
}

/** 처음 시작하는 사람을 위한 기본 규칙 세트 */
function addPresets() {
  // 스스로 돌아가는 최소 순환. 순서가 곧 우선순위이므로,
  // 채굴기 재생산에 꼭 필요한 철판·철봉을 콘크리트보다 앞에 둔다.
  const presets = [
    { cond: { type: 'stock', item: 'Desc_OreIron_C', op: '<', value: 120 },
      act: { type: 'buildExt', res: 'Desc_OreIron_C', amount: 1 }, cooldown: 10 },
    { cond: { type: 'stock', item: 'Desc_OreIron_C', op: '>', value: 60 },
      act: { type: 'buildLine', recipe: 'Recipe_IngotIron_C', amount: 1 }, cooldown: 10 },
    { cond: { type: 'stock', item: 'Desc_IronIngot_C', op: '>', value: 40 },
      act: { type: 'buildLine', recipe: 'Recipe_IronPlate_C', amount: 1 }, cooldown: 10 },
    { cond: { type: 'stock', item: 'Desc_IronIngot_C', op: '>', value: 80 },
      act: { type: 'buildLine', recipe: 'Recipe_IronRod_C', amount: 1 }, cooldown: 10 },
    { cond: { type: 'stock', item: 'Desc_Stone_C', op: '<', value: 120 },
      act: { type: 'buildExt', res: 'Desc_Stone_C', amount: 1 }, cooldown: 12 },
    { cond: { type: 'stock', item: 'Desc_Stone_C', op: '>', value: 60 },
      act: { type: 'buildLine', recipe: 'Recipe_Concrete_C', amount: 1 }, cooldown: 12 },
    { cond: { type: 'stock', item: 'Desc_OreCopper_C', op: '<', value: 120 },
      act: { type: 'buildExt', res: 'Desc_OreCopper_C', amount: 1 }, cooldown: 14 },
    { cond: { type: 'stock', item: 'Desc_OreCopper_C', op: '>', value: 60 },
      act: { type: 'buildLine', recipe: 'Recipe_IngotCopper_C', amount: 1 }, cooldown: 14 },
  ];
  let added = 0;
  for (const p of presets) {
    if (state.rules.length >= state.ruleSlots) break;
    state.rules.push({ id: state.seq++, on: true, fires: 0, ...p });
    added++;
  }
  save(); rebuild();
  banner(added ? `예시 규칙 ${added}개를 넣었습니다. 조건과 수치를 바꿔가며 실험해 보세요.` : '규칙 슬롯이 가득 찼습니다.');
}

/* ---------- 공장 현황 ---------- */
function buildFactory() {
  const box = $('factory-body');
  box.textContent = '';

  // 교착 탈출: 채취기도 없고 채취기를 지을 자재도 없을 때만 열린다
  const rescue = el('div', 'rescue');
  rescue.append(el('div', 'hint', '새로 들어올 자원이 없습니다 — 지원 물자를 받아 다시 시작하세요.'));
  const rBtn = el('button', null, '🚨 긴급 지원 물자 요청');
  rBtn.addEventListener('click', () => {
    if (requestSupplies()) { save(); rebuild(); banner('🚨 지원 물자를 받았습니다. 규칙이 다시 돌아갑니다.'); }
  });
  rescue.append(rBtn);
  box.append(rescue);
  onUpdate(() => { rescue.style.display = isStuck() ? '' : 'none'; });

  const section = (title, rows) => {
    box.append(el('div', 'sec-title', title));
    if (!rows.length) { box.append(el('div', 'hint', '없음')); return; }
    for (const r of rows) box.append(r);
  };

  section('채취기', state.ext.filter(e => e.count > 0).map(e => {
    const row = el('div', 'frow');
    row.append(iconEl(e.res, 's'), el('span', 'grow', iname(e.res)));
    const cnt = el('span', 'cnt', '×' + e.count);
    const eff = el('span', 'eff');
    row.append(cnt, eff);
    onUpdate(() => {
      cnt.textContent = '×' + e.count;
      const p = Math.round((e.eff || 0) * 100);
      eff.textContent = p + '%';
      eff.className = 'eff ' + (p >= 99 ? 'ok' : 'bad');
    });
    return row;
  }));

  section('생산 라인 (위에서부터 재료 우선)', state.lines.filter(l => l.count > 0).map(l => {
    const r = recipeById[l.recipeId];
    const row = el('div', 'frow');
    row.append(iconEl(r.out[0][0], 's'), el('span', 'grow', r.ko));
    const cnt = el('span', 'cnt', '×' + l.count);
    const eff = el('span', 'eff');
    row.append(cnt, eff);
    const why = el('div', 'why');
    const wrap = el('div');
    wrap.append(row, why);
    onUpdate(() => {
      cnt.textContent = '×' + l.count;
      const p = Math.round((l.eff || 0) * 100);
      eff.textContent = p + '%';
      eff.className = 'eff ' + (p >= 99 ? 'ok' : 'bad');
      why.textContent = l.why && p < 99 ? '⚠ ' + l.why : '';
      why.style.display = why.textContent ? '' : 'none';
    });
    return wrap;
  }));

  section('발전기', state.gens.filter(g => g.count > 0).map(g => {
    const row = el('div', 'frow');
    row.append(iconEl(GENS[g.key].build, 's'), el('span', 'grow', mname(GENS[g.key].build)));
    const cnt = el('span', 'cnt', '×' + g.count);
    const eff = el('span', 'eff');
    row.append(cnt, eff);
    onUpdate(() => {
      cnt.textContent = '×' + g.count;
      const p = Math.round((g.eff || 0) * 100);
      eff.textContent = p + '%';
      eff.className = 'eff ' + (p >= 99 ? 'ok' : 'bad');
    });
    return row;
  }));
}

/* ---------- 재고 ---------- */
let stockKeys = '';
const visibleStock = () => Object.keys(state.stock)
  .filter(cn => stockOf(cn) >= 0.5)
  .sort((a, b) => iname(a).localeCompare(iname(b), 'ko'));

function buildStock() {
  const list = visibleStock();
  stockKeys = list.join(',');
  const t = $('stock-table');
  t.textContent = '';
  for (const cn of list) {
    const tr = el('tr');
    const name = el('td');
    name.append(iconEl(cn, 's'), ' ' + iname(cn));
    const num = el('td', 'num');
    const rate = el('td', 'rate');
    tr.append(name, num, rate);
    t.append(tr);
    onUpdate(() => {
      num.textContent = fmtN(stockOf(cn));
      const v = lastRates[cn] || 0;
      rate.textContent = fmtRate(v);
      rate.className = 'rate ' + (v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'zero');
    });
  }
  if (!list.length) {
    const tr = el('tr');
    const td = el('td', 'hint', '재고 없음 — 채취기부터 지어야 합니다');
    td.colSpan = 3;
    tr.append(td);
    t.append(tr);
  }
}

/* ---------- 계약 · 연구 ---------- */
function buildContract() {
  const box = $('contract-body');
  box.textContent = '';
  const c = CONTRACTS[state.contract];
  if (!c) {
    box.append(el('div', 'ok', '🎉 모든 계약 완료! 공장을 자유롭게 키워보세요.'));
    return;
  }
  box.append(el('div', 'sec-title', `${state.contract + 1}. ${c.name}`),
    el('div', 'hint', `완료 보상: 🪙 ${c.reward}`));
  for (const [cn, n] of Object.entries(c.need)) {
    const row = el('div', 'frow');
    row.append(iconEl(cn, 's'), el('span', 'grow', iname(cn)));
    const val = el('span');
    row.append(val);
    const bar = el('div', 'bar');
    const fill = el('div');
    bar.append(fill);
    box.append(row, bar);
    onUpdate(() => {
      const have = stockOf(cn);
      val.textContent = `${fmtN(have)} / ${n}`;
      val.className = have >= n ? 'ok' : 'bad';
      fill.style.width = Math.min(100, have / n * 100) + '%';
    });
  }
  const btn = el('button', null, '납품하기');
  btn.title = '규칙의 "계약 납품" 행동으로 자동화할 수도 있습니다';
  btn.addEventListener('click', () => {
    const r = doAction({ act: { type: 'deliver' } });
    if (r !== true) banner('납품 실패: ' + r);
    else { save(); rebuild(); }
  });
  box.append(btn);
  onUpdate(() => { btn.disabled = !canAfford(c.need); });
}

function buildTech() {
  const box = $('tech-body');
  box.textContent = '';
  for (const t of TECHS) {
    const row = el('div', 'tech');
    const head = el('div', 'frow');
    head.append(el('span', 'grow', t.name));
    const price = el('span', 'hint', `🪙 ${t.credits}`);
    head.append(price);
    row.append(head, el('div', 'hint', t.desc));
    const costRow = el('div', 'chips');
    for (const [cn, n] of Object.entries(t.cost)) {
      const chip = el('span', 'chip');
      chip.append(iconEl(cn, 's'), el('b', null, String(n)));
      chip.title = iname(cn);
      costRow.append(chip);
    }
    row.append(costRow);
    const btn = el('button', 'mini', '연구');
    btn.addEventListener('click', () => {
      const r = doAction({ act: { type: 'research', tech: t.id } });
      if (r !== true) banner('연구 실패: ' + r);
      else { save(); rebuild(); }
    });
    row.append(btn);
    box.append(row);
    onUpdate(() => {
      const done = hasTech(t.id);
      row.classList.toggle('done', done);
      btn.textContent = done ? '완료' : '연구';
      btn.disabled = done || state.credits < t.credits || !canAfford(t.cost);
    });
  }
}

/* ---------- 로그 · 헤더 ---------- */
function buildLog() {
  const box = $('log-body');
  onUpdate(() => {
    box.textContent = '';
    for (const l of state.log.slice(0, 12)) {
      box.append(el('div', 'log-line log-' + l.kind, l.text));
    }
    if (!state.log.length) box.append(el('div', 'hint', '아직 기록이 없습니다.'));
  });
}

function buildHeader() {
  onUpdate(() => {
    const { supply, demand } = lastPower;
    $('power-text').textContent = `${fmtN(demand)} / ${fmtN(supply)} MW`;
    const pf = $('power-fill');
    pf.style.width = (supply > 0 ? Math.min(100, demand / supply * 100) : 100) + '%';
    pf.style.background = demand > supply ? 'var(--bad)' : 'var(--good)';

    $('bw-text').textContent = `${lastBw.used} / ${lastBw.max}`;
    const bf = $('bw-fill');
    bf.style.width = (lastBw.max > 0 ? Math.min(100, lastBw.used / lastBw.max * 100) : 0) + '%';
    bf.style.background = lastBw.used >= lastBw.max ? 'var(--bad)' : 'var(--accent)';

    $('credits').textContent = '🪙 ' + fmtN(state.credits);
  });
}

function banner(text) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  clearTimeout(banner._t);
  banner._t = setTimeout(() => { b.hidden = true; }, 6000);
}

/* ---------- 클라우드 ---------- */
function initCloudUI() {
  const codeEl = $('cloud-code');
  const statusEl = $('cloud-status');
  Cloud.onChange((status, text, code) => {
    codeEl.textContent = code ? code.replace(/(.{4})(.{4})/, '$1-$2') : '—';
    const label = { syncing: '동기화 중…', synced: '☁ 서버 저장됨', offline: '💾 로컬 저장', conflict: '⚠ 충돌', idle: '' };
    statusEl.textContent = text || label[status] || '';
    statusEl.dataset.state = status;
  });
  $('cloud-code-box').addEventListener('click', async () => {
    if (Cloud.code && navigator.clipboard) {
      try { await navigator.clipboard.writeText(Cloud.code); banner(`📋 코드 ${Cloud.code} 복사됨`); } catch { /* 무시 */ }
    }
  });
  $('btn-cloud-code').addEventListener('click', async () => {
    if (!Cloud.available()) {
      const url = prompt('저장 서버 주소 (예: http://192.168.0.10:8787)', Cloud.serverUrl());
      if (url === null) return;
      Cloud.setServerUrl(url);
      location.reload();
      return;
    }
    const input = prompt('다른 기기에서 쓰던 코드 (8자리)', Cloud.code || '');
    if (!input) return;
    try {
      const remote = await Cloud.useCode(input);
      if (!remote) { banner('해당 코드에 이 게임 저장이 없습니다. 지금 진행을 저장합니다.'); save({ immediate: true, force: true }); return; }
      state = withDefaults(remote);
      applyOffline();
      rebuild();
      banner('☁ 서버 저장을 불러왔습니다.');
    } catch (e) { alert(e.message); }
  });
}

/* ---------- 조립 ---------- */
function rebuild() {
  updaters = [];
  buildHeader();
  buildContract();
  buildTech();
  buildRules();
  buildFactory();
  buildStock();
  buildLog();
}

function update() {
  if (visibleStock().join(',') !== stockKeys) { rebuild(); return; }
  for (const fn of updaters) fn();
}

/* ---------- 시작 ---------- */
let lastSnapshot = '';
async function init() {
  state = load() || freshState();
  const local = state.savedAt || 0;

  initCloudUI();
  rebuild();

  const remote = await Cloud.pull();
  if (remote && (remote.savedAt || 0) > local) state = withDefaults(remote);

  if (state._rescued) {
    delete state._rescued;
    banner('🚨 시작 물자가 없어 아무것도 지을 수 없는 상태였습니다 — 지원 물자와 철 광석 채취기 1대를 지급했습니다.');
  }
  const off = applyOffline();
  if (off > 10) banner(`⏰ 오프라인 ${Math.floor(off / 60)}분 동안 규칙이 공장을 돌렸습니다.`);
  if (state.won) banner('🎉 모든 계약을 완수했습니다!');
  rebuild();
  save({ immediate: true });

  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dtMin = Math.min(10000, now - lastTick) / 60000;
    lastTick = now;
    tick(dtMin);
    // 라인·채취기·발전기 구성이 바뀌면 화면을 다시 그린다
    const snap = state.lines.map(l => l.id + ':' + l.count).join(',') + '|'
      + state.ext.map(e => e.id + ':' + e.count).join(',') + '|'
      + state.gens.map(g => g.id + ':' + g.count).join(',') + '|'
      + state.techs.length + '|' + state.contract + '|' + state.rules.length;
    if (snap !== lastSnapshot) { lastSnapshot = snap; rebuild(); }
    update();
  }, TICK_MS);

  setInterval(() => save(), 10000);
  $('btn-save').addEventListener('click', () => { save({ immediate: true }); banner('저장했습니다.'); });
  window.addEventListener('beforeunload', () => save({ immediate: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) save({ immediate: true }); });
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('처음부터 다시 시작할까요? 서버 저장도 초기화됩니다.')) return;
    localStorage.removeItem(SAVE_KEY);
    state = freshState();
    rebuild();
    save({ immediate: true, force: true });
  });
}

init();
