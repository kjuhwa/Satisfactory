'use strict';
const D = window.GAME_DATA;

/* ---------- 데이터 헬퍼 (본편과 동일 수치) ---------- */
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
const MINERS = {
  1: { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  2: { build: 'Desc_MinerMk2_C', rate: 120, power: 12 },
  3: { build: 'Desc_MinerMk3_C', rate: 240, power: 30 },
};
const minerTierUnlocked = t => t === 1 || (t === 2 && state.ms >= 4) || (t === 3 && state.ms >= 6);
const GENS = {
  coal: { build: 'Desc_GeneratorCoal_C', power: 75,  burns: [['Desc_Coal_C', 15], ['Desc_Water_C', 45]] },
  fuel: { build: 'Desc_GeneratorFuel_C', power: 250, burns: [['Desc_LiquidFuel_C', 20]] },
  nuclear: {
    build: 'Desc_GeneratorNuclear_C', power: 2500,
    burns: [['Desc_NuclearFuelRod_C', 0.2], ['Desc_Water_C', 240]],
    wastes: [['Desc_NuclearWaste_C', 10]],
  },
};
const BASE_POWER = 20;

const BELT_TIERS = [null,
  { cap: 60,  cost: {} },
  { cap: 120, cost: { Desc_IronPlateReinforced_C: 5 } },
  { cap: 270, cost: { Desc_SteelPlate_C: 5 } },
  { cap: 480, cost: { Desc_SteelPlateReinforced_C: 5 } },
  { cap: 780, cost: { Desc_AluminumPlate_C: 10 } },
];
const beltOf = e => BELT_TIERS[e.tier || 1];

const PURITY = {
  impure: { mult: 0.5, ko: '불순' },
  normal: { mult: 1,   ko: '보통' },
  pure:   { mult: 2,   ko: '순수' },
};
const DEPOSITS = {
  Desc_OreIron_C:      { pure: 2, normal: 4, impure: 3 },
  Desc_OreCopper_C:    { pure: 1, normal: 3, impure: 3 },
  Desc_Stone_C:        { pure: 2, normal: 3, impure: 2 },
  Desc_Coal_C:         { pure: 2, normal: 3, impure: 2 },
  Desc_OreGold_C:      { pure: 1, normal: 2, impure: 2 },
  Desc_RawQuartz_C:    { pure: 1, normal: 2, impure: 2 },
  Desc_Sulfur_C:       { pure: 1, normal: 2, impure: 2 },
  Desc_OreBauxite_C:   { pure: 1, normal: 2, impure: 2 },
  Desc_OreUranium_C:   { normal: 2, impure: 2 },
  Desc_SAM_C:          { normal: 2, impure: 1 },
  Desc_LiquidOil_C:    { pure: 2, normal: 3, impure: 2 },
  Desc_NitrogenGas_C:  { normal: 2, impure: 2 },
  Desc_Water_C:        null,
};

const SHARD = 'Desc_CrystalShard_C';
const POWER_EXP = 1.321929;
const ptsOf = cn => (D.items[cn] && D.items[cn].pts) || 0;
const couponCost = k => 500 * (k + 1) * (k + 2) / 2;
const clockOf = f => f.clock || 100;
const shardsFor = clock => Math.max(0, Math.ceil((clock - 100) / 50));
const lockedAlts = () => D.recipes.filter(r => r.alt && !state.altUnlocked.includes(r.id));

/* 연구 트리: 쿠폰으로 영구 강화 (계약 → 쿠폰 → 연구 순환) */
const RESEARCH = {
  mine:    { name: '채굴 효율',      max: 5, base: 4,  fx: l => `채굴 속도 +${l * 10}%` },
  craft:   { name: '제조 속도',      max: 5, base: 4,  fx: l => `기계 속도 +${l * 10}% (전력 불변)` },
  power:   { name: '발전 효율',      max: 3, base: 4,  fx: l => `발전량 +${l * 10}%` },
  store:   { name: '저장고 확장',    max: 3, base: 3,  fx: l => `단지 저장고 +${l * 50}%` },
  belt:    { name: '벨트 정비',      max: 3, base: 3,  fx: l => `벨트 용량 +${l * 20}%` },
  offline: { name: '오프라인 연장',  max: 2, base: 6,  fx: l => `오프라인 진행 ${4 + l * 4}시간` },
  slot:    { name: '계약 슬롯',      max: 2, base: 10, fx: l => `동시 계약 ${3 + l}건` },
  reward:  { name: '계약 보상 협상', max: 2, base: 6,  fx: l => `계약 쿠폰 보상 +${l * 25}%` },
};
const rlv = k => (state.research && state.research[k]) || 0;
const researchCost = k => RESEARCH[k].base * Math.pow(2, rlv(k));
const genPowerOf = g => g.power * (1 + 0.1 * rlv('power'));
const beltCap = e => Math.round(beltOf(e).cap * (1 + 0.2 * rlv('belt')));

/** 쿠폰 긴급 건설: 재료 대신 쿠폰으로 1대 건설 — 가격은 건설 재료의 싱크 포인트 가치 비례 */
function couponBuildCost(def) {
  let pts = 0;
  for (const [cn, n] of Object.entries(def.cost)) pts += ptsOf(cn) * n;
  return Math.max(1, Math.ceil(pts / 500));
}

function depositsLeft(resource, purity) {
  const pool = DEPOSITS[resource];
  if (!pool) return Infinity;
  const bonus = (state.bonusDeposits && state.bonusDeposits[resource] && state.bonusDeposits[resource][purity]) || 0;
  const total = (pool[purity] || 0) + bonus; // 계약 보상 '탐사권'으로 늘어난 매장지
  let used = 0;
  for (const cx of state.cx) {
    for (const f of cx.members) {
      if (f.type === 'miner' && f.resource === resource && (f.purity || 'normal') === purity) used += f.count;
    }
  }
  return Math.max(0, total - used);
}

/* ---------- 마일스톤 (본편과 동일) ---------- */
const MS = [
  { name: '자동 채굴', desc: '채굴기 해금 — 시설을 배치하고 제련 시설과 겹쳐 단지를 만드세요',
    cost: { Desc_IronPlate_C: 10, Desc_IronRod_C: 10 },
    apply: s => { s.miners = true; } },
  { name: '부품 조립', desc: '조립기 해금 (보강 철판, 회전자 등)',
    cost: { Desc_IronPlate_C: 30, Desc_IronRod_C: 30, Desc_Wire_C: 100 },
    apply: s => { s.machines.push('Desc_AssemblerMk1_C'); } },
  { name: '석탄 발전', desc: '석탄 발전기 · 물 추출기 · 석탄 채굴 해금 — 셋을 합치면 발전 단지!',
    cost: { Desc_IronPlateReinforced_C: 20, Desc_Rotor_C: 10, Desc_Cable_C: 50 },
    apply: s => { s.gensUnlocked.push('coal'); s.raws.push('Desc_Coal_C', 'Desc_Water_C'); } },
  { name: '기초 강철', desc: '주조소 · 채굴기 Mk.2(120/분) 해금',
    cost: { Desc_Cement_C: 100, Desc_Rotor_C: 20, Desc_ModularFrame_C: 10 },
    apply: s => { s.machines.push('Desc_FoundryMk1_C'); } },
  { name: '석유 정제', desc: '정제소 · 패키저 · 원유 추출기 · 연료 발전기 해금',
    cost: { Desc_SteelPlate_C: 50, Desc_SteelPipe_C: 100, Desc_SteelPlateReinforced_C: 20 },
    apply: s => { s.machines.push('Desc_OilRefinery_C', 'Desc_Packager_C'); s.gensUnlocked.push('fuel'); s.raws.push('Desc_LiquidOil_C'); } },
  { name: '고급 제조', desc: '제조기 · 채굴기 Mk.3(240/분) 해금 + 카테리움 · 원시 수정 · 유황 채굴',
    cost: { Desc_Motor_C: 20, Desc_Plastic_C: 100, Desc_Rubber_C: 100, Desc_SteelPlate_C: 100 },
    apply: s => { s.machines.push('Desc_ManufacturerMk1_C'); s.raws.push('Desc_OreGold_C', 'Desc_RawQuartz_C', 'Desc_Sulfur_C'); } },
  { name: '첨단 소재', desc: '블렌더 · 입자 가속기 · 변환기 · 양자 인코더 · 원자력 발전소 + 상위 자원 해금',
    cost: { Desc_Computer_C: 20, Desc_ModularFrameHeavy_C: 10, Desc_Motor_C: 50 },
    apply: s => {
      s.machines.push('Desc_Blender_C', 'Desc_HadronCollider_C', 'Desc_Converter_C', 'Desc_QuantumEncoder_C');
      s.raws.push('Desc_OreBauxite_C', 'Desc_OreUranium_C', 'Desc_SAM_C', 'Desc_NitrogenGas_C');
      s.gensUnlocked.push('nuclear');
    } },
  { name: '프로젝트 조립: 1단계', desc: '궤도 엘리베이터로 첫 부품을 발사합니다 (보상: 쿠폰 10장)',
    cost: { Desc_SpaceElevatorPart_1_C: 50, Desc_SpaceElevatorPart_2_C: 50, Desc_SpaceElevatorPart_3_C: 50 },
    apply: s => { s.coupons += 10; } },
  { name: '프로젝트 조립: 2단계', desc: '부품 수요가 커집니다 (보상: 쿠폰 15장)',
    cost: { Desc_SpaceElevatorPart_1_C: 150, Desc_SpaceElevatorPart_2_C: 150, Desc_SpaceElevatorPart_3_C: 50 },
    apply: s => { s.coupons += 15; } },
  { name: '프로젝트 조립: 3단계', desc: '모듈 엔진 · 적응형 제어 장치 생산 (보상: 쿠폰 20장)',
    cost: { Desc_SpaceElevatorPart_2_C: 300, Desc_SpaceElevatorPart_4_C: 100, Desc_SpaceElevatorPart_5_C: 50 },
    apply: s => { s.coupons += 20; } },
  { name: '프로젝트 조립: 4단계', desc: '최상위 부품 4종 (보상: 쿠폰 30장)',
    cost: { Desc_SpaceElevatorPart_6_C: 100, Desc_SpaceElevatorPart_7_C: 100,
            Desc_SpaceElevatorPart_8_C: 50, Desc_SpaceElevatorPart_9_C: 50 },
    apply: s => { s.coupons += 30; } },
  { name: '프로젝트 조립: 5단계', desc: '차원 너머로 — 최종 목표!',
    cost: { Desc_SpaceElevatorPart_10_C: 50, Desc_SpaceElevatorPart_11_C: 25, Desc_SpaceElevatorPart_12_C: 50 },
    apply: s => { s.won = true; } },
];

/* ---------- 상태 ---------- */
const SAVE_KEY = 'sfy-cx-v1';
let state = null;

function freshState() {
  return {
    stock: {},
    cx: [],            // [{id,x,y,members:[fac],pool:{}}]
    edges: [],         // [{id,tier,from:{cx,item},to:{cx,item}}]
    seq: 1,
    gensUnlocked: [],
    machines: ['Desc_SmelterMk1_C', 'Desc_ConstructorMk1_C'],
    raws: ['Desc_OreIron_C', 'Desc_OreCopper_C', 'Desc_Stone_C'],
    miners: false,
    ms: 0,
    won: false,
    sinkPts: 0,
    coupons: 0,
    couponsPrinted: 0,
    altUnlocked: [],
    contracts: [],
    research: {},
    bonusDeposits: {},
    speed: 1,
    zoom: 1,
    savedAt: Date.now(),
  };
}

function withDefaults(s) {
  s.sinkPts ??= 0; s.coupons ??= 0; s.couponsPrinted ??= 0;
  s.altUnlocked ??= [];
  s.speed ??= 1;
  s.contracts ??= [];
  s.research ??= {};
  s.bonusDeposits ??= {};
  s.won = s.ms >= MS.length;
  if (s.ms >= 7 && !s.gensUnlocked.includes('nuclear')) s.gensUnlocked.push('nuclear');
  for (const cx of s.cx) { cx.members ??= []; }
  migrateToWiring(s); // 공유 저장고 → 내부 배선 방식
  return s;
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
      if (s && Array.isArray(s.cx)) return withDefaults(s);
    }
  } catch (e) { /* 무시 */ }
  return null;
}

/* ---------- 시설 정의 ---------- */
const cxById = id => state.cx.find(c => c.id === id);

function facDef(f) {
  if (f.type === 'miner') {
    const def = EXT[f.resource] || MINERS[f.tier || 1];
    const mult = PURITY[f.purity || 'normal'].mult * (1 + 0.1 * rlv('mine'));
    const c = clockOf(f) / 100;
    return {
      label: (def.label || D.xnames[def.build]) + ' — ' + iname(f.resource),
      iconCn: f.resource,
      ins: [], outs: [{ item: f.resource, rate: def.rate * mult * c }],
      power: def.power * Math.pow(c, POWER_EXP),
      cost: buildCost(def.build),
    };
  }
  if (f.type === 'machine') {
    const r = recipeById[f.recipeId];
    const c = clockOf(f) / 100 * (1 + 0.1 * rlv('craft'));
    return {
      label: (r.alt ? '★ ' : '') + r.ko,
      iconCn: r.out[0][0],
      ins: r.in.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) * c })),
      outs: r.out.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) * c })),
      power: linePower(r) * Math.pow(clockOf(f) / 100, POWER_EXP),
      cost: buildCost(r.machine),
    };
  }
  if (f.type === 'gen') {
    const g = GENS[f.genKey];
    return {
      label: D.xnames[g.build],
      iconCn: g.build,
      ins: g.burns.map(([cn, rate]) => ({ item: cn, rate })),
      outs: (g.wastes || []).map(([cn, rate]) => ({ item: cn, rate })),
      power: 0, produces: genPowerOf(g),
      cost: buildCost(g.build),
    };
  }
  if (f.type === 'awesink') {
    return { label: 'AWESOME 싱크', iconCn: SHARD, ins: [], outs: [], power: 30, cost: {} };
  }
  return { label: '출하 시설', iconCn: null, ins: [], outs: [], power: 0, cost: {} }; // sink
}

/** 단지의 아이템별 총 생산/소비 (100% 기준). virtual=true 면 미건설(0대)도 1대로 가정 */
function cxFlows(cx, virtual) {
  const prod = {}, cons = {};
  for (const f of cx.members) {
    const def = facDef(f);
    const run = virtual ? Math.max(f.count, 1) : f.count;
    for (const p of def.outs) prod[p.item] = (prod[p.item] || 0) + p.rate * run;
    for (const p of def.ins) cons[p.item] = (cons[p.item] || 0) + p.rate * run;
  }
  return { prod, cons };
}

/** 단지 외부 포트: 부족 입력 / 잉여 출력 */
function cxPorts(cx, virtual) {
  const { prod, cons } = cxFlows(cx, virtual);
  const items = new Set([...Object.keys(prod), ...Object.keys(cons)]);
  const ins = [], outs = [];
  for (const cn of items) {
    const net = (prod[cn] || 0) - (cons[cn] || 0);
    if (net < -0.05) ins.push({ item: cn, rate: -net });
    else if (net > 0.05) outs.push({ item: cn, rate: net });
  }
  return { ins, outs };
}

/**
 * 단지가 소비하는 모든 재료 (내부 공급분도 포함 — 합체로 상쇄돼 포트에서 사라지는 것까지 보여주기 위함).
 * 아이템별로 총 소비/내부 생산/외부 필요량을 돌려준다.
 */
function cxNeeds(cx) {
  const { prod, cons } = cxFlows(cx);
  return Object.keys(cons)
    .filter(cn => cons[cn] > 0.05)
    .map(cn => ({
      item: cn,
      cons: cons[cn],
      inner: Math.min(prod[cn] || 0, cons[cn]),
      outer: Math.max(0, cons[cn] - (prod[cn] || 0)),
    }))
    .sort((a, b) => (b.outer - a.outer) || (b.cons - a.cons));
}

const hasSink = cx => cx.members.some(f => f.type === 'sink');
const hasAwesink = cx => cx.members.some(f => f.type === 'awesink');

/** 단지 정체성 (이름·아이콘) */
function cxIdentity(cx) {
  const gen = cx.members.find(f => f.type === 'gen');
  const hasMachine = cx.members.some(f => f.type === 'machine');
  if (gen && !hasMachine) {
    // 순수 발전 단지 (생산 기계 없음)
    const g = GENS[gen.genKey];
    return { name: '⚡ ' + D.xnames[g.build].replace('발전소', '').replace('발전기', '').trim() + ' 발전 단지', icon: g.build, cls: 'power-plant' };
  }
  if (cx.members.length === 1) {
    const def = facDef(cx.members[0]);
    return { name: def.label, icon: def.iconCn, cls: '' };
  }
  const { outs } = cxPorts(cx, true); // 미건설 시설도 1대로 가정해 정체성 부여
  if (outs.length > 0) {
    // 가장 가공도 높은 산출물로 명명 — 자체 발전 포함이면 ⚡ 표시
    const main = outs.sort((a, b) =>
      (itemDepth(b.item) - itemDepth(a.item)) || (b.rate - a.rate))[0].item;
    return { name: (gen ? '⚡ ' : '') + iname(main) + ' 단지', icon: main, cls: gen ? 'power-plant' : '' };
  }
  if (gen) {
    const g = GENS[gen.genKey];
    return { name: '⚡ ' + D.xnames[g.build].replace('발전소', '').replace('발전기', '').trim() + ' 발전 단지', icon: g.build, cls: 'power-plant' };
  }
  if (hasSink(cx) || hasAwesink(cx)) {
    return { name: hasAwesink(cx) ? 'AWESOME 싱크장' : '출하장', icon: hasAwesink(cx) ? SHARD : null, cls: '' };
  }
  const first = cx.members[0];
  return { name: first ? facDef(first).label + ' 외 ' + (cx.members.length - 1) : '단지', icon: first ? facDef(first).iconCn : null, cls: '' };
}

/* ---------- 단지 건물 일러스트 (인라인 SVG, 합체할수록 증축) ---------- */
function cxArch(cx) {
  if (cx.members.some(f => f.type === 'gen')) return 'power';
  if (cx.members.some(f => f.type === 'machine')) return 'factory';
  if (cx.members.some(f => f.type === 'miner')) return 'mine';
  return 'logi';
}
const cxStage = cx => cx.members.length >= 7 ? 4 : cx.members.length >= 4 ? 3 : cx.members.length >= 2 ? 2 : 1;

