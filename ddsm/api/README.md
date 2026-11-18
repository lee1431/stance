# DDSM 사용자 인증 API (초기 버전)

기존 `dsd` 서버와 별개로 `ddsm/api/app.py`에 Flask 인증 API를 추가했습니다. 실제 서버 배포·연결은 아직 수행하지 않았습니다.

## 실행 준비

```bash
pip install -r ddsm/api/requirements.txt
export DDSM_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export DDSM_ORIGIN=https://llsshh.com
export DDSM_DB_PATH=/secure/path/ddsm_auth.sqlite3
waitress-serve --listen=127.0.0.1:8862 --call app:create_app
```

위 명령은 `ddsm/api` 디렉터리에서 실행한다는 전제입니다. Nginx는 HTTPS `/ddsm/api/`를 이 서버에 프록시해야 하며 Flask가 **동일한 전체 경로** `/ddsm/api/auth/login`을 받도록 구성해야 합니다. 쿠키는 HTTPS, HttpOnly, SameSite=Lax, `/ddsm/api` 경로입니다. 서버는 URL 기준 동일 출처의 POST를 검사합니다.

## 경로

- `GET /ddsm/api/health` 서비스 상태
- `POST /ddsm/api/auth/register` JSON `{ "phone": "01012345678", "password": "10자 이상" }`
- `POST /ddsm/api/auth/login` 동일 형식
- `GET /ddsm/api/auth/me` 인증 세션 조회
- `POST /ddsm/api/auth/logout` 세션 종료. `X-CSRF-Token` 필요

암호는 평문 저장하지 않고 Werkzeug scrypt로 해시합니다. 서버 환경변수의 `DDSM_SECRET_KEY`는 저장소에 넣지 마세요. SQLite 데이터와 비밀키를 안전한 위치에 보관하세요.

## 주의

- **SMS 번호 소유자 인증은 아직 없습니다.** 번호를 아는 사람이 선점해 가입할 수 있으므로 실사용 공개 가입 전에 휴대폰 인증·계정복구 절차를 추가해야 합니다.
- IP/전화번호의 기본 속도 제한은 프로세스 메모리 기준이므로 여러 워커 환경에서는 Nginx 또는 Redis 기반 속도 제한을 추가하세요.
- 현재 이 API는 **계정 가입·로그인만 지원**합니다. 기존 DDSM 배송 데이터는 여전히 브라우저 localStorage에 있으며, 로그인만으로 서버 동기화되지 않습니다.
- 화면의 '서버 없이 이 기기에서 계속'은 기존 로컬 자료에 접근하는 버튼이며 서버 인증을 대체하지 않습니다. 민감한 배송 데이터를 API로 저장·공유하기 전에는 인증 강제와 사용자 권한 검증을 적용해야 합니다.
- 실제 서버에 연결되지 않았다면 화면의 가입·로그인 버튼은 연결 오류를 보여 주며, 비밀번호는 브라우저 저장소에 보관하지 않습니다.


## 관리자 콘솔 및 데이터 적재

**관리 화면:** `/ddsm/admin/` (정적 페이지). `/ddsm/api/`는 별도 Flask 서버를 동일 도메인으로 프록시해야 합니다. 코드를 GitHub에 커밋했다고 서버가 실행되는 것은 아닙니다.

관리자 공개 가입을 허용하지 않습니다. 서버에 미리 허용 전화번호 목록과 **별도 관리자 비밀번호 해시**를 설정해야 합니다.

```bash
export DDSM_ADMIN_PHONES=01012345678,01098765432
python - <<'PY'
from getpass import getpass
from werkzeug.security import generate_password_hash
print(generate_password_hash(getpass('관리자 비밀번호: '), method='scrypt'))
PY
# 위 출력값을 DDSM_ADMIN_PASSWORD_HASH 환경변수로 등록하세요.
```

