/* DDSM daily all-round NAVER overview. Reuses the existing public map SDK client ID. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const valid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
  const key = s => String(s.roundNo) + ':' + String(s.id);
  let map = null, maps = null, currentDate = '', markers = new Map();
  let selectedSignature = '', initialFitDone = false, userInteracted = false, active = false, loadPromise = null;
  let onSelect = null, onGeocoded = null, geocodeGeneration = 0;
  let failed = new Set();
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
    if (!map || !maps) return;
    const validMarkers = [...markers.values()];
    if (!validMarkers.length) return;
    if (validMarkers.length === 1) {
      map.setCenter(validMarkers[0].getPosition());
      map.setZoom(16);
      return;
    }
    const bounds = new maps.LatLngBounds();
    validMarkers.forEach(marker => bounds.extend(marker.getPosition()));
    map.fitBounds(bounds, { top: 74, bottom: 65, left: 65, right: 65 });
  }
  function fit() {
    if (!active) return;
    if (!map) return;
    maps.Event.trigger(map, 'resize');
    boundsAll();
  }
  function draw(stops) {
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
          if (active && typeof onSelect === 'function') onSelect(s.id, s.roundNo);
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
    $('deliveryMapCount').textContent = '지도 표시 ' + markers.size + '곳 / 전체 ' + stops.length + '건'
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
    if (markers.size && !userInteracted) {
      initialFitDone = true;
      requestAnimationFrame(fit);
    }
  }
  function createMap() {
    if (map) return;
    const n = maps;
    map = new n.Map($('deliveryMapCanvas'), {
      center: new n.LatLng(36.991, 127.925),
      zoom: 12,
      zoomControl: true,
      zoomControlOptions: { position: n.Position.TOP_RIGHT },
      mapDataControl: false, scaleControl: false, logoControl: true
    });
    n.Event.addListener(map, 'dragstart', () => { userInteracted = true; });
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
  async function render(date, stops, callbacks) {
    active = true;
    onSelect = callbacks.onSelect;
    onGeocoded = callbacks.onGeocoded;
    if (currentDate !== date) {
      currentDate = date;
      initialFitDone = false;
      userInteracted = false;
      ++geocodeGeneration;
      requestQueue = [];
      failed = new Set();
      for (const marker of markers.values()) marker.setMap(null);
      markers.clear();
    }
    $('deliveryMapCount').textContent = '오늘 전체 ' + stops.length + '건 · 모든 회차';
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
    const signature = date + '|' + stops.map(s => [
      s.roundNo, s.id, s.position, s.status, s.lat, s.lng, s.address, s.recipient
    ].join(':')).join('|');
    if (signature === selectedSignature && map) {
      maps.Event.trigger(map, 'resize');
      return;
    }
    selectedSignature = signature;
    status('오늘 배송지 지도를 준비하고 있습니다.');
    try { await loadPromise; } catch (_) { return; }
    if (!active || currentDate !== date || signature !== selectedSignature) return;
    maps.Event.trigger(map, 'resize');
    draw(stops);
    queueGeocodes(stops, date);
  }
  function pause() {
    active = false;
    ++geocodeGeneration;
    requestQueue = [];
    initialFitDone = false;
    userInteracted = false;
    selectedSignature = '';
  }
  root.DDSM_DeliveryMap = Object.freeze({ render, pause, fit });
})(window);
