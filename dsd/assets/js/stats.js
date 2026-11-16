/* DSD daily statistics: uses existing authenticated rounds API.
   Counts reflect current server records, not an immutable historical event log. */
(function () {
  'use strict';
  const API = window.DSD_API;
  const $ = id => document.getElementById(id);
  let sequence = 0;
  let rowsForExport = null;

  function today() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }
  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function offsetDate(date, days) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function number(value) { return Number(value || 0).toLocaleString('ko-KR'); }
  function rate(count, total) { return total ? (100 * count / total).toFixed(1) + '%' : '0%'; }
  function message(value, isError = false) {
    $('message').textContent = value;
    $('message').classList.toggle('error', isError);
  }
  function bucket(stops) {
    const counts = { total: 0, done: 0, pending: 0, failed: 0, returned: 0, other: 0 };
    for (const stop of stops) {
      counts.total++;
      const status = String(stop && stop.status || '').toLowerCase();
      if (status === 'done') counts.done++;
      else if (status === 'pending') counts.pending++;
      else if (status === 'failed') counts.failed++;
      else if (status === 'return') counts.returned++;
      else counts.other++;
    }
    return counts;
  }
  function combine(rows) {
    const all = bucket([]);
    for (const row of rows) for (const key of Object.keys(all)) all[key] += row.counts[key];
    return all;
  }
  async function fetchRoundDetails(rounds) {
    const data = new Array(rounds.length);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < rounds.length) {
        const index = nextIndex++;
        const result = await API.getRound(rounds[index].id);
        if (!result || !Array.isArray(result.stops)) throw new Error('회차 기록 형식이 올바르지 않습니다.');
        data[index] = {
          name: String(result.round?.round_no ?? rounds[index].round_no ?? (index + 1)) + '회차',
          counts: bucket(result.stops),
          stops: result.stops
        };
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, rounds.length) }, () => worker()));
    return data;
  }
  function addCell(tr, value) {
    const td = document.createElement('td');
    td.textContent = String(value);
    tr.appendChild(td);
  }
  function statusLabel(value) {
    const code = String(value || '').toLowerCase();
    return ({ done:'완료', pending:'미완료', failed:'미배송', return:'반품' })[code] || '기타';
  }
  function deliveryText(stop, key, fallback = '') {
    const value = stop && stop[key];
    return value === null || value === undefined ? fallback : String(value).trim();
  }
  function renderDeliveryList(container, stops, roundName) {
    container.replaceChildren();
    const caption = document.createElement('div');
    caption.className = 'round-details-title';
    caption.textContent = roundName + ' 배송지 · ' + number(stops.length) + '건';
    container.appendChild(caption);
    if (!stops.length) {
      const empty = document.createElement('div');
      empty.className = 'delivery-none';
      empty.textContent = '등록된 배송지가 없습니다.';
      container.appendChild(empty);
      return;
    }
    const list = document.createElement('div');
    list.className = 'delivery-list';
    const ordered = stops.map((stop, index) => ({ stop: stop || {}, index }))
      .sort((a,b) => {
        const pa = Number(a.stop.position), pb = Number(b.stop.position);
        const na = Number.isFinite(pa) && pa > 0 ? pa : Number.MAX_SAFE_INTEGER;
        const nb = Number.isFinite(pb) && pb > 0 ? pb : Number.MAX_SAFE_INTEGER;
        return na - nb || a.index - b.index;
      });
    ordered.forEach(({stop, index}, orderIndex) => {
      const article = document.createElement('article');
      article.className = 'delivery-item';
      const top = document.createElement('div');
      top.className = 'delivery-top';
      const name = document.createElement('div');
      name.className = 'delivery-name';
      const place = deliveryText(stop,'company') || deliveryText(stop,'recipient_name') ||
        deliveryText(stop,'name') || '배송지';
      name.textContent = (deliveryText(stop,'position') || String(orderIndex + 1)) + '번 · ' + place;
      const badge = document.createElement('span');
      const status = deliveryText(stop,'status').toLowerCase();
      badge.className = 'delivery-badge ' + (['done','pending','failed','return'].includes(status) ? status : 'other');
      badge.textContent = statusLabel(status);
      top.append(name,badge);
      const address = document.createElement('div');
      address.className = 'delivery-address';
      address.textContent = deliveryText(stop,'address') || deliveryText(stop,'recipient_address') || '주소 미등록';
      article.append(top,address);
      const waybill = deliveryText(stop,'waybill') || deliveryText(stop,'waybill_no') ||
        deliveryText(stop,'tracking_number');
      const memo = deliveryText(stop,'memo');
      const metadata = [];
      if (waybill) metadata.push('운송장 ' + waybill);
      if (memo) metadata.push('메모 ' + memo);
      if (metadata.length) {
        const extra = document.createElement('div');
        extra.className = 'delivery-sub';
        for (const item of metadata) {
          const label = document.createElement('span');
          label.textContent = item;
          extra.appendChild(label);
        }
        article.appendChild(extra);
      }
      list.appendChild(article);
    });
    container.appendChild(list);
  }
  function addExpandableRound(tbody, row, index) {
    const tr = document.createElement('tr');
    addCell(tr, row.name);
    for (const key of ['total','done','pending','failed','returned']) addCell(tr, number(row.counts[key]));
    addCell(tr, rate(row.counts.done + row.counts.failed + row.counts.returned, row.counts.total));

    const buttonCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'round-expand';
    button.textContent = '▼ 배송지 보기';
    button.setAttribute('aria-expanded','false');
    const panelId = 'round-deliveries-' + index;
    button.setAttribute('aria-controls',panelId);
    buttonCell.appendChild(button);
    tr.appendChild(buttonCell);
    tbody.appendChild(tr);

    const detailsRow = document.createElement('tr');
    detailsRow.hidden = true;
    detailsRow.id = panelId;
    const detailsCell = document.createElement('td');
    detailsCell.colSpan = 8;
    detailsCell.className = 'round-detail-cell';
    const panel = document.createElement('div');
    detailsCell.appendChild(panel);
    detailsRow.appendChild(detailsCell);
    tbody.appendChild(detailsRow);
    let built = false;
    button.addEventListener('click', () => {
      const expanding = detailsRow.hidden;
      if (expanding && !built) {
        renderDeliveryList(panel, row.stops || [], row.name);
        built = true;
      }
      detailsRow.hidden = !expanding;
      button.setAttribute('aria-expanded',String(expanding));
      button.textContent = expanding ? '▲ 접기' : '▼ 배송지 보기';
    });
  }
  function drawBar(t) {
    const bar = $('progressBar');
    bar.replaceChildren();
    for (const [key, className] of [['done','done'],['failed','failed'],['returned','return'],['pending','pending'],['other','other']]) {
      if (!t[key]) continue;
      const span = document.createElement('span');
      span.className = className;
      span.style.width = (100 * t[key] / t.total) + '%';
      bar.appendChild(span);
    }
    bar.setAttribute('aria-label', '완료 ' + t.done + '건, 미배송 ' + t.failed + '건, 반품 ' + t.returned + '건, 미완료 ' + t.pending + '건, 기타 ' + t.other + '건');
  }
  function render(date, rounds) {
    const total = combine(rounds);
    for (const key of ['total','done','pending','failed','returned']) $(key).textContent = number(total[key]);
    $('deliveryRate').textContent = rate(total.done, total.total);
    $('processRate').textContent = rate(total.done + total.failed + total.returned, total.total);
    drawBar(total);
    $('roundRows').replaceChildren();
    rounds.forEach((row,index) => addExpandableRound($('roundRows'),row,index));
    $('otherNotice').hidden = total.other === 0;
    $('otherNotice').textContent = total.other ? '분류되지 않은 상태 ' + number(total.other) + '건은 전체 건수에 포함되지만 완료·미완료·미배송·반품에는 포함되지 않습니다.' : '';
    $('report').hidden = false;
    rowsForExport = { date, rows: rounds, total };
    message(date + ' · ' + rounds.length + '개 회차 조회 완료');
  }
  async function refresh() {
    const date = $('statDate').value;
    if (!isDate(date)) { message('조회 날짜를 정확히 선택해 주세요.', true); return; }
    const callId = ++sequence;
    rowsForExport = null;
    $('report').hidden = true;
    $('empty').hidden = true;
    $('downloadCsv').disabled = true;
    message(date + ' 배송 기록 조회 중…');
    try {
      const response = await API.rounds(date);
      if (callId !== sequence) return;
      if (!response || !Array.isArray(response.rounds)) throw new Error('회차 목록 응답이 올바르지 않습니다.');
      if (!response.rounds.length) {
        $('empty').hidden = false;
        message(date + ' · 저장된 회차 없음');
        return;
      }
      const rounds = await fetchRoundDetails(response.rounds);
      if (callId !== sequence) return;
      render(date, rounds);
      $('downloadCsv').disabled = false;
    } catch (error) {
      if (callId !== sequence) return;
      $('report').hidden = true;
      message('통계를 전부 조회하지 못했습니다. ' + (error.message || '서버 연결 상태를 확인하세요.'), true);
    }
  }
  function changeDate(value) {
    if (!isDate(value)) return;
    $('statDate').value = value;
    try { history.replaceState(null, '', './stats.html?date=' + encodeURIComponent(value)); } catch (_) {}
    refresh();
  }
  function exportCsv() {
    if (!rowsForExport) return;
    const data = rowsForExport;
    const cols = ['날짜','회차','전체','완료','미완료','미배송','반품','기타','완료율','처리율'];
    const record = (name, c) => [
      data.date, name, c.total, c.done, c.pending, c.failed, c.returned, c.other,
      rate(c.done, c.total), rate(c.done + c.failed + c.returned, c.total)
    ];
    const all = [cols, ...data.rows.map(r => record(r.name, r.counts)), record('합계', data.total)];
    const csv = '\uFEFF' + all.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DSD-데일리-통계-' + data.date + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function init() {
    const params = new URLSearchParams(location.search);
    $('statDate').value = isDate(params.get('date') || '') ? params.get('date') : today();
    $('prevDate').addEventListener('click', () => changeDate(offsetDate($('statDate').value, -1)));
    $('nextDate').addEventListener('click', () => changeDate(offsetDate($('statDate').value, 1)));
    $('todayDate').addEventListener('click', () => changeDate(today()));
    $('reload').addEventListener('click', refresh);
    $('statDate').addEventListener('change', () => changeDate($('statDate').value));
    $('downloadCsv').addEventListener('click', exportCsv);
    $('downloadCsv').disabled = true;
    try {
      const me = await API.me();
      const user = me.user || {};
      $('account').textContent = '기사 계정 · ' + (user.phone || user.client_id || '로그인됨');
      await refresh();
    } catch (error) {
      message('로그인이 필요하거나 서버에 연결할 수 없습니다. DSD 배송 화면에서 먼저 로그인해 주세요. (' + (error.message || '로그인 확인 실패') + ')', true);
      $('account').textContent = '로그인 확인 필요';
    }
  }
  init();
})();