관리자 계정은 먼저 `/ddsm/api/auth/register`로 일반 계정을 만든 뒤, 관리자 콘솔에서 **휴대폰 번호 + 사용자 비밀번호 + 관리자 비밀번호**를 입력해야 합니다. 현재 SMS 소유 인증이 없으므로 공개 운영 전 가입 통제와 휴대폰 인증을 적용해야 합니다. 비밀키·해시를 저장소에 커밋하지 마세요.

### 관리자 경로

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/ddsm/api/admin/me` | 관리자 세션 확인 |
| POST | `/ddsm/api/admin/unlock` | 별도 관리자 비밀번호로 잠금 해제 |
| GET | `/ddsm/api/admin/deliveries?date=YYYY-MM-DD` | 당일 전체 원본 열·배송지·지도 좌표 조회 |
| POST | `/ddsm/api/admin/import` | 날짜와 엑셀을 multipart 전송하여 저장 |
| GET | `/ddsm/api/admin/destinations?q=상호명` | 과거 고유 배송지 검색 |
| POST | `/ddsm/api/admin/deliveries/{id}/location` | 고유 배송지 연결·중앙 좌표 수정 |

조회·쓰기 모두 관리자 인증을 요구하며, 쓰기에는 서버 세션의 CSRF 토큰이 필요합니다.

### 원본 파일 및 저장 정책

- `XLSX`, `XLSM`, `XLS`, `CSV(UTF-8·CP949·EUC-KR)` 지원; 최대 8MB·20시트·15,000행·160열. 더 큰 파일을 처리하려면 서버 용량/분할 업로드 설계가 필요합니다.
- 각 시트의 제목행을 추정해 운송장, 주소, 상호·수취인, 발송인, 전화번호, 품명, 착불, 담당기사, 배송상태 등을 표준 필드로 추출합니다. 인식되지 않은 열도 **raw_json에 원본 열 이름과 값 그대로** 저장됩니다.
- 해당 날짜·송장번호를 기준으로 재업로드 시 갱신합니다. 동일 운송장번호가 원본에서 반복 등장하면 발생 순서까지 구분하여 각 행을 보존합니다. 운송장이 없는 행도 원본 시트·행·내용을 기준으로 보존합니다.
- 원본 테이블은 SQLite `admin_deliveries`; 업로드 이력은 `import_batches`; 고유 배송지는 `destinations`; 원본 주소 → 수정 배송지 연결은 `destination_aliases`.
- 주소를 정규화한 키로 배송지를 중복 없이 저장하며, 같은 주소의 후속 배송은 기록된 지도 좌표를 재사용합니다. 상호명만 있는 항목은 같은 상호로 과거 저장된 배송지가 **정확히 하나일 때만** 자동 연결합니다. 둘 이상이면 수동 확인합니다.
- 처음 보는 주소는 관리자 웹에서 네이버 Geocoding으로 좌표를 찾습니다. 자동 조회는 최초 최대 60건, 수동 버튼으로 최대 200건씩 추가 조회합니다. API 사용량과 실패 건을 관리자가 확인해야 합니다.
- 지도에는 위치가 확인된 고유 배송지만 마커로 표시합니다. 하나의 배송지에 여러 물품이 있다면 마커는 하나이며 관련 화물은 목록에 각각 나타납니다.
- 관리자 웹은 선택 날짜의 모든 행을 API로 가져오고, 화면 부하를 막기 위해 250행씩 추가 표시합니다. 원본 열은 표에서 가로 스크롤로 확인할 수 있습니다.

**중요:** 현재 센터 관리자 기록과 DDSM 개인 배송 목록은 자동 동기화되지 않습니다. 관리콘솔과 인증 서버를 실제 배포한 뒤 별도 기사 조회/스캔 API를 구축해야 합니다. 엑셀에 포함된 개인정보의 업로드·보관·접근 권한은 운영자가 적법하게 관리해야 합니다.
