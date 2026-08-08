'use strict';
/*
 * 규칙 공장 — 시뮬레이션 + 규칙 엔진
 *
 * 이 게임은 손으로 짓지 않는다. 플레이어는 "조건 → 행동" 규칙을 만들고,
 * 컨트롤러가 제한된 제어 대역폭 안에서 그 규칙을 위에서부터 실행한다.
 * 규칙 순서와 대역폭 배분이 곧 실력이다.
 */
const D = window.GAME_DATA;

/* ---------- 데이터 헬퍼 ---------- */
const iname = cn => (D.items[cn] && (D.items[cn].ko || D.items[cn].n)) || D.xnames[cn] || cn;
const mname = cn => (D.machines[cn] && (D.machines[cn].ko || D.machines[cn].n)) || D.xnames[cn] || cn;
const recipeById = {};
for (const r of D.recipes) recipeById[r.id] = r;
const perMin = (r, amt) => amt * 60 / r.time;
const recipePower = r => r.power ?? D.machines[r.machine].power;
const buildCost = cn => Object.fromEntries(D.build[cn] || []);
const ptsOf = cn => (D.items[cn] && D.items[cn].pts) || 0;

/* ---------- 상수 ---------- */
// 시작 전력. 초반 기계 20대 정도는 돌아가야 규칙이 굴러가고,
// 그 이상으로 키우려면 석탄 발전 연구가 필요해진다.
const BASE_POWER = 100;
const TICK_MS = 250;
const RULE_COST_EVAL = 1;       // 규칙 1개 평가 비용
const RULE_COST_FIRE = 3;       // 규칙 1개 발동 비용 (시작 대역폭으로 3~4개는 돌아야 게임이 굴러간다)
const DEFAULT_COOLDOWN = 3;     // 규칙 기본 쿨다운 (초)
const LOG_MAX = 60;

// 채취 가능한 자원 (실제 채굴기·추출기 수치)
const RES = {
  Desc_OreIron_C:      { rate: 60,  power: 5,  build: 'Desc_MinerMk1_C' },
  Desc_OreCopper_C:    { rate: 60,  power: 5,  build: 'Desc_MinerMk1_C' },
  Desc_Stone_C:        { rate: 60,  power: 5,  build: 'Desc_MinerMk1_C' },
  Desc_Coal_C:         { rate: 60,  power: 5,  build: 'Desc_MinerMk1_C', tech: 'coal' },
  Desc_Water_C:        { rate: 120, power: 20, build: 'Desc_WaterPump_C', tech: 'coal' },
  Desc_LiquidOil_C:    { rate: 120, power: 40, build: 'Desc_OilPump_C',  tech: 'refinery' },
  Desc_OreGold_C:      { rate: 60,  power: 5,  build: 'Desc_MinerMk1_C', tech: 'manufacturer' },
  Desc_RawQuartz_C:    { rate: 60,  power: 5,  build: 'Desc_MinerMk1_C', tech: 'manufacturer' },
  Desc_Sulfur_C:       { rate: 60,  power: 5,  build: 'Desc_MinerMk1_C', tech: 'manufacturer' },
};

// 발전기 (연료는 재고에서 소모)
const GENS = {
  coal: { build: 'Desc_GeneratorCoal_C', power: 75,  burns: [['Desc_Coal_C', 15], ['Desc_Water_C', 45]], tech: 'coal' },
  fuel: { build: 'Desc_GeneratorFuel_C', power: 250, burns: [['Desc_LiquidFuel_C', 20]], tech: 'refinery' },
};

