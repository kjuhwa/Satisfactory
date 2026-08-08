(function (root, factory) {
  // 서버(Node)와 브라우저(GitHub Pages 단독 실행)가 같은 규칙을 쓴다.
  // 이 파일에는 fs·http 같은 환경 의존이 하나도 없다 — 그런 것은 어댑터가 맡는다.
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./map.js'));
  else root.FrontierCore = factory(root.FrontierMap);
})(typeof self !== 'undefined' ? self : this, function (MAP) {
'use strict';

const { REGIONS, DIRS, DIR_ALIAS, PURITY_NAME, DANGER_NAME } = MAP;

/* ---------- 규칙 상수 ---------- */
const TICK_SEC = 5;
const BASE_POWER = 100;        // 강하 캡슐 원자로. 본거지가 속한 전력망에만 들어온다
const OFFLINE_CAP_H = 8;

const WATER_PUMP = { build: 'Desc_WaterPump_C', rate: 120, power: 20 };

const EXTRACTOR = {
  Desc_OreIron_C:      { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_OreCopper_C:    { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_Stone_C:        { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_Coal_C:         { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_RawQuartz_C:    { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_Sulfur_C:       { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_OreGold_C:      { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_OreBauxite_C:   { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_OreUranium_C:   { build: 'Desc_MinerMk1_C', rate: 60,  power: 5 },
  Desc_LiquidOil_C:    { build: 'Desc_OilPump_C',  rate: 120, power: 40 },
  Desc_NitrogenGas_C:  { build: 'Desc_OilPump_C',  rate: 120, power: 40 },
};

const GENS = {
  석탄: { build: 'Desc_GeneratorCoal_C', power: 75,  needsWater: true,
        burns: [['Desc_Coal_C', 15], ['Desc_Water_C', 45]] },
  연료: { build: 'Desc_GeneratorFuel_C', power: 250, needsWater: false,
        burns: [['Desc_LiquidFuel_C', 20]] },
};

const LINK_COST = { Desc_Cable_C: 20, Desc_Cement_C: 20, Desc_IronRod_C: 10 };

const GEAR = {
  방호복: { danger: 2, cost: { Desc_IronPlateReinforced_C: 10, Desc_Cable_C: 20 },
         desc: '위험 등급 2 지역 진입' },
  방독장비: { danger: 3, cost: { Desc_SteelPlate_C: 20, Desc_CircuitBoard_C: 5 },
          desc: '위험 등급 3 지역 진입' },
};

// 공동 프로젝트. 여럿이 붙는 서버에서는 통째로, 혼자 하는 로컬 모드에서는 규모를 줄인다
// (혼자서는 끝낼 수 없는 양이라는 설계는 "여럿"을 전제로 한 것이다)
const PROJECT_BASE = [
  { name: '1단계 — 기반 골조', need: { Desc_SpaceElevatorPart_1_C: 50 } },
  { name: '2단계 — 승강 구조', need: { Desc_SpaceElevatorPart_2_C: 80, Desc_SteelPlate_C: 500 } },
  { name: '3단계 — 궤도 연결', need: { Desc_SpaceElevatorPart_3_C: 100, 유물: 12 } },
];

const STARTER = {
  Desc_IronPlate_C: 100, Desc_IronRod_C: 80, Desc_Cement_C: 60,
  Desc_Wire_C: 100, Desc_Cable_C: 60, Desc_IronPlateReinforced_C: 20, Desc_Rotor_C: 8,
};
const STARTER_MACHINES = ['Desc_SmelterMk1_C', 'Desc_ConstructorMk1_C', 'Desc_AssemblerMk1_C'];

const HELP = [
  ['이동', '북 남 동 서 위 아래 (n s e w u d)'],
  ['보기 / l', '지금 있는 지역을 살펴본다'],
  ['조사', '매장지와 잔해를 드러낸다 (지역마다 한 번)'],
  ['지도', '방문한 지역과 미탐사 출구'],
  ['점유 <번호>', '매장지를 선점한다 — 선착순이다'],
  ['건설 채굴기 <번호>', '점유한 매장지에 추출 설비를 세운다'],
  ['건설 발전기 [석탄|연료]', '물이 있는 지역에만 석탄 발전기를 세울 수 있다'],
  ['건설 물펌프', '물이 있는 지역'],
  ['건설 <레시피> [수]', '가공 라인 (예: `건설 철판 2`)'],
  ['송전 <방향>', '인접 지역과 전력망을 잇는다'],
  ['제작 <장비>', '방호복 / 방독장비 — 위험 지역 진입용'],
  ['회수', '잔해에서 하드 드라이브·유물을 꺼낸다'],
  ['공장 / 재고 / 전력', '내 상태'],
  ['목표 / 납품 <품목> <수>', '공동 프로젝트'],
  ['말 <내용> / 외침 <내용>', '같은 지역 / 전 세계'],
  ['누구', '접속자 목록'],
];

/**
 * 세계 하나를 만든다.
 * @param deps.data   web/data.js 의 GAME_DATA (서버는 vm 으로, 브라우저는 script 태그로 읽어 넘긴다)
 * @param deps.emit   { toPlayer, toRoom, broadcast } — 전달 방식은 어댑터가 정한다
 * @param deps.online () => player[] — 지금 듣고 있는 사람
 * @param deps.rng    () => string   — 토큰 발급
 * @param deps.solo   true 면 공동 프로젝트 규모를 줄인다
 */
function createWorld(deps) {
  const D = deps.data;
  const emit = deps.emit || {};
  const onlineList = deps.online || (() => Object.values(world.players));
  const rng = deps.rng || (() => Math.random().toString(36).slice(2) + Date.now().toString(36));
  const solo = !!deps.solo;

  const iname = cn => (D.items[cn] && (D.items[cn].ko || D.items[cn].n)) || D.xnames[cn] || cn;
  const mname = cn => (D.machines[cn] && (D.machines[cn].ko || D.machines[cn].n)) || D.xnames[cn] || cn;
  const recipeById = Object.fromEntries(D.recipes.map(r => [r.id, r]));
  const recipePower = r => r.power ?? (D.machines[r.machine] || {}).power ?? 0;
  const buildCost = cn => Object.fromEntries(D.build[cn] || []);
  const perMin = (r, amt) => amt * 60 / r.time;
  const itemName = cn => (cn === '유물' ? '고대 유물' : iname(cn));

  const scale = solo ? 0.2 : 1;
  const PROJECT = PROJECT_BASE.map(s => ({
    name: s.name,
    need: Object.fromEntries(Object.entries(s.need).map(([cn, n]) => [cn, Math.max(1, Math.round(n * scale))])),
  }));

  const world = {
    players: {},
    claims: {},
    project: { stage: 0, delivered: {}, contrib: {} },
    startedAt: Date.now(),
  };
  const tokens = new Map();

  const now = () => Date.now();
  const player = id => world.players[id];
  const online = () => onlineList();

  /* ---------- 재고 ---------- */
  const stockOf = (p, cn) => p.stock[cn] || 0;
  const addStock = (p, cn, n) => { p.stock[cn] = Math.max(0, stockOf(p, cn) + n); };
  const pay = (p, cost) => { for (const [cn, n] of Object.entries(cost)) addStock(p, cn, -n); };

  function shortfall(p, cost) {
    const miss = Object.entries(cost).filter(([cn, n]) => stockOf(p, cn) < n);
    if (!miss.length) return null;
    return '자재 부족 — ' + miss.map(([cn, n]) => `${itemName(cn)} ${Math.floor(stockOf(p, cn))}/${n}`).join(', ');
  }

  /* ---------- 전력망 ---------- */
  function gridsOf(p) {
    const parent = {};
    const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const touch = r => { if (!(r in parent)) parent[r] = r; };
    for (const r of Object.keys(p.built)) touch(r);
    touch('grass_hub');
    for (const link of p.links) {
      const [a, b] = link.split('|');
      touch(a); touch(b);
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    const map = {};
    for (const r of Object.keys(parent)) map[r] = find(r);
    return map;
  }

  function powerOf(p) {
    const grid = gridsOf(p);
    const g = {};
    const bucket = r => (g[grid[r]] = g[grid[r]] || { supply: 0, demand: 0, regions: [] });
    bucket('grass_hub').supply += BASE_POWER;
    for (const [rid, b] of Object.entries(p.built)) {
      const cell = bucket(rid);
      if (!cell.regions.includes(rid)) cell.regions.push(rid);
      for (const e of b.ext) cell.demand += EXTRACTOR[e.res].power;
      cell.demand += (b.pumps || 0) * WATER_PUMP.power;
      for (const l of b.lines) {
        const r = recipeById[l.recipeId];
        if (r) cell.demand += recipePower(r) * l.count;
      }
      for (const gen of b.gens) cell.supply += GENS[gen.key].power * gen.count * (gen.eff ?? 1);
    }
    for (const cell of Object.values(g)) cell.eff = cell.demand > 0 ? Math.min(1, cell.supply / cell.demand) : 1;
    return { grid, cells: g };
  }

  /* ---------- 시뮬레이션 ---------- */
  function tickPlayer(p, dtMin) {
    const before = { ...p.stock };

    for (const b of Object.values(p.built)) {
      for (const gen of b.gens) {
        const def = GENS[gen.key];
        let frac = 1;
        for (const [cn, rate] of def.burns) {
          const need = rate * gen.count * dtMin;
          if (need > 0) frac = Math.min(frac, stockOf(p, cn) / need);
        }
        frac = Math.min(1, Math.max(0, frac));
        for (const [cn, rate] of def.burns) addStock(p, cn, -rate * gen.count * dtMin * frac);
        gen.eff = frac;
      }
    }

    const { grid, cells } = powerOf(p);
    const effOf = rid => (cells[grid[rid]] || { eff: 1 }).eff;

    for (const [rid, b] of Object.entries(p.built)) {
      const eff = effOf(rid);
      for (const e of b.ext) addStock(p, e.res, EXTRACTOR[e.res].rate * e.purity * eff * dtMin);
      if (b.pumps) addStock(p, 'Desc_Water_C', WATER_PUMP.rate * b.pumps * eff * dtMin);
    }

    // 모자란 재료는 요구량 비율대로 나눠 갖는다. 순서대로 끌어가면 앞선 라인이
    // 재고를 0으로 만들어 뒤 라인이 영영 굶는다.
    const want = {};
    for (const [rid, b] of Object.entries(p.built)) {
      const eff = effOf(rid);
      for (const l of b.lines) {
        const r = recipeById[l.recipeId];
        if (!r) continue;
        for (const [cn, amt] of r.in) want[cn] = (want[cn] || 0) + perMin(r, amt) * l.count * eff * dtMin;
      }
    }
    const share = {};
    for (const cn of Object.keys(want)) share[cn] = want[cn] > 0 ? Math.min(1, stockOf(p, cn) / want[cn]) : 1;

    for (const [rid, b] of Object.entries(p.built)) {
      const eff = effOf(rid);
      for (const l of b.lines) {
        const r = recipeById[l.recipeId];
        if (!r) { l.eff = 0; continue; }
        let frac = 1, short = null;
        for (const [cn] of r.in) { const f = share[cn] ?? 1; if (f < frac) { frac = f; short = cn; } }
        frac = Math.min(1, Math.max(0, frac));
        const run = l.count * eff * dtMin * frac;
        for (const [cn, amt] of r.in) addStock(p, cn, -perMin(r, amt) * run);
        for (const [cn, amt] of r.out) addStock(p, cn, perMin(r, amt) * run);
        l.eff = eff * frac;
        l.why = frac < 0.99 ? `재료 부족: ${iname(short)}` : (eff < 0.99 ? '전력 부족' : null);
      }
    }

    p.rates = {};
    for (const cn of new Set([...Object.keys(before), ...Object.keys(p.stock)]))
      p.rates[cn] = ((p.stock[cn] || 0) - (before[cn] || 0)) / dtMin;
  }

  function tickAll(dtMin) {
    for (const p of Object.values(world.players)) tickPlayer(p, dtMin);
  }

  /* ---------- 출력 ---------- */
  const fmt = x => x >= 1000 ? Math.floor(x).toLocaleString() : x >= 10 ? Math.floor(x).toString() : (Math.round(x * 10) / 10).toString();
  const say = text => ({ t: 'info', text });
  const err = text => ({ t: 'err', text });
  const ok = text => ({ t: 'ok', text });
  const regionLine = rid => `${REGIONS[rid].name} (${DANGER_NAME[REGIONS[rid].danger]}${REGIONS[rid].water ? ' · 물 있음' : ' · 물 없음'})`;

  const toRoom = (rid, lines, exceptId) => emit.toRoom && emit.toRoom(rid, lines, exceptId);
  const broadcast = lines => emit.broadcast && emit.broadcast(lines);

  function describe(p, rid) {
    const r = REGIONS[rid];
    const out = [];
    out.push({ t: 'room', text: r.name });
    out.push({ t: 'desc', text: r.desc });
    const exits = Object.entries(r.exits).map(([d, to]) =>
      `${d}(${p.visited.includes(to) ? REGIONS[to].name : '???'})`);
    out.push({ t: 'exit', text: '출구: ' + (exits.join('  ') || '없음') });

    if (!p.surveyed.includes(rid)) {
      out.push({ t: 'hint', text: '아직 조사하지 않았다. `조사` 하면 매장지가 드러난다.' });
    } else {
      if (!r.nodes.length && !r.salvage) out.push({ t: 'dim', text: '쓸 만한 매장지가 없다.' });
      r.nodes.forEach((n, i) => {
        const owner = (world.claims[rid] || {})[i];
        const mine = p.built[rid] && p.built[rid].ext.some(e => e.node === i);
        const tag = !owner ? '비어 있음'
          : owner === p.id ? (mine ? '내 채굴기 가동 중' : '내 점유')
          : `${player(owner) ? player(owner).name : '?'} 점유`;
        out.push({ t: owner && owner !== p.id ? 'dim' : 'node',
          text: `  [${i + 1}] ${iname(n.res)} · ${PURITY_NAME[n.purity]} (×${n.purity}) — ${tag}` });
      });
      if (r.salvage) out.push({ t: 'node', text: '  잔해가 있다 — `회수` 로 뒤져볼 수 있다.' });
    }

    const here = online().filter(o => o.at === rid && o.id !== p.id);
    if (here.length) out.push({ t: 'who', text: '여기 있는 사람: ' + here.map(o => o.name).join(', ') });
    return out;
  }

  /* ---------- 명령 ---------- */
  const cmdLook = p => describe(p, p.at);

  function cmdMove(p, dir) {
    const to = REGIONS[p.at].exits[dir];
    if (!to) return [err(`${dir}쪽으로는 길이 없다.`)];
    const dest = REGIONS[to];
    if (dest.danger >= 2) {
      const need = Object.entries(GEAR).find(([, g]) => g.danger === dest.danger);
      if (need && !p.gear.includes(need[0]))
        return [err(`${dest.name}은(는) ${DANGER_NAME[dest.danger]} 지역이다. ${need[0]} 없이는 들어갈 수 없다. (\`제작 ${need[0]}\`)`)];
    }
    toRoom(p.at, [say(`${p.name} 이(가) ${dir}쪽으로 떠났다.`)], p.id);
    p.at = to;
    if (!p.visited.includes(to)) p.visited.push(to);
    toRoom(to, [say(`${p.name} 이(가) 도착했다.`)], p.id);
    return cmdLook(p);
  }

  function cmdSurvey(p) {
    if (p.surveyed.includes(p.at)) return [say('이미 조사한 지역이다.'), ...cmdLook(p)];
    p.surveyed.push(p.at);
    toRoom(p.at, [say(`${p.name} 이(가) 주변을 조사한다.`)], p.id);
    return [ok('조사 완료.'), ...cmdLook(p)];
  }

  function cmdSalvage(p) {
    const r = REGIONS[p.at];
    if (!r.salvage) return [err('여기엔 뒤질 잔해가 없다.')];
    if (!p.surveyed.includes(p.at)) return [err('먼저 `조사` 해야 한다.')];
    p.salvaged = p.salvaged || [];
    if (p.salvaged.includes(p.at)) return [err('이미 회수해 갔다. 남은 게 없다.')];
    p.salvaged.push(p.at);
    if (r.relic) { addStock(p, '유물', 1); return [ok('고대 유물 1개를 회수했다. 공동 프로젝트에 쓰인다.')]; }
    addStock(p, 'Desc_HardDrive_C', 1);
    return [ok('하드 드라이브 1개를 회수했다.')];
  }

  function cmdClaim(p, arg) {
    const r = REGIONS[p.at];
    if (!p.surveyed.includes(p.at)) return [err('먼저 `조사` 해야 한다.')];
    const i = parseInt(arg, 10) - 1;
    if (!(i >= 0 && i < r.nodes.length)) return [err('그런 번호의 매장지가 없다. `보기` 로 번호를 확인하라.')];
    world.claims[p.at] = world.claims[p.at] || {};
    const owner = world.claims[p.at][i];
    if (owner === p.id) return [say('이미 내 것이다.')];
    if (owner) return [err(`${player(owner) ? player(owner).name : '누군가'} 이(가) 이미 점유했다. 다른 자리를 찾아라.`)];
    world.claims[p.at][i] = p.id;
    const n = r.nodes[i];
    broadcast([say(`📍 ${p.name} 이(가) ${r.name}의 ${iname(n.res)} ${PURITY_NAME[n.purity]} 매장지를 점유했다.`)]);
    return [ok(`[${i + 1}] ${iname(n.res)} ${PURITY_NAME[n.purity]} 매장지를 점유했다. \`건설 채굴기 ${i + 1}\``)];
  }

  const builtAt = (p, rid) => (p.built[rid] = p.built[rid] || { ext: [], lines: [], gens: [], pumps: 0 });

  function cmdBuild(p, args) {
    const r = REGIONS[p.at];
    const what = (args[0] || '').toLowerCase();

    if (what === '채굴기' || what === '추출기') {
      const i = parseInt(args[1], 10) - 1;
      if (!(i >= 0 && i < r.nodes.length)) return [err('매장지 번호를 대라. 예) `건설 채굴기 1`')];
      if ((world.claims[p.at] || {})[i] !== p.id) return [err('점유하지 않은 매장지다. `점유 ' + (i + 1) + '` 부터.')];
      const b = builtAt(p, p.at);
      if (b.ext.some(e => e.node === i)) return [err('이미 그 매장지에 설비가 있다.')];
      const node = r.nodes[i];
      const def = EXTRACTOR[node.res];
      const cost = buildCost(def.build);
      const miss = shortfall(p, cost);
      if (miss) return [err(miss)];
      pay(p, cost);
      b.ext.push({ node: i, res: node.res, purity: node.purity });
      toRoom(p.at, [say(`${p.name} 이(가) ${mname(def.build)} 를 세웠다.`)], p.id);
      return [ok(`${mname(def.build)} 건설 — ${iname(node.res)} ${Math.round(def.rate * node.purity)}/분`)];
    }

    if (what === '물펌프' || what === '펌프') {
      if (!r.water) return [err('여긴 물이 없다.')];
      const cost = buildCost(WATER_PUMP.build);
      const miss = shortfall(p, cost);
      if (miss) return [err(miss)];
      pay(p, cost);
      builtAt(p, p.at).pumps++;
      return [ok(`물 펌프 건설 — 물 ${WATER_PUMP.rate}/분`)];
    }

    if (what === '발전기') {
      const key = args[1] || '석탄';
      const def = GENS[key];
      if (!def) return [err('발전기 종류: ' + Object.keys(GENS).join(', '))];
      if (def.needsWater && !r.water) return [err(`${key} 발전기는 물이 필요하다. 여긴 물이 없다.`)];
      const cost = buildCost(def.build);
      const miss = shortfall(p, cost);
      if (miss) return [err(miss)];
      pay(p, cost);
      const b = builtAt(p, p.at);
      let g = b.gens.find(x => x.key === key);
      if (!g) { g = { key, count: 0, eff: 1 }; b.gens.push(g); }
      g.count++;
      return [ok(`${key} 발전기 건설 (총 ${g.count}대) — 최대 ${def.power * g.count}MW`)];
    }

    const name = args.join(' ').trim();
    if (!name) return [err('무엇을 지을지 대라. `건설 채굴기 <번호>` / `건설 발전기` / `건설 <레시피> [수]`')];
    const mAmount = /\s(\d+)$/.exec(name);
    const amount = mAmount ? Math.max(1, parseInt(mAmount[1], 10)) : 1;
    const key = (mAmount ? name.slice(0, mAmount.index) : name).trim();
    const cand = D.recipes.filter(rc => !rc.alt && p.machines.includes(rc.machine) &&
      (rc.ko === key || rc.ko.replace(/\s/g, '') === key.replace(/\s/g, '')));
    if (!cand.length) {
      const near = D.recipes.filter(rc => !rc.alt && p.machines.includes(rc.machine) && rc.ko.includes(key)).slice(0, 8);
      return [err(`"${key}" 레시피를 못 찾았다.` + (near.length ? ' 비슷한 것: ' + near.map(x => x.ko).join(', ') : ''))];
    }
    const rec = cand[0];
    const cost = {};
    for (const [cn, n] of Object.entries(buildCost(rec.machine))) cost[cn] = n * amount;
    const miss = shortfall(p, cost);
    if (miss) return [err(miss)];
    pay(p, cost);
    const b = builtAt(p, p.at);
    let line = b.lines.find(l => l.recipeId === rec.id);
    if (!line) { line = { recipeId: rec.id, count: 0 }; b.lines.push(line); }
    line.count += amount;
    return [ok(`${rec.ko} 라인 +${amount} (여기 총 ${line.count}대, ${mname(rec.machine)} ${recipePower(rec)}MW/대)`)];
  }

  function cmdLink(p, dir) {
    const to = REGIONS[p.at].exits[dir];
    if (!to) return [err(`${dir}쪽으로는 길이 없다.`)];
    const key = [p.at, to].sort().join('|');
    if (p.links.includes(key)) return [say('이미 이어져 있다.')];
    const miss = shortfall(p, LINK_COST);
    if (miss) return [err(miss)];
    pay(p, LINK_COST);
    p.links.push(key);
    return [ok(`송전탑 건설 — ${REGIONS[p.at].name} ↔ ${REGIONS[to].name} 전력망 연결`)];
  }

  function cmdCraft(p, name) {
    const g = GEAR[name];
    if (!g) return [err('제작 가능: ' + Object.entries(GEAR).map(([k, v]) => `${k}(${v.desc})`).join(', '))];
    if (p.gear.includes(name)) return [say('이미 갖고 있다.')];
    const miss = shortfall(p, g.cost);
    if (miss) return [err(miss)];
    pay(p, g.cost);
    p.gear.push(name);
    return [ok(`${name} 제작 완료 — ${g.desc}`)];
  }

  function cmdFactory(p) {
    const out = [{ t: 'room', text: '내 시설' }];
    const { cells, grid } = powerOf(p);
    const ids = Object.keys(p.built);
    if (!ids.length) return [...out, say('아직 아무것도 짓지 않았다.')];
    for (const rid of ids) {
      const b = p.built[rid];
      const cell = cells[grid[rid]] || { eff: 1 };
      if (!b.ext.length && !b.lines.length && !b.gens.length && !b.pumps) continue;
      out.push({ t: 'exit', text: `${REGIONS[rid].name} — 가동률 ${Math.round(cell.eff * 100)}%` });
      for (const e of b.ext)
        out.push({ t: 'dim', text: `  ${mname(EXTRACTOR[e.res].build)} · ${iname(e.res)} ${PURITY_NAME[e.purity]} → ${fmt(EXTRACTOR[e.res].rate * e.purity * cell.eff)}/분` });
      if (b.pumps) out.push({ t: 'dim', text: `  물 펌프 ×${b.pumps} → ${fmt(WATER_PUMP.rate * b.pumps * cell.eff)}/분` });
      for (const l of b.lines) {
        const rc = recipeById[l.recipeId];
        out.push({ t: 'dim', text: `  ${rc.ko} ×${l.count} → ${fmt(perMin(rc, rc.out[0][1]) * l.count * (l.eff ?? cell.eff))}/분` + (l.why ? `  ⚠ ${l.why}` : '') });
      }
      for (const g of b.gens)
        out.push({ t: 'dim', text: `  ${g.key} 발전기 ×${g.count} → ${Math.round(GENS[g.key].power * g.count * (g.eff ?? 1))}MW` + ((g.eff ?? 1) < 0.99 ? '  ⚠ 연료 부족' : '') });
    }
    return out;
  }

  function cmdPower(p) {
    const { cells, grid } = powerOf(p);
    const out = [{ t: 'room', text: '전력망' }];
    const seen = new Set();
    for (const root of Object.values(grid)) {
      if (seen.has(root)) continue;
      seen.add(root);
      const cell = cells[root];
      if (!cell) continue;
      const members = Object.entries(grid).filter(([, rt]) => rt === root).map(([r]) => REGIONS[r].name);
      out.push({ t: 'exit', text: `${Math.round(cell.demand)} / ${Math.round(cell.supply)} MW (${Math.round(cell.eff * 100)}%)` });
      out.push({ t: 'dim', text: '  ' + members.join(', ') });
    }
    out.push({ t: 'hint', text: '물이 없는 지역은 발전할 수 없다 — `송전 <방향>` 으로 발전소가 있는 망과 이어라.' });
    return out;
  }

  function cmdStock(p, filter) {
    const rows = Object.entries(p.stock)
      .filter(([cn, v]) => v > 0.05 && (!filter || itemName(cn).includes(filter)))
      .sort((a, b) => b[1] - a[1]).slice(0, 30);
    if (!rows.length) return [say('재고가 없다.')];
    return [{ t: 'room', text: '재고' }, ...rows.map(([cn, v]) => {
      const rate = (p.rates || {})[cn] || 0;
      const r = Math.abs(rate) < 0.05 ? '' : `  ${rate > 0 ? '+' : ''}${fmt(rate)}/분`;
      return { t: 'dim', text: `  ${itemName(cn).padEnd(14)} ${fmt(v)}${r}` };
    })];
  }

  function cmdMap(p) {
    const out = [{ t: 'room', text: '지도 (방문한 곳만)' }];
    const byDist = {};
    for (const rid of p.visited) (byDist[REGIONS[rid].dist] = byDist[REGIONS[rid].dist] || []).push(rid);
    for (const d of Object.keys(byDist).sort((a, b) => a - b)) {
      out.push({ t: 'exit', text: `거리 ${d}` });
      for (const rid of byDist[d]) {
        const mine = p.built[rid] ? ' 🏭' : '';
        const cur = rid === p.at ? ' ←지금 여기' : '';
        const unexplored = Object.values(REGIONS[rid].exits).filter(t => !p.visited.includes(t)).length;
        out.push({ t: rid === p.at ? 'ok' : 'dim',
          text: `  ${regionLine(rid)}${mine}${cur}` + (unexplored ? `  · 미탐사 출구 ${unexplored}` : '') });
      }
    }
    out.push({ t: 'hint', text: `${p.visited.length} / ${Object.keys(REGIONS).length} 지역 발견` });
    return out;
  }

  function cmdProject(p) {
    const stage = PROJECT[world.project.stage];
    const out = [{ t: 'room', text: '공동 프로젝트 — 우주 엘리베이터' }];
    if (!stage) return [...out, ok('모든 단계가 완료되었다. 이 세계는 궤도와 연결되었다.')];
    out.push({ t: 'desc', text: stage.name });
    for (const [cn, n] of Object.entries(stage.need)) {
      const have = world.project.delivered[cn] || 0;
      out.push({ t: have >= n ? 'ok' : 'node', text: `  ${itemName(cn)} ${fmt(have)} / ${n}` });
    }
    const top = Object.entries(world.project.contrib).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) {
      out.push({ t: 'exit', text: '기여 순위' });
      top.forEach(([pid, v], i) => out.push({ t: 'dim', text: `  ${i + 1}. ${player(pid) ? player(pid).name : '?'} — ${fmt(v)}` }));
    }
    out.push({ t: 'hint', text: solo
      ? '혼자 하는 세계라 필요량이 5분의 1로 줄어 있다. `납품 <품목> <수량>`'
      : '`납품 <품목> <수량>` 으로 기여한다. 혼자서는 끝낼 수 없는 양이다.' });
    return out;
  }

  function cmdDeliver(p, args) {
    const stage = PROJECT[world.project.stage];
    if (!stage) return [say('더 납품할 것이 없다.')];
    const nameArg = args.slice(0, -1).join(' ') || args[0];
    const amount = Math.max(1, parseInt(args[args.length - 1], 10) || 1);
    const cn = Object.keys(stage.need).find(c => itemName(c) === nameArg ||
      itemName(c).replace(/\s/g, '') === (nameArg || '').replace(/\s/g, ''));
    if (!cn) return [err('이번 단계에 필요한 품목: ' + Object.keys(stage.need).map(itemName).join(', '))];
    const give = Math.min(amount, Math.floor(stockOf(p, cn)), stage.need[cn] - (world.project.delivered[cn] || 0));
    if (give < 1) return [err('납품할 수량이 없다.')];
    addStock(p, cn, -give);
    world.project.delivered[cn] = (world.project.delivered[cn] || 0) + give;
    world.project.contrib[p.id] = (world.project.contrib[p.id] || 0) + give;
    broadcast([say(`📦 ${p.name} 이(가) ${itemName(cn)} ${give} 을(를) 납품했다.`)]);
    if (Object.entries(stage.need).every(([c, n]) => (world.project.delivered[c] || 0) >= n)) {
      world.project.stage++;
      world.project.delivered = {};
      broadcast([ok(`🎉 ${stage.name} 완료! 다음 단계가 열렸다.`)]);
    }
    return [ok(`${itemName(cn)} ${give} 납품.`)];
  }

  function cmdWho() {
    const list = online();
    return [{ t: 'room', text: `접속 중 (${list.length}명)` },
      ...list.map(o => ({ t: 'dim', text: `  ${o.name} — ${REGIONS[o.at].name}` }))];
  }

  const cmdHelp = () => [{ t: 'room', text: '명령어' },
    ...HELP.map(([c, d]) => ({ t: 'dim', text: `  ${c.padEnd(22)} ${d}` }))];

  function handleCommand(p, raw) {
    const line = String(raw || '').trim();
    if (!line) return [];
    const parts = line.split(/\s+/);
    const head = parts[0];
    const rest = parts.slice(1);
    const dir = DIRS.includes(head) ? head : DIR_ALIAS[head.toLowerCase()];
    if (dir) return cmdMove(p, dir);

    switch (head) {
      case '이동': case 'go': {
        const d = DIRS.includes(rest[0]) ? rest[0] : DIR_ALIAS[(rest[0] || '').toLowerCase()];
        return d ? cmdMove(p, d) : [err('방향을 대라. 북 남 동 서 위 아래')];
      }
      case '보기': case '살펴보기': case 'l': case 'look': return cmdLook(p);
      case '조사': case 'survey': return cmdSurvey(p);
      case '회수': case '수색': return cmdSalvage(p);
      case '점유': case 'claim': return cmdClaim(p, rest[0]);
      case '건설': case 'build': return cmdBuild(p, rest);
      case '송전': case 'link': {
        const d = DIRS.includes(rest[0]) ? rest[0] : DIR_ALIAS[(rest[0] || '').toLowerCase()];
        return d ? cmdLink(p, d) : [err('방향을 대라. 예) `송전 남`')];
      }
      case '제작': case 'craft': return cmdCraft(p, rest.join(''));
      case '공장': return cmdFactory(p);
      case '재고': case '인벤': return cmdStock(p, rest.join(' '));
      case '전력': return cmdPower(p);
      case '지도': case 'map': return cmdMap(p);
      case '목표': case '프로젝트': return cmdProject(p);
      case '납품': return cmdDeliver(p, rest);
      case '누구': case 'who': return cmdWho();
      case '말': case 'say': {
        const msg = rest.join(' ');
        if (!msg) return [err('무슨 말을 할지 적어라.')];
        toRoom(p.at, [{ t: 'chat', text: `${p.name}: ${msg}` }], p.id);
        return [{ t: 'chat', text: `나: ${msg}` }];
      }
      case '외침': case 'shout': {
        const msg = rest.join(' ');
        if (!msg) return [err('무슨 말을 할지 적어라.')];
        for (const o of online()) if (o.id !== p.id) emit.toPlayer && emit.toPlayer(o.id, [{ t: 'chat', text: `[전체] ${p.name}: ${msg}` }]);
        return [{ t: 'chat', text: `[전체] 나: ${msg}` }];
      }
      case '도움말': case '?': case 'help': return cmdHelp();
      default: return [err(`"${head}" 가 뭔지 모르겠다. \`도움말\` 을 쳐 보라.`)];
    }
  }

  /* ---------- 접속 ---------- */
  function join(name) {
    const clean = String(name || '').trim().slice(0, 12).replace(/[<>\s]/g, '') || '개척자';
    if (Object.values(world.players).some(p => p.name === clean))
      return { error: '같은 이름이 이미 있다. 다른 이름을 쓰라.' };
    const id = 'p' + (Object.keys(world.players).length + 1) + '_' + Date.now().toString(36);
    const token = rng();
    world.players[id] = {
      id, name: clean, at: 'grass_hub',
      stock: { ...STARTER }, built: {}, links: [], gear: [],
      visited: ['grass_hub'], surveyed: [], salvaged: [],
      machines: [...STARTER_MACHINES],
      rates: {}, joinedAt: now(), lastSeen: now(),
    };
    tokens.set(token, id);
    broadcast([say(`✦ ${clean} 이(가) 이 세계에 강하했다.`)]);
    return { token, id, name: clean };
  }

  function resume(token) {
    const id = tokens.get(token);
    return id && world.players[id] ? world.players[id] : null;
  }

  const greeting = p => [
    { t: 'room', text: '개척 원정대' },
    { t: 'desc', text: '캡슐 문이 열리고 낯선 대기가 밀려든다. 이 행성에서 쓸 수 있는 것은 ' +
      '캡슐 원자로 100MW 와 상자 하나뿐이다. 좋은 자리는 정해져 있고, 먼저 잡는 사람이 임자다.' },
    { t: 'hint', text: '`도움말` 로 명령어를, `조사` 로 발밑을 확인하라.' },
    ...cmdLook(p),
  ];

  function summary(p) {
    const { cells, grid } = powerOf(p);
    const cell = cells[grid[p.at]] || cells[grid.grass_hub] || { supply: 0, demand: 0, eff: 1 };
    const stage = PROJECT[world.project.stage];
    return {
      name: p.name, at: REGIONS[p.at].name, atId: p.at,
      danger: REGIONS[p.at].danger, water: REGIONS[p.at].water,
      power: { supply: Math.round(cell.supply), demand: Math.round(cell.demand) },
      visited: p.visited.length, total: Object.keys(REGIONS).length,
      gear: p.gear,
      stock: Object.entries(p.stock).filter(([, v]) => v > 0.05)
        .sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([cn, v]) => ({ name: itemName(cn), n: fmt(v), rate: (p.rates || {})[cn] || 0 })),
      project: stage
        ? { name: stage.name, need: Object.entries(stage.need)
            .map(([cn, n]) => ({ name: itemName(cn), have: Math.floor(world.project.delivered[cn] || 0), need: n })) }
        : { name: '완료', need: [] },
      online: online().length,
      solo,
    };
  }

  /* ---------- 직렬화 (저장 방식은 어댑터가 정한다) ---------- */
  const dump = () => ({ v: 1, savedAt: now(), world, tokens: [...tokens.entries()] });
  function restore(s) {
    if (!s || !s.world) return 0;
    Object.assign(world, s.world);
    tokens.clear();
    for (const [t, id] of s.tokens || []) tokens.set(t, id);
    // 꺼져 있던 동안에도 공장은 돌았어야 한다
    const elapsed = Math.min(OFFLINE_CAP_H * 3600, (now() - (s.savedAt || now())) / 1000);
    if (elapsed > TICK_SEC) {
      const steps = Math.floor(elapsed / TICK_SEC);
      for (let i = 0; i < steps; i++) tickAll(TICK_SEC / 60);
    }
    return elapsed;
  }

  return { world, join, resume, handleCommand, summary, greeting, tickAll, dump, restore, PROJECT, TICK_SEC };
}

return { createWorld, TICK_SEC, OFFLINE_CAP_H, REGIONS, HELP };
});