function buildingSVG(arch, stage) {
  const D = 'var(--b-dark)';
  // 공통 그라데이션 (id 중복은 동일 정의라 무해)
  let s = `<defs>
    <linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5c5340"/><stop offset="1" stop-color="#3a3428"/></linearGradient>
    <linearGradient id="gw2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c4536"/><stop offset="1" stop-color="#2e2920"/></linearGradient>
    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d08542"/><stop offset="1" stop-color="#8f5527"/></linearGradient>
    <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#544c3c"/><stop offset="1" stop-color="#332e23"/></linearGradient>
  </defs>`;
  s += `<rect x="0" y="70" width="240" height="14" fill="${D}"/><rect x="0" y="69" width="240" height="1.5" fill="#463e30"/>`;
  const win = (x, y, w, h) => `<rect x="${x - .8}" y="${y - .8}" width="${w + 1.6}" height="${h + 1.6}" rx="1.5" fill="#241f18"/><rect class="win" x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/>`;
  const smoke = (x, y, d, r) => `<circle class="smoke" cx="${x}" cy="${y}" r="${r || 4}" style="animation-delay:${d}s"/>`;
  const steam = (x, y, d) => `<ellipse class="steam" cx="${x}" cy="${y}" rx="7" ry="5" style="animation-delay:${d}s"/>`;

  if (arch === 'mine') {
    // 광석 더미 + 권양탑(도르래 회전) + 오르막 컨베이어(광석 흐름) + 저장 사일로
    s += `<polygon points="8,70 24,56 42,70" fill="#57606c"/><polygon points="16,70 26,61 36,70" fill="#6b7684"/>`;
    s += `<polygon points="34,70 52,22 58,22 76,70" fill="none" stroke="url(#gr)" stroke-width="4.5"/>`;
    s += `<line x1="41" y1="52" x2="69" y2="52" stroke="#8f5527" stroke-width="2.5"/><line x1="45" y1="38" x2="65" y2="38" stroke="#8f5527" stroke-width="2.5"/>`;
    s += `<g class="wheel"><circle cx="55" cy="20" r="8" fill="none" stroke="#c9bfa8" stroke-width="2.5"/><line x1="55" y1="12.5" x2="55" y2="27.5" stroke="#c9bfa8" stroke-width="2"/><line x1="47.5" y1="20" x2="62.5" y2="20" stroke="#c9bfa8" stroke-width="2"/></g>`;
    s += `<rect x="46" y="48" width="20" height="22" fill="url(#gw2)"/><polygon points="44,48 56,41 68,48" fill="url(#gr)"/>` + win(50, 53, 11, 7);
    // 컨베이어: 낮은 곳(권양탑)에서 사일로로
    s += `<g transform="rotate(-11 76 62)">
      <rect x="74" y="58" width="96" height="5.5" rx="2.5" fill="#211c15" stroke="#463e30" stroke-width="1"/>
      <g class="belt-run">${[0, 24, 48, 72, 96].map(o => `<circle cx="${80 + o}" cy="57" r="3.2" fill="#7d8a99"/>`).join('')}</g>
    </g>`;
    // 사일로 (도착지)
    s += `<rect x="176" y="30" width="30" height="40" rx="3" fill="url(#gw)"/><ellipse cx="191" cy="30" rx="15" ry="5" fill="url(#gr)"/>` + win(184, 44, 13, 8);
    // 증축: 창고 동
    for (let i = 0; i < Math.min(stage - 1, 2); i++) {
      const x = 96 + i * 40, h = 15 + i * 5;
      s += `<rect x="${x}" y="${70 - h}" width="34" height="${h}" fill="url(#gw2)"/><polygon points="${x - 2},${70 - h} ${x + 17},${70 - h - 7} ${x + 36},${70 - h}" fill="url(#gr)"/>` + win(x + 6, 70 - h + 4, 8, 6);
    }
    if (stage >= 4) s += `<rect x="212" y="40" width="20" height="30" rx="2" fill="url(#gw2)"/><ellipse cx="222" cy="40" rx="10" ry="4" fill="url(#gr)"/>`;
  } else if (arch === 'factory') {
    // 톱니지붕 공장 + 회전 톱니바퀴 + 프레스 + 출하 컨베이어
    const bays = Math.min(1 + stage, 5);
    const bw = Math.min(42, 172 / bays);
    for (let i = 0; i < bays; i++) {
      const x = 16 + i * bw;
      s += `<rect x="${x}" y="36" width="${bw}" height="34" fill="url(#${i % 2 ? 'gw' : 'gw2'})"/>`;
      s += `<polygon points="${x},36 ${x},24 ${x + bw * 0.62},36" fill="url(#gr)"/><line x1="${x}" y1="24" x2="${x + bw * 0.62}" y2="36" stroke="#e0a060" stroke-width="1.2"/>`;
      if (i === 0) {
        // 프레스가 보이는 큰 문
        s += `<rect x="${x + 6}" y="46" width="${bw - 12}" height="24" rx="2" fill="#191510"/>`;
        s += `<rect class="forge" x="${x + 8}" y="62" width="${bw - 16}" height="7" rx="1"/>`;
        s += `<rect class="piston" x="${x + bw / 2 - 4}" y="44" width="8" height="12" rx="1" fill="#8a7f6c"/><rect class="piston" x="${x + bw / 2 - 7}" y="54" width="14" height="4" rx="1" fill="#a89a80"/>`;
      } else {
        s += win(x + bw * 0.16, 46, bw * 0.3, 10) + win(x + bw * 0.56, 46, bw * 0.3, 10);
      }
    }
    // 벽면 톱니바퀴
    const gx = 16 + bw * 1.5, gy = 30;
    s += `<g class="gear"><circle cx="${gx}" cy="${gy}" r="7.5" fill="#6b5f4a" stroke="#241f18" stroke-width="1.5"/>${[0, 60, 120].map(a => `<rect x="${gx - 1.6}" y="${gy - 11}" width="3.2" height="22" rx="1" fill="#6b5f4a" transform="rotate(${a} ${gx} ${gy})"/>`).join('')}<circle cx="${gx}" cy="${gy}" r="2.5" fill="#241f18"/></g>`;
    // 굴뚝 + 연기
    for (let i = 0; i < Math.min(stage, 3); i++) {
      const x = 40 + i * 56;
      s += `<rect x="${x}" y="10" width="9" height="26" fill="url(#gt)"/><rect x="${x - 1.5}" y="8" width="12" height="4" rx="1" fill="url(#gr)"/>`;
      s += smoke(x + 4.5, 6, i * 0.7) + smoke(x + 4.5, 6, i * 0.7 + 1.1, 3);
    }
    // 출하 컨베이어 (상자가 흘러나감)
    s += `<rect x="192" y="63" width="44" height="5" rx="2.5" fill="#211c15" stroke="#463e30" stroke-width="1"/>`;
    s += `<g class="crate-run">${[0, 18].map(o => `<g><rect x="${196 + o}" y="55" width="9" height="8" rx="1" fill="url(#gr)" stroke="#241f18" stroke-width="1"/><line x1="${200.5 + o}" y1="55" x2="${200.5 + o}" y2="63" stroke="#241f18" stroke-width="1"/></g>`).join('')}</g>`;
  } else if (arch === 'power') {
    // 냉각탑(증기) + 터빈동(팬 회전) + 송전탑(스파크)
    const towers = Math.min(stage, 3);
    for (let i = 0; i < towers; i++) {
      const x = 22 + i * 46;
      s += `<path d="M ${x} 70 C ${x + 5} 46, ${x + 3} 36, ${x + 9} 24 L ${x + 25} 24 C ${x + 31} 36, ${x + 29} 46, ${x + 34} 70 Z" fill="url(#gt)"/>`;
      s += `<ellipse cx="${x + 17}" cy="24" rx="8" ry="2.5" fill="#241f18"/>`;
      s += steam(x + 17, 18, i * 0.9) + steam(x + 13, 20, i * 0.9 + 1.3);
    }
    // 터빈동
    const bx = 22 + towers * 46 + 6;
    const bwid = Math.max(46, 196 - bx);
    s += `<rect x="${bx}" y="38" width="${bwid}" height="32" rx="2" fill="url(#gw2)"/><polygon points="${bx},38 ${bx},30 ${bx + 34},38" fill="url(#gr)"/>`;
    const fx = bx + bwid / 2, fy = 54;
    s += `<circle cx="${fx}" cy="${fy}" r="10" fill="#191510" stroke="#463e30" stroke-width="1.5"/>`;
    s += `<g class="fan">${[0, 120, 240].map(a => `<path d="M ${fx} ${fy} L ${fx - 2.5} ${fy - 8.5} A 4 4 0 0 1 ${fx + 2.5} ${fy - 8.5} Z" fill="#c9bfa8" transform="rotate(${a} ${fx} ${fy})"/>`).join('')}<circle cx="${fx}" cy="${fy}" r="2" fill="#463e30"/></g>`;
    // 송전탑 + 전선 + 스파크
    s += `<line x1="218" y1="70" x2="218" y2="26" stroke="#8a7f6c" stroke-width="2.5"/><line x1="210" y1="34" x2="226" y2="34" stroke="#8a7f6c" stroke-width="2"/><line x1="212" y1="28" x2="224" y2="28" stroke="#8a7f6c" stroke-width="2"/>`;
    s += `<path d="M ${bx + 30} 36 Q ${(bx + 30 + 218) / 2} 46, 218 30" fill="none" stroke="#5d5443" stroke-width="1.5"/>`;
    s += `<circle class="sparkdot" cx="0" cy="0" r="2.2" fill="#fad56e"><animateMotion dur="1.6s" repeatCount="indefinite" path="M ${bx + 30} 36 Q ${(bx + 30 + 218) / 2} 46, 218 30"/></circle>`;
    s += `<polygon class="bolt" points="230,10 222,26 227,26 220,40 233,22 227,22 234,10" fill="var(--accent)"/>`;
  } else {
    // 물류 창고 + 갠트리 크레인(왕복) + 경광등 + 화물
    const ww = Math.min(96 + stage * 12, 132);
    s += `<rect x="20" y="36" width="${ww}" height="34" rx="2" fill="url(#gw)"/>`;
    s += `<polygon points="14,36 ${20 + ww / 2},16 ${26 + ww},36" fill="url(#gr)"/><line x1="14" y1="36" x2="${20 + ww / 2}" y2="16" stroke="#e0a060" stroke-width="1.2"/>`;
    s += `<rect x="${20 + ww / 2 - 17}" y="46" width="34" height="24" rx="2" fill="#191510"/>${[0, 1, 2].map(i => `<rect x="${20 + ww / 2 - 15}" y="${49 + i * 7}" width="30" height="2.5" rx="1" fill="#3a3428"/>`).join('')}`;
    s += win(28, 44, 12, 8);
    s += `<circle class="beacon" cx="${20 + ww / 2}" cy="13" r="2.6"/>`;
    // 크레인 레일 + 트롤리
    const rx0 = 20 + ww + 8;
    s += `<line x1="${rx0}" y1="26" x2="234" y2="26" stroke="#8a7f6c" stroke-width="2.5"/><line x1="${rx0 + 2}" y1="70" x2="${rx0 + 2}" y2="26" stroke="#8a7f6c" stroke-width="2.5"/><line x1="232" y1="70" x2="232" y2="26" stroke="#8a7f6c" stroke-width="2.5"/>`;
    s += `<g class="crane"><rect x="${rx0 + 8}" y="24" width="14" height="6" rx="1" fill="url(#gr)"/><line x1="${rx0 + 15}" y1="30" x2="${rx0 + 15}" y2="44" stroke="#c9bfa8" stroke-width="1.5"/><rect x="${rx0 + 10}" y="44" width="10" height="9" rx="1" fill="url(#gw)" stroke="#241f18" stroke-width="1"/></g>`;
    // 쌓인 화물
    for (let i = 0; i < Math.min(stage * 2, 6); i++) {
      const x = rx0 + 6 + (i % 3) * 16, y = 62 - Math.floor(i / 3) * 10;
      s += `<rect x="${x}" y="${y}" width="13" height="8" rx="1" fill="url(#${i % 2 ? 'gw' : 'gw2'})" stroke="#241f18" stroke-width="1"/>`;
    }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 240 84');
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  svg.innerHTML = s;
  return svg;
}

const lastMemberCount = {}; // 합체 시 증축 애니메이션 감지 (런타임)

/* ---------- 시뮬레이션 ---------- */
let lastRates = {};
let lastPower = { supply: BASE_POWER, demand: 0, eff: 1 };
let lastEdgeFlow = {};

// 기계 처리 순서용 아이템 깊이 (원자재 0)
const depthMemo = {};
function itemDepth(item, path) {
  if (D.raw.includes(item)) return 0;
  if (item in depthMemo) return depthMemo[item];
  path = path || new Set();
  if (path.has(item)) return 0;
  const r = (D.recipes.find(x => !x.alt && x.out[0][0] === item)) || D.recipes.find(x => x.out.some(o => o[0] === item));
  if (!r) return 0;
  path.add(item);
  const d = 1 + Math.max(0, ...r.in.map(([ing]) => itemDepth(ing, path)));
  path.delete(item);
  depthMemo[item] = d;
  return d;
}

const poolCap = cx => 100 * Math.max(2, cx.members.length) * (1 + 0.5 * rlv('store'));
const fbufCap = f => 100 * Math.max(1, f.count) * (1 + 0.5 * rlv('store'));
const facById = (cx, fid) => cx.members.find(m => m.id === fid);
const hasInI = (cx, fid, item) => cx.iedges.some(e => e.to.f === fid && e.to.item === item);
const hasOutI = (cx, fid, item) => cx.iedges.some(e => e.from.f === fid && e.from.item === item);
const cx0ConsumesInbox = (cx, item) => cx.iedges.some(e => e.from.f === 'in' && e.from.item === item);
let lastIFlow = {}; // 내부 연결선 흐름량 (표시용)

/** 내부 자동 배치: 깊이순 열 정렬 (채굴기 왼쪽 → 완제품 오른쪽) */
function autoLayoutCx(cx) {
  const depthOfFac = f => {
    if (f.type === 'miner') return 0;
    if (f.type === 'gen') return 1;
    if (f.type === 'machine') return Math.max(1, itemDepth(recipeById[f.recipeId].out[0][0]));
    return 90; // sink류는 맨 오른쪽
  };
  const colY = {};
  for (const f of [...cx.members].sort((a, b) => depthOfFac(a) - depthOfFac(b))) {
    const d = Math.min(depthOfFac(f), 6);
    colY[d] = (colY[d] ?? 0) + 1;
    f.ix = 165 + d * 205;
    f.iy = 40 + (colY[d] - 1) * 135;
  }
}

/** 처리량에 맞는 최소 벨트 티어 (자동 배선은 목 조르지 않게 무료로 맞춰 준다) */
function tierForRate(rate) {
  const mult = 1 + 0.2 * rlv('belt');
  for (let t = 1; t <= 5; t++) if (BELT_TIERS[t].cap * mult >= rate - 1e-6) return t;
  return 5;
}
/** 이 연결이 감당해야 할 분당 처리량 추정 */
function iedgeRate(cx, e) {
  const item = e.from.item;
  if (e.from.f === 'in') {
    const c = facById(cx, e.to.f);
    if (!c) return 60;
    const p = facDef(c).ins.find(x => x.item === item);
    return p ? p.rate * Math.max(1, c.count) : 60;
  }
  const f = facById(cx, e.from.f);
  if (!f) return 60;
  const p = facDef(f).outs.find(x => x.item === item);
  return p ? p.rate * Math.max(1, f.count) : 60;
}

/** 빠진 배선을 아이템 매칭으로 채움 (합체·마이그레이션·설비등록의 자동 배선) */
function ensureWired(cx) {
  cx.iedges ??= [];
  const addI = (fromF, toF, item) => {
    if (cx.iedges.some(e => e.from.f === fromF && e.from.item === item && e.to.f === toF)) return;
    const e = { id: state.seq++, from: { f: fromF, item }, to: { f: toF, item } };
    e.tier = tierForRate(iedgeRate(cx, e)); // 자동 배선은 처리량에 맞는 티어로
    cx.iedges.push(e);
  };
  const producersOfItem = item => cx.members.filter(m => facDef(m).outs.some(o => o.item === item));
  const consumersOfItem = item => cx.members.filter(m => facDef(m).ins.some(o => o.item === item));
  // 1) 모든 소비 입력: 내부 생산자 → 없으면 반입구에서
  for (const f of cx.members) {
    for (const p of facDef(f).ins) {
      if (hasInI(cx, f.id, p.item)) continue;
      const prods = producersOfItem(p.item).filter(m => m.id !== f.id);
      if (prods.length) for (const pr of prods) addI(pr.id, f.id, p.item);
      else addI('in', f.id, p.item);
    }
  }
  // 2) 모든 생산 출력: 소비처 없으면 출하/싱크 → 그것도 없으면 반출구
  const sink = cx.members.find(m => m.type === 'sink');
  const awe = cx.members.find(m => m.type === 'awesink');
  for (const f of cx.members) {
    for (const p of facDef(f).outs) {
      if (hasOutI(cx, f.id, p.item)) continue;
      const cons = consumersOfItem(p.item).filter(m => m.id !== f.id);
      if (cons.length) { for (const cf of cons) addI(f.id, cf.id, p.item); continue; }
      if (sink) { addI(f.id, sink.id, p.item); continue; }
      if (awe && ptsOf(p.item) > 0) { addI(f.id, awe.id, p.item); continue; }
      addI(f.id, 'out', p.item);
    }
    // 잉여도 흘러나가도록: 소비처가 있어도 출하 연결을 하나 추가 (기계행 우선 배분이라 잉여만 나감)
    for (const p of facDef(f).outs) {
      const drainTo = sink ? sink.id : (awe && ptsOf(p.item) > 0 ? awe.id : null);
      if (drainTo != null && !cx.iedges.some(e => e.from.f === f.id && e.from.item === p.item
        && (e.to.f === drainTo || e.to.f === 'out'))) {
        addI(f.id, drainTo, p.item);
      }
    }
  }
  // 3) 좌표 없는 시설 배치
  if (cx.members.some(f => f.ix == null)) autoLayoutCx(cx);
}

/** 구 저장(공유 저장고 방식) → 배선 방식 마이그레이션 */
function migrateToWiring(s) {
  for (const cx of s.cx) {
    cx.iedges ??= [];
    cx.inbox ??= (cx.pool || {});
    cx.outbox ??= {};
    delete cx.pool;
    for (const f of cx.members) f.buf ??= { in: {}, out: {} };
  }
  return s;
}

function tick(dtMin) {
  const prev = { ...state.stock };

  // 1) 발전 (연료는 시설 입력 버퍼에서 — 내부 배선으로 공급)
  let supply = BASE_POWER;
  for (const cx of state.cx) {
    for (const f of cx.members) {
      if (f.type !== 'gen') continue;
      if (f.count <= 0) { f.eff = 0; f.why = '기계 없음'; continue; }
      const g = GENS[f.genKey];
      const cap = fbufCap(f);
      let frac = 1, limit = null, limitKind = null;
      for (const [cn, rate] of g.burns) {
        const need = rate * f.count * dtMin;
        if (need > 0) {
          const v = (f.buf.in[cn] || 0) / need;
          if (v < frac) { frac = v; limit = cn; limitKind = 'in'; }
        }
      }
      for (const [cn, rate] of (g.wastes || [])) {
        const need = rate * f.count * dtMin;
        if (need > 0) {
          const v = Math.max(0, cap - (f.buf.out[cn] || 0)) / need;
          if (v < frac) { frac = v; limit = cn; limitKind = 'out'; }
        }
      }
      frac = Math.min(1, Math.max(0, frac));
      for (const [cn, rate] of g.burns) f.buf.in[cn] = Math.max(0, (f.buf.in[cn] || 0) - rate * f.count * dtMin * frac);
      for (const [cn, rate] of (g.wastes || [])) f.buf.out[cn] = (f.buf.out[cn] || 0) + rate * f.count * dtMin * frac;
      supply += genPowerOf(g) * f.count * frac;
      f.eff = frac;
      f.why = frac >= 0.99 || !limit ? null
        : limitKind === 'in'
          ? (hasInI(cx, f.id, limit) ? `연료 부족: ${iname(limit)}` : `연료 미연결: ${iname(limit)} — 내부에서 포트를 연결하세요`)
          : (hasOutI(cx, f.id, limit) ? `폐기물 정체: ${iname(limit)}` : `폐기물 미연결: ${iname(limit)} — 처리 라인을 연결하세요`);
      const bound = limit && frac < 0.999;
      f.lack = bound && limitKind === 'in' ? limit : null;
      f.jam = bound && limitKind === 'out' ? limit : null;
    }
  }

  // 2) 수요·전력 효율
  let demand = 0;
  for (const cx of state.cx) for (const f of cx.members) demand += facDef(f).power * Math.max(f.count, f.type === 'awesink' || f.type === 'sink' ? 1 : 0);
  const powerEff = demand > 0 ? Math.min(1, supply / demand) : 1;

  // 3) 단지 간 벨트 이동 (반출구 상자 → 상대 단지 반입구 상자)
  lastEdgeFlow = {};
  const groups = {};
  for (const e of state.edges) (groups[e.from.cx + '|' + e.from.item] ??= []).push(e);
  for (const [key, edges] of Object.entries(groups)) {
    const [fromId, item] = key.split('|');
    const from = cxById(+fromId);
    if (!from) continue;
    const avail = from.outbox[item] || 0;
    if (avail <= 0) continue;
    const share = avail / edges.length;
    for (const e of edges) {
      const dst = cxById(e.to.cx);
      if (!dst) continue;
      const space = poolCap(dst) - (dst.inbox[item] || 0);
      const moved = Math.min(share, beltCap(e) * dtMin, Math.max(0, space));
      dst.inbox[item] = (dst.inbox[item] || 0) + moved;
      from.outbox[item] -= moved;
      lastEdgeFlow[e.id] = moved / dtMin;
      // 도착 품목을 소비할 내부 배선이 없고 출하 시설이 있으면 자동으로 연결
      if (moved > 0 && !cx0ConsumesInbox(dst, item)) {
        const sk = dst.members.find(m => m.type === 'sink' || (m.type === 'awesink' && ptsOf(item) > 0));
        if (sk) dst.iedges.push({ id: state.seq++, from: { f: 'in', item }, to: { f: sk.id, item } });
      }
    }
  }

  // 4) 내부 배선 이동 — 기계행 우선, 남는 것은 출하/싱크/반출구로
  lastIFlow = {};
  for (const cx of state.cx) {
    cx.ptsRate = 0;
    const igroups = {};
    for (const e of cx.iedges) (igroups[e.from.f + '|' + e.from.item] ??= []).push(e);
    for (const [key, edges] of Object.entries(igroups)) {
      const [fromKey, item] = key.split('|');
      const srcFac = fromKey === 'in' ? null : facById(cx, +fromKey);
      const avail = fromKey === 'in' ? (cx.inbox[item] || 0) : (srcFac ? (srcFac.buf.out[item] || 0) : 0);
      if (avail <= 0) continue;
      const isDrain = e => e.to.f === 'out'
        || (facById(cx, e.to.f) && ['sink', 'awesink'].includes(facById(cx, e.to.f).type));
      const primary = edges.filter(e => !isDrain(e));
      const drains = edges.filter(isDrain);
      let remaining = avail;
      const moveTo = (e, budget) => {
        let moved = 0;
        const cap = beltCap(e) * dtMin;
        if (e.to.f === 'out') {
          const space = poolCap(cx) - (cx.outbox[item] || 0);
          moved = Math.min(budget, cap, Math.max(0, space));
          cx.outbox[item] = (cx.outbox[item] || 0) + moved;
        } else {
          const dst = facById(cx, e.to.f);
          if (!dst) return 0;
          if (dst.type === 'sink') {
            moved = Math.min(budget, cap);
            addStock(item, moved);
          } else if (dst.type === 'awesink') {
            if (ptsOf(item) > 0) {
              moved = Math.min(budget, cap);
              state.sinkPts += moved * ptsOf(item);
              cx.ptsRate = (cx.ptsRate || 0) + moved * ptsOf(item) / dtMin;
            }
          } else {
            const space = fbufCap(dst) - (dst.buf.in[item] || 0);
            moved = Math.min(budget, cap, Math.max(0, space));
            dst.buf.in[item] = (dst.buf.in[item] || 0) + moved;
          }
        }
        lastIFlow[e.id] = (lastIFlow[e.id] || 0) + moved / dtMin;
        return moved;
      };
      if (primary.length) {
        const share = remaining / primary.length;
        for (const e of primary) remaining -= moveTo(e, share);
      }
      if (drains.length && remaining > 1e-9) {
        const share = remaining / drains.length;
        for (const e of drains) remaining -= moveTo(e, share);
      }
      const used = avail - remaining;
      if (fromKey === 'in') cx.inbox[item] = Math.max(0, (cx.inbox[item] || 0) - used);
      else if (srcFac) srcFac.buf.out[item] = Math.max(0, (srcFac.buf.out[item] || 0) - used);
    }
  }

  // 5) 시설 가동 (자기 버퍼 기준 — 배선이 없으면 굶거나 막힌다)
  for (const cx of state.cx) {
    cx.ptsRate = cx.ptsRate || 0;
    for (const f of cx.members) {
      if (f.type === 'miner' || f.type === 'machine') f.lack = f.jam = null;
    }
    for (const f of cx.members) {
      if (f.type === 'miner') {
        if (f.count <= 0) { f.eff = 0; f.why = '기계 없음'; continue; }
        const def = facDef(f);
        const out = def.outs[0];
        const cap = fbufCap(f);
        const want = out.rate * f.count * powerEff * dtMin;
        const space = Math.max(0, cap - (f.buf.out[out.item] || 0));
        const make = Math.min(want, space);
        f.buf.out[out.item] = (f.buf.out[out.item] || 0) + make;
        f.eff = want > 0 ? powerEff * (make / want) : 0;
        f.why = f.eff >= 0.99 ? null
          : space < want
            ? (hasOutI(cx, f.id, out.item) ? `출력 정체: ${iname(out.item)}` : `출력 미연결: ${iname(out.item)} — 내부에서 포트를 연결하세요`)
            : powerEff < 0.99 ? '전력 부족' : null;
        f.jam = space < want ? out.item : null;
      } else if (f.type === 'machine') {
        if (f.count <= 0) { f.eff = 0; f.why = '기계 없음'; continue; }
        const def = facDef(f);
        const run = f.count * powerEff;
        if (run <= 0) { f.eff = 0; f.why = '전력 부족'; continue; }
        const cap = fbufCap(f);
        let frac = 1, limit = null, limitKind = null;
        for (const p of def.ins) {
          const need = p.rate * run * dtMin;
          if (need > 0) {
            const v = (f.buf.in[p.item] || 0) / need;
            if (v < frac) { frac = v; limit = p.item; limitKind = 'in'; }
          }
        }
        for (const p of def.outs) {
          const make = p.rate * run * dtMin;
          if (make > 0) {
            const v = Math.max(0, cap - (f.buf.out[p.item] || 0)) / make;
            if (v < frac) { frac = v; limit = p.item; limitKind = 'out'; }
          }
        }
        frac = Math.min(1, Math.max(0, frac));
        for (const p of def.ins) f.buf.in[p.item] = Math.max(0, (f.buf.in[p.item] || 0) - p.rate * run * dtMin * frac);
        for (const p of def.outs) f.buf.out[p.item] = (f.buf.out[p.item] || 0) + p.rate * run * dtMin * frac;
        f.eff = powerEff * frac;
        f.why = f.eff >= 0.99 ? null
          : limit && frac < powerEff
            ? (limitKind === 'in'
              ? (hasInI(cx, f.id, limit) ? `재료 부족: ${iname(limit)}` : `입력 미연결: ${iname(limit)} — 내부에서 포트를 연결하세요`)
              : (hasOutI(cx, f.id, limit) ? `출력 정체: ${iname(limit)}` : `출력 미연결: ${iname(limit)} — 내부에서 포트를 연결하세요`))
            : powerEff < 0.99 ? '전력 부족' : null;
        const bound = limit && frac < 0.999;
        f.lack = bound && limitKind === 'in' ? limit : null;
        f.jam = bound && limitKind === 'out' ? limit : null;
      }
    }
  }

  // 계약 기한 (게임 시간 기준 — 배속에 같이 흐름)
  if (Array.isArray(state.contracts)) {
    let expired = false;
    for (const c of state.contracts) c.left -= dtMin;
    state.contracts = state.contracts.filter(c => {
      if (c.left > 0) return true;
      expired = true;
      return false;
    });
    if (expired) {
      ensureContracts();
      showBanner('⌛ 기한이 지난 계약이 회수되고 새 계약이 게시되었습니다.', 4000);
      contractsDirty = true;
    }
  }

  let printed = 0;
  while (state.sinkPts >= couponCost(state.couponsPrinted)) {
    state.sinkPts -= couponCost(state.couponsPrinted);
    state.couponsPrinted++;
    state.coupons++;
    printed++;
  }
  if (printed > 0) sfx('coupon'); // 고배속에서 연타 방지: 틱당 1회만

  const keys = new Set([...Object.keys(prev), ...Object.keys(state.stock)]);
  lastRates = {};
  for (const cn of keys) lastRates[cn] = ((state.stock[cn] || 0) - (prev[cn] || 0)) / dtMin;
  lastPower = { supply, demand, eff: powerEff };
}

/* ---------- 효과음 ---------- */
let audioCtx = null;
function beep(freq, dur, delay, type, vol) {
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.12, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0 + dur);
}
function sfx(name) {
  if (!state || state.muted || !audioCtx) return;
  try {
    if (name === 'milestone') { beep(523, .18, 0); beep(659, .18, .1); beep(784, .3, .2); }
    else if (name === 'coupon') { beep(880, .1, 0, 'triangle'); beep(1175, .18, .08, 'triangle'); }
    else if (name === 'unlock') { beep(659, .12, 0); beep(880, .25, .09); }
    else if (name === 'merge') { beep(392, .1, 0, 'square', .07); beep(523, .16, .07, 'square', .07); }
    else if (name === 'upgrade') { beep(660, .09, 0, 'square', .06); beep(990, .13, .08, 'square', .06); }
    else if (name === 'won') { [523, 659, 784, 1047, 1319].forEach((f, i) => beep(f, .35, i * .13)); }
  } catch (e) { /* 무시 */ }
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
  img.src = '../game/icons/' + cn + '.png';
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
    makeCraftLink(chip, cn);
    box.append(chip);
    return { chip, val, cn, n };
  });
  const refresh = () => {
    for (const c of chips) {
      const have = stockOf(c.cn);
      c.val.textContent = `${fmtN(have)}/${c.n}`;
      c.chip.classList.toggle('ok', have >= c.n);
      c.chip.classList.toggle('no', have < c.n);
    }
  };
  return { box, refresh };
}

