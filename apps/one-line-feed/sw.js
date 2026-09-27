'use strict';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys()) if(key.startsWith('one-line-feed-')) await caches.delete(key);
 await self.clients.claim();
})()));
// Always use the network: never serve an old board or cache backend requests.
