'use strict';
const $ = id => document.getElementById(id);
const ids = ['price','first','second','coupon'];
const storageKey = 'stance-stacked-discount-v1';
const won = value => Math.round(value).toLocaleString('ko-KR') + '원';
let copyText = '';

function resetResult(){ $('result').hidden=true; $('empty').hidden=false; $('error').textContent=''; $('copyStatus').textContent=''; copyText=''; }
function persist(){ try{ if($('remember').checked){localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(ids.map(id=>[id,$(id).value]))));$('storage').textContent='이 브라우저에 할인 조건을 저장했습니다.';}else{localStorage.removeItem(storageKey);$('storage').textContent='할인 조건을 저장하지 않습니다.';} }catch{$('storage').textContent='기기 저장을 사용할 수 없습니다. 계산은 계속할 수 있습니다.';} }
function render(){ resetResult(); try{const r=calculateDiscount(...ids.map(id=>$(id).value));$('final').textContent=won(r.finalPrice);$('saved').textContent=won(r.saved);$('rate').textContent=r.effectiveRate.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';$('stage1').textContent=won(r.afterFirst);$('stage2').textContent=won(r.afterSecond);$('couponUsed').textContent='-'+won(r.couponApplied);$('notice').textContent=r.couponLimited?'쿠폰이 할인 후 가격보다 커서 결제액을 0원으로 제한했습니다.':'할인율은 단순히 더하지 않고 입력 순서대로 적용했습니다.';copyText='최종 '+won(r.finalPrice)+' · 절약 '+won(r.saved)+' · 실질 할인율 '+r.effectiveRate.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';$('empty').hidden=true;$('result').hidden=false;}catch(error){$('error').textContent=error.message;} }
$('form').addEventListener('submit',event=>{event.preventDefault();persist();render();});
ids.forEach(id=>$(id).addEventListener('input',()=>{resetResult();persist();}));
$('remember').addEventListener('change',persist);
$('sample').addEventListener('click',()=>{['100000','20','10','5000'].forEach((value,index)=>$(ids[index]).value=value);persist();render();});
$('clear').addEventListener('click',()=>{ids.forEach(id=>$(id).value='');resetResult();persist();$('price').focus();});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(copyText);$('copyStatus').textContent='결과를 복사했습니다.';}catch{$('copyStatus').textContent='복사 권한이 없습니다. 위 결과를 직접 선택해 주세요.';}});
try{const saved=JSON.parse(localStorage.getItem(storageKey)||'null');if(saved&&typeof saved==='object'&&ids.every(id=>typeof saved[id]==='string')){ids.forEach(id=>$(id).value=saved[id]);$('remember').checked=true;$('storage').textContent='저장된 할인 조건을 불러왔습니다.';if(ids.every(id=>$(id).value!==''))render();}}catch{$('storage').textContent='저장된 조건을 불러오지 못했습니다.';}
let installEvent;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;$('install').hidden=false;});
$('install').addEventListener('click',async()=>{if(!installEvent)return;await installEvent.prompt();installEvent=null;$('install').hidden=true;});
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready).then(()=>{$('offline').textContent='오프라인 준비 완료 · 인터넷 없이도 다시 계산할 수 있습니다.';}).catch(()=>{$('offline').textContent='오프라인 준비에 실패했습니다. 온라인 계산은 가능합니다.';});}else{$('offline').textContent='이 브라우저는 오프라인 설치를 지원하지 않습니다.';}
