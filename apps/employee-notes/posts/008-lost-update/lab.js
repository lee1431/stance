(() => {
  'use strict';
  const mode = document.querySelector('#update-mode');
  const next = document.querySelector('#update-next');
  const reset = document.querySelector('#update-reset');
  let step = 0;
  const states = {
    overwrite: [
      ['10 / v7', '초기 상태입니다. 두 입고의 의도한 합계는 12입니다.'],
      ['10 / v7', 'A가 10을 읽고 자기 화면에서 11을 계산합니다.'],
      ['10 / v7', 'B도 10을 읽고 자기 화면에서 11을 계산합니다.'],
      ['11 / v8', 'A의 값 11을 저장했습니다.'],
      ['11 / v9', 'B도 오래된 근거로 만든 11을 저장했습니다. 두 요청은 성공했지만 증가 하나가 사라졌습니다.']
    ],
    version: [
      ['10 / v7', '초기 상태입니다. 읽은 판본이 같은 경우에만 변경합니다.'],
      ['10 / v7', 'A가 10과 판본 7을 읽습니다.'],
      ['10 / v7', 'B도 10과 판본 7을 읽습니다.'],
      ['11 / v8', 'A의 조건 7이 일치합니다. 검사와 변경을 함께 수행해 판본 8로 바꿉니다.'],
      ['11 / v8', 'B의 조건 7은 현재 8과 다릅니다. 저장을 거절했습니다. B의 초안을 보존하고 최신 내용과 비교해야 합니다.']
    ],
    increment: [
      ['10 / v7', '초기 상태입니다. 오래된 계산 결과 대신 1 증가라는 연산을 보냅니다.'],
      ['10 / v7', 'A의 입고 1개를 증가 연산으로 준비합니다.'],
      ['10 / v7', 'B의 입고 1개도 별도의 증가 연산으로 준비합니다.'],
      ['11 / v8', 'A의 연산을 현재 값 10에 적용했습니다.'],
      ['12 / v9', 'B의 연산은 현재 값 11에 적용했습니다. 두 입고가 모두 반영되었습니다.']
    ]
  };
  function render() {
    const state = states[mode.value][step];
    document.querySelector('#update-value').textContent = state[0];
    document.querySelector('#update-step').textContent = step + ' / 4';
    document.querySelector('#update-log').textContent = state[1];
    next.disabled = step === 4;
  }
  next.addEventListener('click', () => { step = Math.min(4, step + 1); render(); });
  const restart = () => { step = 0; render(); };
  reset.addEventListener('click', restart);
  mode.addEventListener('change', restart);
  reset.disabled = false;
  render();
})();