function showBanner(text, autohide) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  if (autohide) setTimeout(() => { b.hidden = true; }, autohide);
}

/* --- 마일스톤 --- */
function buildMilestone() {
  const box = $('milestone-body');
  box.textContent = '';
  if (state.ms >= MS.length) {
    box.append(el('div', 'ms-done', '모든 마일스톤 달성! 자유롭게 확장하세요.'));
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
    makeCraftLink(label, cn);
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
    sfx(state.won ? 'won' : 'milestone');
    if (state.won) showBanner('🎉 프로젝트 조립 완료! FICSIT이 매우 만족했습니다.');
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
    if (!r) { box.append(el('div', 'hint', '목록에서 레시피를 클릭해 선택하세요.')); reqRefresh = null; return; }
    const need = el('div');
    need.append(el('span', 'hint', '재료  '));
    const chips = chipRow(Object.fromEntries(r.in));
    need.append(chips.box);
    box.append(need);
    const out = el('div', 'hint', '→ 산출: ');
    for (const [cn, amt] of r.out) out.append(iconEl(cn, 's'), ` ${iname(cn)} ×${amt}  `);
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
        row.addEventListener('click', () => { handSelected = r.id; $('hand-info').textContent = ''; renderList(); renderReq(); });
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
    $('hand-info').textContent = made > 0 ? `${out} 제작 완료`
      : `재료 부족: ${r.in.map(([cn, amt]) => `${iname(cn)}×${amt}`).join(', ')} 필요`;
    update();
  };
  $('hand-craft-1').onclick = () => craft(1);
  $('hand-craft-10').onclick = () => craft(10);
}

function makeCraftLink(elem, cn) {
  if (!HAND_RECIPES.some(x => x.out.some(o => o[0] === cn))) return;
  elem.classList.add('craft');
  elem.title = `${iname(cn)} — 클릭하면 수동 제작에서 선택됩니다`;
  elem.addEventListener('click', () => {
    const r = HAND_RECIPES.find(x => x.out[0][0] === cn) || HAND_RECIPES.find(x => x.out.some(o => o[0] === cn));
    if (!r) return;
    handSelected = r.id;
    $('hand-search').value = '';
    rebuild();
    $('hand-list').querySelector('.hand-item.sel')?.scrollIntoView({ block: 'center' });
  });
}

/* --- 상점 --- */
function buildShop() {
  const panel = $('shop-panel');
  const show = state.ms >= 2;
  panel.hidden = !show;
  if (!show) return;
  const box = $('shop-body');
  box.textContent = '';
  const coupons = el('div', 'shop-coupons');
  const prog = el('div', 'hint');
  const bar = el('div', 'ms-bar');
  const fill = el('div');
  bar.append(fill);
  box.append(coupons, prog, bar);
  const shardBtn = el('button');
  shardBtn.append(iconEl(SHARD, 's'), ' 동력 조각 ×1 — 🎟 3');
  shardBtn.addEventListener('click', () => {
    if (state.coupons < 3) return;
    state.coupons -= 3; addStock(SHARD, 1); update(); save();
  });
  const hdBtn = el('button', null, '💾 하드 드라이브 (대체 레시피 택1) — 🎟 5');
  hdBtn.addEventListener('click', () => {
    if (state.coupons < 5 || lockedAlts().length === 0) return;
    state.coupons -= 5; save(); openAltChoice();
  });
  const wrapB = el('div', 'btn-wrap');
  wrapB.append(shardBtn, hdBtn);
  box.append(wrapB);
  box.append(el('div', 'hint', 'AWESOME 싱크 시설이 있는 단지는 잉여 아이템을 소각해 포인트를 얻습니다.'));
  onUpdate(() => {
    coupons.textContent = `🎟 쿠폰 ${state.coupons}장`;
    const cost = couponCost(state.couponsPrinted);
    prog.textContent = `다음 쿠폰: ${fmtN(state.sinkPts)} / ${cost.toLocaleString()} P`;
    fill.style.width = Math.min(100, state.sinkPts / cost * 100) + '%';
    shardBtn.disabled = state.coupons < 3;
    hdBtn.disabled = state.coupons < 5 || lockedAlts().length === 0;
  });
}

function openAltChoice() {
  const pool = [...lockedAlts()];
  const picks = [];
  while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const overlay = el('div', 'alt-overlay');
  const card = el('div', 'alt-card');
  card.append(el('h3', null, '💾 하드 드라이브 분석 완료 — 해금할 레시피를 선택하세요'));
  for (const r of picks) {
    const b = el('button', 'alt-choice');
    const name = el('div', 'alt-name');
    name.append(iconEl(r.out[0][0], 's'), ` ★ ${r.ko} `, el('span', 'hint', `[${mname(r.machine)}]`));
    const io = r.in.map(([cn, amt]) => `${iname(cn)} ${perMin(r, amt)}`).join(' + ')
      + ' → ' + r.out.map(([cn, amt]) => `${iname(cn)} ${perMin(r, amt)}`).join(' + ');
    b.append(name, el('div', 'alt-io', io + ' /분·대'));
    b.addEventListener('click', () => {
      state.altUnlocked.push(r.id);
      overlay.remove();
      sfx('unlock');
      save();
      rebuild();
      showBanner(`★ ${r.ko} 레시피 해금!`, 4000);
    });
    card.append(b);
  }
  overlay.append(card);
  document.body.append(overlay);
}

/* --- 납품 계약 --- */
let contractsDirty = false; // 만료 등으로 패널 재구성 필요

let ctPoolCache = { sig: '', items: [] };
/** 현재 해금 상태에서 원자재까지 전부 생산 가능한 품목만 (이행 불가 계약 방지) */
function contractPool() {
  const sig = [state.ms, state.machines.length, state.altUnlocked.length, state.raws.length].join('|');
  if (ctPoolCache.sig === sig) return ctPoolCache.items;
  const items = Object.keys(D.items).filter(cn => {
    if (ptsOf(cn) <= 0 || !planPick(cn)) return false;
    const plan = computePlan(cn, 1);
    if (!plan.recipes.length || Object.keys(plan.external).length) return false;
    return Object.keys(plan.raws).every(rw => state.raws.includes(rw));
  });
  ctPoolCache = { sig, items };
  return items;
}

function genContract() {
  const pool = contractPool();
  const maxItems = state.ms >= 5 ? 3 : 2;
  const n = Math.min(1 + Math.floor(Math.random() * maxItems), Math.max(1, pool.length));
  const items = [];
  const chosen = new Set();
  let guard = 0;
  while (items.length < n && guard++ < 60) {
    const cn = pool[Math.floor(Math.random() * pool.length)];
    if (chosen.has(cn)) continue;
    chosen.add(cn);
    const r = planPick(cn);
    const opm = perMin(r, r.out.find(o => o[0] === cn)[1]);
    // 기계 1대 기준 3~8분 분량, 상한 500
    const qty = Math.min(500, Math.max(10, Math.round(opm * (3 + Math.random() * 5) / 5) * 5));
    items.push({ item: cn, qty, delivered: 0 });
  }
  const depth = Math.max(1, ...items.map(i => itemDepth(i.item)));
  const reward = {
    coupons: Math.round((2 + items.length * 2 + depth * 1.5) * (1 + 0.25 * rlv('reward'))),
  };
  const roll = Math.random();
  if (roll < 0.18) reward.shards = 1 + Math.floor(Math.random() * 2);
  else if (roll < 0.32) {
    const ores = state.raws.filter(cn => DEPOSITS[cn]);
    if (ores.length) {
      const res = ores[Math.floor(Math.random() * ores.length)];
      const ps = Object.keys(DEPOSITS[res]);
      reward.deposit = { res, purity: ps[Math.floor(Math.random() * ps.length)] };
    }
  }
  const time = 25 + items.length * 10;
  return { id: state.seq++, items, total: time, left: time, reward };
}

function contractSlots() { return 3 + rlv('slot'); }
function ensureContracts() {
  if (state.ms < 1) return;
  while (state.contracts.length < contractSlots()) state.contracts.push(genContract());
}

function rewardText(rw) {
  let s = `🎟 쿠폰 ${rw.coupons}장`;
  if (rw.shards) s += ` + 동력 조각 ${rw.shards}`;
  if (rw.deposit) s += ` + 탐사권(새 매장지)`;
  return s;
}

function deliverContract(id) {
  const c = state.contracts.find(x => x.id === id);
  if (!c) return;
  let moved = 0;
  for (const it of c.items) {
    const take = Math.min(stockOf(it.item), it.qty - it.delivered);
    if (take > 0) { addStock(it.item, -take); it.delivered += take; moved += take; }
  }
  if (c.items.every(it => it.delivered >= it.qty - 1e-9)) {
    state.coupons += c.reward.coupons;
    if (c.reward.shards) addStock(SHARD, c.reward.shards);
    let extra = '';
    if (c.reward.deposit) {
      const { res, purity } = c.reward.deposit;
      state.bonusDeposits[res] ??= {};
      state.bonusDeposits[res][purity] = (state.bonusDeposits[res][purity] || 0) + 1;
      extra = ` · 🗺 새 매장지 발견: ${iname(res)} (${PURITY[purity].ko}) +1`;
    }
    state.contracts = state.contracts.filter(x => x.id !== id);
    ensureContracts();
    sfx('milestone');
    showBanner(`📦 계약 납품 완료! ${rewardText(c.reward)}${extra}`, 5000);
    save();
    rebuild();
  } else if (moved > 0) {
    save();
    update();
  }
}

