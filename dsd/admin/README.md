# DSD 센터 관리자 페이지

배포 위치: `dsd/admin/index.html`

설정한 API 기본 주소: `https://mrdindoin.ddns.net/dsd/api/`

## 화면 기능
- 관리자 로그인, 날짜별 엑셀(XLSX/XLSM/XLS/CSV) 업로드
- 날짜별 전체 원본 목록, 모든 원본 컬럼 표시, 표 검색 및 250행 단위 추가 표시
- 네이버 지도 고유 배송지 마커, 위치가 없는 상호명 별도 목록
- 수동 위치 보정, 정기화물 과거 배송지 연결

관리자 API와 SQLite 스키마는 **S10 서버의 dsd.py / admin.py**에 설치해야 합니다. GitHub의 정적 페이지를 올리는 것만으로 API 서버가 설치되지는 않습니다.

## 매우 중요: llsshh.com에서 별도 도메인 API를 호출하는 경우

서버는 `mrdindoin.ddns.net`이고 정적 사이트는 `llsshh.com`이므로 서로 다른 사이트입니다. 브라우저 쿠키 인증이 작동하려면 다음 **모두** 충족해야 합니다.

1. Flask가 `Origin: https://llsshh.com`을 허용하고 응답에 `Access-Control-Allow-Origin: https://llsshh.com`과 `Access-Control-Allow-Credentials: true`를 설정해야 합니다.
2. 브라우저가 보내는 OPTIONS preflight 응답에서도 `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, X-CSRF-Token` 등을 반환해야 합니다.
3. Flask 세션 쿠키는 `SESSION_COOKIE_SECURE=True`, `SESSION_COOKIE_SAMESITE="None"`, `SESSION_COOKIE_PATH="/dsd/api"`가 필요합니다. 기존 `Lax` 설정으로는 타 사이트로부터 세션 쿠키가 보내지지 않습니다.
4. 브라우저의 서드파티 쿠키 차단 정책에 따라 위 설정을 모두 적용해도 인증이 불가능할 수 있습니다.

**더 안전하고 간단한 권장 방식:** 웹페이지와 API를 같은 출처로 제공하세요. 예를 들어 S7 Nginx에 `location ^~ /dsd/api/`를 설정하여 `https://llsshh.com/dsd/api/`를 S10(`172.30.1.51:8862`)으로 프록시하면 서드파티 쿠키 문제가 사라집니다. 이때 `admin.js`의 `API_BASE`를 `'/dsd/api/'`로 바꾸고 `credentials`는 `'same-origin'`으로 변경하면 됩니다. 단, 기존 S21의 DSD API와 경로가 충돌하는지 먼저 확인하세요. 별도 prefix를 사용할 수도 있습니다.

## NAVER 지도

지도 SDK Client ID `wwowrt4n6u`가 사용됩니다. NAVER Cloud 지도 서비스에 실제 관리자 페이지의 호스트(`llsshh.com` 또는 GitHub Pages)를 허용해야 합니다. 지도는 브라우저 API 허용 도메인과 Geocoding API 사용 권한이 필요합니다.

**안내:** GitHub 반영만 완료했습니다. Nginx 설정, 실제 API 응답, 사용자 인증 및 지도 표시의 실기 검증은 아직 완료되지 않았습니다.
