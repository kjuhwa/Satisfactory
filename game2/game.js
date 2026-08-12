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

function depositsLeft(resource, purity) {
  const pool = DEPOSITS[resource];
  if (!pool) return Infinity;
  const total = pool[purity] || 0;
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
    zoom: 1,
    savedAt: Date.now(),
  };
}

function withDefaults(s) {
  s.sinkPts ??= 0; s.coupons ??= 0; s.couponsPrinted ??= 0;
  s.altUnlocked ??= [];
  s.won = s.ms >= MS.length;
  if (s.ms >= 7 && !s.gensUnlocked.includes('nuclear')) s.gensUnlocked.push('nuclear');
  for (const cx of s.cx) { cx.pool ??= {}; cx.members ??= []; }
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
    const mult = PURITY[f.purity || 'normal'].mult;
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
    const c = clockOf(f) / 100;
    return {
      label: (r.alt ? '★ ' : '') + r.ko,
      iconCn: r.out[0][0],
      ins: r.in.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) * c })),
      outs: r.out.map(([cn, amt]) => ({ item: cn, rate: perMin(r, amt) * c })),
      power: linePower(r) * Math.pow(c, POWER_EXP),
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
      power: 0, produces: g.power,
      cost: buildCost(g.build),
    };
  }
  if (f.type === 'awesink') {
    return { label: 'AWESOME 싱크', iconCn: SHARD, ins: [], outs: [], power: 30, cost: {} };
  }
  return { label: '출하 시설', iconCn: null, ins: [], outs: [], power: 0, cost: {} }; // sink
}

/** 단지의 아이템별 총 생산/소비 (100% 기준) */
function cxFlows(cx) {
  const prod = {}, cons = {};
  for (const f of cx.members) {
    const def = facDef(f);
    for (const p of def.outs) prod[p.item] = (prod[p.item] || 0) + p.rate * f.count;
    for (const p of def.ins) cons[p.item] = (cons[p.item] || 0) + p.rate * f.count;
  }
  return { prod, cons };
}

/** 단지 외부 포트: 부족 입력 / 잉여 출력 */
function cxPorts(cx) {
  const { prod, cons } = cxFlows(cx);
  const items = new Set([...Object.keys(prod), ...Object.keys(cons)]);
  const ins = [], outs = [];
  for (const cn of items) {
    const net = (prod[cn] || 0) - (cons[cn] || 0);
    if (net < -0.05) ins.push({ item: cn, rate: -net });
    else if (net > 0.05) outs.push({ item: cn, rate: net });
  }
  return { ins, outs };
}

const hasSink = cx => cx.members.some(f => f.type === 'sink');
const hasAwesink = cx => cx.members.some(f => f.type === 'awesink');