function abandonContract(id) {
  state.contracts = state.contracts.filter(x => x.id !== id);
  ensureContracts();
  save();
  rebuild();
}

function buildContracts() {
  const panel = $('contract-panel');
  const show = state.ms >= 1;
  panel.hidden = !show;
  if (!show) return;
  ensureContracts();
  contractsDirty = false;
  const box = $('contract-body');
  box.textContent = '';
  for (const c of state.contracts) {
    const row = el('div', 'contract');
    row.append(el('div', 'ct-reward', rewardText(c.reward)));
    const chipsBox = el('div', 'chips');
    const chips = c.items.map(it => {
      const chip = el('span', 'need');
      const val = el('b');
      chip.append(iconEl(it.item, 's'), el('span', null, iname(it.item)), val);
      makeCraftLink(chip, it.item);
      chipsBox.append(chip);
      return { it, chip, val };
    });
    row.append(chipsBox);
    const bar = el('div', 'ms-bar');
    const fill = el('div');
    bar.append(fill);
    const timeTxt = el('div', 'hint');
    row.append(bar, timeTxt);
    const btns = el('div', 'btn-wrap');
    const dv = el('button', 'mini', '납품');
    dv.addEventListener('click', () => deliverContract(c.id));
    const ab = el('button', 'mini ghost danger', '포기 ↻');
    ab.title = '계약을 버리고 새 계약을 받습니다';
    ab.addEventListener('click', () => abandonContract(c.id));
    btns.append(dv, ab);
    row.append(btns);
    box.append(row);
    onUpdate(() => {
      for (const { it, chip, val } of chips) {
        val.textContent = `${fmtN(it.delivered)}/${it.qty}`;
        const done = it.delivered >= it.qty - 1e-9;
        chip.classList.toggle('ok', done);
        chip.classList.toggle('no', !done && stockOf(it.item) < 1);
        chip.title = `${iname(it.item)} — 재고 ${fmtN(stockOf(it.item))}` + (chip.classList.contains('craft') ? ' · 클릭: 수동 제작' : '');
      }
      fill.style.width = Math.max(0, Math.min(100, c.left / c.total * 100)) + '%';
      timeTxt.textContent = `남은 시간 ${fmtN(Math.max(0, c.left))}분 (게임 시간)`;
      dv.disabled = !c.items.some(it => it.delivered < it.qty && stockOf(it.item) >= 1);
    });
  }
  onUpdate(() => { if (contractsDirty) { rebuild(); } });
}

/* --- 연구 --- */
function buildResearch() {
  const panel = $('research-panel');
  const show = state.ms >= 2;
  panel.hidden = !show;
  if (!show) return;
  const box = $('research-body');
  box.textContent = '';
  for (const [key, def] of Object.entries(RESEARCH)) {
    const row = el('div', 'research-row');
    const grow = el('div', 'grow');
    const name = el('div', 'r-name');
    const desc = el('div', 'hint');
    grow.append(name, desc);
    const btn = el('button', 'mini');
    btn.addEventListener('click', () => {
      const cost = researchCost(key);
      if (rlv(key) >= def.max || state.coupons < cost) return;
      state.coupons -= cost;
      state.research[key] = rlv(key) + 1;
      sfx('unlock');
      save();
      rebuild();
    });
    row.append(grow, btn);
    box.append(row);
    onUpdate(() => {
      const lv = rlv(key);
      name.textContent = `${def.name}  ${lv}/${def.max}`;
      desc.textContent = lv >= def.max
        ? '최대 — ' + def.fx(lv)
        : (lv > 0 ? `현재 ${def.fx(lv)} → ` : '') + `다음: ${def.fx(lv + 1)}`;
      btn.textContent = lv >= def.max ? '완료' : `🎟 ${researchCost(key)}`;
      btn.disabled = lv >= def.max || state.coupons < researchCost(key);
    });
  }
}

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
    makeCraftLink(nameTd, cn);
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

/* ---------- 계획 모드: 목표 → 완성 단지 자동 생성 ---------- */
const producersOf = {};
for (const r of D.recipes) for (const [cn] of r.out) (producersOf[cn] ??= []).push(r);
for (const [cn, list] of Object.entries(producersOf)) {
  const nm = D.items[cn].n;
  const score = r => (r.alt ? 4 : 0) + (r.out[0][0] !== cn ? 2 : 0) + (r.name !== nm ? 1 : 0);
  list.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
function planPick(item) {
  return (producersOf[item] || []).find(r =>
    state.machines.includes(r.machine) && (!r.alt || state.altUnlocked.includes(r.id))) || null;
}
function computePlanMulti(demands) {
  const recipes = new Map();
  const raws = {};
  const external = {};
  const expand = (item, need, path) => {
    if (D.raw.includes(item)) { raws[item] = (raws[item] || 0) + need; return; }
    const r = planPick(item);
    if (!r || path.has(item)) { external[item] = (external[item] || 0) + need; return; }
    const outPerMin = perMin(r, r.out.find(o => o[0] === item)[1]);
    const m = need / outPerMin;
    const e = recipes.get(r.id) || { recipe: r, machines: 0 };
    e.machines += m;
    recipes.set(r.id, e);
    const next = new Set(path);
    next.add(item);
    for (const [ing, amt] of r.in) expand(ing, m * perMin(r, amt), next);
  };
  for (const [item, rate] of demands) expand(item, rate, new Set());
  return { recipes: [...recipes.values()], raws, external };
}
const computePlan = (target, rate) => computePlanMulti([[target, rate]]);
const bestMinerTier = () => [3, 2, 1].find(minerTierUnlocked);

/** 계획의 전력 수요 (기계 + 채굴기, 100% 클럭) */
function planPower(plan) {
  let p = 0;
  for (const { recipe, machines } of plan.recipes) p += linePower(recipe) * machines;
  const tier = bestMinerTier();
  for (const [cn, r8] of Object.entries(plan.raws)) {
    const def = EXT[cn] || MINERS[tier];
    p += def.power * (r8 / def.rate);
  }
  return p;
}

/** 목표 + 자체 발전(연료 체인 포함, 반복 수렴) 통합 계획 */
function computeFullPlan(target, rate, genKey) {
  let plan = computePlan(target, rate);
  if (!genKey) return { ...plan, gens: 0, genKey: null, power: planPower(plan) };
  const g = GENS[genKey];
  let gens = 0;
  for (let i = 0; i < 4; i++) {
    gens = Math.max(1, Math.ceil(planPower(plan) / g.power - 1e-9));
    plan = computePlanMulti([
      [target, rate],
      ...g.burns.map(([cn, r]) => [cn, r * gens]),
    ]);
  }
  return { ...plan, gens, genKey, power: planPower(plan) };
}

function autoBuildPlan(plan) {
  const members = [];
  const tier = bestMinerTier();
  for (const cn of Object.keys(plan.raws)) {
    const f = { id: state.seq++, type: 'miner', resource: cn, count: 0 };
    f.purity = DEPOSITS[cn]
      ? (['pure', 'normal', 'impure'].find(p => depositsLeft(cn, p) > 0) || 'normal')
      : 'normal';
    if (!EXT[cn]) f.tier = tier;
    members.push(f);
  }
  for (const e of plan.recipes) {
    members.push({ id: state.seq++, type: 'machine', recipeId: e.recipe.id, count: 0 });
  }
  if (plan.genKey && plan.gens > 0) {
    members.push({ id: state.seq++, type: 'gen', genKey: plan.genKey, count: 0 });
  }
  members.push({ id: state.seq++, type: 'sink', count: 1 }); // 잉여 자동 출하
  const pos = spawnXY();
  newComplex(members, pos.x, pos.y); // 자동 배치 + 자동 배선 포함
  save();
  rebuild();
  showBanner(`📋 ${iname(plan.target)} ${fmtN(plan.rate)}/분 단지가 통째로 배치되었습니다 — 더블클릭하면 내부 배선을 볼 수 있습니다.`, 7000);
}

function openPlanner() {
  const overlay = el('div', 'alt-overlay');
  overlay.addEventListener('pointerdown', ev => { if (ev.target === overlay) overlay.remove(); });
  const card = el('div', 'alt-card plan-card');
  card.append(el('h3', null, '📋 계획 모드 — 목표를 정하면 완성 단지를 통째로 만들어 줍니다'));

  const search = el('input');
  search.placeholder = '목표 아이템 검색 (한글/영문)';
  const listBox = el('div', 'plan-list');
  const rateRow = el('div', 'plan-rate');
  const rateInput = el('input');
  rateInput.type = 'number'; rateInput.min = '0.1'; rateInput.step = 'any'; rateInput.value = '10';
  rateRow.append(el('span', null, '목표 생산량'), rateInput, el('span', 'hint', '/분'));
  // 자체 발전 선택 (해금된 발전기 + 연료 체인까지 계획에 포함)
  const genSel = el('select');
  const noGen = el('option', null, '자체 발전 없음 (외부 전력)');
  noGen.value = '';
  genSel.append(noGen);
  for (const key of state.gensUnlocked) {
    const opt = el('option', null, `${D.xnames[GENS[key].build]} 포함 (+${GENS[key].power}MW/대)`);
    opt.value = key;
    genSel.append(opt);
  }
  if (state.gensUnlocked.includes('coal')) genSel.value = 'coal';
  rateRow.append(el('span', null, ' · 전력'), genSel);
  const result = el('div', 'plan-result');
  const btnRow = el('div', 'btn-wrap');
  const buildBtn = el('button', null, '단지로 자동 생성');
  const closeBtn = el('button', 'ghost', '닫기');
  closeBtn.addEventListener('click', () => overlay.remove());
  btnRow.append(buildBtn, closeBtn);
  card.append(search, listBox, rateRow, result, btnRow);
  overlay.append(card);
  document.body.append(overlay);

  let selItem = null;
  let lastPlan = null;
  const targets = Object.keys(D.items).filter(cn => producersOf[cn])
    .sort((a, b) => iname(a).localeCompare(iname(b), 'ko'));

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    listBox.textContent = '';
    let shown = 0;
    for (const cn of targets) {
      if (q && !(iname(cn).toLowerCase().includes(q) || D.items[cn].n.toLowerCase().includes(q))) continue;
      if (++shown > 60) break;
      const row = el('div', 'hand-item' + (cn === selItem ? ' sel' : ''));
      const left = el('span');
      left.append(iconEl(cn, 's'), ' ' + iname(cn));
      row.append(left, el('span', 'en', D.items[cn].n));
      row.addEventListener('click', () => { selItem = cn; renderList(); renderPlan(); });
      listBox.append(row);
    }
    if (!shown) listBox.append(el('div', 'hand-empty', '검색 결과가 없습니다'));
  };

  const renderPlan = () => {
    result.textContent = '';
    lastPlan = null;
    buildBtn.disabled = true;
    if (!selItem) { result.append(el('div', 'hint', '목표 아이템을 선택하세요.')); return; }
    const rate = Math.max(0.1, parseFloat(rateInput.value) || 10);
    const plan = computeFullPlan(selItem, rate, genSel.value || null);
    if (plan.recipes.length === 0) {
      result.append(el('div', 'hint', '현재 해금된 기계로는 이 아이템을 생산할 수 없습니다.'));
      return;
    }
    lastPlan = { ...plan, target: selItem, rate };
    buildBtn.disabled = false;
    const t = el('table', 'plan-table');
    if (plan.genKey && plan.gens > 0) {
      const g = GENS[plan.genKey];
      const tr = el('tr');
      const nameTd = el('td');
      nameTd.append(iconEl(g.build, 's'), ` ⚡ ${D.xnames[g.build]} `,
        el('span', 'hint', `연료 체인 포함 · 발전 +${(g.power * plan.gens).toLocaleString()}MW`));
      tr.append(nameTd, el('td', 'num', `×${plan.gens}`));
      t.append(tr);
    }
    for (const { recipe, machines } of plan.recipes.sort((a, b) => b.machines - a.machines)) {
      const tr = el('tr');
      const nameTd = el('td');
      nameTd.append(iconEl(recipe.out[0][0], 's'), ` ${recipe.ko} `, el('span', 'hint', `[${mname(recipe.machine)}]`));
      tr.append(nameTd, el('td', 'num', `×${Math.ceil(machines - 1e-9)} (${fmtN(machines)})`));
      t.append(tr);
    }
    const tier = bestMinerTier();
    for (const [cn, r8] of Object.entries(plan.raws).sort((a, b) => b[1] - a[1])) {
      const def = EXT[cn] || MINERS[tier];
      const cnt = Math.ceil(r8 / def.rate - 1e-9);
      const tr = el('tr', 'plan-raw');
      const nameTd = el('td');
      nameTd.append(iconEl(cn, 's'),
        ` ${iname(cn)} ${fmtN(r8)}/분 `,
        el('span', 'hint', `(${EXT[cn] ? D.xnames[def.build] : '채굴기 Mk.' + tier} ×${cnt}, 보통 순도 기준)`));
      tr.append(nameTd, el('td', 'num', ''));
      t.append(tr);
    }
    for (const [cn, r8] of Object.entries(plan.external)) {
      const tr = el('tr', 'plan-ext');
      const nameTd = el('td');
      nameTd.append(iconEl(cn, 's'), ` ${iname(cn)} ${fmtN(r8)}/분 — 레시피 잠김/순환, 반입 포트로 공급 필요`);
      tr.append(nameTd, el('td', 'num', ''));
      t.append(tr);
    }
    result.append(t);
    const genMW = plan.genKey ? GENS[plan.genKey].power * plan.gens : 0;
    result.append(el('div', 'hint',
      `전력 수요 ~${fmtN(plan.power)} MW (100% 클럭)`
      + (genMW ? ` · 자체 발전 +${genMW.toLocaleString()} MW — 전력까지 자급하는 단지` : ' · 외부 전력 필요')
      + ' · 내부 물류 자동'));
  };

  buildBtn.addEventListener('click', () => {
    if (!lastPlan) return;
    autoBuildPlan(lastPlan);
    overlay.remove();
  });
  search.oninput = renderList;
  rateInput.oninput = renderPlan;
  genSel.onchange = renderPlan;
  renderList();
  renderPlan();
}

/* ---------- 업무 모드: 가짜 엑셀 (게임 데이터가 실시간 시트로 표시) ---------- */
const XL_COLS = 8, XL_ROWS = 38;
let xlSheet = '설비현황';
let xlCells = null; // [row][col] td
let xlMeta = null;  // [row][col] 편집 메타 ({t:'count'|'clock', cxId, fid})
let xlSelected = null;
let xlEditing = null; // {td, input, meta}
let xlFormBuilt = false;
let xlName = null, xlFbar = null;
let xlStatusEl = null, xlStatusTimer = null;

function xlStatus(msg) {
  if (!xlStatusEl) return;
  xlStatusEl.textContent = msg;
  clearTimeout(xlStatusTimer);
  xlStatusTimer = setTimeout(() => { xlStatusEl.textContent = '준비'; }, 3500);
}

function buildExcel() {
  const root = el('div');
  root.id = 'excel';

  const title = el('div', 'xl-title');
  title.append(el('span', null, '자동 저장 ●'), el('span', 't', '생산현황_분기보고.xlsx - Excel'), el('span', 'win', '— ⬜ ✕'));
  root.append(title);

  const menu = el('div', 'xl-menu');
  for (const m of ['파일', '홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기']) {
    const it = el('span', m === '홈' ? 'active' : null, m);
    if (m === '보기') {
      it.title = '게임 화면으로 (F9)';
      it.addEventListener('click', () => { state.biz = false; applyBiz(); save(); });
    }
    menu.append(it);
  }
  root.append(menu);

  const ribbon = el('div', 'xl-ribbon');
  const grp1 = el('span', 'grp', '📋 붙여넣기');
  const grp2 = el('span', 'grp');
  grp2.append(el('span', 'box', '맑은 고딕'), el('span', 'box', '11'), el('span', null, '가 가 가'));
  const grp3 = el('span', 'grp', '≡ ≡ ≡  병합하고 가운데 맞춤');
  const grp4 = el('span', 'grp', '표준 ▾  ％ 🔗  ,  .00');
  const grp5 = el('span', 'grp', '조건부 서식 ▾  표 서식 ▾  셀 스타일 ▾');
  ribbon.append(grp1, grp2, grp3, grp4, grp5, el('span', null, 'Σ 자동 합계  ▾ 정렬 및 필터'));
  root.append(ribbon);

  const fbarWrap = el('div', 'xl-formula');
  xlName = el('div', 'xl-name', 'A1');
  xlFbar = el('div', 'xl-fbar', '');
  fbarWrap.append(xlName, el('div', 'xl-fx', 'fx'), xlFbar);
  root.append(fbarWrap);

  const wrap = el('div', 'xl-grid-wrap');
  const table = el('table', 'xl-grid');
  const hrow = el('tr');
  hrow.append(el('th', 'rn', ''));
  for (let c = 0; c < XL_COLS; c++) hrow.append(el('th', null, String.fromCharCode(65 + c)));
  table.append(hrow);
  xlCells = [];
  xlMeta = [];
  for (let r = 0; r < XL_ROWS; r++) {
    const tr = el('tr');
    tr.append(el('th', 'rn', r + 1));
    const rowCells = [];
    const rowMeta = [];
    for (let c = 0; c < XL_COLS; c++) {
      const td = el('td');
      td.addEventListener('click', () => {
        if (xlEditing) return;
        if (xlSelected) xlSelected.classList.remove('sel');
        xlSelected = td;
        td.classList.add('sel');
        xlName.textContent = String.fromCharCode(65 + c) + (r + 1);
        xlFbar.textContent = td.textContent;
      });
      td.addEventListener('dblclick', () => {
        const meta = xlMeta[r] && xlMeta[r][c];
        if (meta) startCellEdit(td, meta);
      });
      tr.append(td);
      rowCells.push(td);
      rowMeta.push(null);
    }
    table.append(tr);
    xlCells.push(rowCells);
    xlMeta.push(rowMeta);
  }
  wrap.append(table);
  root.append(wrap);

  const tabs = el('div', 'xl-tabs');
  tabs.append(el('span', 'nav', '◀ ▶'));
  for (const name of ['설비현황', '재고', '생산실적', '설비등록']) {
    const t = el('span', 'tab' + (name === xlSheet ? ' active' : ''), name);
    t.addEventListener('click', () => {
      xlSheet = name;
      xlFormBuilt = false;
      for (const x of tabs.querySelectorAll('.tab')) x.classList.toggle('active', x.textContent === name);
      refreshExcel();
    });
    tabs.append(t);
  }
  tabs.append(el('span', 'nav', '＋'));
  root.append(tabs);

  const status = el('div', 'xl-status');
  xlStatusEl = el('span', null, '준비');
  status.append(xlStatusEl, el('span', 'xl-agg', ''), el('span', null, '🔳 ▦ ▤  ─── 100% ＋'));
  root.append(status);

  document.body.append(root);
}

