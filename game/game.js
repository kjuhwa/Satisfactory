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
// 채굴기 티어 (실제 속도·전력). 같은 매장지에서 더 뽑는 수단
const MINERS = {
  1: { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  2: { build: 'Desc_MinerMk2_C', rate: 120, power: 12 },
  3: { build: 'Desc_MinerMk3_C', rate: 240, power: 30 },
};
const MINER = MINERS[1];
const minerTierUnlocked = t => t === 1 || (t === 2 && state.ms >= 4) || (t === 3 && state.ms >= 6);
const GENS = {
  coal: { build: 'Desc_GeneratorCoal_C', power: 75,  burns: [['Desc_Coal_C', 15], ['Desc_Water_C', 45]] },
  fuel: { build: 'Desc_GeneratorFuel_C', power: 250, burns: [['Desc_LiquidFuel_C', 20]] },
  nuclear: {
    build: 'Desc_GeneratorNuclear_C', power: 2500,
    burns: [['Desc_NuclearFuelRod_C', 0.2], ['Desc_Water_C', 240]],
    wastes: [['Desc_NuclearWaste_C', 10]], // 폐기물이 안 빠지면 발전 정지
  },
};
const BASE_POWER = 20;
const BUF_CAP = 100; // 포트 버퍼 용량 (기계 1대당)

// 컨베이어 벨트 티어 (실제 1.0 용량). Mk.1은 무료, 업그레이드는 재료 소모
const BELT_TIERS = [null,
  { cap: 60,  cost: {} },
  { cap: 120, cost: { Desc_IronPlateReinforced_C: 5 } },
  { cap: 270, cost: { Desc_SteelPlate_C: 5 } },
  { cap: 480, cost: { Desc_SteelPlateReinforced_C: 5 } },
  { cap: 780, cost: { Desc_AluminumPlate_C: 10 } },
];
const beltOf = e => BELT_TIERS[e.tier || 1];

// 자원 매장지: 순도별 슬롯 수 (기계 1대 = 매장지 1개 점유). null = 무한(물)
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

// AWESOME 싱크 · 오버클럭
const SHARD = 'Desc_CrystalShard_C';
const POWER_EXP = 1.321929; // 실제 오버클럭 전력 지수
const ptsOf = cn => (D.items[cn] && D.items[cn].pts) || 0;
const couponCost = k => 500 * (k + 1) * (k + 2) / 2; // k번째 쿠폰 비용 (점증)
const clockOf = n => n.clock || 100;
const shardsFor = clock => Math.max(0, Math.ceil((clock - 100) / 50));
const lockedAlts = () => D.recipes.filter(r => r.alt && !state.altUnlocked.includes(r.id));

function depositsLeft(resource, purity) {
  const pool = DEPOSITS[resource];
  if (!pool) return Infinity; // 물 등 무한 자원
  const total = pool[purity] || 0;
  let used = 0;
  for (const n of state.nodes) {
    if (n.type === 'miner' && n.resource === resource && (n.purity || 'normal') === purity) {
      used += n.count;
    }
  }
  return Math.max(0, total - used);
}

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
  { name: '기초 강철', desc: '주조소 · 채굴기 Mk.2(120/분) 해금',
    cost: { Desc_Cement_C: 100, Desc_Rotor_C: 20, Desc_ModularFrame_C: 10 },
    apply: s => { s.machines.push('Desc_FoundryMk1_C'); } },
  { name: '석유 정제', desc: '정제소 · 패키저 · 원유 추출기 · 연료 발전기 해금',
    cost: { Desc_SteelPlate_C: 50, Desc_SteelPipe_C: 100, Desc_SteelPlateReinforced_C: 20 },
    apply: s => { s.machines.push('Desc_OilRefinery_C', 'Desc_Packager_C'); s.gensUnlocked.push('fuel'); s.raws.push('Desc_LiquidOil_C'); } },
  { name: '고급 제조', desc: '제조기 · 채굴기 Mk.3(240/분) 해금 + 카테리움 · 원시 수정 · 유황 채굴',
    cost: { Desc_Motor_C: 20, Desc_Plastic_C: 100, Desc_Rubber_C: 100, Desc_SteelPlate_C: 100 },
    apply: s => { s.machines.push('Desc_ManufacturerMk1_C'); s.raws.push('Desc_OreGold_C', 'Desc_RawQuartz_C', 'Desc_Sulfur_C'); } },
  { name: '첨단 소재', desc: '블렌더 · 입자 가속기 · 변환기 · 양자 인코더 · 원자력 발전소 + 보크사이트 · 우라늄 · SAM · 질소 해금',
    cost: { Desc_Computer_C: 20, Desc_ModularFrameHeavy_C: 10, Desc_Motor_C: 50 },
    apply: s => {
      s.machines.push('Desc_Blender_C', 'Desc_HadronCollider_C', 'Desc_Converter_C', 'Desc_QuantumEncoder_C');
      s.raws.push('Desc_OreBauxite_C', 'Desc_OreUranium_C', 'Desc_SAM_C', 'Desc_NitrogenGas_C');
      s.gensUnlocked.push('nuclear');
    } },
  { name: '프로젝트 조립: 1단계', desc: '궤도 엘리베이터로 첫 부품을 발사합니다 (보상: 쿠폰 10장)',
    cost: { Desc_SpaceElevatorPart_1_C: 50, Desc_SpaceElevatorPart_2_C: 50, Desc_SpaceElevatorPart_3_C: 50 },
    apply: s => { s.coupons += 10; } },
  { name: '프로젝트 조립: 2단계', desc: '부품 수요가 커집니다 — 라인 증설 필요 (보상: 쿠폰 15장)',
    cost: { Desc_SpaceElevatorPart_1_C: 150, Desc_SpaceElevatorPart_2_C: 150, Desc_SpaceElevatorPart_3_C: 50 },
    apply: s => { s.coupons += 15; } },
  { name: '프로젝트 조립: 3단계', desc: '모듈 엔진 · 적응형 제어 장치 생산 (보상: 쿠폰 20장)',
    cost: { Desc_SpaceElevatorPart_2_C: 300, Desc_SpaceElevatorPart_4_C: 100, Desc_SpaceElevatorPart_5_C: 50 },
    apply: s => { s.coupons += 20; } },
  { name: '프로젝트 조립: 4단계', desc: '최상위 부품 4종 — 원자력·알루미늄 체인 총동원 (보상: 쿠폰 30장)',
    cost: { Desc_SpaceElevatorPart_6_C: 100, Desc_SpaceElevatorPart_7_C: 100,
            Desc_SpaceElevatorPart_8_C: 50, Desc_SpaceElevatorPart_9_C: 50 },
    apply: s => { s.coupons += 30; } },
  { name: '프로젝트 조립: 5단계', desc: '차원 너머로 — 최종 목표!',
    cost: { Desc_SpaceElevatorPart_10_C: 50, Desc_SpaceElevatorPart_11_C: 25, Desc_SpaceElevatorPart_12_C: 50 },
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
    sinkPts: 0,
    coupons: 0,
    couponsPrinted: 0,
    altUnlocked: [],
    auto: { buy: false, ms: false, belt: false, shard: false },
    savedAt: Date.now(),
  };
}

function withDefaults(s) {
  // 손상되거나 손으로 만든 저장을 가져와도 게임이 멈추지 않도록 최소 형태를 보장
  const fresh = freshState();
  for (const k of ['nodes', 'edges', 'machines', 'raws', 'gensUnlocked', 'altUnlocked']) {
    if (!Array.isArray(s[k])) s[k] = fresh[k];
  }
  if (!s.stock || typeof s.stock !== 'object') s.stock = {};
  if (!s.gens || typeof s.gens !== 'object') s.gens = { coal: 0, fuel: 0 };
  if (typeof s.ms !== 'number' || !isFinite(s.ms)) s.ms = 0;
  if (typeof s.seq !== 'number' || !isFinite(s.seq)) {
    s.seq = Math.max(1, ...s.nodes.map(n => n.id || 0), ...s.edges.map(e => e.id || 0)) + 1;
  }
  for (const n of s.nodes) if (!n.buf || typeof n.buf !== 'object') n.buf = { in: {}, out: {} };

  s.auto = { buy: false, ms: false, belt: false, shard: false, ...(s.auto || {}) };
  s.sinkPts ??= 0;
  s.coupons ??= 0;
  s.couponsPrinted ??= 0;
  // 마일스톤이 확장되어, 이전 최종(1단계) 클리어 저장은 계속 진행
  s.won = s.ms >= MS.length;
  // 첨단 소재(ms7)를 이미 달성한 저장에 원자력 해금 소급 적용
  if (s.ms >= 7 && Array.isArray(s.gensUnlocked) && !s.gensUnlocked.includes('nuclear')) {
    s.gensUnlocked.push('nuclear');
  }
  if (!Array.isArray(s.altUnlocked)) {
    // 구버전 저장: 이미 사용 중인 대체 레시피는 해금된 것으로 인정
    s.altUnlocked = [];
    for (const n of s.nodes || []) {
      if (n.type === 'machine') {
        const r = recipeById[n.recipeId];
        if (r && r.alt && !s.altUnlocked.includes(r.id)) s.altUnlocked.push(r.id);
      }
    }
  }
  return s;
}

const stockOf = cn => state.stock[cn] || 0;
const addStock = (cn, n) => { state.stock[cn] = Math.max(0, stockOf(cn) + n); };
const canAfford = cost => Object.entries(cost).every(([cn, n]) => stockOf(cn) >= n);
const pay = cost => { for (const [cn, n] of Object.entries(cost)) addStock(cn, -n); };
const refund = cost => { for (const [cn, n] of Object.entries(cost)) addStock(cn, n); };
const buildCost = cn => Object.fromEntries(D.build[cn]);

function save(opts = {}) {
  state.savedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  Cloud.push(state, opts);   // 서버에도 반영 (서버 없으면 무시)
}

function migrateSidebarGens(s) {
  // 사이드바 발전기(전역 재고 소모 방식) → 캔버스 노드 방식으로 이전: 비용 전액 환불
  if (!s.gens) { s.gens = { coal: 0, fuel: 0 }; return; }
  for (const [key, count] of Object.entries(s.gens)) {
    if (count > 0 && GENS[key]) {
      for (const [cn, n] of Object.entries(buildCost(GENS[key].build))) {
        addToStock(s.stock, cn, n * count);
      }
      s._genMigrated = true;
    }
    s.gens[key] = 0;
  }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.nodes)) { migrateSidebarGens(s); return withDefaults(s); }
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
      migrateSidebarGens(s2);
      s2._migrated = true;
      return withDefaults(s2);
    }
  } catch (e) { /* 손상된 저장은 무시 */ }
  return null;
}
function addToStock(stock, cn, n) { stock[cn] = (stock[cn] || 0) + n; }

