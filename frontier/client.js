'use strict';
/*
 * 개척 원정대 — 클라이언트
 *
 * 두 가지 모드로 돈다. 어느 쪽인지는 켜질 때 스스로 알아낸다.
 *
 *   멀티 (서버 있음) — 서버→클라 SSE, 클라→서버 POST.
 *                     WebSocket 라이브러리를 안 쓰려고 고른 조합이다.
 *   혼자 (서버 없음) — GitHub Pages 처럼 정적 호스팅이면 세계를 브라우저에서 돌린다.
 *                     규칙은 서버와 같은 core.js 를 쓰므로 갈라지지 않는다.
 */

const $ = id => document.getElementById(id);

// 저장소를 하위 경로에 올려도(예: /Satisfactory/frontier/) API 주소가 맞도록 계산한다
const BASE = location.pathname.replace(/\/frontier\/?[^/]*$/, '');
const API = BASE + '/api/mud';
const KEY = 'frontier-token';

let mode = null;             // 'server' | 'local'
let token = localStorage.getItem(KEY) || null;
let stream = null;
const history = [];
let histAt = -1;

/* ---------- 출력 ---------- */
function print(line) {
  const box = $('out');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const div = document.createElement('div');
  div.className = 'ln ' + (line.t || 'info');
  div.textContent = line.text;
  box.append(div);
  if (atBottom) box.scrollTop = box.scrollHeight;
  while (box.childElementCount > 600) box.firstElementChild.remove();
}
const printAll = lines => (lines || []).forEach(print);
const echo = text => print({ t: 'echo', text: '> ' + text });

/* ---------- 사이드 패널 ---------- */
const COMPASS = ['위', '북', '', '서', '·', '동', '아래', '남', ''];

function renderCompass() {
  const box = $('compass');
  if (box.childElementCount) return;
  for (const d of COMPASS) {
    const b = document.createElement('button');
    b.textContent = d === '·' ? '' : d;
    b.disabled = !d || d === '·';
    if (d && d !== '·') b.addEventListener('click', () => submit(d));
    box.append(b);
  }
}

function renderSummary(s) {
  if (!s) return;
  $('hud-where').textContent = `${s.at} · ${['안전', '주의', '위험', '치명'][s.danger]}${s.water ? ' · 물' : ''}`;
  $('hud-power').textContent = `전력 ${s.power.demand} / ${s.power.supply} MW`;
  $('hud-power').classList.toggle('bad', s.power.demand > s.power.supply);
  $('hud-explore').textContent = `탐사 ${s.visited}/${s.total}`;
  $('hud-online').textContent = s.solo ? '혼자 하는 세계' : `접속 ${s.online}명`;

  const stock = $('stock');
  stock.textContent = '';
  for (const it of s.stock) {
    const row = document.createElement('div');
    row.className = 'row';
    const k = document.createElement('span'); k.className = 'k'; k.textContent = it.name;
    const v = document.createElement('span'); v.className = 'v'; v.textContent = it.n;
    const r = document.createElement('span');
    r.className = 'r ' + (it.rate > 0 ? 'up' : it.rate < 0 ? 'down' : '');
    r.textContent = Math.abs(it.rate) < 0.05 ? '' : `${it.rate > 0 ? '+' : ''}${Math.round(it.rate * 10) / 10}/분`;
    row.append(k, v, r);
    stock.append(row);
  }
  if (!s.stock.length) {
    const d = document.createElement('div'); d.className = 'dim'; d.textContent = '비어 있다';
    stock.append(d);
  }

  const proj = $('project');
  proj.textContent = '';
  const t = document.createElement('div');
  t.className = 'ptitle';
  t.textContent = s.project.name;
  proj.append(t);
  for (const n of s.project.need) {
    const row = document.createElement('div');
    row.className = 'row' + (n.have >= n.need ? ' done' : '');
    const k = document.createElement('span'); k.className = 'k'; k.textContent = n.name;
    const v = document.createElement('span'); v.className = 'v'; v.textContent = `${n.have} / ${n.need}`;
    row.append(k, v);
    proj.append(row);
  }
}

