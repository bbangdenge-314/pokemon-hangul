/* 포켓몬 한글 따라쓰기 - 메인 로직 */
(function () {
  'use strict';

  var D = window.POKE_DATA;
  var POKEMON = D.POKEMON;
  var STAGES = D.STAGES;
  var REWARDS = D.REWARDS;
  var BONUS = D.BONUS;
  var artworkUrl = D.artworkUrl;
  var spriteUrl = D.spriteUrl;

  var KEY = 'pokemon-hangul-trace-v1';
  var main = document.getElementById('main');
  var hud = document.getElementById('hud');
  var confettiLayer = document.getElementById('confetti-layer');
  var toastEl = document.getElementById('toast');

  var POKE_IDS = Object.keys(POKEMON).map(Number).sort(function (a, b) { return a - b; });
  var PRAISE = ['좋았어!', '잘했어!', '최고야!', '멋져!', '딱 좋아!', '짝짝짝!'];
  var INK_COLORS = ['#ff6b9d', '#4dabf7', '#845ef7', '#f76707', '#20c997', '#e64980'];
  /* 단계별로 자동 완성으로 인정하는 회색 글자 덮음 비율 (5살 기준으로 넉넉하게) */
  var THRESH = { 1: 0.40, 2: 0.42, 3: 0.44, 4: 0.46, 5: 0.48 };
  /* "다 썼어요!"로 넘어가려면 최소한 이만큼은 그어야 한다 */
  var MIN_MANUAL = 0.16;

  /* ---------------- 상태 저장 ---------------- */
  function defaultState() {
    return { unlocked: 1, cleared: {}, caught: [], muted: false };
  }
  var state = defaultState();

  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return;
      state = Object.assign(defaultState(), s);
      if (!Array.isArray(state.caught)) state.caught = [];
      if (!state.cleared || typeof state.cleared !== 'object') state.cleared = {};
      state.unlocked = Math.min(5, Math.max(1, Number(state.unlocked) || 1));
    } catch (e) {
      state = defaultState();
    }
  }
  function saveState() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function isCaught(id) { return state.caught.indexOf(Number(id)) !== -1; }
  function catchPokemon(id) {
    id = Number(id);
    if (isCaught(id)) return false;
    state.caught.push(id);
    saveState();
    return true;
  }
  function clearedCount() { return Object.keys(state.cleared).length; }
  function totalStars() {
    var t = 0;
    Object.keys(state.cleared).forEach(function (k) { t += Number(state.cleared[k]) || 0; });
    return t;
  }
  function allCleared() {
    return STAGES.every(function (s) { return state.cleared[s.id] > 0; });
  }

  /* ---------------- 소리 ---------------- */
  var Sound = {
    ctx: null,
    ensure: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx) {
        try { this.ctx = new AC(); } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
      return this.ctx;
    },
    tone: function (freq, start, dur, type, vol) {
      if (state.muted) return;
      var ctx = this.ensure();
      if (!ctx) return;
      var t0 = ctx.currentTime + start;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },
    slide: function (from, to, start, dur, vol) {
      if (state.muted) return;
      var ctx = this.ensure();
      if (!ctx) return;
      var t0 = ctx.currentTime + start;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(from, t0);
      osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.14, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    },
    tap: function () { this.tone(880, 0, 0.07, 'sine', 0.07); },
    correct: function () {
      var notes = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < notes.length; i++) this.tone(notes[i], i * 0.07, 0.2, 'sine', 0.15);
    },
    pop: function () { this.slide(500, 1200, 0, 0.14, 0.13); },
    nudge: function () { this.slide(420, 560, 0, 0.2, 0.1); },
    fanfare: function () {
      var seq = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.52], [1046.5, 0.62], [1318.5, 0.74]];
      for (var i = 0; i < seq.length; i++) this.tone(seq[i][0], seq[i][1], 0.3, 'triangle', 0.13);
      this.tone(261.63, 0, 0.9, 'sine', 0.07);
      this.tone(392.0, 0, 0.9, 'sine', 0.05);
    }
  };

  /* ---------------- 말하기(TTS) ---------------- */
  var Speech = {
    voice: null,
    init: function () {
      if (!('speechSynthesis' in window)) return;
      var self = this;
      this.pick();
      try {
        window.speechSynthesis.onvoiceschanged = function () { self.pick(); };
      } catch (e) {}
    },
    pick: function () {
      if (!('speechSynthesis' in window)) return;
      try {
        var list = window.speechSynthesis.getVoices() || [];
        var ko = list.filter(function (v) {
          return v.lang && v.lang.toLowerCase().replace('_', '-').indexOf('ko') === 0;
        });
        this.voice = ko[0] || null;
      } catch (e) {}
    },
    speak: function (text, opts) {
      if (state.muted || !text || !('speechSynthesis' in window)) return;
      var self = this;
      var go = function () {
        try {
          var u = new SpeechSynthesisUtterance(String(text));
          u.lang = 'ko-KR';
          if (self.voice) u.voice = self.voice;
          u.rate = (opts && opts.rate) || 0.88;
          u.pitch = 1.15;
          u.volume = 1;
          window.speechSynthesis.speak(u);
        } catch (e) {}
      };
      try {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
          setTimeout(go, 90);
        } else {
          go();
        }
      } catch (e) {}
    },
    stop: function () {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  };

  /* ---------------- 효과 ---------------- */
  var COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#b983ff', '#ff9f43', '#ff8fab'];

  function confetti(n, origin) {
    n = n || 26;
    var w = window.innerWidth, h = window.innerHeight;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i');
      p.className = 'confetti';
      var x = origin ? origin.x : w / 2;
      var y = origin ? origin.y : h * 0.38;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.background = COLORS[i % COLORS.length];
      p.style.setProperty('--dx', (Math.random() * 2 - 1) * (w * 0.32) + 'px');
      p.style.setProperty('--dy', (Math.random() * 0.5 + 0.9) * (h * 0.45) + 'px');
      p.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
      p.style.setProperty('--dur', (1.1 + Math.random() * 0.9).toFixed(2) + 's');
      p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
      confettiLayer.appendChild(p);
      (function (node) { setTimeout(function () { node.remove(); }, 2600); })(p);
    }
  }

  var toastTimer = null;
  function toast(html, ms) {
    toastEl.innerHTML = html;
    toastEl.hidden = false;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      setTimeout(function () { toastEl.hidden = true; }, 260);
    }, ms || 1900);
  }

  var PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
    '<circle cx="60" cy="60" r="52" fill="#f5f7fb" stroke="#c9d6e8" stroke-width="6"/>' +
    '<path d="M8 60a52 52 0 0 1 104 0z" fill="#ff7b7b"/>' +
    '<rect x="8" y="55" width="104" height="10" fill="#39445c"/>' +
    '<circle cx="60" cy="60" r="16" fill="#fff" stroke="#39445c" stroke-width="8"/>' +
    '</svg>'
  );

  window.__pokeImgFallback = function (img) {
    var step = Number(img.getAttribute('data-step') || 0);
    var id = img.getAttribute('data-id');
    if (step === 0) {
      img.setAttribute('data-step', '1');
      img.src = spriteUrl(id);
    } else {
      img.setAttribute('data-step', '2');
      img.classList.add('img-fallback');
      img.src = PLACEHOLDER;
    }
  };

  function pokeImg(id, cls, alt) {
    return '<img class="' + (cls || '') + '" data-id="' + id + '" data-step="0" ' +
      'src="' + artworkUrl(id) + '" alt="' + (alt || POKEMON[id].name) + '" ' +
      'loading="lazy" decoding="async" onerror="window.__pokeImgFallback(this)">';
  }

  function starRow(n, max) {
    var out = '';
    for (var i = 0; i < (max || 3); i++) {
      out += '<span class="star ' + (i < n ? 'on' : 'off') + '">★</span>';
    }
    return out;
  }

  /* 받침 유무에 맞는 조사를 고른다 */
  function josa(word, withBatchim, withoutBatchim) {
    if (!word) return withoutBatchim;
    var code = word.charCodeAt(word.length - 1);
    if (code < 0xAC00 || code > 0xD7A3) return withBatchim;
    return ((code - 0xAC00) % 28) ? withBatchim : withoutBatchim;
  }
  function objParticle(word) { return josa(word, '을', '를'); }

  /* ---------------- 화면 공통 ---------------- */
  var view = 'home';
  var stage = null;   /* { data, index, nudges, clears } */
  var T = null;       /* 따라쓰기 세션 */
  var tokenSeq = 0;

  function setHud(title) {
    if (!title) { hud.hidden = true; hud.innerHTML = ''; return; }
    hud.hidden = false;
    hud.innerHTML =
      '<button class="hud-btn" data-act="back" aria-label="뒤로 가기">←</button>' +
      '<div class="hud-title">' + title + '</div>' +
      '<div class="hud-right">' +
      '<span class="star-chip" aria-label="별 개수">⭐ ' + totalStars() + '</span>' +
      '<button class="hud-btn" data-act="sound" aria-label="소리 켜기/끄기">' + (state.muted ? '🔇' : '🔊') + '</button>' +
      '</div>';
  }

  function refreshHud() {
    var chip = document.querySelector('.star-chip');
    if (chip) chip.textContent = '⭐ ' + totalStars();
  }

  function endTrace() {
    T = null;
    Speech.stop();
    var ov = document.getElementById('catch-overlay');
    if (ov) ov.remove();
  }

  /* ---------------- 홈 ---------------- */
  function goHome() {
    view = 'home';
    stage = null;
    endTrace();
    setHud(null);
    var started = clearedCount() > 0 || state.unlocked > 1;
    main.innerHTML =
      '<section class="screen home-screen">' +
      '<div class="home-sky"></div>' +
      '<div class="home-cloud c1"></div><div class="home-cloud c2"></div><div class="home-cloud c3"></div>' +
      '<div class="home-inner">' +
      '<div class="home-badge">한글 따라쓰기 · 5살</div>' +
      '<h1 class="home-title">포켓몬<br>한글 따라쓰기</h1>' +
      '<div class="home-hero">' +
      '<div class="hero-poke mini">' + pokeImg(7, 'hero-img') + '</div>' +
      '<div class="hero-poke big">' + pokeImg(25, 'hero-img') + '</div>' +
      '<div class="hero-poke mini">' + pokeImg(4, 'hero-img') + '</div>' +
      '</div>' +
      '<p class="home-sub">포켓몬 이름을 손가락으로 따라 써 봐요!</p>' +
      '<button class="big-btn primary" data-act="start">' + (started ? '계속 하기' : '시작하기') + '</button>' +
      '<div class="home-links">' +
      '<button class="ghost-btn" data-act="dex">📕 나의 도감 (' + state.caught.length + ')</button>' +
      '<button class="ghost-btn" data-act="parent">👨‍👩‍👧 보호자</button>' +
      '</div>' +
      '</div>' +
      '<div class="home-grass"></div>' +
      '</section>';
  }

  /* ---------------- 지도 ---------------- */
  function goMap() {
    view = 'map';
    stage = null;
    endTrace();
    setHud('모험 지도');
    var done = clearedCount();
    var html = '<section class="screen map-screen">';
    html += '<div class="map-top">' +
      '<div class="map-progress"><span>진행한 단계 <b>' + done + '</b> / ' + STAGES.length + '</span>' +
      '<div class="map-bar"><i style="width:' + (done / STAGES.length * 100) + '%"></i></div></div>' +
      '<button class="dex-btn" data-act="dex">📕 도감</button>' +
      '</div>';
    html += '<div class="stage-list">';
    STAGES.forEach(function (s) {
      var locked = s.id > state.unlocked;
      var stars = state.cleared[s.id] || 0;
      var cleared = stars > 0;
      html += '<button class="stage-card' + (locked ? ' locked' : '') + (cleared ? ' cleared' : '') +
        '" data-act="stage" data-id="' + s.id + '" data-locked="' + (locked ? '1' : '0') + '" ' +
        'style="--theme:' + s.theme + '">' +
        '<span class="sc-num">' + (locked ? '🔒' : (cleared ? '✓' : s.id)) + '</span>' +
        '<span class="sc-body">' +
        '<span class="sc-title">' + (locked ? '아직 잠겨 있어요' : s.id + '단계 · ' + s.title) + '</span>' +
        '<span class="sc-sub">' + (locked ? s.id + '단계를 먼저 깨야 해요' : s.subtitle) + '</span>' +
        '<span class="sc-stars">' + starRow(stars) + '</span>' +
        '</span>' +
        '<span class="sc-icon">' + (locked ? '🚪' : s.icon) + '</span>' +
        '</button>';
    });
    html += '</div>';
    var nextUncleared = STAGES.filter(function (x) { return !(state.cleared[x.id] > 0); })[0];
    if (allCleared() || !nextUncleared) {
      html += '<div class="map-done">🎉 모든 단계를 깼어요! 최고예요!</div>';
    } else {
      html += '<div class="map-next">다음은 <b>' + nextUncleared.id + '단계 · ' + nextUncleared.title + '</b> 예요!</div>';
    }
    html += '<div class="map-links"><button class="ghost-btn" data-act="home">처음으로</button>' +
      '<button class="ghost-btn" data-act="parent">👨‍👩‍👧 보호자</button></div>';
    html += '</section>';
    main.innerHTML = html;
  }

  /* ---------------- 단계 시작 ---------------- */
  function startStage(id) {
    var s = STAGES.filter(function (x) { return x.id === id; })[0];
    if (!s) { goMap(); return; }
    if (id > state.unlocked) {
      Sound.nudge();
      toast('아직 잠겨 있어요! 앞 단계를 먼저 깨요 🔒');
      return;
    }
    stage = { data: s, index: 0, nudges: 0, clears: 0 };
    view = 'quiz';
    renderQuestion();
  }

  /* ---------------- 따라쓰기 화면 ---------------- */
  function traceTargets(q) {
    return q.trace.slice().sort(function (a, b) { return a - b; });
  }

  function nameRowHTML(chars, targets, doneCount) {
    return chars.map(function (ch, i) {
      var order = targets.indexOf(i);
      var cls = 'syl';
      if (order !== -1) {
        cls += ' target';
        if (order < doneCount) cls += ' done';
        else if (order === doneCount) cls += ' now';
      } else {
        cls += ' fixed';
      }
      return '<span class="' + cls + '">' + ch + '</span>';
    }).join('');
  }

  function renderQuestion() {
    var s = stage.data;
    var q = s.questions[stage.index];
    var pkm = POKEMON[q.id];
    var chars = pkm.name.split('');
    var targets = traceTargets(q);
    var total = s.questions.length;

    setHud(s.title);
    document.getElementById('hud').style.setProperty('--theme', s.theme);

    main.innerHTML =
      '<section class="screen trace-screen" style="--theme:' + s.theme + '">' +
      '<div class="q-top">' +
      '<div class="q-step">' + s.icon + ' ' + s.id + '단계</div>' +
      '<div class="q-count">' + (stage.index + 1) + ' / ' + total + '</div>' +
      '</div>' +
      '<div class="q-bar"><i style="width:' + (stage.index / total * 100) + '%"></i></div>' +
      '<div class="poke-strip">' +
      '<div class="strip-img">' + pokeImg(q.id, 'strip-poke') + '</div>' +
      '<div class="strip-body">' +
      '<div class="name-row' + (chars.length >= 4 ? ' len4' : (chars.length === 3 ? ' len3' : '')) + '" id="name-row">' + nameRowHTML(chars, targets, 0) + '</div>' +
      '<div class="strip-hint" id="trace-hint">' + s.tip + '</div>' +
      '</div>' +
      '<button class="speaker-btn small" data-act="replay" aria-label="이름 듣기">🔊</button>' +
      '</div>' +
      '<div class="trace-main">' +
      '<div class="dots-row" id="dots-row"' + (targets.length > 1 ? '' : ' hidden') + '></div>' +
      '<div class="box-wrap" id="box-wrap">' +
      '<div class="box-bg"></div>' +
      '<canvas class="guide-canvas" aria-hidden="true"></canvas>' +
      '<canvas class="ink-canvas" role="img" aria-label="따라 쓰기 칸"></canvas>' +
      '<div class="start-dot" id="start-dot" hidden></div>' +
      '<div class="box-glow" aria-hidden="true"></div>' +
      '</div>' +
      '<div class="cover-wrap"><div class="cover-bar" id="cover-bar"></div></div>' +
      '<div class="cover-label" id="cover-label">손가락으로 회색 글자를 따라 그어요</div>' +
      '</div>' +
      '<div class="trace-btns">' +
      '<button class="round-btn" data-act="clear" aria-label="다시 쓰기">↺</button>' +
      '<button class="big-btn primary" data-act="done">다 썼어요!</button>' +
      '<button class="round-btn" data-act="replay" aria-label="다시 듣기">🔊</button>' +
      '</div>' +
      '</section>';

    T = {
      token: ++tokenSeq,
      stageId: s.id,
      q: q,
      pkm: pkm,
      chars: chars,
      targets: targets,
      ti: 0,
      total: total,
      strokes: [],
      drawing: false,
      cov: 0,
      locked: false,
      char: '',
      mask: null,
      path: [],
      done: {},
      stageIndex: stage.index
    };

    var ink = main.querySelector('.ink-canvas');
    ink.addEventListener('pointerdown', onDown);
    ink.addEventListener('pointermove', onMove);
    ink.addEventListener('pointerup', onUp);
    ink.addEventListener('pointercancel', onUp);
    ink.addEventListener('pointerleave', onLeave);

    initSyllable();
    speakQuestion();
  }

  function boxSize() {
    var tm = main.querySelector('.trace-main');
    var dots = document.getElementById('dots-row');
    /* 덮은 정도 막대 + 안내 글자 + 간격만큼은 칸에서 빼야 한다 */
    var extra = 66 + (dots && !dots.hidden ? 42 : 0);
    var byW = Math.min(window.innerWidth, 560) - 44;
    var byH = (tm && tm.clientHeight > 120)
      ? tm.clientHeight - extra
      : (window.innerHeight - 430);
    return Math.max(168, Math.round(Math.min(byW, byH, 400)));
  }

  var MASK_L = 96;
  var maskCanvas = null;

  function buildMask(ch) {
    if (!maskCanvas) {
      maskCanvas = document.createElement('canvas');
      maskCanvas.width = MASK_L;
      maskCanvas.height = MASK_L;
    }
    var g = maskCanvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, MASK_L, MASK_L);
    var fs = MASK_L * 0.76;
    g.font = fs + 'px Jua, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#000';
    var m = g.measureText(ch);
    var asc = m.actualBoundingBoxAscent || fs * 0.72;
    var desc = m.actualBoundingBoxDescent || fs * 0.12;
    var yy = (MASK_L - (asc + desc)) / 2 + asc;
    g.fillText(ch, MASK_L / 2, yy);

    var data = g.getImageData(0, 0, MASK_L, MASK_L).data;
    var mask = new Uint8Array(MASK_L * MASK_L);
    var count = 0;
    for (var i = 0; i < MASK_L * MASK_L; i++) {
      if (data[i * 4 + 3] > 105) { mask[i] = 1; count++; }
    }
    /* 시작점: 왼쪽 위에 가장 가까운 잉크 칸 (첫 획이 시작하는 자리) */
    var start = null;
    var bestScore = 1e9;
    for (var y = 0; y < MASK_L; y++) {
      for (var x = 0; x < MASK_L; x++) {
        if (!mask[y * MASK_L + x]) continue;
        var score = x + y * 1.35;
        if (score < bestScore) {
          bestScore = score;
          start = { x: (x + 0.5) / MASK_L, y: (y + 0.5) / MASK_L };
        }
      }
    }
    return { mask: mask, ink: count, start: start, L: MASK_L };
  }

  function buildPath(maskInfo) {
    var L = maskInfo.L;
    var cells = [];
    for (var y = 0; y < L; y += 2) {
      for (var x = (y % 4 === 0 ? 0 : 1); x < L; x += 2) {
        if (maskInfo.mask[y * L + x]) cells.push({ x: (x + 0.5) / L, y: (y + 0.5) / L });
      }
    }
    if (!cells.length) return [];
    var start = maskInfo.start || cells[0];
    var path = [];
    var pool = cells.slice();
    var cur = { x: start.x, y: start.y };
    var used = new Uint8Array(pool.length);
    for (var k = 0; k < pool.length; k++) {
      var best = -1, bestD = 1e9;
      for (var i = 0; i < pool.length; i++) {
        if (used[i]) continue;
        var dx = pool[i].x - cur.x, dy = pool[i].y - cur.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best === -1) break;
      used[best] = 1;
      cur = pool[best];
      path.push({ x: cur.x, y: cur.y });
    }
    return path;
  }

  function drawGuide(ctx, size, ch) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    /* 아주 옅은 십자 안내선 */
    ctx.strokeStyle = 'rgba(150, 186, 214, 0.35)';
    ctx.lineWidth = Math.max(1, size * 0.005);
    ctx.setLineDash([size * 0.02, size * 0.032]);
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.07);
    ctx.lineTo(size / 2, size * 0.93);
    ctx.moveTo(size * 0.07, size / 2);
    ctx.lineTo(size * 0.93, size / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    /* 따라 쓸 회색 글자 */
    var fs = size * 0.76;
    ctx.font = fs + 'px Jua, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var m = ctx.measureText(ch);
    var asc = m.actualBoundingBoxAscent || fs * 0.72;
    var desc = m.actualBoundingBoxDescent || fs * 0.12;
    var yy = (size - (asc + desc)) / 2 + asc;

    ctx.fillStyle = 'rgba(196, 219, 238, 0.55)';
    ctx.fillText(ch, size / 2, yy);

    ctx.lineWidth = Math.max(2, size * 0.012);
    ctx.strokeStyle = 'rgba(122, 166, 203, 0.85)';
    ctx.setLineDash([size * 0.035, size * 0.03]);
    ctx.strokeText(ch, size / 2, yy);
    ctx.setLineDash([]);
  }

  function placeStartDot(wrap, size) {
    var dot = document.getElementById('start-dot');
    if (!dot) return;
    if (!T || !T.mask || !T.mask.start) { dot.hidden = true; return; }
    dot.hidden = false;
    dot.style.left = (T.mask.start.x * size) + 'px';
    dot.style.top = (T.mask.start.y * size) + 'px';
  }

  /* 회색 글자를 지금 상태 그대로 다시 그린다 (글꼴이 늦게 왔을 때) */
  function redrawGuideNow() {
    if (!T || !T.char || !T.inkCanvas) return;
    var guide = main.querySelector('.guide-canvas');
    if (!guide) return;
    drawGuide(guide.getContext('2d'), T.inkCanvas.width, T.char);
    T.mask = buildMask(T.char);
    T.path = buildPath(T.mask);
    placeStartDot(document.getElementById('box-wrap'), T.cssSize);
    if (T.strokes && T.strokes.length) validate();
  }

  /* Jua 글꼴을 확실히 불러온 뒤 회색 글자를 다시 그린다 (못 불러오면 시스템 글꼴로 계속) */
  var guideFontTried = false;
  function ensureGuideFont() {
    if (guideFontTried || !document.fonts || !document.fonts.load) return;
    guideFontTried = true;
    try {
      document.fonts.load('40px Jua').then(redrawGuideNow, function () {});
    } catch (e) {}
  }

  function initSyllable() {
    if (!T) return;
    T.strokes = [];
    T.drawing = false;
    T.cov = 0;
    T.locked = false;

    var wrap = document.getElementById('box-wrap');
    var ink = main.querySelector('.ink-canvas');
    var guide = main.querySelector('.guide-canvas');
    if (!wrap || !ink || !guide) return;

    var size = boxSize();
    wrap.style.width = size + 'px';
    wrap.style.height = size + 'px';

    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    [ink, guide].forEach(function (c) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
      c.style.width = size + 'px';
      c.style.height = size + 'px';
    });

    T.char = T.chars[T.targets[T.ti]];
    T.cssSize = size;
    /* 한 글자는 한 가지 크레파스 색으로 쓴다 */
    T.color = (T.stageId * 3 + T.ti) % 6;
    T.inkCanvas = ink;
    T.inkCtx = ink.getContext('2d');
    T.mask = buildMask(T.char);
    T.path = buildPath(T.mask);

    drawGuide(guide.getContext('2d'), Math.round(size * dpr), T.char);
    placeStartDot(wrap, size);

    wrap.classList.remove('done');
    updateNameRow();
    updateDots();
    updateCoverageUI(0);
    setCoverLabel(0);
    ensureGuideFont();
  }

  function updateNameRow() {
    var row = document.getElementById('name-row');
    if (!row || !T) return;
    var doneCount = T.ti + (T.done[T.ti] ? 1 : 0);
    row.innerHTML = nameRowHTML(T.chars, T.targets, Math.min(doneCount, T.targets.length));
  }

  function updateDots() {
    var row = document.getElementById('dots-row');
    if (!row || !T) return;
    if (T.targets.length < 2) { row.hidden = true; row.innerHTML = ''; return; }
    row.hidden = false;
    row.innerHTML = T.targets.map(function (idx, i) {
      var cls = 'dot';
      if (T.done[i]) cls += ' done';
      else if (i === T.ti) cls += ' now';
      return '<span class="' + cls + '">' + T.chars[idx] + '</span>';
    }).join('<span class="dot-sep">›</span>');
  }

  function updateCoverageUI(cov) {
    var bar = document.getElementById('cover-bar');
    var need = (T && THRESH[T.stageId]) || 0.45;
    if (bar) bar.style.width = Math.min(100, Math.round(cov / need * 100)) + '%';
    var wrap = document.getElementById('box-wrap');
    if (wrap) {
      if (cov >= need * 0.55) wrap.classList.add('almost');
      else wrap.classList.remove('almost');
    }
  }

  function setCoverLabel(cov) {
    var el = document.getElementById('cover-label');
    if (!el || !T) return;
    var need = THRESH[T.stageId] || 0.45;
    if (cov >= need) el.textContent = '다 썼어요!';
    else if (cov > 0.02) el.textContent = '조금만 더 그어 볼까요?';
    else el.textContent = '손가락으로 회색 글자를 따라 그어요';
  }

  /* ---------------- 그리기 ---------------- */
  function normPoint(e) {
    var c = T && T.inkCanvas ? T.inkCanvas : e.currentTarget;
    var r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function beginStroke(p) {
    if (!T || T.locked) return;
    T.drawing = true;
    T.strokes.push({ color: (T.color || 0), pts: [p] });
    drawDot(p);
    Sound.tap();
  }

  function addPoint(p) {
    if (!T || !T.drawing) return;
    var st = T.strokes[T.strokes.length - 1];
    if (!st) return;
    var last = st.pts[st.pts.length - 1];
    var dx = p.x - last.x, dy = p.y - last.y;
    if (dx * dx + dy * dy < 0.0000035) return;
    st.pts.push(p);
    drawSegment(last, p, st.color);
  }

  function endStroke() {
    if (!T) return;
    T.drawing = false;
    scheduleValidate(40);
  }

  function onDown(e) {
    if (!T || T.locked) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { e.preventDefault(); } catch (err) {}
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    beginStroke(normPoint(e));
  }

  function onMove(e) {
    if (!T || !T.drawing || T.locked) return;
    try { e.preventDefault(); } catch (err) {}
    var list = [];
    try {
      list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    } catch (err) { list = []; }
    if (!list || !list.length) list = [e];
    for (var i = 0; i < list.length; i++) addPoint(normPoint(list[i]));
    scheduleValidate();
  }

  function onUp(e) {
    if (!T) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) {}
    endStroke();
  }

  function onLeave(e) {
    if (!T) return;
    if (T.drawing && e.pointerType === 'mouse' && e.buttons === 0) endStroke();
  }

  function drawSegment(a, b, colorIdx) {
    if (!T || !T.inkCtx) return;
    var ctx = T.inkCtx;
    var w = T.inkCanvas.width;
    var col = INK_COLORS[colorIdx % INK_COLORS.length];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col;
    ctx.lineWidth = w * 0.085;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * w);
    ctx.lineTo(b.x * w, b.y * w);
    ctx.stroke();
  }

  function drawDot(p) {
    if (!T || !T.inkCtx) return;
    var ctx = T.inkCtx;
    var w = T.inkCanvas.width;
    var st = T.strokes[T.strokes.length - 1];
    var col = INK_COLORS[(st ? st.color : 0) % INK_COLORS.length];
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * w, w * 0.0425, 0, Math.PI * 2);
    ctx.fill();
  }

  function redrawInk() {
    if (!T || !T.inkCtx) return;
    var ctx = T.inkCtx;
    var w = T.inkCanvas.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, w);
    T.strokes.forEach(function (st) {
      if (!st.pts.length) return;
      if (st.pts.length === 1) {
        ctx.fillStyle = INK_COLORS[st.color % INK_COLORS.length];
        ctx.beginPath();
        ctx.arc(st.pts[0].x * w, st.pts[0].y * w, w * 0.0425, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      for (var i = 1; i < st.pts.length; i++) drawSegment(st.pts[i - 1], st.pts[i], st.color);
    });
  }

  /* ---------------- 덮은 정도 계산 ---------------- */
  var DILATE = [];
  (function () {
    var R = 2;
    for (var dy = -R; dy <= R; dy++) {
      for (var dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy <= R * R + 1) DILATE.push([dx, dy]);
      }
    }
  })();

  var inkSampleCanvas = null;

  function computeCoverage() {
    if (!T || !T.mask || !T.inkCanvas) return 0;
    var L = MASK_L;
    if (!inkSampleCanvas) {
      inkSampleCanvas = document.createElement('canvas');
      inkSampleCanvas.width = L;
      inkSampleCanvas.height = L;
    }
    var g = inkSampleCanvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, L, L);
    g.drawImage(T.inkCanvas, 0, 0, L, L);
    var data = g.getImageData(0, 0, L, L).data;

    var hit = new Uint8Array(L * L);
    for (var i = 0; i < L * L; i++) {
      if (data[i * 4 + 3] > 28) hit[i] = 1;
    }
    var dil = new Uint8Array(L * L);
    for (var y = 0; y < L; y++) {
      for (var x = 0; x < L; x++) {
        if (!hit[y * L + x]) continue;
        for (var k = 0; k < DILATE.length; k++) {
          var ny = y + DILATE[k][1];
          var nx = x + DILATE[k][0];
          if (ny < 0 || ny >= L || nx < 0 || nx >= L) continue;
          dil[ny * L + nx] = 1;
        }
      }
    }
    var total = 0, covered = 0;
    for (var j = 0; j < L * L; j++) {
      if (T.mask.mask[j]) {
        total++;
        if (dil[j]) covered++;
      }
    }
    return total ? covered / total : 0;
  }

  var validateTimer = null;
  function scheduleValidate(delay) {
    if (validateTimer) clearTimeout(validateTimer);
    validateTimer = setTimeout(validate, delay || 110);
  }

  function validate() {
    if (!T || T.locked) return;
    var cov = computeCoverage();
    T.cov = cov;
    updateCoverageUI(cov);
    setCoverLabel(cov);
    var need = THRESH[T.stageId] || 0.45;
    if (cov >= need) completeSyllable();
  }

  /* ---------------- 글자 완성 ---------------- */
  function completeSyllable() {
    if (!T || T.locked) return;
    T.locked = true;
    T.done[T.ti] = true;
    var order = T.ti;
    updateNameRow();
    updateDots();
    updateCoverageUI(1);

    var wrap = document.getElementById('box-wrap');
    if (wrap) wrap.classList.add('done');
    var r = wrap ? wrap.getBoundingClientRect() : null;
    if (r) confetti(18, { x: r.left + r.width / 2, y: r.top + r.height * 0.42 });
    Sound.correct();

    var token = T.token;
    var last = (order >= T.targets.length - 1);
    if (!last) {
      Speech.speak(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
    }
    setTimeout(function () {
      if (!T || T.token !== token) return;
      T.ti = order + 1;
      if (T.ti >= T.targets.length) completeQuestion();
      else initSyllable();
    }, last ? 260 : 780);
  }

  /* ---------------- 문제 완성 → 포켓몬 잡기 ---------------- */
  function completeQuestion() {
    if (!T) return;
    var token = T.token;
    var pkm = T.pkm;
    var isNew = catchPokemon(T.q.id);
    var nextIndex = T.stageIndex + 1;

    showCatch(T.q.id, pkm, isNew, function () {
      if (!T || T.token !== token) return;
      if (nextIndex >= T.total) {
        finishStage();
      } else {
        stage.index = nextIndex;
        renderQuestion();
        refreshHud();
      }
    });
  }

  function showCatch(id, pkm, isNew, cb) {
    var old = document.getElementById('catch-overlay');
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.className = 'catch-overlay';
    ov.id = 'catch-overlay';
    ov.innerHTML =
      '<div class="catch-card">' +
      '<div class="catch-ball"><span class="pb-top"></span><span class="pb-band"></span><span class="pb-btn"></span></div>' +
      '<div class="catch-poke">' + pokeImg(id, 'catch-img') + '</div>' +
      '<div class="catch-name">' + pkm.name + '</div>' +
      '<div class="catch-tag">' + (isNew ? '도감에 담았어요!' : '또 만났네요!') + '</div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });

    Sound.pop();
    setTimeout(function () {
      var ball = ov.querySelector('.catch-ball');
      if (ball) ball.classList.add('gone');
      var poke = ov.querySelector('.catch-poke');
      if (poke) poke.classList.add('show');
      Sound.fanfare();
      confetti(26);
      Speech.speak(pkm.name + '! 잡았다!', { rate: 0.96 });
    }, 520);

    var closed = false;
    var finish = function () {
      if (closed) return;
      closed = true;
      ov.classList.remove('show');
      setTimeout(function () { ov.remove(); }, 180);
      if (typeof cb === 'function') cb();
    };
    ov.addEventListener('click', finish);
    setTimeout(finish, 2100);
  }

  /* ---------------- 단계 완료 ---------------- */
  function finishStage() {
    var s = stage.data;
    var penalty = stage.nudges + stage.clears;
    var stars = 3;
    if (penalty > 8) stars = 1;
    else if (penalty > 3) stars = 2;

    var prev = state.cleared[s.id] || 0;
    state.cleared[s.id] = Math.max(prev, stars);
    if (state.unlocked < s.id + 1) state.unlocked = Math.min(STAGES.length, s.id + 1);

    var rewardId = REWARDS[s.id];
    var gotReward = catchPokemon(rewardId);
    var bonusId = null;
    if (allCleared() && !isCaught(BONUS)) {
      catchPokemon(BONUS);
      bonusId = BONUS;
    }
    saveState();
    renderReward(s, stars, rewardId, gotReward, bonusId);
  }

  function renderReward(s, stars, rewardId, gotReward, bonusId) {
    view = 'reward';
    endTrace();
    setHud(null);
    var nextId = s.id + 1;
    var hasNext = nextId <= STAGES.length;
    var pkm = POKEMON[rewardId];
    var showBonus = s.id === STAGES.length && isCaught(BONUS);
    var title = gotReward ? '야호! ' + pkm.name + objParticle(pkm.name) + ' 잡았다!' : s.id + '단계 완료!';

    main.innerHTML =
      '<section class="screen reward-screen" style="--theme:' + s.theme + '">' +
      '<div class="reward-sparks"></div>' +
      '<div class="reward-stage">' +
      '<div class="pokeball" id="reward-ball"><span class="pb-top"></span><span class="pb-band"></span><span class="pb-btn"></span></div>' +
      '<div class="reward-poke" id="reward-poke">' + pokeImg(rewardId, 'reward-img') + '</div>' +
      (showBonus ? '<div class="reward-poke bonus" id="reward-bonus">' + pokeImg(BONUS, 'reward-img') + '</div>' : '') +
      '</div>' +
      '<h2 class="reward-title">' + title + '</h2>' +
      '<div class="reward-stars">' + starRow(stars) + '</div>' +
      '<div class="reward-sub">' + (showBonus
        ? '모든 단계를 깼어요! 전설의 포켓몬 <b>뮤</b>가 찾아왔어요 ✨'
        : s.id + '단계 · ' + s.title + ' 성공!') + '</div>' +
      '<div class="reward-btns">' +
      (hasNext
        ? '<button class="big-btn primary" data-act="next-stage" data-id="' + nextId + '">' + nextId + '단계 도전!</button>'
        : '<button class="big-btn primary" data-act="dex">📕 도감 보러 가기</button>') +
      '<button class="ghost-btn" data-act="map">모험 지도</button>' +
      '</div>' +
      '<div class="reward-dex">' + (gotReward ? '📕 ' + pkm.name + objParticle(pkm.name) + ' 도감에 담았어요' : '📕 도감: ' + state.caught.length + '마리') + '</div>' +
      '</section>';

    setTimeout(function () {
      var ball = document.getElementById('reward-ball');
      if (ball) ball.classList.add('opening');
      Sound.pop();
    }, 650);
    setTimeout(function () {
      var ball = document.getElementById('reward-ball');
      if (ball) ball.classList.add('gone');
      var poke = document.getElementById('reward-poke');
      if (poke) poke.classList.add('show');
      var bonus = document.getElementById('reward-bonus');
      if (bonus) bonus.classList.add('show');
      Sound.fanfare();
      confetti(40);
      Speech.speak((gotReward ? pkm.name + objParticle(pkm.name) + ' 잡았다! ' : '') + '대단해! 최고야!', { rate: 0.94 });
    }, 1000);
    setTimeout(function () { confetti(24, { x: window.innerWidth * 0.2, y: window.innerHeight * 0.35 }); }, 1500);
    setTimeout(function () { confetti(24, { x: window.innerWidth * 0.8, y: window.innerHeight * 0.35 }); }, 1900);
  }

  /* ---------------- 도감 ---------------- */
  function goDex() {
    view = 'dex';
    stage = null;
    endTrace();
    setHud('나의 포켓몬 도감');
    var html = '<section class="screen dex-screen">' +
      '<div class="dex-head">' +
      '<div class="dex-count"><b>' + state.caught.length + '</b> / ' + POKE_IDS.length + ' 마리</div>' +
      '<div class="dex-hint">잡은 포켓몬을 눌러 이름을 들어 보세요</div>' +
      '</div>' +
      '<div class="dex-grid">';
    POKE_IDS.forEach(function (id) {
      var got = isCaught(id);
      html += '<button class="dex-item' + (got ? ' got' : '') + '" data-act="dex-item" data-id="' + id + '" aria-label="' + (got ? POKEMON[id].name : '아직 못 만난 포켓몬') + '">' +
        '<span class="dex-img-wrap">' + pokeImg(id, 'dex-img') + '</span>' +
        '<span class="dex-name">' + (got ? POKEMON[id].name : '???') + '</span>' +
        '</button>';
    });
    html += '</div>' +
      '<div class="dex-btns">' +
      '<button class="ghost-btn" data-act="map">모험 지도</button>' +
      '<button class="ghost-btn" data-act="home">처음으로</button>' +
      '</div>' +
      '</section>';
    main.innerHTML = html;
  }

  /* ---------------- 보호자 메뉴 ---------------- */
  var resetArmed = false;
  function openParent() {
    resetArmed = false;
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'parent-modal';
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="보호자 메뉴">' +
      '<div class="modal-title">보호자 메뉴</div>' +
      '<div class="parent-stats">진행한 단계 <b>' + clearedCount() + ' / ' + STAGES.length + '</b> · 모은 별 <b>⭐' + totalStars() + '</b> · 잡은 포켓몬 <b>' + state.caught.length + '마리</b></div>' +
      '<button class="modal-btn" data-act="sound">' + (state.muted ? '🔇 소리 켜기' : '🔊 소리 끄기') + '</button>' +
      '<button class="modal-btn" data-act="unlock-all">🔓 전체 단계 열기</button>' +
      '<button class="modal-btn danger" data-act="reset-all">🧹 진행 기록 지우기</button>' +
      '<button class="modal-btn plain" data-act="close-parent">닫기</button>' +
      '<div class="modal-note">진행 상황은 이 기기(브라우저)에만 저장돼요.</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
  }
  function closeParent() {
    var overlay = document.getElementById('parent-modal');
    if (!overlay) return;
    overlay.classList.remove('show');
    setTimeout(function () { overlay.remove(); }, 200);
  }

  /* ---------------- 문제 음성 ---------------- */
  function speakQuestion() {
    if (!T) return;
    var target = T.char || T.chars[T.targets[0]];
    Speech.speak(T.pkm.name + '! ' + target + '를 따라 써 봐요', { rate: 0.86 });
  }

  function speakHint() {
    if (!T) return;
    var target = T.chars[T.targets[T.ti]];
    Speech.speak(T.pkm.name + ', ' + target, { rate: 0.82 });
  }

  /* ---------------- "다 썼어요!" ---------------- */
  function manualDone() {
    if (!T || T.locked) return;
    validate();
    if (T.locked) return;
    var cov = T.cov;
    var need = THRESH[T.stageId] || 0.45;
    if (cov >= need) { completeSyllable(); return; }
    if (cov >= MIN_MANUAL || stage.nudges >= 3) {
      completeSyllable();
      return;
    }
    /* 아직 거의 안 그렸을 때: 한 번 더 부드럽게 권한다 */
    stage.nudges += 1;
    Sound.nudge();
    var wrap = document.getElementById('box-wrap');
    if (wrap) {
      wrap.classList.remove('hint-flash');
      void wrap.offsetWidth;
      wrap.classList.add('hint-flash');
    }
    toast('회색 글자 위를 손가락으로 따라 그어 봐요 ✍️', 1600);
    Speech.speak('조금만 더 따라 그어 볼까?', { rate: 0.9 });
  }

  function clearInk() {
    if (!T || T.locked) return;
    stage.clears += 1;
    T.strokes = [];
    T.cov = 0;
    redrawInk();
    updateCoverageUI(0);
    setCoverLabel(0);
    var wrap = document.getElementById('box-wrap');
    if (wrap) wrap.classList.remove('almost');
    Sound.tap();
  }

  /* ---------------- 동작 처리 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    if (act !== 'answer' && act !== 'dex-item') Sound.tap();

    switch (act) {
      case 'start':
        goMap();
        break;
      case 'home':
        goHome();
        break;
      case 'map':
        goMap();
        break;
      case 'back':
        if (view === 'quiz') goMap();
        else goHome();
        break;
      case 'stage': {
        var id = Number(t.getAttribute('data-id'));
        if (t.getAttribute('data-locked') === '1') {
          Sound.nudge();
          toast('아직 잠겨 있어요! 🔒 앞 단계를 먼저 깨요');
          Speech.speak(id + '단계는 아직 잠겨 있어요');
        } else {
          startStage(id);
        }
        break;
      }
      case 'next-stage':
        startStage(Number(t.getAttribute('data-id')));
        break;
      case 'replay':
        if (view === 'quiz') speakHint();
        break;
      case 'done':
        manualDone();
        break;
      case 'clear':
        clearInk();
        break;
      case 'dex':
        goDex();
        break;
      case 'dex-item': {
        var pid = Number(t.getAttribute('data-id'));
        if (isCaught(pid)) {
          Sound.pop();
          t.classList.add('pulse');
          setTimeout(function () { t.classList.remove('pulse'); }, 600);
          Speech.speak(POKEMON[pid].name);
        } else {
          Sound.nudge();
          Speech.speak('아직 만나지 못했어요');
        }
        break;
      }
      case 'parent':
        openParent();
        break;
      case 'close-parent':
        closeParent();
        break;
      case 'sound': {
        state.muted = !state.muted;
        saveState();
        if (state.muted) Speech.stop();
        var sb = document.querySelector('.hud-btn[data-act="sound"]');
        if (sb) sb.textContent = state.muted ? '🔇' : '🔊';
        var mb = document.querySelector('.modal-btn[data-act="sound"]');
        if (mb) mb.textContent = state.muted ? '🔇 소리 켜기' : '🔊 소리 끄기';
        toast(state.muted ? '🔇 소리를 껐어요' : '🔊 소리를 켰어요');
        break;
      }
      case 'unlock-all': {
        state.unlocked = STAGES.length;
        saveState();
        closeParent();
        toast('🔓 모든 단계를 열었어요');
        if (view === 'map') goMap();
        break;
      }
      case 'reset-all': {
        if (!resetArmed) {
          resetArmed = true;
          t.textContent = '⚠️ 정말 지울까요? 한 번 더 누르면 지워져요';
          t.classList.add('armed');
        } else {
          var muted = state.muted;
          state = defaultState();
          state.muted = muted;
          saveState();
          resetArmed = false;
          closeParent();
          toast('🧹 진행 기록을 지웠어요');
          goHome();
        }
        break;
      }
    }
  });

  document.addEventListener('click', function (e) {
    var overlay = document.getElementById('parent-modal');
    if (overlay && e.target === overlay) closeParent();
  });

  /* 화면 크기가 바뀌면 칸 크기와 글자를 다시 맞춘다 */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!T) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!T) return;
      var size = boxSize();
      var wrap = document.getElementById('box-wrap');
      var ink = main.querySelector('.ink-canvas');
      var guide = main.querySelector('.guide-canvas');
      if (!wrap || !ink || !guide) return;
      wrap.style.width = size + 'px';
      wrap.style.height = size + 'px';
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      [ink, guide].forEach(function (c) {
        c.width = Math.round(size * dpr);
        c.height = Math.round(size * dpr);
        c.style.width = size + 'px';
        c.style.height = size + 'px';
      });
      drawGuide(guide.getContext('2d'), Math.round(size * dpr), T.char);
      placeStartDot(wrap, size);
      redrawInk();
    }, 220);
  });

  /* 폰트가 늦게 준비되면 회색 글자를 다시 그린다 */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(redrawGuideNow, function () {});
  }

  /* 테스트용 도우미 (#debug) */
  if (location.hash.indexOf('debug') !== -1) {
    window.__trace = {
      info: function () {
        if (!T) return null;
        var box = document.getElementById('box-wrap');
        var r = box ? box.getBoundingClientRect() : null;
        return {
          view: view,
          stage: stage ? stage.data.id : 0,
          q: stage ? stage.index : -1,
          total: T.total,
          char: T.char,
          ti: T.ti,
          targets: T.targets.length,
          cov: Number(T.cov.toFixed(3)),
          need: THRESH[T.stageId] || 0.45,
          strokes: T.strokes.length,
          locked: T.locked,
          caught: state.caught.length,
          box: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null
        };
      },
      points: function (n) {
        if (!T) return [];
        var box = document.getElementById('box-wrap');
        if (!box) return [];
        var r = box.getBoundingClientRect();
        var path = T.path || [];
        var step = Math.max(1, Math.floor(path.length / (n || 48)));
        var out = [];
        for (var i = 0; i < path.length; i += step) {
          out.push({ x: Math.round(r.left + path[i].x * r.width), y: Math.round(r.top + path[i].y * r.height) });
        }
        return out;
      },
      autoTrace: function (frac) {
        if (!T || T.locked) return false;
        var path = T.path || [];
        if (!path.length) return false;
        var stop = Math.max(2, Math.floor(path.length * (frac || 1)));
        beginStroke(path[0]);
        for (var i = 1; i < stop; i++) addPoint(path[i]);
        endStroke();
        return true;
      },
      tapDone: function () { manualDone(); },
      tapClear: function () { clearInk(); },
      goto: function (sid) { startStage(sid); }
    };
  }

  /* ---------------- 시작 ---------------- */
  loadState();
  Speech.init();
  goHome();
})();