/* ---------- 노드 정의 ---------- */
const nodeById = id => state.nodes.find(n => n.id === id);

function nodeDef(n) {
  if (n.type === 'miner') {
    const def = EXT[n.resource] || MINERS[n.tier || 1];
    const mult = PURITY[n.purity || 'normal'].mult;
    const c = clockOf(n) / 100;
    return {
      label: (def.label || D.xnames[def.build]),
      iconCn: n.resource,
      ins: [],
      outs: [{ item: n.resource, rate: def.rate * mult * c }],
      power: def.power * Math.pow(c, POWER_EXP),
      cost: buildCost(def.build),
    };
  }
  if (n.type === 'machine') {
    const r = recipeById[n.recipeId];
    const c = clockOf(n) / 100;
    return {
      label: (r.alt ? '★ ' : '') + r.ko,
      iconCn: r.out[0][0],
      ins: r.in.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) * c })),
      outs: r.out.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) * c })),
      power: linePower(r) * Math.pow(c, POWER_EXP),
      cost: buildCost(r.machine),
      machine: r.machine,
    };
  }
  if (n.type === 'awesink') {
    return { label: 'AWESOME 싱크', iconCn: SHARD, ins: [], outs: [], power: 30, cost: {} };
  }
  if (n.type === 'gen') {
    const g = GENS[n.genKey];
    return {
      label: D.xnames[g.build],
      iconCn: g.build,
      ins: g.burns.map(([cn, rate]) => ({ item: cn, rate })),
      outs: (g.wastes || []).map(([cn, rate]) => ({ item: cn, rate })),
      power: 0,
      produces: g.power,
      cost: buildCost(g.build),
    };
  }
  return { label: '출하 (재고로)', iconCn: null, ins: [], outs: [], power: 0, cost: {} }; // sink
}

/* ---------- 시뮬레이션 ---------- */
let lastRates = {};
let lastPower = { supply: BASE_POWER, demand: 0, eff: 1 };
let lastEdgeFlow = {}; // edgeId -> 이번 틱에 아이템이 흘렀는지 (연결선 애니메이션용)

/**
 * 이 노드에 물린 벨트가 이미 꽉 차 있으면 그 합계 용량을 돌려준다 (아니면 null).
 *
 * 벨트가 한계면 상류 기계를 늘려 봐야 아무 소용이 없다. 예전에는 이걸 구분하지 않고
 * "이전 단계 생산을 늘리세요" 라고만 해서, 물 추출기를 16대까지 늘리다 전력이 무너지는
 * 일이 생겼다 (물은 남아돌고 벨트가 못 나르던 것이다).
 *
 * 지난 틱의 흐름을 쓴다 — 진단 문구라 한 틱 늦어도 상관없다.
 */
function beltCapped(nodeId, item, dir) {
  const edges = state.edges.filter(e => dir === 'in'
    ? (e.to.node === nodeId && e.to.item === item)
    : (e.from.node === nodeId && e.from.item === item));
  if (!edges.length) return null;
  let cap = 0;
  for (const e of edges) {
    const c = beltOf(e).cap;
    if ((lastEdgeFlow[e.id] || 0) < c * 0.98) return null;  // 여유 있는 벨트가 하나라도 있으면 벨트 탓이 아니다
    cap += c;
  }
  return cap;
}

/** 벨트가 병목일 때 쓰는 안내 — 지금 용량과 필요량을 같이 적는다 */
const beltWhy = (item, cap, need) =>
  `벨트 한계: ${iname(item)} ${fmtN(cap)}/분 → ${fmtN(need)}/분 필요 — 연결선을 클릭해 업그레이드하거나 하나 더 이으세요`;

/**
 * 버퍼가 말라 가는 입력을 미리 찾아낸다.
 *
 * 이 게임에서 제일 잔인한 순간은 "잘 되다가 갑자기" 무너지는 것이다.
 * 들어오는 양보다 쓰는 양이 많아도 버퍼가 남아 있는 동안은 100% 로 보인다.
 * 버퍼가 마르는 순간 발전량이 떨어지고, 전력이 모자라면 상류(물 추출기)가 더 느려져
 * 더 떨어지는 되먹임이 돈다. 한 번 넘어가면 스스로 못 돌아온다.
 *
 * 그래서 아직 100% 로 돌고 있을 때 "몇 분 뒤에 멈춘다" 를 미리 말해 준다.
 * 무너진 뒤에 원인을 알려 주는 것은 늦다.
 */
function drainWarn(n) {
  if (n.paused || n.count <= 0) return null;
  const def = nodeDef(n);
  if (!def.ins || !def.ins.length) return null;
  let worst = null;
  for (const p of def.ins) {
    const use = p.rate * n.count * (n.eff ?? 1);          // 지금 쓰고 있는 양 (분당)
    if (use <= 0) continue;
    const inflow = state.edges
      .filter(e => e.to.node === n.id && e.to.item === p.item)
      .reduce((a, e) => a + (lastEdgeFlow[e.id] || 0), 0);
    const deficit = use - inflow;
    if (deficit <= use * 0.02) continue;                  // 오차 수준은 무시
    const buf = n.buf.in[p.item] || 0;
    if (buf <= 0) continue;                               // 이미 말랐으면 경고가 아니라 현상이다
    const mins = buf / deficit;
    if (mins > 10) continue;                              // 아직 멀었으면 잔소리다
    if (!worst || mins < worst.mins) worst = { mins, item: p.item, inflow, use, deficit };
  }
  if (!worst) return null;
  return `${iname(worst.item)} 적자 ${fmtN(worst.deficit)}/분 `
    + `(들어옴 ${fmtN(worst.inflow)} · 씀 ${fmtN(worst.use)}) — `
    + `약 ${worst.mins < 1 ? '1분 안에' : Math.round(worst.mins) + '분 뒤'} 멈춥니다`;
}

