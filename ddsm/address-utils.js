/* DDSM Korean address interpretation. Preserve originals; derive map-only candidates. */
(function (root) {
  'use strict';
  const ROAD = /([가-힣0-9·._-]+(?:대로|로|길))\s*(\d{1,5}(?:-\d{1,5})?)(?=$|[\s,，()])/g;
  const LOT = /([가-힣][가-힣0-9·._-]*(?:동|읍|면|리|가))\s*(산\s*)?(\d{1,5}(?:-\d{1,5})?)(?=$|[\s,，()])/g;
  const REGION = /^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|[가-힣0-9]+(?:도|시|군|구|읍|면))$/;
  const trim = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  function occurrences(value, pattern, type) {
    const matches = [];
    for (const m of value.matchAll(pattern)) {
      matches.push({
        type, name: m[1], number: m[type === 'lot' ? 3 : 2],
        mountain: type === 'lot' && !!m[2],
        index: m.index, end: m.index + m[0].length
      });
    }
    return matches;
  }
  function prefix(value, index) {
    const words = trim(value.slice(0, index)).replace(/[，,()]/g, ' ').split(/\s+/);
    const regions = [];
    for (const word of words) {
      if (!REGION.test(word)) break;
      regions.push(word);
    }
    return regions.join(' ');
  }
  function analyze(input) {
    const values = [...new Set((Array.isArray(input) ? input : [input]).map(trim).filter(Boolean))];
    const roads = [], lots = [];
    const roadKeys = new Set(), lotKeys = new Set();
    for (const value of values) {
      for (const item of occurrences(value, ROAD, 'road')) {
        const key = item.name + ' ' + item.number;
        if (roadKeys.has(key)) continue;
        roadKeys.add(key);
        roads.push({ ...item, region: prefix(value, item.index), key });
      }
      for (const item of occurrences(value, LOT, 'lot')) {
        const key = item.name + ' ' + (item.mountain ? '산 ' : '') + item.number;
        if (lotKeys.has(key)) continue;
        lotKeys.add(key);
        lots.push({ ...item, region: prefix(value, item.index), key });
      }
    }
    const ambiguous = roads.length > 1 || lots.length > 1;
    const type = roads.length && lots.length ? 'mixed' : roads.length ? 'road' : lots.length ? 'lot' : 'unknown';
    const label = ambiguous ? '주소 충돌 · 확인 필요' :
      ({mixed:'도로명+지번 혼합', road:'도로명주소', lot:'지번주소', unknown:'주소 판별 필요'})[type];
    const queries = [];
    for (const item of [...roads, ...lots]) {
      const query = trim([item.region, item.key].filter(Boolean).join(' '));
      if (!queries.includes(query)) queries.push(query);
    }
    // Unknown formats are suitable for manual search only, never automatic mapping.
    if (!queries.length) queries.push(...values.map(v=>v.split(/[，,]/)[0].trim()).filter(v=>v.length>=4));
    const regions = [...new Set([...roads, ...lots].map(x=>x.region).filter(Boolean))];
    const regionTokens = regions.flatMap(x=>x.split(/\s+/)).filter(x=>/(?:시|군|구|읍|면)$/.test(x));
    // Require enough locality to prevent matching the wrong city on ambiguous street names.
    const hasRegion = regionTokens.length > 0;
    return {
      type, label, ambiguous, roads, lots, queries: [...new Set(queries)].slice(0, 5),
      regionTokens: [...new Set(regionTokens)], hasRegion, original: values[0] || ''
    };
  }
  function matches(plan, result) {
    if (!result || plan.ambiguous || plan.type === 'unknown' || !plan.hasRegion) return false;
    const roadAddress = trim(result.roadAddress);
    const lotAddress = trim(result.jibunAddress);
    const resolved = trim(roadAddress + ' ' + lotAddress);
    if (!plan.regionTokens.some(token => resolved.includes(token))) return false;
    const resolvedRoads = occurrences(roadAddress, ROAD, 'road');
    const resolvedLots = occurrences(lotAddress, LOT, 'lot');
    const roadOk = !plan.roads.length || plan.roads.every(
      wanted => resolvedRoads.some(actual => wanted.name === actual.name && wanted.number === actual.number)
    );
    const lotOk = !plan.lots.length || plan.lots.every(
      wanted => resolvedLots.some(actual => wanted.name === actual.name &&
        wanted.number === actual.number && wanted.mountain === actual.mountain)
    );
    return roadOk && lotOk;
  }
  async function resolve(maps, input, options = {}) {
    const plan = analyze(input);
    const manual = options.manual === true;
    if (!manual && (plan.ambiguous || !plan.hasRegion || plan.type === 'unknown')) return null;
    if (!maps?.Service?.geocode || !plan.queries.length) return null;
    let tentative = null;
    for (const query of plan.queries) {
      const candidates = await new Promise(resolve => {
        let done = false;
        const finish = value => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => finish([]), 5000);
        try {
          maps.Service.geocode({query}, (status, response) => {
            const ok = status === maps.Service.Status.OK;
            finish(ok && Array.isArray(response?.v2?.addresses) ? response.v2.addresses : []);
          });
        } catch (_) { finish([]); }
      });
      for (const result of candidates) {
        const lat = Number(result.y), lng = Number(result.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
            lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
        const point = {lat, lng, query, verified: matches(plan, result)};
        if (point.verified) return point;
        if (manual && !tentative) tentative = point;
      }
    }
    return manual ? tentative : null;
  }
  root.DDSM_Address = Object.freeze({analyze, matches, resolve});
})(window);
