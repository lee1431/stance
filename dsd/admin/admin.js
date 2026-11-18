/* DSD fixed-admin center console. Bearer token kept in memory; no signup or browser cookie auth. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API_BASE = 'https://mrdindoin.ddns.net/dsd-center-api/';
  const dateString = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  };

  let token = '';
  let rows = [], columns = [], map = null, maps = null, markers = [], mapLoading = null;
  let requestVersion = 0, geocodeRunning = false, fitOnLoad = false;
  let shown = [], pageIndex = 0;
  let visibleColumns = [], fixedExcelLayout = false;
  const FIXED_DSD_HEADERS = [
    '일자','발송지','운송장번호','발화주','수화주','품명','포장','상품','수량',
    '상태','현불운임','착불운임','출고제비용','합계','특기사항',
    '수화주 지번주소','수화주 도로명주소'
  ];
  function normalizedHeader(name){
    return String(name||'').normalize('NFKC').replace(/[\s()·\-_]+/g,'').toLowerCase();
  }
  function displayColumns(){
    // Preserve exact original Excel column order, including a leading ID column.
    fixedExcelLayout = false;
    const limit = Math.min(3, columns.length - FIXED_DSD_HEADERS.length);
    for (let start = 0; start <= limit; start++) {
      if (FIXED_DSD_HEADERS.every((name, i) =>
        normalizedHeader(columns[start + i]) === normalizedHeader(name))) {
        fixedExcelLayout = true;
        break;
      }
    }
    return [...columns];
  }
  let highlightedIds = new Set();
  const PAGE_SIZE = 250;
  const attempted = new Set();
  const safePoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
      && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  const say = (id,text) => { $(id).textContent = String(text); };

  async function api(path, options = {}) {
    const headers = {...(options.headers || {})};
    if (token) headers.Authorization = 'Bearer ' + token;
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers, body, mode: 'cors', credentials: 'omit',
      cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (response.status === 401 && token) {
        // A lost/expired token must never allow access to old delivery data.
        lock(false);
      }
      throw new Error(data?.error || 'API 요청 실패 (' + response.status + ')');
    }
    return data;
  }
  const get = path => api(path);
  const post = (path, body) => api(path, {method:'POST', body});

  async function signIn(event) {
    event.preventDefault();
    const button = $('authForm').querySelector('button[type=submit]');
    button.disabled = true;
    say('authError','');
    try {
      const result = await post('admin/login', {
        id: $('adminId').value.trim(),
        password: $('adminPassword').value
      });
      if (!result.token || typeof result.token !== 'string') throw new Error('서버 로그인 응답에 토큰이 없습니다.');
      token = result.token; // In-memory only. Refresh requires login.
      $('adminPassword').value = '';
      $('authPanel').hidden = true;
      $('dashboard').hidden = false;
      $('logoutBtn').hidden = false;
      await loadDay();
    } catch (error) {
      say('authError', error.message || '로그인 실패');
    } finally {
      button.disabled = false;
    }
  }

  function clearMap() {
    for (const item of markers) item.marker.setMap(null);
    markers = [];
  }
  function lock(performLogout = true) {
    const previous = token;
    token = '';
    requestVersion++;
    rows = []; columns = []; attempted.clear();
    highlightedIds.clear();
    clearMap();
    $('dashboard').hidden = true;
    $('authPanel').hidden = false;
    $('logoutBtn').hidden = true;
    $('adminPassword').value = '';
    if (performLogout && previous) {
      // Revocation uses the captured token so it survives local state reset.
      fetch(API_BASE + 'admin/logout', {
        method:'POST', mode:'cors', credentials:'omit',
        headers: {Authorization:'Bearer ' + previous}
      }).catch(() => {});
    }
  }

  async function ensureMap() {
    if (map) return map;
    if (mapLoading) return mapLoading;
    mapLoading = window.DSD_NaverMap.loadSdk().then(n => {
      maps = n;
      map = new n.Map($('mapCanvas'), {
        center: new n.LatLng(36.991,127.925),
        zoom:12,
        zoomControl:true,
        zoomControlOptions:{position:n.Position.TOP_RIGHT},
        mapDataControl:false,scaleControl:false
      });
      return map;
    }).catch(error => {
      mapLoading = null;
      say('mapPlaceholder','네이버 지도 연결 실패: ' + error.message);
      throw error;
    });
    return mapLoading;
  }
  function fitMap() {
    if (!map || !markers.length) return;
    maps.Event.trigger(map,'resize');
    if (markers.length===1) {
      map.setCenter(markers[0].marker.getPosition());
      map.setZoom(16);
      return;
    }
    const bounds = new maps.LatLngBounds();
    markers.forEach(m => bounds.extend(m.marker.getPosition()));
    map.fitBounds(bounds,{top:50,bottom:50,left:50,right:50});
  }

  function drawMap() {
    if (!map) return;
    clearMap();
    const places = new Map();
    for (const row of rows) {
      const pt = {lat:Number(row.lat),lng:Number(row.lng)};
      if (!row.located || !safePoint(pt)) continue;
      const key = row.destination_id ? 'd:'+row.destination_id : pt.lat.toFixed(6)+':'+pt.lng.toFixed(6);
      const entry=places.get(key);
      if (entry) entry.items.push(row);
      else places.set(key,{pt,items:[row]});
    }
    for (const entry of places.values()) {
      const first = entry.items[0];
      const count = entry.items.length;
      const label = first.business_name || first.waybill || '배송지';
      const marker = new maps.Marker({
        map,
        position:new maps.LatLng(entry.pt.lat,entry.pt.lng),
        icon: {
          content:'<div class="admin-map-marker">'+count+'</div>',
          size:new maps.Size(30,32), anchor:new maps.Point(15,29)
        },
        clickable:true,
        title:label+' · 배송 '+count+'건'
      });
      maps.Event.addListener(marker,'click',()=>{
        // Marker selection must never filter or remove rows from the delivery list.
        highlightShipments(entry.items);
      });
      markers.push({marker});
    }
    say('markerCount',markers.length);
    const mapped=rows.filter(row=>row.located&&safePoint({lat:Number(row.lat),lng:Number(row.lng)})).length;
    say('mapCount',mapped);
    say('missingCount',rows.length-mapped);
    const empty=$('mapPlaceholder');
    empty.hidden=markers.length>0;
    if(!markers.length)empty.textContent=rows.length
      ? '아직 위치가 확인된 배송지가 없습니다. 주소 좌표 조회를 실행하세요.'
      : '엑셀을 업로드하면 배송지가 표시됩니다.';
    if(!fitOnLoad && markers.length){fitOnLoad=true;requestAnimationFrame(fitMap);}
  }

  async function loadDay() {
    if (!token) return;
    const version=++requestVersion;
    const day=$('deliveryDate').value;
    say('importStatus',day+' 배송 목록 조회 중…');
    try {
      const result=await get('admin/deliveries?date='+encodeURIComponent(day));
      if (version!==requestVersion || !token) return;
      rows=result.rows||[];
      columns=result.columns||[];
      highlightedIds.clear();
      say('totalCount',rows.length);
      say('importStatus',day+' · 전체 '+rows.length+'건 · 위치 미확인 '+result.unlocated+'건');
      fitOnLoad=false;
      renderTable();
      try {
        await ensureMap();
        if(version!==requestVersion||!token)return;
        drawMap();
        // Automatic lookup is quota bounded; manual lookup can continue later.
        if(rows.some(x=>!x.located && x.source_address))lookupMissing(60);
      } catch (_) {}
    } catch(error) {
      if(version===requestVersion && token)say('importStatus','목록 조회 실패: '+error.message);
    }
  }

  async function upload(event) {
    event.preventDefault();
    const file=$('excelFile').files[0];
    if(!file)return;
    if(file.size>8*1024*1024) {
      say('importStatus','8MB 이하 엑셀 파일만 업로드 가능합니다.');return;
    }
    const body=new FormData();
    body.append('file',file,file.name);
    body.append('date',$('deliveryDate').value);
    const button=$('importBtn');
    button.disabled=true;
    say('importStatus','전체 원본 데이터 저장 중…');
    try {
      const result=await post('admin/import',body);
      attempted.clear();
      await loadDay();
      say('importStatus',file.name+' · '+result.imported+'행 저장 (신규 '+result.added+' / 갱신 '+result.updated+')');
    } catch(error) {say('importStatus','엑셀 업로드 실패: '+error.message);}
    finally {button.disabled=false;}
  }

  function filteredRows(){
    const q=$('searchInput').value.trim().toLocaleLowerCase();
    const filter=$('filterSelect').value;
    return rows.filter(row=>{
      if(filter==='mapped'&&!row.located)return false;
      if(filter==='missing'&&row.located)return false;
      return !q || [row.waybill,row.business_name,row.source_address,
        ...Object.values(row.raw||{})].some(x=>String(x||'').toLocaleLowerCase().includes(q));
    });
  }

  function cell(text) {
    const td=document.createElement('td');
    td.textContent=String(text==null?'':text);
    return td;
  }
  function appendPage(){
    const body=$('rawBody');
    for(const row of shown.slice(pageIndex*PAGE_SIZE,(pageIndex+1)*PAGE_SIZE)){
      const tr=document.createElement('tr');
      tr.dataset.id = String(row.id);
      if (highlightedIds.has(row.id)) tr.classList.add('row-selected');
      const status=cell(row.located?'● 지도':'○ 미확인');
      status.className=row.located?'mapped':'missing';
      tr.append(status);
      if (!fixedExcelLayout) {
        tr.append(cell(row.business_name||'상호 미입력'),
          cell(row.registry_address||row.source_address||'주소 없음'),cell(row.waybill));
      }
      for(const column of visibleColumns)tr.append(cell(row.raw?.[column]||''));
      body.append(tr);
    }
    pageIndex++;
    const total=Math.min(pageIndex*PAGE_SIZE,shown.length);
    say('tableInfo','전체 '+rows.length+'건 · 검색 '+shown.length+'건 · 표시 '+total+'건');
    $('showMoreBtn').hidden=total>=shown.length;
  }
  function highlightShipments(items){
    highlightedIds = new Set(items.map(item => item.id));
    // Preserve the user's current search/filter settings and the complete list.
    const firstIndex = shown.findIndex(row => highlightedIds.has(row.id));
    if (firstIndex < 0) {
      // The clicked destination isn't in the current user-selected filter.
      // Don't alter that filter or silently replace the visible shipment list.
      return;
    }
    // Large tables are paged: add the necessary pages without discarding others.
    while (pageIndex * PAGE_SIZE <= firstIndex) appendPage();
    for (const tr of $('rawBody').rows) {
      tr.classList.toggle('row-selected', highlightedIds.has(Number(tr.dataset.id)));
    }
    const selected = [...$('rawBody').rows].find(tr => tr.classList.contains('row-selected'));
    selected?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function renderTable(){
    const head=$('rawHeader'),body=$('rawBody');
    head.replaceChildren();body.replaceChildren();
    const tr=document.createElement('tr');
    visibleColumns=displayColumns();
    const headers=fixedExcelLayout ? ['위치',...visibleColumns]
      : ['위치','상호/수취인','배송지','운송장',...visibleColumns];
    headers.forEach(label=>{
      const th=document.createElement('th');
      th.textContent=label;tr.append(th);
    });
    head.append(tr);
    pageIndex=0;
    shown=filteredRows();
    appendPage();
  }

  function addressesToTry(raw){
    const full=String(raw||'').trim();
    const first=full.split(/[,，]/)[0].trim();
    const simplified=first.replace(/\s+\d{1,4}\s*동\s*\d{1,4}\s*호.*$/,'')
      .replace(/\s+\d{1,4}\s*호.*$/,'')
      .replace(/\s+\d{1,3}\s*층.*$/,'').trim();
    return [...new Set([full,first,simplified].filter(s=>s.length>=4))];
  }
  async function coordinatesFor(address){
    for(const query of addressesToTry(address)){
      const found=await new Promise(resolve=>{
        let resolved=false;
        const finish=value=>{if(resolved)return;resolved=true;clearTimeout(timer);resolve(value);};
        const timer=setTimeout(()=>finish(null),5000);
        try {
          maps.Service.geocode({query},(status,result)=>{
            const first=result?.v2?.addresses?.[0];
            const pt={lat:Number(first?.y),lng:Number(first?.x)};
            finish(status===maps.Service.Status.OK&&first&&safePoint(pt)?pt:null);
          });
        } catch (_) {finish(null);}
      });
      if(found)return found;
    }
    return null;
  }
  async function lookupMissing(limit=60){
    if(geocodeRunning || !token || !map)return;
    geocodeRunning=true;
    const day=$('deliveryDate').value;
    const candidates=rows.filter(r=>!r.located&&r.source_address?.trim().length>=4
      && !attempted.has(day+':'+r.id));
    let checked=0,saved=0;
    const cache=new Map();
    try {
      for(const row of candidates.slice(0,limit)){
        if(!token || day!==$('deliveryDate').value)break;
        attempted.add(day+':'+row.id);
        checked++;
        const addr=row.source_address.trim();
        if(!cache.has(addr))cache.set(addr,await coordinatesFor(addr));
        const pt=cache.get(addr);
        if(pt){
          try {
            await post('admin/deliveries/'+row.id+'/location',{
              address:addr,business_name:row.business_name,
              lat:pt.lat,lng:pt.lng
            });
            saved++;
          }catch(_) {}
        }
        if(checked%10===0)say('importStatus','주소 확인 '+checked+'건 · 위치 저장 '+saved+'건');
      }
      if(saved) {
        const result=await get('admin/deliveries?date='+encodeURIComponent(day));
        if(day===$('deliveryDate').value && token){
          rows=result.rows;columns=result.columns;
          say('totalCount',rows.length);
          renderTable();drawMap();
        }
      }
      say('importStatus','주소 확인 '+checked+'건 · 좌표 저장 '+saved+'건 · 주소가 없는 화물은 아래 목록에서 확인할 수 있습니다.');
    }catch(error){
      if(token)say('importStatus','주소 조회 실패: '+error.message);
    }finally{geocodeRunning=false;}
  }

  function bind(){
    $('deliveryDate').value=dateString();
    $('authForm').addEventListener('submit',signIn);
    $('logoutBtn').addEventListener('click',()=>lock(true));
    $('deliveryDate').addEventListener('change',loadDay);
    $('refreshBtn').addEventListener('click',loadDay);
    $('importForm').addEventListener('submit',upload);
    $('excelFile').addEventListener('change',()=>{
      say('fileName',$('excelFile').files[0]?.name||'선택된 파일 없음');
    });
    $('searchInput').addEventListener('input',renderTable);
    $('filterSelect').addEventListener('change',renderTable);
    $('fitBtn').addEventListener('click',fitMap);
    $('geocodeBtn').addEventListener('click',()=>lookupMissing(200));
    $('showMoreBtn').addEventListener('click',appendPage);
  }
  bind();
})();
