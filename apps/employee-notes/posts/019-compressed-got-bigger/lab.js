(()=>{'use strict';
const presets={
 repeat:'AAAAAAAAAAAAAAAAAAAAAAAA',
 mixed:'HELLO',
 unique:'ABCDEFGH12345678',
 korean:'가가가가가가나나나나',
 custom:''
};
const $=id=>document.getElementById(id),preset=$('compress-preset'),overhead=$('compress-overhead'),input=$('compress-input'),run=$('compress-run'),reset=$('compress-reset'),error=$('compress-error'),original=$('original-bytes'),payload=$('payload-bytes'),packed=$('packed-bytes'),verdict=$('compress-verdict'),runs=$('compress-runs');
if(!preset||!overhead||!input||!run||!reset)return;
const bytes=s=>new TextEncoder().encode(s).length;
function splitRuns(value){const chars=Array.from(value);const out=[];for(const ch of chars){const last=out[out.length-1];if(last&&last.ch===ch&&last.count<255)last.count++;else out.push({ch,count:1});}return out;}
function showError(message){error.textContent=message;error.hidden=false;verdict.textContent='입력을 확인한 뒤 다시 계산하세요.';}
function calculate(){const value=input.value;if(!value){showError('한 글자 이상 입력하세요.');return;}if(Array.from(value).length>120){showError('입력은 최대 120자까지 계산할 수 있습니다.');return;}error.hidden=true;const groups=splitRuns(value),sourceBytes=bytes(value),payloadBytes=groups.reduce((sum,g)=>sum+bytes(g.ch)+1,0),wrapper=Number(overhead.value),total=payloadBytes+wrapper,diff=total-sourceBytes,ratio=Math.abs(diff/sourceBytes*100).toFixed(1);original.textContent=`${sourceBytes} B`;payload.textContent=`${payloadBytes} B`;packed.textContent=`${total} B`;runs.textContent=groups.map(g=>`${g.ch.replace(/\s/g,'␠')}×${g.count}`).join('  ');verdict.className='lab-verdict '+(diff<0?'win':diff>0?'loss':'even');verdict.textContent=diff<0?`${-diff}바이트 절약 · 원본보다 ${ratio}% 작음`:diff>0?`${diff}바이트 증가 · 원본보다 ${ratio}% 큼`:'원본과 같은 크기 · 손익분기점';try{localStorage.setItem('employee-notes-compress-lab',JSON.stringify({value,wrapper}));}catch{}}
function choose(){if(preset.value!=='custom')input.value=presets[preset.value];input.readOnly=preset.value!=='custom';calculate();}
function restore(){preset.value='repeat';overhead.value='8';input.value=presets.repeat;input.readOnly=true;calculate();}
preset.addEventListener('change',choose);overhead.addEventListener('change',calculate);input.addEventListener('input',()=>{preset.value='custom';calculate();});run.addEventListener('click',calculate);reset.addEventListener('click',restore);restore();
})();
