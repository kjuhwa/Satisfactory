'use strict';
/*
 * 빚과 칼 — 화면
 *
 * 이 게임이 파는 건 "선택이 실제로 다르다"는 감각이다. 그래서 화면에서 두 가지를 고집한다:
 *   - 잠긴 선택지를 지우지 않는다. 무엇이 얼마나 모자라 못 고르는지 같이 적는다.
 *   - 과거에서 온 선택지에는 표를 달고, 그게 언제 한 일인지 며칠째였는지까지 적는다.
 */

const E = window.QuestEngine;
const D = window.QuestData;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const SAVE = 'quests-meta-v1';
let meta = load();
let run = null, rng = null, phase = null, current = null;

function load() {
  try { return JSON.parse(localStorage.getItem(SAVE)) || {}; } catch { return {}; }
}
function saveMeta() { try { localStorage.setItem(SAVE, JSON.stringify(meta)); } catch {} }

/* ---------- 제목 화면 ---------- */
function showTitle() {
  $('title').hidden = false;
  $('game').hidden = true;
  $('t-debt').textContent = E.RULES.debt;

  const box = $('memories');
  box.textContent = '';
  const owned = (meta.memories || []);
  if (owned.length) {
    box.append(el('h2', null, '지난 판에서 가져온 것'));
    for (const id of owned) {
      const m = D.memories.find(x => x.id === id);
      if (!m) continue;
      const row = el('label', 'memory');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = (meta.chosen || []).includes(id);
      cb.addEventListener('change', () => {
        meta.chosen = meta.chosen || [];
        meta.chosen = cb.checked ? [...new Set([...meta.chosen, id])] : meta.chosen.filter(x => x !== id);
        saveMeta();
      });
      row.append(cb, el('b', null, m.name), el('span', 'dim', m.desc));
      box.append(row);
    }
    box.append(el('p', 'dim small', '들고 갈 것만 골라라. 많이 든다고 좋기만 한 건 아니다.'));
  }

  const rec = $('record');
  rec.textContent = '';
  if (meta.runs) {
    rec.append(el('span', null, `${meta.runs}판 · 갚음 ${meta.wins || 0} · 죽음 ${meta.deaths || 0}`));
  }
}

/* ---------- 판 시작 ---------- */
function startRun() {
  run = E.newRun({});
  rng = E.makeRng(run.seed);
  for (const id of (meta.chosen || [])) {
    const m = D.memories.find(x => x.id === id);
    if (m) m.apply(run);
  }
  $('title').hidden = true;
  $('game').hidden = false;
  goMorning();
}

/* ---------- 화면 그리기 ---------- */
function drawHud() {
  $('h-day').textContent = run.day;
  $('h-gold').textContent = run.gold;
  $('h-debt').textContent = run.debt;

  const hp = $('h-hp');
  hp.textContent = '';
  hp.append(el('span', null, '체력 '));
  const bar = el('span', 'hpbar');
  for (let i = 0; i < run.hpMax; i++) bar.append(el('i', i < run.hp ? 'on' : 'off'));
  hp.append(bar, el('b', null, ` ${run.hp}/${run.hpMax}`));

  const st = $('h-stats');
  st.textContent = '';
  for (const [k, s] of Object.entries(E.STATS)) {
    const c = el('span', 'stat');
    c.title = s.desc;
    c.append(el('span', 'sname', s.name), el('b', null, run.stats[k]));
    st.append(c);
  }

  const items = $('items');
  items.textContent = '';
  const list = Object.keys(run.items).filter(k => run.items[k] > 0);
  if (!list.length) items.append(el('div', 'dim', '아무것도 없다'));
  for (const id of list) {
    const it = D.items[id];
    const row = el('div', 'item');
    row.append(el('b', null, it.name + (run.items[id] > 1 ? ` ×${run.items[id]}` : '')));
    row.append(el('span', 'dim', it.desc));
    items.append(row);
  }

  const deeds = $('deeds');
  deeds.textContent = '';
  const fl = Object.entries(run.flags).sort((a, b) => a[1] - b[1]);
  if (!fl.length) deeds.append(el('div', 'dim', '아직 아무 일도 없었다'));
  for (const [f, day] of fl) {
    const label = DEED_NAMES[f];
    if (!label) continue;
    deeds.append(el('div', 'deed', `${day}일째 · ${label}`));
  }
}

