/* DSD API at localflow.ddns.net. No customer records in browser localStorage. */
(function (root) {
  'use strict';
  const BASE = 'https://localflow.ddns.net/dsd/api/';
  let csrf = '';
  async function request(path, { method = 'GET', body, file = false } = {}) {
    const headers = { 'Accept': 'application/json' };
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    if (!file && body !== undefined) headers['Content-Type'] = 'application/json';
    const options = { method, credentials: 'include', cache: 'no-store', headers };
    if (body !== undefined) options.body = file ? body : JSON.stringify(body);
    let res;
    try { res = await fetch(BASE + path, options); }
    catch (_) { throw Object.assign(new Error('API 연결에 실패했습니다. 서버 CORS 설정과 브라우저 쿠키 허용 여부를 확인하세요.'), { code: 'NETWORK' }); }
    const data = await res.json().catch(() => ({ error: '서버 응답을 읽지 못했습니다.' }));
    if (!res.ok) throw Object.assign(new Error(data.error || ('서버 오류 ' + res.status)), {
      code: data.code || String(res.status), status: res.status, revision: data.revision
    });
    return data;
  }
  const api = {
    request,
    base: BASE,
    health: () => request('health'),
    async download(path, filename) {
      let res;
      try {
        res = await fetch(BASE + path, { method: 'GET', credentials: 'include', cache: 'no-store', headers: { Accept: '*/*' } });
      } catch (_) {
        throw new Error('파일을 받지 못했습니다. API CORS와 로그인 상태를 확인하세요.');
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || ('다운로드 실패 (HTTP ' + res.status + ')'));
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      try {
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename || 'dsd-download';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      }
    },
    setCsrf(value) { csrf = value || ''; },
    async me() { const r = await request('auth/me'); csrf = r.csrf_token; return r; },
    async enter(client_id, phone, password) {
      const r = await request('auth/enter', { method: 'POST', body: { client_id, phone, password } });
      csrf = r.csrf_token;
      return r;
    },
    logout: () => request('auth/logout', { method: 'POST', body: {} }),
    rounds: date => request('rounds?date=' + encodeURIComponent(date)),
    createRound: (date, center_name = '') => request('rounds', { method: 'POST', body: { date, center_name } }),
    getRound: id => request('rounds/' + encodeURIComponent(id)),
    deleteRound: (id, rev) => request('rounds/' + encodeURIComponent(id), { method: 'DELETE', body: { expected_revision: rev } }),
    addStop: (id, rev, stop) => request('rounds/' + encodeURIComponent(id) + '/stops', { method: 'POST', body: { expected_revision: rev, stop } }),
    updateStop: (id, rev, changes, action) => request('stops/' + encodeURIComponent(id), { method: 'PATCH', body: { expected_revision: rev, ...(action ? { action } : { changes }) } }),
    deleteStop: (id, rev) => request('stops/' + encodeURIComponent(id), { method: 'DELETE', body: { expected_revision: rev } }),
    order: (id, rev, ids) => request('rounds/' + encodeURIComponent(id) + '/order', { method: 'PUT', body: { expected_revision: rev, ids } }),
    recommend: (id, rev, start) => request('rounds/' + encodeURIComponent(id) + '/recommend', { method: 'POST', body: { expected_revision: rev, start } }),
    importSheet(id, rev, file) {
      const body = new FormData(); body.set('expected_revision', String(rev)); body.set('file', file);
      return request('rounds/' + encodeURIComponent(id) + '/import', { method: 'POST', body, file: true });
    },
    listFiles: id => request('rounds/' + encodeURIComponent(id) + '/files'),
    legacy: rounds => request('import-legacy', { method: 'POST', body: { rounds } }),
    url(path) { return BASE + path; }
  };
  root.DSD_API = Object.freeze(api);
})(window);