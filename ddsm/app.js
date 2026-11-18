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
  let addressMapTimer = null;
  const mapSearchUrl = address => 'https://map.naver.com/p/search/' + encodeURIComponent(address);
  // A query-based Google Maps embed avoids storing or exposing an API key.
  // Search results are approximate; the Naver Maps link is provided for verification.
  const mapEmbedUrl = address => 'https://maps.google.com/maps?q=' + encodeURIComponent(address) + '&output=embed';
  function updateAddressMap() {
    const address = clean($('addressInput').value, 250);
    const frame = $('addressMapFrame');
    const empty = $('addressMapEmpty');
    const link = $('addressMapLink');
    clearTimeout(addressMapTimer);
    if (!address || address.length < 4) {
      frame.classList.add('hidden');
      frame.removeAttribute('src');
      link.classList.add('hidden');
      link.removeAttribute('href');
      empty.classList.remove('hidden');
      empty.textContent = address ? '주소를 조금 더 자세히 입력해 주세요.' : '주소를 입력하면 여기에 지도가 표시됩니다.';
      return;
    }
    empty.classList.remove('hidden');
    empty.textContent = '입력한 주소의 지도를 불러오는 중입니다.';
    link.href = mapSearchUrl(address);
    link.classList.remove('hidden');
    addressMapTimer = setTimeout(() => {
      const current = clean($('addressInput').value, 250);
      if (current !== address || !$('editDialog').open) return;
      frame.src = mapEmbedUrl(address);
      frame.classList.remove('hidden');
      empty.classList.add('hidden');
    }, 700);
  }
  function closeAddressMap() {
    clearTimeout(addressMapTimer);
    const frame = $('addressMapFrame');
    frame.classList.add('hidden');
    frame.removeAttribute('src');
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
  function renderDelivery() {
    const c = counts();
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
    if (view === 'delivery') renderDelivery();
  }
  function showView(next) {
    view = next;
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

  function openScan() {
    const dialog = $('scanDialog');
    $('scanResult').textContent = '현재 날짜와 ' + round().no + '회차에 등록합니다.';
    $('waybillInput').value = '';
    if (!dialog.open) dialog.showModal();
    $('waybillInput').focus({ preventScroll: true });
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
    $('editWaybill').textContent = '운송장 ' + stop.waybill;
    $('recipientInput').value = stop.recipient;
    $('addressInput').value = stop.address;
    $('phoneInput').value = stop.phone;
    $('memoInput').value = stop.memo;
    $('editDialog').showModal();
    updateAddressMap();
  }
  function saveEdit(event) {
    event.preventDefault();
    const stop = stops().find(x => x.id === editingId);
    if (!stop) return;
    const before = { recipient: stop.recipient, address: stop.address, phone: stop.phone, memo: stop.memo };
    stop.recipient = clean($('recipientInput').value, 100);
    stop.address = clean($('addressInput').value, 250);
    stop.phone = clean($('phoneInput').value, 25);
    stop.memo = clean($('memoInput').value, 500);
    if (!persist()) { Object.assign(stop, before); return; }
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
          return { id: makeId(), waybill, recipient: clean(s.recipient,100), address: clean(s.address,250), phone: clean(s.phone,25), memo: clean(s.memo,500), status: s.status === 'done' ? 'done' : 'pending', createdAt: clean(s.createdAt,80) };
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
      const d = day();
      const next = Number(e.target.value);
      if (!d.rounds.some(r => r.no === next)) return;
      const old = d.selected;
      d.selected = next;
      if (!persist()) { d.selected = old; return; }
      render();
    });
    $('newRoundButton').addEventListener('click', addRound);
    $('scanButton').addEventListener('click', openScan);
    $('workScanButton').addEventListener('click', openScan);
    $('deliveryButton').addEventListener('click', () => showView('delivery'));
    $('listButton').addEventListener('click', () => showView('delivery'));
    $('backButton').addEventListener('click', () => showView('home'));
    $('closeScan').addEventListener('click', () => $('scanDialog').close());
    $('scanDialog').addEventListener('close', stopCamera);
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