/* 셀 편집 (더블클릭): 대수 = 기계 구매/판매, 클럭 = 오버클럭 */
function startCellEdit(td, meta) {
  if (xlEditing) return;
  const cur = td.textContent.replace('%', '');
  td.textContent = '';
  const input = el('input', 'xl-edit');
  input.value = cur;
  td.append(input);
  xlEditing = { td, input, meta };
  input.focus();
  input.select();
  const finish = commit => {
    if (!xlEditing) return;
    const val = input.value;
    xlEditing = null;
    td.textContent = cur;
    if (commit) applyCellEdit(meta, val);
    refreshExcel();
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation(); // 엑셀 전체 Esc/F9 와 충돌 방지
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function applyCellEdit(meta, val) {
  const cx = cxById(meta.cxId);
  const f = cx?.members.find(x => x.id === meta.fid);
  if (!f) return;
  const n = parseInt(val, 10);
  if (isNaN(n)) { xlStatus('숫자를 입력하세요'); return; }
  if (meta.t === 'count') {
    const def = facDef(f);
    const target = Math.max(0, n);
    let applied = 0;
    while (f.count < target) {
      if (f.type === 'miner' && depositsLeft(f.resource, f.purity || 'normal') <= 0) { xlStatus('매장지가 부족하여 일부만 적용되었습니다'); break; }
      if (!canAfford(def.cost)) { xlStatus('건설 재료가 부족하여 일부만 적용되었습니다'); break; }
      pay(def.cost);
      f.count++;
      applied++;
    }
    while (f.count > target) { f.count--; refund(def.cost); applied++; }
    if (applied && f.count === target) xlStatus(`${def.label} 대수 ${target}대 적용 완료`);
    save();
  } else if (meta.t === 'clock') {
    const target = Math.min(250, Math.max(50, Math.round(n / 25) * 25));
    const diff = shardsFor(target) - shardsFor(clockOf(f));
    if (diff > 0 && stockOf(SHARD) < diff) { xlStatus(`동력 조각 ${diff}개 필요 (보유 ${fmtN(stockOf(SHARD))})`); return; }
    addStock(SHARD, -diff);
    f.clock = target;
    xlStatus(`클럭 ${target}% 적용 완료` + (target !== n ? ' (25% 단위 반올림)' : ''));
    save();
  }
}

/* '설비등록' 시트: 폼 형태로 신규 시설 추가 */
function renderFormSheet() {
  // 셀 비우기
  for (let r = 0; r < XL_ROWS; r++) {
    for (let c = 0; c < XL_COLS; c++) {
      xlCells[r][c].textContent = '';
      xlCells[r][c].className = '';
      xlMeta[r][c] = null;
    }
  }
  const set = (r, c, v, cls) => { xlCells[r][c].textContent = v; if (cls) xlCells[r][c].className = cls; };
  const sel = (r, c, options, value, onchange) => {
    const s = el('select', 'xl-cellsel');
    for (const [v, label] of options) {
      const o = el('option', null, label);
      o.value = v;
      s.append(o);
    }
    if (value != null) s.value = value;
    s.onchange = () => { onchange(s.value); };
    xlCells[r][c].textContent = '';
    xlCells[r][c].className = 'edit';
    xlCells[r][c].append(s);
    return s;
  };
  const form = renderFormSheet.form ??= { type: 'miner', res: state.raws[0], purity: 'normal', tier: 1, machine: state.machines[0], recipeId: null, genKey: state.gensUnlocked[0] || null, target: 'new' };

  set(0, 0, '신규 설비 등록', 'hdr');
  set(0, 1, '아래 항목을 선택 후 [등록]', 'hdr');
  set(2, 0, '설비 유형');
  const types = [['miner', '채굴기'], ['machine', '생산 기계'], ['sink', '출하 시설']];
  if (state.gensUnlocked.length) types.splice(2, 0, ['gen', '발전기']);
  if (state.ms >= 2) types.push(['awesink', 'AWESOME 싱크']);
  sel(2, 1, types, form.type, v => { form.type = v; xlFormBuilt = false; refreshExcel(); });

  let row = 4;
  if (form.type === 'miner') {
    set(row, 0, '자원');
    sel(row, 1, state.raws.map(cn => [cn, iname(cn)]), form.res, v => { form.res = v; xlFormBuilt = false; refreshExcel(); });
    if (DEPOSITS[form.res]) {
      set(row + 2, 0, '순도');
      const opts = ['pure', 'normal', 'impure'].filter(p => (DEPOSITS[form.res] || {})[p] != null)
        .map(p => [p, `${PURITY[p].ko} (매장지 ${depositsLeft(form.res, p)})`]);
      sel(row + 2, 1, opts, form.purity, v => { form.purity = v; });
      if (!EXT[form.res]) {
        set(row + 4, 0, '채굴기 등급');
        sel(row + 4, 1, [1, 2, 3].filter(minerTierUnlocked).map(t => [t, `Mk.${t} (${MINERS[t].rate}/분)`]), form.tier, v => { form.tier = +v; });
      }
      row += 6;
    } else row += 2;
  } else if (form.type === 'machine') {
    set(row, 0, '기계');
    sel(row, 1, state.machines.map(m => [m, mname(m)]), form.machine, v => { form.machine = v; xlFormBuilt = false; refreshExcel(); });
    set(row + 2, 0, '레시피');
    const list = D.recipes.filter(r => r.machine === form.machine && (!r.alt || state.altUnlocked.includes(r.id)));
    if (!list.some(r => r.id === form.recipeId)) form.recipeId = list[0]?.id;
    sel(row + 2, 1, list.map(r => [r.id, (r.alt ? '★ ' : '') + r.ko]), form.recipeId, v => { form.recipeId = v; });
    row += 4;
  } else if (form.type === 'gen') {
    set(row, 0, '발전기');
    sel(row, 1, state.gensUnlocked.map(k => [k, `${D.xnames[GENS[k].build]} (+${GENS[k].power}MW)`]), form.genKey, v => { form.genKey = v; });
    row += 2;
  }

  set(row, 0, '등록 위치');
  const targets = [['new', '새 단지로']].concat(state.cx.map(c => [String(c.id), cxIdentity(c).name + ' 에 합류']));
  if (![...targets.map(t => t[0])].includes(form.target)) form.target = 'new';
  sel(row, 1, targets, form.target, v => { form.target = v; });

  const btnRow = row + 2;
  set(btnRow, 0, '');
  const btn = xlCells[btnRow][1];
  btn.textContent = '[ 등록 ]';
  btn.className = 'edit xl-btn';
  btn.onclick = () => {
    const fac = { type: form.type, count: (form.type === 'sink' || form.type === 'awesink') ? 1 : 0 };
    if (form.type === 'miner') {
      fac.resource = form.res;
      fac.purity = DEPOSITS[form.res] ? form.purity : 'normal';
      if (!EXT[form.res]) fac.tier = form.tier;
    } else if (form.type === 'machine') {
      if (!form.recipeId) return;
      fac.recipeId = form.recipeId;
    } else if (form.type === 'gen') {
      if (!form.genKey) return;
      fac.genKey = form.genKey;
    }
    if (form.target === 'new') {
      addComplex(fac); // save + rebuild 포함
    } else {
      const cx = cxById(+form.target);
      if (!cx) return;
      fac.id = state.seq++;
      fac.buf = { in: {}, out: {} };
      cx.members.push(fac);
      autoLayoutCx(cx);
      ensureWired(cx); // 자동 배선
      save();
      rebuild();
    }
    xlStatus('등록 완료 — 설비현황 시트에서 대수를 입력해 건설하세요');
    xlFormBuilt = false;
    refreshExcel();
  };
  set(btnRow + 2, 0, '※ 대수·클럭은 설비현황 시트에서 노란 셀을 더블클릭해 수정합니다.');
}

/** 현재 시트의 데이터 행 계산 */
function excelRows() {
  const rows = [];
  if (xlSheet === '설비현황') {
    rows.push(['구분', '설비명', '클럭', '대수', '가동률', '소요전력(MW)', '비고', '']);
    for (const cx of state.cx) {
      const idn = cxIdentity(cx).name.replace(/[⚡🏭📦⛏]/g, '').trim();
      let first = true;
      for (const f of cx.members) {
        const def = facDef(f);
        const isProd = f.type === 'miner' || f.type === 'machine' || f.type === 'gen';
        const canClock = f.type === 'miner' || f.type === 'machine';
        rows.push([
          first ? idn : '',
          def.label.replace(/[★⚡]/g, '').trim()
            + (f.type === 'miner' && f.purity && DEPOSITS[f.resource] ? ` [${PURITY[f.purity].ko}]` : ''),
          canClock
            ? { v: clockOf(f) + '%', cls: 'edit', meta: { t: 'clock', cxId: cx.id, fid: f.id } }
            : '-',
          isProd
            ? { v: f.count, cls: 'edit', meta: { t: 'count', cxId: cx.id, fid: f.id } }
            : '-',
          isProd && f.count > 0 ? Math.round((f.eff || 0) * 100) + '%' : '-',
          isProd ? Math.round(def.power * f.count * 10) / 10 : '-',
          f.why || (f.type === 'sink' ? '잉여 반출' : f.type === 'awesink' ? '포인트 전환' : ''),
          '',
        ]);
        first = false;
      }
    }
    rows.push(['', '', '', '', '', '', '', '']);
    rows.push(['합계', '', '', '', '', Math.round(lastPower.demand * 10) / 10, `공급 ${Math.round(lastPower.supply)}`, '']);
  } else if (xlSheet === '재고') {
    rows.push(['품목코드', '품목명', '현재고', '입출고(/분)', '', '항목', '값', '']);
    const items = visibleStock();
    const meta = [
      ['전력 공급(MW)', Math.round(lastPower.supply)],
      ['전력 수요(MW)', Math.round(lastPower.demand * 10) / 10],
      ['보유 쿠폰', state.coupons],
      ['싱크 포인트', Math.round(state.sinkPts)],
      ['달성 마일스톤', state.ms + ' / ' + MS.length],
      ...state.contracts.map((c, i) => [
        `계약${i + 1} (${fmtN(Math.max(0, c.left))}분)`,
        c.items.map(it => `${iname(it.item)} ${fmtN(it.delivered)}/${it.qty}`).join(', '),
      ]),
    ];
    for (let i = 0; i < Math.max(items.length, meta.length); i++) {
      const cn = items[i];
      rows.push([
        cn ? 'ITM-' + String(i + 1).padStart(3, '0') : '',
        cn ? iname(cn) : '',
        cn ? Math.floor(stockOf(cn)).toLocaleString() : '',
        cn ? fmtRate(lastRates[cn] || 0) : '',
        '',
        meta[i] ? meta[i][0] : '',
        meta[i] ? meta[i][1] : '',
        '',
      ]);
    }
  } else {
    rows.push(['품목명', '생산(/분)', '소비(/분)', '순증(/분)', '', '', '', '']);
    const prod = {}, cons = {};
    for (const cx of state.cx) {
      for (const f of cx.members) {
        const def = facDef(f);
        const run = f.count * (f.eff || 0);
        for (const p of def.outs) prod[p.item] = (prod[p.item] || 0) + p.rate * run;
        for (const p of def.ins) cons[p.item] = (cons[p.item] || 0) + p.rate * run;
      }
    }
    const all = [...new Set([...Object.keys(prod), ...Object.keys(cons)])]
      .sort((a, b) => (prod[b] || 0) - (prod[a] || 0));
    for (const cn of all) {
      const p = prod[cn] || 0, c = cons[cn] || 0;
      rows.push([iname(cn), fmtN(p), fmtN(c), fmtN(p - c), '', '', '', '']);
    }
  }
  return rows;
}

function applyBiz() {
  document.body.classList.toggle('biz', !!state.biz);
  const bizBtn = $('btn-biz');
  if (bizBtn) bizBtn.textContent = state.biz ? '게임 모드' : '업무 모드 (F9)';
  document.title = state.biz ? '생산현황_분기보고.xlsx - Excel' : 'Satisfactory 공장 단지';
  if (state.biz) refreshExcel();
}

function refreshExcel() {
  if (!state.biz || !xlCells) return;
  if (xlSheet === '설비등록') {
    if (!xlFormBuilt) { renderFormSheet(); xlFormBuilt = true; }
    return;
  }
  const rows = excelRows();
  let vSum = 0, vCnt = 0;
  for (let r = 0; r < XL_ROWS; r++) {
    for (let c = 0; c < XL_COLS; c++) {
      const td = xlCells[r][c];
      if (xlEditing && xlEditing.td === td) continue; // 편집 중인 셀은 건드리지 않음
      const cell = rows[r] ? (rows[r][c] ?? '') : '';
      const isObj = cell !== null && typeof cell === 'object';
      const s = String(isObj ? cell.v : cell);
      if (td.firstElementChild) td.textContent = ''; // 폼 시트 잔여물 제거
      if (td.textContent !== s) td.textContent = s;
      xlMeta[r][c] = isObj ? (cell.meta || null) : null;
      const isNum = s !== '' && /^[-+]?[\d,.]+%?$/.test(s);
      td.classList.toggle('num', isNum);
      td.classList.toggle('edit', isObj && cell.cls === 'edit');
      td.classList.toggle('hdr', r === 0 && s !== '');
      td.classList.toggle('warncell', c === 6 && s !== '' && !/^(공급|잉여|포인트)/.test(s) && r !== 0 && xlSheet === '설비현황');
      if (isNum) { vCnt++; vSum += parseFloat(s.replace(/[,%]/g, '')) || 0; }
    }
  }
  const agg = document.querySelector('.xl-agg');
  if (agg) agg.textContent = `평균: ${vCnt ? fmtN(vSum / vCnt) : 0}  개수: ${vCnt}  합계: ${fmtN(vSum)}`;
  if (xlSelected && !xlEditing) xlFbar.textContent = xlSelected.textContent;
}

/* --- 시작 가이드 --- */
const TUT_STEPS = [
  { text: '수동 채집에서 철 광석을 캐세요 (10개)', done: () => stockOf('Desc_OreIron_C') >= 10 },
  { text: '수동 제작에서 철 주괴를 만드세요 (5개)', done: () => stockOf('Desc_IronIngot_C') >= 5 },
  { text: '철판 10개 · 철봉 10개를 만드세요', done: () => stockOf('Desc_IronPlate_C') >= 10 && stockOf('Desc_IronRod_C') >= 10 },
  { text: '마일스톤 1 "자동 채굴"을 달성하세요', done: () => state.ms >= 1 },
  { text: '채굴기 시설을 배치하고 + 로 기계를 사세요', done: () => state.cx.some(c => c.members.some(f => f.type === 'miner' && f.count > 0)) },
  { text: '제련기(철 주괴) 시설을 만들어 채굴기 카드 위로 드래그 — 합체해서 단지로!', done: () => state.cx.some(c => c.members.some(f => f.type === 'miner') && c.members.some(f => f.type === 'machine')) },
  { text: '출하 시설을 단지 위로 드래그해 합치면 잉여 산출물이 재고로 들어옵니다', done: () => state.cx.some(c => hasSink(c) && c.members.length > 1) },
];
function buildTutorial() {
  const panel = $('tut-panel');
  const allDone = () => (state.tut || []).filter(Boolean).length >= TUT_STEPS.length;
  if (state.tutHidden || allDone()) { panel.hidden = true; return; }
  panel.hidden = false;
  const box = $('tut-body');
  box.textContent = '';
  const rows = TUT_STEPS.map((s, i) => {
    const row = el('div', 'tut-step');
    const mark = el('span', 'tut-mark');
    row.append(mark, el('span', null, `${i + 1}. ${s.text}`));
    box.append(row);
    return { row, mark, i };
  });
  $('tut-hide').onclick = () => { state.tutHidden = true; save(); rebuild(); };
  onUpdate(() => {
    state.tut ??= [];
    let firstOpen = -1;
    for (const r of rows) {
      if (!state.tut[r.i] && TUT_STEPS[r.i].done()) state.tut[r.i] = true;
      const done = !!state.tut[r.i];
      r.mark.textContent = done ? '✅' : '⬜';
      if (!done && firstOpen < 0) firstOpen = r.i;
      r.row.classList.toggle('done', done);
    }
    for (const r of rows) r.row.classList.toggle('current', r.i === firstOpen);
    if (allDone()) panel.hidden = true;
  });
}

/* ---------- 캔버스: 단지 카드 ---------- */
const drag = { mode: null, cx: null, dx: 0, dy: 0, moved: false, fromCx: null, fromItem: null, dropTarget: null, pendingRebuild: false };
let portEls = {};
let focusedCx = null;
let expandedCx = null; // 더블클릭으로 펼친 단지 (내부 배선 편집기)
let iPortEls = {};     // 내부 포트 점: "fid|item|dir" (펼친 단지 하나 기준)
let iSvgEl = null, iSpaceEl = null;
let edgeMenu = null;

function iPortAnchor(fid, item, dir) {
  const elp = iPortEls[fid + '|' + item + '|' + dir] || iPortEls[fid + '|*|' + dir];
  if (!elp || !iSpaceEl) return null;
  const rect = elp.getBoundingClientRect();
  const cRect = iSpaceEl.getBoundingClientRect();
  const z = zoomOf();
  return { x: (rect.left + rect.width / 2 - cRect.left) / z, y: (rect.top + rect.height / 2 - cRect.top) / z };
}
function layoutIEdges() {
  if (!iSvgEl || expandedCx == null) return;
  const cx = cxById(expandedCx);
  if (!cx) return;
  for (const path of iSvgEl.querySelectorAll('path.edge, path.edge-hit')) {
    const e = cx.iedges.find(x => x.id === +path.dataset.id);
    if (!e) { path.remove(); continue; }
    const a = iPortAnchor(e.from.f, e.from.item, 'out');
    const b = iPortAnchor(e.to.f, e.to.item, 'in');
    if (a && b) path.setAttribute('d', edgePath(a, b));
  }
}
function addIEdge(cx, fromF, fromItem, toF, toItem) {
  const dstFac = toF === 'out' ? null : facById(cx, toF);
  const sinkLike = toF === 'out' || (dstFac && (dstFac.type === 'sink' || dstFac.type === 'awesink'));
  if (!sinkLike && toItem !== fromItem) return;
  const finalItem = sinkLike ? fromItem : toItem;
  if (fromF === toF) return;
  if (cx.iedges.some(e => e.from.f === fromF && e.from.item === fromItem && e.to.f === toF && e.to.item === finalItem)) return;
  cx.iedges.push({ id: state.seq++, from: { f: fromF, item: fromItem }, to: { f: toF, item: finalItem } });
  save(); rebuild();
}
function removeIEdge(cx, id) {
  const e = cx.iedges.find(x => x.id === id);
  if (e) for (let t = 2; t <= (e.tier || 1); t++) refund(BELT_TIERS[t].cost);
  cx.iedges = cx.iedges.filter(x => x.id !== id);
  save(); rebuild();
}
function openIEdgeMenu(ev, cx, edgeId) {
  closeEdgeMenu();
  const e = cx.iedges.find(x => x.id === edgeId);
  if (!e) return;
  const t = e.tier || 1;
  const menu = el('div', 'edge-menu');
  const head = el('div', 'em-head');
  head.append(iconEl(e.from.item, 's'), ` ${iname(e.from.item)} `, el('b', null, `Mk.${t}`));
  menu.append(head);
  menu.append(el('div', 'em-line', `용량 ${beltCap(e)}/분 · 현재 흐름 ${fmtN(lastIFlow[e.id] || 0)}/분`));
  if (t < 5) {
    const next = BELT_TIERS[t + 1];
    const up = el('button', null, `Mk.${t + 1} 업그레이드 (${Math.round(next.cap * (1 + 0.2 * rlv('belt')))}/분)`);
    up.disabled = !canAfford(next.cost);
    up.addEventListener('click', () => {
      if (!canAfford(next.cost)) return;
      pay(next.cost);
      e.tier = t + 1;
      closeEdgeMenu();
      save(); rebuild();
    });
    menu.append(up);
    const chips = chipRow(next.cost);
    chips.refresh();
    const line = el('div', 'em-line');
    line.append(chips.box);
    menu.append(line);
  } else menu.append(el('div', 'em-line', '최고 티어입니다'));
  const del = el('button', 'ghost danger', '연결 삭제' + (t > 1 ? ' (업그레이드 환불)' : ''));
  del.addEventListener('click', () => { removeIEdge(cx, edgeId); closeEdgeMenu(); });
  menu.append(del);
  menu.style.left = Math.min(ev.clientX, window.innerWidth - 240) + 'px';
  menu.style.top = Math.min(ev.clientY, window.innerHeight - 180) + 'px';
  document.body.append(menu);
  edgeMenu = menu;
}

const zoomOf = () => state.zoom || 1;
function applyZoom() {
  $('canvas-inner').style.transform = `scale(${zoomOf()})`;
  const wrap = $('canvas-wrap');
  const z = zoomOf();
  wrap.classList.toggle('zoom-far', z < 0.75);
  wrap.classList.toggle('zoom-mid', z >= 0.75 && z < 1.15);
  wrap.classList.toggle('zoom-near', z >= 1.15);
}
function canvasPos(e) {
  const rect = $('canvas-inner').getBoundingClientRect();
  const z = zoomOf();
  return { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z };
}
function portAnchor(cxId, item, dir) {
  const elp = portEls[cxId + '|' + item + '|' + dir] || portEls[cxId + '|*|' + dir];
  if (!elp) return null;
  const rect = elp.getBoundingClientRect();
  const cRect = $('canvas-inner').getBoundingClientRect();
  const z = zoomOf();
  return { x: (rect.left + rect.width / 2 - cRect.left) / z, y: (rect.top + rect.height / 2 - cRect.top) / z };
}
function edgePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
function layoutEdges() {
  for (const path of $('edge-svg').querySelectorAll('path.edge, path.edge-hit')) {
    const e = state.edges.find(x => x.id === +path.dataset.id);
    if (!e) { path.remove(); continue; }
    const a = portAnchor(e.from.cx, e.from.item, 'out');
    const b = portAnchor(e.to.cx, e.to.item, 'in');
    if (a && b) path.setAttribute('d', edgePath(a, b));
  }
}

function closeEdgeMenu() { if (edgeMenu) { edgeMenu.remove(); edgeMenu = null; } }

function removeEdge(id) {
  const e = state.edges.find(x => x.id === id);
  if (e) for (let t = 2; t <= (e.tier || 1); t++) refund(BELT_TIERS[t].cost);
  state.edges = state.edges.filter(x => x.id !== id);
  save(); rebuild();
}
function upgradeEdge(id) {
  const e = state.edges.find(x => x.id === id);
  if (!e) return;
  const t = e.tier || 1;
  if (t >= 5 || !canAfford(BELT_TIERS[t + 1].cost)) return;
  pay(BELT_TIERS[t + 1].cost);
  e.tier = t + 1;
  save(); rebuild();
}
/**
 * 벨트가 실제로 병목인지 진단.
 * 이동량은 min(보낼 양, 벨트 용량, 받는 쪽 빈 자리) 이므로 (tick 3번 항목),
 * 흐름이 용량보다 낮다면 원인은 벨트가 아니라 상류 공급이나 하류 수요다.
 */
function edgeDiag(e) {
  const cap = beltCap(e);
  const flow = lastEdgeFlow[e.id] || 0;
  const src = cxById(e.from.cx), dst = cxById(e.to.cx);
  const srcPool = src ? (src.pool[e.from.item] || 0) : 0;
  const dstPool = dst ? (dst.pool[e.to.item] || 0) : 0;
  const dstFull = dst && dstPool >= poolCap(dst) * 0.95;
  if (flow >= cap * 0.97) {
    return { bottleneck: true, text: '벨트가 꽉 찼습니다 — 업그레이드하면 그만큼 더 흐릅니다' };
  }
  if (dstFull) {
    return {
      bottleneck: false,
      text: `받는 쪽 저장고가 가득(${fmtN(dstPool)}/${poolCap(dst)})해 수요만큼만 흐릅니다`
        + ' — 벨트 병목이 아니라 하류 소비 부족입니다',
    };
  }
  if (srcPool <= 0.5 && flow < cap * 0.5) {
    return { bottleneck: false, text: '보낼 재고가 없습니다 — 벨트 병목이 아니라 상류 생산 부족입니다' };
  }
  return { bottleneck: false, text: `용량이 ${fmtN(cap - flow)}/분 남았습니다 — 지금은 벨트 병목이 아닙니다` };
}

function openEdgeMenu(ev, edgeId) {
  closeEdgeMenu();
  const e = state.edges.find(x => x.id === edgeId);
  if (!e) return;
  const t = e.tier || 1;
  const menu = el('div', 'edge-menu');
  const head = el('div', 'em-head');
  head.append(iconEl(e.from.item, 's'), ` ${iname(e.from.item)} `, el('b', null, `Mk.${t}`));
  menu.append(head);
  menu.append(el('div', 'em-line', `용량 ${beltCap(e)}/분 · 현재 흐름 ${fmtN(lastEdgeFlow[e.id] || 0)}/분`));
  const diag = edgeDiag(e);
  menu.append(el('div', 'em-diag' + (diag.bottleneck ? ' hot' : ''), (diag.bottleneck ? '⚠ ' : 'ℹ ') + diag.text));
  if (t < 5) {
    const next = BELT_TIERS[t + 1];
    // 병목이 아닐 때 업그레이드는 효과가 없으므로 강조하지 않는다
    const up = el('button', diag.bottleneck ? null : 'ghost', `Mk.${t + 1} 업그레이드 (${Math.round(next.cap * (1 + 0.2 * rlv('belt')))}/분)`);
    up.disabled = !canAfford(next.cost);
    up.addEventListener('click', () => { upgradeEdge(edgeId); closeEdgeMenu(); });
    menu.append(up);
    const chips = chipRow(next.cost);
    chips.refresh();
    const line = el('div', 'em-line');
    line.append(chips.box);
    menu.append(line);
  } else menu.append(el('div', 'em-line', '최고 티어입니다'));
  const del = el('button', 'ghost danger', '연결 삭제' + (t > 1 ? ' (업그레이드 환불)' : ''));
  del.addEventListener('click', () => { removeEdge(edgeId); closeEdgeMenu(); });
  menu.append(del);
  // 진단줄 때문에 메뉴가 최대 300px까지 넓어질 수 있다 (style.css .edge-menu)
  menu.style.left = Math.max(8, Math.min(ev.clientX, window.innerWidth - 312)) + 'px';
  menu.style.top = Math.min(ev.clientY, window.innerHeight - 220) + 'px';
  document.body.append(menu);
  edgeMenu = menu;
}

function openClockMenu(ev, cxId, facId) {
  closeEdgeMenu();
  const cx = cxById(cxId);
  const f = cx?.members.find(x => x.id === facId);
  if (!f) return;
  const menu = el('div', 'edge-menu');
  const head = el('div', 'em-head');
  head.append('⚡ 오버클럭', el('b'));
  menu.append(head);
  const range = el('input');
  range.type = 'range'; range.min = 50; range.max = 250; range.step = 25;
  range.value = clockOf(f);
  menu.append(range);
  const info = el('div', 'em-line');
  const shardInfo = el('div', 'em-line');
  const apply = el('button', null, '적용');
  menu.append(info, shardInfo, apply);
  const refresh = () => {
    const t = +range.value;
    head.querySelector('b').textContent = t + '%';
    info.textContent = `속도 ×${(t / 100).toFixed(2)} · 전력 ×${Math.pow(t / 100, POWER_EXP).toFixed(2)}`;
    const diff = shardsFor(t) - shardsFor(clockOf(f));
    shardInfo.textContent = diff > 0 ? `동력 조각 ${diff}개 필요 (보유 ${fmtN(stockOf(SHARD))})`
      : diff < 0 ? `동력 조각 ${-diff}개 환불` : '동력 조각 변동 없음';
    apply.disabled = t === clockOf(f) || (diff > 0 && stockOf(SHARD) < diff);
  };
  range.oninput = refresh;
  refresh();
  apply.addEventListener('click', () => {
    const t = +range.value;
    const diff = shardsFor(t) - shardsFor(clockOf(f));
    if (diff > 0 && stockOf(SHARD) < diff) return;
    addStock(SHARD, -diff);
    f.clock = t;
    closeEdgeMenu();
    save(); rebuild();
  });
  menu.style.left = Math.min(ev.clientX, window.innerWidth - 260) + 'px';
  menu.style.top = Math.min(ev.clientY, window.innerHeight - 200) + 'px';
  document.body.append(menu);
  edgeMenu = menu;
}

/* --- 단지 조작 --- */
function spawnXY() {
  const k = state.cx.length;
  return { x: 60 + (k % 5) * 240, y: 60 + Math.floor(k / 5) * 200 % 900 };
}
function newComplex(members, x, y) {
  const cx = { id: state.seq++, x, y, members, pool: undefined, inbox: {}, outbox: {}, iedges: [] };
  delete cx.pool;
  for (const f of members) f.buf ??= { in: {}, out: {} };
  state.cx.push(cx);
  ensureWired(cx);
  return cx;
}
function addComplex(fac) {
  fac.id = state.seq++;
  const pos = spawnXY();
  newComplex([fac], pos.x, pos.y);
  save(); rebuild();
}
function mergeComplex(srcId, dstId) {
  const src = cxById(srcId), dst = cxById(dstId);
  if (!src || !dst || src === dst) return;
  dst.members.push(...src.members);
  dst.iedges.push(...(src.iedges || []));
  for (const [cn, v] of Object.entries(src.inbox || {})) dst.inbox[cn] = (dst.inbox[cn] || 0) + v;
  for (const [cn, v] of Object.entries(src.outbox || {})) dst.outbox[cn] = (dst.outbox[cn] || 0) + v;
  for (const e of state.edges) {
    if (e.from.cx === srcId) e.from.cx = dstId;
    if (e.to.cx === srcId) e.to.cx = dstId;
  }
  state.edges = state.edges.filter(e => e.from.cx !== e.to.cx);
  state.cx = state.cx.filter(c => c.id !== srcId);
  if (focusedCx === srcId) focusedCx = dstId;
  autoLayoutCx(dst);   // 새 식구 포함 재배치
  ensureWired(dst);    // 빠진 배선 자동 연결 (기존 배선은 유지)
  sfx('merge');
  save(); rebuild();
}
function extractMember(cxId, facId) {
  const cx = cxById(cxId);
  if (!cx) return;
  const idx = cx.members.findIndex(f => f.id === facId);
  if (idx < 0) return;
  const [f] = cx.members.splice(idx, 1);
  cx.iedges = cx.iedges.filter(e => e.from.f !== facId && e.to.f !== facId);
  newComplex([f], cx.x + 60, cx.y + 120);
  if (cx.members.length === 0) removeComplexInner(cx.id);
  save(); rebuild();
}
function removeComplexInner(id) {
  state.cx = state.cx.filter(c => c.id !== id);
  state.edges = state.edges.filter(e => e.from.cx !== id && e.to.cx !== id);
  if (focusedCx === id) focusedCx = null;
}
function removeComplex(id) {
  const cx = cxById(id);
  if (!cx) return;
  for (const f of cx.members) {
    const def = facDef(f);
    refund(Object.fromEntries(Object.entries(def.cost).map(([cn, c]) => [cn, c * f.count])));
  }
  removeComplexInner(id);
  save(); rebuild();
}
/** 채굴기 Mk.N → Mk.N+1 차액 (보유 대수만큼, 이전 건물은 환불되므로 차액만 받는다) */
function minerUpgradeCost(f, nextTier) {
  if (!MINERS[nextTier]) return {};
  const from = buildCost(MINERS[f.tier || 1].build);
  const to = buildCost(MINERS[nextTier].build);
  const cost = {};
  const n = Math.max(f.count, 1);
  for (const cn of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const diff = ((to[cn] || 0) - (from[cn] || 0)) * n;
    if (diff > 0) cost[cn] = diff;
  }
  return cost;
}

/** 배치된 채굴기를 제자리에서 한 단계 업그레이드 (철거 → 재배치 없이) */
function upgradeMiner(cxId, facId) {
  const cx = cxById(cxId);
  const f = cx && cx.members.find(x => x.id === facId);
  if (!f || f.type !== 'miner' || EXT[f.resource] || f.count <= 0) return;
  const next = (f.tier || 1) + 1;
  if (!MINERS[next] || !minerTierUnlocked(next)) return;
  const cost = minerUpgradeCost(f, next);
  if (!canAfford(cost)) return;
  pay(cost);
  f.tier = next;
  sfx('upgrade');
  showBanner(`⛏ ${iname(f.resource)} 채굴기 ×${f.count} → Mk.${next} (${MINERS[next].rate}/분)`, 3500);
  save(); rebuild();
}

/** 지금 한 단계 올릴 수 있는 채굴기들 (해금 여부만 판단, 자원은 별도 확인) */
function upgradableMiners() {
  const list = [];
  for (const cx of state.cx) {
    for (const f of cx.members) {
      if (f.type !== 'miner' || EXT[f.resource] || f.count <= 0) continue;
      const next = (f.tier || 1) + 1;
      if (MINERS[next] && minerTierUnlocked(next)) list.push({ cx, f, next });
    }
  }
  return list;
}
const upgradeAllCost = list => {
  const total = {};
  for (const { f, next } of list) {
    for (const [cn, n] of Object.entries(minerUpgradeCost(f, next))) total[cn] = (total[cn] || 0) + n;
  }
  return total;
};

/** 여유가 되는 만큼 채굴기를 일괄 업그레이드 (비싼 것부터 굶지 않게 저렴한 순으로) */
function upgradeAllMiners() {
  const list = upgradableMiners()
    .sort((a, b) => Object.values(minerUpgradeCost(a.f, a.next)).reduce((s, n) => s + n, 0)
                  - Object.values(minerUpgradeCost(b.f, b.next)).reduce((s, n) => s + n, 0));
  let done = 0;
  for (const { f, next } of list) {
    const cost = minerUpgradeCost(f, next);
    if (!canAfford(cost)) continue;
    pay(cost);
    f.tier = next;
    done++;
  }
  if (!done) return;
  sfx('upgrade');
  showBanner(`⛏ 채굴기 ${done}종을 업그레이드했습니다`
    + (done < list.length ? ` (재료가 부족해 ${list.length - done}종은 남았습니다)` : ''), 4000);
  save(); rebuild();
}

function removeFacility(cxId, facId) {
  const cx = cxById(cxId);
  if (!cx) return;
  const f = cx.members.find(x => x.id === facId);
  if (!f) return;
  const def = facDef(f);
  refund(Object.fromEntries(Object.entries(def.cost).map(([cn, c]) => [cn, c * f.count])));
  cx.members = cx.members.filter(x => x.id !== facId);
  cx.iedges = cx.iedges.filter(e => e.from.f !== facId && e.to.f !== facId);
  if (cx.members.length === 0) removeComplexInner(cxId);
  save(); rebuild();
}

/* --- 툴바 --- */
function buildFactoryBar() {
  const resSel = $('add-res');
  const mSel = $('add-machine');
  const rSel = $('add-recipe');
  const genSel = $('add-gen');
  const tierSel = $('add-mtier');
  const puritySel = $('add-purity');
  const prevRes = resSel.value, prevM = mSel.value, prevR = rSel.value, prevG = genSel.value;

  resSel.textContent = '';
  for (const cn of state.raws) {
    const opt = el('option', null, iname(cn));
    opt.value = cn;
    resSel.append(opt);
  }
  if (prevRes && state.raws.includes(prevRes)) resSel.value = prevRes;

  let puritySig = '';
  const refreshPurity = () => {
    const pool = DEPOSITS[resSel.value];
    const sig = resSel.value + '|' + (pool ? ['pure', 'normal', 'impure'].map(p => depositsLeft(resSel.value, p)).join(',') : 'inf');
    if (sig === puritySig) return;
    puritySig = sig;
    const prev = puritySel.value;
    puritySel.textContent = '';
    if (!pool) { puritySel.style.display = 'none'; return; }
    puritySel.style.display = '';
    for (const p of ['pure', 'normal', 'impure']) {
      if (!(p in pool)) continue;
      const left = depositsLeft(resSel.value, p);
      const opt = el('option', null, `${PURITY[p].ko} ×${PURITY[p].mult} (매장지 ${left}/${pool[p]})`);
      opt.value = p;
      opt.disabled = left <= 0;
      puritySel.append(opt);
    }
    if (prev && [...puritySel.options].some(o => o.value === prev && !o.disabled)) puritySel.value = prev;
    else {
      const firstOk = [...puritySel.options].find(o => !o.disabled);
      if (firstOk) puritySel.value = firstOk.value;
    }
  };
  refreshPurity();

  const refreshTier = () => {
    const isOre = !EXT[resSel.value];
    tierSel.style.display = isOre ? '' : 'none';
    if (!isOre) return;
    const prev = tierSel.value;
    tierSel.textContent = '';
    for (const t of [1, 2, 3]) {
      const unlocked = minerTierUnlocked(t);
      const opt = el('option', null, (unlocked ? '' : '🔒 ') + `Mk.${t} (${MINERS[t].rate}/분)`);
      opt.value = t;
      opt.disabled = !unlocked;
      tierSel.append(opt);
    }
    // 해금했는데도 Mk.1로 되돌아가면 매번 다시 고르게 되므로, 기본값은 최고 해금 티어
    tierSel.value = prev && minerTierUnlocked(+prev) ? prev : bestMinerTier();
  };
  refreshTier();

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
      const locked = r.alt && !state.altUnlocked.includes(r.id);
      const opt = el('option', null, (locked ? '🔒 ' : '') + (r.alt ? '★ ' : '') + r.ko);
      opt.value = r.id;
      opt.disabled = locked;
      rSel.append(opt);
    }
    const sel = rSel.selectedOptions[0];
    if (!sel || sel.disabled) {
      const firstOk = [...rSel.options].find(o => !o.disabled);
      if (firstOk) rSel.value = firstOk.value;
    }
  };
  mSel.onchange = () => { fillRecipes(); refreshCost('machine'); };
  fillRecipes();
  if (prevR && [...rSel.options].some(o => o.value === prevR && !o.disabled)) rSel.value = prevR;

  genSel.textContent = '';
  for (const key of state.gensUnlocked) {
    const g = GENS[key];
    const opt = el('option', null, `${D.xnames[g.build]} (+${g.power}MW)`);
    opt.value = key;
    genSel.append(opt);
  }
  if (prevG && state.gensUnlocked.includes(prevG)) genSel.value = prevG;
  $('gen-bar').style.display = state.gensUnlocked.length > 0 ? '' : 'none';

  // 비용 칩: 최근 만진 선택 기준
  let costChips = null;
  const refreshCost = which => {
    const box = $('bar-cost');
    box.textContent = '';
    let build = null;
    if (which === 'miner' && state.miners && resSel.value) build = (EXT[resSel.value] || MINERS[+tierSel.value || 1]).build;
    if (which === 'machine' && rSel.value) build = recipeById[rSel.value].machine;
    if (which === 'gen' && genSel.value) build = GENS[genSel.value].build;
    if (!build) { costChips = null; return; }
    costChips = chipRow(buildCost(build));
    box.append(costChips.box);
    costChips.refresh();
  };
  resSel.onchange = () => { refreshPurity(); refreshTier(); refreshCost('miner'); };
  tierSel.onchange = () => refreshCost('miner');
  genSel.onchange = () => refreshCost('gen');
  rSel.onchange = () => refreshCost('machine');
  refreshCost('machine');

  $('add-miner').onclick = () => {
    if (!state.miners || !resSel.value) return;
    const fac = { type: 'miner', resource: resSel.value, count: 0 };
    fac.purity = DEPOSITS[resSel.value] ? (puritySel.value || 'normal') : 'normal';
    if (!EXT[resSel.value]) fac.tier = +tierSel.value || 1;
    addComplex(fac);
  };
  const upAll = $('up-miners');
  upAll.onclick = () => upgradeAllMiners();
  onUpdate(() => {
    const list = upgradableMiners();
    upAll.hidden = list.length === 0;
    if (upAll.hidden) return;
    const cost = upgradeAllCost(list);
    upAll.disabled = !canAfford(cost);
    upAll.textContent = `⛏⬆ 전체 업그레이드 (${list.length})`;
    upAll.title = `배치된 채굴기 ${list.length}종을 한 단계씩 올립니다`
      + `\n필요: ${Object.entries(cost).map(([cn, n]) => `${iname(cn)}×${fmtN(n)}`).join(', ') || '무료'}`;
  });

  $('add-node').onclick = () => { if (rSel.value) addComplex({ type: 'machine', recipeId: rSel.value, count: 0 }); };
  $('add-gen-btn').onclick = () => { if (genSel.value) addComplex({ type: 'gen', genKey: genSel.value, count: 0 }); };
  $('add-sink').onclick = () => addComplex({ type: 'sink', count: 1 });
  const awBtn = $('add-awesink');
  awBtn.style.display = state.ms >= 2 ? '' : 'none';
  awBtn.onclick = () => addComplex({ type: 'awesink', count: 1 });
  $('open-plan').onclick = () => openPlanner();

  onUpdate(() => {
    $('add-miner').disabled = !state.miners;
    if (costChips) costChips.refresh();
    refreshPurity();
  });
}

