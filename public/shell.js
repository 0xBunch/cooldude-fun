/* COOL DUDEZ ARCADE — shell controller (the trusted parent).
 * Owns the nickname + device id, runs the gate, renders the gallery, hosts the
 * sandboxed game iframe, and is the ONLY thing that submits scores. */
(function () {
  'use strict';

  var ACCENTS = [
    { c: 'var(--cyan)', g: 'rgba(0,229,255,.32)' },
    { c: 'var(--magenta)', g: 'rgba(255,43,214,.32)' },
    { c: 'var(--yellow)', g: 'rgba(255,230,0,.30)' },
    { c: 'var(--ice)', g: 'rgba(125,249,255,.30)' },
  ];

  var ICON = '<svg class="tile-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M7 9h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.2 2L14 15h-4l-1.8 1A3 3 0 0 1 3 14v-1a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  var state = {
    gamesBaseUrl: '',
    nickname: localStorage.getItem('cd_nickname') || '',
    deviceId: '',
    games: [],
    currentGame: null,
    iframe: null,
    lastTop: [],
  };

  // ── helpers ──────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function fmt(n) { try { return Number(n).toLocaleString('en-US'); } catch (e) { return String(n); } }

  function deviceId() {
    var id = localStorage.getItem('cd_device_id');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'd-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('cd_device_id', id);
    }
    return id;
  }

  // ── sound (synthesized via Web Audio — no audio files) ─────────────────────
  var sound = { ctx: null, muted: localStorage.getItem('cd_sound') === '0' };

  function audioCtx() {
    if (!sound.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) sound.ctx = new AC();
    }
    if (sound.ctx && sound.ctx.state === 'suspended') sound.ctx.resume();
    return sound.ctx;
  }
  function tone(freq, start, dur, type, gain) {
    var ctx = sound.ctx;
    if (!ctx) return;
    var t0 = ctx.currentTime + start;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.16, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function play(seq) {
    if (sound.muted || !audioCtx()) return;
    seq();
  }
  var sfx = {
    blip:    function () { play(function () { tone(660, 0, 0.07, 'square', 0.10); }); },
    select:  function () { play(function () { tone(520, 0, 0.06, 'square', 0.13); tone(780, 0.06, 0.09, 'square', 0.13); }); },
    coin:    function () { play(function () { tone(988, 0, 0.07, 'square', 0.15); tone(1319, 0.07, 0.17, 'square', 0.15); }); },
    powerup: function () { play(function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.07, 0.13, 'triangle', 0.15); }); }); },
    buzz:    function () { play(function () { tone(160, 0, 0.18, 'sawtooth', 0.16); tone(120, 0.16, 0.22, 'sawtooth', 0.14); }); },
  };
  function unlockAudioOnce() {
    audioCtx();
    window.removeEventListener('pointerdown', unlockAudioOnce);
    window.removeEventListener('keydown', unlockAudioOnce);
  }
  function applyMuteUI(btn) {
    if (!btn) return;
    btn.classList.toggle('is-muted', sound.muted);
    btn.setAttribute('aria-pressed', sound.muted ? 'false' : 'true');
    btn.setAttribute('aria-label', sound.muted ? 'Unmute sound' : 'Mute sound');
  }
  function initSound() {
    window.addEventListener('pointerdown', unlockAudioOnce);
    window.addEventListener('keydown', unlockAudioOnce);
    var btn = $('sound-toggle');
    applyMuteUI(btn);
    if (btn) btn.addEventListener('click', function () {
      sound.muted = !sound.muted;
      localStorage.setItem('cd_sound', sound.muted ? '0' : '1');
      applyMuteUI(btn);
      if (!sound.muted) { audioCtx(); sfx.blip(); }
    });
    // Light tactile blip on secondary nav controls (primary actions have their own SFX).
    document.addEventListener('pointerdown', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('.iconbtn, .linkbtn')) sfx.blip();
    });
  }

  function getJSON(path) {
    return fetch(path, { headers: { 'x-device-id': state.deviceId } }).then(function (r) { return r.json(); });
  }
  function postJSON(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': state.deviceId },
      body: JSON.stringify(body || {}),
    });
  }

  function showView(name) {
    ['gate', 'home', 'play'].forEach(function (v) {
      var el = $(v);
      if (el) el.hidden = v !== name;
    });
  }

  // ── gate ─────────────────────────────────────────────────────────────────
  function initGate() {
    $('gate-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('gate-error');
      err.hidden = true;
      sfx.coin();
      postJSON('/api/gate', { code: $('gate-input').value }).then(function (r) {
        if (r.ok) { sfx.powerup(); enterArcade(); }
        else { sfx.buzz(); err.textContent = 'That code is not right. Ask the Cool Dude!'; err.hidden = false; }
      }).catch(function () {
        err.textContent = 'Something went wrong. Try again.'; err.hidden = false;
      });
    });
  }

  function enterArcade() {
    showView('home');
    renderWhoami();
    loadGames();
  }

  // ── nickname ─────────────────────────────────────────────────────────────
  var pendingAfterNick = null;
  function ensureNickname(cb) {
    if (state.nickname) { cb && cb(); return; }
    pendingAfterNick = cb || null;
    openNicknameModal();
  }
  function openNicknameModal() {
    $('nickname-error').hidden = true;
    $('nickname-input').value = state.nickname || '';
    $('nickname-modal').hidden = false;
    setTimeout(function () { $('nickname-input').focus(); }, 30);
  }
  function initNickname() {
    $('nickname-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var val = $('nickname-input').value.trim();
      var err = $('nickname-error');
      if (!/^[A-Za-z0-9 _-]{1,16}$/.test(val)) {
        err.textContent = '1–16 letters, numbers, spaces, _ or -'; err.hidden = false; return;
      }
      state.nickname = val;
      localStorage.setItem('cd_nickname', val);
      sfx.select();
      $('nickname-modal').hidden = true;
      renderWhoami();
      var cb = pendingAfterNick; pendingAfterNick = null;
      if (cb) cb();
    });
    $('change-name').addEventListener('click', function () { ensureNickname(); });
  }
  function renderWhoami() {
    if (state.nickname) $('whoami-name').textContent = state.nickname;
    $('play-nick').textContent = state.nickname || 'DUDE';
  }

  // ── gallery ──────────────────────────────────────────────────────────────
  function loadGames() {
    getJSON('/api/games').then(function (games) {
      state.games = Array.isArray(games) ? games : [];
      renderGames();
    }).catch(function () { state.games = []; renderGames(); });
  }

  function renderGames() {
    var grid = $('game-grid');
    grid.textContent = '';
    $('empty').hidden = state.games.length > 0;
    grid.hidden = state.games.length === 0;

    state.games.forEach(function (game, i) {
      var accent = ACCENTS[i % ACCENTS.length];
      var tile = document.createElement('button');
      tile.className = 'tile';
      tile.type = 'button';
      tile.setAttribute('role', 'listitem');
      tile.style.setProperty('--accent', accent.c);
      tile.style.setProperty('--accent-glow', accent.g);

      if (game.thumbUrl) {
        var img = document.createElement('img');
        img.className = 'tile-thumb';
        img.src = game.thumbUrl;
        img.alt = '';
        img.loading = 'lazy';
        tile.appendChild(img);
      } else {
        var iconWrap = document.createElement('div');
        iconWrap.innerHTML = ICON;
        tile.appendChild(iconWrap.firstChild);
      }

      var title = document.createElement('div');
      title.className = 'tile-title';
      title.textContent = game.title;
      tile.appendChild(title);

      var play = document.createElement('span');
      play.className = 'tile-play';
      play.textContent = '▶ PLAY';
      tile.appendChild(play);

      tile.addEventListener('click', function () { openGame(game); });
      grid.appendChild(tile);
    });
  }

  // ── play ─────────────────────────────────────────────────────────────────
  function openGame(game) {
    sfx.select();
    ensureNickname(function () {
      state.currentGame = game;
      $('play-title').textContent = game.title;
      renderWhoami();
      showView('play');

      var wrap = $('frame-wrap');
      wrap.textContent = '';
      var iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts'); // opaque origin — the boundary
      iframe.setAttribute('title', game.title);
      iframe.src = state.gamesBaseUrl + '/g/' + encodeURIComponent(game.slug);
      iframe.addEventListener('load', sendInit);
      wrap.appendChild(iframe);
      state.iframe = iframe;
    });
  }

  function sendInit() {
    if (!state.iframe || !state.currentGame) return;
    try {
      state.iframe.contentWindow.postMessage(
        { type: 'arcade:init', v: 1, nickname: state.nickname, slug: state.currentGame.slug },
        '*'
      );
    } catch (e) {}
  }

  function closePlay() {
    var wrap = $('frame-wrap');
    wrap.textContent = '';
    state.iframe = null;
    state.currentGame = null;
    hideToast();
    showView('home');
  }

  // The single trusted entry point for scores. Validates the message is from our
  // game iframe; the game can NOT name a different player — we use our nickname.
  function onMessage(e) {
    if (!state.iframe || e.source !== state.iframe.contentWindow) return;
    var d = e.data;
    if (!d || d.v !== 1) return;
    if (d.type === 'arcade:ready') { sendInit(); return; }
    if (d.type === 'arcade:score') { submitScore(d.score); return; }
  }

  function submitScore(score) {
    var game = state.currentGame;
    if (!game || !state.nickname) return;
    var n = Math.floor(Number(score));
    if (!isFinite(n)) return;

    postJSON('/api/scores', { slug: game.slug, nickname: state.nickname, score: n })
      .then(function (r) {
        if (r.status === 403) { showToast('Arcade locked', 'Re-enter the code to save scores.'); showView('gate'); return null; }
        if (r.status === 429) { showToast('Whoa, slow down!', 'Try again in a moment.'); return null; }
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        if (!res) return;
        if (!res.ok) { showToast('Could not save', (res.data && res.data.error) || 'Try again.'); return; }
        var top = (res.data && res.data.top) || [];
        state.lastTop = top;
        celebrate(game.slug, n, top);
      })
      .catch(function () { showToast('Could not save', 'Check your connection.'); });
  }

  function celebrate(slug, score, top) {
    var bestKey = 'cd_best_' + slug;
    var prevBest = Number(localStorage.getItem(bestKey) || 0);
    var isBest = score > prevBest;
    if (isBest) localStorage.setItem(bestKey, String(score));

    var rank = 0;
    for (var i = 0; i < top.length; i++) {
      if (top[i].nickname === state.nickname && Number(top[i].score) === score) { rank = i + 1; break; }
    }
    if (isBest) sfx.powerup(); else sfx.coin();
    var head = isBest ? 'NEW HIGH SCORE!' : 'SCORE SAVED!';
    var sub = fmt(score) + (rank ? '  ·  #' + rank + ' on the board' : '');
    showToast(head, sub);
  }

  var toastTimer = null;
  function showToast(head, sub) {
    var t = $('toast');
    t.innerHTML = '';
    t.appendChild(document.createTextNode(head));
    if (sub) { var s = document.createElement('span'); s.className = 'small'; s.textContent = sub; t.appendChild(s); }
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }
  function hideToast() { $('toast').hidden = true; }

  // ── leaderboard ──────────────────────────────────────────────────────────
  function openLeaderboard() {
    if (!state.currentGame) return;
    $('lb-title').textContent = 'Top scores — ' + state.currentGame.title;
    getJSON('/api/scores/' + encodeURIComponent(state.currentGame.slug) + '?limit=10')
      .then(renderLeaderboard).catch(function () { renderLeaderboard([]); });
    $('leaderboard-modal').hidden = false;
  }
  function renderLeaderboard(top) {
    var list = $('lb-list');
    list.textContent = '';
    var rows = Array.isArray(top) ? top : [];
    $('lb-empty').hidden = rows.length > 0;
    rows.forEach(function (row, i) {
      var li = document.createElement('li');
      li.className = 'lb-row' + (row.nickname === state.nickname ? ' is-me' : '');
      var rank = document.createElement('span'); rank.className = 'lb-rank'; rank.textContent = '#' + (i + 1);
      var name = document.createElement('span'); name.className = 'lb-name'; name.textContent = row.nickname;
      var score = document.createElement('span'); score.className = 'lb-score'; score.textContent = fmt(row.score);
      li.appendChild(rank); li.appendChild(name); li.appendChild(score);
      list.appendChild(li);
    });
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  function initPlay() {
    $('back-btn').addEventListener('click', closePlay);
    $('scores-btn').addEventListener('click', openLeaderboard);
    $('lb-close').addEventListener('click', function () { $('leaderboard-modal').hidden = true; });
    $('leaderboard-modal').addEventListener('click', function (e) {
      if (e.target === $('leaderboard-modal')) $('leaderboard-modal').hidden = true;
    });
    window.addEventListener('message', onMessage);
  }

  function start() {
    state.deviceId = deviceId();
    initSound();
    initGate();
    initNickname();
    initPlay();
    renderWhoami();
    getJSON('/api/session').then(function (s) {
      state.gamesBaseUrl = (s && s.gamesBaseUrl) || '';
      if (s && s.gated) { enterArcade(); } else { showView('gate'); $('gate-input').focus(); }
    }).catch(function () { showView('gate'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
