# 배송지도 웹 프론트엔드

현재 경로: `stance/dsd/`.

## 구조

- `index.html`: 데스크톱 배송 작업 공간 및 모바일 지도·목록·주소 추가·설정 화면
- `style.css`: 반응형 화면 구성과 고객명 마커 스타일
- `app.js`: 네이버지도 SDK, 배송 완료 마커 토글, 목록 검색/필터, 로그인 계정·관리자 기능
- `login.html`: 기존 Flask/Jinja 로그인 템플릿. **정적 서버에서 그대로 서비스하면 Jinja 문법은 렌더되지 않음**

## 현재 배포되는 /dsd/ 화면 (중요)

GitHub Pages의 `dsd/index.html`은 **독립형 브라우저 저장 버전**입니다. 아래에 설명하는 `dsd/app.js` 및 S21 Flask API 방식은 별도의 서버 연동용 코드이며, `index.html`에는 자동 적용되지 않습니다.

### 센터별 코스 v1 (브라우저 저장)

- 화면 왼쪽 상단의 **센터 선택 / + 센터**로 센터를 만들고 바꿀 수 있습니다.
- 센터마다 등록 배송지, 코스 목록, 코스별 방문 순서가 독립적입니다.
- **코스 만들기** → 코스 선택·추가·이름 변경·삭제 → 배송지 추가·제외 및 순서 조정 → **코스 저장**.
- 코스 삭제는 배송지를 삭제하지 않습니다. 배송지를 삭제하면 해당 센터의 다른 저장 코스에서도 삭제된 배송지 참조를 정리합니다.
- 이전 버전의 `dsd:vanilla:stops:v1`와 `dsd:vanilla:course:v1` 값은 첫 실행 시 **기본 센터**로 복사하며, 원래 값은 복구용으로 그대로 둡니다.
- 센터 목록은 `dsd:centers:v1`, 배송지 목록은 `dsd:center:<center-id>:stops`, 코스는 `dsd:center:<center-id>:route:<route-id>`로 각각 `localStorage`에 저장됩니다.

**한계 및 데이터 보안:** 이 기능은 같은 브라우저·프로필에서만 유지됩니다. 기기 간 동기화, 센터별 사용자 접근 권한, 서버 백업은 아직 없습니다. 브라우저 데이터 삭제·프로필 변경 시 자료가 없어질 수 있습니다. 같은 브라우저를 쓰는 사용자는 다른 센터의 자료에도 접근할 수 있으므로 **인증된 멀티센터 운영 환경으로 간주하면 안 됩니다.**

### 여러 기기에서 공유하는 서버 저장을 위한 후속 작업

S21 Flask와 SQLite 소스가 이 저장소에 포함되어 있지 않아 기존 인증·DB 스키마와 호환되는 서버 코드 배포는 여기서 검증하지 못했습니다. 서버 단계에서는 다음과 같이 확장해야 합니다.

1. `centers (id, name)`, `center_members (center_id, user_id, role)`, `routes (id, center_id, name, updated_at, revision)`, `route_stops (route_id, stop_id, position)` 테이블을 운영하고 배송지에도 `center_id`를 부여합니다.
2. 매 요청에 현재 로그인 사용자의 센터 소속·역할을 검증하고, 조회·수정·삭제 조건에 **항상 센터 ID**를 포함합니다. 클라이언트에서 보낸 센터 ID만 신뢰하면 안 됩니다.
3. 코스 변경 시 트랜잭션 및 `revision` 검사로 동시에 수정하는 기사 간 데이터 충돌을 처리합니다. 정기 백업을 구성합니다.
4. 기존 데이터 이관 시 사용자·센터 매핑을 확인하고, 데이터를 공개 API나 GitHub Pages 정적 파일에 넣지 않습니다.

## 백엔드 연결

서버 연동형 `app.js`는 갤럭시 S21 Flask v0.6과 SQLite DB를 전제로 합니다. **현재 배포되는 `index.html`은 이 백엔드를 사용하지 않고 브라우저에 저장하므로 혼동하지 마세요.**

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