// flag 를 사람 말로. 여기 없는 flag 는 화면에 안 나온다(내부용).
const DEED_NAMES = {
  spared_thief: '좀도둑을 놓아주었다',
  sold_thief: '좀도둑을 관에 넘겼다',
  killed_yield: '무릎 꿇은 자를 베었다',
  gave_priest: '신전에 기부했다',
  robbed_temple: '헌금함에 손을 댔다',
  cheated_deal: '상인을 속였다',
  forgiven_deal: '상인에게 용서받았다',
  saved_pup: '덫에 걸린 늑대를 풀어주었다',
  killed_pup: '어린 늑대의 가죽을 벗겼다',
  took_ring: '주검에게서 반지를 가져왔다',
  ring_freed: '반지를 떼어냈다',
  ring_passed: '반지를 남에게 넘겼다',
  helped_pilgrim: '순례자를 도왔다',
  pilgrim_paid: '순례자가 빚을 갚아주었다',
  stole_ledger: '빚쟁이의 장부를 훔쳤다',
  burned_ledger: '장부를 태웠다',
  owe_gambler: '노름빚을 졌다',
  thief_repaid: '도둑들이 빚을 갚았다',
  buried_dead: '길가의 주검을 묻어주었다',
  stripped_grove: '약초 자리를 통째로 뽑았다',
  kept_grove: '약초를 쓸 만큼만 캤다',
  robbed_shrine: '사당의 공물을 가져갔다',
  robbed_altar: '제단의 것을 가져갔다',
  made_partner: '폐허에서 몫을 나눴다',
  refused_wolves: '늑대들에게 칼을 들었다',
  known_thief: '손버릇이 소문났다',
  on_the_list: '관의 장부에 이름이 올랐다',
  took_dirty_work: '험한 일을 맡았다',
  robbed_asleep: '자다가 털렸다',
};

function scene(parts) {
  const s = $('scene');
  s.textContent = '';
  for (const p of parts) s.append(p);
  s.scrollTop = 0;
}

/* ---------- 아침: 어디로 갈 것인가 ---------- */
function goMorning() {
  phase = 'morning';
  drawHud();
  scene([
    el('h2', 'day-head', `${run.day}일째 아침`),
    el('p', 'flavor', run.day === 1
      ? '여관 주인이 문 앞에서 팔짱을 끼고 있다. 오늘부터 서른 날이다.'
      : MORNING[run.day % MORNING.length]),
    el('p', 'ask', '오늘은 어디로 갈까.'),
  ]);

  const box = $('choices');
  box.textContent = '';
  for (const [key, p] of Object.entries(E.PLACES)) {
    const b = el('button', 'choice');
    b.append(el('span', 'ctext', p.name));
    b.append(el('span', 'cnote', p.desc));
    b.addEventListener('click', () => { run.place = key; goEvent(); });
    box.append(b);
  }
}

const MORNING = [
  '밤새 어깨가 결렸다. 그래도 아직 걸을 수 있다.',
  '빵 반 조각으로 아침을 때웠다.',
  '누가 문 앞에 분필로 표시를 해 뒀다. 지우고 나왔다.',
  '해가 늦게 떴다. 그만큼 하루가 짧다.',
  '거울 대신 물통에 얼굴을 비춰 봤다. 볼 만한 얼굴이 아니다.',
];

/* ---------- 낮: 사건 ---------- */
function goEvent() {
  phase = 'event';
  const ev = E.drawEvent(run, D, rng);
  if (!ev) { goNight(); return; }
  run.seen[ev.id] = run.day;
  current = ev;
  drawHud();

  scene([
    el('div', 'place', E.PLACES[run.place].name),
    el('h2', null, ev.title),
    el('p', 'body', ev.text),
  ]);

  const box = $('choices');
  box.textContent = '';
  for (const c of E.presentChoices(run, ev, D)) {
    const b = el('button', 'choice' + (c.locked ? ' locked' : '') + (c.tag ? ' callback' : ''));
    if (c.tag) b.append(el('span', 'tag', c.tag));
    b.append(el('span', 'ctext', c.text));

    const notes = [];
    if (c.odds != null) notes.push(`성공 ${Math.round(c.odds * 100)}%`);
    if (c.locked) notes.push(c.reason);
    if (notes.length) b.append(el('span', c.locked ? 'cnote bad' : 'cnote', notes.join(' · ')));

    if (c.locked) b.disabled = true;
    else b.addEventListener('click', () => pick(c));
    box.append(b);
  }
}

