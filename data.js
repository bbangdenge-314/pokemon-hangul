/* 포켓몬 한글 따라쓰기 - 학습 데이터 (v4)
   - pokemon-data.js 의 전국도감 1~1025 를 쓰기 좋은 모양으로 다듬고
   - 6단계 문제를 그때그때 뽑는 규칙(문제 은행)을 담습니다.
   - 모든 포켓몬은 어느 단계에서는 꼭 나올 수 있습니다 (1,025마리 전부). */
window.POKE_DATA = (function () {
  'use strict';

  var RAW = window.POKEMON_DATA || { COUNT: 0, LIST: [] };
  var POKEMON = {};
  var POKE_IDS = [];
  (RAW.LIST || []).forEach(function (row, i) {
    var id = i + 1;
    POKEMON[id] = {
      id: id,
      name: row[0],
      gen: row[1],
      types: [row[2]].concat(row[3] ? [row[3]] : [])
    };
    POKE_IDS.push(id);
  });

  var GEN_COLORS = {
    1: '#ff8a5c', 2: '#7bc96f', 3: '#4cc2e0', 4: '#f06fa6', 5: '#9b8bff',
    6: '#3fc7b4', 7: '#ff9f43', 8: '#8aa4ff', 9: '#c084e8'
  };
  var GEN_NAMES = {
    1: '관동', 2: '성도', 3: '호연', 4: '신오', 5: '하나',
    6: '칼로스', 7: '알로라', 8: '가라르', 9: '팔데아'
  };

  var TYPE_COLORS = {
    '노말': '#b3aea5', '불꽃': '#ff8a4c', '물': '#59b7f2', '전기': '#f7cf3f',
    '풀': '#68c96a', '얼음': '#79dbe8', '격투': '#e2685c', '독': '#b56bd6',
    '땅': '#d8ab5c', '비행': '#8fa9f0', '에스퍼': '#f573a9', '벌레': '#a6c23f',
    '바위': '#c2ad6b', '고스트': '#8374c6', '드래곤': '#6f75e8', '악': '#7e6d63',
    '강철': '#9fb0c4', '페어리': '#f09ed0'
  };

  var ARTWORK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';
  var SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  /* 포켓몬 울음소리 (PokeAPI cries) */
  var CRY = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/';
  var CRY_ALT = 'https://cdn.jsdelivr.net/gh/PokeAPI/cries@main/cries/pokemon/latest/';

  function artworkUrl(id) { return ARTWORK + Number(id) + '.png'; }
  function spriteUrl(id) { return SPRITE + Number(id) + '.png'; }
  function cryUrl(id) { return CRY + Number(id) + '.ogg'; }
  function cryAltUrl(id) { return CRY_ALT + Number(id) + '.ogg'; }

  function genOf(id) { var p = POKEMON[id]; return p ? p.gen : 1; }
  function genLabel(id) { return genOf(id) + '세대'; }
  function nameOf(id) { var p = POKEMON[id]; return p ? p.name : ''; }
  function lenOf(id) { return nameOf(id).length; }
  function typeColor(t) { return TYPE_COLORS[t] || '#b3aea5'; }

  /* 세대별 마리 수 */
  var GEN_COUNT = {};
  POKE_IDS.forEach(function (id) {
    var g = genOf(id);
    GEN_COUNT[g] = (GEN_COUNT[g] || 0) + 1;
  });

  /* 단계를 깰 때 잡는 포켓몬 */
  var REWARDS = { 1: 175, 2: 197, 3: 252, 4: 282, 5: 393, 6: 888 };
  /* 모든 단계를 깨면 찾아오는 전설의 포켓몬 */
  var BONUS = 151;

  /*
    문제는 고정 목록이 아니라 단계 규칙(pool)으로 그때그때 뽑습니다.
    pool(id) 이 true 인 포켓몬이 그 단계에 나올 수 있습니다.
      - 1단계: 이름이 두 글자 이상 → 첫 글자 한 글자 따라 쓰기
      - 2단계: 한두 글자 이름 → 이름 전체
      - 3단계: 세 글자 이름 → 이름 전체
      - 4단계: 세·네 글자 이름 → 흐린 글자 전체
      - 5단계: 세 글자 이상 이름 → 빠진 한 글자 혼자 쓰기
      - 6단계: 두세 글자 이름 → 이름 전체 혼자 쓰기 (백지)
  */
  var STAGES = [
    {
      id: 1,
      title: '첫 글자 따라 쓰기',
      subtitle: '이름의 첫 글자 한 글자',
      icon: '✏️',
      theme: '#ff9ec4',
      theme2: '#ffd6e7',
      guide: 'strong',
      tip: '포켓몬 이름의 첫 글자를 손가락으로 따라 써요',
      count: 6,
      blank: false,
      pool: function (p) { return p.name.length >= 2; },
      trace: function (p) { return [0]; }
    },
    {
      id: 2,
      title: '짧은 이름 따라 쓰기',
      subtitle: '한두 글자 이름을 통째로',
      icon: '🙌',
      theme: '#79c9ff',
      theme2: '#cdeeff',
      guide: 'strong',
      tip: '짧은 이름을 처음부터 끝까지 따라 써요',
      count: 6,
      blank: false,
      pool: function (p) { return p.name.length <= 2; },
      trace: function (p) { return range(p.name.length); }
    },
    {
      id: 3,
      title: '세 글자 따라 쓰기',
      subtitle: '세 글자 이름 전체',
      icon: '💪',
      theme: '#ffc247',
      theme2: '#ffe9b8',
      guide: 'strong',
      tip: '세 글자를 차례대로 다 따라 써요',
      count: 6,
      blank: false,
      pool: function (p) { return p.name.length === 3; },
      trace: function (p) { return range(p.name.length); }
    },
    {
      id: 4,
      title: '흐린 글자 따라 쓰기',
      subtitle: '아주 연한 글자를 보고 따라 쓰기',
      icon: '🌫️',
      theme: '#a98bff',
      theme2: '#e3d9ff',
      guide: 'faint',
      tip: '아주 연한 글자를 눈으로 보고 따라 써요',
      count: 5,
      blank: false,
      pool: function (p) { return p.name.length === 3 || p.name.length === 4; },
      trace: function (p) { return range(p.name.length); }
    },
    {
      id: 5,
      title: '빈칸 혼자 쓰기',
      subtitle: '이름에서 빠진 한 글자를 혼자서',
      icon: '🧩',
      theme: '#4fd0a8',
      theme2: '#c9f5e6',
      guide: 'blank',
      tip: '빈칸 글자를 혼자 써 봐요',
      count: 5,
      blank: true,
      pool: function (p) { return p.name.length >= 3; },
      trace: function (p, rand) {
        /* 첫 글자는 보여 주고, 뒤에서 한 글자를 가린다 */
        var i = 1 + Math.floor((rand ? rand() : Math.random()) * (p.name.length - 1));
        return [Math.min(p.name.length - 1, i)];
      }
    },
    {
      id: 6,
      title: '이름 전체 혼자 쓰기!',
      subtitle: '가이드 없이 이름을 통째로',
      icon: '🏆',
      theme: '#ff7ba9',
      theme2: '#ffd9e6',
      guide: 'blank',
      tip: '이름 전체를 혼자 써 봐요',
      count: 4,
      blank: true,
      pool: function (p) { return p.name.length >= 2 && p.name.length <= 3; },
      trace: function (p) { return range(p.name.length); }
    }
  ];

  function range(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(i);
    return out;
  }

  /* 단계에 나올 수 있는 포켓몬 (세대 고르기: 0 = 전체) */
  function stagePool(sid, gen) {
    var s = STAGES.filter(function (x) { return x.id === sid; })[0];
    if (!s) return [];
    return POKE_IDS.filter(function (id) {
      var p = POKEMON[id];
      if (gen && p.gen !== gen) return false;
      return s.pool(p);
    });
  }

  /* 그 세대에 그 단계로 나올 수 있는 포켓몬이 있는지 (없으면 전체로 돌아간다) */
  function stageAvailable(sid, gen) {
    return gen ? stagePool(sid, gen).length > 0 : true;
  }

  function shuffle(arr, rand) {
    var r = rand || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /*
    단계 문제 n개를 뽑는다.
    - 이미 잡은 포켓몬보다 아직 못 만난 포켓몬을 먼저 넣어 도감이 골고루 채워지게 한다
    - 같은 단계 안에서 같은 포켓몬이 두 번 나오지 않는다
  */
  function makeQuestions(sid, gen, n, isCaught, rand) {
    var s = STAGES.filter(function (x) { return x.id === sid; })[0];
    if (!s) return [];
    var r = rand || Math.random;
    var pool = stagePool(sid, gen);
    var fresh = [];
    var seen = [];
    shuffle(pool.slice(), r).forEach(function (id) {
      if (typeof isCaught === 'function' && isCaught(id)) seen.push(id);
      else fresh.push(id);
    });
    var list = fresh.concat(seen);
    var want = Math.min(n || s.count, list.length);
    var out = [];
    for (var i = 0; i < want; i++) {
      var p = POKEMON[list[i]];
      out.push({ id: list[i], trace: s.trace(p, r) });
    }
    return out;
  }

  return {
    POKEMON: POKEMON,
    POKE_IDS: POKE_IDS,
    COUNT: POKE_IDS.length,
    STAGES: STAGES,
    REWARDS: REWARDS,
    BONUS: BONUS,
    GEN_COLORS: GEN_COLORS,
    GEN_NAMES: GEN_NAMES,
    GEN_COUNT: GEN_COUNT,
    TYPE_COLORS: TYPE_COLORS,
    artworkUrl: artworkUrl,
    spriteUrl: spriteUrl,
    cryUrl: cryUrl,
    cryAltUrl: cryAltUrl,
    genOf: genOf,
    genLabel: genLabel,
    nameOf: nameOf,
    lenOf: lenOf,
    typeColor: typeColor,
    stagePool: stagePool,
    stageAvailable: stageAvailable,
    makeQuestions: makeQuestions,
    shuffle: shuffle
  };
})();
