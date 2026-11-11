/* DSD server-authoritative workspace. No new customer data is written to localStorage.
   Existing localStorage is read ONLY for an explicit, verified one-time migration. */
(function(root) {
  'use strict';
  const API = new URL('api/workspace', new URL('./', location.href)).href;
  const AUTH = new URL('api/auth/me', new URL('./', location.href)).href;
  const allowed = key => typeof key === 'string' &&
    (key.startsWith('dsd:') || key === 'deliveryMapClientId');
  let entries = new Map(), revision = 0, csrf = '', loaded = false;
  let dirty = false, inflight = null, timer = null, conflict = false;
  let warning = '';

  function indicate(message, error = false) {
    const el = document.getElementById('serverStorageState');
    if (!el) return;
    el.textContent = 'DSD 서버 · ' + message;
    el.classList.toggle('is-error', error);
    el.title = error ? '서버 저장을 확인할 수 없습니다. 브라우저를 닫기 전에 확인하세요.' : '';
  }

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin', cache: 'no-store',
        ...options, headers: {Accept: 'application/json', ...(options.headers || {})}
      });
    } catch (error) {
      throw Error('서버 통신 실패: ' + (error.message || '네트워크 확인'));
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) throw Error('로그인이 필요합니다. /dsd/login 에서 로그인하세요.');
    if (!response.ok) {
      const error = Error(body.error || '서버 HTTP ' + response.status);
      error.code = body.code || String(response.status);
      throw error;
    }
    return body;
  }

  function validPayload(body) {
    if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
        !body.entries || typeof body.entries !== 'object' ||
        Array.isArray(body.entries)) throw Error('서버 작업 공간 응답 형식 오류');
    for (const [key, value] of Object.entries(body.entries)) {
      if (!allowed(key) || typeof value !== 'string') throw Error('서버 작업 공간에 잘못된 항목이 있습니다.');
    }
  }

  function legacyEntries() {
    const found = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (allowed(key)) found[key] = localStorage.getItem(key);
      }
    } catch (_) {
      // Storage may be blocked; new DSD doesn't require access to it.
    }
    return found;
  }

  function removeLegacy(legacy) {
    for (const [key, value] of Object.entries(legacy)) {
      try {
        if (localStorage.getItem(key) === value) localStorage.removeItem(key);
      } catch (_) {}
    }
  }

  async function put(snapshot, expectedRevision) {
    const body = await request(API, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf},
      body: JSON.stringify({revision: expectedRevision, entries: snapshot})
    });
    if (body.ok !== true || body.revision !== expectedRevision + 1)
      throw Error('서버가 저장 완료를 확인하지 않았습니다.');
    return body;
  }

  async function init() {
    indicate('로그인 확인 중');
    const auth = await request(AUTH);
    if (!auth.user || typeof auth.csrfToken !== 'string' || !auth.csrfToken)
      throw Error('로그인 정보 또는 CSRF 토큰을 확인할 수 없습니다.');
    csrf = auth.csrfToken;
    indicate('저장 데이터 불러오는 중');
    const remote = await request(API);
    validPayload(remote);
    revision = remote.revision;
    entries = new Map(Object.entries(remote.entries));

    const legacy = legacyEntries();
    const legacyKeys = Object.keys(legacy);
    if (legacyKeys.length && entries.size === 0) {
      const agree = confirm(
        '이 브라우저에 기존 DSD 자료 ' + legacyKeys.length + '개 항목이 있습니다.\n' +
        '현재 로그인한 계정의 서버 작업 공간으로 이전할까요?\n' +
        '서버에서 저장을 다시 확인한 뒤에만 기존 브라우저 자료를 정리합니다.'
      );
      if (!agree) throw Error('기존 브라우저 자료 이전이 취소되었습니다. 자료는 삭제하지 않았습니다.');
      indicate('기존 브라우저 자료를 서버로 이전 중');
      const result = await put(legacy, revision);
      const verification = await request(API);
      validPayload(verification);
      if (verification.revision !== result.revision ||
          JSON.stringify(verification.entries) !== JSON.stringify(legacy))
        throw Error('서버 이전 검증 실패. 브라우저 자료는 보존했습니다.');
      revision = verification.revision;
      entries = new Map(Object.entries(verification.entries));
      removeLegacy(legacy);
    } else if (legacyKeys.length) {
      const different = legacyKeys.filter(k => entries.get(k) !== legacy[k]);
      if (different.length) {
        warning = '서버 자료와 다른 이전 브라우저 자료 ' + different.length + '개 항목이 남아 있습니다. 자동 덮어쓰지 않습니다.';
      } else {
        removeLegacy(legacy);
      }
    }
    loaded = true;
    indicate(warning || ('동기화 완료 (v' + revision + ')'), !!warning);
    return {revision, warning};
  }

  function get(key, fallback = '') {
    if (!loaded) throw Error('DSD 서버 데이터가 아직 준비되지 않았습니다.');
    return entries.get(key) || fallback;
  }

  function schedule() {
    indicate('변경사항 서버 저장 대기');
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush().catch(() => {});
    }, 150);
  }

  function set(key, value) {
    if (!loaded || !allowed(key) || typeof value !== 'string')
      throw Error('DSD 서버 저장 준비 또는 항목 형식 오류');
    if (entries.get(key) === value) return true;
    entries.set(key, value);
    dirty = true;
    schedule();
    return true;
  }

  function remove(key) {
    if (!loaded || !allowed(key)) throw Error('DSD 서버 삭제 준비 또는 항목 형식 오류');
    if (!entries.has(key)) return true;
    entries.delete(key);
    dirty = true;
    schedule();
    return true;
  }

  async function flush() {
    if (!loaded) throw Error('서버 작업 공간이 준비되지 않았습니다.');
    if (conflict) throw Error('다른 기기에서 서버 자료가 변경되었습니다. 현재 작업을 확인한 뒤 새로고침하세요.');
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (inflight) {
      await inflight;
      return dirty ? flush() : revision;
    }
    if (!dirty) return revision;
    const snapshot = Object.fromEntries(entries);
    const expected = revision;
    dirty = false;
    indicate('서버에 저장 중');
    inflight = put(snapshot, expected);
    try {
      const result = await inflight;
      revision = result.revision;
      indicate(dirty ? '추가 변경사항 저장 대기' : ('동기화 완료 (v' + revision + ')'));
    } catch (error) {
      dirty = true;
      if (error.code === 'REVISION_CONFLICT') conflict = true;
      indicate('저장 실패: ' + error.message, true);
      throw error;
    } finally {
      inflight = null;
    }
    if (dirty) return flush();
    return revision;
  }

  root.addEventListener('online', () => {
    if (dirty && !conflict) void flush().catch(() => {});
  });
  root.addEventListener('beforeunload', event => {
    if (dirty || inflight) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  root.DsdServerStore = Object.freeze({
    init, get, set, remove, flush,
    hasPending: () => dirty || !!inflight,
    version: () => revision
  });
}(window));
