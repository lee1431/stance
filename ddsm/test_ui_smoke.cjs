const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const read = p => fs.readFileSync(path.join(__dirname,p),'utf8');
const dom = new JSDOM(read('index.html'), {url:'https://llsshh.com/ddsm/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
const w = dom.window, d = w.document, $ = id => d.getElementById(id);
const tick = () => new Promise(resolve => setTimeout(resolve,25));
const iosMode=process.env.DDSM_TEST_IOS==='1';
let showBarcode=false;
let currentDay = {selected:1,rounds:[{no:1,stops:[
  {id:'a',waybill:'1234567890123',recipient:'첫 배송지',address:'충주시 금봉로 21',phone:'',memo:'',status:'pending',createdAt:'2026-11-26T01:00:00Z',lat:36.99,lng:127.92,scannedItems:[]},
  {id:'b',waybill:'1234567890124',recipient:'둘째 배송지',address:'충주시 금봉로 22',phone:'',memo:'',status:'pending',createdAt:'2026-11-26T01:01:00Z',lat:36.98,lng:127.91,scannedItems:[]}
]}]}, revision=1, mapState, autofocus=0, cameraStops=0, destinationWrites=0;
const clone = x => JSON.parse(JSON.stringify(x));
const response = data => Promise.resolve({ok:true,status:200,json:async()=>clone(data)});
w.localStorage.setItem('ddsm:center:driver:v1','d_a_'+'d'.repeat(64));
w.scrollTo=()=>{};
w.confirm=()=>true;
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
w.HTMLDialogElement.prototype.close=function(){if(!this.hasAttribute('open'))return;this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
w.fetch=(url, opts={})=>{
  if(url.endsWith('connection/code-login')){
    codeRequests++;const req=JSON.parse(opts.body);
    if(req.code!=='01234567')return Promise.resolve({ok:false,status:403,json:async()=>({ok:false,error:'센터 코드가 틀렸거나 만료되었습니다.'})});
    if(!req.device)return response({ok:true,center:'a',name:'충주센터'});
    assert.equal(req.center,'a');assert.equal(req.device,'d'.repeat(64));
    return response({ok:true,token:'d_'+req.center+'_'+req.device,center:req.center,name:'충주센터'});
  }
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
let codeRequests=0;
if(!iosMode)w.BarcodeDetector=class {async detect(){return [];}};
else{
  const bundle=path.join(path.dirname(require.resolve('@zxing/browser/package.json')),'umd','zxing-browser.min.js');
  w.eval(fs.readFileSync(bundle,'utf8'));
  assert.ok(w.ZXingBrowser.BrowserMultiFormatOneDReader);
  const runs=[2,1,1,2,1,4,1,2,3,2,2,1,2,2,3,2,1,1,2,2,1,1,3,2,2,2,1,2,3,1,2,1,3,2,1,2,2,2,3,1,1,2,3,1,2,1,3,1,3,1,1,2,2,2,3,2,1,1,2,2,1,2,3,1,2,2,1,2,3,2,2,1,2,2,3,2,1,1,2,1,3,2,1,2,4,1,2,1,2,1,2,3,3,1,1,1,2];
  Object.defineProperties($('cameraVideo'),{readyState:{value:4},videoWidth:{value:1280},videoHeight:{value:720}});
  w.HTMLCanvasElement.prototype.getContext=function(){const canvas=this;return {drawImage(){},getImageData(){
    const width=canvas.width,height=canvas.height,data=new w.Uint8ClampedArray(width*height*4);data.fill(255);
    if(showBarcode){
      const scale=4,total=runs.reduce((a,b)=>a+b,0)*scale;let x=Math.floor((width-total)/2);
      for(let i=0;i<runs.length;i++){
        const next=x+runs[i]*scale;
        if(i%2===0)for(let yy=0;yy<height;yy++)for(let xx=x;xx<next;xx++){const j=(yy*width+xx)*4;data[j]=data[j+1]=data[j+2]=0;}
        x=next;
      }
    }
    return {data,width,height};
  }}};
}
w.localStorage.setItem('ddsm:device:v1:a','d'.repeat(64));
w.DDSM_NaverMap={loadSdk:async()=>({}),open:()=>{},close:()=>{}};
w.DDSM_DeliveryMap={render:async(date,stops,callbacks,round)=>{mapState={stops,callbacks,round};},pause:()=>{},project:()=>({x:120,y:200}),showDraft:()=>{},clearDraft:()=>{}};
Object.defineProperties($('deliveryMapStage'),{clientWidth:{value:390},clientHeight:{value:680}});
Object.defineProperties($('mapPopup'),{offsetWidth:{value:144},offsetHeight:{value:220}});
Object.defineProperties($('pinPopup'),{offsetWidth:{value:235},offsetHeight:{value:120}});
w.eval(read('waybill.js'));w.eval(read('center-link.js'));w.eval(read('app.js'));
(async()=>{
  await tick();await tick();
  assert.equal(d.body.dataset.page,'scan');assert.ok(autofocus>0,'continuous autofocus requested');
  assert.match($('recentScans').firstElementChild.textContent,/둘째 배송지/);
  if(iosMode){
    showBarcode=true;
    for(let i=0;i<30&&currentDay.rounds[0].stops.length!==3;i++)await new Promise(r=>setTimeout(r,100));
    showBarcode=false;
    assert.equal(currentDay.rounds[0].stops.length,3,'Safari-compatible engine decoded a real Code128 pixel frame');
  }else{
    $('waybillInput').value='1234567890125';
    $('scanForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await tick();await tick();
  }
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
  assert.equal($('roundScanCount').textContent,'3건 등록');
  $('settingsButton').click();
  assert.ok($('settingsDialog').open);
  assert.ok($('recoveryTools').classList.contains('hidden'));
  $('soundToggle').click();assert.equal(w.localStorage.getItem('ddsm:pref:sound'),'off');
  $('openStats').click();await tick();
  assert.ok($('statsDialog').open);
  assert.equal($('statsContent').querySelectorAll('.stats-metric').length,3);
  assert.match($('statsContent').textContent,/전체 배송3/);
  assert.match($('statsContent').textContent,/1회차/);
  $('statsPrev').click();await tick();
  assert.match($('statsStatus').textContent,/서버 저장 내역/);
  $('closeStats').click();await tick();
  $('settingsButton').click();$('openCenterSettings').click();
  assert.ok($('centerSettingsDialog').open);
  assert.match($('centerDetails').textContent,/연결되어/);
  $('logoutDriver').click();await tick();
  assert.equal(w.localStorage.getItem('ddsm:center:driver:v1'),null);
  assert.ok(!$('centerCodeForm').classList.contains('hidden'));
  assert.equal($('roundScanCount').textContent,'0건 등록');
  assert.equal(currentDay.rounds[0].stops.length,3,'logout does not delete server work');
  const camerasBefore=autofocus;
  $('centerCode').value='0123a4567';
  $('centerCode').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal($('centerCode').value,'01234567');
  $('centerCode').value='99999999';
  $('centerCodeForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  assert.match($('centerCodeStatus').textContent,/틀렸거나 만료/);
  assert.ok($('centerSettingsDialog').open);
  assert.equal(autofocus,camerasBefore,'login never opens the camera');
  assert.equal(w.localStorage.getItem('ddsm:center:driver:v1'),null);
  $('centerCode').value='01234567';
  $('centerCodeForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  assert.equal(codeRequests,3);
  assert.equal(w.localStorage.getItem('ddsm:center:driver:v1'),'d_a_'+'d'.repeat(64));
  assert.equal(w.localStorage.getItem('ddsm:center:name:v1:a'),'충주센터');
  assert.ok(!$('centerSettingsDialog').open);
  assert.equal($('roundScanCount').textContent,'3건 등록');
  console.log('DDSM UI smoke OK');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>dom.window.close());
