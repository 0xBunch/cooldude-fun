/*
 * COOL DUDE'S ARCADE — Arcade SDK
 * Injected into every game. Runs inside a sandboxed iframe (opaque origin),
 * so it has NO access to the arcade's cookies or storage. It talks to the
 * arcade shell only through postMessage.
 *
 * For game makers, the whole contract is one line at game-over:
 *     window.Arcade?.submitScore(finalScore);
 * Optionally greet the player with: window.Arcade?.nickname
 */
(function () {
  var nickname = null;
  var slug = null;
  var readyCbs = [];
  var lastSent = 0;

  var Arcade = {
    v: 1,
    nickname: null,
    slug: null,

    // Run cb once the player's nickname is known (or immediately if it already is).
    ready: function (cb) {
      if (typeof cb !== 'function') return;
      if (nickname !== null) cb();
      else readyCbs.push(cb);
    },

    // Report a score to the arcade. The shell attaches the trusted nickname.
    submitScore: function (score) {
      var n = Math.floor(Number(score));
      if (!isFinite(n)) return;
      if (n < 0) n = 0;
      if (n > 1e9) n = 1e9;
      var now = Date.now();
      if (now - lastSent < 250) return; // ignore accidental double-fires
      lastSent = now;
      try {
        window.parent.postMessage({ type: 'arcade:score', v: 1, score: n }, '*');
      } catch (e) {}
    },
  };

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return; // only listen to our embedder
    var d = e.data;
    if (!d || d.type !== 'arcade:init' || d.v !== 1) return;
    nickname = typeof d.nickname === 'string' ? d.nickname : null;
    slug = typeof d.slug === 'string' ? d.slug : null;
    Arcade.nickname = nickname;
    Arcade.slug = slug;
    var cbs = readyCbs;
    readyCbs = [];
    for (var i = 0; i < cbs.length; i++) {
      try { cbs[i](); } catch (e2) {}
    }
  });

  window.Arcade = Arcade;

  // Announce we're alive so the shell sends us the player's nickname.
  try { window.parent.postMessage({ type: 'arcade:ready', v: 1 }, '*'); } catch (e) {}
})();
