'use strict';
/*
 * 빚과 칼 — 규칙 엔진
 *
 * 이 장르가 지루해지는 이유는 하나다. 선택지가 사실은 안 중요해서다.
 * 글 읽고 버튼 두 개 중 하나 누르면 주사위 굴려서 성공/실패, 그게 전부면 3분이면 질린다.
 * 그래서 이 엔진은 세 가지를 규칙으로 못박아 둔다:
 *
 *   1. 잠긴 선택지도 보여준다. 왜 못 하는지(무엇이 얼마나 모자란지) 같이 보여준다.
 *      못 고르는 선택지가 보여야 능력치를 올릴 이유가 생긴다.
 *   2. 과거가 되돌아온다. 선택은 flag 를 남기고, 뒤쪽 이벤트가 그 flag 를 조건으로 갈라진다.
 *   3. 실패가 죽음이 아니다. 판정에 실패해도 이야기는 다른 쪽으로 이어진다.
 */

const STATS = {
  might:  { name: '완력',   desc: '치고 버티고 밀어붙인다' },
  hands:  { name: '손재주', desc: '따고 훔치고 다룬다' },
  eye:    { name: '눈치',   desc: '알아채고 읽어낸다' },
  tongue: { name: '말솜씨', desc: '구슬리고 흥정하고 둘러댄다' },
};

const PLACES = {
  town:   { name: '저잣거리', desc: '일감과 소문. 안전하지만 돈이 안 된다' },
  road:   { name: '길',       desc: '오가는 사람들. 운에 크게 좌우된다' },
  forest: { name: '숲',       desc: '약초와 짐승. 몸이 상하기 쉽다' },
  ruin:   { name: '폐허',     desc: '값나가는 것이 있다. 그만큼 위험하다' },
};

// 수치는 자동 플레이 500판을 돌려 맞췄다.
// 처음엔 최대 체력 12 에 한 방이 -5~-7 이라 회복(+3/박)이 도저히 못 따라갔고,
// 사망률이 90% 를 넘겨 "선택"이 아니라 "운"만 남았다.
const RULES = {
  days: 30,
  // 빚을 올려 봐도 잘 두는 쪽은 거의 안 떨어지고(83%→73%) 못 두는 쪽만 무너졌다.
  // 돈이 아니라 생존이 병목이라는 뜻이다. 그래서 초보가 배울 여지가 남는 선에서 멈췄다.
  debt: 240,
  startGold: 15,
  hpMax: 16,
  interestDay: 10,        // 10일마다 빚쟁이가 온다
  interestRate: 0.15,
  inn:   { gold: 8, hp: 5, label: '여관' },
  cheap: { gold: 3, hp: 2, label: '싸구려 여인숙' },
  rough: { gold: 0, hp: -1, label: '노숙' },
};