function tick(dtMin) {
  const prev = { ...state.stock };
  const hasInEdge = (id, item) => state.edges.some(e => e.to.node === id && e.to.item === item);
  const hasOutEdge = (id, item) => state.edges.some(e => e.from.node === id && e.from.item === item);

  // 1) 발전기 노드: 입력 버퍼의 연료만큼 가동 (전력망과 무관하게 동작)
  let supply = BASE_POWER;
  for (const n of state.nodes) {
    if (n.type !== 'gen') continue;
    if (n.paused) { n.eff = 0; n.why = '일시 중지 — 연료를 쓰지 않습니다'; continue; }
    if (n.count <= 0) { n.eff = 0; n.why = '기계 없음 — + 로 구매'; continue; }
    const g = GENS[n.genKey];
    let frac = 1;
    let limit = null;
    let limitKind = null;
    let limitNeed = 0;            // 분당 필요량 (벨트 안내에 쓴다)
    for (const [cn, rate] of g.burns) {
      const need = rate * n.count * dtMin;
      if (need > 0) {
        const f = (n.buf.in[cn] || 0) / need;
        if (f < frac) { frac = f; limit = cn; limitKind = 'in'; limitNeed = rate * n.count; }
      }
    }
    const gcap = BUF_CAP * n.count;
    for (const [cn, rate] of (g.wastes || [])) {
      const need = rate * n.count * dtMin;
      if (need > 0) {
        const f = Math.max(0, gcap - (n.buf.out[cn] || 0)) / need;
        if (f < frac) { frac = f; limit = cn; limitKind = 'out'; limitNeed = rate * n.count; }
      }
    }
    frac = Math.min(1, Math.max(0, frac));
    for (const [cn, rate] of g.burns) {
      n.buf.in[cn] = Math.max(0, (n.buf.in[cn] || 0) - rate * n.count * dtMin * frac);
    }
    for (const [cn, rate] of (g.wastes || [])) {
      n.buf.out[cn] = (n.buf.out[cn] || 0) + rate * n.count * dtMin * frac;
    }
    supply += g.power * n.count * frac;
    n.eff = frac;
    if (frac >= 0.99 || !limit) {
      n.why = null;
    } else if (limitKind === 'in') {
      const cap = beltCapped(n.id, limit, 'in');
      n.why = !hasInEdge(n.id, limit) ? `입력 미연결: ${iname(limit)} — 입력 포트를 연결하세요`
        : cap != null ? beltWhy(limit, cap, limitNeed)
        : `연료 부족: ${iname(limit)} — 이전 단계 생산을 늘리세요`;
    } else {
      const cap = beltCapped(n.id, limit, 'out');
      n.why = !hasOutEdge(n.id, limit) ? `출력 미연결: ${iname(limit)} — 폐기물 처리 라인이 필요합니다`
        : cap != null ? beltWhy(limit, cap, limitNeed)
        : `출력 정체: ${iname(limit)} — 폐기물 처리를 늘리세요`;
    }
  }

  // 2) 수요 · 전력 효율
  // 일시 중지한 노드는 전력을 먹지 않는다. 이게 이 기능의 전부다 —
  // 전력이 모자라 물 추출기가 느려지고, 물이 안 와서 발전기가 멈추고,
  // 그래서 전력이 더 모자라지는 고리는 "덜 급한 기계를 꺼서" 밖에 못 끊는다.
  let demand = 0;
  for (const n of state.nodes) if (!n.paused) demand += nodeDef(n).power * n.count;
  const powerEff = demand > 0 ? Math.min(1, supply / demand) : 1;

  // 3) 연결선으로 아이템 이동 (출력 버퍼 → 입력 버퍼 / 출하 = 재고 / 싱크 = 포인트)
  lastEdgeFlow = {};
  for (const n of state.nodes) if (n.type === 'awesink') n.ptsRate = 0;
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
      const beltMax = beltOf(e).cap * dtMin; // 벨트 티어 용량 제한
      let moved;
      if (dst.type === 'sink') {
        moved = Math.min(share, beltMax);
        addStock(item, moved);
      } else if (dst.type === 'awesink') {
        // 0포인트 아이템(핵폐기물·유체 등)은 소각 불가 — 실제 게임과 동일
        moved = ptsOf(item) > 0 ? Math.min(share, beltMax) : 0;
        state.sinkPts += moved * ptsOf(item);
        dst.ptsRate = (dst.ptsRate || 0) + moved * ptsOf(item) / dtMin;
      } else {
        const cap = BUF_CAP * Math.max(1, dst.count);
        const space = cap - (dst.buf.in[item] || 0);
        moved = Math.min(share, beltMax, Math.max(0, space));
        dst.buf.in[item] = (dst.buf.in[item] || 0) + moved;
      }
      from.buf.out[item] -= moved;
      lastEdgeFlow[e.id] = moved / dtMin; // 분당 흐름량
    }
  }
  // 쿠폰 자동 발행
  while (state.sinkPts >= couponCost(state.couponsPrinted)) {
    state.sinkPts -= couponCost(state.couponsPrinted);
    state.couponsPrinted++;
    state.coupons++;
    sfx('coupon');
  }

  // 4) 채굴기 노드: 출력 버퍼 공간만큼 생산 (막히면 정지 = 배압)
  for (const n of state.nodes) {
    if (n.type !== 'miner') continue;
    if (n.paused) { n.eff = 0; n.why = '일시 중지 — 전력을 쓰지 않습니다'; continue; }
    if (n.count <= 0) { n.eff = 0; n.why = '기계 없음 — + 로 구매'; continue; }
    const def = nodeDef(n);
    const out = def.outs[0];
    const cap = BUF_CAP * n.count;
    const want = out.rate * n.count * powerEff * dtMin;
    const space = Math.max(0, cap - (n.buf.out[out.item] || 0));
    const make = Math.min(want, space);
    n.buf.out[out.item] = (n.buf.out[out.item] || 0) + make;
    n.eff = want > 0 ? powerEff * (make / want) : 0;
    n.why = null;
    if (n.eff < 0.99) {
      if (space < want) {
        const cap = beltCapped(n.id, out.item, 'out');
        n.why = !hasOutEdge(n.id, out.item) ? `출력 미연결: ${iname(out.item)} — 출력 포트를 연결하세요`
          : cap != null ? beltWhy(out.item, cap, out.rate * n.count)
          : `출력 정체: ${iname(out.item)} — 다음 단계 기계를 늘리거나 출하로 빼세요`;
      } else if (powerEff < 0.99) {
        n.why = '전력 부족 — 발전기를 늘리세요';
      }
    }
  }

  // 5) 기계 노드: 입력 버퍼 재료 + 출력 공간만큼 가동
  for (const n of state.nodes) {
    if (n.type !== 'machine') continue;
    if (n.paused) { n.eff = 0; n.why = '일시 중지 — 전력을 쓰지 않습니다'; continue; }
    if (n.count <= 0) { n.eff = 0; n.why = '기계 없음 — + 로 구매'; continue; }
    const def = nodeDef(n);
    const run = n.count * powerEff;
    if (run <= 0) { n.eff = 0; n.why = '전력 부족 — 발전기를 늘리세요'; continue; }
    let frac = 1;
    let limit = null; // 가장 크게 발목 잡는 요소
    for (const p of def.ins) {
      const need = p.rate * run * dtMin;
      if (need > 0) {
        const f = (n.buf.in[p.item] || 0) / need;
        if (f < frac) { frac = f; limit = { kind: 'in', item: p.item, need: p.rate * n.count }; }
      }
    }
    const cap = BUF_CAP * n.count;
    for (const p of def.outs) {
      const make = p.rate * run * dtMin;
      if (make > 0) {
        const f = Math.max(0, cap - (n.buf.out[p.item] || 0)) / make;
        if (f < frac) { frac = f; limit = { kind: 'out', item: p.item, need: p.rate * n.count }; }
      }
    }
    frac = Math.min(1, Math.max(0, frac));
    for (const p of def.ins) n.buf.in[p.item] = Math.max(0, (n.buf.in[p.item] || 0) - p.rate * run * dtMin * frac);
    for (const p of def.outs) n.buf.out[p.item] = (n.buf.out[p.item] || 0) + p.rate * run * dtMin * frac;
    n.eff = powerEff * frac;
    n.why = null;
    if (n.eff < 0.99) {
      if (limit && frac < powerEff) {
        const belt = beltCapped(n.id, limit.item, limit.kind);
        if (limit.kind === 'in') {
          n.why = !hasInEdge(n.id, limit.item) ? `입력 미연결: ${iname(limit.item)} — 입력 포트를 연결하세요`
            : belt != null ? beltWhy(limit.item, belt, limit.need)
            : `재료 부족: ${iname(limit.item)} — 이전 단계 생산을 늘리세요`;
        } else {
          n.why = !hasOutEdge(n.id, limit.item) ? `출력 미연결: ${iname(limit.item)} — 출력 포트를 연결하세요`
            : belt != null ? beltWhy(limit.item, belt, limit.need)
            : `출력 정체: ${iname(limit.item)} — 다음 단계 기계를 늘리거나 출하로 빼세요`;
        }
      } else if (powerEff < 0.99) {
        n.why = '전력 부족 — 발전기를 늘리세요';
      }
    }
  }

  // 6) 아직 멀쩡해 보이지만 버퍼가 말라 가는 곳을 미리 알린다
  for (const n of state.nodes) n.warn = drainWarn(n);

  const keys = new Set([...Object.keys(prev), ...Object.keys(state.stock)]);
  lastRates = {};
  for (const cn of keys) lastRates[cn] = ((state.stock[cn] || 0) - (prev[cn] || 0)) / dtMin;
  lastPower = { supply, demand, eff: powerEff };

  autoStep(); // 자동화도 시뮬레이션의 일부 — 오프라인 진행 중에도 동작
}

/* ---------- 자동화 ---------- */
const AUTO_OPTS = [
  { key: 'buy',   label: '기계 자동 구매',       desc: '각 노드의 🎯 목표 대수까지 재고로 알아서 구매' },
  { key: 'ms',    label: '마일스톤 자동 달성',   desc: '재료가 모이는 즉시 다음 마일스톤 달성' },
  { key: 'belt',  label: '벨트 자동 업그레이드', desc: '용량이 꽉 찬 연결선만 다음 티어로 업그레이드' },
  { key: 'shard', label: '동력 조각 자동 구매',  desc: '쿠폰 3장이 모이면 동력 조각으로 교환' },
];
let autoNeedsRebuild = false;   // 해금·벨트 티어처럼 화면을 다시 그려야 하는 변화

function autoStep() {
  const a = state.auto;
  if (!a) return;

  // 1) 목표 대수까지 기계 구매 (틱당 노드별 1대 — 재고를 한 번에 비우지 않도록)
  if (a.buy) {
    for (const n of state.nodes) {
      if (n.type === 'sink' || n.type === 'awesink') continue;
      if (n.paused) continue;   // 멈춰 둔 노드에 재고를 쓰지 않는다
      if (n.count >= (n.want || 0)) continue;
      if (n.type === 'miner' && depositsLeft(n.resource, n.purity || 'normal') <= 0) continue;
      const cost = nodeDef(n).cost;
      if (!canAfford(cost)) continue;
      pay(cost);
      n.count++;
    }
  }

  // 2) 마일스톤 자동 달성
  if (a.ms && state.ms < MS.length) {
    const m = MS[state.ms];
    if (canAfford(m.cost)) {
      pay(m.cost);
      m.apply(state);
      state.ms++;
      sfx(state.won ? 'won' : 'milestone');
      autoNeedsRebuild = true;
    }
  }

  // 3) 포화된 벨트만 업그레이드 (여유 있는 연결선은 건드리지 않음)
  if (a.belt) {
    for (const e of state.edges) {
      const t = e.tier || 1;
      if (t >= 5) continue;
      if ((lastEdgeFlow[e.id] || 0) < beltOf(e).cap * 0.98) continue;
      const next = BELT_TIERS[t + 1];
      if (!canAfford(next.cost)) continue;
      pay(next.cost);
      e.tier = t + 1;
      autoNeedsRebuild = true;
    }
  }

  // 4) 쿠폰 → 동력 조각 (하드 드라이브는 선택이 필요하므로 자동화하지 않음)
  if (a.shard && state.coupons >= 3) {
    state.coupons -= 3;
    addStock(SHARD, 1);
  }
}