/* --- 단지 카드 렌더링 --- */
function buildCanvas() {
  closeEdgeMenu();
  applyZoom();
  portEls = {};
  const layer = $('node-layer');
  layer.textContent = '';
  const svg = $('edge-svg');
  svg.textContent = '';

  for (const cx of state.cx) {
    const idn = cxIdentity(cx);
    const box = el('div', 'cx ' + idn.cls + (focusedCx === cx.id ? ' focused' : ''));
    box.style.left = cx.x + 'px';
    box.style.top = cx.y + 'px';
    box.dataset.id = cx.id;

    // 건물 일러스트 (합체할수록 증축, 합체 직후엔 증축 연출)
    const visual = el('div', 'cx-visual arch-' + cxArch(cx));
    visual.append(buildingSVG(cxArch(cx), cxStage(cx)));
    if (lastMemberCount[cx.id] !== undefined && cx.members.length > lastMemberCount[cx.id]) {
      box.classList.add('evolve');
      setTimeout(() => box.classList.remove('evolve'), 700);
    }
    lastMemberCount[cx.id] = cx.members.length;
    box.append(visual);

    // 헤더
    const head = el('div', 'cx-head');
    if (idn.icon) head.append(iconEl(idn.icon, 's'));
    head.append(el('span', null, idn.name));
    if (cx.members.length > 1) head.append(el('span', 'cx-badge', cx.members.length + '개 시설'));
    const eff = el('span', 'eff');
    head.append(eff);
    box.append(head);
    const whyLine = el('div', 'cx-why');
    box.append(whyLine);

    // 요약줄 (전력·포인트)
    const sub = el('div', 'cx-sub');
    box.append(sub);

    // 필요 재료 — 줌과 무관하게 항상 표시 (합체로 상쇄된 내부 소비까지)
    const needs = cxNeeds(cx);
    if (needs.length) {
      const nWrap = el('div', 'cx-needs');
      nWrap.append(el('span', 'nl', '필요'));
      for (const n of needs) {
        const chip = el('span', 'need');
        const amt = el('b');
        chip.append(iconEl(n.item, 's'), amt);
        chip.title = `${iname(n.item)} — 소비 ${fmtN(n.cons)}/분`
          + (n.inner > 0.05 ? ` · 단지 내부 공급 ${fmtN(n.inner)}/분` : '')
          + (n.outer > 0.05 ? ` · 외부 반입 필요 ${fmtN(n.outer)}/분` : ' · 내부에서 전량 자급');
        nWrap.append(chip);
        onUpdate(() => {
          const have = (cx.inbox[n.item] || 0)
            + cx.members.reduce((s, f) => s + ((f.buf && f.buf.in[n.item]) || 0), 0);
          const starving = cx.members.some(f => f.lack === n.item);
          amt.textContent = fmtN(have);
          chip.classList.toggle('lack', starving);
          chip.classList.toggle('ext', !starving && n.outer > 0.05);
        });
      }
      box.append(nWrap);
    }

    // 건설 대기 재료 — 아직 안 지어진(0대) 시설을 1대씩 짓는 데 필요한 재료 합계
    const unbuilt = cx.members.filter(f =>
      f.type !== 'sink' && f.type !== 'awesink' && f.count === 0);
    if (unbuilt.length) {
      const agg = {};
      for (const f of unbuilt) {
        for (const [cn, n] of Object.entries(facDef(f).cost)) agg[cn] = (agg[cn] || 0) + n;
      }
      const bWrap = el('div', 'cx-needs cx-build');
      bWrap.append(el('span', 'nl', `건설 대기 ${unbuilt.length}`));
      for (const [item, need] of Object.entries(agg)) {
        const chip = el('span', 'need');
        const amt = el('b');
        chip.append(iconEl(item, 's'), amt);
        makeCraftLink(chip, item);
        chip.title = `${iname(item)} — 미건설 시설 ${unbuilt.length}개(1대씩) 건설에 ${fmtN(need)}개 필요`
          + (chip.classList.contains('craft') ? ' · 클릭하면 수동 제작 선택' : '');
        bWrap.append(chip);
        onUpdate(() => {
          const have = stockOf(item);
          amt.textContent = `${fmtN(have)}/${fmtN(need)}`;
          chip.classList.toggle('short', have < need);
          chip.classList.toggle('ok', have >= need);
        });
      }
      box.append(bWrap);
    }

    // 중간 줌: 아이콘 스트립
    const strip = el('div', 'cx-strip');
    for (const f of cx.members) {
      const ic = iconEl(facDef(f).iconCn || SHARD, 's');
      ic.title = facDef(f).label + ' ×' + f.count;
      strip.append(ic);
    }
    box.append(strip);


    // 외부 포트
    const ports = cxPorts(cx);
    const pWrap = el('div', 'cx-ports');
    const insCol = el('div', 'ports in');
    const outsCol = el('div', 'ports out');
    if (hasSink(cx) || hasAwesink(cx)) {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.cx = cx.id; dot.dataset.item = '*'; dot.dataset.dir = 'in';
      portEls[cx.id + '|*|in'] = dot;
      p.append(dot, el('span', null, hasSink(cx) ? '반입 → 재고' : '반입 소각 → P'));
      insCol.append(p);
    }
    for (const pin of ports.ins) {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.cx = cx.id; dot.dataset.item = pin.item; dot.dataset.dir = 'in';
      portEls[cx.id + '|' + pin.item + '|in'] = dot;
      const pool = el('span', 'pool');
      // 이 수치는 "설계상 밖에서 받아야 하는 양"이다. 지금 굶는 중일 때만 '부족'이라고 쓴다.
      const rate = el('span', 'rate', `${fmtN(pin.rate)}/분 필요`);
      p.append(dot, iconEl(pin.item, 's'), rate, pool);
      insCol.append(p);
      onUpdate(() => {
        const have = cx.inbox[pin.item] || 0;
        const starving = cx.members.some(f => f.lack === pin.item);
        pool.textContent = fmtN(have);
        rate.textContent = `${fmtN(pin.rate)}/분 ` + (starving ? '부족' : '필요');
        p.classList.toggle('starving', starving);
        p.title = `${iname(pin.item)} — 설계상 외부 반입 ${fmtN(pin.rate)}/분 필요 · 현재 보유 ${fmtN(have)}/${poolCap(cx)}`
          + (starving ? '\n⚠ 지금 이 재료가 모자라 기계가 멈춰 있습니다' : '\n지금은 모자라지 않습니다');
      });
    }
    for (const pout of ports.outs) {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.cx = cx.id; dot.dataset.item = pout.item; dot.dataset.dir = 'out';
      portEls[cx.id + '|' + pout.item + '|out'] = dot;
      const pool = el('span', 'pool');
      p.append(dot, iconEl(pout.item, 's'), el('span', 'rate', `+${fmtN(pout.rate)}/분`), pool);
      outsCol.append(p);
      onUpdate(() => {
        const have = cx.outbox[pout.item] || 0;
        const cap = poolCap(cx);
        const jammed = cx.members.some(f => f.jam === pout.item) || have >= cap * 0.98;
        pool.textContent = fmtN(have);
        p.classList.toggle('jammed', jammed);
        p.title = `${iname(pout.item)} — 설계상 잉여 ${fmtN(pout.rate)}/분 · 현재 보유 ${fmtN(have)}/${cap}`
          + (jammed ? '\n⚠ 저장고가 가득해 생산이 막혔습니다 — 출하 시설을 합치거나 벨트로 내보내세요' : '');
      });
    }
    pWrap.append(insCol, outsCol);
    box.append(pWrap);

    // 푸터
    const foot = el('div', 'cx-foot');
    const powerS = el('span');
    foot.append(powerS);
    const expandBtn = el('button', 'ghost', expandedCx === cx.id ? '⤡ 접기' : '⤢ 내부 배선');
    expandBtn.title = '더블클릭으로도 열고 닫을 수 있습니다';
    expandBtn.addEventListener('click', () => {
      expandedCx = expandedCx === cx.id ? null : cx.id;
      rebuild();
    });
    foot.append(expandBtn);
    const del = el('button', 'ghost danger del', '✕ 단지 철거');
    del.addEventListener('click', () => removeComplex(cx.id));
    foot.append(del);
    box.append(foot);

    // 더블클릭 = 내부 배선 편집기 열기/닫기
    box.addEventListener('dblclick', e => {
      if (e.target.closest('button, select, input, .craft, .port, .cx-inner-wrap')) return;
      expandedCx = expandedCx === cx.id ? null : cx.id;
      rebuild();
    });
    if (expandedCx === cx.id) {
      box.classList.add('expanded');
      box.append(buildInnerEditor(cx));
    }

    onUpdate(() => {
      // 단지 가동률 = 기계 수 가중 평균
      let wsum = 0, esum = 0;
      let power = 0, produces = 0;
      const lacks = new Set(), jams = new Set(), reasons = new Set();
      for (const f of cx.members) {
        const def = facDef(f);
        power += def.power * f.count;
        if (def.produces) produces += def.produces * f.count * (f.eff || 0);
        if (f.type === 'sink' || f.type === 'awesink') continue;
        if (f.count > 0) {
          wsum += f.count;
          esum += (f.eff || 0) * f.count;
          if (f.lack) lacks.add(f.lack);
          else if (f.jam) jams.add(f.jam);
          else if (f.why) reasons.add(f.why);
        }
      }
      // 같은 원인은 한 줄로 모아서 (기계마다 같은 말 반복하지 않게)
      const worst = [
        lacks.size ? '재료 부족: ' + [...lacks].map(iname).join(', ') : null,
        jams.size ? '저장고 가득: ' + [...jams].map(iname).join(', ') + ' — 출하 시설을 합치거나 소비처를 늘리세요' : null,
        ...reasons,
      ].filter(Boolean).join(' · ') || null;
      const pct = wsum > 0 ? Math.round(esum / wsum * 100) : 0;
      eff.textContent = hasAwesink(cx) && cx.ptsRate ? `+${fmtN(cx.ptsRate)} P/분` : (wsum > 0 ? pct + '%' : '휴면');
      eff.style.color = pct >= 99 || wsum === 0 ? 'var(--good)' : 'var(--bad)';
      whyLine.textContent = worst ? '⚠ ' + worst : '';
      whyLine.style.display = worst ? '' : 'none';
      sub.textContent = '';
      if (produces > 0) sub.append(`⚡ +${fmtN(produces)}MW`);
      if (power > 0) sub.append(`소비 ${fmtN(power)}MW`);
      const working = wsum > 0 && pct > 1;
      box.classList.toggle('working', working);
      if (working) box.style.setProperty('--spd', (0.9 / Math.max(0.25, pct / 100)).toFixed(2) + 's');
    });

    layer.append(box);
  }

  // 연결선
  for (const e of state.edges) {
    const tier = e.tier || 1;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('edge');
    path.dataset.id = e.id;
    path.style.strokeWidth = (2 + (tier - 1) * 0.7) + 'px';
    svg.append(path);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.classList.add('edge-hit');
    hit.dataset.id = e.id;
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${iname(e.from.item)} · Mk.${tier} ${beltCap(e)}/분 (클릭: 업그레이드/삭제)`;
    hit.append(title);
    hit.addEventListener('click', ev => openEdgeMenu(ev, e.id));
    hit.addEventListener('pointerenter', () => path.classList.add('hover'));
    hit.addEventListener('pointerleave', () => path.classList.remove('hover'));
    svg.append(hit);
  }
  onUpdate(() => {
    for (const path of svg.querySelectorAll('path.edge')) {
      path.classList.toggle('flow', (lastEdgeFlow[+path.dataset.id] || 0) > 1e-6);
    }
  });
  layoutEdges();
}

/* 내부 배선 편집기 (v1 노드 캔버스를 단지 안에 이식) */
function buildInnerEditor(cx) {
  iPortEls = {};
  const wrap = el('div', 'cx-inner-wrap');
  const space = el('div', 'cx-inner-space');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('iedge-svg');
  const layer = el('div', 'inode-layer');
  space.append(svg, layer);
  wrap.append(space);
  iSvgEl = svg;
  iSpaceEl = space;

  const mkDot = (fid, item, dir) => {
    const dot = el('span', 'dot');
    dot.dataset.ifid = fid;
    dot.dataset.item = item;
    dot.dataset.dir = dir;
    iPortEls[fid + '|' + item + '|' + dir] = dot;
    return dot;
  };

  // 게이트: 반입구 (외부 벨트가 가져온 아이템)
  const inItems = [...new Set([
    ...Object.keys(cx.inbox).filter(k => (cx.inbox[k] || 0) > 0.05),
    ...cx.iedges.filter(e => e.from.f === 'in').map(e => e.from.item),
    ...state.edges.filter(e => e.to.cx === cx.id).map(e => e.to.item),
  ])].filter(i => i !== '*');
  const gateIn = el('div', 'fnode inode gate');
  gateIn.style.left = '8px';
  gateIn.style.top = '30px';
  const giHead = el('div', 'fnode-head');
  giHead.append('📥 반입구');
  gateIn.append(giHead);
  {
    const body = el('div', 'fnode-body');
    const outs = el('div', 'ports out');
    for (const item of inItems) {
      const p = el('div', 'port');
      const buf = el('span', 'buf');
      p.append(mkDot('in', item, 'out'), iconEl(item, 's'), buf);
      p.title = iname(item) + ' — 외부에서 반입';
      outs.append(p);
      onUpdate(() => { buf.textContent = fmtN(cx.inbox[item] || 0); });
    }
    if (!inItems.length) outs.append(el('div', 'hint', ' 반입 없음 '));
    body.append(el('div', 'ports in'), outs);
    gateIn.append(body);
  }
  layer.append(gateIn);

  // 게이트: 반출구 (외부 벨트로 내보낼 아이템)
  const gateOut = el('div', 'fnode inode gate');
  gateOut.style.right = '8px';
  gateOut.style.top = '30px';
  const goHead = el('div', 'fnode-head');
  goHead.append('📤 반출구');
  gateOut.append(goHead);
  {
    const body = el('div', 'fnode-body');
    const ins = el('div', 'ports in');
    const p = el('div', 'port');
    p.append(mkDot('out', '*', 'in'), el('span', null, '모든 아이템'));
    p.title = '여기로 연결하면 단지 밖(외부 벨트)으로 나갑니다';
    ins.append(p);
    const outList = el('div', 'hint');
    ins.append(outList);
    onUpdate(() => {
      outList.textContent = Object.entries(cx.outbox)
        .filter(([, v]) => v > 0.05)
        .map(([cn, v]) => `${iname(cn)} ${fmtN(v)}`).join(' · ');
    });
    body.append(ins, el('div', 'ports out'));
    gateOut.append(body);
  }
  layer.append(gateOut);

  // 시설 노드
  for (const f of cx.members) {
    const def = facDef(f);
    const node = el('div', 'fnode inode ' + f.type);
    if (f.ix == null) autoLayoutCx(cx);
    node.style.left = f.ix + 'px';
    node.style.top = f.iy + 'px';
    node.dataset.fid = f.id;
    const head = el('div', 'fnode-head');
    if (def.iconCn) head.append(iconEl(def.iconCn, 's'));
    head.append(el('span', null, def.label));
    const eff = el('span', 'eff');
    head.append(eff);
    node.append(head);
    const why = el('div', 'fnode-why');
    node.append(why);
    const body = el('div', 'fnode-body');
    const insCol = el('div', 'ports in');
    const outsCol = el('div', 'ports out');
    if (f.type === 'sink' || f.type === 'awesink') {
      const p = el('div', 'port');
      p.append(mkDot(f.id, '*', 'in'), el('span', null,
        f.type === 'sink' ? '모두 → 재고' : '소각 → P (0P 불가)'));
      insCol.append(p);
    }
    for (const pin of def.ins) {
      const p = el('div', 'port');
      const buf = el('span', 'buf');
      p.append(mkDot(f.id, pin.item, 'in'), iconEl(pin.item, 's'),
        el('span', 'rate', `${fmtN(pin.rate * Math.max(f.count, 1))}/분`), buf);
      p.title = iname(pin.item);
      insCol.append(p);
      onUpdate(() => {
        buf.textContent = fmtN(f.buf.in[pin.item] || 0);
        p.classList.toggle('starving', f.lack === pin.item);
      });
    }
    for (const pout of def.outs) {
      const p = el('div', 'port');
      const buf = el('span', 'buf');
      p.append(mkDot(f.id, pout.item, 'out'), iconEl(pout.item, 's'),
        el('span', 'rate', `${fmtN(pout.rate * Math.max(f.count, 1))}/분`), buf);
      p.title = iname(pout.item);
      outsCol.append(p);
      onUpdate(() => { buf.textContent = fmtN(f.buf.out[pout.item] || 0); });
    }
    body.append(insCol, outsCol);
    node.append(body);
    // 노드 푸터: 구매·쿠폰 건설·오버클럭·승급·꺼내기·삭제
    const nfoot = el('div', 'fnode-foot');
    if (f.type !== 'sink' && f.type !== 'awesink') {
      const minus = el('button', 'ghost', '−');
      const cnt = el('span', 'cnt', f.count);
      const plus = el('button', null, '+');
      const noDeposit = () => f.type === 'miner' && depositsLeft(f.resource, f.purity || 'normal') <= 0;
      minus.addEventListener('click', () => { if (f.count > 0) { f.count--; refund(def.cost); update(); save(); } });
      plus.addEventListener('click', () => {
        if (noDeposit()) return;
        if (canAfford(def.cost)) { pay(def.cost); f.count++; update(); save(); }
      });
      plus.title = Object.entries(def.cost).map(([cn, n]) => `${iname(cn)}×${n}`).join(', ');
      const cpn = el('button', 'ghost cbuild');
      cpn.addEventListener('click', () => {
        const price = couponBuildCost(def);
        if (state.coupons < price || noDeposit()) return;
        state.coupons -= price;
        f.count++;
        sfx('coupon');
        update(); save();
      });
      const clk = el('button', 'ghost clk');
      clk.addEventListener('click', ev => openClockMenu(ev, cx.id, f.id));
      nfoot.append(minus, cnt, plus, cpn, clk);
      if (f.type === 'miner' && !EXT[f.resource]) {
        const up = el('button', 'ghost up');
        up.addEventListener('click', () => upgradeMiner(cx.id, f.id));
        nfoot.append(up);
        onUpdate(() => {
          const next = (f.tier || 1) + 1;
          up.hidden = !MINERS[next];
          if (up.hidden) return;
          up.textContent = '⬆' + next;
          const cost = minerUpgradeCost(f, next);
          const locked = !minerTierUnlocked(next);
          up.disabled = locked || !canAfford(cost) || f.count <= 0;
          up.title = locked ? `Mk.${next} 미해금` : `Mk.${next} 승급 — 차액: `
            + (Object.entries(cost).map(([cn, n]) => `${iname(cn)}×${fmtN(n)}`).join(', ') || '무료');
        });
      }
      onUpdate(() => {
        cnt.textContent = f.count;
        plus.disabled = !canAfford(def.cost) || noDeposit();
        minus.disabled = f.count <= 0;
        const price = couponBuildCost(def);
        cpn.textContent = '🎟' + price;
        cpn.disabled = state.coupons < price || noDeposit();
        clk.textContent = '⚡' + clockOf(f) + '%';
        clk.classList.toggle('oc', clockOf(f) !== 100);
      });
    }
    const outB = el('button', 'ghost', '⇱');
    outB.title = '단지에서 꺼내기 (독립 단지로)';
    outB.addEventListener('click', () => extractMember(cx.id, f.id));
    const delB = el('button', 'ghost danger', '✕');
    delB.title = '시설 삭제 (비용 환불)';
    delB.addEventListener('click', () => removeFacility(cx.id, f.id));
    nfoot.append(outB, delB);
    node.append(nfoot);
    onUpdate(() => {
      if (f.type === 'sink' || f.type === 'awesink') { eff.textContent = ''; why.style.display = 'none'; return; }
      const pct = Math.round((f.eff || 0) * 100);
      eff.textContent = f.count > 0 ? pct + '%' : '휴면';
      eff.style.color = pct >= 99 ? 'var(--good)' : (f.count > 0 ? 'var(--bad)' : 'var(--muted)');
      const w = pct < 99 ? (f.why || '') : '';
      why.textContent = w ? '⚠ ' + w : '';
      why.style.display = w ? '' : 'none';
    });
    layer.append(node);
  }

  // 내부 연결선
  for (const e of cx.iedges) {
    const tier = e.tier || 1;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('edge');
    path.dataset.id = e.id;
    path.style.strokeWidth = (2 + (tier - 1) * 0.7) + 'px';
    svg.append(path);
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.classList.add('edge-hit');
    hit.dataset.id = e.id;
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${iname(e.from.item)} · Mk.${tier} ${beltCap(e)}/분 (클릭: 업그레이드/삭제)`;
    hit.append(title);
    hit.addEventListener('click', ev => openIEdgeMenu(ev, cx, e.id));
    hit.addEventListener('pointerenter', () => path.classList.add('hover'));
    hit.addEventListener('pointerleave', () => path.classList.remove('hover'));
    svg.append(hit);
  }
  onUpdate(() => {
    for (const path of svg.querySelectorAll('path.edge')) {
      path.classList.toggle('flow', (lastIFlow[+path.dataset.id] || 0) > 1e-6);
    }
  });
  requestAnimationFrame(layoutIEdges);
  return wrap;
}

