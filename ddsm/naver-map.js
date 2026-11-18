/* DDSM: NAVER Maps address preview. Public browser Client ID only; never use a Client Secret here. */
(function (root) {
  'use strict';

  const CLIENT_ID = 'wwowrt4n6u';
  const $ = id => document.getElementById(id);
  const searchUrl = address => 'https://map.naver.com/p/search/' + encodeURIComponent(address);
  const validPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

  let sdkPromise = null;
  let map = null;
  let timer = null;
  let requestId = 0;
  let active = false;
  let selectedAddress = '';
  let point = null;
  let movedByUser = false;

  function announce(message, isError = false) {
    const area = $('addressMapEmpty');
    if (!area) return;
    area.textContent = message;
    area.classList.remove('hidden');
    area.classList.toggle('map-error', isError);
  }
  function hideMap() {
    const stage = $('addressMapStage');
    if (stage) stage.classList.add('hidden');
    const coords = $('addressMapCoordinates');
    if (coords) coords.textContent = '';
  }
  function updateLink(address) {
    const link = $('addressMapLink');
    if (!link) return;
    if (!address) {
      link.removeAttribute('href');
      link.classList.add('hidden');
      return;
    }
    link.href = searchUrl(address);
    link.classList.remove('hidden');
  }
  function loadSdk() {
    if (root.naver && root.naver.maps && root.naver.maps.Service
        && typeof root.naver.maps.Service.geocode === 'function') {
      return Promise.resolve(root.naver.maps);
    }
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const callback = '__ddsmNaverMapReady';
      const script = document.createElement('script');
      let finished = false;
      let watchdog;
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        try { delete root[callback]; } catch (_) { root[callback] = undefined; }
        if (error) {
          script.remove();
          reject(error);
        } else if (!root.naver || !root.naver.maps || !root.naver.maps.Service
          || typeof root.naver.maps.Service.geocode !== 'function') {
          reject(new Error('주소 검색 기능(Geocoding)을 사용할 수 없습니다. 네이버 Cloud 설정을 확인하세요.'));
        } else {
          resolve(root.naver.maps);
        }
      }
      root[callback] = () => finish(null);
      script.async = true;
      script.src = 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId='
        + encodeURIComponent(CLIENT_ID) + '&submodules=geocoder&callback=' + callback;
      script.onerror = () => finish(new Error('네이버 지도 SDK를 불러오지 못했습니다. 등록된 웹 서비스 URL과 네트워크를 확인하세요.'));
      watchdog = setTimeout(() => finish(new Error('네이버 지도 연결 시간이 초과되었습니다.')), 15000);
      document.head.appendChild(script);
    }).catch(error => {
      sdkPromise = null;
      throw error;
    });
    return sdkPromise;
  }
  function mapCenter() {
    if (!map) return null;
    const center = map.getCenter();
    if (!center || typeof center.lat !== 'function' || typeof center.lng !== 'function') return null;
    const centerPoint = { lat: center.lat(), lng: center.lng() };
    return validPoint(centerPoint) ? centerPoint : null;
  }
  function updateCenterReadout() {
    if (!active || $('addressMapStage').classList.contains('hidden')) return;
    const center = mapCenter();
    if (!center) return;
    point = center;
    $('addressMapCoordinates').textContent =
      (movedByUser ? '중앙 위치 조정됨 · 저장하면 반영됩니다. ' : '중앙 마커에 위치를 맞춰주세요. ')
      + center.lat.toFixed(6) + ', ' + center.lng.toFixed(6);
  }
  function focusAt(next) {
    if (!validPoint(next)) return;
    point = { lat: next.lat, lng: next.lng };
    movedByUser = false;
    const n = root.naver.maps;
    const position = new n.LatLng(point.lat, point.lng);
    const stage = $('addressMapStage');
    stage.classList.remove('hidden');
    if (!map) {
      map = new n.Map($('addressMapCanvas'), {
        center: position,
        zoom: 17,
        zoomControl: true,
        zoomControlOptions: { position: n.Position.TOP_RIGHT },
        mapDataControl: false,
        scaleControl: false,
        logoControl: true
      });
      // The marker is a fixed overlay at 50%/50%. Only the underlying map moves.
      n.Event.addListener(map, 'dragstart', () => {
        if (!active) return;
        movedByUser = true;
      });
      n.Event.addListener(map, 'idle', updateCenterReadout);
      n.Event.addListener(map, 'zoom_changed', updateCenterReadout);
    } else {
      n.Event.trigger(map, 'resize');
      map.setCenter(position);
    }
    $('addressMapEmpty').classList.add('hidden');
    $('addressMapCoordinates').textContent =
      '중앙 마커에 위치를 맞춰주세요. ' + point.lat.toFixed(6) + ', ' + point.lng.toFixed(6);
    requestAnimationFrame(() => {
      if (!active || $('addressMapStage').classList.contains('hidden') || !map) return;
      n.Event.trigger(map, 'resize');
      map.setCenter(position);
      updateCenterReadout();
    });
  }
  function geocode(maps, address, id) {
    maps.Service.geocode({ query: address }, (status, response) => {
      if (!active || id !== requestId || selectedAddress !== address) return;
      if (status !== maps.Service.Status.OK) {
        hideMap();
        announce('네이버 주소 검색에 실패했습니다. Geocoding 사용 설정을 확인하거나 네이버 지도에서 검색하세요.', true);
        return;
      }
      const addresses = response && response.v2 && response.v2.addresses;
      const first = Array.isArray(addresses) ? addresses[0] : null;
      const lat = first && Number(first.y);
      const lng = first && Number(first.x);
      if (!first || !validPoint({ lat, lng })) {
        hideMap();
        announce('일치하는 주소를 찾지 못했습니다. 도로명과 건물번호를 확인하거나 네이버 지도에서 검색하세요.', true);
        return;
      }
      focusAt({ lat, lng });
    });
  }
  async function resolveAddress(address, storedPoint, id) {
    try {
      const n = await loadSdk();
      if (!active || id !== requestId || selectedAddress !== address) return;
      const dialog = $('editDialog');
      if (!dialog || !dialog.open) return;
      if (validPoint(storedPoint)) {
        focusAt(storedPoint);
        return;
      }
      geocode(n, address, id);
    } catch (error) {
      if (!active || id !== requestId) return;
      hideMap();
      announce(error.message || '네이버 지도를 표시하지 못했습니다.', true);
    }
  }
  function update(address, storedPoint = null) {
    const text = String(address || '').trim();
    selectedAddress = text;
    const id = ++requestId;
    clearTimeout(timer);
    point = null;
    movedByUser = false;
    hideMap();
    updateLink(text);
    if (!text || text.length < 4) {
      announce(text ? '주소를 조금 더 자세히 입력해 주세요.' : '주소를 입력하면 네이버 지도가 표시됩니다.');
      return;
    }
    announce('네이버 지도에서 주소를 찾는 중입니다.');
    timer = setTimeout(() => resolveAddress(text, storedPoint, id), validPoint(storedPoint) ? 0 : 650);
  }
  function open(address, storedPoint) {
    active = true;
    update(address, storedPoint);
  }
  function close() {
    active = false;
    ++requestId;
    clearTimeout(timer);
    point = null;
    selectedAddress = '';
    hideMap();
  }
  function selection(address) {
    if (!active || selectedAddress !== String(address || '').trim()
        || $('addressMapStage').classList.contains('hidden')) return null;
    // Read the live viewport center: no touch/click precision loss and no idle-event race.
    const center = mapCenter();
    return center || (validPoint(point) ? { lat: point.lat, lng: point.lng } : null);
  }

  root.DDSM_NaverMap = Object.freeze({ open, update, close, selection, loadSdk });
})(window);
