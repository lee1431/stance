/* DDSM Korean address interpretation. Preserve originals; derive map-only candidates. */
(function (root) {
  'use strict';
  const ROAD = /([가-힣0-9·._-]+(?:대로|로|길))\s*(\d{1,5}(?:-\d{1,5})?)(?=$|[\s,，()])/g;
  const LOT = /([가-힣][가-힣0-9·._-]*(?:동|읍|면|리|가))\s*(산\s*)?(\d{1,5}(?:-\d{1,5})?)(?=$|[\s,，()])/g;
  const REGION = /^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|[가-힣0-9]+(?:도|시|군|구|읍|면))$/;
  // An apartment name is a place candidate, but its dong/ho details are NOT
  // geocodable building numbers. The original full address stays untouched.
  const COMPLEX_NAME = /(?:아파트|오피스텔|빌라|맨션|주상복합|단지|apt\.?$)/i;
  const RESIDENTIAL_TAIL = /[\s,，(]+(?:제?\d{1,4}\s*동(?:\s*제?\d{1,5}\s*호)?|\d{1,4}\s*[-–]\s*\d{1,5}\s*호?|제?\d{1,5}\s*호)\s*\)?\s*$/i;
  // Some exports attach the unit directly to the complex name:
  // '영진브랑아파트101-306' or '주공3단지아파트307동302호'.
  const ATTACHED_COMPLEX_UNIT = /((?:아파트|오피스텔|빌라|맨션|주상복합|단지))(?:제?\d{1,4}\s*동(?:\s*제?\d{1,5}\s*호)?|\d{1,4}\s*[-–]\s*\d{1,5}\s*호?)\s*$/i;
  const NEIGHBORHOOD = /(?:동|리|가)$/;
  const normalizeName = value => String(value || '').normalize('NFKC').replace(/[\s()·._-]+/g, '').toLowerCase();
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
  function residentialQuery(value) {
    if (!COMPLEX_NAME.test(value)) return null;
    let base = trim(value);
    // Remove a terminal apartment unit such as '307-302호', '307동 302호',
    // '101동' or '302호' ONLY when the input names a residential building.
    for (let i = 0; i < 2; i++) {
      const next = trim(base.replace(RESIDENTIAL_TAIL, '').replace(ATTACHED_COMPLEX_UNIT, '$1'));
      if (next === base) break;
      base = next;
    }
    const words = base.split(' ');
    let regionEnd = 0;
    while (regionEnd < words.length &&
           (REGION.test(words[regionEnd]) || NEIGHBORHOOD.test(words[regionEnd]))) {
      regionEnd++;
    }
    if (!regionEnd || regionEnd === words.length) return null;
    const regionWords = words.slice(0, regionEnd);
    const name = trim(words.slice(regionEnd).join(' ').replace(/[()]/g, ' '));
    if (!COMPLEX_NAME.test(name)) return null;
    const region = regionWords.join(' ');
    const majorRegion = regionWords.filter(x => REGION.test(x)).join(' ');
    const queries = [trim(region + ' ' + name)];
    if (majorRegion && majorRegion !== region)
      queries.push(trim(majorRegion + ' ' + name));
    return {
      name, region, queries, strippedUnit: base !== trim(value),
      regionTokens: regionWords.filter(x => /(?:시|군|구|읍|면|동|리|가)$/.test(x))
    };
  }
  function analyze(input) {
    const values = [...new Set((Array.isArray(input) ? input : [input]).map(trim).filter(Boolean))];
    const roads = [], lots = [], complexes = [];
    const roadKeys = new Set(), lotKeys = new Set(), complexKeys = new Set();
    for (const value of values) {
      const complex = residentialQuery(value);
      if (complex && !complexKeys.has(complex.region + '|' + complex.name)) {
        complexKeys.add(complex.region + '|' + complex.name);
        complexes.push(complex);
      }
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
    const ambiguous = roads.length > 1 || lots.length > 1 ||
      (!roads.length && !lots.length && complexes.length > 1);
    const type = roads.length && lots.length ? 'mixed' : roads.length ? 'road' :
      lots.length ? 'lot' : complexes.length ? 'complex' : 'unknown';
    const label = ambiguous ? '주소 충돌 · 확인 필요' :
      ({mixed:'도로명+지번 혼합', road:'도로명주소', lot:'지번주소',
        complex:'아파트·건물명 (동·호수 제외)', unknown:'주소 판별 필요'})[type];
    const queries = [];
    for (const item of [...roads, ...lots]) {
      const query = trim([item.region, item.key].filter(Boolean).join(' '));
      if (!queries.includes(query)) queries.push(query);
    }
    if (!queries.length && complexes.length) {
      for (const complex of complexes) {
        for (const query of complex.queries) {
          if (!queries.includes(query)) queries.push(query);
        }
      }
    }
    // Unknown formats are suitable for manual search only, never automatic mapping.
    if (!queries.length) queries.push(...values.map(v=>v.split(/[，,]/)[0].trim()).filter(v=>v.length>=4));
    const regions = [...new Set([...roads, ...lots].map(x=>x.region).filter(Boolean))];
    const regionTokens = type === 'complex'
      ? complexes.flatMap(x=>x.regionTokens)
      : regions.flatMap(x=>x.split(/\s+/)).filter(x=>/(?:시|군|구|읍|면)$/.test(x));
    // Require enough locality to prevent matching the wrong city on ambiguous street names.
    const hasRegion = regionTokens.length > 0;
    return {
      type, label, ambiguous, roads, lots, complexes, queries: [...new Set(queries)].slice(0, 5),
      regionTokens: [...new Set(regionTokens)], hasRegion, original: values[0] || ''
    };
  }
  function matches(plan, result) {
    if (!result || plan.ambiguous || plan.type === 'unknown' || !plan.hasRegion) return false;
    const roadAddress = trim(result.roadAddress);
    const lotAddress = trim(result.jibunAddress);
    const resolved = trim(roadAddress + ' ' + lotAddress);
    if (!plan.regionTokens.some(token => resolved.includes(token))) return false;
    if (plan.type === 'complex') {
      // A same-city geocoding hit is NOT sufficient to pin an apartment.
      // Automatic saving requires the result itself to name the exact complex.
      if (plan.complexes.length !== 1 ||
          !plan.complexes[0].regionTokens.every(token => resolved.includes(token))) return false;
      const namedElements = Array.isArray(result.addressElements)
        ? result.addressElements.filter(el=>Array.isArray(el.types) &&
            el.types.includes('BUILDING_NAME')).map(el=>el.longName || el.shortName || '')
        : [];
      const returnedName = normalizeName([roadAddress, lotAddress, result.buildingName || '',
        ...namedElements].join(' '));
      return !!returnedName && returnedName.includes(normalizeName(plan.complexes[0].name));
    }
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
        if (manual && !tentative &&
            (plan.type !== 'complex' ||
             plan.regionTokens.every(token =>
               trim(String(result.roadAddress || '') + ' ' + String(result.jibunAddress || '')).includes(token))))
          tentative = point;
      }
    }
    return manual ? tentative : null;
  }
  root.DDSM_Address = Object.freeze({analyze, matches, resolve, residentialQuery});
})(window);
