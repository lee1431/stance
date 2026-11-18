/* DDSM v1 — standalone, login-free daily scan and delivery workflow.
   No calls to the DSD authenticated API. Browser-local data only. */
(function () {
  'use strict';

  const STORAGE_KEY = 'ddsm:data:v1';
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
      const raw = localStorage.getItem(STORAGE_KEY);
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
    catch (_) { toast('저장할 수 없습니다. 브라우저 저장 공간을 확인하세요.'); return false; }
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
    $('scanHint').textContent = '현재 회차 배송지 ' + c.total + '건';
    $('deliveryButton').disabled = c.pending === 0;
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
      detail.append(node('span', '', '운송장 ' + stop.waybill + (stop.memo ? ' · 메모 있음' : '')));
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
  function addWaybill(raw) {
    const waybill = clean(raw, 100).replace(/\s+/g, '');
    if (!waybill) return { error: '운송장번호를 입력하세요.' };
    if (waybill.length < 4 || /[\u0000-\u001f<>]/.test(waybill)) return { error: '운송장번호를 확인하세요.' };
    if (stops().some(stop => stop.waybill === waybill)) return { error: '이미 등록된 운송장입니다: ' + waybill };
    const stop = { id: makeId(), waybill, recipient: '', address: '', phone: '', memo: '', status: 'pending', createdAt: new Date().toISOString() };
    stops().push(stop);
    if (!persist()) { stops().pop(); return { error: '저장하지 못했습니다. 저장 공간을 확인하세요.' }; }
    render();
    if (navigator.vibrate) navigator.vibrate(45);
    return { stop };
  }

  function syncScanViewport() {
    const dialog = $('scanDialog');
    if (!dialog.open) return;
    const viewport = window.visualViewport;
    dialog.style.setProperty('--scan-viewport-height', (viewport ? viewport.height : window.innerHeight) + 'px');
    dialog.style.setProperty('--scan-viewport-top', (viewport ? viewport.offsetTop : 0) + 'px');
  }
  function openScan() {
    const dialog = $('scanDialog');
    const input = $('waybillInput');
    $('scanResult').textContent = '현재 날짜와 ' + round().no + '회차에 등록합니다.';
    input.value = '';
    // Handheld barcode readers act like physical keyboards. Keep input focused
    // but suppress the soft keyboard until the user explicitly taps to type.
    input.setAttribute('inputmode', 'none');
    if (!dialog.open) dialog.showModal();
    syncScanViewport();
    input.focus({ preventScroll: true });
  }
  function processScan(raw, camera = false) {
    const result = addWaybill(raw);
    const message = result.error || ('등록 완료 · ' + result.stop.waybill + ' (' + stops().length + '건)');
    $('scanResult').textContent = message;
    if (result.error && !camera) toast(message);
    if (!camera) {
      $('waybillInput').value = '';
      $('waybillInput').focus({ preventScroll: true });
    }
    return !result.error;
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (generation !== cameraGeneration || !$('scanDialog').open) {
          stream.getTracks().forEach(track => track.stop()); return;
        }
        cameraStream = stream;
        video.srcObject = stream;
        video.classList.remove('hidden');
        await video.play();
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
        const controls = await reader.decodeFromVideoDevice(undefined, video, result => {
          if (generation === cameraGeneration && result) cameraDetected(result.getText());
        });
        if (generation !== cameraGeneration) { controls.stop(); return; }
        zxingControls = controls;
      }
      control.textContent = '카메라 끄기';
      $('scanResult').textContent = '바코드에 카메라를 맞춰주세요.';
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
    $('dateButton').addEventListener('click', chooseDate);
    $('dateInput').addEventListener('change', e => {
      const value = e.target.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
      date = value;
      render();
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
      if (e.key === STORAGE_KEY) { data = readData(); render(); toast('다른 탭에서 변경된 배송 목록을 반영했습니다.'); }
    });
  }
  bind();
  render();
})();