/* ---------- 효과음 (WebAudio 합성, 에셋 없음) ---------- */
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
  osc.start(t0);
  osc.stop(t0 + dur);
}
function sfx(name) {
  if (!state || state.muted || !audioCtx) return;
  try {
    if (name === 'milestone') { beep(523, .18, 0); beep(659, .18, .1); beep(784, .3, .2); }
    else if (name === 'coupon') { beep(880, .1, 0, 'triangle'); beep(1175, .18, .08, 'triangle'); }
    else if (name === 'unlock') { beep(659, .12, 0); beep(880, .25, .09); }
    else if (name === 'won') { [523, 659, 784, 1047, 1319].forEach((f, i) => beep(f, .35, i * .13)); }
  } catch (e) { /* 오디오 실패는 무시 */ }
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
    if (state.won) showBanner('🎉 프로젝트 조립 완료! FICSIT이 매우 만족했습니다. 자유롭게 확장하세요.');
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

/* ---------- 공장 배치 캔버스 ---------- */
const drag = { mode: null, node: null, dx: 0, dy: 0, fromNode: null, fromItem: null, pendingRebuild: false };
let portEls = {}; // "nodeId|item|dir" -> element

const WORLD_W = 8000, WORLD_H = 6000;  // 노드를 놓을 수 있는 최대 범위 (캔버스는 내용에 맞춰 늘어남)
const ZOOM_MIN = 0.2;                  // 공장이 커지면 더 많이 축소할 수 있어야 한다
const zoomOf = () => state.zoom || 1;

function applyZoom() {
  $('canvas-inner').style.transform = `scale(${zoomOf()})`;
}

function canvasPos(e) {
  const rect = $('canvas-inner').getBoundingClientRect();
  const z = zoomOf();
  return { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z };
}

function portAnchor(nodeId, item, dir) {
  const elp = portEls[nodeId + '|' + item + '|' + dir] || portEls[nodeId + '|*|' + dir];
  if (!elp) return null;
  const rect = elp.getBoundingClientRect();
  const cRect = $('canvas-inner').getBoundingClientRect();
  const z = zoomOf();
  return {
    x: (rect.left + rect.width / 2 - cRect.left) / z,
    y: (rect.top + rect.height / 2 - cRect.top) / z,
  };
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
  const sinkLike = dst.type === 'sink' || dst.type === 'awesink';
  if (!sinkLike && toItem !== fromItem) return;              // 같은 아이템 포트만
  const finalToItem = sinkLike ? fromItem : toItem;
  if (fromNode === toNodeId) return;
  if (state.edges.some(e => e.from.node === fromNode && e.from.item === fromItem
      && e.to.node === toNodeId && e.to.item === finalToItem)) return; // 중복 방지
  state.edges.push({ id: state.seq++, from: { node: fromNode, item: fromItem }, to: { node: toNodeId, item: finalToItem } });
  save();
  rebuild();
}

function removeEdge(id) {
  const e = state.edges.find(x => x.id === id);
  if (e) { // 벨트 업그레이드 비용 환불
    for (let t = 2; t <= (e.tier || 1); t++) refund(BELT_TIERS[t].cost);
  }
  state.edges = state.edges.filter(x => x.id !== id);
  save();
  rebuild();
}

function upgradeEdge(id) {
  const e = state.edges.find(x => x.id === id);
  if (!e) return;
  const t = e.tier || 1;
  if (t >= 5 || !canAfford(BELT_TIERS[t + 1].cost)) return;
  pay(BELT_TIERS[t + 1].cost);
  e.tier = t + 1;
  save();
  rebuild();
}

/* 연결선 클릭 시 벨트 메뉴 (업그레이드 / 삭제) */
let edgeMenu = null;
function closeEdgeMenu() {
  if (edgeMenu) { edgeMenu.remove(); edgeMenu = null; }
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
  const flow = lastEdgeFlow[e.id] || 0;
  menu.append(el('div', 'em-line', `용량 ${beltOf(e).cap}/분 · 현재 흐름 ${fmtN(flow)}/분`));
  if (t < 5) {
    const next = BELT_TIERS[t + 1];
    const up = el('button', null, `Mk.${t + 1} 업그레이드 (${next.cap}/분)`);
    up.disabled = !canAfford(next.cost);
    up.addEventListener('click', () => { upgradeEdge(edgeId); closeEdgeMenu(); });
    menu.append(up);
    const chips = chipRow(next.cost);
    chips.refresh();
    const costLine = el('div', 'em-line');
    costLine.append(chips.box);
    menu.append(costLine);
  } else {
    menu.append(el('div', 'em-line', '최고 티어입니다'));
  }
  const del = el('button', 'ghost danger', '연결 삭제' + (t > 1 ? ' (업그레이드 환불)' : ''));
  del.addEventListener('click', () => { removeEdge(edgeId); closeEdgeMenu(); });
  menu.append(del);
  menu.style.left = Math.min(ev.clientX, window.innerWidth - 240) + 'px';
  menu.style.top = Math.min(ev.clientY, window.innerHeight - 180) + 'px';
  document.body.append(menu);
  edgeMenu = menu;
}

/* 노드 오버클럭 메뉴 */
function openClockMenu(ev, nodeId) {
  closeEdgeMenu();
  const n = nodeById(nodeId);
  if (!n) return;
  const menu = el('div', 'edge-menu');
  const head = el('div', 'em-head');
  head.append('⚡ 오버클럭', el('b'));
  menu.append(head);
  const range = el('input');
  range.type = 'range'; range.min = 50; range.max = 250; range.step = 25;
  range.value = clockOf(n);
  menu.append(range);
  const info = el('div', 'em-line');
  const shardInfo = el('div', 'em-line');
  menu.append(info, shardInfo);
  const apply = el('button', null, '적용');
  menu.append(apply);
  const refresh = () => {
    const t = +range.value;
    head.querySelector('b').textContent = t + '%';
    const pMult = Math.pow(t / 100, POWER_EXP);
    info.textContent = `속도 ×${(t / 100).toFixed(2)} · 전력 ×${pMult.toFixed(2)}`;
    const diff = shardsFor(t) - shardsFor(clockOf(n));
    shardInfo.textContent = diff > 0
      ? `동력 조각 ${diff}개 필요 (보유 ${fmtN(stockOf(SHARD))})`
      : diff < 0 ? `동력 조각 ${-diff}개 환불` : '동력 조각 변동 없음';
    apply.disabled = t === clockOf(n) || (diff > 0 && stockOf(SHARD) < diff);
  };
  range.oninput = refresh;
  refresh();
  apply.addEventListener('click', () => {
    const t = +range.value;
    const diff = shardsFor(t) - shardsFor(clockOf(n));
    if (diff > 0 && stockOf(SHARD) < diff) return;
    addStock(SHARD, -diff);
    n.clock = t;
    closeEdgeMenu();
    save();
    rebuild();
  });
  menu.style.left = Math.min(ev.clientX, window.innerWidth - 260) + 'px';
  menu.style.top = Math.min(ev.clientY, window.innerHeight - 200) + 'px';
  document.body.append(menu);
  edgeMenu = menu;
}

/* 하드 드라이브: 잠긴 대체 레시피 3개 중 택1 */
function openAltChoice() {
  const pool = [...lockedAlts()];
  const picks = [];
  while (picks.length < 3 && pool.length) {
    picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
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
      showBanner(`★ ${r.ko} 레시피 해금!`);
      setTimeout(() => { $('banner').hidden = true; }, 4000);
    });
    card.append(b);
  }
  overlay.append(card);
  document.body.append(overlay);
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

/** 새 노드는 지금 보고 있는 화면 안의 빈 자리에 놓는다 (멀리 생겨서 못 찾는 일 방지) */
function spawnXY() {
  const wrap = $('canvas-wrap');
  const z = zoomOf();
  const x0 = Math.round(wrap.scrollLeft / z) + 40;
  const y0 = Math.round(wrap.scrollTop / z) + 40;
  const W = 250, H = 200;
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 10; col++) {
      const x = x0 + col * W, y = y0 + row * H;
      const busy = state.nodes.some(n => Math.abs(n.x - x) < W * 0.8 && Math.abs(n.y - y) < H * 0.8);
      if (!busy) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}

/** 캔버스(및 연결선 SVG)를 노드가 모두 들어가는 크기로 넓힌다.
 *  고정 크기였을 때는 이 범위 밖 노드의 연결선이 SVG 뷰포트 밖이라 보이지 않았다. */
function resizeCanvas() {
  let maxX = 0, maxY = 0;
  for (const n of state.nodes) {
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  const inner = $('canvas-inner');
  inner.style.width = Math.max(2400, maxX + 500) + 'px';
  inner.style.height = Math.max(1400, maxY + 420) + 'px';
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

  // 순도 선택 (남은 매장지 표시, 무한 자원은 숨김)
  const puritySel = $('add-purity');
  let puritySig = '';
  const refreshPurity = () => {
    const pool = DEPOSITS[resSel.value];
    // 열려 있는 드롭다운이 매 틱 초기화되지 않게, 잔량이 실제로 바뀔 때만 재구성
    const sig = resSel.value + '|' + (pool
      ? ['pure', 'normal', 'impure'].map(p => depositsLeft(resSel.value, p)).join(',')
      : 'inf');
    if (sig === puritySig) return;
    puritySig = sig;
    const prev = puritySel.value;
    puritySel.textContent = '';
    if (!pool) { puritySel.style.display = 'none'; return; }
    puritySel.style.display = '';
    for (const p of ['pure', 'normal', 'impure']) {
      if (!(p in pool)) continue;
      const left = depositsLeft(resSel.value, p);
      const opt = el('option', null,
        `${PURITY[p].ko} ×${PURITY[p].mult} (매장지 ${left}/${pool[p]})`);
      opt.value = p;
      opt.disabled = left <= 0;
      puritySel.append(opt);
    }
    if (prev && [...puritySel.options].some(o => o.value === prev && !o.disabled)) {
      puritySel.value = prev;
    } else {
      const firstOk = [...puritySel.options].find(o => !o.disabled);
      if (firstOk) puritySel.value = firstOk.value;
    }
  };
  refreshPurity();

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
      opt.disabled = locked; // 하드 드라이브로 해금 필요
      rSel.append(opt);
    }
    const sel = rSel.selectedOptions[0];
    if (!sel || sel.disabled) {
      const firstOk = [...rSel.options].find(o => !o.disabled);
      if (firstOk) rSel.value = firstOk.value;
    }
  };
  mSel.onchange = () => { fillRecipes(); rebuildBarCosts(); };
  fillRecipes();
  if (prevR && [...rSel.options].some(o => o.value === prevR && !o.disabled)) rSel.value = prevR;
  rSel.onchange = () => rebuildBarCosts();

  // 발전기 선택 (해금 전엔 숨김)
  const genSel = $('add-gen');
  const prevG = genSel.value;
  genSel.textContent = '';
  for (const key of state.gensUnlocked) {
    const g = GENS[key];
    const opt = el('option', null, `${D.xnames[g.build]} (+${g.power}MW)`);
    opt.value = key;
    genSel.append(opt);
  }
  if (prevG && state.gensUnlocked.includes(prevG)) genSel.value = prevG;
  $('gen-bar').style.display = state.gensUnlocked.length > 0 ? '' : 'none';

  // 비용 칩 (선택 기준, 노드 자체는 무료 — 기계 구매는 노드 안의 + 버튼)
  let minerChips = null, machineChips = null, genChips = null;
  const rebuildBarCosts = () => {
    const mc = $('miner-cost');
    mc.textContent = '';
    if (state.miners && resSel.value) {
      const def = EXT[resSel.value] || MINERS[+tierSel.value || 1];
      minerChips = chipRow(buildCost(def.build));
      mc.append(minerChips.box);
    } else minerChips = null;
    const xc = $('machine-cost');
    xc.textContent = '';
    if (rSel.value) {
      machineChips = chipRow(buildCost(recipeById[rSel.value].machine));
      xc.append(machineChips.box);
    } else machineChips = null;
    const gc = $('gen-cost');
    gc.textContent = '';
    if (genSel.value) {
      genChips = chipRow(buildCost(GENS[genSel.value].build));
      gc.append(genChips.box);
    } else genChips = null;
  };
  // 채굴기 티어 선택 (광물 자원 전용 — 물·원유·질소는 추출기 고정)
  const tierSel = $('add-mtier');
  const refreshTier = () => {
    const isOre = !EXT[resSel.value];
    tierSel.style.display = isOre ? '' : 'none';
    if (!isOre) return;
    const prev = tierSel.value;
    tierSel.textContent = '';
    for (const t of [1, 2, 3]) {
      const unlocked = minerTierUnlocked(t);
      const opt = el('option', null,
        (unlocked ? '' : '🔒 ') + `Mk.${t} (${MINERS[t].rate}/분)`);
      opt.value = t;
      opt.disabled = !unlocked;
      tierSel.append(opt);
    }
    if (prev && minerTierUnlocked(+prev)) tierSel.value = prev;
  };
  refreshTier();

  resSel.onchange = () => { refreshPurity(); refreshTier(); rebuildBarCosts(); };
  genSel.onchange = () => rebuildBarCosts();
  tierSel.onchange = () => rebuildBarCosts();
  rebuildBarCosts();

  $('add-miner').onclick = () => {
    if (!state.miners || !resSel.value) return;
    const purity = DEPOSITS[resSel.value] ? (puritySel.value || 'normal') : 'normal';
    const node = { type: 'miner', resource: resSel.value, purity, count: 0 };
    if (!EXT[resSel.value]) node.tier = +tierSel.value || 1;
    addNode(node);
  };
  $('add-node').onclick = () => {
    if (!rSel.value) return;
    addNode({ type: 'machine', recipeId: rSel.value, count: 0 });
  };
  $('add-gen-btn').onclick = () => {
    if (!genSel.value) return;
    addNode({ type: 'gen', genKey: genSel.value, count: 0 });
  };
  $('add-sink').onclick = () => addNode({ type: 'sink', count: 1 });
  const awBtn = $('add-awesink');
  awBtn.style.display = state.ms >= 2 ? '' : 'none';
  awBtn.onclick = () => addNode({ type: 'awesink', count: 1 });
  $('open-plan').onclick = () => openPlanner();
  $('btn-tidy').onclick = () => {
    if (state.nodes.length > 1 && !confirm('모든 노드를 연결 순서대로 재배치할까요? (직접 잡아둔 위치는 사라집니다)')) return;
    tidyLayout();
  };
  $('btn-fit').onclick = () => fitView();
  $('btn-rescue').onclick = () => powerRescue();
  $('btn-resume').onclick = () => {
    const n = state.nodes.filter(x => x.paused).length;
    if (!n) { showBanner('멈춰 둔 노드가 없습니다.'); setTimeout(() => { $('banner').hidden = true; }, 2500); return; }
    for (const x of state.nodes) x.paused = false;
    save(); update();
    showBanner(`▶ ${n}개 노드를 다시 돌립니다.`);
    setTimeout(() => { $('banner').hidden = true; }, 3000);
  };
  const cBtn = $('btn-compact');
  cBtn.onclick = () => { setCompact(!state.compact); cBtn.classList.toggle('on', !!state.compact); };
  cBtn.classList.toggle('on', !!state.compact);

  onUpdate(() => {
    $('add-miner').disabled = !state.miners;
    if (minerChips) minerChips.refresh();
    if (machineChips) machineChips.refresh();
    if (genChips) genChips.refresh();
  });
  // 매장지 잔량 표시 갱신 (기계 구매/판매 시 변동)
  onUpdate(refreshPurity);
}

