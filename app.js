/* 포켓몬 한글 따라쓰기 - 메인 로직 (v4)
   - 전국도감 1~1025 (1~9세대) 전체
   - 글자를 다 쓰면 저절로 정답 처리 (손을 뗀 뒤 잠깐 기다렸다가 검사)
   - 정밀 인식: 글자 덮음 + 3x3 구역 검사 + 글자 밖 벗어남 검사
   - 6단계: 진한 가이드 → 흐린 가이드 → 백지 혼자 쓰기
   - 포획할 때 포켓몬 울음소리 재생 (실패하면 한국어 목소리로 대신) */
(function () {
  'use strict';

  var D = window.POKE_DATA;
  var POKEMON = D.POKEMON;
  var STAGES = D.STAGES;
  var REWARDS = D.REWARDS;
  var BONUS = D.BONUS;
  var GEN_COLORS = D.GEN_COLORS;
  var GEN_NAMES = D.GEN_NAMES;
  var artworkUrl = D.artworkUrl;
  var spriteUrl = D.spriteUrl;
  var cryUrl = D.cryUrl;
  var cryAltUrl = D.cryAltUrl;
  var genOf = D.genOf;
  var genLabel = D.genLabel;
  var typeColor = D.typeColor;
  var makeQuestions = D.makeQuestions;
  var stagePool = D.stagePool;

  var KEY = 'pokemon-hangul-v4';
  /* 저장 형식 번호. 5부터: 예전 판에서 도감 세대 칩 때문에 한 세대로 고정된 기록은 한 번 전체로 되돌린다 */
  var STATE_VER = 5;
  var OLD_KEYS = ['pokemon-hangul-trace-v3'];
  var main = document.getElementById('main');
  var hud = document.getElementById('hud');
  var confettiLayer = document.getElementById('confetti-layer');
  var toastEl = document.getElementById('toast');

  var POKE_IDS = D.POKE_IDS;
  var PRAISE = ['좋았어!', '잘했어!', '최고야!', '멋져!', '딱 좋아!', '짝짝짝!'];
  var INK_COLORS = ['#ff7ba9', '#4db8ff', '#a98bff', '#ffa94d', '#37c9a3', '#ff6b6b'];

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
    return { unlocked: 1, cleared: {}, caught: [], muted: false, gen: 0, ver: STATE_VER };
  }
  var state = defaultState();

  function validId(id) { return !!POKEMON[Number(id)]; }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (!raw) {
      /* v3 기록이 있으면 잡은 포켓몬·별·잠금 해제를 이어받는다 */
      for (var i = 0; i < OLD_KEYS.length && !raw; i++) {
        try { raw = localStorage.getItem(OLD_KEYS[i]); } catch (e) { raw = null; }
      }
    }
    if (!raw) return;
    var migrated = false;
    try {
      var s = JSON.parse(raw);
      migrated = !localStorage.getItem(KEY);
      if (!s || typeof s !== 'object') return;
      state = Object.assign(defaultState(), s);
      if (!Array.isArray(state.caught)) state.caught = [];
      state.caught = state.caught.map(Number).filter(validId);
      if (!state.cleared || typeof state.cleared !== 'object') state.cleared = {};
      state.unlocked = Math.min(STAGES.length, Math.max(1, Number(state.unlocked) || 1));
      state.gen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].indexOf(Number(state.gen)) !== -1 ? Number(state.gen) : 0;
      state.muted = !!state.muted;
      /* 예전 판(v4 초기)은 도감의 세대 칩이 문제 출제 세대까지 바꿔 놓아, 한 세대만 나오는 것처럼 보였다.
         그렇게 남은 세대 고정은 한 번만 전체로 되돌리고, 이후에 고른 세대는 그대로 지킨다. */
      if ((Number(s.ver) || 0) < STATE_VER) {
        state.gen = 0;
        migrated = true;
      }
      state.ver = STATE_VER;
      if (migrated) saveState();   /* v3 기록을 v4 키로 옮기고, 형식을 새로 저장한다 */
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
    if (!validId(id) || isCaught(id)) return false;
    state.caught.push(id);
    saveState();
    return true;
  }
  function clearedCount() { return Object.keys(state.cleared).length; }
  function caughtCount() { return state.caught.length; }
  function caughtOf(ids) {
    var n = 0;
    ids.forEach(function (id) { if (isCaught(id)) n++; });
    return n;
  }
  function totalStars() {
    var t = 0;
    Object.keys(state.cleared).forEach(function (k) { t += Number(state.cleared[k]) || 0; });
    return t;
  }
  function allCleared() {
    return STAGES.every(function (s) { return state.cleared[s.id] > 0; });
  }

  /* ---------------- 효과음 ---------------- */
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
    tap: function () { this.tone(980, 0, 0.06, 'sine', 0.05); },
    correct: function () {
      var notes = [659.25, 783.99, 987.77, 1318.5];
      for (var i = 0; i < notes.length; i++) this.tone(notes[i], i * 0.07, 0.18, 'sine', 0.13);
    },
    pop: function () { this.slide(520, 1300, 0, 0.13, 0.12); },
    nudge: function () { this.slide(420, 560, 0, 0.2, 0.09); },
    fanfare: function () {
      var seq = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.52], [1046.5, 0.62], [1318.5, 0.74]];
      for (var i = 0; i < seq.length; i++) this.tone(seq[i][0], seq[i][1], 0.28, 'triangle', 0.11);
      this.tone(261.63, 0, 0.9, 'sine', 0.06);
    }
  };

  /* ---------------- 말하기(TTS) ---------------- */
  var Speech = {
    voice: null,
    last: null,
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
      this.last = String(text);
      var self = this;
      var go = function () {
        try {
          var u = new SpeechSynthesisUtterance(String(text));
          u.lang = 'ko-KR';
          if (self.voice) u.voice = self.voice;
          u.rate = (opts && opts.rate) || 0.88;
          u.pitch = 1.18;
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

  /* ---------------- 포켓몬 울음소리 ---------------- */
  var Cry = {
    els: {},
    order: [],
    last: null,
    forceFail: false,
    make: function (url) {
      var a = new Audio();
      a.preload = 'auto';
      a.volume = 0.9;
      a.src = url;
      return a;
    },
    get: function (id) {
      id = Number(id);
      var e = this.els[id];
      if (!e) {
        e = { main: this.make(cryUrl(id)), alt: null };
        this.els[id] = e;
        this.order.push(id);
        while (this.order.length > 6) {
          var old = this.order.shift();
          if (old === id) continue;
          try { this.els[old].main.src = ''; } catch (err) {}
          delete this.els[old];
        }
      }
      return e;
    },
    /* 다음에 들을 울음소리를 미리 받아 둔다 */
    preload: function (id) {
      if (state.muted || !validId(id)) return;
      try { this.get(id).main.load(); } catch (err) {}
    },
    tryPlay: function (el, done) {
      var settled = false;
      var finish = function (ok) {
        if (settled) return;
        settled = true;
        el.onerror = null;
        done(ok);
      };
      el.onerror = function () { finish(false); };
      try {
        el.currentTime = 0;
        var p = el.play();
        if (p && p.then) {
          p.then(function () { finish(true); }, function () { finish(false); });
        }
        setTimeout(function () { if (!settled && !el.paused) finish(true); }, 700);
      } catch (err) { finish(false); }
    },
    /* cb('ok' | 'fail' | 'muted') */
    play: function (id, cb) {
      var self = this;
      id = Number(id);
      self.last = { id: id, url: cryUrl(id), status: 'start' };
      var done = function (status) {
        self.last.status = status;
        if (cb) cb(status);
      };
      if (!validId(id)) { done('fail'); return; }
      if (state.muted) { done('muted'); return; }
      if (self.forceFail) { done('fail'); return; }
      var e = self.get(id);
      self.tryPlay(e.main, function (ok) {
        if (ok) { done('ok'); return; }
        /* 다른 주소에서 한 번 더 (네트워크·형식 문제 대비) */
        if (!e.alt) e.alt = self.make(cryAltUrl(id));
        self.tryPlay(e.alt, function (ok2) { done(ok2 ? 'ok' : 'fail'); });
      });
    }
  };

  /* ---------------- 효과 ---------------- */
  var COLORS = ['#ff8fb1', '#ffd166', '#7ee0a8', '#7cc7ff', '#c2a4ff', '#ffb27f', '#ff9ec4'];

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
      p.style.setProperty('--dx', (Math.random() * 2 - 1) * (w * 0.34) + 'px');
      p.style.setProperty('--dy', (Math.random() * 0.5 + 0.9) * (h * 0.45) + 'px');
      p.style.setProperty('--rot', Math.round(Math.random() * 900 - 450) + 'deg');
      p.style.setProperty('--dur', (1.1 + Math.random() * 0.9).toFixed(2) + 's');
      p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
      if (i % 3 === 0) p.style.borderRadius = '50%';
      confettiLayer.appendChild(p);
      (function (node) { setTimeout(function () { node.remove(); }, 2800); })(p);
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
    '<circle cx="60" cy="60" r="52" fill="#fff4f8" stroke="#ffd0e2" stroke-width="6"/>' +
    '<path d="M8 60a52 52 0 0 1 104 0z" fill="#ff9ec4"/>' +
    '<rect x="8" y="55" width="104" height="10" fill="#6b5a72"/>' +
    '<circle cx="60" cy="60" r="16" fill="#fff" stroke="#6b5a72" stroke-width="8"/>' +
    '</svg>'
  );

  window.__pokeImgFallback = function (img) {
    var step = Number(img.getAttribute('data-step') || 0);
    var id = img.getAttribute('data-id');
    var spriteOnly = img.getAttribute('data-sprite') === '1';
    if (step === 0 && !spriteOnly) {
      img.setAttribute('data-step', '1');
      img.src = spriteUrl(id);
    } else {
      img.setAttribute('data-step', '2');
      img.classList.add('img-fallback');
      img.src = PLACEHOLDER;
    }
  };

  function pokeImg(id, cls, opts) {
    opts = opts || {};
    var sprite = !!opts.sprite;
    var alt = opts.alt || (POKEMON[id] ? POKEMON[id].name : '포켓몬');
    return '<img class="' + (cls || '') + '" data-id="' + id + '" data-step="0" data-sprite="' + (sprite ? '1' : '0') + '" ' +
      'src="' + (sprite ? spriteUrl(id) : artworkUrl(id)) + '" alt="' + alt + '" ' +
      'loading="lazy" decoding="async" draggable="false" onerror="window.__pokeImgFallback(this)">';
  }

  function genBadge(id, extraCls) {
    return '<span class="gen-badge' + (extraCls ? ' ' + extraCls : '') + '" style="--gen:' +
      (GEN_COLORS[genOf(id)] || '#9b8bff') + '">' + genLabel(id) + '</span>';
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
  var stage = null;   /* { data, questions, index, hints, clears } */
  var T = null;       /* 따라쓰기 세션 */
  var tokenSeq = 0;
  var dexState = { gen: 0, q: '', shown: 0, list: [] };
  var dexFrom = 'map';   /* 도감을 어디서 열었는지 (뒤로 가면 그리로) */
  var dexObserver = null;

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
    try { Object.keys(Cry.els).forEach(function (k) { Cry.els[k].main.pause(); }); } catch (e) {}
    var ov = document.getElementById('catch-overlay');
    if (ov) ov.remove();
    var md = document.getElementById('dex-detail');
    if (md) md.remove();
  }

  /* ---------------- 홈 ---------------- */
  var HEROES = [[25, 133, 1008], [1, 4, 7], [906, 909, 912], [39, 183, 700], [151, 251, 385], [448, 658, 778], [175, 187, 209], [152, 255, 258]];

  function goHome() {
    hideToast();
    view = 'home';
    stage = null;
    endTrace();
    setHud(null);
    var trio = HEROES[Math.floor(Math.random() * HEROES.length)];
    var started = clearedCount() > 0 || state.unlocked > 1;
    main.innerHTML =
      '<section class="screen home-screen">' +
      '<div class="home-bubbles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="home-cloud c1"></div><div class="home-cloud c2"></div><div class="home-cloud c3"></div>' +
      '<div class="home-inner">' +
      '<div class="home-badge">전국도감 <b>' + D.COUNT + '</b>마리 · 1~9세대</div>' +
      '<h1 class="home-title"><span>포켓몬</span><span>한글</span><span>따라쓰기</span></h1>' +
      '<div class="home-hero">' +
      '<div class="hero-poke mini">' + pokeImg(trio[0], 'hero-img') + '</div>' +
      '<div class="hero-poke big">' + pokeImg(trio[1], 'hero-img') + '</div>' +
      '<div class="hero-poke mini">' + pokeImg(trio[2], 'hero-img') + '</div>' +
      '<div class="hero-ball" aria-hidden="true"><i></i><b></b></div>' +
      '</div>' +
      '<p class="home-sub">포켓몬 이름을 손가락으로 써 봐요!</p>' +
      '<button class="big-btn primary" data-act="start">' + (started ? '계속 하기' : '시작하기') + '</button>' +
      '<div class="home-links">' +
      '<button class="ghost-btn" data-act="dex">📕 도감 <b>' + caughtCount() + '</b></button>' +
      '<button class="ghost-btn" data-act="parent">👨‍👩‍👧 보호자</button>' +
      '</div>' +
      '</div>' +
      '</section>';
  }

  /* ---------------- 세대 고르기 ---------------- */
  function genPickerHTML() {
    var html = '<div class="gen-picker" role="group" aria-label="세대 고르기">' +
      '<button class="gen-chip' + (!state.gen ? ' on' : '') + '" data-act="pick-gen" data-gen="0">전체 ' + D.COUNT + '</button>';
    for (var g = 1; g <= 9; g++) {
      html += '<button class="gen-chip' + (state.gen === g ? ' on' : '') + '" data-act="pick-gen" data-gen="' + g + '" ' +
        'style="--gen:' + (GEN_COLORS[g] || '#9b8bff') + '">' + g + '세대<em>' + GEN_NAMES[g] + '</em></button>';
    }
    return html + '</div>';
  }

  /* ---------------- 지도 ---------------- */
  function goMap() {
    hideToast();
    view = 'map';
    stage = null;
    endTrace();
    setHud('모험 지도');
    var done = clearedCount();
    var genIds = state.gen ? POKE_IDS.filter(function (id) { return genOf(id) === state.gen; }) : POKE_IDS;
    var html = '<section class="screen map-screen">';
    html += '<div class="map-top">' +
      '<div class="map-progress"><span>진행한 단계 <b>' + done + '</b> / ' + STAGES.length + '</span>' +
      '<div class="map-bar"><i style="width:' + (done / STAGES.length * 100) + '%"></i></div></div>' +
      '<button class="dex-btn" data-act="dex">📕 도감<br><b>' + caughtCount() + '</b></button>' +
      '</div>';
    html += '<div class="gen-pick"><div class="gen-pick-title">어느 세대 포켓몬과 놀까요?</div>' + genPickerHTML() + '</div>';
    html += '<div class="stage-list">';
    STAGES.forEach(function (s) {
      var locked = s.id > state.unlocked;
      var stars = state.cleared[s.id] || 0;
      var cleared = stars > 0;
      var pool = stagePool(s.id, state.gen).length;
      html += '<button class="stage-card' + (locked ? ' locked' : '') + (cleared ? ' cleared' : '') +
        '" data-act="stage" data-id="' + s.id + '" data-locked="' + (locked ? '1' : '0') + '" ' +
        'style="--theme:' + s.theme + ';--theme2:' + s.theme2 + '">' +
        '<span class="sc-num">' + (locked ? '🔒' : (cleared ? '✓' : s.id)) + '</span>' +
        '<span class="sc-body">' +
        '<span class="sc-title">' + (locked ? '아직 잠겨 있어요' : s.id + '단계 · ' + s.title) + '</span>' +
        '<span class="sc-sub">' + (locked ? s.id + '단계를 먼저 깨야 해요' : s.subtitle) + '</span>' +
        '<span class="sc-meta"><span class="sc-stars">' + starRow(stars) + '</span>' +
        (locked ? '' : '<span class="sc-pool">' + pool + '마리 중 ' + s.count + '마리</span>') + '</span>' +
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
    html += '<div class="map-dex-note">도감 <b>' + caughtCount() + '</b> / ' + D.COUNT + '마리 · 잡은 포켓몬은 도감에 쌓여요</div>';
    html += '</section>';
    main.innerHTML = html;
    main.scrollTop = 0;
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
    var pool = stagePool(id, state.gen);
    if (!pool.length) {
      toast('이 세대에는 이 단계 포켓몬이 없어요. 세대를 바꿔 볼까요?');
      return;
    }
    hideToast();
    stage = {
      data: s,
      questions: makeQuestions(id, state.gen, s.count, isCaught),
      index: 0,
      hints: 0,
      clears: 0
    };
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
    return n >= 6 ? ' len6' : (n === 5 ? ' len5' : (n === 4 ? ' len4' : (n === 3 ? ' len3' : (n === 2 ? ' len2' : ''))));
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
    var q = stage.questions[stage.index];
    if (!q) { finishStage(); return; }
    var pkm = POKEMON[q.id];
    var chars = pkm.name.split('');
    var targets = traceTargets(q);
    var total = stage.questions.length;
    var blank = s.guide === 'blank';

    setHud(s.title + (state.gen ? ' · ' + state.gen + '세대' : ''));
    hud.style.setProperty('--theme', s.theme);

    main.innerHTML =
      '<section class="screen trace-screen" style="--theme:' + s.theme + ';--theme2:' + s.theme2 + '">' +
      '<div class="q-top">' +
      '<span class="q-step">' + s.icon + ' ' + s.id + '단계</span>' +
      '<div class="q-bar"><i style="width:' + (stage.index / total * 100) + '%"></i></div>' +
      '<span class="q-count"><b>' + (stage.index + 1) + '</b>/' + total + '</span>' +
      '</div>' +
      '<div class="poke-card">' +
      '<button class="poke-art" data-act="cry" data-id="' + q.id + '" aria-label="' + pkm.name + ' 울음소리">' +
      pokeImg(q.id, 'strip-poke') +
      '<span class="art-badge">' + genLabel(q.id) + '</span>' +
      '<span class="art-cry" aria-hidden="true">🔊</span>' +
      '</button>' +
      '<div class="poke-body">' +
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
    /* 다음 문제의 울음소리를 미리 받아 둔다 */
    var nextQ = stage.questions[stage.index + 1];
    if (nextQ) Cry.preload(nextQ.id);
  }

  function boxSize() {
    /* 화면 위/아래에 늘 있는 것들의 높이를 빼고 남는 만큼만 칸으로 쓴다 */
    var chrome = 0;
    ['#hud', '.q-top', '.poke-card', '.cover-wrap', '.cover-label', '.trace-btns'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el && el.offsetHeight) chrome += el.offsetHeight;
    });
    var tools = main.querySelector('.trace-tools');
    var toolsH = tools && tools.offsetHeight ? tools.offsetHeight + 6 : 0;
    var byW = Math.min(window.innerWidth, 560) - 40;
    /* 간격·여백 + 덮은 정도 막대 + 안내 글자 */
    var byH = window.innerHeight - chrome - 62 - toolsH - 60;
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
    ctx.strokeStyle = 'rgba(255, 176, 208, 0.35)';
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
      ctx.fillStyle = 'rgba(255, 200, 222, 0.30)';
      ctx.fillText(ch, size / 2, met.y);
      ctx.lineWidth = Math.max(1.5, size * 0.008);
      ctx.strokeStyle = 'rgba(238, 160, 194, 0.45)';
      ctx.setLineDash([size * 0.014, size * 0.030]);
      ctx.strokeText(ch, size / 2, met.y);
      ctx.setLineDash([]);
      return;
    }

    /* strong: 진한 회색 글자 */
    ctx.fillStyle = 'rgba(214, 206, 224, 0.66)';
    ctx.fillText(ch, size / 2, met.y);
    ctx.lineWidth = Math.max(2, size * 0.012);
    ctx.strokeStyle = 'rgba(150, 138, 170, 0.92)';
    ctx.setLineDash([size * 0.030, size * 0.026]);
    ctx.strokeText(ch, size / 2, met.y);
    ctx.setLineDash([]);
  }

  function drawHint(ctx, size, ch) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (!ch) return;
    var met = glyphMetrics(ctx, size, ch);
    ctx.fillStyle = 'rgba(255, 196, 71, 0.32)';
    ctx.fillText(ch, size / 2, met.y);
    ctx.lineWidth = Math.max(2, size * 0.010);
    ctx.strokeStyle = 'rgba(240, 160, 10, 0.78)';
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
    placeStartDot(T.cssSize);
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
    3) 글자 밖 벗어남(off) — 잉크가 글자 허용 범위 밖에 얼마나 많은가
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
    if (r) confetti(16, { x: r.left + r.width / 2, y: r.top + r.height * 0.42 });
    Sound.correct();
    T.progress = 1;
    setCoverLabel(1);
    setCheckMsg('');

    var token = T.token;
    var last = (order >= T.targets.length - 1);
    if (!last) Speech.speak(PRAISE[Math.floor(Math.random() * PRAISE.length)]);

    /* 다음 글자를 미리 그려 두면 넘어갈 때 끊기지 않는다 */
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
    var id = T.q.id;
    var isNew = catchPokemon(id);
    var nextIndex = T.stageIndex + 1;

    showCatch(id, pkm, isNew, function () {
      if (!T || T.token !== token) return;
      if (nextIndex >= stage.questions.length) {
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
      '<div class="catch-rays" aria-hidden="true"></div>' +
      '<div class="catch-ball"><span class="pb-top"></span><span class="pb-band"></span><span class="pb-btn"></span></div>' +
      '<div class="catch-poke">' + pokeImg(id, 'catch-img') + '</div>' +
      '<div class="catch-name">' + pkm.name + '</div>' +
      '<div class="catch-tags">' + genBadge(id) + typeChipsHTML(id, 'small') + '</div>' +
      '<div class="catch-tag">' + (isNew ? '도감에 담았어요!' : '또 만났네요!') + '</div>' +
      '<button class="catch-again" data-act="catch-cry" data-id="' + id + '">🔊 다시 듣기</button>' +
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
      confetti(28);
      /* 포켓몬 울음소리! 실패하면 한국어 목소리로 대신 */
      Cry.play(id, function (status) {
        if (status !== 'ok') Speech.speak(pkm.name + '! 잡았다!', { rate: 0.96 });
      });
    }, 560);

    var closed = false;
    var finish = function (e) {
      if (closed) return;
      if (e && e.target && e.target.closest && e.target.closest('[data-act="catch-cry"]')) return;
      closed = true;
      ov.classList.remove('show');
      setTimeout(function () { ov.remove(); }, 180);
      if (typeof cb === 'function') cb();
    };
    ov.addEventListener('click', finish);
    setTimeout(finish, 2600);
  }

  function typeChipsHTML(id, extraCls) {
    var p = POKEMON[id];
    if (!p) return '';
    return '<span class="type-chips' + (extraCls ? ' ' + extraCls : '') + '">' +
      p.types.map(function (t) {
        return '<span class="type-chip" style="--tc:' + typeColor(t) + '">' + t + '</span>';
      }).join('') + '</span>';
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
      '<section class="screen reward-screen" style="--theme:' + s.theme + ';--theme2:' + s.theme2 + '">' +
      '<div class="reward-sparks" aria-hidden="true"></div>' +
      '<div class="reward-stage">' +
      '<div class="pokeball" id="reward-ball"><span class="pb-top"></span><span class="pb-band"></span><span class="pb-btn"></span></div>' +
      '<div class="reward-poke" id="reward-poke">' + pokeImg(rewardId, 'reward-img') + '</div>' +
      (showBonus ? '<div class="reward-poke bonus" id="reward-bonus">' + pokeImg(BONUS, 'reward-img') + '</div>' : '') +
      '</div>' +
      '<h2 class="reward-title">' + title + '</h2>' +
      '<div class="reward-stars">' + starRow(stars) + '</div>' +
      '<div class="reward-sub">' + (showBonus
        ? '모든 단계를 깼어요! 전설의 포켓몬 <b>뮤</b>가 찾아왔어요 ✨'
        : s.id + '단계 · ' + s.title + ' 성공! ' + genBadge(rewardId, 'soft')) + '</div>' +
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
      Cry.play(rewardId, function (status) {
        if (status !== 'ok') Speech.speak(pkm.name + objParticle(pkm.name) + ' 잡았다! 대단해!', { rate: 0.94 });
      });
    }, 1000);
    setTimeout(function () { confetti(24, { x: window.innerWidth * 0.2, y: window.innerHeight * 0.35 }); }, 1500);
    setTimeout(function () { confetti(24, { x: window.innerWidth * 0.8, y: window.innerHeight * 0.35 }); }, 1900);
  }

  /* ---------------- 도감 ---------------- */
  var DEX_CHUNK = 60;

  function dexList() {
    var q = dexState.q.trim().toLowerCase();
    var qNum = /^[#]?(\d{1,4})$/.exec(q);
    /* 찾기 중에는 세대를 넘어서 찾는다 */
    var gen = q ? 0 : dexState.gen;
    return POKE_IDS.filter(function (id) {
      if (gen && genOf(id) !== gen) return false;
      if (!q) return true;
      var name = POKEMON[id].name.toLowerCase();
      if (qNum) return String(id) === String(Number(qNum[1]));
      return name.indexOf(q) !== -1;
    });
  }

  function goDex() {
    var fromDex = (view === 'dex');
    view = 'dex';
    stage = null;
    endTrace();
    setHud('나의 포켓몬 도감');
    if (!fromDex) dexState.gen = state.gen;
    dexState.q = '';
    var html = '<section class="screen dex-screen">' +
      '<div class="dex-head">' +
      '<div class="dex-count"><b>' + caughtCount() + '</b> / ' + D.COUNT + ' 마리</div>' +
      '<div class="dex-progress"><i style="width:' + (caughtCount() / D.COUNT * 100) + '%"></i></div>' +
      '<div class="dex-hint">잡은 포켓몬을 누르면 이름과 울음소리를 들려줘요</div>' +
      '</div>' +
      '<div class="gen-picker dex-gens" role="group" aria-label="세대 고르기">' +
      '<button class="gen-chip' + (!dexState.gen ? ' on' : '') + '" data-act="dex-gen" data-gen="0">전체</button>' +
      Array.apply(null, Array(9)).map(function (_, k) {
        var g = k + 1;
        return '<button class="gen-chip' + (dexState.gen === g ? ' on' : '') + '" data-act="dex-gen" data-gen="' + g + '" style="--gen:' + GEN_COLORS[g] + '">' +
          g + '세대<em>' + (D.GEN_COUNT[g] || 0) + '</em></button>';
      }).join('') +
      '</div>' +
      '<div class="dex-search"><span>🔍</span><input id="dex-search" type="search" inputmode="search" placeholder="이름이나 번호로 찾기" autocomplete="off" aria-label="포켓몬 찾기"></div>' +
      '<div class="dex-filter-note" id="dex-note"></div>' +
      '<div class="dex-grid" id="dex-grid"></div>' +
      '<button class="dex-more" id="dex-more" data-act="dex-more" hidden>더 보기</button>' +
      '<div class="dex-btns">' +
      '<button class="ghost-btn" data-act="map">모험 지도</button>' +
      '<button class="ghost-btn" data-act="home">처음으로</button>' +
      '</div>' +
      '</section>';
    main.innerHTML = html;
    renderDexGrid(true);
    /* 아래까지 내리면 다음 묶음을 저절로 이어서 보여 준다 */
    try {
      if (dexObserver) dexObserver.disconnect();
      var more = document.getElementById('dex-more');
      if (more && 'IntersectionObserver' in window) {
        dexObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting && view === 'dex') renderDexGrid(false);
          });
        }, { root: main, rootMargin: '120px' });
        dexObserver.observe(more);
      }
    } catch (e) {}
    var input = document.getElementById('dex-search');
    if (input) {
      input.addEventListener('input', function () {
        dexState.q = input.value;
        renderDexGrid(true);
      });
    }
    main.scrollTop = 0;
  }

  function renderDexGrid(reset) {
    var grid = document.getElementById('dex-grid');
    var more = document.getElementById('dex-more');
    var note = document.getElementById('dex-note');
    if (!grid) return;
    if (reset) {
      dexState.list = dexList();
      dexState.shown = 0;
      grid.innerHTML = '';
    }
    if (!dexState.list) dexState.list = dexList();
    var list = dexState.list;
    var end = Math.min(dexState.shown + DEX_CHUNK, list.length);
    var html = '';
    for (var i = dexState.shown; i < end; i++) {
      var id = list[i];
      var got = isCaught(id);
      html += '<button class="dex-item' + (got ? ' got' : '') + '" data-act="dex-item" data-id="' + id + '" ' +
        'aria-label="' + (got ? POKEMON[id].name + ' ' + genLabel(id) : '아직 못 만난 포켓몬') + '">' +
        '<span class="dex-img-wrap">' + pokeImg(id, 'dex-img', { sprite: true, alt: got ? POKEMON[id].name : '???' }) + '</span>' +
        '<span class="dex-name">' + (got ? POKEMON[id].name : '???') + '</span>' +
        '<span class="dex-no">#' + String(id).padStart(4, '0') + '</span>' +
        '</button>';
    }
    grid.insertAdjacentHTML('beforeend', html);
    dexState.shown = end;
    if (note) {
      var caught = caughtOf(list);
      note.textContent = (dexState.q ? '찾은 포켓몬 ' + list.length + '마리 · ' : '') + '잡은 ' + caught + ' / ' + list.length + '마리';
    }
    if (more) more.hidden = dexState.shown >= list.length;
  }

  function openDexDetail(id) {
    var old = document.getElementById('dex-detail');
    if (old) old.remove();
    var p = POKEMON[id];
    var got = isCaught(id);
    var ov = document.createElement('div');
    ov.className = 'detail-overlay';
    ov.id = 'dex-detail';
    ov.innerHTML =
      '<div class="detail-card" role="dialog" aria-modal="true" aria-label="' + p.name + '">' +
      '<button class="detail-close" data-act="close-detail" aria-label="닫기">✕</button>' +
      '<div class="detail-art">' + pokeImg(id, 'detail-img') + '</div>' +
      '<div class="detail-no">No.' + String(id).padStart(4, '0') + '</div>' +
      '<div class="detail-name">' + (got ? p.name : '???') + '</div>' +
      '<div class="detail-tags">' + genBadge(id) + typeChipsHTML(id) + '</div>' +
      (got
        ? '<button class="big-btn cry-btn" data-act="detail-cry" data-id="' + id + '">🔊 울음소리 듣기</button>'
        : '<div class="detail-lock">아직 만나지 못했어요!<br>이름을 다 쓰면 도감에 담겨요</div>') +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(function () { ov.classList.add('show'); });
    if (got) Cry.preload(id);
  }

  function closeDexDetail() {
    var ov = document.getElementById('dex-detail');
    if (!ov) return;
    ov.classList.remove('show');
    setTimeout(function () { ov.remove(); }, 180);
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
      '<div class="parent-stats">진행한 단계 <b>' + clearedCount() + ' / ' + STAGES.length + '</b><br>' +
      '모은 별 <b>⭐' + totalStars() + '</b> · 잡은 포켓몬 <b>' + caughtCount() + ' / ' + D.COUNT + '</b></div>' +
      '<button class="modal-btn" data-act="sound">' + (state.muted ? '🔇 소리 켜기' : '🔊 소리 끄기') + '</button>' +
      '<button class="modal-btn" data-act="unlock-all">🔓 전체 단계 열기</button>' +
      '<button class="modal-btn danger" data-act="reset-all">🧹 진행 기록 지우기</button>' +
      '<button class="modal-btn plain" data-act="close-parent">닫기</button>' +
      '<div class="modal-note">진행 상황은 이 기기(브라우저)에만 저장돼요.<br>울음소리는 인터넷에서 받아 와요.</div>' +
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

  /* ---------------- 음성 안내 ---------------- */
  function speakQuestion() {
    if (!T) return;
    var target = T.char || T.chars[T.targets[0]];
    if (T.guide === 'blank') {
      Speech.speak(T.pkm.name + '! 혼자서 써 볼까요?', { rate: 0.86 });
    } else {
      Speech.speak(T.pkm.name + '! ' + target + josa(target, '을', '를') + ' 따라 써 봐요', { rate: 0.86 });
    }
  }

  function speakHint() {
    if (!T) return;
    /* 백지 단계에서는 글자를 읽어 주지 않는다 (이름만 들려주고 혼자 쓰게) */
    if (T.guide === 'blank') {
      Speech.speak(T.pkm.name + '!', { rate: 0.82 });
      return;
    }
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
    /* 한 글자에 힌트를 여러 번 눌러도 한 번으로 센다 */
    if (!T.hintUsed) stage.hints += 1;
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

    if (act !== 'answer' && act !== 'dex-item' && act !== 'dex-gen' && act !== 'cry' && act !== 'catch-cry' && act !== 'detail-cry') Sound.tap();

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
        else if (view === 'dex') { if (dexFrom === 'home') goHome(); else goMap(); }
        else goHome();
        break;
      case 'pick-gen': {
        var g = Number(t.getAttribute('data-gen')) || 0;
        state.gen = g;
        saveState();
        goMap();
        break;
      }
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
      case 'cry': {
        if (!T) break;
        var cid = Number(t.getAttribute('data-id')) || T.q.id;
        Cry.play(cid, function (status) {
          if (status === 'fail') Speech.speak(POKEMON[cid].name);
        });
        break;
      }
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
        if (view !== 'dex') dexFrom = view;
        goDex();
        break;
      case 'dex-gen': {
        dexState.gen = Number(t.getAttribute('data-gen')) || 0;
        goDex();
        break;
      }
      case 'dex-more':
        renderDexGrid(false);
        break;
      case 'dex-item': {
        var pid = Number(t.getAttribute('data-id'));
        if (isCaught(pid)) openDexDetail(pid);
        else {
          Sound.nudge();
          Speech.speak('아직 만나지 못했어요');
          openDexDetail(pid);
        }
        break;
      }
      case 'close-detail':
        closeDexDetail();
        break;
      case 'detail-cry': {
        var did = Number(t.getAttribute('data-id'));
        Cry.play(did, function (status) {
          if (status === 'fail') Speech.speak(POKEMON[did].name);
        });
        break;
      }
      case 'catch-cry': {
        var kid = Number(t.getAttribute('data-id'));
        Cry.play(kid, function (status) {
          if (status === 'fail') Speech.speak(POKEMON[kid].name);
        });
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
    var detail = document.getElementById('dex-detail');
    if (detail && e.target === detail) closeDexDetail();
  });

  /* 화면 크기가 바뮌면 칸 크기와 글자를 다시 맞춘다 */
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
        if (!T) return { view: view, stage: stage ? stage.data.id : 0, q: stage ? stage.index : -1, locked: true, ti: -1, caught: caughtCount() };
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
          cov: Number((T.cov || 0).toFixed(3)),
          need: (RECOG[T.stageId] || RECOG[1]).cov,
          strokes: T.strokes.length,
          locked: T.locked,
          hints: stage ? stage.hints : 0,
          clears: stage ? stage.clears : 0,
          caught: caughtCount(),
          pokemon: T.q.id,
          name: T.pkm.name,
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
      recog: RECOG,
      pool: function (sid, gen) { return stagePool(sid, gen === undefined ? state.gen : gen).length; },
      poolIds: function (sid, gen) { return stagePool(sid, gen === undefined ? state.gen : gen); },
      lastCry: function () { return Cry.last; },
      lastSpeech: function () { return Speech.last; },
      cryFail: function (on) { Cry.forceFail = !!on; },
      setGen: function (g) { state.gen = Number(g) || 0; saveState(); },
      questions: function () { return stage ? stage.questions.map(function (q) { return q.id; }) : []; },
      caughtIds: function () { return state.caught.slice(); },
      clearStorage: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
      dexShown: function () { return { shown: dexState.shown, total: (dexState.list || []).length }; },
      dexSearch: function (text) {
        var input = document.getElementById('dex-search');
        if (!input) return false;
        input.value = text;
        dexState.q = text;
        renderDexGrid(true);
        return true;
      },
      openDexDetail: openDexDetail,
      previewQuestion: function (id, sid) {
        var s = STAGES.filter(function (x) { return x.id === (sid || 1); })[0];
        stage = { data: s, questions: [{ id: Number(id), trace: s.trace(POKEMON[Number(id)]) }], index: 0, hints: 0, clears: 0 };
        view = 'quiz';
        renderQuestion();
      }
    };
  }

  /* ---------------- 시작 ---------------- */
  loadState();
  Speech.init();
  goHome();
})();