// 연구: 크레딧 + 재료. 대역폭·규칙 슬롯·기계 해금이 성장의 축
const TECHS = [
  { id: 'bw1',    name: '제어 대역폭 II',  desc: '대역폭 +6',
    credits: 40,   cost: { Desc_IronPlate_C: 60, Desc_Wire_C: 100 },       apply: s => { s.bwMax += 6; } },
  { id: 'sell2',  name: '고효율 소각로',   desc: '재고 소각으로 얻는 크레딧 2배',
    credits: 60,   cost: { Desc_Cement_C: 100, Desc_Wire_C: 100 },            apply: s => { s.sellMult = 2; } },
  { id: 'slot1',  name: '규칙 메모리 II',  desc: '규칙 슬롯 +4',
    credits: 80,   cost: { Desc_Cement_C: 100, Desc_IronRod_C: 100 },      apply: s => { s.ruleSlots += 4; } },
  { id: 'coal',   name: '석탄 발전',       desc: '석탄·물 채취 + 석탄 발전기 해금',
    credits: 120,  cost: { Desc_IronPlateReinforced_C: 20, Desc_Rotor_C: 10 }, apply: () => {} },
  { id: 'foundry',name: '주조소',          desc: '주조소 해금 (강철)',
    credits: 200,  cost: { Desc_Cement_C: 200, Desc_Rotor_C: 20 },         apply: s => { s.machines.push('Desc_FoundryMk1_C'); } },
  { id: 'bw2',    name: '제어 대역폭 III', desc: '대역폭 +10',
    credits: 300,  cost: { Desc_SteelPlate_C: 80, Desc_ModularFrame_C: 20 }, apply: s => { s.bwMax += 10; } },
  { id: 'refinery',name: '석유 정제',      desc: '정제소 · 원유 채취 · 연료 발전기 해금',
    credits: 450,  cost: { Desc_SteelPipe_C: 100, Desc_SteelPlateReinforced_C: 20 }, apply: s => { s.machines.push('Desc_OilRefinery_C', 'Desc_Packager_C'); } },
  { id: 'slot2',  name: '규칙 메모리 III', desc: '규칙 슬롯 +6',
    credits: 600,  cost: { Desc_Plastic_C: 100, Desc_Rubber_C: 100 },      apply: s => { s.ruleSlots += 6; } },
  { id: 'manufacturer', name: '고급 제조', desc: '제조기 해금 + 카테리움·석영·유황 채취',
    credits: 900,  cost: { Desc_Motor_C: 20, Desc_Plastic_C: 200 },        apply: s => { s.machines.push('Desc_ManufacturerMk1_C'); } },
  { id: 'bw3',    name: '제어 대역폭 IV',  desc: '대역폭 +20',
    credits: 1400, cost: { Desc_Computer_C: 10, Desc_Motor_C: 40 },        apply: s => { s.bwMax += 20; } },
  { id: 'idle',   name: '무인 운전',       desc: '오프라인 진행 4시간 → 12시간',
    credits: 2000, cost: { Desc_Computer_C: 20, Desc_ModularFrameHeavy_C: 10 }, apply: s => { s.offlineH = 12; } },
];
const techById = Object.fromEntries(TECHS.map(t => [t.id, t]));

// 납품 계약: 이 게임의 목표. 달성하면 크레딧과 다음 계약이 열린다
const CONTRACTS = [
  { name: '1차 납품', need: { Desc_IronPlate_C: 200, Desc_IronRod_C: 200 }, reward: 150 },
  { name: '2차 납품', need: { Desc_IronPlateReinforced_C: 100, Desc_Rotor_C: 50 }, reward: 400 },
  { name: '3차 납품', need: { Desc_SpaceElevatorPart_1_C: 20 }, reward: 900 },
  { name: '4차 납품', need: { Desc_SpaceElevatorPart_2_C: 30, Desc_SteelPlate_C: 300 }, reward: 1800 },
  { name: '5차 납품', need: { Desc_SpaceElevatorPart_3_C: 30, Desc_Computer_C: 30 }, reward: 4000 },
];

/* ---------- 상태 ---------- */
const SAVE_KEY = 'rulefactory-v1';
let state = null;

