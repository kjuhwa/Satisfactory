/*
 * 클라우드 저장 (서버 동기화) — game.js 보다 먼저 로드된다.
 *
 * 플레이어 코드 8자 하나로 어느 기기에서든 같은 저장을 이어서 한다.
 * 서버에 못 붙으면 조용히 로컬(localStorage) 저장만으로 계속 동작한다.
 */
const Cloud = (() => {
  const CODE_KEY = 'sfy-cloud-code';
  const URL_KEY = 'sfy-cloud-url';
  // 게임별 저장 칸. 코드는 공유하고 저장만 따로 보관한다 (window.CLOUD_SLOT 으로 지정)
  const SLOT = (typeof window !== 'undefined' && window.CLOUD_SLOT) || 'main';
  const savePath = code => `/api/save/${code}` + (SLOT === 'main' ? '' : `/${SLOT}`);
  const TIMEOUT = 6000;
  const PUSH_DELAY = 3000;   // 저장 후 서버 반영까지 묶는 시간

  let code = localStorage.getItem(CODE_KEY) || '';
  let status = 'idle';       // idle | syncing | synced | offline | conflict
  let statusText = '';
  let listeners = [];
  let pushTimer = null;
  let pending = null;        // 밀린 저장 { state }
  let pushing = false;
  let lastPushedAt = 0;

  /* 서버 주소: http(s)로 열었으면 같은 오리진, file:// 이면 저장된 주소 사용 */
  function base() {
    if (location.protocol === 'http:' || location.protocol === 'https:') return '';
    return (localStorage.getItem(URL_KEY) || '').replace(/\/$/, '');
  }
  const available = () => location.protocol.startsWith('http') || !!localStorage.getItem(URL_KEY);

  function setStatus(s, text) {
    status = s; statusText = text || '';
    for (const fn of listeners) fn(status, statusText, code);
  }

  async function api(path, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(base() + path, {
        ...opts,
        signal: ctrl.signal,
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      });
      let data = null;
      try { data = await res.json(); } catch { /* 본문 없음 */ }
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(t);
    }
  }

  const normalize = raw => String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);

  /* ---------- 공개 API ---------- */

  /** 서버에서 저장을 받아온다. 실패하면 null (게임은 로컬 저장으로 계속). */
  async function pull() {
    if (!available()) { setStatus('offline', '로컬 저장'); return null; }
    setStatus('syncing', '동기화 중…');
    try {
      if (!code) {
        const res = await api('/api/save/new', { method: 'POST' });
        if (!res.ok || !res.data || !res.data.code) { setStatus('offline', '서버 없음 · 로컬 저장'); return null; }
        code = res.data.code;
        localStorage.setItem(CODE_KEY, code);
        setStatus('synced', '새 코드 발급됨');
        return null;
      }
      const res = await api(savePath(code));
      if (res.status === 404) { setStatus('synced', '서버에 저장 없음'); return null; }
      if (!res.ok || !res.data || !res.data.state) { setStatus('offline', '서버 응답 오류 · 로컬 저장'); return null; }
      setStatus('synced', '');
      const s = res.data.state;
      s.savedAt = res.data.savedAt || s.savedAt;
      return s;
    } catch {
      setStatus('offline', '서버 연결 실패 · 로컬 저장');
      return null;
    }
  }

  async function flush(state, force) {
    if (!available() || !code) return;
    if (pushing) { pending = { state: state, force: force }; return; }
    pushing = true;
    setStatus('syncing', '저장 중…');
    try {
      const res = await api(savePath(code), {
        method: 'PUT',
        body: JSON.stringify({ savedAt: state.savedAt || Date.now(), state: state, force: !!force }),
      });
      if (res.status === 409) {
        setStatus('conflict', '다른 기기의 저장이 더 최신입니다 — 새로고침하세요');
      } else if (res.ok) {
        lastPushedAt = Date.now();
        setStatus('synced', '');
      } else {
        setStatus('offline', '서버 저장 실패 · 로컬 저장');
      }
    } catch {
      setStatus('offline', '서버 연결 실패 · 로컬 저장');
    } finally {
      pushing = false;
      const next = pending;
      pending = null;
      if (next) flush(next.state, next.force);
    }
  }

  /** 저장 예약 (여러 번 불러도 PUSH_DELAY 안에서 한 번만 전송). */
  function push(state, opts = {}) {
    if (!available() || !code) return;
    if (opts.immediate) {
      clearTimeout(pushTimer); pushTimer = null;
      return flush(state, opts.force);
    }
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = null; flush(state); }, PUSH_DELAY);
  }

  /** 다른 기기의 코드로 갈아탄다. 성공하면 그 저장을 반환. */
  async function useCode(raw) {
    const c = normalize(raw);
    if (c.length !== 8) throw new Error('코드는 8자리입니다.');
    if (!available()) throw new Error('서버에 연결할 수 없습니다.');
    const res = await api(savePath(c));
    if (res.status === 400) throw new Error('코드 형식이 올바르지 않습니다.');
    if (!res.ok && res.status !== 404) throw new Error('서버에 연결할 수 없습니다.');
    code = c;
    localStorage.setItem(CODE_KEY, code);
    setStatus('synced', '');
    if (res.status === 404 || !res.data || !res.data.state) return null;
    const s = res.data.state;
    s.savedAt = res.data.savedAt || s.savedAt;
    return s;
  }

  /** file:// 로 열었을 때 쓸 서버 주소 (예: http://192.168.0.10:8787). */
  function setServerUrl(url) {
    const u = String(url || '').trim().replace(/\/$/, '');
    if (u) localStorage.setItem(URL_KEY, u); else localStorage.removeItem(URL_KEY);
  }
  const serverUrl = () => localStorage.getItem(URL_KEY) || (location.protocol.startsWith('http') ? location.origin : '');

  return {
    pull, push, useCode, setServerUrl, serverUrl, available,
    get code() { return code; },
    get status() { return status; },
    get statusText() { return statusText; },
    onChange(fn) { listeners.push(fn); fn(status, statusText, code); },
  };
})();
