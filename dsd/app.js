'use strict';
// S21 Flask + NAVER Maps. Step 1 only: save stops, geocode, display names, toggle completion.
const $ = (id) => document.getElementById(id);
const CHUNGJU = {lat:36.991, lng:127.926};
const state = {stops:[], map:null, sdkReady:false, sdkLoading:false, markers:[], markerById:new Map(),
  activeRun:0, running:false, busyToggles:new Set(), tilesLoaded:false, resizeObserver:null, sdkScript:null, tileFailures:0,csrfToken:"",user:null,filter:"all",search:""};

function esc(value) {
  return String(value??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function status(message, error=false) {
  $('statusText').textContent=message;
  $('statusText').style.color=error?'#c33d35':'#63758c';
}
function apiState(message, mode='') { $('apiState').textContent=message; $('apiState').className='api-state '+mode; }
function errMessage(e) { return e?.message || String(e); }
function getSavedClientId(){try{return localStorage.getItem('deliveryMapClientId')||'';}catch(_){return '';}}
function saveClientId(id){try{localStorage.setItem('deliveryMapClientId',id);}catch(_){}}
const APP_BASE = window.location.pathname.replace(/[^/]*$/, '');
async function api(path,options={}) {
 const method=(options.method||'GET').toUpperCase();
 const response=await fetch(APP_BASE+String(path).replace(/^\/+/,''),{
  ...options,credentials:'same-origin',
  headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{}),
   ...(method!=='GET'?{'X-CSRF-Token':state.csrfToken}:{})}
 });
 if(response.status===401)throw new Error('LOGIN_REQUIRED');
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body.error||('HTTP '+response.status));
 return body;
}
function normalize(s) { return String(s||'').trim().replace(/\s+/g,' '); }
function newStop(name,address,extras={}) {
  return {name:String(name||'').trim()||'배송지',address:normalize(address),
    location:String(extras.location||''), qty:Number(extras.qty)||1};
}
function splitCsv(content) {
  const rows=[]; let row=[],field='',quoted=false;
  const text=String(content).replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"') {field+='"';i++;} else quoted=!quoted; }
    else if(c===','&&!quoted) {row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted) {
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field);field='';if(row.some(x=>x.trim()))rows.push(row);row=[];
    } else field+=c;
  }
  row.push(field);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
