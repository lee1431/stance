/* DSD v1 app: two views, server-owned state, map/location/order editing. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = window.DSD_API;
  const map = new window.DSDMap();
  const state = {
    user: null, date: localDate(), rounds: [], round: null, stops: [],
    view: 'map', selected: null, filter: 'all', editingStop: null, busy: false,
    geocoding: false, mapLoaded: false, mapError: null, inspected: null,
    editTarget: null, searchMatch: null
  };
  let toastTimer;
  let inspectRequest = 0;
  let searchTimer = null;
  let searchSequence = 0;
  function localDate() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function btn(text, className, action, title) {
    const node = el('button', className, text);
    node.type = 'button';
    if (title) node.title = title;
    node.addEventListener('click', event => { event.stopPropagation(); action(); });
    return node;
  }
  function toast(message, ms = 3600) {
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), ms);
  }
  function saving(value = true, error = false) {
    $('saveIndicator').textContent = value ? '● 저장 중' : error ? '● 저장 실패' : '● 저장됨';
    $('saveIndicator').classList.toggle('error', !!error);
  }
  async function perform(task, message) {
    if (state.busy) return;
    state.busy = true;
    saving(true);
    try {
      const result = await task();
      if (result && result.round && Array.isArray(result.stops)) applyState(result);
      saving(false);
      if (message) toast(message);
      return result;
    } catch (error) {
      saving(false, true);
      toast(error.message, 6000);
      if (error.code === 'REVISION_CONFLICT' && state.round) {
        if (confirm('다른 기기에서 자료를 변경했습니다. 서버 자료를 다시 불러올까요?')) {
          await openRound(state.round.id).catch(e => toast(e.message));
        }
      }
    } finally { state.busy = false; }
  }
  async function showApp(user) {
    state.user = user;
    $('authView').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('userInfo').textContent = user.client_id + ' · ' + (user.phone || '');
    $('workDate').value = state.date;
    $('dateCaption').textContent = state.date;
    await loadRounds();
    map.onSelect = id => {
      if (!map.editing) { selectStop(id); return; }
      const stop = state.stops.find(item => item.id === id);
      if (!stop) return;
      cancelSearchRequests();
      hideAddressResults();
      state.editTarget = id;
      state.searchMatch = null;
      map.centerOn(stop, 17);
      updateCenterUI();
      toast('지도 중앙에 위치를 맞춘 후 위치 저장을 누르세요.', 3200);
    };
    map.onDraft = coords => commitCenterPosition(coords);
    map.onCenterIdle = () => updateCenterUI();
    map.onPanStart = () => {
      if (!map.editing) return;
      searchSequence++;
      state.searchMatch = null;
      hideAddressResults();
      updateCenterUI();
    };
    map.onInspect = coords => inspectMapPosition(coords);
    map.onGPS = event => {
      $('gpsBtn').classList.toggle('active', event.tracking);
      if (event.error) toast('GPS: ' + event.error);
      renderTarget();
    };
    map.load(user.client_id).then(() => {
      state.mapLoaded = true;
      $('mapPlaceholder').classList.add('hidden');
      drawMap();
      setTimeout(() => map.fit(), 250);
    }).catch(error => {
      state.mapError = error.message;
      $('mapPlaceholder').querySelector('strong').textContent = '지도를 연결할 수 없습니다';
      $('mapPlaceholder').querySelector('span').textContent = error.message + ' · 목록은 계속 사용할 수 있습니다.';
      toast('지도 연결 실패: ' + error.message, 6000);
    });
    changeView('map');
  }
  async function loadRounds(preferredId) {
    let response = await API.rounds(state.date);
    if (!response.rounds.length) {
      await API.createRound(state.date);
      response = await API.rounds(state.date);
    }
    state.rounds = response.rounds;
    const chosen = preferredId && response.rounds.find(r => r.id === preferredId);
    await openRound(chosen ? chosen.id : response.rounds[0].id);
  }
  async function openRound(id) {
    const response = await API.getRound(id);
    applyState(response);
    state.selected = response.round.active_stop_id || null;
    render();
  }
  function applyState(response) {
    state.round = response.round;
    state.stops = response.stops;
    if (state.selected && !state.stops.some(s => s.id === state.selected)) state.selected = null;
    if (!state.selected) state.selected = state.round.active_stop_id || null;
    const i = state.rounds.findIndex(r => r.id === response.round.id);
    if (i >= 0) state.rounds[i].revision = response.round.revision;
    render();
  }
  function render() {
    const roundNo = state.round ? state.round.round_no : 1;
    $('roundChip').firstChild.textContent = roundNo + '회차 ';
    $('dateCaption').textContent = state.date;
    renderRounds(); renderList(); renderCard(); renderTarget(); drawMap();
  }
  function drawMap() {
    map.draw(state.stops, state.round && state.round.active_stop_id, state.round && state.round.road);
  }
  function renderRounds() {
    const root = $('roundTabs'); root.replaceChildren();
    for (const round of state.rounds) {
      root.append(btn(round.round_no + '회차', 'round-tab' + (state.round && round.id === state.round.id ? ' active' : ''),
        () => openRound(round.id).catch(e => toast(e.message))));
    }
  }
  function statusText(status) {
    return ({ pending: '미완료', done: '완료', failed: '미배송', return: '반품' })[status] || status;
  }
  function renderList() {
    const total = state.stops.length;
    const done = state.stops.filter(s => s.status === 'done').length;
    const failed = state.stops.filter(s => s.status === 'failed' || s.status === 'return').length;
    const summary = $('summary'); summary.replaceChildren();
    for (const [value, cls] of [[`전체 ${total}`, ''], [`완료 ${done}`, 'done'], [`미배송·반품 ${failed}`, 'failed'], [`남음 ${total-done-failed}`, '']]) {
      summary.append(el('div', 'sum-pill ' + cls, value));
    }
    const root = $('stopList'); root.replaceChildren();
    const visible = state.stops.filter(s => state.filter === 'all' ||
      (state.filter === 'pending' ? s.status !== 'done' : s.status === 'done'));
    if (!visible.length) {
      const empty = el('div', 'empty-state');
      empty.append(el('strong', '', total ? '표시할 배송지가 없습니다' : '아직 배송지가 없습니다'));
      empty.append(el('p', '', '위의 배송지 버튼이나 엑셀로 추가하세요.'));
      root.append(empty); return;
    }
    visible.forEach(stop => {
      const row = el('article', 'stop-row' + (stop.status === 'done' ? ' is-done' : ''));
      row.dataset.sid = stop.id; row.draggable = true;
      row.addEventListener('dragstart', event => { row.classList.add('dragging'); event.dataTransfer.setData('text/plain', stop.id); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', event => event.preventDefault());
      row.addEventListener('drop', event => {
        event.preventDefault();
        const source = event.dataTransfer.getData('text/plain');
        if (source && source !== stop.id) reorderBetween(source, stop.id);
      });
      const order = el('div','order-controls');
      order.append(btn('↑','',() => moveStop(stop.id,-1),'위로'));
      order.append(btn('↓','',() => moveStop(stop.id,1),'아래로'));
      order.append(el('span','grab','↕'));
      const number = el('div','stop-number',stop.position);
      const details = el('div','stop-details');
      details.append(el('strong','',stop.company || ('배송지 ' + stop.position)));
      details.append(el('small','',stop.address || '지도에서 위치 지정'));
      details.append(el('div','stop-sub',statusText(stop.status) + (stop.id === state.round.active_stop_id ? ' · 현재 목적지' : '')));
      details.addEventListener('click', () => { selectStop(stop.id); openEditor(stop); });
      const actions = el('div','stop-actions');
      actions.append(btn('출발','action-start',() => start(stop.id)));
      actions.append(btn(stop.status === 'done' ? '취소' : '완료','action-done',
        () => action(stop.id, stop.status === 'done' ? 'undo' : 'done')));
      actions.append(btn('⋯','action-more',() => extraStop(stop.id)));
      row.append(order,number,details,actions); root.append(row);
    });
  }
  function renderCard() {
    const card = $('stopCard'); card.replaceChildren();
    const stop = state.stops.find(s => s.id === state.selected);
    if (!stop || state.view !== 'map') { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const head = el('div','stop-card-head');
    head.append(el('h3','',stop.position + ' · ' + (stop.company || '배송지')));
    head.append(btn('✕','action-more',() => { state.selected=null; renderCard(); }));
    card.append(head,el('p','',stop.address || '주소 없음'));
    const buttons = el('div','stop-card-buttons');
    buttons.append(btn('출발','primary',() => start(stop.id)));
    buttons.append(btn(stop.status === 'done' ? '완료 취소' : '완료','secondary',
      () => action(stop.id,stop.status === 'done' ? 'undo' : 'done')));
    buttons.append(btn('내비','secondary',() => openNavigation(stop)));
    buttons.append(btn('수정','secondary',() => openEditor(stop)));
    const select = el('select',''); select.title = '방문 순서 변경';
    for (let i=1;i<=state.stops.length;i++) {
      const option = el('option','',i + '번'); option.value = String(i);
      option.selected = stop.position === i; select.append(option);
    }
    select.addEventListener('change',() => moveTo(stop.id,Number(select.value)));
    buttons.append(select); card.append(buttons);
  }
  function renderTarget() {
    const strip = $('targetStrip');
    const stop = state.stops.find(s => state.round && s.id === state.round.active_stop_id);
    if (!stop || state.view !== 'map') { strip.classList.add('hidden'); return; }
    strip.classList.remove('hidden'); strip.replaceChildren();
    strip.append(el('strong','',stop.position + '번 목적지 · ' + (stop.company || '배송지')));
    const lat = stop.parking_lat == null ? stop.lat : stop.parking_lat;
    const lng = stop.parking_lng == null ? stop.lng : stop.parking_lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      strip.append(el('span','', '목적지 좌표가 없습니다. 배송지 위치를 지정하세요.'));
      return;
    }
    const distance = map.lastGps ? map.constructor.distance(map.lastGps,{lat,lng}) : null;
    if (distance === null) {
      strip.append(el('span','',map.tracking
        ? '현재 GPS 위치 확인 중 · 위치 권한을 허용하세요.'
        : 'GPS 추적을 켜야 거리를 표시할 수 있습니다.'));
    } else {
      const display = distance < 1000 ? distance + ' m' : (distance / 1000).toFixed(2) + ' km';
      strip.append(el('span','target-distance','현재 위치 → 목적지 · 직선 ' + display));
      strip.append(el('span','target-accuracy','GPS 정확도 약 ±' +
        Math.round(map.lastGps.accuracy || 0) + ' m'));
      strip.append(el('span','target-route-note',
        '주황색 점선은 직선 안내선입니다. 실제 도로 경로·주행거리가 아닙니다.'));
    }
  }
  function selectStop(id) {
    closeMapInfo();
    state.selected = id;
    renderCard();
    const selected = state.stops.find(s => s.id === id);
    if (selected && !map.editing) map.centerOn(selected,16);
  }
  function closeMapInfo() {
    inspectRequest++;
    state.inspected = null;
    $('mapAddressCard').classList.add('hidden');
    map.clearInspectMarker();
  }
  async function inspectMapPosition(coords) {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
    cancelSearchRequests();
    hideAddressResults();
    if (map.editing) leaveCenterMode();
    closeMapInfo();
    state.selected = null;
    renderCard();

    state.inspected = { lat:coords.lat, lng:coords.lng, road:'', jibun:'' };
    map.showInspectMarker(coords);
    $('mapAddressCard').classList.remove('hidden');
    $('mapAddressRoad').textContent = '도로명주소 조회 중...';
    $('mapAddressJibun').textContent = '지번주소 조회 중...';
    $('mapAddressCoords').textContent =
      '위도 ' + coords.lat.toFixed(7) + ' · 경도 ' + coords.lng.toFixed(7);
    const requestId = ++inspectRequest;
    try {
      const found = await map.reverseGeocode(coords);
      if (requestId !== inspectRequest || !state.inspected) return;
      state.inspected.road = found.road || '';
      state.inspected.jibun = found.jibun || '';
      $('mapAddressRoad').textContent = found.road ? '도로명: ' + found.road : '도로명주소: 조회 결과 없음';
      $('mapAddressJibun').textContent = found.jibun ? '지번: ' + found.jibun : '지번주소: 조회 결과 없음';
    } catch (error) {
      if (requestId !== inspectRequest || !state.inspected) return;
      $('mapAddressRoad').textContent = '주소 조회 불가: ' + error.message;
      $('mapAddressJibun').textContent = '좌표는 그대로 배송지 등록에 사용할 수 있습니다.';
    }
  }
  function openEditorFromMap(coords, address = '') {
    if (!coords) return;
    closeMapInfo();
    openEditor(null, coords, address);
    if (address) return;
    // Also populate addresses when a user adds by ordinary map tap or pencil.
    map.reverseGeocode(coords).then(found => {
      if (!$('stopDialog').open || state.editingStop) return;
      if (Number($('stopLat').value) !== coords.lat || Number($('stopLng').value) !== coords.lng) return;
      if (!$('stopAddress').value.trim()) $('stopAddress').value = found.road || found.jibun || '';
    }).catch(() => {
      // Map coordinate entry stays available when the reverse geocoding quota/permission fails.
    });
  }
  function hideAddressResults() {
    $('mapSearchResults').classList.add('hidden');
    $('mapSearchResults').replaceChildren();
  }
  function cancelSearchRequests() {
    searchSequence++;
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  function updateCenterUI() {
    const choosing = map.editing;
    $('mapCenterPin').classList.toggle('hidden', !choosing);
    $('mapCenterActions').classList.toggle('hidden', !choosing);
    $('mapEditBtn').classList.toggle('active', choosing);
    $('mapEditBtn').setAttribute('aria-pressed', String(choosing));
    const stop = state.editTarget && state.stops.find(item => item.id === state.editTarget);
    $('mapCenterSave').textContent = stop ? '위치 저장' : '이 위치 등록';
    const coords = choosing ? map.getDraftPosition() : null;
    $('mapCenterText').textContent = coords
      ? (stop ? (stop.company || '선택한 배송지') + ' · ' : '') +
        '위도 ' + coords.lat.toFixed(6) + ' · 경도 ' + coords.lng.toFixed(6)
      : '지도를 움직여 중앙 위치를 맞춰주세요.';
    $('mapHint').classList.add('hidden');
  }
  function enterCenterMode() {
    if (!map.isAvailable()) {
      toast('지도가 아직 연결되지 않았습니다.');
      return false;
    }
    closeMapInfo();
    state.selected = null;
    renderCard();
    if (!map.editing) map.setEdit(true);
    updateCenterUI();
    return true;
  }
  function leaveCenterMode() {
    map.setEdit(false);
    state.editTarget = null;
    state.searchMatch = null;
    updateCenterUI();
  }
  function chooseAddressResult(found, keepResults = false) {
    if (!enterCenterMode()) return;
    state.editTarget = null;
    state.searchMatch = { lat: found.lat, lng: found.lng,
      address: found.road || found.jibun || '' };
    if (!keepResults) {
      cancelSearchRequests();
      $('mapSearchInput').value = found.road || found.jibun ||
        (found.lat.toFixed(6) + ', ' + found.lng.toFixed(6));
      $('mapSearchClear').classList.remove('hidden');
      hideAddressResults();
    }
    map.centerOn({ lat: found.lat, lng: found.lng }, 17);
    updateCenterUI();
  }
  function renderAddressResults(rows, message) {
    const panel = $('mapSearchResults');
    panel.replaceChildren();
    if (message) {
      panel.append(el('div', 'map-search-message', message));
      panel.classList.remove('hidden');
      return;
    }
    for (const result of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-search-result';
      button.setAttribute('role','option');
      button.append(el('strong','',result.road || result.jibun || '주소 없음'));
      if (result.road && result.jibun)
        button.append(el('small','',result.jibun));
      button.addEventListener('click', () => chooseAddressResult(result));
      panel.append(button);
    }
    panel.classList.toggle('hidden', !rows.length);
  }
  function searchAddressInput() {
    cancelSearchRequests();
    const query = $('mapSearchInput').value.trim();
    $('mapSearchClear').classList.toggle('hidden', !query);
    state.searchMatch = null;
    if (!query || query.length < 2) {
      hideAddressResults();
      return;
    }
    if (!enterCenterMode()) return;
    renderAddressResults([], '주소 검색 중...');
    const request = searchSequence;
    searchTimer = setTimeout(async () => {
      try {
        const rows = await map.searchAddresses(query, 5);
        if (request !== searchSequence || state.view !== 'map') return;
        if (!rows.length) {
          renderAddressResults([], '주소 검색 결과가 없습니다. 더 정확한 주소를 입력하세요.');
          return;
        }
        renderAddressResults(rows);
        // Auto-place the fixed center pin on the best match without saving it.
        chooseAddressResult(rows[0], true);
      } catch (error) {
        if (request !== searchSequence) return;
        renderAddressResults([], error.message || '주소 검색 실패');
      }
    }, 450);
  }
  async function commitCenterPosition(coords) {
    if (!coords || $('stopDialog').open || state.busy) return;
    const stop = state.editTarget &&
      state.stops.find(item => item.id === state.editTarget);
    if (stop) {
      const changes = stop.parking_lat != null
        ? { parking_lat: coords.lat, parking_lng: coords.lng }
        : { lat: coords.lat, lng: coords.lng };
      const result = await perform(
        () => API.updateStop(stop.id, state.round.revision, changes),
        '지도 중앙 위치로 마커를 저장했습니다.');
      if (result) leaveCenterMode();
      return;
    }
    const matched = state.searchMatch;
    const address = matched && map.constructor.distance(coords, matched) <= 12
      ? matched.address : '';
    leaveCenterMode();
    hideAddressResults();
    openEditorFromMap(coords, address);
  }
  function changeView(view) {
    if (view !== 'map') {
      closeMapInfo();
      cancelSearchRequests();
      hideAddressResults();
      if (map.editing) leaveCenterMode();
    }
    state.view = view;
    $('app').dataset.view = view;
    $('mapView').classList.toggle('hidden',view !== 'map');
    $('listView').classList.toggle('hidden',view !== 'list');
    $('navMap').classList.toggle('active',view === 'map');
    $('navList').classList.toggle('active',view === 'list');
    renderCard(); renderTarget();
    if (view === 'map') setTimeout(() => map.resize(),50);
  }
  function newRound() {
    perform(async () => {
      const created = await API.createRound(state.date);
      const response = await API.rounds(state.date);
      state.rounds = response.rounds;
      await openRound(created.id);
    }, '새 회차를 만들었습니다.');
  }
  function reorderBetween(sourceId,targetId) {
    const ids = state.stops.map(s => s.id);
    const from = ids.indexOf(sourceId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to,0,ids.splice(from,1)[0]);
    perform(() => API.order(state.round.id,state.round.revision,ids),'방문 순서를 저장했습니다.');
  }
  function moveStop(id,delta) {
    const stops = state.stops;
    const i = stops.findIndex(s => s.id === id);
    const j = i+delta;
    if (j < 0 || j >= stops.length) return;
    const ids = stops.map(s => s.id);
    [ids[i],ids[j]] = [ids[j],ids[i]];
    perform(() => API.order(state.round.id,state.round.revision,ids));
  }
  function moveTo(id,position) {
    const ids = state.stops.map(s => s.id);
    const i = ids.indexOf(id);
    if (i < 0 || position < 1 || position > ids.length) return;
    ids.splice(position-1,0,ids.splice(i,1)[0]);
    perform(() => API.order(state.round.id,state.round.revision,ids),'방문 순서를 변경했습니다.');
  }
  async function start(id) {
    const result = await perform(() => API.updateStop(id,state.round.revision,null,'start'),'목적지를 지정했습니다.');
    if (!result) return;
    state.selected = id;
    changeView('map');
    const stop = state.stops.find(s => s.id === id);
    if (stop) map.centerOn(stop,16);
    if (!map.tracking) {
      try { map.gpsToggle(); } catch (error) { toast(error.message); }
    } else map.resumeFollow();
    render();
  }
  function action(id,code) {
    perform(() => API.updateStop(id,state.round.revision,null,code),
      code === 'done' ? '배송 완료! 다음 목적지를 확인하세요.' : '배송 상태를 저장했습니다.');
  }
  function openNavigation(stop) {
    const lat=stop.parking_lat == null ? stop.lat : stop.parking_lat;
    const lng=stop.parking_lng == null ? stop.lng : stop.parking_lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { toast('목적지의 좌표를 먼저 지정하세요.'); return; }
    if (!confirm('네이버 지도 앱의 내비게이션을 실행할까요?')) return;
    const url='nmap://navigation?dlat='+encodeURIComponent(lat)+'&dlng='+encodeURIComponent(lng)+
      '&dname='+encodeURIComponent(stop.company || stop.address || '배송지')+
      '&appname='+encodeURIComponent(location.origin + '/dsd/');
    location.href=url;
    toast('네이버 지도 앱이 설치되어 있지 않다면 앱스토어에서 설치하세요.',5000);
  }
  function extraStop(id) {
    const stop=state.stops.find(s=>s.id===id);
    if (!stop) return;
    const actions=$('moreActions'); actions.replaceChildren();
    $('moreTitle').textContent=stop.position+'번 · '+(stop.company||'배송지');
    const add=(name,fn,style='secondary') => actions.append(btn(name,style,() => {
      $('moreDialog').close(); fn();
    }));
    add('정보 수정',()=>openEditor(stop));
    add('미배송 처리',()=>action(id,'failed'));
    add('반품 처리',()=>action(id,'return'));
    add('미완료로 되돌리기',()=>action(id,'undo'));
    add('삭제',()=>{
      if (confirm('이 배송지를 삭제하시겠습니까?')) perform(() => API.deleteStop(id,state.round.revision),'삭제했습니다.');
    },'danger-quiet');
    $('moreDialog').showModal();
  }
  function openEditor(stop,coords,address = '') {
    state.editingStop = stop ? stop.id : null;
    $('stopDialogTitle').textContent = stop ? '배송지 수정' : '배송지 추가';
    $('stopCompany').value = stop?.company || '';
    $('stopAddress').value = stop?.address || address || '';
    $('stopWaybill').value = stop?.waybill || '';
    $('stopQuantity').value = stop?.quantity || 1;
    $('stopMemo').value = stop?.memo || '';
    $('stopApproach').value = stop?.approach_hint || '';
    $('stopPinned').checked = !!stop?.pinned_last;
    $('stopLat').value = coords?.lat ?? stop?.lat ?? '';
    $('stopLng').value = coords?.lng ?? stop?.lng ?? '';
    $('stopDialog').showModal();
  }
  async function saveEditor(event) {
    event.preventDefault();
    const lat = $('stopLat').value.trim(), lng = $('stopLng').value.trim();
    if (!!lat !== !!lng) { toast('위도와 경도를 함께 입력하세요.'); return; }
    const values = {
      company: $('stopCompany').value.trim(), address: $('stopAddress').value.trim(),
      waybill: $('stopWaybill').value.trim(), quantity: Number($('stopQuantity').value || 1),
      memo: $('stopMemo').value.trim(), approach_hint: $('stopApproach').value,
      pinned_last: $('stopPinned').checked,
      lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null
    };
    if (!values.company && !values.address && values.lat===null) { toast('업체명·주소·지도 위치 중 하나를 입력하세요.'); return; }
    const sid = state.editingStop;
    const response = await perform(() => sid
      ? API.updateStop(sid,state.round.revision,values)
      : API.addStop(state.round.id,state.round.revision,values),'배송지 저장 완료');
    if (response) $('stopDialog').close();
  }
  async function geocodeEditor() {
    const address=$('stopAddress').value.trim();
    if (!address) { toast('주소를 입력하세요.'); return; }
    $('lookupAddressBtn').disabled=true;
    try {
      const coords=await map.geocode(address);
      $('stopLat').value=coords.lat; $('stopLng').value=coords.lng;
      toast('주소 좌표를 찾았습니다. 저장 버튼을 누르세요.');
    } catch (error) { toast(error.message); }
    finally { $('lookupAddressBtn').disabled=false; }
  }
  async function autoGeocodeAll() {
    if (state.geocoding) return;
    const missing=state.stops.filter(s => s.address && (s.lat === null || s.lng === null));
    if (!missing.length) { toast('좌표가 없는 배송지가 없습니다.'); return; }
    if (!map.isAvailable()) { toast('지도 연결이 필요합니다.'); return; }
    if (!confirm('주소가 있는 ' + missing.length + '건의 좌표를 차례로 검색할까요? 네이버 지도 API 사용량이 발생합니다.')) return;
    state.geocoding=true;
    let success=0, failed=0;
    for (let i=0;i<missing.length;i++) {
      const stop=missing[i];
      toast('주소 검색 ' + (i+1) + '/' + missing.length + ' · 성공 ' + success + ' · 실패 ' + failed,2000);
      try {
        const point=await map.geocode(stop.address);
        const updated=await API.updateStop(stop.id,state.round.revision,point);
        applyState(updated); success++;
      } catch (error) {
        failed++;
        if (error.code==='REVISION_CONFLICT' || error.code==='NETWORK' || error.status===401) {
          toast('주소 검색을 중단합니다: ' + error.message,6000);
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve,200));
    }
    state.geocoding=false;
    toast('주소 검색 종료 · 성공 ' + success + ' · 실패 ' + failed,6000);
  }
  function toggleDrawer(open) {
    $('drawer').classList.toggle('hidden',!open);
    $('drawerScrim').classList.toggle('hidden',!open);
  }
  async function importExcel(file) {
    if (!file || !state.round) return;
    if (!confirm('현재 '+state.round.round_no+'회차에 '+file.name+'을(를) 가져올까요?\n원본 파일도 DSD 서버에 보관됩니다.')) return;
    const result = await perform(() => API.importSheet(state.round.id,state.round.revision,file));
    if (result) toast(result.imported+'건 추가 · '+result.skipped+'건 제외. 좌표 찾기를 실행하세요.',6000);
    $('excelFile').value='';
  }
  async function roadRecommend() {
    if (!state.round) return;
    if (!confirm('현재 배송지 좌표를 설정된 도로 경로 엔진에 전송해 실제 도로 기준 방문 순서를 계산하고 저장할까요?\n기존 수동 방문 순서를 덮어씁니다.')) return;
    const start=map.lastGps ? {lat:map.lastGps.lat,lng:map.lastGps.lng}:null;
    const result=await perform(() => API.recommend(state.round.id,state.round.revision,start));
    if (result) toast('도로 기반 순서를 저장했습니다. 실시간 교통·신호 주기는 반영되지 않습니다.',6500);
  }
  function bind() {
    $('authForm').addEventListener('submit',async event => {
      event.preventDefault(); $('loginSubmit').disabled=true;
      try {
        const response=await API.enter($('clientId').value.trim(),$('phone').value.trim(),$('password').value);
        // Verify the token on a second independent API request.
        const verified = await API.me().catch(() => {
          throw new Error('로그인 토큰 검증 실패: 서버 버전과 프론트 인증 방식이 일치하는지 확인하세요.');
        });
        $('password').value=''; await showApp(verified.user || response.user);
      } catch(error) { toast(error.message,6000); }
      finally {$('loginSubmit').disabled=false;}
    });
    $('navMap').addEventListener('click',() => changeView('map'));
    $('navList').addEventListener('click',() => changeView('list'));
    $('roundChip').addEventListener('click',() => changeView('list'));
    $('menuBtn').addEventListener('click',() => toggleDrawer(true));
    $('closeDrawer').addEventListener('click',() => toggleDrawer(false));
    $('drawerScrim').addEventListener('click',() => toggleDrawer(false));
    $('workDate').addEventListener('change',async event => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) return;
      state.date=event.target.value; toggleDrawer(false);
      await loadRounds().catch(e=>toast(e.message));
    });
    $('newRoundBtn').addEventListener('click',newRound);
    $('addListStopBtn').addEventListener('click',() => openEditor());
    $('cancelStopBtn').addEventListener('click',() => $('stopDialog').close());
    $('cancelStop2').addEventListener('click',() => $('stopDialog').close());
    $('stopForm').addEventListener('submit',saveEditor);
    $('lookupAddressBtn').addEventListener('click',geocodeEditor);
    $('listImportBtn').addEventListener('click',() => $('excelFile').click());
    $('excelFile').addEventListener('change',e => importExcel(e.target.files[0]));
    $('listRecommendBtn').addEventListener('click',roadRecommend);
    $('listGeocodeBtn').addEventListener('click',autoGeocodeAll);
    document.querySelectorAll('.filter').forEach(button => button.addEventListener('click',() => {
      state.filter=button.dataset.filter;
      document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===button));
      renderList();
    }));
    $('gpsBtn').addEventListener('click',() => {
      try { if (map.tracking && Date.now() < map.pausedUntil) map.resumeFollow(); else map.gpsToggle(); }
      catch(error) { toast(error.message); }
    });
    $('fitBtn').addEventListener('click',() => map.fit());
    $('mapAddressClose').addEventListener('click', closeMapInfo);
    $('mapAddressRegister').addEventListener('click', () => {
      const inspected = state.inspected;
      if (!inspected) return;
      openEditorFromMap(
        { lat: inspected.lat, lng: inspected.lng },
        inspected.road || inspected.jibun || ''
      );
    });
    $('mapSearchInput').addEventListener('input', searchAddressInput);
    $('mapSearchInput').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      // Enter selects the current top match when available.
      const first = $('mapSearchResults').querySelector('.map-search-result');
      if (first) first.click();
      $('mapSearchInput').blur();
    });
    $('mapSearchClear').addEventListener('click', () => {
      cancelSearchRequests();
      state.searchMatch = null;
      $('mapSearchInput').value = '';
      $('mapSearchClear').classList.add('hidden');
      hideAddressResults();
      $('mapSearchInput').focus();
    });
    $('mapCenterSave').addEventListener('click', () => {
      if (map.onDraft) map.onDraft(map.getDraftPosition());
    });
    $('mapCenterCancel').addEventListener('click', () => {
      cancelSearchRequests();
      hideAddressResults();
      leaveCenterMode();
    });
    $('mapEditBtn').addEventListener('click', () => {
      cancelSearchRequests();
      hideAddressResults();
      if (!map.isAvailable()) { toast('지도 연결이 필요합니다.'); return; }
      if (map.editing) leaveCenterMode();
      else {
        state.editTarget = null;
        state.searchMatch = null;
        enterCenterMode();
      }
    });
    $('downloadBtn').addEventListener('click',() => {
      if (state.round) {
        const round = state.round;
        API.download('rounds/'+encodeURIComponent(round.id)+'/export.csv',
          'dsd-'+round.date_key+'-'+round.round_no+'회차.csv').catch(e=>toast(e.message));
      }
      toggleDrawer(false);
    });
    $('filesBtn').addEventListener('click',async () => {
      const result=await API.listFiles(state.round.id).catch(e=>{toast(e.message);return null;});
      if (!result) return;
      const actions=$('fileActions'); actions.replaceChildren();
      if (!result.files.length) actions.append(el('p','', '보관된 원본 파일이 없습니다.'));
      for (const file of result.files) {
        actions.append(btn('↓ '+file.original_name,'secondary',
          ()=>API.download('files/'+encodeURIComponent(file.id),file.original_name)
            .catch(e=>toast(e.message))));
      }
      toggleDrawer(false); $('fileDialog').showModal();
    });
    $('closeFilesBtn').addEventListener('click',() => $('fileDialog').close());
    $('closeMoreBtn').addEventListener('click',() => $('moreDialog').close());
    $('removeRoundBtn').addEventListener('click',async () => {
      if (!state.round || !confirm(state.round.round_no+'회차와 배송지·원본 파일을 삭제할까요? 복구할 수 없습니다.')) return;
      const result=await perform(()=>API.deleteRound(state.round.id,state.round.revision));
      if (result) { toggleDrawer(false); await loadRounds(); }
    });
    $('legacyBtn').addEventListener('click',async () => {
      const records=window.DSDLegacy.collect();
      if (!records.length) { toast('현재 주소의 브라우저에서 이전 자료를 찾지 못했습니다.'); return; }
      if (!confirm('기존 브라우저 자료 '+records.length+'개 회차를 서버로 가져올까요?\n같은 날짜·회차는 건너뛰며 기존 브라우저 자료는 삭제하지 않습니다.')) return;
      const result=await perform(()=>API.legacy(records));
      if (result) { toast('이전 완료 '+result.imported_rounds+'회차, 중복 '+result.skipped_existing_rounds+'회차',7000);await loadRounds(); }
      toggleDrawer(false);
    });
    $('logoutBtn').addEventListener('click',async () => {
      if (!confirm('로그아웃하시겠습니까?')) return;
      await API.logout().catch(e=>toast(e.message));
      location.reload();
    });
    window.addEventListener('resize',() => { if (state.view==='map')map.resize(); });
    document.addEventListener('visibilitychange',() => { if (!document.hidden && state.round && !state.busy) {
      API.getRound(state.round.id).then(applyState).catch(()=>{});
    }});
  }
  async function init() {
    bind();
    try {
      const me=await API.me();
      await showApp(me.user);
    } catch (error) {
      if (error.status!==401 && error.code!=='401') toast('자동 로그인 확인 실패: '+error.message,4500);
    }
  }
  init();
})();