'use strict';
/*
 * 개척 원정대 — Node 서버 어댑터
 *
 * 규칙은 전부 core.js 에 있다. 이 파일이 하는 일은 셋뿐이다:
 *   HTTP/SSE 로 주고받기 · 파일로 저장하기 · 세계 시계 돌리기
 * 브라우저 단독 실행(GitHub Pages)은 같은 core.js 를 local.js 가 감싼다.
 *
 * game/server.js 가 /api/mud/* 를 이리로 넘긴다.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const core = require('./core.js');

/* ---------- 게임 데이터 (플래너와 같은 파일을 그대로 읽는다) ---------- */
const DATA = (() => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'data.js'), 'utf8'), sandbox);
  return sandbox.window.GAME_DATA;
})();

const streams = new Map();     // playerId -> Set<res>
let SAVE_FILE = path.join(__dirname, '..', 'game', 'saves', 'frontier-world.json');

function send(pid, lines, extra) {
  const set = streams.get(pid);
  if (!set) return;
  const payload = `data: ${JSON.stringify({ lines: [].concat(lines || []), ...extra })}\n\n`;
  for (const res of set) { try { res.write(payload); } catch { /* 끊긴 연결 */ } }
}

const G = core.createWorld({
  data: DATA,
  rng: () => crypto.randomBytes(16).toString('hex'),
  online: () => Object.values(G.world.players).filter(p => streams.has(p.id)),
  emit: {
    toPlayer: send,
    toRoom: (rid, lines, exceptId) => {
      for (const p of Object.values(G.world.players))
        if (p.at === rid && p.id !== exceptId && streams.has(p.id)) send(p.id, lines);
    },
    broadcast: lines => { for (const pid of streams.keys()) send(pid, lines); },
  },
});

/* ---------- 저장 ---------- */
function persist() {
  try {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    const tmp = SAVE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(G.dump()), 'utf8');
    fs.renameSync(tmp, SAVE_FILE);
  } catch (e) { console.error('개척 원정대 저장 실패:', e.message); }
}

// 종료 훅에 기대면 안 된다 — Windows 에는 진짜 시그널이 없어 강제 종료되면 훅이 돌지 않는다.
// 그래서 상태가 바뀐 명령 뒤에 곧바로(1초 이내로 묶어서) 저장한다.
// 틱으로 쌓인 생산량은 저장 시각으로부터 다시 계산되므로 잃을 것이 없다 — 잃으면 안 되는 건
// 점유·건설·송전 같은 "되돌릴 수 없는 결정"이다.
let flushTimer = null;
function flushSoon() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; persist(); }, 1000);
  flushTimer.unref?.();
}

function restore() {
  try {
    const elapsed = G.restore(JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')));
    if (elapsed > core.TICK_SEC)
      console.log(`개척 원정대: 정지해 있던 ${Math.round(elapsed / 60)}분을 따라잡았다.`);
  } catch { /* 첫 실행 */ }
}

/* ---------- HTTP ---------- */
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res, urlPath) {
  const route = urlPath.replace(/^\/api\/mud\/?/, '');

  if (route === 'join' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const r = G.join(body.name);
    if (!r.error) flushSoon();
    return r.error ? json(res, 409, r) : json(res, 201, r);
  }

  if (route === 'cmd' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const p = G.resume(body.token);
    if (!p) return json(res, 401, { error: 'unknown token' });
    p.lastSeen = Date.now();
    let lines;
    try { lines = G.handleCommand(p, body.line); }
    catch (e) { console.error(e); lines = [{ t: 'err', text: '명령을 처리하다 문제가 생겼다: ' + e.message }]; }
    flushSoon();
    return json(res, 200, { lines, summary: G.summary(p) });
  }

  if (route.startsWith('stream') && req.method === 'GET') {
    const token = new URL(req.url, 'http://x').searchParams.get('token');
    const p = G.resume(token);
    if (!p) return json(res, 401, { error: 'unknown token' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':\n\n');
    if (!streams.has(p.id)) streams.set(p.id, new Set());
    streams.get(p.id).add(res);
    send(p.id, G.greeting(p), { summary: G.summary(p) });
    req.on('close', () => {
      const set = streams.get(p.id);
      if (set) { set.delete(res); if (!set.size) streams.delete(p.id); }
    });
    return;
  }

  return json(res, 404, { error: 'unknown endpoint' });
}

/* ---------- 기동 ---------- */
let started = false;
function start(saveDir) {
  if (started) return;
  started = true;
  if (saveDir) SAVE_FILE = path.join(saveDir, 'frontier-world.json');
  restore();
  setInterval(() => {
    G.tickAll(core.TICK_SEC / 60);
    // 명령을 치지 않아도 재고·전력이 흐르는 게 보여야 한다
    for (const pid of streams.keys()) {
      const p = G.world.players[pid];
      if (p) send(pid, [], { summary: G.summary(p) });
    }
  }, core.TICK_SEC * 1000).unref?.();
  setInterval(persist, 30000).unref?.();
  process.on('exit', persist);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { persist(); process.exit(0); });
  }
}

module.exports = {
  handle, start,
  world: G.world,
  join: G.join, resume: G.resume, handleCommand: G.handleCommand,
  summary: G.summary, tickAll: G.tickAll,
};
