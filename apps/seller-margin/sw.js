const CACHE_PREFIX = "stance-seller-margin-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_PATH = "/apps/seller-margin/";
const ASSETS = [APP_PATH,`${APP_PATH}index.html`,`${APP_PATH}style.css`,`${APP_PATH}core.js`,`${APP_PATH}app.js`,`${APP_PATH}manifest.webmanifest`,`${APP_PATH}icon.svg`,`${APP_PATH}icon-192.png`,`${APP_PATH}icon-512.png`];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{const url=new URL(event.request.url);if(event.request.method!=="GET"||url.origin!==self.location.origin||!url.pathname.startsWith(APP_PATH))return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(event.request,response.clone()));return response}).catch(()=>caches.match(APP_PATH))))});
