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
  let marker = null;
  let timer = null;
  let requestId = 0;
  let active = false;
  let selectedAddress = '';
  let point = null;

  function announce(message, isError = false) {
    const area = $('addressMapEmpty');
    if (!area) return;
    area.textContent = message;
    area.classList.remove('hidden');
    area.classList.toggle('map-error', isError);
  }
  function hideMap() {
    const canvas = $('addressMapCanvas');
    if (canvas) canvas.classList.add('hidden');
    const coords = $('addressMapCoordinates');
    if (coords) coords.textContent = '';
    if (marker) marker.setMap(null);
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
  function setPoint(next, adjusted = false) {
    if (!validPoint(next)) return;
    point = { lat: next.lat, lng: next.lng };
    const n = root.naver.maps;
    const position = new n.LatLng(point.lat, point.lng);
    const container = $('addressMapCanvas');
    container.classList.remove('hidden');
    if (!map) {
      map = new n.Map(container, {
        center: position,
        zoom: 16,
        zoomControl: true,
        zoomControlOptions: { position: n.Position.TOP_RIGHT },
        mapDataControl: false,
        scaleControl: false,
        logoControl: true
      });
      n.Event.addListener(map, 'click', event => {
        if (!active || !event || !event.coord) return;
        setPoint({ lat: event.coord.lat(), lng: event.coord.lng() }, true);
      });
    } else {
      n.Event.trigger(map, 'resize');
      map.setCenter(position);
    }
    if (!marker) {
      marker = new n.Marker({
        map,
        position,
        draggable: true,
        title: '배송 위치 · 드래그해서 조정'
      });
      n.Event.addListener(marker, 'dragend', () => {
        if (!active) return;
        const moved = marker.getPosition();
        setPoint({ lat: moved.lat(), lng: moved.lng() }, true);
      });
    } else {
      marker.setMap(map);
      marker.setPosition(position);
    }
    $('addressMapEmpty').classList.add('hidden');
    $('addressMapCoordinates').textContent =
      (adjusted ? '위치 조정됨 · 저장하면 반영됩니다. ' : '마커를 이동해 위치를 조정할 수 있습니다. ')
      + point.lat.toFixed(6) + ', ' + point.lng.toFixed(6);
    requestAnimationFrame(() => {
      if (active && map) n.Event.trigger(map, 'resize');
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
      setPoint({ lat, lng });
    });
  }
  async function resolveAddress(address, storedPoint, id) {
    try {
      const n = await loadSdk();
      if (!active || id !== requestId || selectedAddress !== address) return;
      const dialog = $('editDialog');
      if (!dialog || !dialog.open) return;
      if (validPoint(storedPoint)) {
        setPoint(storedPoint);
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
    return active && selectedAddress === String(address || '').trim() && validPoint(point)
      ? { lat: point.lat, lng: point.lng } : null;
  }

  root.DDSM_NaverMap = Object.freeze({ open, update, close, selection });
})(window);