function addEdge(fromCx, fromItem, toCxId, toItem) {
  const dst = cxById(toCxId);
  if (!dst || fromCx === toCxId) return;
  const sinkLike = toItem === '*';
  if (!sinkLike && toItem !== fromItem) return;
  const finalItem = sinkLike ? fromItem : toItem;
  if (state.edges.some(e => e.from.cx === fromCx && e.from.item === fromItem && e.to.cx === toCxId && e.to.item === finalItem)) return;
  state.edges.push({ id: state.seq++, from: { cx: fromCx, item: fromItem }, to: { cx: toCxId, item: finalItem } });
  // 게이트 자동 배선: 보내는 쪽은 생산자→반출구, 받는 쪽은 반입구→소비처
  const src = cxById(fromCx);
  if (src && !src.iedges.some(e => e.to.f === 'out' && e.to.item === fromItem)) {
    const prod = src.members.find(m => facDef(m).outs.some(o => o.item === fromItem));
    if (prod) src.iedges.push({ id: state.seq++, from: { f: prod.id, item: fromItem }, to: { f: 'out', item: fromItem } });
  }
  if (!cx0ConsumesInbox(dst, finalItem)) {
    const cons = dst.members.find(m => facDef(m).ins.some(o => o.item === finalItem))
      || dst.members.find(m => m.type === 'sink' || (m.type === 'awesink' && ptsOf(finalItem) > 0));
    if (cons) dst.iedges.push({ id: state.seq++, from: { f: 'in', item: finalItem }, to: { f: cons.id, item: finalItem } });
  }
  save(); rebuild();
}