/* ---------- 모드별 통신 ---------- */
const net = {
  async join(name) {
    if (mode === 'local') return window.FrontierLocal.join(name);
    const r = await fetch(API + '/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    return r.ok ? data : { error: data.error || '강하 실패' };
  },
  async command(line) {
    if (mode === 'local') return window.FrontierLocal.command(line);
    const r = await fetch(API + '/cmd', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, line }),
    });
    if (r.status === 401) return { unauthorized: true };
    return r.json();
  },
};

async function submit(line) {
  if (!line.trim()) return;
  echo(line);
  history.unshift(line);
  histAt = -1;
  try {
    const data = await net.command(line);
    if (data.unauthorized) { localStorage.removeItem(KEY); location.reload(); return; }
    printAll(data.lines);
    renderSummary(data.summary);
  } catch {
    print({ t: 'err', text: '서버와 연결이 끊겼다. 새로고침하라.' });
  }
}

function listen() {
  if (mode === 'local') {
    window.FrontierLocal.onUpdate(d => { printAll(d.lines); renderSummary(d.summary); });
    const g = window.FrontierLocal.greeting();
    printAll(g.lines);
    renderSummary(g.summary);
    return;
  }
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

/* ---------- 기동 ---------- */
function loadScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => no(new Error(src));
    document.head.append(s);
  });
}

/** 서버가 있는지 확인한다. 정적 호스팅이면 이 경로가 없으므로 혼자 모드로 간다. */
async function detectMode() {
  try {
    const r = await fetch(API + '/cmd', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '', line: '' }),
    });
    if (r.status === 401 || r.status === 200) return 'server';
  } catch { /* 네트워크 없음 = 정적 호스팅 */ }
  return 'local';
}

async function boot() {
  mode = await detectMode();
  const badge = $('mode-note');
  if (mode === 'local') {
    badge.textContent = '서버가 없어 혼자 하는 세계로 시작합니다 — 진행은 이 브라우저에 저장됩니다.';
    // 세계를 브라우저에서 돌리는 데 필요한 것만 이때 받아온다 (멀티면 받지 않는다)
    await loadScript('../web/data.js');
    await loadScript('map.js');
    await loadScript('core.js');
    await loadScript('local.js');
    const resumed = window.FrontierLocal.tryResume();
    if (resumed) {
      enter();
      if (resumed.elapsed > 60)
        print({ t: 'ok', text: `⏰ 자리를 비운 ${Math.round(resumed.elapsed / 60)}분 동안에도 공장은 돌았다.` });
      return;
    }
  } else {
    badge.textContent = '서버에 접속합니다 — 다른 개척자들과 같은 행성을 나눠 씁니다.';
    if (token) {
      const r = await net.command('');
      if (!r.unauthorized) { enter(); return; }
      localStorage.removeItem(KEY);
      token = null;
    }
  }
  $('gate').hidden = false;
  $('name').focus();
}

async function join(name) {
  const msg = $('gate-msg');
  msg.textContent = '강하 중…';
  try {
    const data = await net.join(name);
    if (data.error) { msg.textContent = data.error; return; }
    token = data.token;
    localStorage.setItem(KEY, token);
    enter();
  } catch {
    msg.textContent = '강하에 실패했다. 새로고침해 보라.';
  }
}

function enter() {
  $('gate').hidden = true;
  $('app').hidden = false;
  renderCompass();
  listen();
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
    b.addEventListener('click', () => { submit(b.dataset.cmd); input.focus(); });

  // 화면 아무 데나 눌러도 입력창으로 돌아온다 (머드의 기본 예의)
  document.addEventListener('click', e => {
    if (!$('app').hidden && !e.target.closest('button') && !window.getSelection().toString()) input.focus();
  });
}

wire();
boot();