function buildFactory() {
  closeEdgeMenu();
  applyZoom();
  document.body.classList.toggle('compact', !!state.compact);
  portEls = {};
  const layer = $('node-layer');
  layer.textContent = '';
  const svg = $('edge-svg');
  svg.textContent = '';

  for (const n of state.nodes) {
    const def = nodeDef(n);
    const box = el('div', 'fnode ' + n.type);
    box.style.left = n.x + 'px';
    box.style.top = n.y + 'px';
    box.dataset.id = n.id;

    // 헤더
    const head = el('div', 'fnode-head');
    if (def.iconCn) head.append(iconEl(def.iconCn, 's'));
    head.append(el('span', null, def.label));
    if (n.type === 'miner' && DEPOSITS[n.resource]) {
      const p = n.purity || 'normal';
      head.append(el('span', 'purity purity-' + p, PURITY[p].ko));
    }
    const eff = el('span', 'eff');
    head.append(eff);
    // 일시 중지 토글 — 출하·싱크는 전력을 안 쓰므로 멈출 이유가 없다
    let pauseBtn = null;
    if (n.type !== 'sink' && n.type !== 'awesink') {
      pauseBtn = el('button', 'ghost pause');
      pauseBtn.addEventListener('click', ev => {
        ev.stopPropagation();          // 노드 드래그로 새어 나가지 않게
        n.paused = !n.paused;
        update(); save();
      });
      head.append(pauseBtn);
    }
    box.append(head);
    const whyLine = el('div', 'fnode-why');
    box.append(whyLine);

    // 포트
    const body = el('div', 'fnode-body');
    const insCol = el('div', 'ports in');
    const outsCol = el('div', 'ports out');
    if (n.type === 'sink' || n.type === 'awesink') {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.node = n.id; dot.dataset.item = '*'; dot.dataset.dir = 'in';
      portEls[n.id + '|*|in'] = dot;
      p.append(dot, el('span', null,
        n.type === 'sink' ? '모든 아이템 → 재고' : '아이템 소각 → 포인트 (0P 불가)'));
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
      const noDeposit = () => n.type === 'miner'
        && depositsLeft(n.resource, n.purity || 'normal') <= 0;
      minus.addEventListener('click', () => {
        if (n.count > 0) { n.count--; refund(def.cost); update(); save(); }
      });
      plus.addEventListener('click', () => {
        if (noDeposit()) return;
        if (canAfford(def.cost)) { pay(def.cost); n.count++; update(); save(); }
      });
      foot.append(minus, cnt, plus, el('span', 'hint',
        def.produces ? `+${def.produces}MW/대` : `${fmtN(def.power)}MW/대`));
      // 자동 구매 목표 대수
      const tgt = el('button', 'ghost tgt');
      tgt.addEventListener('click', () => {
        const input = prompt(`${def.label} — 자동 구매 목표 대수 (0 = 자동 구매 안 함)`, n.want || 0);
        if (input === null) return;
        n.want = Math.max(0, Math.floor(Number(input) || 0));
        save();
        update();
      });
      foot.append(tgt);
      onUpdate(() => {
        const want = n.want || 0;
        tgt.textContent = '🎯' + want;
        tgt.classList.toggle('on', want > n.count);
        tgt.title = want > 0
          ? `자동 구매 목표 ${want}대 (현재 ${n.count}대) — 자동화 패널의 "기계 자동 구매"가 켜져 있으면 재료가 모이는 대로 지어집니다`
          : '자동 구매 목표 대수 설정 (클릭)';
      });
      if (n.type === 'miner' || n.type === 'machine') {
        const clk = el('button', 'ghost clk');
        clk.title = '오버클럭 (동력 조각 필요)';
        clk.addEventListener('click', ev => openClockMenu(ev, n.id));
        foot.append(clk);
        onUpdate(() => {
          clk.textContent = '⚡' + clockOf(n) + '%';
          clk.classList.toggle('oc', clockOf(n) !== 100);
        });
      }
      onUpdate(() => {
        cnt.textContent = n.count;
        const blocked = noDeposit();
        plus.disabled = !canAfford(def.cost) || blocked;
        plus.title = blocked ? '남은 매장지가 없습니다' : '';
        minus.disabled = n.count <= 0;
      });
    }
    const dup = el('button', 'ghost', '⧉');
    dup.title = '노드 복제 (레시피·순도·오버클럭 설정 복사, 기계 수는 0부터)';
    dup.addEventListener('click', () => {
      const copy = { type: n.type, count: (n.type === 'sink' || n.type === 'awesink') ? 1 : 0 };
      if (n.type === 'machine') { copy.recipeId = n.recipeId; copy.clock = n.clock; }
      if (n.type === 'miner') {
        copy.resource = n.resource; copy.purity = n.purity;
        copy.tier = n.tier; copy.clock = n.clock;
      }
      if (n.type === 'gen') copy.genKey = n.genKey;
      addNode(copy);
    });
    const del = el('button', 'ghost danger del', '✕');
    del.title = '노드 삭제 (기계 비용 환불)';
    del.addEventListener('click', () => removeNode(n.id));
    foot.append(dup, del);
    box.append(foot);

    // 기계 1대 건설에 필요한 재료 (충족=초록/부족=빨강, 호버 시 보유량)
    if (n.type !== 'sink') {
      const costRow = el('div', 'fnode-cost');
      costRow.append(el('span', 'hint', '건설'));
      const minis = Object.entries(def.cost).map(([cn, need]) => {
        const chip = el('span', 'chip-mini');
        chip.append(iconEl(cn, 's'), el('b', null, need));
        makeCraftLink(chip, cn);
        costRow.append(chip);
        return { chip, cn, need };
      });
      box.append(costRow);
      onUpdate(() => {
        for (const m of minis) {
          const have = stockOf(m.cn);
          m.chip.classList.toggle('ok', have >= m.need);
          m.chip.classList.toggle('no', have < m.need);
          m.chip.title = `${iname(m.cn)} — 보유 ${fmtN(have)} / 필요 ${m.need}`
            + (m.chip.classList.contains('craft') ? ' · 클릭하면 수동 제작 선택' : '');
        }
      });
    }

    onUpdate(() => {
      if (n.type === 'sink' || n.type === 'awesink') {
        eff.textContent = n.type === 'awesink' ? `+${fmtN(n.ptsRate || 0)} P/분` : '';
        eff.style.color = 'var(--good)';
        whyLine.style.display = 'none';
        // 아이템이 들어오는 동안 흡수 애니메이션
        box.classList.toggle('working',
          state.edges.some(e => e.to.node === n.id && (lastEdgeFlow[e.id] || 0) > 1e-6));
        return;
      }
      if (pauseBtn) {
        pauseBtn.textContent = n.paused ? '▶' : '⏸';
        pauseBtn.title = n.paused
          ? '재개 — 다시 전력을 쓰고 생산합니다'
          : '일시 중지 — 전력을 쓰지 않고 멈춥니다 (기계는 그대로 남습니다)';
        pauseBtn.classList.toggle('on', !!n.paused);
      }
      box.classList.toggle('paused', !!n.paused);
      if (n.paused) {
        eff.textContent = '중지';
        eff.style.color = 'var(--muted)';
        whyLine.textContent = `⏸ ${fmtN(nodeDef(n).power * n.count)}MW 를 아끼는 중`;
        whyLine.style.display = '';
        box.classList.remove('working');
        return;
      }
      const pct = Math.round((n.eff || 0) * 100);
      eff.textContent = n.count > 0 ? pct + '%' : '휴면';
      eff.style.color = pct >= 99 ? 'var(--good)' : (n.count > 0 ? 'var(--bad)' : 'var(--muted)');
      // 100% 로 돌고 있어도 버퍼가 말라 가면 알려야 한다 — 그게 이 경고의 존재 이유다
      const why = pct < 99 ? (n.why || '') : '';
      const warn = n.warn || '';
      whyLine.textContent = why ? '⚠ ' + why : (warn ? '⏳ ' + warn : '');
      whyLine.style.display = (why || warn) ? '' : 'none';
      whyLine.classList.toggle('soon', !why && !!warn);
      eff.title = why || warn;
      // 가동 중이면 타입별 애니메이션 (효율이 높을수록 빠르게)
      const working = n.count > 0 && (n.eff || 0) > 0.01;
      box.classList.toggle('working', working);
      if (working) box.style.setProperty('--spd', (0.9 / Math.max(0.25, n.eff)).toFixed(2) + 's');
    });

    layer.append(box);
  }

  // 연결선 (표시용 + 클릭용 넓은 투명 히트 영역)
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
    const t = `${iname(e.from.item)}: ${nodeDef(nodeById(e.from.node))?.label} → ${nodeDef(nodeById(e.to.node))?.label} · Mk.${tier} ${beltOf(e).cap}/분 (클릭: 업그레이드/삭제)`;
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = t;
    hit.append(title);
    hit.addEventListener('click', ev => openEdgeMenu(ev, e.id));
    hit.addEventListener('pointerenter', () => path.classList.add('hover'));
    hit.addEventListener('pointerleave', () => path.classList.remove('hover'));
    svg.append(hit);
  }
  // 아이템이 흐르는 연결선은 컨베이어처럼 점선이 흘러가게
  onUpdate(() => {
    for (const path of svg.querySelectorAll('path.edge')) {
      path.classList.toggle('flow', (lastEdgeFlow[+path.dataset.id] || 0) > 1e-6);
    }
  });
  resizeCanvas();
  layoutEdges();
}

