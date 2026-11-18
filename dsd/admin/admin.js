/* DSD center console. Never cache recipient data in browser storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API_BASE = '/dsd-center-api/';
  const dateString = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  };
  let csrf = '', rows = [], columns = [], map = null, maps = null, markers = [], selected = null;
  let updateSeq = 0, mapLoading = null, editorOpen = false, fitOnce = false;
  let currentPage = 0, visibleFiltered = [];
  const chunkSize = 250;
  const valid = p => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
  const say = (id, message) => { $(id).textContent = message; };
  async function api(path, options={}) {
    const opts = { credentials: 'same-origin', cache: 'no-store', ...options };
    opts.headers = { ...(opts.headers || {}), ...(opts.method === 'POST' ? {'X-CSRF-Token':csrf} : {}) };
    if (opts.body instanceof FormData) delete opts.headers['Content-Type'];
    else if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(API_BASE + path, opts);
    const json = await response.json().catch(() => null);
    if (!response.ok || !json || !json.ok) {
      throw new Error(json?.error || 'API 응답 오류 (' + response.status + ')');
    }
    return json;
  }
  const get = path => api(path);
  const post = (path, body) => api(path, { method:'POST', body });
  function showDashboard() {
    $('authPanel').hidden = true;
    $('dashboard').hidden = false;
    $('logoutBtn').hidden = false;
    say('authBadge', '관리자 인증됨');
    loadDay();
  }
  async function validateSession() {
    try {
      const result = await get('admin/me');
      csrf = result.csrf;
      showDashboard();
    } catch (_) {
      $('authPanel').hidden = false;
    }
  }
  async function authenticate(event) {
    event.preventDefault();
    const phone = $('loginPhone').value.replace(/\D/g,'');
    const password = $('loginPassword').value;
    const adminPassword = $('adminPassword').value;
    const button = $('authForm').querySelector('button[type=submit]');
    button.disabled = true;
    say('authError','');
    try {
      let me;
      try { me = await get('auth/me'); }
      catch (_) { me = null; }
      if (!me || me.phone !== phone) {
        const loggedIn = await post('auth/login',{phone,password});
        csrf = loggedIn.csrf;
      } else {
        csrf = me.csrf;
      }
      const unlocked = await post('admin/unlock',{admin_password:adminPassword});
      csrf = unlocked.csrf;
      $('loginPassword').value = '';
      $('adminPassword').value = '';
      showDashboard();
    } catch (error) {
      say('authError',error.message || '인증에 실패했습니다.');
    } finally { button.disabled = false; }
  }
  async function lock() {
    try {
      await post('auth/logout',{});
    } catch (_) { /* Local UI lock even if session expiry is already complete. */ }
    csrf = '';
    rows = [];
    clearMarkers();
    $('dashboard').hidden = true;
    $('authPanel').hidden = false;
    $('logoutBtn').hidden = true;
    say('authBadge','관리자 인증 필요');
  }
  function mapNotice(message, small=false) {
    const el = $('mapPlaceholder');
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('hint',small);
  }
  async function ensureMap() {
    if (mapLoading) return mapLoading;
    mapLoading = window.DSD_NaverMap.loadSdk().then(n => {
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
  function renderUnlocated() {
    const missing=rows.filter(row=>!row.located);
    $('unlocatedPanel').hidden=missing.length===0;
    const target=$('unlocatedChips');target.replaceChildren();
    const LIMIT=100;
    missing.slice(0,LIMIT).forEach(row=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='unlocated-chip';
      button.textContent=(row.business_name||'상호 미입력') + (row.source_address?' · 주소 확인':' · 주소 없음');
      button.title='배송지 위치 지정: '+(row.business_name||row.waybill||'미입력');
      button.addEventListener('click',()=>selectRow(row.id));
      target.append(button);
    });
    if(missing.length>LIMIT){
      const more=document.createElement('span');
      more.textContent='외 '+(missing.length-LIMIT)+'건 · 미확인 목록 전체 보기에서 확인';
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
  async function loadDay() {
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
      if(rows.length&&rows.some(x=>!x.located&&x.source_address)) autoGeocode(60);
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
      if(filter==='mapped'&&!r.located)return false;
      if(!q)return true;
      return [r.waybill,r.business_name,r.source_address,
        ...Object.values(r.raw||{})].some(x=>String(x||'').toLocaleLowerCase().includes(q));
    });
  }
  function appendPage() {
    const tbody=$('rawBody');
    for(const row of visibleFiltered.slice(currentPage*chunkSize,(currentPage+1)*chunkSize)){
      const tr=document.createElement('tr');tr.dataset.id=String(row.id);
      const action=document.createElement('td');
      const button=document.createElement('button');button.type='button';
      button.className='row-edit';button.textContent=row.located?'위치 수정':'위치 지정';
      button.addEventListener('click',()=>selectRow(row.id));
      action.append(button);tr.append(action);
      const state=textCell(row.located?'● 지도 표시':'○ 위치 미확인');
      state.className=row.located?'mapped':'missing';tr.append(state);
      tr.append(textCell(row.business_name||'상호 미입력'));
      tr.append(textCell(row.registry_address||row.source_address||'주소 없음'));
      tr.append(textCell(row.waybill));
      for(const col of columns)tr.append(textCell((row.raw||{})[col]||''));
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
    ['작업','지도 상태','수취인/상호','배송 주소','운송장',...columns].forEach(c=>{
      const th=document.createElement('th');th.textContent=c;tr.append(th);
    });head.append(tr);
    visibleFiltered=displayedRows();currentPage=0;appendPage();
  }
  function focusSelectedRow(id) {
    document.querySelectorAll('.row-selected').forEach(el=>el.classList.remove('row-selected'));
    const match=[...$('rawBody').children].find(tr=>tr.dataset.id===String(id));
    if(match){match.classList.add('row-selected');match.scrollIntoView({block:'nearest',behavior:'smooth'});}
  }
  function selectRow(id) {
    const row=rows.find(r=>r.id===id);if(!row)return;
    selected=row;editorOpen=true;
    $('locationEditor').hidden=false;
    $('mapCrosshair').hidden=false;
    say('editName','배송지 · '+rowName(row));
    say('editInfo','운송장 '+(row.waybill||'미등록')+' · 원본 '+row.sheet_name+' '+row.source_row+'행');
    $('editAddress').value=row.registry_address||row.source_address||'';
    say('locationHint','지도를 움직여 중앙 마커 위치를 맞춘 뒤 저장하세요.');
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
    if(!selected)return;
    const destinationId=Number($('savedDestinationSelect').value);
    if(!Number.isSafeInteger(destinationId))return;
    try {
      await post('admin/deliveries/'+selected.id+'/location',{destination_id:destinationId});
      closeEditor();await loadDay();
      say('importStatus','기존 배송지와 연결했습니다. 이후 동일 상호의 재배송에도 참조됩니다.');
    }catch(e){say('locationHint','연결 실패: '+e.message);}
  }
  function geocodingQueries(raw) {
    const full=String(raw||'').trim();
    // Strip apartment unit or floor ONLY for the map query. Original address
    // remains intact in the unique delivery destination registry.
    const beforeComma=full.split(/[,，]/)[0].trim();
    const withoutUnit=beforeComma
      .replace(/\s+\d{1,4}\s*동\s*\d{1,4}\s*호.*$/,'')
      .replace(/\s+\d{1,4}\s*호.*$/,'')
      .replace(/\s+\d{1,3}\s*층.*$/,'').trim();
    return [...new Set([full,beforeComma,withoutUnit].filter(q=>q.length>=4))];
  }
  async function lookupCoordinates(address) {
    for(const query of geocodingQueries(address)) {
      const coords=await new Promise(resolve=>{
        let settled=false;
        const complete=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
        const timer=setTimeout(()=>complete(null),5000);
        try {
          maps.Service.geocode({query},(status,response)=>{
            const first=response?.v2?.addresses?.[0];
            const lat=Number(first?.y),lng=Number(first?.x);
            complete(status===maps.Service.Status.OK&&first&&valid({lat,lng})?{lat,lng}:null);
          });
        }catch(_){complete(null);}
      });
      if(coords)return coords;
    }
    return null;
  }
  async function searchAddress(){
    const address=$('editAddress').value.trim();
    if(address.length<4){say('locationHint','정확한 주소를 입력하세요.');return;}
    const selectedId=selected?.id;
    try{
      await ensureMap();
      say('locationHint','네이버 주소를 검색하는 중…');
      const coords=await lookupCoordinates(address);
      if(!editorOpen||selected?.id!==selectedId)return;
      if(!coords) {
        say('locationHint','주소를 찾지 못했습니다. 지도를 직접 움직여 지정하세요.');
        return;
      }
      map.setCenter(new maps.LatLng(coords.lat,coords.lng));
      map.setZoom(17);
      say('locationHint','검색 위치로 이동했습니다. 동·호는 원본에 보존되며, 지도 중앙을 조정해 저장하세요.');
    }catch(e){say('locationHint',e.message);}
  }
  async function saveCenter() {
    if(!selected||!map)return;
    const address=$('editAddress').value.trim();
    if(!address){say('locationHint','저장할 배송지의 주소를 입력하세요.');return;}
    const center=map.getCenter();
    try{
      await post('admin/deliveries/'+selected.id+'/location',{
        address, business_name:selected.business_name,
        lat:center.lat(), lng:center.lng()
      });
      closeEditor();await loadDay();
      say('importStatus','고유 배송지 위치를 저장했습니다. 향후 같은 주소의 배송에도 적용됩니다.');
    }catch(e){say('locationHint','위치 저장 실패: '+e.message);}
  }
  let geocodeRunning=false;
  const geocodeTried=new Set();
  async function autoGeocode(limit=60){
    if(geocodeRunning)return;
    geocodeRunning=true;
    try {
      await ensureMap();
      const targetDate=$('deliveryDate').value;
      let stored=0,attempted=0;
      const unresolved=rows.filter(x=>!x.located&&x.source_address?.trim().length>=4
        && !geocodeTried.has(targetDate+'|'+x.id+'|'+x.source_address));
      // Cache lookups per address so recurring shipments do not waste API quota.
      const addressCache=new Map();
      for(const row of unresolved.slice(0,limit)){
        if(targetDate!==$('deliveryDate').value)break;
        attempted++;
        const address=row.source_address.trim();
        geocodeTried.add(targetDate+'|'+row.id+'|'+row.source_address);
        let coords=addressCache.get(address);
        if(coords===undefined){
          coords=await lookupCoordinates(address);
          addressCache.set(address,coords);
        }
        if(coords){
          try {
            await post('admin/deliveries/'+row.id+'/location',{
              address,business_name:row.business_name,lat:coords.lat,lng:coords.lng
            });
            stored++;
          } catch(_){}
        }
        if(attempted%10===0)say('importStatus','주소 좌표 자동 조회 '+attempted+'건 · 저장 '+stored+'건');
      }
      if(stored)await loadDayWithoutGeocode();
      say('importStatus','주소 좌표 확인 완료 · 조회 '+attempted+'건 / 저장 '+stored+'건. 미확인은 목록에서 관리하세요.');
    }catch(e){say('importStatus','주소 좌표 찾기 실패: '+e.message);}
    finally{geocodeRunning=false;}
  }
  async function loadDayWithoutGeocode(){
    const response=await get('admin/deliveries?date='+encodeURIComponent($('deliveryDate').value));
    rows=response.rows;columns=response.columns;
    say('totalCount',String(response.total));
    say('mapCount',String(response.located));
    say('missingCount',String(response.unlocated));
    renderTable();renderUnlocated();drawMap();
  }
  function bind(){
    $('deliveryDate').value=dateString();
    $('authForm').addEventListener('submit',authenticate);
    $('logoutBtn').addEventListener('click',lock);
    $('deliveryDate').addEventListener('change',loadDay);
    $('refreshBtn').addEventListener('click',loadDay);
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
    $('cancelLocationBtn').addEventListener('click',closeEditor);
    $('saveCenterBtn').addEventListener('click',saveCenter);
    $('searchAddressBtn').addEventListener('click',searchAddress);
    $('linkDestinationBtn').addEventListener('click',linkSaved);
    $('showMoreBtn')?.addEventListener('click',appendPage);
  }
  bind();validateSession();
})();
