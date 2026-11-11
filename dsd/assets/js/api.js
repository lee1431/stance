/* DSD API at localflow.ddns.net. No customer records in browser localStorage. */
(function (root) {
  'use strict';
  const BASE = 'https://localflow.ddns.net/dsd/api/';
  // Session-only token. No delivery/customer data is stored in browser storage.
  const TOKEN_KEY = 'dsd:v1:bearer-token';
  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }
  function forget() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
  }
  function keep(value) {
    if (typeof value !== 'string' || value.length < 32) throw new Error('서버 로그인 토큰이 올바르지 않습니다.');
    try { sessionStorage.setItem(TOKEN_KEY, value); }
    catch (_) { throw new Error('브라우저 세션 저장소가 차단되어 로그인할 수 없습니다.'); }
  }
  async function request(path, { method = 'GET', body, file = false, anonymous = false } = {}) {
    const headers = { 'Accept': 'application/json' };
    const access = token();
    if (access && !anonymous) headers.Authorization = 'Bearer ' + access;
    if (!file && body !== undefined) headers['Content-Type'] = 'application/json';
    const options = { method, credentials: 'omit', mode: 'cors', cache: 'no-store', headers };
    if (body !== undefined) options.body = file ? body : JSON.stringify(body);
    let res;
    try { res = await fetch(BASE + path, options); }
    catch (_) { throw Object.assign(new Error('API 연결 실패: Nginx의 Authorization 허용과 CORS를 확인하세요.'), { code: 'NETWORK' }); }
    const data = await res.json().catch(() => ({ error: '서버 응답을 읽지 못했습니다.' }));
    if (res.status === 401 && !anonymous) forget();
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
        res = await fetch(BASE + path, { method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store',
          headers: { Accept: '*/*', Authorization: 'Bearer ' + token() } });
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
    setCsrf(_value) {},
    async me() {
      if (!token()) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401, code: '401' });
      return request('auth/me');
    },
    async enter(client_id, phone, password) {
      const r = await request('auth/enter', { method: 'POST',
        body: { client_id, phone, password }, anonymous: true });
      keep(r.access_token);
      return r;
    },
    async logout() {
      try { return await request('auth/logout', { method: 'POST', body: {} }); }
      finally { forget(); }
    },
    rounds: date => request('rounds?date=' + encodeURIComponent(date)),
    createRound: (date, center_name = '') => request('rounds', { method: 'POST', body: { date, center_name } }),
    getRound: id => request('rounds/' + encodeURIComponent(id)),
    deleteRound: (id, rev) => request('rounds/' + encodeURIComponent(id), { method: 'DELETE', body: { expected_revision: rev } }),
    addStop: (id, rev, stop) => request('rounds/' + encodeURIComponent(id) + '/stops', { method: 'POST', body: { expected_revision: rev, stop } }),
    updateStop: (id, rev, changes, action) => request('stops/' + encodeURIComponent(id), { method: 'PATCH', body: { expected_revision: rev, ...(action ? { changes: {}, action } : { changes }) } }),
    deleteStop: (id, rev) => request('stops/' + encodeURIComponent(id), { method: 'DELETE', body: { expected_revision: rev } }),
    order: (id, rev, ids) => request('rounds/' + encodeURIComponent(id) + '/order', { method: 'PUT', body: { expected_revision: rev, ids } }),
    recommend: (id, rev, start) => request('rounds/' + encodeURIComponent(id) + '/recommend', { method: 'POST', body: { expected_revision: rev, start } }),
    drivingRoute: (id, start) => request('routes/driving', { method: 'POST', body: { stop_id: id, start } }),
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