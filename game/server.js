#!/usr/bin/env node
/*
 * 방치형 공장 게임 저장 서버 (의존성 없음, Node 18+)
 *
 *   node game/server.js            # http://localhost:8787
 *   PORT=3000 node game/server.js
 *
 * - 정적 파일: 저장소 루트(game/, web/, game/icons/ ...)를 그대로 서빙
 * - 저장 API : 플레이어 코드(8자) 하나로 어느 기기에서든 같은 저장을 읽고 쓴다
 *     POST   /api/save/new        -> { code }              새 코드 발급
 *     GET    /api/save/:code      -> { code, savedAt, state } | 404
 *     PUT    /api/save/:code      body { savedAt, state }  저장 (오래된 저장은 409)
 *     DELETE /api/save/:code      저장 삭제
 * - 저장 파일: game/saves/<code>.json
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');            // Satisfactory/
const SAVE_DIR = process.env.SAVE_DIR
  ? path.resolve(process.env.SAVE_DIR)
  : path.join(__dirname, 'saves');
const MAX_BODY = 4 * 1024 * 1024;                      // 4MB

/* ---------- 플레이어 코드 ---------- */
// 헷갈리는 글자(0/O/1/I/L) 제외한 31자 알파벳
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LEN = 8;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);

function newCode() {
  const buf = require('crypto').randomBytes(CODE_LEN);
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

const normalizeCode = raw => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const savePath = code => path.join(SAVE_DIR, `${code}.json`);

/* ---------- HTTP 유틸 ---------- */
function sendJson(res, status, obj) {
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
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/game/index.html';
  else if (rel.endsWith('/')) rel += 'index.html';

  const file = path.resolve(ROOT, '.' + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { // 경로 탈출 차단
    return sendJson(res, 403, { error: 'forbidden' });
  }
  let stat;
  try { stat = await fsp.stat(file); } catch { return sendJson(res, 404, { error: 'not found' }); }
  if (stat.isDirectory()) return serveStatic(req, res, rel + '/');

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- 저장 API ---------- */
async function readSave(code) {
  try { return JSON.parse(await fsp.readFile(savePath(code), 'utf8')); }
  catch { return null; }
}

async function writeSave(code, record) {
  const tmp = `${savePath(code)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record), 'utf8');
  await fsp.rename(tmp, savePath(code));   // 쓰다 만 파일이 남지 않도록 원자적 교체
}

async function handleApi(req, res, urlPath) {
  const m = /^\/api\/save(?:\/([^/]*))?$/.exec(urlPath);
  if (!m) return sendJson(res, 404, { error: 'unknown endpoint' });
  const seg = m[1] || '';

  // 새 코드 발급
  if (req.method === 'POST' && seg === 'new') {
    for (let i = 0; i < 20; i++) {
      const code = newCode();
      if (!fs.existsSync(savePath(code))) {
        await writeSave(code, { code, savedAt: 0, state: null, updatedAt: new Date().toISOString() });
        return sendJson(res, 201, { code });
      }
    }
    return sendJson(res, 500, { error: 'code generation failed' });
  }

  const code = normalizeCode(seg);
  if (!CODE_RE.test(code)) return sendJson(res, 400, { error: 'invalid code' });

  if (req.method === 'GET') {
    const rec = await readSave(code);
    if (!rec || !rec.state) return sendJson(res, 404, { error: 'no save' });
    return sendJson(res, 200, { code, savedAt: rec.savedAt || 0, state: rec.state });
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (!body || typeof body.state !== 'object' || body.state === null || !Array.isArray(body.state.nodes)) {
      return sendJson(res, 400, { error: 'invalid state' });
    }
    const savedAt = Number(body.savedAt) || Date.now();
    const cur = await readSave(code);
    // 다른 기기가 더 최신 저장을 올려둔 경우 덮어쓰지 않는다 (force 로 강제 가능)
    if (cur && cur.state && (cur.savedAt || 0) > savedAt && !body.force) {
      return sendJson(res, 409, { error: 'stale', savedAt: cur.savedAt });
    }
    await writeSave(code, { code, savedAt, state: body.state, updatedAt: new Date().toISOString() });
    return sendJson(res, 200, { code, savedAt });
  }

  if (req.method === 'DELETE') {
    try { await fsp.unlink(savePath(code)); } catch { /* 이미 없음 */ }
    return sendJson(res, 200, { code, deleted: true });
  }

  return sendJson(res, 405, { error: 'method not allowed' });
}

/* ---------- 서버 ---------- */
const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  try {
    if (urlPath.startsWith('/api/')) return await handleApi(req, res, urlPath);
    if (req.method === 'GET' || req.method === 'HEAD') return await serveStatic(req, res, urlPath);
    return sendJson(res, 405, { error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    else res.end();
  }
});

fs.mkdirSync(SAVE_DIR, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`방치형 공장 서버 실행 중 → http://localhost:${PORT}/game/`);
  console.log(`저장 위치: ${SAVE_DIR}`);
});
