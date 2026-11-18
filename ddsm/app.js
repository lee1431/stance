/* DDSM daily / scan / delivery. Scans require authenticated S10 manifest lookup; local delivery lists remain intact. */
(function () {
  'use strict';

  const AUTH_API_BASE = 'https://mrdindoin.ddns.net/dsd/api/auth/';
  const DRIVER_API_BASE = 'https://mrdindoin.ddns.net/dsd-center-api/';
  const LEGACY_STORAGE_KEY = 'ddsm:data:v1';
  const IDENTITY_KEY = 'ddsm:identity:phone:v1';
  const MIGRATION_KEY = 'ddsm:identity:migrated-legacy:v1';
  const phoneStorageKey = number => 'ddsm:data:v1:phone:' + number;
  const normalizePhone = raw => String(raw || '').replace(/\D/g, '');
  const isPhone = number => /^01[016789]\d{7,8}$/.test(number);
  const displayPhone = raw => {
    const value = normalizePhone(raw);
    if (value.length === 11) return value.slice(0,3) + '-' + value.slice(3,7) + '-' + value.slice(7);
    if (value.length === 10) return value.slice(0,3) + '-' + value.slice(3,6) + '-' + value.slice(6);
    return value;
  };
  function storedPhone() {
    try {
      const value = normalizePhone(localStorage.getItem(IDENTITY_KEY));
      return isPhone(value) ? value : '';
    } catch (_) { return ''; }
  }
  let identityPhone = storedPhone();
  let remoteAccount = false;
  let driverToken = ''; // Ephemeral, never written to browser storage.
  let resumeScanAfterLogin = false;
  // Central server owns day state; localStorage remains a recovery backup.
  let syncedDate = '', serverRevision = 0, syncBusy = false, syncPending = false, syncBlocked = false, syncEpoch = 0;
  const WORK_API = DRIVER_API_BASE + 'ddsm/work-day';
  function archiveLocal(dayKey) {
    try {
      const item = data.days[dayKey];
      if (!item || !item.rounds?.some(r => r.stops?.length)) return;
      const key = 'ddsm:legacy-archive:' + identityPhone + ':' + dayKey;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(item));
    } catch (_) {}
  }
  async function serverDay(dayKey, token) {
    const res = await fetch(WORK_API+'?date='+encodeURIComponent(dayKey),{
      headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store'
    });
    const body = await res.json().catch(()=>null);
    if (res.status===404) throw Error('S10 배송 작업 API가 없습니다. 서버 admin.py 업데이트 및 재시작이 필요합니다.');
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
       document.hidden || $('editDialog')?.open || $('scanDialog')?.open) return;
    const token=driverToken, dayKey=date, epoch=syncEpoch;
    try {
      const remote=await serverDay(dayKey,token);
      if(epoch!==syncEpoch || token!==driverToken || date!==dayKey || syncPending) return;
      if(remote.revision>serverRevision) {
        serverRevision=remote.revision;
        data.days[dayKey]=remote.day;
        try {localStorage.setItem(activeStorageKey(),JSON.stringify(data));}catch(_){}
        render();toast('다른 기기의 변경사항을 동기화했습니다.');
      }
    } catch(_) {}
  }

  const activeStorageKey = () => identityPhone ? phoneStorageKey(identityPhone) : LEGACY_STORAGE_KEY;
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
    if (!identityPhone) return false;
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
    $('myPhoneLabel').textContent = identityPhone
      ? (driverToken ? '서버 로그인 · ' : '서버 로그인 필요 · ') + displayPhone(identityPhone)
      : '휴대폰 번호 등록';
    $('dailyPhoneLabel').textContent = identityPhone ? displayPhone(identityPhone) : '번호 미등록';
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
    $('totalCount').textContent = String(c.total);
    $('pendingCount').textContent = String(c.pending);
    $('doneCount').textContent = String(c.done);
    $('scanHint').textContent = '현재 회차 배송지 ' + c.total + '건'
      + (driverToken ? ' · 서버 조회 가능' : ' · 스캔하려면 서버 로그인');
    $('deliveryButton').disabled = c.pending === 0 || !driverToken || syncedDate !== date || syncBlocked;
    $('deliveryHint').textContent = c.pending
      ? '배송 예정 ' + c.pending + '건 · 누르면 목록으로 이동합니다.'
      : c.total ? '현재 회차의 배송을 모두 완료했습니다.' : '운송장을 스캔하면 배송을 시작할 수 있습니다.';
  }
  function allDayStops() {
    const d = day();
    return d.rounds.flatMap(r => (r.stops || []).map((stop, index) => ({
      ...stop, roundNo: r.no, position: index + 1
    })));
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
      renderDayMap();
    }
  }
  function selectMapStop(id, roundNo) {
    const d = day();
    if (d.selected !== roundNo) {
      const exists = d.rounds.some(r => r.no === roundNo);
      if (!exists) return;
      d.selected = roundNo;
      persist();
      render();
    }
    openEdit(id);
  }
  function renderDayMap() {
    if (view !== 'delivery') return;
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
    const all = allDayStops();
    Promise.resolve(window.DDSM_DeliveryMap.render(date, all, {
      onSelect: selectMapStop,
      onGeocoded: persistGeocoded
    })).catch(error => {
      message.textContent = '배송 지도 오류: ' + (error.message || String(error));
      message.classList.remove('hidden');
      message.classList.add('map-error');
    });
  }
  function setSelectedRound(value) {
    const d = day();
    const next = Number(value);
    if (!d.rounds.some(r => r.no === next) || d.selected === next) return;
    const old = d.selected;
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
      const ordering = node('div', 'stop-ordering');
      const up = button('↑', 'order-arrow', () => moveStopOrder(stop.id, index - 1));
      up.disabled = index === 0;
      up.setAttribute('aria-label', (index + 1) + '번 배송지를 위로');
      const down = button('↓', 'order-arrow', () => moveStopOrder(stop.id, index + 1));
      down.disabled = index === stops().length - 1;
      down.setAttribute('aria-label', (index + 1) + '번 배송지를 아래로');
      const jump = node('select', 'order-select');
      jump.setAttribute('aria-label', '배송 순번 변경: ' + (index + 1) + '번');
      for (let i = 0; i < stops().length; i++) {
        const option = node('option', '', (i + 1) + '번');
        option.value = String(i);
        jump.append(option);
      }
      jump.value = String(index);
      jump.addEventListener('change', () => moveStopOrder(stop.id, Number(jump.value)));
      ordering.append(node('span', 'order-caption', '순번'), up, down, jump);
      card.append(ordering);
      const actions = node('div', 'stop-actions');
      actions.append(button('정보 수정', '', () => openEdit(stop.id)));
      if (stop.address) {
        const link = node('a', '', '지도 열기');
        link.href = 'https://map.naver.com/p/search/' + encodeURIComponent(stop.address);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', '네이버 지도에서 주소 검색');
        actions.append(link);
      }
      actions.append(button(done ? '완료 취소' : '배송 완료', done ? 'undo' : 'complete', () => setDone(stop.id, !done)));
      actions.append(button('삭제', 'remove', () => removeStop(stop.id)));
      card.append(actions);
      root.append(card);
    });
  }
  function render() {
    renderHome();
    if (view === 'delivery') {
      renderDelivery();
      renderDayMap();
    }
  }
  function showView(next) {
    view = next;
    if (next !== 'delivery' && window.DDSM_DeliveryMap) window.DDSM_DeliveryMap.pause();
    $('homeScreen').classList.toggle('hidden', next !== 'home');
    $('deliveryScreen').classList.toggle('hidden', next !== 'delivery');
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
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
      render();
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
    render();
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
    if (!dialog.open) return;
    scanShutterSound();
    clearTimeout(scanFlashTimer);
    dialog.classList.remove('scan-read-flash');
    // Restart animation on consecutive scans, including a duplicate code.
    void dialog.offsetWidth;
    dialog.classList.add('scan-read-flash');
    scanFlashTimer = setTimeout(() => dialog.classList.remove('scan-read-flash'), 540);
  }
  function syncScanViewport() {
    const dialog = $('scanDialog');
    if (!dialog.open) return;
    const viewport = window.visualViewport;
    dialog.style.setProperty('--scan-viewport-height', (viewport ? viewport.height : window.innerHeight) + 'px');
    dialog.style.setProperty('--scan-viewport-top', (viewport ? viewport.offsetTop : 0) + 'px');
  }
  function openScan() {
    if (driverToken && (syncedDate !== date || syncBlocked)) { toast('서버 배송 목록 동기화 후 스캔하세요.');return; }
    if (!driverToken) {
      // No silent local registration. A scanned barcode must resolve on S10.
      resumeScanAfterLogin = true;
      openIdentityDialog();
      $('identityError').textContent = '운송장 조회를 위해 배송기사 로그인이 필요합니다. 로그인 후 스캔이 열립니다.';
      $('identityError').classList.remove('hidden');
      return;
    }
    const dialog = $('scanDialog');
    const input = $('waybillInput');
    $('scanResult').textContent = date+' · '+round().no+'회차 · S10 서버 원본 조회 후 등록';
    input.value = '';
    // Handheld barcode readers act like physical keyboards. Keep input focused
    // but suppress the soft keyboard until the user explicitly taps to type.
    input.setAttribute('inputmode', 'none');
    if (!dialog.open) dialog.showModal();
    prepareScanAudio();
    syncScanViewport();
    input.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (dialog.open && document.activeElement !== input) input.focus({preventScroll:true});
    });
  }
  const pendingScans = [];
  let scanWorkerActive = false;
  async function lookupWaybill(raw, dateKey) {
    const parsed = window.DDSM_Waybill?.parse(raw);
    if (!parsed?.valid) throw Error('운송장번호는 기본 13자리 또는 물품 16자리여야 합니다.');
    if (!driverToken) throw Error('서버 조회를 위해 휴대폰 번호로 로그인하세요.');
    const response = await fetch(
      DRIVER_API_BASE+'ddsm/waybill?date='+encodeURIComponent(dateKey)
        +'&barcode='+encodeURIComponent(parsed.scanned),
      {method:'GET',headers:{Authorization:'Bearer '+driverToken},credentials:'omit',cache:'no-store'}
    );
    const payload = await response.json().catch(()=>null);
    if (!response.ok || payload?.ok!==true) {
      if (response.status===401) {
        driverToken='';
        remoteAccount=false;
        renderHome();
      }
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
          const message=(result.existing?'같은 배송지 물품 추가':'서버 조회·등록 완료')
            +' · '+(detail.recipient||result.stop.waybill)
            +(result.suffix?' · 물품 '+result.suffix:'')
            +(detail.address?' · 주소 확인':' · 주소 미등록');
          $('scanResult').textContent=message;
        } catch(e) {
          const message=e.message||'운송장 조회 실패';
          $('scanResult').textContent=message;
          if(!job.camera)toast(message);
        } finally {
          if (!job.camera && $('scanDialog').open) {
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
      const message='서버 로그인이 필요합니다. 휴대폰 번호 버튼에서 로그인 후 다시 스캔하세요.';
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
    toast(value ? '배송 완료로 표시했습니다.' : '배송 예정으로 되돌렸습니다.');
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
    const orderPicker = $('editOrderSelect');
    orderPicker.replaceChildren();
    stops().forEach((_, index) => {
      const opt = node('option', '', (index + 1) + '번');
      opt.value = String(index);
      orderPicker.append(opt);
    });
    orderPicker.value = String(stops().findIndex(x => x.id === id));
    $('recipientInput').value = stop.recipient;
    $('addressInput').value = stop.address;
    $('phoneInput').value = stop.phone;
    $('memoInput').value = stop.memo;
    $('editDialog').showModal();
    if (window.DDSM_NaverMap) {
      window.DDSM_NaverMap.open(stop.address, validCoordinates(stop) ? { lat: stop.lat, lng: stop.lng } : null);
    }
  }
  function saveEdit(event) {
    event.preventDefault();
    const stop = stops().find(x => x.id === editingId);
    if (!stop) return;
    const before = { recipient: stop.recipient, address: stop.address, phone: stop.phone, memo: stop.memo, lat: stop.lat, lng: stop.lng };
    const list = stops();
    const oldIndex = list.findIndex(x => x.id === editingId);
    const wantedIndex = Number($('editOrderSelect').value);
    const moveIndex = Number.isInteger(wantedIndex) && wantedIndex >= 0
      && wantedIndex < list.length ? wantedIndex : oldIndex;
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
    if (oldIndex >= 0 && moveIndex !== oldIndex) {
      list.splice(oldIndex, 1);
      list.splice(moveIndex, 0, stop);
    }
    if (!persist()) {
      Object.assign(stop, before);
      if (oldIndex >= 0 && moveIndex !== oldIndex) {
        list.splice(moveIndex, 1);
        list.splice(oldIndex, 0, stop);
      }
      return;
    }
    $('editDialog').close();
    render();
    toast('배송 정보를 저장했습니다.');
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
    $('cameraButton').textContent = '▣ 카메라로 스캔';
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
        if (generation !== cameraGeneration || !$('scanDialog').open) {
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
        if (generation !== cameraGeneration || !$('scanDialog').open) return;
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
        if (generation === cameraGeneration) await enableContinuousFocus(video);
        if (generation !== cameraGeneration) { controls.stop(); return; }
        zxingControls = controls;
      }
      control.textContent = '카메라 끄기';
      $('scanResult').textContent = '카메라 준비 완료 · 바코드에 맞추면 자동으로 초점을 조절합니다(기기 지원 시).';
    } catch (error) {
      stopCamera();
      $('scanResult').textContent = '카메라 실행 실패: ' + (error.message || '권한과 브라우저 설정을 확인하세요.');
    } finally {
      control.disabled = false;
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

  function identityDialogMode(first = false) {
    const dialog = $('identityDialog');
    $('closeIdentity').classList.toggle('hidden', first);
    $('identityTitle').textContent = first ? '처음 시작하기' : '내 휴대폰 번호';
    $('saveIdentityButton').textContent = '기존 기기 자료만 보기 (스캔은 서버 로그인 필요)';
    $('identityError').textContent = '';
    $('identityError').classList.add('hidden');
    $('identityPhoneInput').value = identityPhone ? displayPhone(identityPhone) : '';
    $('identityPasswordInput').value = '';
    if (!dialog.open) dialog.showModal();
  }
  function openIdentityDialog(force = false) {
    identityDialogMode(force || !identityPhone);
  }
  function saveIdentity(event) {
    event.preventDefault();
    syncEpoch++;syncedDate='';syncPending=false;syncBlocked=false;
    const number = normalizePhone($('identityPhoneInput').value);
    const error = $('identityError');
    if (!isPhone(number)) {
      error.textContent = '올바른 휴대폰 번호를 입력해 주세요. 예: 010-1234-5678';
      error.classList.remove('hidden');
      return;
    }
    if (identityPhone && identityPhone !== number &&
        !confirm('다른 번호로 전환하면 이 기기에 저장된 해당 번호의 배송 목록이 열립니다. 기존 번호의 자료는 보존됩니다. 계속할까요?')) return;
    try {
      const previous = identityPhone;
      remoteAccount = false;
      driverToken = '';
      const destination = phoneStorageKey(number);
      // Preserve legacy data on first adoption without moving or deleting its key.
      // Never copy another user's records when switching to a different number.
      if (!localStorage.getItem(MIGRATION_KEY)) {
        if (!localStorage.getItem(destination)) {
          const original = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (original) {
            const parsed = JSON.parse(original);
            if (isData(parsed)) localStorage.setItem(destination, original);
          }
        }
        localStorage.setItem(MIGRATION_KEY, '1');
      }
      localStorage.setItem(IDENTITY_KEY, number);
      identityPhone = number;
      data = readData();
      date = today();
      if (previous && previous !== number) showView('home');
      $('identityDialog').close();
      render();
      toast('기존 기기 자료 · ' + displayPhone(number) + ' · 스캔은 서버 로그인 후 가능합니다.');
      $('identityPasswordInput').value = '';
    } catch (_) {
      error.textContent = '번호를 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.';
      error.classList.remove('hidden');
    }
  }

  async function apiAuthenticate(action) {
    const phone = normalizePhone($('identityPhoneInput').value);
    const password = $('identityPasswordInput').value;
    const error = $('identityError');
    error.classList.add('hidden');
    if (!isPhone(phone)) {
      error.textContent = '휴대폰 번호를 확인하세요.';
      error.classList.remove('hidden');
      return;
    }
    if (!password || password.length < 1 || password.length > 16) {
      error.textContent = '비밀번호는 1~16자로 입력하세요.';
      error.classList.remove('hidden');
      return;
    }
    const login = $('identityLoginButton');
    const register = $('identityRegisterButton');
    login.disabled = register.disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(
        action === 'login' ? DRIVER_API_BASE + 'ddsm/login' : AUTH_API_BASE + 'register', {
        method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (response.status === 404) {
        throw new Error(action === 'login'
          ? 'S10 로그인 API가 없습니다(404). 서버 admin.py를 업데이트하고 Waitress를 재시작하세요.'
          : '가입 API가 없습니다(404). S10 인증 라우트를 확인하세요.');
      }
      if (!response.ok || !result || result.ok !== true || result.phone !== phone) {
        throw new Error(result?.error || '인증 API 연결 또는 응답을 확인하세요.');
      }
      // DDSM courier tokens are in memory only, never browser storage.
      // Login is required; it does not synchronize local delivery stops.
      if (action === 'login' && typeof result.access_token !== 'string')
        throw new Error('배송기사 인증 토큰이 없습니다. S10의 API를 업데이트하세요.');
      const previous = identityPhone;
      if (previous && previous !== phone &&
          !confirm('다른 번호의 로컬 작업으로 전환합니다. 계속할까요?')) return;
      localStorage.setItem(IDENTITY_KEY, phone);
      identityPhone = phone;
      remoteAccount = action === 'login';
      driverToken = action === 'login' ? result.access_token : '';
      syncEpoch++;syncedDate='';syncPending=false;syncBlocked=false;
      data = readData();
      date = today();
      $('identityDialog').close();
      $('identityPasswordInput').value = '';
      if (previous !== phone) showView('home');
      render();
      if(action==='login') {
        const loaded=await activateDay(date);
        if(loaded && resumeScanAfterLogin) {
          resumeScanAfterLogin=false;requestAnimationFrame(openScan);
        }
      }
      toast(action === 'register'
        ? '가입 완료 · 로그인 후 운송장 스캔 가능'
        : '배송기사 로그인 완료 · 이제 스캔 시 S10 원본 조회');
    } catch (e) {
      error.textContent = e.name === 'AbortError'
        ? '서버 응답 시간이 초과되었습니다. API 상태를 확인하세요.'
        : e instanceof TypeError ? 'S10 API 연결 또는 CORS 오류입니다. API 주소와 Origin 허용 설정을 확인하세요.'
        : e.message || 'API 연결에 실패했습니다.';
      error.classList.remove('hidden');
    } finally {
      clearTimeout(timeout);
      login.disabled = register.disabled = false;
    }
  }

  function bind() {
    $('myPhoneButton').addEventListener('click', openIdentityDialog);
    $('identityForm').addEventListener('submit', event => {
      event.preventDefault();
      apiAuthenticate('login');
    });
    $('saveIdentityButton').addEventListener('click', saveIdentity);
    $('identityLoginButton').addEventListener('click', () => apiAuthenticate('login'));
    $('identityRegisterButton').addEventListener('click', () => apiAuthenticate('register'));
    $('closeIdentity').addEventListener('click', () => $('identityDialog').close());
    $('identityDialog').addEventListener('close', () => { resumeScanAfterLogin = false; });
    $('dateButton').addEventListener('click', chooseDate);
    $('dateInput').addEventListener('change', async e => {
      const value = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      if(syncPending || syncBusy || syncBlocked) {
        toast('서버 저장 완료 후 날짜를 변경하세요.');e.target.value=date;return;
      }
      date=value;render();
      if(driverToken) await activateDay(value);
    });
    $('roundSelect').addEventListener('change', e => {
      setSelectedRound(e.target.value);
    });
    $('newRoundButton').addEventListener('click', addRound);
    $('scanButton').addEventListener('click', openScan);
    $('workScanButton').addEventListener('click', openScan);
    $('deliveryButton').addEventListener('click', () => showView('delivery'));
    $('listButton').addEventListener('click', () => showView('delivery'));
    $('backButton').addEventListener('click', () => showView('home'));
    $('deliveryMapFitBtn').addEventListener('click', () => window.DDSM_DeliveryMap?.fit());
    $('deliveryRoundSelect').addEventListener('change', e => setSelectedRound(e.target.value));
    $('closeScan').addEventListener('click', () => $('scanDialog').close());
    $('scanDialog').addEventListener('close', () => {
      clearTimeout(scanFlashTimer);
      $('scanDialog').classList.remove('scan-read-flash');
      stopCamera();
      $('waybillInput').setAttribute('inputmode', 'none');
      $('scanDialog').style.removeProperty('--scan-viewport-height');
      $('scanDialog').style.removeProperty('--scan-viewport-top');
    });
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
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncScanViewport);
      window.visualViewport.addEventListener('scroll', syncScanViewport);
    }
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
      if (document.hidden && (cameraStream || zxingControls)) stopCamera();
    });
    window.addEventListener('storage', e => {
      if (e.key === activeStorageKey() && identityPhone) {
        if (!driverToken) { data=readData();render(); }
        else void refreshDay();
      } else if (e.key === IDENTITY_KEY && e.newValue !== identityPhone) {
        toast('다른 탭에서 사용자 번호가 변경되었습니다. 새로고침해 주세요.');
      }
    });
  }
  bind();
  setInterval(()=>{if(syncPending) void flushDay();else void refreshDay();},3000);
  render();
  if (!identityPhone) openIdentityDialog(true);
})();
