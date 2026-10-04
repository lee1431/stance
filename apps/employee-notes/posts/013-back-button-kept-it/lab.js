(function(root){
'use strict';
function simulateReturn(mode,draft){
 const value=String(draft||'').trim();
 if(mode==='bfcache')return {document:'Document A · 메모리에서 복원',draft:value,event:'pageshow(true)',note:'기존 문서와 자바스크립트 메모리, 화면 상태가 함께 깨어났습니다.'};
 if(mode==='persisted')return {document:'Document B · 새로 생성',draft:value,event:'load → pageshow(false)',note:'새 문서를 만들고 방문 기록에 보존된 폼 값을 다시 놓았습니다.'};
 return {document:'Document C · 새 방문',draft:'(빈 초안)',event:'load → pageshow(false)',note:'같은 URL이지만 과거 항목 순회가 아닌 새 방문이라 초기 화면에서 시작했습니다.'};
}
if(typeof module!=='undefined'&&module.exports)module.exports={simulateReturn};
if(!root||!root.document)return;
const d=root.document,$=selector=>d.querySelector(selector),lab=$('#history-lab');
if(!lab)return;
const input=$('#draft-input'),mode=$('#return-mode'),leave=$('#leave-page'),back=$('#return-page'),reset=$('#reset-history'),marker=$('#page-marker'),url=$('#page-url'),doc=$('#document-state'),draft=$('#draft-state'),event=$('#event-state'),log=$('#history-log');
let savedDraft=input.value,away=false;
function syncDraft(){if(!away){savedDraft=input.value.trim();draft.textContent=savedDraft||'(빈 초안)';}}
function resetAll(){away=false;input.disabled=false;mode.disabled=false;leave.disabled=false;back.disabled=true;input.value='심야 택시 이용 사유';savedDraft=input.value;marker.textContent='신청서 항목 A';url.textContent='/expense/42';doc.textContent='Document A · 실행 중';draft.textContent=savedDraft;event.textContent='초기 load → pageshow(false)';log.className='demo-log';log.textContent='신청서 항목 A가 활성화되어 있습니다. 먼저 규정으로 이동하세요.';}
input.addEventListener('input',syncDraft);
leave.disabled=false;reset.disabled=false;
leave.addEventListener('click',()=>{savedDraft=input.value.trim();away=true;input.disabled=true;mode.disabled=true;leave.disabled=true;back.disabled=false;marker.textContent='규정 항목 B';url.textContent='/policy/expense';doc.textContent='Document Policy · 실행 중';draft.textContent='(신청서 화면 아님)';event.textContent='신청서 pagehide(?) → 규정 load';log.className='demo-log';log.textContent='신청서 항목 A는 한 걸음 뒤에 남았습니다. 선택한 방식으로 돌아오세요.';});
back.addEventListener('click',()=>{const result=simulateReturn(mode.value,savedDraft);away=false;marker.textContent=mode.value==='fresh'?'신청서 항목 C':'신청서 항목 A';url.textContent='/expense/42';doc.textContent=result.document;draft.textContent=result.draft;event.textContent=result.event;input.value=result.draft==='(빈 초안)'?'':result.draft;input.disabled=false;back.disabled=true;leave.disabled=false;mode.disabled=false;log.className='demo-log success';log.textContent=result.note;});
reset.addEventListener('click',resetAll);
resetAll();
})(typeof window!=='undefined'?window:null);
