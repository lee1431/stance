(() => {
'use strict';
const $=s=>document.querySelector(s);
const base=new URL('./',document.currentScript.src||'https://llsshh.com/apps/employee-notes/');
const store={get(k){try{return localStorage.getItem('employee-notes:'+k)}catch{return null}},set(k,v){try{localStorage.setItem('employee-notes:'+k,String(v))}catch{}}};
let timer;function notice(s){const t=$('#toast');if(!t)return;t.textContent=s;t.hidden=false;clearTimeout(timer);timer=setTimeout(()=>t.hidden=true,3500);}
function filter(){const q=$('#search').value.trim().toLowerCase();let n=0;document.querySelectorAll('.post-row').forEach(r=>{r.hidden=!(r.dataset.search||r.textContent).toLowerCase().includes(q);if(!r.hidden)n++;});$('#result-count').textContent=String(n).padStart(2,'0');$('#no-results').hidden=n!==0;}
function postURL(p){const u=new URL(p,base);if(u.origin!==base.origin||!u.pathname.startsWith(base.pathname+'posts/'))throw Error('Invalid post URL');return u.href;}
async function catalog(){
 if(!$('#post-list'))return;
 $('#search').addEventListener('input',filter);
 if(location.protocol==='file:'){filter();return;}
 try{
  const res=await fetch(new URL('posts.json',base),{cache:'no-cache'});if(!res.ok)throw Error('HTTP '+res.status);
  const data=await res.json();if(!Array.isArray(data.posts))throw Error('Invalid catalog');
  const seen=new Set();const posts=data.posts.filter(p=>{
   if(!p||typeof p.title!=='string'||typeof p.path!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date||''))return false;
   try{postURL(p.path)}catch{return false}if(seen.has(p.path))return false;seen.add(p.path);return true;
  }).sort((a,b)=>b.date.localeCompare(a.date)||(b.number||0)-(a.number||0));
  if(!posts.length)throw Error('Empty catalog');
  const fragment=document.createDocumentFragment();
  posts.forEach(p=>{
   const row=document.createElement('a');row.className='post-row';row.href=postURL(p.path);
   row.dataset.search=[p.title,p.description||'',p.series||'',...(Array.isArray(p.tags)?p.tags:[])].join(' ');
   const number=document.createElement('span');number.className='row-number';number.textContent=String(p.number||'').padStart(2,'0');
   const text=document.createElement('div'),h=document.createElement('h3'),d=document.createElement('p');
   h.textContent=p.title;d.textContent=p.description||'';text.append(h,d);
   const date=document.createElement('time');date.className='row-date';date.dateTime=p.date;date.textContent=p.date.replaceAll('-','.');
   row.append(number,text,date);fragment.append(row);
  });$('#post-list').replaceChildren(fragment);
  const p=posts[0];$('#featured-title').textContent=p.title;$('#featured-description').textContent=p.description||'';
  for(const id of ['featured-title-link','featured-cover-link','featured-read'])$('#'+id).href=postURL(p.path);
  $('#featured-cover-link').setAttribute('aria-label',p.title+' 읽기');
  $('#featured-issue').textContent='ISSUE '+String(p.number||'').padStart(2,'0');
  $('#featured-date').textContent=p.date.replaceAll('-','.');$('#featured-date').dateTime=p.date;
  $('#featured-series').textContent=p.series||'기술 읽을거리';
  if(p.cover){const u=new URL(p.cover,base);if(u.origin===base.origin&&u.pathname.startsWith(base.pathname))$('#featured-cover').src=u.href;}
  $('#featured-cover').alt=p.cover_alt||p.title+' 표지';
  $('#catalog-state').textContent='게시글 '+posts.length+'편 · 새 글은 이 목록 안에 쌓입니다.';
 }catch(e){console.warn('Catalog fallback',e);$('#catalog-state').textContent='기본 목록을 표시합니다. 새 목록은 연결 후 다시 확인해 주세요.';}
 filter();
}
function reader(){
 const prose=$('#article-body');if(!prose)return;
 let size=Number(store.get('font'));if(![17,19,21].includes(size))size=19;
 function apply(){prose.style.setProperty('--article-size',size+'px');$('#font-small').disabled=size===17;$('#font-large').disabled=size===21;}
 apply();$('#font-small').onclick=()=>{size=Math.max(17,size-2);apply();store.set('font',size);};$('#font-large').onclick=()=>{size=Math.min(21,size+2);apply();store.set('font',size);};
 const key='progress:'+location.pathname.replace(/index\.html$/,'');const old=Number(store.get(key));
 const bounds=()=>({top:prose.getBoundingClientRect().top+scrollY,range:Math.max(1,prose.scrollHeight-innerHeight+100)});
 if(old>.03&&old<.97){const r=$('#resume');r.hidden=false;r.textContent='이어서 읽기 '+Math.round(old*100)+'%';r.onclick=()=>{const b=bounds();scrollTo({top:b.top+b.range*old,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});r.hidden=true;};}
 let pending=false;function progress(save){const b=bounds();const v=Math.max(0,Math.min(1,(scrollY-b.top)/b.range));$('#read-progress').value=Math.round(v*100);if(save&&scrollY>b.top)store.set(key,v);}
 progress(false);addEventListener('resize',()=>progress(false));addEventListener('scroll',()=>{if(!pending){pending=true;requestAnimationFrame(()=>{progress(true);pending=false;});}},{passive:true});
 $('#share').onclick=async()=>{
  const u=document.querySelector('link[rel="canonical"]').href;
  try{if(navigator.share)await navigator.share({title:document.title,url:u});else if(navigator.clipboard&&isSecureContext){await navigator.clipboard.writeText(u);notice('글 주소를 복사했습니다.');}else prompt('복사할 글 주소',u);}
  catch(e){if(e.name!=='AbortError')notice('공유하지 못했습니다. 주소창의 주소를 복사해 주세요.');}
 };
}
function lab(){
 if(!$('#delivery-lab'))return;
 let count=0,sent=false,stored=false,useKey=false;
 const show=(state,text)=>{$('#sender-state').textContent=state;$('#stored-count').textContent=count;$('#demo-log').textContent=text;};
 const reset=()=>{count=0;sent=false;stored=false;$('#retry-demo').disabled=true;show('아직 보내지 않음','조건을 바꾸면 실험이 초기화됩니다. 실제 통신은 하지 않습니다.');};
 $('#scenario').onchange=reset;$('#dedupe').onchange=reset;
 $('#send-demo').onclick=()=>{
  const mode=$('#scenario').value;useKey=$('#dedupe').checked;sent=true;stored=mode!=='request-lost';count=stored?1:0;$('#retry-demo').disabled=false;
  if(mode==='normal')show('서버 저장 확인','요청 42가 저장되고 응답도 도착했습니다. 상대방의 읽음을 뜻하지는 않습니다.');
  else if(stored)show('결과 확인 못 함','서버에는 이미 1건이 있습니다. 응답만 사라져 보내는 쪽은 결과를 확인하지 못했습니다.');
  else show('결과 확인 못 함','요청이 도착하지 않은 상황입니다. 실제 타임아웃만으로는 저장 여부를 확정할 수 없습니다.');
 };
 $('#retry-demo').onclick=()=>{
  if(!sent)return;const duplicate=useKey&&stored;if(!duplicate){count++;stored=true;}
  show('서버 저장 확인',duplicate?'연결 복구 후 같은 요청 42를 보냈습니다. 이전 결과를 반환하므로 추가 저장되지 않았습니다.':count>1?'연결 복구 후 요청을 다시 처리하여 중복 메시지가 생겼습니다.':'연결 복구 후 이번에 처음 저장되었습니다.');
 };
}
function cacheLab(){
 if(!$('#cache-lab'))return;
 let server=2;
 const http=$('#http-cache-state'),worker=$('#worker-strategy');
 const show=(screen,message)=>{$('#server-version').textContent='v'+server;$('#screen-version').textContent=screen;$('#cache-log').textContent=message;};
 $('#cache-request').onclick=()=>{
  if(worker.value==='cache-first'){
   show('v1','서비스 워커가 Cache Storage의 v1 응답을 먼저 반환했습니다. 네트워크와 현재 서버는 확인하지 않았습니다.');
   return;
  }
  if(http.value==='fresh-old'){
   show('v1','네트워크 경로를 선택했지만 HTTP 캐시의 v1 응답이 아직 신선해 원본 서버에 재검증하지 않았습니다.');
   return;
  }
  if(http.value==='stale-old'){
   show('v'+server,'HTTP 캐시가 v1 검증을 요청했고 서버의 버전이 달라 새 본문 v'+server+'를 받았습니다.');
   return;
  }
  show('v'+server,'저장된 응답이 없어 원본 서버의 현재 본문 v'+server+'를 받았습니다.');
 };
 $('#cache-deploy').onclick=()=>{server=3;show($('#screen-version').textContent,'서버는 v3로 바뀌었습니다. 이미 저장된 v1 응답과 현재 화면은 저절로 교체되지 않습니다.');};
 $('#cache-reset').onclick=()=>{server=2;http.value='fresh-old';worker.value='cache-first';show('아직 요청 안 함','서버는 v2지만, 앞선 저장 층이 먼저 답할 수 있습니다.');};
 http.onchange=()=>show('아직 요청 안 함','HTTP 캐시 조건을 바꿨습니다. 페이지 요청으로 선택 결과를 확인하세요.');
 worker.onchange=()=>show('아직 요청 안 함','서비스 워커 전략을 바꿨습니다. 페이지 요청으로 선택 결과를 확인하세요.');
}
function pushLab(){
 if(!$('#push-lab'))return;
 const device=$('#push-device'),ttl=$('#push-ttl'),permission=$('#push-permission');
 const show=(stage,result,message)=>{$('#push-stage').textContent=stage;$('#push-result').textContent=result;$('#push-log').textContent=message;};
 const reset=()=>show('아직 보내지 않음','—','세 조건을 고른 뒤 푸시 보내기를 눌러 보세요.');
 $('#push-send').onclick=()=>{
  const delay=device.value==='online'?0:device.value==='offline-short'?1200:10800;
  const lifetime=Number(ttl.value);
  if(delay>lifetime){show('푸시 서비스에서 만료','표시되지 않음','기기가 다시 연결되기 전에 TTL이 끝났습니다. 만료된 메시지는 전달하지 않습니다.');return;}
  if(permission.value==='denied'){show('브라우저까지 전달','표시 거부','메시지는 도달할 수 있어도 회수된 권한으로 시스템 알림을 표시할 수 없습니다.');return;}
  show('서비스 워커 처리','알림 표시','TTL 안에 기기가 연결됐고 권한도 허용되어 서비스 워커가 알림을 표시했습니다. 클릭이나 읽음까지 뜻하지는 않습니다.');
 };
 $('#push-reset').onclick=()=>{device.value='online';ttl.value='3600';permission.value='granted';reset();};
 for(const el of [device,ttl,permission])el.onchange=reset;
}
function saveLab(){
 if(!$('#save-lab'))return;
 let stage=0;
 const screen=$('#save-screen'),disk=$('#save-disk'),log=$('#save-log');
 const buttons=()=>{$('#save-write').disabled=stage<1;$('#save-sync').disabled=stage<2;};
 $('#save-edit').onclick=()=>{stage=1;screen.textContent='초안 B';log.textContent='최신 문장은 아직 앱 메모리에만 있습니다. 앱이 지금 종료되면 초안 A가 남습니다.';buttons();};
 $('#save-write').onclick=()=>{if(stage<1)return;stage=2;log.textContent='write가 성공해 운영체제 페이지 캐시에 들어갔습니다. 전원 차단 뒤 생존은 아직 약속하지 않습니다.';buttons();};
 $('#save-sync').onclick=()=>{if(stage<2)return;stage=3;disk.textContent='초안 B';log.textContent='fsync가 성공한 상태를 단순화했습니다. 최신 문장이 지속 저장 경계를 넘었습니다.';buttons();};
 $('#save-crash').onclick=()=>{
  if(stage<3){screen.textContent='초안 A';disk.textContent='초안 A';log.textContent=stage===2?'전원 차단으로 페이지 캐시의 변경이 사라졌다고 가정했습니다. 재부팅 뒤 초안 A가 보입니다.':'지속 저장 전의 변경이 사라져 초안 A가 보입니다.';}
  else{screen.textContent='초안 B';disk.textContent='초안 B';log.textContent='동기화 성공 뒤 전원이 끊겨도 이 모형에서는 초안 B가 남습니다.';}
  stage=0;buttons();
 };
 $('#save-reset').onclick=()=>{stage=0;screen.textContent='초안 A';disk.textContent='초안 A';log.textContent='아직 변경하지 않았습니다. 저장장치에는 초안 A가 있습니다.';buttons();};
}
function eventLoopLab(){
 if(!$('#event-loop-lab'))return;
 const mode=$('#loop-mode'),next=$('#loop-next');let step=0;
 const states={
  long:[['0 / 3','검색 전','긴 태스크 방식입니다. 다음 단계에서 클릭 처리를 시작합니다.'],['0 / 3','검색 전','DOM에는 찾는 중을 적었지만, 긴 계산이 같은 태스크를 점유합니다. 모형에서는 아직 화면을 갱신하지 않았습니다.'],['3 / 3','검색 전','계산과 완료 DOM 변경까지 끝났습니다. 화면 출력은 별도의 기회를 기다립니다.'],['3 / 3','검색 완료','이 모형이 선택한 렌더링 기회에서 최종 상태를 표시했습니다. 중간 문장은 보이지 않았습니다.']],
  micro:[['0 / 3','검색 전','마이크로태스크 사슬 방식입니다.'],['1 / 3','검색 전','클릭 처리 뒤 후속 계산을 마이크로태스크에 넣었습니다. 화면은 아직 검색 전입니다.'],['2 / 3','검색 전','후속 작업이 또 마이크로태스크를 추가합니다. 체크포인트가 이어져 이 모형에서는 화면 차례가 오지 않습니다.'],['3 / 3','검색 전','계산 사슬이 끝났고 DOM은 완료 상태입니다. 다음 단계에서 화면 기회를 선택합니다.'],['3 / 3','검색 완료','마이크로태스크가 비워진 뒤 이 모형의 화면 갱신 기회에서 결과를 표시했습니다.']],
  split:[['0 / 3','검색 전','미래 태스크로 나누는 방식입니다.'],['1 / 3','찾는 중 · 1 / 3','첫 묶음을 마치고 다음 태스크로 양보했습니다. 이 모형에서는 그 사이 화면 갱신 기회를 선택했습니다. 실제 렌더링이 매번 보장되는 것은 아닙니다.'],['2 / 3','찾는 중 · 2 / 3','다음 묶음 사이에도 입력과 화면을 처리할 기회를 열었습니다. 총 계산량은 그대로입니다.'],['3 / 3','검색 완료','마지막 묶음과 화면 반영이 끝났습니다. 취소나 조건 변경은 묶음 사이에 확인하도록 설계할 수 있습니다.']]
 };
 function show(){const list=states[mode.value],s=list[step];$('#loop-work').textContent=s[0];$('#loop-screen').textContent=s[1];$('#loop-log').textContent=s[2];next.disabled=step===list.length-1;}
 next.onclick=()=>{step=Math.min(step+1,states[mode.value].length-1);show();};
 const reset=()=>{step=0;show();};mode.onchange=reset;$('#loop-reset').onclick=reset;show();
}
catalog();reader();lab();cacheLab();pushLab();saveLab();eventLoopLab();
if('serviceWorker'in navigator&&['https:','http:'].includes(location.protocol)){
 addEventListener('load',()=>navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname}).then(()=>navigator.serviceWorker.ready).then(r=>{if(r.active)r.active.postMessage({type:'CACHE_PAGE',url:location.href});}).catch(e=>console.warn('Offline unavailable',e)));
}
})();
