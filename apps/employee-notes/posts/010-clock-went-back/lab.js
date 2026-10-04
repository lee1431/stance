(() => {
  'use strict';
  function calculate(adjustment) {
    const n=Number(adjustment);
    if(!Number.isFinite(n)||n < -3600||n > 3600)return {error:'보정값을 계산할 수 없습니다.'};
    const work=20,wallDuration=work+n,endSeconds=wallDuration;
    const total=((10*3600+endSeconds)%86400+86400)%86400;
    const hh=String(Math.floor(total/3600)).padStart(2,'0');
    const mm=String(Math.floor(total%3600/60)).padStart(2,'0');
    const ss=String(total%60).padStart(2,'0');
    return {adjustment:n,wallDuration,monotonicDuration:work,end:`${hh}:${mm}:${ss}`};
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={calculate};
  if(typeof document==='undefined')return;
  const $=id=>document.getElementById(id),select=$('clock-adjust');
  if(!select)return;
  const render=result=>{
    if(result.error){$('clock-status').textContent=result.error;return;}
    $('clock-end').textContent=result.end;
    $('clock-wall-duration').textContent=(result.wallDuration>0?'+':'')+result.wallDuration+'초';
    $('clock-mono-duration').textContent=result.monotonicDuration+'초';
    $('clock-choice').textContent='벽시각 / 단조 기간';
    $('clock-status').textContent=result.adjustment===0?'보정이 없어 두 차이가 모두 20초입니다. 목적은 여전히 구분해야 합니다.':result.adjustment<0?'벽시계가 뒤로 이동해 기간이 음수가 됐습니다. 작업 경과는 단조 시계의 20초입니다.':'벽시계가 앞으로 이동해 기간이 부풀었습니다. 작업 경과는 단조 시계의 20초입니다.';
  };
  const reset=()=>{select.value='0';$('clock-end').textContent='아직 계산 전';$('clock-wall-duration').textContent='—';$('clock-mono-duration').textContent='—';$('clock-choice').textContent='—';$('clock-status').textContent='보정을 고른 뒤 계산해 보세요.';};
  $('clock-run').disabled=false;$('clock-reset').disabled=false;
  $('clock-run').addEventListener('click',()=>render(calculate(select.value)));
  $('clock-reset').addEventListener('click',reset);
  select.addEventListener('change',()=>{$('clock-status').textContent='선택을 바꿨습니다. 계산 버튼을 눌러 결과를 확인하세요.';});
})();