// 시작 지원 물자. 이 게임에는 수동 채집·수동 제작이 없으므로
// 첫 채취기와 첫 라인을 세울 밑천이 없으면 아무것도 시작할 수 없다.
// 회전자가 들어 있는 이유: 조립기 건설비가 보강 철판·회전자인데 회전자는 조립기에서만 나온다.
// 밑천에 회전자가 없으면 조립기를 영영 못 지어 보강 철판 재생산이 막히고,
// 보강 철판이 없으면 제작기도 더 못 지어 초반 5대에서 성장이 멈춘다.
const STARTER_KIT = {
  Desc_IronPlate_C: 80,
  Desc_IronRod_C: 60,
  Desc_Cement_C: 40,
  Desc_Wire_C: 80,
  Desc_Cable_C: 60,
  Desc_IronPlateReinforced_C: 24,
  Desc_Rotor_C: 8,
};

function freshState() {
  return {
    stock: { ...STARTER_KIT },
    // 지원 채취기 1대는 무료로 깔려 있다 (여기서 나오는 광석이 첫 순환을 만든다)
    ext: [{ id: 1, res: 'Desc_OreIron_C', count: 1 }],
    lines: [],          // [{ id, recipeId, count }]
    gens: [],           // [{ id, key, count }]
    rules: [],          // [{ id, on, cond, act, cooldown, lastFired, fires, status }]
    // 조립기까지 있어야 제작기 재료(보강 철판)를 스스로 만들 수 있다 = 초반 자립 가능
    machines: ['Desc_SmelterMk1_C', 'Desc_ConstructorMk1_C', 'Desc_AssemblerMk1_C'],
    techs: [],
    credits: 0,
    sellMult: 1,
    bwMax: 16,
    ruleSlots: 14,   // 자립하는 최소 순환(채취 3종 + 라인 8종 + 납품)이 13개다
    contract: 0,
    offlineH: 4,
    seq: 2,             // 1번은 지원 채취기가 쓴다
    log: [],
    won: false,
    savedAt: Date.now(),
  };
}

function withDefaults(s) {
  const fresh = freshState();
  for (const k of ['ext', 'lines', 'gens', 'rules', 'machines', 'techs', 'log']) {
    if (!Array.isArray(s[k])) s[k] = fresh[k];
  }
  if (!s.stock || typeof s.stock !== 'object') s.stock = {};
  for (const k of ['credits', 'bwMax', 'ruleSlots', 'contract', 'offlineH', 'seq', 'sellMult']) {
    if (typeof s[k] !== 'number' || !isFinite(s[k])) s[k] = fresh[k];
  }
  s.seq = Math.max(s.seq, 1 + Math.max(0, ...s.rules.map(r => r.id || 0),
    ...s.lines.map(l => l.id || 0), ...s.ext.map(e => e.id || 0), ...s.gens.map(g => g.id || 0)));

  // 밑천 없이 시작해 아무것도 못 하던 초기 저장을 구제한다
  if (isStuckState(s) && !s.kitGiven) {
    for (const [cn, n] of Object.entries(STARTER_KIT)) s.stock[cn] = (s.stock[cn] || 0) + n;
    if (!s.ext.some(e => e.count > 0)) s.ext.push({ id: s.seq++, res: 'Desc_OreIron_C', count: 1 });
    s.kitGiven = true;
    s._rescued = true;
  }
  return s;
}

/** 채취기가 하나도 없고 채취기를 지을 자재도 없으면 새로 들어올 자원이 없다 = 교착 */
function isStuckState(s) {
  const noExt = !s.ext.some(e => e.count > 0);
  const minerCost = buildCost('Desc_MinerMk1_C');
  const canBuild = Object.entries(minerCost).every(([cn, n]) => (s.stock[cn] || 0) >= n);
  return noExt && !canBuild;
}
const isStuck = () => isStuckState(state);

