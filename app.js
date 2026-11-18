/* 포켓몬 한글 대모험 - 메인 로직 */
(function () {
  'use strict';

  var D = window.POKE_DATA;
  var POKEMON = D.POKEMON;
  var STAGES = D.STAGES;
  var REWARDS = D.REWARDS;
  var BONUS = D.BONUS;
  var artworkUrl = D.artworkUrl;
  var spriteUrl = D.spriteUrl;

  var KEY = 'pokemon-hangul-progress-v1';
  var main = document.getElementById('main');
  var hud = document.getElementById('hud');
  var confettiLayer = document.getElementById('confetti-layer');
  var toastEl = document.getElementById('toast');

  var POKE_IDS = Object.keys(POKEMON).map(Number).sort(function (a, b) { return a - b; });
  var PRAISE = ['정답이야!', '딩동댕!', '잘했어!', '최고야!', '멋져요!'];

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
  function recalcStars() {
    var total = 0;
    Object.keys(state.cleared).forEach(function (k) { total += Number(state.cleared[k]) || 0; });
    state.stars = total;
  }
  function saveState() {
    recalcStars();
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
  function totalStars() { var t = 0; Object.keys(state.cleared).forEach(function (k) { t += Number(state.cleared[k]) || 0; }); return t; }
  function allCleared() { return STAGES.every(function (s) { return state.cleared[s.id] > 0; }); }

  /* ---------------- 소리 ---------------- */
  var Audio = {
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
      gain.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.02);
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
      gain.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    },
    tap: function () { this.tone(880, 0, 0.08, 'sine', 0.10); },
    correct: function () {
      var notes = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < notes.length; i++) this.tone(notes[i], i * 0.075, 0.22, 'sine', 0.16);
    },
    wrong: function () { this.slide(320, 190, 0, 0.22, 0.12); },
    pop: function () { this.slide(500, 1200, 0, 0.14, 0.14); },
    fanfare: function () {
      var seq = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.52], [1046.5, 0.62], [1318.5, 0.74]];
      for (var i = 0; i < seq.length; i++) this.tone(seq[i][0], seq[i][1], 0.3, 'triangle', 0.14);
      this.tone(261.63, 0, 0.9, 'sine', 0.08);
      this.tone(392.0, 0, 0.9, 'sine', 0.06);
    }
  };

  /* ---------------- 말하기(TTS) ---------------- */
  var Speech = {
    voice: null,
    ready: false,
    pick: function () {
      if (!('speechSynthesis' in window)) return;
      try {
        var list = window.speechSynthesis.getVoices() || [];
        var ko = list.filter(function (v) { return v.lang && v.lang.toLowerCase().replace('_', '-').indexOf('ko') === 0; });
        this.voice = ko[0] || null;
      } catch (e) {}
    },
    init: function () {
      if (!('speechSynthesis' in window)) return;
      this.pick();
      try {
        window.speechSynthesis.onvoiceschanged = function () { Speech.pick(); };
      } catch (e) {}
    },
    speak: function (text, opts) {
      if (state.muted || !text || !('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(String(text));
        u.lang = 'ko-KR';
        if (this.voice) u.voice = this.voice;
        u.rate = (opts && opts.rate) || 0.9;
        u.pitch = 1.15;
        u.volume = 1;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    },
    stop: function () {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  };

  /* ---------------- 효과 ---------------- */
  var COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#b983ff', '#ff9f43', '#ff8fab'];

  function confetti(n, origin) {
    n = n || 28;
    var w = window.innerWidth, h = window.innerHeight;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i');
      p.className = 'confetti';
      var x = origin ? origin.x : w / 2;
      var y = origin ? origin.y : h * 0.38;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.background = COLORS[i % COLORS.length];
      p.style.setProperty('--dx', (Math.random() * 2 - 1) * (w * 0.35) + 'px');
      p.style.setProperty('--dy', (Math.random() * 0.5 + 0.9) * (h * 0.5) + 'px');
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
    }, ms || 1800);
  }

  /* placeholder: 포켓볼 그림 */
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
    for (var i = 0; i < (max || 3); i++) out += '<span class="star ' + (i < n ? 'on' : 'off') + '">★</span>';
    return out;
  }

  /* ---------------- 화면 ---------------- */
  var view = 'home';
  var stage = null; // 진행 중인 단계

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

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 홈 */
  function goHome() {
    view = 'home';
    setHud(null);
    var started = clearedCount() > 0 || state.unlocked > 1;
    var id1 = 25, id2 = 1, id3 = 4;
    main.innerHTML =
      '<section class="screen home-screen">' +
      '<div class="home-sky"></div>' +
      '<div class="home-cloud c1"></div><div class="home-cloud c2"></div><div class="home-cloud c3"></div>' +
      '<div class="home-inner">' +
      '<div class="home-badge">한글 첫걸음 · 5살</div>' +
      '<h1 class="home-title">포켓몬<br>한글 대모험</h1>' +
      '<div class="home-hero">' +
      '<div class="hero-poke mini">' + pokeImg(id2, 'hero-img') + '</div>' +
      '<div class="hero-poke big">' + pokeImg(id1, 'hero-img') + '</div>' +
      '<div class="hero-poke mini">' + pokeImg(id3, 'hero-img') + '</div>' +
      '</div>' +
      '<p class="home-sub">포켓몬을 잡으러 한글 여행을 떠나요!</p>' +
      '<button class="big-btn primary" data-act="start">' + (started ? '계속 하기' : '시작하기') + '</button>' +
      '<div class="home-links">' +
      '<button class="ghost-btn" data-act="dex">📕 나의 도감 (' + state.caught.length + ')</button>' +
      '<button class="ghost-btn" data-act="parent">👨‍👩‍👧 보호자</button>' +
      '</div>' +
      '</div>' +
      '<div class="home-grass"></div>' +
      '</section>';
  }

  /* 지도 */
  function goMap() {
    view = 'map';
    stage = null;
    setHud('모험 지도');
    var done = clearedCount();
    var html = '<section class="screen map-screen">';
    html += '<div class="map-top">' +
      '<div class="map-progress"><span>진행한 단계 <b>' + done + '</b> / 5</span>' +
      '<div class="map-bar"><i style="width:' + (done / 5 * 100) + '%"></i></div></div>' +
      '<button class="dex-btn" data-act="dex">📕 도감</button>' +
      '</div>';
    html += '<div class="stage-list">';
    STAGES.forEach(function (s, idx) {
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
        '</span>' +
        '<span class="sc-icon">' + (locked ? '🚪' : s.icon) + '</span>' +
        (cleared ? '<span class="sc-stars">' + starRow(stars) + '</span>' : '<span class="sc-stars">' + starRow(0) + '</span>') +
        '</button>';
    });
    html += '</div>';
    if (allCleared()) {
      html += '<div class="map-done">🎉 모든 단계를 깼어요! 최고예요!</div>';
    } else {
      html += '<div class="map-next">다음은 <b>' + state.unlocked + '단계</b>예요!</div>';
    }
    html += '<div class="map-links"><button class="ghost-btn" data-act="home">처음으로</button>' +
      '<button class="ghost-btn" data-act="parent">👨‍👩‍👧 보호자</button></div>';
    html += '</section>';
    main.innerHTML = html;
  }

  /* 단계 시작 */
  function startStage(id) {
    var s = STAGES.filter(function (x) { return x.id === id; })[0];
    if (!s) { goMap(); return; }
    if (id > state.unlocked) {
      Audio.wrong();
      toast('아직 잠겨 있어요! 앞 단계를 먼저 깨요 🔒');
      return;
    }
    stage = {
      data: s,
      index: 0,
      wrongHere: 0,
      stageWrong: 0,
      lock: false,
      order: s.questions.map(function (q) { return q; })
    };
    view = 'quiz';
    renderQuestion();
  }

  /* 문제 화면 */
  function renderQuestion() {
    var s = stage.data;
    var q = stage.data.questions[stage.index];
    var total = stage.data.questions.length;
    setHud(s.title);
    document.getElementById('hud').style.setProperty('--theme', s.theme);

    var prompt = '';
    if (q.type === 'listen') {
      prompt = '<div class="prompt-area">' +
        '<div class="prompt-chip">무슨 소리일까요?</div>' +
        '<button class="speaker-btn" data-act="replay" aria-label="다시 듣기">🔊</button>' +
        '<div class="prompt-help">' + (state.muted ? '소리가 꺼져 있어요! 🔊 를 눌러 주세요' : '잘 듣고 같은 글자를 골라요') + '</div>' +
        '</div>';
    } else if (q.type === 'consonant') {
      prompt = '<div class="prompt-area">' +
        '<div class="prompt-chip">첫소리를 찾아보세요</div>' +
        '<button class="speaker-btn" data-act="replay" aria-label="다시 듣기">🔊</button>' +
        '<div class="prompt-help">' + (state.muted ? '소리가 꺼져 있어요! 🔊 를 눌러 주세요' : '이름을 잘 듣고 글자를 골라요') + '</div>' +
        '</div>';
    } else if (q.type === 'combine') {
      prompt = '<div class="prompt-area">' +
        '<div class="prompt-chip">합체하면 무슨 글자?</div>' +
        '<div class="combine">' +
        '<span class="jamo">' + q.consonant + '</span>' +
        '<span class="op">+</span>' +
        '<span class="jamo">' + q.vowel + '</span>' +
        '<span class="op">=</span>' +
        '<span class="jamo blank">?</span>' +
        '</div>' +
        '</div>';
    } else if (q.type === 'first' || q.type === 'fill') {
      var pkm = POKEMON[q.pokemon];
      var chars = pkm.name.split('');
      var blankAt = q.type === 'first' ? 0 : q.blank;
      var shown = chars.map(function (ch, i) {
        return i === blankAt ? '<span class="name-blank">?</span>' : '<span class="name-ch">' + ch + '</span>';
      }).join('');
      prompt = '<div class="prompt-area poke-area">' +
        '<div class="poke-card">' + pokeImg(q.pokemon, 'poke-img') +
        '<div class="poke-name">' + shown + '</div>' +
        '<div class="poke-tag">' + (q.type === 'first' ? '첫 글자는?' : '빈칸 글자는?') + '</div>' +
        '</div>' +
        '<button class="speaker-btn small" data-act="replay" aria-label="이름 다시 듣기">🔊</button>' +
        '</div>';
    }

    var opts = shuffle(q.options).map(function (o) {
      return '<button class="option" data-act="answer" data-val="' + o + '">' + o + '</button>';
    }).join('');

    main.innerHTML =
      '<section class="screen quiz-screen" style="--theme:' + s.theme + '">' +
      '<div class="q-top">' +
      '<div class="q-step">' + s.icon + ' ' + s.id + '단계</div>' +
      '<div class="q-count">' + (stage.index + 1) + ' / ' + total + '</div>' +
      '</div>' +
      '<div class="q-bar"><i style="width:' + (stage.index / total * 100) + '%"></i></div>' +
      prompt +
      (q.type === 'combine' ? '<div class="hint-line" id="hint-line" hidden></div>' : '') +
      '<div class="options ' + (q.options.length === 2 ? 'two' : '') + '">' + opts + '</div>' +
      '</section>';

    stage.lock = false;
    stage.wrongHere = 0;

    // 자동 읽기
    var speech = '';
    if (q.type === 'listen') speech = q.say;
    else if (q.type === 'consonant') speech = q.say;
    else if (q.type === 'first' || q.type === 'fill') speech = POKEMON[q.pokemon].name;
    else if (q.type === 'combine') speech = '';
    if (speech) {
      setTimeout(function () { if (view === 'quiz' && stage) Speech.speak(speech); }, 320);
    }
  }

  function speakPrompt() {
    if (!stage) return;
    var q = stage.data.questions[stage.index];
    if (q.type === 'listen' || q.type === 'consonant') Speech.speak(q.say);
    else if (q.type === 'first' || q.type === 'fill') Speech.speak(POKEMON[q.pokemon].name);
    else if (q.type === 'combine') Speech.speak(q.answer);
  }

  function answer(btn) {
    if (!stage || stage.lock) return;
    var q = stage.data.questions[stage.index];
    var val = btn.getAttribute('data-val');
    if (val === q.answer) {
      stage.lock = true;
      btn.classList.add('correct');
      Audio.correct();
      var rect = btn.getBoundingClientRect();
      confetti(18, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      var praise = PRAISE[Math.floor(Math.random() * PRAISE.length)];
      var say = praise;
      if (q.type === 'first' || q.type === 'fill') say = q.answer + '! ' + POKEMON[q.pokemon].name + '!';
      else say = praise + ' ' + q.answer;
      Speech.speak(say);
      if (q.pokemon && catchPokemon(q.pokemon)) {
        setTimeout(function () {
          Audio.pop();
          toast('📕 ' + POKEMON[q.pokemon].name + '를 도감에 담았어!');
        }, 420);
      }
      setTimeout(function () {
        stage.index += 1;
        if (stage.index >= stage.data.questions.length) finishStage();
        else { renderQuestion(); refreshHud(); }
      }, 1050);
    } else {
      btn.classList.add('wrong');
      Audio.wrong();
      stage.wrongHere += 1;
      stage.stageWrong += 1;
      stage.lock = true;
      setTimeout(function () {
        btn.classList.remove('wrong');
        stage.lock = false;
      }, 480);
      if (stage.wrongHere === 1) {
        Speech.speak('음, 다시 해볼까?');
      } else if (stage.wrongHere >= 2) {
        var target = main.querySelector('.option[data-val="' + q.answer + '"]');
        if (target) target.classList.add('hint');
        var hintLine = document.getElementById('hint-line');
        if (q.type === 'combine') {
          if (hintLine) {
            hintLine.hidden = false;
            hintLine.innerHTML = q.consonant + ' + ' + q.vowel + ' = <b>' + q.answer + '</b> 이렇게 읽어요!';
          }
          Speech.speak(q.consonant + ' ' + q.vowel + ', ' + q.answer);
        } else if (q.type === 'first' || q.type === 'fill') {
          Speech.speak(POKEMON[q.pokemon].name + ', ' + q.answer);
        } else {
          Speech.speak(q.answer);
        }
      }
    }
  }

  function refreshHud() {
    var chip = document.querySelector('.star-chip');
    if (chip) chip.textContent = '⭐ ' + totalStars();
  }

  /* 단계 완료 */
  function finishStage() {
    var s = stage.data;
    var stars = stage.stageWrong === 0 ? 3 : (stage.stageWrong <= 2 ? 2 : 1);
    var prev = state.cleared[s.id] || 0;
    if (stars > prev) state.cleared[s.id] = stars;
    else state.cleared[s.id] = prev;
    if (state.unlocked < s.id + 1) state.unlocked = Math.min(5, s.id + 1);
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
    setHud(null);
    var nextId = s.id + 1;
    var hasNext = nextId <= 5;
    var pkm = POKEMON[rewardId];
    var showBonus = s.id === 5 && isCaught(BONUS);
    var title = gotReward ? '야호! ' + pkm.name + '를 잡았다!' : s.id + '단계 완료!';
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
        ? (bonusId ? '모든 단계를 깼어요! 전설의 포켓몬 <b>뮤</b>가 찾아왔어요 ✨' : '모든 단계를 깼어요! 정말 대단해요 ✨')
        : s.id + '단계 · ' + s.title + ' 를 깼어요!') + '</div>' +
      '<div class="reward-btns">' +
      (hasNext
        ? '<button class="big-btn primary" data-act="next-stage" data-id="' + nextId + '">' + nextId + '단계 도전!</button>'
        : '<button class="big-btn primary" data-act="dex">📕 도감 보러 가기</button>') +
      '<button class="ghost-btn" data-act="map" data-id="' + s.id + '">모험 지도</button>' +
      '</div>' +
      '</section>';

    setTimeout(function () {
      var ball = document.getElementById('reward-ball');
      if (ball) ball.classList.add('opening');
      Audio.pop();
    }, 650);
    setTimeout(function () {
      var ball = document.getElementById('reward-ball');
      if (ball) ball.classList.add('gone');
      var poke = document.getElementById('reward-poke');
      if (poke) poke.classList.add('show');
      var bonus = document.getElementById('reward-bonus');
      if (bonus) bonus.classList.add('show');
      Audio.fanfare();
      confetti(40);
      Speech.speak((gotReward ? pkm.name + '를 잡았다! ' : '') + (s.id === 5 ? '모든 단계를 깼어! 최고야!' : '대단해! 최고야!'), { rate: 0.92 });
    }, 1000);
    setTimeout(function () { confetti(26, { x: window.innerWidth * 0.2, y: window.innerHeight * 0.35 }); }, 1500);
    setTimeout(function () { confetti(26, { x: window.innerWidth * 0.8, y: window.innerHeight * 0.35 }); }, 1900);
  }

  /* 도감 */
  function goDex() {
    view = 'dex';
    setHud('나의 포켓몬 도감');
    var caughtN = state.caught.length;
    var html = '<section class="screen dex-screen">' +
      '<div class="dex-head">' +
      '<div class="dex-count"><b>' + caughtN + '</b> / ' + POKE_IDS.length + ' 마리</div>' +
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

  /* 보호자 메뉴 */
  var resetArmed = false;
  function openParent() {
    resetArmed = false;
    var caughtN = state.caught.length;
    var doneN = clearedCount();
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'parent-modal';
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="보호자 메뉴">' +
      '<div class="modal-title">보호자 메뉴</div>' +
      '<div class="parent-stats">진행한 단계 <b>' + doneN + ' / 5</b> · 모은 별 <b>⭐' + totalStars() + '</b> · 잡은 포켓몬 <b>' + caughtN + '마리</b></div>' +
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

  /* ---------------- 동작 처리 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    if (act !== 'answer' && act !== 'dex-item') Audio.tap();

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
        if (view === 'quiz') { Speech.stop(); goMap(); }
        else goHome();
        break;
      case 'stage': {
        var id = Number(t.getAttribute('data-id'));
        if (t.getAttribute('data-locked') === '1') {
          Audio.wrong();
          toast('아직 잠겨 있어요! 🔒 ' + id + '단계를 먼저 깨요');
          Speech.speak(id + '단계는 아직 잠겨 있어요');
        } else {
          startStage(id);
        }
        break;
      }
      case 'answer':
        answer(t);
        break;
      case 'replay':
        speakPrompt();
        break;
      case 'next-stage':
        startStage(Number(t.getAttribute('data-id')));
        break;
      case 'dex':
        goDex();
        break;
      case 'dex-item': {
        var pid = Number(t.getAttribute('data-id'));
        if (isCaught(pid)) {
          Audio.pop();
          t.classList.add('pulse');
          setTimeout(function () { t.classList.remove('pulse'); }, 600);
          Speech.speak(POKEMON[pid].name);
        } else {
          Audio.wrong();
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
        state.unlocked = 5;
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

  /* 오버레이 바깥을 누르면 닫기 */
  document.addEventListener('click', function (e) {
    var overlay = document.getElementById('parent-modal');
    if (overlay && e.target === overlay) closeParent();
  });

  /* 시작 */
  loadState();
  recalcStars();
  Speech.init();
  goHome();
})();