/** 단지 정체성 (이름·아이콘) */
function cxIdentity(cx) {
  const gen = cx.members.find(f => f.type === 'gen');
  if (gen) {
    const g = GENS[gen.genKey];
    return { name: '⚡ ' + D.xnames[g.build].replace('발전소', '').replace('발전기', '').trim() + ' 발전 단지', icon: g.build, cls: 'power-plant' };
  }
  if (cx.members.length === 1) {
    const def = facDef(cx.members[0]);
    return { name: def.label, icon: def.iconCn, cls: '' };
  }
  const { outs } = cxPorts(cx);
  if (outs.length > 0) {
    const main = outs.sort((a, b) => b.rate - a.rate)[0].item;
    return { name: iname(main) + ' 단지', icon: main, cls: '' };
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

const poolCap = cx => 100 * Math.max(2, cx.members.length);

function tick(dtMin) {
  const prev = { ...state.stock };

  // 1) 발전 (연료는 단지 저장고에서)
  let supply = BASE_POWER;
  for (const cx of state.cx) {
    const cap = poolCap(cx);
    for (const f of cx.members) {
      if (f.type !== 'gen') continue;
      if (f.count <= 0) { f.eff = 0; f.why = '기계 없음'; continue; }
      const g = GENS[f.genKey];
      let frac = 1, limit = null, limitKind = null;
      for (const [cn, rate] of g.burns) {
        const need = rate * f.count * dtMin;
        if (need > 0) {
          const v = (cx.pool[cn] || 0) / need;
          if (v < frac) { frac = v; limit = cn; limitKind = 'in'; }
        }
      }
      for (const [cn, rate] of (g.wastes || [])) {
        const need = rate * f.count * dtMin;
        if (need > 0) {
          const v = Math.max(0, cap - (cx.pool[cn] || 0)) / need;
          if (v < frac) { frac = v; limit = cn; limitKind = 'out'; }
        }
      }
      frac = Math.min(1, Math.max(0, frac));
      for (const [cn, rate] of g.burns) cx.pool[cn] = Math.max(0, (cx.pool[cn] || 0) - rate * f.count * dtMin * frac);
      for (const [cn, rate] of (g.wastes || [])) cx.pool[cn] = (cx.pool[cn] || 0) + rate * f.count * dtMin * frac;
      supply += g.power * f.count * frac;
      f.eff = frac;
      f.why = frac >= 0.99 || !limit ? null
        : limitKind === 'in' ? `연료 부족: ${iname(limit)}` : `폐기물 정체: ${iname(limit)}`;
    }
  }

  // 2) 수요·전력 효율
  let demand = 0;
  for (const cx of state.cx) for (const f of cx.members) demand += facDef(f).power * Math.max(f.count, f.type === 'awesink' || f.type === 'sink' ? 1 : 0);
  const powerEff = demand > 0 ? Math.min(1, supply / demand) : 1;

  // 3) 단지 간 벨트 이동
  lastEdgeFlow = {};
  const groups = {};
  for (const e of state.edges) (groups[e.from.cx + '|' + e.from.item] ??= []).push(e);
  for (const [key, edges] of Object.entries(groups)) {
    const [fromId, item] = key.split('|');
    const from = cxById(+fromId);
    if (!from) continue;
    const avail = from.pool[item] || 0;
    if (avail <= 0) continue;
    const share = avail / edges.length;
    for (const e of edges) {
      const dst = cxById(e.to.cx);
      if (!dst) continue;
      const space = poolCap(dst) - (dst.pool[item] || 0);
      const moved = Math.min(share, beltOf(e).cap * dtMin, Math.max(0, space));
      dst.pool[item] = (dst.pool[item] || 0) + moved;
      from.pool[item] -= moved;
      lastEdgeFlow[e.id] = moved / dtMin;
    }
  }

  // 4) 시설 가동 (채굴 → 얕은 레시피 → 깊은 레시피 순)
  for (const cx of state.cx) {
    const cap = poolCap(cx);
    const order = [...cx.members].sort((a, b) => {
      const da = a.type === 'miner' ? -1 : a.type === 'machine' ? itemDepth(recipeById[a.recipeId].out[0][0]) : 99;
      const db = b.type === 'miner' ? -1 : b.type === 'machine' ? itemDepth(recipeById[b.recipeId].out[0][0]) : 99;
      return da - db;
    });
    for (const f of order) {
      if (f.type === 'miner') {
        if (f.count <= 0) { f.eff = 0; f.why = '기계 없음'; continue; }
        const def = facDef(f);
        const out = def.outs[0];
        const want = out.rate * f.count * powerEff * dtMin;
        const space = Math.max(0, cap - (cx.pool[out.item] || 0));
        const make = Math.min(want, space);
        cx.pool[out.item] = (cx.pool[out.item] || 0) + make;
        f.eff = want > 0 ? powerEff * (make / want) : 0;
        f.why = f.eff >= 0.99 ? null
          : space < want ? `저장고 가득: ${iname(out.item)} — 소비·수출·출하가 필요합니다`
          : powerEff < 0.99 ? '전력 부족' : null;
      } else if (f.type === 'machine') {
        if (f.count <= 0) { f.eff = 0; f.why = '기계 없음'; continue; }
        const def = facDef(f);
        const run = f.count * powerEff;
        if (run <= 0) { f.eff = 0; f.why = '전력 부족'; continue; }
        let frac = 1, limit = null, limitKind = null;
        for (const p of def.ins) {
          const need = p.rate * run * dtMin;
          if (need > 0) {
            const v = (cx.pool[p.item] || 0) / need;
            if (v < frac) { frac = v; limit = p.item; limitKind = 'in'; }
          }
        }
        for (const p of def.outs) {
          const make = p.rate * run * dtMin;
          if (make > 0) {
            const v = Math.max(0, cap - (cx.pool[p.item] || 0)) / make;
            if (v < frac) { frac = v; limit = p.item; limitKind = 'out'; }
          }
        }
        frac = Math.min(1, Math.max(0, frac));
        for (const p of def.ins) cx.pool[p.item] = Math.max(0, (cx.pool[p.item] || 0) - p.rate * run * dtMin * frac);
        for (const p of def.outs) cx.pool[p.item] = (cx.pool[p.item] || 0) + p.rate * run * dtMin * frac;
        f.eff = powerEff * frac;
        f.why = f.eff >= 0.99 ? null
          : limit && frac < powerEff
            ? (limitKind === 'in' ? `재료 부족: ${iname(limit)}` : `저장고 가득: ${iname(limit)}`)
            : powerEff < 0.99 ? '전력 부족' : null;
      }
    }
    // 5) 출하/싱크: 모든 잉여 반출 — 내부 소비 품목은 소비 1분치만 남기고 초과분을 내보냄
    const consRate = {};
    for (const f of cx.members) {
      for (const p of facDef(f).ins) consRate[p.item] = (consRate[p.item] || 0) + p.rate * f.count;
    }
    if (hasSink(cx)) {
      for (const cn of Object.keys(cx.pool)) {
        const reserve = consRate[cn] || 0; // 내부 소비 1분치 버퍼
        const excess = cx.pool[cn] - reserve;
        if (excess > 0) { addStock(cn, excess); cx.pool[cn] = reserve; }
      }
    }
    if (hasAwesink(cx)) {
      let rate = 0;
      for (const cn of Object.keys(cx.pool)) {
        if (ptsOf(cn) <= 0) continue;
        const reserve = consRate[cn] || 0;
        const excess = cx.pool[cn] - reserve;
        if (excess > 0) {
          state.sinkPts += excess * ptsOf(cn);
          rate += excess * ptsOf(cn) / dtMin;
          cx.pool[cn] = reserve;
        }
      }
      cx.ptsRate = rate;
    }
  }

  while (state.sinkPts >= couponCost(state.couponsPrinted)) {
    state.sinkPts -= couponCost(state.couponsPrinted);
    state.couponsPrinted++;
    state.coupons++;
    sfx('coupon');
  }

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
let edgeMenu = null;

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
function openEdgeMenu(ev, edgeId) {
  closeEdgeMenu();
  const e = state.edges.find(x => x.id === edgeId);
  if (!e) return;
  const t = e.tier || 1;
  const menu = el('div', 'edge-menu');
  const head = el('div', 'em-head');
  head.append(iconEl(e.from.item, 's'), ` ${iname(e.from.item)} `, el('b', null, `Mk.${t}`));
  menu.append(head);
  menu.append(el('div', 'em-line', `용량 ${beltOf(e).cap}/분 · 현재 흐름 ${fmtN(lastEdgeFlow[e.id] || 0)}/분`));
  if (t < 5) {
    const next = BELT_TIERS[t + 1];
    const up = el('button', null, `Mk.${t + 1} 업그레이드 (${next.cap}/분)`);
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
  menu.style.left = Math.min(ev.clientX, window.innerWidth - 240) + 'px';
  menu.style.top = Math.min(ev.clientY, window.innerHeight - 180) + 'px';
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
function addComplex(fac) {
  fac.id = state.seq++;
  const pos = spawnXY();
  state.cx.push({ id: state.seq++, x: pos.x, y: pos.y, members: [fac], pool: {} });
  save(); rebuild();
}
function mergeComplex(srcId, dstId) {
  const src = cxById(srcId), dst = cxById(dstId);
  if (!src || !dst || src === dst) return;
  dst.members.push(...src.members);
  for (const [cn, v] of Object.entries(src.pool)) dst.pool[cn] = (dst.pool[cn] || 0) + v;
  for (const e of state.edges) {
    if (e.from.cx === srcId) e.from.cx = dstId;
    if (e.to.cx === srcId) e.to.cx = dstId;
  }
  state.edges = state.edges.filter(e => e.from.cx !== e.to.cx); // 자기 연결 제거 (내부는 자동)
  state.cx = state.cx.filter(c => c.id !== srcId);
  if (focusedCx === srcId) focusedCx = dstId;
  sfx('merge');
  save(); rebuild();
}
function extractMember(cxId, facId) {
  const cx = cxById(cxId);
  if (!cx) return;
  const idx = cx.members.findIndex(f => f.id === facId);
  if (idx < 0) return;
  const [f] = cx.members.splice(idx, 1);
  state.cx.push({ id: state.seq++, x: cx.x + 60, y: cx.y + 120, members: [f], pool: {} });
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
function removeFacility(cxId, facId) {
  const cx = cxById(cxId);
  if (!cx) return;
  const f = cx.members.find(x => x.id === facId);
  if (!f) return;
  const def = facDef(f);
  refund(Object.fromEntries(Object.entries(def.cost).map(([cn, c]) => [cn, c * f.count])));
  cx.members = cx.members.filter(x => x.id !== facId);
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
    if (prev && minerTierUnlocked(+prev)) tierSel.value = prev;
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
  $('add-node').onclick = () => { if (rSel.value) addComplex({ type: 'machine', recipeId: rSel.value, count: 0 }); };
  $('add-gen-btn').onclick = () => { if (genSel.value) addComplex({ type: 'gen', genKey: genSel.value, count: 0 }); };
  $('add-sink').onclick = () => addComplex({ type: 'sink', count: 1 });
  const awBtn = $('add-awesink');
  awBtn.style.display = state.ms >= 2 ? '' : 'none';
  awBtn.onclick = () => addComplex({ type: 'awesink', count: 1 });

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

    // 중간 줌: 아이콘 스트립
    const strip = el('div', 'cx-strip');
    for (const f of cx.members) {
      const ic = iconEl(facDef(f).iconCn || SHARD, 's');
      ic.title = facDef(f).label + ' ×' + f.count;
      strip.append(ic);
    }
    box.append(strip);

    // 근접 줌: 시설 목록 (조작)
    const memBox = el('div', 'cx-members');
    for (const f of cx.members) {
      const def = facDef(f);
      const row = el('div', 'mem');
      const nm = el('span', 'm-name');
      if (def.iconCn) nm.append(iconEl(def.iconCn, 's'), ' ');
      nm.append(def.label);
      nm.title = def.label;
      row.append(nm);
      if (f.type === 'sink' || f.type === 'awesink') {
        row.append(el('span', 'hint', f.type === 'sink' ? '잉여 → 재고' : '잉여 소각 → P'));
      } else {
        const effS = el('span', 'm-eff');
        row.append(effS);
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
        const clk = el('button', 'ghost clk');
        clk.addEventListener('click', ev => openClockMenu(ev, cx.id, f.id));
        row.append(minus, cnt, plus, clk);
        onUpdate(() => {
          cnt.textContent = f.count;
          plus.disabled = !canAfford(def.cost) || noDeposit();
          minus.disabled = f.count <= 0;
          clk.textContent = '⚡' + clockOf(f) + '%';
          clk.classList.toggle('oc', clockOf(f) !== 100);
          const pct = Math.round((f.eff || 0) * 100);
          effS.textContent = f.count > 0 ? pct + '%' : '휴면';
          effS.style.color = pct >= 99 ? 'var(--good)' : (f.count > 0 ? 'var(--bad)' : 'var(--muted)');
          effS.title = f.why || '';
        });
      }
      const out = el('button', 'ghost', '⇱');
      out.title = '단지에서 꺼내기';
      out.addEventListener('click', () => extractMember(cx.id, f.id));
      const del = el('button', 'ghost danger', '✕');
      del.title = '시설 삭제 (비용 환불)';
      del.addEventListener('click', () => removeFacility(cx.id, f.id));
      row.append(out, del);
      memBox.append(row);
    }
    box.append(memBox);

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
      p.append(dot, iconEl(pin.item, 's'), el('span', 'rate', `${fmtN(pin.rate)}/분 부족`), pool);
      p.title = iname(pin.item);
      insCol.append(p);
      onUpdate(() => { pool.textContent = fmtN(cx.pool[pin.item] || 0); });
    }
    for (const pout of ports.outs) {
      const p = el('div', 'port');
      const dot = el('span', 'dot');
      dot.dataset.cx = cx.id; dot.dataset.item = pout.item; dot.dataset.dir = 'out';
      portEls[cx.id + '|' + pout.item + '|out'] = dot;
      const pool = el('span', 'pool');
      p.append(dot, iconEl(pout.item, 's'), el('span', 'rate', `+${fmtN(pout.rate)}/분`), pool);
      p.title = iname(pout.item);
      outsCol.append(p);
      onUpdate(() => { pool.textContent = fmtN(cx.pool[pout.item] || 0); });
    }
    pWrap.append(insCol, outsCol);
    box.append(pWrap);

    // 푸터
    const foot = el('div', 'cx-foot');
    const powerS = el('span');
    foot.append(powerS);
    const del = el('button', 'ghost danger del', '✕ 단지 철거');
    del.addEventListener('click', () => removeComplex(cx.id));
    foot.append(del);
    box.append(foot);

    onUpdate(() => {
      // 단지 가동률 = 기계 수 가중 평균
      let wsum = 0, esum = 0, worst = null;
      let power = 0, produces = 0;
      for (const f of cx.members) {
        const def = facDef(f);
        power += def.power * f.count;
        if (def.produces) produces += def.produces * f.count * (f.eff || 0);
        if (f.type === 'sink' || f.type === 'awesink') continue;
        if (f.count > 0) {
          wsum += f.count;
          esum += (f.eff || 0) * f.count;
          if (f.why && (worst === null)) worst = f.why;
        }
      }
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
    title.textContent = `${iname(e.from.item)} · Mk.${tier} ${beltOf(e).cap}/분 (클릭: 업그레이드/삭제)`;
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

function addEdge(fromCx, fromItem, toCxId, toItem) {
  const dst = cxById(toCxId);
  if (!dst || fromCx === toCxId) return;
  const sinkLike = toItem === '*';
  if (!sinkLike && toItem !== fromItem) return;
  const finalItem = sinkLike ? fromItem : toItem;
  if (state.edges.some(e => e.from.cx === fromCx && e.from.item === fromItem && e.to.cx === toCxId && e.to.item === finalItem)) return;
  state.edges.push({ id: state.seq++, from: { cx: fromCx, item: fromItem }, to: { cx: toCxId, item: finalItem } });
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

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('.edge-hit')) return;
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
      if (dot && dot.dataset.dir === 'in') addEdge(drag.fromCx, drag.fromItem, +dot.dataset.cx, dot.dataset.item);
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
}

/* ---------- 조립 ---------- */
function rebuild() {
  if (drag.mode) { drag.pendingRebuild = true; return; }
  updaters = [];
  buildTutorial();
  buildMilestone();
  buildGather();
  buildHand();
  buildShop();
  buildFactoryBar();
  buildCanvas();
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

  const elapsedSec = Math.min(4 * 3600, (Date.now() - (state.savedAt || Date.now())) / 1000);
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

  initCanvasEvents();
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
