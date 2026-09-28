'use strict';
const $=id=>document.getElementById(id);
const ids=['hours','minutes','speed'];
const storageKey='stance-playback-time-v1';
let copyText='';

function resetResult(){$('result').hidden=true;$('empty').hidden=false;$('error').textContent='';$('copyStatus').textContent='';copyText='';}
function persist(){try{if($('remember').checked){localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(ids.map(id=>[id,$(id).value]))));$('storage').textContent='이 브라우저에 영상 조건을 저장했습니다.';}else{localStorage.removeItem(storageKey);$('storage').textContent='영상 조건을 저장하지 않습니다.';}}catch{$('storage').textContent='기기 저장을 사용할 수 없습니다. 계산은 계속할 수 있습니다.';}}
function render(){resetResult();try{const r=calculatePlayback(...ids.map(id=>$(id).value));$('watch').textContent=formatDuration(r.watchSeconds);$('original').textContent=formatDuration(r.originalSeconds);$('difference').textContent=formatDuration(r.differenceSeconds);$('differenceLabel').firstChild.textContent=r.direction==='added'?'추가로 필요한 시간 ':'절약되는 시간 ';$('speedResult').textContent=r.speed+'×';$('meterFill').style.width=Math.min(100,r.watchSeconds/r.originalSeconds*100)+'%';$('notice').textContent=r.direction==='same'?'1배속이라 원래 영상 길이와 같습니다.':r.direction==='saved'?'원래 영상보다 '+formatDuration(r.differenceSeconds)+' 빠르게 끝납니다.':'원래 영상보다 '+formatDuration(r.differenceSeconds)+' 더 필요합니다.';copyText=r.speed+'배속 시 '+formatDuration(r.watchSeconds)+' · '+(r.direction==='added'?'추가 ':'절약 ')+formatDuration(r.differenceSeconds);$('empty').hidden=true;$('result').hidden=false;}catch(error){$('error').textContent=error.message;}}
$('form').addEventListener('submit',event=>{event.preventDefault();persist();render();});
ids.forEach(id=>$(id).addEventListener('input',()=>{resetResult();persist();}));
document.querySelectorAll('[data-speed]').forEach(button=>button.addEventListener('click',()=>{$('speed').value=button.dataset.speed;persist();if($('hours').value!==''&&$('minutes').value!=='')render();}));
$('remember').addEventListener('change',persist);
$('sample').addEventListener('click',()=>{['2','30','1.5'].forEach((value,index)=>$(ids[index]).value=value);persist();render();});
$('clear').addEventListener('click',()=>{ids.forEach(id=>$(id).value='');resetResult();persist();$('hours').focus();});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(copyText);$('copyStatus').textContent='결과를 복사했습니다.';}catch{$('copyStatus').textContent='복사 권한이 없습니다. 위 결과를 직접 선택해 주세요.';}});
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved&&typeof saved==='object'&&ids.every(id=>typeof saved[id]==='string')){ids.forEach(id=>$(id).value=saved[id]);$('remember').checked=true;$('storage').textContent='저장된 영상 조건을 불러왔습니다.';if(ids.every(id=>$(id).value!==''))render();}}catch{$('storage').textContent='저장된 조건을 불러오지 못했습니다.';}
let installEvent;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;$('install').hidden=false;});
$('install').addEventListener('click',async()=>{if(!installEvent)return;await installEvent.prompt();installEvent=null;$('install').hidden=true;});
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready).then(()=>{$('offline').textContent='오프라인 준비 완료 · 인터넷 없이도 다시 계산할 수 있습니다.';}).catch(()=>{$('offline').textContent='오프라인 준비에 실패했습니다. 온라인 계산은 가능합니다.';});}else{$('offline').textContent='이 브라우저는 오프라인 설치를 지원하지 않습니다.';}