/* ---------- 배치 정리 도구 ---------- */

/**
 * 연결 관계로 각 노드의 단계를 잰다 (0 = 원자재, 클수록 하류).
 * 배치 정리와 전력 회복이 같이 쓴다.
 */
function nodeDepths() {
  const incoming = {};
  for (const n of state.nodes) incoming[n.id] = [];
  for (const e of state.edges) if (incoming[e.to.node]) incoming[e.to.node].push(e.from.node);

  const depth = {};
  for (const n of state.nodes) depth[n.id] = 0;
  // 순환이 있어도 멈추도록 반복 횟수를 노드 수로 제한
  for (let i = 0; i < state.nodes.length + 1; i++) {
    let changed = false;
    for (const n of state.nodes) {
      const d = Math.max(0, ...incoming[n.id].map(id => (depth[id] ?? 0) + 1));
      if (d > depth[n.id]) { depth[n.id] = d; changed = true; }
    }
    if (!changed) break;
  }
  return { depth, incoming };
}

/**
 * 전력이 모자라 스스로는 못 빠져나오는 상태를 푼다.
 *
 * 전력이 모자라면 물 추출기가 느려지고 → 물이 안 와서 발전기가 멈추고 →
 * 전력이 더 모자라진다. 이 고리는 안에서 끊을 수 없다.
 * 그래서 발전기와 그 연료를 만드는 라인만 남기고, 가장 하류부터 멈춘다.
 */
function powerRescue() {
  const { depth, incoming } = nodeDepths();

  // 발전기와 그 연료 공급 라인은 절대 끄지 않는다 — 끄면 영영 못 돌아온다
  const keep = new Set();
  const walkUp = id => {
    if (keep.has(id)) return;
    keep.add(id);
    for (const from of (incoming[id] || [])) walkUp(from);
  };
  for (const n of state.nodes) if (n.type === 'gen') walkUp(n.id);

  const supply = lastPower.supply;
  let demand = 0;
  for (const n of state.nodes) if (!n.paused) demand += nodeDef(n).power * n.count;

  if (demand <= supply) {
    showBanner('⚡ 전력은 이미 넉넉합니다. 멈출 것이 없습니다.');
    setTimeout(() => { $('banner').hidden = true; }, 3000);
    return;
  }

  // 하류(가장 가공된 쪽)부터 끈다. 원자재·연료 라인을 남겨야 회복이 시작된다.
  const victims = state.nodes
    .filter(n => !n.paused && n.count > 0 && n.type !== 'sink' && n.type !== 'awesink' && !keep.has(n.id))
    .sort((a, b) => depth[b.id] - depth[a.id] || b.id - a.id);

  let count = 0, freed = 0;
  for (const n of victims) {
    if (demand <= supply) break;
    const p = nodeDef(n).power * n.count;
    n.paused = true;
    demand -= p; freed += p; count++;
  }

  save(); update();
  showBanner(demand <= supply
    ? `⚡ ${count}개 노드를 멈춰 ${fmtN(freed)}MW 를 확보했습니다. 물·연료가 차면 ▶ 로 하나씩 되살리세요.`
    : `⚡ ${count}개를 멈췄지만 아직 ${fmtN(demand - supply)}MW 모자랍니다 — 발전기 라인 자체가 전력을 넘겨 씁니다. 발전기를 더 지으세요.`);
  setTimeout(() => { $('banner').hidden = true; }, 8000);
}

/** 연결 관계대로 왼→오 단계별 정렬 (원자재 → 가공 → 출하) */
function tidyLayout() {
  const { depth } = nodeDepths();
  // 출하·싱크는 항상 맨 오른쪽 열로
  const maxD = Math.max(0, ...state.nodes.map(n => depth[n.id]));
  for (const n of state.nodes) {
    if (n.type === 'sink' || n.type === 'awesink') depth[n.id] = maxD + 1;
  }

  const colCount = {};
  const ordered = [...state.nodes].sort((a, b) => depth[a.id] - depth[b.id] || a.id - b.id);
  for (const n of ordered) {
    const d = depth[n.id];
    colCount[d] = (colCount[d] ?? 0) + 1;
    n.x = 60 + d * 280;
    n.y = 60 + (colCount[d] - 1) * 200;
  }
  save();
  rebuild();
  fitView();
  showBanner('🧹 연결 순서대로 정리했습니다.');
  setTimeout(() => { $('banner').hidden = true; }, 3000);
}

/** 모든 노드가 한 화면에 들어오도록 확대율·스크롤 조정 */
function fitView() {
  const wrap = $('canvas-wrap');
  const boxes = [...$('node-layer').querySelectorAll('.fnode')];
  if (!boxes.length) return;
  let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
  for (const b of boxes) {
    const n = nodeById(+b.dataset.id);
    if (!n) continue;
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + b.offsetWidth);
    maxY = Math.max(maxY, n.y + b.offsetHeight);
  }
  const pad = 30;
  const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  const z = Math.min(1.5, Math.max(ZOOM_MIN,
    Math.min(wrap.clientWidth / w, wrap.clientHeight / h)));
  state.zoom = z;
  applyZoom();
  resizeCanvas();
  wrap.scrollLeft = Math.max(0, (minX - pad) * z);
  wrap.scrollTop = Math.max(0, (minY - pad) * z);
  save();
}

/** 노드가 많을 때 쓰는 축소 표시 (비용·속도 숨김) */
function setCompact(on) {
  state.compact = !!on;
  document.body.classList.toggle('compact', state.compact);
  layoutEdges();
  save();
}

