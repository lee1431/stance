/* DSD center admin NAVER Maps loader. Browser client ID is public; never embed client secrets. */
(function (root) {
  'use strict';
  const CLIENT_ID = 'wwowrt4n6u';
  let loading = null;
  function loadSdk() {
    if (root.naver?.maps?.Service?.geocode) return Promise.resolve(root.naver.maps);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const callback = '__dsdAdminNaverReady';
      const script = document.createElement('script');
      let settled = false;
      let watchdog;
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        try { delete root[callback]; } catch (_) { root[callback] = undefined; }
        if (error) {
          script.remove();
          reject(error);
        } else if (!root.naver?.maps?.Service?.geocode) {
          reject(new Error('네이버 지도 Geocoding 사용 권한을 확인하세요.'));
        } else {
          resolve(root.naver.maps);
        }
      }
      root[callback] = () => finish(null);
      script.async = true;
      script.src = 'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=' +
        encodeURIComponent(CLIENT_ID) + '&submodules=geocoder&callback=' + callback;
      script.onerror = () => finish(new Error('네이버 지도 SDK 로딩 실패: 지도 API 허용 도메인을 확인하세요.'));
      watchdog = setTimeout(() => finish(new Error('네이버 지도 연결 시간이 초과됐습니다.')), 15000);
      document.head.appendChild(script);
    }).catch(error => {
      loading = null;
      throw error;
    });
    return loading;
  }
  root.DSD_NaverMap = Object.freeze({loadSdk});
})(window);
