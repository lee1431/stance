/* DDSM daily / scan / delivery. Center-scoped device delivery workflow. */
(function () {
  'use strict';

  const DRIVER_API_BASE = 'https://mrdindoin.ddns.net/ddsm/api/driver/';
  const TOKEN_KEY = 'ddsm:center:driver:v1';
  let driverToken = '';
  let connecting = null;
  let syncedDate = '', serverRevision = 0, syncBusy = false, syncPending = false, syncBlocked = false, syncEpoch = 0;
  const WORK_API = DRIVER_API_BASE + 'work-day';
  function invalidateDriverAuth(notify = false) {
    driverToken = '';
    ++syncEpoch; syncedDate = ''; syncPending = false; syncBlocked = false;
    data = freshData(); closeMapPopup(); render();
    if (notify) toast('연결이 끊겼습니다. 센터에서 받은 연결 링크를 확인하세요.');
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
          toast('센터에서 받은 기사 연결 링크로 처음 한 번 접속하세요.'); return false;
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
      serverRevision=remote.revision;
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
      if (epoch===syncEpoch) toast('서버 동기화 실패: '+e.message);
      return false;
    }
  }
  async function flushDay() {
    if (syncBusy || !syncPending || syncBlocked || !driverToken || syncedDate!==date) return;
    syncBusy=true;
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
          toast('다른 기기와 저장 충돌: JSON 백업 후 새로고침하세요.');
          break;
        }
        if(!res.ok || body?.ok!==true) {
          syncPending=true;
          toast('서버 저장 대기: '+(body?.error||'연결 오류'));break;
        }
        serverRevision=body.revision;
      }
    } catch(_) {
      if(epoch===syncEpoch){syncPending=true;toast('서버 연결 오류 · 자동 재전송 대기');}
    } finally {syncBusy=false;}
  }
  async function refreshDay() {
    if(!driverToken || syncedDate!==date || syncPending || syncBusy || syncBlocked ||
       document.hidden || $('editDialog')?.open || scanWorkerActive || pendingScans.length || mapSelected || pinDraft) return;
    const token=driverToken, dayKey=date, epoch=syncEpoch;
    try {
      const remote=await serverDay(dayKey,token);
      if(epoch!==syncEpoch || token!==driverToken || date!==dayKey || syncPending || syncBusy || scanWorkerActive || mapSelected || pinDraft) return;
      if(remote.revision>serverRevision) {
        serverRevision=remote.revision;
        data.days[dayKey]=remote.day;
        try {localStorage.setItem(activeStorageKey(),JSON.stringify(data));}catch(_){}
        render();toast('다른 기기의 변경사항을 동기화했습니다.');
      }
    } catch(_) {}
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
  let view = 'home';
  let workTab = 'map';
  let mapSelected = null, pinDraft = null, wheelValue = 1, wheelDrag = null, wheelFrame = 0;
  const recentScanTimes = new Map();
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
        toast('저장 충돌 상태입니다. JSON 백업 후 새로고침하세요.');
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
    cancelAnimationFrame(wheelFrame); wheelFrame=0; wheelDrag=null;
    mapSelected=null; pinDraft=null;
    $('mapPopup').classList.add('hidden'); $('pinPopup').classList.add('hidden');
    window.DDSM_DeliveryMap?.clearDraft();
  }
  const wrapOrder = n => { const count=Math.max(1,stops().length);return ((n-1)%count+count)%count+1; };
  function renderWheel(offset=0) {
    const root=$('wheelNumbers'); root.replaceChildren();
    const count=stops().length;
    for(let i=-2;i<=2;i++){
      const line=node('div','wheel-number'+(i===0?' current':''),count>1||i===0?String(wrapOrder(wheelValue+i)):'');
      line.style.transform='translateY('+offset+'px)';root.append(line);
    }
    const wheel=$('orderWheel');wheel.setAttribute('aria-valuemax',String(Math.max(1,count)));wheel.setAttribute('aria-valuenow',String(wheelValue));
    $('mapOrderSave').textContent=wheelValue+'번으로 변경';
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
  function selectMapStop(id, roundNo) {
    if(round().no!==roundNo||view!=='delivery'||workTab!=='map')return;
    const stop=stops().find(s=>s.id===id);if(!stop)return;
    closeMapPopup(); mapSelected=id; wheelValue=stops().indexOf(stop)+1;
    $('mapPopupName').textContent=stop.recipient||stop.waybill;
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
    const wheel=$('orderWheel'),row=37;
    const finish=()=>{wheelFrame=0;renderWheel();};
    const cancel=()=>{cancelAnimationFrame(wheelFrame);wheelFrame=0;};
    wheel.addEventListener('wheel',e=>{e.preventDefault();cancel();wheelValue=wrapOrder(wheelValue+Math.sign(e.deltaY)*Math.max(1,Math.round(Math.abs(e.deltaY)/50)));renderWheel();},{passive:false});
    wheel.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key))return;e.preventDefault();cancel();wheelValue=e.key==='Home'?1:e.key==='End'?stops().length:wrapOrder(wheelValue+({ArrowUp:-1,ArrowDown:1,PageUp:-10,PageDown:10}[e.key]||0));renderWheel();});
    wheel.addEventListener('pointerdown',e=>{e.preventDefault();cancel();wheelDrag={start:e.clientY,last:e.clientY,base:wheelValue,t:performance.now(),v:0};wheel.setPointerCapture(e.pointerId);});
    wheel.addEventListener('pointermove',e=>{if(!wheelDrag)return;const now=performance.now(),delta=(wheelDrag.start-e.clientY)/row,step=Math.round(delta);wheelDrag.v=.5*wheelDrag.v+.5*(wheelDrag.last-e.clientY)/Math.max(8,now-wheelDrag.t);wheelDrag.last=e.clientY;wheelDrag.t=now;wheelValue=wrapOrder(wheelDrag.base+step);renderWheel((step-delta)*row);});
    wheel.addEventListener('pointerup',()=>{if(!wheelDrag)return;let remaining=performance.now()-wheelDrag.t<100?Math.max(-40,Math.min(40,wheelDrag.v*9)):0;wheelDrag=null;
      function glide(){if(Math.abs(remaining)<.7){finish();return;}const step=Math.sign(remaining)*Math.max(1,Math.round(Math.abs(remaining)*.24));wheelValue=wrapOrder(wheelValue+step);renderWheel();remaining*=.74;wheelFrame=requestAnimationFrame(glide);}glide();});
    wheel.addEventListener('pointercancel',()=>{wheelDrag=null;cancel();finish();});
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
    Promise.resolve(window.DDSM_DeliveryMap.render(date, selected, {
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
    if (navigator.vibrate) navigator.vibrate(45);
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
    scanShutterSound();
    clearTimeout(scanFlashTimer);
    dialog.classList.remove('scan-read-flash');
    // Restart animation on consecutive scans, including a duplicate code.
    void dialog.offsetWidth;
    dialog.classList.add('scan-read-flash');
    scanFlashTimer = setTimeout(() => dialog.classList.remove('scan-read-flash'), 540);
  }
  function openScan() {
    if(view!=='home'){showView('home');return;}
    const input=$('waybillInput');
    input.setAttribute('inputmode','none');
    prepareScanAudio();
    if(!cameraStream&&!zxingControls&&!$('cameraButton').disabled)void startCamera();
    input.focus({preventScroll:true});
  }
  const pendingScans = [];
  let scanWorkerActive = false;
  async function lookupWaybill(raw, dateKey) {
    const parsed = window.DDSM_Waybill?.parse(raw);
    if (!parsed?.valid) throw Error('운송장번호는 기본 13자리 또는 물품 16자리여야 합니다.');
    if (!driverToken) throw Error('센터 연결이 필요합니다.');
    const response = await fetch(
      DRIVER_API_BASE+'waybill?date='+encodeURIComponent(dateKey)
        +'&barcode='+encodeURIComponent(parsed.scanned),
      {method:'GET',headers:{Authorization:'Bearer '+driverToken},credentials:'omit',cache:'no-store'}
    );
    const payload = await response.json().catch(()=>null);
    if (!response.ok || payload?.ok!==true) {
      if (response.status===401) invalidateDriverAuth(true);
      throw Error(payload?.error||'서버 운송장 조회 실패 (HTTP '+response.status+')');
    }
    if (payload.master_waybill!==parsed.master) throw Error('원본 운송장과 조회 결과가 일치하지 않습니다.');
    return payload;
  }
  async function drainScanQueue() {
    if (scanWorkerActive) return;
    scanWorkerActive=true;
    try {
      while (pendingScans.length) {
        const job=pendingScans.shift();
        $('scanResult').textContent = '운송장 조회 중 · '+job.raw;
        try {
          const detail=await lookupWaybill(job.raw,job.date);
          if (job.date!==date || job.roundNo!==round().no)
            throw Error('배송일 또는 회차가 변경되었습니다. 다시 스캔하세요.');
          const result=addWaybill(job.raw,detail);
          if (result.error) throw Error(result.error);
          const message='등록 · '+(detail.recipient||result.stop.waybill);
          $('scanResult').textContent=message;
        } catch(e) {
          const message=e.message||'운송장 조회 실패';
          $('scanResult').textContent=message;
          if(!job.camera)toast(message);
        } finally {
          if (!job.camera && view === 'home') {
            $('waybillInput').focus({preventScroll:true});
          }
        }
      }
    } finally {scanWorkerActive=false;}
  }
  function processScan(raw, camera = false) {
    if (!String(raw||'').trim()) return false;
    if (syncedDate !== date || syncBlocked) { toast('서버 동기화가 필요합니다.'); return false; }
    if (!driverToken) {
      const message='센터 연결 후 다시 스캔하세요.';
      $('scanResult').textContent=message;
      toast(message);
      return false;
    }
    scanReadFeedback();
    if (pendingScans.length>=20) {
      $('scanResult').textContent='스캔 대기열이 가득 찼습니다. 조회 완료 후 다시 스캔하세요.';
      return false;
    }
    pendingScans.push({raw:String(raw).trim(),camera,date,roundNo:round().no});
    if (!camera) {
      $('waybillInput').value='';
      $('waybillInput').focus({preventScroll:true});
    }
    drainScanQueue();
    return true;
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
  function cameraDetected(value) {
    const now = Date.now();
    if (value === lastCameraValue && now - lastCameraAt < 2500) return;
    lastCameraValue = value;
    lastCameraAt = now;
    processScan(value, true);
  }
  function loadZXing() {
    if (barcodeDecoder) return barcodeDecoder;
    barcodeDecoder = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
      script.async = true;
      script.onload = () => window.ZXingBrowser ? resolve(window.ZXingBrowser) : reject(new Error('바코드 모듈이 없습니다.'));
      script.onerror = () => reject(new Error('바코드 모듈 다운로드 실패'));
      document.head.append(script);
    }).catch(error => { barcodeDecoder = null; throw error; });
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
    const generation = ++cameraGeneration;
    const video = $('cameraVideo');
    const control = $('cameraButton');
    if(view!=='home'||control.disabled)return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('scanResult').textContent = '이 브라우저에서는 카메라를 사용할 수 없습니다. 운송장번호를 직접 입력하세요.';
      return;
    }
    control.disabled = true;
    $('scanResult').textContent = '카메라를 준비하고 있습니다.';
    try {
      if (typeof window.BarcodeDetector === 'function') {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode:{ideal:'environment'},
            width:{ideal:1280},height:{ideal:720}
          }, audio:false
        });
        if (generation !== cameraGeneration || view !== 'home') {
          stream.getTracks().forEach(track => track.stop()); return;
        }
        cameraStream = stream;
        video.srcObject = stream;
        video.classList.remove('hidden');
        await video.play();
        const autoFocus = await enableContinuousFocus(video);
        if (generation !== cameraGeneration) return;
        $('scanResult').textContent = autoFocus ? '연속 자동 초점 활성화 · 바코드를 맞춰주세요.'
          : '기본 카메라 자동 초점 · 바코드를 맞춰주세요.';
        const detector = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_8', 'ean_13', 'itf'] });
        const detect = async () => {
          if (generation !== cameraGeneration) return;
          try {
            if (video.readyState >= 2) {
              const found = await detector.detect(video);
              if (found && found.length && found[0].rawValue) cameraDetected(found[0].rawValue);
            }
          } catch (_) {}
          if (generation === cameraGeneration) nativeTimer = setTimeout(detect, 160);
        };
        detect();
      } else {
        const zxing = await loadZXing();
        if (generation !== cameraGeneration || view !== 'home') return;
        const Reader = zxing.BrowserMultiFormatOneDReader || zxing.BrowserMultiFormatReader;
        if (!Reader) throw new Error('카메라 스캔 모듈을 사용할 수 없습니다.');
        const reader = new Reader();
        video.classList.remove('hidden');
        const callback = result => {
          if (generation === cameraGeneration && result) cameraDetected(result.getText());
        };
        // Prefer the back camera even when native BarcodeDetector is absent.
        const controls = typeof reader.decodeFromConstraints === 'function'
          ? await reader.decodeFromConstraints({
            video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}
          },video,callback)
          : await reader.decodeFromVideoDevice(undefined,video,callback);
        if (generation !== cameraGeneration) { controls.stop(); return; }
        zxingControls = controls;
        await enableContinuousFocus(video);
        if (generation !== cameraGeneration) return;
      }
      control.textContent = '카메라 끄기';
      $('scanResult').textContent = '카메라 준비 완료 · 자동 초점 (기기 지원 시)';
    } catch (error) {
      if(generation!==cameraGeneration)return;
      stopCamera();
      $('scanResult').textContent = '카메라 실행 실패: ' + (error.message || '권한과 브라우저 설정을 확인하세요.');
    } finally {
      if(generation===cameraGeneration)control.disabled = false;
    }
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
    toast('JSON 백업 파일을 만들었습니다.');
  }
  function validateBackup(value) {
    if (!isData(value) || Object.keys(value.days).length > 730) throw Error('지원되지 않는 백업 형식입니다.');
    const result = freshData();
    for (const [key, d] of Object.entries(value.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !d || !Array.isArray(d.rounds) || d.rounds.length > 100) throw Error('백업 데이터가 올바르지 않습니다.');
      const used = new Set();
      const rounds = d.rounds.map(r => {
        if (!Number.isInteger(r.no) || r.no < 1 || r.no > 100 || used.has(r.no) || !Array.isArray(r.stops) || r.stops.length > 5000) throw Error('회차 데이터 오류');
        used.add(r.no);
        const codes = new Set();
        const stops = r.stops.map(s => {
          if (!s || !s.waybill || typeof s.waybill !== 'string') throw Error('운송장 데이터 오류');
          const waybill = clean(s.waybill, 100);
          if (codes.has(waybill)) throw Error('운송장 중복');
          codes.add(waybill);
          return {
            id: makeId(), waybill, recipient: clean(s.recipient,100),
            address: clean(s.address,250), phone: clean(s.phone,25),
            memo: clean(s.memo,500), status: s.status === 'done' ? 'done' : 'pending',
            createdAt: clean(s.createdAt,80),
            scannedItems: Array.isArray(s.scannedItems) ? [...new Set(s.scannedItems.filter(x=>/^\d{3}$/.test(x)))].slice(0,999) : [],
            ...(validCoordinates(s) ? { lat: s.lat, lng: s.lng } : {})
          };
        });
        return { no: r.no, stops };
      });
      result.days[key] = { selected: used.has(d.selected) ? d.selected : (rounds[0] ? rounds[0].no : 1), rounds: rounds.length ? rounds : [{ no: 1, stops: [] }] };
    }
    return result;
  }
  async function importData(file) {
    if (!file) return;
    try {
      if (file.size > 3 * 1024 * 1024) throw Error('3MB 이하 JSON 파일만 가져올 수 있습니다.');
      const incoming = validateBackup(JSON.parse(await file.text()));
      if (!confirm('현재 이 브라우저에 있는 DDSM 데이터를 모두 백업 내용으로 바꿀까요?')) return;
      const previous = data;
      data = incoming;
      if (!persist()) { data = previous; return; }
      $('settingsDialog').close();
      render();
      toast('백업을 불러왔습니다.');
    } catch (error) { toast('가져오기 실패: ' + (error.message || 'JSON 형식을 확인하세요.')); }
    finally { $('importInput').value = ''; }
  }

  function bind() {
    $('myPhoneButton').addEventListener('click',()=>{if(!syncPending&&!syncBusy)void restoreConnection();});
    $('dateButton').addEventListener('click', chooseDate);
    $('dateInput').addEventListener('change', async e => {
      const value = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      if(syncPending || syncBusy || syncBlocked || scanWorkerActive || pendingScans.length) {
        toast('서버 저장 완료 후 날짜를 변경하세요.');e.target.value=date;return;
      }
      date=value;render();
      if(driverToken) await activateDay(value);
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
    $('settingsButton').addEventListener('click', () => $('settingsDialog').showModal());
    $('closeSettings').addEventListener('click', () => $('settingsDialog').close());
    $('exportButton').addEventListener('click', exportData);
    $('importInput').addEventListener('change', e => importData(e.target.files[0]));
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
  document.body.dataset.page='scan';
  render();
  void restoreConnection().then(ok=>{if(ok&&view==='home')openScan();else if(view==='home')$('scanResult').textContent='센터 연결 및 서버 동기화 후 스캔할 수 있습니다.';});
})();
