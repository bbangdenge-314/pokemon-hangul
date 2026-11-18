/* 포켓몬 한글 따라쓰기 - 메인 로직 (v3)
   - 글자를 다 쓰면 저절로 정답 처리 (손을 뗀 뒤 잠깐 기다렸다가 검사)
   - 정밀 인식: 글자 덮음 + 3x3 구역 검사 + 글자 밖 벗어남 검사
   - 6단계: 진한 가이드 → 흐린 가이드 → 백지 혼자 쓰기 */
(function () {
  'use strict';

  var D = window.POKE_DATA;
  var POKEMON = D.POKEMON;
  var STAGES = D.STAGES;
  var REWARDS = D.REWARDS;
  var BONUS = D.BONUS;
  var GEN_COLORS = D.GEN_COLORS;
  var artworkUrl = D.artworkUrl;
  var spriteUrl = D.spriteUrl;
  var genOf = D.genOf;
  var genLabel = D.genLabel;

  var KEY = 'pokemon-hangul-trace-v3';
  var main = document.getElementById('main');
  var hud = document.getElementById('hud');
  var confettiLayer = document.getElementById('confetti-layer');
  var toastEl = document.getElementById('toast');

  var POKE_IDS = Object.keys(POKEMON).map(Number).sort(function (a, b) { return a - b; });
  var PRAISE = ['좋았어!', '잘했어!', '최고야!', '멋져!', '딱 좋아!', '짝짝짝!'];
  var INK_COLORS = ['#ff6b9d', '#4dabf7', '#845ef7', '#f76707', '#20c997', '#e64980'];

  /* 정밀 인식 기준 (단계별) */
  var RECOG = {
    1: { cov: 0.70, zone: 0.50, off: 0.45, tol: 0.080 },
    2: { cov: 0.72, zone: 0.50, off: 0.45, tol: 0.080 },
    3: { cov: 0.72, zone: 0.52, off: 0.45, tol: 0.080 },
    4: { cov: 0.74, zone: 0.55, off: 0.44, tol: 0.078 },
    5: { cov: 0.66, zone: 0.50, off: 0.45, tol: 0.085 },
    6: { cov: 0.68, zone: 0.50, off: 0.45, tol: 0.085 }
  };
  var SETTLE_MS = 420;   /* 손을 뗀 뒤 이만큼 기다렸다가 검사 (다음 획을 그으면 취소) */
  var IDLE_MS = 2600;    /* 가만히 있으면 살짝 안내 */

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
      /* 예전 판에서 잡은 포켓몬 중 지금 도감에 없는 번호는 정리한다 */
      state.caught = state.caught.map(Number).filter(function (id) { return !!POKEMON[id]; });
      if (!state.cleared || typeof state.cleared !== 'object') state.cleared = {};
      state.unlocked = Math.min(STAGES.length, Math.max(1, Number(state.unlocked) || 1));
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
  function caughtCount() { return POKE_IDS.filter(isCaught).length; }
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
    tap: function () { this.tone(880, 0, 0.07, 'sine', 0.06); },
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
  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    toastEl.classList.remove('show');
    toastEl.hidden = true;
    toastEl.innerHTML = '';
  }
  function toast(html, ms) {
    toastEl.innerHTML = html;
    toastEl.hidden = false;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      setTimeout(function () { toastEl.hidden = true; }, 260);
    }, ms || 2000);
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

  function genBadge(id, extraCls) {
    return '<span class="gen-badge' + (extraCls ? ' ' + extraCls : '') + '" style="--gen:' +
      (GEN_COLORS[genOf(id)] || '#495057') + '">' + genLabel(id) + '</span>';
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
  var stage = null;   /* { data, index, hints, clears } */
  var T = null;       /* 따라쓰기 세션 */
  var tokenSeq = 0;
  var dexFilter = 0;

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
    cancelTimers();
    T = null;
    Speech.stop();
    var ov = document.getElementById('catch-overlay');
    if (ov) ov.remove();
  }

  /* ---------------- 홈 ---------------- */
  function goHome() {
    hideToast();
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
      '<div class="home-badge">1~9세대 · ' + POKE_IDS.length + '마리 · 5살</div>' +
      '<h1 class="home-title">포켓몬<br>한글 따라쓰기</h1>' +
      '<div class="home-hero">' +
      '<div class="hero-poke mini">' + pokeImg(906, 'hero-img') + '</div>' +
      '<div class="hero-poke big">' + pokeImg(25, 'hero-img') + '</div>' +
      '<div class="hero-poke mini">' + pokeImg(1008, 'hero-img') + '</div>' +
      '</div>' +
      '<p class="home-sub">포켓몬 이름을 손가락으로 써 봐요!</p>' +
      '<button class="big-btn primary" data-act="start">' + (started ? '계속 하기' : '시작하기') + '</button>' +
      '<div class="home-links">' +
      '<button class="ghost-btn" data-act="dex">📕 나의 도감 (' + caughtCount() + ')</button>' +
      '<button class="ghost-btn" data-act="parent">👨‍👩‍👧 보호자</button>' +
      '</div>' +
      '</div>' +
      '<div class="home-grass"></div>' +
      '</section>';
  }

  /* ---------------- 지도 ---------------- */
  function goMap() {
    hideToast();
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
    endTrace();
    if (id > state.unlocked) {
      Sound.nudge();
      toast('아직 잠겨 있어요! 앞 단계를 먼저 깨요 🔒');
      return;
    }
    hideToast();
    stage = { data: s, index: 0, hints: 0, clears: 0 };
    view = 'quiz';
    renderQuestion();
  }

  /* ---------------- 따라쓰기 화면 ---------------- */
  function traceTargets(q) {
    return q.trace.slice().sort(function (a, b) { return a - b; });
  }

  function isBlankStage() {
    return !!(stage && stage.data && stage.data.guide === 'blank');
  }

  function nameRowClass(n) {
    return n >= 5 ? ' len5' : (n === 4 ? ' len4' : (n === 3 ? ' len3' : ''));
  }

  function nameRowHTML(chars, targets, doneCount) {
    var blank = isBlankStage();
    return chars.map(function (ch, i) {
      var order = targets.indexOf(i);
      var cls = 'syl';
      var body = ch;
      if (order !== -1) {
        cls += ' target';
        if (order < doneCount) cls += ' done';
        else if (order === doneCount) cls += ' now';
        if (blank && !(order < doneCount)) { cls += ' blank'; body = '?'; }
      } else {
        cls += ' fixed';
      }
      if (order === doneCount) cls += ' current';
      return '<span class="' + cls + '">' + body + '</span>';
    }).join('');
  }

  function renderQuestion() {
    hideToast();
    var s = stage.data;
    var q = s.questions[stage.index];
    var pkm = POKEMON[q.id];
    var chars = pkm.name.split('');
    var targets = traceTargets(q);
    var total = s.questions.length;
    var blank = s.guide === 'blank';

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
      '<div class="name-row' + nameRowClass(chars.length) + '" id="name-row">' + nameRowHTML(chars, targets, 0) + '</div>' +
      '<div class="strip-hint" id="trace-hint">' + s.tip + '</div>' +
      '</div>' +
      '<button class="speaker-btn small" data-act="replay" aria-label="이름 듣기">🔊</button>' +
      '</div>' +
      '<div class="trace-main">' +
      '<div class="trace-tools">' +
      '<span class="check-msg" id="check-msg"></span>' +
      (blank ? '<button class="hint-btn" data-act="hint">💡 살짝 힌트</button>' : '') +
      '</div>' +
      '<div class="box-wrap' + (blank ? ' blank-box' : '') + '" id="box-wrap">' +
      '<div class="box-bg"></div>' +
      '<canvas class="guide-canvas" aria-hidden="true"></canvas>' +
      '<canvas class="hint-canvas" aria-hidden="true"></canvas>' +
      '<canvas class="ink-canvas" role="img" aria-label="따라 쓰기 칸"></canvas>' +
      '<div class="start-dot" id="start-dot" hidden></div>' +
      '<div class="zone-mark" id="zone-mark" aria-hidden="true"></div>' +
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
      guide: s.guide || 'strong',
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
      hintUsed: 0,
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
    /* 화면 위/아래에 늘 있는 것들의 높이를 빼고 남는 만큼만 칸으로 쓴다 */
    var chrome = 0;
    ['#hud', '.q-top', '.q-bar', '.poke-strip', '.trace-btns'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el && el.offsetHeight) chrome += el.offsetHeight;
    });
    var tools = main.querySelector('.trace-tools');
    var toolsH = tools && tools.offsetHeight ? tools.offsetHeight + 6 : 0;
    var byW = Math.min(window.innerWidth, 560) - 40;
    /* 간격·여백 + 덮은 정도 막대 + 안내 글자 */
    var byH = window.innerHeight - chrome - 62 - toolsH - 74;
    return Math.max(150, Math.round(Math.min(byW, byH, 400)));
  }

  /* ---------------- 글자 마스크 ---------------- */
  var MASK_L = 128;
  var maskCanvas = null;
  var inkSampleCanvas = null;

  function maskFont(px) {
    return px + 'px Jua, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  }

  function buildMask(ch) {
    if (!maskCanvas) {
      maskCanvas = document.createElement('canvas');
      maskCanvas.width = MASK_L;
      maskCanvas.height = MASK_L;
    }
    var g = maskCanvas.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, MASK_L, MASK_L);
    var fs = MASK_L * 0.76;
    g.font = maskFont(fs);
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
    var minX = MASK_L, maxX = -1, minY = MASK_L, maxY = -1;
    for (var y = 0; y < MASK_L; y++) {
      for (var x = 0; x < MASK_L; x++) {
        var i = y * MASK_L + x;
        if (data[i * 4 + 3] > 105) {
          mask[i] = 1;
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { minX = 0; maxX = MASK_L - 1; minY = 0; maxY = MASK_L - 1; }

    /* 시작점: 왼쪽 위에 가장 가까운 잉크 칸 (첫 획이 시작하는 자리) */
    var start = null;
    var bestScore = 1e9;
    for (var yy2 = minY; yy2 <= maxY; yy2++) {
      for (var xx2 = minX; xx2 <= maxX; xx2++) {
        if (!mask[yy2 * MASK_L + xx2]) continue;
        var score = (xx2 - minX) + (yy2 - minY) * 1.35;
        if (score < bestScore) {
          bestScore = score;
          start = { x: (xx2 + 0.5) / MASK_L, y: (yy2 + 0.5) / MASK_L };
        }
      }
    }
    return {
      mask: mask, ink: count, start: start, L: MASK_L,
      bbox: { minX: minX, maxX: maxX, minY: minY, maxY: maxY }
    };
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

  function glyphMetrics(ctx, size, ch) {
    var fs = size * 0.76;
    ctx.font = maskFont(fs);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var m = ctx.measureText(ch);
    var asc = m.actualBoundingBoxAscent || fs * 0.72;
    var desc = m.actualBoundingBoxDescent || fs * 0.12;
    var yy = (size - (asc + desc)) / 2 + asc;
    return { fs: fs, y: yy };
  }

  function drawGuide(ctx, size, ch, mode) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (mode === 'blank') return;

    /* 아주 옅은 십자 안내선 */
    ctx.strokeStyle = 'rgba(150, 186, 214, 0.30)';
    ctx.lineWidth = Math.max(1, size * 0.005);
    ctx.setLineDash([size * 0.02, size * 0.032]);
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.07);
    ctx.lineTo(size / 2, size * 0.93);
    ctx.moveTo(size * 0.07, size / 2);
    ctx.lineTo(size * 0.93, size / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    var met = glyphMetrics(ctx, size, ch);
    if (mode === 'faint') {
      ctx.fillStyle = 'rgba(186, 212, 232, 0.26)';
      ctx.fillText(ch, size / 2, met.y);
      ctx.lineWidth = Math.max(1.5, size * 0.008);
      ctx.strokeStyle = 'rgba(140, 180, 214, 0.40)';
      ctx.setLineDash([size * 0.014, size * 0.030]);
      ctx.strokeText(ch, size / 2, met.y);
      ctx.setLineDash([]);
      return;
    }

    /* strong: 진한 회색 글자 */
    ctx.fillStyle = 'rgba(178, 204, 228, 0.62)';
    ctx.fillText(ch, size / 2, met.y);
    ctx.lineWidth = Math.max(2, size * 0.012);
    ctx.strokeStyle = 'rgba(108, 155, 196, 0.90)';
    ctx.setLineDash([size * 0.030, size * 0.026]);
    ctx.strokeText(ch, size / 2, met.y);
    ctx.setLineDash([]);
  }

  function drawHint(ctx, size, ch) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (!ch) return;
    var met = glyphMetrics(ctx, size, ch);
    ctx.fillStyle = 'rgba(255, 176, 32, 0.30)';
    ctx.fillText(ch, size / 2, met.y);
    ctx.lineWidth = Math.max(2, size * 0.010);
    ctx.strokeStyle = 'rgba(226, 140, 0, 0.75)';
    ctx.setLineDash([size * 0.022, size * 0.022]);
    ctx.strokeText(ch, size / 2, met.y);
    ctx.setLineDash([]);
  }

  function placeStartDot(size) {
    var dot = document.getElementById('start-dot');
    if (!dot) return;
    if (!T || !T.mask || !T.mask.start || T.guide !== 'strong') { dot.hidden = true; return; }
    dot.hidden = false;
    dot.style.left = (T.mask.start.x * size) + 'px';
    dot.style.top = (T.mask.start.y * size) + 'px';
  }

  /* 글자 마스크·가이드를 지금 상태 그대로 다시 그린다 (글꼴이 늦게 왔을 때, 크기 변경 때) */
  function redrawGuideNow() {
    if (!T || !T.char || !T.inkCanvas) return;
    var guide = main.querySelector('.guide-canvas');
    if (!guide) return;
    var size = T.inkCanvas.width;
    drawGuide(guide.getContext('2d'), size, T.char, T.guide);
    var hint = main.querySelector('.hint-canvas');
    if (hint && hint.dataset.on === '1') drawHint(hint.getContext('2d'), size, T.char);
    T.mask = buildMask(T.char);
    T.path = buildPath(T.mask);
    placeStartDot(document.getElementById('box-wrap'), T.cssSize);
    if (T.strokes && T.strokes.length) refreshBar();
  }

  /* Jua 글꼴을 확실히 불러온 뒤 가이드를 다시 그린다 (못 불러오면 시스템 글꼴로 계속) */
  var guideFontTried = false;
  function ensureGuideFont() {
    if (guideFontTried || !document.fonts || !document.fonts.load) return;
    guideFontTried = true;
    try {
      document.fonts.load('40px Jua').then(function () {
        redrawGuideNow();
        /* 글꼴이 늦게 준비되면 마스크가 바뀌므로 검사 기준도 다시 잡는다 */
      }, function () {});
    } catch (e) {}
  }

  function initSyllable() {
    if (!T) return;
    cancelTimers();
    T.strokes = [];
    T.drawing = false;
    T.cov = 0;
    T.locked = false;
    T.hintUsed = 0;

    var wrap = document.getElementById('box-wrap');
    var ink = main.querySelector('.ink-canvas');
    var guide = main.querySelector('.guide-canvas');
    var hint = main.querySelector('.hint-canvas');
    if (!wrap || !ink || !guide) return;

    var size = boxSize();
    wrap.style.width = size + 'px';
    wrap.style.height = size + 'px';

    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    [ink, guide].concat(hint ? [hint] : []).forEach(function (c) {
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

    drawGuide(guide.getContext('2d'), Math.round(size * dpr), T.char, T.guide);
    if (hint) {
      hint.dataset.on = '0';
      hint.classList.remove('show');
      hint.getContext('2d').clearRect(0, 0, hint.width, hint.height);
    }
    placeStartDot(size);

    wrap.classList.remove('done');
    wrap.classList.toggle('blank-box', T.guide === 'blank');
    clearZoneMarks();
    setCheckMsg('');
    updateNameRow();
    updateBar(null);
    setCoverLabel(0);
    ensureGuideFont();
  }

  function updateNameRow() {
    var row = document.getElementById('name-row');
    if (!row || !T) return;
    var doneCount = T.ti + (T.done[T.ti] ? 1 : 0);
    row.innerHTML = nameRowHTML(T.chars, T.targets, Math.min(doneCount, T.targets.length));
  }

  /* 덮음·구역·벗어남을 모두 반영한 진행 정도 (0~1) */
  function progressOf(a) {
    if (!a) return 0;
    var p = a.need ? a.cov / a.need : 0;
    if (a.activeZones && a.zoneNeed) p = Math.min(p, a.zoneMin / a.zoneNeed);
    if (a.offMax < 1) p = Math.min(p, (1 - a.offRatio) / (1 - a.offMax));
    return Math.max(0, Math.min(1, p));
  }

  function updateBar(a) {
    var bar = document.getElementById('cover-bar');
    var p = progressOf(a);
    if (bar) bar.style.width = Math.round(p * 100) + '%';
    var wrap = document.getElementById('box-wrap');
    if (wrap) {
      if (p >= 0.82) wrap.classList.add('almost');
      else wrap.classList.remove('almost');
    }
    T.progress = p;
  }

  function setCoverLabel(cov) {
    var el = document.getElementById('cover-label');
    if (!el || !T) return;
    var cfg = RECOG[T.stageId] || RECOG[1];
    el.classList.remove('warn');
    if (T.progress >= 0.99) el.textContent = '거의 다 됐어요!';
    else if (cov > 0.02) el.textContent = '조금만 더 써 볼까요?';
    else if (T.guide === 'blank') el.textContent = '그림을 떠올리며 혼자 써 보세요';
    else if (T.guide === 'faint') el.textContent = '흐린 글자를 잘 보고 따라 그어요';
    else el.textContent = '손가락으로 회색 글자를 따라 그어요';
  }

  function setCheckMsg(text, warn) {
    var el = document.getElementById('check-msg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('warn', !!warn);
  }

  /* ---------------- 그리기 ---------------- */
  function normPoint(e) {
    var c = T && T.inkCanvas ? T.inkCanvas : e.currentTarget;
    var r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function beginStroke(p) {
    if (!T || T.locked) return;
    cancelTimers();
    clearZoneMarks();
    setCheckMsg('');
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
    scheduleSettle();
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
    /* 획을 긋는 중에는 절대 채점하지 않는다 — 손을 뗀 뒤에만 검사 */
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

  /* ---------------- 정밀 인식 ---------------- */
  /* 잉크/글자 사이 거리 지도 (BFS, 4방향) */
  function distanceField(set, cap) {
    var L = MASK_L;
    var dist = new Uint8Array(L * L);
    dist.fill(255);
    var q = new Int32Array(L * L);
    var head = 0, tail = 0;
    for (var i = 0; i < L * L; i++) {
      if (set[i]) { dist[i] = 0; q[tail++] = i; }
    }
    while (head < tail) {
      var cur = q[head++];
      var d = dist[cur];
      if (d >= cap) continue;
      var x = cur % L;
      var y = (cur - x) / L;
      var nd = d + 1;
      if (x > 0 && dist[cur - 1] > nd) { dist[cur - 1] = nd; q[tail++] = cur - 1; }
      if (x < L - 1 && dist[cur + 1] > nd) { dist[cur + 1] = nd; q[tail++] = cur + 1; }
      if (y > 0 && dist[cur - L] > nd) { dist[cur - L] = nd; q[tail++] = cur - L; }
      if (y < L - 1 && dist[cur + L] > nd) { dist[cur + L] = nd; q[tail++] = cur + L; }
    }
    return dist;
  }

  function sampleInk() {
    var L = MASK_L;
    if (!inkSampleCanvas) {
      inkSampleCanvas = document.createElement('canvas');
      inkSampleCanvas.width = L;
      inkSampleCanvas.height = L;
    }
    var g = inkSampleCanvas.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, L, L);
    if (T && T.inkCanvas) g.drawImage(T.inkCanvas, 0, 0, L, L);
    var data = g.getImageData(0, 0, L, L).data;
    var ink = new Uint8Array(L * L);
    var count = 0;
    for (var i = 0; i < L * L; i++) {
      if (data[i * 4 + 3] > 28) { ink[i] = 1; count++; }
    }
    return { ink: ink, count: count };
  }

  /*
    정밀 채점: 세 가지를 함께 본다.
    1) 글자 덮음(coverage) — 가이드 글자 잉크를 잉크가 충분히 덮었는가 (좁은 허용 폭)
    2) 구역 검사(zone) — 글자 상자를 3x3으로 나눠, 잉크가 있는 구역은 모두 채웠는가
       (받침·모음을 통째로 빠뜨리면 여기서 걸린다)
    3) 글자 밖 벗어남(off) — 잉크가 글자 허용 범위 밖에 얼마나 많은가 (마구 낙서 걸러내기)
  */
  function analyze() {
    if (!T || !T.mask) return null;
    var L = MASK_L;
    var cfg = RECOG[T.stageId] || RECOG[1];
    var rCov = Math.max(4, Math.round(L * cfg.tol));
    var img = sampleInk();
    var inkCount = img.count;
    var dInk = distanceField(img.ink, rCov);
    var dGlyph = distanceField(T.mask.mask, rCov);

    var glyph = T.mask.mask;
    var bbox = T.mask.bbox;
    var gw = bbox.maxX - bbox.minX + 1;
    var gh = bbox.maxY - bbox.minY + 1;
    var zones = [];
    for (var z = 0; z < 9; z++) zones.push({ g: 0, c: 0 });

    var total = 0, covered = 0;
    for (var y = bbox.minY; y <= bbox.maxY; y++) {
      for (var x = bbox.minX; x <= bbox.maxX; x++) {
        var i = y * L + x;
        if (!glyph[i]) continue;
        total++;
        var hit = dInk[i] <= rCov;
        if (hit) covered++;
        var cx = Math.min(2, Math.floor((x - bbox.minX) * 3 / gw));
        var cy = Math.min(2, Math.floor((y - bbox.minY) * 3 / gh));
        var zi = cy * 3 + cx;
        zones[zi].g++;
        if (hit) zones[zi].c++;
      }
    }

    var zoneMin = 1, worst = null, active = 0;
    var missingZones = [];
    for (var k = 0; k < 9; k++) {
      var zz = zones[k];
      if (!zz.g) continue;
      var share = total ? zz.g / total : 0;
      if (share < 0.04 || zz.g < 3) continue;
      active++;
      var zcov = zz.c / zz.g;
      var need = share >= 0.10 ? cfg.zone : Math.max(0.34, cfg.zone - 0.16);
      zz.cov = zcov;
      zz.need = need;
      zz.share = share;
      if (!worst || zcov - need < worst.cov - worst.need) {
        worst = { cov: zcov, need: need, col: k % 3, row: Math.floor(k / 3) };
      }
      if (zcov < need) missingZones.push({ k: k, cov: zcov, need: need, col: k % 3, row: Math.floor(k / 3) });
      if (zcov < zoneMin) zoneMin = zcov;
    }

    var off = 0;
    if (inkCount) {
      for (var j = 0; j < L * L; j++) {
        if (img.ink[j] && dGlyph[j] > rCov) off++;
      }
    }

    var cov = total ? covered / total : 0;
    var offRatio = inkCount ? off / inkCount : 0;
    var reasons = [];
    if (inkCount < 8 || cov < cfg.cov) reasons.push('coverage');
    if (active && zoneMin < cfg.zone) reasons.push('zone');
    if (offRatio > cfg.off) reasons.push('off');
    var ok = reasons.length === 0;

    return {
      cov: cov, zoneMin: zoneMin, zoneNeed: cfg.zone, activeZones: active,
      offRatio: offRatio, inkCount: inkCount, covered: covered, total: total,
      need: cfg.cov, offMax: cfg.off, ok: ok, reasons: reasons, worst: worst,
      missingZones: missingZones, zones: zones
    };
  }

  /* ---------------- 채점 시점 ---------------- */
  var settleTimer = null, idleTimer = null;

  function cancelTimers() {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  /* 손을 뗀 뒤 잠깐 기다렸다가 검사한다. 다음 획을 그으면 검사는 취소된다. */
  function scheduleSettle() {
    if (!T || T.locked) return;
    cancelTimers();
    var token = T.token, ti = T.ti;
    settleTimer = setTimeout(function () {
      settleTimer = null;
      if (!T || T.token !== token || T.ti !== ti || T.locked) return;
      evaluate(true);
    }, SETTLE_MS);
  }

  function refreshBar() {
    if (!T || T.locked) return;
    var a = analyze();
    if (!a) return;
    T.cov = a.cov;
    updateBar(a);
    setCoverLabel(a.cov);
  }

  /* auto=true: 저절로 하는 검사 (조용히), auto=false: '다 썼어요!' 버튼 검사 (안내 포함) */
  function evaluate(auto) {
    if (!T || T.locked) return null;
    var a = analyze();
    if (!a) return null;
    T.cov = a.cov;
    updateBar(a);
    setCoverLabel(a.cov);

    if (a.ok) {
      completeSyllable();
      return a;
    }

    if (auto) {
      /* 아직 다 안 썼다 — 그림은 지우지 않고 가만히 둔다 */
      if (idleTimer) clearTimeout(idleTimer);
      var token = T.token, ti = T.ti;
      idleTimer = setTimeout(function () {
        idleTimer = null;
        if (!T || T.token !== token || T.ti !== ti || T.locked) return;
        if (!T.strokes.length) return;
        var b = analyze();
        if (b && b.ok) { completeSyllable(); return; }
        setCheckMsg(zoneHint(b), false);
        markZones(b);
      }, IDLE_MS);
      return a;
    }

    /* 버튼으로 확인했는데 아직 부족 → 다정하게 알려 주고 그림은 그대로 둔다 */
    if (a.reasons.indexOf('off') !== -1) {
      setCheckMsg('글자 밖으로 많이 벗어났어요! 모양에 맞춰 다시 써 볼까요?', true);
      toast('글자 밖으로 많이 벗어났어요! 모양을 보고 다시 써 볼까요?', 2300);
      Sound.nudge();
      Speech.speak('글자 밖으로 많이 벗어났어요. 모양에 맞춰 다시 써 볼까요?', { rate: 0.9 });
    } else {
      var msg = zoneHint(a);
      setCheckMsg(msg, true);
      toast(msg, 2400);
      Sound.nudge();
      Speech.speak(msg, { rate: 0.9 });
    }
    markZones(a);
    return a;
  }

  function zoneHint(a) {
    if (!a) return '아직 다 쓰지 않았어요! 글자를 끝까지 써 볼까요?';
    if (a.inkCount < a.total * 0.22) {
      return '아직 다 쓰지 않았어요! 글자를 끝까지 써 볼까요?';
    }
    var w = a.worst;
    if (a.reasons.indexOf('zone') !== -1 && w) {
      if ((a.missingZones || []).length >= 3) {
        return '아직 안 쓴 부분이 있어요! 노란 표시를 보고 채워 볼까요?';
      }
      var colName = (w.col === 2 ? '오른쪽' : (w.col === 0 ? '왼쪽' : '가운데'));
      var rowName = (w.row === 2 ? '아래' : (w.row === 0 ? '위' : ''));
      var where = (colName + ' ' + rowName).trim();
      return '아직 ' + where + ' 부분이 비었어요! 그 부분도 써 볼까요?';
    }
    return '아직 다 쓰지 않았어요! 글자를 끝까지 써 볼까요?';
  }

  function markZones(a) {
    var wrap = document.getElementById('zone-mark');
    if (!wrap || !T || !T.mask) return;
    wrap.innerHTML = '';
    if (!a || a.ok) return;
    var bbox = T.mask.bbox;
    var L = MASK_L;
    var gw = bbox.maxX - bbox.minX + 1;
    var gh = bbox.maxY - bbox.minY + 1;
    var list = [];
    if (a.reasons.indexOf('zone') !== -1) {
      for (var k = 0; k < 9; k++) {
        var z = a.zones[k];
        if (!z.g || z.share === undefined) continue;
        if (z.cov >= z.need) continue;
        list.push(k);
      }
    }
    list.slice(0, 4).forEach(function (k) {
      var col = k % 3, row = Math.floor(k / 3);
      var el = document.createElement('i');
      el.style.left = ((bbox.minX + gw * col / 3) / L * 100) + '%';
      el.style.top = ((bbox.minY + gh * row / 3) / L * 100) + '%';
      el.style.width = (gw / 3 / L * 100) + '%';
      el.style.height = (gh / 3 / L * 100) + '%';
      wrap.appendChild(el);
    });
    wrap.classList.add('show');
    setTimeout(function () { clearZoneMarks(); }, 2600);
  }

  function clearZoneMarks() {
    var wrap = document.getElementById('zone-mark');
    if (!wrap) return;
    wrap.classList.remove('show');
    wrap.innerHTML = '';
  }

  /* ---------------- 글자 완성 ---------------- */
  function completeSyllable() {
    if (!T || T.locked) return;
    T.locked = true;
    cancelTimers();
    T.done[T.ti] = true;
    var order = T.ti;
    updateNameRow();

    var wrap = document.getElementById('box-wrap');
    if (wrap) wrap.classList.add('done');
    var r = wrap ? wrap.getBoundingClientRect() : null;
    if (r) confetti(18, { x: r.left + r.width / 2, y: r.top + r.height * 0.42 });
    Sound.correct();
    T.progress = 1;
    setCoverLabel(1);
    setCheckMsg('');

    var token = T.token;
    var last = (order >= T.targets.length - 1);
    if (!last) Speech.speak(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
    setTimeout(function () {
      if (!T || T.token !== token) return;
      T.ti = order + 1;
      if (T.ti >= T.targets.length) completeQuestion();
      else initSyllable();
    }, last ? 260 : 760);
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
      genBadge(id) +
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
    var penalty = stage.hints * 2 + stage.clears;
    var stars = 3;
    if (penalty > 6) stars = 1;
    else if (penalty > 2) stars = 2;

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
        : s.id + '단계 · ' + s.title + ' 성공!' + genBadge(rewardId, 'soft')) + '</div>' +
      '<div class="reward-btns">' +
      (hasNext
        ? '<button class="big-btn primary" data-act="next-stage" data-id="' + nextId + '">' + nextId + '단계 도전!</button>'
        : '<button class="big-btn primary" data-act="dex">📕 도감 보러 가기</button>') +
      '<button class="ghost-btn" data-act="map">모험 지도</button>' +
      '</div>' +
      '<div class="reward-dex">' + (gotReward ? '📕 ' + pkm.name + objParticle(pkm.name) + ' 도감에 담았어요' : '📕 도감: ' + caughtCount() + '마리') + '</div>' +
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
    var gens = [];
    POKE_IDS.forEach(function (id) {
      var g = genOf(id);
      if (gens.indexOf(g) === -1) gens.push(g);
    });
    gens.sort(function (a, b) { return a - b; });
    var shown = POKE_IDS.filter(function (id) { return !dexFilter || genOf(id) === dexFilter; });
    var caughtInShown = shown.filter(isCaught).length;

    var html = '<section class="screen dex-screen">' +
      '<div class="dex-head">' +
      '<div class="dex-count"><b>' + caughtCount() + '</b> / ' + POKE_IDS.length + ' 마리</div>' +
      '<div class="dex-hint">1세대부터 9세대까지! 잡은 포켓몬을 누르면 이름을 들려줘요</div>' +
      '</div>' +
      '<div class="dex-filter">' +
      '<button class="gen-chip' + (!dexFilter ? ' on' : '') + '" data-act="dex-filter" data-gen="0">전체</button>' +
      gens.map(function (g) {
        return '<button class="gen-chip' + (dexFilter === g ? ' on' : '') + '" data-act="dex-filter" data-gen="' + g + '" style="--gen:' + (GEN_COLORS[g] || '#495057') + '">' + g + '세대</button>';
      }).join('') +
      '</div>' +
      (dexFilter ? '<div class="dex-filter-note">' + dexFilter + '세대 · ' + caughtInShown + ' / ' + shown.length + ' 마리</div>' : '') +
      '<div class="dex-grid">';
    shown.forEach(function (id) {
      var got = isCaught(id);
      html += '<button class="dex-item' + (got ? ' got' : '') + '" data-act="dex-item" data-id="' + id + '" aria-label="' + (got ? POKEMON[id].name + ' ' + genLabel(id) : '아직 못 만난 포켓몬') + '">' +
        '<span class="dex-img-wrap">' + pokeImg(id, 'dex-img') + genBadge(id, 'corner') + '</span>' +
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
      '<div class="parent-stats">진행한 단계 <b>' + clearedCount() + ' / ' + STAGES.length + '</b> · 모은 별 <b>⭐' + totalStars() + '</b> · 잡은 포켓몬 <b>' + caughtCount() + '마리</b></div>' +
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
    if (T.guide === 'blank') {
      Speech.speak(T.pkm.name + '! 혼자서 써 볼까요?', { rate: 0.86 });
    } else {
      Speech.speak(T.pkm.name + '! ' + target + '를 따라 써 봐요', { rate: 0.86 });
    }
  }

  function speakHint() {
    if (!T) return;
    var target = T.chars[T.targets[T.ti]];
    Speech.speak(T.pkm.name + ', ' + target, { rate: 0.82 });
  }

  /* ---------------- 버튼 동작 ---------------- */
  function manualDone() {
    if (!T || T.locked) return;
    cancelTimers();
    evaluate(false);
  }

  function clearInk() {
    if (!T || T.locked) return;
    cancelTimers();
    stage.clears += 1;
    T.strokes = [];
    T.cov = 0;
    T.progress = 0;
    redrawInk();
    updateBar(null);
    setCoverLabel(0);
    setCheckMsg('');
    clearZoneMarks();
    var wrap = document.getElementById('box-wrap');
    if (wrap) wrap.classList.remove('almost');
    Sound.tap();
  }

  function useHint() {
    if (!T || T.locked) return;
    if (T.guide !== 'blank') {
      toast('이 단계는 회색 글자를 보고 따라 쓰면 돼요', 1600);
      return;
    }
    var hint = main.querySelector('.hint-canvas');
    if (!hint) return;
    stage.hints += 1;
    T.hintUsed = 1;
    drawHint(hint.getContext('2d'), hint.width, T.char);
    hint.dataset.on = '1';
    hint.classList.add('show');
    Sound.pop();
    speakHint();
    if (T.hintTimer) clearTimeout(T.hintTimer);
    T.hintTimer = setTimeout(function () {
      if (!hint) return;
      hint.classList.remove('show');
      hint.dataset.on = '0';
      setTimeout(function () { hint.getContext('2d').clearRect(0, 0, hint.width, hint.height); }, 400);
    }, 4200);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    if (act !== 'answer' && act !== 'dex-item' && act !== 'dex-filter') Sound.tap();

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
      case 'hint':
        useHint();
        break;
      case 'dex':
        goDex();
        break;
      case 'dex-filter': {
        dexFilter = Number(t.getAttribute('data-gen')) || 0;
        goDex();
        break;
      }
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
      var hint = main.querySelector('.hint-canvas');
      if (!wrap || !ink || !guide) return;
      wrap.style.width = size + 'px';
      wrap.style.height = size + 'px';
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      [ink, guide].concat(hint ? [hint] : []).forEach(function (c) {
        c.width = Math.round(size * dpr);
        c.height = Math.round(size * dpr);
        c.style.width = size + 'px';
        c.style.height = size + 'px';
      });
      drawGuide(guide.getContext('2d'), Math.round(size * dpr), T.char, T.guide);
      if (hint && hint.dataset.on === '1') drawHint(hint.getContext('2d'), hint.width, T.char);
      placeStartDot(size);
      /* 크기가 바뀌면 잉크 좌표계가 달라지므로 그림을 같은 비율로 다시 그린다 */
      redrawInk();
      refreshBar();
    }, 220);
  });

  /* 폰트가 늦게 준비되면 가이드를 다시 그린다 */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { redrawGuideNow(); }, function () {});
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
          guide: T.guide,
          targets: T.targets.length,
          cov: Number(T.cov.toFixed(3)),
          need: (RECOG[T.stageId] || RECOG[1]).cov,
          strokes: T.strokes.length,
          locked: T.locked,
          hints: stage ? stage.hints : 0,
          clears: stage ? stage.clears : 0,
          caught: state.caught.length,
          box: r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null
        };
      },
      analyze: analyze,
      path: function () {
        if (!T) return [];
        return (T.path || []).map(function (p) { return { x: p.x, y: p.y }; });
      },
      traceNorm: function (points) {
        if (!T || T.locked || !points || points.length < 1) return false;
        beginStroke({ x: points[0].x, y: points[0].y });
        for (var i = 1; i < points.length; i++) addPoint({ x: points[i].x, y: points[i].y });
        endStroke();
        return true;
      },
      autoTrace: function (frac, filter) {
        var path = this.path();
        if (!path.length) return false;
        var stop = Math.max(2, Math.floor(path.length * (frac || 1)));
        var pts = path.slice(0, stop).filter(function (p) {
          if (!filter) return true;
          if (filter.maxX !== undefined && p.x > filter.maxX) return false;
          if (filter.minX !== undefined && p.x < filter.minX) return false;
          if (filter.maxY !== undefined && p.y > filter.maxY) return false;
          if (filter.minY !== undefined && p.y < filter.minY) return false;
          return true;
        });
        if (pts.length < 2) return false;
        return this.traceNorm(pts);
      },
      tapDone: function () { manualDone(); },
      tapClear: function () { clearInk(); },
      tapHint: function () { useHint(); },
      goto: function (sid) { startStage(sid); },
      unlockAll: function () { state.unlocked = STAGES.length; saveState(); },
      need: function () { return (T && (RECOG[T.stageId] || RECOG[1])) || null; },
      recog: RECOG
    };
  }

  /* ---------------- 시작 ---------------- */
  loadState();
  Speech.init();
  goHome();
})();
