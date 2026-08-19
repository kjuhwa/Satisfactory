'use strict';
/* 효율 헬퍼 — 매장지(순도·설비·클럭)에서 출발해 목표 아이템까지
 * 유휴 없는 세팅(벨트/파이프, 기계 대수, 언더클럭)을 계산하고
 * 실제 게임에서 짓는 모양 그대로 배치도로 보여준다. 1.0 수치.
 */

const D = window.GAME_DATA;
const $ = id => document.getElementById(id);

const BELTS = [[1, 60], [2, 120], [3, 270], [4, 480], [5, 780], [6, 1200]];
const PIPES = [[1, 300], [2, 600]];
const MINER_BASE = { 1: 60, 2: 120, 3: 240 };   // 보통 순도, 100% 기준 /분
const MINER_PWR = { 1: 5, 2: 15, 3: 45 };       // MW
const PURITY = [['impure', '임순', 0.5], ['normal', '보통', 1], ['pure', '순수', 2]];
const EXP = 1.321929;                            // 오버클럭 전력 지수
const SOLID = ['Desc_OreIron_C', 'Desc_OreCopper_C', 'Desc_Stone_C', 'Desc_Coal_C',
  'Desc_OreGold_C', 'Desc_RawQuartz_C', 'Desc_Sulfur_C', 'Desc_OreBauxite_C',
  'Desc_OreUranium_C', 'Desc_SAM_C'];
/* 액체 자원: 순도 개념이 있는 원유, 무제한·고정 속도인 물 */
const RES_KIND = {
  'Desc_Water_C': { kind: 'water', base: 120, pwr: 20, mach: 'Desc_WaterPump_C', mname: '양수기' },
  'Desc_LiquidOil_C': { kind: 'oil', base: 120, pwr: 40, mach: 'Desc_OilPump_C', mname: '원유 추출기' },
};
const RESOURCES = [...SOLID, 'Desc_Water_C', 'Desc_LiquidOil_C'];

const koOf = id => (D.items[id] && (D.items[id].ko || D.items[id].n)) || id;
const fmt = x => (Math.round(x * 100) / 100).toLocaleString('ko-KR');
const isRaw = id => D.raw.includes(id);
const isLiq = id => !!(D.items[id] && D.items[id].liq);
const resKind = () => (RES_KIND[state.res] || { kind: 'miner' }).kind;

/* 아이템 → 그 아이템을 만드는 레시피들 */
const byOut = {};
for (const r of D.recipes) for (const [o] of r.out) (byOut[o] = byOut[o] || []).push(r);

/* ---------- 상태 ---------- */
let state = {
  res: 'Desc_OreIron_C',
  deps: [{ purity: 'normal', mk: 1, clock: 100 }],
  target: null,          // item id
  recipeSel: {},         // item id -> recipe id
  noMerge: {},           // item id -> true(합류기 생략, 각자 직결 배치도)
  maxBelt: 6,            // 해금된 벨트 티어
  maxPipe: 2,            // 해금된 파이프 티어
  auxPurity: {},         // 부수 원자재 매장지 순도 (item id -> impure|normal|pure)
};
try {
  const saved = JSON.parse(localStorage.getItem('sfy-helper') || 'null');
  if (saved && saved.res) state = Object.assign(state, saved);
} catch (e) { }
state.noMerge = state.noMerge || {};
state.maxBelt = state.maxBelt || 6;
state.maxPipe = state.maxPipe || 2;
state.auxPurity = state.auxPurity || {};
const save = () => localStorage.setItem('sfy-helper', JSON.stringify(state));

/* ---------- 벨트 · 파이프 (해금된 티어만 사용) ---------- */
function avTiers(liq) {
  return (liq ? PIPES : BELTS).filter(([mk]) => mk <= (liq ? state.maxPipe : state.maxBelt));
}
function maxCap(liq) { const t = avTiers(liq); return t[t.length - 1][1]; }
function flowFor(rate, liq) {
  const tiers = avTiers(liq);
  for (const [mk, cap] of tiers) if (rate <= cap + 1e-9) return { mk, cap, lines: 1, liq };
  const [mk, cap] = tiers[tiers.length - 1];
  return { mk, cap, lines: Math.ceil(rate / cap - 1e-9), liq };
}
function flowName(f) {
  const w = f.liq ? '파이프' : '벨트';
  return f.lines > 1 ? `${w} Mk.${f.mk} × ${f.lines}줄` : `${w} Mk.${f.mk}`;
}
function flowBadge(rate, liq) {
  const f = flowFor(rate, liq);
  const util = rate / (f.cap * f.lines) * 100;
  const exact = Math.abs(util - 100) < 0.05;
  return `<span class="badge ${liq ? 'pipe' : 'belt'}">${flowName(f)}</span> <span class="badge ${exact ? 'good' : ''}">${exact ? '딱 맞음 ✨' : '사용률 ' + fmt(util) + '%'}</span>`;
}
const unitOf = liq => liq ? '㎥/분' : '/분';

/* ---------- 채굴 · 추출 ----------
 * 채굴기/추출기의 출력 포트는 하나 → 해금된 벨트/파이프 한도가 실효 상한이 된다 */
function depRateRaw(d) {
  const k = resKind();
  if (k === 'water') return RES_KIND[state.res].base * d.clock / 100;
  const pm = PURITY.find(p => p[0] === d.purity)[2];
  if (k === 'oil') return RES_KIND[state.res].base * pm * d.clock / 100;
  return MINER_BASE[d.mk] * pm * d.clock / 100;
}
function depRate(d) {
  return Math.min(depRateRaw(d), maxCap(isLiq(state.res)));
}
function depPower(d) {
  const k = resKind();
  const base = k === 'miner' ? MINER_PWR[d.mk] : RES_KIND[state.res].pwr;
  return base * Math.pow(d.clock / 100, EXP);
}
function depMachine(d) {
  const k = resKind();
  if (k === 'miner') return { icon: `Desc_MinerMk${d.mk}_C`, name: `채굴기 Mk.${d.mk}` };
  return { icon: RES_KIND[state.res].mach, name: RES_KIND[state.res].mname };
}
const totalMine = () => state.deps.reduce((s, d) => s + depRate(d), 0);

function shardsFor(clock) { return clock > 100 ? Math.ceil((clock - 100) / 50 - 1e-9) : 0; }