/* --- 캔버스 이벤트 --- */
function initCanvasEvents() {
  const wrap = $('canvas-wrap');
  const svg = $('edge-svg');
  const portDotAt = target => {
    if (!target || !target.closest) return null;
    return target.closest('.port .dot') || target.closest('.port')?.querySelector('.dot') || null;
  };

  const iPos = e => {
    const rect = iSpaceEl.getBoundingClientRect();
    const z = zoomOf();
    return { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z };
  };

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('.edge-hit')) return;
    // ---- 내부 배선 편집기 (펼친 단지 안) ----
    const innerWrap = e.target.closest('.cx-inner-wrap');
    if (innerWrap) {
      const icx = cxById(expandedCx);
      if (!icx) return;
      const idot = e.target.closest('.inode .port .dot')
        || e.target.closest('.inode .port')?.querySelector('.dot');
      const inode = e.target.closest('.inode');
      if (idot && idot.dataset.dir === 'out') {
        drag.mode = 'iedge';
        drag.iCx = icx;
        drag.fromF = idot.dataset.ifid === 'in' ? 'in' : +idot.dataset.ifid;
        drag.fromItem = idot.dataset.item;
        const pending = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pending.classList.add('pending');
        pending.id = 'pending-iedge';
        iSvgEl.append(pending);
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        e.preventDefault();
        return;
      }
      if (inode && !inode.classList.contains('gate')
        && !e.target.closest('button, select, input, .port')) {
        drag.mode = 'inode';
        drag.iCx = icx;
        drag.if = facById(icx, +inode.dataset.fid);
        const pos = iPos(e);
        drag.dx = pos.x - drag.if.ix;
        drag.dy = pos.y - drag.if.iy;
        inode.classList.add('dragging');
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        e.preventDefault();
        return;
      }
      if (!inode && !e.target.closest('button, select, input')) {
        drag.mode = 'ipan';
        drag.iWrap = innerWrap;
        drag.px = e.clientX; drag.py = e.clientY;
        drag.sx = innerWrap.scrollLeft; drag.sy = innerWrap.scrollTop;
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        e.preventDefault();
      }
      return; // 내부 조작은 월드 드래그로 번지지 않게
    }
    const card = e.target.closest('.cx');
    const interactive = e.target.closest('button, select, input, .craft');
    const inPort = e.target.closest('.port');
    const dot = portDotAt(e.target);
    if (dot && dot.dataset.dir === 'out') {
      drag.mode = 'edge';
      drag.fromCx = +dot.dataset.cx;
      drag.fromItem = dot.dataset.item;
      const pending = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pending.classList.add('pending');
      pending.id = 'pending-edge';
      svg.append(pending);
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트 등 */ }
      e.preventDefault();
    } else if (card && !interactive && !inPort) {
      drag.mode = 'cx';
      drag.cx = cxById(+card.dataset.id);
      drag.moved = false;
      const pos = canvasPos(e);
      drag.dx = pos.x - drag.cx.x;
      drag.dy = pos.y - drag.cx.y;
      card.classList.add('dragging');
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트 등 */ }
      e.preventDefault();
    } else if (!card) {
      drag.mode = 'pan';
      drag.px = e.clientX; drag.py = e.clientY;
      drag.sx = wrap.scrollLeft; drag.sy = wrap.scrollTop;
      wrap.style.cursor = 'grabbing';
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트 등 */ }
      e.preventDefault();
    }
  });

  const hitOtherCx = e => {
    const at = document.elementsFromPoint(e.clientX, e.clientY);
    for (const elx of at) {
      if (elx.classList && elx.classList.contains('cx') && +elx.dataset.id !== drag.cx.id) return elx;
    }
    return null;
  };

  wrap.addEventListener('pointermove', e => {
    if (drag.mode && e.buttons === 0) { endDrag(e); return; }
    if (drag.mode === 'cx' && drag.cx) {
      const pos = canvasPos(e);
      drag.cx.x = Math.max(0, Math.min(2200, pos.x - drag.dx));
      drag.cx.y = Math.max(0, Math.min(1300, pos.y - drag.dy));
      drag.moved = true;
      const card = $('node-layer').querySelector(`.cx[data-id="${drag.cx.id}"]`);
      if (card) { card.style.left = drag.cx.x + 'px'; card.style.top = drag.cx.y + 'px'; }
      // 합체 대상 하이라이트
      const target = hitOtherCx(e);
      if (drag.dropTarget && drag.dropTarget !== target) drag.dropTarget.classList.remove('drop-target');
      drag.dropTarget = target;
      if (target) target.classList.add('drop-target');
      layoutEdges();
    } else if (drag.mode === 'edge') {
      const a = portAnchor(drag.fromCx, drag.fromItem, 'out');
      const b = canvasPos(e);
      const pending = $('pending-edge');
      if (a && pending) pending.setAttribute('d', edgePath(a, b));
    } else if (drag.mode === 'inode' && drag.if) {
      const pos = iPos(e);
      drag.if.ix = Math.max(0, Math.min(1250, pos.x - drag.dx));
      drag.if.iy = Math.max(0, Math.min(620, pos.y - drag.dy));
      const node = iSpaceEl?.querySelector(`.inode[data-fid="${drag.if.id}"]`);
      if (node) { node.style.left = drag.if.ix + 'px'; node.style.top = drag.if.iy + 'px'; }
      layoutIEdges();
    } else if (drag.mode === 'iedge') {
      const a = iPortAnchor(drag.fromF, drag.fromItem, 'out');
      const b = iPos(e);
      const pending = document.getElementById('pending-iedge');
      if (a && pending) pending.setAttribute('d', edgePath(a, b));
    } else if (drag.mode === 'ipan' && drag.iWrap) {
      drag.iWrap.scrollLeft = drag.sx - (e.clientX - drag.px);
      drag.iWrap.scrollTop = drag.sy - (e.clientY - drag.py);
    } else if (drag.mode === 'pan') {
      wrap.scrollLeft = drag.sx - (e.clientX - drag.px);
      wrap.scrollTop = drag.sy - (e.clientY - drag.py);
    }
  });

  const endDrag = e => {
    if (drag.mode === 'edge') {
      $('pending-edge')?.remove();
      const at = document.elementFromPoint(e.clientX, e.clientY);
      const dot = at && at.closest ? (at.closest('.port .dot') || at.closest('.port')?.querySelector('.dot')) : null;
      if (dot && dot.dataset.dir === 'in' && dot.dataset.cx != null) {
        addEdge(drag.fromCx, drag.fromItem, +dot.dataset.cx, dot.dataset.item);
      }
    }
    if (drag.mode === 'iedge') {
      document.getElementById('pending-iedge')?.remove();
      const at = document.elementFromPoint(e.clientX, e.clientY);
      const dot = at && at.closest
        ? (at.closest('.inode .port .dot') || at.closest('.inode .port')?.querySelector('.dot')) : null;
      if (dot && dot.dataset.dir === 'in' && dot.dataset.ifid != null && drag.iCx) {
        const toF = dot.dataset.ifid === 'out' ? 'out' : +dot.dataset.ifid;
        addIEdge(drag.iCx, drag.fromF, drag.fromItem, toF, dot.dataset.item);
      }
    }
    if (drag.mode === 'inode' && drag.if) {
      const node = iSpaceEl?.querySelector(`.inode[data-fid="${drag.if.id}"]`);
      if (node) node.classList.remove('dragging');
      save();
    }
    if (drag.mode === 'cx' && drag.cx) {
      const card = $('node-layer').querySelector(`.cx[data-id="${drag.cx.id}"]`);
      if (card) card.classList.remove('dragging');
      if (drag.dropTarget) {
        const dstId = +drag.dropTarget.dataset.id;
        drag.dropTarget.classList.remove('drop-target');
        drag.dropTarget = null;
        mergeComplex(drag.cx.id, dstId);
      } else if (!drag.moved) {
        // 클릭 = 고정 펼침 토글
        focusedCx = focusedCx === drag.cx.id ? null : drag.cx.id;
        rebuild();
      } else save();
    }
    if (drag.mode === 'pan') wrap.style.cursor = '';
    drag.mode = null;
    drag.cx = null;
    if (drag.pendingRebuild) { drag.pendingRebuild = false; rebuild(); }
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const old = zoomOf();
    const z = Math.min(1.6, Math.max(0.4, old * Math.exp(-e.deltaY * 0.0012)));
    if (Math.abs(z - old) < 1e-4) return;
    const rect = wrap.getBoundingClientRect();
    const cx0 = e.clientX - rect.left, cy0 = e.clientY - rect.top;
    const px = (wrap.scrollLeft + cx0) / old, py = (wrap.scrollTop + cy0) / old;
    state.zoom = z;
    applyZoom();
    layoutEdges();
    wrap.scrollLeft = px * z - cx0;
    wrap.scrollTop = py * z - cy0;
  }, { passive: false });

  document.addEventListener('pointerdown', ev => {
    if (edgeMenu && !edgeMenu.contains(ev.target)) closeEdgeMenu();
  }, true);

  // 줌 버튼 (모바일·터치 대응 — 휠과 같은 로직, 화면 중앙 기준)
  const zoomBy = mult => {
    const old = zoomOf();
    const z = Math.min(1.6, Math.max(0.4, old * mult));
    if (Math.abs(z - old) < 1e-4) return;
    const rect = wrap.getBoundingClientRect();
    const cx0 = rect.width / 2, cy0 = rect.height / 2;
    const px = (wrap.scrollLeft + cx0) / old, py = (wrap.scrollTop + cy0) / old;
    state.zoom = z;
    applyZoom();
    layoutEdges();
    wrap.scrollLeft = px * z - cx0;
    wrap.scrollTop = py * z - cy0;
    save();
  };
  $('zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => zoomBy(0.8));
}

/* ---------- 조립 ---------- */
function rebuild() {
  if (drag.mode) { drag.pendingRebuild = true; return; }
  updaters = [];
  buildTutorial();
  buildMilestone();
  buildContracts();
  buildGather();
  buildHand();
  buildShop();
  buildResearch();
  buildFactoryBar();
  buildCanvas();
  buildStock();
  buildPower();
}
function update() {
  if (state.biz) { refreshExcel(); return; } // 업무 모드 중엔 시트만 갱신 (게임 UI는 덮여 있음)
  if (!drag.mode && visibleStock().join(',') !== stockKeys) { rebuild(); return; }
  for (const fn of updaters) fn();
}

/* ---------- 시작 ---------- */
function init() {
  state = load() || freshState();
  for (const cx of state.cx) ensureWired(cx); // 구 저장 자동 배선 (신규 배선엔 state.seq 필요)
  // 일회성 보정: 초기 마이그레이션이 Mk.1로 깔았던 내부 배선을 처리량에 맞게 승급
  if (!state.iedgeTierFix) {
    for (const cx of state.cx) {
      for (const e of cx.iedges) e.tier = Math.max(e.tier || 1, tierForRate(iedgeRate(cx, e)));
    }
    state.iedgeTierFix = true;
  }

  const offlineCap = (4 + 4 * rlv('offline')) * 3600; // 연구로 연장
  const elapsedSec = Math.min(offlineCap, (Date.now() - (state.savedAt || Date.now())) / 1000);
  if (elapsedSec > 10) {
    const steps = Math.floor(elapsedSec / 5);
    for (let i = 0; i < steps; i++) tick(5 / 60);
    showBanner(`⏰ 오프라인 ${Math.floor(elapsedSec / 60)}분 동안 단지가 가동됐습니다.`, 6000);
  }
  if (state.won) showBanner('🎉 프로젝트 조립 완료! FICSIT이 매우 만족했습니다.');

  document.addEventListener('pointerdown', () => {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 무시 */ } }
  }, { once: true });
  const muteBtn = $('btn-mute');
  const refreshMute = () => { muteBtn.textContent = state.muted ? '🔇' : '🔊'; };
  muteBtn.addEventListener('click', () => { state.muted = !state.muted; refreshMute(); save(); });
  refreshMute();

  // 업무 모드 (보스 키): 가짜 엑셀 전체 화면, F9 로 즉시 전환 (엑셀 안 Esc 도 복귀)
  buildExcel();
  $('btn-biz').addEventListener('click', () => { state.biz = !state.biz; applyBiz(); save(); });
  document.addEventListener('keydown', e => {
    // 엑셀 내부 입력 요소에서는 전역 단축키 무시
    if (e.target && e.target.closest && e.target.closest('#excel')
      && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'F9' || (e.key === 'Escape' && state.biz)) {
      e.preventDefault();
      state.biz = !state.biz;
      applyBiz();
      save();
    }
  });
  applyBiz();

  // 게임 속도 (×1 ~ ×100)
  const spdSel = $('speed');
  for (const s of [1, 2, 5, 10, 25, 50, 100]) {
    const opt = el('option', null, '⏩ ×' + s);
    opt.value = s;
    spdSel.append(opt);
  }
  spdSel.value = state.speed || 1;
  spdSel.addEventListener('change', () => { state.speed = +spdSel.value; save(); });

  initCanvasEvents();
  rebuild();
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const realMin = Math.min(10000, now - lastTick) / 60000;
    lastTick = now;
    // 고배속에서도 시뮬 정확도를 유지하도록 큰 틱을 잘게 쪼개 실행
    let dt = realMin * (state.speed || 1);
    const MAX_STEP = 0.06; // 게임-분
    let guard = 0;
    while (dt > 1e-9 && guard++ < 300) {
      const step = Math.min(dt, MAX_STEP);
      tick(step);
      dt -= step;
    }
    update();
  }, 200);
  setInterval(save, 10000);

  $('btn-save').addEventListener('click', () => save());
  $('btn-export').addEventListener('click', () => {
    save();
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `satisfactory-complex-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!s || !Array.isArray(s.cx)) { alert('단지 설계 파일이 아닙니다.'); return; }
      if (!confirm('현재 진행을 이 파일로 덮어쓸까요?')) return;
      state = withDefaults(s);
      for (const cx of state.cx) ensureWired(cx);
      state.savedAt = Date.now();
      save();
      $('banner').hidden = true;
      rebuild();
    } catch (e) { alert('파일을 읽을 수 없습니다: ' + e.message); }
  });
  $('btn-reset').addEventListener('click', () => {
    if (confirm('정말 처음부터 다시 시작할까요? 저장이 삭제됩니다.')) {
      localStorage.removeItem(SAVE_KEY);
      state = freshState();
      focusedCx = null;
      $('banner').hidden = true;
      rebuild();
    }
  });
}
init();