function pick(c) {
  const r = E.resolve(run, c, D, rng);
  drawHud();
  const parts = [
    el('div', 'place', E.PLACES[run.place].name),
    el('h2', null, current.title),
    el('p', 'chosen', '→ ' + c.text),
    el('p', 'body', r.result),
  ];
  if (r.rolled != null) {
    parts.splice(3, 0, el('div', r.rolled ? 'roll ok' : 'roll fail', r.rolled ? '성공' : '실패'));
  }
  if (r.notes.length) {
    const n = el('div', 'notes');
    for (const x of r.notes) n.append(el('span', 'note ' + x.t, x.text));
    parts.push(n);
  }
  scene(parts);

  const box = $('choices');
  box.textContent = '';
  const end = E.checkEnd(run);
  const b = el('button', 'choice primary', end ? '…' : '계속한다');
  b.addEventListener('click', () => (end ? finish(end) : goNight()));
  box.append(b);
}

/* ---------- 밤: 어디서 잘 것인가 ---------- */
function goNight() {
  const end = E.checkEnd(run);
  if (end) return finish(end);
  phase = 'night';
  drawHud();
  scene([
    el('h2', 'day-head', `${run.day}일째 밤`),
    el('p', 'ask', '어디서 잘까.'),
  ]);

  const box = $('choices');
  box.textContent = '';
  for (const o of E.nightOptions(run)) {
    const b = el('button', 'choice' + (o.locked ? ' locked' : ''));
    b.append(el('span', 'ctext', o.label));
    const bits = [];
    if (o.gold) bits.push(`금화 -${o.gold}`);
    bits.push(o.hp >= 0 ? `체력 +${o.hp}` : `체력 ${o.hp}`);
    bits.push(o.desc);
    b.append(el('span', o.locked ? 'cnote bad' : 'cnote',
      o.locked ? `금화 ${o.gold} 필요 · 지금 ${run.gold}` : bits.join(' · ')));
    if (o.locked) b.disabled = true;
    else b.addEventListener('click', () => doSleep(o.key));
    box.append(b);
  }
}

function doSleep(key) {
  const res = E.sleep(run, key, D, rng);
  drawHud();
  const parts = [el('h2', 'day-head', `${run.day - 1}일째 밤`)];
  if (res.extra) parts.push(el('p', 'body bad-text', res.extra));
  if (res.notes.length) {
    const n = el('div', 'notes');
    for (const x of res.notes) n.append(el('span', 'note ' + x.t, x.text));
    parts.push(n);
  }
  for (const d of res.dues) parts.push(el('p', 'body bad-text', d.text));
  scene(parts);

  const box = $('choices');
  box.textContent = '';
  const end = E.checkEnd(run);
  const b = el('button', 'choice primary', end ? '…' : `${run.day}일째로`);
  b.addEventListener('click', () => (end ? finish(end) : goMorning()));
  box.append(b);
}

/* ---------- 끝 ---------- */
function finish(end) {
  phase = 'over';
  drawHud();
  const earned = E.earnedMemories(run, D);

  meta.runs = (meta.runs || 0) + 1;
  if (end.win) meta.wins = (meta.wins || 0) + 1;
  else if (run.hp <= 0) meta.deaths = (meta.deaths || 0) + 1;
  const before = new Set(meta.memories || []);
  meta.memories = [...new Set([...(meta.memories || []), ...earned.map(m => m.id)])];
  saveMeta();

  const parts = [
    el('h2', 'day-head', end.win ? '갚았다' : '끝났다'),
    el('p', 'body', end.reason),
    el('p', 'dim', `${run.day}일 · 금화 ${run.gold} · 남은 빚 ${run.debt}`),
  ];

  const deeds = Object.entries(run.flags).filter(([f]) => DEED_NAMES[f]).sort((a, b) => a[1] - b[1]);
  if (deeds.length) {
    parts.push(el('h3', null, '지나온 일'));
    const ul = el('div', 'deeds');
    for (const [f, day] of deeds) ul.append(el('div', 'deed', `${day}일째 · ${DEED_NAMES[f]}`));
    parts.push(ul);
  }

  const fresh = earned.filter(m => !before.has(m.id));
  if (fresh.length) {
    parts.push(el('h3', null, '남은 기억'));
    const ul = el('div', 'deeds');
    for (const m of fresh) ul.append(el('div', 'deed new', `${m.name} — ${m.desc}`));
    parts.push(ul);
  }
  scene(parts);

  const box = $('choices');
  box.textContent = '';
  const b = el('button', 'choice primary', '다시 떠난다');
  b.addEventListener('click', showTitle);
  box.append(b);
}

/* ---------- 시작 ---------- */
$('btn-start').addEventListener('click', startRun);
showTitle();