/** 교착에서 빠져나오기 위한 지원 물자 (막혔을 때만 쓸 수 있다) */
function requestSupplies() {
  if (!isStuck()) return false;
  for (const [cn, n] of Object.entries(STARTER_KIT)) addStock(cn, n);
  if (!state.ext.some(e => e.count > 0)) {
    state.ext.push({ id: state.seq++, res: 'Desc_OreIron_C', count: 1 });
  }
  log('🚨 긴급 지원 물자를 받았습니다.', 'contract');
  return true;
}

const stockOf = cn => state.stock[cn] || 0;
const addStock = (cn, n) => { state.stock[cn] = Math.max(0, stockOf(cn) + n); };
const canAfford = cost => Object.entries(cost).every(([cn, n]) => stockOf(cn) >= n);
const pay = cost => { for (const [cn, n] of Object.entries(cost)) addStock(cn, -n); };
const hasTech = id => state.techs.includes(id);
const resUnlocked = cn => !RES[cn].tech || hasTech(RES[cn].tech);
const genUnlocked = k => !GENS[k].tech || hasTech(GENS[k].tech);
const recipeUnlocked = r => state.machines.includes(r.machine) && !r.alt;
const unlockedRecipes = () => D.recipes.filter(recipeUnlocked);

function log(text, kind) {
  state.log.unshift({ t: Date.now(), text, kind: kind || 'info' });
  if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
}

/* ---------- 시뮬레이션 ---------- */
let lastRates = {};
let lastPower = { supply: BASE_POWER, demand: 0, eff: 1 };

function tick(dtMin) {
  const prev = { ...state.stock };

  // 1) 발전: 연료가 있는 만큼만 돈다
  let supply = BASE_POWER;
  for (const g of state.gens) {
    const def = GENS[g.key];
    if (!def || g.count <= 0) { g.eff = 0; continue; }
    let frac = 1;
    for (const [cn, rate] of def.burns) {
      const need = rate * g.count * dtMin;
      if (need > 0) frac = Math.min(frac, stockOf(cn) / need);
    }
    frac = Math.min(1, Math.max(0, frac));
    for (const [cn, rate] of def.burns) addStock(cn, -rate * g.count * dtMin * frac);
    supply += def.power * g.count * frac;
    g.eff = frac;
  }

  // 2) 전력 수요 → 효율
  let demand = 0;
  for (const e of state.ext) demand += (RES[e.res]?.power || 0) * e.count;
  for (const l of state.lines) {
    const r = recipeById[l.recipeId];
    if (r) demand += recipePower(r) * l.count;
  }
  const powerEff = demand > 0 ? Math.min(1, supply / demand) : 1;

  // 3) 채취
  for (const e of state.ext) {
    const def = RES[e.res];
    if (!def || e.count <= 0) { e.eff = 0; continue; }
    addStock(e.res, def.rate * e.count * powerEff * dtMin);
    e.eff = powerEff;
  }

  // 4) 생산 라인: 모자란 재료는 요구량 비율대로 나눠 갖는다.
  //
  // 예전에는 배열 순서대로 재고를 끌어갔다. 그러면 같은 재료를 쓰는 라인 중 앞선 하나가
  // 재고를 0으로 만들어, 뒤쪽 라인은 조건이 아무리 맞아도 영영 한 개도 생산하지 못했다
  // (철판 라인이 철 주괴를 전부 먹어 철봉이 0으로 고정 → 철봉이 필요한 납품·제련기·채굴기가 모두 막힘).
  // 벨트를 나눠 물린 것처럼 비율로 나누면 양쪽 다 느리게라도 돈다.
  const want = {};
  for (const l of state.lines) {
    const r = recipeById[l.recipeId];
    if (!r || l.count <= 0) continue;
    for (const [cn, amt] of r.in) want[cn] = (want[cn] || 0) + perMin(r, amt) * l.count * powerEff * dtMin;
  }
  const share = {};
  for (const cn of Object.keys(want)) share[cn] = want[cn] > 0 ? Math.min(1, stockOf(cn) / want[cn]) : 1;

  for (const l of state.lines) {
    const r = recipeById[l.recipeId];
    if (!r || l.count <= 0) { l.eff = 0; l.why = '기계 없음'; continue; }
    const run = l.count * powerEff;
    let frac = 1;
    let short = null;
    for (const [cn] of r.in) {
      const f = share[cn] ?? 1;
      if (f < frac) { frac = f; short = cn; }
    }
    frac = Math.min(1, Math.max(0, frac));
    for (const [cn, amt] of r.in) addStock(cn, -perMin(r, amt) * run * dtMin * frac);
    for (const [cn, amt] of r.out) addStock(cn, perMin(r, amt) * run * dtMin * frac);
    l.eff = powerEff * frac;
    l.why = frac < 0.99 ? `재료 부족: ${iname(short)}` : (powerEff < 0.99 ? '전력 부족' : null);
  }

  const keys = new Set([...Object.keys(prev), ...Object.keys(state.stock)]);
  lastRates = {};
  for (const cn of keys) lastRates[cn] = ((state.stock[cn] || 0) - (prev[cn] || 0)) / dtMin;
  lastPower = { supply, demand, eff: powerEff };

  runRules(dtMin);
}

