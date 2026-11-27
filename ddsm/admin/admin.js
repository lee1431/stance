/* DDSM center console. Never cache recipient data in browser storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API_BASE = 'https://mrdindoin.ddns.net/ddsm/api/';
  const dateString = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  };
  let authToken = '', rows = [], columns = [], map = null, maps = null, markers = [], selected = null;
  let updateSeq = 0, mapLoading = null, editorOpen = false, fitOnce = false;
  let currentPage = 0, visibleFiltered = [];
  let addressRow = null, autoLocationWrite = null;
  const chunkSize = 250;
  const valid = p => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
  const say = (id, message) => { $(id).textContent = message; };
  async function api(path, options={}) {
    const opts = { credentials: 'omit', cache: 'no-store', ...options };
    opts.headers = { ...(opts.headers || {}), ...(authToken ? {Authorization:'Bearer '+authToken} : {}) };
    if (opts.body instanceof FormData) delete opts.headers['Content-Type'];
    else if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(API_BASE + path, opts);
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || !json.ok) {
      const error=new Error(json?.error || 'API 응답 오류 (' + response.status + ')');error.status=response.status;throw error;
    }
    return json;
  }
  const get = path => api(path);
  const post = (path, body) => api(path, { method:'POST', body });
  const ADMIN_KEY='ddsm:center:admin:v1', SESSION_KEY='ddsm:admin:session:v2';
  let availableCenters=[],currentCenter=null,authBusy=false;
  function forgetLegacyKey(){try{localStorage.removeItem(ADMIN_KEY);}catch(_){}}
  function storedSession(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');}catch(_){return null;}}
  function forgetSession(){try{sessionStorage.removeItem(SESSION_KEY);}catch(_){}}
  function saveSession(result){try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({token:result.token,center:result.center,expires_at:result.expires_at}));}catch(_){}}
  function fillCenters(){
    const picker=$('centerSelect');picker.replaceChildren();
    for(const center of availableCenters){const option=document.createElement('option');option.value=center.id;option.textContent=center.name;picker.append(option);}
    if(!availableCenters.length)throw Error('등록된 센터가 없습니다.');
    picker.disabled=false;$('openCenter').disabled=false;
    $('adminPasswordRow').hidden=false;$('adminPassword').required=true;
    say('centerStatus','센터를 선택하고 관리자 비밀번호를 입력하세요.');
  }
  async function enterCenter(center){
    await get('admin/me');currentCenter=center;
    $('centerPanel').hidden=true;$('dashboard').hidden=false;$('changeCenter').hidden=false;
    say('authBadge',center.name);
    await loadDay();void loadRecurring();
  }
  async function validateSession(){
    if(authBusy)return;authBusy=true;
    $('openCenter').disabled=true;$('centerSelect').disabled=true;
    say('centerStatus','센터 목록을 불러오는 중');
    try{
      const params=new URLSearchParams(location.hash.slice(1));
      if(params.has('admin'))history.replaceState(null,'',location.pathname+location.search);
      authToken='';forgetLegacyKey();
      $('adminPasswordRow').hidden=false;$('adminPassword').required=true;
      try{
        const result=await get('connection/admin-centers');availableCenters=result.centers;
      }catch(e){
        throw Error('센터 목록 조회 실패 · S10의 신규 관리자 로그인 API와 연결 상태를 확인하세요. ('+e.message+')');
      }
      fillCenters();
      const saved=storedSession();
      if(saved&&saved.expires_at>Date.now()/1000){
        const center=availableCenters.find(c=>c.id===saved.center);
        if(center&&typeof saved.token==='string'&&saved.token.startsWith('s_'+center.id+'_')){
          $('centerSelect').value=center.id;authToken=saved.token;
          try{await enterCenter(center);return;}catch(_){forgetSession();authToken='';say('centerStatus','관리자 세션이 만료되었습니다. 다시 로그인하세요.');}
        }
      }
      forgetSession();authToken='';
    }catch(e){authToken='';say('centerStatus',e.message||'센터 연결 실패');}
    finally{authBusy=false;}
  }
  async function openCenter(event){
    event?.preventDefault();
    if(authBusy)return;
    const center=availableCenters.find(c=>c.id===$('centerSelect').value);
    if(!center)return;
    authBusy=true;$('openCenter').disabled=true;$('centerSelect').disabled=true;$('adminPassword').disabled=true;
    try{
      const password=$('adminPassword').value;
      if(!password)throw Error('관리자 비밀번호를 입력하세요.');
      authToken='';
      const result=await post('connection/admin-login',{center:center.id,password});
      if(result.center!==center.id||typeof result.token!=='string'||!result.token.startsWith('s_'+center.id+'_')||!Number.isFinite(result.expires_at))throw Error('관리자 인증 응답 오류');
      authToken=result.token;saveSession(result);forgetLegacyKey();
      $('adminPassword').value='';
      await enterCenter(center);
    }catch(e){forgetSession();authToken='';say('centerStatus',e.message);}
    finally{authBusy=false;$('openCenter').disabled=false;$('centerSelect').disabled=false;$('adminPassword').disabled=false;}
  }
  async function leaveCenter(){
    if(authBusy)return;authBusy=true;
    $('changeCenter').disabled=true;
    try{if(authToken.startsWith('s_'))await post('connection/admin-logout',{});}
    catch(e){if(e.status!==401&&e.status!==403){say('authBadge','로그아웃 실패 · 다시 시도');$('changeCenter').disabled=false;authBusy=false;return;}}
    forgetSession();forgetLegacyKey();authToken='';
    location.reload();
  }
  let activeCode='',codeExpiry=0,codeTimer=null,codeRequest=0;
  function clearDriverCode(){
    codeRequest++;clearInterval(codeTimer);codeTimer=null;activeCode='';codeExpiry=0;
    $('driverCodeValue').textContent='--------';$('copyDriverCode').disabled=true;
  }
  function updateCodeExpiry(){
    const remaining=Math.max(0,Math.ceil(codeExpiry-Date.now()/1000));
    if(!remaining){activeCode='';$('driverCodeValue').textContent='--------';$('copyDriverCode').disabled=true;say('driverCodeExpiry','코드 만료 · 새 코드를 발급하세요.');clearInterval(codeTimer);codeTimer=null;return;}
    say('driverCodeExpiry','남은 시간 '+Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0'));
  }
  async function issueDriverCode(renew=false){
    if(!currentCenter)return;
    clearDriverCode();const requestId=codeRequest,center=currentCenter.id;
    $('renewDriverCode').disabled=true;say('driverCodeExpiry','코드 발급 중…');
    try{
      const result=await post('connection/code',{renew});
      if(requestId!==codeRequest||!$('driverCodeDialog').open||currentCenter?.id!==center)return;
      if(!/^[0-9]{8}$/.test(result.code||'')||!Number.isFinite(result.expires_at)||result.center!==center)throw Error('코드 발급 응답 오류');
      activeCode=result.code;codeExpiry=result.expires_at;
      $('driverCodeValue').textContent=activeCode.slice(0,4)+' '+activeCode.slice(4);
      $('copyDriverCode').disabled=false;updateCodeExpiry();
      if(activeCode)codeTimer=setInterval(updateCodeExpiry,1000);
    }catch(e){if(requestId===codeRequest)say('driverCodeExpiry','코드 발급 실패 · '+(e.message||'센터 서버를 확인하세요.'));}
    finally{if(requestId===codeRequest)$('renewDriverCode').disabled=false;}
  }
  function showDriverCode(){
    if(!currentCenter)return;
    say('driverCodeCenter',currentCenter.name);$('driverCodeDialog').showModal();void issueDriverCode();
  }
  async function copyDriverCode(){
    if(!activeCode||Date.now()/1000>=codeExpiry){updateCodeExpiry();return;}
    try{await navigator.clipboard.writeText(activeCode);say('driverCodeStatus','기사 연결 코드 복사 완료');}
    catch(_){say('driverCodeStatus','코드를 직접 읽어서 전달하세요.');}
  }
  function mapNotice(message, small=false) {
    const el = $('mapPlaceholder');
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('hint',small);
  }
  async function ensureMap() {
    if (mapLoading) return mapLoading;
    mapLoading = window.DDSM_NaverMap.loadSdk().then(n => {
      maps = n;
      map = new n.Map($('mapCanvas'),{
        center:new n.LatLng(36.991,127.925), zoom:12,
        zoomControl:true, zoomControlOptions:{position:n.Position.TOP_RIGHT},
        scaleControl:false, mapDataControl:false
      });
      mapNotice('위치가 저장된 배송지가 없습니다. 지도를 이동할 수 있습니다.',true);
      return map;
    }).catch(err => {
      mapLoading=null;
      mapNotice('네이버 지도 연결 실패: '+(err.message||err));
      throw err;
    });
    return mapLoading;
  }
  function clearMarkers() {
    markers.forEach(item=>item.marker.setMap(null));
    markers=[];
  }
  let recurringMap=null,recurringMaps=null,recurringDraft=null,recurringSeq=0,manualLocationBusy=false;
  const recurringEdits=new Map();
  function recurringField(row,key,label,limit){
    const input=document.createElement('input');input.type=key==='phone'?'tel':'text';
    input.value=recurringEdits.get(row.id)?.[key]??row[key]??'';input.maxLength=limit;
    input.setAttribute('aria-label',label+' · '+row.recipient_name);
    input.placeholder=label;
    if(key==='address')input.className='recurring-address';
    input.addEventListener('input',()=>{
      const edit=recurringEdits.get(row.id)||{recipient_name:row.recipient_name,phone:row.phone||'',address:row.address||''};
      edit[key]=input.value;recurringEdits.set(row.id,edit);
    });
    const cell=document.createElement('td');cell.append(input);return {cell,input};
  }
  async function beforeManualLocation(){
    // Stop the automatic geocode batch before writing a manual correction.
    ++updateSeq;
    if(autoLocationWrite)await autoLocationWrite.done.catch(()=>{});
  }
  async function refreshSaved(message){
    const results=await Promise.allSettled([loadDayWithoutGeocode(),loadRecurring()]);
    const failed=results.filter(r=>r.status==='rejected'||r.value===false);
    say('importStatus',message+(failed.length?' · 목록 갱신 실패: '+(failed[0].reason?.message||'정기배송 목록 조회 실패'):' · 목록 및 지도 갱신 완료'));
    return !failed.length;
  }
  async function persistRecurring(row,fields,point=null){
    if(manualLocationBusy)return false;
    manualLocationBusy=true;
    try{
      await beforeManualLocation();
      await post('admin/recurring-recipients/'+row.id+'/update',{...fields,...(point||{})});
      recurringEdits.delete(row.id);
      const refreshed=await refreshSaved('정기배송 고객 저장 완료');
      if(!refreshed)say('recurringStatus','저장 완료 · 목록 새로고침이 필요합니다.');
      return true;
    }finally{manualLocationBusy=false;}
  }
  async function openRecurringMap(row,fields){
    const seq=++recurringSeq;recurringDraft={row,fields};
    $('recurringMapAddress').value=fields.address;
    say('recurringMapName',fields.recipient_name);
    say('recurringMapStatus','지도를 불러오는 중…');
    $('recurringMapSave').disabled=true;
    $('recurringMapDialog').showModal();
    try{
      recurringMaps=await window.DDSM_NaverMap.loadSdk();
      if(seq!==recurringSeq||!$('recurringMapDialog').open)return;
      const n=recurringMaps;
      const initial=valid(row)?new n.LatLng(row.lat,row.lng):(map?map.getCenter():new n.LatLng(36.991,127.925));
      if(!recurringMap)recurringMap=new n.Map($('recurringMapCanvas'),{center:initial,zoom:valid(row)?17:12,zoomControl:true,scaleControl:false,mapDataControl:false});
      else{recurringMap.setCenter(initial);recurringMap.setZoom(valid(row)?17:12);}
      n.Event.trigger(recurringMap,'resize');
      $('recurringMapSave').disabled=false;
      say('recurringMapStatus','지도를 움직여 중앙 핀을 정확한 배송지에 맞추세요.');
    }catch(e){say('recurringMapStatus','지도 연결 실패: '+e.message);}
  }
  async function searchRecurringMap(){
    if(!recurringDraft||!recurringMap)return;
    const address=$('recurringMapAddress').value.trim(),seq=recurringSeq;
    if(address.length<4){say('recurringMapStatus','정확한 주소를 입력하세요.');return;}
    say('recurringMapStatus','주소 검색 중…');
    $('recurringMapSearch').disabled=true;$('recurringMapSave').disabled=true;
    try{
      const p=await window.DDSM_Address.resolve(recurringMaps,[address],{manual:true});
      if(seq!==recurringSeq)return;
      if(!p){say('recurringMapStatus','주소를 찾지 못했습니다. 지도에서 직접 지정하세요.');return;}
      recurringMap.setCenter(new recurringMaps.LatLng(p.lat,p.lng));recurringMap.setZoom(17);
      say('recurringMapStatus','지도 중앙 핀을 실제 배송지에 맞춘 뒤 저장하세요.');
    }catch(e){if(seq===recurringSeq)say('recurringMapStatus',e.message);}
    finally{$('recurringMapSearch').disabled=false;if(seq===recurringSeq)$('recurringMapSave').disabled=false;}
  }
  async function saveRecurringMap(){
    if(!recurringDraft||!recurringMap||$('recurringMapSave').disabled||manualLocationBusy)return;
    const {row,fields}=recurringDraft,center=recurringMap.getCenter();
    $('recurringMapSave').disabled=true;$('recurringMapCancel').disabled=true;$('recurringMapSearch').disabled=true;
    try{
      if(await persistRecurring(row,{...fields,address:$('recurringMapAddress').value.trim()},{lat:center.lat(),lng:center.lng()}))$('recurringMapDialog').close();
    }catch(e){say('recurringMapStatus','저장 실패: '+e.message);}
    finally{$('recurringMapSave').disabled=false;$('recurringMapCancel').disabled=false;$('recurringMapSearch').disabled=false;}
  }
  async function loadRecurring() {
    try {
      const result=await get('admin/recurring-recipients?q='+encodeURIComponent($('recurringSearch').value.trim()));
      const root=$('recurringBody');root.replaceChildren();
      result.recipients.forEach(row=>{
        const tr=document.createElement('tr');
        const name=recurringField(row,'recipient_name','수취인명',160);
        const phone=recurringField(row,'phone','연락처',40);
        const address=recurringField(row,'address','주소',250);
        const fields=()=>({recipient_name:name.input.value.trim(),phone:phone.input.value.trim(),address:address.input.value.trim()});
        tr.append(name.cell,phone.cell,address.cell);
        const location=document.createElement('td'),pin=document.createElement('button');
        pin.type='button';pin.textContent=valid(row)?'위치 수정':'위치 지정';
        pin.className=valid(row)?'mapped':'missing';pin.addEventListener('click',()=>void openRecurringMap(row,fields()));
        location.append(pin);tr.append(location);
        const td=document.createElement('td'),actions=document.createElement('div'),save=document.createElement('button'),remove=document.createElement('button');
        actions.className='recurring-actions';save.type=remove.type='button';save.className='primary';save.textContent='저장';remove.textContent='등록 해제';
        save.addEventListener('click',async()=>{
          if(manualLocationBusy)return;save.disabled=true;remove.disabled=true;
          try{await persistRecurring(row,fields());}
          catch(e){say('recurringStatus','저장 실패: '+e.message);}
          finally{save.disabled=false;remove.disabled=false;}
        });
        remove.addEventListener('click',async()=>{
          if(manualLocationBusy||!confirm('이 고객의 자동 참조 등록을 해제할까요?'))return;
          try{await post('admin/recurring-recipients/'+row.id+'/remove',{});recurringEdits.delete(row.id);await loadRecurring();}
          catch(e){say('recurringStatus',e.message);}
        });
        actions.append(save,remove);td.append(actions);tr.append(td);root.append(tr);
      });
      say('recurringStatus','등록 고객 '+result.recipients.length+'건 · 각 항목 수정 후 저장 (최대 500건 표시)');
    } catch(e){say('recurringStatus','조회 실패: '+e.message);return false;}
    return true;
  }
  function renderUnlocated() {
    const missing=rows.filter(row=>!row.located);
    $('unlocatedPanel').hidden=missing.length===0;
    const target=$('unlocatedChips');target.replaceChildren();
    const LIMIT=100;
    const groups=new Map();
    missing.forEach(row=>{
      const name=String(row.business_name||'').trim();
      const phone=String(row.recipient_phone||'').replace(/\D/g,'');
      const key=row.name_only&&name ? JSON.stringify([name,phone]) : String(row.id);
      const group=groups.get(key)||{row,count:0};group.count++;groups.set(key,group);
    });
    const grouped=[...groups.values()];
    grouped.slice(0,LIMIT).forEach(({row,count})=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='unlocated-chip';
      button.textContent=(row.business_name||'상호 미입력') + (row.name_only?' · 주소 없음':' · 주소 확인') + (count>1?' · '+count+'건':'');
      button.title='배송지 위치 지정: '+(row.business_name||row.waybill||'미입력');
      button.addEventListener('click',()=>selectRow(row.id));
      target.append(button);
    });
    if(grouped.length>LIMIT){
      const more=document.createElement('span');
      more.textContent='외 '+(grouped.length-LIMIT)+'건 · 미확인 목록 전체 보기에서 확인';
      more.className='unlocated-more';
      target.append(more);
    }
  }
  function fit() {
    if (!map || !markers.length) return;
    maps.Event.trigger(map,'resize');
    if(markers.length===1) {
      map.setCenter(markers[0].marker.getPosition());map.setZoom(16);return;
    }
    const bounds=new maps.LatLngBounds();
    markers.forEach(x=>bounds.extend(x.marker.getPosition()));
    map.fitBounds(bounds,{top:65,bottom:60,left:60,right:60});
  }
  function rowName(row) {return row.business_name||row.waybill||'상호 미입력';}
  function drawMap() {
    if (!map) return;
    clearMarkers();
    // One marker per unique destination, with shipment count in tooltip.
    const locations=new Map();
    for (const row of rows) {
      if(!row.located || !valid(row))continue;
      const id=String(row.destination_id || row.id);
      if(!locations.has(id))locations.set(id,{row,count:0});
      locations.get(id).count++;
    }
    let order=0;
    for (const group of locations.values()) {
      const row=group.row;
      const count=++order;
      const marker=new maps.Marker({
        map, position:new maps.LatLng(row.lat,row.lng),
        icon:{
          content:'<div class="admin-map-marker">' + count + '</div>',
          size:new maps.Size(30,32),
          anchor:new maps.Point(15,29)
        },
        title:rowName(row)+' · '+group.count+'건',
        clickable:true
      });
      maps.Event.addListener(marker,'click',()=>selectRow(row.id));
      markers.push({marker,id:row.id});
    }
    const placeholder=$('mapPlaceholder');
    if(markers.length)placeholder.hidden=true;
    else mapNotice(rows.length
        ? '아직 지도 위치가 확인되지 않았습니다. 주소 좌표 찾기를 실행하세요.'
        : '당일 배송지가 없습니다. 엑셀을 업로드하세요.',true);
    say('mapCount',String(rows.filter(x=>x.located).length));
    say('missingCount',String(rows.filter(x=>!x.located).length));
    if(!fitOnce&&markers.length){fitOnce=true;requestAnimationFrame(fit);}
  }
  let deliveryStatusSeq=0,adminProofSeq=0,adminProofUrl='',adminProofFile='';
  function clearAdminProof(){
    ++adminProofSeq;if(adminProofUrl)URL.revokeObjectURL(adminProofUrl);adminProofUrl='';
    $('adminProofImage').hidden=true;$('adminProofImage').removeAttribute('src');$('adminProofDownload').disabled=true;
  }
  async function viewAdminProof(row,dayKey){
    const token=authToken;clearAdminProof();const seq=adminProofSeq;
    say('adminProofInfo',(row.recipient||row.waybill)+' · 사진 조회 중…');$('adminProofDialog').showModal();
    try{
      const query=new URLSearchParams({date:dayKey,user_id:String(row.user_id),stop_id:row.stop_id});
      const res=await fetch(API_BASE+'admin/delivery-proof?'+query,{credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer '+token}});
      if(!res.ok)throw Error((await res.json().catch(()=>null))?.error||'사진 조회 실패');
      if(!/^image\/jpeg/i.test(res.headers.get('Content-Type')||''))throw Error('사진 응답 형식 오류');
      const blob=await res.blob();if(seq!==adminProofSeq||token!==authToken)return;
      adminProofUrl=URL.createObjectURL(blob);adminProofFile='DDSM-'+dayKey+'-'+String(row.stop_id).replace(/[^A-Za-z0-9_-]/g,'')+'.jpg';
      $('adminProofImage').src=adminProofUrl;$('adminProofImage').hidden=false;$('adminProofDownload').disabled=false;
      say('adminProofInfo',row.recipient||row.waybill);
    }catch(e){if(seq===adminProofSeq)say('adminProofInfo',e.message);}
  }
  async function loadDeliveryStatus(){
    const dayKey=$('deliveryDate').value,seq=++deliveryStatusSeq,token=authToken,root=$('deliveryStatusBody');
    root.replaceChildren();say('deliveryStatusInfo','배송내역 조회 중…');
    try{
      const result=await get('admin/delivery-status?date='+encodeURIComponent(dayKey));
      if(seq!==deliveryStatusSeq||token!==authToken||dayKey!==$('deliveryDate').value)return;
      const done=result.rows.filter(r=>r.status==='done').length;
      say('deliveryStatusInfo','등록 '+result.rows.length+'건 · 완료 '+done+'건 · 배송 예정 '+(result.rows.length-done)+'건');
      const fragment=document.createDocumentFragment();
      for(const row of result.rows){
        const tr=document.createElement('tr');
        for(const value of [row.waybill,row.recipient,row.driver,row.round+'회차',row.status==='done'?'완료':'배송 예정']){
          const td=document.createElement('td');td.textContent=value;tr.append(td);
        }
        const td=document.createElement('td');
        if(row.has_photo){const b=document.createElement('button');b.type='button';b.textContent='사진 보기';b.addEventListener('click',()=>void viewAdminProof(row,dayKey));td.append(b);}
        else td.textContent='—';tr.append(td);fragment.append(tr);
      }
      root.append(fragment);
    }catch(e){if(seq===deliveryStatusSeq)say('deliveryStatusInfo','배송현황 조회 실패: '+e.message);}
  }
  async function loadDay() {
    void loadDeliveryStatus();
    const date=$('deliveryDate').value;
    const token=++updateSeq;
    say('importStatus','당일 원본 데이터 조회 중…');
    try {
      const info=await get('admin/deliveries?date='+encodeURIComponent(date));
      if(token!==updateSeq)return;
      rows=info.rows;
      columns=info.columns;
      say('totalCount',String(info.total));
      say('mapCount',String(info.located));
      say('missingCount',String(info.unlocated));
      say('lastImport',info.last_import?.filename||'—');
      say('importStatus',date+' · 원본 '+info.total+'건 · 위치 미확인 '+info.unlocated+'건');
      fitOnce=false;
      selected=null;
      closeEditor();
      renderTable();
      renderUnlocated();
      try { await ensureMap();drawMap();} catch (_) {}
      if(token!==updateSeq)return;
      // Use a bounded number of address queries; avoids unexpectedly exhausting map quota.
      if(rows.length&&rows.some(x=>!x.located&&(x.registry_address||x.source_address))) autoGeocode(60);
    } catch(e){if(token===updateSeq)say('importStatus','조회 실패: '+e.message);}
  }
  async function importExcel(event) {
    event.preventDefault();
    if(!$('excelFile').files[0])return;
    const file=$('excelFile').files[0],date=$('deliveryDate').value;
    if(file.size>8*1024*1024){say('importStatus','8MB 이하 파일만 지원합니다.');return;}
    const body=new FormData();
    body.append('date',date);body.append('file',file,file.name);
    const button=$('importBtn');button.disabled=true;
    say('importStatus','원본 엑셀을 분석하고 모든 행을 저장하는 중…');
    try {
      const result=await post('admin/import',body);
      geocodeTried.clear();
      await loadDay();
      say('importStatus',file.name+' · '+result.imported+'행 반영 · 신규 '+result.added+'건 / 갱신 '+result.updated+'건');
    }catch(e){say('importStatus','업로드 실패: '+e.message);}
    finally{button.disabled=false;}
  }
  const textCell=(text)=>{const td=document.createElement('td');td.textContent=String(text??'');return td;};
  function displayedRows() {
    const filter=$('filterSelect').value;
    const q=$('searchInput').value.trim().toLocaleLowerCase();
    return rows.filter(r=>{
      if(filter==='missing'&&r.located)return false;
      if(filter==='name-only'&&!r.name_only)return false;
      if(filter==='mapped'&&!r.located)return false;
      if(!q)return true;
      return [r.waybill,r.business_name,r.registry_address,r.source_address,
        r.cod_amount,r.recipient_phone].some(x=>String(x||'').toLocaleLowerCase().includes(q));
    });
  }
  function appendPage() {
    const tbody=$('rawBody');
    for(const row of visibleFiltered.slice(currentPage*chunkSize,(currentPage+1)*chunkSize)){
      const tr=document.createElement('tr');tr.dataset.id=String(row.id);
      const action=document.createElement('td');
      const actions=document.createElement('div');actions.className='row-actions';
      const button=document.createElement('button');button.type='button';
      button.className='row-edit';button.textContent=row.located?'위치 수정':'위치 지정';
      button.addEventListener('click',()=>selectRow(row.id));
      const addressButton=document.createElement('button');addressButton.type='button';
      addressButton.textContent='주소 입력';
      addressButton.addEventListener('click',()=>openAddressDialog(row.id));
      actions.append(button,addressButton);action.append(actions);tr.append(action);
      const state=textCell(row.located?'● 지도 표시':'○ 위치 미확인');
      state.className=row.located?'mapped':'missing';tr.append(state);
      tr.append(textCell(row.waybill));
      tr.append(textCell(row.business_name||'수취인 미입력'));
      tr.append(textCell(row.registry_address||row.source_address||'주소 없음'));
      tr.append(textCell(row.cod_amount||'미확인'));
      tr.append(textCell(row.recipient_phone||'연락처 없음'));
      tbody.append(tr);
    }
    currentPage++;
    const shown=Math.min(currentPage*chunkSize,visibleFiltered.length);
    $('tableInfo').textContent='전체 '+rows.length+'건 · 검색 '+visibleFiltered.length+'건 · 표시 '+shown+'건';
    const more=$('showMoreBtn');
    if(more)more.hidden=shown>=visibleFiltered.length;
  }
  function renderTable() {
    const head=$('rawHeader'),body=$('rawBody');head.replaceChildren();body.replaceChildren();
    const tr=document.createElement('tr');
    ['작업','지도 상태','운송장','수취인명','주소','착불유무','연락처'].forEach(c=>{
      const th=document.createElement('th');th.textContent=c;tr.append(th);
    });head.append(tr);
    visibleFiltered=displayedRows();currentPage=0;appendPage();
  }
  function focusSelectedRow(id) {
    document.querySelectorAll('.row-selected').forEach(el=>el.classList.remove('row-selected'));
    const match=[...$('rawBody').children].find(tr=>tr.dataset.id===String(id));
    if(match){match.classList.add('row-selected');match.scrollIntoView({block:'nearest',behavior:'smooth'});}
  }
  function openAddressDialog(id) {
    const row = rows.find(item => item.id === id);
    if (!row) return;
    addressRow = row;
    say('addressRowInfo', rowName(row) + ' · 운송장 ' + (row.waybill || '미등록'));
    $('newAddress').value = row.registry_address || (row.name_only?'':row.source_address) || '';
    $('rememberAddress').checked=Boolean(row.name_only);
    say('addressError', '');
    $('addressDialog').showModal();
    $('newAddress').select();
  }
  async function saveAddress(event) {
    event.preventDefault();
    const dialog = $('addressDialog');
    const button = $('saveAddressBtn');
    const input = $('newAddress');
    const row = addressRow;
    if (!row || button.disabled || manualLocationBusy) return;
    const address = input.value.trim();
    if (!address) {
      say('addressError', '배송 주소를 입력하세요.');
      input.focus();
      return;
    }
    const cancel = $('cancelAddressBtn');
    manualLocationBusy=true;
    button.disabled = cancel.disabled = input.readOnly = true;
    say('addressError', '');
    try {
      // Save the address first. Existing manually verified coordinates take priority.
      const targetDate=$('deliveryDate').value;
      const remember=$('rememberAddress').checked;
      await beforeManualLocation();
      say('addressError','주소 저장 및 지도 위치 확인 중…');
      const saved=await post('admin/deliveries/' + row.id + '/location', {address,remember_recipient:remember});
      closeEditor();
      let message='주소 저장 완료 · 위치 미확인: 위치 지정을 눌러 확인하세요.';
      let current=null;
      try{
        // Query the original day even if the operator changes the date while saving.
        const response=await get('admin/deliveries?date='+encodeURIComponent(targetDate));
        current=response.rows.find(item=>item.id===row.id);
        if(current?.located&&valid(current)){
          message='주소 저장 완료 · 기존 지도 위치 연결 완료';
        }else if(current&&current.destination_id===saved.destination_id){
          const canonical=current.registry_address||address;
          await ensureMap();
          const point=await lookupCoordinates([canonical]);
          if(point?.verified&&valid(point)){
            // Recheck the master after the network lookup; never replace a pin
            // saved by another operator in the meantime.
            const latest=await get('admin/deliveries?date='+encodeURIComponent(targetDate));
            const check=latest.rows.find(item=>item.id===row.id);
            if(check?.located&&valid(check)){
              message='주소 저장 완료 · 기존 지도 위치 연결 완료';
            }else if(check&&check.destination_id===saved.destination_id&&
                     (check.registry_address||address)===canonical){
              await post('admin/deliveries/'+row.id+'/location',{
                destination_id:saved.destination_id,lat:point.lat,lng:point.lng
              });
              message='주소 및 지도 위치 저장 완료';
            }
          }
        }
      }catch(_){message='주소 저장 완료 · 좌표 조회 실패: 위치 지정을 눌러 확인하세요.';}
      dialog.close();
      await refreshSaved(message);
    } catch (error) {
      say('addressError', '주소 저장 실패: ' + error.message);
    } finally {
      manualLocationBusy=false;
      button.disabled = cancel.disabled = input.readOnly = false;
    }
  }
  function selectRow(id) {
    const row=rows.find(r=>r.id===id);if(!row)return;
    selected=row;editorOpen=true;
    $('locationEditor').hidden=false;
    $('mapCrosshair').hidden=false;
    $('mapPinSaveBar').hidden=false;
    say('editName','배송지 · '+rowName(row));
    say('editInfo','운송장 '+(row.waybill||'미등록')+' · 원본 '+row.sheet_name+' '+row.source_row+'행');
    $('editAddress').value=row.registry_address||(row.name_only?'':row.source_address)||'';
    $('rememberLocation').checked=Boolean(row.name_only);
    const plan=addressPlan(row);
    say('locationHint','주소 판별: '+plan.label+' · 검색 후보: '+(plan.queries.join(' / ')||'없음')+'. 지도를 확인하고 중앙 마커를 조정한 뒤 저장하세요.');
    focusSelectedRow(id);
    if(map&&valid(row)){
      map.setCenter(new maps.LatLng(row.lat,row.lng));map.setZoom(17);
    }
    searchSaved(row.business_name);
    $('locationEditor').scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function closeEditor() {
    selected=null;editorOpen=false;
    $('locationEditor').hidden=true;$('mapCrosshair').hidden=true;
    $('mapPinSaveBar').hidden=true;
    $('savedDestinationPanel').hidden=true;
    document.querySelectorAll('.row-selected').forEach(el=>el.classList.remove('row-selected'));
  }
  async function searchSaved(name){
    $('savedDestinationPanel').hidden=true;
    if(!name||name.length<2)return;
    try {
      const data=await get('admin/destinations?q='+encodeURIComponent(name));
      if(!selected||selected.business_name!==name||!data.destinations.length)return;
      const list=$('savedDestinationSelect');list.replaceChildren();
      data.destinations.forEach(d=>{
        const option=document.createElement('option');option.value=String(d.id);
        option.textContent=(d.business_name||'상호 없음')+' · '+d.address;
        list.append(option);
      });
      $('savedDestinationPanel').hidden=false;
    }catch(_){}
  }
  async function linkSaved() {
    if(!selected||manualLocationBusy)return;
    const destinationId=Number($('savedDestinationSelect').value);
    if(!Number.isSafeInteger(destinationId))return;
    manualLocationBusy=true;$('linkDestinationBtn').disabled=true;
    try {
      const row=selected,remember=$('rememberLocation').checked;
      await beforeManualLocation();
      await post('admin/deliveries/'+row.id+'/location',{destination_id:destinationId,remember_recipient:remember});
      closeEditor();await refreshSaved('기존 배송지 연결 완료');
    }catch(e){say('locationHint','연결 실패: '+e.message);}
    finally{manualLocationBusy=false;$('linkDestinationBtn').disabled=false;}
  }
  function addressValues(row, override = null) {
    const primary = override === null ? (row?.registry_address || row?.source_address || '') : override;
    const entries = [primary];
    // A manually corrected address must not be mixed with outdated spreadsheet alternatives.
    if (override !== null || (row?.registry_address && row.registry_address !== row.source_address)) return entries;
    for (const [header, value] of Object.entries(row?.raw || {})) {
      if (/(?:도로명.*주소|지번.*주소)/.test(header.replace(/\s+/g, '')) && String(value || '').trim()) {
        entries.push(String(value));
      }
    }
    return [...new Set(entries.filter(Boolean))];
  }
  const addressPlan = row => window.DDSM_Address.analyze(addressValues(row));
  async function lookupCoordinates(values, manual = false) {
    return window.DDSM_Address.resolve(maps, values, {manual});
  }
  async function searchAddress(){
    const address=$('editAddress').value.trim();
    if(address.length<4){say('locationHint','정확한 주소를 입력하세요.');return;}
    const selectedId=selected?.id;
    try{
      await ensureMap();
      say('locationHint','네이버 주소를 검색하는 중…');
      const coords=await lookupCoordinates(addressValues(null,address),true);
      if(!editorOpen||selected?.id!==selectedId)return;
      if(!coords) {
        say('locationHint','주소를 찾지 못했습니다. 지도를 직접 움직여 지정하세요.');
        return;
      }
      map.setCenter(new maps.LatLng(coords.lat,coords.lng));
      map.setZoom(17);
      say('locationHint',coords.verified
        ? '주소가 일치합니다. 동·호수는 원본에 보존되며 지도 중앙을 확인한 뒤 저장하세요.'
        : '주소를 정확히 검증하지 못한 참고 위치입니다. 실제 배송지를 지도에서 확인하고 중앙을 조정한 뒤 저장하세요.');
    }catch(e){say('locationHint',e.message);}
  }
  async function saveCenter() {
    if(!selected||!map||manualLocationBusy)return;
    const address=$('editAddress').value.trim();
    if(!address && !selected.business_name.trim()) {say('locationHint','주소 또는 상호명이 필요합니다.');return;}
    const center=map.getCenter(),row=selected,remember=$('rememberLocation').checked;
    manualLocationBusy=true;$('saveCenterBtn').disabled=$('mapPinSaveBtn').disabled=true;
    try{
      await beforeManualLocation();
      await post('admin/deliveries/'+row.id+'/location',{
        address, business_name:row.business_name,
        lat:center.lat(), lng:center.lng(), remember_recipient:remember
      });
      closeEditor();await refreshSaved('배송 위치 저장 완료');
    }catch(e){say('locationHint','위치 저장 실패: '+e.message);}
    finally{manualLocationBusy=false;$('saveCenterBtn').disabled=$('mapPinSaveBtn').disabled=false;}
  }
  let geocodeRunning=false;
  const geocodeTried=new Set();
  async function autoGeocode(limit=60){
    if(geocodeRunning||manualLocationBusy)return;
    geocodeRunning=true;
    try {
      await ensureMap();
      const targetDate=$('deliveryDate').value;
      const daySequence=updateSeq;
      let stored=0,attempted=0;
      const unresolved=rows.filter(x=>!x.located&&addressValues(x).some(value=>value.trim().length>=4)
        && !geocodeTried.has(targetDate+'|'+x.id+'|'+addressValues(x)[0]));
      // Cache lookups per address so recurring shipments do not waste API quota.
      const addressCache=new Map();
      for(const row of unresolved.slice(0,limit)){
        if(daySequence!==updateSeq || targetDate!==$('deliveryDate').value)break;
        if(addressRow?.id===row.id||selected?.id===row.id||manualLocationBusy)continue;
        attempted++;
        const values=addressValues(row);
        const address=values[0]?.trim()||'';
        const cacheKey=values.join('\u001f');
        let coords=addressCache.get(cacheKey);
        if(coords===undefined){
          coords=await lookupCoordinates(values);
          addressCache.set(cacheKey,coords);
        }
        const current = rows.find(item => item.id === row.id);
        if(daySequence!==updateSeq || targetDate!==$('deliveryDate').value)break;
        if(!current || addressRow?.id===row.id || selected?.id===row.id || manualLocationBusy || addressValues(current)[0]!==values[0])continue;
        geocodeTried.add(targetDate+'|'+row.id+'|'+values[0]);
        if(coords){
          const done = post('admin/deliveries/'+row.id+'/location',{
            address,business_name:row.business_name,lat:coords.lat,lng:coords.lng
          });
          autoLocationWrite = { id: row.id, done };
          try {
            await done;
            stored++;
          } catch(_){} finally { autoLocationWrite = null; }
        }
        if(attempted%10===0)say('importStatus','주소 좌표 자동 조회 '+attempted+'건 · 저장 '+stored+'건');
      }
      if(daySequence===updateSeq && targetDate===$('deliveryDate').value && !addressRow){
        if(stored)await loadDayWithoutGeocode();
        say('importStatus','주소 좌표 확인 완료 · 조회 '+attempted+'건 / 저장 '+stored+'건. 미확인은 목록에서 관리하세요.');
      }
    }catch(e){say('importStatus','주소 좌표 찾기 실패: '+e.message);}
    finally{geocodeRunning=false;}
  }
  async function loadDayWithoutGeocode(){
    const date=$('deliveryDate').value;
    const token=++updateSeq;
    const response=await get('admin/deliveries?date='+encodeURIComponent(date));
    if(token!==updateSeq)return;
    rows=response.rows;columns=response.columns;
    say('totalCount',String(response.total));
    say('mapCount',String(response.located));
    say('missingCount',String(response.unlocated));
    const scroll=$('rawTable').parentElement,top=scroll.scrollTop,left=scroll.scrollLeft;
    renderTable();renderUnlocated();drawMap();
    scroll.scrollTop=top;scroll.scrollLeft=left;
    return true;
  }
  function setRecurringCollapsed(collapsed){
    $('recurringContent').hidden=collapsed;
    $('toggleRecurring').textContent=collapsed?'펼치기 ▾':'접기 ▴';
    $('toggleRecurring').setAttribute('aria-expanded',String(!collapsed));
    try{sessionStorage.setItem('ddsm:admin:recurring-collapsed:v1',collapsed?'1':'0');}catch(_){}
  }
  function bind(){
    let collapsed=false;
    try{collapsed=sessionStorage.getItem('ddsm:admin:recurring-collapsed:v1')==='1';}catch(_){}
    setRecurringCollapsed(collapsed);
    $('toggleRecurring').addEventListener('click',()=>setRecurringCollapsed(!$('recurringContent').hidden));
    $('deliveryDate').value=dateString();
    $('centerLoginForm').addEventListener('submit',openCenter);
    $('retryCenter').addEventListener('click',validateSession);
    $('changeCenter').addEventListener('click',leaveCenter);
    $('showDriverCode').addEventListener('click',showDriverCode);
    $('renewDriverCode').addEventListener('click',()=>void issueDriverCode(true));
    $('copyDriverCode').addEventListener('click',copyDriverCode);
    $('closeDriverCode').addEventListener('click',()=>$('driverCodeDialog').close());
    $('driverCodeDialog').addEventListener('close',clearDriverCode);
    $('deliveryDate').addEventListener('change',loadDay);
    $('refreshBtn').addEventListener('click',loadDay);
    $('refreshDeliveryStatus').addEventListener('click',loadDeliveryStatus);
    $('adminProofClose').addEventListener('click',()=>$('adminProofDialog').close());
    $('adminProofDialog').addEventListener('close',clearAdminProof);
    $('adminProofDownload').addEventListener('click',()=>{if(adminProofUrl){const a=document.createElement('a');a.href=adminProofUrl;a.download=adminProofFile;document.body.append(a);a.click();a.remove();}});
    $('refreshRecurring').addEventListener('click',loadRecurring);
    $('recurringMapSearch').addEventListener('click',searchRecurringMap);
    $('recurringMapSave').addEventListener('click',saveRecurringMap);
    $('recurringMapCancel').addEventListener('click',()=>$('recurringMapDialog').close());
    $('recurringMapDialog').addEventListener('cancel',e=>{if(manualLocationBusy)e.preventDefault();});
    $('recurringMapDialog').addEventListener('close',()=>{++recurringSeq;recurringDraft=null;});
    $('recurringSearch').addEventListener('change',loadRecurring);
    $('excelFile').addEventListener('change',()=>say('fileName',$('excelFile').files[0]?.name||'선택된 파일 없음'));
    $('importForm').addEventListener('submit',importExcel);
    $('searchInput').addEventListener('input',renderTable);
    $('filterSelect').addEventListener('change',renderTable);
    $('filterMissingBtn').addEventListener('click',()=>{
      $('filterSelect').value='missing';
      renderTable();
      $('rawTable').scrollIntoView({block:'start',behavior:'smooth'});
    });
    $('fitBtn').addEventListener('click',fit);
    $('geocodeBtn').addEventListener('click',()=>autoGeocode(200));
    $('addressForm').addEventListener('submit',saveAddress);
    $('cancelAddressBtn').addEventListener('click',()=>$('addressDialog').close());
    $('addressDialog').addEventListener('cancel',event=>{
      if ($('saveAddressBtn').disabled) event.preventDefault();
    });
    $('addressDialog').addEventListener('close',()=>{addressRow=null;});
    $('cancelLocationBtn').addEventListener('click',closeEditor);
    $('saveCenterBtn').addEventListener('click',saveCenter);
    $('mapPinSaveBtn').addEventListener('click',saveCenter);
    $('searchAddressBtn').addEventListener('click',searchAddress);
    $('linkDestinationBtn').addEventListener('click',linkSaved);
    $('showMoreBtn')?.addEventListener('click',appendPage);
  }
  bind();validateSession();
})();
