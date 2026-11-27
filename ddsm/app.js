/* DDSM daily / scan / delivery. Center-scoped device delivery workflow. */
(function () {
  'use strict';

  const DRIVER_API_BASE = 'https://mrdindoin.ddns.net/ddsm/api/driver/';
  const TOKEN_KEY = 'ddsm:center:driver:v1';
  let driverToken = '';
  let connecting = null, syncFault=false, manualSyncBusy=false, mapRefreshBusy=false;
  const PAGE_KEY='ddsm:session:page:v1';
  let syncedDate = '', serverRevision = 0, syncBusy = false, syncPending = false, syncBlocked = false, syncEpoch = 0;
  const WORK_API = DRIVER_API_BASE + 'work-day';
  function invalidateDriverAuth(notify = false) {
    driverToken = '';syncFault=false;
    ++syncEpoch; syncedDate = ''; syncPending = false; syncBlocked = false;
    data = freshData(); closeMapPopup();
    if(view==='delivery')showView('home');else render();
    if (notify) toast('연결이 끊겼습니다. 센터 관리자에게 새 접속 코드를 요청하세요.');
  }
  async function restoreConnection() {
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const params = new URLSearchParams(location.hash.slice(1));
        if (params.has('center') && params.has('invite')) {
          location.replace('connect/' + location.hash); return false;
        }
        const token = localStorage.getItem(TOKEN_KEY) || '';
        if (!/^d_[A-Za-z0-9-]{1,40}_[A-Za-z0-9_-]{43,128}$/.test(token)) {
          toast('센터 코드를 입력하여 로그인하세요.'); return false;
        }
        driverToken = token;
        data = readData(); render();
        return await activateDay(date);
      } catch(e) { toast(e.message || '센터 연결 실패'); return false; }
    })();
    try { return await connecting; } finally { connecting=null; }
  }
  function archiveLocal(dayKey) {
    try {
      const item = data.days[dayKey];
      if (!item || !item.rounds?.some(r => r.stops?.length)) return;
      const key = activeStorageKey() + ':archive:' + dayKey;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(item));
    } catch (_) {}
  }
  async function serverDay(dayKey, token) {
    const res = await fetch(WORK_API+'?date='+encodeURIComponent(dayKey),{
      headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store'
    });
    const body = await res.json().catch(()=>null);
    if (res.status===401 && token===driverToken) invalidateDriverAuth(true);
    if (res.status===404) throw Error('G10 배송 작업 API가 없습니다. 서버 admin.py 업데이트 및 재시작이 필요합니다.');
    if (!res.ok || body?.ok!==true || !body.day) throw Error(body?.error||'서버 배송 목록 조회 실패');
    return body;
  }
  async function activateDay(dayKey = date) {
    const token=driverToken, epoch=++syncEpoch;
    syncedDate='';syncPending=false;syncBlocked=false;
    if (!token) return false;
    try {
      const remote=await serverDay(dayKey,token);
      if (epoch!==syncEpoch || token!==driverToken || date!==dayKey) return false;
      const local=data.days[dayKey];
      serverRevision=remote.revision;syncFault=false;
      // Only migrate a legacy day when the central day has never been written.
      if (!remote.revision && local?.rounds?.some(r=>r.stops?.length)) {
        archiveLocal(dayKey);
        syncedDate=dayKey;syncPending=true;render();
        await flushDay();
        return !syncBlocked && !syncPending && syncedDate===dayKey;
      }
      if (local && JSON.stringify(local)!==JSON.stringify(remote.day)) archiveLocal(dayKey);
      data.days[dayKey]=remote.day;
      syncedDate=dayKey;
      try { localStorage.setItem(activeStorageKey(),JSON.stringify(data)); } catch (_) {}
      render();return true;
    } catch(e) {
      if (epoch===syncEpoch) {syncFault=true;renderSettings();toast('서버 동기화 실패: '+e.message);}
      return false;
    }
  }
  async function flushDay() {
    if (syncBusy || !syncPending || syncBlocked || !driverToken || syncedDate!==date) return;
    syncBusy=true;renderSettings();
    const token=driverToken, dayKey=date, epoch=syncEpoch;
    try {
      while(syncPending && !syncBlocked && epoch===syncEpoch && syncedDate===dayKey) {
        syncPending=false;
        const snapshot=JSON.parse(JSON.stringify(day()));
        const res=await fetch(WORK_API,{
          method:'PUT',credentials:'omit',cache:'no-store',
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
          body:JSON.stringify({date:dayKey,revision:serverRevision,day:snapshot})
        });
        const body=await res.json().catch(()=>null);
        if(epoch!==syncEpoch || token!==driverToken) return;
        if(res.status===401) {
          if(token===driverToken) invalidateDriverAuth(true);
          break;
        }
        if(res.status===409) {
          syncBlocked=true;syncPending=false;
          toast('저장 충돌: 설정에서 작업 사본을 저장하고 센터에 문의하세요.');
          break;
        }
        if(!res.ok || body?.ok!==true) {
          syncFault=true;syncPending=true;
          toast('서버 저장 대기: '+(body?.error||'연결 오류'));break;
        }
        serverRevision=body.revision;syncFault=false;
      }
    } catch(_) {
      if(epoch===syncEpoch){syncFault=true;syncPending=true;toast('서버 연결 오류 · 자동 재전송 대기');}
    } finally {syncBusy=false;renderSettings();}
  }
  async function refreshDay() {
    if(!driverToken || syncedDate!==date || syncPending || syncBusy || syncBlocked || manualSyncBusy ||
       document.hidden || document.querySelector('dialog[open]') || scanWorkerActive || pendingScans.length || mapSelected || pinDraft) return;
    const token=driverToken, dayKey=date, epoch=syncEpoch;
    try {
      const remote=await serverDay(dayKey,token);
      if(epoch!==syncEpoch || token!==driverToken || date!==dayKey || syncPending || syncBusy || manualSyncBusy || scanWorkerActive || mapSelected || pinDraft) return;
      syncFault=false;renderSettings();
      if(remote.revision>serverRevision) {
        serverRevision=remote.revision;
        data.days[dayKey]=remote.day;
        try {localStorage.setItem(activeStorageKey(),JSON.stringify(data));}catch(_){}
        render();toast('다른 기기의 변경사항을 동기화했습니다.');
      }
    } catch(_) {if(token===driverToken&&dayKey===date){syncFault=true;renderSettings();}}
  }

  const activeStorageKey = () => driverToken ? 'ddsm:center:data:v1:' + driverToken : 'ddsm:center:offline:v1';
  const $ = id => document.getElementById(id);
  const today = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const makeId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const clean = (value, max = 250) => String(value == null ? '' : value).trim().slice(0, max);

  function freshData() { return { version: 1, days: {} }; }
  function isData(value) { return Boolean(value && value.version === 1 && value.days && typeof value.days === 'object' && !Array.isArray(value.days)); }
  function readData() {
    try {
      const raw = localStorage.getItem(activeStorageKey());
      const parsed = raw ? JSON.parse(raw) : freshData();
      return isData(parsed) ? parsed : freshData();
    } catch (_) { return freshData(); }
  }

  let data = readData();
  let date = today();
  function rememberedPage(){
    try{
      const token=localStorage.getItem(TOKEN_KEY)||'';
      const page=sessionStorage.getItem(PAGE_KEY);
      if(/^d_[A-Za-z0-9-]{1,40}_[A-Za-z0-9_-]{43,128}$/.test(token)&&['scan','map','list'].includes(page))return page;
    }catch(_){}
    return 'scan';
  }
  let view = 'home';
  let workTab = 'map';
  let mapSelected = null, pinDraft = null, wheelValue = 1, wheelDrag = null, wheelFrame = 0, wheelPosition = 1, wheelSettleTimer = 0;
  const recentScanTimes = new Map();
  let statsRequest=0;
  let codeLoginBusy=false;
  const pref=(key)=>{try{return localStorage.getItem('ddsm:pref:'+key)!=='off';}catch(_){return true;}};
  let scanSound=pref('sound'),scanVibration=pref('vibration');
  let editingId = '';
  let toastTimer = null;
  let cameraStream = null;
  let zxingControls = null;
  let nativeTimer = null;
  let cameraGeneration = 0;
  let lastCameraValue = '';
  let lastCameraAt = 0;
  let barcodeDecoder = null;
  function validCoordinates(item) {
    return item && Number.isFinite(item.lat) && Number.isFinite(item.lng)
      && item.lat >= -90 && item.lat <= 90 && item.lng >= -180 && item.lng <= 180;
  }
  function updateAddressMap() {
    if (!window.DDSM_NaverMap) return;
    const address = clean($('addressInput').value, 250);
    const stop = stops().find(x => x.id === editingId);
    const original = stop && clean(stop.address, 250) === address && validCoordinates(stop) ? { lat: stop.lat, lng: stop.lng } : null;
    window.DDSM_NaverMap.update(address, original);
  }
  function closeAddressMap() {
    if (window.DDSM_NaverMap) window.DDSM_NaverMap.close();
  }

  function persist() {
    if (!driverToken || syncedDate !== date || syncBlocked) { toast('센터 연결 및 동기화가 필요합니다.'); return false; }
    try {
      localStorage.setItem(activeStorageKey(),JSON.stringify(data));
      if(driverToken && syncedDate===date && !syncBlocked) {
        syncPending=true;void flushDay();
      } else if(driverToken && syncBlocked) {
        toast('저장 충돌: 설정에서 작업 사본을 저장하고 센터에 문의하세요.');
      }
      return true;
    } catch(_) {toast('브라우저 백업 저장 실패');return false;}
  }
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3300);
  }
  function day(create = true) {
    let found = data.days[date];
    if (!found && create) {
      found = { selected: 1, rounds: [{ no: 1, stops: [] }] };
      data.days[date] = found;
    }
    return found || null;
  }
  function round() {
    const d = day();
    if (!Array.isArray(d.rounds) || !d.rounds.length) d.rounds = [{ no: 1, stops: [] }];
    const active = d.rounds.find(r => r.no === d.selected);
    if (active) return active;
    d.selected = d.rounds[0].no;
    return d.rounds[0];
  }
  function stops() { return round().stops; }
  function counts() {
    const all = stops();
    return { total: all.length, done: all.filter(x => x.status === 'done').length, pending: all.filter(x => x.status !== 'done').length };
  }
  function dateText(value) {
    const parts = value.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return (value === today() ? '오늘 · ' : '') + parts[1] + '월 ' + parts[2] + '일 (' + '일월화수목금토'[d.getDay()] + ')';
  }
  function node(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(label, className, action) {
    const b = node('button', className, label);
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  }

  function renderHome() {
    $('myPhoneLabel').textContent = driverToken ? '동기화 확인' : '센터 연결 확인';
    $('myPhoneButton').classList.toggle('hidden',Boolean(driverToken&&syncedDate===date));
    $('dailyPhoneLabel').textContent = driverToken ? '배송 준비' : '연결 대기';
    document.documentElement.dataset.ddsmConnected = driverToken ? 'true' : 'false';
    const d = day();
    const active = round();
    const c = counts();
    $('dateLabel').textContent = dateText(date);
    $('dateInput').value = date;
    const select = $('roundSelect');
    select.replaceChildren();
    d.rounds.slice().sort((a, b) => a.no - b.no).forEach(r => {
      const opt = node('option', '', r.no + '회차');
      opt.value = String(r.no);
      select.append(opt);
    });
    select.value = String(active.no);
    $('scanHint').textContent = c.total + '건';
    $('roundScanCount').textContent=c.total+'건 등록';
    renderSettings();
    const recent = $('recentScans');
    recent.replaceChildren();
    const items = active.stops.slice().sort((a,b) =>
      (recentScanTimes.get(b.id)||Date.parse(b.createdAt)||0)-(recentScanTimes.get(a.id)||Date.parse(a.createdAt)||0));
    if (!items.length) recent.append(node('p','recent-empty','스캔된 운송장이 없습니다.'));
    for (const stop of items) {
      const row=node('article','recent-scan-row');
      const head=node('div','recent-scan-head');
      head.append(node('strong','',stop.recipient||stop.waybill));
      head.append(node('span','recent-scan-ok',stop.status==='done'?'배송 완료':'등록 완료'));
      row.append(head,node('div','recent-address',stop.address||'위치 미지정'),node('div','recent-meta',stop.waybill+(stop.scannedItems?.length?' · '+stop.scannedItems.length+'개 물품':'')));
      recent.append(row);
    }
  }
  function selectedRoundStops() {
    const selected = round();
    return (selected.stops || []).map((stop, index) => ({
      ...stop, roundNo: selected.no, position: index + 1
    }));
  }
  function persistGeocoded(dateKey, roundNo, id, address, coordinates) {
    if(proofBusy)return;
    const d = data.days[dateKey];
    const r = d && d.rounds.find(x => x.no === roundNo);
    const stop = r && r.stops.find(x => x.id === id);
    if (!stop || clean(stop.address, 250) !== address || validCoordinates(stop)) return;
    stop.lat = coordinates.lat;
    stop.lng = coordinates.lng;
    if (!persist()) { delete stop.lat; delete stop.lng; return; }
    if (dateKey === date && view === 'delivery') {
      // The map may geocode after the delivery list was rendered.
      // Refresh only the affected link, without rebuilding cards during user interaction.
      document.querySelectorAll('#stopList a[data-navigation-stop-id]').forEach(link => {
        if (link.dataset.navigationStopId === String(id)) configureNavigationLink(link, stop);
      });
      renderDayMap();
    }
  }
  function closeMapPopup() {
    cancelAnimationFrame(wheelFrame); clearTimeout(wheelSettleTimer); wheelFrame=0; wheelSettleTimer=0; wheelDrag=null;
    mapSelected=null; pinDraft=null;
    $('mapPopup').classList.add('hidden'); $('pinPopup').classList.add('hidden');
    window.DDSM_DeliveryMap?.clearDraft();
  }
  const wrapOrder = n => { const count=Math.max(1,stops().length);return ((n-1)%count+count)%count+1; };
  const WHEEL_ROW = 37;
  function renderWheel(offset=0) {
    const root=$('wheelNumbers'),count=stops().length;
    const key=count+':'+wheelValue;
    if(root.dataset.wheelKey!==key||!root.children.length){
      root.replaceChildren();
      for(let i=-2;i<=2;i++){
        root.append(node('div','wheel-number'+(i===0?' current':''),count>1||i===0?String(wrapOrder(wheelValue+i)):''));
      }
      root.dataset.wheelKey=key;
    }
    root.style.transform='translate3d(0,'+offset+'px,0)';
    const wheel=$('orderWheel');wheel.setAttribute('aria-valuemax',String(Math.max(1,count)));wheel.setAttribute('aria-valuenow',String(wheelValue));
    $('mapOrderSave').textContent=wheelValue+'번으로 변경';
  }
  function positionWheel(position){
    if(stops().length<=1)position=1;
    wheelPosition=position;
    const nearest=Math.round(position);
    wheelValue=wrapOrder(nearest);
    renderWheel((nearest-position)*WHEEL_ROW);
  }
  function placePopup(id, point) {
    const popup=$(id),stage=$('deliveryMapStage');
    if (!point || point.x<0 || point.y<0 || point.x>stage.clientWidth || point.y>stage.clientHeight) {popup.classList.add('hidden');return;}
    popup.classList.remove('hidden');
    const w=popup.offsetWidth,h=popup.offsetHeight;
    const right=point.x+22,left=point.x-w-22;
    popup.style.left=Math.max(6,Math.min(stage.clientWidth-w-6,right+w<=stage.clientWidth-6?right:left))+'px';
    popup.style.top=Math.max(6,Math.min(stage.clientHeight-h-6,point.y-h/2))+'px';
  }
  function positionMapPopup() {
    const dm=window.DDSM_DeliveryMap;
    if(pinDraft)placePopup('pinPopup',dm?.project(pinDraft));
    else if(mapSelected) {
      const stop=stops().find(s=>s.id===mapSelected);
      if(!stop||!validCoordinates(stop)){closeMapPopup();return;}
      placePopup('mapPopup',dm?.project(stop));
    }
  }
  let proofTarget=null, proofBlob=null, proofUrl='', proofBusy=false, proofGeneration=0;
  function clearProof(){
    ++proofGeneration;proofTarget=null;proofBlob=null;
    if(proofUrl)URL.revokeObjectURL(proofUrl);proofUrl='';
    $('proofPreview').hidden=true;$('proofPreview').removeAttribute('src');
    $('proofCamera').value='';$('proofFile').value='';$('proofSave').disabled=true;
  }
  function openProof(stop){
    if(!driverToken||syncedDate!==date||syncBlocked||scanWorkerActive||pendingScans.length){toast('센터 동기화 및 스캔 처리를 먼저 완료하세요.');return;}
    closeMapPopup();clearProof();
    proofTarget={id:stop.id,round:round().no,date,token:driverToken,epoch:syncEpoch};
    $('proofRecipient').textContent=(stop.recipient||stop.waybill)+' · '+(stop.address||'주소 미입력');
    $('proofStatus').textContent='배송 사진을 촬영하거나 선택하세요.';
    $('proofDialog').showModal();
  }
  async function compressProof(file){
    if(!file||file.size>25*1024*1024)throw Error('25MB 이하 사진을 선택하세요.');
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('사진을 읽을 수 없습니다. JPEG 또는 PNG를 선택하세요.'));img.src=url;});
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      if(!ctx||!img.naturalWidth||!img.naturalHeight)throw Error('사진 변환 실패');
      for(const edge of [1280,960,640]){
        const scale=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight));
        canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        for(const quality of [.76,.62,.45]){
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
          if(blob&&blob.size<=300*1024)return blob;
        }
      }
      throw Error('사진 압축에 실패했습니다.');
    }finally{URL.revokeObjectURL(url);}
  }
  async function selectProof(file){
    if(!file||proofBusy||!proofTarget)return;
    const generation=++proofGeneration;proofBlob=null;$('proofSave').disabled=true;
    if(proofUrl)URL.revokeObjectURL(proofUrl);proofUrl='';
    $('proofPreview').hidden=true;$('proofStatus').textContent='사진 압축 중…';
    try{
      const blob=await compressProof(file);
      if(generation!==proofGeneration)return;
      proofBlob=blob;proofUrl=URL.createObjectURL(blob);$('proofPreview').src=proofUrl;$('proofPreview').hidden=false;
      $('proofStatus').textContent='사진 준비 완료 · '+Math.ceil(blob.size/1024)+'KB';$('proofSave').disabled=false;
    }catch(e){if(generation===proofGeneration)$('proofStatus').textContent=e.message;}
  }
  async function saveProof(){
    if(proofBusy||!proofBlob||!proofTarget)return;
    const target=proofTarget;
    if(target.date!==date||target.token!==driverToken||target.epoch!==syncEpoch||syncedDate!==date||syncBlocked){$('proofStatus').textContent='연결이 변경되었습니다. 다시 열어 주세요.';return;}
    if(syncBusy||syncPending){$('proofStatus').textContent='기존 작업 동기화 중입니다. 잠시 후 다시 누르세요.';void flushDay();return;}
    proofBusy=true;
    for(const id of ['proofSave','proofClose','proofTake','proofChoose'])$(id).disabled=true;
    $('proofStatus').textContent='사진 및 완료 상태 저장 중…';
    try{
      const form=new FormData();form.append('date',target.date);form.append('round',String(target.round));form.append('stop_id',target.id);form.append('revision',String(serverRevision));form.append('photo',proofBlob,'delivery.jpg');
      const res=await fetch(DRIVER_API_BASE+'delivery-proof',{method:'POST',credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer '+target.token},body:form});
      const body=await res.json().catch(()=>null);
      if(!res.ok||!body?.ok||!body.day)throw Error(body?.error||'사진 저장 실패 (HTTP '+res.status+')');
      if(target.epoch!==syncEpoch||target.token!==driverToken||date!==target.date)return;
      serverRevision=body.revision;data.days[target.date]=body.day;
      try{localStorage.setItem(activeStorageKey(),JSON.stringify(data));}catch(_){}
      $('proofDialog').close();render();toast('사진 저장 및 배송완료');
    }catch(e){$('proofStatus').textContent=e.message+' · 필요하면 작업을 동기화한 뒤 다시 시도하세요.';}
    finally{proofBusy=false;for(const id of ['proofClose','proofTake','proofChoose'])$(id).disabled=false;$('proofSave').disabled=!proofBlob;}
  }
  function bindProof(){
    $('proofTake').addEventListener('click',()=>$('proofCamera').click());
    $('proofChoose').addEventListener('click',()=>$('proofFile').click());
    for(const id of ['proofCamera','proofFile'])$(id).addEventListener('change',e=>{const file=e.target.files[0];e.target.value='';void selectProof(file);});
    $('proofSave').addEventListener('click',()=>void saveProof());
    $('proofClose').addEventListener('click',()=>{if(!proofBusy)$('proofDialog').close();});
    $('proofDialog').addEventListener('cancel',e=>{if(proofBusy)e.preventDefault();});
    $('proofDialog').addEventListener('close',clearProof);
    $('mapComplete').addEventListener('click',()=>{const stop=stops().find(s=>s.id===mapSelected);if(stop){if(stop.status==='done'){closeMapPopup();setDone(stop.id,false);}else openProof(stop);}});
  }
  function selectMapStop(id, roundNo) {
    if(round().no!==roundNo||view!=='delivery'||workTab!=='map')return;
    const stop=stops().find(s=>s.id===id);if(!stop)return;
    closeMapPopup(); mapSelected=id; wheelValue=stops().indexOf(stop)+1; wheelPosition=wheelValue;
    $('mapPopupName').textContent=stop.recipient||stop.waybill;
    $('mapComplete').textContent=stop.status==='done'?'완료 취소':'완료';
    const link=$('mapNav');configureNavigationLink(link,stop);link.textContent='내비';
    renderWheel();positionMapPopup();
  }
  function onMapLongPress(point) {
    if(view!=='delivery'||workTab!=='map'||!stops().length)return;
    const selected=mapSelected;
    const list=stops();closeMapPopup();
    pinDraft=point;window.DDSM_DeliveryMap?.showDraft(point);
    const picker=$('pinStopSelect');picker.replaceChildren();
    list.forEach((s,i)=>{const opt=node('option','', (i+1)+'. '+(s.recipient||s.waybill)+(validCoordinates(s)?'':' · 위치 미지정'));opt.value=s.id;picker.append(opt);});
    const target=list.find(s=>s.id===selected)||list.find(s=>!validCoordinates(s));
    if(target)picker.value=target.id;
    else {const placeholder=node('option','','배송지 선택');placeholder.value='';picker.prepend(placeholder);picker.value='';}
    $('pinSave').disabled=!picker.value;
    positionMapPopup();
  }
  async function saveMapPin() {
    const stop=stops().find(s=>s.id===$('pinStopSelect').value);
    if(!stop||!validCoordinates(pinDraft))return;
    const point=pinDraft, old={lat:stop.lat,lng:stop.lng},savedDate=date,token=driverToken;
    stop.lat=point.lat;stop.lng=point.lng;
    if(!persist()){Object.assign(stop,old);return;}
    closeMapPopup();render();
    if(!stop.address){toast('핀 저장 완료 · 주소 입력 후 공용 주소록에 반영할 수 있습니다.');return;}
    try {
      const res=await fetch(DRIVER_API_BASE+'destination',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({date:savedDate,waybill:stop.waybill,address:stop.address,lat:point.lat,lng:point.lng})});
      const payload=await res.json();if(!res.ok||!payload.ok)throw Error(payload.error||'HTTP '+res.status);
      toast('핀과 공용 배송지 저장 완료');
    }catch(e){toast('기사 핀 저장됨 · 공용 주소록 반영 실패: '+e.message);}
  }
  function bindMapWheel() {
    bindProof();
    const wheel=$('orderWheel');
    const cancel=()=>{cancelAnimationFrame(wheelFrame);clearTimeout(wheelSettleTimer);wheelFrame=0;wheelSettleTimer=0;};
    function settle(){
      cancel();
      const from=wheelPosition,to=Math.round(from);
      if(Math.abs(to-from)<.001){positionWheel(to);return;}
      const start=performance.now(),duration=220;
      function frame(now){
        const t=Math.min(1,(now-start)/duration),ease=1-Math.pow(1-t,3);
        positionWheel(from+(to-from)*ease);
        if(t<1)wheelFrame=requestAnimationFrame(frame);
        else{wheelFrame=0;positionWheel(to);}
      }
      wheelFrame=requestAnimationFrame(frame);
    }
    function coast(velocity){
      cancel();
      if(Math.abs(velocity)<.0025||stops().length<=1){settle();return;}
      let v=Math.max(-.045,Math.min(.045,velocity)),last=performance.now(),elapsed=0;
      function frame(now){
        const dt=Math.min(40,Math.max(1,now-last));last=now;elapsed+=dt;
        positionWheel(wheelPosition+v*dt);
        v*=Math.exp(-dt/145);
        if(Math.abs(v)<.0018||elapsed>650){settle();return;}
        wheelFrame=requestAnimationFrame(frame);
      }
      wheelFrame=requestAnimationFrame(frame);
    }
    wheel.addEventListener('wheel',e=>{
      e.preventDefault();if(wheelDrag)return;cancel();
      const px=e.deltaY*(e.deltaMode===1?18:e.deltaMode===2?111:1);
      positionWheel(wheelPosition+Math.max(-6,Math.min(6,px/55)));
      wheelSettleTimer=setTimeout(settle,120);
    },{passive:false});
    wheel.addEventListener('keydown',e=>{
      if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key))return;
      e.preventDefault();cancel();wheelDrag=null;
      positionWheel(e.key==='Home'?1:e.key==='End'?Math.max(1,stops().length):Math.round(wheelPosition)+({ArrowUp:-1,ArrowDown:1,PageUp:-10,PageDown:10}[e.key]||0));
    });
    wheel.addEventListener('pointerdown',e=>{
      if(wheelDrag||e.button!==0)return;e.preventDefault();cancel();
      wheelDrag={id:e.pointerId,start:e.clientY,last:e.clientY,base:wheelPosition,t:performance.now(),v:0};
      wheel.setPointerCapture(e.pointerId);
    });
    wheel.addEventListener('pointermove',e=>{
      if(!wheelDrag||e.pointerId!==wheelDrag.id)return;
      const now=performance.now(),dt=Math.max(1,now-wheelDrag.t);
      const velocity=(wheelDrag.last-e.clientY)/WHEEL_ROW/dt;
      if(e.clientY!==wheelDrag.last)wheelDrag.v=.65*velocity+.35*wheelDrag.v;
      else if(dt>40)wheelDrag.v=0;
      wheelDrag.last=e.clientY;wheelDrag.t=now;
      positionWheel(wheelDrag.base+(wheelDrag.start-e.clientY)/WHEEL_ROW);
    });
    wheel.addEventListener('pointerup',e=>{
      if(!wheelDrag||e.pointerId!==wheelDrag.id)return;
      const age=performance.now()-wheelDrag.t,v=age<100?wheelDrag.v*Math.exp(-age/55):0;
      wheelDrag=null;coast(v);
    });
    const endDrag=e=>{if(wheelDrag&&e.pointerId===wheelDrag.id){wheelDrag=null;settle();}};
    wheel.addEventListener('pointercancel',endDrag);
    wheel.addEventListener('lostpointercapture',endDrag);
    $('mapOrderSave').addEventListener('click',()=>{const id=mapSelected,target=wheelValue-1;closeMapPopup();if(id)moveStopOrder(id,target);});
    $('mapEdit').addEventListener('click',()=>{const id=mapSelected;closeMapPopup();if(id)openEdit(id);});
    $('mapNav').addEventListener('click',e=>{const stop=stops().find(s=>s.id===mapSelected);if(!stop){e.preventDefault();return;}if(!naverNavigationUrl(stop)&&/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)){e.preventDefault();if(!stop.address){toast('주소 또는 위치를 먼저 지정하세요.');return;}void locateAndLaunchNavigation(e.currentTarget,stop);}});
    $('pinStopSelect').addEventListener('change',e=>{$('pinSave').disabled=!e.target.value;});
    $('pinCancel').addEventListener('click',closeMapPopup);$('pinSave').addEventListener('click',saveMapPin);
  }
  function openWorkTab(tab) { if(scanWorkerActive||pendingScans.length){toast('스캔 처리 중');return;} workTab = tab; showView('delivery'); }
  function renderDayMap() {
    if (view !== 'delivery' || workTab !== 'map') return;
    const message = $('deliveryMapEmpty');
    if(!driverToken||syncedDate!==date){message.textContent='배송 데이터 동기화 대기 중 · 새로고침을 눌러 다시 연결할 수 있습니다.';message.classList.remove('hidden');return;}
    if (!window.DDSM_DeliveryMap || typeof window.DDSM_DeliveryMap.render !== 'function') {
      message.textContent = '배송 지도 모듈을 불러오지 못했습니다. 브라우저 새로고침 후 다시 확인하세요.';
      message.classList.remove('hidden');
      message.classList.add('map-error');
      return;
    }
    if (!window.DDSM_NaverMap || typeof window.DDSM_NaverMap.loadSdk !== 'function') {
      message.textContent = '네이버 지도 연결 모듈이 오래된 버전입니다. 브라우저 새로고침 후 다시 확인하세요.';
      message.classList.remove('hidden');
      message.classList.add('map-error');
      return;
    }
    const selectedRoundNo = round().no;
    const selected = selectedRoundStops();
    return Promise.resolve(window.DDSM_DeliveryMap.render(date, selected, {
      onSelect: selectMapStop,
      onGeocoded: persistGeocoded,
      onLongPress: onMapLongPress,
      onDismiss: closeMapPopup,
      onViewport: positionMapPopup
    }, selectedRoundNo)).catch(error => {
      message.textContent = '배송 지도 오류: ' + (error.message || String(error));
      message.classList.remove('hidden');
      message.classList.add('map-error');
    });
  }
  function setSelectedRound(value) {
    const d = day();
    const next = Number(value);
    if (!d.rounds.some(r => r.no === next) || d.selected === next) return;
    if(scanWorkerActive||pendingScans.length){toast('스캔 처리 완료 후 회차를 변경하세요.');render();return;}
    const old = d.selected;
    closeMapPopup();
    d.selected = next;
    if (!persist()) { d.selected = old; return; }
    render();
  }
  function moveStopOrder(id, targetIndex) {
    const list = stops();
    const sourceIndex = list.findIndex(stop => stop.id === id);
    const target = Math.max(0, Math.min(list.length - 1, Number(targetIndex)));
    if (sourceIndex < 0 || !Number.isInteger(target) || sourceIndex === target) return;
    const moved = list.splice(sourceIndex, 1)[0];
    list.splice(target, 0, moved);
    if (!persist()) {
      list.splice(target, 1);
      list.splice(sourceIndex, 0, moved);
      return;
    }
    render();
    toast('배송 순번을 ' + (target + 1) + '번으로 변경했습니다.');
  }
  // Open NAVER navigation from a user tap when destination coordinates are known.
  // Android mobile web uses the official intent URL; iOS uses the NAVER URL scheme.
  // Without coordinates, preserve the address-search fallback instead of guessing.
  function naverNavigationUrl(stop) {
    if (!validCoordinates(stop)) return '';
    const params = 'dlat=' + encodeURIComponent(stop.lat)
      + '&dlng=' + encodeURIComponent(stop.lng)
      + '&dname=' + encodeURIComponent(stop.address || '배송지')
      + '&appname=' + encodeURIComponent(window.location.origin + '/ddsm/');
    if (/Android/i.test(navigator.userAgent)) {
      const store = encodeURIComponent('https://play.google.com/store/apps/details?id=com.nhn.android.nmap');
      return 'intent://navigation?' + params
        + '#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;'
        + 'package=com.nhn.android.nmap;S.browser_fallback_url=' + store + ';end';
    }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'nmap://navigation?' + params;
    return '';
  }
  function configureNavigationLink(link, stop) {
    const url = naverNavigationUrl(stop);
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (url) {
      link.textContent = '내비 실행';
      link.href = url;
      link.setAttribute('aria-label', '네이버 지도 내비게이션에서 목적지 안내');
      link.removeAttribute('target');
      link.removeAttribute('rel');
    } else if (mobile) {
      // Navigation requires coordinates. Do not silently open an address search.
      link.textContent = '내비 위치 확인';
      link.href = '#';
      link.setAttribute('aria-label', '목적지 좌표를 확인하고 내비게이션 실행');
      link.removeAttribute('target');
      link.removeAttribute('rel');
    } else {
      link.textContent = '지도 검색';
      link.href = 'https://map.naver.com/p/search/' + encodeURIComponent(stop.address || (stop.lat+','+stop.lng));
      link.setAttribute('aria-label', '네이버 지도에서 주소 검색');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
  async function locateAndLaunchNavigation(link, stop) {
    if (link.dataset.navigationLoading === '1') return;
    const startDate = date;
    const startRound = round().no;
    const address = stop.address;
    link.dataset.navigationLoading = '1';
    link.textContent = '좌표 확인 중…';
    link.setAttribute('aria-busy', 'true');
    try {
      if (!window.DDSM_NaverMap || !window.DDSM_Address) throw new Error('지도 모듈을 불러올 수 없습니다.');
      const maps = await window.DDSM_NaverMap.loadSdk();
      const point = await window.DDSM_Address.resolve(maps, address);
      const stillHere = startDate === date && day().rounds.some(r =>
        r.no === startRound && r.stops.some(s => s.id === stop.id && s.address === address));
      if (!stillHere) return;
      if (!point?.verified || !validCoordinates(point)) {
        toast('정확한 위치를 확인할 수 없습니다. 지도에서 목적지를 지정해 주세요.');
        if (round().no === startRound) openEdit(stop.id);
        return;
      }
      persistGeocoded(startDate, startRound, stop.id, address, point);
      configureNavigationLink(link, { ...stop, lat: point.lat, lng: point.lng });
      // Browsers may disallow app deep links after asynchronous geocoding.
      // The now-visible real link supports a second direct tap in that case.
      window.location.href = naverNavigationUrl({ ...stop, lat: point.lat, lng: point.lng });
      toast('내비가 열리지 않으면 내비 실행을 다시 눌러 주세요.');
    } catch (_) {
      toast('좌표를 찾지 못했습니다. 정보 수정에서 지도 위치를 지정해 주세요.');
      if (startDate === date && round().no === startRound) openEdit(stop.id);
    } finally {
      delete link.dataset.navigationLoading;
      link.removeAttribute('aria-busy');
      if (!validCoordinates(stop)) {
        const current = day().rounds.find(r => r.no === startRound)?.stops.find(s => s.id === stop.id);
        if (current) configureNavigationLink(link, current);
      }
    }
  }

  function renderDelivery() {
    const c = counts();
    const picker = $('deliveryRoundSelect');
    picker.replaceChildren();
    day().rounds.slice().sort((a,b) => a.no - b.no).forEach(r => {
      const option = node('option', '', r.no + '회차');
      option.value = String(r.no);
      picker.append(option);
    });
    picker.value = String(round().no);
    $('mapRoundLabel').textContent=round().no+'회차';
    $('mapRound').disabled=day().rounds.length<2;
    $('mapRound').setAttribute('aria-label',round().no+'회차 · 다음 회차로 변경');
    $('workDateLabel').textContent = dateText(date) + ' · ' + round().no + '회차';
    $('progressLabel').textContent = '완료 ' + c.done + ' / ' + c.total;
    $('remainingLabel').textContent = '남은 배송 ' + c.pending + '건';
    const percent = c.total ? Math.round(c.done * 100 / c.total) : 0;
    $('progressFill').style.width = percent + '%';
    $('progressTrack').setAttribute('aria-valuenow', String(percent));
    const root = $('stopList');
    root.replaceChildren();
    if (!c.total) {
      root.append(node('div', 'empty-list', '아직 스캔된 운송장이 없습니다. 위의 스캔 버튼으로 등록하세요.'));
      return;
    }
    stops().forEach((stop, index) => {
      const done = stop.status === 'done';
      const card = node('article', 'stop-card' + (done ? ' done' : ''));
      const head = node('div', 'stop-top');
      head.append(node('span', 'stop-number', String(index + 1)));
      const detail = node('div', 'stop-detail');
      detail.append(node('strong', '', stop.recipient || '배송건 ' + stop.waybill));
      detail.append(node('span', '', stop.address || '주소 미입력 · 정보 수정에서 입력하세요'));
      detail.append(node('span', '', '운송장 ' + stop.waybill
        + (stop.scannedItems?.length ? ' · 물품 '+stop.scannedItems.join(', ') : '')
        + (stop.memo ? ' · 메모 있음' : '')));
      head.append(detail);
      head.append(node('span', 'status-tag', done ? '완료' : '배송 예정'));
      card.append(head);
      const actions = node('div', 'stop-actions');
      actions.append(button(done ? '완료 취소' : '완료', done ? 'undo' : 'complete', () => setDone(stop.id, !done)));
      if (stop.address || validCoordinates(stop)) {
        const link = node('a', '');
        link.dataset.navigationStopId = String(stop.id);
        configureNavigationLink(link, stop);
        link.addEventListener('click', event => {
          if (naverNavigationUrl(stop) || !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
          event.preventDefault();
          void locateAndLaunchNavigation(link, stop);
        });
        actions.append(link);
      }
      actions.append(button('수정', '', () => openEdit(stop.id)));
      card.append(actions);
      root.append(card);
    });
  }
  function render() {
    renderHome();
    $('scanTab').setAttribute('aria-pressed',String(view==='home'));
    $('mapTab').setAttribute('aria-pressed',String(view==='delivery'&&workTab==='map'));
    $('listTab').setAttribute('aria-pressed',String(view==='delivery'&&workTab==='list'));
    if (view === 'delivery') {
      $('deliveryHeading').textContent = '배송 목록';
      $('mapPanel').classList.toggle('hidden',workTab!=='map');
      $('listPanel').classList.toggle('hidden',workTab!=='list');
      renderDelivery();
      if(workTab==='map')renderDayMap();else window.DDSM_DeliveryMap?.pause();
    }
  }
  function showView(next) {
    const changed=view!==next||document.body.dataset.page!==(next==='home'?'scan':workTab);
    if(changed&& (scanWorkerActive||pendingScans.length)) {toast('스캔 처리 완료 후 이동하세요.');return;}
    view=next;
    document.body.dataset.page=next==='home'?'scan':workTab;
    try{sessionStorage.setItem(PAGE_KEY,document.body.dataset.page);}catch(_){}
    if(next!=='delivery'||workTab!=='map') {closeMapPopup();window.DDSM_DeliveryMap?.pause();}
    if(next!=='home')stopCamera();
    $('homeScreen').classList.toggle('hidden',next!=='home');
    $('deliveryScreen').classList.toggle('hidden',next!=='delivery');
    render();
    if(changed)window.scrollTo({top:0,behavior:'instant'});
    if(next==='home'&&changed)openScan();
  }
  function addWaybill(raw, remote = null) {
    if (!remote || remote.ok !== true) return {error:'서버 조회에 성공한 운송장만 등록할 수 있습니다.'};
    const parsed = window.DDSM_Waybill?.parse(raw) || {scanned:String(raw||'').trim(),valid:false};
    const waybill = parsed.valid ? parsed.master : clean(raw,100).replace(/\s+/g,'');
    if (!waybill) return {error:'운송장번호를 입력하세요.'};
    if (waybill.length < 4 || /[\u0000-\u001f<>]/.test(waybill)) return {error:'운송장번호를 확인하세요.'};
    const digitKey = value => String(value||'').replace(/[\s-]/g,'');
    const existing = stops().find(stop => {
      const saved = digitKey(stop.waybill);
      return saved === digitKey(waybill)
        || (parsed.valid && saved.length === 16 && saved.slice(0,13) === waybill);
    });
    const suffix = parsed.valid ? parsed.suffix : null;
    if (existing) {
      const scannedItems = Array.isArray(existing.scannedItems) ? existing.scannedItems.slice() : [];
      if (!suffix || scannedItems.includes(suffix)) {
        return {error: suffix ? '이미 스캔한 물품 '+suffix+'번입니다.' : '이미 등록된 운송장입니다: '+waybill};
      }
      const snapshot = {...existing, scannedItems};
      existing.scannedItems = [...scannedItems, suffix];
      if (remote) {
        if (!existing.recipient) existing.recipient = clean(remote.recipient,100);
        if (!existing.address) existing.address = clean(remote.address,250);
        if (!existing.phone) existing.phone = clean(remote.phone,25);
      }
      if (!persist()) {Object.assign(existing,snapshot);return {error:'물품 스캔을 저장하지 못했습니다.'};}
      recentScanTimes.set(existing.id,Date.now());render();
      return {stop:existing,existing:true,suffix};
    }
    const stop = {
      id:makeId(),waybill,recipient:clean(remote?.recipient,100),
      address:clean(remote?.address,250),phone:clean(remote?.phone,25),
      memo:'',status:'pending',createdAt:new Date().toISOString(),
      scannedItems:suffix?[suffix]:[],
      ...(Number.isFinite(remote?.lat) && Number.isFinite(remote?.lng)
        ? {lat:remote.lat,lng:remote.lng} : {})
    };
    stops().push(stop);
    if (!persist()) {stops().pop();return {error:'저장하지 못했습니다. 저장 공간을 확인하세요.'};}
    recentScanTimes.set(stop.id,Date.now());render();
    if (scanVibration&&navigator.vibrate) navigator.vibrate(45);
    return {stop,suffix};
  }

  // Play an original short, two-stage mechanical click. Audio is unlocked
  // from the user's SCAN tap so camera/barcode callbacks can give feedback.
  let scanAudioContext = null;
  let scanFlashTimer = null;
  function prepareScanAudio() {
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return;
    try {
      if (!scanAudioContext) scanAudioContext = new AudioContextType();
      if (scanAudioContext.state === 'suspended') {
        scanAudioContext.resume().catch(() => {});
      }
    } catch (_) { /* Sound is optional; scanning still works. */ }
  }
  function scanShutterSound() {
    try {
      prepareScanAudio();
      const audio = scanAudioContext;
      if (!audio || audio.state !== 'running') return;
      const length = Math.floor(audio.sampleRate * 0.14);
      const buffer = audio.createBuffer(1, length, audio.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / audio.sampleRate;
        const first = Math.exp(-t * 110);
        const second = t > 0.044 ? 0.88 * Math.exp(-(t - 0.044) * 48) : 0;
        samples[i] = (Math.random() * 2 - 1) * (first + second);
      }
      const source = audio.createBufferSource();
      const filter = audio.createBiquadFilter();
      const volume = audio.createGain();
      source.buffer = buffer;
      filter.type = 'highpass';
      filter.frequency.value = 800;
      volume.gain.value = 0.33;
      source.connect(filter);
      filter.connect(volume);
      volume.connect(audio.destination);
      source.onended = () => { source.disconnect(); filter.disconnect(); volume.disconnect(); };
      source.start();
    } catch (_) { /* A blocked audio context must never block scanning. */ }
  }
  function scanReadFeedback() {
    const dialog = $('scanDialog');
    if (view!=='home') return;
    if(scanSound)scanShutterSound();
    clearTimeout(scanFlashTimer);
    dialog.classList.remove('scan-read-flash');
    // Restart animation on consecutive scans, including a duplicate code.
    void dialog.offsetWidth;
    dialog.classList.add('scan-read-flash');
    scanFlashTimer = setTimeout(() => dialog.classList.remove('scan-read-flash'), 540);
  }
  function openScan() {
    if(view!=='home'){showView('home');return;}
    if(!driverToken||syncedDate!==date||syncBlocked||document.querySelector('dialog[open]'))return;
    const input=$('waybillInput');
    input.setAttribute('inputmode','none');
    prepareScanAudio();
    if(!cameraStream&&!zxingControls&&!$('cameraButton').disabled)void startCamera();
    input.focus({preventScroll:true});
  }
  const pendingScans = [];
  let scanWorkerActive = false;
  function showScanDetails(parsed,dateKey,source){
    // Display the exact detected value and lookup context locally only.
    const text=String(parsed.scanned).replace(/[\x00-\x1f\x7f]/g,c=>'[0x'+c.charCodeAt(0).toString(16).padStart(2,'0')+']').slice(0,120);
    $('scanDetails').textContent='인식 '+text+' · '+(parsed.valid?parsed.digits.length+'자리':'형식 오류')+' · '+source+' · '+dateKey+' · '+centerDisplay()+(parsed.valid&&parsed.scanned!==parsed.digits?' · 조회 '+parsed.digits:'');
    $('scanDetails').classList.remove('hidden');
  }
  async function lookupWaybill(raw, dateKey) {
    const parsed = window.DDSM_Waybill.parse(raw);
    if (!parsed.valid) throw Error('형식 오류 · 운송장번호는 13자리 또는 16자리여야 합니다.');
    const token=driverToken;
    if (!token) throw Error('센터 연결이 필요합니다.');
    let response;
    try{
      response=await fetch(
        DRIVER_API_BASE+'waybill?date='+encodeURIComponent(dateKey)+'&barcode='+encodeURIComponent(parsed.digits),
        {method:'GET',headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store'}
      );
    }catch(_){throw Error('조회 연결 실패 · 네트워크 또는 브라우저 연결 상태를 확인하세요.');}
    const payload=await response.json().catch(()=>null);
    if(!response.ok||payload?.ok!==true){
      if(response.status===401&&token===driverToken)invalidateDriverAuth(true);
      throw Error((payload?.error||'서버 운송장 조회 실패')+' (HTTP '+response.status+')');
    }
    if(token!==driverToken)throw Error('센터 연결이 변경되었습니다. 다시 스캔하세요.');
    if(String(payload.master_waybill)!==parsed.master)throw Error('서버 조회 번호가 인식 번호와 일치하지 않습니다.');
    return payload;
  }
  async function drainScanQueue() {
    if (scanWorkerActive) return;
    scanWorkerActive=true;
    try {
      while (pendingScans.length) {
        const job=pendingScans.shift();
        showScanDetails(job.parsed,job.date,job.source);
        $('scanResult').textContent='운송장 조회 중 · '+job.parsed.digits;
        try {
          const detail=await lookupWaybill(job.parsed.digits,job.date);
          if(job.token!==driverToken||job.date!==date||job.roundNo!==round().no)
            throw Error('센터·배송일 또는 회차가 변경되었습니다. 다시 스캔하세요.');
          const result=addWaybill(job.parsed.digits,detail);
          if(result.error)throw Error(result.error);
          $('scanResult').textContent='등록 · '+(detail.recipient||result.stop.waybill);
        }catch(e){
          const message=e.message||'운송장 조회 실패';
          $('scanResult').textContent=message;
          if(!job.camera)toast(message);
        }finally{
          if(!job.camera&&view==='home')$('waybillInput').focus({preventScroll:true});
        }
      }
    }finally{scanWorkerActive=false;}
  }
  function processScan(raw,camera=false,source=camera?'카메라':'직접 입력'){
    if(!String(raw||'').trim()||view!=='home'||document.querySelector('dialog[open]'))return false;
    const parsed=window.DDSM_Waybill.parse(raw);
    if(!driverToken||syncedDate!==date||syncBlocked){
      $('scanResult').textContent='센터 연결 및 서버 동기화가 필요합니다.';
      toast('서버 동기화가 필요합니다.');return false;
    }
    if(!parsed.valid){
      showScanDetails(parsed,date,source);
      $('scanResult').textContent='형식 오류 · 13자리 또는 16자리 운송장인지 확인하세요.';
      return false;
    }
    if(pendingScans.length>=20){$('scanResult').textContent='스캔 대기열이 가득 찼습니다. 조회 완료 후 다시 스캔하세요.';return false;}
    scanReadFeedback();
    pendingScans.push({parsed,camera,source,date,roundNo:round().no,token:driverToken});
    if(!camera){$('waybillInput').value='';$('waybillInput').focus({preventScroll:true});}
    void drainScanQueue();return true;
  }

  function setDone(id, value) {
    const target = stops().find(x => x.id === id);
    if (!target) return;
    const old = target.status;
    target.status = value ? 'done' : 'pending';
    if (!persist()) { target.status = old; return; }
    render();
    toast(value ? '완료' : '완료 취소');
  }
  function removeStop(id) {
    const active = stops();
    const target = active.find(x => x.id === id);
    if (!target || !confirm('운송장 ' + target.waybill + '을(를) 목록에서 삭제할까요?')) return;
    const index = active.findIndex(x => x.id === id);
    active.splice(index, 1);
    if (!persist()) { active.splice(index, 0, target); return; }
    render();
  }
  function openEdit(id) {
    const stop = stops().find(x => x.id === id);
    if (!stop) return;
    editingId = id;
    $('editWaybill').textContent = '운송장 ' + stop.waybill + ' · ' + round().no + '회차';
    const roundPicker = $('editRoundSelect');
    roundPicker.replaceChildren();
    day().rounds.slice().sort((a,b)=>a.no-b.no).forEach(r=>{
      const opt = node('option','',r.no+'회차'); opt.value=String(r.no); roundPicker.append(opt);
    });
    roundPicker.value = String(round().no);
    $('recipientInput').value = stop.recipient;
    $('addressInput').value = stop.address;
    $('phoneInput').value = stop.phone;
    $('memoInput').value = stop.memo;
    $('editDialog').showModal();
    if (window.DDSM_NaverMap) {
      window.DDSM_NaverMap.open(stop.address, validCoordinates(stop) ? { lat: stop.lat, lng: stop.lng } : null);
    }
  }
  async function saveEdit(event) {
    event.preventDefault();
    const stop = stops().find(x => x.id === editingId);
    if (!stop) return;
    const before = { recipient: stop.recipient, address: stop.address, phone: stop.phone, memo: stop.memo, lat: stop.lat, lng: stop.lng };
    const savedDate = date;
    const authAtEdit = driverToken;
    const list = stops();
    const oldIndex = list.findIndex(x => x.id === editingId);
    const targetRound = day().rounds.find(r=>r.no===Number($('editRoundSelect').value));
    const moveRound = targetRound && targetRound.stops !== list;
    stop.recipient = clean($('recipientInput').value, 100);
    stop.address = clean($('addressInput').value, 250);
    stop.phone = clean($('phoneInput').value, 25);
    stop.memo = clean($('memoInput').value, 500);
    const selected = window.DDSM_NaverMap ? window.DDSM_NaverMap.selection(stop.address) : null;
    if (selected) {
      stop.lat = selected.lat;
      stop.lng = selected.lng;
    } else {
      // A changed or unresolved address must never retain an unrelated older pin.
      delete stop.lat;
      delete stop.lng;
    }
    if (moveRound) { list.splice(oldIndex,1); targetRound.stops.push(stop); }
    if (!persist()) {
      Object.assign(stop, before);
      if (moveRound) { targetRound.stops.pop(); list.splice(oldIndex,0,stop); }
      return;
    }
    closeMapPopup();
    $('editDialog').close();
    render();
    // Only address and point edits affect the shared master. Personal notes and
    // phone edits remain in the driver's private daily work data.
    const addressChanged = stop.address !== before.address ||
      stop.lat !== before.lat || stop.lng !== before.lng;
    if (addressChanged && stop.address && authAtEdit && syncedDate === savedDate) {
      try {
        const response = await fetch(DRIVER_API_BASE + 'destination', {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + authAtEdit},
          body: JSON.stringify({
            date: savedDate, waybill: stop.waybill, address: stop.address,
            ...(Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
              ? {lat: stop.lat, lng: stop.lng} : {})
          })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok !== true) {
          throw Error(payload?.error || 'HTTP ' + response.status);
        }
        toast('배송 정보와 공용 배송지 마스터를 저장했습니다.');
      } catch (error) {
        toast('기사 작업은 저장됨 · 배송지 마스터 반영 실패: ' + error.message);
      }
    } else {
      toast('배송 정보를 저장했습니다.');
    }
  }
  function chooseDate() {
    const el = $('dateInput');
    el.value = date;
    try { if (typeof el.showPicker === 'function') { el.showPicker(); return; } }
    catch (_) {}
    el.focus({ preventScroll: true });
    el.click();
  }
  function addRound() {
    if(scanWorkerActive||pendingScans.length){toast('스캔 처리 완료 후 회차를 추가하세요.');return;}
    const d = day();
    const next = Math.max(0, ...d.rounds.map(x => x.no)) + 1;
    if (next > 100) { toast('회차는 100개까지 만들 수 있습니다.'); return; }
    d.rounds.push({ no: next, stops: [] });
    d.selected = next;
    if (!persist()) { d.rounds.pop(); d.selected = d.rounds[0].no; return; }
    render();
    toast(next + '회차를 만들었습니다.');
  }

  function stopCamera() {
    cameraGeneration++;
    if (nativeTimer !== null) { clearTimeout(nativeTimer); nativeTimer = null; }
    if (zxingControls) { try { zxingControls.stop(); } catch (_) {} zxingControls = null; }
    if (cameraStream) { cameraStream.getTracks().forEach(track => track.stop()); cameraStream = null; }
    const video = $('cameraVideo');
    if (video.srcObject && video.srcObject.getTracks) {
      video.srcObject.getTracks().forEach(track => track.stop());
    }
    video.pause();
    video.srcObject = null;
    video.classList.add('hidden');
    $('cameraButton').disabled=false;
    $('cameraButton').textContent = '카메라 켜기';
  }
  function cameraDetected(value,source) {
    const parsed=window.DDSM_Waybill.parse(value),key=parsed.valid?parsed.digits:parsed.scanned;
    const now=Date.now();
    if(key===lastCameraValue&&now-lastCameraAt<2500)return;
    lastCameraValue=key;lastCameraAt=now;
    processScan(value,true,source);
  }
  function loadZXing() {
    if(window.ZXingBrowser?.BrowserMultiFormatOneDReader||window.ZXingBrowser?.BrowserMultiFormatReader)return Promise.resolve(window.ZXingBrowser);
    if (barcodeDecoder) return barcodeDecoder;
    // Pages includes a pinned same-origin bundle; CDN is a secondary fallback.
    const urls=['vendor/zxing-browser-0.1.5.min.js','https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js','https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js'];
    const load = url => new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const fail=()=>{clearTimeout(timer);script.remove();reject(Error('바코드 인식 모듈 로딩 실패'));};
      const timer=setTimeout(fail,4500);
      script.src=url;script.async=true;
      script.onload=()=>{clearTimeout(timer);if(window.ZXingBrowser?.BrowserMultiFormatOneDReader||window.ZXingBrowser?.BrowserMultiFormatReader)resolve(window.ZXingBrowser);else fail();};
      script.onerror=fail;document.head.append(script);
    });
    barcodeDecoder=(async()=>{for(const url of urls){try{return await load(url);}catch(_){}}throw Error('바코드 인식 모듈을 불러올 수 없습니다.');})().catch(e=>{barcodeDecoder=null;throw e;});
    return barcodeDecoder;
  }
  async function enableContinuousFocus(video) {
    const track = video.srcObject?.getVideoTracks?.()?.[0];
    if (!track) return false;
    // focusMode is experimental; browsers without this capability retain the
    // camera's own default autofocus, rather than failing barcode scanning.
    try {
      const capabilities = typeof track.getCapabilities === 'function'
        ? track.getCapabilities() : {};
      const modes = capabilities.focusMode;
      if (Array.isArray(modes) && modes.includes('continuous') &&
          typeof track.applyConstraints === 'function') {
        await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
        return true;
      }
    } catch (_) { /* Unsupported focus constraint: use hardware default. */ }
    return false;
  }
  async function startCamera() {
    const video=$('cameraVideo'),control=$('cameraButton');
    if(view!=='home'||control.disabled||cameraStream||!driverToken||syncedDate!==date||syncBlocked||document.querySelector('dialog[open]'))return;
    const generation=++cameraGeneration;
    const current=()=>generation===cameraGeneration&&view==='home'&&Boolean(driverToken)&&!document.hidden;
    if(!navigator.mediaDevices?.getUserMedia){
      $('scanResult').textContent='카메라를 사용할 수 없습니다. Safari 또는 Chrome에서 열거나 운송장번호를 직접 입력하세요.';return;
    }
    control.disabled=true;$('scanResult').textContent='카메라를 준비하고 있습니다.';
    try{
      // Acquire one rear-camera stream for both engines, including iOS Safari.
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
      if(!current()){stream.getTracks().forEach(track=>track.stop());return;}
      cameraStream=stream;video.muted=true;video.playsInline=true;video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');
      video.srcObject=stream;video.classList.remove('hidden');await video.play();
      if(!current())return;
      void enableContinuousFocus(video);
      let detector=null,reader=null,nativeBusy=false,nativeValue=null,misses=0,loading=false,softwareFailed=false;
      try{if(typeof window.BarcodeDetector==='function')detector=new window.BarcodeDetector({formats:['code_128','code_39','ean_8','ean_13','itf']});}catch(_){}
      const canvas=document.createElement('canvas');let ctx=null,frameNo=0;
      const loadSoftware=async()=>{
        if(loading||reader||softwareFailed)return;
        loading=true;
        try{
          const mod=await loadZXing();if(!current())return;
          const Reader=mod.BrowserMultiFormatOneDReader||mod.BrowserMultiFormatReader;
          reader=new Reader();
          if(typeof reader.decodeFromCanvas!=='function')throw Error('지원하지 않는 인식 모듈');
          $('scanResult').textContent='카메라 준비 완료 · 호환 바코드 인식';
        }catch(e){
          if(current()){$('scanResult').textContent=detector?'기본 인식 사용 중 · 호환 모듈 로딩 실패':'바코드 인식 모듈 로딩 실패 · 카메라를 다시 켜거나 번호를 입력하세요.';softwareFailed=true;}
        }finally{loading=false;}
      };
      // Start local decoding immediately when native detection is unavailable.
      if(!detector)void loadSoftware();
      const decodeSoftware=()=>{
        const w=video.videoWidth,h=video.videoHeight;if(!reader||!w||!h)return null;
        if(!ctx)ctx=canvas.getContext('2d',{willReadFrequently:true});
        if(!ctx)throw Error('카메라 영상 처리 실패');
        // Alternate full frame and central horizontal band without reducing
        // horizontal resolution: narrow Code 128 bars need enough pixels.
        const full=(frameNo++%3===2),sw=w,sh=full?h:Math.max(1,Math.round(h*.55)),sy=Math.round((h-sh)/2);
        const scale=Math.min(1,1600/sw),dw=Math.max(1,Math.round(sw*scale)),dh=Math.max(1,Math.round(sh*scale));
        if(canvas.width!==dw)canvas.width=dw;if(canvas.height!==dh)canvas.height=dh;
        ctx.drawImage(video,0,sy,sw,sh,0,0,dw,dh);
        try{return reader.decodeFromCanvas(canvas)?.getText()||null;}catch(_){return null;}
      };
      const detect=()=>{
        if(!current())return;
        if(video.readyState>=2){
          let raw=nativeValue,source='기본 인식';nativeValue=null;
          if(detector&&!nativeBusy){
            nativeBusy=true;
            Promise.resolve().then(()=>detector.detect(video)).then(found=>{if(current())nativeValue=found?.[0]?.rawValue||null;}).catch(()=>{detector=null;}).finally(()=>{nativeBusy=false;});
          }
          if(!raw){source='호환 인식';try{raw=decodeSoftware();}catch(e){if(current())$('scanResult').textContent='영상 처리 오류 · '+e.message;}}
          if(raw){misses=0;cameraDetected(raw,source);}
          else if(++misses>=6||!detector)void loadSoftware();
        }
        if(current())nativeTimer=setTimeout(detect,180);
      };
      control.textContent='카메라 끄기';
      $('scanResult').textContent=detector?'카메라 준비 완료 · 바코드를 맞춰주세요.':'호환 바코드 인식 준비 중…';
      detect();
    }catch(error){
      if(generation!==cameraGeneration)return;
      stopCamera();$('scanResult').textContent='카메라 실행 실패: '+(error.message||'카메라 권한을 확인하세요.');
    }finally{if(generation===cameraGeneration)control.disabled=false;}
  }

  function exportData() {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ddsm-backup-' + today() + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('작업 사본을 저장했습니다.');
  }
  function centerId(){return /^d_([A-Za-z0-9-]{1,40})_/.exec(driverToken)?.[1]||'';}
  function centerDisplay(){const id=centerId();return id?(localStorage.getItem('ddsm:center:name:v1:'+id)||(id==='chungju'?'충주센터':id)):'연결 대기';}
  function renderSettings(){
    const state=syncBlocked?'저장 충돌 · 센터 문의':!driverToken?'센터 연결 필요':syncedDate!==date?'동기화 필요':syncFault?'서버 연결 확인 필요':syncPending||syncBusy?'서버 저장 중':'서버 저장 완료';
    $('syncLabel').textContent=state;$('dailyPhoneLabel').textContent=state;
    $('settingsDateLabel').textContent=dateText(date);
    $('centerLabel').textContent=driverToken?centerDisplay()+' · 연결됨':'로그인 필요';
    $('centerDetails').textContent=driverToken?centerDisplay()+'에 연결되어 있습니다.':'센터 코드를 입력하여 로그인하세요.';
    $('logoutDriver').classList.toggle('hidden',!driverToken);
    $('centerCodeForm').classList.toggle('hidden',Boolean(driverToken));
    $('recoveryTools').classList.toggle('hidden',!syncBlocked);
    $('soundToggle').checked=scanSound;$('vibrationToggle').checked=scanVibration;
  }
  function openDriverDialog(id){
    stopCamera();$('settingsDialog').close();
    renderSettings();$(id).showModal();
  }
  function resumeScan(){if(view==='home'&&driverToken&&syncedDate===date&&!document.querySelector('dialog[open]'))openScan();}
  async function manualSync(){
    if(!driverToken){openDriverDialog('centerSettingsDialog');return false;}
    if(syncBlocked){toast('저장 충돌 상태입니다. 작업 사본을 저장하고 센터에 문의하세요.');return false;}
    if(connecting||manualSyncBusy||scanWorkerActive||pendingScans.length||syncBusy){toast('작업 처리 중입니다. 완료 후 다시 시도하세요.');return false;}
    manualSyncBusy=true;
    const token=driverToken,dayKey=date;
    try{
      if(syncPending){await flushDay();renderSettings();if(syncPending||syncBlocked||token!==driverToken||dayKey!==date)return false;}
      if(syncedDate!==date){if(!await activateDay(date))return false;}
      else{
        const epoch=syncEpoch;
        const remote=await serverDay(dayKey,token);
        if(token!==driverToken||date!==dayKey||epoch!==syncEpoch||syncPending||syncBusy||syncBlocked||scanWorkerActive||pendingScans.length){
          toast('작업이 변경되었습니다. 저장 완료 후 다시 시도하세요.');return false;
        }
        syncFault=false;
        if(remote.revision>=serverRevision){
          serverRevision=remote.revision;data.days[dayKey]=remote.day;
          try{localStorage.setItem(activeStorageKey(),JSON.stringify(data));}catch(_){}
          render();
        }
      }
      renderSettings();toast('서버 동기화 완료');return true;
    }catch(e){
      if(token===driverToken&&dayKey===date){syncFault=true;renderSettings();}
      toast(e.message||'동기화 실패');return false;
    }finally{manualSyncBusy=false;}
  }
  async function refreshMap(){
    if(view!=='delivery'||workTab!=='map'||mapRefreshBusy)return;
    mapRefreshBusy=true;
    const button=$('mapRefresh'),dayKey=date,token=driverToken;
    button.disabled=true;button.setAttribute('aria-busy','true');
    closeMapPopup();
    try{
      if(!await manualSync())return;
      if(view!=='delivery'||workTab!=='map'||date!==dayKey||driverToken!==token)return;
      window.DDSM_DeliveryMap?.prepareRefresh?.();
      await renderDayMap();
    }finally{
      mapRefreshBusy=false;button.disabled=false;button.setAttribute('aria-busy','false');
    }
  }
  function renderStats(value){
    const rounds=(value?.rounds||[]).slice().sort((a,b)=>a.no-b.no);
    const all=rounds.flatMap(r=>r.stops||[]),done=all.filter(s=>s.status==='done').length;
    const root=$('statsContent');root.replaceChildren();
    const summary=node('div','stats-summary');
    for(const [label,count] of [['전체 배송',all.length],['배송 예정',all.length-done],['배송 완료',done]]){
      const item=node('div','stats-metric');item.append(node('span','',label),node('strong','',String(count)));summary.append(item);
    }
    const percent=all.length?Math.round(done/all.length*100):0;
    const progress=node('div','stats-overall');progress.append(node('strong','','완료율 '+percent+'%'));
    const track=node('div','stats-track'),fill=node('div','stats-fill');fill.style.width=percent+'%';track.append(fill);progress.append(track);
    root.append(summary,progress,node('h3','stats-heading','회차별 배송'));
    for(const r of rounds){
      const items=r.stops||[],completed=items.filter(s=>s.status==='done').length;
      const details=node('details','stats-round'),head=node('summary','');
      head.append(node('strong','',r.no+'회차'),node('span','',completed+' / '+items.length+'건 완료'));
      details.append(head);
      if(!items.length)details.append(node('p','stats-empty','배송 내역 없음'));
      for(const s of items){
        const row=node('div','stats-stop');
        const info=node('div','');info.append(node('strong','',s.recipient||s.waybill),node('small','',s.address||'주소 미지정'));
        row.append(info,node('span',s.status==='done'?'stats-done':'stats-pending',s.status==='done'?'완료':'예정'));details.append(row);
      }
      root.append(details);
    }
    if(!all.length)root.append(node('p','stats-empty','선택한 날짜의 배송 내역이 없습니다.'));
  }
  async function loadStats(){
    const key=$('statsDate').value,token=driverToken,request=++statsRequest;
    $('statsNext').disabled=key>=today();$('statsContent').replaceChildren();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||key>today()){ $('statsStatus').textContent='배송일을 확인하세요.';return;}
    if(!token){$('statsStatus').textContent='센터에 로그인한 후 배송 현황을 확인하세요.';return;}
    if(key===date&&syncedDate===date){
      $('statsStatus').textContent=syncPending||syncBusy||syncBlocked||syncFault?'현재 기기 작업 기준 · 서버 저장 상태 확인 필요':'현재 배송 작업 기준';
      renderStats(day());return;
    }
    $('statsStatus').textContent='서버에서 배송 내역을 불러오는 중…';
    try{
      const remote=await serverDay(key,token);
      if(request!==statsRequest||token!==driverToken||!$('statsDialog').open)return;
      $('statsStatus').textContent='서버 저장 내역 기준';renderStats(remote.day);
    }catch(e){if(request===statsRequest&&$('statsDialog').open)$('statsStatus').textContent=e.message||'배송 현황 조회 실패';}
  }
  function stepStats(delta){
    const value=$('statsDate').value;if(!value)return;
    const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+delta);
    const key=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    if(key>today())return;$('statsDate').value=key;void loadStats();
  }
  function logoutDriver(){
    if(syncPending||syncBusy||syncBlocked||scanWorkerActive||pendingScans.length||connecting){toast('서버 저장 및 스캔 처리 완료 후 로그아웃하세요.');return;}
    if(!driverToken)return;
    if(syncedDate!==date){toast('서버 동기화 후 로그아웃하세요.');return;}
    if(!confirm('센터 연결을 종료할까요? 다시 로그인하려면 센터 코드가 필요합니다.'))return;
    stopCamera();
    try{localStorage.removeItem(TOKEN_KEY);}catch(_){toast('로그아웃 실패');return;}
    invalidateDriverAuth();$('scanDetails').textContent='';$('scanDetails').classList.add('hidden');++statsRequest;recentScanTimes.clear();$('statsContent').replaceChildren();$('scanResult').textContent='센터에 로그인하세요.';
    renderSettings();toast('로그아웃 완료');
  }
  async function loginWithCode(event){
    event.preventDefault();
    if(driverToken||codeLoginBusy)return;
    const input=$('centerCode'),status=$('centerCodeStatus'),code=input.value;
    if(!/^[0-9]{8}$/.test(code)){status.textContent='숫자 8자리 센터 코드를 입력하세요.';return;}
    codeLoginBusy=true;input.disabled=true;$('loginSubmit').disabled=true;$('closeCenterSettings').disabled=true;
    status.textContent='센터 연결 중…';
    try{
      await window.DDSM_CenterLink.connectCode(code);
      const synced=await restoreConnection();
      if(!driverToken)throw Error('인증 후 로그인 정보를 확인하지 못했습니다.');
      input.value='';status.textContent='센터 연결 완료';
      if($('centerSettingsDialog').open)$('centerSettingsDialog').close();
      $('scanResult').textContent=synced?'센터 연결 완료 · 운송장을 스캔하세요.':'센터 연결 완료 · 서버 동기화가 필요합니다.';
      toast(synced?'센터 로그인 완료':'센터 연결 완료 · 동기화 필요');
      if(synced)resumeScan();
    }catch(e){status.textContent=e.message||'센터 로그인 실패';}
    finally{codeLoginBusy=false;input.disabled=false;$('loginSubmit').disabled=false;$('closeCenterSettings').disabled=false;}
  }

  function bind() {
    $('myPhoneButton').addEventListener('click',()=>{if(!driverToken)openDriverDialog('centerSettingsDialog');else void manualSync();});
    $('dateButton').addEventListener('click', chooseDate);
    $('dateInput').addEventListener('change', async e => {
      const value = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      if(syncPending || syncBusy || syncBlocked || scanWorkerActive || pendingScans.length) {
        toast('서버 저장 완료 후 날짜를 변경하세요.');e.target.value=date;return;
      }
      date=value;render();
      if(driverToken) {await activateDay(value);resumeScan();}
    });
    $('roundSelect').addEventListener('change', e => {
      setSelectedRound(e.target.value);
    });
    $('newRoundButton').addEventListener('click', addRound);
    $('scanTab').addEventListener('click',()=>showView('home'));
    $('workScanButton').addEventListener('click',()=>showView('home'));
    $('mapTab').addEventListener('click',()=>openWorkTab('map'));
    $('listTab').addEventListener('click',()=>openWorkTab('list'));
    $('deleteEditStop').addEventListener('click',()=>{const id=editingId;$('editDialog').close();removeStop(id);closeMapPopup();});
    $('backButton').addEventListener('click',()=>showView('home'));
    $('deliveryRoundSelect').addEventListener('change',e=>setSelectedRound(e.target.value));
    $('mapLocate').addEventListener('click',()=>{
      closeMapPopup();
      const dm=window.DDSM_DeliveryMap;
      if(!dm?.locate){toast('지도 모듈을 확인하세요.');return;}
      dm.locate(toast);
    });
    $('mapFitAll').addEventListener('click',()=>{
      closeMapPopup();
      if(!window.DDSM_DeliveryMap?.fitAll())toast('현재 회차에 지도 표시 가능한 배송지가 없습니다.');
    });
    $('mapRefresh').addEventListener('click',()=>void refreshMap());
    $('mapRound').addEventListener('click',()=>{
      const rounds=day().rounds.map(r=>r.no).sort((a,b)=>a-b);
      if(rounds.length<2)return;
      setSelectedRound(rounds[(rounds.indexOf(round().no)+1)%rounds.length]);
    });
    bindMapWheel();
    $('waybillInput').addEventListener('pointerdown', event => {
      // An intentional touch on the field enables the touchscreen keyboard.
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      const input = $('waybillInput');
      if (input.getAttribute('inputmode') === 'text') return;
      input.setAttribute('inputmode', 'text');
      // Already-focused inputmode=none fields need a fresh focus on Android.
      input.blur();
      input.focus({ preventScroll: true });
    });
    $('scanForm').addEventListener('submit', e => { e.preventDefault(); processScan($('waybillInput').value); });
    $('cameraButton').addEventListener('click', () => {
      prepareScanAudio();
      if (cameraStream || zxingControls) stopCamera(); else startCamera();
    });
    $('editForm').addEventListener('submit', saveEdit);
    $('closeEdit').addEventListener('click', () => $('editDialog').close());
    $('addressInput').addEventListener('input', updateAddressMap);
    $('editDialog').addEventListener('close', closeAddressMap);
    $('settingsButton').addEventListener('click',()=>openDriverDialog('settingsDialog'));
    $('closeSettings').addEventListener('click',()=>$('settingsDialog').close());
    $('settingsDate').addEventListener('click',()=>{$('settingsDialog').close();chooseDate();});
    $('openStats').addEventListener('click',()=>{openDriverDialog('statsDialog');$('statsDate').max=today();$('statsDate').value=date>today()?today():date;void loadStats();});
    $('closeStats').addEventListener('click',()=>$('statsDialog').close());
    $('statsDate').addEventListener('change',loadStats);$('statsPrev').addEventListener('click',()=>stepStats(-1));$('statsNext').addEventListener('click',()=>stepStats(1));
    $('syncNow').addEventListener('click',manualSync);
    $('openCenterSettings').addEventListener('click',()=>openDriverDialog('centerSettingsDialog'));
    $('closeCenterSettings').addEventListener('click',()=>$('centerSettingsDialog').close());
    $('logoutDriver').addEventListener('click',logoutDriver);
    $('centerCodeForm').addEventListener('submit',loginWithCode);
    $('centerCode').addEventListener('input',e=>{e.target.value=e.target.value.replace(/[^0-9]/g,'').slice(0,8);});
    $('centerSettingsDialog').addEventListener('cancel',e=>{if(codeLoginBusy)e.preventDefault();});
    $('soundToggle').addEventListener('change',e=>{scanSound=e.target.checked;try{localStorage.setItem('ddsm:pref:sound',scanSound?'on':'off');}catch(_){}});
    $('vibrationToggle').addEventListener('change',e=>{scanVibration=e.target.checked;try{localStorage.setItem('ddsm:pref:vibration',scanVibration?'on':'off');}catch(_){}});
    $('exportButton').addEventListener('click',exportData);
    for(const id of ['settingsDialog','statsDialog','centerSettingsDialog']){
      $(id).addEventListener('close',()=>{if(id==='statsDialog')++statsRequest;resumeScan();});
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopCamera(); else if(view==='home')openScan();
    });
    window.addEventListener('storage', e => {
      if (e.key === activeStorageKey() && driverToken) {
        if (!driverToken) { data=readData();render(); }
        else void refreshDay();
      } else if (e.key === TOKEN_KEY && e.newValue !== driverToken) {
        invalidateDriverAuth(true);
      }
    });
  }
  bind();
  setInterval(()=>{if(syncPending) void flushDay();else void refreshDay();},3000);
  const initialPage=rememberedPage();
  if(initialPage==='list'||initialPage==='map'){workTab=initialPage;showView('delivery');}
  else{document.body.dataset.page='scan';render();}
  void restoreConnection().then(ok=>{if(ok&&view==='home')openScan();else if(view==='home')$('scanResult').textContent='센터 연결 및 서버 동기화 후 스캔할 수 있습니다.';});
})();
