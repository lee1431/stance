# 배송지도 웹 프론트엔드

현재 경로: `stance/dsd/`.

## 구조

- `index.html`: 데스크톱 배송 작업 공간 및 모바일 지도·목록·주소 추가·설정 화면
- `style.css`: 반응형 화면 구성과 고객명 마커 스타일
- `app.js`: 네이버지도 SDK, 배송 완료 마커 토글, 목록 검색/필터, 로그인 계정·관리자 기능
- `login.html`: 기존 Flask/Jinja 로그인 템플릿. **정적 서버에서 그대로 서비스하면 Jinja 문법은 렌더되지 않음**

## 백엔드 연결

실제 배송·인증 데이터는 갤럭시 S21 Flask v0.6의 SQLite DB에 저장한다. 정적 프론트엔드는 고객 데이터를 직접 보관하지 않는다.

브라우저가 `https://llsshh.com/dsd/`로 접속하면 다음 **동일 출처 요청**이 Flask로 전달되어야 한다.

- `/dsd/api/auth/me`, `/dsd/api/auth/logout`
- `/dsd/api/stops`, `/dsd/api/stops/completed`, `/dsd/api/stops/<id>`, `/dsd/api/geocode`
- `/dsd/api/config`, 관리자용 `/dsd/api/users`
- `/dsd/login` 및 로그인 POST 처리

단순히 `app.js`의 fetch URL을 S21 도메인으로 변경하는 것은 적절하지 않다. Flask 세션 쿠키가 서로 다른 도메인에 공유되지 않기 때문이다. `llsshh.com`에서 동일 출처로 보이도록 **서버측 reverse proxy**가 필요하다.

HTTPS Nginx 리버스 프록시 설정 예시 (기존 서비스와 경로 충돌 여부 확인 필수):

```nginx
location ^~ /dsd/api/ {
  proxy_pass https://localflow.ddns.net/dsd/api/;
  proxy_set_header Host localflow.ddns.net;
  proxy_set_header X-Forwarded-Proto https;
}
location = /dsd/login {
  proxy_pass https://localflow.ddns.net/dsd/login;
  proxy_set_header Host localflow.ddns.net;
  proxy_set_header X-Forwarded-Proto https;
}
```

**주의:** 로그인 POST의 리다이렉트 `Location`, Flask 쿠키 Path/Domain, CSRF 검증, 프록시의 SSL 및 웹 호스트 검증을 실제 환경에 맞게 확인해야 한다. 위 예시는 배포 확인 없이 그대로 적용할 수 있는 확정 구성이 아니다.

네이버 클라우드 Maps Web 서비스 URL에도 **`https://llsshh.com`**을 추가 등록해야 한다. Client Secret을 프론트에 넣지 않는다.

## UI 동작

- PC: 지도와 사이드바를 동시에 표시하고 탭으로 배송 목록/주소 등록/계정 설정을 전환.
- 모바일: 지도가 기본 화면, 하단 메뉴에서 배송 목록·주소 등록·설정 패널 표시.
- 마커 클릭 시 배송 완료 상태 저장.
- 완료건 일괄 삭제는 **본인 완료 건만 삭제**하고 미배송은 보존하도록 서버 API `DELETE /api/stops/completed` 사용.
- 배송지 검색과 상태 필터는 현재 계정 목록에 대한 **프론트 화면 표시 필터**이며, 서버 권한 검사를 대체하지 않음.

## 테스트

- 프론트 소스의 HTML 요소 ID와 JS 참조 검증 및 JS 문법 검사 완료.
- S21 Flask 연동, 실제 네이버지도 키 인증 및 스마트폰 실기 테스트는 별도로 필요.
- `충주시 상가 100곳 예제` 버튼은 정적 배포에 해당 CSV가 있어야 정상 작동한다. 실제 고객 정보는 접근 제어 확인 전 공개 서버에 넣지 말 것.