/* ---------- 규칙 ---------- */
const COND_TYPES = {
  always:  { label: '항상', fields: [] },
  stock:   { label: '재고', fields: ['item', 'op', 'value'] },
  rate:    { label: '순생산(/분)', fields: ['item', 'op', 'value'] },
  power:   { label: '전력 여유(%)', fields: ['op', 'value'] },
  lineEff: { label: '라인 가동률(%)', fields: ['line', 'op', 'value'] },
  credits: { label: '크레딧', fields: ['op', 'value'] },
  every:   { label: '주기(초)마다', fields: ['value'] },
};
const ACT_TYPES = {
  buildLine: { label: '생산 라인 증설', fields: ['recipe', 'amount'] },
  buildExt:  { label: '채취기 증설',   fields: ['res', 'amount'] },
  buildGen:  { label: '발전기 증설',   fields: ['gen', 'amount'] },
  sell:      { label: '재고 소각 → 크레딧', fields: ['item', 'amount'] },
  research:  { label: '연구 구매',     fields: ['tech'] },
  deliver:   { label: '계약 납품',     fields: [] },
  toggle:    { label: '다른 규칙 켜기/끄기', fields: ['rule', 'onoff'] },
};
const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };

const ruleById = id => state.rules.find(r => r.id === id);
const lineById = id => state.lines.find(l => l.id === id);

function condMet(rule, nowSec) {
  const c = rule.cond || {};
  const v = Number(c.value) || 0;
  const op = OPS[c.op] || OPS['>'];
  switch (c.type) {
    case 'always': return true;
    case 'stock': return op(stockOf(c.item), v);
    case 'rate': return op(lastRates[c.item] || 0, v);
    case 'power': {
      const free = lastPower.supply > 0 ? (1 - lastPower.demand / lastPower.supply) * 100 : 0;
      return op(free, v);
    }
    case 'lineEff': {
      const l = lineById(c.line);
      return l ? op((l.eff || 0) * 100, v) : false;
    }
    case 'credits': return op(state.credits, v);
    case 'every': return nowSec - (rule.lastFired || 0) >= Math.max(1, v);
    default: return false;
  }
}

/** 비용을 못 내면 "무엇이" 모자란지 알려준다 (막힘 사유 표시용) */
function shortfall(cost) {
  const miss = Object.entries(cost)
    .filter(([cn, n]) => stockOf(cn) < n)
    .sort((a, b) => (b[1] - stockOf(b[0])) - (a[1] - stockOf(a[0])));
  if (!miss.length) return null;
  const [cn, n] = miss[0];
  return `자재 부족: ${iname(cn)} ${Math.floor(stockOf(cn))}/${n}`
    + (miss.length > 1 ? ` 외 ${miss.length - 1}종` : '');
}
const scaleCost = (cost, k) => Object.fromEntries(Object.entries(cost).map(([cn, n]) => [cn, n * k]));