/* ---------- 난수 (판마다 씨앗이 다르고, 같은 씨앗이면 같은 판이 나온다) ---------- */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/* ---------- 상태 ---------- */
function newRun(opts = {}) {
  const seed = opts.seed || (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const run = {
    seed,
    day: 1,
    hp: RULES.hpMax,
    hpMax: RULES.hpMax,
    gold: RULES.startGold,
    debt: RULES.debt,
    stats: { might: 8, hands: 8, eye: 8, tongue: 8 },
    items: {},
    flags: {},              // flag -> 남긴 날짜 (언제 그랬는지 되짚어 주기 위해)
    seen: {},               // 한 번만 나오는 이벤트
    log: [],
    over: null,             // { win, reason }
    place: null,
    pending: null,
  };
  // 시작 특전(전 판에서 얻은 '기억')
  if (opts.boon) opts.boon.apply(run);
  return run;
}

const has = (run, item) => (run.items[item] || 0) > 0;
const flagged = (run, f) => f in run.flags;

function give(run, item, n = 1) {
  run.items[item] = (run.items[item] || 0) + n;
  if (run.items[item] <= 0) delete run.items[item];
}

/* ---------- 조건 ---------- */
/**
 * 조건을 재는 것으로 끝내지 않고, 못 미친 이유를 사람 말로 돌려준다.
 * 이 문자열이 잠긴 선택지에 그대로 붙는다 — "말솜씨 14 필요 · 지금 11".
 * @return null 이면 통과, 아니면 막힌 이유
 */
function checkReq(run, req, D) {
  if (!req) return null;
  if (req.gold != null && run.gold < req.gold)
    return `금화 ${req.gold} 필요 · 지금 ${run.gold}`;
  if (req.hp != null && run.hp < req.hp)
    return `체력 ${req.hp} 필요 · 지금 ${run.hp}`;
  for (const [k, v] of Object.entries(req.stat || {}))
    if (run.stats[k] < v) return `${STATS[k].name} ${v} 필요 · 지금 ${run.stats[k]}`;
  for (const it of [].concat(req.item || []))
    if (!has(run, it)) return `${D.items[it] ? D.items[it].name : it} 필요`;
  for (const f of [].concat(req.flag || []))
    if (!flagged(run, f)) return '__hide__';           // 과거 조건은 없으면 아예 안 보인다
  for (const f of [].concat(req.notFlag || []))
    if (flagged(run, f)) return '__hide__';
  if (req.dayFrom != null && run.day < req.dayFrom) return '__hide__';
  return null;
}

/** 이벤트가 지금 뽑힐 수 있는가 */
function eligible(run, ev, D) {
  if (ev.once && run.seen[ev.id]) return false;
  if (ev.place && ev.place !== run.place) return false;
  if (ev.dayFrom != null && run.day < ev.dayFrom) return false;
  if (ev.dayTo != null && run.day > ev.dayTo) return false;
  const r = checkReq(run, ev.req, D);
  return r === null;
}

/* ---------- 판정 ---------- */
/**
 * 성공률은 능력치가 민다. 순수 운이 아니라는 걸 보여주려고 확률을 화면에 그대로 띄운다.
 * 8 이 기준값이므로 능력치 1 = 8%p.
 */
function odds(run, check) {
  if (!check) return null;
  let p = 0.5 + (run.stats[check.stat] - check.dc) * 0.08;
  for (const [item, bonus] of Object.entries(check.itemBonus || {}))
    if (has(run, item)) p += bonus;
  if (check.flagBonus) for (const [f, bonus] of Object.entries(check.flagBonus))
    if (flagged(run, f)) p += bonus;
  return Math.max(0.05, Math.min(0.95, p));
}

/* ---------- 효과 적용 ---------- */
function applyEffect(run, eff, D) {
  if (!eff) return [];
  const notes = [];
  const push = (t, s) => notes.push({ t, text: s });

  if (eff.gold) {
    run.gold = Math.max(0, run.gold + eff.gold);
    push(eff.gold > 0 ? 'good' : 'bad', `금화 ${eff.gold > 0 ? '+' : ''}${eff.gold}`);
  }
  if (eff.hp) {
    run.hp = Math.max(0, Math.min(run.hpMax, run.hp + eff.hp));
    push(eff.hp > 0 ? 'good' : 'bad', `체력 ${eff.hp > 0 ? '+' : ''}${eff.hp}`);
  }
  if (eff.hpMax) {
    run.hpMax += eff.hpMax;
    run.hp += eff.hpMax;
    push('good', `최대 체력 +${eff.hpMax}`);
  }
  if (eff.debt) {
    run.debt = Math.max(0, run.debt + eff.debt);
    push(eff.debt < 0 ? 'good' : 'bad', `빚 ${eff.debt > 0 ? '+' : ''}${eff.debt}`);
  }
  for (const [k, v] of Object.entries(eff.stat || {})) {
    run.stats[k] += v;
    push(v > 0 ? 'good' : 'bad', `${STATS[k].name} ${v > 0 ? '+' : ''}${v}`);
  }
  for (const it of [].concat(eff.item || [])) {
    give(run, it, 1);
    push('good', `${D.items[it].name} 획득`);
  }
  for (const it of [].concat(eff.lose || [])) {
    if (has(run, it)) { give(run, it, -1); push('bad', `${D.items[it].name} 잃음`); }
  }
  for (const f of [].concat(eff.flag || [])) {
    if (!flagged(run, f)) run.flags[f] = run.day;
  }
  return notes;
}

/* ---------- 하루 진행 ---------- */
function drawEvent(run, D, rng) {
  const pool = D.events.filter(ev => eligible(run, ev, D));
  if (!pool.length) return null;
  // 과거를 되짚는 이벤트(callback)는 가중치를 크게 준다 — 이 게임이 팔고 있는 게 그거다
  const total = pool.reduce((a, ev) => a + (ev.weight || 10), 0);
  let r = rng() * total;
  for (const ev of pool) {
    r -= ev.weight || 10;
    if (r <= 0) return ev;
  }
  return pool[pool.length - 1];
}

/** 선택지를 화면에 낼 수 있는 형태로 — 잠긴 것도 이유와 함께 같이 낸다 */
function presentChoices(run, ev, D) {
  const out = [];
  for (const c of ev.choices) {
    const reason = checkReq(run, c.req, D);
    if (reason === '__hide__') continue;
    out.push({
      ref: c,
      text: c.text,
      tag: c.tag || (c.req && c.req.flag ? '아는 얼굴' : null),
      locked: reason !== null,
      reason,
      odds: odds(run, c.check),
      cost: c.req && c.req.gold ? c.req.gold : null,
    });
  }
  return out;
}

function resolve(run, choice, D, rng) {
  const c = choice.ref;
  // c.text 는 버튼에 찍히는 말, branch.result 는 고르고 난 뒤의 서술이다
  let branch = c;
  let rolled = null;

  if (c.check) {
    const p = odds(run, c.check);
    rolled = rng() < p;
    branch = rolled ? c.ok : c.fail;
  }

  const notes = applyEffect(run, branch.effect, D);
  // 판정에 쓴 능력치는 실패해도 조금 는다. 실패가 순수 손해이기만 하면 아무도 시도하지 않는다.
  if (c.check && !rolled && rng() < 0.35) {
    run.stats[c.check.stat] += 1;
    notes.push({ t: 'good', text: `${STATS[c.check.stat].name} +1 (몸으로 배웠다)` });
  }
  return { result: branch.result, notes, rolled, ended: branch.end || null };
}

/* ---------- 밤과 다음 날 ---------- */
function nightOptions(run) {
  return [
    { key: 'inn',   ...RULES.inn,   locked: run.gold < RULES.inn.gold,
      desc: '뜨거운 물과 침대. 상처가 아문다' },
    { key: 'cheap', ...RULES.cheap, locked: run.gold < RULES.cheap.gold,
      desc: '벼룩과 코 고는 소리. 그래도 지붕은 있다' },
    { key: 'rough', ...RULES.rough, locked: false,
      desc: '돈은 안 들지만 몸이 상한다' },
  ];
}

function sleep(run, key, D, rng) {
  const opt = nightOptions(run).find(o => o.key === key);
  const notes = applyEffect(run, { gold: -opt.gold, hp: opt.hp }, D);
  let extra = null;

  // 노숙은 돈만 아끼는 선택이 아니다 — 도둑맞을 수 있어야 진짜 선택이 된다
  if (key === 'rough' && run.gold > 0 && rng() < 0.22) {
    const stolen = Math.max(1, Math.round(run.gold * 0.3));
    run.gold -= stolen;
    extra = `자는 사이 누가 주머니를 뒤졌다. 금화 ${stolen} 이 사라졌다.`;
    if (!flagged(run, 'robbed_asleep')) run.flags.robbed_asleep = run.day;
  }

  run.day++;
  const dues = [];
  if (run.day > 1 && (run.day - 1) % RULES.interestDay === 0 && run.debt > 0) {
    const interest = Math.ceil(run.debt * RULES.interestRate);
    if (run.gold >= interest) {
      run.gold -= interest;
      dues.push({ t: 'bad', text: `빚쟁이가 다녀갔다. 이자 ${interest} 을(를) 냈다.` });
    } else {
      const short = interest - run.gold;
      run.gold = 0;
      run.hp -= 3;
      run.debt += short;
      dues.push({ t: 'bad', text: `이자 ${interest} 을(를) 못 냈다. 매를 맞았다 (체력 -3, 빚 +${short}).` });
    }
  }
  return { notes, extra, dues };
}

/** 판이 끝났는지 본다. 끝났으면 이유를 붙인다. */
function checkEnd(run) {
  if (run.hp <= 0) return { win: false, reason: '몸이 버티지 못했다.' };
  if (run.debt <= 0) return { win: true, reason: '빚을 다 갚았다. 처음으로, 아무에게도 빚지지 않은 아침이다.' };
  if (run.day > RULES.days) return { win: false, reason: `${RULES.days}일이 지났다. 빚 ${run.debt} 이(가) 남았다.` };
  return null;
}

/* ---------- 판이 끝난 뒤: 기억 ---------- */
/** 이번 판에서 한 일이 다음 판의 시작 조건이 된다 */
function earnedMemories(run, D) {
  return D.memories.filter(m => m.earn(run));
}

if (typeof module === 'object' && module.exports) {
  module.exports = { STATS, PLACES, RULES, makeRng, newRun, has, flagged, give,
    checkReq, eligible, odds, applyEffect, drawEvent, presentChoices, resolve,
    nightOptions, sleep, checkEnd, earnedMemories };
} else {
  window.QuestEngine = { STATS, PLACES, RULES, makeRng, newRun, has, flagged, give,
    checkReq, eligible, odds, applyEffect, drawEvent, presentChoices, resolve,
    nightOptions, sleep, checkEnd, earnedMemories };
}