/* 추출기 한 대의 팁: 벨트 병목 경고 또는 꽉 채우는 클럭 제안 */
function depTip(d) {
  const liq = isLiq(state.res);
  const raw = depRateRaw(d);
  const cap = maxCap(liq);
  if (raw > cap + 1e-9) {
    // 출력 포트가 하나라 벨트가 병목 — 클럭을 낮추면 같은 실효 출력에 전력 절약
    const fit = cap / (raw / (d.clock / 100)) * 100;
    const kind = liq ? '파이프' : '벨트';
    return `<div class="tip">⚠ <b>${kind} 병목</b> — 출력 ${fmt(raw)} > 해금 ${kind} 한도 ${cap}, 실효 <b>${fmt(cap)}${unitOf(liq)}</b>.
      클럭을 <b>${fmt(fit)}%</b>로 낮추면 같은 양을 캐면서 전력만 절약됩니다 (상위 ${kind} 해금 시 되돌리기)</div>`;
  }
  const rate = depRate(d);
  const f = flowFor(rate, liq);
  if (f.lines > 1 || rate >= f.cap - 1e-9) return '';
  const base = rate / (d.clock / 100);
  const fit = f.cap / base * 100;
  if (fit > 250 + 1e-9) return '';
  const sh = shardsFor(fit);
  return `<div class="tip">💡 클럭 <b>${fmt(fit)}%</b>로 올리면 ${flowName(f)}를 꽉 채웁니다${sh ? ` (동력 조각 ${sh}개)` : ''}</div>`;
}