function initFactoryEvents() {
  const wrap = $('canvas-wrap');
  const svg = $('edge-svg');

  // 포트는 점이 작으므로 행 전체를 드래그 시작/드롭 대상으로 허용
  const portDotAt = target => {
    if (!target || !target.closest) return null;
    const direct = target.closest('.port .dot');
    if (direct) return direct;
    return target.closest('.port')?.querySelector('.dot') || null;
  };

  wrap.addEventListener('pointerdown', e => {
    // 연결선 클릭(삭제)은 패닝으로 가로채지 않는다
    if (e.target.closest && e.target.closest('.edge-hit')) return;
    const fnode = e.target.closest('.fnode');
    const interactive = e.target.closest('button, select, input, .craft');
    const inPort = e.target.closest('.port');
    const dot = portDotAt(e.target);
    if (dot && dot.dataset.dir === 'out') {
      drag.mode = 'edge';
      drag.fromNode = +dot.dataset.node;
      drag.fromItem = dot.dataset.item;
      const pending = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pending.classList.add('pending');
      pending.id = 'pending-edge';
      svg.append(pending);
      wrap.setPointerCapture(e.pointerId); // 캔버스 밖에서 놓아도 pointerup을 받도록
      e.preventDefault();
    } else if (fnode && !interactive && !inPort) {
      // 노드는 버튼·포트를 제외한 어디를 잡아도 이동 (커서 모양과 일치)
      const n = nodeById(+fnode.dataset.id);
      const pos = canvasPos(e);
      drag.mode = 'node';
      drag.node = n;
      drag.dx = pos.x - n.x;
      drag.dy = pos.y - n.y;
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (!fnode) {
      // 빈 캔버스: 잡고 드래그하면 화면 이동 (패닝)
      drag.mode = 'pan';
      drag.px = e.clientX;
      drag.py = e.clientY;
      drag.sx = wrap.scrollLeft;
      drag.sy = wrap.scrollTop;
      wrap.style.cursor = 'grabbing';
      wrap.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  wrap.addEventListener('pointermove', e => {
    // 버튼이 눌려있지 않은데 드래그 상태가 남아있으면 즉시 해제 (고착 방지 안전장치)
    if (drag.mode && e.buttons === 0) { endDrag(e); return; }
    if (drag.mode === 'node' && drag.node) {
      const pos = canvasPos(e);
      drag.node.x = Math.max(0, Math.min(WORLD_W, pos.x - drag.dx));
      drag.node.y = Math.max(0, Math.min(WORLD_H, pos.y - drag.dy));
      const box = $('node-layer').querySelector(`.fnode[data-id="${drag.node.id}"]`);
      if (box) { box.style.left = drag.node.x + 'px'; box.style.top = drag.node.y + 'px'; }
      resizeCanvas();   // 캔버스 밖으로 나가면 넓혀서 연결선이 잘리지 않게
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
      // 포인터 캡처 중에는 e.target이 wrap 으로 고정되므로 실제 좌표의 요소를 찾는다
      const at = document.elementFromPoint(e.clientX, e.clientY);
      const dot = portDotAt(at);
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
  wrap.addEventListener('pointercancel', endDrag);

  // 휠 = 확대/축소 (커서 위치 기준)
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const old = zoomOf();
    const z = Math.min(1.5, Math.max(ZOOM_MIN, old * Math.exp(-e.deltaY * 0.0012)));
    if (Math.abs(z - old) < 1e-4) return;
    const rect = wrap.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const px = (wrap.scrollLeft + cx) / old, py = (wrap.scrollTop + cy) / old;
    state.zoom = z;
    applyZoom();
    wrap.scrollLeft = px * z - cx;
    wrap.scrollTop = py * z - cy;
  }, { passive: false });

  // 벨트 메뉴 바깥 클릭 시 닫기
  document.addEventListener('pointerdown', ev => {
    if (edgeMenu && !edgeMenu.contains(ev.target)) closeEdgeMenu();
  }, true);
}

/* 재료 칩/재고 클릭 → 해당 아이템의 수동 제작 레시피 자동 선택 */
function makeCraftLink(elem, cn) {
  if (!handCraftable(cn)) return;
  elem.classList.add('craft');
  elem.title = `${iname(cn)} — 클릭하면 수동 제작에서 선택됩니다`;
  elem.addEventListener('click', () => selectHandRecipeFor(cn));
}

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

/* ---------- 계획 모드: 목표 → 필요 노드 계산 · 자동 배치 ---------- */
const producersOf = {};
for (const r of D.recipes) for (const [cn] of r.out) (producersOf[cn] ??= []).push(r);
for (const [cn, list] of Object.entries(producersOf)) {
  const nm = D.items[cn].n;
  const score = r => (r.alt ? 4 : 0) + (r.out[0][0] !== cn ? 2 : 0) + (r.name !== nm ? 1 : 0);
  list.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

/** 게임에서 현재 사용 가능한(기계 해금 + 대체 레시피 해금) 레시피 선택 */
function planPick(item) {
  return (producersOf[item] || []).find(r =>
    state.machines.includes(r.machine) && (!r.alt || state.altUnlocked.includes(r.id))) || null;
}

function computePlan(target, rate) {
  const recipes = new Map(); // recipeId -> {recipe, machines}
  const raws = {};
  const external = {}; // 레시피 잠김·순환 → 수동 공급 필요
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
  expand(target, rate, new Set());
  return { recipes: [...recipes.values()], raws, external };
}

const bestMinerTier = () => [3, 2, 1].find(minerTierUnlocked);

function openPlanner() {
  const overlay = el('div', 'alt-overlay');
  overlay.addEventListener('pointerdown', ev => { if (ev.target === overlay) overlay.remove(); });
  const card = el('div', 'alt-card plan-card');
  card.append(el('h3', null, '📋 계획 모드 — 목표를 정하면 필요한 라인을 계산합니다'));

  const search = el('input');
  search.placeholder = '목표 아이템 검색 (한글/영문)';
  const listBox = el('div', 'plan-list');
  const rateRow = el('div', 'plan-rate');
  const rateInput = el('input');
  rateInput.type = 'number'; rateInput.min = '0.1'; rateInput.step = 'any'; rateInput.value = '10';
  rateRow.append(el('span', null, '목표 생산량'), rateInput, el('span', 'hint', '/분'));
  const result = el('div', 'plan-result');
  const btnRow = el('div', 'btn-wrap');
  const buildBtn = el('button', null, '캔버스에 자동 배치');
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
    const plan = computePlan(selItem, rate);
    if (plan.recipes.length === 0) {
      result.append(el('div', 'hint', '현재 해금된 기계로는 이 아이템을 생산할 수 없습니다.'));
      return;
    }
    lastPlan = { ...plan, target: selItem, rate };
    buildBtn.disabled = false;
    let power = 0;
    const t = el('table', 'plan-table');
    for (const { recipe, machines } of plan.recipes.sort((a, b) => b.machines - a.machines)) {
      power += linePower(recipe) * machines;
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
      power += def.power * (r8 / def.rate);
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
      nameTd.append(iconEl(cn, 's'), ` ${iname(cn)} ${fmtN(r8)}/분 — 레시피 잠김/순환, 별도 공급 필요`);
      tr.append(nameTd, el('td', 'num', ''));
      t.append(tr);
    }
    result.append(t);
    const beltWarn = Object.values(plan.raws).some(v => v > 60)
      || plan.recipes.some(e => e.recipe.out.some(([cn, amt]) => perMin(e.recipe, amt) * e.machines > 60));
    result.append(el('div', 'hint',
      `예상 전력 ~${fmtN(power)} MW (100% 클럭)` + (beltWarn ? ' · 60/분 초과 구간은 벨트 업그레이드 필요' : '')));
  };

  buildBtn.addEventListener('click', () => {
    if (!lastPlan) return;
    autoBuildPlan(lastPlan);
    overlay.remove();
  });
  search.oninput = renderList;
  rateInput.oninput = renderPlan;
  renderList();
  renderPlan();
}

/** 계획을 캔버스 노드·연결로 자동 배치 (기계 수 0 — 구매는 직접) */
function autoBuildPlan(plan) {
  // 아이템 깊이 계산 (원자재 0 → 목표가 가장 오른쪽)
  const depthMemo = {};
  const depthOf = (item, path) => {
    if (D.raw.includes(item) || plan.external[item] != null) return 0;
    if (item in depthMemo) return depthMemo[item];
    if (path.has(item)) return 0;
    const r = plan.recipes.find(e => e.recipe.out.some(o => o[0] === item))?.recipe;
    if (!r) return 0;
    const next = new Set(path);
    next.add(item);
    const d = 1 + Math.max(0, ...r.in.map(([ing]) => depthOf(ing, next)));
    depthMemo[item] = d;
    return d;
  };

  const baseY = Math.max(60, ...state.nodes.map(n => n.y + 220));
  const colY = {};
  const place = depth => {
    colY[depth] = (colY[depth] ?? 0) + 1;
    return { x: 60 + depth * 280, y: baseY + (colY[depth] - 1) * 190 };
  };
  const newNodes = [];
  const mk = props => {
    const pos = place(props._depth);
    const node = { ...props, id: state.seq++, x: pos.x, y: pos.y, buf: { in: {}, out: {} } };
    delete node._depth;
    state.nodes.push(node);
    newNodes.push(node);
    return node;
  };

  const producerNode = {}; // item -> nodeId
  const tier = bestMinerTier();
  for (const [cn, need] of Object.entries(plan.raws)) {
    const node = { type: 'miner', resource: cn, count: 0, _depth: 0 };
    const def = EXT[cn] || MINERS[tier];
    if (!EXT[cn]) {
      node.tier = tier;
      node.purity = ['pure', 'normal', 'impure'].find(p => depositsLeft(cn, p) > 0) || 'normal';
    }
    // 자동 구매 목표 = 계획상 필요 대수 (순도 배율 반영)
    node.want = Math.ceil(need / (def.rate * PURITY[node.purity || 'normal'].mult) - 1e-9);
    producerNode[cn] = mk(node).id;
  }
  const maxDepth = Math.max(1, ...plan.recipes.map(e => depthOf(e.recipe.out[0][0], new Set())));
  for (const e of plan.recipes) {
    const node = mk({ type: 'machine', recipeId: e.recipe.id, count: 0,
      want: Math.ceil(e.machines - 1e-9),
      _depth: Math.max(1, depthOf(e.recipe.out[0][0], new Set())) });
    for (const [cn] of e.recipe.out) producerNode[cn] ??= node.id;
  }
  // 연결: 각 기계의 입력 ← 생산자, 목표 → 출하
  for (const e of plan.recipes) {
    const nid = newNodes.find(n => n.recipeId === e.recipe.id).id;
    for (const [ing] of e.recipe.in) {
      if (producerNode[ing] != null) {
        state.edges.push({ id: state.seq++, from: { node: producerNode[ing], item: ing }, to: { node: nid, item: ing } });
      }
    }
  }
  let sink = state.nodes.find(n => n.type === 'sink');
  if (!sink) sink = mk({ type: 'sink', count: 1, _depth: maxDepth + 1 });
  if (producerNode[plan.target] != null) {
    state.edges.push({ id: state.seq++, from: { node: producerNode[plan.target], item: plan.target }, to: { node: sink.id, item: plan.target } });
  }
  save();
  rebuild();
  showBanner(`📋 ${iname(plan.target)} ${fmtN(plan.rate)}/분 라인이 배치되고 🎯 목표 대수가 설정되었습니다 — 자동화 패널의 "기계 자동 구매"를 켜면 재료가 모이는 대로 알아서 지어집니다.`);
  setTimeout(() => { $('banner').hidden = true; }, 6000);
}

/* --- 시작 가이드 (첫 플레이 튜토리얼) --- */
const TUT_STEPS = [
  { text: '수동 채집에서 철 광석을 캐세요 (10개)', done: () => stockOf('Desc_OreIron_C') >= 10 },
  { text: '수동 제작에서 철 주괴를 만드세요 (5개)', done: () => stockOf('Desc_IronIngot_C') >= 5 },
  { text: '철판 10개 · 철봉 10개를 만드세요', done: () => stockOf('Desc_IronPlate_C') >= 10 && stockOf('Desc_IronRod_C') >= 10 },
  { text: '마일스톤 1 "자동 채굴"을 달성하세요', done: () => state.ms >= 1 },
  { text: '공장 배치에서 채굴기 노드를 추가하고 + 로 기계를 사세요', done: () => state.nodes.some(n => n.type === 'miner' && n.count > 0) },
  { text: '제련기(철 주괴) 노드를 추가하고 채굴기의 출력 ●을 입력 ●으로 드래그해 연결하세요', done: () => state.edges.length >= 1 && state.nodes.some(n => n.type === 'machine' && n.count > 0) },
  { text: '기계의 출력을 출하 노드에 연결하면 재고로 들어옵니다', done: () => state.edges.some(e => nodeById(e.to.node)?.type === 'sink') },
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
      if (!state.tut[r.i] && TUT_STEPS[r.i].done()) state.tut[r.i] = true; // 한번 달성하면 유지
      const done = !!state.tut[r.i];
      r.mark.textContent = done ? '✅' : '⬜';
      if (!done && firstOpen < 0) firstOpen = r.i;
      r.row.classList.toggle('done', done);
    }
    for (const r of rows) r.row.classList.toggle('current', r.i === firstOpen);
    if (allDone()) { panel.hidden = true; }
  });
}

/* --- 자동화 패널 --- */
function buildAuto() {
  const panel = $('auto-panel');
  const show = state.ms >= 2;   // 조립기 해금 이후부터 노출
  panel.hidden = !show;
  if (!show) return;
  const box = $('auto-body');
  box.textContent = '';
  for (const o of AUTO_OPTS) {
    const row = el('label', 'auto-row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!state.auto[o.key];
    cb.addEventListener('change', () => {
      state.auto[o.key] = cb.checked;
      save();
      update();
    });
    const txt = el('span', 'auto-text');
    txt.append(el('span', 'auto-name', o.label), el('span', 'hint', o.desc));
    row.append(cb, txt);
    box.append(row);
  }
  const status = el('div', 'auto-status hint');
  box.append(status);
  onUpdate(() => {
    const pend = state.nodes.filter(n => (n.want || 0) > n.count);
    status.textContent = !state.auto.buy
      ? '노드 아래 🎯 버튼으로 목표 대수를 정한 뒤 "기계 자동 구매"를 켜세요.'
      : pend.length
        ? `구매 대기 ${pend.length}개 노드 — 재료가 모이는 대로 지어집니다.`
        : '모든 노드가 목표 대수를 채웠습니다.';
  });
}

/* --- AWESOME 상점 --- */
function buildShop() {
  const panel = $('shop-panel');
  const show = state.ms >= 2;
  panel.hidden = !show;
  if (!show) return;
  const box = $('shop-body');
  box.textContent = '';
  const coupons = el('div', 'shop-coupons');
  box.append(coupons);
  const prog = el('div', 'hint');
  const bar = el('div', 'ms-bar');
  const fill = el('div');
  bar.append(fill);
  box.append(prog, bar);
  const shardBtn = el('button');
  shardBtn.append(iconEl(SHARD, 's'), ' 동력 조각 ×1 — 🎟 3');
  shardBtn.addEventListener('click', () => {
    if (state.coupons < 3) return;
    state.coupons -= 3;
    addStock(SHARD, 1);
    update();
    save();
  });
  const hdBtn = el('button', null, '💾 하드 드라이브 (대체 레시피 택1) — 🎟 5');
  hdBtn.addEventListener('click', () => {
    if (state.coupons < 5 || lockedAlts().length === 0) return;
    state.coupons -= 5;
    save();
    openAltChoice();
  });
  const wrapB = el('div', 'btn-wrap');
  wrapB.append(shardBtn, hdBtn);
  box.append(wrapB);
  box.append(el('div', 'hint',
    '캔버스의 AWESOME 싱크 노드에 잉여 아이템을 연결하면 포인트가 쌓이고 쿠폰이 자동 발행됩니다. 동력 조각은 노드의 ⚡ 버튼(오버클럭)에 사용합니다.'));
  onUpdate(() => {
    coupons.textContent = `🎟 쿠폰 ${state.coupons}장`;
    const cost = couponCost(state.couponsPrinted);
    prog.textContent = `다음 쿠폰: ${fmtN(state.sinkPts)} / ${cost.toLocaleString()} P`;
    fill.style.width = Math.min(100, state.sinkPts / cost * 100) + '%';
    shardBtn.disabled = state.coupons < 3;
    hdBtn.disabled = state.coupons < 5 || lockedAlts().length === 0;
  });
}

/* --- 공장 통계: 노드 전체의 아이템별 생산/소비 (분당, 가동률 반영) --- */
function buildStats() {
  const panel = $('stats-panel');
  const prodNodes = state.nodes.filter(n => n.type === 'miner' || n.type === 'machine' || n.type === 'gen');
  const items = new Set();
  for (const n of prodNodes) {
    const def = nodeDef(n);
    for (const p of def.ins) items.add(p.item);
    for (const p of def.outs) items.add(p.item);
  }
  panel.hidden = items.size === 0;
  if (items.size === 0) return;
  const list = [...items].sort((a, b) => iname(a).localeCompare(iname(b), 'ko'));
  const t = $('stats-table');
  t.textContent = '';
  const hdr = el('tr');
  hdr.append(el('th', null, ''), el('th', 'num', '생산/분'), el('th', 'num', '소비/분'));
  t.append(hdr);
  const rows = list.map(cn => {
    const tr = el('tr');
    const nameTd = el('td');
    nameTd.append(iconEl(cn, 's'), ' ' + iname(cn));
    const prodTd = el('td', 'num');
    const consTd = el('td', 'num');
    tr.append(nameTd, prodTd, consTd);
    t.append(tr);
    return { cn, prodTd, consTd };
  });
  onUpdate(() => {
    const prod = {}, cons = {};
    let machines = 0;
    for (const n of prodNodes) {
      const def = nodeDef(n);
      const run = n.count * (n.eff || 0);
      machines += n.count;
      for (const p of def.outs) prod[p.item] = (prod[p.item] || 0) + p.rate * run;
      for (const p of def.ins) cons[p.item] = (cons[p.item] || 0) + p.rate * run;
    }
    $('stats-summary').textContent =
      `기계 ${machines}대 · 발전 ${fmtN(lastPower.supply)} MW · 수요 ${fmtN(lastPower.demand)} MW`;
    for (const r of rows) {
      const p = prod[r.cn] || 0, c = cons[r.cn] || 0;
      r.prodTd.textContent = p > 0.05 ? fmtN(p) : '·';
      r.consTd.textContent = c > 0.05 ? fmtN(c) : '·';
      r.prodTd.className = 'num ' + (p > c + 0.05 ? 'rate-up' : '');
      r.consTd.className = 'num ' + (c > p + 0.05 ? 'rate-down' : '');
    }
  });
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
  autoNeedsRebuild = false;
  updaters = [];
  buildTutorial();
  buildMilestone();
  buildGather();
  buildHand();
  buildAuto();
  buildShop();
  buildFactoryBar();
  buildFactory();
  buildStock();
  buildStats();
  buildPower();
}

function update() {
  if (!drag.mode && visibleStock().join(',') !== stockKeys) { rebuild(); return; }
  for (const fn of updaters) fn();
}

/* ---------- 오프라인 진행 ---------- */
function applyOffline() {
  const elapsedSec = Math.min(4 * 3600, (Date.now() - (state.savedAt || Date.now())) / 1000);
  if (elapsedSec > 10) {
    const steps = Math.floor(elapsedSec / 5);
    const msBefore = state.ms;
    for (let i = 0; i < steps; i++) tick(5 / 60);
    const gained = state.ms - msBefore;   // 자동 마일스톤이 방치 중 달성한 수
    showBanner(`⏰ 오프라인 ${Math.floor(elapsedSec / 60)}분 동안 공장이 가동됐습니다.`
      + (gained > 0 ? ` 🤖 마일스톤 ${gained}개가 자동 달성되었습니다.` : ''));
    setTimeout(() => { $('banner').hidden = true; }, 6000);
  }
}

/* ---------- 클라우드 UI ---------- */
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
      try { await navigator.clipboard.writeText(Cloud.code); showBanner(`📋 코드 ${Cloud.code} 를 복사했습니다. 다른 기기에서 "코드 입력"에 붙여넣으세요.`); } catch { /* 무시 */ }
    }
  });

  $('btn-cloud-code').addEventListener('click', async () => {
    if (!Cloud.available()) {
      const url = prompt('저장 서버 주소를 입력하세요 (예: http://192.168.0.10:8787)', Cloud.serverUrl());
      if (url === null) return;
      Cloud.setServerUrl(url);
      location.reload();
      return;
    }
    const input = prompt('다른 기기에서 쓰던 코드를 입력하세요 (8자리). 현재 진행은 그 코드의 저장으로 대체됩니다.', Cloud.code || '');
    if (!input) return;
    try {
      const remote = await Cloud.useCode(input);
      if (!remote) {
        showBanner('해당 코드에 저장이 없습니다. 지금 진행 상황을 이 코드로 저장합니다.');
        save({ immediate: true, force: true });
        return;
      }
      state = remote;
      applyOffline();
      rebuild();
      showBanner('☁ 서버 저장을 불러왔습니다.');
    } catch (e) {
      alert(e.message);
    }
  });
}