/**
 * 남는 전력으로 감당되는 기계만 짓는다.
 *
 * 이 검사가 없으면 되먹임이 생긴다: 전력이 모자라 라인이 감속 → 재고가 목표에 못 미침
 * → "재고가 적으면 증설" 규칙이 라인을 더 짓는다 → 전력이 더 모자라 공장 전체가 더 느려진다.
 * 발전기는 전력을 늘리러 짓는 것이므로 이 검사에서 제외한다.
 */
function powerRoom(draw) {
  const free = lastPower.supply - lastPower.demand;
  if (free >= draw) return null;
  return `전력 부족: 여유 ${Math.max(0, Math.round(free))} / 필요 ${Math.round(draw)}MW`;
}

/** 행동 실행. 성공하면 true, 자원/조건 부족이면 사유 문자열 */
function doAction(rule) {
  const a = rule.act || {};
  const amount = Math.max(1, Math.floor(Number(a.amount) || 1));
  switch (a.type) {
    case 'buildLine': {
      const r = recipeById[a.recipe];
      if (!r || !recipeUnlocked(r)) return '레시피 잠김';
      const noPower = powerRoom(recipePower(r) * amount);
      if (noPower) return noPower;
      const total = scaleCost(buildCost(r.machine), amount);
      const miss = shortfall(total);
      if (miss) return miss;
      pay(total);
      let line = state.lines.find(l => l.recipeId === a.recipe);
      if (!line) { line = { id: state.seq++, recipeId: a.recipe, count: 0 }; state.lines.push(line); }
      line.count += amount;
      log(`${r.ko} 라인 +${amount} (총 ${line.count}대)`, 'build');
      return true;
    }
    case 'buildExt': {
      const def = RES[a.res];
      if (!def || !resUnlocked(a.res)) return '자원 잠김';
      const noPower = powerRoom(def.power * amount);
      if (noPower) return noPower;
      const total = scaleCost(buildCost(def.build), amount);
      const miss = shortfall(total);
      if (miss) return miss;
      pay(total);
      let e = state.ext.find(x => x.res === a.res);
      if (!e) { e = { id: state.seq++, res: a.res, count: 0 }; state.ext.push(e); }
      e.count += amount;
      log(`${iname(a.res)} 채취기 +${amount} (총 ${e.count}대)`, 'build');
      return true;
    }
    case 'buildGen': {
      const def = GENS[a.gen];
      if (!def || !genUnlocked(a.gen)) return '발전기 잠김';
      const total = scaleCost(buildCost(def.build), amount);
      const miss = shortfall(total);
      if (miss) return miss;
      pay(total);
      let g = state.gens.find(x => x.key === a.gen);
      if (!g) { g = { id: state.seq++, key: a.gen, count: 0 }; state.gens.push(g); }
      g.count += amount;
      log(`${mname(def.build)} +${amount} (총 ${g.count}대)`, 'build');
      return true;
    }
    case 'sell': {
      const pts = ptsOf(a.item);
      if (pts <= 0) return '소각 불가 품목';
      const n = Math.min(stockOf(a.item), amount);
      if (n < 1) return '재고 없음';
      addStock(a.item, -n);
      const gain = Math.max(1, Math.round(pts * n / 10 * (state.sellMult || 1)));
      state.credits += gain;
      return true;
    }
    case 'research': {
      const t = techById[a.tech];
      if (!t) return '없는 연구';
      if (hasTech(t.id)) return '이미 완료';
      if (state.credits < t.credits) return `크레딧 부족 ${Math.floor(state.credits)}/${t.credits}`;
      const missT = shortfall(t.cost);
      if (missT) return missT;
      state.credits -= t.credits;
      pay(t.cost);
      state.techs.push(t.id);
      t.apply(state);
      log(`🔬 연구 완료: ${t.name}`, 'tech');
      return true;
    }
    case 'deliver': {
      const c = CONTRACTS[state.contract];
      if (!c) return '남은 계약 없음';
      const missC = shortfall(c.need);
      if (missC) return missC.replace('자재', '납품');
      pay(c.need);
      state.credits += c.reward;
      state.contract++;
      if (state.contract >= CONTRACTS.length) state.won = true;
      log(`📦 ${c.name} 완료 — 크레딧 +${c.reward}`, 'contract');
      return true;
    }
    case 'toggle': {
      const target = ruleById(a.rule);
      if (!target) return '대상 규칙 없음';
      const on = a.onoff !== 'off';
      if (target.on === on) return '이미 그 상태';
      target.on = on;
      log(`규칙 #${state.rules.indexOf(target) + 1} ${on ? '켜짐' : '꺼짐'}`, 'info');
      return true;
    }
    default: return '알 수 없는 행동';
  }
}

