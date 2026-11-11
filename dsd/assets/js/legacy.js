/* Read-only adapter for legacy /dsd/ localStorage. Never removes old records. */
(function (root) {
  'use strict';
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }
  const today = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  };
  function collect() {
    const registry = read('dsd:centers:v1');
    const centers = registry && Array.isArray(registry.centers) ? registry.centers : [];
    const data = [];
    for (const center of centers) {
      const routes = Array.isArray(center.routes) ? center.routes : [];
      for (let index = 0; index < routes.length; index++) {
        const route = routes[index];
        const id = route.id;
        const prefix = 'dsd:center:' + center.id;
        const list = read(prefix + ':round:' + id + ':stops') || read(prefix + ':stops') || [];
        const ordered = read(prefix + ':route:' + id) || {};
        const ids = Array.isArray(ordered.ids) ? ordered.ids : [];
        const raw = Array.isArray(list) ? list : [];
        const byId = new Map(raw.map(s => [String(s.id), s]));
        const orderedStops = ids.map(x => byId.get(String(x))).filter(Boolean);
        for (const s of raw) if (!ids.map(String).includes(String(s.id))) orderedStops.push(s);
        const stops = orderedStops.map(s => {
          const lat = Number(s.lat ?? s.latitude);
          const lng = Number(s.lng ?? s.longitude);
          return {
            company: String(s.company ?? s.name ?? '').slice(0,100),
            address: String(s.address ?? '').slice(0,300),
            waybill: String(s.waybill ?? '').slice(0,120),
            quantity: Number(s.quantity) || 1,
            lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
            lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
            parking_lat: Number.isFinite(Number(s.parking?.lat)) ? Number(s.parking.lat) : null,
            parking_lng: Number.isFinite(Number(s.parking?.lng)) ? Number(s.parking.lng) : null,
            memo: String(s.accessNote ?? s.memo ?? '').slice(0,300),
            approach_hint: String(s.approachHint ?? '').slice(0,120),
            pinned_last: (ordered.pinnedLastIds || []).map(String).includes(String(s.id))
          };
        });
        // Ignore fully empty placeholder rounds. Cannot reconstruct deleted local records.
        if (!stops.length) continue;
        data.push({ date: /^\d{4}-\d{2}-\d{2}$/.test(route.date_key || '') ? route.date_key : today(),
                    round_no: Number(route.round_no) || index + 1,
                    center_name: String(center.name || ''), stops });
      }
    }
    return data;
  }
  root.DSDLegacy = Object.freeze({ collect });
})(window);