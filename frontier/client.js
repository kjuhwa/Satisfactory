'use strict';
/*
 * 개척 원정대 — 클라이언트
 *
 * 서버 → 클라: SSE 한 줄기 (다른 사람의 행동, 틱마다의 상태)
 * 클라 → 서버: POST 한 방 (명령 한 줄)
 * 라이브러리를 쓰지 않으려고 WebSocket 대신 이 조합을 골랐다.
 */

const $ = id => document.getElementById(id);
const API = '/api/mud';
const KEY = 'frontier-token';

let token = localStorage.getItem(KEY) || null;
let stream = null;
const history = [];
let histAt = -1;

/* ---------- 출력 ---------- */
const out = () => $('out');

function print(line) {
  const div = document.createElement('div');
  div.className = 'ln ' + (line.t || 'info');
  div.textContent = line.text;
  out().append(div);
  // 이미 바닥을 보고 있을 때만 따라 내려간다 (위를 읽는 중이면 방해하지 않는다)
  const box = out();
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  if (atBottom) box.scrollTop = box.scrollHeight;
  while (box.childElementCount > 600) box.firstElementChild.remove();
}
const printAll = lines => (lines || []).forEach(print);
function echo(text) { print({ t: 'echo', text: '> ' + text }); }

/* ---------- 사이드 패널 ---------- */
const DIRS = [
  ['위', 0, 0], ['북', 1, 0], ['', 2, 0],
  ['서', 0, 1], ['·', 1, 1], ['동', 2, 1],
  ['아래', 0, 2], ['남', 1, 2], ['', 2, 2],
];

function renderCompass() {
  const box = $('compass');
  if (box.childElementCount) return;
  for (const [d] of DIRS) {
    const b = document.createElement('button');
    b.textContent = d || '';
    b.disabled = !d || d === '·';
    if (d && d !== '·') b.addEventListener('click', () => submit(d));
    box.append(b);
  }
}

function renderSummary(s) {
  if (!s) return;
  $('hud-where').textContent = `${s.at} · ${['안전', '주의', '위험', '치명'][s.danger]}${s.water ? ' · 물' : ''}`;
  const pw = s.power;
  $('hud-power').textContent = `전력 ${pw.demand} / ${pw.supply} MW`;
  $('hud-power').classList.toggle('bad', pw.demand > pw.supply);
  $('hud-explore').textContent = `탐사 ${s.visited}/${s.total}`;
  $('hud-online').textContent = `접속 ${s.online}명`;

  $('stock').innerHTML = '';
  for (const it of s.stock) {
    const row = document.createElement('div');
    row.className = 'row';
    const rate = Math.abs(it.rate) < 0.05 ? ''
      : `${it.rate > 0 ? '+' : ''}${Math.round(it.rate * 10) / 10}/분`;
    row.innerHTML = `<span class="k"></span><span class="v"></span><span class="r ${it.rate > 0 ? 'up' : it.rate < 0 ? 'down' : ''}"></span>`;
    row.children[0].textContent = it.name;
    row.children[1].textContent = it.n;
    row.children[2].textContent = rate;
    $('stock').append(row);
  }
  if (!s.stock.length) $('stock').innerHTML = '<div class="dim">비어 있다</div>';

  $('project').innerHTML = '';
  const t = document.createElement('div');
  t.className = 'ptitle';
  t.textContent = s.project.name;
  $('project').append(t);
  for (const n of s.project.need) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span class="k"></span><span class="v"></span>';
    row.children[0].textContent = n.name;
    row.children[1].textContent = `${n.have} / ${n.need}`;
    if (n.have >= n.need) row.classList.add('done');
    $('project').append(row);
  }
}

/* ---------- 통신 ---------- */
async function submit(line) {
  if (!line.trim()) return;
  echo(line);
  history.unshift(line);
  histAt = -1;
  try {
    const r = await fetch(API + '/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, line }),
    });
    if (r.status === 401) { localStorage.removeItem(KEY); location.reload(); return; }
    const data = await r.json();
    printAll(data.lines);
    renderSummary(data.summary);
  } catch (e) {
    print({ t: 'err', text: '서버와 연결이 끊겼다. 새로고침하라.' });
  }
}

function connect() {
  if (stream) stream.close();
  stream = new EventSource(`${API}/stream?token=${encodeURIComponent(token)}`);
  stream.onmessage = ev => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }
    printAll(data.lines);
    renderSummary(data.summary);
  };
  stream.onerror = () => print({ t: 'dim', text: '(연결이 불안정하다 — 다시 잇는 중)' });
}

async function join(name) {
  const msg = $('gate-msg');
  msg.textContent = '강하 중…';
  try {
    const r = await fetch(API + '/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (!r.ok) { msg.textContent = data.error || '강하 실패'; return; }
    token = data.token;
    localStorage.setItem(KEY, token);
    enter();
  } catch {
    msg.textContent = '서버에 닿지 않는다. `node game/server.js` 로 서버를 띄웠는지 확인하라.';
  }
}

function enter() {
  $('gate').hidden = true;
  $('app').hidden = false;
  renderCompass();
  connect();
  $('in').focus();
}

/* ---------- 입력 ---------- */
function wire() {
  $('btn-join').addEventListener('click', () => join($('name').value));
  $('name').addEventListener('keydown', e => { if (e.key === 'Enter') join($('name').value); });

  const input = $('in');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = input.value; input.value = ''; submit(v); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histAt + 1 < history.length) input.value = history[++histAt];
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histAt > 0) input.value = history[--histAt];
      else { histAt = -1; input.value = ''; }
    }
  });
  for (const b of document.querySelectorAll('.quick button'))
    b.addEventListener('click', () => { submit(b.dataset.cmd); $('in').focus(); });

  // 화면 아무 데나 눌러도 입력창으로 돌아온다 (머드의 기본 예의)
  document.addEventListener('click', e => {
    if (!$('app').hidden && !e.target.closest('button') && !window.getSelection().toString()) $('in').focus();
  });
}

wire();
if (token) {
  // 저장된 토큰이 아직 살아 있는지 가벼운 명령으로 확인한다
  fetch(API + '/cmd', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, line: '' }),
  }).then(r => {
    if (r.ok) enter();
    else { localStorage.removeItem(KEY); token = null; }
  }).catch(() => {});
}
