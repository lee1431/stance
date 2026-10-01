const PREFIX='employee-notes-',CACHE=PREFIX+'v8',ROOT=new URL('./',self.location.href);
const CORE=['./','index.html','style.css','app.js?v=3','app.js?v=4','app.js?v=5','app.js?v=6','app.js?v=7','posts.json','cover.svg','posts/002-stale-screen/','posts/002-stale-screen/cover.svg','posts/003-web-push/','posts/003-web-push/cover.svg','posts/004-durable-save/','posts/004-durable-save/cover.svg','posts/005-event-loop/','posts/005-event-loop/cover.svg','posts/006-login-session/','posts/006-login-session/cover.svg','posts/007-unread-consent/','posts/007-unread-consent/cover.svg','thumbnail.svg','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE.map(p=>new Request(new URL(p,ROOT).href,{cache:'reload'}))))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const req=e.request,u=new URL(req.url);
 if(req.method!=='GET'||u.origin!==ROOT.origin||!u.pathname.startsWith(ROOT.pathname))return;
 e.respondWith((async()=>{
  const c=await caches.open(CACHE),content=req.mode==='navigate'||u.pathname.endsWith('.json');
  if(!content){const old=await c.match(req);if(old)return old;}
  try{const r=await fetch(req);if(r.ok&&r.type==='basic'){try{await c.put(req,r.clone())}catch{}}return r;}
  catch{const old=await c.match(req);if(old)return old;
   if(req.mode==='navigate')return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>오프라인</title><body style="padding:40px;font-family:sans-serif;line-height:1.8"><h1>아직 저장하지 않은 글입니다.</h1><p>연결 후 한 번 연 글을 오프라인으로 읽을 수 있습니다. 브라우저의 저장 공간 정책에 따라 캐시는 삭제될 수 있습니다.</p><a href="'+ROOT.pathname+'">글 목록으로</a></body></html>',{status:503,headers:{'Content-Type':'text/html;charset=utf-8'}});
   return new Response('',{status:503});
  }
 })());
});
self.addEventListener('message',e=>{
 if(!e.data||e.data.type!=='CACHE_PAGE')return;
 try{const u=new URL(e.data.url);if(u.origin!==ROOT.origin||!u.pathname.startsWith(ROOT.pathname)||!(u.pathname.endsWith('/')||u.pathname.endsWith('.html')))return;u.hash='';e.waitUntil(caches.open(CACHE).then(c=>c.add(new Request(u.href,{cache:'reload'}))).catch(()=>{}));}catch{}
});
