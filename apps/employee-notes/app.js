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
catalog();reader();lab();
if('serviceWorker'in navigator&&['https:','http:'].includes(location.protocol)){
 addEventListener('load',()=>navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname}).then(()=>navigator.serviceWorker.ready).then(r=>{if(r.active)r.active.postMessage({type:'CACHE_PAGE',url:location.href});}).catch(e=>console.warn('Offline unavailable',e)));
}
})();