/* ---------- 시작 ---------- */
async function init() {
  state = load() || freshState();
  const local = state.savedAt || 0;

  initFactoryEvents();
  initCloudUI();
  rebuild();

  // 서버 저장이 더 최신이면 그쪽을 쓴다 (다른 기기에서 이어서 하기)
  const remote = await Cloud.pull();
  if (remote && (remote.savedAt || 0) > local) state = remote;

  if (state._migrated) {
    delete state._migrated;
    showBanner('🔧 공장이 그래프 방식으로 개편되어 기존 기계·채굴기 비용이 전액 재고로 환불되었습니다. 아래 공장 배치에서 다시 연결해 보세요!');
  } else if (state._genMigrated) {
    delete state._genMigrated;
    showBanner('⚡ 발전기가 캔버스 노드로 바뀌었습니다. 비용은 환불됐으니 툴바의 "발전기 추가"로 배치하고 석탄·물을 연결하세요!');
  }
  applyOffline();
  if (state.won) showBanner('🎉 프로젝트 조립 완료! FICSIT이 매우 만족했습니다. 자유롭게 확장하세요.');
  rebuild();
  save({ immediate: true });

  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dtMin = Math.min(10000, now - lastTick) / 60000;
    lastTick = now;
    tick(dtMin);
    if (autoNeedsRebuild) { autoNeedsRebuild = false; rebuild(); }
    update();
  }, 200);
  setInterval(() => save(), 10000);
  window.addEventListener('beforeunload', () => { save({ immediate: true }); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save({ immediate: true }); });
  // 오디오는 첫 사용자 입력 후에만 생성 가능 (브라우저 정책)
  document.addEventListener('pointerdown', () => {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 무시 */ }
    }
  }, { once: true });
  const muteBtn = $('btn-mute');
  const refreshMute = () => { muteBtn.textContent = state.muted ? '🔇' : '🔊'; };
  muteBtn.addEventListener('click', () => { state.muted = !state.muted; refreshMute(); save(); });
  refreshMute();

  $('btn-save').addEventListener('click', () => { save({ immediate: true }); });
  // 공장 설계 내보내기 (JSON 파일 다운로드)
  $('btn-export').addEventListener('click', () => {
    save();
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `satisfactory-factory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  // 가져오기 (파일 선택 → 현재 진행 덮어쓰기)
  $('btn-import').addEventListener('click', () => { $('import-file').click(); });
  $('import-file').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!s || !Array.isArray(s.nodes) || !Array.isArray(s.edges)) {
        alert('공장 설계 파일이 아닙니다.');
        return;
      }
      if (!confirm('현재 진행을 이 파일로 덮어쓸까요?')) return;
      migrateSidebarGens(s);
      state = withDefaults(s);
      state.savedAt = Date.now(); // 오프라인 진행 소급 방지
      save({ immediate: true, force: true });   // 가져온 설계를 서버에도 반영
      $('banner').hidden = true;
      rebuild();
    } catch (e) {
      alert('파일을 읽을 수 없습니다: ' + e.message);
    }
  });
  $('btn-reset').addEventListener('click', () => {
    if (confirm('정말 처음부터 다시 시작할까요? 서버 저장도 함께 삭제됩니다.')) {
      localStorage.removeItem(SAVE_KEY);
      state = freshState();
      $('banner').hidden = true;
      rebuild();
      save({ immediate: true, force: true });   // 서버 저장도 초기 상태로 덮어쓴다
    }
  });
}
init();