let lastBw = { used: 0, max: 0 };

function runRules(dtMin) {
  const nowSec = (state.simSec = (state.simSec || 0) + dtMin * 60);
  const n = state.rules.length;
  let used = 0;
  const budget = state.bwMax;

  // 한 틱 안에서는 여전히 위에서부터 평가한다 (= 순서가 곧 우선순위).
  // 다만 지난 틱에 대역폭이 모자라 밀린 규칙이 있으면 그 규칙부터 시작해 한 바퀴 돈다.
  // 이렇게 하지 않으면 "위치 + 발동 비용 > 대역폭" 인 아래쪽 규칙은
  // 조건이 아무리 만족돼도 영영 발동하지 못한다 (납품 규칙이 대표적).
  const start = n ? ((state.bwStart || 0) % n + n) % n : 0;
  let nextStart = -1;
  const starve = idx => { if (nextStart < 0) nextStart = idx; };

  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    const rule = state.rules[idx];
    if (!rule.on) { rule.status = 'off'; continue; }
    if (used + RULE_COST_EVAL > budget) { rule.status = 'bw'; starve(idx); continue; }  // 대역폭 소진 → 평가조차 못 함
    used += RULE_COST_EVAL;
    const cd = rule.cooldown ?? DEFAULT_COOLDOWN;
    if (nowSec - (rule.lastFired || 0) < cd) { rule.status = 'cool'; continue; }
    if (!condMet(rule, nowSec)) { rule.status = 'wait'; continue; }
    if (used + RULE_COST_FIRE > budget) { rule.status = 'bw'; starve(idx); continue; }
    const r = doAction(rule);
    if (r === true) {
      used += RULE_COST_FIRE;
      rule.lastFired = nowSec;
      rule.fires = (rule.fires || 0) + 1;
      rule.status = 'fired';
      rule.why = null;
    } else {
      rule.status = 'block';
      rule.why = r;
    }
  }
  state.bwStart = nextStart >= 0 ? nextStart : 0;   // 밀린 규칙이 없으면 다시 1번부터
  lastBw = { used, max: budget };
}

/* ---------- 저장 ---------- */
function save(opts = {}) {
  state.savedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  Cloud.push(state, opts);
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object') return withDefaults(s);
    }
  } catch (e) { /* 손상된 저장은 무시 */ }
  return null;
}

/** 시작 시 밀린 시간만큼 돌린다 (규칙도 그대로 동작한다) */
function applyOffline() {
  const capH = state.offlineH || 4;
  const elapsedSec = Math.min(capH * 3600, (Date.now() - (state.savedAt || Date.now())) / 1000);
  if (elapsedSec <= 10) return 0;
  const steps = Math.floor(elapsedSec / 5);
  for (let i = 0; i < steps; i++) tick(5 / 60);
  return elapsedSec;
}
