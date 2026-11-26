const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
async function run(page,authenticated=true){
 const dom=new JSDOM(read('index.html'),{url:'https://llsshh.com/ddsm/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);
 let remote={selected:2,rounds:[{no:1,stops:[]},{no:2,stops:[{id:'a',waybill:'1234567890123',recipient:'기존 배송지',address:'충주시',status:'pending',lat:36.9,lng:127.8}]}]},rev=1,gets=0,prepares=0,mapState,cameraCalls=0;
 let held=null,fail=false;
 const clone=v=>JSON.parse(JSON.stringify(v));
 w.sessionStorage.setItem('ddsm:session:page:v1',page);
 if(authenticated)w.localStorage.setItem('ddsm:center:driver:v1','d_a_'+'d'.repeat(64));
 w.scrollTo=()=>{};w.HTMLMediaElement.prototype.pause=()=>{};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>{cameraCalls++;throw Error('unexpected camera');}}});
 w.DDSM_NaverMap={loadSdk:async()=>({})};
 w.DDSM_DeliveryMap={pause(){},clearDraft(){},prepareRefresh(){prepares++;},render:async(date,stops,cb,round)=>{mapState={stops,round};}};
 w.fetch=async(url,opts={})=>{
   assert.ok(url.includes('work-day'));assert.notEqual(opts.method,'PUT');
   gets++;
   if(fail)throw Error('network offline');
   if(held)await held;
   return {ok:true,status:200,json:async()=>({ok:true,revision:rev,day:clone(remote)})};
 };
 try{
   w.eval(read('waybill.js'));w.eval(read('center-link.js'));w.eval(read('app.js'));
   await tick();await tick();
   if(!authenticated){assert.equal(d.body.dataset.page,'scan');assert.equal(gets,0);return;}
   assert.equal(d.body.dataset.page,page);
   assert.ok($('homeScreen').classList.contains('hidden'));
   assert.ok(!$('deliveryScreen').classList.contains('hidden'));
   assert.equal(cameraCalls,0);
   assert.match($('stopList').textContent,/기존 배송지/);
   if(page==='list'){assert.equal($('listTab').getAttribute('aria-pressed'),'true');assert.ok(!$('listPanel').classList.contains('hidden'));return;}
   assert.equal(mapState.round,2);
   remote.rounds[1].stops[0].recipient='새 배송지';rev++;
   let release;held=new Promise(r=>release=r);
   $('mapRefresh').click();$('mapRefresh').click();
   assert.equal($('mapRefresh').disabled,true);
   assert.equal(gets,2);
   release();held=null;await tick();await tick();
   assert.equal($('mapRefresh').disabled,false);
   assert.equal(d.body.dataset.page,'map');
   assert.equal(mapState.round,2);
   assert.equal(mapState.stops[0].recipient,'새 배송지');
   assert.equal(prepares,1);
   assert.equal(cameraCalls,0);
   fail=true;$('mapRefresh').click();await tick();await tick();
   assert.equal(prepares,1);
   assert.equal($('mapRefresh').disabled,false);
   assert.equal(mapState.stops[0].recipient,'새 배송지');
   assert.match($('toast').textContent,/network offline/);
 }finally{dom.window.close();}
}
(async()=>{await run('list');await run('map');await run('list',false);console.log('Tab restoration and map refresh tests passed');})().catch(e=>{console.error(e);process.exitCode=1;});
