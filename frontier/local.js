'use strict';
/*
 * 개척 원정대 — 브라우저 단독 어댑터 (GitHub Pages 용)
 *
 * 서버가 없으면 세계를 브라우저 안에서 돌린다. 규칙은 서버판과 같은 core.js 를 쓰므로
 * 지도·전력망·매장지 선착순 같은 규칙이 갈라지지 않는다.
 *
 * 서버판과 다른 점은 딱 둘이다:
 *   - 다른 사람이 없다 (점유 경쟁도 없고 `누구` 는 늘 나 혼자다)
 *   - 그래서 공동 프로젝트 필요량이 5분의 1로 줄어 있다 (core 의 solo 모드)
 */

window.FrontierLocal = (function () {
  const KEY = 'frontier-local-v1';

  function create() {
    const G = window.FrontierCore.createWorld({
      data: window.GAME_DATA,
      solo: true,
      rng: () => {
        const b = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(b);
        return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
      },
      online: () => Object.values(G.world.players),
      emit: {
        // 혼자이므로 어디로 보내든 결국 나에게 온다. 중복 출력을 막으려고
        // 방/전체 알림은 버린다 — 내 행동의 결과는 명령 응답에 이미 들어 있다.
        toPlayer: () => {},
        toRoom: () => {},
        broadcast: () => {},
      },
    });
    return G;
  }

  let G = null;
  let token = null;
  let onUpdate = null;
  let timer = null;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ token, dump: G.dump() })); }
    catch (e) { /* 용량 초과 등 — 다음 저장에서 다시 시도한다 */ }
  }

  function tick() {
    G.tickAll(window.FrontierCore.TICK_SEC / 60);
    const p = G.resume(token);
    if (p && onUpdate) onUpdate({ lines: [], summary: G.summary(p) });
    save();
  }

  function startClock() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, window.FrontierCore.TICK_SEC * 1000);
  }

  return {
    /** 저장된 세계가 있으면 이어서 시작한다 */
    tryResume() {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
      if (!saved || !saved.dump || !saved.token) return null;
      G = create();
      const elapsed = G.restore(saved.dump);     // 닫아 둔 동안에도 공장은 돌았다
      token = saved.token;
      const p = G.resume(token);
      if (!p) return null;
      startClock();
      return { player: p, elapsed };
    },

    join(name) {
      G = G || create();
      const r = G.join(name);
      if (r.error) return r;
      token = r.token;
      save();
      startClock();
      return r;
    },

    command(line) {
      const p = G && G.resume(token);
      if (!p) return { error: 'no session' };
      let lines;
      try { lines = G.handleCommand(p, line); }
      catch (e) { lines = [{ t: 'err', text: '명령을 처리하다 문제가 생겼다: ' + e.message }]; }
      save();
      return { lines, summary: G.summary(p) };
    },

    greeting() {
      const p = G && G.resume(token);
      return p ? { lines: G.greeting(p), summary: G.summary(p) } : { lines: [] };
    },

    onUpdate(fn) { onUpdate = fn; },

    reset() {
      localStorage.removeItem(KEY);
      if (timer) clearInterval(timer);
      G = null; token = null;
    },
  };
})();
