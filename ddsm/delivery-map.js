/* DDSM selected-round NAVER map. Reuses the existing public map SDK client ID. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const valid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
  const key = s => String(s.roundNo) + ':' + String(s.id);
  let map = null, maps = null, currentDate = '', currentRound = 0, markers = new Map();
  let selectedSignature = '', initialFitDone = false, userInteracted = false, active = false, loadPromise = null;
  let onSelect = null, onGeocoded = null, geocodeGeneration = 0;
  let failed = new Set();
  let onLongPress=null,onDismiss=null,onViewport=null,draftMarker=null,lastMarkerClick=0,lastLongPress=0;
  let pointer=null;
  let locationSignature='';
  let locationMarker=null,locationWatch=null,locationEpoch=0,locationPoint=null,locationCenterPending=false;
  let renderedSignature='';
  let requestQueue = [], working = 0;
  const inFlight = new Set();

  function status(message, error = false) {
    const el = $('deliveryMapEmpty');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('map-error', error);
    // Once the base map exists, keep its tiles visible even when no stops
    // or geocoding results exist. The notice becomes a small corner hint.
    el.classList.toggle('map-ready', Boolean(map));
  }
  // NAVER icon content is HTML: always escape names entered by users.
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  function recipientName(stop) {
    const full = String(stop.recipient || '').trim();
    if (!full) return '미입력';
    const letters = Array.from(full);
    return letters.length > 8 ? letters.slice(0, 8).join('') + '…' : full;
  }
  function markerTitle(stop) {
    return String(stop.position) + '번 · ' + (String(stop.recipient || '').trim() || '수취인 미입력');
  }
  function icon(stop) {
    const complete = stop.status === 'done';
    const color = complete ? '#16855B' : '#087F8C';
    const number = String(stop.position);
    const content = '<div class="ddsm-map-marker' + (complete ? ' is-done' : '')
      + '" style="--marker-color:' + color + '" title="' + escapeHtml(markerTitle(stop)) + '">'
      + '<span class="ddsm-map-pin-order">' + escapeHtml(number) + '</span>'
      + '<span class="ddsm-map-pin-name">' + escapeHtml(recipientName(stop)) + '</span>'
      + '</div>';
    return { content, size: new maps.Size(94, 64), anchor: new maps.Point(47, 61) };
  }
  function boundsAll() {
    if (!map || !maps) return false;
    const validMarkers = [...markers.values()];
    if (!validMarkers.length) return false;
    if (validMarkers.length === 1) {
      map.setCenter(validMarkers[0].getPosition());
      map.setZoom(16);
      return true;
    }
    const bounds = new maps.LatLngBounds();
    validMarkers.forEach(marker => bounds.extend(marker.getPosition()));
    map.fitBounds(bounds, { top: 80, bottom: 65, left: 65, right: 112 });
    return true;
  }
  function fit() {
    if(!active||!map||renderedSignature!==selectedSignature)return false;
    maps.Event.trigger(map,'resize');
    return boundsAll();
  }
  function fitAll(){
    if(!active||!map)return false;
    userInteracted=true;locationCenterPending=false;
    return fit();
  }
  function locationState(state){
    const button=$('mapLocate');
    button.setAttribute('aria-pressed',String(state==='active'));
    button.setAttribute('aria-busy',String(state==='pending'));
    button.classList.toggle('location-pending',state==='pending');
  }
  function stopLocation(){
    ++locationEpoch;
    if(locationWatch!==null){try{navigator.geolocation.clearWatch(locationWatch);}catch(_){}}
    locationWatch=null;locationCenterPending=false;locationPoint=null;
    if(locationMarker){locationMarker.setMap(null);locationMarker=null;}
    locationState('idle');
  }
  function centerLocation(){
    if(!map||!locationPoint)return;
    map.setCenter(locationPoint);map.setZoom(16);
  }
  function locate(notify){
    if(!active||!map){notify('지도를 준비 중입니다. 잠시 후 다시 눌러주세요.');return;}
    if(!navigator.geolocation){notify('이 브라우저는 위치 확인을 지원하지 않습니다.');return;}
    userInteracted=true;
    if(locationWatch!==null){
      if(locationPoint){locationCenterPending=false;centerLocation();}
      else{locationCenterPending=true;notify('현재 위치를 확인 중입니다.');}
      return;
    }
    const epoch=++locationEpoch;
    locationCenterPending=true;locationState('pending');
    try{
      locationWatch=navigator.geolocation.watchPosition(position=>{
        if(!active||epoch!==locationEpoch)return;
        const p={lat:position.coords.latitude,lng:position.coords.longitude};
        if(!valid(p))return;
        locationPoint=new maps.LatLng(p.lat,p.lng);
        if(!locationMarker){
          locationMarker=new maps.Marker({map,position:locationPoint,clickable:false,zIndex:1000,
            icon:{content:'<div class="ddsm-current-location" aria-label="내 위치"></div>',size:new maps.Size(28,28),anchor:new maps.Point(14,14)}});
        }else locationMarker.setPosition(locationPoint);
        locationState('active');
        if(locationCenterPending){locationCenterPending=false;centerLocation();}
      },error=>{
        if(epoch!==locationEpoch||!active)return;
        stopLocation();
        notify(error.code===1?'브라우저의 위치 접근 권한을 허용하세요.':'현재 위치를 확인하지 못했습니다. 다시 시도하세요.');
      },{enableHighAccuracy:true,maximumAge:5000,timeout:12000});
    }catch(_){stopLocation();notify('위치 서비스를 사용할 수 없습니다.');}
  }
  function draw(stops, roundNo) {
    if (!map) return;
    const keep = new Set();
    for (const s of stops) {
      if (!valid(s)) continue;
      const id = key(s);
      keep.add(id);
      const coords = new maps.LatLng(s.lat, s.lng);
      let marker = markers.get(id);
      if (!marker) {
        marker = new maps.Marker({ map, position: coords, icon: icon(s), clickable: true, title: markerTitle(s) });
        maps.Event.addListener(marker, 'click', () => {
          if (active && typeof onSelect === 'function' && Date.now()-lastLongPress>500) {lastMarkerClick=Date.now();userInteracted=true;onSelect(s.id,s.roundNo);}
        });
        markers.set(id, marker);
      } else {
        marker.setPosition(coords);
        marker.setIcon(icon(s));
        if (typeof marker.setTitle === 'function') marker.setTitle(markerTitle(s));
      }
    }
    for (const [id, marker] of markers) {
      if (!keep.has(id)) { marker.setMap(null); markers.delete(id); }
    }
    const missing = stops.filter(s => !valid(s)).length;
    $('deliveryMapCount').textContent = roundNo + '회차 · 지도 표시 ' + markers.size + '곳 / 전체 ' + stops.length + '건'
      + (missing ? ' · 위치 미확인 ' + missing + '건' : '');
    if (!stops.length) {
      status('배송지 0건 · 지도를 자유롭게 이동할 수 있습니다.');
    } else if (!markers.size) {
      status(stops.some(s => s.address && s.address.length >= 4)
        ? '주소 위치를 확인 중입니다. 지도는 이동할 수 있습니다.'
        : '주소를 등록하면 여기에 배송지 번호가 표시됩니다.');
    } else {
      $('deliveryMapEmpty').classList.add('hidden');
    }
    const locations=stops.filter(valid).map(s=>key(s)+':'+s.lat+':'+s.lng).sort().join('|');
    if (markers.size && !userInteracted && (!initialFitDone||locations!==locationSignature)) {
      initialFitDone=true;const signature=selectedSignature;requestAnimationFrame(()=>{if(!userInteracted&&signature===selectedSignature)fit();});
    }
    renderedSignature=selectedSignature;locationSignature=locations;onViewport?.();
  }
  function createMap() {
    if (map) return;
    const n = maps;
    map = new n.Map($('deliveryMapCanvas'), {
      center: new n.LatLng(36.991, 127.925),
      zoom: 12,
      zoomControl: false,
      zoomControlOptions: { position: n.Position.TOP_RIGHT },
      mapDataControl: false, scaleControl: false, logoControl: true
    });
    n.Event.addListener(map,'dragstart',()=>{userInteracted=true;locationCenterPending=false;pointer=null;});
    n.Event.addListener(map,'bounds_changed',()=>onViewport?.());
    n.Event.addListener(map,'idle',()=>onViewport?.());
    n.Event.addListener(map,'click',()=>{if(Date.now()-lastMarkerClick>300&&Date.now()-lastLongPress>500)onDismiss?.();});
    const canvas=$('deliveryMapCanvas');
    canvas.addEventListener('pointerdown',e=>{
      userInteracted=true;locationCenterPending=false;
      if(!e.isPrimary||e.button!==0||pointer){pointer=null;return;}
      pointer={id:e.pointerId,x:e.clientX,y:e.clientY,t:performance.now()};
    },true);
    canvas.addEventListener('pointermove',e=>{if(pointer&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>12)pointer=null;},true);
    canvas.addEventListener('pointercancel',()=>{pointer=null;},true);
    canvas.addEventListener('pointerup',e=>{
      const p=pointer;pointer=null;
      if(!active||!p||p.id!==e.pointerId||performance.now()-p.t<500||Math.hypot(e.clientX-p.x,e.clientY-p.y)>12)return;
      const r=canvas.getBoundingClientRect();
      const coord=map.getProjection().fromOffsetToCoord(new n.Point(e.clientX-r.left,e.clientY-r.top));
      const point={lat:coord.lat(),lng:coord.lng()};
      if(valid(point)){lastLongPress=Date.now();onLongPress?.(point);}
    },true);
    canvas.addEventListener('contextmenu',e=>e.preventDefault());

  }
  function queueGeocodes(stops, date) {
    // Revisions of order or completion must not invalidate geocoding for this day.
    const generation = geocodeGeneration;
    const existing = new Set(requestQueue.map(s => s.id + ':' + s.roundNo));
    for (const s of stops) {
      const lookup = key(s) + ':' + s.address;
      if (!s.address || s.address.length < 4 || valid(s) || failed.has(lookup) || existing.has(key(s)) || inFlight.has(lookup)) continue;
      requestQueue.push({ ...s, date, lookup, generation });
      existing.add(key(s));
    }
    startGeocoding();
  }
  function startGeocoding() {
    if (!maps || !maps.Service || !active) return;
    while (working < 2 && requestQueue.length) {
      const s = requestQueue.shift();
      if (!s || s.generation !== geocodeGeneration || s.date !== currentDate) continue;
      working++;
      inFlight.add(s.lookup);
      try {
        window.DDSM_Address.resolve(maps, s.address).then(point => {
          working--;
          inFlight.delete(s.lookup);
          if (s.generation === geocodeGeneration && s.date === currentDate) {
            const lat = point?.lat, lng = point?.lng;
            if (point?.verified && valid({ lat, lng })) {
              if (typeof onGeocoded === 'function') onGeocoded(s.date, s.roundNo, s.id, s.address, { lat, lng });
            } else {
              failed.add(s.lookup);
            }
          }
          startGeocoding();
          if (active && !requestQueue.length && !working && !markers.size)
            status('주소에서 지도 위치를 찾지 못했습니다. 배송 정보에서 주소 또는 위치를 확인하세요.', true);
        }).catch(() => {
          working--;
          inFlight.delete(s.lookup);
          failed.add(s.lookup);
          startGeocoding();
        });
      } catch (_) {
        working--;
        inFlight.delete(s.lookup);
        failed.add(s.lookup);
      }
    }
  }
  async function render(date, stops, callbacks, roundNo) {
    active = true;
    onSelect = callbacks.onSelect;
    onGeocoded = callbacks.onGeocoded;
    onLongPress=callbacks.onLongPress;onDismiss=callbacks.onDismiss;onViewport=callbacks.onViewport;
    if (currentDate !== date) {
      currentDate = date;
      initialFitDone = false;
      userInteracted = false;locationSignature='';clearDraft();
      ++geocodeGeneration;
      requestQueue = [];
      failed = new Set();
      for (const marker of markers.values()) marker.setMap(null);
      markers.clear();
    }
    if (currentRound !== roundNo) {
      currentRound = roundNo;
      initialFitDone = false;
      userInteracted = false;locationSignature='';clearDraft();
      // Pending geocoding from another round must not delay this round.
      ++geocodeGeneration;
      requestQueue = [];
      for(const marker of markers.values())marker.setMap(null);
      markers.clear();renderedSignature='';
    }
    $('deliveryMapCount').textContent = roundNo + '회차 · ' + stops.length + '건';
    // Lazy load: no additional SDK request until the delivery page opens.
    if (!loadPromise) {
      loadPromise = root.DDSM_NaverMap.loadSdk().then(n => {
        maps = n;
        createMap();
      }).catch(e => {
        loadPromise = null;
        status('네이버 지도를 불러오지 못했습니다: ' + (e.message || e), true);
        throw e;
      });
    }
    const signature = date + '|' + roundNo + '|' + stops.map(s => [
      s.roundNo, s.id, s.position, s.status, s.lat, s.lng, s.address, s.recipient
    ].join(':')).join('|');
    if (signature === selectedSignature && map) {
      maps.Event.trigger(map, 'resize');onViewport?.();
      return;
    }
    selectedSignature = signature;
    status(roundNo + '회차 배송지 지도를 준비하고 있습니다.');
    try { await loadPromise; } catch (_) { return; }
    if (!active || currentDate !== date || signature !== selectedSignature) return;
    maps.Event.trigger(map, 'resize');
    draw(stops, roundNo);
    queueGeocodes(stops, date);
  }
  function prepareRefresh(){
    // Redraw the current round, including retrying unresolved addresses, without resetting GPS or zoom.
    selectedSignature='';renderedSignature='';failed.clear();
    if(map)userInteracted=true;
  }
  function pause() {
    active = false;
    ++geocodeGeneration;
    requestQueue = [];
    clearDraft();stopLocation();pointer=null;
    selectedSignature = '';renderedSignature='';
  }
  function project(point) {
    if(!active||!map||!valid(point))return null;
    return map.getProjection().fromCoordToOffset(new maps.LatLng(point.lat,point.lng));
  }
  function clearDraft(){if(draftMarker){draftMarker.setMap(null);draftMarker=null;}}
  function showDraft(point){
    clearDraft();if(!map||!valid(point))return;
    draftMarker=new maps.Marker({map,position:new maps.LatLng(point.lat,point.lng),clickable:false,zIndex:10000,
      icon:{content:'<div class="draft-map-pin"></div>',size:new maps.Size(26,34),anchor:new maps.Point(13,30)}});
  }
  root.DDSM_DeliveryMap = Object.freeze({ render, pause, prepareRefresh, fit, fitAll, locate, project,showDraft,clearDraft });
})(window);
