/* 포켓몬 한글 대모험 - 학습 데이터 */
window.POKE_DATA = (function () {
  'use strict';

  var POKEMON = {
    1: { name: '이상해씨' },
    4: { name: '파이리' },
    7: { name: '꼬부기' },
    25: { name: '피카츄' },
    39: { name: '푸린' },
    131: { name: '라프라스' },
    133: { name: '이브이' },
    143: { name: '잠만보' },
    149: { name: '망나뇽' },
    150: { name: '뮤츠' },
    151: { name: '뮤' }
  };

  var ARTWORK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';
  var SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

  function artworkUrl(id) { return ARTWORK + id + '.png'; }
  function spriteUrl(id) { return SPRITE + id + '.png'; }

  /* 단계를 깰 때 잡는 포켓몬 */
  var REWARDS = { 1: 1, 2: 7, 3: 4, 4: 133, 5: 25 };
  /* 모든 단계를 깨면 찾아오는 전설의 포켓몬 */
  var BONUS = 151;

  var STAGES = [
    {
      id: 1,
      title: '모음 친구들',
      subtitle: '아 야 어 여 오 요 우 유',
      icon: '🎵',
      theme: '#ff8fab',
      tip: '소리를 잘 듣고 똑같은 모음을 찾아요',
      questions: [
        { type: 'listen', say: '아', answer: 'ㅏ', options: ['ㅏ', 'ㅓ', 'ㅗ', 'ㅜ'] },
        { type: 'listen', say: '야', answer: 'ㅑ', options: ['ㅑ', 'ㅏ', 'ㅕ', 'ㅛ'] },
        { type: 'listen', say: '어', answer: 'ㅓ', options: ['ㅓ', 'ㅗ', 'ㅜ', 'ㅏ'] },
        { type: 'listen', say: '여', answer: 'ㅕ', options: ['ㅕ', 'ㅓ', 'ㅑ', 'ㅠ'] },
        { type: 'listen', say: '오', answer: 'ㅗ', options: ['ㅗ', 'ㅜ', 'ㅏ', 'ㅓ'] },
        { type: 'listen', say: '요', answer: 'ㅛ', options: ['ㅛ', 'ㅑ', 'ㅠ', 'ㅗ'] },
        { type: 'listen', say: '우', answer: 'ㅜ', options: ['ㅜ', 'ㅗ', 'ㅠ', 'ㅏ'] },
        { type: 'listen', say: '유', answer: 'ㅠ', options: ['ㅠ', 'ㅛ', 'ㅜ', 'ㅕ'] }
      ]
    },
    {
      id: 2,
      title: '자음 탐험',
      subtitle: 'ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ',
      icon: '🧭',
      theme: '#4dabf7',
      tip: '소리를 잘 듣고 첫소리를 찾아요',
      questions: [
        { type: 'consonant', say: '기역, 그', answer: 'ㄱ', options: ['ㄱ', 'ㄴ', 'ㄷ', 'ㅁ'] },
        { type: 'consonant', say: '니은, 느', answer: 'ㄴ', options: ['ㄴ', 'ㄷ', 'ㄹ', 'ㅁ'] },
        { type: 'consonant', say: '디귿, 드', answer: 'ㄷ', options: ['ㄷ', 'ㄱ', 'ㄹ', 'ㅂ'] },
        { type: 'consonant', say: '리을, 르', answer: 'ㄹ', options: ['ㄹ', 'ㄴ', 'ㅁ', 'ㅇ'] },
        { type: 'consonant', say: '미음, 므', answer: 'ㅁ', options: ['ㅁ', 'ㅂ', 'ㄴ', 'ㄷ'] },
        { type: 'consonant', say: '비읍, 브', answer: 'ㅂ', options: ['ㅂ', 'ㅁ', 'ㅅ', 'ㅇ'] },
        { type: 'consonant', say: '시옷, 스', answer: 'ㅅ', options: ['ㅅ', 'ㅂ', 'ㅇ', 'ㄷ'] },
        { type: 'consonant', say: '이응, 응', answer: 'ㅇ', options: ['ㅇ', 'ㅅ', 'ㄱ', 'ㅁ'] }
      ]
    },
    {
      id: 3,
      title: '글자 합체!',
      subtitle: 'ㄱ + ㅏ = 가',
      icon: '✨',
      theme: '#845ef7',
      tip: '첫소리와 모음이 만나면 어떤 글자가 될까요?',
      questions: [
        { type: 'combine', consonant: 'ㄱ', vowel: 'ㅏ', answer: '가', options: ['가', '나', '다', '라'] },
        { type: 'combine', consonant: 'ㄴ', vowel: 'ㅗ', answer: '노', options: ['노', '도', '로', '모'] },
        { type: 'combine', consonant: 'ㄷ', vowel: 'ㅣ', answer: '디', options: ['디', '기', '니', '리'] },
        { type: 'combine', consonant: 'ㄹ', vowel: 'ㅜ', answer: '루', options: ['루', '누', '무', '두'] },
        { type: 'combine', consonant: 'ㅁ', vowel: 'ㅏ', answer: '마', options: ['마', '바', '사', '자'] },
        { type: 'combine', consonant: 'ㅂ', vowel: 'ㅓ', answer: '버', options: ['버', '서', '저', '거'] },
        { type: 'combine', consonant: 'ㅅ', vowel: 'ㅗ', answer: '소', options: ['소', '보', '도', '고'] },
        { type: 'combine', consonant: 'ㅈ', vowel: 'ㅏ', answer: '자', options: ['자', '차', '카', '타'] }
      ]
    },
    {
      id: 4,
      title: '이름 첫 글자',
      subtitle: '포켓몬 이름을 듣고 첫 글자를 찾아요',
      icon: '🔍',
      theme: '#f59f00',
      tip: '이름을 듣고 첫 글자를 골라요',
      questions: [
        { type: 'first', pokemon: 25, answer: '피', options: ['피', '파', '꼬', '이'] },
        { type: 'first', pokemon: 4, answer: '파', options: ['파', '피', '바', '아'] },
        { type: 'first', pokemon: 7, answer: '꼬', options: ['꼬', '고', '포', '도'] },
        { type: 'first', pokemon: 1, answer: '이', options: ['이', '리', '시', '지'] },
        { type: 'first', pokemon: 133, answer: '이', options: ['이', '브', '비', '미'] },
        { type: 'first', pokemon: 39, answer: '푸', options: ['푸', '부', '프', '투'] },
        { type: 'first', pokemon: 143, answer: '잠', options: ['잠', '삼', '참', '담'] },
        { type: 'first', pokemon: 151, answer: '뮤', options: ['뮤', '무', '유', '뷰'] }
      ]
    },
    {
      id: 5,
      title: '이름 완성!',
      subtitle: '빈칸에 들어갈 글자를 찾아요',
      icon: '🏆',
      theme: '#20c997',
      tip: '이름을 듣고 빈칸에 들어갈 글자를 골라요',
      questions: [
        { type: 'fill', pokemon: 25, blank: 2, answer: '츄', options: ['츄', '추', '초', '치'] },
        { type: 'fill', pokemon: 7, blank: 1, answer: '부', options: ['부', '보', '브', '구'] },
        { type: 'fill', pokemon: 1, blank: 3, answer: '씨', options: ['씨', '시', '세', '새'] },
        { type: 'fill', pokemon: 133, blank: 1, answer: '브', options: ['브', '비', '부', '보'] },
        { type: 'fill', pokemon: 143, blank: 1, answer: '만', options: ['만', '맘', '반', '문'] },
        { type: 'fill', pokemon: 150, blank: 1, answer: '츠', options: ['츠', '추', '초', '치'] },
        { type: 'fill', pokemon: 149, blank: 2, answer: '뇽', options: ['뇽', '냥', '녕', '용'] },
        { type: 'fill', pokemon: 131, blank: 1, answer: '프', options: ['프', '파', '푸', '브'] }
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
