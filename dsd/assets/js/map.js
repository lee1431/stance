/* NAVER map adapter. Map location is independent of routing and GPS. */
(function (root) {
  'use strict';
  const mapClass = class DSDMap {
    constructor() {
      this.map = null;
      this.markers = new Map();
      this.inspectMarker = null;
      this.gpsMarker = null;
      this.pathLine = null;
      this.targetLine = null;
      this.pendingTargetOverview = false;
      this.targetOverviewUntil = 0;
      this.current = null;
      this.target = null;
      this.stops = [];
      this.editing = false;
      this.adding = false;
      this.tracking = false;
      this.pausedUntil = 0;
      this.lastGps = null;
      this.lastTier = -1;
      this.lastProgrammatic = 0;
      this.watchId = null;
      this.onSelect = null;
      this.onDraft = null;
      this.onInspect = null;
      this.onCenterIdle = null;
      this.onPanStart = null;
      this.onGPS = null;
    }
    load(clientId) {
      return new Promise((resolve, reject) => {
        if (root.naver && root.naver.maps && root.naver.maps.Service) { this.init(); resolve(); return; }
        const callback = '__dsdMapReady_' + Math.round(Math.random() * 1e9);
        let timer;
        const finish = (error) => {
          clearTimeout(timer); delete root[callback];
          if (error) { script.remove(); reject(error); }
          else { try { this.init(); resolve(); } catch (e) { reject(e); } }
        };
        root[callback] = () => finish(null);
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=' + encodeURIComponent(clientId)
          + '&submodules=geocoder&callback=' + callback;
        script.onerror = () => finish(Error('네이버 지도 SDK를 불러오지 못했습니다.'));
        timer = setTimeout(() => finish(Error('지도 연결 시간이 초과되었습니다.')), 18000);
        document.head.append(script);
      });
    }
    init() {
      const n = root.naver.maps;
      this.map = new n.Map('map', {
        center: new n.LatLng(36.991, 127.925), zoom: 12,
        zoomControl: false, mapDataControl: false, scaleControl: false, logoControl: true
      });
      const inspectPoint = event => {
        if (!event || !event.coord || !this.onInspect) return;
        this.onInspect({ lat: event.coord.lat(), lng: event.coord.lng() });
      };
      // NAVER Maps supports longtap (a one-finger press of 1s or longer).
      n.Event.addListener(this.map, 'longtap', inspectPoint);
      // Desktop alternative for a mouse or trackpad.
      n.Event.addListener(this.map, 'rightclick', inspectPoint);
      n.Event.addListener(this.map, 'dragstart', () => {
        if (this.tracking) this.pausedUntil = Infinity;
        if (this.onPanStart) this.onPanStart();
      });
      n.Event.addListener(this.map, 'idle', () => {
        if (this.onCenterIdle) this.onCenterIdle(this.getDraftPosition());
      });
      n.Event.addListener(this.map, 'zoom_changed', () => {
        if (this.tracking && Date.now() - this.lastProgrammatic > 700) this.pausedUntil = Date.now() + 30000;
      });
    }
    isAvailable() { return !!this.map; }
    draw(stops, targetId, road) {
      if (!this.map) return;
      this.stops = stops;
      this.target = targetId;
      const n = root.naver.maps;
      for (const marker of this.markers.values()) marker.setMap(null);
      this.markers.clear();
      for (const stop of stops) {
        const lat = stop.parking_lat == null ? stop.lat : stop.parking_lat;
        const lng = stop.parking_lng == null ? stop.lng : stop.parking_lng;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const cls = stop.status === 'done' ? 'done' : stop.id === targetId ? 'active' : '';
        const marker = new n.Marker({
          position: new n.LatLng(lat, lng), map: this.map, draggable: false,
          zIndex: stop.id === targetId ? 200 : 100 - Math.min(stop.position, 90),
          title: (stop.company || '배송지') + ' · ' + stop.position + '번',
          icon: { content: '<div class="stop-pin ' + cls + '"><span>' + Number(stop.position) + '</span></div>',
                  size: new n.Size(34, 34), anchor: new n.Point(17, 25) }
        });
        n.Event.addListener(marker, 'click', () => { if (this.onSelect) this.onSelect(stop.id); });
        this.markers.set(stop.id, marker);
      }
      if (this.pathLine) { this.pathLine.setMap(null); this.pathLine = null; }
      if (road && Array.isArray(road.path) && road.path.length >= 2) {
        this.pathLine = new n.Polyline({
          map: this.map, path: road.path.map(p => new n.LatLng(p.lat, p.lng)),
          strokeColor: '#246fe9', strokeOpacity: .87, strokeWeight: 5,
          strokeLineCap: 'round', strokeLineJoin: 'round'
        });
      }
      this.updateTargetLine();
    }
    // GPS-to-active-stop connector only: this is NOT a routed driving path.
    updateTargetLine() {
      const stop = this.stops.find(s => s.id === this.target);
      const lat = stop && (stop.parking_lat == null ? stop.lat : stop.parking_lat);
      const lng = stop && (stop.parking_lng == null ? stop.lng : stop.parking_lng);
      if (!this.map || !this.tracking || !this.lastGps || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (this.targetLine) this.targetLine.setMap(null);
        this.targetLine = null;
        return;
      }
      const n = root.naver.maps;
      const points = [
        new n.LatLng(this.lastGps.lat, this.lastGps.lng),
        new n.LatLng(lat, lng)
      ];
      if (this.targetLine) {
        this.targetLine.setPath(points);
      } else {
        this.targetLine = new n.Polyline({
          map: this.map, path: points,
          strokeColor: '#df692a', strokeOpacity: 0.95,
          strokeWeight: 4, strokeStyle: 'shortdash',
          clickable: false, zIndex: 12
        });
      }
    }
    showTargetOverview() {
      this.pendingTargetOverview = true;
      this.targetOverviewUntil = Date.now() + 8000;
      this.tryTargetOverview();
    }
    tryTargetOverview() {
      if (!this.pendingTargetOverview || !this.map || !this.lastGps) return false;
      const stop = this.stops.find(s => s.id === this.target);
      const lat = stop && (stop.parking_lat == null ? stop.lat : stop.parking_lat);
      const lng = stop && (stop.parking_lng == null ? stop.lng : stop.parking_lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const n = root.naver.maps;
      const bounds = new n.LatLngBounds();
      bounds.extend(new n.LatLng(this.lastGps.lat, this.lastGps.lng));
      bounds.extend(new n.LatLng(lat, lng));
      this.lastProgrammatic = Date.now();
      this.map.fitBounds(bounds, {top: 140, bottom: 130, left: 60, right: 80});
      this.pendingTargetOverview = false;
      return true;
    }
    setEdit(flag) {
      this.editing = !!flag;
      if (this.editing && this.tracking) this.pausedUntil = Infinity;
    }
    getDraftPosition() {
      if (!this.map) return null;
      const center = this.map.getCenter();
      return center ? { lat: center.lat(), lng: center.lng() } : null;
    }
    setAdd(flag) { this.adding = !!flag; }
    showInspectMarker(coords) {
      if (!this.map || !coords) return;
      const n = root.naver.maps;
      const point = new n.LatLng(coords.lat, coords.lng);
      if (this.inspectMarker) { this.inspectMarker.setPosition(point); return; }
      this.inspectMarker = new n.Marker({
        map: this.map, position: point, clickable: false, zIndex: 950,
        title: '길게 누른 지도 위치',
        icon: { content: '<div class="inspect-pin">●</div>',
          size: new n.Size(26, 34), anchor: new n.Point(13, 32) }
      });
    }
    clearInspectMarker() {
      if (this.inspectMarker) this.inspectMarker.setMap(null);
      this.inspectMarker = null;
    }
    centerOn(stop, zoom = 16) {
      if (!this.map || !stop) return;
      const lat = stop.parking_lat == null ? stop.lat : stop.parking_lat;
      const lng = stop.parking_lng == null ? stop.lng : stop.parking_lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      this.lastProgrammatic = Date.now();
      this.map.setCenter(new root.naver.maps.LatLng(lat, lng));
      this.map.setZoom(zoom);
    }
    fit() {
      if (!this.map) return;
      const coords = this.stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      if (!coords.length) { if (this.lastGps) this.map.setCenter(new root.naver.maps.LatLng(this.lastGps.lat, this.lastGps.lng)); return; }
      if (coords.length === 1) { this.centerOn(coords[0], 15); return; }
      const bounds = new root.naver.maps.LatLngBounds();
      coords.forEach(s => bounds.extend(new root.naver.maps.LatLng(s.lat, s.lng)));
      this.lastProgrammatic = Date.now();
      this.map.fitBounds(bounds, { top: 90, bottom: 120, left: 45, right: 65 });
    }
    searchAddresses(query, count = 5) {
      return new Promise((resolve, reject) => {
        const service = root.naver && root.naver.maps && root.naver.maps.Service;
        if (!this.map || !service || typeof service.geocode !== 'function') {
          reject(Error('네이버 지도 주소 검색이 연결되지 않았습니다.'));
          return;
        }
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; reject(Error('주소 검색 응답 시간이 초과되었습니다.')); }
        }, 10000);
        try {
          service.geocode({ query, count }, (status, response) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (status !== service.Status.OK) {
              reject(Error('주소 검색 API가 응답하지 않습니다. 네이버 지도 서비스 권한을 확인하세요.'));
              return;
            }
            const addresses = response && response.v2 && response.v2.addresses || [];
            resolve(addresses.map(item => ({
              lat: Number(item.y), lng: Number(item.x),
              road: String(item.roadAddress || '').trim(),
              jibun: String(item.jibunAddress || '').trim()
            })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng)));
          });
        } catch (error) {
          if (!settled) { settled = true; clearTimeout(timer); reject(error); }
        }
      });
    }
    async geocode(address) {
      const results = await this.searchAddresses(address, 1);
      if (!results.length) throw Error('검색되는 주소가 없습니다. 지도에서 직접 위치를 지정하세요.');
      return { lat: results[0].lat, lng: results[0].lng };
    }
    reverseGeocode(coords) {
      return new Promise((resolve, reject) => {
        const n = root.naver && root.naver.maps;
        if (!n || !n.Service || typeof n.Service.reverseGeocode !== 'function') {
          reject(Error('네이버 지도 역지오코딩 서비스를 사용할 수 없습니다.'));
          return;
        }
        if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
          reject(Error('유효하지 않은 좌표입니다.'));
          return;
        }
        let settled = false;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error); else resolve(result);
        };
        const timer = setTimeout(() => finish(Error('주소 조회 시간이 초과되었습니다.')), 10000);
        try {
          n.Service.reverseGeocode({
            coords: new n.LatLng(coords.lat, coords.lng),
            orders: 'roadaddr,addr'
          }, (status, response) => {
            if (status !== n.Service.Status.OK) {
              finish(Error('네이버 주소 조회에 실패했습니다. API 권한을 확인하세요.'));
              return;
            }
            const found = response && response.v2 && response.v2.address;
            const road = found && typeof found.roadAddress === 'string' ? found.roadAddress.trim() : '';
            const jibun = found && typeof found.jibunAddress === 'string' ? found.jibunAddress.trim() : '';
            finish(null, { road, jibun });
          });
        } catch (error) { finish(error); }
      });
    }
    gpsToggle() {
      if (this.tracking) {
        this.tracking = false;
        if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null; this.lastTier = -1;
        this.pendingTargetOverview = false;
        this.targetOverviewUntil = 0;
        this.updateTargetLine();
        if (this.onGPS) this.onGPS({ tracking: false });
        return;
      }
      if (!navigator.geolocation) throw Error('이 기기에서는 GPS를 사용할 수 없습니다.');
      this.tracking = true; this.pausedUntil = 0;
      this.watchId = navigator.geolocation.watchPosition(
        pos => this.updateGPS(pos),
        err => {
          this.gpsToggle();
          if (this.onGPS) this.onGPS({ tracking: false, error: err.message || 'GPS 권한 확인 필요' });
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
      if (this.onGPS) this.onGPS({ tracking: true });
    }
    updateGPS(pos) {
      this.lastGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      if (this.map) {
        const n = root.naver.maps;
        if (!this.gpsMarker) this.gpsMarker = new n.Marker({
          map: this.map, position: new n.LatLng(this.lastGps.lat, this.lastGps.lng),
          icon: { content: '<div class="gps-pin"></div>', anchor: new n.Point(10, 10) }, zIndex: 500
        });
        else this.gpsMarker.setPosition(new n.LatLng(this.lastGps.lat, this.lastGps.lng));
        this.updateTargetLine();
        if (!this.tryTargetOverview()) this.follow();
      }
      if (this.onGPS) this.onGPS({ tracking: true, gps: this.lastGps });
    }
    follow() {
      if (!this.map || !this.tracking || !this.lastGps ||
          Date.now() < this.pausedUntil || Date.now() < this.targetOverviewUntil) return;
      const stop = this.stops.find(s => s.id === this.target);
      const lat = stop ? (stop.parking_lat == null ? stop.lat : stop.parking_lat) : null;
      const lng = stop ? (stop.parking_lng == null ? stop.lng : stop.parking_lng) : null;
      const distance = Number.isFinite(lat) && Number.isFinite(lng) ? mapClass.distance(this.lastGps, { lat, lng }) : null;
      let tier = distance === null ? 0 : distance <= 50 ? 3 : distance <= 200 ? 2 : distance <= 500 ? 1 : 0;
      const boundaries = [0, 500, 200, 50];
      if (this.lastTier !== -1 && tier !== this.lastTier && distance !== null) {
        const threshold = boundaries[Math.max(tier, this.lastTier)];
        if (threshold > 0 && Math.abs(distance - threshold) < threshold * .15) tier = this.lastTier;
      }
      const zoom = [14, 16, 17, 19][tier];
      this.lastProgrammatic = Date.now();
      if (tier !== this.lastTier) { this.map.setZoom(zoom); this.lastTier = tier; }
      const center = distance !== null && distance < 900 ?
        new root.naver.maps.LatLng((this.lastGps.lat + lat) / 2, (this.lastGps.lng + lng) / 2) :
        new root.naver.maps.LatLng(this.lastGps.lat, this.lastGps.lng);
      this.map.setCenter(center);
    }
    resumeFollow() {
      this.pausedUntil = 0;
      this.pendingTargetOverview = false;
      this.targetOverviewUntil = 0;
      this.follow();
    }
    resize() { if (this.map) { root.naver.maps.Event.trigger(this.map, 'resize'); } }
    static distance(a, b) {
      const toR = Math.PI / 180;
      const dLat = (b.lat - a.lat) * toR, dLon = (b.lng - a.lng) * toR;
      const v = Math.sin(dLat/2)**2 + Math.cos(a.lat*toR)*Math.cos(b.lat*toR)*Math.sin(dLon/2)**2;
      return Math.round(12742000 * Math.asin(Math.min(1,Math.sqrt(v))));
    }
  };
  root.DSDMap = mapClass;
})(window);