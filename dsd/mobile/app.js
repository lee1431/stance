'use strict';
const $=id=>document.getElementById(id);
const state={stops:[],csrf:'',stream:null,map:null,markers:[],clientId:'',mapLoading:false,selected:null,ocr:null,ocrBusy:false,cameraTrack:null,cameraCaps:{},cameraBusy:false};
const base=location.pathname.includes('/dsd/')?location.pathname.split('/dsd/')[0]+'/dsd/':'/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.display='none',4000)}
async function api(path,options={}){const method=options.method||'GET';const r=await fetch(base+path.replace(/^\//,''),{...options,credentials:'same-origin',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':state.csrf}:{}),...(options.headers||{})}});if(r.status===401){location.href=base+'login';throw Error('로그인이 필요합니다')}const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'HTTP '+r.status);return j}
async function init(){try{const auth=await api('api/auth/me');state.csrf=auth.csrfToken;$('account').textContent=auth.user.username;const cfg=await api('api/config').catch(()=>({}));state.clientId=cfg.clientId||localStorage.getItem('deliveryMapClientId')||'';await refresh()}catch(e){toast(e.message)}}
async function refresh(){const r=await api('api/stops');state.stops=r.stops;renderList();if(state.map)drawMarkers()}
function renderList(){$('count').textContent=state.stops.length+'건';$('list').innerHTML=state.stops.length?state.stops.slice().reverse().map(s=>'<button class="stop" data-id="'+s.id+'"><span><strong>'+esc(s.name)+'</strong><small>'+esc(s.address)+(s.location?' · '+esc(s.location):'')+'</small></span><span class="pill '+(s.completed?'done':'')+'">'+(s.completed?'✓ 완료':'미배송')+'</span></button>').join(''):'<p class="detail-note">촬영 후 주소를 등록하면 여기에 표시됩니다.</p>';$('list').querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>openDetail(Number(el.dataset.id)))}
function scannerStatus(message){$('scanStatus').textContent=message;}
function scanner(){
  if(state.ocr)return state.ocr;
  if(!window.DoroFastOCR)throw Error('OCR 엔진 파일을 불러오지 못했습니다');
  state.ocr=DoroFastOCR.create({
    video:$('video'),guide:document.querySelector('.target'),
    parse:parseWaybill,
    onStatus:scannerStatus,
    onMetric:message=>{$('progress').textContent=message;},
    onBusy:busy=>{state.ocrBusy=busy;$('progress').hidden=!busy;$('shutter').disabled=busy||!state.stream;},
    onReview:(parsed,raw,confidence,message)=>{
      $('ocrRaw').value=raw;
      $('recipient').value=parsed.name;
      $('address').value=parsed.address;
      $('review').hidden=false;
      scannerStatus(message+' · OCR '+Math.round(confidence)+'%');
      $('review').scrollIntoView({behavior:'smooth',block:'nearest'});
    },
    onAutoSave:async parsed=>{
      const address=parsed.address.trim().replace(/\s+/g,' ');
      const name=parsed.name.trim();
      // The current backend has no unique waybill ID; do not merge distinct
      // parcels silently. Same recipient/address always requires a review.
      if(state.stops.some(s=>s.address.trim().replace(/\s+/g,' ')===address&&s.name.trim()===name))return false;
      await api('api/stops',{method:'POST',body:JSON.stringify({stops:[{name,address}]})});
      await refresh();
      toast('자동 등록 완료 · '+name);
      return true;
    }
  });
  return state.ocr;
}

const cameraEl=id=>$(id);
function cameraMessage(message){cameraEl('cameraInfo').textContent=message;}
function cameraCapabilities(track){
  try{return typeof track.getCapabilities==='function'?track.getCapabilities()||{}:{};}
  catch(_){return {};}
}
async function cameraConstraint(values){
  const track=state.cameraTrack;
  if(!track||track.readyState!=='live')throw Error('카메라가 연결되지 않았습니다');
  if(typeof track.applyConstraints!=='function')throw Error('브라우저가 카메라 조절을 지원하지 않습니다');
  await track.applyConstraints({advanced:[values]});
}
async function listCameras(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  try{
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(x=>x.kind==='videoinput'&&x.deviceId);
    const select=cameraEl('cameraSelect');
    const active=state.cameraTrack?.getSettings?.().deviceId;
    select.replaceChildren();
    devices.forEach((device,i)=>{
      const option=document.createElement('option');
      option.value=device.deviceId;
      option.textContent=device.label||'카메라 '+(i+1);
      select.appendChild(option);
    });
    if(active&&devices.some(x=>x.deviceId===active))select.value=active;
    cameraEl('cameraChoice').hidden=devices.length<2;
  }catch(_){cameraEl('cameraChoice').hidden=true;}
}
function updateFocusControls(){
  const caps=state.cameraCaps||{};
  const modes=Array.isArray(caps.focusMode)?caps.focusMode:[];
  const zoom=caps.zoom;
  const hasZoom=zoom&&Number.isFinite(zoom.min)&&Number.isFinite(zoom.max)&&zoom.max>zoom.min;
  const row=cameraEl('zoomRow');
  row.hidden=!hasZoom;
  if(hasZoom){
    const range=cameraEl('zoomSlider'),settings=state.cameraTrack?.getSettings?.()||{};
    const min=Math.max(zoom.min,1),max=Math.min(zoom.max,4);
    row.hidden=max<=min;
    if(!row.hidden){
      range.min=min;range.max=max;range.step=zoom.step>0?zoom.step:0.1;
      range.value=Math.max(min,Math.min(max,Number(settings.zoom)||min));
      cameraEl('zoomValue').textContent=Number(range.value).toFixed(1)+'×';
    }
  }
  cameraEl('refocus').disabled=false;
  cameraEl('focusSupport').textContent=modes.includes('continuous')?
    '연속 자동초점 사용 가능':'초점 조절은 기기·브라우저에서 제한될 수 있습니다';
}
async function setContinuousFocus(){
  const modes=state.cameraCaps.focusMode;
  if(!Array.isArray(modes)||!modes.includes('continuous'))return false;
  try{
    await cameraConstraint({focusMode:'continuous'});
    return true;
  }catch(_){return false;}
}
async function refocus(){
  if(state.cameraBusy)return;
  const track=state.cameraTrack;
  if(!track)return toast('카메라를 먼저 켜주세요');
  state.ocr?.setVisible(false);
  const button=cameraEl('refocus');
  button.disabled=true;
  try{
    const modes=Array.isArray(state.cameraCaps.focusMode)?state.cameraCaps.focusMode:[];
    if(modes.includes('single-shot')){
      try{
        await cameraConstraint({focusMode:'single-shot'});
        await new Promise(resolve=>setTimeout(resolve,350));
      }catch(_){}
    }
    const continuous=await setContinuousFocus();
    if(continuous)cameraMessage('자동초점 다시 적용 · 송장을 20~35cm 거리에서 고정하세요');
    else{
      cameraMessage('카메라 재시작으로 초점을 다시 시도합니다');
      await startCamera(cameraEl('cameraSelect').value||null);
    }
  }catch(e){cameraMessage('초점 조절 실패: '+e.message);}
  finally{
    button.disabled=false;
    state.ocr?.setVisible(!$('scanView').hidden);
  }
}
async function setZoom(){
  const slider=cameraEl('zoomSlider');
  const requested=Number(slider.value);
  if(!Number.isFinite(requested)||!state.cameraTrack)return;
  state.ocr?.setVisible(false);
  slider.disabled=true;
  try{
    await cameraConstraint({zoom:requested});
    const applied=Number(state.cameraTrack.getSettings?.().zoom)||requested;
    slider.value=applied;
    cameraEl('zoomValue').textContent=applied.toFixed(1)+'×';
    cameraMessage('확대 적용 · 너무 가까우면 오히려 흐릴 수 있습니다');
  }catch(e){cameraMessage('배율 조절을 지원하지 않습니다: '+e.message);}
  finally{
    slider.disabled=false;
    state.ocr?.setVisible(!$('scanView').hidden);
  }
}
async function startCamera(deviceId){
  if(state.cameraBusy)return;
  if(!navigator.mediaDevices?.getUserMedia){toast('카메라를 사용할 수 없습니다. HTTPS 또는 사진 선택을 이용하세요.');return;}
  state.cameraBusy=true;
  cameraEl('startCamera').disabled=true;
  state.ocr?.setVisible(false);
  try{
    state.stream?.getTracks().forEach(track=>track.stop());
    state.cameraTrack=null;
    state.cameraCaps={};
    const video=typeof deviceId==='string'&&deviceId?
      {deviceId:{exact:deviceId},width:{ideal:1920},height:{ideal:1080}}:
      {facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}};
    state.stream=await navigator.mediaDevices.getUserMedia({audio:false,video});
    state.cameraTrack=state.stream.getVideoTracks()[0];
    $('video').srcObject=state.stream;
    await $('video').play();
    state.cameraCaps=cameraCapabilities(state.cameraTrack);
    cameraEl('cameraTools').hidden=false;
    await setContinuousFocus();
    await listCameras();
    updateFocusControls();
    cameraMessage('송장을 20~35cm 거리에서 비추고 초점을 맞추세요');
    $('cameraHint').hidden=true;
    $('shutter').disabled=false;
    scanner().setEnabled($('autoScan').checked);
    scanner().prewarm().catch(e=>scannerStatus('OCR 준비 실패: '+e.message));
  }catch(e){
    cameraMessage('카메라 연결 실패: '+(e.message||e));
    toast('카메라 선택 또는 권한을 확인해 주세요');
  }finally{
    state.cameraBusy=false;
    cameraEl('startCamera').disabled=false;
    if(state.cameraTrack?.readyState==='live')state.ocr?.setVisible(!$('scanView').hidden);
  }
}
function capture(){try{scanner().manualCapture();}catch(e){toast(e.message);}}
async function recognize(blob){
  try{await scanner().recognizePhoto(blob);}
  catch(e){toast('사진 인식 실패: '+e.message);}
}
function parseWaybill(text){const lines=String(text).split(/\r?\n/).map(x=>x.replace(/[|｜]/g,' ').trim()).filter(Boolean);let address='',name='';const addrRe=/(충청북도|충북|충청남도|충남|서울|경기|경기도|인천|부산|대구|대전|광주|울산|세종|강원|전북|전남|경북|경남|제주|[가-힣]+시\s*[가-힣]+(?:구|군)|[가-힣]+(?:로|길|동|읍|면)\s*\d)/;const labelRe=/^(?:받는\s*분|받는\s*사람|수취인|수령인|받는곳|주소|배송지)\s*[:：]?\s*/;for(let i=0;i<lines.length;i++){const l=lines[i];if(!name){const m=l.match(/(?:받는\s*분|수취인|수령인|받는\s*사람)\s*[:：]?\s*([가-힣]{2,5})/);if(m)name=m[1]}if(!address&&addrRe.test(l)){address=l.replace(labelRe,'').replace(/\s*(?:전화|연락처|휴대폰|TEL)\s*[:：]?.*$/i,'').trim();if(i+1<lines.length&&/^(?:\d{1,4}\s*(?:동|호)|\d{1,4}[- ]\d{1,4}호|\([^)]{2,}\))/.test(lines[i+1]))address+=' '+lines[i+1]}}return {name,address}}
async function saveStop(){const name=$('recipient').value.trim()||'수취인 미확인',address=$('address').value.trim().replace(/\s+/g,' ');if(address.length<5)return toast('주소를 확인해 주세요');const duplicate=state.stops.find(s=>s.address.trim().replace(/\s+/g,' ')===address&&s.name===name);if(duplicate&&!confirm('같은 수취인과 주소가 있습니다. 별도 배송건으로 등록할까요?'))return;$('saveStop').disabled=true;try{await api('api/stops',{method:'POST',body:JSON.stringify({stops:[{name,address}]})});$('review').hidden=true;await refresh();scanner().markSaved({name,address});toast('배송지 등록 완료')}catch(e){toast('등록 실패: '+e.message)}finally{$('saveStop').disabled=false}}
function openDetail(id){const s=state.stops.find(x=>x.id===id);if(!s)return;state.selected=id;$('detail').innerHTML='<div class="detail-field"><b>'+esc(s.name)+'</b><p>'+esc(s.address)+' '+esc(s.location||'')+'</p></div><div class="detail-field">배송 상태: <b>'+(s.completed?'배송완료':'미배송')+'</b></div><p class="detail-note">이번 버전은 주소 인식만 지원합니다. 송장 사진·착불·화물·정기·반품 구분은 다음 단계에서 추가됩니다.</p>';$('modal').hidden=false}
async function mark(completed){if(state.selected===null)return;try{await api('api/stops/'+state.selected,{method:'PATCH',body:JSON.stringify({completed})});$('modal').hidden=true;await refresh();toast(completed?'배송완료 처리했습니다':'미배송으로 변경했습니다')}catch(e){toast(e.message)}}
function tab(which){$('scanView').hidden=which!=='scan';$('mapView').hidden=which!=='map';if(state.ocr)state.ocr.setVisible(which==='scan');$('tabScan').classList.toggle('active',which==='scan');$('tabMap').classList.toggle('active',which==='map');if(which==='map'){loadMap();setTimeout(()=>{if(state.map){const r=$('map').getBoundingClientRect();state.map.setSize(new naver.maps.Size(r.width,r.height));fitMap()}},150)}}
function loadMap(){if(state.map){drawMarkers();return}if(state.mapLoading)return;if(!state.clientId){$('mapFallback').textContent='네이버지도 Client ID가 없습니다. 기존 DSD 설정에서 연결해 주세요.';return}state.mapLoading=true;const s=document.createElement('script');s.src='https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId='+encodeURIComponent(state.clientId);s.onload=()=>{state.mapLoading=false;if(!window.naver?.maps?.Map){$('mapFallback').textContent='지도 SDK 로드 실패';return}state.map=new naver.maps.Map('map',{center:new naver.maps.LatLng(36.991,127.926),zoom:13});$('mapFallback').hidden=true;drawMarkers()};s.onerror=()=>{state.mapLoading=false;$('mapFallback').textContent='지도 연결 실패: 도메인과 Client ID를 확인하세요'};document.head.appendChild(s)}
function drawMarkers(){if(!state.map)return;state.markers.forEach(m=>m.setMap(null));state.markers=[];state.stops.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng)&&s.status==='mapped').forEach(s=>{const marker=new naver.maps.Marker({map:state.map,position:new naver.maps.LatLng(s.lat,s.lng),icon:{content:'<div class="marker '+(s.completed?'done':'')+'">'+esc(s.name)+'</div>',anchor:new naver.maps.Point(15,32)}});naver.maps.Event.addListener(marker,'click',()=>openDetail(s.id));state.markers.push(marker)});fitMap();const missing=state.stops.filter(s=>!Number.isFinite(s.lat)||!Number.isFinite(s.lng)).length;if(missing)toast(missing+'건은 좌표 미등록으로 지도에 표시되지 않습니다. 기존 DSD에서 좌표 변환하세요.')}
function fitMap(){if(!state.map)return;const valid=state.stops.filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lng));if(!valid.length)return;if(valid.length===1){state.map.setCenter(new naver.maps.LatLng(valid[0].lat,valid[0].lng));state.map.setZoom(17);return}const bounds=new naver.maps.LatLngBounds();valid.forEach(s=>bounds.extend(new naver.maps.LatLng(s.lat,s.lng)));state.map.fitBounds(bounds)}
$('startCamera').onclick=()=>startCamera();$('refocus').onclick=refocus;$('cameraSelect').onchange=e=>startCamera(e.target.value);$('zoomSlider').oninput=e=>{$('zoomValue').textContent=Number(e.target.value).toFixed(1)+'×';};$('zoomSlider').onchange=setZoom;$('shutter').onclick=capture;$('photo').onchange=e=>{const f=e.target.files[0];if(f)recognize(f);e.target.value=''};$('saveStop').onclick=saveStop;$('cancelReview').onclick=()=>{$('review').hidden=true;state.ocr?.resume();};$('autoScan').onchange=e=>{try{scanner().setEnabled(e.target.checked);}catch(err){toast(err.message);}};$('tabMap').onclick=()=>tab('map');$('tabScan').onclick=()=>tab('scan');$('closeModal').onclick=()=>$('modal').hidden=true;$('markPending').onclick=()=>mark(false);$('markDone').onclick=()=>mark(true);$('fitMap').onclick=fitMap;$('retryMap').onclick=()=>{state.mapLoading=false;loadMap()};window.addEventListener('pagehide',()=>{state.ocr?.dispose();state.stream?.getTracks().forEach(t=>t.stop());});init();