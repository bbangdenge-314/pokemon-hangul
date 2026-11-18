/* 포켓몬 한글 따라쓰기 - 학습 데이터
   포켓몬 이름(공식 한국어 명칭)과 번호, 세대는 PokeAPI(pokemon-species)에서 확인했습니다.
   공식 아트워크 주소는 모두 HTTP 200 응답을 확인했습니다. */
window.POKE_DATA = (function () {
  'use strict';

  /* 번호: { 이름, 세대 } — 1~9세대 45마리 (문제·보상으로 모두 만날 수 있어요) */
  var POKEMON = {
    /* 1세대 */
    1:   { name: '이상해씨', gen: 1 },
    4:   { name: '파이리',   gen: 1 },
    7:   { name: '꼬부기',   gen: 1 },
    25:  { name: '피카츄',   gen: 1 },
    35:  { name: '삐삐',     gen: 1 },
    39:  { name: '푸린',     gen: 1 },
    79:  { name: '야돈',     gen: 1 },
    84:  { name: '두두',     gen: 1 },
    86:  { name: '쥬쥬',     gen: 1 },
    133: { name: '이브이',   gen: 1 },
    143: { name: '잠만보',   gen: 1 },
    151: { name: '뮤',       gen: 1 },
    /* 2세대 */
    152: { name: '치코리타', gen: 2 },
    175: { name: '토게피',   gen: 2 },
    183: { name: '마릴',     gen: 2 },
    197: { name: '블래키',   gen: 2 },
    /* 3세대 */
    252: { name: '나무지기', gen: 3 },
    255: { name: '아차모',   gen: 3 },
    258: { name: '물짱이',   gen: 3 },
    282: { name: '가디안',   gen: 3 },
    /* 4세대 */
    393: { name: '팽도리',   gen: 4 },
    431: { name: '나옹마',   gen: 4 },
    445: { name: '한카리아스', gen: 4 },
    448: { name: '루카리오', gen: 4 },
    /* 5세대 */
    494: { name: '비크티니', gen: 5 },
    501: { name: '수댕이',   gen: 5 },
    570: { name: '조로아',   gen: 5 },
    572: { name: '치라미',   gen: 5 },
    /* 6세대 */
    653: { name: '푸호꼬',   gen: 6 },
    658: { name: '개굴닌자', gen: 6 },
    700: { name: '님피아',   gen: 6 },
    702: { name: '데덴네',   gen: 6 },
    /* 7세대 */
    722: { name: '나몰빼미', gen: 7 },
    725: { name: '냐오불',   gen: 7 },
    728: { name: '누리공',   gen: 7 },
    778: { name: '따라큐',   gen: 7 },
    /* 8세대 */
    810: { name: '흥나숭',   gen: 8 },
    813: { name: '염버니',   gen: 8 },
    816: { name: '울머기',   gen: 8 },
    888: { name: '자시안',   gen: 8 },
    /* 9세대 */
    906: { name: '나오하',   gen: 9 },
    909: { name: '뜨아거',   gen: 9 },
    912: { name: '꾸왁스',   gen: 9 },
    921: { name: '빠모',     gen: 9 },
    1008:{ name: '미라이돈', gen: 9 }
  };

  var GEN_COLORS = {
    1: '#e8590c', 2: '#2f9e44', 3: '#1971c2', 4: '#c2255c', 5: '#5f3dc4',
    6: '#0c8599', 7: '#9c36b5', 8: '#b0821a', 9: '#495057'
  };

  var ARTWORK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';
  var SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

  function artworkUrl(id) { return ARTWORK + id + '.png'; }
  function spriteUrl(id) { return SPRITE + id + '.png'; }
  function genOf(id) { var p = POKEMON[id]; return p ? p.gen : 1; }
  function genLabel(id) { return genOf(id) + '세대'; }

  /* 단계를 깰 때 잡는 포켓몬 (1~8세대) */
  var REWARDS = { 1: 175, 2: 197, 3: 252, 4: 282, 5: 393, 6: 888 };
  /* 모든 단계를 깨면 찾아오는 전설의 포켓몬 */
  var BONUS = 151;

  /*
    문제 = { id: 포켓몬 번호, trace: 써 볼 글자 위치(0부터) }
    trace에 없는 글자는 미리 채워진 글자로 보여 준다.
    guide: strong(진한 회색) / faint(아주 연한 흐린 글자) / blank(가이드 없는 백지)
  */
  var STAGES = [
    {
      id: 1,
      title: '첫 글자 따라 쓰기',
      subtitle: '이름의 첫 글자 한 글자',
      icon: '✏️',
      theme: '#ff8fab',
      guide: 'strong',
      tip: '포켓몬 이름의 첫 글자를 손가락으로 따라 써요',
      hint: '회색 글자 위를 손가락으로 따라 그어요',
      questions: [
        { id: 25,   trace: [0] },   /* 피카츄 → 피 */
        { id: 7,    trace: [0] },   /* 꼬부기 → 꼬 */
        { id: 906,  trace: [0] },   /* 나오하 → 나 */
        { id: 921,  trace: [0] },   /* 빠모 → 빠 */
        { id: 152,  trace: [0] },   /* 치코리타 → 치 */
        { id: 909,  trace: [0] }    /* 뜨아거 → 뜨 */
      ]
    },
    {
      id: 2,
      title: '두 글자 따라 쓰기',
      subtitle: '짧은 이름을 통째로',
      icon: '🙌',
      theme: '#4dabf7',
      guide: 'strong',
      tip: '두 글자 이름을 처음부터 끝까지 따라 써요',
      hint: '한 글자씩 차례대로 따라 써요',
      questions: [
        { id: 183, trace: [0, 1] },   /* 마릴 */
        { id: 921, trace: [0, 1] },   /* 빠모 */
        { id: 39,  trace: [0, 1] },   /* 푸린 */
        { id: 79,  trace: [0, 1] },   /* 야돈 */
        { id: 84,  trace: [0, 1] },   /* 두두 */
        { id: 35,  trace: [0, 1] },   /* 삐삐 */
        { id: 86,  trace: [0, 1] }    /* 쥬쥬 */
      ]
    },
    {
      id: 3,
      title: '세 글자 따라 쓰기',
      subtitle: '세 글자 이름 전체',
      icon: '💪',
      theme: '#f59f00',
      guide: 'strong',
      tip: '세 글자 이름을 순서대로 다 따라 써요',
      hint: '세 글자를 차례대로 따라 써요',
      questions: [
        { id: 4,   trace: [0, 1, 2] },   /* 파이리 */
        { id: 255, trace: [0, 1, 2] },   /* 아차모 */
        { id: 501, trace: [0, 1, 2] },   /* 수댕이 */
        { id: 653, trace: [0, 1, 2] },   /* 푸호꼬 */
        { id: 912, trace: [0, 1, 2] },   /* 꾸왁스 */
        { id: 816, trace: [0, 1, 2] }    /* 울머기 */
      ]
    },
    {
      id: 4,
      title: '흐린 글자 따라 쓰기',
      subtitle: '아주 연한 글자를 보고 따라 쓰기',
      icon: '🌫️',
      theme: '#845ef7',
      guide: 'faint',
      tip: '아주 연한 글자를 눈으로 보고 따라 써요',
      hint: '흐린 글자 모양을 잘 보고 따라 그어요',
      questions: [
        { id: 133, trace: [0, 1, 2] },   /* 이브이 */
        { id: 570, trace: [0, 1, 2] },   /* 조로아 */
        { id: 572, trace: [0, 1, 2] },   /* 치라미 */
        { id: 258, trace: [0, 1, 2] },   /* 물짱이 */
        { id: 700, trace: [0, 1, 2] },   /* 님피아 */
        { id: 702, trace: [0, 1, 2] }    /* 데덴네 */
      ]
    },
    {
      id: 5,
      title: '빈칸 혼자 쓰기',
      subtitle: '이름에서 빠진 한 글자를 혼자서',
      icon: '🧩',
      theme: '#20c997',
      guide: 'blank',
      tip: '빈칸 글자를 혼자 써 봐요',
      hint: '빈칸 글자를 혼자 써 봐요. 막히면 살짝 힌트!',
      questions: [
        { id: 1,    trace: [3] },   /* 이상해[씨] */
        { id: 445,  trace: [4] },   /* 한카리아[스] */
        { id: 658,  trace: [3] },   /* 개굴닌[자] */
        { id: 722,  trace: [3] },   /* 나몰빼[미] */
        { id: 778,  trace: [2] },   /* 따라[큐] */
        { id: 431,  trace: [2] },   /* 나옹[마] */
        { id: 494,  trace: [3] }    /* 비크티[니] */
      ]
    },
    {
      id: 6,
      title: '이름 전체 혼자 쓰기!',
      subtitle: '가이드 없이 이름을 통째로',
      icon: '🏆',
      theme: '#e64980',
      guide: 'blank',
      tip: '이름 전체를 혼자 써 봐요',
      hint: '이름을 통째로 혼자 써 봐요. 막히면 살짝 힌트!',
      questions: [
        { id: 813,  trace: [0, 1, 2] },       /* 염버니 */
        { id: 143,  trace: [0, 1, 2] },       /* 잠만보 */
        { id: 725,  trace: [0, 1, 2] },       /* 냐오불 */
        { id: 810,  trace: [0, 1, 2] },       /* 흥나숭 */
        { id: 728,  trace: [0, 1, 2] },       /* 누리공 */
        { id: 448,  trace: [0, 1, 2, 3] },    /* 루카리오 */
        { id: 1008, trace: [0, 1, 2, 3] }     /* 미라이돈 */
      ]
    }
  ];

  return {
    POKEMON: POKEMON,
    STAGES: STAGES,
    REWARDS: REWARDS,
    BONUS: BONUS,
    GEN_COLORS: GEN_COLORS,
    artworkUrl: artworkUrl,
    spriteUrl: spriteUrl,
    genOf: genOf,
    genLabel: genLabel
  };
})();
