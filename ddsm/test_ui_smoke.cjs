const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const read = p => fs.readFileSync(path.join(__dirname,p),'utf8');
const dom = new JSDOM(read('index.html'), {url:'https://llsshh.com/ddsm/',runScripts:'outside-only',pretendToBeVisual:true});
const w = dom.window, d = w.document, $ = id => d.getElementById(id);
const tick = () => new Promise(resolve => setTimeout(resolve,25));
let currentDay = {selected:1,rounds:[{no:1,stops:[
  {id:'a',waybill:'1234567890123',recipient:'첫 배송지',address:'충주시 금봉로 21',phone:'',memo:'',status:'pending',createdAt:'2026-11-26T01:00:00Z',lat:36.99,lng:127.92,scannedItems:[]},
  {id:'b',waybill:'1234567890124',recipient:'둘째 배송지',address:'충주시 금봉로 22',phone:'',memo:'',status:'pending',createdAt:'2026-11-26T01:01:00Z',lat:36.98,lng:127.91,scannedItems:[]}
]}]}, revision=1, mapState, autofocus=0, cameraStops=0, destinationWrites=0;
const clone = x => JSON.parse(JSON.stringify(x));
const response = data => Promise.resolve({ok:true,status:200,json:async()=>clone(data)});
w.localStorage.setItem('ddsm:center:driver:v1','d_a_'+'d'.repeat(64));
w.scrollTo=()=>{};
w.fetch=(url, opts={})=>{
  if(url.includes('work-day')) {
    if(opts.method==='PUT'){currentDay=JSON.parse(opts.body).day;revision++;return response({ok:true,revision});}
    return response({ok:true,revision,day:currentDay});
  }
  if(url.includes('waybill?'))return response({ok:true,master_waybill:'1234567890125',recipient:'최신 배송지',address:'충주시 금봉로 23',phone:'',lat:36.97,lng:127.93});
  if(url.endsWith('destination')){destinationWrites++;return response({ok:true});}
  throw Error('Unexpected fetch: '+url);
};
w.HTMLMediaElement.prototype.play=async()=>{};
w.HTMLMediaElement.prototype.pause=()=>{};
const track={getCapabilities:()=>({focusMode:['continuous']}),applyConstraints:async c=>{assert.equal(c.advanced[0].focusMode,'continuous');autofocus++;},stop:()=>cameraStops++};
Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})}});
w.BarcodeDetector=class {async detect(){return [];}};
w.DDSM_NaverMap={loadSdk:async()=>({}),open:()=>{},close:()=>{}};
w.DDSM_DeliveryMap={render:async(date,stops,callbacks,round)=>{mapState={stops,callbacks,round};},pause:()=>{},project:()=>({x:120,y:200}),showDraft:()=>{},clearDraft:()=>{}};
Object.defineProperties($('deliveryMapStage'),{clientWidth:{value:390},clientHeight:{value:680}});
Object.defineProperties($('mapPopup'),{offsetWidth:{value:144},offsetHeight:{value:220}});
Object.defineProperties($('pinPopup'),{offsetWidth:{value:235},offsetHeight:{value:120}});
w.eval(read('waybill.js'));w.eval(read('app.js'));
(async()=>{
  await tick();await tick();
  assert.equal(d.body.dataset.page,'scan');assert.ok(autofocus>0,'continuous autofocus requested');
  assert.match($('recentScans').firstElementChild.textContent,/둘째 배송지/);
  $('waybillInput').value='1234567890125';
  $('scanForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  assert.match($('recentScans').firstElementChild.textContent,/최신 배송지/);
  assert.equal(currentDay.rounds[0].stops.length,3);
  $('mapTab').click();await tick();
  assert.equal(d.body.dataset.page,'map');assert.ok(cameraStops>0);
  assert.equal(mapState.stops.length,3);
  mapState.callbacks.onSelect(mapState.stops[2].id,1);
  assert.ok(!$('mapPopup').classList.contains('hidden'));
  assert.equal($('orderWheel').getAttribute('aria-valuenow'),'3');
  $('orderWheel').dispatchEvent(new w.WheelEvent('wheel',{deltaY:40,bubbles:true,cancelable:true}));
  assert.equal($('orderWheel').getAttribute('aria-valuenow'),'1','wheel wraps');
  $('mapOrderSave').click();await tick();
  assert.equal(currentDay.rounds[0].stops[0].recipient,'최신 배송지');
  assert.ok($('mapPopup').classList.contains('hidden'));
  mapState.callbacks.onSelect('a',1);
  mapState.callbacks.onLongPress({lat:36.9,lng:127.9});
  assert.equal($('pinStopSelect').value,'a');
  $('pinSave').click();await tick();
  assert.equal(currentDay.rounds[0].stops.find(s=>s.id==='a').lat,36.9);
  assert.equal(destinationWrites,1);
  $('listTab').click();assert.equal(d.body.dataset.page,'list');
  assert.match($('stopList').firstElementChild.textContent,/최신 배송지/);
  assert.match($('stopList').firstElementChild.textContent,/완료/);
  $('scanTab').click();await tick();
  assert.equal(d.body.dataset.page,'scan');assert.ok(autofocus>=2);
  console.log('DDSM UI smoke OK');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>dom.window.close());