function parseCsv(content) {
  const rows=splitCsv(content);if(!rows.length)return [];
  const h=rows[0].map(v=>v.trim().toLowerCase().replace(/\s/g,''));
  const at=keys=>h.findIndex(v=>keys.includes(v));
  const ai=at(['도로명주소','주소','배송주소','address','roadaddress','지번주소']);
  if(ai<0)throw new Error('CSV에 주소 또는 도로명주소 열이 필요합니다.');
  const ni=at(['고객명','수령인','받는분','받는사람','수취인','성함','고객이름','상호명','상호','점포명','이름','name','recipient']);
  const di=at(['상세위치','상세주소','detail']);
  const qi=at(['배송수량','수량','qty','quantity']);
  return rows.slice(1).map(row=>newStop(ni<0?'':row[ni], row[ai], {
    location:di<0?'':row[di], qty:qi<0?1:row[qi]})).filter(s=>s.address);
}
function parseText(content) {
  return String(content).split(/\r?\n/).map(v=>v.trim()).filter(Boolean).map(line=>{
    let index=line.indexOf('|'); if(index<0)index=line.indexOf('\t');
    return index<0?newStop('',line):newStop(line.slice(0,index),line.slice(index+1));
  }).filter(s=>s.address);
}
function hasGeo(s) {return Number.isFinite(s.lat)&&Number.isFinite(s.lng)&&s.status==='mapped';}
function updateCounts() {
  const total=state.stops.length;
  $('totalCount').textContent=total;
  $('inputCount').textContent=total+'건';
  $('listCount').textContent=total+'건';
  $('pendingCount').textContent=state.stops.filter(s=>!s.completed).length;
  $('completedCount').textContent=state.stops.filter(s=>s.completed).length;
  $('failCount').textContent=state.stops.filter(s=>s.status==='failed').length;
  $('plotBtn').disabled=!state.sdkReady||!total||state.running;
  $('clearBtn').disabled=!state.stops.some(s=>s.completed)||state.running;
}
function renderStops() {
  const list=$('stopList'), y=list.scrollTop;
  if(!state.stops.length) {list.innerHTML='<div class="empty-list">고객 이름과 주소를 입력해 주세요.</div>';updateCounts();return;}
  list.innerHTML=state.stops.filter(s=>{
 const keyword=(s.name+' '+s.address+' '+(s.location||'')).toLowerCase();
 return (!state.search||keyword.includes(state.search))&&
  (state.filter==='all'||(state.filter==='pending'&&!s.completed)||
   (state.filter==='completed'&&s.completed)||(state.filter==='failed'&&s.status==='failed'));
}).slice(0,1000).map((s,i)=>`<div class="stop-row ${esc(s.status)} ${s.completed?'completed':''}">
    <span class="stop-no">${i+1}</span>
    <div class="stop-main"><span class="stop-name">${esc(s.name)}</span>
      <span class="stop-address">${esc(s.address)}${s.location?' · '+esc(s.location):''}</span>
      ${s.error?`<span class="stop-note">${esc(s.error)}</span>`:''}
    </div>
    <div class="stop-actions">
      <button type="button" class="toggle-action ${s.completed?'is-done':''}" data-toggle="${s.id}">${s.completed?'✓ 완료':'○ 미배송'}</button>
      <button type="button" data-focus="${s.id}">${hasGeo(s)?'보기':'미표시'}</button>
      <button type="button" class="delete-stop" data-delete="${s.id}">삭제</button>
    </div>
  </div>`).join('');
  list.scrollTop=y;
  list.querySelectorAll('[data-toggle]').forEach(el=>el.addEventListener('click',()=>toggleStop(Number(el.dataset.toggle))));
  list.querySelectorAll('[data-focus]').forEach(el=>el.addEventListener('click',()=>focusStop(Number(el.dataset.focus))));
  list.querySelectorAll('[data-delete]').forEach(el=>el.addEventListener('click',()=>deleteOne(Number(el.dataset.delete))));
  updateCounts();
}
function setMapHealth(message, kind='') {
  const node=$('mapHealth');
  node.textContent=message;
  node.className='map-health '+kind;
}
function mapStats() {
  const el=$('map');
  const r=el.getBoundingClientRect();
  const images=[...el.querySelectorAll('img')];
  const loaded=images.filter(x=>x.complete && x.naturalWidth>0).length;
  const broken=images.filter(x=>x.complete && x.naturalWidth===0).length;
  return {width:Math.round(r.width),height:Math.round(r.height),images:images.length,loaded,broken,
    markerObjects:state.markers.length,markerElements:el.querySelectorAll('.map-customer-marker').length};
}
function updateDiagnostics() {
  const v=mapStats();
  const lines=[
    `SDK: ${!!window.naver?.maps?.Map?'로드됨':'미로드'} / 지도 객체: ${!!state.map?'생성됨':'없음'}`,
    `지도 영역: ${v.width} × ${v.height}px`,
    `지도 이미지: ${v.images}개 / 정상 ${v.loaded}개 / 실패 ${v.broken}개`,
    `타일 로드 이벤트: ${state.tilesLoaded?'발생':'미확인'}`,
    `고객 마커 객체: ${v.markerObjects}개 / 화면 DOM: ${v.markerElements}개`,
    `주소 좌표: ${state.stops.filter(hasGeo).length}/${state.stops.length}개`,
    `웹 출처: ${location.origin}`,
    `접속 경로: ${APP_BASE}`
  ];
  $('diagnosticText').textContent=lines.join('\n');
  return v;
}
function checkMapRendering() {
  if(!state.sdkReady) return;
  const v=updateDiagnostics();
  if(v.width<120 || v.height<120) {
    setMapHealth('지도 영역 크기 오류 — 지도 진단을 확인하세요', 'error');
  } else if(v.loaded>0) {
    document.querySelector('.map-area').classList.add('has-map');
    setMapHealth(`지도 이미지 ${v.loaded}개 로드 · 마커 ${v.markerObjects}개`, 'ok');
  } else if(v.broken>0) {
    setMapHealth(`지도 이미지 ${v.broken}개 로드 실패 — 인증·도메인·Network 확인`, 'error');
  } else if(!state.tilesLoaded) {
    setMapHealth('SDK 연결됨 · 실제 지도 이미지 로딩 확인 중');
  } else {
    setMapHealth('타일 로드 이벤트 수신 · 지도 이미지 표시 확인 필요');
  }
  if(v.markerObjects && !v.markerElements) {
    setMapHealth('마커는 생성됐지만 화면 요소가 없습니다 — 지도 진단 확인', 'error');
  }
}
function resizeMap() {
  if(!state.sdkReady || !state.map) return;
  const box=$('map').getBoundingClientRect();
  if(box.width>0 && box.height>0) {
    state.map.setSize(new naver.maps.Size(Math.round(box.width),Math.round(box.height)));
  }
  checkMapRendering();
}
function setupMapObserver() {
  if('ResizeObserver' in window) {
    state.resizeObserver?.disconnect();
    let last='';
    state.resizeObserver=new ResizeObserver(entries=>{
      const r=entries[0].contentRect;
      const k=`${Math.round(r.width)}:${Math.round(r.height)}`;
      if(k===last)return;
      last=k;
      window.requestAnimationFrame(resizeMap);
    });
    state.resizeObserver.observe($('map'));
  } else window.addEventListener('resize', resizeMap);
  window.requestAnimationFrame(resizeMap);
  [700,2500,6500].forEach(ms=>setTimeout(checkMapRendering,ms));
}
function resetMarkers() {
  for(const marker of state.markers) marker.setMap(null);
  state.markers=[]; state.markerById.clear();
  $('fitBtn').disabled=true;
}
function refreshBadge() {
  $('mapBadge').textContent=`완료 ${state.stops.filter(s=>s.completed).length} / 전체 ${state.stops.length} · 마커 ${state.markers.length}`;
}
async function refreshStops(redraw=true) {
  const response=await api('/api/stops');
  state.stops=response.stops;
  renderStops();
  if(redraw&&state.sdkReady)drawMarkers();
  else refreshBadge();
}
async function addStops(items,source='직접 입력') {
  if(!items.length){status('입력된 배송지가 없습니다.',true);return;}
  try {
    const response=await api('/api/stops',{method:'POST',body:JSON.stringify({stops:items})});
    state.stops=response.stops;
    renderStops();if(state.sdkReady)drawMarkers();
    status(`${source}: ${response.added}곳을 S21 서버에 저장했습니다. 지도에 전체 표시를 누르세요.`);
    return true;
  } catch(e) {status(`저장 실패: ${errMessage(e)}`,true);return false;}
}
async function clearAll(){
 const n=state.stops.filter(s=>s.completed).length,pending=state.stops.length-n;
 if(!n){status('완료된 배송이 없습니다. 미배송은 모두 유지됩니다.');return;}
 if(!confirm('완료 '+n+'건만 삭제할까요?\n미배송 '+pending+'건은 유지됩니다.'))return;
 $('clearBtn').disabled=true;
 try{
  const result=await api('/api/stops/completed',{method:'DELETE'});
  state.stops=result.stops;renderStops();
  if(state.sdkReady)drawMarkers();else{resetMarkers();refreshBadge();}
  status('완료 '+result.deleted+'건 삭제 · 미배송 '+result.remaining+'건 보존');
 }catch(e){status('완료건 삭제 실패: '+errMessage(e),true);updateCounts();}
}
async function deleteOne(id) {
  const s=state.stops.find(v=>v.id===id); if(!s)return;
  if(!confirm(`${s.name} 배송지를 삭제할까요?`))return;
  try {
    await api(`/api/stops/${id}`,{method:'DELETE'});
    state.stops=state.stops.filter(v=>v.id!==id);
    renderStops();if(state.sdkReady)drawMarkers();else refreshBadge();
    status(s.name+' 배송지를 삭제했습니다.');
  } catch(e) {status('삭제 실패: '+errMessage(e),true);}
}
async function toggleStop(id) {
  const s=state.stops.find(v=>v.id===id);
  if(!s || state.busyToggles.has(id))return;
  state.busyToggles.add(id);
  try {
    const res=await api(`/api/stops/${id}`,{method:'PATCH',body:JSON.stringify({completed:!s.completed})});
    Object.assign(s,res.stop);
    const entry=state.markerById.get(id);
    if(entry)entry.marker.setIcon(markerIcon(s,entry.duplicateIndex));
    renderStops();refreshBadge();
    status(`${s.name}: ${s.completed?'배송 완료 (서버 저장됨)':'미배송으로 변경 (서버 저장됨)'}`);
  } catch(e) {status('상태 저장 실패: '+errMessage(e),true);}
  finally {state.busyToggles.delete(id);}
}
function markerIcon(s,duplicateIndex=0) {
  const col=Math.floor(duplicateIndex/5),row=duplicateIndex%5;
  return {content:`<div class="map-customer-marker ${s.completed?'is-completed':'is-pending'}" title="${esc(s.name)}: ${s.completed?'배송 완료':'미배송'}">
    <span class="customer-dot">${s.completed?'✓':''}</span><span class="customer-name">${esc(s.name)}</span></div>`,
    size:new naver.maps.Size(190,43), anchor:new naver.maps.Point(16-col*180,41+row*44)};
}
function fitAll() {
  if(!state.sdkReady)return;
  const valid=state.stops.filter(hasGeo);
  if(!valid.length)return;
  resizeMap();
  if(valid.length===1) {
    state.map.setCenter(new naver.maps.LatLng(valid[0].lat,valid[0].lng));state.map.setZoom(17);
  } else {
    const bounds=new naver.maps.LatLngBounds();
    valid.forEach(s=>bounds.extend(new naver.maps.LatLng(s.lat,s.lng)));
    state.map.fitBounds(bounds,{top:80,right:80,bottom:80,left:80});
  }
}
function drawMarkers() {
  if(!state.sdkReady)return;
  resetMarkers();
  const seen=new Map();
  state.stops.forEach(s=>{
    if(!hasGeo(s))return;
    const key=s.lat.toFixed(6)+','+s.lng.toFixed(6);
    const index=seen.get(key)||0;seen.set(key,index+1);
    const marker=new naver.maps.Marker({map:state.map,position:new naver.maps.LatLng(s.lat,s.lng),
      icon:markerIcon(s,index),title:`${s.name} · ${s.address}`,clickable:true});
    naver.maps.Event.addListener(marker,'click',()=>toggleStop(s.id));
    state.markers.push(marker);state.markerById.set(s.id,{marker,duplicateIndex:index});
  });
  $('fitBtn').disabled=!state.markers.length;
  fitAll();refreshBadge();
  window.requestAnimationFrame(checkMapRendering);
}
function focusStop(id) {
  const s=state.stops.find(v=>v.id===id);
  if(!s||!hasGeo(s)||!state.sdkReady)return;
  state.map.setCenter(new naver.maps.LatLng(s.lat,s.lng));state.map.setZoom(17);
  if(window.innerWidth<=740)closeWorkspace();
}
function geocode(address) {
  return new Promise((resolve,reject)=>{
    try {
      naver.maps.Service.geocode({query:address},(code,response)=>{
        if(code!==naver.maps.Service.Status.OK) {reject(new Error('네이버 주소 검색 API 오류'));return;}
        const a=response?.v2?.addresses?.[0];
        if(!a||!Number.isFinite(Number(a.x))||!Number.isFinite(Number(a.y))) {
          reject(new Error('주소 검색 결과 없음'));return;
        }
        resolve({lat:Number(a.y),lng:Number(a.x)});
      });
    } catch(e){reject(e);}
  });
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function plotAll() {
  if(state.running||!state.sdkReady||!state.stops.length)return;
  state.running=true;const run=++state.activeRun;
  $('plotText').textContent='주소 변환 중...';$('progressTrack').hidden=false;
  const groups=new Map();
  state.stops.forEach(s=>{if(!hasGeo(s))groups.set(s.address,true);});
  const addresses=[...groups.keys()];let cursor=0,processed=0,failed=0;
  if(!addresses.length){state.running=false;$('plotText').textContent='지도에 전체 표시';$('progressTrack').hidden=true;drawMarkers();renderStops();status('저장된 좌표로 마커를 표시했습니다.');return;}
  async function worker(){
    while(cursor<addresses.length&&run===state.activeRun){
      const address=addresses[cursor++];let result;
      try {result=await geocode(address);}
      catch(e){result={lat:null,lng:null,error:errMessage(e)};failed++;}
      if(run!==state.activeRun)return;
      try {
        await api('/api/geocode',{method:'POST',body:JSON.stringify({address,...result})});
        state.stops.filter(s=>s.address===address).forEach(s=>{
          s.lat=result.lat;s.lng=result.lng;s.status=result.lat!==null?'mapped':'failed';s.error=result.error||'';
        });
      } catch(e) {failed++;status('좌표 저장 실패: '+errMessage(e),true);}
      processed++;$('progressBar').style.width=`${Math.round(processed/addresses.length*100)}%`;
      status(`좌표 확인 ${processed}/${addresses.length}건`);
      if(processed%10===0||processed===addresses.length)renderStops();
      await sleep(200);
    }
  }
  await Promise.all(Array.from({length:Math.min(2,addresses.length)},worker));
  if(run!==state.activeRun)return;
  state.running=false;$('plotText').textContent='지도에 전체 표시';$('progressTrack').hidden=true;
  drawMarkers();renderStops();
  status(`지도 마커 ${state.markers.length}곳 표시 · 좌표 오류 ${failed}개. 마커 터치로 완료 처리.`,failed>0);
  if(window.innerWidth<=740&&state.markers.length)closeWorkspace();
}
function connectNaver(clientId) {
  if(!/^[a-zA-Z0-9_-]{5,100}$/.test(clientId)) {
    status('올바른 Client ID를 입력해 주세요.',true);return;
  }
  const old=getSavedClientId();
  if(state.sdkReady) {
    if(old!==clientId) {saveClientId(clientId);location.reload();}
    else {resizeMap();drawMarkers();status('지도 크기와 마커를 다시 갱신했습니다.');}
    return;
  }
  if(state.sdkLoading)return;
  state.sdkLoading=true;
  $('connectBtn').disabled=true;
  apiState('SDK 로딩 중');
  setMapHealth('네이버지도 SDK 연결 중...');
  status('네이버지도 SDK 로드 중...');
  const timer=setTimeout(()=>{
    if(state.sdkLoading) connectionFailed('SDK 연결 제한시간 초과 — Client ID, 등록된 Web 서비스 URL, Network 확인');
  },15000);
  function connectionFailed(message) {
    clearTimeout(timer);
    state.sdkLoading=false;
    $('connectBtn').disabled=false;
    apiState('연결 실패','error');
    setMapHealth(message,'error');
    status(message,true);
    if(state.sdkScript) {state.sdkScript.remove();state.sdkScript=null;}
  }
  function onReady() {
    if(!state.sdkLoading)return;
    try {
      if(!window.naver?.maps?.Map)throw new Error('지도 SDK Map 객체를 찾지 못했습니다.');
      if(!window.naver?.maps?.Service?.geocode)throw new Error('Geocoding 모듈을 찾지 못했습니다. Maps 권한을 확인하세요.');
      const frame=$('map');
      const rect=frame.getBoundingClientRect();
      if(rect.width<100||rect.height<100)throw new Error(`지도 영역 크기 오류: ${rect.width} × ${rect.height}`);
      state.map=new naver.maps.Map(frame,{
        center:new naver.maps.LatLng(CHUNGJU.lat,CHUNGJU.lng),
        zoom:13,
        mapTypeId:naver.maps.MapTypeId.NORMAL,
        size:new naver.maps.Size(Math.round(rect.width),Math.round(rect.height)),
        zoomControl:true,
        zoomControlOptions:{position:naver.maps.Position.TOP_RIGHT}
      });
      naver.maps.Event.addListener(state.map,'tilesloaded',()=>{
        state.tilesLoaded=true;
        checkMapRendering();
      });
      naver.maps.Event.addListener(state.map,'idle',checkMapRendering);
      clearTimeout(timer);
      state.sdkReady=true;
      state.sdkLoading=false;
      $('connectBtn').disabled=false;
      saveClientId(clientId);
      $('mapCover').hidden=true;
      apiState('SDK 연결됨','connected');
      setMapHealth('SDK 연결됨 · 도로 지도 타일 확인 중');
      setupMapObserver();
      drawMarkers();
      renderStops();
      status('네이버지도 SDK 초기화 완료. 이미지가 보이는지 지도 진단으로 확인할 수 있습니다.');
    } catch(e) {
      connectionFailed(errMessage(e));
    }
  }
  window.initDeliveryNaverMap=onReady;
  const script=document.createElement('script');
  state.sdkScript=script;
  script.dataset.naverSdk='1';
  script.src=`https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}&submodules=geocoder&callback=initDeliveryNaverMap`;
  script.onerror=()=>connectionFailed('네이버 SDK 로드 실패 — Client ID, 등록 도메인, Dynamic Map 권한을 확인하세요.');
  document.head.appendChild(script);
}
async function loadSample() {
  if(state.stops.length&&!confirm('예제 배송지 100개를 현재 배송지에 추가할까요?'))return;
  try {
    const r=await fetch(APP_BASE + 'data/chungju_100_delivery_stops.csv',{cache:'no-store'});
    if(!r.ok)throw new Error('예제 CSV 파일을 읽을 수 없습니다.');
    const items=parseCsv(await r.text());
    if(items.length!==100)throw new Error(`예제 ${items.length}개 발견 (100개 아님)`);
    await addStops(items,'충주시 100곳 예제');
  } catch(e){status('예제 로드 실패: '+errMessage(e),true);}
}
async function readFile(file) {
  if(!file)return;
  if(file.size>2*1024*1024){status('2MB 이하 파일만 지원합니다.',true);return;}
  try {
    const raw=await file.text(); const items=/\.txt$/i.test(file.name)?parseText(raw):parseCsv(raw);
    await addStops(items,file.name);
  }catch(e){status('파일 오류: '+errMessage(e),true);}
}
function selectTab(which) {
  const paste=which==='paste';
  $('pastePanel').hidden=!paste;$('filePanel').hidden=paste;
  $('pasteTab').classList.toggle('is-active',paste);$('fileTab').classList.toggle('is-active',!paste);
  $('pasteTab').setAttribute('aria-selected',String(paste));$('fileTab').setAttribute('aria-selected',String(!paste));
}

function setWorkspace(view){
 if(!['list','add','settings'].includes(view))return;
 document.querySelectorAll('[data-panel]').forEach(x=>x.hidden=x.dataset.panel!==view);
 document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
 document.querySelectorAll('[data-mobile-view]').forEach(x=>x.classList.toggle('active',x.dataset.mobileView===view));
 if(window.innerWidth<=740)document.body.classList.add('drawer-open');
}
function closeWorkspace(){
 document.body.classList.remove('drawer-open');
 document.querySelectorAll('[data-mobile-view]').forEach(x=>x.classList.toggle('active',x.dataset.mobileView==='map'));
 if(state.sdkReady)requestAnimationFrame(resizeMap);
}
function setupWorkspace(){
 document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',()=>setWorkspace(x.dataset.view)));
 document.querySelectorAll('[data-mobile-view]').forEach(x=>x.addEventListener('click',()=>{
  if(x.dataset.mobileView==='map')closeWorkspace();else setWorkspace(x.dataset.mobileView);
 }));
 $('stopSearch').addEventListener('input',e=>{state.search=e.target.value.toLowerCase().trim();renderStops();});
 document.querySelectorAll('[data-stop-filter]').forEach(x=>x.addEventListener('click',()=>{
  state.filter=x.dataset.stopFilter;
  document.querySelectorAll('[data-stop-filter]').forEach(y=>y.classList.toggle('active',y.dataset.stopFilter===state.filter));
  renderStops();
 }));
}
function adminMessage(message,failed=false){
 $('adminMessage').textContent=message;
 $('adminMessage').style.color=failed?'#b84a40':'#728198';
}
async function refreshUsers(){
 if(state.user?.role!=='admin')return;
 const data=await api('/api/users'),list=$('userList');
 list.innerHTML='';
 for(const u of data.users){
  const card=document.createElement('div');card.className='user-row';
  const head=document.createElement('div');head.className='user-main';
  const title=document.createElement('strong');title.textContent=u.username;
  const meta=document.createElement('span');meta.textContent=(u.role==='admin'?'관리자':'배송기사')+' · '+u.count+'건 · '+(u.active?'활성':'중지');
  head.append(title,meta);card.append(head);
  if(u.role!=='admin'){
   const actions=document.createElement('div');actions.className='user-actions';
   const activeBtn=document.createElement('button');activeBtn.type='button';activeBtn.textContent=u.active?'계정 중지':'활성화';
   activeBtn.onclick=async()=>{
    const active=!u.active;if(!confirm(active?'계정을 활성화할까요?':'계정을 중지할까요?'))return;
    try{await api('/api/users/'+u.id,{method:'PATCH',body:JSON.stringify({active})});await refreshUsers();}
    catch(e){adminMessage(errMessage(e),true);}
   };
   const pwd=document.createElement('input');pwd.type='password';pwd.placeholder='새 비밀번호 12자 이상';pwd.autocomplete='new-password';
   const resetBtn=document.createElement('button');resetBtn.type='button';resetBtn.textContent='비밀번호 변경';
   resetBtn.onclick=async()=>{
    if(pwd.value.length<12){adminMessage('비밀번호를 12자 이상 입력하세요.',true);return;}
    try{await api('/api/users/'+u.id,{method:'PATCH',body:JSON.stringify({password:pwd.value})});pwd.value='';adminMessage('비밀번호 변경 완료');}
    catch(e){adminMessage(errMessage(e),true);}
   };
   actions.append(activeBtn,pwd,resetBtn);card.append(actions);
  }
  list.append(card);
 }
}
async function initAccount(){
 const info=await api('/api/auth/me');
 state.user=info.user;state.csrfToken=info.csrfToken;
 $('currentUser').textContent=info.user.username;
 $('userBadge').textContent=info.user.role==='admin'?'관리자':'배송기사';
 if(info.user.role==='admin'){$('adminPanel').hidden=false;await refreshUsers();}
 $('logoutBtn').addEventListener('click',async()=>{
  try{await api('/api/auth/logout',{method:'POST'});location.href=APP_BASE+'login';}
  catch(e){status('로그아웃 오류: '+errMessage(e),true);}
 });
 $('createUserBtn').addEventListener('click',async()=>{
  try{
   await api('/api/users',{method:'POST',body:JSON.stringify({username:$('newUsername').value.trim(),password:$('newPassword').value})});
   $('newUsername').value='';$('newPassword').value='';await refreshUsers();adminMessage('사용자를 추가했습니다.');
  }catch(e){adminMessage('사용자 추가 실패: '+errMessage(e),true);}
 });
}
async function init() {
  setupWorkspace();
  $('pasteTab').addEventListener('click',()=>selectTab('paste'));
  $('fileTab').addEventListener('click',()=>selectTab('file'));
  $('applyTextBtn').addEventListener('click',async()=>{
    const text=$('addressText').value; const items=parseText(text);
    if(!items.length){status('고객명과 주소를 입력하세요.',true);return;}
    if(await addStops(items,'직접 입력')) $('addressText').value='';
  });
  $('quickAddBtn').addEventListener('click',async()=>{
    const name=$('quickName').value.trim(),address=$('quickAddress').value.trim();
    if(!address){status('주소를 입력하세요.',true);$('quickAddress').focus();return;}
    const before=state.stops.length; await addStops([newStop(name,address)],'고객 1명');
    if(state.stops.length>before){$('quickName').value='';$('quickAddress').value='';$('quickName').focus();}
  });
  for(const id of ['quickName','quickAddress'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter')$('quickAddBtn').click();});
  $('clearBtn').addEventListener('click',clearAll);
  $('sampleBtn').addEventListener('click',loadSample);
  $('plotBtn').addEventListener('click',plotAll);
  $('fitBtn').addEventListener('click',fitAll);
  $('diagnoseBtn').addEventListener('click',()=>{
    $('mapDiagnostics').hidden=!$('mapDiagnostics').hidden;
    updateDiagnostics();
  });
  $('closeDiagBtn').addEventListener('click',()=>$('mapDiagnostics').hidden=true);
  $('retryMapBtn').addEventListener('click',()=>{
    resizeMap();drawMarkers();
    setTimeout(checkMapRendering,600);
  });
  $('connectBtn').addEventListener('click',()=>connectNaver($('clientId').value.trim()));
  $('clientId').addEventListener('keydown',e=>{if(e.key==='Enter')$('connectBtn').click();});
  $('csvFile').addEventListener('change',e=>readFile(e.target.files?.[0]));
  for(const eventName of ['dragover','dragenter'])$('dropZone').addEventListener(eventName,e=>{e.preventDefault();$('dropZone').classList.add('is-dragging');});
  for(const eventName of ['dragleave','drop'])$('dropZone').addEventListener(eventName,e=>{e.preventDefault();$('dropZone').classList.remove('is-dragging');});
  $('dropZone').addEventListener('drop',e=>readFile(e.dataTransfer?.files?.[0]));
  try {
    await initAccount();
    await refreshStops(false);status(`${state.stops.length}곳의 배송지가 S21 서버에서 불러와졌습니다.`);
    const server=await api('/api/config');
    const clientId=getSavedClientId()||server.clientId;
    if(clientId){$('clientId').value=clientId;connectNaver(clientId);}
  }catch(e){if(errMessage(e)==='LOGIN_REQUIRED')location.href=APP_BASE+'login';else status('S21 연결 실패: '+errMessage(e),true);}
}
window.addEventListener('DOMContentLoaded',init);
