'use strict';
const $ = id => document.getElementById(id);
const fields = ['width','height','target','axis'];
const key = 'stance-aspect-fit-v1';
let copyText = '';
function invalidate(){ $('result').hidden=true; $('empty').hidden=false; $('error').textContent=''; $('copyStatus').textContent=''; copyText=''; }
function save(){try{if($('remember').checked){localStorage.setItem(key,JSON.stringify(Object.fromEntries(fields.map(id=>[id,$(id).value]))));$('storage').textContent='이 브라우저에 입력값을 저장했습니다.';}else{localStorage.removeItem(key);$('storage').textContent='입력값을 저장하지 않습니다.';}}catch{$('storage').textContent='기기 저장을 사용할 수 없습니다. 계산은 계속할 수 있습니다.';}}
function calculate(){invalidate();try{const r=fitSize($('width').value,$('height').value,$('target').value,$('axis').value);$('size').textContent=r.width+' × '+r.height;$('ratio').textContent=r.ratio;$('scale').textContent=r.percent.toLocaleString('ko-KR',{maximumFractionDigits:4})+'%';$('rounding').textContent=r.rounded?'픽셀은 정수로 반올림했습니다. 원본 비율과 아주 작은 차이가 생길 수 있습니다.':'반올림 없이 원본 비율과 정확히 일치합니다.';copyText=$('size').textContent+' px · 원본 비율 '+r.ratio;$('empty').hidden=true;$('result').hidden=false;}catch(e){$('error').textContent=e.message;}}
$('form').addEventListener('submit',e=>{e.preventDefault();save();calculate();});
fields.forEach(id=>$(id).addEventListener('input',()=>{invalidate();save();}));
$('remember').addEventListener('change',save);
$('sample').addEventListener('click',()=>{['1920','1080','1200','width'].forEach((v,i)=>$(fields[i]).value=v);save();calculate();});
$('clear').addEventListener('click',()=>{fields.slice(0,3).forEach(id=>$(id).value='');$('axis').value='width';invalidate();save();$('width').focus();});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(copyText);$('copyStatus').textContent='결과를 복사했습니다.';}catch{$('copyStatus').textContent='복사 권한이 없습니다. 위 결과를 직접 선택해 복사해 주세요.';}});
try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&typeof saved==='object'&&fields.every(id=>typeof saved[id]==='string')){fields.forEach(id=>$(id).value=saved[id]);$('remember').checked=true;$('storage').textContent='저장된 입력값을 불러왔습니다.';if(fields.slice(0,3).every(id=>$(id).value))calculate();}}catch{$('storage').textContent='저장된 입력값을 불러오지 못했습니다.';}
let installEvent;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('install').hidden=false;});
$('install').addEventListener('click',async()=>{if(!installEvent)return;await installEvent.prompt();installEvent=null;$('install').hidden=true;});
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready).then(()=>{$('offline').textContent='오프라인 준비 완료 · 이 기기에서 다시 사용할 수 있습니다.';}).catch(()=>{$('offline').textContent='오프라인 준비에 실패했습니다. 온라인 계산은 가능합니다.';});}else{$('offline').textContent='이 브라우저는 오프라인 설치를 지원하지 않습니다.';}