/* ---------- 레시피 선택 ---------- */
function recipeOf(item) {
  const list = byOut[item] || [];
  if (!list.length) return null;
  const sel = state.recipeSel[item];
  return list.find(r => r.id === sel)
    || list.find(r => !r.alt && r.out[0][0] === item)   // 주 산출물인 정규 레시피 우선
    || list.find(r => !r.alt) || list[0];
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

function buildChain(targetRate, credits) {
  const totals = {};   // item -> {rate, depth}
  const ext = {};      // 외부 공급 item -> rate
  const bypro = {};    // 부산물 item -> rate
  const reused = {};   // 부산물 재사용량 item -> rate
  const creditLeft = Object.assign({}, credits || {});
  let oreUsed = 0;
  const walk = (item, rate, depth, visiting) => {
    // 부산물 크레딧부터 소진 (목표 자체는 제외 — 목표량 의미 유지)
    if (depth > 0 && creditLeft[item] > 1e-12) {
      const u = Math.min(rate, creditLeft[item]);
      creditLeft[item] -= u;
      reused[item] = (reused[item] || 0) + u;
      rate -= u;
      if (rate <= 1e-12) return;
    }
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
  return { totals, ext, bypro, reused, oreUsed };
}

/* 부산물 재사용 + 채굴량 완전 소진을 함께 만족할 때까지 반복 수렴 */
function solveChain(E, orePer) {
  let targetRate = E / orePer;
  let credits = {};
  let chain = null;
  for (let it = 0; it < 10; it++) {
    chain = buildChain(targetRate, credits);
    let stable = true;
    for (const k of new Set([...Object.keys(chain.bypro), ...Object.keys(credits)])) {
      if (Math.abs((chain.bypro[k] || 0) - (credits[k] || 0)) > 1e-6) { stable = false; break; }
    }
    credits = chain.bypro;
    if (chain.oreUsed > 1e-9 && Math.abs(chain.oreUsed - E) > 1e-6) {
      targetRate *= E / chain.oreUsed;
      stable = false;
    }
    if (stable) break;
  }
  chain.targetRate = targetRate;
  return chain;
}

/* ---------- 분배기 (실게임: 분배기 1→3, 합류기 3→1) ----------
 * 균형 트리: 대수가 2·3의 곱(2,3,4,6,8,9,12…)일 때만 가능 — 즉시 균등.
 * 매니폴드(일렬): 아무 대수나 가능 — 버퍼가 찰 때까지 앞쪽 기계부터 돈다.
 * 액체는 파이프 접합부가 알아서 균형을 맞추므로 해당 없음. */
function splitTree(n) {
  let m = n;
  const fs = [];
  while (m % 2 === 0) { fs.push(2); m /= 2; }
  while (m % 3 === 0) { fs.push(3); m /= 3; }
  if (m !== 1 || n < 2) return null;
  fs.sort();                       // 2분기 먼저 → 분배기 수 최소
  let count = 0, width = 1;
  const desc = [];
  for (const f of fs) {
    desc.push(width === 1 ? `1→${f}` : `1→${f} ×${width}`);
    count += width;
    width *= f;
  }
  return { count, desc: desc.join(', ') };
}
function nextBalanced(n) {
  for (let k = n + 1; k <= n * 3 + 2; k++) if (splitTree(k)) return k;
  return null;
}

function distGuide(item, ml, rate) {
  const N = ml.count;
  const liqIns = ml.r.in.filter(([i]) => isLiq(i));
  const solidIns = ml.r.in.filter(([i]) => !isLiq(i));
  let html = '';
  if (N > 1 && solidIns.length) {
    const per = rate / N;
    const tree = splitTree(N);
    // 입력이 해금 벨트 한도를 넘으면 여러 줄로 나눠 와야 한다
    const maxInLines = Math.max(...solidIns.map(([ing, q]) => {
      const outQty = ml.r.out.find(o => o[0] === item)[1];
      return flowFor(rate / outQty * q, false).lines;
    }));
    if (maxInLines > 1) {
      html += `<div class="tip">🔀 입력이 해금 벨트 한도를 넘어 <b>${maxInLines}줄</b>로 들어옵니다 — 기계를 ${maxInLines}그룹(각 ~${Math.ceil(N / maxInLines)}대)으로 나눠 줄마다 아래 분배를 반복하세요</div>`;
    }
    html += '<div class="tip">🔀 벨트 1줄 → ' + N + '대 나누기: ';
    if (tree) {
      html += `<b>균형 트리</b> — 분배기 ${tree.count}개 (${tree.desc}) → 즉시 각 ${fmt(per)}/분 균등. ` +
        `또는 매니폴드(분배기 ${N - 1}개 일렬, 마지막 기계는 벨트 끝 직결) — 간단하지만 예열 필요`;
    } else {
      const nb = nextBalanced(N);
      html += `<b>매니폴드</b> — 분배기 ${N - 1}개 일렬, 마지막 기계는 벨트 끝 직결 (${N}대는 2·3 곱이 아니라 균형 트리 불가)`;
      if (nb) {
        const c2 = rate / (nb * ml.per) * 100;
        const t2 = splitTree(nb);
        html += `. 즉시 균등을 원하면 <b>${nb}대 × ${fmt(c2)}%</b>로 — 균형 트리(분배기 ${t2.count}개: ${t2.desc}) 가능`;
      }
    }
    if (state.noMerge[item]) {
      html += ` · 출력은 합류기 없이 각 기계에서 ${fmt(rate / N)}${unitOf(isLiq(item))}씩 직결</div>`;
    } else {
      html += isLiq(item) ? ` · 출력은 파이프 접합으로 합류</div>` : ` · 모으기: 합류기 ${N - 1}개 일렬</div>`;
    }
    if (solidIns.length > 1) html += `<div class="tip">↳ 고체 입력이 ${solidIns.length}종이므로 재료마다 벨트·분배를 따로 구성합니다</div>`;
  }
  if (N > 1 && liqIns.length) {
    html += `<div class="tip">💧 액체 입력(${liqIns.map(([i]) => koOf(i)).join(', ')})은 파이프를 접합부로 이어 나누면 됩니다 — 압력으로 자연 균형이 맞아 분배기·예열 걱정이 없습니다</div>`;
  }
  return html;
}

/* ---------- 배치도 (실제 짓는 모양) ---------- */
const BP = {
  belt: '#c9a97e', pipe: '#58a6ff', drop: '#57503f', frame: '#3a332a',
  text: '#9a917f', bright: '#e8e2d8', accent: '#fa9549',
};
const IC_SPLIT = 'Desc_ConveyorAttachmentSplitter_C';
const IC_MERGE = 'Desc_ConveyorAttachmentMerger_C';
const IC_JUNC = 'Desc_PipelineJunction_Cross_C';
function svgIcon(id, x, y, s) {
  return `<image href="../game/icons/${id}.png" x="${x}" y="${y}" width="${s}" height="${s}"/>`;
}
/* 라인 위 분기/합류 지점: 액체는 접합, 고체는 분배기/합류기 실물 아이콘 */
function tapIcon(liq, kind, cx, cy) {
  const id = liq ? IC_JUNC : (kind === 'split' ? IC_SPLIT : IC_MERGE);
  return `<rect x="${cx - 9}" y="${cy - 9}" width="18" height="18" rx="4" fill="#241f18" stroke="${BP.frame}"/>` +
    svgIcon(id, cx - 8, cy - 8, 16);
}

/* 추출 배치도: 추출기들 → 합류 한 줄 */
function mineDiagram() {
  const c = mineDiagramCore();
  return `<div class="bp"><svg viewBox="0 0 ${c.W} ${c.H}" style="min-width:${Math.min(c.W, 780)}px">${c.s}</svg></div>`;
}
function mineDiagramCore() {
  const deps = state.deps;
  const liq = isLiq(state.res);
  const N = deps.length;
  const cell = 96, x0 = 20;
  const W = Math.max(x0 + N * cell + 250, 560), H = 148;
  const mergeY = 112;
  let s = '', taps = '';
  deps.forEach((d, i) => {
    const cx = x0 + i * cell + cell / 2;
    const m = depMachine(d);
    s += svgIcon(m.icon, cx - 22, 8, 44);
    s += svgIcon(state.res, cx + 12, 34, 18);
    const pu = resKind() === 'water' ? '' : PURITY.find(p => p[0] === d.purity)[1] + ' · ';
    s += `<text x="${cx}" y="66" text-anchor="middle" font-size="10" fill="${BP.text}">${pu}${m.name}${d.clock !== 100 ? ' ' + fmt(d.clock) + '%' : ''}</text>`;
    s += `<text x="${cx}" y="80" text-anchor="middle" font-size="11" font-weight="700" fill="${BP.bright}">${fmt(depRate(d))}${unitOf(liq)}</text>`;
    s += `<line x1="${cx}" y1="84" x2="${cx}" y2="${mergeY}" stroke="${BP.drop}" stroke-width="2"/>`;
    if (N > 1 && i > 0) taps += tapIcon(liq, 'merge', cx, mergeY);  // 첫 대는 라인 시작점(직결)
  });
  const lineX1 = x0 + cell / 2, lineX2 = x0 + (N - 1) * cell + cell / 2;
  const col = liq ? BP.pipe : BP.belt;
  const E = totalMine();
  const f = flowFor(E, liq);
  s += `<line x1="${lineX1}" y1="${mergeY}" x2="${lineX2 + 40}" y2="${mergeY}" stroke="${col}" stroke-width="${liq ? 5 : 3}" ${liq ? '' : 'stroke-dasharray="7 4"'}/>`;
  s += `<line x1="${lineX2 + 40}" y1="${mergeY}" x2="${W - 190}" y2="${mergeY}" stroke="${col}" stroke-width="${liq ? 5 : 3}" ${liq ? '' : 'stroke-dasharray="7 4"'}/>`;
  s += `<polygon points="${W - 190},${mergeY - 5} ${W - 180},${mergeY} ${W - 190},${mergeY + 5}" fill="${col}"/>`;
  s += taps;
  s += `<text x="${W - 172}" y="${mergeY - 2}" font-size="11" font-weight="700" fill="${BP.accent}">합계 ${fmt(E)}${unitOf(liq)}</text>`;
  s += `<text x="${W - 172}" y="${mergeY + 12}" font-size="10" fill="${BP.text}">${flowName(f)}${N > 1 ? (liq ? ' · 접합 ' + (N - 1) + '곳' : ' · 합류기 ' + (N - 1) + '개') : ''}</text>`;
  return { s, W, H, outPort: { x: W - 180, y: mergeY, liq } };
}

/* 공정 한 단계 배치도: 입력 라인(들) → 분배 → 기계 N대 → 합류 → 출력 */
function stageDiagram(item, ml, rate) {
  const c = stageDiagramCore(item, ml, rate);
  return `<div class="bp"><svg viewBox="0 0 ${c.W} ${c.H}" style="min-width:${Math.min(c.W, 780)}px">${c.s}</svg></div>`;
}
function stageDiagramCore(item, ml, rate) {
  const N = ml.count;
  const drawN = Math.min(N, 24);
  const ins = ml.r.in.map(([ing, q]) => {
    const outQty = ml.r.out.find(o => o[0] === item)[1];
    return { ing, rate: rate / outQty * q, liq: isLiq(ing) };
  });
  const cell = 56, x0 = 168;
  const inTop = 14, inGap = 17;
  const machY = inTop + ins.length * inGap + 12;
  const iconS = 38;
  const mergeY = machY + iconS + 22;
  const W = Math.max(x0 + drawN * cell + 205, 620), H = mergeY + 30;
  let s = '';
  // 입력 라인들 — 분배기는 앞쪽 N-1대에만, 마지막 기계는 벨트 끝 직결
  let taps = '';
  ins.forEach((inp, k) => {
    const y = inTop + k * inGap;
    const col = inp.liq ? BP.pipe : BP.belt;
    const lastX = x0 + (drawN - 1) * cell + cell / 2;
    s += `<text x="6" y="${y + 4}" font-size="10" fill="${BP.text}">${koOf(inp.ing)} <tspan font-weight="700" fill="${BP.bright}">${fmt(inp.rate)}${unitOf(inp.liq)}</tspan></text>`;
    s += `<line x1="${x0 - 26}" y1="${y}" x2="${lastX}" y2="${y}" stroke="${col}" stroke-width="${inp.liq ? 4 : 2.5}" ${inp.liq ? '' : 'stroke-dasharray="6 4"'}/>`;
    for (let i = 0; i < drawN; i++) {
      const cx = x0 + i * cell + cell / 2;
      s += `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${machY}" stroke="${BP.drop}" stroke-width="1.5"/>`;
      const isEnd = i === drawN - 1 && drawN === N;   // 마지막 기계 = 라인 끝 직결
      if (!isEnd) taps += tapIcon(inp.liq, 'split', cx, y);
    }
  });
  // 기계들 — 합류기는 두 번째 기계부터 (첫 기계가 출력 라인의 시작점)
  const noMerge = N > 1 && !!state.noMerge[item];
  const outLiqEarly = isLiq(item);
  for (let i = 0; i < drawN; i++) {
    const cx = x0 + i * cell + cell / 2;
    s += `<rect x="${cx - iconS / 2 - 3}" y="${machY - 3}" width="${iconS + 6}" height="${iconS + 6}" rx="6" fill="#2a251d" stroke="${BP.frame}"/>`;
    s += svgIcon(ml.r.machine, cx - iconS / 2, machY, iconS);
    if (noMerge) {
      // 합류기 생략: 각 기계가 자기 벨트/파이프로 바로 내려보냄
      const colO = outLiqEarly ? BP.pipe : BP.belt;
      s += `<line x1="${cx}" y1="${machY + iconS + 3}" x2="${cx}" y2="${mergeY - 2}" stroke="${colO}" stroke-width="${outLiqEarly ? 4 : 2.5}" ${outLiqEarly ? '' : 'stroke-dasharray="6 4"'}/>`;
      s += `<polygon points="${cx - 4},${mergeY - 2} ${cx + 4},${mergeY - 2} ${cx},${mergeY + 5}" fill="${colO}"/>`;
    } else {
      s += `<line x1="${cx}" y1="${machY + iconS + 3}" x2="${cx}" y2="${mergeY}" stroke="${BP.drop}" stroke-width="1.5"/>`;
      if (i > 0) taps += tapIcon(outLiqEarly, 'merge', cx, mergeY);
    }
  }
  if (N > drawN) {
    const cx = x0 + drawN * cell + 8;
    s += `<text x="${cx}" y="${machY + iconS / 2 + 4}" font-size="13" font-weight="700" fill="${BP.text}">… ×${N}</text>`;
  }
  // 기계 라벨 (왼쪽)
  s += `<text x="6" y="${machY + iconS / 2 - 2}" font-size="11" font-weight="700" fill="${BP.bright}">${ml.m.ko} ${N}대</text>`;
  s += `<text x="6" y="${machY + iconS / 2 + 12}" font-size="10" fill="${ml.exact ? '#6fd68a' : BP.text}">각 ${fmt(ml.clock)}%${ml.exact ? ' 딱 ✨' : ''}</text>`;
  // 출력: 한 줄 합류 또는 각자 직결
  const outLiq = outLiqEarly;
  const colO = outLiq ? BP.pipe : BP.belt;
  if (noMerge) {
    const per = rate / N;
    const fp = flowFor(per, outLiq);
    const midX = x0 + (drawN - 1) * cell / 2 + cell / 2;
    s += taps;
    s += `<text x="${midX}" y="${mergeY + 17}" text-anchor="middle" font-size="10.5" fill="${BP.bright}">각 <tspan font-weight="700" fill="${BP.accent}">${fmt(per)}${unitOf(outLiq)}</tspan> · ${flowName(fp)} — 다음 공정 기계·저장고에 각자 직결 (합류기 0개)</text>`;
    if (N > 1) s += `<text x="${W - 8}" y="11" text-anchor="end" font-size="9.5" fill="${BP.text}">매니폴드 기준 배치도 · 합류기 생략</text>`;
  } else {
    const f = flowFor(rate, outLiq);
    s += `<line x1="${x0 + cell / 2}" y1="${mergeY}" x2="${W - 195}" y2="${mergeY}" stroke="${colO}" stroke-width="${outLiq ? 5 : 3}" ${outLiq ? '' : 'stroke-dasharray="7 4"'}/>`;
    s += `<polygon points="${W - 195},${mergeY - 5} ${W - 185},${mergeY} ${W - 195},${mergeY + 5}" fill="${colO}"/>`;
    s += taps;
    if (N > 1) s += `<text x="${W - 8}" y="11" text-anchor="end" font-size="9.5" fill="${BP.text}">매니폴드 기준 배치도</text>`;
    s += svgIcon(item, W - 178, mergeY - 22, 18);
    s += `<text x="${W - 156}" y="${mergeY - 8}" font-size="11" font-weight="700" fill="${BP.accent}">${fmt(rate)}${unitOf(outLiq)}</text>`;
    s += `<text x="${W - 178}" y="${mergeY + 12}" font-size="10" fill="${BP.text}">${flowName(f)}${N > 1 ? (outLiq ? ' · 접합' : ' · 합류기 ' + (N - 1) + '개') : ''}</text>`;
  }
  const inPorts = ins.map((inp, k) => ({ ing: inp.ing, x: x0 - 26, y: inTop + k * inGap, liq: inp.liq }));
  const outPort = noMerge
    ? { x: x0 + (drawN - 1) * cell / 2 + cell / 2, y: mergeY + 8, liq: outLiq }
    : { x: W - 185, y: mergeY, liq: outLiq };
  return { s, W, H, inPorts, outPort };
}

/* ---------- 부수 원자재 채굴 계획 (정석: 외부 공급 없이 전부 직접 캔다) ----------
 * 체인에 필요한 다른 원자재(석탄·석영·물…)도 채굴기/추출기 대수·클럭으로 계획.
 * 매장지 순도는 카드에서 선택(state.auxPurity, 기본 보통), 채굴기 Mk는 주 자원과 동일. */
function auxPlans(ext) {
  const plans = [];
  for (const [id, need] of Object.entries(ext)) {
    if (need <= 1e-6) continue;
    if (!isRaw(id) || id === 'Desc_NitrogenGas_C') { plans.push({ id, need, unplanned: true }); continue; }
    const liq = isLiq(id);
    let base, pwr, icon, name, hasPu = true;
    if (id === 'Desc_Water_C') { base = 120; pwr = 20; icon = 'Desc_WaterPump_C'; name = '양수기'; hasPu = false; }
    else if (id === 'Desc_LiquidOil_C') { base = 120; pwr = 40; icon = 'Desc_OilPump_C'; name = '원유 추출기'; }
    else {
      const mk = resKind() === 'miner' ? state.deps[0].mk : 1;
      base = MINER_BASE[mk]; pwr = MINER_PWR[mk]; icon = `Desc_MinerMk${mk}_C`; name = `채굴기 Mk.${mk}`;
    }
    const pu = hasPu ? (state.auxPurity[id] || 'normal') : null;
    const puDef = pu ? PURITY.find(p => p[0] === pu) : null;
    const eff = base * (puDef ? puDef[2] : 1);         // 순도 반영 원출력
    const per = Math.min(eff, maxCap(liq));            // 한 대 실효 상한 (출력 포트 1개)
    const count = Math.ceil(need / per - 1e-9);
    const clock = need / (count * eff) * 100;
    const power = pwr * count * Math.pow(clock / 100, EXP);
    plans.push({ id, need, liq, count, clock, power, icon, name, pu, puKo: puDef ? puDef[1] : '' });
  }
  return plans;
}

/* 부수 원자재 채굴 배치도 (작은 추출 섹션) */
function auxMineCore(pl) {
  const N = Math.min(pl.count, 10);
  const cell = 78, x0 = 18, mergeY = 92, H = 124;
  const W = Math.max(x0 + N * cell + 250, 560);
  let s = '', taps = '';
  for (let i = 0; i < N; i++) {
    const cx = x0 + i * cell + cell / 2;
    s += svgIcon(pl.icon, cx - 19, 4, 38);
    s += `<text x="${cx}" y="${56}" text-anchor="middle" font-size="10" font-weight="700" fill="${BP.bright}">${fmt(pl.need / pl.count)}${unitOf(pl.liq)}</text>`;
    s += `<line x1="${cx}" y1="60" x2="${cx}" y2="${mergeY}" stroke="${BP.drop}" stroke-width="2"/>`;
    if (pl.count > 1 && i > 0) taps += tapIcon(pl.liq, 'merge', cx, mergeY);
  }
  const col = pl.liq ? BP.pipe : BP.belt;
  const f = flowFor(pl.need, pl.liq);
  const x1 = x0 + cell / 2;
  s += `<line x1="${x1}" y1="${mergeY}" x2="${W - 190}" y2="${mergeY}" stroke="${col}" stroke-width="${pl.liq ? 5 : 3}" ${pl.liq ? '' : 'stroke-dasharray="7 4"'}/>`;
  s += `<polygon points="${W - 190},${mergeY - 5} ${W - 180},${mergeY} ${W - 190},${mergeY + 5}" fill="${col}"/>`;
  s += taps;
  if (pl.count > N) s += `<text x="${x0 + N * cell + 4}" y="36" font-size="13" font-weight="700" fill="${BP.text}">… ×${pl.count}</text>`;
  s += `<text x="${W - 172}" y="${mergeY - 2}" font-size="11" font-weight="700" fill="${BP.accent}">${fmt(pl.need)}${unitOf(pl.liq)}</text>`;
  s += `<text x="${W - 172}" y="${mergeY + 12}" font-size="10" fill="${BP.text}">${flowName(f)}${pl.count > 1 ? (pl.liq ? ' · 접합 ' + (pl.count - 1) + '곳' : ' · 합류기 ' + (pl.count - 1) + '개') : ''}</text>`;
  s += `<text x="${x0}" y="${H - 6}" font-size="9.5" fill="#ffc94d">${pl.name} ×${pl.count} · 각 ${fmt(pl.clock)}%${pl.puKo ? ' · 순도 ' + pl.puKo : ''}</text>`;
  return { s, W, H, outPort: { x: W - 180, y: mergeY, liq: pl.liq } };
}

/* ---------- 전체 배치도 (합성) ----------
 * 위에 개별로 그린 채굴/단계 배치도를 그대로 세로로 이어 붙이고,
 * 단계 사이를 실제 벨트/파이프 연결선(오른쪽 레인 경유)으로 잇는다. */
function composedDiagram(stageInfo, reused, oreUsed, plans) {
  const GAP = 46;
  const secs = [];
  const mine = mineDiagramCore();
  secs.push({ key: '@ore', title: `${koOf(state.res)} 채굴 · ${fmt(oreUsed)}${unitOf(isLiq(state.res))}`, core: mine, item: state.res });
  for (const pl of (plans || []).filter(p => !p.unplanned)) {
    secs.push({ key: pl.id, title: `${koOf(pl.id)} 채굴·추출 · ${fmt(pl.need)}${unitOf(pl.liq)}`, core: auxMineCore(pl), item: pl.id });
  }
  for (const s of stageInfo) {
    secs.push({ key: s.item, title: `${koOf(s.item)} · ${fmt(s.t.rate)}${unitOf(isLiq(s.item))}`, core: stageDiagramCore(s.item, s.ml, s.t.rate), item: s.item, info: s });
  }
  const maxW = Math.max(...secs.map(x => x.core.W));
  // 섹션 배치 (세로 스택) + 절대 좌표 포트 기록
  let y = 8, body = '';
  for (const sec of secs) {
    sec.y0 = y + 20;
    body += `<text x="8" y="${y + 12}" font-size="11.5" font-weight="700" fill="${BP.accent}">▼ ${sec.title}</text>`;
    body += `<g transform="translate(0, ${sec.y0})">${sec.core.s}</g>`;
    y = sec.y0 + sec.core.H + GAP;
  }
  // 연결선: 생산 섹션 출력 → (오른쪽 레인) → 소비 섹션 입력
  const conns = [];
  for (const sec of secs) {
    if (!sec.info) continue;
    for (const p of sec.core.inPorts) {
      const src = secs.find(x => x.item === p.ing && x !== sec);
      if (src) conns.push({ src, dst: sec, port: p, recycle: false, label: koOf(p.ing) });
    }
  }
  for (const [k, amt] of Object.entries(reused)) {
    if (amt <= 1e-6) continue;
    const prod = secs.find(x => x.info && x.info.ml.r.out.some(o => o[0] === k && o[0] !== x.item));
    const cons = secs.find(x => x.info && x.core.inPorts.some(pt => pt.ing === k));
    if (prod && cons) {
      const port = cons.core.inPorts.find(pt => pt.ing === k);
      conns.push({ src: prod, dst: cons, port, recycle: true, label: `♻ ${koOf(k)} ${fmt(amt)}${unitOf(isLiq(k))}` });
    }
  }
  // 아이템별 오른쪽 레인 배정
  const lanes = new Map();
  for (const c of conns) if (!lanes.has(c.src.key)) lanes.set(c.src.key, lanes.size);
  const laneX = i => maxW + 26 + i * 20;
  const W = maxW + 40 + lanes.size * 20 + 130;
  let wires = '';
  for (const c of conns) {
    const o = c.src.core.outPort;
    const ox = o.x, oy = c.src.y0 + o.y;
    const ix = c.port.x, iy = c.dst.y0 + c.port.y;
    const lx = laneX(lanes.get(c.src.key));
    const gy = c.dst.y0 - 12 - (c.dst.core.inPorts.indexOf(c.port)) * 8;   // 소비 섹션 위 빈틈에서 가로 이동
    const col = c.recycle ? '#6fd68a' : (c.port.liq ? BP.pipe : BP.belt);
    const dash = c.recycle ? 'stroke-dasharray="3 4"' : (c.port.liq ? '' : 'stroke-dasharray="7 5"');
    wires += `<path d="M ${ox} ${oy} H ${lx} V ${gy} H ${ix - 10} V ${iy} H ${ix}" fill="none" stroke="${col}" stroke-width="${c.port.liq && !c.recycle ? 4 : 2.5}" ${dash} opacity=".9"/>`;
    wires += `<polygon points="${ix - 7},${iy - 4} ${ix},${iy} ${ix - 7},${iy + 4}" fill="${col}"/>`;
    wires += `<text x="${lx - 6}" y="${gy - 4}" text-anchor="end" font-size="9.5" font-weight="700" fill="${c.recycle ? '#6fd68a' : BP.bright}" paint-order="stroke" stroke="#1b1813" stroke-width="3">${c.label} ⟶</text>`;
  }
  const H = y - GAP + 14;
  return `<div class="bp"><svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W, 1200)}px">${wires}${body}</svg></div>`;
}

/* ---------- 렌더링 ---------- */
function iconImg(id, size) {
  return `<img src="../game/icons/${id}.png" width="${size}" height="${size}" onerror="this.remove()" alt="">`;
}

function buildResSelect() {
  const s = $('sel-res');
  s.innerHTML =
    `<optgroup label="고체 (채굴기)">` + SOLID.map(id => `<option value="${id}">${koOf(id)}</option>`).join('') + `</optgroup>` +
    `<optgroup label="액체 (추출기)">` + ['Desc_Water_C', 'Desc_LiquidOil_C'].map(id => `<option value="${id}">${koOf(id)}</option>`).join('') + `</optgroup>`;
  s.value = state.res;
}

function buildDepRows() {
  const box = $('dep-rows');
  const kind = resKind();
  box.innerHTML = '';
  state.deps.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'dep-row';
    let controls = '';
    if (kind !== 'water') {
      controls += `<label>순도<select data-k="purity">${PURITY.map(p => `<option value="${p[0]}" ${d.purity === p[0] ? 'selected' : ''}>${p[1]} ×${p[2]}</option>`).join('')}</select></label>`;
    }
    if (kind === 'miner') {
      controls += `<label>채굴기<select data-k="mk">${[1, 2, 3].map(m => `<option value="${m}" ${d.mk === m ? 'selected' : ''}>Mk.${m} (${MINER_BASE[m]}/분)</option>`).join('')}</select></label>`;
    } else {
      controls += `<span class="badge">${iconImg(RES_KIND[state.res].mach, 18)} ${RES_KIND[state.res].mname} (${RES_KIND[state.res].base}㎥/분)</span>`;
    }
    controls += `<label>클럭 %<input data-k="clock" type="number" min="1" max="250" step="0.1" value="${d.clock}" style="width:76px"></label>`;
    row.innerHTML = controls +
      (state.deps.length > 1 ? `<button class="ghost mini" data-del>✕</button>` : '') +
      `<div class="dep-out"><b>${fmt(depRate(d))}${unitOf(isLiq(state.res))}</b>${depRateRaw(d) > depRate(d) + 1e-9 ? ` <span class="hint">(원출력 ${fmt(depRateRaw(d))})</span>` : ''} · ${flowBadge(depRate(d), isLiq(state.res))}${depTip(d)}</div>`;
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
  const kind = resKind();
  const panel = $('p-quick');
  if (kind === 'water') {
    panel.querySelector('h2').innerHTML = `양수기 빠른 표 <span class="hint">(물은 순도 없음 · 1대 = 120㎥/분 고정)</span>`;
    $('quick-table').innerHTML =
      `<div class="rsum">파이프 <b>Mk.1 (300㎥/분)</b> 한 줄에 양수기 <b>2대</b>(240) — 3대부터 초과<br>` +
      `파이프 <b>Mk.2 (600㎥/분)</b> 한 줄에 양수기 <b>5대</b>(600) <span class="fit">딱 맞음 ✨</span></div>`;
    return;
  }
  if (kind === 'oil') {
    panel.querySelector('h2').innerHTML = `순도 빠른 표 <span class="hint">(원유 추출기 · 클럭 100% 기준)</span>`;
    const cells = PURITY.map(([, ko, mult]) => {
      const rate = 120 * mult;
      const f = flowFor(rate, true);
      return `<td><b>${rate}</b>㎥/분<br>파이프 Mk.${f.mk} (${fmt(rate / f.cap * 100)}%)</td>`;
    }).join('');
    $('quick-table').innerHTML = `<table><tr><th></th>${PURITY.map(p => `<th>${p[1]} ×${p[2]}</th>`).join('')}</tr><tr><th>원유 추출기</th>${cells}</tr></table>`;
    return;
  }
  panel.querySelector('h2').innerHTML = `순도 × 채굴기 빠른 표 <span class="hint">(클럭 100% 기준 · 딱 맞는 벨트)</span>`;
  const rows = [1, 2, 3].map(mk => {
    const cells = PURITY.map(([, ko, mult]) => {
      const rate = MINER_BASE[mk] * mult;
      const cap = maxCap(false);
      if (rate > cap + 1e-9) {
        return `<td><b>${rate}</b>/분<br><span style="color:var(--bad)">⚠ 실효 ${cap} (벨트 병목)</span></td>`;
      }
      const b = flowFor(rate, false);
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
  // 조각으로 대수 줄이기 대안 (기계 출력 포트도 하나 — 한 대 출력이 벨트 한도를 넘지 않게)
  let minCount = Math.ceil(rate / (per * 2.5) - 1e-9);
  minCount = Math.max(minCount, Math.ceil(rate / maxCap(isLiq(item)) - 1e-9));
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
  if (state.target === state.res) { box.innerHTML = '<div class="rsum">목표가 캐는 자원 그 자체입니다 — 위의 벨트/파이프 추천을 그대로 쓰면 됩니다.</div>'; return; }

  const unit = orePerUnit(state.target);
  if (unit.ore <= 1e-12) {
    box.innerHTML = `<div class="rsum">⚠ 현재 선택된 레시피 조합으로는 <b>${koOf(state.target)}</b> 생산에 <b>${koOf(state.res)}</b>이(가) 쓰이지 않습니다. 단계별 레시피를 바꿔 보세요.</div>`;
    return;
  }
  const { totals, ext, bypro, reused, oreUsed, targetRate } = solveChain(E, unit.ore);

  // 요약
  let html = `<div class="rsum">채굴 <b>${fmt(E)}${unitOf(isLiq(state.res))}</b> (${koOf(state.res)}) 전부 투입 →
    <b>${koOf(state.target)} ${fmt(targetRate)}${unitOf(isLiq(state.target))}</b> 생산.
    아래 세팅이면 <b>어느 기계도 놀지 않습니다</b> (재료가 정확히 맞물림).`;
  const plans = auxPlans(ext);
  const planned = plans.filter(p => !p.unplanned);
  if (planned.length) {
    html += `<br>부수 원자재 (채굴 계획 포함): ` + planned.map(p =>
      `<b>${koOf(p.id)} ${fmt(p.need)}${unitOf(p.liq)}</b> <span class="hint">(${p.name} ×${p.count} · ${fmt(p.clock)}%)</span>`).join(' · ');
  }
  const unplanned = plans.filter(p => p.unplanned);
  if (unplanned.length) {
    html += `<br>별도 라인 필요: ` + unplanned.map(p =>
      `<span class="ext">${koOf(p.id)} ${fmt(p.need)}${unitOf(isLiq(p.id))}</span>`).join(' · ');
  }
  const reList = Object.entries(reused).filter(([, v]) => v > 1e-6);
  if (reList.length) {
    html += `<br>♻ 부산물 재사용: ` + reList.map(([k, v]) =>
      `<b>${koOf(k)} ${fmt(v)}${unitOf(isLiq(k))}</b>`).join(' · ') +
      ` <span class="hint">— 부산물을 해당 라인 입력으로 되돌려 잇는 만큼 원자재·기계가 줄어 있습니다` +
      (reList.some(([k]) => isLiq(k)) ? ' (액체 재순환은 재사용 파이프를 우선 접합으로)' : '') + `</span>`;
  }
  const bpList = Object.entries(bypro).map(([k, v]) => [k, v - (reused[k] || 0)]).filter(([, v]) => v > 1e-6);
  if (bpList.length) html += `<br>잉여 부산물: ` + bpList.map(([k, v]) => `${koOf(k)} ${fmt(v)}${unitOf(isLiq(k))}`).join(' · ') +
    ` <span class="hint">(싱크 소각 또는 저장)</span>`;
  html += `</div>`;

  html += `<div class="rsum" style="font-size:13px">🔀 <b>분배기 상식</b> — 일렬로 늘어세운 분배기(매니폴드)는
    처음에 <b>앞쪽 기계만 재료를 받습니다</b>. 고장이 아니라, 기계 버퍼가 차면 남는 재료가 뒤로 흘러
    몇 분 뒤 전원 100%로 맞춰집니다 (총 공급 = 총 소비이기만 하면 됨 — 아래 세팅이 그 상태).
    기다리기 싫으면 각 단계의 <b>균형 트리</b> 구성을 쓰세요. 액체는 파이프 접합만으로 자연 균형입니다.</div>`;

  // 채굴 배치도
  html += `<div class="stage"><div class="head">${iconImg(state.res, 26)}<span class="t">채굴 · 추출</span>
    <span class="rate">${fmt(oreUsed)}${unitOf(isLiq(state.res))} 사용</span></div>${mineDiagram()}</div>`;

  // 부수 원자재 채굴 카드 (정석: 전부 직접 캔다)
  for (const pl of planned) {
    const c = auxMineCore(pl);
    html += `<div class="stage"><div class="head">${iconImg(pl.id, 26)}<span class="t">${koOf(pl.id)} 채굴·추출</span>
      <span class="rate">${fmt(pl.need)}${unitOf(pl.liq)}</span></div>
      <div class="bp"><svg viewBox="0 0 ${c.W} ${c.H}" style="min-width:${Math.min(c.W, 780)}px">${c.s}</svg></div>
      <div class="mach">
        ${pl.pu ? `<label style="flex-direction:row;align-items:center;gap:6px">순도
          <select data-auxpu="${pl.id}">${PURITY.map(p => `<option value="${p[0]}" ${pl.pu === p[0] ? 'selected' : ''}>${p[1]} ×${p[2]}</option>`).join('')}</select></label>` : ''}
        <span class="badge good">${pl.name} ×${pl.count} · 각 ${fmt(pl.clock)}%</span>
        ${flowBadge(pl.need, pl.liq)}
        <span class="badge">⚡ ${fmt(pl.power)} MW</span></div>
    </div>`;
  }

  // 단계: 깊은 것(원자재 쪽)부터 (재사용으로 0이 된 라인은 제외)
  const stages = Object.entries(totals).filter(([, t]) => t.rate > 1e-6).sort((a, b) => b[1].depth - a[1].depth);
  let totalPower = state.deps.reduce((s, d) => s + depPower(d), 0)
    + planned.reduce((s, p) => s + p.power, 0);
  const stageInfo = [];
  for (const [item, t] of stages) {
    const ml = machineLine(item, t.rate);
    stageInfo.push({ item, t, ml });
    totalPower += ml.power;
    const recipes = byOut[item];
    const selHtml = recipes.length > 1
      ? `<select data-item="${item}">${recipes.map(r => `<option value="${r.id}" ${r.id === ml.r.id ? 'selected' : ''}>${r.alt ? '★ ' : ''}${r.ko || r.name}</option>`).join('')}</select>`
      : '';
    html += `<div class="stage">
      <div class="head">${iconImg(item, 34)}<span class="t">${koOf(item)}</span>${selHtml}
        <span class="rate">${fmt(t.rate)}${unitOf(isLiq(item))}</span></div>
      ${stageDiagram(item, ml, t.rate)}
      <div class="mach">
        <span class="badge ${ml.exact ? 'good' : ''}">${ml.count}대 × ${fmt(ml.clock)}%${ml.exact ? ' 딱 맞음 ✨' : ''}</span>
        ${flowBadge(t.rate, isLiq(item))}
        <span class="badge">⚡ ${fmt(ml.power)} MW</span>
        ${ml.count > 1 ? `<button class="ghost mini" data-nomerge="${item}">${state.noMerge[item] ? '↩ 한 줄로 모으기' : '합류기 생략 보기'}</button>` : ''}</div>
      ${distGuide(item, ml, t.rate)}
      ${ml.alt}
    </div>`;
  }
  // 🗺 전체 배치도 — 채굴부터 목표까지 한 장으로
  if (stageInfo.length) {
    html += `<div class="stage">
      <div class="head"><span class="t">🗺 전체 배치도</span>
        <span class="hint">위의 채굴·단계 배치도를 그대로 이어 붙인 전체 그림 — 단계 사이 연결선은 오른쪽 레인을 타고 내려갑니다.
        점선=벨트, 파랑=파이프, <span style="color:#6fd68a">초록 ♻=부산물 재순환</span></span></div>
      ${composedDiagram(stageInfo, reused, oreUsed, plans)}
    </div>`;
  }

  // 🚚 수송 가이드 — 매장지가 멀 때: 단계별 벨트 부하(광석 대비)로 "어디까지 현지 가공할지" 판단
  if (stages.length >= 1) {
    let chips = `<span class="badge">${iconImg(state.res, 16)} ${koOf(state.res)} ${fmt(oreUsed)}${unitOf(isLiq(state.res))} <b>100%</b></span>`;
    for (const [item, t] of stages) {
      const pct = t.rate / oreUsed * 100;
      chips += ` ▸ <span class="badge ${pct <= 50 ? 'good' : ''}">${iconImg(item, 16)} ${koOf(item)} ${fmt(t.rate)}${unitOf(isLiq(item))} <b>${fmt(pct)}%</b></span>`;
    }
    html += `<div class="rsum" style="font-size:13px">🚚 <b>수송 가이드</b> — 매장지가 멀면 전부 본진으로 끌고 오지 말고,
      <b>부하(%)가 뚝 떨어지는 단계까지 매장지 옆에서 가공</b>한 뒤 그것만 나르세요.<br>
      <div style="margin:6px 0; line-height:2.2">${chips}</div>
      <span class="hint">%는 광석 벨트 대비 나를 양. 벨트·파이프는 아무리 길어도 손실이 없으니(건설비뿐) 초반엔 그냥 길게 잇는 게 정답이고,
      주괴처럼 1:1인 단계는 현지 가공해도 수송 이득이 없습니다. 초록 배지(≤50%)부터 벨트 수가 절반 이하로 줄어듭니다.
      현지 가공엔 전력이 필요하니 전력선을 같이 끌고 갈 것. 장거리 대량 수송은 트럭(티어 3)·기차(티어 6), 액체는 파이프 구간마다 펌프로 양정 확보.</span></div>`;
  }
  html += `<div class="rsum">총 전력 (채굴·추출 포함): <b>${fmt(totalPower)} MW</b></div>`;
  box.innerHTML = html;
  box.querySelectorAll('select[data-item]').forEach(s => s.addEventListener('change', () => {
    state.recipeSel[s.dataset.item] = s.value;
    update();
  }));
  box.querySelectorAll('button[data-nomerge]').forEach(b => b.addEventListener('click', () => {
    const it = b.dataset.nomerge;
    state.noMerge[it] = !state.noMerge[it];
    update();
  }));
  box.querySelectorAll('select[data-auxpu]').forEach(s => s.addEventListener('change', () => {
    state.auxPurity[s.dataset.auxpu] = s.value;
    update();
  }));
}

function renderMineSummary() {
  const E = totalMine();
  const pw = state.deps.reduce((s, d) => s + depPower(d), 0);
  $('mine-summary').innerHTML =
    `<div class="rsum">합계 <b>${fmt(E)}${unitOf(isLiq(state.res))}</b> · 설비 전력 <b>${fmt(pw)} MW</b>
     ${state.deps.length > 1 ? '<br>' + flowBadge(E, isLiq(state.res)) + ' <span class="hint">(합쳐서 한 줄로 나를 때)</span>' : ''}</div>`;
}

function update() {
  save();
  $('sel-res').value = state.res;
  $('sel-belt').value = state.maxBelt;
  $('sel-pipe').value = state.maxPipe;
  buildDepRows();
  buildQuickTable();
  renderMineSummary();
  renderResult();
}

/* ---------- 초기화 ---------- */
buildResSelect();
$('sel-belt').innerHTML = BELTS.map(([mk, cap]) => `<option value="${mk}">~Mk.${mk} (${cap}/분)</option>`).join('');
$('sel-pipe').innerHTML = PIPES.map(([mk, cap]) => `<option value="${mk}">~Mk.${mk} (${cap}㎥/분)</option>`).join('');
$('sel-belt').addEventListener('change', () => { state.maxBelt = +$('sel-belt').value; update(); });
$('sel-pipe').addEventListener('change', () => { state.maxPipe = +$('sel-pipe').value; update(); });
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
