/* 포켓몬 한글 따라쓰기 - 학습 데이터 (이름·이미지 ID는 PokeAPI 공식 한국어 명칭으로 확인) */
window.POKE_DATA = (function () {
  'use strict';

  var POKEMON = {
    1: { name: '이상해씨' },
    2: { name: '이상해풀' },
    6: { name: '리자몽' },
    4: { name: '파이리' },
    7: { name: '꼬부기' },
    25: { name: '피카츄' },
    26: { name: '라이츄' },
    35: { name: '삐삐' },
    39: { name: '푸린' },
    54: { name: '고라파덕' },
    79: { name: '야돈' },
    84: { name: '두두' },
    86: { name: '쥬쥬' },
    94: { name: '팬텀' },
    131: { name: '라프라스' },
    132: { name: '메타몽' },
    133: { name: '이브이' },
    143: { name: '잠만보' },
    149: { name: '망나뇽' },
    150: { name: '뮤츠' },
    151: { name: '뮤' },
    152: { name: '치코리타' },
    172: { name: '피츄' },
    175: { name: '토게피' },
    658: { name: '개굴닌자' }
  };

  var ARTWORK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';
  var SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

  function artworkUrl(id) { return ARTWORK + id + '.png'; }
  function spriteUrl(id) { return SPRITE + id + '.png'; }

  /* 단계를 깰 때 잡는 포켓몬 */
  var REWARDS = { 1: 35, 2: 175, 3: 86, 4: 132, 5: 6 };
  /* 모든 단계를 깨면 찾아오는 전설의 포켓몬 */
  var BONUS = 151;

  /*
    문제 = { id: 포켓몬 번호, trace: 따라 쓸 글자 위치(0부터) }
    trace에 없는 글자는 미리 채워진 글자로 보여 준다.
  */
  var STAGES = [
    {
      id: 1,
      title: '첫 글자 따라 쓰기',
      subtitle: '이름의 첫 글자 한 글자',
      icon: '✏️',
      theme: '#ff8fab',
      tip: '포켓몬 이름의 첫 글자를 손가락으로 따라 써요',
      hint: '회색 글자 위를 손가락으로 따라 그어요',
      questions: [
        { id: 151, trace: [0] },   /* 뮤 */
        { id: 39, trace: [0] },    /* 푸린 → 푸 */
        { id: 25, trace: [0] },    /* 피카츄 → 피 */
        { id: 7, trace: [0] },     /* 꼬부기 → 꼬 */
        { id: 4, trace: [0] },     /* 파이리 → 파 */
        { id: 133, trace: [0] }    /* 이브이 → 이 */
      ]
    },
    {
      id: 2,
      title: '두 글자 이름',
      subtitle: '짧은 이름을 통째로',
      icon: '🙌',
      theme: '#4dabf7',
      tip: '두 글자 이름을 처음부터 끝까지 따라 써요',
      hint: '한 글자씩 차례대로 따라 써요',
      questions: [
        { id: 39, trace: [0, 1] },   /* 푸린 */
        { id: 172, trace: [0, 1] },  /* 피츄 */
        { id: 79, trace: [0, 1] },   /* 야돈 */
        { id: 84, trace: [0, 1] },   /* 두두 */
        { id: 94, trace: [0, 1] },   /* 팬텀 */
        { id: 150, trace: [0, 1] }   /* 뮤츠 */
      ]
    },
    {
      id: 3,
      title: '빈칸 따라 쓰기',
      subtitle: '이름에서 빠진 글자',
      icon: '🧩',
      theme: '#845ef7',
      tip: '이름에서 빠진 글자를 찾아 따라 써요',
      hint: '노란 빈칸 글자를 따라 써요',
      questions: [
        { id: 25, trace: [2] },    /* 피카[츄] */
        { id: 4, trace: [2] },     /* 파이[리] */
        { id: 7, trace: [2] },     /* 꼬부[기] */
        { id: 143, trace: [2] },   /* 잠만[보] */
        { id: 54, trace: [3] },    /* 고라파[덕] */
        { id: 149, trace: [2] }    /* 망나[뇽] */
      ]
    },
    {
      id: 4,
      title: '세 글자 이름',
      subtitle: '이름 전체를 따라 쓰기',
      icon: '💪',
      theme: '#f59f00',
      tip: '세 글자 이름을 순서대로 다 따라 써요',
      hint: '세 글자를 차례대로 따라 써요',
      questions: [
        { id: 25, trace: [0, 1, 2] },   /* 피카츄 */
        { id: 4, trace: [0, 1, 2] },    /* 파이리 */
        { id: 7, trace: [0, 1, 2] },    /* 꼬부기 */
        { id: 133, trace: [0, 1, 2] },  /* 이브이 */
        { id: 26, trace: [0, 1, 2] },   /* 라이츄 */
        { id: 149, trace: [0, 1, 2] }   /* 망나뇽 */
      ]
    },
    {
      id: 5,
      title: '네 글자 도전!',
      subtitle: '긴 이름에 도전',
      icon: '🏆',
      theme: '#20c997',
      tip: '긴 네 글자 이름에 도전해 봐요',
      hint: '네 글자를 차근차근 따라 써요',
      questions: [
        { id: 1, trace: [0, 1, 2, 3] },     /* 이상해씨 */
        { id: 131, trace: [0, 1, 2, 3] },   /* 라프라스 */
        { id: 54, trace: [0, 1, 2, 3] },    /* 고라파덕 */
        { id: 658, trace: [0, 1, 2, 3] },   /* 개굴닌자 */
        { id: 2, trace: [0, 1, 2, 3] },     /* 이상해풀 */
        { id: 152, trace: [0, 1, 2, 3] }    /* 치코리타 */
      ]
    }
  ];

  return {
    POKEMON: POKEMON,
    STAGES: STAGES,
    REWARDS: REWARDS,
    BONUS: BONUS,
    artworkUrl: artworkUrl,
    spriteUrl: spriteUrl
  };
})();
